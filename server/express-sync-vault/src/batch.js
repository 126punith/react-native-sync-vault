'use strict';

const express = require('express');

const FORWARDED_HEADERS = ['authorization', 'cookie', 'x-user-id'];

/**
 * POST /sync/batch: applies operations in order and returns one result per operation, so a
 * single bad item does not fail the batch.
 *
 * Request:  { "operations": [{ "id": "op1", "method": "POST", "path": "/todos",
 *              "headers": { "Idempotency-Key": "..." }, "body": {...} }] }
 * Response: { "results": [{ "id": "op1", "status": 201, "headers": { "etag": "\"1\"" }, "body": {...} }] }
 *
 * Each operation is dispatched to this same server over loopback, so every route keeps its own
 * middleware (auth, idempotency(), ifMatch()) and per-operation Idempotency-Keys stay effective.
 */
function batchRouter(options = {}) {
  const { path = '/sync/batch', maxOperations = 100, stopOnError = false, allowedPaths = null } = options;
  const router = express.Router();

  router.post(path, express.json({ limit: options.limit || '5mb' }), async (req, res, next) => {
    try {
      const operations = req.body && Array.isArray(req.body.operations) ? req.body.operations : null;
      if (!operations) return res.status(400).json({ error: 'operations_required' });
      if (operations.length > maxOperations) return res.status(413).json({ error: 'too_many_operations', max: maxOperations });

      const port = req.socket.localPort;
      const base = `http://127.0.0.1:${port}`;
      const forwarded = {};
      for (const name of FORWARDED_HEADERS) {
        const value = req.get(name);
        if (value) forwarded[name] = value;
      }

      const results = [];
      for (const op of operations) {
        const method = String(op.method || 'POST').toUpperCase();
        const opPath = String(op.path || '');
        if (!opPath.startsWith('/') || opPath.startsWith(path) || (allowedPaths && !allowedPaths.some((p) => opPath.startsWith(p)))) {
          results.push({ id: op.id, status: 400, body: { error: 'invalid_path' } });
          if (stopOnError) break;
          continue;
        }
        try {
          const response = await fetch(base + opPath, {
            method,
            headers: { 'content-type': 'application/json', ...forwarded, ...(op.headers || {}) },
            body: op.body === undefined || method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(op.body),
          });
          const text = await response.text();
          let body = text;
          try {
            body = text ? JSON.parse(text) : null;
          } catch (_) {
            // Non-JSON bodies are returned as text.
          }
          const headers = {};
          for (const name of ['etag', 'location', 'retry-after', 'idempotent-replayed']) {
            const value = response.headers.get(name);
            if (value != null) headers[name] = value;
          }
          results.push({ id: op.id, status: response.status, headers, body });
          if (stopOnError && response.status >= 400) break;
        } catch (error) {
          results.push({ id: op.id, status: 502, body: { error: 'dispatch_failed', message: error.message } });
          if (stopOnError) break;
        }
      }
      return res.status(200).json({ results });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { batchRouter };
