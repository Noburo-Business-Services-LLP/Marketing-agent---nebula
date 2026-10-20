// A top-up paid while the browser was closed is credited by the order.paid / payment.captured webhook, once, with the
// same checks as /verify. And a second plan is never started while one is active. In-memory fakes only.
const test = require('node:test');
const assert = require('node:assert');
const { chargePaise } = require('../config/apiCosts');
const bp = require('../services/billingPlans');
const { ENV, hmac, mkFree, setup, stored, handlerOf, call } = require('./paymentFakes');

const PACK = bp.findTopupPack(1000);
const PAID = chargePaise(1000);
const mkUser = (over = {}) => mkFree({ plan: { tier: 'starter', addons: [], subscriptions: [] }, ...over });

function topupBody(eventName, { orderId = 'order_1', paymentId = 'pay_1', amount = PAID, userId = 'user1', packInr = 1000, kind = 'topup', withOrder = true } = {}) {
  const notes = { userId, kind, packInr: String(packInr), quarks: String(PACK.quarks) };
  const payload = { payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured', notes } } };
  if (withOrder) payload.order = { entity: { id: orderId, amount, status: 'paid', notes } };
  return Buffer.from(JSON.stringify({ event: eventName, payload }));
}
const hook = (ctx, body, sig) => call(ctx.r, 'post', '/webhook', { body, headers: { 'x-razorpay-signature': sig === undefined ? hmac(ENV.RAZORPAY_WEBHOOK_SECRET, body.toString()) : sig } });

test('order.paid credits the top-up once; a replay credits nothing more', async () => {
  const ctx = setup({ user: mkUser() });
  const body = topupBody('order.paid');
  assert.strictEqual((await hook(ctx, body)).code, 200);
  assert.strictEqual(stored(ctx).credits.balance, 100 + PACK.quarks);
  assert.strictEqual(stored(ctx).credits.topupBalance, PACK.quarks);
  assert.strictEqual(stored(ctx).payments.length, 1);
  await hook(ctx, body);
  assert.strictEqual(stored(ctx).credits.balance, 100 + PACK.quarks);
  assert.strictEqual(stored(ctx).payments.length, 1);
});

test('payment.captured of a top-up order credits too, with only the payment entity', async () => {
  const ctx = setup({ user: mkUser() });
  await hook(ctx, topupBody('payment.captured', { withOrder: false }));
  assert.strictEqual(stored(ctx).credits.balance, 100 + PACK.quarks);
});

test('verify then webhook (and webhook then verify) credit only once', async () => {
  const ctx = setup({ user: mkUser() });
  ctx.razorpay.orders.fetch = async (id) => ({ id, amount: PAID, notes: { userId: 'user1', kind: 'topup', packInr: '1000' } });
  const verify = () => call(ctx.r, 'post', '/verify', { body: { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: hmac(ENV.RAZORPAY_KEY_SECRET, 'order_1|pay_1') } });
  assert.strictEqual((await verify()).body.quarksGranted, PACK.quarks);
  await hook(ctx, topupBody('order.paid'));
  assert.strictEqual(stored(ctx).credits.balance, 100 + PACK.quarks);
  const ctx2 = setup({ user: mkUser() });
  ctx2.razorpay.orders.fetch = ctx.razorpay.orders.fetch;
  await hook(ctx2, topupBody('order.paid'));
  const res = await call(ctx2.r, 'post', '/verify', { body: { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: hmac(ENV.RAZORPAY_KEY_SECRET, 'order_1|pay_1') } });
  assert.strictEqual(res.body.alreadyProcessed, true);
  assert.strictEqual(stored(ctx2).credits.balance, 100 + PACK.quarks);
});

test('a wrong amount is refused and recorded for a refund, nothing credited', async () => {
  const ctx = setup({ user: mkUser() });
  await hook(ctx, topupBody('order.paid', { amount: PAID - 100 }));
  const u = stored(ctx);
  assert.strictEqual(u.credits.balance, 100);
  assert.strictEqual(u.payments.length, 1);
  assert.strictEqual(u.payments[0].status, 'failed'); assert.strictEqual(u.payments[0].needsRefund, true);
  assert.strictEqual(u.payments[0].reason, 'amount_mismatch');
});

test('an unknown account or unknown pack credits nothing', async () => {
  const ctx = setup({ user: mkUser() });
  await hook(ctx, topupBody('order.paid', { userId: 'ghost' }));
  assert.ok(ctx.alerts.length >= 1);
  await hook(ctx, topupBody('order.paid', { paymentId: 'pay_2', packInr: 123 }));
  assert.strictEqual(stored(ctx).credits.balance, 100);
  assert.strictEqual(stored(ctx).credits.topupBalance, 0);
});

test('a bad signature is rejected, and other events or non-top-up payments are ignored', async () => {
  const ctx = setup({ user: mkUser() });
  assert.strictEqual((await hook(ctx, topupBody('order.paid'), 'deadbeef')).code, 400);
  assert.strictEqual(stored(ctx).credits.balance, 100);
  await hook(ctx, topupBody('payment.refunded'));
  await hook(ctx, topupBody('payment.captured', { kind: 'other' }));
  assert.strictEqual(stored(ctx).credits.balance, 100);
  assert.strictEqual(stored(ctx).payments.length, 0);
});

// ---------------------------------------------------------------- double plan
const planRec = (id, over = {}) => ({ subscriptionId: id, kind: 'plan', key: 'starter', razorpayPlanId: 'plan_starter', active: false, createdAt: new Date(), ...over });
const planCharge = (subId, paymentId) => {
  const quote = bp.planQuote('starter');
  return Buffer.from(JSON.stringify({ event: 'subscription.charged', payload: {
    subscription: { entity: { id: subId, plan_id: 'plan_starter', notes: { userId: 'user1' } } },
    payment: { entity: { id: paymentId, amount: quote.chargePaise } }
  } }));
};

test('a first payment for a second plan while one is active is refused, recorded, and its subscription cancelled', async () => {
  const user = mkUser({ plan: { tier: 'starter', addons: [], subscriptionId: 'sub_a', subscriptions: [planRec('sub_a', { active: true }), planRec('sub_b')] }, subscription: { status: 'active', razorpaySubscriptionId: 'sub_a' } });
  const ctx = setup({ user });
  await hook(ctx, planCharge('sub_b', 'pay_b'));
  const u = stored(ctx);
  assert.strictEqual(u.credits.balance, 100, 'no second allowance');
  assert.strictEqual(u.payments[0].reason, 'duplicate_plan'); assert.strictEqual(u.payments[0].needsRefund, true);
  assert.deepStrictEqual(ctx.razorpay.calls.cancels, [['sub_b', 0]]);
  await hook(ctx, planCharge('sub_b', 'pay_b'));
  assert.strictEqual(stored(ctx).payments.length, 1, 'a replay records nothing more');
});

test('a renewal of the active plan and a first plan payment with no other plan active still work', async () => {
  const renew = setup({ user: mkUser({ plan: { tier: 'starter', addons: [], subscriptionId: 'sub_a', subscriptions: [planRec('sub_a', { active: true })] }, subscription: { status: 'active', razorpaySubscriptionId: 'sub_a' } }) });
  await hook(renew, planCharge('sub_a', 'pay_r'));
  assert.strictEqual(stored(renew).payments[0].status === 'failed', false);
  assert.ok(stored(renew).credits.balance > 100);
  const first = setup({ user: mkUser({ plan: { tier: 'free', addons: [], subscriptions: [planRec('sub_n')] }, subscription: { status: 'active' } }) });
  await hook(first, planCharge('sub_n', 'pay_f'));
  assert.ok(stored(first).credits.balance > 100);
  assert.strictEqual(first.razorpay.calls.cancels.length, 0);
});

// ---------------------------------------------------------------- reuse of an unpaid checkout
const free = (subs) => mkFree({ plan: { tier: 'free', addons: [], subscriptions: subs }, subscription: { status: 'active' } });
function openEntity(ctx, id, over = {}) { ctx.razorpay.subscriptions.fetch = async () => ({ id, status: 'created', plan_id: 'plan_starter', notes: { userId: 'user1' }, ...over }); }

test('create-subscription reuses an unpaid checkout from the last 30 minutes for the same plan', async () => {
  const ctx = setup({ user: free([planRec('sub_open')]) });
  openEntity(ctx, 'sub_open');
  const res = await call(ctx.r, 'post', '/create-subscription', { body: { planId: 'starter' } });
  assert.strictEqual(res.body.subscription_id, 'sub_open');
  assert.strictEqual(ctx.razorpay.calls.subs.length, 0);
});

test('create-subscription makes a new one when the old checkout is old, another plan, coupon-tagged or no longer unpaid', async () => {
  const old = new Date(Date.now() - 31 * 60 * 1000);
  const cases = [
    [free([planRec('sub_open', { createdAt: old })]), {}],
    [free([planRec('sub_open', { key: 'professional' })]), {}],
    [free([planRec('sub_open')]), { notes: { userId: 'user1', couponCode: 'X' } }],
    [free([planRec('sub_open')]), { status: 'authenticated' }]
  ];
  for (const [user, over] of cases) {
    const ctx = setup({ user });
    openEntity(ctx, 'sub_open', over);
    const res = await call(ctx.r, 'post', '/create-subscription', { body: { planId: 'starter' } });
    assert.notStrictEqual(res.body.subscription_id, 'sub_open');
    assert.strictEqual(ctx.razorpay.calls.subs.length, 1);
  }
});
