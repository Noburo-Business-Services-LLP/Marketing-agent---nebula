'use strict';
// The shared rate-limit store (services/rateLimitStore.js): atomic counts, window expiry, fail-open, two server
// processes sharing one collection (two limiter instances on one fake collection), store selection, one helper for all.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { rateLimit, MongoRateLimitStore, makeStore, storeKind, hashKey } = require('../services/rateLimitStore');

// A tiny in-memory collection that understands the one upsert the store sends ($inc with $setOnInsert).
function fakeCollection() {
  const docs = new Map();
  return {
    docs,
    calls: 0,
    async findOneAndUpdate(filter, upd, opts) {
      this.calls += 1;
      assert.ok(opts.upsert && opts.returnDocument === 'after' && opts.maxTimeMS > 0);
      assert.ok(!Array.isArray(upd), 'a plain update, not a pipeline');
      let doc = docs.get(filter._id);
      if (!doc) { doc = { _id: filter._id, ...upd.$setOnInsert }; docs.set(filter._id, doc); }
      for (const [k, v] of Object.entries(upd.$inc)) doc[k] = (doc[k] || 0) + v;
      return { ...doc };
    },
    async updateOne(filter, upd) { const d = docs.get(filter._id); if (d && d.hits > 0) d.hits += upd.$inc.hits; },
    async deleteOne(filter) { docs.delete(filter._id); },
    async findOne(filter) { return docs.get(filter._id) || null; }
  };
}

test('counts atomically and starts a new window when the old one ends', async () => {
  const coll = fakeCollection();
  let now = 1_200_000; // a multiple of the window: windows are aligned, the same in every task
  const store = new MongoRateLimitStore({ prefix: 't1', collection: () => coll, now: () => now, ensureIndex: null });
  store.init({ windowMs: 60_000 });
  const results = await Promise.all(Array.from({ length: 50 }, () => store.increment('k')));
  assert.deepStrictEqual(results.map((r) => r.totalHits).sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.strictEqual(coll.docs.size, 1);
  const doc = [...coll.docs.values()][0];
  assert.strictEqual(doc.hits, 50);
  assert.strictEqual(doc.expireAt.getTime(), 1_260_000, 'TTL field equals the window end');
  assert.strictEqual(doc._id, `${hashKey('t1', 'k')}.${(1_200_000).toString(36)}`, 'the key is stored hashed, with its window');
  now += 30_000;
  assert.strictEqual((await store.increment('k')).totalHits, 51, 'same window');
  now += 30_001;
  const fresh = await store.increment('k');
  assert.strictEqual(fresh.totalHits, 1, 'window over: starts again at 1');
  assert.strictEqual(fresh.resetTime.getTime(), 1_320_000);
  assert.strictEqual((await store.get('k')).totalHits, 1);
  await store.decrement('k');
  assert.strictEqual((await store.get('k')).totalHits, 0);
  await store.resetKey('k');
  assert.strictEqual(await store.get('k'), undefined);
});

test('a duplicate-key race on the first hit is retried once', async () => {
  const coll = fakeCollection();
  const real = coll.findOneAndUpdate.bind(coll);
  let first = true;
  coll.findOneAndUpdate = async (...a) => { if (first) { first = false; const e = new Error('dup'); e.code = 11000; throw e; } return real(...a); };
  const store = new MongoRateLimitStore({ prefix: 'dup', collection: () => coll, ensureIndex: null });
  assert.strictEqual((await store.increment('k')).totalHits, 1);
});

function listen(app) {
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}
function get(server, p = '/') {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
}
function appWith(limiter) {
  const app = express();
  app.set('trust proxy', false);
  app.use(limiter);
  app.get('/', (req, res) => res.send('ok'));
  return app;
}

test('two server processes (two limiter instances) share one collection: the limit is counted across both', async () => {
  const coll = fakeCollection();
  const mk = () => rateLimit({ name: 'shared-test', windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false, store: new MongoRateLimitStore({ prefix: 'shared-test', collection: () => coll, ensureIndex: null }) });
  const a = await listen(appWith(mk()));
  const b = await listen(appWith(mk()));
  try {
    const codes = [];
    for (let i = 0; i < 3; i += 1) codes.push(await get(a));
    for (let i = 0; i < 2; i += 1) codes.push(await get(b));
    assert.deepStrictEqual(codes, [200, 200, 200, 200, 200]);
    assert.strictEqual(await get(b), 429, 'the sixth request is refused by the other instance');
    assert.strictEqual(await get(a), 429);
    assert.strictEqual(coll.docs.size, 1);
  } finally { a.close(); b.close(); }
});

test('fail-open: a store that cannot answer lets the request through', async () => {
  const errors = [];
  const origWarn = console.warn; const origErr = console.error;
  console.warn = (...m) => errors.push(m.join(' ')); console.error = () => {};
  const down = new MongoRateLimitStore({ prefix: 'down', collection: () => null, ensureIndex: null });
  const broken = new MongoRateLimitStore({ prefix: 'broken', collection: () => ({ findOneAndUpdate: async () => { throw new Error('timeout'); } }), ensureIndex: null });
  const slow = new MongoRateLimitStore({ prefix: 'slow', wait: 50, collection: () => ({ findOneAndUpdate: () => new Promise((r) => setTimeout(() => r({ hits: 1, resetAt: new Date() }), 400)) }), ensureIndex: null });
  const s3 = await listen(appWith(rateLimit({ name: 'slow', windowMs: 60_000, max: 1, store: slow })));
  const t = Date.now();
  assert.strictEqual(await get(s3), 200);
  assert.ok(Date.now() - t < 300, 'a slow store adds at most the wait (50 ms here), not its own time');
  s3.close();
  const s1 = await listen(appWith(rateLimit({ name: 'down', windowMs: 60_000, max: 1, store: down })));
  const s2 = await listen(appWith(rateLimit({ name: 'broken', windowMs: 60_000, max: 1, store: broken })));
  try {
    assert.deepStrictEqual([await get(s1), await get(s1), await get(s1)], [200, 200, 200]);
    assert.deepStrictEqual([await get(s2), await get(s2)], [200, 200]);
    assert.ok(errors.some((e) => /let through/.test(e)), 'a warning is logged');
  } finally { s1.close(); s2.close(); console.warn = origWarn; console.error = origErr; }
});

test('store selection: memory by default, mongo on request, redis only with REDIS_URL and the packages', () => {
  assert.strictEqual(storeKind({}), 'memory');
  assert.strictEqual(storeKind({ RATE_LIMIT_STORE: 'MONGO' }), 'mongo');
  assert.strictEqual(storeKind({ RATE_LIMIT_STORE: 'nonsense' }), 'memory');
  assert.strictEqual(makeStore('x', { env: {} }), null, 'memory: the library default store');
  assert.ok(makeStore('x', { env: { RATE_LIMIT_STORE: 'mongo' } }) instanceof MongoRateLimitStore);
  const origWarn = console.warn; console.warn = () => {};
  try {
    assert.ok(makeStore('x', { env: { RATE_LIMIT_STORE: 'redis' } }) instanceof MongoRateLimitStore, 'no REDIS_URL: Mongo');
    const missing = () => { throw new Error("Cannot find module 'rate-limit-redis'"); };
    assert.ok(makeStore('x', { env: { RATE_LIMIT_STORE: 'redis', REDIS_URL: 'redis://127.0.0.1:1' }, load: missing }) instanceof MongoRateLimitStore, 'package missing: Mongo, no crash');
  } finally { console.warn = origWarn; }
});

test('the general per-address limiter stays per task unless RATE_LIMIT_GENERAL_SHARED=on', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'rateLimits.js'), 'utf8');
  assert.match(src, /name: 'general',\n\s*perTask: true/);
  const helper = fs.readFileSync(path.join(__dirname, '..', 'services', 'rateLimitStore.js'), 'utf8');
  assert.match(helper, /const keepLocal = perTask && String\(process\.env\.RATE_LIMIT_GENERAL_SHARED \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'on';/);
});

test('every limiter of the app is made through the one helper', () => {
  const root = path.join(__dirname, '..');
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.js') && rel !== 'services/rateLimitStore.js' && /require\(['"]express-rate-limit['"]\)/.test(fs.readFileSync(path.join(root, rel), 'utf8'))) offenders.push(rel);
    }
  };
  for (const d of ['routes', 'middleware', 'services', 'controllers']) walk(d);
  assert.ok(!/require\(['"]express-rate-limit['"]\)/.test(fs.readFileSync(path.join(root, 'server-main.js'), 'utf8')));
  assert.deepStrictEqual(offenders, []);
  assert.strictEqual(typeof rateLimit.ipKeyGenerator, 'function');
  assert.strictEqual(rateLimit.rateLimit, rateLimit);
});
