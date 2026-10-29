/**
 * Randomised state-machine tests over the reference engine. Each seed runs a random sequence of
 * operations against a fault-injecting server model and checks the outbox invariants after every
 * step; a final healing phase checks liveness (nothing is stuck in a non-terminal state).
 *
 *   SYNC_VAULT_SEEDS=2000 npx jest stateMachine   # more seeds
 *   SYNC_VAULT_SEED=1234 npx jest stateMachine    # reproduce one failure
 */
import { memoryHarness, request, CONTRACT_CONFIG, type ContractHarness } from '../src/testing/contract';
import type { TransportRequest, TransportResponse } from '../src/testing/MemorySyncVault';
import type { QueuedRequest, RequestEvent } from '../src/specs/NativeSyncVault';

const VALID_STATES = new Set(['pending', 'inflight', 'succeeded', 'conflict', 'dead_letter']);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Outcome =
  | { kind: 'status'; status: number; retryAfter?: number; etag?: string }
  | { kind: 'network' }
  | { kind: 'drop' }
  | { kind: 'offline' };

function pickOutcome(rand: () => number): Outcome {
  const r = rand();
  if (r < 0.45) return { kind: 'status', status: rand() < 0.5 ? 200 : 201 };
  if (r < 0.55) return { kind: 'status', status: [500, 502, 503][Math.floor(rand() * 3)]! };
  if (r < 0.6) return { kind: 'status', status: 429, retryAfter: Math.floor(rand() * 3) };
  if (r < 0.65) return { kind: 'status', status: 409, etag: rand() < 0.5 ? `"v${Math.floor(rand() * 9)}"` : undefined };
  if (r < 0.7) return { kind: 'status', status: 412, etag: `"v${Math.floor(rand() * 9)}"` };
  if (r < 0.75) return { kind: 'status', status: 401 };
  if (r < 0.8) return { kind: 'status', status: rand() < 0.5 ? 400 : 422 };
  if (r < 0.9) return { kind: 'network' };
  if (r < 0.95) return { kind: 'drop' };
  return { kind: 'offline' };
}

interface ServerModel {
  /** Idempotency records: key -> body fingerprint and replayable response. */
  records: Map<string, { body: string | null; response: TransportResponse }>;
  /** Applied side effects, one per (key) at most. */
  effects: string[];
  /** Every body ever sent under each key. */
  bodiesByKey: Map<string, Set<string | null>>;
  healthy: boolean;
}

/** Event counts from the faulty phase across all seeds, to prove the histories exercise every path. */
const coverage = new Map<string, number>();

async function runSeed(seed: number, steps: number): Promise<void> {
  const rand = mulberry32(seed);
  const h: ContractHarness = memoryHarness({ ...CONTRACT_CONFIG, defaultMaxAttempts: 3, maxConcurrency: 1 + Math.floor(rand() * 4) });
  const server: ServerModel = { records: new Map(), effects: [], bodiesByKey: new Map(), healthy: false };
  const removed = new Set<string>();
  const enqueued = new Set<string>();
  const violations: string[] = [];
  let sub: { remove: () => void } | null = null;

  const subscribe = () => {
    sub?.remove();
    sub = h.vault.onRequestEvent((e: RequestEvent) => {
      if (process.env.SYNC_VAULT_TRACE) console.log(JSON.stringify(e));
      if (!server.healthy) coverage.set(e.type, (coverage.get(e.type) ?? 0) + 1);
      if (e.type === 'discarded' && e.id) removed.add(e.id);
    }) as unknown as { remove: () => void };
  };
  subscribe();

  const rows = async (): Promise<QueuedRequest[]> =>
    h.vault.getRequests({ statuses: [], queueKey: null, limit: 100_000, offset: 0 });

  h.respond(async (req: TransportRequest): Promise<TransportResponse> => {
    const key = req.headers['Idempotency-Key']!;
    const bodies = server.bodiesByKey.get(key) ?? new Set();
    bodies.add(req.body);
    server.bodiesByKey.set(key, bodies);

    // FIFO: when a request is on the wire, nothing older in its queue may be unfinished.
    const all = await rows();
    const self = all.find((r) => r.idempotencyKey === key);
    // The same holds per dedupeKey, so an older body can never overwrite a newer one.
    if (self && (self.queueKey != null || self.dedupeKey != null)) {
      const blocker = all.find(
        (r) =>
          r.id < self.id &&
          ['pending', 'inflight', 'conflict'].includes(r.status) &&
          ((self.queueKey != null && r.queueKey === self.queueKey) || (self.dedupeKey != null && r.dedupeKey === self.dedupeKey))
      );
      if (blocker) violations.push(`FIFO: ${self.id} sent while ${blocker.id} is ${blocker.status}`);
    }

    await new Promise((r) => setImmediate(r));

    const record = server.records.get(key);
    if (record) return record.response;

    const outcome: Outcome = server.healthy ? { kind: 'status', status: 200 } : pickOutcome(rand);
    const applyEffect = () => {
      const response: TransportResponse = { status: 201, headers: { ETag: `"${key}"` }, body: '{}' };
      server.effects.push(key);
      server.records.set(key, { body: req.body, response });
      return response;
    };
    switch (outcome.kind) {
      case 'network':
        throw new Error('ECONNRESET');
      case 'offline':
        h.setOnline(false);
        throw new Error('The Internet connection appears to be offline.');
      case 'drop':
        applyEffect();
        throw new Error('socket hang up');
      case 'status': {
        if (outcome.status >= 200 && outcome.status < 300) return applyEffect();
        const headers: Record<string, string> = {};
        if (outcome.retryAfter != null) headers['Retry-After'] = String(outcome.retryAfter);
        if (outcome.etag) headers.ETag = outcome.etag;
        return { status: outcome.status, headers, body: null };
      }
    }
  });

  const checkInvariants = async (label: string) => {
    const all = await rows();
    const ids = new Set(all.map((r) => r.id));
    for (const id of enqueued) {
      if (!ids.has(id) && !removed.has(id)) violations.push(`${label}: request ${id} was lost`);
    }
    for (const r of all) {
      if (!VALID_STATES.has(r.status)) violations.push(`${label}: ${r.id} has invalid status ${r.status}`);
      if (r.attempt < 0 || r.attempt > r.maxAttempts) violations.push(`${label}: ${r.id} attempt ${r.attempt}/${r.maxAttempts}`);
      if (r.status === 'inflight') violations.push(`${label}: ${r.id} inflight while the engine is idle`);
      if (r.authBlocked && r.status !== 'pending') violations.push(`${label}: ${r.id} auth-blocked in ${r.status}`);
    }
    for (const [key, bodies] of server.bodiesByKey) {
      if (bodies.size > 1) violations.push(`${label}: idempotency key ${key} was reused for ${bodies.size} different bodies`);
    }
    if (violations.length > 0) throw new Error(`seed ${seed}:\n${violations.join('\n')}`);
  };

  const pickRow = async (status?: string): Promise<QueuedRequest | undefined> => {
    const all = (await rows()).filter((r) => status == null || r.status === status);
    return all.length ? all[Math.floor(rand() * all.length)] : undefined;
  };

  h.vault.setAuthHeaders({ Authorization: 'Bearer 1' });
  for (let step = 0; step < steps; step++) {
    const op = rand();
    if (op < 0.3) {
      const strategies = ['manual', 'client_wins', 'server_wins'];
      const id = await h.vault.enqueue(
        request({
          method: rand() < 0.5 ? 'POST' : 'PATCH',
          url: `/items/${Math.floor(rand() * 5)}`,
          body: JSON.stringify({ step, seed }),
          queueKey: rand() < 0.6 ? `q${Math.floor(rand() * 3)}` : null,
          dedupeKey: rand() < 0.25 ? `d${Math.floor(rand() * 2)}` : null,
          maxAttempts: rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 4),
          priority: rand() < 0.1 ? 5 : 0,
          conflictStrategy: strategies[Math.floor(rand() * strategies.length)]!,
        })
      );
      enqueued.add(id);
    } else if (op < 0.6) {
      await h.settle();
    } else if (op < 0.7) {
      h.advance(Math.floor(rand() * 120_000));
    } else if (op < 0.76) {
      h.setOnline(rand() < 0.85);
    } else if (op < 0.82) {
      // Kill the process mid-drain: in-flight responses are lost, the server may have applied them.
      const running = h.settle();
      await new Promise((r) => setImmediate(r));
      await h.restart();
      subscribe();
      await running;
    } else if (op < 0.86) {
      h.vault.setAuthHeaders({ Authorization: `Bearer ${step}` });
    } else if (op < 0.9) {
      const row = await pickRow('dead_letter');
      if (row) await h.vault.retry(row.id);
    } else if (op < 0.95) {
      const row = await pickRow('conflict');
      if (row) {
        if (rand() < 0.3) {
          await h.vault.resolveConflict(row.id, null, null);
        } else {
          await h.vault.resolveConflict(row.id, JSON.stringify({ merged: step }), row.serverVersion);
        }
      }
    } else {
      const row = await pickRow();
      if (row && row.status !== 'inflight') await h.vault.discard(row.id);
    }
    if (op >= 0.3 && op < 0.6) await checkInvariants(`step ${step}`);
  }

  // Healing phase: the network and server recover; every surviving request must be delivered.
  server.healthy = true;
  h.setOnline(true);
  h.vault.setAuthHeaders({ Authorization: 'Bearer healed' });
  for (let round = 0; round < 30; round++) {
    await h.settle();
    await checkInvariants(`heal ${round}`);
    for (const row of await rows()) {
      if (row.status === 'conflict') await h.vault.resolveConflict(row.id, row.body ?? '{}', row.serverVersion);
    }
    await h.vault.retryAllDeadLetters();
    h.advance(10 * 60_000);
    const counts = await h.vault.getCounts();
    if (counts.pending + counts.inflight + counts.conflict + counts.deadLetter === 0) break;
  }
  const final = await rows();
  const stuck = final.filter((r) => r.status !== 'succeeded');
  if (stuck.length > 0) {
    throw new Error(`seed ${seed}: not terminal after healing: ${stuck.map((r) => `${r.id}=${r.status}`).join(', ')}`);
  }
  for (const id of enqueued) {
    if (!removed.has(id) && !final.some((r) => r.id === id)) throw new Error(`seed ${seed}: ${id} lost`);
  }
  // At most one applied effect per idempotency key.
  expect(new Set(server.effects).size).toBe(server.effects.length);
  (sub as { remove: () => void } | null)?.remove();
  h.dispose();
}

describe('outbox state machine (property)', () => {
  const single = process.env.SYNC_VAULT_SEED ? Number(process.env.SYNC_VAULT_SEED) : null;
  const seeds = single != null ? [single] : Array.from({ length: Number(process.env.SYNC_VAULT_SEEDS ?? 150) }, (_, i) => i + 1);

  it(`holds every invariant across ${seeds.length} random histories`, async () => {
    for (const seed of seeds) await runSeed(seed, 150);
    if (single == null) {
      for (const type of ['coalesced', 'succeeded', 'retry_scheduled', 'dead_lettered', 'conflict', 'conflict_resolved', 'discarded', 'auth_blocked']) {
        const count = coverage.get(type) ?? 0;
        if (count <= seeds.length / 10) throw new Error(`histories rarely reach '${type}' (${count} times); widen the generator`);
      }
    }
  }, 120_000);
});
