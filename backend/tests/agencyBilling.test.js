const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const bp = require('../services/billingPlans');
const { createPaymentRouter } = require('../routes/payment');
const { PLANS, AGENCY, chargePaise, gstPaise } = require('../config/apiCosts');
const { isBlockedInsideClient } = require('../services/agencyWorkspaces');
const ag = require('../services/agency');

const CAP = AGENCY.maxClients - AGENCY.includedClients; // most extra client slots one agency can hold

// ---------------------------------------------------------------- pure rules
test('the agency plan is billed like the other plans and sets the pool, the tier and the client limit', () => {
  const rec = { kind: 'plan', key: 'agency', subscriptionId: 'sub_a', razorpayPlanId: 'plan_a' };
  const u = bp.buildChargeUpdate(rec, { paymentId: 'pay_1', paidPaise: bp.planQuote('agency').chargePaise });
  assert.strictEqual(u.update.$set['plan.tier'], 'agency');
  assert.strictEqual(u.quarks, PLANS.agency.quarks);
  assert.strictEqual(u.update.$push.payments.exGstAmount, PLANS.agency.inr);
  assert.match(bp.invoiceSpec('plan', 'agency').description, /Agency plan/);
  assert.strictEqual(bp.invoiceSpec('plan', 'agency').itemName, 'Nebulaa Agency subscription');
  assert.strictEqual(bp.invoiceSpec('plan', 'starter').itemName, 'Nebulaa subscription', 'other plans keep their item name');
});

test('GST is added on top in whole paise, from config only', () => {
  const q = bp.planQuote('agency');
  assert.strictEqual(q.chargePaise, PLANS.agency.inr * 100 + gstPaise(PLANS.agency.inr));
  assert.ok(Number.isInteger(q.chargePaise) && Number.isInteger(bp.slotQuote().chargePaise));
  assert.strictEqual(bp.slotQuote().chargePaise, AGENCY.slot.inr * 100 + gstPaise(AGENCY.slot.inr));
  assert.strictEqual(bp.invoiceSpec('slot', 'client').totalPaise, chargePaise(AGENCY.slot.inr));
  assert.strictEqual(bp.invoiceSpec('slot', 'client').gstPercent, 18);
});

test('a client slot is its own monthly subscription at the configured price plus GST', () => {
  const q = bp.slotQuote();
  assert.strictEqual(q.inr, AGENCY.slot.inr);
  assert.strictEqual(q.quarks, AGENCY.slot.quarks);
  assert.strictEqual(q.chargePaise, chargePaise(AGENCY.slot.inr));
  const spec = bp.invoiceSpec('slot', 'client');
  assert.strictEqual(spec.amountInr, AGENCY.slot.inr);
  assert.strictEqual(spec.itemName, 'Nebulaa extra client');
  const body = bp.razorpayPlanBody('slot', 'client');
  assert.strictEqual(body.item.amount, q.chargePaise);
  assert.strictEqual(body.notes.kind, 'slot');
  assert.strictEqual(body.item.name, 'Nebulaa extra client');
  assert.strictEqual(bp.envVarFor('slot', 'client'), 'RAZORPAY_PLAN_ID_SLOT');
  assert.strictEqual(bp.envVarFor('plan', 'agency'), 'RAZORPAY_PLAN_ID_AGENCY');
  assert.strictEqual(bp.razorpayPlanBody('plan', 'agency').item.amount, bp.planQuote('agency').chargePaise);
  for (const bad of ['', 'clients', 'Client', 'plan_x', undefined, null, 5]) {
    assert.strictEqual(bp.invoiceSpec('slot', bad), null, String(bad));
    assert.strictEqual(bp.razorpayPlanBody('slot', bad), null, String(bad));
  }
});

test('the plans catalogue carries the slot price with GST for the plans and clients pages', () => {
  const c = bp.planCatalogue();
  assert.deepStrictEqual(c.slot, { id: 'client', inr: AGENCY.slot.inr, gstPaise: gstPaise(AGENCY.slot.inr), chargePaise: chargePaise(AGENCY.slot.inr), quarks: AGENCY.slot.quarks });
});

test('wording on invoices and plans is plain: no vendor names, no credits, no exclamation marks or em dashes', () => {
  const texts = [
    bp.invoiceSpec('slot', 'client').itemName, bp.invoiceSpec('slot', 'client').description,
    bp.invoiceSpec('plan', 'agency').itemName, bp.invoiceSpec('plan', 'agency').description,
    bp.razorpayPlanBody('slot', 'client').item.description, bp.razorpayPlanBody('plan', 'agency').item.description,
    bp.canBuySlot({ plan: { tier: 'free' } }).message, bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: CAP } }).message
  ];
  for (const t of texts) assert.doesNotMatch(t, /razorpay|zoho|ayrshare|credit|trial|!|—/i, t);
});

test('a paid slot adds one client and grants its Quarks to the monthly allowance; a renewal of the same slot grants nothing', () => {
  const rec = { kind: 'slot', key: 'client', subscriptionId: 'sub_s' };
  const first = bp.buildChargeUpdate(rec, { paymentId: 'pay_s1', paidPaise: bp.slotQuote().chargePaise, firstCycle: true });
  assert.strictEqual(first.update.$inc['agency.extraSlots'], 1);
  assert.strictEqual(first.quarks, AGENCY.slot.quarks);
  assert.strictEqual(first.update.$inc['credits.planBalance'], AGENCY.slot.quarks, 'slot Quarks go to the monthly bucket');
  assert.strictEqual(first.update.$inc['credits.balance'], AGENCY.slot.quarks);
  assert.strictEqual(first.update.$inc['credits.topupBalance'], undefined);
  assert.strictEqual(JSON.stringify(first.update.$set || {}).includes('Expires'), false, 'no end date is touched');
  const renewal = bp.buildChargeUpdate(rec, { paymentId: 'pay_s2', paidPaise: bp.slotQuote().chargePaise, firstCycle: false });
  assert.strictEqual(renewal.quarks, 0, 'the slot Quarks arrive with the Agency plan renewal');
  assert.strictEqual(renewal.update.$inc, undefined);
  assert.strictEqual(renewal.update.$push.payments.credits, 0);
  const dflt = bp.buildChargeUpdate(rec, { paymentId: 'pay_s3', paidPaise: 1 });
  assert.strictEqual(dflt.update.$inc['agency.extraSlots'], 1, 'first cycle is the default');
});

test('only an agency account may buy a slot, and never beyond the most clients', () => {
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'professional' } }).ok, false);
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'free' } }).ok, false);
  assert.strictEqual(bp.canBuySlot({ plan: {} }).ok, false, 'a managed account');
  assert.strictEqual(bp.canBuySlot(null).ok, false);
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' } }).ok, true, 'no slots yet');
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: CAP - 1 } }).ok, true, 'one below the most');
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: CAP } }).ok, false, 'already at the most clients');
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: CAP + 1 } }).ok, false);
  assert.strictEqual(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { ownerId: 'o1' } }).ok, false, 'a client workspace never buys');
  assert.match(bp.canBuySlot({ plan: { tier: 'agency' }, agency: { extraSlots: CAP } }).message, new RegExp(`\\(${AGENCY.maxClients}\\)`));
});

test('ending a slot subscription removes one slot and nothing else', () => {
  const u = bp.endUpdateFor({ kind: 'slot', key: 'client', subscriptionId: 'sub_s' });
  assert.deepStrictEqual(u.$inc, { 'agency.extraSlots': -1 });
  assert.deepStrictEqual(u.$set, { 'plan.subscriptions.$[sub].active': false, 'plan.subscriptions.$[sub].ended': true });
  assert.strictEqual(bp.endUpdateFor({ kind: 'slot', key: 'client', subscriptionId: 'sub_s' }, 'subscription.halted').$set['plan.subscriptions.$[sub].ended'], undefined, 'a halted slot can still be resumed');
  assert.strictEqual(bp.endUpdateFor({ kind: 'plan', key: 'agency' }), null);
  const built = bp.buildEndUpdate({ plan: { subscriptions: [] } }, { kind: 'slot', key: 'client', subscriptionId: 'sub_s' }, 'subscription.cancelled');
  assert.deepStrictEqual(built.update.$inc, { 'agency.extraSlots': -1 });
  assert.deepStrictEqual(built.filter, { 'plan.subscriptions': { $elemMatch: { subscriptionId: 'sub_s', active: true } } }, 'only a slot that is active ends once');
});

// ---------------------------------------------------------------- fakes
const ENV = { RAZORPAY_KEY_ID: 'rzp_test_fake', RAZORPAY_KEY_SECRET: 'test_key_secret', RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret' };
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

function matchFilter(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return v.some((f) => matchFilter(doc, f));
    if (k === '_id') return String(doc._id) === String(v);
    let vals = [doc];
    for (const p of k.split('.')) vals = vals.flatMap((x) => (x == null ? [] : Array.isArray(x[p]) ? x[p] : [x[p]]));
    if (v === null) return vals.every((x) => x == null);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('$ne' in v) return !vals.some((x) => x === v.$ne);
      if ('$in' in v) return v.$in.some((c) => (c === null ? vals.every((x) => x == null) || vals.some((x) => x === null) : vals.some((x) => x === c)));
      if ('$lt' in v) return vals.some((x) => typeof x === 'number' && x < v.$lt);
      if ('$elemMatch' in v) return vals.some((el) => el && typeof el === 'object' && matchFilter(el, v.$elemMatch));
      throw new Error(`fake does not support ${JSON.stringify(v)}`);
    }
    return vals.some((x) => x === v);
  });
}
const getAt = (doc, p) => p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), doc);
function setAt(cur, parts, value, arrayFilters) {
  const [p, ...rest] = parts;
  const m = /^\$\[(\w+)\]$/.exec(p);
  if (m) {
    const f = (arrayFilters || []).find((x) => Object.keys(x)[0].startsWith(m[1] + '.'));
    const [fk, fv] = Object.entries(f)[0];
    const sub = fk.slice(m[1].length + 1);
    for (const el of cur) if (el[sub] === fv) setAt(el, rest, value, arrayFilters);
    return;
  }
  if (rest.length === 0) { cur[p] = value; return; }
  if (cur[p] == null) cur[p] = {};
  setAt(cur[p], rest, value, arrayFilters);
}
function applyUpdate(doc, update, arrayFilters) {
  for (const [k, v] of Object.entries(update.$set || {})) setAt(doc, k.split('.'), v, arrayFilters);
  for (const [k, v] of Object.entries(update.$inc || {})) setAt(doc, k.split('.'), (getAt(doc, k) || 0) + v, arrayFilters);
  for (const [k, v] of Object.entries(update.$push || {})) {
    const parts = k.split('.'); const parent = parts.slice(0, -1).reduce((c, x) => (c[x] = c[x] || {}), doc);
    const key = parts[parts.length - 1]; parent[key] = parent[key] || [];
    if (v && v.$each) parent[key].push(...JSON.parse(JSON.stringify(v.$each))); else parent[key].push(JSON.parse(JSON.stringify(v)));
  }
  for (const [k, v] of Object.entries(update.$addToSet || {})) {
    const parts = k.split('.'); const parent = parts.slice(0, -1).reduce((c, x) => (c[x] = c[x] || {}), doc);
    const key = parts[parts.length - 1]; parent[key] = parent[key] || [];
    for (const item of v.$each) if (!parent[key].includes(item)) parent[key].push(item);
  }
  for (const [k, v] of Object.entries(update.$pull || {})) {
    const parts = k.split('.'); const parent = parts.slice(0, -1).reduce((c, x) => (c[x] = c[x] || {}), doc);
    const key = parts[parts.length - 1]; parent[key] = (parent[key] || []).filter((x) => !v.$in.includes(x));
  }
}
// Reads return copies, like a real database, so a stale read really is stale. Updates are applied to the stored record.
function fakeUserModel(users) {
  const copy = (d) => (d ? structuredClone(d) : null);
  return {
    users,
    async findById(id) { return copy(users.find((u) => String(u._id) === String(id))); },
    async findOne(q) { return copy(users.find((u) => matchFilter(u, q))); },
    async findOneAndUpdate(filter, update, opts = {}) {
      const doc = users.find((u) => matchFilter(u, filter));
      if (!doc) return null;
      applyUpdate(doc, update, opts.arrayFilters);
      return copy(doc);
    },
    async updateOne(filter, update, opts = {}) {
      const doc = users.find((u) => matchFilter(u, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(doc, update, opts.arrayFilters);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filter, update) { users.filter((u) => matchFilter(u, filter)).forEach((u) => applyUpdate(u, update)); },
    find(filter) {
      const rows = () => users.filter((u) => matchFilter(u, filter)).map(copy).sort((a, b) => a.createdAt - b.createdAt);
      return { sort() { return { lean: async () => rows() }; }, lean: async () => rows() };
    }
  };
}
function mkAgency(over = {}) {
  return {
    _id: 'user1', email: 'a@example.com', firstName: 'Asha', lastName: 'K', mobileNumber: '',
    credits: { balance: 100, topupBalance: 0, totalUsed: 0 }, payments: [],
    subscription: { status: 'active', razorpaySubscriptionId: 'sub_plan' },
    plan: { tier: 'agency', addons: [], subscriptionId: 'sub_plan', subscriptions: [{ subscriptionId: 'sub_plan', kind: 'plan', key: 'agency', razorpayPlanId: 'plan_agency', active: true }] },
    agency: { clientCount: 0, extraSlots: 0 },
    ...over
  };
}
const mkFree = (over = {}) => mkAgency({ plan: { tier: 'free', addons: [], subscriptions: [] }, subscription: { status: 'active' }, agency: undefined, ...over });
function mkWorkspace(n, ownerId = 'user1', tier = 'agency') {
  return { _id: `w${n}`, createdAt: new Date(1000 * n), email: `ws-${n}@workspace.invalid`, agency: { ownerId, workspaceName: `Client ${n}`, frozen: false }, plan: { tier, addons: [] }, credits: { balance: 0 } };
}
function fakeRazorpay() {
  const calls = { plans: [], subs: [], cancels: [] };
  const subs = {};
  return {
    calls,
    plans: { create: async (b) => { calls.plans.push(b); return { id: `plan_fake${calls.plans.length}` }; } },
    subscriptions: {
      create: async (b) => { calls.subs.push(b); const s = { id: `sub_fake${calls.subs.length}`, plan_id: b.plan_id, notes: b.notes }; subs[s.id] = s; return s; },
      fetch: async (id) => subs[id],
      cancel: async (id, atEnd) => { calls.cancels.push([id, atEnd]); return { id, status: 'cancelled' }; }
    },
    orders: { create: async () => { throw new Error('no orders here'); }, fetch: async () => null },
    // What Razorpay reports for a payment: set per payment id in `amounts`, otherwise the price the test is about.
    amounts: {}, defaultAmount: undefined,
    payments: { fetch: async function (id) { return { id, amount: Object.prototype.hasOwnProperty.call(this.amounts, id) ? this.amounts[id] : this.defaultAmount }; } }
  };
}
function setup({ user = mkAgency(), extra = [], env = ENV, settle } = {}) {
  const welcomes = []; const invoices = []; const alerts = [];
  const User = fakeUserModel([user, ...extra]);
  const razorpay = fakeRazorpay();
  razorpay.payments.fetch = razorpay.payments.fetch.bind(razorpay);
  const notifies = [];
  const r = createPaymentRouter({
    razorpay, User, env, alert: (c, d) => alerts.push([c, d]), ...(settle ? { settle: settle(User) } : {}),
    notifyNow: async (m) => { notifies.push(m); return true; },
    protect: (req, res, next) => next(),
    Coupon: { findOne: async () => null, findOneAndUpdate: async () => null },
    createInvoice: async (p) => { invoices.push(p); return { invoiceNumber: 'INV-1', invoiceUrl: 'https://invoice.example/1' }; },
    sendWelcome: async (u, info) => { welcomes.push({ email: u.email, ...info }); return { sent: true }; }
  });
  return { r, User, razorpay, invoices, user, welcomes, alerts, notifies };
}
const stored = (ctx, id = 'user1') => ctx.User.users.find((u) => String(u._id) === id);
function handlerOf(r, method, p) {
  const layer = r.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  assert.ok(layer, `${method} ${p} is registered`);
  const st = layer.route.stack; return st[st.length - 1].handle;
}
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function call(r, method, p, req) {
  const res = mkRes();
  const q = [console.error, console.log, console.warn];
  console.error = console.log = console.warn = () => {};
  try { await handlerOf(r, method, p)({ headers: {}, body: {}, user: { userId: 'user1' }, ...req }, res); }
  finally { [console.error, console.log, console.warn] = q; }
  return res;
}
function hook(event, subId, planId, payId, { amount = 0, notes } = {}) {
  return {
    event,
    payload: {
      subscription: { entity: { id: subId, plan_id: planId, notes: notes || { userId: 'user1' }, current_end: 1900000000, charge_at: 1902600000 } },
      ...(payId ? { payment: { entity: { id: payId, amount } } } : {})
    }
  };
}
function sendHook(r, body, { secret = ENV.RAZORPAY_WEBHOOK_SECRET, sig } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  return call(r, 'post', '/webhook', { headers: { 'x-razorpay-signature': sig === undefined ? hmac(secret, raw) : sig }, body: raw });
}
async function startSlot(ctx) {
  const res = await call(ctx.r, 'post', '/create-slot-subscription', {});
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  const created = ctx.razorpay.calls.subs[ctx.razorpay.calls.subs.length - 1];
  ctx.razorpay.defaultAmount = res.body.amount;
  return { id: res.body.subscription_id, planId: created.plan_id, res };
}
async function startAgency(ctx) {
  const res = await call(ctx.r, 'post', '/create-subscription', { body: { planId: 'agency' } });
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  const created = ctx.razorpay.calls.subs[ctx.razorpay.calls.subs.length - 1];
  ctx.razorpay.defaultAmount = res.body.amount;
  return { id: res.body.subscription_id, planId: created.plan_id, res };
}
const SLOT_PAISE = chargePaise(AGENCY.slot.inr);
const AGENCY_PAISE = chargePaise(PLANS.agency.inr);
const slotCharge = (s, payId, amount = SLOT_PAISE) => hook('subscription.charged', s.id, s.planId, payId, { amount });

// ---------------------------------------------------------------- buying the agency plan
test('create-subscription for the agency plan charges the configured price plus GST and names the plan plainly', async () => {
  const ctx = setup({ user: mkFree() });
  const s = await startAgency(ctx);
  assert.strictEqual(ctx.razorpay.calls.plans[0].item.amount, AGENCY_PAISE);
  assert.strictEqual(ctx.razorpay.calls.plans[0].item.name, 'Nebulaa Agency subscription');
  assert.strictEqual(s.res.body.amount, AGENCY_PAISE);
  assert.strictEqual(s.res.body.gstPaise, gstPaise(PLANS.agency.inr));
  assert.deepStrictEqual(s.res.body.plan, { id: 'agency', tier: 'agency', quarks: PLANS.agency.quarks });
  const rec = stored(ctx).plan.subscriptions[0];
  assert.deepStrictEqual([rec.kind, rec.key, rec.active], ['plan', 'agency', false]);
});

test('RAZORPAY_PLAN_ID_AGENCY and RAZORPAY_PLAN_ID_SLOT are used when set, and nothing is created at Razorpay', async () => {
  const ctx = setup({ user: mkFree(), env: { ...ENV, RAZORPAY_PLAN_ID_AGENCY: 'plan_env_agency', RAZORPAY_PLAN_ID_SLOT: 'plan_env_slot' } });
  await startAgency(ctx);
  assert.strictEqual(ctx.razorpay.calls.subs[0].plan_id, 'plan_env_agency');
  stored(ctx).plan = { tier: 'agency', addons: [], subscriptions: [] };
  await startSlot(ctx);
  assert.strictEqual(ctx.razorpay.calls.subs[1].plan_id, 'plan_env_slot');
  assert.strictEqual(ctx.razorpay.calls.plans.length, 0);
});

test('a managed account cannot buy the agency plan by mistake, and nothing is created', async () => {
  const ctx = setup({ user: mkFree({ plan: { addons: [], subscriptions: [] } }) }); // no tier: managed
  const res = await call(ctx.r, 'post', '/create-subscription', { body: { planId: 'agency' } });
  assert.strictEqual(res.code, 400);
  assert.match(res.body.message, /managed by Nebulaa/);
  assert.strictEqual(ctx.razorpay.calls.subs.length, 0);
  assert.strictEqual(ctx.razorpay.calls.plans.length, 0);
});

test('the agency plan webhook grants the configured Quarks, mirrors the plan to clients and sends one welcome', async () => {
  const ws = [1, 2].map((n) => mkWorkspace(n, 'user1', 'free'));
  const ctx = setup({ user: mkFree({ agency: { clientCount: 2, extraSlots: 0 } }), extra: ws });
  const s = await startAgency(ctx);
  const ev = hook('subscription.charged', s.id, s.planId, 'pay_A', { amount: AGENCY_PAISE });
  ev.payload.payment.entity.notes = { quarks: 99999 };
  assert.strictEqual((await sendHook(ctx.r, ev)).code, 200);
  const u = stored(ctx);
  assert.strictEqual(u.plan.tier, 'agency');
  assert.strictEqual(u.credits.balance, 100 + PLANS.agency.quarks);
  assert.strictEqual(u.payments.length, 1);
  assert.strictEqual(u.payments[0].credits, PLANS.agency.quarks);
  assert.strictEqual(u.payments[0].exGstAmount, PLANS.agency.inr);
  assert.strictEqual(ctx.invoices[0].itemName, 'Nebulaa Agency subscription');
  assert.strictEqual(ctx.invoices[0].amount, PLANS.agency.inr);
  assert.strictEqual(ctx.invoices[0].totalAmount, AGENCY_PAISE / 100);
  assert.deepStrictEqual(ctx.welcomes, [{ email: 'a@example.com', tier: 'agency', quarks: PLANS.agency.quarks }]);
  assert.ok(ctx.User.users.filter((x) => x.agency && x.agency.ownerId).every((w) => w.plan.tier === 'agency'), 'clients mirror the plan');
  // replay of the same payment id, and a renewal
  await sendHook(ctx.r, ev);
  assert.strictEqual(u.credits.balance, 100 + PLANS.agency.quarks);
  assert.strictEqual(ctx.invoices.length, 1);
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_B', { amount: AGENCY_PAISE }));
  assert.strictEqual(ctx.welcomes.length, 1, 'welcome only once');
  assert.strictEqual(ctx.welcomes.length, 1);
});

test('agency plan webhook: a forged amount, a forged plan id or another owner grants nothing', async () => {
  const ctx = setup({ user: mkFree() });
  const s = await startAgency(ctx);
  const grants = () => [stored(ctx).credits.balance, stored(ctx).payments.filter((p) => p.status === 'paid').length, stored(ctx).plan.tier];
  const before = grants();
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_low', { amount: chargePaise(PLANS.starter.inr) }))).code, 200);
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, 'plan_other', 'pay_p', { amount: AGENCY_PAISE }))).code, 200);
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_o', { amount: AGENCY_PAISE, notes: { userId: 'someone' } }))).code, 200);
  assert.deepStrictEqual(grants(), before);
  assert.ok(ctx.alerts.some(([c, d]) => c === 'payment' && /amount/.test(d)), 'the owner is told about the mismatch');
});

// ---------------------------------------------------------------- buying a slot
test('create-slot-subscription charges the configured price plus GST and records a slot', async () => {
  const ctx = setup();
  const s = await startSlot(ctx);
  assert.strictEqual(ctx.razorpay.calls.plans[0].item.amount, SLOT_PAISE);
  assert.strictEqual(ctx.razorpay.calls.plans[0].item.name, 'Nebulaa extra client');
  assert.deepStrictEqual(ctx.razorpay.calls.subs[0].notes, { userId: 'user1', email: 'a@example.com', slot: 'client' });
  assert.strictEqual(ctx.razorpay.calls.subs[0].total_count, 120);
  assert.deepStrictEqual(Object.keys(s.res.body).sort(), ['amount', 'gstPaise', 'key', 'prefill', 'slot', 'subscription_id', 'success']);
  assert.strictEqual(s.res.body.amount, SLOT_PAISE);
  assert.strictEqual(s.res.body.gstPaise, gstPaise(AGENCY.slot.inr));
  assert.strictEqual(s.res.body.key, ENV.RAZORPAY_KEY_ID);
  assert.deepStrictEqual(s.res.body.slot, { id: 'client', quarks: AGENCY.slot.quarks });
  const rec = stored(ctx).plan.subscriptions.find((x) => x.kind === 'slot');
  assert.deepStrictEqual([rec.key, rec.active, rec.subscriptionId], ['client', false, s.id]);
  assert.ok(rec.razorpayPlanId);
});

test('create-slot-subscription refuses non-agency accounts, accounts at the most clients and client workspaces', async () => {
  for (const [label, user] of [
    ['free', mkFree()],
    ['growth', mkFree({ plan: { tier: 'professional', addons: [], subscriptions: [] } })],
    ['managed', mkFree({ plan: { addons: [], subscriptions: [] } })],
    ['at the most', mkAgency({ agency: { clientCount: 25, extraSlots: CAP } })]
  ]) {
    const ctx = setup({ user });
    const res = await call(ctx.r, 'post', '/create-slot-subscription', {});
    assert.strictEqual(res.code, 400, label);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(ctx.razorpay.calls.subs.length, 0, label);
  }
  const ws = setup({ user: mkAgency({ agency: { ownerId: 'owner9', workspaceName: 'X' } }) });
  const res = await call(ws.r, 'post', '/create-slot-subscription', {});
  assert.strictEqual(res.code, 403);
  assert.strictEqual(ws.razorpay.calls.subs.length, 0);
  assert.strictEqual(ws.razorpay.calls.plans.length, 0);
});

test('a client workspace can never start any billing', async () => {
  const mk = () => setup({ user: mkAgency({ plan: { tier: 'agency', addons: [], subscriptions: [] }, agency: { ownerId: 'owner9', workspaceName: 'X' } }) });
  for (const [p, body] of [['/create-subscription', { planId: 'agency' }], ['/create-subscription', { planId: 'starter' }], ['/create-addon-subscription', { addon: 'publish' }], ['/create-slot-subscription', {}], ['/create-order', { packInr: 500 }]]) {
    const ctx = mk();
    const res = await call(ctx.r, 'post', p, { body });
    assert.strictEqual(res.code, 403, p);
    assert.strictEqual(ctx.razorpay.calls.subs.length, 0, p);
    assert.strictEqual(ctx.razorpay.calls.plans.length, 0, p);
  }
  // and the pass rules refuse every payment route before the handler is reached
  for (const p of ['create-subscription', 'create-addon-subscription', 'create-slot-subscription', 'create-order', 'verify', 'verify-subscription', 'cancel-subscription', 'billing-details', 'retry-invoices']) {
    for (const url of [`/api/payment/${p}`, `/API/PAYMENT/${p}`, `/api/payment/${p}?x=1`, `/api/%70ayment/${p}`]) {
      assert.strictEqual(isBlockedInsideClient(url, 'POST'), true, url);
    }
  }
});

test('slot webhook: the first payment adds one client and the configured Quarks, once', async () => {
  const ctx = setup();
  const s = await startSlot(ctx);
  const ev = slotCharge(s, 'pay_s1');
  ev.payload.payment.entity.notes = { quarks: 99999, slots: 99 };
  assert.strictEqual((await sendHook(ctx.r, ev)).code, 200);
  const u = stored(ctx);
  assert.strictEqual(u.agency.extraSlots, 1);
  assert.strictEqual(u.credits.balance, 100 + AGENCY.slot.quarks);
  assert.strictEqual(u.credits.planBalance, AGENCY.slot.quarks);
  assert.ok(!u.credits.topupBalance, 'the top-up bucket is untouched');
  assert.strictEqual(u.credits.topupExpiresAt, undefined);
  assert.strictEqual(u.plan.subscriptions.find((x) => x.kind === 'slot').active, true);
  assert.strictEqual(u.plan.tier, 'agency', 'the plan is untouched');
  assert.strictEqual(u.payments[0].credits, AGENCY.slot.quarks);
  assert.strictEqual(u.payments[0].exGstAmount, AGENCY.slot.inr);
  assert.strictEqual(ctx.invoices[0].itemName, 'Nebulaa extra client');
  assert.strictEqual(ctx.invoices[0].amount, AGENCY.slot.inr);
  assert.strictEqual(ctx.welcomes.length, 0, 'no welcome email for a slot');
  assert.strictEqual(ag.clientLimitOf(u), AGENCY.includedClients + 1);
  // the same payment id again grants nothing
  await sendHook(ctx.r, ev);
  assert.strictEqual(u.agency.extraSlots, 1);
  assert.strictEqual(u.credits.balance, 100 + AGENCY.slot.quarks);
  assert.strictEqual(u.payments.length, 1);
  assert.strictEqual(ctx.invoices.length, 1);
});

test('slot renewal grants no Quarks and never another slot, but records each payment', async () => {
  const ctx = setup();
  const s = await startSlot(ctx);
  await sendHook(ctx.r, slotCharge(s, 'pay_s1'));
  await sendHook(ctx.r, slotCharge(s, 'pay_s2'));
  await sendHook(ctx.r, slotCharge(s, 'pay_s3'));
  const u = stored(ctx);
  assert.strictEqual(u.agency.extraSlots, 1);
  assert.strictEqual(u.credits.balance, 100 + AGENCY.slot.quarks, 'only the first payment grants');
  assert.deepStrictEqual(u.payments.map((x) => x.credits), [AGENCY.slot.quarks, 0, 0]);
  assert.strictEqual(u.payments.length, 3);
});

test('double activation: verify and the webhook for the same payment, and two payments racing, add one slot', async () => {
  const ctx = setup();
  const s = await startSlot(ctx);
  const sig = hmac(ENV.RAZORPAY_KEY_SECRET, `pay_first|${s.id}`);
  const v = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_first', razorpay_subscription_id: s.id, razorpay_signature: sig } });
  assert.strictEqual(v.code, 200, JSON.stringify(v.body));
  await sendHook(ctx.r, slotCharge(s, 'pay_first'));
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
  assert.strictEqual(stored(ctx).credits.balance, 100 + AGENCY.slot.quarks);
  // a second subscription, two different payments arriving at the same moment while it is still inactive
  const ctx2 = setup();
  const s2 = await startSlot(ctx2);
  await Promise.all([sendHook(ctx2.r, slotCharge(s2, 'pay_x')), sendHook(ctx2.r, slotCharge(s2, 'pay_y'))]);
  assert.strictEqual(stored(ctx2).agency.extraSlots, 1);
  assert.strictEqual(stored(ctx2).credits.balance, 100 + AGENCY.slot.quarks);
  assert.strictEqual(stored(ctx2).payments.length, 2);
});

test('verify-subscription for a slot: response shape, replay, bad signature, unknown subscription', async () => {
  const ctx = setup();
  const s = await startSlot(ctx);
  const body = { razorpay_payment_id: 'pay_v1', razorpay_subscription_id: s.id, razorpay_signature: hmac(ENV.RAZORPAY_KEY_SECRET, `pay_v1|${s.id}`) };
  const ok = await call(ctx.r, 'post', '/verify-subscription', { body });
  assert.strictEqual(ok.code, 200);
  assert.deepStrictEqual(ok.body, { success: true, alreadyProcessed: false, message: 'Your extra client is added.', kind: 'slot', key: 'client', quarksGranted: AGENCY.slot.quarks, balance: 100 + AGENCY.slot.quarks, clientLimit: AGENCY.includedClients + 1 });
  const again = await call(ctx.r, 'post', '/verify-subscription', { body });
  assert.strictEqual(again.body.alreadyProcessed, true);
  assert.strictEqual(again.body.quarksGranted, 0);
  assert.strictEqual(again.body.clientLimit, AGENCY.includedClients + 1);
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
  const bad = await call(ctx.r, 'post', '/verify-subscription', { body: { ...body, razorpay_payment_id: 'pay_v2', razorpay_signature: 'nope' } });
  assert.strictEqual(bad.code, 400);
  const noSecret = setup({ env: { RAZORPAY_KEY_ID: 'k' } });
  const s3 = await startSlot(noSecret);
  const ns = await call(noSecret.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'p', razorpay_subscription_id: s3.id, razorpay_signature: hmac('', `p|${s3.id}`) } });
  assert.strictEqual(ns.code, 400);
  const unknown = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_u', razorpay_subscription_id: 'sub_unknown', razorpay_signature: hmac(ENV.RAZORPAY_KEY_SECRET, 'pay_u|sub_unknown') } });
  assert.ok(unknown.code >= 400);
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
  assert.strictEqual(stored(ctx).credits.balance, 100 + AGENCY.slot.quarks);
});

test('verify-subscription for the agency plan answers with the plan and the client limit', async () => {
  const ctx = setup({ user: mkFree() });
  const s = await startAgency(ctx);
  const v = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_a', razorpay_subscription_id: s.id, razorpay_signature: hmac(ENV.RAZORPAY_KEY_SECRET, `pay_a|${s.id}`) } });
  assert.strictEqual(v.code, 200, JSON.stringify(v.body));
  assert.strictEqual(v.body.kind, 'plan'); assert.strictEqual(v.body.key, 'agency');
  assert.strictEqual(v.body.message, 'Your plan is active.');
  assert.strictEqual(v.body.quarksGranted, PLANS.agency.quarks);
  assert.strictEqual(v.body.clientLimit, AGENCY.includedClients);
});

test('slot webhook: bad signature, no signature and no configured secret grant nothing', async () => {
  const ctx = setup();
  const s = await startSlot(ctx);
  const ev = slotCharge(s, 'pay_s1');
  assert.strictEqual((await sendHook(ctx.r, ev, { secret: 'wrong' })).code, 400);
  assert.strictEqual((await sendHook(ctx.r, ev, { sig: '' })).code, 400);
  const noSecret = setup({ env: { RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' } });
  const s2 = await startSlot(noSecret);
  const res = await sendHook(noSecret.r, slotCharge(s2, 'pay_s2'), { sig: 'anything' });
  assert.strictEqual(res.code, 503);
  for (const c of [ctx, noSecret]) {
    assert.strictEqual(stored(c).agency.extraSlots, 0);
    assert.strictEqual(stored(c).credits.balance, 100);
    assert.strictEqual(stored(c).payments.length, 0);
  }
});

test('slot webhook: a forged amount, plan id, owner, slot key or event grants nothing', async () => {
  const ctx = setup();
  const s = await startSlot(ctx);
  const before = () => JSON.stringify([stored(ctx).agency, stored(ctx).credits.balance, stored(ctx).payments.filter((p) => p.status === 'paid')]);
  const snap = before();
  for (const amount of [1, SLOT_PAISE - 1, SLOT_PAISE + 1, AGENCY_PAISE]) {
    assert.strictEqual((await sendHook(ctx.r, slotCharge(s, `pay_a${amount}`, amount))).code, 200);
  }
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, 'plan_forged', 'pay_p', { amount: SLOT_PAISE }))).code, 200);
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_o', { amount: SLOT_PAISE, notes: { userId: 'someone' } }))).code, 200);
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', 'sub_unknown', s.planId, 'pay_u', { amount: SLOT_PAISE }))).code, 200);
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, null))).code, 200);
  stored(ctx).plan.subscriptions.find((x) => x.kind === 'slot').key = 'client2'; // a stored record with an unknown slot id
  assert.strictEqual((await sendHook(ctx.r, slotCharge(s, 'pay_k'))).code, 200);
  stored(ctx).plan.subscriptions.find((x) => x.kind === 'slot').key = 'client';
  assert.strictEqual(before(), snap);
});

test('slot webhook: a payment with no agency plan grants nothing, the owner is told and the subscription is stopped', async () => {
  for (const user of [mkFree(), mkFree({ plan: { tier: 'professional', addons: [], subscriptions: [] } })]) {
    const ctx = setup({ user: mkAgency() });
    const s = await startSlot(ctx); // bought while on the agency plan
    stored(ctx).plan.tier = user.plan.tier; // the plan has since ended
    const res = await sendHook(ctx.r, slotCharge(s, 'pay_late'));
    assert.strictEqual(res.code, 200);
    const u = stored(ctx);
    assert.strictEqual(u.agency.extraSlots, 0);
    assert.strictEqual(u.credits.balance, 100);
    assert.strictEqual(u.payments.filter((p) => p.status === 'paid').length, 0);
    assert.strictEqual(u.payments.filter((p) => p.status === 'failed' && p.needsRefund && p.reason === 'no_agency_plan').length, 1, 'recorded for staff');
    assert.strictEqual(ctx.invoices.length, 0);
    assert.ok(ctx.alerts.some(([c, d]) => c === 'payment' && /pay_late/.test(d)), 'the owner is told');
    assert.strictEqual(ctx.notifies.length, 1, 'and emailed at once');
    assert.deepStrictEqual(ctx.razorpay.calls.cancels, [[s.id, 0]], 'further charges are stopped');
  }
});

test('slot webhook: a client workspace record cannot receive a slot', async () => {
  const ctx = setup({ user: mkAgency() });
  const s = await startSlot(ctx);
  stored(ctx).agency.ownerId = 'owner9';
  await sendHook(ctx.r, slotCharge(s, 'pay_w'));
  assert.strictEqual(stored(ctx).agency.extraSlots, 0);
  assert.strictEqual(stored(ctx).credits.balance, 100);
});

test('slot webhook: a slot beyond the most clients grants nothing', async () => {
  const ctx = setup({ user: mkAgency({ agency: { clientCount: 24, extraSlots: CAP - 1 } }) });
  const a = await startSlot(ctx);
  const b = await startSlot(ctx); // two checkouts open at once, only one may complete
  await sendHook(ctx.r, slotCharge(a, 'pay_a'));
  assert.strictEqual(stored(ctx).agency.extraSlots, CAP);
  const bal = stored(ctx).credits.balance;
  assert.strictEqual((await sendHook(ctx.r, slotCharge(b, 'pay_b'))).code, 200);
  assert.strictEqual(stored(ctx).agency.extraSlots, CAP, 'never above the most');
  assert.strictEqual(ag.clientLimitOf(stored(ctx)), AGENCY.maxClients);
  assert.strictEqual(stored(ctx).credits.balance, bal);
  assert.strictEqual(stored(ctx).payments.filter((p) => p.status === 'paid').length, 1);
  assert.ok(ctx.alerts.some(([, d]) => /pay_b/.test(d)));
  assert.deepStrictEqual(ctx.razorpay.calls.cancels, [[b.id, 0]]);
  // verify path refuses the same way and says so
  const v = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_c', razorpay_subscription_id: b.id, razorpay_signature: hmac(ENV.RAZORPAY_KEY_SECRET, `pay_c|${b.id}`) } });
  assert.strictEqual(v.code, 409);
  assert.strictEqual(v.body.success, false);
  assert.doesNotMatch(v.body.message, /!|—|credit|trial/i);
  assert.match(v.body.message, /most clients/, 'the at-limit reason is the one given');
  assert.strictEqual(stored(ctx).agency.extraSlots, CAP);
});

test('the cap holds when extraSlots is missing on an older account and the payment arrives', async () => {
  const ctx = setup({ user: mkAgency({ agency: undefined }) });
  const s = await startSlot(ctx);
  await sendHook(ctx.r, slotCharge(s, 'pay_m'));
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
});

// ---------------------------------------------------------------- ending
test('cancelling a slot lowers the limit once, never deletes clients and freezes the newest above the limit', async () => {
  const ws = [1, 2, 3, 4, 5, 6].map((n) => mkWorkspace(n));
  const ctx = setup({ user: mkAgency({ agency: { clientCount: 6, extraSlots: 0 } }), extra: ws });
  const s = await startSlot(ctx);
  await sendHook(ctx.r, slotCharge(s, 'pay_s1'));
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
  assert.ok(ws.every((w) => w.agency.frozen === false), 'six clients fit in six places');
  const cancelled = hook('subscription.cancelled', s.id, s.planId, null);
  assert.strictEqual((await sendHook(ctx.r, cancelled)).code, 200);
  const u = stored(ctx);
  assert.strictEqual(u.agency.extraSlots, 0);
  assert.strictEqual(u.agency.clientCount, 6, 'no client is removed');
  assert.strictEqual(ctx.User.users.filter((x) => x.agency && x.agency.ownerId).length, 6);
  assert.deepStrictEqual(ws.map((w) => w.agency.frozen), [false, false, false, false, false, true], 'the newest is frozen');
  assert.strictEqual(u.plan.tier, 'agency', 'the plan stays');
  assert.strictEqual(u.plan.subscriptions.find((x) => x.kind === 'slot').active, false);
  // the same event again, and the halted and completed events for it, change nothing more
  for (const e of ['subscription.cancelled', 'subscription.halted', 'subscription.completed']) await sendHook(ctx.r, hook(e, s.id, s.planId, null));
  assert.strictEqual(u.agency.extraSlots, 0);
  assert.strictEqual(u.agency.clientCount, 6);
  // buying a new slot unfreezes it again
  const s2 = await startSlot(ctx);
  await sendHook(ctx.r, slotCharge(s2, 'pay_s9'));
  assert.deepStrictEqual(ws.map((w) => w.agency.frozen), [false, false, false, false, false, false]);
});

test('a slot that was never paid ends without lowering the limit', async () => {
  const ctx = setup({ user: mkAgency({ agency: { clientCount: 1, extraSlots: 2 } }) });
  const s = await startSlot(ctx);
  await sendHook(ctx.r, hook('subscription.cancelled', s.id, s.planId, null));
  assert.strictEqual(stored(ctx).agency.extraSlots, 2);
});

test('extraSlots never goes below zero', async () => {
  const ctx = setup({ user: mkAgency({ agency: { clientCount: 0, extraSlots: 0 } }) });
  const s = await startSlot(ctx);
  stored(ctx).plan.subscriptions.find((x) => x.kind === 'slot').active = true; // an inconsistent record
  await sendHook(ctx.r, hook('subscription.cancelled', s.id, s.planId, null));
  assert.strictEqual(stored(ctx).agency.extraSlots, 0);
});

test('the agency plan ending (cancelled or halted) freezes every client, stops the slots and deletes nothing', async () => {
  for (const event of ['subscription.cancelled', 'subscription.halted', 'subscription.completed']) {
    const ws = [1, 2, 3].map((n) => mkWorkspace(n));
    const ctx = setup({ user: mkAgency({ agency: { clientCount: 3, extraSlots: 0 } }), extra: ws });
    const s = await startSlot(ctx);
    await sendHook(ctx.r, slotCharge(s, 'pay_s1'));
    assert.strictEqual(stored(ctx).agency.extraSlots, 1);
    assert.strictEqual((await sendHook(ctx.r, hook(event, 'sub_plan', 'plan_agency', null))).code, 200);
    const u = stored(ctx);
    assert.strictEqual(u.plan.tier, 'free', event);
    assert.strictEqual(u.agency.extraSlots, 0, event);
    assert.strictEqual(u.agency.clientCount, 3, `${event}: nothing deleted`);
    assert.strictEqual(u.plan.subscriptions.find((x) => x.kind === 'slot').active, false);
    assert.deepStrictEqual(ctx.razorpay.calls.cancels, [[s.id, 0]], 'the slot stops billing with the plan');
    assert.ok(ws.every((w) => w.agency.frozen === true && w.plan.tier === 'free'), `${event}: every client is frozen`);
    assert.strictEqual(ctx.User.users.length, 4);
    // the slot's own cancel event arriving afterwards does not lower anything twice
    await sendHook(ctx.r, hook('subscription.cancelled', s.id, s.planId, null));
    assert.strictEqual(u.agency.extraSlots, 0);
    // a late slot payment on the ended plan grants nothing
    await sendHook(ctx.r, slotCharge(s, 'pay_after'));
    assert.strictEqual(u.credits.balance, 100 + AGENCY.slot.quarks);
  }
});

test('buying the agency plan again unfreezes the clients that fit', async () => {
  const ws = [1, 2, 3].map((n) => Object.assign(mkWorkspace(n, 'user1', 'free'), { agency: { ownerId: 'user1', workspaceName: `C${n}`, frozen: true } }));
  const ctx = setup({ user: mkFree({ agency: { clientCount: 3, extraSlots: 0 } }), extra: ws });
  const s = await startAgency(ctx);
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_re', { amount: AGENCY_PAISE }));
  assert.ok(ws.every((w) => w.agency.frozen === false && w.plan.tier === 'agency'));
});

test('cancel-subscription on an agency plan stops its extra client slots at the end of the month too', async () => {
  const ctx = setup({ user: mkAgency({ subscription: { status: 'active', razorpaySubscriptionId: 'sub_plan', currentPeriodEnd: new Date(1900000000000) } }) });
  const s = await startSlot(ctx);
  await sendHook(ctx.r, slotCharge(s, 'pay_s1'));
  const res = await call(ctx.r, 'post', '/cancel-subscription', {});
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(ctx.razorpay.calls.cancels.sort(), [['sub_plan', 1], [s.id, 1]].sort());
});

test('a halted or cancelled subscription event for an unknown subscription changes nothing', async () => {
  const ctx = setup();
  const snap = JSON.stringify(stored(ctx));
  await sendHook(ctx.r, hook('subscription.cancelled', 'sub_unknown', 'plan_x', null));
  assert.strictEqual(JSON.stringify(stored(ctx)), snap);
});

// ---------------------------------------------------------------- the rest of billing knows the new items
test('the welcome email for the agency plan is plain and states the clients included', () => {
  const we = require('../services/welcomeEmail');
  const m = we.buildWelcomeEmail({ firstName: 'Asha', tier: 'agency', quarks: PLANS.agency.quarks });
  assert.ok(m);
  assert.match(m.subject, /Agency plan is active/);
  assert.ok(m.text.includes(`${AGENCY.includedClients} client`));
  assert.ok(m.text.includes(PLANS.agency.quarks.toLocaleString('en-US')));
  assert.doesNotMatch(m.text, /add-ons\. You can add any|!|—|credit|trial|razorpay|zoho|ayrshare/i);
  assert.ok(we.buildWelcomeEmail({ firstName: 'A', tier: 'starter', quarks: 600 }).text.includes('are add-ons'), 'other plans keep their email');
});

test('renewal reminders cover the agency plan and add the extra client slots to the next charge', () => {
  const rr = require('../services/renewalReminders');
  const user = {
    email: 'a@example.com', firstName: 'A', subscription: { status: 'active', nextBillingAt: new Date(Date.now() + 3 * 86400000) },
    plan: { tier: 'agency', subscriptions: [
      { kind: 'plan', key: 'agency', active: true }, { kind: 'slot', key: 'client', active: true }, { kind: 'slot', key: 'client', active: true }, { kind: 'slot', key: 'client', active: false }
    ] }
  };
  assert.strictEqual(rr.nextChargePaise(user), AGENCY_PAISE + 2 * SLOT_PAISE);
  assert.strictEqual(rr.isDue(user), true);
  const mail = rr.buildReminderEmail({ user });
  assert.match(mail.subject, /Agency plan renews/);
  assert.doesNotMatch(mail.text, /!|—|credit|trial/i);
});

test('the staff money page counts agency accounts and slots instead of failing', () => {
  const money = require('../services/staff/money');
  const mix = money._planMixOf ? money._planMixOf([{ plan: { tier: 'agency', subscriptions: [{ kind: 'plan', key: 'agency', active: true }, { kind: 'slot', key: 'client', active: true }] } }]) : null;
  assert.ok(mix, 'planMixOf is exported for tests');
  assert.strictEqual(mix.tiers.find((t) => t.id === 'agency').count, 1);
  assert.strictEqual(mix.monthlyRecurring.exGstPaise, (PLANS.agency.inr + AGENCY.slot.inr) * 100);
});

test('the ops scripts know the two new plan id names (read only check of the text)', () => {
  const dir = path.join(__dirname, '..', '..', 'docs', 'superpowers', 'ops');
  const allow = fs.readFileSync(path.join(dir, 'set-secret-value.sh'), 'utf8');
  const check = fs.readFileSync(path.join(dir, 'check-secret-keys.sh'), 'utf8');
  for (const name of ['RAZORPAY_PLAN_ID_AGENCY', 'RAZORPAY_PLAN_ID_SLOT']) {
    assert.ok(/^ALLOWED="[^"]*"/m.exec(allow)[0].split(/[ "=]/).includes(name), `${name} is allowed`);
    assert.ok(/^OPTIONAL="[^"]*"/m.exec(check)[0].split(/[ "=]/).includes(name), `${name} is checked as optional`);
  }
});

// ================================================================ fix round: refused payments, verify amount, stored price
const verifyBody = (payId, subId) => ({ body: { razorpay_payment_id: payId, razorpay_subscription_id: subId, razorpay_signature: hmac(ENV.RAZORPAY_KEY_SECRET, `${payId}|${subId}`) } });
const paidRows = (u) => (u.payments || []).filter((p) => p.status === 'paid');
const failedRows = (u) => (u.payments || []).filter((p) => p.status === 'failed');
// Nothing but the money state, with the refused-payment records left out, to prove a refusal changes none of it.
const moneyState = (u) => JSON.stringify([u.agency, u.credits, u.plan, paidRows(u)]);

test('a slot payment refused at the limit is recorded for staff with everything needed to refund it, and the owner is emailed at once', async () => {
  const ctx = setup({ user: mkAgency({ agency: { clientCount: 24, extraSlots: CAP - 1 } }) });
  const a = await startSlot(ctx);
  const b = await startSlot(ctx);
  await sendHook(ctx.r, slotCharge(a, 'pay_a'));
  await sendHook(ctx.r, slotCharge(b, 'pay_b'));
  const rows = failedRows(stored(ctx));
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  assert.strictEqual(row.razorpayPaymentId, 'pay_b');
  assert.strictEqual(row.razorpayOrderId, b.id);
  assert.strictEqual(row.subscriptionId, b.id);
  assert.strictEqual(row.needsRefund, true);
  assert.strictEqual(row.reason, 'at_limit');
  assert.strictEqual(row.amount, SLOT_PAISE / 100);
  assert.ok(row.paidAt, 'the time is stored');
  assert.strictEqual(paidRows(stored(ctx)).length, 1, 'only the first slot payment counts as paid');
  // one email, straight away, naming user, subscription, payment, amount and reason
  assert.strictEqual(ctx.notifies.length, 1);
  const m = ctx.notifies[0];
  for (const needle of ['user1', b.id, 'pay_b', String(SLOT_PAISE / 100), 'at_limit']) assert.ok(`${m.subject} ${m.text}`.includes(needle), needle);
  assert.match(m.key, /pay_b/);
  assert.match(m.text, /refund/i);
  // the same webhook again, and the checkout verify for the same payment: no second record, no second email
  await sendHook(ctx.r, slotCharge(b, 'pay_b'));
  const v = await call(ctx.r, 'post', '/verify-subscription', verifyBody('pay_b', b.id));
  assert.strictEqual(v.code, 409, 'a replayed verify still says the payment was not applied');
  assert.strictEqual(failedRows(stored(ctx)).length, 1);
  assert.strictEqual(ctx.notifies.length, 1);
  assert.strictEqual(stored(ctx).agency.extraSlots, CAP);
});

test('the staff Money failures list shows a refused payment as needing a refund, with the reason in plain words', () => {
  const { buildMoney } = require('../services/staff/money');
  const now = Date.now();
  const u = { _id: 'u1', email: 'a@x.com', companyName: 'Acme', createdAt: new Date(now - 864e5 * 60), plan: { tier: 'agency', addons: [], subscriptions: [{ subscriptionId: 'sub_x', kind: 'slot', key: 'client', active: false }] }, credits: { balance: 1, history: [] },
    payments: [{ razorpayOrderId: 'sub_x', razorpayPaymentId: 'pay_x', amount: SLOT_PAISE / 100, exGstAmount: AGENCY.slot.inr, status: 'failed', needsRefund: true, reason: 'at_limit', subscriptionId: 'sub_x', item: 'Nebulaa extra client', paidAt: new Date(now - 864e5) }] };
  const items = buildMoney({ users: [u], now, ayrshareProfiles: 0 }).failures.payments.items;
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].needsRefund, true);
  assert.match(items[0].reason, /refund/i);
  assert.doesNotMatch(items[0].reason, /razorpay|zoho|at_limit/i);
  assert.strictEqual(items[0].totalPaise, SLOT_PAISE);
});

test('a charge with the wrong amount (webhook) is recorded as needing a refund, emailed once, and never granted', async () => {
  const ctx = setup({ user: mkFree() });
  const s = await startAgency(ctx);
  const wrong = chargePaise(PLANS.starter.inr);
  const snap = moneyState(stored(ctx));
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_low', { amount: wrong }));
  assert.strictEqual(moneyState(stored(ctx)), snap);
  const rows = failedRows(stored(ctx));
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].reason, rows[0].needsRefund, rows[0].amount, rows[0].subscriptionId], ['amount_mismatch', true, wrong / 100, s.id]);
  assert.strictEqual(ctx.notifies.length, 1);
  assert.ok(ctx.notifies[0].text.includes('pay_low') && ctx.notifies[0].text.includes('user1') && ctx.notifies[0].text.includes(s.id));
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_low', { amount: wrong }));
  assert.strictEqual(failedRows(stored(ctx)).length, 1, 'a replayed webhook records nothing more');
  assert.strictEqual(ctx.notifies.length, 1, 'and emails nothing more');
});

test('an email that cannot be sent never fails the webhook or the verify, and the record is still kept', async () => {
  const ctx = setup({ user: mkFree() });
  const s = await startAgency(ctx);
  const r2 = createPaymentRouter({
    razorpay: ctx.razorpay, User: ctx.User, env: ENV, alert: () => {}, notifyNow: async () => { throw new Error('mail down'); },
    protect: (req, res, next) => next(), Coupon: { findOne: async () => null }, createInvoice: async () => ({}), sendWelcome: async () => ({})
  });
  const res = await sendHook(r2, hook('subscription.charged', s.id, s.planId, 'pay_m', { amount: 5 }));
  assert.strictEqual(res.code, 200);
  assert.strictEqual(failedRows(stored(ctx)).length, 1);
  ctx.razorpay.amounts.pay_v = 7;
  const v = await call(r2, 'post', '/verify-subscription', verifyBody('pay_v', s.id));
  assert.strictEqual(v.code, 409);
  assert.strictEqual(failedRows(stored(ctx)).length, 2);
});

test('verify checks the amount Razorpay reports: a wrong amount grants nothing for the agency plan and for a slot', async () => {
  for (const kind of ['agency', 'slot']) {
    const ctx = setup({ user: kind === 'agency' ? mkFree() : mkAgency() });
    const s = kind === 'agency' ? await startAgency(ctx) : await startSlot(ctx);
    const wrong = (kind === 'agency' ? AGENCY_PAISE : SLOT_PAISE) - 100;
    ctx.razorpay.amounts.pay_w = wrong;
    const snap = moneyState(stored(ctx));
    const v = await call(ctx.r, 'post', '/verify-subscription', verifyBody('pay_w', s.id));
    assert.strictEqual(v.code, 409, kind);
    assert.strictEqual(v.body.success, false);
    assert.match(v.body.message, /refund or fix/);
    assert.doesNotMatch(v.body.message, /razorpay|zoho|ayrshare|!|—|credit|trial/i);
    assert.strictEqual(moneyState(stored(ctx)), snap, kind);
    assert.strictEqual(ctx.invoices.length, 0);
    const rows = failedRows(stored(ctx));
    assert.deepStrictEqual([rows.length, rows[0].reason, rows[0].needsRefund, rows[0].amount], [1, 'amount_mismatch', true, wrong / 100], kind);
    assert.strictEqual(ctx.notifies.length, 1);
    // the webhook for the same payment (a correct-looking amount cannot rescue it) records and emails nothing more, and grants nothing
    await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_w', { amount: wrong }));
    assert.strictEqual(failedRows(stored(ctx)).length, 1);
    assert.strictEqual(ctx.notifies.length, 1);
    assert.strictEqual(moneyState(stored(ctx)), snap);
  }
});

test('verify with the right amount grants once, and the webhook for the same payment afterwards (or before) does not grant again', async () => {
  for (const order of ['verify-first', 'webhook-first']) {
    const ctx = setup({ user: mkAgency() });
    const s = await startSlot(ctx);
    const doVerify = () => call(ctx.r, 'post', '/verify-subscription', verifyBody('pay_ok', s.id));
    const doHook = () => sendHook(ctx.r, slotCharge(s, 'pay_ok'));
    if (order === 'verify-first') { await doVerify(); await doHook(); } else { await doHook(); await doVerify(); }
    assert.strictEqual(stored(ctx).agency.extraSlots, 1, order);
    assert.strictEqual(stored(ctx).credits.balance, 100 + AGENCY.slot.quarks, order);
    assert.strictEqual(paidRows(stored(ctx)).length, 1, order);
    assert.strictEqual(failedRows(stored(ctx)).length, 0, order);
    assert.strictEqual(ctx.notifies.length, 0, order);
  }
  const both = setup({ user: mkAgency() });
  const s = await startSlot(both);
  await Promise.all([call(both.r, 'post', '/verify-subscription', verifyBody('pay_r', s.id)), sendHook(both.r, slotCharge(s, 'pay_r'))]);
  assert.strictEqual(stored(both).agency.extraSlots, 1);
  assert.strictEqual(paidRows(stored(both)).length, 1);
});

test('verify grants nothing when the amount cannot be confirmed, and leaves the grant to the webhook', async () => {
  const ctx = setup({ user: mkFree() });
  const s = await startAgency(ctx);
  ctx.razorpay.defaultAmount = undefined;
  const snap = moneyState(stored(ctx));
  const v = await call(ctx.r, 'post', '/verify-subscription', verifyBody('pay_u', s.id));
  assert.strictEqual(v.code, 409);
  assert.strictEqual(moneyState(stored(ctx)), snap);
  assert.strictEqual(failedRows(stored(ctx)).length, 0, 'nothing is recorded as refused: it is only unconfirmed');
  assert.strictEqual(ctx.notifies.length, 0);
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_u', { amount: AGENCY_PAISE }));
  assert.strictEqual(stored(ctx).plan.tier, 'agency');
  assert.strictEqual(paidRows(stored(ctx)).length, 1);
});

test('verify with no active agency plan: 409, the pinned wording, a record with the reason, and the subscription is stopped', async () => {
  const ctx = setup({ user: mkAgency() });
  const s = await startSlot(ctx);
  stored(ctx).plan.tier = 'free'; // the plan ended before the slot payment
  const v = await call(ctx.r, 'post', '/verify-subscription', verifyBody('pay_n', s.id));
  assert.strictEqual(v.code, 409);
  assert.strictEqual(v.body.message, 'We received your payment, but your Agency plan is not active, so the extra client could not be added. Our team has been told and will contact you about a refund.');
  assert.strictEqual(stored(ctx).agency.extraSlots, 0);
  assert.strictEqual(stored(ctx).credits.balance, 100);
  const rows = failedRows(stored(ctx));
  assert.deepStrictEqual([rows.length, rows[0].reason, rows[0].needsRefund], [1, 'no_agency_plan', true]);
  assert.deepStrictEqual(ctx.razorpay.calls.cancels, [[s.id, 0]]);
  assert.strictEqual(ctx.notifies.length, 1);
});

test('the at-limit refusal reason and wording are pinned', async () => {
  const ctx = setup({ user: mkAgency({ agency: { clientCount: 24, extraSlots: CAP } }) });
  const s = await startSlot(ctx).catch(() => null);
  assert.strictEqual(s, null, 'create-slot-subscription itself refuses at the limit');
  // two checkouts open below the limit, the second paid after the first filled the last place
  const ctx2 = setup({ user: mkAgency({ agency: { clientCount: 24, extraSlots: CAP - 1 } }) });
  const a = await startSlot(ctx2); const b = await startSlot(ctx2);
  await sendHook(ctx2.r, slotCharge(a, 'pay_a'));
  const v = await call(ctx2.r, 'post', '/verify-subscription', verifyBody('pay_b', b.id));
  assert.strictEqual(v.code, 409);
  assert.strictEqual(v.body.message, `We received your payment, but your account already has the most clients (${AGENCY.maxClients}), so the extra client could not be added. Our team has been told and will contact you about a refund.`);
  assert.strictEqual(failedRows(stored(ctx2))[0].reason, 'at_limit');
});

test('slot_conflict: when the account keeps changing under the update, nothing is granted, the payment is recorded and emailed, and the slot subscription is stopped', async () => {
  const ctx = setup({ user: mkAgency() });
  const s = await startSlot(ctx);
  const original = ctx.User.findOneAndUpdate;
  let blocked = 0;
  // Every grant attempt (the update that adds a paid payment row) finds the account changed and matches nothing.
  ctx.User.findOneAndUpdate = async (filter, update, opts) => {
    if (update.$push && update.$push.payments && update.$push.payments.status === 'paid') { blocked += 1; return null; }
    return original(filter, update, opts);
  };
  const v = await call(ctx.r, 'post', '/verify-subscription', verifyBody('pay_c', s.id));
  assert.strictEqual(blocked, 2, 'it tries again once with a fresh read');
  assert.strictEqual(v.code, 409);
  assert.strictEqual(v.body.message, 'We received your payment, but could not add the extra client just now. Our team has been told and will contact you.');
  assert.strictEqual(stored(ctx).agency.extraSlots, 0);
  assert.strictEqual(stored(ctx).credits.balance, 100);
  assert.strictEqual(paidRows(stored(ctx)).length, 0);
  const rows = failedRows(stored(ctx));
  assert.deepStrictEqual([rows.length, rows[0].reason, rows[0].needsRefund], [1, 'slot_conflict', true]);
  assert.deepStrictEqual(ctx.razorpay.calls.cancels, [[s.id, 0]]);
  assert.strictEqual(ctx.notifies.length, 1);
  assert.ok(ctx.alerts.some(([c, d]) => c === 'payment' && /pay_c/.test(d) && /slot_conflict/.test(d)));
});

test('the immediate owner alert is deduplicated by payment id through the real alerter, and an alert error is swallowed', async () => {
  const { createAlerter } = require('../services/opsAlerts');
  const sent = [];
  const alerter = createAlerter({ env: { ALERT_EMAILS: 'owner@example.com' }, now: () => 1, send: async (m) => { sent.push(m); } });
  const mk = (id) => ({ key: `refused_payment:${id}`, subject: 's', text: 't', cooldownMs: 1e12 });
  assert.strictEqual(await alerter.notify(mk('pay_1')), true);
  assert.strictEqual(await alerter.notify(mk('pay_1')), false, 'the same payment is not emailed twice');
  assert.strictEqual(await alerter.notify(mk('pay_2')), true, 'another payment is');
  assert.strictEqual(sent.length, 2);
  const broken = createAlerter({ env: { ALERT_EMAILS: 'o@example.com' }, send: async () => { throw new Error('mail down'); } });
  assert.strictEqual(await broken.notify(mk('pay_3')), false);
  // the default alert in the router uses notify with that key and the 'unlimited' cooldown
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'payment.js'), 'utf8');
  assert.match(src, /refused_payment:\$\{/);
});

// ---- the price stored when the subscription was created decides what a charge must be
test('create-subscription stores the price (paise, GST included) on the record for the agency plan and for a slot', async () => {
  const ctx = setup({ user: mkFree() });
  await startAgency(ctx);
  const rec = stored(ctx).plan.subscriptions.find((x) => x.kind === 'plan');
  assert.strictEqual(rec.expectedPaise, AGENCY_PAISE);
  const ctx2 = setup();
  await startSlot(ctx2);
  assert.strictEqual(stored(ctx2).plan.subscriptions.find((x) => x.kind === 'slot').expectedPaise, SLOT_PAISE);
});

test('repricing new sign-ups in config does not break renewals of an existing agency or slot, on the webhook or on verify', async () => {
  const oldSlot = AGENCY.slot.inr; const oldPlan = PLANS.agency.inr;
  try {
    const ctx = setup({ user: mkAgency() });
    const s = await startSlot(ctx);
    const slotPaid = SLOT_PAISE;
    const ctxA = setup({ user: mkFree() });
    const a = await startAgency(ctxA);
    const planPaid = AGENCY_PAISE;
    AGENCY.slot.inr = oldSlot + 500; PLANS.agency.inr = oldPlan + 3000; // the price for new sign-ups goes up
    assert.notStrictEqual(chargePaise(AGENCY.slot.inr), slotPaid);
    // first payment by verify and a renewal by webhook, both at the price stored at purchase
    ctx.razorpay.amounts.pay_1 = slotPaid;
    assert.strictEqual((await call(ctx.r, 'post', '/verify-subscription', verifyBody('pay_1', s.id))).code, 200);
    await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_2', { amount: slotPaid }));
    assert.strictEqual(paidRows(stored(ctx)).length, 2, 'both granted');
    assert.strictEqual(stored(ctx).agency.extraSlots, 1);
    assert.strictEqual(paidRows(stored(ctx))[0].exGstAmount, oldSlot, 'the invoice shows the price the customer signed up at');
    assert.strictEqual(paidRows(stored(ctx))[0].amount, slotPaid / 100);
    assert.strictEqual(ctx.notifies.length, 0);
    await sendHook(ctxA.r, hook('subscription.charged', a.id, a.planId, 'pay_a1', { amount: planPaid }));
    await sendHook(ctxA.r, hook('subscription.charged', a.id, a.planId, 'pay_a2', { amount: planPaid }));
    assert.strictEqual(paidRows(stored(ctxA)).length, 2);
    assert.strictEqual(stored(ctxA).plan.tier, 'agency');
    assert.strictEqual(ctxA.invoices[0].amount, oldPlan);
    // but a charge at today's new price on an old record is the mismatch now
    await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_3', { amount: chargePaise(AGENCY.slot.inr) }));
    assert.strictEqual(paidRows(stored(ctx)).length, 2);
    assert.strictEqual(failedRows(stored(ctx)).length, 1);
    // a new sign-up after the change is stored and charged at the new price
    const fresh = setup();
    await startSlot(fresh);
    assert.strictEqual(stored(fresh).plan.subscriptions.find((x) => x.kind === 'slot').expectedPaise, chargePaise(AGENCY.slot.inr));
  } finally { AGENCY.slot.inr = oldSlot; PLANS.agency.inr = oldPlan; }
});

test('a record made before the price was stored falls back to the price in config today', async () => {
  const ctx = setup({ user: mkAgency() });
  const s = await startSlot(ctx);
  delete stored(ctx).plan.subscriptions.find((x) => x.kind === 'slot').expectedPaise;
  await sendHook(ctx.r, slotCharge(s, 'pay_old', SLOT_PAISE + 1));
  assert.strictEqual(paidRows(stored(ctx)).length, 0);
  assert.strictEqual(failedRows(stored(ctx)).length, 1);
  await sendHook(ctx.r, slotCharge(s, 'pay_old2', SLOT_PAISE));
  assert.strictEqual(paidRows(stored(ctx)).length, 1);
});


// ================================================================ final review fixes (money path)
// Mirrors quarkBuckets.settle against the fake store: expires the plan bucket when due (or forced), with the same balance check.
const fakeSettle = (User) => async (id, now = new Date(), { forcePlan = false } = {}) => {
  const u = await User.findById(id); const c = (u && u.credits) || {};
  const due = forcePlan || (c.planExpiresAt && new Date(c.planExpiresAt) <= now);
  const plan = Math.min(Math.max(0, c.planBalance || 0), Math.max(0, c.balance || 0));
  if (!due || !plan) return { changed: false };
  const doc = await User.findOneAndUpdate({ _id: id, 'credits.balance': c.balance }, { $set: { 'credits.planBalance': 0 }, $inc: { 'credits.balance': -plan } });
  return { changed: !!doc };
};

test('A-I2: retry-invoices never makes a tax invoice for a refused or refunded payment', async () => {
  const base = { razorpayOrderId: 'o', currency: 'INR', credits: 0, paidAt: new Date() };
  const ctx = setup({ user: mkAgency({ payments: [
    { ...base, razorpayPaymentId: 'pay_failed', amount: 1768.82, status: 'failed', needsRefund: true },
    { ...base, razorpayPaymentId: 'pay_refunded', amount: 100, status: 'refunded' },
    { ...base, razorpayPaymentId: 'pay_ok', amount: 100, status: 'paid' }
  ] }) });
  const realFindById = ctx.User.findById.bind(ctx.User);
  ctx.User.findById = async (id) => { const d = await realFindById(id); if (d) d.save = async function () { Object.assign(ctx.User.users[0], { payments: this.payments }); }; return d; };
  const res = await call(ctx.r, 'post', '/retry-invoices', {});
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(ctx.invoices.map((i) => i.razorpayPaymentId), ['pay_ok']);
  assert.ok(!stored(ctx).payments.find((p) => p.razorpayPaymentId === 'pay_failed').invoiceUrl);
});

test('A-I3: a verify and a webhook for the first payment arriving together leave the paid month intact', async () => {
  const ctx = setup({ user: mkFree(), settle: fakeSettle });
  const s = await startAgency(ctx);
  const q = PLANS.agency.quarks;
  let armed = true; const realFindOne = ctx.User.findOne.bind(ctx.User);
  // The webhook reads the account (no payment on it yet); before it carries on, the checkout verify applies the same payment.
  ctx.User.findOne = async (f) => {
    const doc = await realFindOne(f);
    if (armed) { armed = false; const v = await call(ctx.r, 'post', '/verify-subscription', verifyBody('pay_race', s.id)); assert.strictEqual(v.code, 200, JSON.stringify(v.body)); }
    return doc;
  };
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_race', { amount: AGENCY_PAISE }));
  const u = stored(ctx);
  assert.strictEqual(u.credits.planBalance, q, 'the month stays granted');
  assert.strictEqual(u.credits.balance, 100 + q);
  assert.strictEqual(paidRows(u).length, 1);
});

test('A-I3: two copies of the same renewal webhook at once grant once and never wipe the grant', async () => {
  const ctx = setup({ user: mkFree(), settle: fakeSettle });
  const s = await startAgency(ctx);
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_1', { amount: AGENCY_PAISE }));
  const q = PLANS.agency.quarks;
  const ev = () => sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_2', { amount: AGENCY_PAISE }));
  await Promise.all([ev(), ev()]);
  const u = stored(ctx);
  assert.strictEqual(paidRows(u).length, 2);
  assert.strictEqual(u.credits.planBalance, q);
  assert.strictEqual(u.credits.balance, 100 + q);
});

test('A-I3: a renewal replaces what is left of last month, and retries when a spend lands in between', async () => {
  const ctx = setup({ user: mkFree({ credits: { balance: 150, topupBalance: 0, planBalance: 50, totalUsed: 0 } }), settle: fakeSettle });
  const s = await startAgency(ctx);
  const q = PLANS.agency.quarks;
  let reads = 0; const realFindById = ctx.User.findById.bind(ctx.User);
  ctx.User.findById = async (id) => {
    const doc = await realFindById(id); reads += 1;
    if (reads === 2) { const d = ctx.User.users[0]; d.credits.planBalance = 30; d.credits.balance = 130; } // a spend after we read
    return doc;
  };
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_r', { amount: AGENCY_PAISE }));
  const u = stored(ctx);
  assert.strictEqual(u.credits.planBalance, q);
  assert.strictEqual(u.credits.balance, 100 + q, '130 held, 30 of it last month: 100 + the new month');
  assert.ok(u.credits.history.some((h) => h.action === 'plan_quarks_expired' && h.amount === -30));
});

test('N1: a slot never changes a top-up pack end date, whatever the pack holds', () => {
  const rec = { kind: 'slot', key: 'client', subscriptionId: 'sub_s' };
  for (const firstCycle of [true, false]) {
    const u = bp.buildChargeUpdate(rec, { paymentId: 'p1', paidPaise: 1, firstCycle, topup: { balance: 300, expiresAt: new Date(Date.now() + 2 * 86400000) } });
    const keys = Object.keys({ ...(u.update.$set || {}), ...(u.update.$inc || {}) }).filter((k) => /topup/i.test(k));
    assert.deepStrictEqual(keys, [], `no top-up field, firstCycle ${firstCycle}`);
  }
  const pack = bp.buildChargeUpdate({ kind: 'topup', key: 1000, orderId: 'o' }, { paymentId: 'p4', paidPaise: 1 });
  assert.ok(pack.update.$set['credits.topupExpiresAt'], 'a bought pack still renews the 60 days');
});

test('N1: the Agency renewal grants the plan Quarks plus 500 per active slot (0, 2, 20, clamped) into the monthly bucket', () => {
  const rec = { kind: 'plan', key: 'agency', subscriptionId: 'sub_a' };
  const grant = (extraSlots) => bp.buildChargeUpdate(rec, { paymentId: 'p', paidPaise: 1, extraSlots, subscription: { current_end: 1900000000 } });
  for (const [slots, want] of [[0, 6000], [2, 7000], [20, 16000], [99, 16000], [-3, 6000], [undefined, 6000], ['x', 6000]]) {
    const g = grant(slots);
    assert.strictEqual(g.quarks, want, `slots ${slots}`);
    assert.strictEqual(g.update.$set['credits.planBalance'], want);
    assert.strictEqual(g.update.$inc['credits.balance'], want);
    assert.strictEqual(g.update.$push.payments.credits, want);
  }
  assert.strictEqual(grant(0).quarks, PLANS.agency.quarks);
  const other = bp.buildChargeUpdate({ kind: 'plan', key: 'professional', subscriptionId: 's' }, { paymentId: 'p', paidPaise: 1, extraSlots: 5 });
  assert.strictEqual(other.quarks, PLANS.professional.quarks, 'other plans ignore the slot count');
});

test('N1: the Agency plan renewal through the webhook brings 500 per slot into the monthly allowance, once', async () => {
  for (const [slots, want] of [[0, 6000], [2, 7000], [20, 16000]]) {
    const ctx = setup({ user: mkAgency({ agency: { clientCount: 0, extraSlots: slots }, credits: { balance: 100, planBalance: 0, totalUsed: 0 } }), settle: fakeSettle });
    const ev = hook('subscription.charged', 'sub_plan', 'plan_agency', 'pay_r', { amount: AGENCY_PAISE });
    await sendHook(ctx.r, ev); await sendHook(ctx.r, ev);
    const u = stored(ctx);
    assert.strictEqual(u.credits.planBalance, want, `slots ${slots}`);
    assert.strictEqual(u.credits.balance, 100 + want);
    assert.ok(u.credits.planExpiresAt, 'the month has an end');
    assert.strictEqual(paidRows(u).length, 1, 'replay records nothing more');
  }
});

test('N1: a slot bought while a top-up pack has 2 days left adds 500 to the monthly bucket only', async () => {
  const end = new Date(Date.now() + 2 * 86400000); const planEnd = new Date(Date.now() + 20 * 86400000);
  const ctx = setup({ user: mkAgency({ credits: { balance: 1300, planBalance: 1000, planExpiresAt: planEnd, topupBalance: 300, topupExpiresAt: end, totalUsed: 0 } }) });
  const s = await startSlot(ctx);
  const ev = slotCharge(s, 'pay_s1');
  await sendHook(ctx.r, ev); await sendHook(ctx.r, ev);
  const u = stored(ctx);
  assert.strictEqual(u.credits.planBalance, 1500);
  assert.strictEqual(u.credits.balance, 1800);
  assert.strictEqual(+u.credits.planExpiresAt, +planEnd, 'the plan month end is unchanged');
  assert.strictEqual(u.credits.topupBalance, 300);
  assert.strictEqual(+u.credits.topupExpiresAt, +end, 'the pack end date is unchanged');
  // a renewal of the slot: nothing granted, still no top-up change
  await sendHook(ctx.r, slotCharge(s, 'pay_s2'));
  await sendHook(ctx.r, slotCharge(s, 'pay_s2'));
  const v = stored(ctx);
  assert.strictEqual(v.credits.planBalance, 1500); assert.strictEqual(v.credits.balance, 1800);
  assert.strictEqual(+v.credits.topupExpiresAt, +end); assert.strictEqual(v.credits.topupBalance, 300);
  assert.strictEqual(v.agency.extraSlots, 1);
  assert.strictEqual(v.payments.length, 2);
});

test('A-M3: a charge that arrives after the slot was cancelled does not bring the slot back', async () => {
  const ctx = setup({});
  const s = await startSlot(ctx);
  await sendHook(ctx.r, slotCharge(s, 'pay_s1'));
  assert.strictEqual(stored(ctx).agency.extraSlots, 1);
  await sendHook(ctx.r, hook('subscription.cancelled', s.id, s.planId, null));
  assert.strictEqual(stored(ctx).agency.extraSlots, 0);
  await sendHook(ctx.r, slotCharge(s, 'pay_late'));
  const u = stored(ctx);
  assert.strictEqual(u.agency.extraSlots, 0);
  assert.strictEqual(u.plan.subscriptions.find((x) => x.subscriptionId === s.id).active, false);
  const row = failedRows(u).find((p) => p.razorpayPaymentId === 'pay_late');
  assert.ok(row && row.needsRefund, 'recorded for a refund');
  assert.strictEqual(ctx.notifies.length, 1);
});

test('A-M4: a first Agency plan payment of the wrong amount is cancelled at Razorpay; a running plan is only recorded', async () => {
  const ctx = setup({ user: mkFree() });
  const s = await startAgency(ctx);
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_bad', { amount: AGENCY_PAISE - 100 }));
  assert.deepStrictEqual(ctx.razorpay.calls.cancels, [[s.id, 0]]);
  assert.strictEqual(failedRows(stored(ctx)).length, 1);
  assert.strictEqual(stored(ctx).plan.tier, 'free');
  // an active plan renewing at a wrong amount: recorded and alerted, not cancelled by us
  const ctx2 = setup({});
  const rec = stored(ctx2).plan.subscriptions[0];
  await sendHook(ctx2.r, hook('subscription.charged', rec.subscriptionId, rec.razorpayPlanId, 'pay_bad2', { amount: 1 }));
  assert.strictEqual(ctx2.razorpay.calls.cancels.length, 0);
  assert.strictEqual(failedRows(stored(ctx2)).length, 1);
  assert.ok(ctx2.alerts.length >= 1);
});

test('A-M6: no "cancel it in Razorpay" alert for a slot that is already cancelled; a real failure still alerts', async () => {
  for (const [message, expectAlert] of [['The subscription is already cancelled', false], ['network down', true]]) {
    const ctx = setup({});
    const s = await startSlot(ctx);
    await sendHook(ctx.r, slotCharge(s, 'pay_s1'));
    ctx.razorpay.subscriptions.cancel = async () => { throw new Error(message); };
    await sendHook(ctx.r, hook('subscription.cancelled', 'sub_plan', 'plan_agency', null));
    assert.strictEqual(ctx.alerts.some(([, d]) => /cancel it in Razorpay/.test(d)), expectAlert, message);
    assert.strictEqual(stored(ctx).agency.extraSlots, 0);
  }
});
