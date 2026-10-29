# Backend contract

react-native-sync-vault guarantees that every queued request is delivered **at least once**:
it retries through crashes, reboots, timeouts, and lost responses. Your API turns that into
**exactly-once effects** by following this contract. A reference implementation for Express
lives in [`server/express-sync-vault`](../server/express-sync-vault).

## 1. What the client sends

Every queued request carries:

| Header | Value | Notes |
| --- | --- | --- |
| `Idempotency-Key` | UUIDv7 | Stable across all retries of the same request. A new key is used only when the payload changes (coalescing of an already-sent request, or a conflict resolution). |
| `If-Match` | server version | Present when the request was enqueued with `ifMatch`, or after a conflict was resolved (the server's version from the 409/412). |
| `Content-Type` | e.g. `application/json` | Objects are JSON-serialized by the client. |
| Auth headers | from `getAuthHeaders()` | Attached at **send** time, not enqueue time, so refreshed tokens apply to old requests. |

Requests with the same `queueKey` arrive strictly in order: request N+1 is not sent until N
succeeded, was dead-lettered, or was discarded.

## 2. How the client reads your responses

| Status | Client behavior |
| --- | --- |
| `2xx` | Success. The `ETag` header (if any) is stored as the server version. |
| `409`, `412` | Conflict. The body is stored as the server copy; the version is read from `ETag`, else from `version` / `_version` / `etag` in the JSON body. The request's conflict strategy runs (`client_wins` resends with `If-Match: <version>`, `server_wins` drops it, `manual` / `merge` waits for the app). |
| `401` | The request is parked **without using an attempt**; the app's `getAuthHeaders()` is called and the request resumes with the new headers. |
| `408`, `425`, `429`, `5xx` | Retryable with exponential backoff and full jitter. `Retry-After` (seconds or HTTP date) is honored as a minimum delay. |
| Network error / timeout | Retryable (does not use an attempt if the device went offline). |
| Other `4xx` | Permanent. The request moves to the dead-letter list for the app to inspect, retry, or discard. |

**Never return 5xx for validation errors** (they would be retried until the attempt budget is
exhausted). Use 400/422.

## 3. Idempotency (required for mutations)

1. Namespace keys per user: `(user, Idempotency-Key)`.
2. On first sight of a key, store an *in-progress* marker atomically (e.g. Redis `SET NX PX`),
   run the handler, then store `(status, selected headers, body)` for **at least 24 hours**.
3. On a duplicate with the same request fingerprint (method + path + body hash), **replay the
   stored response** without running the handler. Mark it with `Idempotent-Replayed: true`.
4. Same key with a different fingerprint: respond `422`.
5. Duplicate while the original is still running: respond `425 Too Early` with `Retry-After: 1`
   (the client retries; do **not** use 409, which clients treat as a data conflict).
6. Store deterministic outcomes only (2xx, 3xx, and 400/403/404/409/410/412/422). Do not store
   401, 408, 425, 429, or 5xx: those should re-execute when retried.
7. Record the response once the handler has produced it, even if the client already
   disconnected. The effect happened, so the retry must get the replay.

Ideally write the idempotency record in the same database transaction as the effect. The
reference middleware stores it right after the handler responds, which is enough for most
APIs. Use a transactional store if a crash between the effect and the record is unacceptable.

## 4. Optimistic concurrency

- Resources carry a monotonically increasing `version`. Return it as `ETag: "<version>"` on
  reads and writes.
- For `PUT`/`PATCH`/`DELETE` with `If-Match`, compare against the current version (ignore
  `W/` and quotes; `*` matches any existing resource). On mismatch respond **`412`** with the
  current resource in the body and the current `ETag`.
- After the app resolves the conflict, the client resends the chosen payload with
  `If-Match: <server version>` and a new `Idempotency-Key`.

```http
PATCH /todos/42
If-Match: "3"
Idempotency-Key: 0190f5c3-...

HTTP/1.1 412 Precondition Failed
ETag: "5"
Content-Type: application/json

{ "error": "version_mismatch", "version": "5", "current": { "id": "42", "title": "...", "version": 5 } }
```

## 5. Retry signaling

- Send `Retry-After` on `429` and `503` (seconds or an HTTP date). The client waits at least
  that long.
- Prefer `503` + `Retry-After` for maintenance windows and load shedding.

## 6. Client-generated IDs

Offline creates use client-generated UUIDv7 primary keys (`SyncVault.generateId()`), so no ID
remapping is needed after sync. Accept them as primary keys. They are time-ordered, which keeps
B-tree indexes compact. Treat "create with an existing ID" as idempotent (replay) or 409.

## 7. Batch endpoint (optional)

`POST /sync/batch` applies operations in order and returns per-operation results, so one bad
item does not fail the batch. Each operation carries its own `Idempotency-Key`.

```json
{ "operations": [
  { "id": "op1", "method": "POST", "path": "/todos", "headers": { "Idempotency-Key": "..." }, "body": { "id": "...", "title": "Milk" } },
  { "id": "op2", "method": "PATCH", "path": "/todos/42", "headers": { "If-Match": "\"3\"" }, "body": { "done": true } }
] }
```

```json
{ "results": [
  { "id": "op1", "status": 201, "headers": { "etag": "\"1\"" }, "body": { "id": "...", "version": 1 } },
  { "id": "op2", "status": 412, "headers": { "etag": "\"5\"" }, "body": { "error": "version_mismatch" } }
] }
```

## 8. Delta pull (recommended next step)

To reconcile caches after pushes, expose `GET /changes?cursor=<opaque>` returning changed
records and tombstones for deletes, plus the next cursor. Cursors must be monotonic (e.g. a
sequence number, not a wall-clock timestamp).

## 9. Checklist

- [ ] Mutations accept and enforce `Idempotency-Key`, with ≥24h retention, per-user scope, and a fingerprint check.
- [ ] Concurrent duplicates get `425` + `Retry-After`, never a second execution.
- [ ] Resources return `ETag`, and writes honor `If-Match` with `412` + current body.
- [ ] Validation errors are 400/422, never 5xx.
- [ ] `429`/`503` include `Retry-After`.
- [ ] `401` is returned for expired tokens (the client refreshes and resumes without losing attempts).
- [ ] Client-generated UUIDv7 IDs are accepted.

## Express quick start

```js
const express = require('express');
const { idempotency, ifMatch, setETag, retryAfter, batchRouter, RedisStore } = require('express-sync-vault');

const app = express();
app.use(express.json());
app.use(retryAfter());
app.use(idempotency({ store: new RedisStore(redis), getScope: (req) => req.user.id }));

app.patch(
  '/todos/:id',
  ifMatch({ getVersion: (req) => db.todoVersion(req.params.id), getCurrent: (req) => db.todo(req.params.id) }),
  async (req, res) => {
    const todo = await db.updateTodo(req.params.id, req.body);
    setETag(res, todo.version);
    res.json(todo);
  }
);

app.use(batchRouter());
```
