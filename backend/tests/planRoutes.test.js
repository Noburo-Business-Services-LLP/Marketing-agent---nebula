const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const router = require('../routes/plan');
const { createPlanRouter } = router;
const { protect } = require('../middleware/auth');
const { createPlanService } = require('../services/plan/planService');
const { can } = require('../services/staff/permissions');
const { isBlockedWhileActing } = require('../services/csmAccess');
const { isBlockedInsideClient } = require('../services/agencyWorkspaces');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const handlerFor = (impl, method, p) => {
  const r = routesOf(createPlanRouter(impl)).find((x) => x.method === method && x.path === p);
  return r.handlers[r.handlers.length - 1];
};

const NOW = new Date('2026-10-17T10:00:00Z');
const DAY = 86400000;
const paying = (extra = {}) => ({
  _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' },
  businessProfile: { name: 'Acme Candles', website: 'https://acme.example', description: 'Hand poured soy candles', targetCustomerProfile: 'Young homeowners in Pune' },
  ...extra
});
const fakeService = (over = {}) => ({
  currentPlan: async () => null, inFlight: async () => false, refresh: async () => ({ ok: true }), ...over
});
const get = async (impl, user) => { const res = mkRes(); await handlerFor({ now: () => NOW, ...impl }, 'get', '/')({ user }, res); return res; };

test('GET /api/plan for a paying account with a plan returns it with the date and no staleness', async () => {
  const completedAt = new Date(NOW.getTime() - 3 * DAY);
  const service = fakeService({ currentPlan: async () => ({ id: 'bp1', completedAt, result: { icp: { summary: 's' } } }) });
  const res = await get({ service }, paying());
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.plan.id, 'bp1');
  assert.strictEqual(res.body.plan.completedAt, completedAt);
  assert.strictEqual(res.body.plan.stale, false);
  assert.deepStrictEqual(res.body.plan.result, { icp: { summary: 's' } });
  assert.strictEqual(res.body.running, false);
  assert.strictEqual(res.body.failed, false);
  assert.strictEqual(res.body.eligible, true);
  assert.strictEqual(res.body.reason, '');
  assert.strictEqual(res.body.nextRefreshAt, null);
  assert.deepStrictEqual(res.body.missing, []);
  assert.strictEqual(res.body.freeBlueprint, null);
});

test('GET /api/plan shows the next refresh date after a refresh, and the running and failed flags', async () => {
  const last = new Date(NOW.getTime() - 2 * DAY);
  let res = await get({ service: fakeService({ inFlight: async () => true, currentPlan: async () => ({ id: 'p', completedAt: last, result: {} }) }) }, paying({ planState: { lastRefreshAt: last } }));
  assert.strictEqual(res.body.running, true);
  assert.strictEqual(res.body.nextRefreshAt, new Date(last.getTime() + 7 * DAY).toISOString());
  res = await get({ service: fakeService() }, paying({ planState: { firstPlanFailedAt: new Date(NOW.getTime() - DAY) } }));
  assert.strictEqual(res.body.failed, true);
  assert.strictEqual(res.body.plan, null);
  res = await get({ service: fakeService({ inFlight: async () => true }) }, paying({ planState: { firstPlanFailedAt: new Date(NOW.getTime() - DAY) } }));
  assert.strictEqual(res.body.failed, false, 'a run in progress is not a failure');
});

test('a plan older than 45 days is returned with stale true', async () => {
  const service = fakeService({ currentPlan: async () => ({ id: 'old', completedAt: new Date(NOW.getTime() - 46 * DAY), result: {} }) });
  const res = await get({ service }, paying());
  assert.strictEqual(res.body.plan.stale, true);
  const fresh = fakeService({ currentPlan: async () => ({ id: 'ok', completedAt: new Date(NOW.getTime() - 44 * DAY), result: {} }) });
  assert.strictEqual((await get({ service: fresh }, paying())).body.plan.stale, false);
});

test('GET /api/plan for a free account explains and points to the free Blueprint', async () => {
  const asked = [];
  const findFreeBlueprint = async (id) => { asked.push(id); return { blueprintId: 'free-bp' }; };
  const res = await get({ service: fakeService(), findFreeBlueprint }, paying({ plan: { tier: 'free' } }));
  assert.strictEqual(res.body.eligible, false);
  assert.strictEqual(res.body.reason, 'free');
  assert.deepStrictEqual(res.body.freeBlueprint, { id: 'free-bp' });
  assert.deepStrictEqual(asked, ['u1']);
  const none = await get({ service: fakeService(), findFreeBlueprint: async () => null }, paying({ plan: { tier: 'free' } }));
  assert.strictEqual(none.body.freeBlueprint, null);
  assert.strictEqual(none.body.reason, 'free');
});

test('GET /api/plan for an incomplete profile lists what is missing in plain words', async () => {
  const res = await get({ service: fakeService() }, paying({ businessProfile: { name: 'Acme Candles' } }));
  assert.strictEqual(res.body.eligible, false);
  assert.strictEqual(res.body.reason, 'profile_incomplete');
  assert.deepStrictEqual(res.body.missing, ['website or Instagram page', 'what you sell', 'who it is for']);
  assert.strictEqual(res.body.freeBlueprint, null);
});

test('an account that cannot have a plan for another reason is not eligible', async () => {
  const res = await get({ service: fakeService() }, paying({ onboardingCompleted: false }));
  assert.strictEqual(res.body.eligible, false);
  assert.strictEqual(res.body.reason, 'not_eligible');
});

// A real plan service with fake storage, so the weekly rule is the real one.
const HAS_PLAN = [{ userId: 'u1', kind: 'plan', status: 'completed', blueprintId: 'old', completedAt: new Date('2026-10-01T00:00:00Z'), result: { plan: {} } }];
function realService(user, docs = HAS_PLAN) {
  const state = { started: 0 };
  const svc = createPlanService({
    loadUser: async () => user,
    findRuns: async (q) => docs.filter((d) => !q.status || [].concat(q.status.$in || q.status).includes(d.status)),
    startSystem: async () => { state.started += 1; return { ok: true, id: 'run1' }; },
    saveState: async (id, patch) => { user.planState = { ...(user.planState || {}), ...patch }; },
    now: () => NOW
  });
  return { svc, state };
}

test('POST /api/plan/refresh: first time ok, second time 429 with the once-a-week message', async () => {
  const user = paying();
  const { svc, state } = realService(user);
  let res = mkRes();
  await handlerFor({ service: svc, now: () => NOW }, 'post', '/refresh')({ user, body: { userId: 'evil', staff: true } }, res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.nextRefreshAt, new Date(NOW.getTime() + 7 * DAY).toISOString());
  assert.strictEqual(state.started, 1);
  res = mkRes();
  await handlerFor({ service: svc, now: () => NOW }, 'post', '/refresh')({ user, body: {} }, res);
  assert.strictEqual(res.code, 429);
  assert.match(res.body.message, /once a week/);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(state.started, 1);
});

test('POST /api/plan/refresh for an account that cannot have a plan is 400', async () => {
  const user = paying({ plan: { tier: 'free' } });
  const { svc, state } = realService(user);
  const res = mkRes();
  await handlerFor({ service: svc }, 'post', '/refresh')({ user }, res);
  assert.strictEqual(res.code, 400);
  assert.strictEqual(state.started, 0);
});

test('a refresh that could not start is a plain 503, and a refresh already running says so', async () => {
  let res = mkRes();
  await handlerFor({ service: fakeService({ refresh: async () => ({ ok: false, reason: 'not_started', message: 'provider secret detail' }) }) }, 'post', '/refresh')({ user: paying() }, res);
  assert.strictEqual(res.code, 503);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
  res = mkRes();
  await handlerFor({ service: fakeService({ refresh: async () => ({ ok: true, alreadyRunning: true }) }) }, 'post', '/refresh')({ user: paying() }, res);
  assert.strictEqual(res.code, 200);
  assert.match(res.body.message, /already/);
});

test('routes exist, protect is first, refresh is rate limited, and the user id comes from the account', () => {
  const found = routesOf(router);
  assert.deepStrictEqual(found.map((r) => `${r.method} ${r.path}`).sort(), ['get /', 'post /refresh']);
  for (const r of found) assert.strictEqual(r.handlers[0], protect, `${r.method} ${r.path}`);
  const refresh = found.find((r) => r.path === '/refresh');
  assert.strictEqual(refresh.handlers.length, 3); // protect, limiter, handler
  const src = fs.readFileSync(path.join(__dirname, '../routes/plan.js'), 'utf8');
  assert.match(src, /makeLimiter\(5,/);
  assert.ok(!/req\.(body|query|params)/.test(src), 'nothing from the request body or query is read');
});

test('a request with no user id is 401, and a thrown error is a generic 500 with no text', async () => {
  for (const [m, p] of [['get', '/'], ['post', '/refresh']]) {
    const res = mkRes();
    await handlerFor({ service: fakeService() }, m, p)({ user: {} }, res);
    assert.strictEqual(res.code, 401, `${m} ${p}`);
  }
  const boom = fakeService({ currentPlan: async () => { throw new Error('mongo://secret-host exploded'); }, refresh: async () => { throw new Error('mongo://secret-host exploded'); } });
  for (const [m, p] of [['get', '/'], ['post', '/refresh']]) {
    const res = mkRes();
    await quiet(() => handlerFor({ service: boom }, m, p)({ user: paying() }, res));
    assert.strictEqual(res.code, 500);
    assert.ok(!JSON.stringify(res.body).includes('secret'));
  }
});

test('the old ICP endpoints answer 410 and never call the old generator', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/campaigns.js'), 'utf8');
  assert.ok(!/generateICPAndStrategy/.test(src));
  const campaigns = require('../routes/campaigns');
  const found = routesOf(campaigns).filter((r) => r.path === '/icp-strategy');
  assert.deepStrictEqual(found.map((r) => r.method).sort(), ['get', 'put']);
  for (const r of found) {
    assert.strictEqual(r.handlers[0], protect);
    const res = mkRes();
    await r.handlers[r.handlers.length - 1]({ user: { _id: 'u1' }, query: { regenerate: 'true' }, body: { icp: {} } }, res);
    assert.strictEqual(res.code, 410);
    assert.deepStrictEqual(res.body, { success: false, message: 'Your customer profile now lives in My plan.' });
  }
  assert.strictEqual(typeof require('../services/geminiAI').generateICPAndStrategy, 'undefined');
});

test('staff refresh ignores the weekly limit and is logged', async () => {
  const client = paying({ _id: 'c1', planState: { lastRefreshAt: new Date(NOW.getTime() - DAY) } });
  const seen = {}; const logged = [];
  const service = fakeService({ refresh: async (a) => { seen.args = a; return { ok: true }; } });
  const staff = { _id: 's1', staffRole: 'admin' };
  const out = await router.staffRefresh({ client, staff, service, record: async (r) => logged.push(r) });
  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(seen.args, { userId: 'c1', staff: true });
  assert.deepStrictEqual(logged, [{ actor: staff, action: 'refresh_plan', client: 'c1' }]);
  // through the real rule: a refresh a day ago is refused for the customer and allowed for staff
  const { svc, state } = realService(client, [{ ...HAS_PLAN[0], userId: 'c1' }]);
  const own = await svc.refresh({ userId: 'c1', user: client, staff: false });
  assert.strictEqual(own.reason, 'too_soon');
  const byStaff = await router.staffRefresh({ client, staff, service: svc, record: async () => {} });
  assert.strictEqual(byStaff.status, 200);
  assert.strictEqual(state.started, 1);
});

test('staff view: the customer body plus the last run', async () => {
  const client = paying({ _id: 'c1' });
  const lastRun = async (id) => (id === 'c1' ? { status: 'failed', createdAt: new Date('2026-10-10T00:00:00Z') } : null);
  const out = await router.staffView({ client, service: fakeService(), lastRun, now: NOW });
  assert.strictEqual(out.eligible, true);
  assert.strictEqual(out.lastStatus, 'failed');
  assert.deepStrictEqual(out.lastRunAt, new Date('2026-10-10T00:00:00Z'));
  const none = await router.staffView({ client, service: fakeService(), lastRun: async () => null, now: NOW });
  assert.strictEqual(none.lastRunAt, null);
  assert.strictEqual(none.lastStatus, null);
});

test('a CSM without access to the client is refused; the staff routes use the client-access check and the log', () => {
  const client = { _id: 'c1', assignedCsm: 'csmA' };
  assert.strictEqual(can({ _id: 'csmB', isCsm: true }, 'open_client', client), false);
  assert.strictEqual(can({ _id: 'csmB', isCsm: true }, 'view_clients', client), false);
  assert.strictEqual(can({ _id: 'csmA', isCsm: true }, 'open_client', client), true);
  const src = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
  const view = src.match(/router\.get\('\/clients\/:id\/plan'[\s\S]*?\n\}\);/)[0];
  const refresh = src.match(/router\.post\('\/clients\/:id\/plan\/refresh'[\s\S]*?\n\}\);/)[0];
  assert.match(view, /requireStaff\('view_clients'\)/);
  assert.match(view, /clientFor\(req, res\)/);
  assert.match(refresh, /requireStaff\('open_client'\)/);
  assert.match(refresh, /clientFor\(req, res, 'open_client'\)/);
  assert.match(refresh, /record: recordStaffAction/);
});

test('the plan routes work inside a CSM pass and an agency pass, and are mounted in the server', () => {
  for (const [m, u] of [['GET', '/api/plan'], ['POST', '/api/plan/refresh']]) {
    assert.strictEqual(isBlockedWhileActing(u, m), false, `csm ${m} ${u}`);
    assert.strictEqual(isBlockedInsideClient(u, m), false, `agency ${m} ${u}`);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8'), /app\.use\('\/api\/plan', require\('\.\/routes\/plan'\)\)/);
});
