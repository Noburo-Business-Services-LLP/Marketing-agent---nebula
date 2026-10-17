const test = require('node:test');
const assert = require('node:assert');
const { runMonthlyOnce, retryFailedFirstPlans } = require('../services/plan/planScheduler');
const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const user = (id, extra = {}) => ({ _id: id, isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'a.in', description: 'Custom cakes baked to order', targetAudience: 'Families' }, ...extra });

test('the monthly run starts plans for due accounts only, at most the limit, one at a time per account', async () => {
  const started = [];
  const deps = {
    candidates: async () => [user('a'), user('b'), user('c', { plan: { tier: 'free' } }), user('d'), user('e')],
    lastPlanAt: async (id) => ({ a: null, b: new Date(NOW - 5 * DAY), d: new Date(NOW - 40 * DAY), e: null })[id] ?? null,
    inFlight: async (id) => id === 'e',
    startPlan: async ({ userId }) => { started.push(userId); return { ok: true }; }
  };
  const out = await runMonthlyOnce({ deps, now: NOW, limit: 1 });
  assert.deepStrictEqual(started, ['a'], 'b is fresh, c is free, d waits for the limit, e is running');
  assert.strictEqual(out.started, 1);
  const out2 = await runMonthlyOnce({ deps, now: NOW, limit: 10 });
  assert.deepStrictEqual(started.slice(1), ['a', 'd']);
  assert.ok(out2.skipped >= 3);
});

test('a failed first plan is retried twice with a pause, then the owner is told once', async () => {
  const alerts = []; const started = [];
  const states = { x: { attempts: 0, lastStartedAt: new Date(NOW - 60 * 60000) } };
  const deps = {
    failedFirst: async () => [{ user: user('x'), state: states.x }],
    startPlan: async ({ userId }) => { started.push(userId); states.x.attempts += 1; states.x.lastStartedAt = NOW; return { ok: true }; },
    saveState: async (id, patch) => Object.assign(states[id], patch),
    alert: (m) => alerts.push(m)
  };
  await retryFailedFirstPlans({ deps, now: NOW });                       // attempt 1
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 10 * 60000) }); // too soon: nothing
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 40 * 60000) }); // attempt 2
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 90 * 60000) }); // out of attempts: alert once
  await retryFailedFirstPlans({ deps, now: new Date(+NOW + 200 * 60000) }); // already alerted: silent
  assert.strictEqual(started.length, 2);
  assert.strictEqual(alerts.length, 1);
  assert.ok(states.x.firstPlanFailedAt);
});

test('maybeStartFirstPlan starts only for an eligible account with no plan, and the safe wrapper never throws', async () => {
  const { createPlanService, maybeStartFirstPlan, maybeStartFirstPlanSafe } = require('../services/plan/planService');
  const calls = [];
  const mk = (u, runs) => createPlanService({
    loadUser: async () => u, findRuns: async (q) => runs.filter((r) => !q.status || [].concat(q.status).includes(r.status) || (q.status.$in || []).includes(r.status)),
    startSystem: async () => { calls.push(1); return { ok: true, id: 'p' }; }, saveState: async () => {}, now: () => NOW
  });
  await maybeStartFirstPlan('a', mk(user('a'), []));
  assert.strictEqual(calls.length, 1);
  await maybeStartFirstPlan('a', mk(user('a'), [{ status: 'completed', result: {}, completedAt: NOW }]));
  assert.strictEqual(calls.length, 1, 'already has a plan');
  await maybeStartFirstPlan('a', mk(user('a', { plan: { tier: 'free' } }), []));
  assert.strictEqual(calls.length, 1, 'free accounts get none');
  const boom = { currentPlan: () => { throw new Error('db down'); }, startPlan: async () => {}, inFlight: async () => false };
  assert.doesNotThrow(() => maybeStartFirstPlanSafe('a', { service: boom, log: () => {} }));
});

const HOUR = 3600000;
const monthlyDeps = (u, over = {}) => {
  const started = []; const alerts = []; const saved = [];
  return { started, alerts, saved, deps: {
    candidates: async () => [u],
    lastPlanAt: async () => new Date(NOW - 40 * DAY),
    inFlight: async () => false,
    lastRunFailed: async () => false,
    startPlan: async ({ userId }) => { started.push(userId); return { ok: true }; },
    saveState: async (id, patch) => { saved.push(patch); Object.assign(u.planState, patch); },
    countAttempt: async () => { u.planState.attempts = (u.planState.attempts || 0) + 1; },
    alert: (m) => alerts.push(m),
    ...over
  } };
};

test('monthly: an account whose first plan retries are used up is never started', async () => {
  const u = user('f', { planState: { firstPlanFailedAt: new Date(NOW - DAY) } });
  const m = monthlyDeps(u, { lastPlanAt: async () => null });
  await runMonthlyOnce({ deps: m.deps, now: NOW });
  assert.deepStrictEqual(m.started, []);
});

test('monthly: an account started 2 hours ago waits, one started 13 hours ago may go', async () => {
  const recent = user('r', { planState: { lastStartedAt: new Date(NOW - 2 * HOUR) } });
  const a = monthlyDeps(recent);
  await runMonthlyOnce({ deps: a.deps, now: NOW });
  assert.deepStrictEqual(a.started, []);
  const older = user('o', { planState: { lastStartedAt: new Date(NOW - 13 * HOUR) } });
  const b = monthlyDeps(older);
  await runMonthlyOnce({ deps: b.deps, now: NOW });
  assert.deepStrictEqual(b.started, ['o']);
});

test('monthly: an account with a failed run and no completed plan is left to the first-plan retry logic', async () => {
  const u = user('n', { planState: { attempts: 0, lastStartedAt: new Date(NOW - 13 * HOUR) } });
  const m = monthlyDeps(u, { lastPlanAt: async () => null, lastRunFailed: async () => true });
  await runMonthlyOnce({ deps: m.deps, now: NOW });
  assert.deepStrictEqual(m.started, []);
  const retried = [];
  await retryFailedFirstPlans({ now: NOW, deps: {
    failedFirst: async () => [{ user: u, state: u.planState }],
    startPlan: async ({ userId }) => { retried.push(userId); return { ok: true }; },
    saveState: async () => {}, alert: () => {}
  } });
  assert.deepStrictEqual(retried, ['n']);
});

test('monthly: a failed monthly run waits 24 hours, and three failed attempts alert once then stop', async () => {
  const u = user('m', { planState: { attempts: 1, lastStartedAt: new Date(NOW - 13 * HOUR) } });
  const m = monthlyDeps(u, { lastRunFailed: async () => true });
  await runMonthlyOnce({ deps: m.deps, now: NOW });
  assert.deepStrictEqual(m.started, [], 'failed 13h ago: 24h cooldown applies');
  u.planState.lastStartedAt = new Date(NOW - 25 * HOUR);
  await runMonthlyOnce({ deps: m.deps, now: NOW });
  assert.deepStrictEqual(m.started, ['m']);
  u.planState.attempts = 3; u.planState.lastStartedAt = new Date(NOW - 25 * HOUR);
  await runMonthlyOnce({ deps: m.deps, now: NOW });
  await runMonthlyOnce({ deps: m.deps, now: new Date(+NOW + 2 * DAY) });
  assert.strictEqual(m.started.length, 1, 'no start after three failures');
  assert.strictEqual(m.alerts.length, 1);
  assert.ok(u.planState.firstPlanFailedAt);
});

test('monthly: a healthy account has its failure count reset', async () => {
  const u = user('h', { planState: { attempts: 2, lastStartedAt: new Date(NOW - 40 * DAY) } });
  const m = monthlyDeps(u);
  await runMonthlyOnce({ deps: m.deps, now: NOW });
  assert.ok(m.saved.some((p) => p.attempts === 0));
});

test('a successful refresh clears a stuck first-plan failure', async () => {
  const { createPlanService } = require('../services/plan/planService');
  const saved = [];
  const svc = createPlanService({
    loadUser: async () => user('s'), findRuns: async () => [], startSystem: async () => ({ ok: true, id: 'p' }),
    saveState: async (id, patch) => saved.push(patch), now: () => NOW
  });
  const r = await svc.refresh({ userId: 's', staff: true });
  assert.ok(r.ok);
  assert.ok(saved.some((p) => p.firstPlanFailedAt === null && p.attempts === 0));
});
