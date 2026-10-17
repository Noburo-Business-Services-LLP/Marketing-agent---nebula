const test = require('node:test');
const assert = require('node:assert');
const { createPlanService, maybeStartFirstPlan } = require('../services/plan/planService');
const { profileComplete } = require('../services/plan/profileInput');
const planRoutes = require('../routes/plan');
const { LIMITS } = require('../config/blueprint');
const { makeBlueprintModel } = require('./blueprintFakes');

const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const NOW = new Date('2026-10-17T06:00:00Z');
const profile = (over = {}) => ({ name: 'Sweet Co', website: 'sweetco.in', description: 'Custom cakes baked to order', targetAudience: 'Families', marketingGoals: ['enquiries'], ...over });
const goodUser = (over = {}) => ({ _id: 'u1', isActive: true, onboardingCompleted: true, plan: { tier: 'starter' }, businessProfile: profile(), updatedAt: new Date(NOW - DAY), ...over });

function setup({ user = goodUser(), docs = [], start = async () => ({ ok: true, id: 'bp1' }), claim } = {}) {
  const calls = []; const failed = []; const released = [];
  const deps = {
    loadUser: async () => user,
    findRuns: async (q) => docs.filter((d) => (!q.userId || d.userId === q.userId) && (!q.status || [].concat(q.status.$in || q.status).includes(d.status))),
    latestRun: async (id) => docs.filter((d) => d.userId === id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null,
    startSystem: async (a) => { calls.push(a.kind); return start(a); },
    saveState: async (id, patch) => { user.planState = { ...(user.planState || {}), ...patch }; },
    failRun: async (id, at) => { const d = docs.find((x) => x.blueprintId === id); if (d && ['queued', 'processing'].includes(d.status)) { d.status = 'failed'; d.error = { message: 'interrupted' }; d.failedAt = at; failed.push(id); } },
    now: () => NOW,
    ...(claim ? { claimStart: claim, releaseStart: async (id) => released.push(id) } : {})
  };
  return { svc: createPlanService(deps), calls, user, docs, failed, released };
}
const run = (over) => ({ userId: 'u1', kind: 'plan', blueprintId: 'r1', status: 'processing', createdAt: new Date(NOW - 5 * MIN), heartbeatAt: new Date(NOW - MIN), ...over });

// ---- C2 ----
test('C2: a run with a stale heartbeat is not in flight, so the account can start again', async () => {
  const { svc, calls } = setup({ docs: [run({ heartbeatAt: new Date(NOW - LIMITS.STALE_MS - MIN) })] });
  assert.strictEqual(await svc.inFlight('u1'), false);
  const r = await svc.startPlan({ userId: 'u1', reason: 'monthly' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls.length, 1);
});

test('C2: a fresh run is still in flight', async () => {
  const { svc } = setup({ docs: [run()] });
  assert.strictEqual(await svc.inFlight('u1'), true);
});

test('C2: the reaper fails stale queued and processing plan runs with error interrupted, and leaves fresh ones', async () => {
  const docs = [
    run({ blueprintId: 'stale1', status: 'queued', heartbeatAt: new Date(NOW - 20 * MIN) }),
    run({ blueprintId: 'stale2', userId: 'u2', heartbeatAt: new Date(NOW - 30 * MIN), charge: { state: 'none' } }),
    run({ blueprintId: 'fresh', userId: 'u3' }),
    run({ blueprintId: 'done', userId: 'u4', status: 'completed', heartbeatAt: new Date(NOW - 99 * DAY) })
  ];
  const { svc, failed } = setup({ docs });
  const out = await svc.reapStalePlanRuns({ now: NOW });
  assert.deepStrictEqual(failed.sort(), ['stale1', 'stale2']);
  assert.strictEqual(out.reaped, 2);
  assert.strictEqual(docs.find((d) => d.blueprintId === 'stale2').error.message, 'interrupted');
  assert.deepStrictEqual(docs.find((d) => d.blueprintId === 'stale2').charge, { state: 'none' });
  assert.strictEqual(docs.find((d) => d.blueprintId === 'fresh').status, 'processing');
});

test('C2: on boot every queued or processing plan run is dead, whatever its heartbeat', async () => {
  const docs = [run({ blueprintId: 'a' }), run({ blueprintId: 'b', userId: 'u2', status: 'queued' }), run({ blueprintId: 'c', userId: 'u3', status: 'completed' })];
  const { svc, failed } = setup({ docs });
  const out = await svc.reapStalePlanRuns({ now: NOW, all: true });
  assert.deepStrictEqual(failed.sort(), ['a', 'b']);
  assert.strictEqual(out.reaped, 2);
});

// ---- C3 and I5 surfaced by the service ----
test('C3/I5: planService passes busy, daily_cap and invalid_input through and records nothing', async () => {
  for (const reason of ['busy', 'daily_cap', 'invalid_input']) {
    const { svc, user } = setup({ start: async () => ({ ok: false, reason, message: 'm', errors: { website: 'x' } }) });
    const r = await svc.startPlan({ userId: 'u1', reason: 'refresh' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, reason);
    assert.ok(!(user.planState && user.planState.lastStartedAt), reason);
  }
});

test('C3: the refresh reply for busy and daily_cap is a plain 503, invalid input a plain 400', () => {
  for (const reason of ['busy', 'daily_cap']) {
    const r = planRoutes.refreshReply({ ok: false, reason }, null);
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.json.message, 'We are busy right now, please try again later');
  }
  const bad = planRoutes.refreshReply({ ok: false, reason: 'invalid_input' }, null);
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json.message, /website or Instagram/);
});

test('I5: profileComplete agrees with the input check: "none" and "-" are not a website', () => {
  for (const w of ['none', '-', 'foo']) {
    const p = profileComplete({ businessProfile: profile({ website: w }) });
    assert.strictEqual(p.complete, false, w);
    assert.ok(p.missing.includes('website or Instagram page'), w);
  }
  assert.strictEqual(profileComplete({ businessProfile: profile({ website: 'sweetco.in' }) }).complete, true);
  const ig = { businessProfile: profile({ website: '' }), connectedSocials: [{ platform: 'instagram', username: 'sweet_co' }] };
  assert.strictEqual(profileComplete(ig).complete, true);
  assert.strictEqual(profileComplete({ businessProfile: profile({ website: 'none' }), connectedSocials: [{ platform: 'instagram', username: 'sweet_co' }] }).complete, false);
});

// ---- I6 and I4 hook rules ----
test('I6: the profile-save hook starts nothing after a failed first plan, or within an hour of the last start', async () => {
  const failedFirst = setup({ user: goodUser({ planState: { firstPlanFailedAt: new Date(NOW - DAY) } }) });
  await maybeStartFirstPlan('u1', failedFirst.svc);
  assert.strictEqual(failedFirst.calls.length, 0);
  const recent = setup({ user: goodUser({ planState: { lastStartedAt: new Date(NOW - 20 * MIN) } }) });
  await maybeStartFirstPlan('u1', recent.svc);
  assert.strictEqual(recent.calls.length, 0);
  const later = setup({ user: goodUser({ planState: { lastStartedAt: new Date(NOW - 2 * HOUR) } }) });
  await maybeStartFirstPlan('u1', later.svc);
  assert.strictEqual(later.calls.length, 1);
});

test('I4: a stopped run is retried by the hook only if the profile changed after it', async () => {
  const stopped = run({ status: 'stopped', createdAt: new Date(NOW - 3 * DAY), stop: { message: 'We could not read your website.' } });
  const unchanged = setup({ user: goodUser({ updatedAt: new Date(NOW - 5 * DAY) }), docs: [stopped] });
  await maybeStartFirstPlan('u1', unchanged.svc);
  assert.strictEqual(unchanged.calls.length, 0);
  const changed = setup({ user: goodUser({ updatedAt: new Date(NOW - MIN) }), docs: [{ ...stopped }] });
  await maybeStartFirstPlan('u1', changed.svc);
  assert.strictEqual(changed.calls.length, 1);
});

test('I4: GET /api/plan shows the stop message in plain words when the newest run stopped', async () => {
  const stopped = run({ status: 'stopped', stop: { reason: 'unreachable', message: 'We could not read your website.' } });
  const { svc } = setup({ docs: [stopped] });
  const view = await planRoutes.viewFor(goodUser(), { service: svc, now: NOW });
  assert.deepStrictEqual(view.stopped, { message: 'We could not read your website.' });
  assert.strictEqual(view.failed, false);
  const none = await planRoutes.viewFor(goodUser(), { service: setup().svc, now: NOW });
  assert.strictEqual(none.stopped, null);
});

// ---- ruling: the button, weekly limit not applied without a plan ----
test('button: with no plan yet the weekly limit does not apply, and building the first plan does not stamp a refresh', async () => {
  const { svc, calls, user } = setup({ user: goodUser({ planState: { lastRefreshAt: new Date(NOW - DAY) } }) });
  const r = await svc.refresh({ userId: 'u1' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(new Date(user.planState.lastRefreshAt).getTime(), NOW.getTime() - DAY);
  const view = await planRoutes.viewFor(goodUser({ planState: { lastRefreshAt: new Date(NOW - DAY) } }), { service: setup().svc, now: NOW });
  assert.strictEqual(view.nextRefreshAt, null);
});

test('M5: a staff refresh does not stamp the customer lastRefreshAt', async () => {
  const docs = [{ userId: 'u1', kind: 'plan', status: 'completed', completedAt: new Date(NOW - 40 * DAY), blueprintId: 'old', result: { plan: {} } }];
  const { svc, user } = setup({ docs });
  const out = await svc.refresh({ userId: 'u1', staff: true });
  assert.strictEqual(out.ok, true);
  assert.ok(!(user.planState && user.planState.lastRefreshAt));
});

// ---- M1 ----
test('M1: the atomic start claim lets exactly one of two simultaneous starts through', async () => {
  let held = false;
  const claim = async () => { if (held) return false; held = true; return true; };
  const { svc, calls, released } = setup({ claim });
  const [a, b] = await Promise.all([svc.startPlan({ userId: 'u1', reason: 'first' }), svc.startPlan({ userId: 'u1', reason: 'first' })]);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual([a, b].filter((r) => r.alreadyRunning).length, 1);
  assert.deepStrictEqual(released, [], 'a started run keeps its claim until it expires');
});

test('M1: a start that is refused releases the claim so the next try is not blocked', async () => {
  const claim = async () => true;
  const { svc, released } = setup({ claim, start: async () => ({ ok: false, reason: 'busy' }) });
  await svc.startPlan({ userId: 'u1', reason: 'first' });
  assert.deepStrictEqual(released, ['u1']);
});

// ---- I9 ----
test('I9: the free Blueprint is found even when the older document has no kind', async () => {
  const model = makeBlueprintModel();
  model.docs.push({ blueprintId: 'old-free', userId: 'u1', status: 'completed', freeSlot: true });
  model.docs.push({ blueprintId: 'plan1', userId: 'u1', kind: 'plan', status: 'completed', freeSlot: true });
  const wrap = { findOne: (f) => ({ select: () => ({ lean: () => model.findOne(f) }) }) };
  const fb = await planRoutes.defaultFreeBlueprint('u1', wrap);
  assert.strictEqual(fb.blueprintId, 'old-free');
});
