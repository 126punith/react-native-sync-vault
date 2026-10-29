/**
 * Runs the shared schema files (schema/sync_vault/*.sql, bundled verbatim into the Android assets
 * and the iOS resource bundle) against a real SQLite, the same way both native runners do:
 * statements split on "--;;" lines, comment lines dropped, ":now" bound positionally.
 *
 * The eligibility SQL is read straight out of OutboxRepository.kt and OutboxStore.swift so the
 * native claim queries are checked against the reference engine's ordering rules.
 */
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

type Row = Record<string, unknown>;
interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): Row[];
  get(...params: unknown[]): Row | undefined;
}
interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

const sqlite = (() => {
  try {
    const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    return getBuiltin?.('node:sqlite') as { DatabaseSync: new (path: string) => Db } | undefined;
  } catch {
    return undefined;
  }
})();

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Mirrors OutboxDatabase.splitStatements (Kotlin) and SQLiteDatabase.splitStatements (Swift). */
function splitStatements(sql: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '--;;') {
      chunks.push(current.join('\n'));
      current = [];
    } else if (!trimmed.startsWith('--')) {
      current.push(line);
    }
  }
  chunks.push(current.join('\n'));
  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}

function migrate(db: Db): void {
  for (const statement of splitStatements(read('schema/sync_vault/001_init.sql'))) db.exec(statement);
}

const V1_SCHEMA = `CREATE TABLE request_queue (
  id TEXT PRIMARY KEY, request_id TEXT UNIQUE, method TEXT NOT NULL, url TEXT NOT NULL, headers TEXT,
  body TEXT, query_params TEXT, status TEXT NOT NULL, priority INTEGER DEFAULT 0, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, last_attempt_at INTEGER, synced_at INTEGER, attempt_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3, retry_after INTEGER, local_data_id TEXT, server_response TEXT,
  conflict_data TEXT, conflict_resolution TEXT, metadata TEXT)`;

function eligibleFromKotlin(): string {
  const match = read('android/src/main/java/com/syncvault/core/OutboxRepository.kt').match(/ELIGIBLE = """([\s\S]*?)"""/);
  if (!match) throw new Error('ELIGIBLE not found in OutboxRepository.kt');
  return match[1]!;
}

function eligibleFromSwift(): string {
  const match = read('ios/SyncVaultCore/OutboxStore.swift').match(/eligible = """([\s\S]*?)"""/);
  if (!match) throw new Error('eligible not found in OutboxStore.swift');
  return match[1]!;
}

const describeSqlite = sqlite ? describe : describe.skip;

describeSqlite('schema migrations (node:sqlite)', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-vault-'));
    db = new sqlite!.DatabaseSync(join(dir, 'sync_vault.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('splits the schema the same way the native runners do', () => {
    const statements = splitStatements(read('schema/sync_vault/001_init.sql'));
    expect(statements.length).toBeGreaterThan(5);
    for (const s of statements) expect(s.split('\n').some((l) => l.trim().startsWith('--'))).toBe(false);
    const imports = splitStatements(read('schema/sync_vault/import_v1.sql'));
    expect(imports).toHaveLength(1);
    // Native binds the timestamp positionally (index 1), so ":now" must be the only parameter name.
    const params = new Set(imports[0]!.replace(/'[^']*'/g, '').match(/[:?@$][A-Za-z_]\w*|\?/g));
    expect([...params]).toEqual([':now']);
  });

  it('creates the v2 schema and is idempotent', () => {
    migrate(db);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['cache', 'kv', 'outbox', 'schema_migrations']));
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'outbox'").all().map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_outbox_ready', 'idx_outbox_queue_key', 'idx_outbox_dedupe_key', 'idx_outbox_lease']));
  });

  it('allows several unfinished rows per dedupe_key (a retried older row returns to pending)', () => {
    migrate(db);
    const insert = db.prepare(
      "INSERT INTO outbox (id, idempotency_key, dedupe_key, method, url, headers, status, created_at, updated_at) VALUES (?, ?, 'd', 'PUT', '/x', '{}', 'pending', 0, 0)"
    );
    insert.run('a', 'ka');
    expect(() => insert.run('b', 'kb')).not.toThrow();
  });

  it('enforces a unique idempotency key', () => {
    migrate(db);
    const insert = db.prepare(
      "INSERT INTO outbox (id, idempotency_key, method, url, headers, status, created_at, updated_at) VALUES (?, 'same', 'POST', '/x', '{}', 'pending', 0, 0)"
    );
    insert.run('a');
    expect(() => insert.run('b')).toThrow(/UNIQUE/);
  });

  describe('v1 import', () => {
    const NOW = 1_800_000_000_000;

    function seedV1(): string {
      const path = join(dir, 'offline_queue.db');
      const v1 = new sqlite!.DatabaseSync(path);
      v1.exec(V1_SCHEMA);
      const insert = v1.prepare(
        `INSERT INTO request_queue (id, request_id, method, url, headers, body, query_params, status, priority, created_at,
          updated_at, attempt_count, max_retries, retry_after, conflict_resolution, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      insert.run('p1', 'r1', 'post', '/todos', '{"X":"1"}', '{"a":1}', '{}', 'pending', 2, 1000, 1000, 2, 5, null, null, '{"m":1}');
      insert.run('s1', 'r2', 'PUT', '/todos/1', '', '{"b":2}', '{"q":"1"}', 'syncing', 0, 1001, 1001, 1, 3, null, 'client_wins', null);
      insert.run('f1', 'r3', 'DELETE', '/todos/2', null, null, null, 'failed', 0, 1002, 1002, 3, 3, 5000, 'server_wins', null);
      insert.run('f2', 'r4', 'PATCH', '/todos/3', null, '{}', 'null', 'failed', 0, 1003, 1003, 4, 0, null, 'merge', null);
      insert.run('c1', 'r5', 'PATCH', '/todos/4', null, '{}', null, 'conflict', 0, 1004, 1004, 1, 3, null, 'manual', null);
      insert.run('ok', 'r6', 'POST', '/todos', null, '{}', null, 'completed', 0, 1005, 1005, 1, 3, null, null, null);
      v1.close();
      return path;
    }

    function runImport(v1Path: string): void {
      const statement = splitStatements(read('schema/sync_vault/import_v1.sql'))[0]!;
      db.prepare('ATTACH DATABASE ? AS v1').run(v1Path);
      try {
        db.prepare(statement).run({ now: NOW });
      } finally {
        db.exec('DETACH DATABASE v1');
      }
    }

    it('maps unfinished v1 requests onto the v2 outbox', () => {
      migrate(db);
      runImport(seedV1());
      const rows = db.prepare('SELECT * FROM outbox ORDER BY created_at').all();
      expect(rows.map((r) => r.id)).toEqual(['p1', 's1', 'f1', 'f2', 'c1']);
      const byId = Object.fromEntries(rows.map((r) => [r.id as string, r]));

      expect(byId.p1).toMatchObject({
        idempotency_key: 'p1',
        method: 'POST',
        headers: '{"X":"1"}',
        body: '{"a":1}',
        query_params: null,
        status: 'pending',
        priority: 2,
        attempt: 0,
        max_attempts: 5,
        conflict_strategy: 'manual',
        metadata: '{"m":1}',
        created_at: 1000,
        updated_at: NOW,
      });
      // Requests interrupted mid-sync in v1 are simply pending again.
      expect(byId.s1).toMatchObject({ status: 'pending', headers: '{}', query_params: '{"q":"1"}', conflict_strategy: 'client_wins' });
      // Failed with a scheduled retry: still retryable.
      expect(byId.f1).toMatchObject({ status: 'pending', conflict_strategy: 'server_wins', body: null });
      // Failed permanently: visible as a dead letter, with at least one attempt allowed on retry.
      expect(byId.f2).toMatchObject({ status: 'dead_letter', max_attempts: 1, conflict_strategy: 'manual', query_params: null });
      expect(byId.f2!.last_error).toMatch(/permanent/);
      expect(byId.c1).toMatchObject({ status: 'conflict', conflict_strategy: 'manual' });
    });

    it('can be re-run after an interrupted import without duplicating rows', () => {
      migrate(db);
      const path = seedV1();
      runImport(path);
      runImport(path);
      expect(db.prepare('SELECT COUNT(*) AS n FROM outbox').get()!.n).toBe(5);
    });
  });

  describe.each([
    ['Kotlin', eligibleFromKotlin],
    ['Swift', eligibleFromSwift],
  ])('%s claim eligibility', (_platform, eligible) => {
    let seq = 0;
    const add = (id: string, fields: Partial<Record<string, unknown>> = {}) => {
      const row = {
        id,
        idempotency_key: id,
        queue_key: null,
        dedupe_key: null,
        status: 'pending',
        priority: 0,
        auth_blocked: 0,
        next_attempt_at: 0,
        ...fields,
      };
      seq++;
      db.prepare(
        `INSERT INTO outbox (seq, id, idempotency_key, queue_key, dedupe_key, method, url, headers, status, priority, auth_blocked,
          next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'POST', '/x', '{}', ?, ?, ?, ?, 0, 0)`
      ).run(seq, row.id, row.idempotency_key, row.queue_key, row.dedupe_key, row.status, row.priority, row.auth_blocked, row.next_attempt_at);
    };
    const claimable = (now: number) =>
      db
        .prepare(`SELECT o.id FROM outbox o WHERE ${eligible()} AND o.next_attempt_at <= ? ORDER BY o.priority DESC, o.seq ASC`)
        .all(now)
        .map((r) => r.id);
    const nextWake = () => db.prepare(`SELECT MIN(o.next_attempt_at) AS next FROM outbox o WHERE ${eligible()}`).get()!.next;

    beforeEach(() => {
      seq = 0;
      migrate(db);
    });

    it('orders by priority then insertion and skips blocked or future rows', () => {
      add('low');
      add('high', { priority: 5 });
      add('auth', { auth_blocked: 1 });
      add('later', { next_attempt_at: 500 });
      add('done', { status: 'succeeded' });
      add('dead', { status: 'dead_letter' });
      expect(claimable(100)).toEqual(['high', 'low']);
      expect(claimable(500)).toEqual(['high', 'low', 'later']);
      expect(nextWake()).toBe(0);
    });

    it('only lets the oldest unfinished row of a queue_key through', () => {
      add('a1', { queue_key: 'a', status: 'inflight' });
      add('a2', { queue_key: 'a' });
      add('b1', { queue_key: 'b', status: 'dead_letter' });
      add('b2', { queue_key: 'b' });
      add('c1', { queue_key: 'c', status: 'conflict' });
      add('c2', { queue_key: 'c' });
      add('d1', { queue_key: 'd', next_attempt_at: 900 });
      add('d2', { queue_key: 'd' });
      expect(claimable(100)).toEqual(['b2']);
      // A head waiting on backoff must not cause wake-ups for the rows behind it.
      expect(nextWake()).toBe(0);
      db.prepare("DELETE FROM outbox WHERE id = 'b2'").run();
      expect(nextWake()).toBe(900);
    });

    it('serialises rows that share a dedupe_key', () => {
      add('v1', { dedupe_key: 'title', status: 'pending', next_attempt_at: 900 });
      add('v2', { dedupe_key: 'title' });
      add('other', { dedupe_key: 'done' });
      expect(claimable(100)).toEqual(['other']);
      expect(claimable(900)).toEqual(['v1', 'other']);
    });
  });
});

if (!sqlite) {
  // eslint-disable-next-line no-console
  console.warn('node:sqlite is unavailable (Node >= 22.13 required); migration tests skipped');
}
