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

test('a paid slot adds one client and grants its Quarks; a repeat payment of the same cycle grants nothing more', () => {
  const rec = { kind: 'slot', key: 'client', subscriptionId: 'sub_s' };
  const first = bp.buildChargeUpdate(rec, { paymentId: 'pay_s1', paidPaise: bp.slotQuote().chargePaise, firstCycle: true });
  assert.strictEqual(first.update.$inc['agency.extraSlots'], 1);
  assert.strictEqual(first.quarks, AGENCY.slot.quarks);
  assert.strictEqual(first.update.$inc['credits.topupBalance'], AGENCY.slot.quarks, 'slot Quarks go to the top-up bucket');
  const renewal = bp.buildChargeUpdate(rec, { paymentId: 'pay_s2', paidPaise: bp.slotQuote().chargePaise, firstCycle: false });
  assert.strictEqual(renewal.update.$inc['agency.extraSlots'], undefined);
  assert.strictEqual(renewal.quarks, AGENCY.slot.quarks);
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
  assert.deepStrictEqual(u.$set, { 'plan.subscriptions.$[sub].active': false });
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
    const key = parts[parts.length - 1]; parent[key] = parent[key] || []; parent[key].push(JSON.parse(JSON.stringify(v)));
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
    payments: { fetch: async () => ({}) }
  };
}
function setup({ user = mkAgency(), extra = [], env = ENV } = {}) {
  const welcomes = []; const invoices = []; const alerts = [];
  const User = fakeUserModel([user, ...extra]);
  const razorpay = fakeRazorpay();
  const r = createPaymentRouter({
    razorpay, User, env, alert: (c, d) => alerts.push([c, d]),
    protect: (req, res, next) => next(),
    Coupon: { findOne: async () => null, findOneAndUpdate: async () => null },
    createInvoice: async (p) => { invoices.push(p); return { invoiceNumber: 'INV-1', invoiceUrl: 'https://invoice.example/1' }; },
    sendWelcome: async (u, info) => { welcomes.push({ email: u.email, ...info }); return { sent: true }; }
  });
  return { r, User, razorpay, invoices, user, welcomes, alerts };
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
  return { id: res.body.subscription_id, planId: created.plan_id, res };
}
async function startAgency(ctx) {
  const res = await call(ctx.r, 'post', '/create-subscription', { body: { planId: 'agency' } });
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  const created = ctx.razorpay.calls.subs[ctx.razorpay.calls.subs.length - 1];
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
  const grants = () => [stored(ctx).credits.balance, stored(ctx).payments.length, stored(ctx).plan.tier];
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
  assert.strictEqual(u.credits.topupBalance, AGENCY.slot.quarks);
  assert.ok(u.credits.topupExpiresAt, 'top-up Quarks carry an expiry');
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

test('slot renewal grants the Quarks again but never another slot', async () => {
  const ctx = setup();
  const s = await startSlot(ctx);
  await sendHook(ctx.r, slotCharge(s, 'pay_s1'));
  await sendHook(ctx.r, slotCharge(s, 'pay_s2'));
  await sendHook(ctx.r, slotCharge(s, 'pay_s3'));
  const u = stored(ctx);
  assert.strictEqual(u.agency.extraSlots, 1);
  assert.strictEqual(u.credits.balance, 100 + 3 * AGENCY.slot.quarks);
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
  assert.strictEqual(stored(ctx2).credits.balance, 100 + 2 * AGENCY.slot.quarks);
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
  const before = () => JSON.stringify([stored(ctx).agency, stored(ctx).credits.balance, stored(ctx).payments]);
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
    assert.strictEqual(u.payments.length, 0);
    assert.strictEqual(ctx.invoices.length, 0);
    assert.ok(ctx.alerts.some(([c, d]) => c === 'payment' && /pay_late/.test(d)), 'the owner is told');
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
  assert.strictEqual(stored(ctx).payments.length, 1);
  assert.ok(ctx.alerts.some(([, d]) => /pay_b/.test(d)));
  assert.deepStrictEqual(ctx.razorpay.calls.cancels, [[b.id, 0]]);
  // verify path refuses the same way and says so
  const v = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_c', razorpay_subscription_id: b.id, razorpay_signature: hmac(ENV.RAZORPAY_KEY_SECRET, `pay_c|${b.id}`) } });
  assert.strictEqual(v.code, 409);
  assert.strictEqual(v.body.success, false);
  assert.doesNotMatch(v.body.message, /!|—|credit|trial/i);
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
