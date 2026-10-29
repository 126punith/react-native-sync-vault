-- Imports unfinished requests from the v1 database (offline_queue.db).
-- The caller ATTACHes the v1 file as "v1" and binds the current time (ms) to every ":now".
-- Permanent v1 failures (status failed without retry_after) become dead letters so they stay visible.
-- v1 attempt counters were unreliable, so imported requests start from attempt 0.

INSERT OR IGNORE INTO outbox (
  id, idempotency_key, queue_key, dedupe_key, method, url, query_params, headers, body,
  content_type, if_match, status, priority, attempt, max_attempts, next_attempt_at,
  lease_until, auth_blocked, conflict_strategy, last_error, metadata, created_at, updated_at
)
SELECT
  id,
  id,
  NULL,
  NULL,
  UPPER(method),
  url,
  CASE WHEN query_params IS NULL OR query_params IN ('', '{}', 'null') THEN NULL ELSE query_params END,
  COALESCE(NULLIF(headers, ''), '{}'),
  body,
  'application/json',
  NULL,
  CASE
    WHEN status = 'failed' AND retry_after IS NULL THEN 'dead_letter'
    WHEN status = 'conflict' THEN 'conflict'
    ELSE 'pending'
  END,
  COALESCE(priority, 0),
  0,
  MAX(COALESCE(max_retries, 3), 1),
  0,
  NULL,
  0,
  CASE conflict_resolution
    WHEN 'client_wins' THEN 'client_wins'
    WHEN 'server_wins' THEN 'server_wins'
    ELSE 'manual'
  END,
  CASE WHEN status = 'failed' AND retry_after IS NULL THEN 'imported from v1 as a permanent failure' ELSE NULL END,
  metadata,
  COALESCE(created_at, :now),
  :now
FROM v1.request_queue
WHERE status IN ('pending', 'syncing', 'failed', 'conflict')
ORDER BY COALESCE(created_at, 0), rowid;
