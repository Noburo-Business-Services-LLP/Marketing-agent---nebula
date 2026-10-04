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
  const calls = { plans: [], subs: [], orders: [] };
  const subs = {}; const orders = {};
  return {
    calls,
    plans: { create: async (b) => { calls.plans.push(b); return { id: `plan_fake${calls.plans.length}` }; } },
    subscriptions: {
      create: async (b) => { calls.subs.push(b); const s = { id: `sub_fake${calls.subs.length}`, plan_id: b.plan_id, notes: b.notes }; subs[s.id] = s; return s; },
      fetch: async (id) => subs[id]
    },
    orders: {
      create: async (b) => { calls.orders.push(b); const o = { id: `order_fake${calls.orders.length}`, amount: b.amount, currency: b.currency, notes: b.notes }; orders[o.id] = o; return o; },
      fetch: async (id) => orders[id]
    },
    payments: { fetch: async () => ({}) },
    _orders: orders
  };
}
function setup({ user = mkUser(), env = ENV } = {}) {
  const User = fakeUserModel([user]);
  const razorpay = fakeRazorpay();
  const invoices = [];
  const r = createPaymentRouter({
    razorpay, User, env,
    protect: (req, res, next) => next(),
    Coupon: { findOne: async () => null, findOneAndUpdate: async () => null },
    createInvoice: async (p) => { invoices.push(p); return { invoiceNumber: 'INV-1', invoiceUrl: 'https://invoice.example/1' }; }
  });
  return { r, User, razorpay, invoices, user };
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
test('plans catalogue: only starter and professional, numbers from config', () => {
  const c = bp.planCatalogue();
  assert.deepStrictEqual(c.plans.map((p) => p.id), ['starter', 'professional']);
  const [s, p] = c.plans;
  assert.strictEqual(s.inr, 999); assert.strictEqual(s.gstPaise, 17982); assert.strictEqual(s.chargePaise, 117882); assert.strictEqual(s.quarks, 2100);
  assert.strictEqual(p.inr, 1999); assert.strictEqual(p.gstPaise, 35982); assert.strictEqual(p.chargePaise, 235882); assert.strictEqual(p.quarks, 3500);
  for (const x of c.plans) { assert.ok(x.name); assert.ok(Array.isArray(x.features) && x.features.length >= 3); }
  assert.ok(s.features.some((f) => /2,100 Quarks/.test(f)));
  assert.ok(p.features.some((f) => /3,500 Quarks/.test(f)));
  assert.deepStrictEqual(c.topups.map((t) => [t.inr, t.quarks, t.chargePaise]), [[999, 500, 117882], [1999, 1000, 235882], [4999, 2500, 589882]]);
  assert.deepStrictEqual(c.addons.map((a) => a.id), ['publish', 'competitors', 'inbox', 'bundle']);
  assert.strictEqual(c.addons.find((a) => a.id === 'publish').chargePaise, chargePaise(1000));
  assert.deepStrictEqual(c.addons.find((a) => a.id === 'inbox').requires, ['publish']);
  assert.ok(!JSON.stringify(c).includes('managed'));
});

test('findTopupPack accepts only a pack price as a number', () => {
  for (const ok of [999, 1999, 4999]) assert.ok(bp.findTopupPack(ok));
  for (const bad of [1000, 0, -5, '500', '999', NaN, null, undefined, 999.5, Infinity, {}, [999]]) assert.strictEqual(bp.findTopupPack(bad), null, String(bad));
});

test('invoice item names and the GST line', () => {
  const plan = bp.invoiceSpec('plan', 'starter');
  assert.strictEqual(plan.itemName, 'Nebulaa subscription');
  assert.strictEqual(plan.amountInr, 999); assert.strictEqual(plan.gstPercent, 18);
  assert.strictEqual(plan.gstPaise, 17982); assert.strictEqual(plan.totalPaise, 117882);
  assert.strictEqual(bp.invoiceSpec('addon', 'inbox').itemName, 'Nebulaa add-on');
  const top = bp.invoiceSpec('topup', 4999);
  assert.strictEqual(top.itemName, 'Nebulaa Quarks'); assert.strictEqual(top.totalPaise, 589882);
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
  assert.deepStrictEqual(res.body.plans.map((p) => p.id), ['starter', 'professional']);
  assert.strictEqual(res.body.topups.length, 3);
  assert.strictEqual(res.body.addons.length, 4);
  assert.ok(!/plan_Sra|growth|"scale"|7500/i.test(JSON.stringify(res.body)));
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
  for (const [pack, paise, quarks] of [[999, 117882, 500], [1999, 235882, 1000], [4999, 589882, 2500]]) {
    const ctx = setup();
    const res = await call(ctx.r, 'post', '/create-order', { body: { packInr: pack, amount: 1, quarks: 999999, credits: 999999 } });
    assert.strictEqual(res.code, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.order.amount, paise);
    const o = ctx.razorpay.calls.orders[0];
    assert.strictEqual(o.amount, paise);
    assert.strictEqual(o.notes.quarks, String(quarks)); assert.strictEqual(o.notes.kind, 'topup'); assert.strictEqual(o.notes.userId, 'user1');
  }
  for (const bad of [1000, 0, -5, '500', NaN, null, undefined, 999.5, 7500]) {
    const ctx = setup();
    const res = await call(ctx.r, 'post', '/create-order', { body: { packInr: bad } });
    assert.strictEqual(res.code, 400, String(bad));
    assert.strictEqual(ctx.razorpay.calls.orders.length, 0);
  }
  const ctx = setup(); // the old field is not a way in
  assert.strictEqual((await call(ctx.r, 'post', '/create-order', { body: { amount: 7500 } })).code, 400);
});

async function paidTopup(ctx, { pack = 999, payId = 'pay_top1', forgeNotes } = {}) {
  const create = await call(ctx.r, 'post', '/create-order', { body: { packInr: pack } });
  const orderId = create.body.order.id;
  if (forgeNotes) Object.assign(ctx.razorpay._orders[orderId].notes, forgeNotes);
  return { orderId, verify: (sig) => call(ctx.r, 'post', '/verify', { body: { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sig === undefined ? hmac(ENV.RAZORPAY_KEY_SECRET, `${orderId}|${payId}`) : sig } }) };
}

test('top-up verify grants the pack Quarks from config, once', async () => {
  const ctx = setup();
  const t = await paidTopup(ctx, { pack: 1999, forgeNotes: { quarks: '99999' } });
  const res = await t.verify();
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  assert.strictEqual(ctx.user.credits.balance, 1100);
  assert.strictEqual(ctx.user.payments.length, 1);
  assert.strictEqual(ctx.user.payments[0].razorpayPaymentId, 'pay_top1');
  assert.strictEqual(ctx.user.payments[0].credits, 1000);
  assert.strictEqual(ctx.invoices.length, 1);
  assert.strictEqual(ctx.invoices[0].itemName, 'Nebulaa Quarks');
  assert.strictEqual(ctx.invoices[0].amount, 1999);
  assert.strictEqual(ctx.invoices[0].gstPercent, 18);
  assert.strictEqual(ctx.user.payments[0].invoiceUrl, 'https://invoice.example/1');
  const again = await t.verify();
  assert.strictEqual(again.code, 200);
  assert.strictEqual(again.body.alreadyProcessed, true);
  assert.strictEqual(ctx.user.credits.balance, 1100);
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
  for (const [planId, quarks, tier, inr] of [['starter', 2100, 'starter', 999], ['professional', 3500, 'professional', 1999]]) {
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
  assert.strictEqual(ctx.user.credits.balance, 2200);
  assert.strictEqual(ctx.user.plan.tier, 'starter');
  await sendHook(ctx.r, hook('subscription.charged', s.id, s.planId, 'pay_first', { amount: 117882 }));
  assert.strictEqual(ctx.user.credits.balance, 2200);
  assert.strictEqual(ctx.user.payments.length, 1);
  const bad = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_x', razorpay_subscription_id: s.id, razorpay_signature: 'nope' } });
  assert.strictEqual(bad.code, 400);
  const unknown = hmac(ENV.RAZORPAY_KEY_SECRET, 'pay_y|sub_unknown');
  const u = await call(ctx.r, 'post', '/verify-subscription', { body: { razorpay_payment_id: 'pay_y', razorpay_subscription_id: 'sub_unknown', razorpay_signature: unknown } });
  assert.ok(u.code >= 400);
  assert.strictEqual(ctx.user.credits.balance, 2200);
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
    assert.strictEqual(ctx.user.credits.balance, 3600); // Quarks already granted are kept
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
  assert.ok(!/plan_Sra|Growth|Scale|quarterly|annual/i.test(cfg));
});
