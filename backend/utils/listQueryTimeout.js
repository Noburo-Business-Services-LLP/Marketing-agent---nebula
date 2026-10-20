'use strict';
/**
 * A server-side time limit for list reads (drafts, campaigns, notifications, videos, inbox lists), so one slow query
 * cannot pile up connections: MongoDB stops it after LIST_QUERY_MAX_TIME_MS (default 5 s) and the route answers its
 * usual error. Works on a mongoose Query (.maxTimeMS) and an Aggregate (.option); anything else is returned unchanged
 * (test fakes, plain promises).
 */
function listMaxTimeMs(env = process.env) {
  const n = Number.parseInt(String(env.LIST_QUERY_MAX_TIME_MS || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

function listTimeout(q, ms = listMaxTimeMs()) {
  if (q && typeof q.maxTimeMS === 'function') return q.maxTimeMS(ms);
  if (q && typeof q.option === 'function') return q.option({ maxTimeMS: ms });
  return q;
}

module.exports = { listTimeout, listMaxTimeMs };
