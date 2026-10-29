'use strict';

const crypto = require('crypto');
const { MemoryStore } = require('./stores');

const DAY_MS = 24 * 60 * 60 * 1000;
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
/** Deterministic outcomes that are safe to replay. Transient ones (401, 408, 425, 429, 5xx) re-execute. */
const REPLAYABLE_4XX = new Set([400, 403, 404, 409, 410, 412, 413, 415, 422]);
const STORED_HEADERS = ['content-type', 'etag', 'location', 'last-modified'];

function stableStringify(value) {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fingerprint(req) {
  const body = Buffer.isBuffer(req.body) ? req.body.toString('base64') : stableStringify(req.body);
  return crypto.createHash('sha256').update(`${req.method}\n${req.originalUrl.split('?')[0]}\n${body}`).digest('hex');
}

function defaultScope(req) {
  if (req.user && req.user.id != null) return `user:${req.user.id}`;
  const auth = req.get('authorization');
  if (auth) return `auth:${crypto.createHash('sha256').update(auth).digest('hex').slice(0, 32)}`;
  return 'anonymous';
}

function isReplayable(status) {
  return (status >= 200 && status < 400) || REPLAYABLE_4XX.has(status);
}

/**
 * Idempotency-Key middleware (place after body parsing, before route handlers).
 *
 * - First request with a key: runs the handler and stores (status, headers, body) for `ttlMs`.
 * - Duplicate with the same key and payload: replays the stored response with
 *   `Idempotent-Replayed: true` without running the handler.
 * - Same key, different payload: 422.
 * - Duplicate while the first is still running: 425 + Retry-After (the client retries).
 */
function idempotency(options = {}) {
  const {
    store = new MemoryStore(),
    ttlMs = DAY_MS,
    lockTtlMs = 60 * 1000,
    methods = MUTATING,
    required = false,
    getScope = defaultScope,
    header = 'Idempotency-Key',
  } = options;
  const methodSet = new Set(methods.map((m) => m.toUpperCase()));

  return async function idempotencyMiddleware(req, res, next) {
    if (!methodSet.has(req.method)) return next();
    const key = req.get(header);
    if (!key) {
      if (required) return res.status(400).json({ error: 'idempotency_key_required' });
      return next();
    }
    if (key.length > 255) return res.status(400).json({ error: 'idempotency_key_too_long' });

    try {
      const storeKey = `${getScope(req)}:${key}`;
      const fp = fingerprint(req);
      const lock = { state: 'in_progress', fingerprint: fp, startedAt: Date.now() };

      if (!(await store.setIfAbsent(storeKey, lock, lockTtlMs))) {
        const record = await store.get(storeKey);
        if (record && record.fingerprint !== fp) {
          return res.status(422).json({ error: 'idempotency_key_reused', message: 'Idempotency-Key was used with a different request' });
        }
        if (record && record.state === 'completed') {
          res.status(record.status);
          for (const [name, value] of Object.entries(record.headers || {})) res.setHeader(name, value);
          res.setHeader('Idempotent-Replayed', 'true');
          return res.send(record.body == null ? undefined : Buffer.from(record.body, 'base64'));
        }
        if (record) {
          res.setHeader('Retry-After', '1');
          return res.status(425).json({ error: 'request_in_progress' });
        }
        // The record expired between the two calls; take the lock again.
        if (!(await store.setIfAbsent(storeKey, lock, lockTtlMs))) {
          res.setHeader('Retry-After', '1');
          return res.status(425).json({ error: 'request_in_progress' });
        }
      }

      let captured = null;
      let settled = false;
      const settle = async () => {
        if (settled) return;
        settled = true;
        try {
          if (isReplayable(res.statusCode)) {
            const headers = {};
            for (const name of STORED_HEADERS) {
              const value = res.getHeader(name);
              if (value != null) headers[name] = String(value);
            }
            await store.set(
              storeKey,
              {
                state: 'completed',
                fingerprint: fp,
                status: res.statusCode,
                headers,
                body: captured ? captured.toString('base64') : null,
                completedAt: Date.now(),
              },
              ttlMs
            );
          } else {
            await store.delete(storeKey);
          }
        } catch (error) {
          // Store failure must not crash the response; the lock expires after lockTtlMs.
          req.app && req.app.emit && req.app.emit('sync-vault:store-error', error);
        }
      };
      // Recorded when the handler responds, even if the client has already disconnected: the
      // effect happened, so a retry must replay it. A handler that never responds leaves the lock
      // to expire after lockTtlMs.
      const originalSend = res.send.bind(res);
      res.send = function send(body) {
        if (captured === null && body != null) {
          captured = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        }
        const result = originalSend(body);
        void settle();
        return result;
      };
      res.on('finish', () => void settle());
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { idempotency, fingerprint, stableStringify, REPLAYABLE_4XX };
