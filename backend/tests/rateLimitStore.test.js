'use strict';
// The shared rate-limit store (services/rateLimitStore.js): atomic counts, window expiry, fail-open, two server
// processes sharing one collection (two limiter instances on one fake collection), store selection, one helper for all.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { rateLimit, MongoRateLimitStore, makeStore, storeKind } = require('../services/rateLimitStore');

// A tiny in-memory collection that understands the one update pipeline the store sends.
function fakeCollection() {
  const docs = new Map();
  const val = (expr, doc) => {
    if (typeof expr === 'string' && expr.startsWith('$')) return doc[expr.slice(1)];
    if (expr instanceof Date || typeof expr !== 'object' || expr === null) return expr;
    if (expr.$cond) return val(expr.$cond[0], doc) ? val(expr.$cond[1], doc) : val(expr.$cond[2], doc);
    if (expr.$lte) { const a = val(expr.$lte[0], doc); const b = val(expr.$lte[1], doc); return a == null ? true : a <= b; }
    if (expr.$add) return expr.$add.reduce((s, e) => s + val(e, doc), 0);
    throw new Error(`unsupported ${JSON.stringify(expr)}`);
  };
  return {
    docs,
    calls: 0,
    async findOneAndUpdate(filter, pipeline, opts) {
      this.calls += 1;
      assert.ok(opts.upsert && opts.returnDocument === 'after' && opts.maxTimeMS > 0);
      let doc = { ...(docs.get(filter._id) || { _id: filter._id }) };
      for (const stage of pipeline) {
        const next = { ...doc };
        for (const [k, e] of Object.entries(stage.$set)) next[k] = val(e, doc);
        doc = next;
      }
      docs.set(filter._id, doc);
      return { ...doc };
    },
    async updateOne(filter, upd) { const d = docs.get(filter._id); if (d && d.hits > 0) d.hits += upd.$inc.hits; },
    async deleteOne(filter) { docs.delete(filter._id); },
    async findOne(filter) { return docs.get(filter._id) || null; }
  };
}

test('counts atomically and starts a new window when the old one ends', async () => {
  const coll = fakeCollection();
  let now = 1_000_000;
  const store = new MongoRateLimitStore({ prefix: 't1', collection: () => coll, now: () => now, ensureIndex: null });
  store.init({ windowMs: 60_000 });
  const results = await Promise.all(Array.from({ length: 50 }, () => store.increment('k')));
  assert.deepStrictEqual(results.map((r) => r.totalHits).sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.strictEqual(coll.docs.size, 1);
  const doc = [...coll.docs.values()][0];
  assert.strictEqual(doc.hits, 50);
  assert.strictEqual(doc.expireAt.getTime(), now + 60_000, 'TTL field equals the window end');
  assert.notStrictEqual(doc._id, 'k', 'the key is stored hashed, not as typed');
  now += 30_000;
  assert.strictEqual((await store.increment('k')).totalHits, 51, 'same window');
  now += 30_001;
  const fresh = await store.increment('k');
  assert.strictEqual(fresh.totalHits, 1, 'window over: starts again at 1');
  assert.strictEqual(fresh.resetTime.getTime(), now + 60_000);
  assert.strictEqual((await store.get('k')).totalHits, 1);
  await store.decrement('k');
  assert.strictEqual([...coll.docs.values()][0].hits, 0);
  await store.resetKey('k');
  assert.strictEqual(coll.docs.size, 0);
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
