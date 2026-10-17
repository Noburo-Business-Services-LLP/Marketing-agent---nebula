const test = require('node:test');
const assert = require('node:assert');
const sch = require('../services/plan/planScheduler');
const { selectForBackfill, waitForRun } = require('../services/plan/backfill');

const MIN = 60000; const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const user = (id, extra = {}) => ({ _id: id, isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'a.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });
const mdeps = (rows, over = {}) => {
  const started = [];
  return { started, deps: {
    candidates: async () => rows,
    lastPlanAt: async () => new Date(NOW - 40 * DAY),
    inFlight: async () => false,
    lastRunFailed: async () => false,
    lastRunStopped: async () => false,
    startPlan: async ({ userId }) => { started.push(userId); return { ok: true }; },
    saveState: async () => {}, countAttempt: async () => {}, alert: () => {},
    ...over
  } };
};

test('I3: the monthly pass refreshes only accounts that already have a plan older than 30 days', async () => {
  const lastPlan = { a: null, b: new Date(NOW - 5 * DAY), c: new Date(NOW - 40 * DAY) };
  const { started, deps } = mdeps([user('a'), user('b'), user('c')], { lastPlanAt: async (id) => lastPlan[id] });
  await sch.runMonthlyOnce({ deps, now: NOW });
  assert.deepStrictEqual(started, ['c']);
});

test('I3: the per-tick cap is five and the first tick comes fifteen minutes after boot', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => user(`u${i}`));
  const { started, deps } = mdeps(rows);
  await sch.runMonthlyOnce({ deps, now: NOW });
  assert.strictEqual(started.length, 5);
  assert.strictEqual(sch.FIRST_TICK_MS, 15 * MIN);
});

test('I4: an account whose newest run stopped is never refreshed or retried automatically', async () => {
  const { started, deps } = mdeps([user('s')], { lastRunStopped: async () => true });
  await sch.runMonthlyOnce({ deps, now: NOW });
  assert.deepStrictEqual(started, []);
});

test('C3: the monthly pass and the retry pass stop at once when the system is busy or at its cap', async () => {
  for (const reason of ['busy', 'daily_cap']) {
    const { started, deps } = mdeps([user('a'), user('b'), user('c')], { startPlan: async ({ userId }) => { started.push(userId); return { ok: false, reason }; } });
    const out = await sch.runMonthlyOnce({ deps, now: NOW });
    assert.deepStrictEqual(started, ['a'], reason);
    assert.strictEqual(out.halted, reason);
    const tried = [];
    const r = await sch.retryFailedFirstPlans({ now: NOW, deps: { failedFirst: async () => [{ user: user('x'), state: {} }, { user: user('y'), state: {} }], startPlan: async ({ userId }) => { tried.push(userId); return { ok: false, reason }; }, saveState: async () => {}, alert: () => {} } });
    assert.deepStrictEqual(tried, ['x'], reason);
    assert.strictEqual(r.halted, reason);
  }
});

test('C2: every tick reaps stale plan runs first', async () => {
  const order = [];
  const deps = { ...mdeps([]).deps, failedFirst: async () => { order.push('retry'); return []; }, candidates: async () => { order.push('monthly'); return []; } };
  await sch.runSchedulerTick({ deps, plans: { reapStalePlanRuns: async ({ now }) => { order.push('reap'); assert.ok(now); return { reaped: 0 }; } }, now: NOW });
  assert.deepStrictEqual(order, ['reap', 'retry', 'monthly']);
});

test('C2: a failing reaper never stops the tick', async () => {
  const order = [];
  const deps = { ...mdeps([]).deps, failedFirst: async () => { order.push('retry'); return []; }, candidates: async () => { order.push('monthly'); return []; } };
  const w = console.warn; console.warn = () => {};
  try { await sch.runSchedulerTick({ deps, plans: { reapStalePlanRuns: async () => { throw new Error('db'); } }, now: NOW }); } finally { console.warn = w; }
  assert.deepStrictEqual(order, ['retry', 'monthly']);
});

// ---- I2 and M4: the real queries, against recording fakes ----
const rec = (rows = []) => {
  const calls = {};
  const chain = (name, filter) => { calls[name] = { filter }; const q = { sort(s) { calls[name].sort = s; return q; }, limit(n) { calls[name].limit = n; return q; }, select() { return q; }, lean: async () => rows }; return q; };
  return { calls, model: { find: (f) => chain('find', f), findOne: (f) => chain('findOne', f), distinct: async (...a) => { calls.distinct = a; return []; }, exists: async () => null } };
};

test('I2: candidates filters in the query: paying, active, not staff or CSM, completed plan older than 30 days, oldest start first, window kept small', async () => {
  const users = rec([]);
  const bps = { distinct: async (field, f) => { bps.args = [field, f]; return ['u1', 'u2']; } };
  const deps = sch.defaultDeps({ User: () => users.model, Blueprint: () => bps, gate: async () => [] });
  await deps.candidates(NOW);
  const f = users.calls.find.filter;
  assert.deepStrictEqual(f['plan.tier'], { $ne: 'free' });
  assert.deepStrictEqual(f.isActive, { $ne: false });
  assert.strictEqual(f.staffRole, null);
  assert.deepStrictEqual(f.isCsm, { $ne: true });
  assert.strictEqual(f.onboardingCompleted, true);
  assert.deepStrictEqual(f._id.$in, ['u1', 'u2']);
  assert.deepStrictEqual(users.calls.find.sort, { 'planState.lastStartedAt': 1 });
  assert.ok(users.calls.find.limit <= 200);
  assert.strictEqual(bps.args[0], 'userId');
  assert.strictEqual(bps.args[1].kind, 'plan');
  assert.strictEqual(bps.args[1].status, 'completed');
  assert.ok(bps.args[1].completedAt.$lt instanceof Date);
});

test('M4: the failed-first scan looks only at the last 14 days and is limited', async () => {
  const bps = rec([]);
  const deps = sch.defaultDeps({ Blueprint: () => bps.model, User: () => rec().model, gate: async () => [] });
  await deps.failedFirst(NOW);
  const f = bps.calls.find.filter;
  assert.strictEqual(f.kind, 'plan');
  assert.strictEqual(f.status, 'failed');
  assert.ok(f.createdAt.$gte instanceof Date);
  assert.ok(NOW.getTime() - f.createdAt.$gte.getTime() <= 15 * DAY);
  assert.ok(bps.calls.find.limit > 0 && bps.calls.find.limit <= 500);
});

// ---- I1, M8 ----
test('M8: the backfill skips accounts the background gate blocks', () => {
  const u = (id) => ({ _id: id, createdAt: new Date(`2026-0${id}-01`), isActive: true, onboardingCompleted: true, plan: { tier: 'managed' }, businessProfile: { name: 'Biz', website: 'b.in', description: 'We sell good things here', targetAudience: 'Everyone nearby' } });
  const out = selectForBackfill({ users: [u('1'), u('2')], blockedIds: new Set(['1']), limit: 5 });
  assert.deepStrictEqual(out.chosen.map((x) => x._id), ['2']);
  assert.strictEqual(out.skipped.find((s) => s.id === '1').why, 'blocked');
});

test('I1: waitForRun polls until the run is terminal, and times out', async () => {
  let t = 0; const states = ['queued', 'processing', 'processing', 'completed'];
  let i = 0;
  const base = { findRun: async () => ({ status: states[Math.min(i++, states.length - 1)] }), sleep: async (ms) => { t += ms; }, now: () => t, pollMs: 15000, timeoutMs: 600000 };
  const done = await waitForRun({ ...base, id: 'x' });
  assert.strictEqual(done.status, 'completed');
  assert.strictEqual(t, 45000);
  t = 0;
  const hung = await waitForRun({ ...base, id: 'y', findRun: async () => ({ status: 'processing' }) });
  assert.strictEqual(hung.status, 'timeout');
  assert.ok(t >= 600000);
  const gone = await waitForRun({ ...base, id: 'z', findRun: async () => null });
  assert.strictEqual(gone.status, 'missing');
});
