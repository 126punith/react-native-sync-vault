/**
 * Chaos tests: the reference engine over real HTTP against the reference Express server
 * (server/express-sync-vault/example/todo-server.js) with injected 5xx/429, dropped responses,
 * client timeouts, process kills, expired auth, and stale writes. The server records every applied
 * side effect, so exactly-once delivery is checked from the server's point of view.
 */
import { MemorySyncVault, MemoryStore } from '../src/testing';
import { setNativeImplementation } from '../src/native';
import { SyncVault } from '../src/core/SyncVault';
import { DEFAULT_NATIVE_CONFIG } from '../src/core/defaults';
import type { NativeConfig } from '../src/specs/NativeSyncVault';
import { startTodoServer, waitFor, type Fault, type TodoServer } from './helpers/todoServer';

const TOKEN = 'secret';

function config(server: TodoServer, overrides: Partial<NativeConfig> = {}): NativeConfig {
  return {
    ...DEFAULT_NATIVE_CONFIG,
    baseUrl: server.baseUrl,
    maxConcurrency: 4,
    requestTimeoutMs: 400,
    leaseMs: 1000,
    retryBaseDelayMs: 5,
    retryMaxDelayMs: 40,
    defaultMaxAttempts: 25,
    backgroundIntervalMinutes: 0,
    ...overrides,
  };
}

async function idle(vault: MemorySyncVault, timeoutMs = 15_000): Promise<void> {
  await waitFor(
    async () => {
      const c = await vault.getCounts();
      return c.pending + c.inflight === 0;
    },
    timeoutMs,
    'the outbox to drain'
  );
}

function createTodo(vault: MemorySyncVault, id: string, title = id) {
  return vault.enqueue({
    method: 'POST',
    url: '/todos',
    headers: {},
    body: JSON.stringify({ id, title }),
    contentType: 'application/json',
    idempotencyKey: null,
    queueKey: `todo:${id}`,
    dedupeKey: null,
    ifMatch: null,
    priority: 0,
    maxAttempts: 0,
    conflictStrategy: 'manual',
    metadata: null,
  });
}

const randomFault = (rand: () => number): Fault => {
  const r = rand();
  if (r < 0.25) return { status: 500 };
  if (r < 0.45) return { status: 503, retryAfter: 0 };
  if (r < 0.6) return { status: 429, retryAfter: 0 };
  if (r < 0.8) return { dropResponse: true };
  return { delayMs: 600 };
};

describe('chaos: engine against the reference server', () => {
  let server: TodoServer;
  const vaults: MemorySyncVault[] = [];

  beforeEach(async () => {
    server = await startTodoServer({ token: TOKEN });
  });

  afterEach(async () => {
    for (const v of vaults.splice(0)) v.crash();
    SyncVault.reset();
    setNativeImplementation(null);
    await server.close();
  });

  const open = (store = new MemoryStore()) => {
    const vault = new MemorySyncVault({ store });
    vaults.push(vault);
    return vault;
  };

  it('applies every create exactly once through 5xx, 429, dropped responses, and timeouts', async () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 60; i++) server.faults.push(randomFault(rand));

    const vault = open();
    await vault.configure(config(server));
    vault.setAuthHeaders({ Authorization: `Bearer ${TOKEN}` });
    const ids = Array.from({ length: 40 }, (_, i) => `t${i}`);
    for (const id of ids) await createTodo(vault, id);

    await idle(vault, 30_000);
    await new Promise((r) => setTimeout(r, 700)); // let delayed (timed-out) originals reach the server

    expect((await vault.getCounts()).succeeded).toBe(ids.length);
    expect([...server.todos.keys()].sort()).toEqual([...ids].sort());
    const creates = server.effects.filter((e) => e.type === 'create').map((e) => e.id);
    expect(creates.sort()).toEqual([...ids].sort());
    expect(server.requestCount).toBeGreaterThan(ids.length);
  }, 60_000);

  it('survives being killed mid-flight without losing or duplicating writes', async () => {
    const store = new MemoryStore();
    let vault = open(store);
    await vault.configure(config(server, { maxConcurrency: 2 }));
    vault.setAuthHeaders({ Authorization: `Bearer ${TOKEN}` });
    for (let i = 0; i < 10; i++) server.faults.push({ delayMs: 150 });
    const ids = Array.from({ length: 20 }, (_, i) => `k${i}`);
    for (const id of ids) await createTodo(vault, id);

    // Kill the process a few times while requests are on the wire; the server keeps applying them.
    for (let kill = 0; kill < 3; kill++) {
      await new Promise((r) => setTimeout(r, 80));
      vault.crash();
      vault = open(store);
    }

    await idle(vault);
    await new Promise((r) => setTimeout(r, 300));
    expect((await vault.getCounts()).succeeded).toBe(ids.length);
    const creates = server.effects.filter((e) => e.type === 'create').map((e) => e.id);
    expect(creates.sort()).toEqual([...ids].sort());
  }, 30_000);

  it('keeps create, update, delete for one record in order through failures', async () => {
    const vault = open();
    await vault.configure(config(server));
    vault.setAuthHeaders({ Authorization: `Bearer ${TOKEN}` });
    server.faults.push({ status: 503, retryAfter: 0 }, { dropResponse: true }, { status: 500 });

    await createTodo(vault, 'x');
    const base = {
      headers: {},
      contentType: 'application/json',
      idempotencyKey: null,
      queueKey: 'todo:x',
      dedupeKey: null,
      ifMatch: null,
      priority: 0,
      maxAttempts: 0,
      conflictStrategy: 'manual',
      metadata: null,
    };
    await vault.enqueue({ ...base, method: 'PATCH', url: '/todos/x', body: '{"done":true}' });
    await vault.enqueue({ ...base, method: 'PATCH', url: '/todos/x', body: '{"title":"renamed"}' });
    await vault.enqueue({ ...base, method: 'DELETE', url: '/todos/x', body: null });

    await idle(vault);
    expect(server.effects.map((e) => e.type)).toEqual(['create', 'update', 'update', 'delete']);
    expect(server.todos.has('x')).toBe(false);
  }, 30_000);

  it('refreshes expired credentials through SyncVault.getAuthHeaders without losing attempts', async () => {
    const vault = open();
    setNativeImplementation(vault);
    let calls = 0;
    await SyncVault.configure({
      ...config(server),
      maxAttempts: 2,
      getAuthHeaders: async (ctx) => {
        calls++;
        // The first token (at configure) is stale; the refresh after the 401 is valid.
        return { Authorization: ctx.reason === 'unauthorized' ? `Bearer ${TOKEN}` : 'Bearer expired' };
      },
    });
    const id = await SyncVault.enqueue({ method: 'POST', url: '/todos', body: { id: 'auth1', title: 'a' } });
    await idle(vault);
    expect(await SyncVault.getRequest(id)).toMatchObject({ status: 'succeeded', attempt: 1 });
    expect(calls).toBe(2);
    expect(server.todos.has('auth1')).toBe(true);
  }, 30_000);

  it('resolves a stale write (412) with a merge function and the server version', async () => {
    const vault = open();
    setNativeImplementation(vault);
    await SyncVault.configure({ ...config(server), getAuthHeaders: () => ({ Authorization: `Bearer ${TOKEN}` }) });
    server.todos.set('m', { id: 'm', title: 'server title', done: false, version: 2 });

    const conflicts: string[] = [];
    SyncVault.addConflictListener((c) => conflicts.push(c.id));
    const id = await SyncVault.enqueue({
      method: 'PATCH',
      url: '/todos/m',
      body: { done: true },
      ifMatch: '"1"',
      queueKey: 'todo:m',
      merge: (local, server) => ({ ...(server as object), ...(local as object) }),
    });

    await waitFor(async () => (await SyncVault.getRequest(id))?.status === 'succeeded', 10_000, 'merge to be delivered');
    expect(conflicts).toEqual([id]);
    const todo = server.todos.get('m')!;
    expect(todo).toMatchObject({ title: 'server title', done: true, version: 3 });
    expect(server.effects.filter((e) => e.type === 'update')).toHaveLength(1);
  }, 30_000);

  it('dead-letters permanent rejections and keeps the rest of the queue moving', async () => {
    const vault = open();
    await vault.configure(config(server));
    vault.setAuthHeaders({ Authorization: `Bearer ${TOKEN}` });
    const bad = await vault.enqueue({
      method: 'POST',
      url: '/todos',
      headers: {},
      body: JSON.stringify({ title: 'no id' }),
      contentType: 'application/json',
      idempotencyKey: null,
      queueKey: 'todos',
      dedupeKey: null,
      ifMatch: null,
      priority: 0,
      maxAttempts: 0,
      conflictStrategy: 'manual',
      metadata: null,
    });
    await createTodo(vault, 'after');
    await idle(vault);
    const rows = await vault.getRequests({ statuses: [], queueKey: null, limit: 10, offset: 0 });
    expect(rows.find((r) => r.id === bad)).toMatchObject({ status: 'dead_letter', lastHttpStatus: 422, attempt: 1 });
    expect(server.todos.has('after')).toBe(true);
  }, 30_000);
});
