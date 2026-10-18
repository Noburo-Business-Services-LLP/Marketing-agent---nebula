/**
 * Guided Razorpay TEST-mode checkout check for the Agency plan and the extra client place.
 * Plain-language instructions: docs/superpowers/ops/razorpay-test-check.md
 *
 *   node scripts/razorpay-test-check.js           run the guided check (you pay twice with Razorpay's TEST card)
 *   node scripts/razorpay-test-check.js cleanup   clean up after an interrupted run
 *
 * Needs, in the shell (never in a file): I_APPROVED_RAZORPAY_TEST=yes, RAZORPAY_KEY_ID (rzp_test_...), RAZORPAY_KEY_SECRET.
 * MONGODB_URI comes from backend/.env as for the other scripts and must be the DEVELOPMENT database (nebulaa_dev).
 * It makes its own random webhook secret that exists only inside this process and is never printed.
 *
 * What runs for real: the REAL payment routes (create, verify, cancel) against Razorpay's TEST API and the real nebulaa_dev
 * database, through one small Razorpay client wrapper (scripts/lib/razorpayTestCheck.js). What is faked: the welcome email,
 * the Zoho invoice and the owner alert emails (nothing is sent). Webhook events are delivered by this script, signed with
 * the local secret, built from the real Razorpay ids and amounts: that proves our handler, not Razorpay's delivery.
 * Throwaway accounts, rows, files and Razorpay TEST subscriptions are removed at the end, on failure and on Ctrl+C.
 */
'use strict';
const L = require('./lib/razorpayTestCheck');

const BAR = '='.repeat(72);

// ---------------------------------------------------------------------------------------------------------------------
function quiet(fn) {
  // The routes log their own warnings (forged payments are meant to warn). Hold them back and show them only on a 500.
  const saved = [console.log, console.warn, console.error, console.info];
  const lines = [];
  console.log = console.warn = console.error = console.info = (...a) => lines.push(a.map((x) => (x && x.message) || String(x)).join(' '));
  return Promise.resolve().then(fn).then(
    (v) => { [console.log, console.warn, console.error, console.info] = saved; return { v, lines }; },
    (e) => { [console.log, console.warn, console.error, console.info] = saved; throw e; }
  );
}

function createAsk({ input = process.stdin, output = process.stdout } = {}) {
  const readline = require('readline');
  return (question) => new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    let interrupted = false;
    // Ctrl+C at a prompt must stop the run (the cleanup handler exits the process), not carry on as if Enter was pressed.
    rl.on('SIGINT', () => { interrupted = true; rl.close(); process.emit('SIGINT'); });
    rl.on('close', () => { if (!interrupted) resolve(''); });
    rl.question(question, (answer) => { rl.removeAllListeners('close'); rl.close(); resolve(String(answer || '').trim()); });
  });
}

class Stop extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
async function runCheck(c) {
  const { out, ask, client, results, models, tag, webhookSecret, keySecret, timing } = c;
  const { User } = models;
  const assert = require('assert');
  const http = require('http');
  const express = require('express');
  const bp = require('../services/billingPlans');
  const ws = require('../services/agencyWorkspaces');
  const agencyRules = require('../services/agency');
  const { PLANS, AGENCY } = require('../config/apiCosts');
  const { generateToken } = require('../middleware/auth');
  const { createPaymentRouter } = require('../routes/payment');
  const { buildMoney } = require('../services/staff/money');
  const legal = require('../config/legalVersions');
  const amt = L.expectedAmounts();

  // Fakes: no real email, no Zoho, no owner alert email. Counted so the checks can look at them.
  const fakes = { welcomes: [], invoices: [], notifies: [], alerts: [] };
  const routeEnv = {
    RAZORPAY_KEY_ID: c.keyId, RAZORPAY_KEY_SECRET: keySecret, RAZORPAY_WEBHOOK_SECRET: webhookSecret,
    ...(c.planOverrides.agency ? { RAZORPAY_PLAN_ID_AGENCY: c.planOverrides.agency } : {}),
    ...(c.planOverrides.slot ? { RAZORPAY_PLAN_ID_SLOT: c.planOverrides.slot } : {})
  };
  const router = createPaymentRouter({
    razorpay: client, env: routeEnv,
    createInvoice: async (p) => { fakes.invoices.push(p); return {}; },
    sendWelcome: async (u, info) => { fakes.welcomes.push({ email: u.email, ...info }); return { sent: false, fake: true }; },
    notifyNow: async (m) => { fakes.notifies.push(m); return true; },
    alert: (category, detail) => { fakes.alerts.push({ category, detail }); }
  });
  const app = express();
  app.use('/api/payment/webhook', express.raw({ type: 'application/json' })); // the raw body, before the JSON reader, as in the server
  app.use(express.json());
  app.use('/api/payment', router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  c.onServer(server);
  const base = `http://127.0.0.1:${server.address().port}`;

  const owner = await User.create({
    email: `${tag}-owner@example.test`, password: 'Check-only-1', firstName: 'Razorpay', lastName: 'Check', isVerified: true, onboardingCompleted: true,
    plan: { tier: 'free', addons: [] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'razorpay-test-check' }
  });
  c.saveCleanup({ userIds: [String(owner._id)] });
  const token = generateToken(owner._id);

  async function api(method, p, body) {
    const { v: res, lines } = await quiet(async () => {
      const r = await fetch(`${base}/api/payment${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
      let json = null; try { json = await r.json(); } catch (_) { /* no body */ }
      return { status: r.status, json };
    });
    if (res.status >= 500) {
      const why = client.lastError();
      out(`      (the route answered ${res.status}. Last Razorpay error: ${why ? `${why.call}: ${why.statusCode || ''} ${why.description}` : 'none'}${lines.length ? ` | log: ${lines.slice(-2).join(' / ').slice(0, 300)}` : ''})`);
    }
    return res;
  }
  async function hook(event) {
    const raw = JSON.stringify(event);
    const { v: res } = await quiet(async () => {
      const r = await fetch(`${base}/api/payment/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': L.webhookSignature(webhookSecret, raw) }, body: raw });
      return { status: r.status };
    });
    return res;
  }
  const hookBadSignature = async (event) => {
    const { v: res } = await quiet(async () => {
      const r = await fetch(`${base}/api/payment/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'f'.repeat(64) }, body: JSON.stringify(event) });
      return { status: r.status };
    });
    return res;
  };

  const fresh = async () => User.findById(owner._id).lean();
  const payRows = (u, id) => (u.payments || []).filter((p) => p.razorpayPaymentId === id);
  const recordOf = (u, subId) => ((u.plan && u.plan.subscriptions) || []).find((s) => s.subscriptionId === subId);
  const bal = (u) => Number((u.credits && u.credits.balance) || 0);
  const planBal = (u) => Number((u.credits && u.credits.planBalance) || 0);
  const wsRows = () => User.find({ 'agency.ownerId': owner._id }).sort({ createdAt: 1 }).lean();
  const sleepMs = async (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = () => sleepMs(timing.settleMs);

  async function step(name, fn) {
    try {
      const detail = await fn();
      results.add(name, 'PASS', detail || '');
      out(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
    } catch (e) {
      if (e instanceof Stop) { results.add(name, 'SKIP', e.message); out(`  SKIP  ${name}: ${e.message}`); return; }
      const msg = String((e && e.message) || e).split('\n')[0].slice(0, 400);
      results.add(name, 'FAIL', msg);
      out(`  FAIL  ${name}: ${msg}`);
      if (e && e.fatal) throw e;
    }
  }
  const fatal = (msg) => { const e = new Error(msg); e.fatal = true; return e; };

  // One real payment: show the link, pause, poll until Razorpay says active, then read the real payment.
  async function payAt({ title, subscriptionId, expectedPaise, cardNote }) {
    const sub0 = await client.subscriptions.fetch(subscriptionId);
    if (!sub0 || !sub0.short_url) throw fatal(`Razorpay did not return a payment link for ${title}.`);
    out('');
    out(BAR);
    out(`  YOUR TURN: pay for "${title}" in Razorpay TEST mode`);
    out(BAR);
    out(`  Amount the page should show: ${L.rupees(expectedPaise)} (the price plus 18% GST)`);
    out(`  1. Open this link in your browser:  ${sub0.short_url}`);
    out('  2. Pay in TEST mode. A subscription is a RECURRING payment, so the usual test card 4111 1111 1111 1111 is');
    out('     refused ("This card is not eligible for recurring payments"). If you see that, click "Try again" and use one of:');
    out('       - a card from the "recurring / subscription" part of Razorpay\'s test-card page (search: Razorpay test cards subscriptions);');
    out('       - UPI: enter the test UPI id success@razorpay (UPI autopay) and approve;');
    out('       - the "EMandate" option with a test bank and "Success".');
    out('     For any card use a future expiry (for example 12/34), any 3-digit CVV and any name. If a page asks for an OTP,');
    out('     pick "Success" or type any OTP. The script keeps waiting (up to 10 minutes) while you retry: do not press Enter or Ctrl+C.');
    out('  3. Wait until the page says the payment worked, then come back here.');
    if (cardNote) out(`  ${cardNote}`);
    out(BAR);
    await ask('Press Enter once you have paid (Ctrl+C to stop and clean up): ');
    out(`  Waiting for Razorpay to report the subscription as active (up to ${Math.max(1, Math.ceil(timing.timeoutMs / 60000))} minutes)...`);
    let lastStatus = '';
    const polled = await L.waitFor(async () => {
      const s = await client.subscriptions.fetch(subscriptionId);
      return { done: s && s.status === 'active', value: s };
    }, {
      intervalMs: timing.intervalMs, timeoutMs: timing.timeoutMs, sleep: timing.sleep,
      onTick: (s) => { if (s && s.status !== lastStatus) { lastStatus = s.status; out(`    status: ${s.status}`); } }
    });
    if (!polled.ok) throw fatal(`The subscription is still "${polled.value && polled.value.status}" after ${Math.max(1, Math.ceil(timing.timeoutMs / 60000))} minutes. If you did pay, check the Razorpay dashboard (Test mode > Subscriptions) and run the check again. Nothing was granted.`);
    const sub = polled.value;
    // The first invoice of the subscription carries the real payment.
    const inv = await L.waitFor(async () => {
      const list = await client.invoices.all({ subscription_id: subscriptionId });
      const paid = ((list && list.items) || []).filter((i) => i && i.payment_id && (i.status === 'paid' || !i.status));
      return { done: paid.length > 0, value: paid[0] };
    }, { intervalMs: timing.intervalMs, timeoutMs: timing.invoiceTimeoutMs, sleep: timing.sleep });
    if (!inv.ok) throw fatal('The subscription is active but Razorpay shows no paid invoice with a payment for it yet. Run the check again in a minute.');
    const payment = await client.payments.fetch(inv.value.payment_id);
    out(`    active. Real payment ${payment.id}: ${L.rupees(payment.amount)}, status ${payment.status}`);
    assert.strictEqual(payment.amount, expectedPaise, `Razorpay charged ${payment.amount} paise, expected ${expectedPaise}`);
    return { sub, payment };
  }

  const cancelledCopy = (sub) => ({ ...sub, status: 'cancelled' });
  const chargedEvent = (sub, payment) => L.buildEvent('subscription.charged', sub, payment);

  // ===================================================================================================================
  try {
    // ---- 0. before any payment -------------------------------------------------------------------------------------
    out('\n--- 0. Before paying: refusals that need no payment ---');
    await step('extra client is refused without an Agency plan (no Razorpay call is made)', async () => {
      const before = client.calls().length;
      const r = await api('POST', '/create-slot-subscription');
      assert.strictEqual(r.status, 400, `expected 400, got ${r.status}`);
      assert.strictEqual(client.calls().length, before, 'a Razorpay call was made');
      assert.ok(!(await fresh()).plan.subscriptions.length, 'a subscription record was stored');
    });
    await step('a webhook with a wrong signature is refused', async () => {
      const r = await hookBadSignature({ event: 'subscription.charged', payload: {} });
      assert.strictEqual(r.status, 400);
    });

    // ---- 3. Agency plan --------------------------------------------------------------------------------------------
    out('\n--- 3. Agency plan ---');
    let agencySub; let agencyPay; let agencyId;
    let created;
    await step('create-subscription (agency): amount equals config price plus GST', async () => {
      created = await api('POST', '/create-subscription', { planId: 'agency' });
      assert.strictEqual(created.status, 200, `create-subscription answered ${created.status}: ${JSON.stringify(created.json && created.json.message)}`);
      assert.strictEqual(created.json.amount, amt.agency.chargePaise, 'amount is not config price plus GST');
      assert.strictEqual(created.json.amount, bp.planQuote('agency').chargePaise);
      assert.strictEqual(created.json.gstPaise, amt.agency.gstPaise);
      agencyId = created.json.subscription_id;
      const rec = recordOf(await fresh(), agencyId);
      assert.ok(rec && rec.kind === 'plan' && rec.key === 'agency' && rec.active === false, 'stored record is wrong');
      assert.strictEqual(rec.expectedPaise, amt.agency.chargePaise, 'stored expected price is not the config price');
      c.saveCleanup({});
      return `${L.rupees(created.json.amount)}`;
    });
    if (!agencyId) throw fatal('The Agency subscription could not be created, so the rest cannot run.');

    ({ sub: agencySub, payment: agencyPay } = await payAt({ title: 'Nebulaa Agency plan', subscriptionId: agencyId, expectedPaise: amt.agency.chargePaise }));
    const aRec = recordOf(await fresh(), agencyId);
    await step('Razorpay subscription uses the Razorpay plan we stored and names our account', async () => {
      assert.strictEqual(agencySub.plan_id, aRec.razorpayPlanId);
      assert.strictEqual(String(agencySub.notes && agencySub.notes.userId), String(owner._id));
    });

    const before1 = await fresh();
    out('  (delivering a subscription.charged event to our real webhook handler, signed with the local test secret, using the REAL ids and amount from Razorpay. This proves our handler on real Razorpay data, not Razorpay\'s own delivery.)');
    await step('webhook subscription.charged: plan becomes agency, shared Quarks granted once', async () => {
      const r = await hook(chargedEvent(agencySub, agencyPay));
      assert.strictEqual(r.status, 200);
      await settle();
      const u = await fresh();
      assert.strictEqual(u.plan.tier, 'agency');
      assert.strictEqual(bal(u) - bal(before1), amt.agency.quarks, `Quarks granted: ${bal(u) - bal(before1)}, expected ${amt.agency.quarks}`);
      assert.strictEqual(planBal(u), amt.agency.quarks);
      const rows = payRows(u, agencyPay.id);
      assert.strictEqual(rows.length, 1, 'payment rows');
      assert.strictEqual(rows[0].status, 'paid'); assert.strictEqual(rows[0].credits, amt.agency.quarks); assert.strictEqual(rows[0].amount, amt.agency.chargePaise / 100);
      assert.strictEqual(u.subscription.status, 'active'); assert.strictEqual(u.plan.subscriptionId, agencyId);
      assert.strictEqual(recordOf(u, agencyId).active, true);
      if (agencySub.current_end) assert.ok(u.subscription.currentPeriodEnd, 'period end not stored');
      return `+${amt.agency.quarks} Quarks`;
    });
    await step('welcome email path ran once (fake mailer, nothing sent) and the invoice call ran once (fake Zoho)', async () => {
      assert.strictEqual(fakes.welcomes.length, 1, `welcome calls: ${fakes.welcomes.length}`);
      assert.strictEqual(fakes.welcomes[0].tier, 'agency'); assert.strictEqual(fakes.welcomes[0].quarks, amt.agency.quarks);
      assert.strictEqual(fakes.invoices.length, 1, `invoice calls: ${fakes.invoices.length}`);
      assert.strictEqual(fakes.invoices[0].razorpayPaymentId, agencyPay.id);
      assert.strictEqual(fakes.invoices[0].totalAmount, amt.agency.chargePaise / 100);
      assert.strictEqual(fakes.invoices[0].credits, amt.agency.quarks);
    });
    await step('replaying the same webhook grants nothing again', async () => {
      const b = await fresh();
      const r = await hook(chargedEvent(agencySub, agencyPay));
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      assert.strictEqual(bal(u), bal(b)); assert.strictEqual(payRows(u, agencyPay.id).length, 1);
      assert.strictEqual(fakes.welcomes.length, 1); assert.strictEqual(fakes.invoices.length, 1);
    });
    await step('verify-subscription with the checkout signature (computed here from your key secret) answers "already processed"', async () => {
      const bad = await api('POST', '/verify-subscription', { razorpay_payment_id: agencyPay.id, razorpay_subscription_id: agencyId, razorpay_signature: 'a'.repeat(64) });
      assert.strictEqual(bad.status, 400, 'a wrong signature must be refused');
      const b = await fresh();
      const r = await api('POST', '/verify-subscription', { razorpay_payment_id: agencyPay.id, razorpay_subscription_id: agencyId, razorpay_signature: L.checkoutSignature(keySecret, agencyPay.id, agencyId) });
      assert.strictEqual(r.status, 200, `verify answered ${r.status}: ${JSON.stringify(r.json && r.json.message)}`);
      assert.strictEqual(r.json.alreadyProcessed, true); assert.strictEqual(r.json.quarksGranted, 0);
      assert.strictEqual(bal(await fresh()), bal(b));
      return 'the browser modal\'s own signature callback is NOT exercised';
    });
    await step('a forged-amount charged event grants nothing and records a needs-refund row', async () => {
      const b = await fresh(); const n = fakes.notifies.length;
      const forged = { ...agencyPay, id: `pay_FORGED${tag.replace(/\W/g, '')}A`, amount: amt.agency.chargePaise - 100 };
      const r = await hook(chargedEvent(agencySub, forged));
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      assert.strictEqual(bal(u), bal(b), 'Quarks changed');
      const rows = payRows(u, forged.id);
      assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].status, 'failed'); assert.strictEqual(rows[0].needsRefund, true); assert.strictEqual(rows[0].reason, 'amount_mismatch'); assert.strictEqual(rows[0].credits, 0);
      assert.strictEqual(fakes.notifies.length, n + 1, 'owner alert not raised');
      assert.strictEqual(u.plan.tier, 'agency');
      await hook(chargedEvent(agencySub, forged)); // replay: still one row, no second alert
      const again = await fresh();
      assert.strictEqual(payRows(again, forged.id).length, 1); assert.strictEqual(fakes.notifies.length, n + 1);
    });
    await step('an event for an unknown Razorpay plan id grants nothing', async () => {
      const b = await fresh();
      const strange = { ...agencySub, plan_id: 'plan_UNKNOWN_FOR_CHECK' };
      const pay = { ...agencyPay, id: `pay_UNKNOWN${tag.replace(/\W/g, '')}` };
      const r = await hook(chargedEvent(strange, pay));
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      assert.strictEqual(bal(u), bal(b)); assert.strictEqual(payRows(u, pay.id).length, 0); assert.strictEqual((u.payments || []).length, (b.payments || []).length);
    });
    await step('strict amount check compares against the stored expected price (a changed config price cannot move an old subscription)', async () => {
      const u = await fresh();
      assert.strictEqual(bp.expectedPaiseOf(recordOf(u, agencyId), bp.invoiceSpec('plan', 'agency')), amt.agency.chargePaise);
      assert.strictEqual(recordOf(u, agencyId).expectedPaise, amt.agency.chargePaise);
    });

    // ---- clients ---------------------------------------------------------------------------------------------------
    out('\n--- 3b. Two client workspaces ---');
    let clients = [];
    await step('create 2 client workspaces; they mirror the Agency plan', async () => {
      for (const n of ['A', 'B']) {
        const r = await ws.createWorkspace({ owner: await User.findById(owner._id), name: `Check client ${n}`, models: { User } });
        assert.ok(r.ok, r.message);
      }
      clients = await wsRows();
      assert.strictEqual(clients.length, 2);
      for (const w of clients) { assert.strictEqual(w.plan.tier, 'agency'); assert.ok(!(w.agency && w.agency.frozen)); }
      assert.strictEqual((await fresh()).agency.clientCount, 2);
      c.saveCleanup({});
    });
    // Make one client's mirrored plan stale, so the sync that follows the next payment has something to repair.
    if (clients.length) await User.updateOne({ _id: clients[0]._id }, { $set: { 'plan.tier': 'free' } });

    // ---- 4. Extra client slot ---------------------------------------------------------------------------------------
    out('\n--- 4. Extra client place ---');
    await step('the cap: at the most clients (25) a new place is refused with no Razorpay call', async () => {
      await User.updateOne({ _id: owner._id }, { $set: { 'agency.extraSlots': amt.maxExtraSlots } });
      try {
        const before = client.calls().length;
        const r = await api('POST', '/create-slot-subscription');
        assert.strictEqual(r.status, 400, `expected 400, got ${r.status}`);
        assert.strictEqual(client.calls().length, before, 'a Razorpay call was made');
      } finally { await User.updateOne({ _id: owner._id }, { $set: { 'agency.extraSlots': 0 } }); }
    });

    async function buySlot(n) {
      let slotRes; let slotId;
      await step(`create-slot-subscription #${n}: amount equals config price plus GST`, async () => {
        slotRes = await api('POST', '/create-slot-subscription');
        assert.strictEqual(slotRes.status, 200, `answered ${slotRes.status}: ${JSON.stringify(slotRes.json && slotRes.json.message)}`);
        assert.strictEqual(slotRes.json.amount, amt.slot.chargePaise); assert.strictEqual(slotRes.json.amount, bp.slotQuote().chargePaise);
        assert.strictEqual(slotRes.json.gstPaise, amt.slot.gstPaise);
        slotId = slotRes.json.subscription_id;
        assert.strictEqual(recordOf(await fresh(), slotId).expectedPaise, amt.slot.chargePaise);
        c.saveCleanup({});
        return L.rupees(slotRes.json.amount);
      });
      if (!slotId) throw fatal('The extra client subscription could not be created.');
      const paid = await payAt({ title: 'Nebulaa extra client place', subscriptionId: slotId, expectedPaise: amt.slot.chargePaise });
      return { slotId, ...paid };
    }

    const s1 = await buySlot(1);
    const beforeSlot = await fresh();
    await step('verify-subscription (real payment amount fetched from Razorpay and compared): +1 place and +500 Quarks once', async () => {
      const r = await api('POST', '/verify-subscription', { razorpay_payment_id: s1.payment.id, razorpay_subscription_id: s1.slotId, razorpay_signature: L.checkoutSignature(keySecret, s1.payment.id, s1.slotId) });
      assert.strictEqual(r.status, 200, `verify answered ${r.status}: ${JSON.stringify(r.json && r.json.message)}`);
      assert.strictEqual(r.json.quarksGranted, amt.slot.quarks);
      assert.strictEqual(r.json.clientLimit, amt.includedClients + 1);
      await settle();
      const u = await fresh();
      assert.strictEqual(u.agency.extraSlots, 1); assert.strictEqual(bal(u) - bal(beforeSlot), amt.slot.quarks); assert.strictEqual(planBal(u) - planBal(beforeSlot), amt.slot.quarks);
      assert.strictEqual(payRows(u, s1.payment.id).length, 1); assert.strictEqual(payRows(u, s1.payment.id)[0].credits, amt.slot.quarks);
      assert.strictEqual(recordOf(u, s1.slotId).active, true);
      return `+${amt.slot.quarks} Quarks, limit ${r.json.clientLimit}`;
    });
    await step('the plan mirror syncs: the stale client is set back to the Agency plan', async () => {
      for (const w of await wsRows()) assert.strictEqual(w.plan.tier, 'agency');
    });
    await step('webhook for the same slot payment grants nothing again', async () => {
      const b = await fresh();
      const r = await hook(chargedEvent(s1.sub, s1.payment));
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      assert.strictEqual(bal(u), bal(b)); assert.strictEqual(u.agency.extraSlots, 1); assert.strictEqual(payRows(u, s1.payment.id).length, 1);
    });
    await step('SIMULATED renewal event (made-up payment id, right amount): records the payment, grants no place and no Quarks', async () => {
      const b = await fresh();
      const pay = { ...s1.payment, id: `pay_SIMRENEW${tag.replace(/\W/g, '')}S` };
      const r = await hook(chargedEvent(s1.sub, pay));
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      assert.strictEqual(u.agency.extraSlots, 1); assert.strictEqual(bal(u), bal(b), 'Quarks changed on a slot renewal');
      const rows = payRows(u, pay.id); assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].status, 'paid'); assert.strictEqual(rows[0].credits, 0);
      return 'slot renewal Quarks arrive with the Agency renewal';
    });
    await step('a forged-amount slot event grants nothing and records a needs-refund row', async () => {
      const b = await fresh();
      const forged = { ...s1.payment, id: `pay_FORGED${tag.replace(/\W/g, '')}S`, amount: amt.slot.chargePaise + 100 };
      const r = await hook(chargedEvent(s1.sub, forged));
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      assert.strictEqual(bal(u), bal(b)); assert.strictEqual(u.agency.extraSlots, 1);
      const rows = payRows(u, forged.id); assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].needsRefund, true); assert.strictEqual(rows[0].reason, 'amount_mismatch');
    });
    await step('SIMULATED Agency renewal (made-up payment id): the new month replaces the old allowance (plan Quarks plus the Quarks of the extra place)', async () => {
      const b = await fresh();
      const pay = { ...agencyPay, id: `pay_SIMRENEW${tag.replace(/\W/g, '')}A` };
      const r = await hook(chargedEvent(agencySub, pay));
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      const want = amt.agency.quarks + amt.slot.quarks;
      assert.strictEqual(planBal(u), want, `plan allowance ${planBal(u)}, expected ${want}`);
      assert.strictEqual(bal(u), bal(b) - planBal(b) + want, 'the old allowance was not replaced');
      assert.strictEqual(payRows(u, pay.id).length, 1);
    });

    // ---- 5. cancels -----------------------------------------------------------------------------------------------
    out('\n--- 5. Cancelling ---');
    let s2 = null;
    const wantSecond = (await ask('Optional: pay a SECOND time (another extra client place) so the "cancelling the plan also stops its places" check can run with a real place? Type y to pay again, or just press Enter to skip: ')).toLowerCase().startsWith('y');
    if (wantSecond) {
      try { s2 = await buySlot(2); } catch (e) { if (!e.fatal) throw e; results.add('second extra client place (optional)', 'FAIL', e.message); out(`  FAIL  second place: ${e.message}`); }
      if (s2) {
        await step('second place: verify grants +1 place and +500 Quarks once', async () => {
          const b = await fresh();
          const r = await api('POST', '/verify-subscription', { razorpay_payment_id: s2.payment.id, razorpay_subscription_id: s2.slotId, razorpay_signature: L.checkoutSignature(keySecret, s2.payment.id, s2.slotId) });
          assert.strictEqual(r.status, 200, JSON.stringify(r.json && r.json.message)); await settle();
          const u = await fresh();
          assert.strictEqual(u.agency.extraSlots, 2); assert.strictEqual(bal(u) - bal(b), amt.slot.quarks);
        });
      }
    } else {
      results.add('second extra client place (optional)', 'SKIP', 'not asked for');
      out('  SKIP  second extra client place (optional): not asked for');
    }
    const newest = s2 || s1; // the route cancels the newest active place
    const oldest = s2 ? s1 : null;
    const slotsBefore = (await fresh()).agency.extraSlots;
    await step(`cancel-slot: Razorpay is asked to end the newest place at the end of its month; the limit stays until the cancelled event`, async () => {
      const r = await api('POST', '/cancel-slot');
      assert.strictEqual(r.status, 200, `answered ${r.status}: ${JSON.stringify(r.json && r.json.message)}`);
      assert.strictEqual(r.json.success, true);
      const call = client.calls().filter((x) => x.name === 'subscriptions.cancel' && x.args[0] === newest.slotId);
      assert.ok(call.length >= 1 && call[call.length - 1].args[1] === 1, 'no cancel-at-cycle-end call reached Razorpay');
      const u = await fresh();
      const rec = recordOf(u, newest.slotId);
      assert.strictEqual(rec.cancelAtPeriodEnd, true); assert.strictEqual(rec.active, true);
      assert.strictEqual(u.agency.slotsEnding, 1); assert.strictEqual(u.agency.extraSlots, slotsBefore, 'the limit moved before Razorpay reported the end');
      const live = await client.subscriptions.fetch(newest.slotId);
      return `Razorpay status now "${live.status}"${r.json.endsAt ? `, ends ${new Date(r.json.endsAt).toISOString().slice(0, 10)}` : ''}`;
    });
    await step('webhook subscription.cancelled for that place: the limit drops by one, once, and no client is deleted or frozen', async () => {
      const live = await client.subscriptions.fetch(newest.slotId);
      const ev = L.buildEvent('subscription.cancelled', cancelledCopy(live));
      const r = await hook(ev);
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      assert.strictEqual(u.agency.extraSlots, slotsBefore - 1, `extra places ${u.agency.extraSlots}`); assert.strictEqual(u.agency.slotsEnding, 0);
      assert.strictEqual(recordOf(u, newest.slotId).active, false); assert.strictEqual(recordOf(u, newest.slotId).ended, true);
      const rows = await wsRows();
      assert.strictEqual(rows.length, 2, 'a client was deleted'); for (const w of rows) assert.ok(!(w.agency && w.agency.frozen), 'a client was frozen');
      await hook(ev); await settle(); // replay
      assert.strictEqual((await fresh()).agency.extraSlots, slotsBefore - 1, 'the replay lowered the limit again');
    });
    await step('a late charge for the ended place does not bring it back (it is recorded as needing a refund)', async () => {
      const b = await fresh();
      const pay = { ...newest.payment, id: `pay_LATE${tag.replace(/\W/g, '')}` };
      await hook(chargedEvent(newest.sub, pay)); await settle();
      const u = await fresh();
      assert.strictEqual(u.agency.extraSlots, b.agency.extraSlots); assert.strictEqual(bal(u), bal(b));
      const rows = payRows(u, pay.id); assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].needsRefund, true); assert.strictEqual(rows[0].reason, 'slot_ended');
    });

    const alertsBeforePlanCancel = fakes.alerts.length;
    await step('cancel-subscription: Razorpay is asked to end the Agency plan at the end of its month; tier stays Agency until the event', async () => {
      const r = await api('POST', '/cancel-subscription');
      assert.strictEqual(r.status, 200, `answered ${r.status}: ${JSON.stringify(r.json && r.json.message)}`);
      const call = client.calls().filter((x) => x.name === 'subscriptions.cancel' && x.args[0] === agencyId);
      assert.ok(call.length >= 1 && call[call.length - 1].args[1] === 1, 'no cancel-at-cycle-end call for the plan reached Razorpay');
      const u = await fresh();
      assert.strictEqual(u.plan.tier, 'agency'); assert.strictEqual(u.subscription.cancelAtPeriodEnd, true);
    });
    await step('webhook subscription.cancelled for the plan: tier is free, ALL clients frozen (none deleted)', async () => {
      const live = await client.subscriptions.fetch(agencyId);
      const r = await hook(L.buildEvent('subscription.cancelled', cancelledCopy(live)));
      assert.strictEqual(r.status, 200); await settle();
      const u = await fresh();
      assert.strictEqual(u.plan.tier, 'free'); assert.strictEqual(u.subscription.status, 'cancelled'); assert.strictEqual(recordOf(u, agencyId).active, false);
      const rows = await wsRows();
      assert.strictEqual(rows.length, 2, 'a client was deleted');
      for (const w of rows) { assert.strictEqual(w.agency.frozen, true, 'a client is not frozen'); assert.strictEqual(w.plan.tier, 'free'); }
      return 'clients kept, paused';
    });
    if (oldest) {
      await step('the plan ending also cancels the remaining extra place at Razorpay and takes its limit away', async () => {
        const u = await fresh();
        const rec = recordOf(u, oldest.slotId);
        assert.strictEqual(rec.active, false); assert.strictEqual(rec.ended, true); assert.strictEqual(u.agency.extraSlots, 0);
        const calls = client.calls().filter((x) => x.name === 'subscriptions.cancel' && x.args[0] === oldest.slotId && x.args[1] === 0);
        assert.ok(calls.length >= 1, 'no immediate cancel for the place reached Razorpay');
        const stuck = fakes.alerts.slice(alertsBeforePlanCancel).filter((a) => /extra client subscription/.test(a.detail));
        assert.strictEqual(stuck.length, 0, `an owner alert was raised: ${stuck.map((a) => a.detail).join(' | ')}`);
      });
    } else {
      results.add('the plan ending also cancels a remaining extra place at Razorpay', 'SKIP', 'needs the optional second payment');
      out('  SKIP  the plan ending also cancels a remaining extra place at Razorpay: needs the optional second payment (the one place bought was already ended above)');
    }
    await step('buying the Agency plan again unfreezes the clients that fit (SIMULATED: a made-up payment on the old plan, no second real payment)', async () => {
      const b = await fresh();
      const pay = { ...agencyPay, id: `pay_SIMREBUY${tag.replace(/\W/g, '')}` };
      const r = await hook(chargedEvent(agencySub, pay)); await settle();
      assert.strictEqual(r.status, 200);
      const u = await fresh();
      assert.strictEqual(u.plan.tier, 'agency'); assert.strictEqual(planBal(u), amt.agency.quarks + amt.slot.quarks * (u.agency.extraSlots || 0));
      assert.ok(bal(u) >= 0 && b);
      for (const w of await wsRows()) { assert.ok(!(w.agency && w.agency.frozen), 'a client is still frozen'); assert.strictEqual(w.plan.tier, 'agency'); }
      return `both clients open again, limit ${agencyRules.clientLimitOf(await User.findById(owner._id))}; a real second purchase is not exercised`;
    });

    // ---- 6. staff Money failures -----------------------------------------------------------------------------------
    out('\n--- 6. Staff Money failures ---');
    await step('the Money failures list shows all three needs-refund rows (forged agency, forged place, late place)', async () => {
      const u = await fresh();
      const money = buildMoney({ users: [u], ayrshareProfiles: 0, now: Date.now() });
      const items = money.failures.payments.items.filter((i) => i.needsRefund);
      assert.strictEqual(items.length, 3, `needs-refund rows listed: ${items.length}`);
      const totals = items.map((i) => i.totalPaise).sort((a, b) => a - b);
      assert.deepStrictEqual(totals, [amt.agency.chargePaise - 100, amt.slot.chargePaise + 100, amt.slot.chargePaise].sort((a, b) => a - b));
      return 'built with the real staff Money builder from this account\'s data';
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
/**
 * opts (all optional, for tests): env, argv, out, ask, sdk, connect(uri) -> mongoose, noDotenv, timing, planOverridesFromEnv
 * Returns the exit code.
 */
async function main(opts = {}) {
  const out = opts.out || ((s) => console.log(s));
  const argv = opts.argv || process.argv.slice(2);
  const mode = argv[0] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') { out('Usage: node scripts/razorpay-test-check.js [run|cleanup]'); return 2; }
  const env0 = { ...(opts.env || process.env) };

  out(BAR);
  out('  RAZORPAY  *** TEST MODE ***  check for the Agency plan and the extra client place');
  out(BAR);

  // Stage 1: nothing is read from any file and nothing is contacted until these pass.
  const g1 = L.evaluateGuards({ env: env0, requireMongo: false });
  if (!g1.ok) {
    out('REFUSED. Nothing was contacted and nothing was changed:');
    for (const p of g1.problems) out(`  - ${p}`);
    out('See docs/superpowers/ops/razorpay-test-check.md');
    return 1;
  }
  // The key, the secret and the plan-id overrides must come from the shell, not from backend/.env: a file must never be able
  // to swap a live key or live plan ids into this run.
  const keyId = env0.RAZORPAY_KEY_ID; const keySecret = env0.RAZORPAY_KEY_SECRET;
  const planOverrides = { agency: env0.RAZORPAY_PLAN_ID_AGENCY || '', slot: env0.RAZORPAY_PLAN_ID_SLOT || '' };
  if (!opts.noDotenv) require('dotenv').config();
  const after = opts.env ? { ...opts.env } : process.env;
  const g2 = L.evaluateGuards({ env: { ...after, ...env0, RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret }, requireMongo: true });
  if (!g2.ok) {
    out('REFUSED. Nothing was contacted and nothing was changed:');
    for (const p of g2.problems) out(`  - ${p}`);
    return 1;
  }
  if (!after.JWT_SECRET) { out('REFUSED. JWT_SECRET is not set (backend/.env should have it), so a login token cannot be made.'); return 1; }

  const mongoose = opts.mongoose || require('mongoose');
  await mongoose.connect(after.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const dbGuard = L.evaluateGuards({ env: { ...env0, RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret, MONGODB_URI: 'set' }, dbName: mongoose.connection.name });
  if (!dbGuard.ok) {
    out('REFUSED. Nothing was changed:');
    for (const p of dbGuard.problems) out(`  - ${p}`);
    await mongoose.disconnect();
    return 1;
  }
  out(`TEST MODE. Razorpay TEST key accepted. Database: ${L.REQUIRED_DB}.`);

  const models = { User: require('../models/User'), QuarkLedger: require('../models/QuarkLedger'), OpsState: require('../models/OpsState') };
  const file = L.cleanupFileApi(opts.cleanupFile);
  const sdk = opts.sdk || L.loadSdk(keyId, keySecret);
  const tag = `${L.PREFIX}${Date.now()}`;
  const saved = { tag, startedAt: new Date().toISOString(), subscriptionIds: [], userIds: [] };
  const saveCleanup = (more = {}) => {
    saved.userIds = [...new Set([...saved.userIds, ...(more.userIds || [])])];
    saved.subscriptionIds = [...new Set([...saved.subscriptionIds, ...client.createdSubscriptionIds()])];
    file.write(saved);
  };
  const client = L.createRazorpayClient(sdk, { onSubscriptionCreated: () => saveCleanup() });
  const results = L.createResults();
  let server = null;
  const doCleanup = L.once(async () => {
    if (server) { try { await new Promise((r) => server.close(r)); } catch (_) { /* already closed */ } }
    out('\n--- cleanup ---');
    return L.cleanupAll({ client, models, db: mongoose.connection.db, file, out, settleMs: (opts.timing && opts.timing.settleMs) ?? 400 });
  });

  let cleanupResult = null;
  let interrupted = false;
  const onSigint = async () => {
    if (interrupted) return;
    interrupted = true;
    out('\nCtrl+C: stopping and cleaning up...');
    try { await doCleanup(); } catch (e) { out(`cleanup failed: ${e.message}. Run: node scripts/razorpay-test-check.js cleanup`); }
    process.exit(130);
  };
  const handlesSignals = !opts.noSignals;
  if (handlesSignals) process.on('SIGINT', onSigint);

  try {
    if (mode === 'cleanup') {
      cleanupResult = await doCleanup();
      await mongoose.disconnect();
      const code = L.exitCodeFor({ results, cleanup: cleanupResult });
      out(code === 0 ? 'Clean: nothing left behind.' : 'Something is left behind: see above.');
      return code;
    }
    saveCleanup();
    out('Starting. This takes about 10 to 15 minutes, mostly your two payments.');
    const webhookSecret = L.newWebhookSecret(); // random, kept only in this process, never printed
    const timing = { intervalMs: 5000, timeoutMs: 10 * 60 * 1000, invoiceTimeoutMs: 2 * 60 * 1000, settleMs: 400, sleep: L.defaultSleep, ...(opts.timing || {}) };
    try {
      await runCheck({
        out, ask: opts.ask || createAsk(), client, results, models, tag, webhookSecret, keyId, keySecret, planOverrides, timing,
        saveCleanup, onServer: (s) => { server = s; }
      });
    } catch (e) {
      const msg = String((e && e.message) || e).split('\n')[0].slice(0, 400);
      results.add(e && e.fatal ? 'stopped' : 'unexpected error', 'FAIL', msg);
      out(`\nSTOPPED: ${msg}`);
    }
  } finally {
    if (mode === 'run') {
      try { cleanupResult = await doCleanup(); }
      catch (e) { out(`cleanup failed: ${e.message}. Run: node scripts/razorpay-test-check.js cleanup`); results.add('cleanup', 'FAIL', e.message); }
    }
    if (handlesSignals) process.removeListener('SIGINT', onSigint);
  }

  out('\n' + BAR);
  out('  RESULTS (Razorpay TEST mode)');
  out(BAR);
  out(L.renderTable(results.rows));
  out(`\n${results.count('PASS')} PASS, ${results.count('FAIL')} FAIL, ${results.count('SKIP')} SKIP; Razorpay calls made: ${client.calls().length}`);
  out('Reminder: the webhook was delivered by this script, and the browser modal\'s own callback was not used. See the instructions file for what this does and does not prove.');
  await mongoose.disconnect();
  const code = L.exitCodeFor({ results, cleanup: cleanupResult });
  out(code === 0 ? 'OVERALL: PASS' : 'OVERALL: FAIL');
  out('Now close this terminal window: your key secret was typed into it.');
  return code;
}

module.exports = { main, runCheck, createAsk, quiet };

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => { console.error('FAILED', e && e.message); process.exit(1); });
}
