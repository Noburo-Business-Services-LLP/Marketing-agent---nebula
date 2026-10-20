const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createHomeRouter, invalidateOnWrite } = require('../routes/home');
const { createSummaryCache } = require('../services/homeSummaryCache');
const { protectCached } = require('../middleware/auth');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } });
const handlerFor = (impl) => { const r = routesOf(createHomeRouter(impl)).find((x) => x.method === 'get' && x.path === '/summary'); return r.handlers[r.handlers.length - 1]; };
const user = (n = 1, extra = {}) => ({ _id: `u${n}`, isActive: true, plan: { tier: 'starter' }, ...extra });
const fakeService = (log = []) => ({ build: async ({ user: u, pass }) => { log.push(u._id); return { generatedAt: 'x', account: { pass }, degraded: [], n: log.length }; } });
const call = async (impl, req) => { const res = mkRes(); await handlerFor(impl)({ query: {}, ...req }, res); return res; };

test('the route is GET /summary behind sign-in and a rate limit', () => {
  const route = routesOf(createHomeRouter({ service: fakeService() })).find((r) => r.path === '/summary');
  assert.ok(route && route.method === 'get');
  assert.strictEqual(route.handlers[0], protectCached, 'sign-in comes first (the short auth cache; the summary loads a fresh user on a miss)');
  assert.ok(route.handlers.length >= 3, 'a rate limiter sits between sign-in and the handler');
});

test('the signed-in account is used, never an id from the request', async () => {
  const log = [];
  const res = await call({ service: fakeService(log), cache: createSummaryCache() }, { user: user(7), query: { userId: 'u99' }, params: { userId: 'u99' }, body: { userId: 'u99' } });
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(log, ['u7']);
  assert.strictEqual(res.body.success, true);
});

test('no sign-in or no id gives 401', async () => {
  const res = await call({ service: fakeService() }, { user: null });
  assert.strictEqual(res.code, 401);
  const demo = await call({ service: fakeService() }, { user: { email: 'x@y.z', isActive: true } });
  assert.strictEqual(demo.code, 401);
});

test('a second call inside the window comes from the cache; ?refresh=1 builds a new one', async () => {
  let t = 1000;
  const log = [];
  const impl = { service: fakeService(log), cache: createSummaryCache({ now: () => t }) };
  const a = await call(impl, { user: user(1) });
  t += 5000;
  const b = await call(impl, { user: user(1) });
  assert.strictEqual(log.length, 1);
  assert.strictEqual(b.body.cached, true);
  assert.strictEqual(a.body.cached, false);
  assert.strictEqual(b.body.n, a.body.n);
  const c = await call(impl, { user: user(1), query: { refresh: '1' } });
  assert.strictEqual(log.length, 2);
  assert.strictEqual(c.body.cached, false);
  const d = await call(impl, { user: user(1) });
  assert.strictEqual(log.length, 2, 'the refreshed answer is the cached one now');
  assert.strictEqual(d.body.n, c.body.n);
});

test('one account never gets another account\'s answer', async () => {
  const impl = { service: fakeService(), cache: createSummaryCache() };
  const a = await call(impl, { user: user(1) });
  const b = await call(impl, { user: user(2) });
  assert.notStrictEqual(a.body.n, b.body.n);
  assert.strictEqual(b.body.cached, false);
});

test('a pass (CSM or agency) is cached apart from the owner, so the owner never sees a pass-shaped answer', async () => {
  const log = [];
  const impl = { service: fakeService(log), cache: createSummaryCache() };
  await call(impl, { user: user(1) });
  const pass = await call(impl, { user: user(1), actingAgency: { _id: 'owner' } });
  assert.strictEqual(log.length, 2);
  assert.strictEqual(pass.body.account.pass, true);
  const csm = await call(impl, { user: user(1), actingCsm: { _id: 'csm' } });
  assert.strictEqual(csm.body.account.pass, true);
});

test('errors are answered plainly and never cached', async () => {
  let fail = true;
  const svc = { build: async () => { if (fail) throw new Error('secret db detail'); return { generatedAt: 'x', degraded: [] }; } };
  const impl = { service: svc, cache: createSummaryCache() };
  const bad = await quiet(() => call(impl, { user: user(1) }));
  assert.strictEqual(bad.code, 500);
  assert.ok(!JSON.stringify(bad.body).includes('secret'));
  assert.match(bad.body.message, /could not/i);
  fail = false;
  const ok = await call(impl, { user: user(1) });
  assert.strictEqual(ok.code, 200);
});

test('an answer with a failed block is returned but not cached', async () => {
  let n = 0;
  const svc = { build: async () => ({ generatedAt: 'x', degraded: n++ === 0 ? ['snapshots'] : [] }) };
  const impl = { service: svc, cache: createSummaryCache() };
  const a = await call(impl, { user: user(1) });
  const b = await call(impl, { user: user(1) });
  assert.strictEqual(a.body.degraded.length, 1);
  assert.strictEqual(b.body.degraded.length, 0);
  assert.strictEqual(b.body.cached, false);
  const c = await call(impl, { user: user(1) });
  assert.strictEqual(c.body.cached, true);
});

test('the answer is never stored by the browser', async () => {
  const res = await call({ service: fakeService(), cache: createSummaryCache() }, { user: user(1) });
  assert.match(String(res.headers['Cache-Control']), /no-store|private/);
});

test('the cache: expiry, size bound, invalidate, clear', () => {
  let t = 0;
  const c = createSummaryCache({ ttlMs: 60000, max: 3, now: () => t });
  c.set('a', { v: 1 }); c.set('b', { v: 2 }); c.set('c', { v: 3 });
  assert.strictEqual(c.size(), 3);
  c.set('d', { v: 4 });
  assert.strictEqual(c.size(), 3, 'bounded');
  assert.strictEqual(c.get('a'), undefined, 'the oldest went first');
  c.get('b'); // b is now the freshest
  c.set('e', { v: 5 });
  assert.ok(c.get('b'), 'a recently used entry survives');
  t = 59999; assert.ok(c.get('b'));
  t = 60001; assert.strictEqual(c.get('b'), undefined);
  assert.strictEqual(c.size() <= 3, true);
  c.set('x:0', 1); c.set('x:1', 2); c.invalidate('x');
  assert.strictEqual(c.get('x:0'), undefined);
  assert.strictEqual(c.get('x:1'), undefined);
  c.set('y', 1); c.clear(); assert.strictEqual(c.size(), 0);
});

test('the default cache holds 60 seconds and a bounded number of accounts', () => {
  const { TTL_MS, MAX_ENTRIES } = require('../services/homeSummaryCache');
  assert.strictEqual(TTL_MS, 60000);
  assert.ok(MAX_ENTRIES > 0 && MAX_ENTRIES <= 2000);
});

test('a write that changes the numbers clears that account\'s cached answer', async () => {
  const cache = createSummaryCache();
  cache.set('u1:0', { a: 1 }); cache.set('u1:1', { a: 2 }); cache.set('u2:0', { a: 3 });
  const mw = invalidateOnWrite(cache);
  const listeners = {};
  const run = (method, status, u) => { const res = { statusCode: status, on: (ev, fn) => { listeners[ev] = fn; } }; let nexted = false; mw({ method, user: u }, res, () => { nexted = true; }); assert.ok(nexted); if (listeners.finish) { listeners.finish(); delete listeners.finish; } };
  run('GET', 200, { _id: 'u1' });
  assert.ok(cache.get('u1:0'), 'a read changes nothing');
  run('POST', 500, { _id: 'u1' });
  assert.ok(cache.get('u1:0'), 'a failed write changes nothing');
  run('POST', 200, { _id: 'u1' });
  assert.strictEqual(cache.get('u1:0'), undefined);
  assert.strictEqual(cache.get('u1:1'), undefined);
  assert.ok(cache.get('u2:0'), 'other accounts are untouched');
});

test('the route is mounted, and one write watcher sits in front of every /api route', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  assert.match(src, /app\.use\('\/api\/home', require\('\.\/routes\/home'\)\)/);
  const watch = src.indexOf("app.use('/api', homeCacheWatch)");
  assert.ok(watch > 0, 'the watcher is mounted');
  assert.ok(watch < src.indexOf("app.use('/api/auth'"), 'before the first core route');
  assert.ok(watch < src.indexOf("app.use('/api/drafts'"), 'before the drafts routes');
  assert.ok(watch < src.indexOf("app.use('/api/week'"), 'before the week routes');
});

test('no route file in this change reads a request id or has no limiter', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'home.js'), 'utf8');
  assert.ok(!/req\.(params|body|query)\.(userId|id)\b/.test(src));
  assert.match(src, /const readLimiter =/);
});
