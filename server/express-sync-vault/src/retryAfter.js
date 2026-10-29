'use strict';

/**
 * Guarantees a Retry-After header on 429 and 503 responses so clients back off for the time
 * the server asks for instead of guessing. Mount early (before routes).
 */
function retryAfter(options = {}) {
  const { defaultSeconds = 5, statuses = [429, 503] } = options;
  const statusSet = new Set(statuses);
  return function retryAfterMiddleware(req, res, next) {
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      const status = typeof args[0] === 'number' ? args[0] : res.statusCode;
      if (statusSet.has(status) && !res.getHeader('Retry-After')) {
        res.setHeader('Retry-After', String(defaultSeconds));
      }
      return writeHead.apply(this, args);
    };
    next();
  };
}

/**
 * Fixed-window rate limiter answering 429 with an accurate Retry-After. In-memory, so per
 * instance; use a shared store (e.g. Redis) in production clusters.
 */
function rateLimit(options = {}) {
  const { windowMs = 60_000, max = 120, key = (req) => req.get('authorization') || req.ip } = options;
  const windows = new Map();
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const id = key(req);
    let entry = windows.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      windows.set(id, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    return next();
  };
}

module.exports = { retryAfter, rateLimit };
