// A short, bounded, in-process cache of "who is this token, and may they still come in" for `protectCached`
// (middleware/auth.js). It holds a LEAN, projected, frozen copy of the user (plus the CSM or agency owner of a pass),
// never money or plan state for a handler to act on. Every write to a User clears that user's entries through the
// schema hooks (services/authCacheHooks.js). The cache is per process: see docs/superpowers/ops/auth-cache.md.
//   AUTH_CACHE=off          kill switch: protectCached becomes protect (full document, no cache)
//   AUTH_CACHE_TTL_MS=15000 how long an entry lives (default 15 s, capped at 60 s, 0 = off)
const DEFAULT_TTL_MS = 15000;
const MAX_TTL_MS = 60000;
const DEFAULT_MAX = 5000;

/** The switches, read at call time so a change of environment in tests (or a restart) takes effect. */
function settings(env = process.env) {
  const raw = env.AUTH_CACHE_TTL_MS;
  let ttlMs = DEFAULT_TTL_MS;
  if (raw !== undefined && raw !== '' && /^\d+$/.test(String(raw).trim())) ttlMs = Math.min(Number(raw), MAX_TTL_MS);
  const off = String(env.AUTH_CACHE || '').trim().toLowerCase() === 'off';
  return { enabled: !off && ttlMs > 0, ttlMs, max: DEFAULT_MAX };
}

/** One entry per token context: the user, and the CSM or agency owner acting inside it (never shared between them). */
function keyFor(decoded) {
  const d = decoded || {};
  return `${String(d.id || '')}|c:${d.actingCsm ? String(d.actingCsm) : ''}|a:${d.actingAgency ? String(d.actingAgency) : ''}`;
}

const isPlain = (v) => v !== null && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Freezes plain objects and arrays all the way down; ObjectIds, Dates and Buffers are left as they are. */
function deepFreeze(value) {
  if (!isPlain(value) || Object.isFrozen(value)) return value;
  for (const k of Object.keys(value)) deepFreeze(value[k]);
  return Object.freeze(value);
}

const idString = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.toHexString === 'function') return v.toHexString();
  if (typeof v === 'object' && v._bsontype === 'ObjectId') return String(v);
  return null;
};

/**
 * The user ids a write filter names, or null when it could touch anyone (then the whole cache is cleared).
 * Only `_id: X`, `_id: { $eq: X }` and `_id: { $in: [...] }` are narrow; everything else is treated as wide.
 */
function idsInFilter(filter) {
  if (!filter || typeof filter !== 'object' || !('_id' in filter)) return null;
  const v = filter._id;
  const one = idString(v);
  if (one) return [one];
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === '$eq') { const s = idString(v.$eq); return s ? [s] : null; }
    if (keys.length === 1 && keys[0] === '$in' && Array.isArray(v.$in)) {
      const out = v.$in.map(idString);
      return out.every(Boolean) ? out : null;
    }
  }
  return null;
}

/**
 * ttlMs and max may be numbers or functions (read on every call). `ticket()` is taken before a database read and
 * passed to `set`; if anything was invalidated in between, the value may be stale and is not stored.
 */
function createAuthCache({ ttlMs = DEFAULT_TTL_MS, max = DEFAULT_MAX, now = Date.now } = {}) {
  const ttl = () => Number(typeof ttlMs === 'function' ? ttlMs() : ttlMs) || 0;
  const cap = () => Math.max(1, Number(typeof max === 'function' ? max() : max) || DEFAULT_MAX);
  const entries = new Map(); // key -> { value, expires, ids }
  const byUser = new Map(); // user id -> Set of keys
  let generation = 0;
  const counts = { hits: 0, misses: 0, invalidations: 0, clears: 0, evictions: 0 };

  function drop(key) {
    const e = entries.get(key);
    if (!e) return;
    entries.delete(key);
    for (const id of e.ids) {
      const set = byUser.get(id);
      if (set) { set.delete(key); if (set.size === 0) byUser.delete(id); }
    }
  }

  function get(key) {
    const e = entries.get(key);
    if (!e) { counts.misses += 1; return undefined; }
    if (now() >= e.expires) { drop(key); counts.misses += 1; return undefined; }
    entries.delete(key); entries.set(key, e); // most recently used goes to the end
    counts.hits += 1;
    return e.value;
  }

  const ticket = () => generation;

  function set(key, value, ids, since) {
    if (since !== generation) return false; // something was invalidated while this was being loaded
    const life = ttl();
    if (!(life > 0)) return false;
    drop(key);
    const list = [...new Set((ids || []).filter(Boolean).map(String))];
    entries.set(key, { value, expires: now() + life, ids: list });
    for (const id of list) {
      if (!byUser.has(id)) byUser.set(id, new Set());
      byUser.get(id).add(key);
    }
    while (entries.size > cap()) { drop(entries.keys().next().value); counts.evictions += 1; }
    return true;
  }

  function invalidateUser(id) {
    generation += 1;
    counts.invalidations += 1;
    const s = id === null || id === undefined ? '' : String(id);
    const keys = byUser.get(s);
    if (keys) for (const k of [...keys]) drop(k);
  }

  function clear() {
    generation += 1;
    counts.clears += 1;
    entries.clear();
    byUser.clear();
  }

  return { get, set, ticket, invalidateUser, clear, size: () => entries.size, stats: () => ({ ...counts, size: entries.size }) };
}

let shared = null;
/** The one cache of this process, sized and timed by the environment switches. */
function sharedAuthCache() {
  if (!shared) shared = createAuthCache({ ttlMs: () => settings().ttlMs, max: () => settings().max });
  return shared;
}

module.exports = { settings, keyFor, deepFreeze, idsInFilter, createAuthCache, sharedAuthCache, DEFAULT_TTL_MS, MAX_TTL_MS, DEFAULT_MAX };
