// Memory watchdog: logs heap + handle counts + known cache sizes every 5 min.
// Goal: identify which counter grows linearly so we can fix the actual leak.
//
// Read the logs in Render → filter for "[MEM]". Look for any number that
// climbs steadily over hours — that's where the leak is.

const mongoose = require('mongoose');

const INTERVAL_MS = Number(process.env.MEMORY_WATCHDOG_INTERVAL_MS || 5 * 60 * 1000);

function mb(bytes) {
  return Math.round((Number(bytes) || 0) / 1024 / 1024);
}

function safeRequire(modPath) {
  try { return require(modPath); } catch (_) { return null; }
}

function snapshot() {
  const mem = process.memoryUsage();
  const handles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : -1;
  const requests = typeof process._getActiveRequests === 'function' ? process._getActiveRequests().length : -1;

  // Categorize active handles by type — this is THE most useful signal.
  // If "Socket" or "TCPSocketWrap" climbs, you have a connection leak.
  // If "Timeout" climbs, you have uncleared setInterval/setTimeout.
  const handlesByType = {};
  try {
    if (typeof process._getActiveHandles === 'function') {
      for (const h of process._getActiveHandles()) {
        const name = h?.constructor?.name || 'unknown';
        handlesByType[name] = (handlesByType[name] || 0) + 1;
      }
    }
  } catch (_) {}

  // Mongoose connection pool
  let mongoPool = {};
  try {
    const conn = mongoose.connection;
    mongoPool = {
      readyState: conn.readyState, // 1 = connected
      // Active sockets in the driver pool
      socketCount: conn.client?.topology?.s?.servers?.size || 'n/a'
    };
  } catch (_) {}

  const stats = {
    ts: new Date().toISOString(),
    rss_mb: mb(mem.rss),
    heapUsed_mb: mb(mem.heapUsed),
    heapTotal_mb: mb(mem.heapTotal),
    external_mb: mb(mem.external),
    arrayBuffers_mb: mb(mem.arrayBuffers),
    activeHandles: handles,
    activeRequests: requests,
    handlesByType,
    mongo: mongoPool,
    uptime_min: Math.round(process.uptime() / 60)
  };

  console.log('[MEM]', JSON.stringify(stats));
}

function start() {
  // Immediate snapshot so we have a baseline
  snapshot();
  const timer = setInterval(snapshot, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[MEM] Watchdog started, interval=${INTERVAL_MS}ms`);
  return timer;
}

module.exports = { start, snapshot };
