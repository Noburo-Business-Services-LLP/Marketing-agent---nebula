'use strict';
/**
 * Health and readiness for the load balancer (docs/superpowers/ops/performance-week1.md).
 *  - GET /api/health (the ALB target-group path, unchanged): 200 only when MongoDB is connected and answered a ping;
 *    503 otherwise, and while the task is shutting down. The ping result is kept 5 seconds and requests at the same
 *    moment share one ping, so the check stays cheap however often it is called. A dropped connection (readyState)
 *    is seen at once.
 *  - GET /api/ready: the same, worded for a readiness probe ("ready" / "shutting-down").
 */
const STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

function createHealth({
  connection = () => require('mongoose').connection,
  pingTimeoutMs = 1500,
  cacheMs = 5000,
  now = Date.now
} = {}) {
  let shuttingDown = false;
  let cached = null; // { ok, at }
  let inFlight = null;

  const ping = (conn) => {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), pingTimeoutMs); });
    const run = Promise.resolve()
      .then(() => conn.db.admin().command({ ping: 1 }))
      .then((r) => !!r && Number(r.ok) === 1, () => false);
    return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
  };

  async function dbStatus() {
    const conn = connection();
    const state = conn ? conn.readyState : 0;
    if (state !== 1 || !conn.db) return { ok: false, db: STATES[state] || 'unknown' };
    if (cached && now() - cached.at < cacheMs) return { ok: cached.ok, db: cached.ok ? 'up' : 'no-answer' };
    if (!inFlight) {
      inFlight = ping(conn).then((ok) => { cached = { ok, at: now() }; return ok; }).finally(() => { inFlight = null; });
    }
    const ok = await inFlight;
    return { ok, db: ok ? 'up' : 'no-answer' };
  }

  async function health(req, res) {
    const s = await dbStatus();
    res.set('Cache-Control', 'no-store');
    if (shuttingDown) return res.status(503).json({ status: 'shutting-down', db: s.db });
    return res.status(s.ok ? 200 : 503).json({ status: s.ok ? 'ok' : 'down', db: s.db });
  }

  async function ready(req, res) {
    const s = await dbStatus();
    res.set('Cache-Control', 'no-store');
    if (shuttingDown) return res.status(503).json({ status: 'shutting-down', db: s.db });
    return res.status(s.ok ? 200 : 503).json({ status: s.ok ? 'ready' : 'not-ready', db: s.db });
  }

  return {
    health,
    ready,
    dbStatus,
    markShuttingDown() { shuttingDown = true; },
    isShuttingDown: () => shuttingDown
  };
}

module.exports = { createHealth };
