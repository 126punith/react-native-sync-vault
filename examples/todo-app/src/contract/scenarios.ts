/**
 * Native contract scenarios: the same guarantees as src/testing/contract.ts in the library, run
 * through the real Turbo Module (Kotlin or Swift) over real HTTP against the reference server's
 * test control API. The Detox suite runs them on both platforms, so Android and iOS must agree.
 */
import {Platform} from 'react-native';
import {SyncVault, type SyncEvent, type SyncRequest} from 'react-native-sync-vault';
import {API_URL, auth} from '../config';

export interface ScenarioResult {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

interface ServerState {
  todos: {id: string; title: string; done: boolean; version: number}[];
  effects: {type: string; id: string; idempotencyKey: string | null}[];
  requests: {method: string; path: string; idempotencyKey: string | null; at: number}[];
}

type Fault = {status?: number; retryAfter?: number; delayMs?: number; dropResponse?: boolean; method?: string; path?: string};

const DEFAULT_TOKEN = 'demo-token';

async function control(path: string, method = 'GET', body?: unknown): Promise<any> {
  const res = await fetch(`${API_URL}/__control${path}`, {
    method,
    headers: {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`control ${path}: HTTP ${res.status}`);
  return res.json();
}

const state = (): Promise<ServerState> => control('/state');
const faults = (list: Fault[]) => control('/faults', 'POST', list);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, label: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

const settled = (id: string, status: string) =>
  waitFor(async () => {
    const row = await SyncVault.getRequest(id);
    return row && row.status === status ? row : null;
  }, `${id.slice(0, 8)} to be ${status}`);

const uid = (prefix: string) => `${prefix}-${SyncVault.generateId().slice(-12)}`;

const create = (id: string, title = id, queueKey: string | null = `todo:${id}`) =>
  SyncVault.enqueue({method: 'POST', url: '/todos', body: {id, title}, queueKey: queueKey ?? undefined});

/** Starts each scenario from a clean server and an empty local outbox. */
async function reset(): Promise<void> {
  auth.token = DEFAULT_TOKEN;
  await control('/reset', 'POST', {token: DEFAULT_TOKEN});
  SyncVault.setAuthHeaders({Authorization: `Bearer ${DEFAULT_TOKEN}`});
  const leftovers = await SyncVault.getRequests({status: ['pending', 'conflict', 'dead_letter'], limit: 1000});
  for (const row of leftovers) await SyncVault.discard(row.id);
  await SyncVault.purgeSucceeded(0);
}

export const scenarios: {name: string; run: () => Promise<string>}[] = [
  {
    name: 'delivers with the contract headers',
    async run() {
      const events: SyncEvent[] = [];
      const off = SyncVault.addEventListener(e => events.push(e));
      try {
        const id = uid('h');
        const requestId = await create(id);
        const row = await settled(requestId, 'succeeded');
        const server = await state();
        const sent = server.requests.find(r => r.method === 'POST' && r.path === '/todos');
        assert(sent?.idempotencyKey === row.idempotencyKey, `server saw key ${sent?.idempotencyKey}, outbox has ${row.idempotencyKey}`);
        assert(row.lastHttpStatus === 201 && row.serverVersion === '"1"', `status ${row.lastHttpStatus}, version ${row.serverVersion}`);
        const types = events.filter(e => e.id === requestId).map(e => e.type);
        assert(types[0] === 'enqueued' && types.includes('attempt') && types[types.length - 1] === 'succeeded', `events ${types.join(',')}`);
        return `key ${row.idempotencyKey.slice(0, 8)}…, events ${types.join(' → ')}`;
      } finally {
        off();
      }
    },
  },
  {
    name: 'exactly once through 5xx, 429, and dropped responses',
    async run() {
      await faults([
        {status: 500, method: 'POST'},
        {status: 503, retryAfter: 0, method: 'POST'},
        {status: 429, retryAfter: 0, method: 'POST'},
        {dropResponse: true, method: 'POST'},
        {dropResponse: true, method: 'POST'},
      ]);
      const ids = Array.from({length: 6}, () => uid('x'));
      const requestIds = await Promise.all(ids.map(id => create(id)));
      for (const r of requestIds) await settled(r, 'succeeded');
      const server = await state();
      for (const id of ids) {
        const count = server.effects.filter(e => e.type === 'create' && e.id === id).length;
        assert(count === 1, `${id} applied ${count} times`);
      }
      return `${ids.length} creates, ${server.requests.length} HTTP requests, each applied once`;
    },
  },
  {
    name: 'FIFO per queueKey',
    async run() {
      await faults([{status: 503, retryAfter: 0, method: 'POST'}]);
      const id = uid('f');
      const q = `todo:${id}`;
      await create(id, 'v1', q);
      await SyncVault.enqueue({method: 'PATCH', url: `/todos/${id}`, body: {done: true}, queueKey: q});
      const last = await SyncVault.enqueue({method: 'DELETE', url: `/todos/${id}`, queueKey: q});
      await settled(last, 'succeeded');
      const types = (await state()).effects.filter(e => e.id === id).map(e => e.type);
      assert(types.join(',') === 'create,update,delete', `server applied ${types.join(',')}`);
      return types.join(' → ');
    },
  },
  {
    name: 'Retry-After is honoured',
    async run() {
      await faults([{status: 503, retryAfter: 2, method: 'POST'}]);
      const id = uid('r');
      await settled(await create(id), 'succeeded');
      const posts = (await state()).requests.filter(r => r.method === 'POST');
      assert(posts.length === 2, `${posts.length} attempts`);
      const gap = posts[1].at - posts[0].at;
      assert(gap >= 1900, `retried after ${gap}ms`);
      return `retried after ${gap}ms`;
    },
  },
  {
    name: 'dedupeKey: newest change wins, never overwritten',
    async run() {
      const id = uid('d');
      await settled(await create(id), 'succeeded');
      await faults([{delayMs: 1500, method: 'PATCH'}]);
      const key = `title:${id}`;
      const v1 = await SyncVault.enqueue({method: 'PATCH', url: `/todos/${id}`, body: {title: 'v1'}, dedupeKey: key});
      await waitFor(async () => (await SyncVault.getRequest(v1))?.status === 'inflight', 'v1 in flight');
      const v2 = await SyncVault.enqueue({method: 'PATCH', url: `/todos/${id}`, body: {title: 'v2'}, dedupeKey: key});
      const v3 = await SyncVault.enqueue({method: 'PATCH', url: `/todos/${id}`, body: {title: 'v3'}, dedupeKey: key});
      assert(v2 !== v1 && v3 === v2, 'v3 should fold into v2, not into the in-flight v1');
      await settled(v2, 'succeeded');
      const server = await state();
      const todo = server.todos.find(t => t.id === id);
      const updates = server.effects.filter(e => e.type === 'update' && e.id === id).length;
      assert(todo?.title === 'v3' && updates === 2, `title ${todo?.title}, ${updates} updates`);
      return `server has "${todo.title}" after ${updates} updates`;
    },
  },
  {
    name: '401 refreshes credentials without burning attempts',
    async run() {
      const rotated = `rotated-${Date.now()}`;
      await control('/token', 'POST', {token: rotated});
      SyncVault.setAuthHeaders({Authorization: 'Bearer stale'});
      auth.token = rotated;
      const row = await settled(await create(uid('a')), 'succeeded');
      assert(row.attempt === 1, `attempt ${row.attempt}`);
      const statuses = (await state()).requests.filter(r => r.method === 'POST').length;
      return `${statuses} sends, attempt counter ${row.attempt}`;
    },
  },
  {
    name: '412 conflict merged with the server version',
    async run() {
      const id = uid('m');
      await settled(await create(id, 'original'), 'succeeded');
      await control(`/todos/${id}`, 'PUT', {title: 'edited elsewhere', done: false, version: 5});
      const conflicts: string[] = [];
      const off = SyncVault.addConflictListener(c => conflicts.push(c.id));
      try {
        const requestId = await SyncVault.enqueue({
          method: 'PATCH',
          url: `/todos/${id}`,
          body: {done: true},
          ifMatch: '"1"',
          merge: (local, server) => ({title: (server as any)?.current?.title, ...(local as object)}),
        });
        await settled(requestId, 'succeeded');
        const todo = (await state()).todos.find(t => t.id === id)!;
        assert(conflicts.includes(requestId), 'conflict event not delivered');
        assert(todo.title === 'edited elsewhere' && todo.done && todo.version === 6, JSON.stringify(todo));
        return `merged to v${todo.version}: "${todo.title}", done=${todo.done}`;
      } finally {
        off();
      }
    },
  },
  {
    name: 'permanent 4xx is dead-lettered once',
    async run() {
      const requestId = await SyncVault.enqueue({method: 'POST', url: '/todos', body: {title: 'missing id'}});
      const row: SyncRequest = await settled(requestId, 'dead_letter');
      assert(row.attempt === 1 && row.lastHttpStatus === 422, `attempt ${row.attempt}, HTTP ${row.lastHttpStatus}`);
      await SyncVault.discard(requestId);
      assert((await SyncVault.getRequest(requestId)) === null, 'discard did not remove the row');
      return 'HTTP 422 after 1 attempt, then discarded';
    },
  },
];

export async function runScenarios(onResult: (result: ScenarioResult) => void): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const started = Date.now();
    let result: ScenarioResult;
    try {
      await reset();
      const detail = await scenario.run();
      result = {name: scenario.name, ok: true, detail, ms: Date.now() - started};
    } catch (error) {
      result = {name: scenario.name, ok: false, detail: error instanceof Error ? error.message : String(error), ms: Date.now() - started};
    }
    results.push(result);
    onResult(result);
  }
  await reset().catch(() => undefined);
  return results;
}

/** Posts results to the server so CI can assert a headless run (GET /__control/report). */
export async function reportResults(results: ScenarioResult[]): Promise<void> {
  await control('/report', 'POST', {platform: Platform.OS, passed: results.filter(r => r.ok).length, total: results.length, results});
}
