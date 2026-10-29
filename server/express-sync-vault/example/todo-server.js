'use strict';

/**
 * Reference todo API implementing the sync-vault backend contract. Used by the example app and
 * by the chaos tests (fault injection via `faults`).
 *
 *   node example/todo-server.js        # listens on PORT or 4000
 */

const express = require('express');
const { idempotency, ifMatch, setETag, retryAfter, batchRouter, MemoryStore } = require('../src');

/**
 * Faults are consumed in order by matching requests:
 *   faults.push({ status: 503, retryAfter: 1 })      respond with an error, effect NOT applied
 *   faults.push({ delayMs: 2000 })                   delay before handling
 *   faults.push({ dropResponse: true })              apply the effect, then destroy the socket
 *   faults.push({ match: (req) => req.method === 'POST', status: 500 })
 */
function createTodoServer(options = {}) {
  const app = express();
  const todos = new Map();
  const faults = [];
  const effects = [];
  const requests = [];
  let idempotencyStore = options.store || new MemoryStore();
  let token = options.token;
  let requestCount = 0;

  app.use(express.json());
  app.use(retryAfter());

  if (options.control) mountControl();

  // Fault injection (before idempotency so injected errors never consume a key).
  app.use((req, res, next) => {
    requestCount++;
    requests.push({ method: req.method, path: req.path, idempotencyKey: req.get('idempotency-key') || null, at: Date.now() });
    const index = faults.findIndex((f) => !f.match || f.match(req));
    if (index === -1) return next();
    const [fault] = faults.splice(index, 1);
    const proceed = () => {
      if (fault.status) {
        if (fault.retryAfter != null) res.setHeader('Retry-After', String(fault.retryAfter));
        return res.status(fault.status).json({ error: 'injected' });
      }
      if (fault.dropResponse) {
        // Let the handler apply the effect, then kill the connection before the client reads it.
        const originalSend = res.send.bind(res);
        res.send = (body) => {
          res.send = originalSend;
          req.socket.destroy();
          return res;
        };
      }
      return next();
    };
    if (fault.delayMs) setTimeout(proceed, fault.delayMs);
    else proceed();
  });

  // Delegates to the current store so /__control/reset can swap it.
  const currentStore = {
    get: (key) => idempotencyStore.get(key),
    setIfAbsent: (key, record, ttlMs) => idempotencyStore.setIfAbsent(key, record, ttlMs),
    set: (key, record, ttlMs) => idempotencyStore.set(key, record, ttlMs),
    delete: (key) => idempotencyStore.delete(key),
  };
  app.use(idempotency({ store: currentStore, getScope: (req) => req.get('x-user-id') || 'anonymous' }));

  const auth = (req, res, next) => {
    if (token && req.get('authorization') !== `Bearer ${token}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  };

  const versionOf = (req) => todos.get(req.params.id)?.version;
  const currentOf = (req) => todos.get(req.params.id) ?? null;

  app.get('/todos', auth, (req, res) => {
    res.json(Array.from(todos.values()));
  });

  app.get('/todos/:id', auth, (req, res) => {
    const todo = todos.get(req.params.id);
    if (!todo) return res.status(404).json({ error: 'not_found' });
    setETag(res, todo.version);
    return res.json(todo);
  });

  app.post('/todos', auth, (req, res) => {
    const { id, title = '', done = false } = req.body || {};
    if (!id || typeof id !== 'string') return res.status(422).json({ error: 'id_required' });
    if (todos.has(id)) return res.status(409).json({ error: 'exists', current: todos.get(id), version: todos.get(id).version });
    const todo = { id, title, done, version: 1 };
    todos.set(id, todo);
    effects.push({ type: 'create', id, idempotencyKey: req.get('idempotency-key') });
    setETag(res, todo.version);
    return res.status(201).json(todo);
  });

  app.patch('/todos/:id', auth, ifMatch({ getVersion: versionOf, getCurrent: currentOf }), (req, res) => {
    const todo = todos.get(req.params.id);
    if (!todo) return res.status(404).json({ error: 'not_found' });
    const next = { ...todo, ...req.body, id: todo.id, version: todo.version + 1 };
    todos.set(todo.id, next);
    effects.push({ type: 'update', id: todo.id, idempotencyKey: req.get('idempotency-key') });
    setETag(res, next.version);
    return res.json(next);
  });

  app.delete('/todos/:id', auth, ifMatch({ getVersion: versionOf, getCurrent: currentOf }), (req, res) => {
    if (!todos.has(req.params.id)) return res.status(404).json({ error: 'not_found' });
    todos.delete(req.params.id);
    effects.push({ type: 'delete', id: req.params.id, idempotencyKey: req.get('idempotency-key') });
    return res.status(204).end();
  });

  app.use(batchRouter());

  /**
   * Test-only control API for end-to-end and native contract runs (never enable in production):
   *   POST /__control/reset   { token? }          clear todos, faults, effects, request log, keys
   *   POST /__control/faults  [{ status, retryAfter, delayMs, dropResponse, method, path }]
   *   POST /__control/token   { token }           rotate the required bearer token
   *   PUT  /__control/todos/:id  { ...todo }      overwrite a record (simulates another device)
   *   GET  /__control/state                       { todos, effects, requests }
   *   POST /__control/report  { platform, results }  store a device's contract results (survives reset)
   *   GET  /__control/report                      last stored report, or 404
   */
  function mountControl() {
    const control = express.Router();
    let report = null;
    control.post('/report', (req, res) => {
      report = { ...req.body, receivedAt: Date.now() };
      res.json({ ok: true });
    });
    control.get('/report', (req, res) => (report ? res.json(report) : res.status(404).json({ error: 'no report yet' })));
    control.post('/reset', (req, res) => {
      todos.clear();
      faults.length = 0;
      effects.length = 0;
      requests.length = 0;
      idempotencyStore = new MemoryStore();
      token = req.body && 'token' in req.body ? req.body.token : options.token;
      res.json({ ok: true });
    });
    control.post('/faults', (req, res) => {
      for (const f of Array.isArray(req.body) ? req.body : [req.body]) {
        const { method, path, ...fault } = f;
        if (method || path) {
          fault.match = (r) => (!method || r.method === method.toUpperCase()) && (!path || r.path.startsWith(path));
        }
        faults.push(fault);
      }
      res.json({ queued: faults.length });
    });
    control.post('/token', (req, res) => {
      token = req.body.token;
      res.json({ ok: true });
    });
    control.put('/todos/:id', (req, res) => {
      todos.set(req.params.id, { ...req.body, id: req.params.id });
      res.json(todos.get(req.params.id));
    });
    control.get('/state', (req, res) => {
      res.json({ todos: Array.from(todos.values()), effects, requests });
    });
    app.use('/__control', control);
  }

  return {
    app,
    todos,
    faults,
    effects,
    requests,
    get idempotencyStore() {
      return idempotencyStore;
    },
    get requestCount() {
      return requestCount;
    },
  };
}

module.exports = { createTodoServer };

if (require.main === module) {
  const port = Number(process.env.PORT || 4000);
  const control = process.env.CONTROL === '1';
  createTodoServer({ token: process.env.TOKEN, control }).app.listen(port, () => {
    console.log(`sync-vault todo server on http://localhost:${port}${control ? ' (test control API enabled)' : ''}`);
  });
}
