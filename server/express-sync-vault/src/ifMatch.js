'use strict';

/** '"3"', 'W/"3"', and '3' all normalize to '3'. */
function normalizeETag(value) {
  if (value == null) return null;
  return String(value).trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

function formatETag(version) {
  return `"${String(version)}"`;
}

/** Sets ETag so clients can store the version and send it back as If-Match. */
function setETag(res, version) {
  if (version != null) res.setHeader('ETag', formatETag(version));
}

/**
 * Optimistic concurrency for PUT/PATCH/DELETE.
 *
 *   ifMatch({ getVersion: (req) => db.todos.get(req.params.id)?.version,
 *             getCurrent: (req) => db.todos.get(req.params.id) })
 *
 * On mismatch responds 412 with the current resource and its ETag, which the client stores as
 * the server copy and version for conflict resolution. A missing resource falls through so the
 * route can answer 404. With `required: true`, a missing If-Match is answered with 428.
 */
function ifMatch(options) {
  const { getVersion, getCurrent, required = false, methods = ['PUT', 'PATCH', 'DELETE'], status = 412 } = options || {};
  if (typeof getVersion !== 'function') throw new Error('ifMatch requires getVersion(req)');
  const methodSet = new Set(methods.map((m) => m.toUpperCase()));

  return async function ifMatchMiddleware(req, res, next) {
    if (!methodSet.has(req.method)) return next();
    const header = req.get('If-Match');
    if (!header) {
      if (required) return res.status(428).json({ error: 'precondition_required', message: 'If-Match header is required' });
      return next();
    }
    try {
      const current = await getVersion(req);
      if (current == null) return next();
      const accepted = header.split(',').map(normalizeETag);
      if (accepted.includes('*') || accepted.includes(normalizeETag(current))) return next();
      const body = getCurrent ? await getCurrent(req) : null;
      setETag(res, current);
      return res.status(status).json({
        error: 'version_mismatch',
        version: normalizeETag(current),
        current: body,
      });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { ifMatch, setETag, normalizeETag, formatETag };
