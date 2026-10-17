const test = require('node:test');
const assert = require('node:assert');
const { createPlanService } = require('../services/plan/planService');

const goodUser = () => ({ _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: { name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families', marketingGoals: ['enquiries'] } });
function setup({ user = goodUser(), docs = [] } = {}) {
  const calls = [];
  const deps = {
    loadUser: async () => user,
    findRuns: async (q) => docs.filter((d) => d.userId === 'u1' && (!q.status || q.status.includes(d.status))),
    startSystem: async ({ user: u, input, kind }) => { calls.push({ id: u._id, kind, goal: input.goal }); return { id: 'bp1' }; },
    saveState: async (id, patch) => { user.planState = { ...(user.planState || {}), ...patch }; },
    now: () => new Date('2026-10-17T06:00:00Z')
  };
  return { svc: createPlanService(deps), calls, user, deps };
}

test('a qualifying account starts one plan run, never charged, and records when', async () => {
  const { svc, calls, user } = setup();
  const r = await svc.startPlan({ userId: 'u1', reason: 'first' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(calls, [{ id: 'u1', kind: 'plan', goal: 'enquiries' }]);
  assert.ok(user.planState.lastStartedAt);
});

test('a run already queued or processing is not started twice', async () => {
  const { svc, calls } = setup({ docs: [{ userId: 'u1', status: 'processing', kind: 'plan' }] });
  const r = await svc.startPlan({ userId: 'u1', reason: 'monthly' });
  assert.strictEqual(r.alreadyRunning, true);
  assert.strictEqual(calls.length, 0);
});

test('a free account, a staff account or an incomplete profile starts nothing', async () => {
  for (const patch of [{ plan: { tier: 'free' } }, { staffRole: 'owner' }, { businessProfile: { name: 'x' } }]) {
    const { svc, calls } = setup({ user: { ...goodUser(), ...patch } });
    const r = await svc.startPlan({ userId: 'u1', reason: 'first' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(calls.length, 0);
  }
});

test('refresh: once a week for customers, any time for staff, and it stamps lastRefreshAt', async () => {
  const { svc, calls, user } = setup();
  assert.strictEqual((await svc.refresh({ userId: 'u1' })).ok, true);
  assert.ok(user.planState.lastRefreshAt);
  const again = await svc.refresh({ userId: 'u1' });
  assert.strictEqual(again.ok, false);
  assert.match(again.message, /once a week/);
  assert.strictEqual(calls.length, 1);
  const staff = await svc.refresh({ userId: 'u1', staff: true });
  assert.strictEqual(staff.ok, true);
});

test('a refresh that finds a run already going does not use up the week', async () => {
  const { svc, user } = setup({ docs: [{ userId: 'u1', status: 'queued', kind: 'plan' }] });
  const r = await svc.refresh({ userId: 'u1' });
  assert.strictEqual(r.alreadyRunning, true);
  assert.ok(!(user.planState && user.planState.lastRefreshAt));
});

test('the current plan is the newest completed plan run, and a failed run never hides it', async () => {
  const docs = [
    { userId: 'u1', kind: 'plan', status: 'completed', completedAt: new Date('2026-09-01'), blueprintId: 'old', result: { v: 1 } },
    { userId: 'u1', kind: 'plan', status: 'completed', completedAt: new Date('2026-10-01'), blueprintId: 'new', result: { v: 2 } },
    { userId: 'u1', kind: 'plan', status: 'failed', completedAt: new Date('2026-10-10'), blueprintId: 'bad' }
  ];
  const { svc } = setup({ docs });
  const cur = await svc.currentPlan('u1');
  assert.strictEqual(cur.id, 'new');
  assert.deepStrictEqual(cur.result, { v: 2 });
});
