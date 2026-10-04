const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const router = require('../routes/blueprint');
const { createBlueprintRouter } = router;
const { protect } = require('../middleware/auth');
const { checkTrial } = require('../middleware/trialGuard');
const { requireFeature } = require('../middleware/requireFeature');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const handlerFor = (impl, method, p) => {
  const r = routesOf(createBlueprintRouter(impl)).find((x) => x.method === method && x.path === p);
  return r.handlers[r.handlers.length - 1];
};

test('the four routes exist and protect is first on every one', () => {
  const found = routesOf(router);
  assert.deepStrictEqual(found.map((r) => `${r.method} ${r.path}`).sort(), ['get /', 'get /:id', 'post /', 'post /:id/continue']);
  for (const r of found) assert.strictEqual(r.handlers[0], protect, `${r.method} ${r.path}`);
});

test('POST / chain: protect, feature gate, checkTrial, credits guard, limiter, handler', () => {
  const post = routesOf(router).find((r) => r.method === 'post' && r.path === '/');
  assert.strictEqual(post.handlers.length, 6);
  assert.strictEqual(post.handlers[0], protect);
  assert.strictEqual(post.handlers[2], checkTrial);
  assert.strictEqual(typeof post.handlers[1], 'function');
  assert.strictEqual(typeof post.handlers[3], 'function');
  assert.ok(post.handlers[1] !== post.handlers[3]);
});

test('the route uses the Blueprint feature gate and the Blueprint price from the cost table', async () => {
  const { QUARK_COSTS } = require('../config/apiCosts');
  assert.ok(QUARK_COSTS.blueprint > 0);
  const src = fs.readFileSync(path.join(__dirname, '../routes/blueprint.js'), 'utf8');
  assert.match(src, /requireCredits\('blueprint', 1\)/);
  assert.match(src, /requireFeature\('blueprint'\)/);
});

test('handlers return the service status and body, with user, tier and ip read on the server', async () => {
  const seen = {};
  const service = {
    start: async (a) => { seen.start = a; return { status: 202, json: { success: true, id: 'x', status: 'queued' } }; },
    get: async (a) => { seen.get = a; return { status: 200, json: { success: true, id: a.id } }; },
    list: async (a) => { seen.list = a; return { status: 200, json: { success: true, blueprints: [] } }; },
    continueRun: async (a) => { seen.cont = a; return { status: 409, json: { success: false, message: 'no' } }; }
  };
  const user = { _id: 'u1', email: 'a@b.com', isVerified: true, plan: { tier: 'starter' } };
  let res = mkRes();
  await handlerFor({ service }, 'post', '/')({ user, ip: '2.2.2.2', body: { businessName: 'X', tier: 'managed', userId: 'evil', cost: 0 } }, res);
  assert.strictEqual(res.code, 202);
  assert.strictEqual(seen.start.tier, 'starter');
  assert.strictEqual(seen.start.ip, '2.2.2.2');
  assert.strictEqual(seen.start.user, user);
  res = mkRes();
  await handlerFor({ service }, 'get', '/:id')({ user, params: { id: 'abc' } }, res);
  assert.deepStrictEqual(seen.get, { userId: 'u1', id: 'abc' });
  res = mkRes();
  await handlerFor({ service }, 'get', '/')({ user }, res);
  assert.deepStrictEqual(seen.list, { userId: 'u1' });
  res = mkRes();
  await handlerFor({ service }, 'post', '/:id/continue')({ user, params: { id: 'abc' }, body: { directionId: 2 } }, res);
  assert.strictEqual(res.code, 409);
  assert.deepStrictEqual(seen.cont, { userId: 'u1', id: 'abc', body: { directionId: 2 } });
});

test('a request with no user id is 401 on every route', async () => {
  const service = { start: async () => { throw new Error('should not run'); } };
  for (const [m, p] of [['post', '/'], ['get', '/'], ['get', '/:id'], ['post', '/:id/continue']]) {
    const res = mkRes();
    await handlerFor({ service }, m, p)({ user: {}, params: {}, body: {} }, res);
    assert.strictEqual(res.code, 401, `${m} ${p}`);
  }
});

test('a thrown service error is a generic 500 with no stack or message text', async () => {
  const service = { get: async () => { throw new Error('mongo secret detail at /srv/app.js:12'); } };
  const res = mkRes();
  await quiet(() => handlerFor({ service }, 'get', '/:id')({ user: { _id: 'u1' }, params: { id: 'a' } }, res));
  assert.strictEqual(res.code, 500);
  assert.deepStrictEqual(res.body, { success: false, message: 'We could not complete that request. Please try again.' });
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('server-main.js requires and mounts the Blueprint routes, and tracks the start event', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  assert.ok(src.includes("const blueprintRoutes = require('./routes/blueprint');"));
  assert.ok(src.includes("app.use('/api/blueprint', blueprintRoutes);"));
  assert.match(src, /feature: 'blueprint_started', {1,}module: 'blueprint'/);
});

test('tier rules: a free account passes the blueprint gate and is refused outside services', async () => {
  const free = { plan: { tier: 'free' } };
  const run = async (feature) => {
    const res = mkRes();
    let nexted = false;
    await requireFeature(feature, { loadUser: async () => free })({ user: { id: 'u1' } }, res, () => { nexted = true; });
    return { res, nexted };
  };
  assert.strictEqual((await run('blueprint')).nexted, true);
  const publish = await run('publish');
  assert.strictEqual(publish.nexted, false);
  assert.strictEqual(publish.res.code, 403);
  assert.strictEqual(publish.res.body.upgradeRequired, true);
});

test('Blueprint routes and services import no outside-service module', () => {
  const banned = ['socialMediaAPI', 'campaignPublisher', 'ayrshareGuard', 'scraper', 'serperLookup', 'zohoBooks', 'emailService'];
  const dir = path.join(__dirname, '../services/blueprint');
  const files = [path.join(__dirname, '../routes/blueprint.js'), ...fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f))];
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const b of banned) assert.ok(!new RegExp(`require\\([^)]*${b}`).test(src), `${path.basename(f)} requires ${b}`);
  }
});

test('the service and runner use no timers', () => {
  for (const f of ['service.js', 'runner.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../services/blueprint', f), 'utf8');
    assert.ok(!/setTimeout|setInterval/.test(src), f);
  }
});
