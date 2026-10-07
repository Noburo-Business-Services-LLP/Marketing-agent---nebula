// The Money numbers: pure builder with fixtures. Every amount is integer paise.
const test = require('node:test');
const assert = require('node:assert');
const { buildMoney, buildPayments, describePayment, monthStart, quarkTotals } = require('../services/staff/money');
const { paymentFailureMessage } = require('../services/providerErrors');
const { AYRSHARE } = require('../config/vendorPlans');
const { PLANS, ADDONS, USD_PER_QUARK } = require('../config/apiCosts');

const NOW = new Date('2026-10-07T06:30:00Z').getTime(); // 12:00 in India, 7 October
const DAY = 86400000;
const ago = (d) => new Date(NOW - d * DAY);
const ahead = (d) => new Date(NOW + d * DAY);
const pay = (over = {}) => ({ razorpayOrderId: 'sub_1', razorpayPaymentId: `pay_${Math.random()}`, amount: 1178.82, exGstAmount: 999, currency: 'INR', credits: 2100, status: 'paid', item: 'Nebulaa subscription', paidAt: ago(1), ...over });
const mk = (id, over = {}) => ({ _id: id, email: `${id}@x.com`, companyName: `Co ${id}`, createdAt: ago(60), payments: [], plan: { tier: 'free', addons: [], subscriptions: [] }, credits: { balance: 100, history: [] }, ...over });

test('months are counted in India time', () => {
  // 1 October 00:00 IST is 30 September 18:30 UTC
  assert.strictEqual(new Date(monthStart(NOW, 0)).toISOString(), '2026-09-30T18:30:00.000Z');
  assert.strictEqual(new Date(monthStart(NOW, 1)).toISOString(), '2026-08-31T18:30:00.000Z');
  assert.strictEqual(new Date(monthStart(new Date('2026-01-15T00:00:00Z').getTime(), 1)).toISOString(), '2025-11-30T18:30:00.000Z');
});

test('revenue is split ex-GST and GST in integer paise for this month, last month, 30 days and all time', () => {
  const users = [
    mk('a', { payments: [
      pay({ paidAt: ago(2) }),                                  // this month
      pay({ paidAt: ago(20) }),                                 // last month (17 Sep), inside 30 days
      pay({ paidAt: ago(70), amount: 2358.82, exGstAmount: 1999 }), // older: all time only
      pay({ paidAt: ago(1), status: 'failed' }),                // never revenue
      pay({ paidAt: ago(1), status: 'refunded' })               // never revenue
    ] })
  ];
  const r = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).revenue;
  assert.deepStrictEqual([r.thisMonth.exGstPaise, r.thisMonth.gstPaise, r.thisMonth.totalPaise, r.thisMonth.count], [99900, 17982, 117882, 1]);
  assert.deepStrictEqual([r.lastMonth.exGstPaise, r.lastMonth.totalPaise], [99900, 117882]);
  assert.deepStrictEqual([r.last30Days.exGstPaise, r.last30Days.count], [199800, 2]);
  assert.deepStrictEqual([r.allTime.exGstPaise, r.allTime.gstPaise, r.allTime.totalPaise, r.allTime.count], [399700, 71946, 471646, 3]);
  for (const w of Object.values(r).filter((x) => x && typeof x === 'object' && 'totalPaise' in x)) {
    for (const k of ['exGstPaise', 'gstPaise', 'unsplitPaise', 'totalPaise']) assert.ok(Number.isInteger(w[k]), `${k} must be an integer`);
    assert.strictEqual(w.exGstPaise + w.gstPaise + w.unsplitPaise, w.totalPaise);
  }
});

test('a payment with no stored ex-GST amount is counted in the total but not split, and says so', () => {
  const users = [mk('a', { payments: [pay({ amount: 500, exGstAmount: undefined, paidAt: ago(1) })] })];
  const r = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).revenue;
  assert.deepStrictEqual([r.thisMonth.totalPaise, r.thisMonth.unsplitPaise, r.thisMonth.exGstPaise, r.thisMonth.gstPaise], [50000, 50000, 0, 0]);
  assert.match(r.note, /not split/i);
});

test('payments in another currency are left out of the rupee figures and counted', () => {
  const users = [mk('a', { payments: [pay({ currency: 'USD', amount: 12, paidAt: ago(1) }), pay({ paidAt: ago(1) })] })];
  const r = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).revenue;
  assert.strictEqual(r.thisMonth.count, 1);
  assert.strictEqual(r.otherCurrencyPayments, 1);
});

test('staff, CSM and hidden test accounts never count as customers', () => {
  const users = [
    mk('a', { payments: [pay({ paidAt: ago(1) })] }),
    mk('b', { isHidden: true, payments: [pay({ paidAt: ago(1) })] }),
    mk('c', { staffRole: 'owner', payments: [pay({ paidAt: ago(1) })] }),
    mk('d', { isCsm: true, payments: [pay({ paidAt: ago(1) })] })
  ];
  const m = buildMoney({ users, now: NOW, ayrshareProfiles: 0 });
  assert.strictEqual(m.revenue.allTime.count, 1);
  assert.strictEqual(m.payments.total, 1);
  assert.strictEqual(m.planMix.customers, 1);
});

test('the 30-day revenue series has one entry per India day, oldest first, and adds up', () => {
  const users = [mk('a', { payments: [pay({ paidAt: ago(2) }), pay({ paidAt: ago(2) }), pay({ paidAt: ago(40) })] })];
  const s = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).revenue.series30;
  assert.strictEqual(s.length, 30);
  assert.strictEqual(s[29].day, '2026-10-07');
  assert.strictEqual(s[27].day, '2026-10-05');
  assert.strictEqual(s[27].exGstPaise, 199800);
  assert.strictEqual(s.reduce((n, d) => n + d.totalPaise, 0), 117882 * 2);
});

test('plan mix counts tiers from the account and add-ons from active add-on subscriptions', () => {
  const sub = (kind, key, active = true) => ({ subscriptionId: `s_${kind}_${key}`, kind, key, active });
  const users = [
    mk('a'), // free
    mk('b', { plan: { tier: 'starter', addons: ['publish'], subscriptions: [sub('plan', 'starter'), sub('addon', 'publish')] } }),
    mk('c', { plan: { tier: 'professional', addons: ['bundle', 'publish', 'competitors', 'inbox'], subscriptions: [sub('plan', 'professional'), sub('addon', 'bundle')] } }),
    mk('d', { plan: undefined }),                                                    // old account: managed
    mk('e', { plan: { tier: 'starter', addons: ['inbox'], subscriptions: [sub('plan', 'starter'), sub('addon', 'inbox', false)] } }) // ended add-on
  ];
  const m = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).planMix;
  const tier = (id) => m.tiers.find((t) => t.id === id).count;
  assert.deepStrictEqual(['free', 'starter', 'professional', 'managed'].map(tier), [1, 2, 1, 1]);
  const addon = (id) => m.addons.find((t) => t.id === id).count;
  assert.deepStrictEqual(['publish', 'competitors', 'inbox', 'bundle'].map(addon), [1, 0, 0, 1]);
  assert.strictEqual(m.tiers.find((t) => t.id === 'starter').label, 'Starter');
  assert.strictEqual(m.addons.find((t) => t.id === 'bundle').label, ADDONS.bundle.label);
  assert.strictEqual(m.customers, 5);
});

test('monthly recurring is computed from config prices of active subscriptions, ex-GST integer paise', () => {
  const sub = (kind, key) => ({ subscriptionId: `s_${key}`, kind, key, active: true });
  const users = [mk('b', { plan: { tier: 'starter', subscriptions: [sub('plan', 'starter'), sub('addon', 'publish')] } })];
  const mrr = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).planMix.monthlyRecurring;
  assert.strictEqual(mrr.exGstPaise, (PLANS.starter.inr + ADDONS.publish.inr) * 100);
  assert.ok(Number.isInteger(mrr.exGstPaise));
});

test('payments are named from our own plan, add-on and pack names, never provider text', () => {
  const user = mk('a', { plan: { tier: 'starter', subscriptions: [{ subscriptionId: 'sub_p', kind: 'plan', key: 'starter' }, { subscriptionId: 'sub_a', kind: 'addon', key: 'publish' }] } });
  assert.strictEqual(describePayment(user, pay({ razorpayOrderId: 'sub_p' })), 'Starter plan');
  assert.strictEqual(describePayment(user, pay({ razorpayOrderId: 'sub_a', item: 'Nebulaa add-on' })), `${ADDONS.publish.label} add-on`);
  assert.match(describePayment(user, pay({ razorpayOrderId: 'order_1', item: 'Nebulaa Quarks', credits: 500 })), /^Quark pack, 500 Quarks$/);
  for (const raw of ['rzp_live_secret card declined by HDFC', undefined, '']) {
    const name = describePayment(user, pay({ razorpayOrderId: 'order_x', item: raw, credits: 0 }));
    assert.strictEqual(name, 'Payment');
  }
});

test('recent payments are paged newest first with status and ex-GST/GST', () => {
  const payments = Array.from({ length: 12 }, (_, i) => pay({ razorpayPaymentId: `p${i}`, paidAt: ago(i + 1), status: i === 3 ? 'failed' : 'paid' }));
  const users = [mk('a', { payments })];
  const m = buildMoney({ users, now: NOW, ayrshareProfiles: 0, pageSize: 5 });
  assert.deepStrictEqual([m.payments.total, m.payments.pages, m.payments.page, m.payments.rows.length], [12, 3, 1, 5]);
  assert.strictEqual(m.payments.rows[0].clientName, 'Co a');
  assert.strictEqual(m.payments.rows[3].status, 'failed');
  assert.ok(new Date(m.payments.rows[0].at) > new Date(m.payments.rows[4].at));
  const p3 = buildPayments({ users, page: 3, pageSize: 5 });
  assert.strictEqual(p3.rows.length, 2);
  assert.deepStrictEqual(Object.keys(m.payments.rows[0]).sort(), ['at', 'clientId', 'clientName', 'exGstPaise', 'gstPaise', 'id', 'status', 'totalPaise', 'what']);
  assert.strictEqual(buildPayments({ users, page: 99, pageSize: 5 }).page, 3);
});

test('renewals list active plans billing in the next 14 days, soonest first, with the config price', () => {
  const act = (id, tier, next, status = 'active') => mk(id, { plan: { tier, subscriptions: [{ subscriptionId: `s${id}`, kind: 'plan', key: tier, active: true }] }, subscription: { status, nextBillingAt: next } });
  const users = [act('a', 'starter', ahead(3)), act('b', 'professional', ahead(1)), act('c', 'starter', ahead(20)), act('d', 'starter', ahead(2), 'halted'), act('e', 'starter', ago(1))];
  const r = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).renewals;
  assert.deepStrictEqual(r.items.map((i) => i.clientId), ['b', 'a']);
  assert.strictEqual(r.items[0].what, 'Professional plan');
  assert.strictEqual(r.items[0].totalPaise, 199900 + Math.floor((199900 * 18 * 2 + 100) / 200));
  assert.strictEqual(r.totalPaise, r.items.reduce((n, i) => n + i.totalPaise, 0));
  assert.strictEqual(r.windowDays, 14);
  assert.match(r.note, /add-on/i);
});

test('failures: failed payments and halted or cancelled plans in the last 30 days, with plain reasons only', () => {
  const users = [
    mk('a', { payments: [pay({ status: 'failed', paidAt: ago(3), item: 'HDFC bank said: card declined (rzp_err_9)' }), pay({ status: 'failed', paidAt: ago(45) })] }),
    mk('b', { subscription: { status: 'halted', currentPeriodEnd: ago(5) }, plan: { tier: 'free' } }),
    mk('c', { subscription: { status: 'cancelled', currentPeriodEnd: ago(40) }, plan: { tier: 'free' } }),
    mk('d', { subscription: { status: 'cancelled', currentPeriodEnd: ago(2) }, plan: { tier: 'free' } }),
    mk('e', { subscription: { status: 'halted' }, plan: { tier: 'free' } }) // no date stored
  ];
  const f = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).failures;
  assert.strictEqual(f.payments.count, 1);
  assert.deepStrictEqual(f.renewals.items.map((i) => [i.clientId, i.kind]), [['d', 'cancelled'], ['b', 'halted'], ['e', 'halted']]);
  assert.strictEqual(f.renewals.items[2].at, null);
  const text = JSON.stringify(f);
  assert.doesNotMatch(text, /HDFC|rzp_|razorpay|card declined/i);
  assert.ok([...f.payments.items, ...f.renewals.items].every((i) => typeof i.reason === 'string' && i.reason.endsWith('.')));
  assert.match(f.note, /only/i);
});

test('a stopped plan is still named from the stored subscription record, even after the account went back to free', () => {
  const users = [mk('b', { subscription: { status: 'halted', currentPeriodEnd: ago(5) }, plan: { tier: 'free', subscriptions: [{ subscriptionId: 's1', kind: 'plan', key: 'professional', active: false }] } })];
  assert.strictEqual(buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).failures.renewals.items[0].what, 'Professional plan');
});

test('failure reasons come from providerErrors and never repeat raw provider text', () => {
  assert.match(paymentFailureMessage('failed'), /did not go through/i);
  assert.match(paymentFailureMessage('halted'), /stopped/i);
  assert.match(paymentFailureMessage('cancelled'), /cancelled/i);
  for (const weird of ['BAD_REQUEST_ERROR: Ayrshare 276 quota', undefined, { message: 'gemini' }, 42]) {
    const m = paymentFailureMessage(weird);
    assert.doesNotMatch(m, /ayrshare|gemini|276|quota|bad_request|42/i);
    assert.ok(m.endsWith('.'));
  }
});

test('Quarks sold come from paid payments this month; spent from this month history, refunds taken off', () => {
  const hist = (o) => ({ createdAt: ago(1), timestamp: ago(1), ...o });
  const users = [
    mk('a', {
      payments: [pay({ paidAt: ago(1), credits: 2100 }), pay({ paidAt: ago(1), credits: 500, status: 'failed' }), pay({ paidAt: ago(30), credits: 999 })],
      credits: { balance: 1, history: [
        hist({ action: 'image', amount: -40 }), hist({ action: 'video', amount: -100 }), hist({ action: 'video_refund', amount: 100 }),
        hist({ action: 'image', cost: 10 }),                                  // older code path: cost only
        hist({ action: 'staff_grant', amount: 500 }),
        hist({ action: 'image', amount: -999, createdAt: ago(30), timestamp: ago(30) })  // last month
      ] }
    })
  ];
  const q = buildMoney({ users, now: NOW, ayrshareProfiles: 0 }).quarks;
  assert.deepStrictEqual([q.sold, q.spent, q.refunded, q.grantedByStaff], [2100, 50, 100, 500]);
  assert.strictEqual(q.usdPerQuark, USD_PER_QUARK);
  assert.strictEqual(q.spentValueUsdCents, Math.round(50 * USD_PER_QUARK * 100));
});

test('Quarks spent says when a long history may have been cut short', () => {
  const entries = Array.from({ length: 60 }, () => ({ action: 'image', amount: -1, createdAt: ago(1), timestamp: ago(1) }));
  const q = buildMoney({ users: [mk('a', { credits: { balance: 0, history: entries } }), mk('b')], now: NOW, ayrshareProfiles: 0 }).quarks;
  assert.strictEqual(q.spent, 60);
  assert.strictEqual(q.possiblyIncompleteClients, 1);
  assert.match(q.note, /last/i);
});

test('Ayrshare profiles against the included number, extra at the config rate, labelled an estimate', () => {
  const a = buildMoney({ users: [], now: NOW, ayrshareProfiles: 34 }).ayrshare;
  assert.deepStrictEqual([a.available, a.profiles, a.included, a.extra], [true, 34, AYRSHARE.includedProfiles, 34 - AYRSHARE.includedProfiles]);
  assert.strictEqual(a.extraUsdCents, (34 - AYRSHARE.includedProfiles) * Math.round(AYRSHARE.extraProfileUsd * 100));
  assert.strictEqual(a.estimate, true);
  assert.strictEqual(buildMoney({ users: [], now: NOW, ayrshareProfiles: 12 }).ayrshare.extraUsdCents, 0);
});

test('a number that cannot be read says so instead of showing zero', () => {
  const a = buildMoney({ users: [], now: NOW, ayrshareProfiles: null }).ayrshare;
  assert.strictEqual(a.available, false);
  assert.match(a.reason, /could not/i);
  assert.strictEqual(a.profiles, undefined);
});

test('quarkTotals ignores entries with no usable date', () => {
  const t = quarkTotals([mk('a', { credits: { history: [{ action: 'image', amount: -5 }] } })], NOW);
  assert.strictEqual(t.spent, 0);
});
