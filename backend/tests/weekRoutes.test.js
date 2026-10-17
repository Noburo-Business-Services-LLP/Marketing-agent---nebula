const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const router = require('../routes/week');
const { createWeekRouter, createSetupRouter } = router;
const planRouter = require('../routes/plan');
const { protect } = require('../middleware/auth');
const { isBlockedWhileActing } = require('../services/csmAccess');
const { isBlockedInsideClient } = require('../services/agencyWorkspaces');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const find = (r, method, p) => routesOf(r).find((x) => x.method === method && x.path === p);
const handlerFor = (r, method, p) => { const f = find(r, method, p); return f.handlers[f.handlers.length - 1]; };
const tick = () => new Promise((r) => setImmediate(r));

const paying = (extra = {}) => ({
  _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' },
  businessProfile: { name: 'Acme', website: 'https://acme.example', description: 'Hand poured soy candles', targetCustomerProfile: 'Young homeowners in Pune' }, ...extra
});
const item = (status, extra = {}) => ({ id: '2026-10-12:0', kind: 'post', status, topic: 't', ...extra });
const proposal = (status, items = [item('proposed')], extra = {}) => ({ weekStart: '2026-10-12', status, items, counts: {}, ...extra });

function fakeWeek(over = {}) {
  const calls = { get: 0, approve: [], run: [], change: [], skip: [] };
  const svc = {
    calls,
    getOrCreate: async () => { calls.get += 1; return { proposal: proposal('proposed'), eligible: true, reason: '' }; },
    approve: async (a) => { calls.approve.push(a); return { proposal: proposal('approved', [item('approved')]), started: 1, prefills: [] }; },
    runApprovedPosts: async (a) => { calls.run.push(a); return { made: 1 }; },
    change: async (a) => { calls.change.push(a); return { ok: true, proposal: proposal('proposed') }; },
    skipWeek: async (a) => { calls.skip.push(a); return { ok: true, proposal: proposal('skipped') }; },
    ...over
  };
  return svc;
}
const open = async () => [];
const mk = (over = {}) => createWeekRouter({ week: fakeWeek(), gate: async () => [], ...over });
const call = async (r, method, p, req) => { const res = mkRes(); await handlerFor(r, method, p)({ body: {}, params: {}, ...req }, res); return res; };

test('GET /api/week returns the proposal for an eligible account and an explanation otherwise', async () => {
  const week = fakeWeek();
  let res = await call(mk({ week }), 'get', '/', { user: paying() });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.eligible, true);
  assert.strictEqual(res.body.reason, '');
  assert.strictEqual(res.body.proposal.status, 'proposed');
  assert.strictEqual(res.body.topUp, false);
  assert.strictEqual(week.calls.run.length, 0, 'nothing approved: no background run');

  res = await call(mk({ week: fakeWeek({ getOrCreate: async () => ({ proposal: null, eligible: false, reason: 'no_plan' }) }) }), 'get', '/', { user: paying() });
  assert.deepStrictEqual([res.code, res.body.eligible, res.body.reason, res.body.proposal, res.body.topUp], [200, false, 'no_plan', null, false]);

  const empty = proposal('proposed', [], { empty: true });
  res = await call(mk({ week: fakeWeek({ getOrCreate: async () => ({ proposal: empty, eligible: true, reason: 'empty' }) }) }), 'get', '/', { user: paying() });
  assert.strictEqual(res.body.topUp, true);
  assert.strictEqual(res.body.reason, 'empty');
});

test('GET /api/week runs approved posts in the background only when some are approved or making, and never waits', async () => {
  for (const st of ['approved', 'making']) {
    const week = fakeWeek({
      getOrCreate: async () => ({ proposal: proposal('approved', [item(st)]), eligible: true, reason: '' }),
      runApprovedPosts: async (a) => { week.calls.run.push(a); return new Promise(() => {}); }
    });
    const res = await call(mk({ week }), 'get', '/', { user: paying() });
    assert.strictEqual(res.code, 200);
    assert.strictEqual(week.calls.run.length, 1);
    assert.strictEqual(week.calls.run[0].user._id, 'u1');
  }
  // a failing background run is logged, never thrown
  const week = fakeWeek({ getOrCreate: async () => ({ proposal: proposal('approved', [item('approved')]), eligible: true, reason: '' }), runApprovedPosts: async () => { throw new Error('boom secret'); } });
  const res = await quiet(async () => { const r = await call(mk({ week }), 'get', '/', { user: paying() }); await tick(); return r; });
  assert.strictEqual(res.code, 200);
  // a gated account gets no background run
  const gated = fakeWeek({ getOrCreate: async () => ({ proposal: proposal('approved', [item('approved')]), eligible: true, reason: '' }) });
  await call(mk({ week: gated, gate: async () => ['u1'] }), 'get', '/', { user: paying() });
  assert.strictEqual(gated.calls.run.length, 0);
});

test('POST /api/week/approve returns the prefills for carousels and videos at once, without waiting for the background run', async () => {
  const prefills = [
    { itemId: 'a', target: 'carousel', route: '/campaigns', prefill: { mode: 'carousel', topic: 'x', platform: 'instagram', language: 'English' } },
    { itemId: 'b', target: 'video', route: '/reels', prefill: { idea: 'y', language: 'English' } }
  ];
  const week = fakeWeek({
    approve: async (a) => { week.calls.approve.push(a); return { proposal: proposal('approved', [item('approved')]), started: 1, prefills }; },
    runApprovedPosts: async (a) => { week.calls.run.push(a); return new Promise(() => {}); } // never resolves
  });
  const res = await call(mk({ week }), 'post', '/approve', { user: paying(), body: { itemIds: ['a', 'b'] } });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.deepStrictEqual(res.body.prefills, prefills);
  assert.strictEqual(res.body.proposal.status, 'approved');
  assert.deepStrictEqual(week.calls.approve[0].itemIds, ['a', 'b']);
  assert.strictEqual(week.calls.run.length, 1);
  // itemIds omitted means every item; junk is not passed on
  await call(mk({ week }), 'post', '/approve', { user: paying(), body: { itemIds: 'nope' } });
  assert.strictEqual(week.calls.approve[1].itemIds, undefined);
});

test('approve refuses an ineligible, paused, frozen or deleting account with 403 and calls neither approve nor run', async () => {
  const cases = [
    ['ineligible', paying({ plan: { tier: 'free' } }), []],
    ['paused or frozen or deleting', paying(), ['u1']]
  ];
  for (const [name, user, blocked] of cases) {
    const week = fakeWeek();
    const res = await call(mk({ week, gate: async () => blocked }), 'post', '/approve', { user, body: {} });
    assert.strictEqual(res.code, 403, name);
    assert.strictEqual(res.body.success, false);
    assert.ok(typeof res.body.message === 'string' && res.body.message.length > 5);
    assert.strictEqual(week.calls.approve.length, 0, name);
    assert.strictEqual(week.calls.run.length, 0, name);
  }
  // an ObjectId-like id still matches the blocked list
  const week = fakeWeek();
  const res = await call(mk({ week, gate: async () => [{ toString: () => 'u1' }] }), 'post', '/approve', { user: paying(), body: {} });
  assert.strictEqual(res.code, 403);
});

test('item change and skip week pass through, validate input and map refusals', async () => {
  const week = fakeWeek();
  const r = mk({ week });
  let res = await call(r, 'post', '/items/:id', { user: paying(), params: { id: 'i1' }, body: { action: 'swap', topic: ' New topic ' } });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.proposal.status, 'proposed');
  assert.deepStrictEqual([week.calls.change[0].itemId, week.calls.change[0].action, week.calls.change[0].topic], ['i1', 'swap', 'New topic']);
  res = await call(r, 'post', '/items/:id', { user: paying(), params: { id: 'i1' }, body: { action: 'delete' } });
  assert.strictEqual(res.code, 400);
  assert.strictEqual(week.calls.change.length, 1);
  res = await call(mk({ week: fakeWeek({ change: async () => ({ ok: false }) }) }), 'post', '/items/:id', { user: paying(), params: { id: 'i1' }, body: { action: 'skip' } });
  assert.strictEqual(res.code, 409);
  res = await call(mk({ week: fakeWeek({ change: async () => ({ ok: false, error: 'topic_required' }) }) }), 'post', '/items/:id', { user: paying(), params: { id: 'i1' }, body: { action: 'swap' } });
  assert.strictEqual(res.code, 400);
  res = await call(r, 'post', '/skip', { user: paying() });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.proposal.status, 'skipped');
  assert.strictEqual(week.calls.skip.length, 1);
  res = await call(mk({ week: fakeWeek({ skipWeek: async () => ({ ok: false, proposal: null }) }) }), 'post', '/skip', { user: paying() });
  assert.strictEqual(res.code, 409);
});

test('writes are refused for staff accounts and limited per account', async () => {
  for (const staff of [{ _id: 's1', staffRole: 'admin' }, { _id: 's2', isCsm: true }]) {
    for (const [p, req] of [['/approve', {}], ['/items/:id', { params: { id: 'x' }, body: { action: 'skip' } }], ['/skip', {}]]) {
      const week = fakeWeek();
      const res = await call(mk({ week }), 'post', p, { user: staff, ...req });
      assert.strictEqual(res.code, 403, p);
      assert.strictEqual(week.calls.approve.length + week.calls.change.length + week.calls.skip.length + week.calls.run.length, 0);
    }
  }
  const src = fs.readFileSync(path.join(__dirname, '../routes/week.js'), 'utf8');
  assert.match(src, /makeLimiter\(30,/);
  for (const m of ['post /approve', 'post /items/:id', 'post /skip']) {
    const f = find(createWeekRouter({}), ...m.split(' '));
    assert.strictEqual(f.handlers[0], protect, m);
    assert.strictEqual(f.handlers.length, 3, `${m}: protect, limiter, handler`);
    assert.notStrictEqual(f.handlers[1], f.handlers[2]);
  }
  // a real limiter answers 429 on the 31st request by the same account
  const f = find(createWeekRouter({}), 'post', '/skip');
  const limiter = f.handlers[1];
  let last;
  for (let i = 0; i < 31; i++) {
    last = mkRes();
    last.setHeader = () => {}; last.getHeader = () => undefined; last.set = () => last; last.send = (b) => { last.body = b; return last; }; last.end = () => last; last.headersSent = false;
    let nexted = false;
    const req = { user: { _id: 'rl1' }, ip: '1.2.3.4', app: { get: () => false }, headers: {} };
    await limiter(req, last, () => { nexted = true; });
    if (i < 30) assert.ok(nexted, `request ${i + 1} passes`);
  }
  assert.strictEqual(last.code, 429);
});

test('the switch: off answers GET with eligible false and refuses writes; unset or anything else is on', async () => {
  const keep = process.env.ENABLE_WEEKLY_PROPOSAL;
  try {
    process.env.ENABLE_WEEKLY_PROPOSAL = 'off';
    const week = fakeWeek();
    let res = await call(mk({ week }), 'get', '/', { user: paying() });
    assert.deepStrictEqual(res.body, { success: true, eligible: false, reason: 'off', proposal: null });
    assert.strictEqual(week.calls.get, 0);
    for (const [p, req] of [['/approve', {}], ['/items/:id', { params: { id: 'x' }, body: { action: 'skip' } }], ['/skip', {}]]) {
      res = await call(mk({ week }), 'post', p, { user: paying(), ...req });
      assert.strictEqual(res.code, 403, p);
    }
    assert.strictEqual(week.calls.approve.length + week.calls.change.length + week.calls.skip.length + week.calls.run.length, 0);
    for (const v of [undefined, 'on', 'OFF2', '']) {
      if (v === undefined) delete process.env.ENABLE_WEEKLY_PROPOSAL; else process.env.ENABLE_WEEKLY_PROPOSAL = v;
      res = await call(mk({ week: fakeWeek() }), 'get', '/', { user: paying() });
      assert.strictEqual(res.body.eligible, true, String(v));
    }
  } finally { if (keep === undefined) delete process.env.ENABLE_WEEKLY_PROPOSAL; else process.env.ENABLE_WEEKLY_PROPOSAL = keep; }
});

test('a request with no user id is 401 and an error is a generic 500 with no text', async () => {
  for (const [m, p] of [['get', '/'], ['post', '/approve'], ['post', '/items/:id'], ['post', '/skip']]) {
    const res = await call(mk(), m, p, { user: {} });
    assert.strictEqual(res.code, 401, `${m} ${p}`);
  }
  const boom = async () => { throw new Error('mongo://secret-host exploded'); };
  const week = fakeWeek({ getOrCreate: boom, approve: boom, change: boom, skipWeek: boom });
  for (const [m, p, req] of [['get', '/', {}], ['post', '/approve', {}], ['post', '/items/:id', { params: { id: 'x' }, body: { action: 'skip' } }], ['post', '/skip', {}]]) {
    const res = await quiet(() => call(mk({ week }), m, p, { user: paying(), ...req }));
    assert.strictEqual(res.code, 500, p);
    assert.ok(!JSON.stringify(res.body).includes('secret'));
  }
});

test('GET /api/setup returns ordered steps with one next step', async () => {
  const seen = {};
  const user = paying({ connectedSocials: [{ platform: 'instagram' }], ayrshare: { activeSocialAccounts: ['instagram', 'facebook', 'x'] }, setup: { planOpenedAt: new Date() } });
  const setup = createSetupRouter({ plan: { currentPlan: async (id) => { seen.id = id; return { id: 'bp' }; } } });
  const res = mkRes();
  await handlerFor(setup, 'get', '/')({ user }, res);
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.body.steps.map((s) => s.id), ['profile', 'socials', 'plan', 'week']);
  assert.deepStrictEqual(res.body.steps.map((s) => s.done), [true, true, true, false]);
  assert.strictEqual(res.body.next, 'week');
  assert.strictEqual(res.body.allDone, false);
  assert.strictEqual(seen.id, 'u1');
  // free account, nothing connected, no plan
  const free = mkRes();
  await handlerFor(createSetupRouter({ plan: { currentPlan: async () => null } }), 'get', '/')({ user: { _id: 'u2', plan: { tier: 'free' } } }, free);
  assert.deepStrictEqual(free.body.steps.map((s) => s.id), ['profile', 'socials', 'choose']);
  assert.strictEqual(free.body.next, 'profile');
  // all done
  const done = mkRes();
  await handlerFor(createSetupRouter({ plan: { currentPlan: async () => ({ id: 'bp' }) } }), 'get', '/')({ user: paying({ connectedSocials: [{}], setup: { planOpenedAt: new Date(), firstWeekApprovedAt: new Date() } }) }, done);
  assert.strictEqual(done.body.allDone, true);
  assert.strictEqual(done.body.next, null);
  // protect first, 401 and 500 are plain
  assert.strictEqual(find(setup, 'get', '/').handlers[0], protect);
  const none = mkRes();
  await handlerFor(setup, 'get', '/')({ user: {} }, none);
  assert.strictEqual(none.code, 401);
  const err = mkRes();
  await quiet(() => handlerFor(createSetupRouter({ plan: { currentPlan: async () => { throw new Error('secret'); } } }), 'get', '/')({ user: paying() }, err));
  assert.strictEqual(err.code, 500);
  assert.ok(!JSON.stringify(err.body).includes('secret'));
});

test('opening the plan stamps planOpenedAt once and never again', async () => {
  const stamps = [];
  const stampPlanOpened = async (id) => { stamps.push(id); };
  const planSvc = (plan) => ({ currentPlan: async () => plan, inFlight: async () => false });
  const get = async (impl, req) => { const res = mkRes(); await handlerFor(planRouter.createPlanRouter({ now: () => new Date('2026-10-17T10:00:00Z'), stampPlanOpened, ...impl }), 'get', '/')(req, res); await tick(); return res; };
  const plan = { id: 'bp', completedAt: new Date('2026-10-10T00:00:00Z'), result: {} };
  await get({ service: planSvc(plan) }, { user: paying() });
  assert.deepStrictEqual(stamps, ['u1']);
  // a stale plan still counts as opened
  await get({ service: planSvc({ ...plan, completedAt: new Date('2026-01-01T00:00:00Z') }) }, { user: paying() });
  assert.strictEqual(stamps.length, 2);
  // no plan, a CSM pass, an agency pass, staff: no stamp
  const before = stamps.length;
  await get({ service: planSvc(null) }, { user: paying() });
  await get({ service: planSvc(plan) }, { user: paying(), actingCsm: { _id: 'c' } });
  await get({ service: planSvc(plan) }, { user: paying(), actingAgency: { _id: 'a' } });
  await get({ service: planSvc(plan) }, { user: { ...paying(), staffRole: 'admin' } });
  assert.strictEqual(stamps.length, before);
  // a failing stamp never breaks the page
  const res = await quiet(() => get({ service: planSvc(plan), stampPlanOpened: async () => { throw new Error('db'); } }, { user: paying() }));
  assert.strictEqual(res.code, 200);
  // the default stamp is a conditional update, so it happens once
  const src = fs.readFileSync(path.join(__dirname, '../routes/plan.js'), 'utf8');
  assert.match(src, /'setup\.planOpenedAt': \{ \$exists: false \}/);
});

test('the default stamp only sets planOpenedAt where it is missing', async () => {
  const seen = [];
  const Model = { updateOne: async (...a) => { seen.push(a); } };
  await planRouter.defaultStampPlanOpened('u1', Model, new Date('2026-10-17T00:00:00Z'));
  assert.deepStrictEqual(seen[0][0], { _id: 'u1', 'setup.planOpenedAt': { $exists: false } });
  assert.deepStrictEqual(seen[0][1], { $set: { 'setup.planOpenedAt': new Date('2026-10-17T00:00:00Z') } });
});

test('a request inside an agency or CSM pass works on the client account and is mounted', async () => {
  for (const [m, u] of [['GET', '/api/week'], ['POST', '/api/week/approve'], ['POST', '/api/week/items/abc'], ['POST', '/api/week/skip'], ['GET', '/api/setup']]) {
    assert.strictEqual(isBlockedWhileActing(u, m), false, `csm ${m} ${u}`);
    assert.strictEqual(isBlockedInsideClient(u, m), false, `agency ${m} ${u}`);
  }
  // inside a pass req.user is the client, so the run and the gate use the client
  const week = fakeWeek();
  const res = await call(mk({ week }), 'post', '/approve', { user: paying({ _id: 'client1' }), actingCsm: { _id: 'csm1', isCsm: true } });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(week.calls.approve[0].user._id, 'client1');
  assert.strictEqual(week.calls.run[0].user._id, 'client1');
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  assert.match(src, /app\.use\('\/api\/week', require\('\.\/routes\/week'\)\)/);
  assert.match(src, /app\.use\('\/api\/setup', require\('\.\/routes\/week'\)\.setupRouter\)/);
});

test('the public user JSON carries setup dates for the frontend', () => {
  const User = require('../models/User');
  const d = new Date('2026-10-17T00:00:00Z');
  const u = new User({ email: 'a@b.co', setup: { planOpenedAt: d } });
  const j = u.toPublicJSON();
  assert.deepStrictEqual(j.setup, { planOpenedAt: d, firstWeekApprovedAt: undefined });
  assert.deepStrictEqual(new User({ email: 'a@b.co' }).toPublicJSON().setup, { planOpenedAt: undefined, firstWeekApprovedAt: undefined });
});
