/**
 * A small in-memory cache for the heavy staff pages (Home, Clients, Team, Usage).
 *
 *  - Fresh for `ttlMs` (5 minutes). After that the last good result is still served at once while one background
 *    refresh runs ("stale while revalidate"), for up to `maxStaleMs` (30 minutes); older than that, the caller waits.
 *  - A second request for the same key while a computation is running joins that computation (no stampede).
 *  - A failed computation is never stored. If a background refresh fails, the last good result stays.
 *  - At most `maxEntries` results are kept (the least recently used one goes first).
 *  - `refresh: true` skips the stored result and recomputes (still joining a computation already running).
 *
 * The caller builds the key. It must contain everything that changes WHO may see the data or WHICH data it is:
 * the endpoint, the window, the permission level, and for a CSM the CSM's own id. See `keyFor`.
 */
const DEFAULTS = { ttlMs: 5 * 60 * 1000, maxStaleMs: 30 * 60 * 1000, maxEntries: 40 };

function createStaffCache({ ttlMs = DEFAULTS.ttlMs, maxStaleMs = DEFAULTS.maxStaleMs, maxEntries = DEFAULTS.maxEntries, now = Date.now, onError = () => {} } = {}) {
  const store = new Map();     // key -> { value, at }
  const running = new Map();   // key -> Promise<{ value, at }>

  function remember(key, value) {
    const entry = { value, at: now() };
    store.delete(key);
    store.set(key, entry);
    while (store.size > maxEntries) store.delete(store.keys().next().value);
    return entry;
  }

  function start(key, compute) {
    if (running.has(key)) return running.get(key);
    const p = (async () => remember(key, await compute()))();
    running.set(key, p);
    const done = () => { if (running.get(key) === p) running.delete(key); };
    p.then(done, done);
    return p;
  }

  /** Resolves to { value, updatedAt (ms), fromCache, stale }. Rejects only when nothing usable exists. */
  async function get(key, compute, { refresh = false } = {}) {
    const hit = store.get(key);
    if (hit && !refresh) {
      const age = now() - hit.at;
      store.delete(key); store.set(key, hit); // most recently used
      if (age <= ttlMs) return { value: hit.value, updatedAt: hit.at, fromCache: true, stale: false };
      if (age <= maxStaleMs) {
        if (!running.has(key)) start(key, compute).catch((error) => onError(key, error));
        return { value: hit.value, updatedAt: hit.at, fromCache: true, stale: true };
      }
    }
    const entry = await start(key, compute);
    return { value: entry.value, updatedAt: entry.at, fromCache: false, stale: false };
  }

  return { get, clear: () => { store.clear(); }, size: () => store.size, has: (key) => store.has(key), _running: () => running.size };
}

/** The cache key: endpoint, window, permission level, and (CSM only) whose clients. Never built from caller-supplied text. */
function keyFor({ endpoint, window = '', role, csmId = '' }) {
  const level = role === 'owner' || role === 'admin' || role === 'csm' ? role : 'none';
  return [endpoint, window, level, level === 'csm' ? String(csmId) : ''].join('|');
}

/** Real cache everywhere except under `node --test`, unless STAFF_CACHE=off. Tests inject their own with `router._setCache`. */
function defaultCache() {
  if (process.env.STAFF_CACHE === 'off' || process.env.NODE_TEST_CONTEXT) return null;
  return createStaffCache({ onError: (key, error) => console.error(`[staff] background refresh failed for ${key.split('|')[0]}:`, error.message) });
}

module.exports = { createStaffCache, keyFor, defaultCache, DEFAULTS };
