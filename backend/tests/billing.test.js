const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const bp = require('../services/billingPlans');
const router = require('../routes/payment');
const { createPaymentRouter } = router;
const { TOPUP_PACKS, chargePaise, gstPaise } = require('../config/apiCosts');

// ---------------------------------------------------------------- fakes
const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_fake',
  RAZORPAY_KEY_SECRET: 'test_key_secret',
  RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret'
};
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

function matchFilter(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '_id') return String(doc._id) === String(v);
    const parts = k.split('.');
    // collect candidate leaf values through arrays
    let vals = [doc];
    for (const p of parts) vals = vals.flatMap((x) => (x == null ? [] : Array.isArray(x[p]) ? x[p] : [x[p]]));
    if (v === null) return vals.every((x) => x == null);
    if (v && typeof v === 'object' && '$ne' in v) return !vals.some((x) => x === v.$ne);
    return vals.some((x) => x === v);
  });
}
function getAt(doc, p) { return p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), doc); }
function setAt(cur, parts, value, arrayFilters) {
  const [p, ...rest] = parts;
  const m = /^\$\[(\w+)\]$/.exec(p);
  if (m) {
    const id = m[1];
    const f = (arrayFilters || []).find((x) => Object.keys(x)[0].startsWith(id + '.'));
    const [fk, fv] = Object.entries(f)[0];
    const sub = fk.slice(id.length + 1);
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
function fakeUserModel(users) {
  return {
    users,
    async findById(id) { return users.find((u) => String(u._id) === String(id)) || null; },
    async findOne(q) { return users.find((u) => matchFilter(u, q)) || null; },
    async findOneAndUpdate(filter, update, opts = {}) {
      const doc = users.find((u) => matchFilter(u, filter));
      if (!doc) return null;
      applyUpdate(doc, update, opts.arrayFilters);
      return doc;
    },
    async updateOne(filter, update, opts = {}) {
      const doc = users.find((u) => matchFilter(u, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(doc, update, opts.arrayFilters);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}
function mkUser(over = {}) {
  return {
    _id: 'user1', email: 'a@example.com', firstName: 'Asha', lastName: 'K', mobileNumber: '',
    credits: { balance: 100, totalUsed: 0 }, payments: [],
    subscription: { status: 'active', razorpaySubscriptionId: '' },
    plan: { tier: 'starter', addons: [], subscriptions: [] },
    ...over
  };
}
function fakeRazorpay() {
  const calls = { plans: [], subs: [], orders: [], cancels: [] };
  const subs = {}; const orders = {};
  return {
    calls,
    plans: { create: async (b) => { calls.plans.push(b); return { id: `plan_fake${calls.plans.length}` }; } },
    subscriptions: {
      create: async (b) => { calls.subs.push(b); const s = { id: `sub_fake${calls.subs.length}`, plan_id: b.plan_id, notes: b.notes }; subs[s.id] = s; return s; },
      fetch: async (id) => subs[id],
      cancel: async (id, atEnd) => { calls.cancels.push([id, atEnd]); return { id, status: 'cancelled' }; }
    },
    orders: {
      create: async (b) => { calls.orders.push(b); const o = { id: `order_fake${calls.orders.length}`, amount: b.amount, currency: b.currency, notes: b.notes }; orders[o.id] = o; return o; },
      fetch: async (id) => orders[id]
    },
    payments: { fetch: async () => ({}) },
    _orders: orders
  };
}
function setup({ user = mkUser(), env = ENV, welcomeFails = false } = {}) {
  const welcomes = [];
  const User = fakeUserModel([user]);
  const razorpay = fakeRazorpay();
  const invoices = [];
  const r = createPaymentRouter({
    razorpay, User, env,
    protect: (req, res, next) => next(),
    Coupon: { findOne: async () => null, findOneAndUpdate: async () => null },
    createInvoice: async (p) => { invoices.push(p); return { invoiceNumber: 'INV-1', invoiceUrl: 'https://invoice.example/1' }; },
    sendWelcome: async (u, info) => { if (welcomeFails) throw new Error('mail down'); welcomes.push({ email: u.email, ...info }); return { sent: true }; }
  });
  return { r, User, razorpay, invoices, user, welcomes };
}
function handlerOf(r, method, p) {
  const layer = r.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  assert.ok(layer, `${method} ${p} is registered`);
  const st = layer.route.stack; return st[st.length - 1].handle;
}
function mkRes() { return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; }
async function call(r, method, p, req) {
  const res = mkRes();
  const quietErr = console.error; const quietLog = console.log; const quietWarn = console.warn;
  console.error = console.log = console.warn = () => {};
  try { await handlerOf(r, method, p)({ headers: {}, body: {}, user: { userId: 'user1' }, ...req }, res); }
  finally { console.error = quietErr; console.log = quietLog; console.warn = quietWarn; }
  return res;
}
function hook(event, subId, planId, payId, { amount = 0, notes, extraPayload } = {}) {
  const body = {
    event,
    payload: {
      subscription: { entity: { id: subId, plan_id: planId, notes: notes || { userId: 'user1' }, current_end: 1900000000, charge_at: 1902600000 } },
      ...(payId ? { payment: { entity: { id: payId, amount } } } : {}),
      ...(extraPayload || {})
    },
    ...(extraPayload || {})
  };
  return body;
}
function sendHook(r, body, { secret = ENV.RAZORPAY_WEBHOOK_SECRET, sig } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  return call(r, 'post', '/webhook', { headers: { 'x-razorpay-signature': sig === undefined ? hmac(secret, raw) : sig }, body: raw });
}
async function startPlan(ctx, planId) {
  const res = await call(ctx.r, 'post', '/create-subscription', { body: { planId } });
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  const created = ctx.razorpay.calls.subs[ctx.razorpay.calls.subs.length - 1];
  return { id: res.body.subscription_id, planId: created.plan_id, res };
}

// ---------------------------------------------------------------- pure helpers
test('plans catalogue: starter, professional and agency, numbers from config', () => {
  const c = bp.planCatalogue();
  assert.deepStrictEqual(c.plans.map((p) => p.id), ['starter', 'professional', 'agency']);
  const [s, p] = c.plans;
  assert.strictEqual(s.inr, 999); assert.strictEqual(s.gstPaise, 17982); assert.strictEqual(s.chargePaise, 117882); assert.strictEqual(s.quarks, 600);
  assert.strictEqual(p.inr, 1999); assert.strictEqual(p.gstPaise, 35982); assert.strictEqual(p.chargePaise, 235882); assert.strictEqual(p.quarks, 2000);
  for (const x of c.plans) { assert.ok(x.name); assert.ok(Array.isArray(x.features) && x.features.length >= 3); }
  assert.ok(s.features.some((f) => /Up to 54 posts/.test(f)));
  assert.ok(p.features.some((f) => /Up to 181 posts/.test(f)));
  assert.deepStrictEqual(c.topups.map((t) => [t.inr, t.quarks, t.chargePaise]), [[500, 240, 59000], [1000, 475, 118000], [2500, 1190, 295000], [5000, 2380, 590000], [10000, 4760, 1180000]]);
  assert.deepStrictEqual(c.addons.map((a) => a.id), ['publish', 'competitors', 'inbox', 'bundle']);
  assert.strictEqual(c.addons.find((a) => a.id === 'publish').chargePaise, chargePaise(1000));
  assert.deepStrictEqual(c.addons.find((a) => a.id === 'inbox').requires, ['publish']);
  assert.ok(!JSON.stringify(c).includes('managed'));
});

test('findTopupPack accepts only a pack price as a number', () => {
  for (const ok of [500, 1000, 2500, 5000, 10000]) assert.ok(bp.findTopupPack(ok));
  for (const bad of [999, 1999, 4999, 0, -5, '500', '1000', NaN, null, undefined, 999.5, Infinity, {}, [500]]) assert.strictEqual(bp.findTopupPack(bad), null, String(bad));
});

test('invoice item names and the GST line', () => {
  const plan = bp.invoiceSpec('plan', 'starter');
  assert.strictEqual(plan.itemName, 'Nebulaa subscription');
  assert.strictEqual(plan.amountInr, 999); assert.strictEqual(plan.gstPercent, 18);
  assert.strictEqual(plan.gstPaise, 17982); assert.strictEqual(plan.totalPaise, 117882);
  assert.strictEqual(bp.invoiceSpec('addon', 'inbox').itemName, 'Nebulaa add-on');
  const top = bp.invoiceSpec('topup', 5000);
  assert.strictEqual(top.itemName, 'Nebulaa Quarks'); assert.strictEqual(top.totalPaise, 590000);
  assert.strictEqual(bp.invoiceSpec('plan', 'pro'), null);
});

test('signature helpers', () => {
  const raw = Buffer.from('{"a":1}');
  assert.strictEqual(bp.verifyWebhookSignature(raw, hmac('s', raw), 's'), true);
  assert.strictEqual(bp.verifyWebhookSignature(raw, hmac('x', raw), 's'), false);
  assert.strictEqual(bp.verifyWebhookSignature(raw, undefined, 's'), false);
  assert.strictEqual(bp.verifyWebhookSignature(raw, hmac('s', raw), ''), false);
  assert.strictEqual(bp.verifyWebhookSignature(raw, 'short', 's'), false);
  assert.strictEqual(bp.verifyCheckoutSignature('order_1|pay_1', hmac('k', 'order_1|pay_1'), 'k'), true);
  assert.strictEqual(bp.verifyCheckoutSignature('order_1|pay_1', 'nope', 'k'), false);
});

test('canBuyAddon enforces tier and requires', () => {
  const u = (tier, addons = []) => ({ plan: { tier, addons } });
  assert.strictEqual(bp.canBuyAddon(u('starter'), 'publish').ok, true);
  assert.strictEqual(bp.canBuyAddon(u('starter'), 'inbox').ok, false);
  assert.strictEqual(bp.canBuyAddon(u('starter', ['publish']), 'inbox').ok, true);
  assert.strictEqual(bp.canBuyAddon(u('professional', ['bundle']), 'inbox').ok, false); // already held through the bundle
  assert.strictEqual(bp.canBuyAddon(u('free'), 'publish').ok, false);
  assert.strictEqual(bp.canBuyAddon(u('starter'), 'seo').ok, false);
  assert.strictEqual(bp.canBuyAddon(u('starter', ['publish']), 'publish').ok, false);
});

// ---------------------------------------------------------------- routes
test('GET /plans returns only the new catalogue', async () => {
  const { r } = setup();
  const res = await call(r, 'get', '/plans', {});
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.body.plans.map((p) => p.id), ['starter', 'professional', 'agency']);
  assert.strictEqual(res.body.topups.length, 5);
  assert.strictEqual(res.body.addons.length, 4);
  assert.ok(!/plan_Sra|"scale"|7500/i.test(JSON.stringify(res.body)));
});

test('unrelated routes are still registered', () => {
  const { r } = setup();
  for (const [m, p] of [['get', '/status'], ['get', '/billing'], ['post', '/retry-invoices'], ['post', '/validate-coupon'], ['post', '/verify'], ['post', '/verify-subscription'], ['post', '/webhook']]) handlerOf(r, m, p);
  assert.strictEqual(typeof router.use, 'function'); // default export is still a router
});

test('create-subscription charges price plus GST exactly and notes the tier', async () => {
  for (const [planId, paise] of [['starter', 117882], ['professional', 235882]]) {
    const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
    const res = await call(ctx.r, 'post', '/create-subscription', { body: { planId } });
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.strictEqual(ctx.razorpay.calls.plans.length, 1);
    assert.strictEqual(ctx.razorpay.calls.plans[0].item.amount, paise);
    assert.strictEqual(ctx.razorpay.calls.plans[0].item.currency, 'INR');
    assert.strictEqual(ctx.razorpay.calls.plans[0].item.name, 'Nebulaa subscription');
    const sub = ctx.razorpay.calls.subs[0];
    assert.strictEqual(sub.notes.tier, planId); assert.strictEqual(sub.notes.userId, 'user1');
    assert.strictEqual(res.body.amount, paise);
    assert.strictEqual(res.body.subscription_id, 'sub_fake1');
    assert.strictEqual(res.body.key, ENV.RAZORPAY_KEY_ID);
    const entry = ctx.user.plan.subscriptions[0];
    assert.deepStrictEqual([entry.subscriptionId, entry.kind, entry.key, entry.active], ['sub_fake1', 'plan', planId, false]);
  }
});

test('Razorpay plan ids are cached per router and can come from env', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  await call(ctx.r, 'post', '/create-subscription', { body: { planId: 'starter' } });
  await call(ctx.r, 'post', '/create-subscription', { body: { planId: 'starter' } });
  assert.strictEqual(ctx.razorpay.calls.plans.length, 1);
  const withEnv = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }), env: { ...ENV, RAZORPAY_PLAN_ID_PROFESSIONAL: 'plan_from_env' } });
  await call(withEnv.r, 'post', '/create-subscription', { body: { planId: 'professional' } });
  assert.strictEqual(withEnv.razorpay.calls.plans.length, 0);
  assert.strictEqual(withEnv.razorpay.calls.subs[0].plan_id, 'plan_from_env');
});

test('create-subscription refuses old plan ids and active subscriptions', async () => {
  for (const planId of ['plan_Sra2nrsAk2M53U', 'pro', 'growth', 'scale', 'managed_10k', '', undefined, 'STARTER']) {
    const ctx = setup();
    const res = await call(ctx.r, 'post', '/create-subscription', { body: { planId } });
    assert.strictEqual(res.code, 400, String(planId));
    assert.strictEqual(ctx.razorpay.calls.subs.length, 0);
  }
  const active = setup({ user: mkUser({ subscription: { status: 'active', razorpaySubscriptionId: 'sub_old' } }) });
  const res = await call(active.r, 'post', '/create-subscription', { body: { planId: 'starter' } });
  assert.strictEqual(res.code, 400);
  assert.strictEqual(active.razorpay.calls.subs.length, 0);
});

test('create-order accepts only the three pack prices and records Quarks server-side', async () => {
  for (const [pack, paise, quarks] of [[1000, 118000, 475], [2500, 295000, 1190], [5000, 590000, 2380]]) {
    const ctx = setup();
    const res = await call(ctx.r, 'post', '/create-order', { body: { packInr: pack, amount: 1, quarks: 999999, credits: 999999 } });
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.order.amount, paise);
    const o = ctx.razorpay.calls.orders[0];
    assert.strictEqual(o.amount, paise);
    assert.strictEqual(o.notes.quarks, String(quarks)); assert.strictEqual(o.notes.kind, 'topup'); assert.strictEqual(o.notes.userId, 'user1');
  }
  for (const bad of [999, 0, -5, '500', NaN, null, undefined, 999.5, 7500]) {
    const ctx = setup();
    const res = await call(ctx.r, 'post', '/create-order', { body: { packInr: bad } });
    assert.strictEqual(res.code, 400, String(bad));
    assert.strictEqual(ctx.razorpay.calls.orders.length, 0);
  }
  const ctx = setup(); // the old field is not a way in
  assert.strictEqual((await call(ctx.r, 'post', '/create-order', { body: { amount: 7500 } })).code, 400);
});

async function paidTopup(ctx, { pack = 1000, payId = 'pay_top1', forgeNotes } = {}) {
  const create = await call(ctx.r, 'post', '/create-order', { body: { packInr: pack } });
  const orderId = create.body.order.id;
  if (forgeNotes) Object.assign(ctx.razorpay._orders[orderId].notes, forgeNotes);
  return { orderId, verify: (sig) => call(ctx.r, 'post', '/verify', { body: { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sig === undefined ? hmac(ENV.RAZORPAY_KEY_SECRET, `${orderId}|${payId}`) : sig } }) };
}

test('top-up verify grants the pack Quarks from config, once', async () => {
  const ctx = setup();
  const t = await paidTopup(ctx, { pack: 2500, forgeNotes: { quarks: '99999' } });
  const res = await t.verify();
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  assert.strictEqual(ctx.user.credits.balance, 1290);
  assert.strictEqual(ctx.user.payments.length, 1);
  assert.strictEqual(ctx.user.payments[0].razorpayPaymentId, 'pay_top1');
  assert.strictEqual(ctx.user.payments[0].credits, 1190);
  assert.strictEqual(ctx.invoices.length, 1);
  assert.strictEqual(ctx.invoices[0].itemName, 'Nebulaa Quarks');
  assert.strictEqual(ctx.invoices[0].amount, 2500);
  assert.strictEqual(ctx.invoices[0].gstPercent, 18);
  assert.strictEqual(ctx.user.payments[0].invoiceUrl, 'https://invoice.example/1');
  const again = await t.verify();
  assert.strictEqual(again.code, 200);
  assert.strictEqual(again.body.alreadyProcessed, true);
  assert.strictEqual(ctx.user.credits.balance, 1290);
  assert.strictEqual(ctx.user.payments.length, 1);
  assert.strictEqual(ctx.invoices.length, 1);
});

test('top-up verify rejects a bad signature, a foreign order and a mismatched order amount', async () => {
  const bad = setup(); const tb = await paidTopup(bad);
  assert.strictEqual((await tb.verify('deadbeef')).code, 400);
  assert.strictEqual(bad.user.credits.balance, 100);

  const foreign = setup(); const tf = await paidTopup(foreign, { forgeNotes: { userId: 'someone_else' } });
  assert.ok((await tf.verify()).code >= 400);
  assert.strictEqual(foreign.user.credits.balance, 100);

  const wrongAmount = setup(); const tw = await paidTopup(wrongAmount);
  wrongAmount.razorpay._orders[tw.orderId].amount = 100;
  assert.ok((await tw.verify()).code >= 400);
  assert.strictEqual(wrongAmount.user.credits.balance, 100);

  const forgedPack = setup(); const tp = await paidTopup(forgedPack);
  forgedPack.razorpay._orders[tp.orderId].notes.packInr = 123;
  assert.ok((await tp.verify()).code >= 400);
  assert.strictEqual(forgedPack.user.credits.balance, 100);
});

test('webhook: bad or missing signature, and no secret configured, grant nothing', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  const s = await startPlan(ctx, 'starter');
  const ev = hook('subscription.charged', s.id, s.planId, 'pay_1', { amount: 117882 });
  assert.strictEqual((await sendHook(ctx.r, ev, { secret: 'wrong' })).code, 400);
  assert.strictEqual((await sendHook(ctx.r, ev, { sig: '' })).code, 400);
  assert.strictEqual(ctx.user.credits.balance, 100);
  const noSecret = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }), env: { RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's' } });
  const s2 = await startPlan(noSecret, 'starter');
  const res = await sendHook(noSecret.r, hook('subscription.charged', s2.id, s2.planId, 'pay_2', { amount: 117882 }), { sig: 'anything' });
  assert.ok(res.code >= 400);
  assert.strictEqual(noSecret.user.credits.balance, 100);
});

test('webhook subscription.charged grants the plan Quarks from config and is idempotent', async () => {
  for (const [planId, quarks, tier, inr] of [['starter', 600, 'starter', 999], ['professional', 2000, 'professional', 1999]]) {
    const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
    const s = await startPlan(ctx, planId);
    const forged = hook('subscription.charged', s.id, s.planId, 'pay_A', { amount: chargePaise(inr), extraPayload: { credits: 99999, quarks: 99999 } });
    forged.payload.payment.entity.notes = { quarks: 99999, credits: 99999 };
    const res = await sendHook(ctx.r, forged);
    assert.strictEqual(res.code, 200);
    assert.strictEqual(ctx.user.credits.balance, 100 + quarks);
    assert.strictEqual(ctx.user.plan.tier, tier);
    assert.strictEqual(ctx.user.plan.subscriptionId, s.id);
    assert.strictEqual(ctx.user.plan.subscriptions[0].active, true);
    assert.strictEqual(ctx.user.subscription.status, 'active');
    assert.strictEqual(ctx.user.subscription.razorpaySubscriptionId, s.id);
    assert.strictEqual(ctx.user.payments.length, 1);
    assert.strictEqual(ctx.user.payments[0].credits, quarks);
    assert.strictEqual(ctx.invoices.length, 1);
    assert.strictEqual(ctx.invoices[0].itemName, 'Nebulaa subscription');
    assert.strictEqual(ctx.invoices[0].amount, inr);
    assert.strictEqual(ctx.invoices[0].gstPercent, 18);
    // replay of the same payment id
    assert.strictEqual((await sendHook(ctx.r, forged)).code, 200);
    assert.strictEqual(ctx.user.credits.balance, 100 + quarks);
    assert.strictEqual(ctx.user.payments.length, 1);
    assert.strictEqual(ctx.invoices.length, 1);
    // next month is a different payment id
    await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_B', { amount: chargePaise(inr) }));
    assert.strictEqual(ctx.user.credits.balance, 100 + 2 * quarks);
  }
});

test('first payment: verify-subscription and the webhook together grant once', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  const s = await startPlan(ctx, 'starter');
  const sig = hmac(ENV.RAZORPAY_KEY_SECRET, `pay_first|${s.id}`);
  const v = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_first', razorpay_subscription_id: s.id, razorpay_signature: sig } });
  assert.strictEqual(v.code, 200, JSON.stringify(v.body));
  assert.strictEqual(ctx.user.credits.balance, 700);
  assert.strictEqual(ctx.user.plan.tier, 'starter');
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_first', { amount: 117882 }));
  assert.strictEqual(ctx.user.credits.balance, 700);
  assert.strictEqual(ctx.user.payments.length, 1);
  const bad = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_x', razorpay_subscription_id: s.id, razorpay_signature: 'nope' } });
  assert.strictEqual(bad.code, 400);
  const unknown = hmac(ENV.RAZORPAY_KEY_SECRET, 'pay_y|sub_unknown');
  const u = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_y', razorpay_subscription_id: 'sub_unknown', razorpay_signature: unknown } });
  assert.ok(u.code >= 400);
  assert.strictEqual(ctx.user.credits.balance, 700);
});

test('webhook grants nothing for unknown subscriptions, unknown plan ids or a mismatched owner', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  const s = await startPlan(ctx, 'starter');
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', 'sub_unknown', s.planId, 'pay_1', { amount: 117882 }))).code, 200);
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, 'plan_Sra2nrsAk2M53U', 'pay_2', { amount: 10000 }))).code, 200);
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_3', { amount: 117882, notes: { userId: 'someone_else' } }))).code, 200);
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, null))).code, 200); // no payment entity
  ctx.user.plan.subscriptions[0].key = 'pro'; // a stored record that is not in config
  assert.strictEqual((await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_4', { amount: 117882 }))).code, 200);
  assert.strictEqual(ctx.user.credits.balance, 100);
  assert.strictEqual(ctx.user.plan.tier, 'free');
  assert.strictEqual(ctx.user.payments.length, 0);
});

test('create-addon-subscription: price, requires, tier and duplicates', async () => {
  const mk = (addons = [], tier = 'starter') => setup({ user: mkUser({ plan: { tier, addons, subscriptions: [] } }) });
  for (const [addon, paise] of [['publish', 118000], ['competitors', 59000], ['inbox', 59000], ['bundle', 212400]]) {
    const ctx = mk(addon === 'inbox' ? ['publish'] : []);
    const res = await call(ctx.r, 'post', '/create-addon-subscription', { body: { addon } });
    assert.strictEqual(res.code, 200, `${addon} ${JSON.stringify(res.body)}`);
    assert.strictEqual(ctx.razorpay.calls.plans[0].item.amount, paise);
    assert.strictEqual(ctx.razorpay.calls.plans[0].item.name, 'Nebulaa add-on');
    assert.strictEqual(ctx.razorpay.calls.subs[0].notes.addon, addon);
    assert.strictEqual(res.body.amount, paise);
  }
  const noPublish = mk();
  assert.strictEqual((await call(noPublish.r, 'post', '/create-addon-subscription', { body: { addon: 'inbox' } })).code, 400);
  assert.strictEqual(noPublish.razorpay.calls.subs.length, 0);
  const viaBundle = mk(['bundle']);
  assert.strictEqual((await call(viaBundle.r, 'post', '/create-addon-subscription', { body: { addon: 'competitors' } })).code, 400); // already held
  for (const bad of ['seo', '', undefined, 'Publish', 'plan_x']) assert.strictEqual((await call(mk().r, 'post', '/create-addon-subscription', { body: { addon: bad } })).code, 400, String(bad));
  assert.strictEqual((await call(mk([], 'free').r, 'post', '/create-addon-subscription', { body: { addon: 'publish' } })).code, 400);
});

test('add-on webhook switches the add-on on, grants no Quarks, and is idempotent', async () => {
  const ctx = setup();
  const res = await call(ctx.r, 'post', '/create-addon-subscription', { body: { addon: 'bundle' } });
  const id = res.body.subscription_id; const planId = ctx.razorpay.calls.subs[0].plan_id;
  const ev = hook('subscription.charged', id, planId, 'pay_addon', { amount: 212400 });
  assert.strictEqual((await sendHook(ctx.r, ev)).code, 200);
  assert.deepStrictEqual([...ctx.user.plan.addons].sort(), ['bundle', 'competitors', 'inbox', 'publish']);
  assert.strictEqual(ctx.user.credits.balance, 100);
  assert.strictEqual(ctx.user.plan.tier, 'starter');
  assert.strictEqual(ctx.invoices.length, 1);
  assert.strictEqual(ctx.invoices[0].itemName, 'Nebulaa add-on');
  assert.strictEqual(ctx.invoices[0].amount, 1800);
  await sendHook(ctx.r, ev);
  assert.strictEqual(ctx.user.payments.length, 1);
  assert.strictEqual(ctx.invoices.length, 1);
  assert.strictEqual(ctx.user.plan.addons.length, 4);
});

test('cancelled or halted plan subscription returns the account to free and clears add-ons', async () => {
  for (const [event, status] of [['subscription.cancelled', 'cancelled'], ['subscription.halted', 'halted']]) {
    const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
    const s = await startPlan(ctx, 'professional');
    await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_1', { amount: 235882 }));
    ctx.user.plan.addons = ['publish'];
    assert.strictEqual(ctx.user.plan.tier, 'professional');
    assert.strictEqual((await sendHook(ctx.r, hook(event, s.id, s.planId, null))).code, 200);
    assert.strictEqual(ctx.user.plan.tier, 'free');
    assert.deepStrictEqual([...ctx.user.plan.addons], []);
    assert.strictEqual(ctx.user.subscription.status, status);
    assert.strictEqual(ctx.user.plan.subscriptions[0].active, false);
    assert.strictEqual(ctx.user.credits.balance, 2100); // Quarks already granted are kept
  }
});

test('a stale subscription ending does not downgrade a newer one; an add-on ending removes only that add-on', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  const s = await startPlan(ctx, 'starter');
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_1', { amount: 117882 }));
  ctx.user.plan.subscriptions.push({ subscriptionId: 'sub_old', kind: 'plan', key: 'starter', razorpayPlanId: s.planId, active: false });
  await sendHook(ctx.r, hook('subscription.cancelled', 'sub_old', s.planId, null));
  assert.strictEqual(ctx.user.plan.tier, 'starter');

  const pub = await call(ctx.r, 'post', '/create-addon-subscription', { body: { addon: 'publish' } });
  await sendHook(ctx.r, hook('subscription.charged', pub.body.subscription_id, ctx.razorpay.calls.subs[1].plan_id, 'pay_pub', { amount: 118000 }));
  const comp = await call(ctx.r, 'post', '/create-addon-subscription', { body: { addon: 'competitors' } });
  await sendHook(ctx.r, hook('subscription.charged', comp.body.subscription_id, ctx.razorpay.calls.subs[2].plan_id, 'pay_comp', { amount: 59000 }));
  assert.deepStrictEqual([...ctx.user.plan.addons].sort(), ['competitors', 'publish']);
  await sendHook(ctx.r, hook('subscription.cancelled', comp.body.subscription_id, ctx.razorpay.calls.subs[2].plan_id, null));
  assert.deepStrictEqual([...ctx.user.plan.addons], ['publish']);
  assert.strictEqual(ctx.user.plan.tier, 'starter');
});

// ---------------------------------------------------------------- invoices and old code
test('Zoho invoice carries the item name and a separate 18% GST line (stubbed fetch)', async () => {
  const realFetch = global.fetch; const seen = [];
  const env = { ...process.env };
  Object.assign(process.env, { ZOHO_BOOKS_REFRESH_TOKEN: 't', ZOHO_BOOKS_CLIENT_ID: 'c', ZOHO_BOOKS_CLIENT_SECRET: 's', ZOHO_BOOKS_ORG_ID: 'org' });
  global.fetch = async (url, opts = {}) => {
    const u = String(url); seen.push({ u, body: typeof opts.body === 'string' ? JSON.parse(opts.body) : null, method: opts.method });
    const json = (o) => ({ json: async () => o });
    if (u.includes('oauth/v2/token')) return json({ access_token: 'a', expires_in: 3600 });
    if (u.includes('/settings/taxes')) return json({ code: 0, taxes: [{ tax_id: 'tax18', tax_percentage: 18, tax_name: 'GST' }] });
    if (u.includes('/contacts?')) return json({ code: 0, contacts: [{ contact_id: 'c1' }] });
    if (u.includes('/invoices?')) return json({ code: 0, invoice: { invoice_id: 'i1', invoice_number: 'INV-9', invoice_url: 'https://z/i1' } });
    if (u.includes('/customerpayments')) return json({ code: 0 });
    return json({ code: 0 });
  };
  try {
    const { createInvoice } = require('../services/zohoBooks');
    const out = await createInvoice({ email: 'a@b.c', firstName: 'A', lastName: '', companyName: '', razorpayPaymentId: 'pay_1', itemName: 'Nebulaa subscription', description: 'Starter, monthly', amount: 999, gstPercent: 18, totalAmount: 1178.82 });
    assert.strictEqual(out.invoiceUrl, 'https://z/i1');
    const inv = seen.find((x) => x.u.includes('/invoices?') && x.method === 'POST').body;
    assert.strictEqual(inv.line_items[0].name, 'Nebulaa subscription');
    assert.strictEqual(inv.line_items[0].rate, 999);
    assert.strictEqual(inv.line_items[0].tax_id, 'tax18');
    assert.ok(!('tax_exemption_id' in inv));
    const pay = seen.find((x) => x.u.includes('/customerpayments')).body;
    assert.strictEqual(pay.amount, 1178.82);
    assert.ok(!seen.some((x) => x.method === 'PUT')); // no tax-exemption update on the contact
  } finally { global.fetch = realFetch; for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; }
});

test('old plan code is gone from the payment routes and plan config', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/payment.js'), 'utf8');
  for (const needle of ['MONTHLY_AMOUNT', 'MONTHLY_CREDITS', 'MIN_AMOUNT', 'MAX_AMOUNT', 'plan_Sra', 'RAZORPAY_DISCOUNTED_PLAN_ID', 'Discounted Pack', 'migrateUserData', 'sendWelcomeEmail']) {
    assert.ok(!src.includes(needle), `payment.js still mentions ${needle}`);
  }
  const cfg = fs.readFileSync(path.join(__dirname, '../config/plans.js'), 'utf8');
  assert.ok(!/plan_Sra|Scale|quarterly|annual/i.test(cfg));
});

// ---------------------------------------------------------------- review fixes
test('I1: a managed account (no plan.tier) cannot buy a plan; free accounts still can', async () => {
  const managed = setup({ user: mkUser({ plan: undefined }) });
  const res = await call(managed.r, 'post', '/create-subscription', { body: { planId: 'starter' } });
  assert.strictEqual(res.code, 400);
  assert.match(res.body.message, /managed by Nebulaa/);
  assert.strictEqual(managed.razorpay.calls.subs.length, 0);
  const explicit = setup({ user: mkUser({ plan: { tier: 'managed' } }) });
  assert.strictEqual((await call(explicit.r, 'post', '/create-subscription', { body: { planId: 'professional' } })).code, 400);
  const free = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  assert.strictEqual((await call(free.r, 'post', '/create-subscription', { body: { planId: 'starter' } })).code, 200);
  // top-ups stay available to managed accounts
  const top = setup({ user: mkUser({ plan: undefined }) });
  assert.strictEqual((await call(top.r, 'post', '/create-order', { body: { packInr: 1000 } })).code, 200);
});

test('I2: ending a plan cancels the add-on subscriptions at Razorpay and clears add-ons', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  const s = await startPlan(ctx, 'starter');
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_1', { amount: 117882 }));
  const pub = await call(ctx.r, 'post', '/create-addon-subscription', { body: { addon: 'publish' } });
  await sendHook(ctx.r, hook('subscription.charged', pub.body.subscription_id, ctx.razorpay.calls.subs[1].plan_id, 'pay_pub', { amount: 118000 }));
  assert.deepStrictEqual([...ctx.user.plan.addons], ['publish']);
  await sendHook(ctx.r, hook('subscription.cancelled', s.id, s.planId, null));
  assert.deepStrictEqual(ctx.razorpay.calls.cancels.map((c) => c[0]), [pub.body.subscription_id]);
  assert.strictEqual(ctx.razorpay.calls.cancels.some((c) => c[0] === s.id), false);
  assert.deepStrictEqual([...ctx.user.plan.addons], []);
  assert.strictEqual(ctx.user.plan.tier, 'free');
  assert.ok(ctx.user.plan.subscriptions.every((x) => x.active === false));
});

test('I2: a cancel failure at Razorpay does not break the webhook; a stale plan ending cancels nothing', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  const s = await startPlan(ctx, 'starter');
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_1', { amount: 117882 }));
  const pub = await call(ctx.r, 'post', '/create-addon-subscription', { body: { addon: 'publish' } });
  await sendHook(ctx.r, hook('subscription.charged', pub.body.subscription_id, ctx.razorpay.calls.subs[1].plan_id, 'pay_pub', { amount: 118000 }));
  ctx.user.plan.subscriptions.push({ subscriptionId: 'sub_old', kind: 'plan', key: 'starter', razorpayPlanId: s.planId, active: false });
  await sendHook(ctx.r, hook('subscription.cancelled', 'sub_old', s.planId, null));
  assert.strictEqual(ctx.razorpay.calls.cancels.length, 0);
  ctx.razorpay.subscriptions.cancel = async () => { throw new Error('rzp down'); };
  const out = await sendHook(ctx.r, hook('subscription.halted', s.id, s.planId, null));
  assert.strictEqual(out.code, 200);
  assert.strictEqual(ctx.user.plan.tier, 'free');
  assert.deepStrictEqual([...ctx.user.plan.addons], []);
});

// ---------------------------------------------------------------- welcome email
const we = require('../services/welcomeEmail');

test('welcome email is sent once on the first verified activation, never on a replay or a renewal', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  const s = await startPlan(ctx, 'professional');
  const sig = hmac(ENV.RAZORPAY_KEY_SECRET, `pay_w1|${s.id}`);
  const body = { razorpay_payment_id: 'pay_w1', razorpay_subscription_id: s.id, razorpay_signature: sig };
  assert.strictEqual((await call(ctx.r, 'post', '/verify-subscription', { body })).code, 200);
  assert.deepStrictEqual(ctx.welcomes, [{ email: 'a@example.com', tier: 'professional', quarks: 2000 }]);
  await call(ctx.r, 'post', '/verify-subscription', { body });
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_w1', { amount: chargePaise(1999) }));
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_w2', { amount: chargePaise(1999) }));
  assert.strictEqual(ctx.welcomes.length, 1);
  assert.strictEqual(ctx.user.credits.balance, 100 + 2 * 2000);
});

test('welcome email is sent from the webhook for a Starter first charge', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }) });
  const s = await startPlan(ctx, 'starter');
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_s1', { amount: chargePaise(999) }));
  assert.deepStrictEqual(ctx.welcomes.map((w) => [w.tier, w.quarks]), [['starter', 600]]);
});

test('an email failure never fails the webhook or the verify, and Quarks are still granted', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [] } }), welcomeFails: true });
  const s = await startPlan(ctx, 'starter');
  const res = await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_f1', { amount: chargePaise(999) }));
  assert.strictEqual(res.code, 200);
  assert.strictEqual(ctx.user.credits.balance, 700);
  assert.strictEqual(ctx.user.plan.tier, 'starter');
});

test('no welcome email for add-ons or top-ups', async () => {
  const ctx = setup({ user: mkUser({ plan: { tier: 'starter', addons: [], subscriptions: [] } }) });
  const res = await call(ctx.r, 'post', '/create-addon-subscription', { body: { addon: 'publish' } });
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  const created = ctx.razorpay.calls.subs[ctx.razorpay.calls.subs.length - 1];
  await sendHook(ctx.r, hook('subscription.charged', res.body.subscription_id, created.plan_id, 'pay_a1', { amount: chargePaise(1000) }));
  assert.deepStrictEqual(ctx.user.plan.addons, ['publish']);
  const top = await paidTopup(ctx, { pack: 1000, payId: 'pay_t1' });
  assert.strictEqual(ctx.welcomes.length, 0);
});

test('welcome email content: plan, Quarks, Hero count, add-ons, plain voice', () => {
  for (const [tier, quarks, plan] of [['starter', 600, 'Starter'], ['professional', 2000, 'Growth']]) {
    const m = we.buildWelcomeEmail({ firstName: 'Asha', tier, quarks });
    const all = `${m.subject}\n${m.text}\n${m.html}`;
    assert.match(m.subject, new RegExp(plan));
    assert.match(m.text, new RegExp(`${quarks.toLocaleString('en-US')} Quarks`));
    assert.ok(m.text.includes('short videos') && !/Hero/.test(m.text), 'videos are described plainly');
    assert.ok(m.text.includes('top up with more'));
    for (const a of ['Publish and schedule', 'Inbox and replies', 'Competitor insights', 'plans page', 'Create content']) assert.ok(m.text.includes(a), a);
    assert.ok(!/[!\u2014\u2013]/.test(all), 'no exclamation marks or dashes');
    assert.ok(!/credit|production|migrat|trial/i.test(all), 'forbidden words');
    assert.match(m.text, /^Hello Asha,/);
  }
  assert.strictEqual(we.buildWelcomeEmail({ firstName: 'A', tier: 'free', quarks: 100 }), null);
});

test('sendWelcomeEmail uses the injected transport, skips without a key, and never throws', async () => {
  const sent = [];
  const ok = await we.sendSubscriberWelcome({ email: 'a@example.com', firstName: 'Asha' }, { tier: 'starter', quarks: 2100 }, { transport: async (m) => { sent.push(m); return {}; }, env: { RESEND_FROM_EMAIL: 'hi@example.com' } });
  assert.strictEqual(ok.sent, true);
  assert.strictEqual(sent[0].to, 'a@example.com');
  assert.match(sent[0].from, /hi@example\.com/);
  const bad = await we.sendSubscriberWelcome({ email: 'a@example.com' }, { tier: 'starter', quarks: 2100 }, { transport: async () => { throw new Error('boom'); } });
  assert.strictEqual(bad.sent, false);
  const none = await we.sendSubscriberWelcome({ email: 'a@example.com' }, { tier: 'starter', quarks: 2100 }, { env: {} });
  assert.strictEqual(none.skipped, true);
});

// ---------------------------------------------------------------- cancel at the end of the paid month
const paidUser = (over = {}) => mkUser({
  plan: { tier: 'starter', addons: ['publish'], subscriptions: [
    { subscriptionId: 'sub_plan', kind: 'plan', key: 'starter', active: true },
    { subscriptionId: 'sub_addon', kind: 'addon', key: 'publish', active: true }] },
  subscription: { status: 'active', razorpaySubscriptionId: 'sub_plan', currentPeriodEnd: new Date('2026-12-01T00:00:00Z') },
  ...over
});

test('cancel: the plan and its add-ons are cancelled at the END of the paid month, and the account is marked', async () => {
  const ctx = setup({ user: paidUser() });
  const res = await call(ctx.r, 'post', '/cancel-subscription');
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(ctx.razorpay.calls.cancels, [['sub_plan', 1], ['sub_addon', 1]]);
  assert.strictEqual(ctx.user.subscription.cancelAtPeriodEnd, true);
  assert.ok(ctx.user.subscription.cancelRequestedAt);
  assert.ok(res.body.endsAt);
  assert.strictEqual(ctx.user.plan.tier, 'starter', 'the plan keeps working until the month ends');
});

test('cancel: pressing it twice does not cancel twice', async () => {
  const ctx = setup({ user: paidUser() });
  await call(ctx.r, 'post', '/cancel-subscription');
  const again = await call(ctx.r, 'post', '/cancel-subscription');
  assert.strictEqual(again.code, 200);
  assert.strictEqual(again.body.alreadyCancelling, true);
  assert.strictEqual(ctx.razorpay.calls.cancels.length, 2);
});

test('cancel: a free or managed account has nothing to cancel', async () => {
  for (const tier of ['free', undefined]) {
    const ctx = setup({ user: mkUser({ plan: tier ? { tier, addons: [], subscriptions: [] } : undefined }) });
    const res = await call(ctx.r, 'post', '/cancel-subscription');
    assert.strictEqual(res.code, 400);
    assert.strictEqual(ctx.razorpay.calls.cancels.length, 0);
  }
});

test('cancel: if Razorpay refuses, nothing is marked and the customer is told plainly', async () => {
  const ctx = setup({ user: paidUser() });
  ctx.razorpay.subscriptions.cancel = async () => { throw new Error('gateway down'); };
  const res = await call(ctx.r, 'post', '/cancel-subscription');
  assert.strictEqual(res.code, 502);
  assert.match(res.body.message, /could not cancel/);
  assert.ok(!ctx.user.subscription.cancelAtPeriodEnd);
});

test('cancel: "already cancelled" from Razorpay counts as done', async () => {
  const ctx = setup({ user: paidUser() });
  ctx.razorpay.subscriptions.cancel = async () => { const e = new Error('x'); e.error = { description: 'The subscription is already cancelled' }; throw e; };
  const res = await call(ctx.r, 'post', '/cancel-subscription');
  assert.strictEqual(res.code, 200);
  assert.strictEqual(ctx.user.subscription.cancelAtPeriodEnd, true);
});

test('a new plan payment clears a pending cancellation', () => {
  const b = bp.buildChargeUpdate({ kind: 'plan', key: 'starter', subscriptionId: 'sub_new' }, { paymentId: 'p', paidPaise: 117882 });
  assert.strictEqual(b.update.$set['subscription.cancelAtPeriodEnd'], false);
});

// ---------------------------------------------------------------- invoice details: GSTIN and state
const gstinRulesT = require('../services/gstin');
const validGstin = (() => { const f = '33ABCDE1234F1Z'; return f + gstinRulesT.checkChar(f); })();

test('details: a valid GSTIN with a business name is saved, and fixes the state', async () => {
  const ctx = setup({ user: mkUser() });
  const res = await call(ctx.r, 'put', '/billing-details', { body: { gstin: validGstin.toLowerCase(), legalName: 'Asha Traders', address: '4 Main Road', pin: '600001', stateCode: 'KA' } });
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  assert.strictEqual(ctx.user.billingDetails.gstin, validGstin);
  assert.strictEqual(ctx.user.billingDetails.stateCode, 'TN', 'the GSTIN decides the state, not the dropdown');
  const got = await call(ctx.r, 'get', '/billing-details');
  assert.strictEqual(got.body.details.legalName, 'Asha Traders');
});

test('details: a bad GSTIN, a missing business name or a bad PIN is refused and nothing is saved', async () => {
  const ctx = setup({ user: mkUser() });
  let res = await call(ctx.r, 'put', '/billing-details', { body: { gstin: '33ABCDE1234F1Z0', legalName: 'X Co' } });
  assert.strictEqual(res.code, 400); assert.ok(res.body.errors.gstin);
  res = await call(ctx.r, 'put', '/billing-details', { body: { gstin: validGstin } });
  assert.strictEqual(res.code, 400); assert.ok(res.body.errors.legalName);
  res = await call(ctx.r, 'put', '/billing-details', { body: { pin: '12' } });
  assert.strictEqual(res.code, 400); assert.ok(res.body.errors.pin);
  assert.ok(!ctx.user.billingDetails);
});

test('details: without a GSTIN only a state can be saved, and an unknown state is refused', async () => {
  const ctx = setup({ user: mkUser() });
  assert.strictEqual((await call(ctx.r, 'put', '/billing-details', { body: { stateCode: 'KA' } })).code, 200);
  assert.strictEqual(ctx.user.billingDetails.stateCode, 'KA');
  assert.strictEqual(ctx.user.billingDetails.gstin, '');
  assert.strictEqual((await call(ctx.r, 'put', '/billing-details', { body: { stateCode: 'ZZ' } })).code, 400);
});

test('details: clearing the GSTIN keeps the account working and the invoice goes back to a plain one', async () => {
  const ctx = setup({ user: mkUser({ billingDetails: { gstin: validGstin, legalName: 'Asha Traders', stateCode: 'TN' } }) });
  assert.strictEqual((await call(ctx.r, 'put', '/billing-details', { body: { gstin: '' } })).code, 200);
  assert.strictEqual(ctx.user.billingDetails.gstin, '');
});

test('the invoice for a payment carries the customer details when they added them, and none when they did not', async () => {
  const withDetails = setup({ user: mkUser({ billingDetails: { gstin: validGstin, legalName: 'Asha Traders', address: '4 Main Road', pin: '600001', stateCode: 'TN' } }) });
  const t1 = await paidTopup(withDetails, { pack: 1000, payId: 'pay_gst1' });
  assert.strictEqual((await t1.verify()).code, 200);
  assert.strictEqual(withDetails.invoices[0].billing.gstin, validGstin);
  assert.strictEqual(withDetails.invoices[0].billing.legalName, 'Asha Traders');
  assert.strictEqual(withDetails.invoices[0].billing.stateName, 'Tamil Nadu');
  const plain = setup({ user: mkUser() });
  const t2 = await paidTopup(plain, { pack: 1000, payId: 'pay_gst2' });
  assert.strictEqual((await t2.verify()).code, 200);
  assert.strictEqual(plain.invoices[0].billing, undefined);
});

test('Zoho: a GSTIN makes a business invoice (contact updated, gst number, state, and the service code on the line)', async () => {
  const realFetch = global.fetch; const seen = [];
  const env = { ...process.env };
  Object.assign(process.env, { ZOHO_BOOKS_REFRESH_TOKEN: 't', ZOHO_BOOKS_CLIENT_ID: 'c', ZOHO_BOOKS_CLIENT_SECRET: 's', ZOHO_BOOKS_ORG_ID: 'org' });
  global.fetch = async (url, opts = {}) => {
    const u = String(url); seen.push({ u, body: typeof opts.body === 'string' ? JSON.parse(opts.body) : null, method: opts.method });
    const json = (o) => ({ json: async () => o });
    if (u.includes('oauth/v2/token')) return json({ access_token: 'a', expires_in: 3600 });
    if (u.includes('/settings/taxes')) return json({ code: 0, taxes: [{ tax_id: 'tax18', tax_percentage: 18, tax_name: 'GST' }] });
    if (u.includes('/contacts?')) return json({ code: 0, contacts: [{ contact_id: 'c1' }] });
    if (u.includes('/invoices?')) return json({ code: 0, invoice: { invoice_id: 'i1', invoice_number: 'INV-9', invoice_url: 'https://z/i1' } });
    return json({ code: 0 });
  };
  try {
    const { createInvoice } = require('../services/zohoBooks');
    const base = { email: 'a@b.c', firstName: 'A', lastName: '', companyName: '', razorpayPaymentId: 'pay_1', itemName: 'Nebulaa subscription', description: 'Starter, monthly', amount: 999, gstPercent: 18, totalAmount: 1178.82 };
    await createInvoice({ ...base, billing: { gstin: validGstin, legalName: 'Asha Traders', address: '4 Main Road', pin: '600001', stateCode: 'KA', stateName: 'Karnataka' } });
    const inv = seen.find((x) => x.u.includes('/invoices?') && x.method === 'POST').body;
    assert.strictEqual(inv.gst_treatment, 'business_gst');
    assert.strictEqual(inv.gst_no, validGstin);
    assert.strictEqual(inv.place_of_supply, 'KA');
    assert.strictEqual(inv.line_items[0].hsn_or_sac, '997331');
    const put = seen.find((x) => x.method === 'PUT');
    assert.strictEqual(put.body.gst_no, validGstin);
    assert.strictEqual(put.body.gst_treatment, 'business_gst');
    // and a plain customer still gets a consumer invoice, with the service code and no GST number
    seen.length = 0;
    await createInvoice(base);
    const plain = seen.find((x) => x.u.includes('/invoices?') && x.method === 'POST').body;
    assert.strictEqual(plain.gst_treatment, 'consumer');
    assert.ok(!('gst_no' in plain));
    assert.strictEqual(plain.place_of_supply, 'TN');
    assert.strictEqual(plain.line_items[0].hsn_or_sac, '997331');
    assert.ok(!seen.some((x) => x.method === 'PUT'));
  } finally { global.fetch = realFetch; for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; }
});
