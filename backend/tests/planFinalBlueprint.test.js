const test = require('node:test');
const assert = require('node:assert');
const { createBlueprintService } = require('../services/blueprint/service');
const { buildBlueprint, scanPlanExtras } = require('../services/blueprint/pipeline');
const { buildDeck } = require('../services/blueprint/designedDeck');
const { normaliseInput } = require('../services/blueprint/input');
const { PLAN_RUNS_PER_DAY_MAX, LIMITS } = require('../config/blueprint');
const { makeDeps } = require('./blueprintFakes');
const sheet = require('./fixtures/blueprintSheet.json');
const good = require('./fixtures/blueprintPlanGood.json');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const NOW = new Date('2026-10-17T10:00:00Z');
const input = normaliseInput({ businessName: 'Sweet Co', website: 'sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries', city: 'Chennai', offers: [{ name: 'Birthday cake', price: '₹499' }], competitors: [{ name: 'Rival Cakes', url: 'https://rivalcakes.in' }, { name: 'Other Bakery' }] }).input;
const llm = (payload) => ({ callLLM: async () => JSON.stringify(payload), parseJSON: JSON.parse });
const withExtras = (extra = {}) => ({
  ...clone(good),
  icp: { who: [{ text: 'Families in Chennai who order for birthdays', tag: 'inference', factIds: ['F3'] }], pains: [{ text: 'Little time to plan a cake', tag: 'proposed' }], where: [{ text: 'Instagram and WhatsApp groups', tag: 'proposed' }], triggers: [{ text: 'A birthday is coming', tag: 'proposed' }] },
  effort: [
    { channel: 'Instagram', organicPct: 80, paidPct: 20, nebulaaDoes: ['posts', 'videos'], youDo: [{ text: 'Reply to messages the same day.', tag: 'proposed' }] },
    { channel: 'WhatsApp', organicPct: 100, paidPct: 0, nebulaaDoes: ['inbox replies'], youDo: [] }
  ],
  ...extra
});

// ---- C1 ----
test('C1: the stored result carries the normalised plan with icp, effort and channels, and the old views still work', async () => {
  const { result, qa } = await buildBlueprint({ input, sheet, mode: 'auto', now: NOW }, llm(withExtras()));
  assert.strictEqual(qa.passed, true);
  const p = result.plan;
  assert.ok(p, 'result.plan exists');
  for (const k of ['promise', 'positioning', 'whereToday', 'competitors', 'pillars', 'calendar', 'offers', 'channels', 'effort', 'icp', 'roadmap', 'firstSteps']) assert.ok(k in p, k);
  assert.ok(p.icp.who.length && p.icp.pains.length);
  assert.deepStrictEqual(p.effort.map((e) => e.channel), ['Instagram', 'WhatsApp']);
  assert.deepStrictEqual(p.effort[0].nebulaaDoes, ['posts', 'videos']);
  assert.ok(p.channels.length >= 2);
  // the frontend reads exactly these names (utils/plan.ts, MyPlan.tsx)
  assert.ok(p.positioning.audience && 'territory' in p.positioning && 'line' in p.positioning);
  assert.ok(p.roadmap.every((r) => 'phase' in r && 'focus' in r && 'actions' in r && 'measure' in r));
  assert.ok(Array.isArray(result.pages) && result.pages.length === 9);
  assert.doesNotThrow(() => buildDeck(result));
});

test('C1: a claim the scanner rejects never reaches result.plan, in icp or effort', () => {
  const plan = {
    icp: { who: [{ text: 'Customers love our cakes', tag: 'proposed' }, { text: 'Families', tag: 'proposed' }], pains: [], where: [], triggers: [] },
    effort: [{ channel: 'Instagram', organicPct: 50, paidPct: 50, nebulaaDoes: [], youDo: [{ text: 'Reach 5000 people!', tag: 'proposed' }, { text: 'Reply fast.', tag: 'proposed' }] }]
  };
  const out = scanPlanExtras(plan, sheet);
  assert.deepStrictEqual(out.plan.icp.who.map((c) => c.text), ['Families']);
  assert.deepStrictEqual(out.plan.effort[0].youDo.map((c) => c.text), ['Reply fast.']);
  assert.strictEqual(out.dropped.length, 2);
});

// ---- I7 ----
test('I7: claims dropped from icp and effort do not fail the Blueprint', async () => {
  const bad = Array.from({ length: 12 }, (_, i) => ({ text: `Reach ${i + 100} families`, tag: 'proposed' }));
  const ans = withExtras();
  ans.icp.pains = bad; ans.icp.where = bad; ans.icp.triggers = bad;
  ans.effort[0].youDo = bad;
  const { result, qa } = await buildBlueprint({ input, sheet, mode: 'auto', now: NOW }, llm(ans));
  assert.strictEqual(qa.passed, true);
  assert.ok(!qa.flags.some((f) => f.rule === 'too_many_removed'));
  assert.strictEqual(result.plan.icp.pains.length, 0);
});

// ---- C3, I4, M2 ----
const user = (over = {}) => ({ _id: 'u1', email: 'owner@example.com', plan: { tier: 'starter' }, ...over });
const form = (over = {}) => ({ businessName: 'Sweet Co', website: 'https://sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries', ...over });
function setup(over) {
  const deps = makeDeps({ spendCheck: async () => ({ ok: true }), alertOwner: () => {}, ...over });
  const svc = createBlueprintService(deps);
  return { deps, svc };
}

test('C3: a refused spend check creates nothing and answers busy', async () => {
  const { deps, svc } = setup({ spendCheck: async (a) => { assert.strictEqual(a, 'blueprint'); return { ok: false, reason: 'switched_off', message: 'busy' }; } });
  const r = await svc.startSystem({ user: user(), input: form(), kind: 'plan' });
  assert.deepStrictEqual({ ok: r.ok, reason: r.reason }, { ok: false, reason: 'busy' });
  assert.strictEqual(deps.Blueprint.docs.length, 0);
  assert.strictEqual(deps.queued.length, 0);
});

test('C3: the global daily cap of plan runs refuses and alerts the owner once', async () => {
  const alerts = [];
  const { deps, svc } = setup({ alertOwner: (m) => alerts.push(m) });
  const recent = new Date(deps.now() - 3600 * 1000);
  for (let i = 0; i < PLAN_RUNS_PER_DAY_MAX; i += 1) deps.Blueprint.docs.push({ blueprintId: `old${i}`, userId: `x${i}`, kind: 'plan', status: 'completed', createdAt: recent });
  const a = await svc.startSystem({ user: user(), input: form(), kind: 'plan' });
  const b = await svc.startSystem({ user: user(), input: form(), kind: 'plan' });
  assert.strictEqual(a.reason, 'daily_cap');
  assert.strictEqual(b.reason, 'daily_cap');
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(deps.Blueprint.docs.length, PLAN_RUNS_PER_DAY_MAX);
});

test('C3: plan runs older than a day do not count toward the cap', async () => {
  const { deps, svc } = setup();
  const old = new Date(deps.now() - 30 * 3600 * 1000);
  for (let i = 0; i < PLAN_RUNS_PER_DAY_MAX; i += 1) deps.Blueprint.docs.push({ blueprintId: `old${i}`, userId: `x${i}`, kind: 'plan', status: 'completed', createdAt: old });
  assert.strictEqual((await svc.startSystem({ user: user(), input: form(), kind: 'plan' })).ok, true);
});

test('I5: invalid input is never silent: ok false, reason invalid_input, errors', async () => {
  const { deps, svc } = setup();
  const r = await svc.startSystem({ user: user(), input: form({ website: 'none' }), kind: 'plan' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'invalid_input');
  assert.ok(r.errors && Object.keys(r.errors).length);
  assert.strictEqual(deps.Blueprint.docs.length, 0);
});

test('I4: spend is recorded when the planner is actually called, not for a stopped run', async () => {
  const spent = [];
  const stopped = setup({ recordSpend: async (a, n) => spent.push([a, n]), discover: async () => ({ sheet: { stop: { reason: 'thin', message: 'Not enough to go on.' }, facts: [] }, sources: [] }) });
  const r = await stopped.svc.startSystem({ user: user(), input: form(), kind: 'plan' });
  assert.deepStrictEqual(spent, [], 'nothing recorded at start');
  await stopped.deps.drain();
  assert.strictEqual(stopped.deps.Blueprint.docs[0].status, 'stopped');
  assert.deepStrictEqual(spent, [], 'a stopped run never called the model');
  const ok = setup({ recordSpend: async (a, n) => spent.push([a, n]) });
  await ok.svc.startSystem({ user: user(), input: form(), kind: 'plan' });
  await ok.deps.drain();
  assert.deepStrictEqual(spent, [['blueprint', 1]]);
  assert.ok(r.ok);
});

test('I8: a plan run is queued in the plan lane', async () => {
  const lanes = [];
  const { deps, svc } = setup({ enqueue: (t, max, lane) => { lanes.push(lane); deps.queued.push(t); } });
  await svc.startSystem({ user: user(), input: form(), kind: 'plan' });
  assert.deepStrictEqual(lanes, ['plan']);
});

test('M2: plan runs do not count toward the customer daily Blueprint cap', async () => {
  const { deps, svc } = setup();
  for (let i = 0; i < LIMITS.PAID_PER_ACCOUNT_PER_DAY; i += 1) deps.Blueprint.docs.push({ blueprintId: `p${i}`, userId: 'u1', kind: 'plan', status: 'completed', createdAt: new Date(deps.now() - 1000), ipHash: 'h:1.1.1.1' });
  const r = await svc.start({ user: user({ isVerified: true }), tier: 'starter', body: form(), ip: '1.1.1.1' });
  assert.strictEqual(r.status, 202);
});

// ---- M9 ----
test('M9: a customer cannot open, continue or buy a designed edition of a plan run', async () => {
  const { deps, svc } = setup();
  deps.Blueprint.docs.push({ blueprintId: 'pl1', userId: 'u1', kind: 'plan', status: 'completed', result: { plan: {} }, createdAt: new Date() });
  assert.strictEqual((await svc.get({ userId: 'u1', id: 'pl1' })).status, 404);
  assert.strictEqual((await svc.continueRun({ userId: 'u1', id: 'pl1', body: {} })).status, 404);
  assert.strictEqual((await svc.startDesigned({ userId: 'u1', id: 'pl1' })).status, 404);
});
