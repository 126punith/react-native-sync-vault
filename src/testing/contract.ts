/**
 * Behavioural contract every SyncVault engine must satisfy (MemorySyncVault, SyncVaultCore.kt,
 * SyncVaultCore.swift). The suite is runner-agnostic: pass Jest's (or Mocha's) globals.
 *
 *   defineContractSuite('MemorySyncVault', () => memoryHarness(), { describe, it, expect, beforeEach, afterEach });
 */
import type { EnqueueRequest, NativeConfig, RequestEvent, Spec } from '../specs/NativeSyncVault';
import type { Transport, TransportRequest, TransportResponse } from './MemorySyncVault';
import { MemorySyncVault, MemoryStore } from './MemorySyncVault';
import { DEFAULT_NATIVE_CONFIG } from '../core/defaults';
import { isUuidV7 } from '../core/uuid';

export interface ContractHarness {
  vault: Spec;
  /** Every request the engine sent, in order. */
  sent: TransportRequest[];
  /** Responds to the next request(s). Defaults to 200 {}. */
  respond(responder: (request: TransportRequest) => TransportResponse | Promise<TransportResponse>): void;
  setOnline(online: boolean): void;
  /** Moves the engine clock forward (backoff, Retry-After, TTLs). */
  advance(ms: number): void;
  now(): number;
  /** Runs the engine until nothing is eligible at the current clock. */
  settle(): Promise<void>;
  /** Kills the engine without letting in-flight requests complete, then starts a new one on the same storage. */
  restart(): Promise<void>;
  dispose(): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ContractRunner {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: any) => void;
  expect: (actual: unknown) => any;
  beforeEach: (fn: any) => void;
  afterEach: (fn: any) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const CONTRACT_CONFIG: NativeConfig = {
  ...DEFAULT_NATIVE_CONFIG,
  baseUrl: 'https://api.test',
  maxConcurrency: 4,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 60_000,
  defaultMaxAttempts: 3,
  backgroundIntervalMinutes: 0,
};

export function request(overrides: Partial<EnqueueRequest> = {}): EnqueueRequest {
  return {
    method: 'POST',
    url: '/todos',
    headers: {},
    body: '{"title":"a"}',
    contentType: 'application/json',
    idempotencyKey: null,
    queueKey: null,
    dedupeKey: null,
    ifMatch: null,
    priority: 0,
    maxAttempts: 0,
    conflictStrategy: 'manual',
    metadata: null,
    ...overrides,
  };
}

/** Deterministic harness over MemorySyncVault: manual clock, manual drains, scripted transport. */
export function memoryHarness(config: NativeConfig = CONTRACT_CONFIG): ContractHarness {
  let clock = 1_700_000_000_000;
  const store = new MemoryStore();
  const sent: TransportRequest[] = [];
  let responder: (request: TransportRequest) => TransportResponse | Promise<TransportResponse> = () => ({
    status: 200,
    body: '{}',
  });
  let online = true;
  const transport: Transport = async (req) => {
    sent.push(req);
    return responder(req);
  };
  const create = () =>
    new MemorySyncVault({
      store,
      transport,
      now: () => clock,
      random: () => 1,
      autoDrain: false,
      network: { isConnected: online },
    });
  let vault = create();
  store.kv.set('config', JSON.stringify(config));

  const harness: ContractHarness = {
    get vault() {
      return vault;
    },
    sent,
    respond(fn) {
      responder = fn;
    },
    setOnline(value) {
      online = value;
      vault.setNetwork({ isConnected: value, isInternetReachable: value, type: value ? 'wifi' : 'none' });
    },
    advance(ms) {
      clock += ms;
    },
    now: () => clock,
    settle: () => vault.drain(),
    async restart() {
      vault.crash();
      vault = create();
    },
    dispose() {
      vault.crash();
    },
  };
  return harness;
}

export function defineContractSuite(
  name: string,
  createHarness: () => ContractHarness | Promise<ContractHarness>,
  t: ContractRunner
): void {
  const { describe, it, expect, beforeEach, afterEach } = t;

  describe(`SyncVault contract: ${name}`, () => {
    let h: ContractHarness;
    let events: RequestEvent[];
    let sub: { remove: () => void };

    beforeEach(async () => {
      h = await createHarness();
      events = [];
      sub = h.vault.onRequestEvent((e) => {
        events.push(e);
      }) as unknown as { remove: () => void };
    });

    afterEach(() => {
      sub.remove();
      h.dispose();
    });

    const only = async (id: string) => {
      const rows = await h.vault.getRequests({ statuses: [], queueKey: null, limit: 1000, offset: 0 });
      return rows.find((r) => r.id === id) ?? null;
    };

    describe('enqueue', () => {
      it('commits a pending row with a UUIDv7 id and defaults the idempotency key to the id', async () => {
        h.setOnline(false);
        const id = await h.vault.enqueue(request());
        expect(isUuidV7(id)).toBe(true);
        const row = await only(id);
        expect(row).toMatchObject({ status: 'pending', idempotencyKey: id, attempt: 0, method: 'POST' });
        expect(events.map((e) => e.type)).toContain('enqueued');
      });

      it('rejects requests without method or url', async () => {
        await expect(h.vault.enqueue(request({ url: '' }))).rejects.toThrow();
      });

      it('rejects a duplicate idempotency key', async () => {
        h.setOnline(false);
        await h.vault.enqueue(request({ idempotencyKey: 'k1' }));
        await expect(h.vault.enqueue(request({ idempotencyKey: 'k1' }))).rejects.toThrow();
      });
    });

    describe('delivery', () => {
      it('sends the contract headers and records the server version', async () => {
        h.vault.setAuthHeaders({ Authorization: 'Bearer t1' });
        h.respond(() => ({ status: 201, headers: { ETag: '"7"' }, body: '{"id":"1"}' }));
        const id = await h.vault.enqueue(request({ ifMatch: '"6"', headers: { 'X-Trace': 'abc' } }));
        await h.settle();
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]).toMatchObject({ method: 'POST', url: 'https://api.test/todos', body: '{"title":"a"}' });
        expect(h.sent[0]!.headers).toMatchObject({
          'Idempotency-Key': id,
          'If-Match': '"6"',
          'Content-Type': 'application/json',
          Authorization: 'Bearer t1',
          'X-Trace': 'abc',
        });
        expect(await only(id)).toMatchObject({ status: 'succeeded', lastHttpStatus: 201, serverVersion: '"7"', attempt: 1 });
      });

      it('leaves absolute URLs untouched and never sends a body for GET', async () => {
        await h.vault.enqueue(request({ method: 'get', url: 'https://other.test/x', body: 'ignored' }));
        await h.settle();
        expect(h.sent[0]).toMatchObject({ method: 'GET', url: 'https://other.test/x', body: null });
      });

      it('delivers higher priority first', async () => {
        h.setOnline(false);
        await h.vault.enqueue(request({ url: '/low' }));
        await h.vault.enqueue(request({ url: '/high', priority: 10 }));
        h.setOnline(true);
        await h.settle();
        expect(h.sent.map((r) => r.url)).toEqual(['https://api.test/high', 'https://api.test/low']);
      });
    });

    describe('ordering', () => {
      it('delivers a queueKey strictly FIFO and blocks behind a failing head', async () => {
        h.setOnline(false);
        const a = await h.vault.enqueue(request({ url: '/a', queueKey: 'todo:1' }));
        await h.vault.enqueue(request({ url: '/b', queueKey: 'todo:1' }));
        await h.vault.enqueue(request({ url: '/other', queueKey: 'todo:2' }));
        h.respond((r) => (r.url.endsWith('/a') ? { status: 503 } : { status: 200 }));
        h.setOnline(true);
        await h.settle();
        expect(h.sent.map((r) => r.url)).toEqual(['https://api.test/a', 'https://api.test/other']);
        expect(await only(a)).toMatchObject({ status: 'pending', attempt: 1 });

        h.respond(() => ({ status: 200 }));
        h.advance(60_000);
        await h.settle();
        expect(h.sent.map((r) => r.url)).toEqual([
          'https://api.test/a',
          'https://api.test/other',
          'https://api.test/a',
          'https://api.test/b',
        ]);
      });

      it('keeps the queue blocked while the head is in conflict', async () => {
        h.setOnline(false);
        const a = await h.vault.enqueue(request({ url: '/a', queueKey: 'k' }));
        await h.vault.enqueue(request({ url: '/b', queueKey: 'k' }));
        h.respond(() => ({ status: 409, body: '{"version":3}' }));
        h.setOnline(true);
        await h.settle();
        expect(h.sent).toHaveLength(1);
        h.respond(() => ({ status: 200 }));
        await h.vault.resolveConflict(a, '{"merged":true}', '3');
        await h.settle();
        expect(h.sent.map((r) => r.url)).toEqual(['https://api.test/a', 'https://api.test/a', 'https://api.test/b']);
      });

      it('unblocks the queue when the head is dead-lettered', async () => {
        h.setOnline(false);
        await h.vault.enqueue(request({ url: '/a', queueKey: 'k' }));
        const b = await h.vault.enqueue(request({ url: '/b', queueKey: 'k' }));
        h.respond((r) => (r.url.endsWith('/a') ? { status: 400 } : { status: 200 }));
        h.setOnline(true);
        await h.settle();
        expect(await only(b)).toMatchObject({ status: 'succeeded' });
      });
    });

    describe('retries', () => {
      it('backs off on retryable statuses, honours Retry-After, and reuses the idempotency key', async () => {
        h.respond(() => ({ status: 429, headers: { 'Retry-After': '120' } }));
        const id = await h.vault.enqueue(request());
        await h.settle();
        const row = await only(id);
        expect(row).toMatchObject({ status: 'pending', attempt: 1, lastHttpStatus: 429 });
        expect(row!.nextAttemptAt).toBeGreaterThanOrEqual(h.now() + 120_000);

        h.advance(60_000);
        await h.settle();
        expect(h.sent).toHaveLength(1);

        h.respond(() => ({ status: 200 }));
        h.advance(61_000);
        await h.settle();
        expect(h.sent).toHaveLength(2);
        expect(h.sent[1]!.headers['Idempotency-Key']).toBe(h.sent[0]!.headers['Idempotency-Key']);
        expect(await only(id)).toMatchObject({ status: 'succeeded', attempt: 2 });
      });

      it('dead-letters after maxAttempts and retry() restores a fresh budget', async () => {
        h.respond(() => ({ status: 500 }));
        const id = await h.vault.enqueue(request({ maxAttempts: 2 }));
        await h.settle();
        h.advance(120_000);
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'dead_letter', attempt: 2 });
        expect((await h.vault.getCounts()).deadLetter).toBe(1);
        expect(events.map((e) => e.type)).toContain('dead_lettered');

        h.respond(() => ({ status: 200 }));
        await h.vault.retry(id);
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'succeeded', attempt: 1 });
      });

      it('dead-letters permanent 4xx immediately', async () => {
        h.respond(() => ({ status: 422, body: '{"error":"invalid"}' }));
        const id = await h.vault.enqueue(request());
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'dead_letter', attempt: 1, lastHttpStatus: 422, serverResponse: '{"error":"invalid"}' });
      });

      it('retryAllDeadLetters re-queues every dead letter', async () => {
        h.respond(() => ({ status: 400 }));
        await h.vault.enqueue(request());
        await h.vault.enqueue(request());
        await h.settle();
        h.respond(() => ({ status: 200 }));
        expect(await h.vault.retryAllDeadLetters()).toBe(2);
        await h.settle();
        expect((await h.vault.getCounts()).succeeded).toBe(2);
      });

      it('treats network errors as retryable', async () => {
        h.respond(() => {
          throw new Error('socket hang up');
        });
        const id = await h.vault.enqueue(request());
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'pending', attempt: 1, lastHttpStatus: 0, lastError: 'socket hang up' });
      });
    });

    describe('connectivity', () => {
      it('sends nothing while offline and drains on reconnect', async () => {
        h.setOnline(false);
        const id = await h.vault.enqueue(request());
        await h.settle();
        expect(h.sent).toHaveLength(0);
        h.setOnline(true);
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'succeeded' });
      });

      it('does not burn an attempt when connectivity drops mid-flight', async () => {
        h.respond(() => {
          h.setOnline(false);
          throw new Error('offline');
        });
        const id = await h.vault.enqueue(request());
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'pending', attempt: 0 });
      });
    });

    describe('auth', () => {
      it('parks requests on 401 without burning attempts and resumes with new headers', async () => {
        const auth: { requestToken: string; requestId: string }[] = [];
        const authSub = h.vault.onAuthHeadersNeeded((e) => {
          auth.push(e);
        }) as unknown as { remove: () => void };
        h.vault.setAuthHeaders({ Authorization: 'Bearer old' });
        h.respond((r) => (r.headers.Authorization === 'Bearer new' ? { status: 200 } : { status: 401 }));
        const id = await h.vault.enqueue(request());
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'pending', authBlocked: true, attempt: 0 });
        expect((await h.vault.getCounts()).authBlocked).toBe(1);
        expect(auth).toHaveLength(1);
        expect(auth[0]!.requestId).toBe(id);

        await h.settle();
        expect(h.sent).toHaveLength(1);

        h.vault.provideAuthHeaders(auth[0]!.requestToken, { Authorization: 'Bearer new' });
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'succeeded', authBlocked: false });
        authSub.remove();
      });
    });

    describe('conflicts', () => {
      it('parks manual conflicts and redelivers the resolved payload with a new key', async () => {
        const conflicts: { id: string; serverVersion: string | null; serverBody: string | null }[] = [];
        const cSub = h.vault.onConflict((e) => {
          conflicts.push(e);
        }) as unknown as { remove: () => void };
        h.respond(() => ({ status: 412, headers: { ETag: '"9"' }, body: '{"title":"server"}' }));
        const id = await h.vault.enqueue(request({ method: 'PATCH', url: '/todos/1', ifMatch: '"8"' }));
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'conflict', serverVersion: '"9"', serverResponse: '{"title":"server"}' });
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0]).toMatchObject({ id, serverVersion: '"9"', serverBody: '{"title":"server"}' });

        h.respond(() => ({ status: 200 }));
        await h.vault.resolveConflict(id, '{"title":"merged"}', '"9"');
        await h.settle();
        const resent = h.sent[1]!;
        expect(resent.body).toBe('{"title":"merged"}');
        expect(resent.headers['If-Match']).toBe('"9"');
        expect(resent.headers['Idempotency-Key']).not.toBe(h.sent[0]!.headers['Idempotency-Key']);
        expect(await only(id)).toMatchObject({ status: 'succeeded' });
        cSub.remove();
      });

      it('resolveConflict with a null payload discards the local change', async () => {
        h.respond(() => ({ status: 409 }));
        const id = await h.vault.enqueue(request());
        await h.settle();
        await h.vault.resolveConflict(id, null, null);
        expect(await only(id)).toBeNull();
        await expect(h.vault.resolveConflict(id, null, null)).rejects.toThrow();
      });

      it('client_wins retries automatically with the server version', async () => {
        h.respond((r) => (r.headers['If-Match'] === '"5"' ? { status: 200 } : { status: 412, headers: { ETag: '"5"' } }));
        const id = await h.vault.enqueue(request({ method: 'PUT', conflictStrategy: 'client_wins' }));
        await h.settle();
        expect(h.sent).toHaveLength(2);
        expect(await only(id)).toMatchObject({ status: 'succeeded', ifMatch: '"5"' });
      });

      it('server_wins drops the local change', async () => {
        h.respond(() => ({ status: 409 }));
        const id = await h.vault.enqueue(request({ conflictStrategy: 'server_wins' }));
        await h.settle();
        expect(await only(id)).toBeNull();
        expect(events.find((e) => e.type === 'discarded')?.id).toBe(id);
      });
    });

    describe('coalescing', () => {
      it('replaces an unsent pending request in place and keeps its key', async () => {
        h.setOnline(false);
        const first = await h.vault.enqueue(request({ body: '{"v":1}', dedupeKey: 'todo:1' }));
        const second = await h.vault.enqueue(request({ body: '{"v":2}', dedupeKey: 'todo:1' }));
        expect(second).toBe(first);
        const row = await only(first);
        expect(row).toMatchObject({ body: '{"v":2}', idempotencyKey: first });
        expect((await h.vault.getCounts()).pending).toBe(1);
        expect(events.map((e) => e.type)).toContain('coalesced');
      });

      it('rotates the idempotency key once the old body may have reached the server', async () => {
        h.respond(() => ({ status: 503 }));
        const id = await h.vault.enqueue(request({ body: '{"v":1}', dedupeKey: 'todo:1' }));
        await h.settle();
        await h.vault.enqueue(request({ body: '{"v":2}', dedupeKey: 'todo:1' }));
        const row = await only(id);
        expect(row!.idempotencyKey).not.toBe(id);
        expect(row).toMatchObject({ attempt: 0, nextAttemptAt: 0, body: '{"v":2}' });
      });

      it('rotates the key even when the previous attempt was refunded (401)', async () => {
        h.respond(() => ({ status: 401 }));
        const id = await h.vault.enqueue(request({ body: '{"v":1}', dedupeKey: 'todo:1' }));
        await h.settle();
        expect(await only(id)).toMatchObject({ attempt: 0, authBlocked: true });
        await h.vault.enqueue(request({ body: '{"v":2}', dedupeKey: 'todo:1' }));
        expect((await only(id))!.idempotencyKey).not.toBe(id);
      });

      it('never lets an older body for a dedupeKey overwrite a newer one', async () => {
        let release: ((r: TransportResponse) => void) | null = null;
        h.respond(
          () =>
            new Promise<TransportResponse>((resolve) => {
              release = resolve;
            })
        );
        const v1 = await h.vault.enqueue(request({ body: '{"v":1}', dedupeKey: 'title' }));
        const draining = h.settle();
        await new Promise((r) => setTimeout(r, 0));
        // v1 is on the wire, so v2 cannot replace it and becomes its own row.
        const v2 = await h.vault.enqueue(request({ body: '{"v":2}', dedupeKey: 'title' }));
        expect(v2).not.toBe(v1);
        // A later change folds into v2 (the newest unfinished row), never into v1.
        expect(await h.vault.enqueue(request({ body: '{"v":3}', dedupeKey: 'title' }))).toBe(v2);

        h.respond(() => ({ status: 200 }));
        (release as ((r: TransportResponse) => void) | null)?.({ status: 503 });
        await draining;
        await h.settle();
        // v2 waits behind v1 even though v1 is backing off.
        expect(h.sent.map((r) => r.body)).toEqual(['{"v":1}']);
        h.advance(60_000);
        await h.settle();
        expect(h.sent.map((r) => r.body)).toEqual(['{"v":1}', '{"v":1}', '{"v":3}']);
      });

      it('never coalesces into a request that is no longer pending', async () => {
        h.respond(() => ({ status: 400 }));
        const first = await h.vault.enqueue(request({ dedupeKey: 'd' }));
        await h.settle();
        const second = await h.vault.enqueue(request({ dedupeKey: 'd' }));
        expect(second).not.toBe(first);
      });
    });

    describe('durability', () => {
      it('recovers requests that were in flight when the process died and resends the same key', async () => {
        let release: (() => void) | null = null;
        h.respond(
          () =>
            new Promise<TransportResponse>((resolve) => {
              release = () => resolve({ status: 200 });
            })
        );
        const id = await h.vault.enqueue(request());
        const pending = h.settle();
        await new Promise((r) => setTimeout(r, 0));
        expect((await only(id))!.status).toBe('inflight');
        await h.restart();
        (release as (() => void) | null)?.();
        await pending.catch(() => undefined);
        expect((await only(id))!.status).toBe('pending');

        h.respond(() => ({ status: 200 }));
        await h.settle();
        expect(h.sent).toHaveLength(2);
        expect(h.sent[1]!.headers['Idempotency-Key']).toBe(h.sent[0]!.headers['Idempotency-Key']);
        expect(await only(id)).toMatchObject({ status: 'succeeded' });
      });

      it('persists auth headers across restarts', async () => {
        h.vault.setAuthHeaders({ Authorization: 'Bearer persisted' });
        await h.restart();
        h.respond((r) => ({ status: r.headers.Authorization === 'Bearer persisted' ? 200 : 401 }));
        const id = await h.vault.enqueue(request());
        await h.settle();
        expect(await only(id)).toMatchObject({ status: 'succeeded' });
      });
    });

    describe('management', () => {
      it('filters, pages, discards, and purges', async () => {
        h.setOnline(false);
        const ids = [] as string[];
        for (let i = 0; i < 5; i++) ids.push(await h.vault.enqueue(request({ queueKey: i % 2 ? 'odd' : 'even' })));
        const page = await h.vault.getRequests({ statuses: ['pending'], queueKey: null, limit: 2, offset: 1 });
        expect(page.map((r) => r.id)).toEqual(ids.slice(1, 3));
        expect((await h.vault.getRequests({ statuses: [], queueKey: 'odd', limit: 10, offset: 0 })).length).toBe(2);

        await h.vault.discard(ids[0]!);
        expect(await only(ids[0]!)).toBeNull();

        h.setOnline(true);
        await h.settle();
        expect((await h.vault.getCounts()).succeeded).toBe(4);
        expect(await h.vault.purgeSucceeded(60_000)).toBe(0);
        h.advance(61_000);
        expect(await h.vault.purgeSucceeded(60_000)).toBe(4);
      });

      it('generates time-ordered ids', () => {
        const a = h.vault.generateId();
        h.advance(1);
        const b = h.vault.generateId();
        expect(isUuidV7(a) && isUuidV7(b)).toBe(true);
        expect(a < b).toBe(true);
      });

      it('records the background drain policy', () => {
        h.vault.scheduleBackgroundDrain({ intervalMinutes: 30, requiresUnmeteredNetwork: true, requiresCharging: false });
        h.vault.cancelBackgroundDrain();
      });
    });

    describe('cache', () => {
      it('stores, expires, invalidates, and evicts', async () => {
        await h.vault.cacheSet('/todos', '[1]', 1000, ['todos']);
        await h.vault.cacheSet('/todos/1', '{"id":1}', 0, ['todo:1']);
        await h.vault.cacheSet('/users/1', '{"id":1}', 0, []);
        expect(await h.vault.cacheGet('/todos')).toMatchObject({ value: '[1]', tags: ['todos'] });

        h.advance(1001);
        expect(await h.vault.cacheGet('/todos')).toBeNull();

        expect(await h.vault.cacheInvalidate('/todos', [])).toBe(1);
        expect(await h.vault.cacheGet('/todos/1')).toBeNull();
        await h.vault.cacheSet('/todos/2', 'x', 0, ['todo:2']);
        expect(await h.vault.cacheInvalidate(null, ['todo:2'])).toBe(1);

        await h.vault.cacheSet('/a', 'aaaa', 0, []);
        h.advance(1);
        await h.vault.cacheSet('/b', 'bbbb', 0, []);
        h.advance(1);
        await h.vault.cacheGet('/a');
        const before = await h.vault.cacheStats();
        expect(before.entries).toBe(3);
        await h.vault.cacheEvict(before.sizeBytes - 1);
        expect(await h.vault.cacheGet('/users/1')).toBeNull();
        expect(await h.vault.cacheGet('/a')).not.toBeNull();

        await h.vault.cacheDelete('/a');
        expect(await h.vault.cacheGet('/a')).toBeNull();
        await h.vault.cacheClear();
        expect((await h.vault.cacheStats()).entries).toBe(0);
      });
    });
  });
}
