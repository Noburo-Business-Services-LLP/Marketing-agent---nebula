'use strict';
/**
 * One place that creates every request limiter of the app, so they all count in the same store
 * (docs/superpowers/ops/ecs-web-worker.md, decision D32).
 *
 *   RATE_LIMIT_STORE=memory (default) -> express-rate-limit's own in-process counters (local runs, tests, one task).
 *   RATE_LIMIT_STORE=mongo            -> counters in the MongoDB collection `rate_limits`, shared by every task:
 *                                        one atomic `$inc` upsert per counted request (one document per key and fixed
 *                                        window), removed by a TTL index when the window ends. Recommended in
 *                                        production with two or more web tasks. The general per-address limiter (every
 *                                        request) stays per task unless RATE_LIMIT_GENERAL_SHARED=on.
 *   RATE_LIMIT_STORE=redis            -> `rate-limit-redis` with a `redis` client, ONLY when REDIS_URL is set and both
 *                                        packages are installed (they are optional, required lazily); otherwise a
 *                                        warning and the Mongo store.
 *
 * Fail-open: if the shared store cannot answer (database down, slow, not connected yet), the request is let through
 * and one warning a minute is logged. The app never goes down because of limiter storage.
 *
 * Usage: `const rateLimit = require('../services/rateLimitStore').rateLimit;` exactly like express-rate-limit (the
 * library's helpers such as `ipKeyGenerator` are on it too). Each limiter gets its own store with a stable prefix: the
 * `name` option when given, else the file and line that created it plus a counter (same image, same load order, so
 * the same prefix in every task).
 */
const crypto = require('crypto');
const path = require('path');
const expressRateLimit = require('express-rate-limit');

const COLLECTION = 'rate_limits';
const OP_TIMEOUT_MS = 1500; // server-side limit of one store operation (maxTimeMS)
// How long a request waits for the shared count before it is let through uncounted (the late count still lands).
// Keeps a slow or contended store from adding more than this to any request. RATE_LIMIT_STORE_WAIT_MS, 50 to 2000.
const waitMs = (env = process.env) => {
  const n = Number.parseInt(String(env.RATE_LIMIT_STORE_WAIT_MS || ''), 10);
  return Number.isFinite(n) ? Math.max(50, Math.min(2000, n)) : 300;
};
const WARN_EVERY_MS = 60 * 1000;

let lastWarn = 0;
function warnOnce(message, now = Date.now()) {
  if (now - lastWarn < WARN_EVERY_MS) return;
  lastWarn = now;
  console.warn(`[rate limit] ${message}: requests are let through without counting until the store answers again`);
}

const hashKey = (prefix, key) => crypto.createHash('sha256').update(`${prefix}|${String(key).slice(0, 512)}`).digest('base64url');

/** The native collection when mongoose is connected, else null (never buffers: a request must not wait for a reconnect). */
function defaultCollection() {
  const mongoose = require('mongoose');
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1 || !conn.db) return null;
  return conn.db.collection(COLLECTION);
}

let indexEnsured = null;
function ensureTtlIndex(coll) {
  if (indexEnsured) return indexEnsured;
  indexEnsured = Promise.resolve()
    .then(() => coll.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expireAt' }))
    .catch((e) => { indexEnsured = null; console.warn('[rate limit] could not create the TTL index on rate_limits:', e && e.message); });
  return indexEnsured;
}

class MongoRateLimitStore {
  constructor({ prefix = '', collection = defaultCollection, now = Date.now, timeoutMs = OP_TIMEOUT_MS, ensureIndex = ensureTtlIndex, wait = waitMs() } = {}) {
    this._wait = wait;
    this.prefix = String(prefix);
    this.localKeys = false;
    this._collection = collection;
    this._now = now;
    this._timeoutMs = timeoutMs;
    this._ensureIndex = ensureIndex;
    this.windowMs = 15 * 60 * 1000;
  }

  init(options) { if (options && Number.isFinite(options.windowMs)) this.windowMs = options.windowMs; }

  /** The collection, after its TTL index exists (built once per process; the first request waits for it, so an
   * index build on a brand-new collection never races the first upserts). */
  async _coll() {
    const coll = this._collection();
    if (!coll) throw new Error('rate limit store not connected');
    if (this._ensureIndex) await this._ensureIndex(coll);
    return coll;
  }

  /** Fixed windows (like the memory store's per key, but aligned to multiples of windowMs, the same in every task):
   * one document per key and window, so a count is a plain atomic `$inc` upsert (measured on the dev cluster: about
   * 4 to 7 times faster under contention than an update pipeline that resets a rolling window in place). */
  _window() {
    const now = this._now();
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    return { start, resetAt: new Date(start + this.windowMs) };
  }

  _id(key, start) { return `${hashKey(this.prefix, key)}.${start.toString(36)}`; }

  async increment(key) {
    try {
      const coll = await this._coll();
      const { start, resetAt } = this._window();
      const id = this._id(key, start);
      const run = () => coll.findOneAndUpdate(
        { _id: id },
        { $inc: { hits: 1 }, $setOnInsert: { resetAt, expireAt: resetAt, p: this.prefix } },
        { upsert: true, returnDocument: 'after', maxTimeMS: this._timeoutMs }
      );
      const attempt = async () => {
        try { return await run(); } catch (e) {
          if (e && e.code === 11000) return run(); // two first hits at the same moment: the loser simply increments
          throw e;
        }
      };
      let timer;
      const slow = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${this._wait} ms`)), this._wait); });
      let doc;
      try { doc = await Promise.race([attempt(), slow]); } finally { clearTimeout(timer); }
      if (doc && doc.value !== undefined && doc.ok !== undefined) doc = doc.value; // older driver result shape
      if (!doc) throw new Error('rate limit store returned nothing');
      return { totalHits: Math.max(1, Number(doc.hits) || 1), resetTime: new Date(doc.resetAt || resetAt) };
    } catch (e) {
      warnOnce(`shared store error (${e && e.message})`);
      throw e; // express-rate-limit lets the request through (passOnStoreError) and logs it
    }
  }

  async decrement(key) {
    try { const { start } = this._window(); await (await this._coll()).updateOne({ _id: this._id(key, start), hits: { $gt: 0 } }, { $inc: { hits: -1 } }, { maxTimeMS: this._timeoutMs }); }
    catch (e) { warnOnce(`shared store error on decrement (${e && e.message})`); }
  }

  async resetKey(key) {
    try { const { start } = this._window(); await (await this._coll()).deleteOne({ _id: this._id(key, start) }, { maxTimeMS: this._timeoutMs }); }
    catch (e) { warnOnce(`shared store error on reset (${e && e.message})`); }
  }

  async get(key) {
    try {
      const { start } = this._window();
      const doc = await (await this._coll()).findOne({ _id: this._id(key, start) }, { maxTimeMS: this._timeoutMs });
      if (!doc) return undefined;
      return { totalHits: doc.hits, resetTime: new Date(doc.resetAt) };
    } catch (e) { warnOnce(`shared store error on read (${e && e.message})`); return undefined; }
  }
}

// ---- which store -------------------------------------------------------------------------------------------------

function storeKind(env = process.env) {
  const v = String(env.RATE_LIMIT_STORE || '').trim().toLowerCase();
  return v === 'mongo' || v === 'redis' ? v : 'memory';
}

let redisClient = null;
let redisWarned = false;
/** A RedisStore when REDIS_URL is set and both optional packages load; otherwise null (the caller uses Mongo). */
function makeRedisStore(prefix, { env = process.env, load = require } = {}) {
  if (!env.REDIS_URL) {
    if (!redisWarned) { redisWarned = true; console.warn('[rate limit] RATE_LIMIT_STORE=redis but REDIS_URL is not set: using the MongoDB store'); }
    return null;
  }
  try {
    const { RedisStore } = load('rate-limit-redis');
    if (!redisClient) {
      const { createClient } = load('redis');
      redisClient = createClient({ url: env.REDIS_URL });
      redisClient.on('error', (e) => warnOnce(`redis error (${e && e.message})`));
      redisClient.connect().catch((e) => warnOnce(`redis connect failed (${e && e.message})`));
    }
    return new RedisStore({ prefix: `rl:${prefix}:`, sendCommand: (...args) => redisClient.sendCommand(args) });
  } catch (e) {
    if (!redisWarned) { redisWarned = true; console.warn(`[rate limit] RATE_LIMIT_STORE=redis but rate-limit-redis/redis are not installed (${e && e.message}): using the MongoDB store`); }
    return null;
  }
}

function makeStore(prefix, { env = process.env, load } = {}) {
  const kind = storeKind(env);
  if (kind === 'memory') return null; // the library's MemoryStore
  if (kind === 'redis') { const r = makeRedisStore(prefix, { env, load }); if (r) return r; }
  return new MongoRateLimitStore({ prefix });
}

// ---- stable names ---------------------------------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const siteCounts = new Map();
/** "routes/plan.js:16#1": the file and line that called rateLimit(), plus the how-many-th limiter made there. */
function callSiteName() {
  const stack = String(new Error().stack || '').split('\n').slice(1);
  const frame = stack.find((l) => !l.includes(__filename) && !l.includes('node_modules') && /\(?(\/[^():]+):(\d+):\d+\)?/.test(l));
  const m = frame && frame.match(/\(?(\/[^():]+):(\d+):\d+\)?/);
  const site = m ? `${path.relative(ROOT, m[1])}:${m[2]}` : 'unknown';
  const n = (siteCounts.get(site) || 0) + 1;
  siteCounts.set(site, n);
  return `${site}#${n}`;
}

const created = [];
/** Drop-in for express-rate-limit: the same options, plus an optional `name`. */
function rateLimit(options = {}) {
  const { name, perTask, ...rest } = options;
  const prefix = String(name || callSiteName());
  // `perTask`: a limiter hit by every request (the general per-address flood guard) keeps its own counters in each
  // task unless RATE_LIMIT_GENERAL_SHARED=on: a shared count would add one database write to every request (D32).
  const keepLocal = perTask && String(process.env.RATE_LIMIT_GENERAL_SHARED || '').trim().toLowerCase() !== 'on';
  const store = rest.store || (keepLocal ? null : makeStore(prefix));
  created.push({ prefix, store: store ? store.constructor.name : 'MemoryStore' });
  return expressRateLimit({ passOnStoreError: true, ...rest, ...(store ? { store } : {}) });
}
Object.assign(rateLimit, expressRateLimit); // ipKeyGenerator, MemoryStore, ... as on the library
rateLimit.rateLimit = rateLimit; // and never the raw library through these two names
rateLimit.default = rateLimit;

module.exports = { rateLimit, MongoRateLimitStore, makeStore, storeKind, hashKey, createdLimiters: () => created.slice(), COLLECTION };
