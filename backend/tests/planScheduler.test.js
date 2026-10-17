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
