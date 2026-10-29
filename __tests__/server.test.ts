/**
 * The reference Express middleware (server/express-sync-vault) against the backend contract in
 * docs/BACKEND_CONTRACT.md.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { startTodoServer, type TodoServer } from './helpers/todoServer';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = require('../server/express-sync-vault/src');

async function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('express-sync-vault', () => {
  describe('idempotency', () => {
    let server: TodoServer;
    beforeEach(async () => {
      server = await startTodoServer();
    });
    afterEach(() => server.close());

    it('replays the stored response for a repeated key without re-running the handler', async () => {
      const first = await fetch(`${server.baseUrl}/todos`, json({ id: 'a', title: 'x' }, { 'Idempotency-Key': 'k1' }));
      const second = await fetch(`${server.baseUrl}/todos`, json({ id: 'a', title: 'x' }, { 'Idempotency-Key': 'k1' }));
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.headers.get('idempotent-replayed')).toBe('true');
      expect(second.headers.get('etag')).toBe(first.headers.get('etag'));
      expect(await second.json()).toEqual(await first.json());
      expect(server.effects).toHaveLength(1);
    });

    it('rejects a reused key with a different payload (422)', async () => {
      await fetch(`${server.baseUrl}/todos`, json({ id: 'a' }, { 'Idempotency-Key': 'k2' }));
      const reused = await fetch(`${server.baseUrl}/todos`, json({ id: 'b' }, { 'Idempotency-Key': 'k2' }));
      expect(reused.status).toBe(422);
      expect(server.todos.has('b')).toBe(false);
    });

    it('answers a concurrent duplicate with 425 + Retry-After instead of 409', async () => {
      // The todo server's delay fault runs before the idempotency lock, so hold the lock with a slow handler.
      const slow = express();
      slow.use(express.json());
      slow.use(lib.idempotency({ store: new lib.MemoryStore() }));
      slow.post('/slow', (_req, res) => setTimeout(() => res.status(201).json({ ok: true }), 200));
      const app = await listen(slow);
      try {
        const first = fetch(`${app.url}/slow`, json({}, { 'Idempotency-Key': 'k3' }));
        await new Promise((r) => setTimeout(r, 50));
        const dup = await fetch(`${app.url}/slow`, json({}, { 'Idempotency-Key': 'k3' }));
        expect(dup.status).toBe(425);
        expect(dup.headers.get('retry-after')).toBe('1');
        expect((await first).status).toBe(201);
        const after = await fetch(`${app.url}/slow`, json({}, { 'Idempotency-Key': 'k3' }));
        expect(after.headers.get('idempotent-replayed')).toBe('true');
      } finally {
        await app.close();
      }
    });

    it('does not store transient failures, so a retry re-executes', async () => {
      const app = express();
      app.use(express.json());
      app.use(lib.idempotency());
      let calls = 0;
      app.post('/flaky', (_req, res) => {
        calls++;
        if (calls === 1) return res.status(503).json({ error: 'busy' });
        return res.status(200).json({ calls });
      });
      const s = await listen(app);
      try {
        expect((await fetch(`${s.url}/flaky`, json({}, { 'Idempotency-Key': 'k4' }))).status).toBe(503);
        const retry = await fetch(`${s.url}/flaky`, json({}, { 'Idempotency-Key': 'k4' }));
        expect(retry.status).toBe(200);
        expect(retry.headers.get('idempotent-replayed')).toBeNull();
      } finally {
        await s.close();
      }
    });

    it('records the effect even when the client never reads the response', async () => {
      server.faults.push({ dropResponse: true });
      await expect(fetch(`${server.baseUrl}/todos`, json({ id: 'd' }, { 'Idempotency-Key': 'k5' }))).rejects.toThrow();
      const retry = await fetch(`${server.baseUrl}/todos`, json({ id: 'd' }, { 'Idempotency-Key': 'k5' }));
      expect(retry.status).toBe(201);
      expect(retry.headers.get('idempotent-replayed')).toBe('true');
      expect(server.effects.filter((e) => e.id === 'd')).toHaveLength(1);
    });

    it('fingerprints payloads independent of key order', () => {
      expect(lib.stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(lib.stableStringify({ a: [{ c: 2, d: 1 }], b: 1 }));
    });
  });

  describe('If-Match', () => {
    let server: TodoServer;
    beforeEach(async () => {
      server = await startTodoServer();
    });
    afterEach(() => server.close());

    it('rejects stale writes with 412, the current body, and its ETag', async () => {
      await fetch(`${server.baseUrl}/todos`, json({ id: 'a', title: 'v1' }));
      const ok = await fetch(`${server.baseUrl}/todos/a`, { ...json({ title: 'v2' }), method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('etag')).toBe('"2"');

      const stale = await fetch(`${server.baseUrl}/todos/a`, { ...json({ title: 'v3' }), method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' } });
      expect(stale.status).toBe(412);
      expect(stale.headers.get('etag')).toBe('"2"');
      expect(await stale.json()).toMatchObject({ current: { title: 'v2', version: 2 } });
      expect(server.todos.get('a')!.title).toBe('v2');
    });

    it('normalises weak and quoted ETags', () => {
      expect(lib.normalizeETag('W/"5"')).toBe(lib.normalizeETag('"5"'));
      expect(lib.formatETag(5)).toBe('"5"');
    });
  });

  describe('Retry-After', () => {
    it('adds a default Retry-After to 429 and 503 responses', async () => {
      const app = express();
      app.use(lib.retryAfter({ defaultSeconds: 7 }));
      app.get('/busy', (_req, res) => res.status(503).end());
      app.get('/explicit', (_req, res) => res.set('Retry-After', '2').status(429).end());
      app.get('/fine', (_req, res) => res.status(500).end());
      const s = await listen(app);
      try {
        expect((await fetch(`${s.url}/busy`)).headers.get('retry-after')).toBe('7');
        expect((await fetch(`${s.url}/explicit`)).headers.get('retry-after')).toBe('2');
        expect((await fetch(`${s.url}/fine`)).headers.get('retry-after')).toBeNull();
      } finally {
        await s.close();
      }
    });

    it('rate limits with an accurate Retry-After', async () => {
      const app = express();
      app.use(lib.rateLimit({ windowMs: 10_000, max: 2, key: () => 'one' }));
      app.get('/', (_req, res) => res.send('ok'));
      const s = await listen(app);
      try {
        await fetch(s.url);
        await fetch(s.url);
        const limited = await fetch(s.url);
        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      } finally {
        await s.close();
      }
    });
  });

  describe('batch', () => {
    let server: TodoServer;
    beforeEach(async () => {
      server = await startTodoServer();
    });
    afterEach(() => server.close());

    it('applies operations in order with per-operation idempotency', async () => {
      const ops = {
        operations: [
          { id: 'op1', method: 'POST', path: '/todos', body: { id: 'b1', title: 'x' }, headers: { 'Idempotency-Key': 'bk1' } },
          { id: 'op2', method: 'PATCH', path: '/todos/b1', body: { done: true }, headers: { 'If-Match': '"1"', 'Idempotency-Key': 'bk2' } },
        ],
      };
      const res = await fetch(`${server.baseUrl}/sync/batch`, json(ops));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: { status: number }[] };
      expect(body.results.map((r) => r.status)).toEqual([201, 200]);

      const again = (await (await fetch(`${server.baseUrl}/sync/batch`, json(ops))).json()) as {
        results: { id: string; status: number; headers: Record<string, string> }[];
      };
      expect(again.results.map((r) => [r.id, r.status, r.headers['idempotent-replayed']])).toEqual([
        ['op1', 201, 'true'],
        ['op2', 200, 'true'],
      ]);
      expect(server.effects.map((e) => e.type)).toEqual(['create', 'update']);
    });
  });
});
