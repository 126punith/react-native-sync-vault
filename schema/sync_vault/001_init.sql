-- Sync Vault schema v2 (migration 001).
-- Shared verbatim by Android (assets), iOS (resource bundle) and the Jest migration tests.
-- Statements are separated by lines containing only "--;;".

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
--;;
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  queue_key TEXT,
  dedupe_key TEXT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  query_params TEXT,
  headers TEXT NOT NULL DEFAULT '{}',
  body TEXT,
  payload_ref TEXT,
  content_type TEXT,
  if_match TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'inflight', 'succeeded', 'conflict', 'dead_letter')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 8,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  auth_blocked INTEGER NOT NULL DEFAULT 0,
  conflict_strategy TEXT NOT NULL DEFAULT 'manual',
  last_error TEXT,
  last_http_status INTEGER NOT NULL DEFAULT 0,
  server_response TEXT,
  server_version TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL DEFAULT 0
);
--;;
CREATE INDEX IF NOT EXISTS idx_outbox_ready
  ON outbox (status, auth_blocked, next_attempt_at, priority DESC, seq);
--;;
CREATE INDEX IF NOT EXISTS idx_outbox_queue_key
  ON outbox (queue_key, seq) WHERE queue_key IS NOT NULL;
--;;
CREATE INDEX IF NOT EXISTS idx_outbox_dedupe_key
  ON outbox (dedupe_key, seq) WHERE dedupe_key IS NOT NULL;
--;;
CREATE INDEX IF NOT EXISTS idx_outbox_lease
  ON outbox (lease_until) WHERE status = 'inflight';
--;;
CREATE VIEW IF NOT EXISTS dead_letter AS
  SELECT * FROM outbox WHERE status = 'dead_letter';
--;;
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL
);
--;;
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache (expires_at);
--;;
CREATE INDEX IF NOT EXISTS idx_cache_lru ON cache (last_accessed_at);
--;;
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
