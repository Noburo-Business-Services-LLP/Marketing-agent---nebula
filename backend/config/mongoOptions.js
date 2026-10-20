'use strict';
/**
 * MongoDB connection settings of the server (decision D36). Each server task opens up to maxPoolSize connections, so
 * the cluster sees about (web tasks + worker tasks) x MONGO_MAX_POOL_SIZE at peak, plus scripts and Atlas's own.
 * Example: 6 web + 1 worker at 20 = 140, well under an M10's 1,500 (M20 3,000, M30 3,000; M0/M2/M5 shared tiers 500).
 *
 *   MONGO_MAX_POOL_SIZE                default 20 (1 to 200)   connections per task at most (the driver's own default is 100)
 *   MONGO_MIN_POOL_SIZE                default 2  (0 to max)   kept open, so the first requests after a quiet spell do not pay a handshake
 *   MONGO_SERVER_SELECTION_TIMEOUT_MS  default 30000 (1000 to 60000) how long a query waits for a usable server (unchanged default)
 *   socketTimeoutMS 45000 and connectTimeoutMS 30000 as before.
 */
const int = (v, def, min, max) => {
  const n = Number.parseInt(String(v == null ? '' : v), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
};

function mongoConnectOptions(env = process.env) {
  const maxPoolSize = int(env.MONGO_MAX_POOL_SIZE, 20, 1, 200);
  const minPoolSize = Math.min(int(env.MONGO_MIN_POOL_SIZE, 2, 0, 200), maxPoolSize);
  return {
    maxPoolSize,
    minPoolSize,
    // Atlas/network hiccups can cause fast failures in the middle of scheduling or publishing: give the driver time
    // to pick a server.
    serverSelectionTimeoutMS: int(env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 30000, 1000, 60000),
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000
  };
}

module.exports = { mongoConnectOptions };
