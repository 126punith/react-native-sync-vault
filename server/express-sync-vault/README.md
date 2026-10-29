# express-sync-vault

Express middleware implementing the [react-native-sync-vault backend contract](../../docs/BACKEND_CONTRACT.md):
exactly-once effects for at-least-once mobile delivery.

| Export | Purpose |
| --- | --- |
| `idempotency({ store, ttlMs, getScope, required })` | Replays stored responses for duplicate `Idempotency-Key`s, returns 422 on key reuse with a different payload, and 425 + `Retry-After` while the original is in flight. |
| `ifMatch({ getVersion, getCurrent, required })` | Optimistic concurrency: 412 + current body + `ETag` on version mismatch. |
| `setETag(res, version)` | Sets `ETag: "<version>"`. |
| `retryAfter({ defaultSeconds })` | Ensures `Retry-After` on every 429/503. |
| `rateLimit({ windowMs, max, key })` | Simple fixed-window limiter answering 429 with an accurate `Retry-After`. |
| `batchRouter({ path, maxOperations })` | `POST /sync/batch`: ordered operations with per-operation results. |
| `MemoryStore`, `RedisStore(client)` | Idempotency stores. `RedisStore` works with ioredis and node-redis v4+. |

## Usage

```js
const express = require('express');
const Redis = require('ioredis');
const { idempotency, ifMatch, setETag, retryAfter, batchRouter, RedisStore } = require('express-sync-vault');

const app = express();
app.use(express.json());
app.use(retryAfter());
app.use(authenticate); // sets req.user
app.use(idempotency({ store: new RedisStore(new Redis()), getScope: (req) => String(req.user.id) }));

app.post('/todos', async (req, res) => {
  const todo = await db.createTodo(req.body); // client-generated UUIDv7 id
  setETag(res, todo.version);
  res.status(201).json(todo);
});

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

Order matters: body parser → `retryAfter` → auth → `idempotency` → routes (with `ifMatch`).

## Notes

- Completed responses are kept for 24h by default (`ttlMs`). Mobile clients can be offline for
  longer than that. If your users are, raise `ttlMs` to cover your longest expected offline
  period, or make handlers naturally idempotent (upserts keyed by client IDs).
- Only deterministic outcomes are stored (2xx/3xx and 400/403/404/409/410/412/413/415/422).
  401, 408, 425, 429, and 5xx re-execute on retry.
- `MemoryStore` is per process. Use `RedisStore` when running more than one instance.

## Reference server

`example/todo-server.js` is a complete todo API (in-memory) with fault injection. The
library's chaos tests run against it:

```sh
node example/todo-server.js   # PORT=4000 TOKEN=secret optional
```
