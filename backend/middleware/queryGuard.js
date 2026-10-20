'use strict';
/**
 * Query-string operator injection: `?status[$ne]=x` is parsed by Express into { status: { $ne: 'x' } }, which a handler
 * that copies req.query.status into a Mongo filter would run as an operator. express-mongo-sanitize (mounted right after
 * this) strips such keys, but that leaves an empty object where a string was expected. This guard answers 400 first, so
 * no handler ever sees an operator-shaped query value. Nested objects WITHOUT operator keys (a=b[c]=d) are left alone.
 */
function hasOperatorKey(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return false;
  if (Array.isArray(value)) return value.some((v) => hasOperatorKey(v, depth + 1));
  return Object.keys(value).some((k) => k.startsWith('$') || hasOperatorKey(value[k], depth + 1));
}

function queryGuard(req, res, next) {
  if (hasOperatorKey(req.query)) return res.status(400).json({ success: false, message: 'Invalid query', errorCode: 'INVALID_QUERY' });
  return next();
}

module.exports = { queryGuard, hasOperatorKey };
