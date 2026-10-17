/**
 * Payment Routes: Razorpay billing for the Starter, Professional and Agency plans, add-on
 * subscriptions, Agency extra client slots and Quark top-up packs.
 *
 * Every price is GST-exclusive in config/apiCosts.js; 18 percent GST is added at
 * checkout (integer paise). Quarks are granted from that config only: never from
 * a request body, a webhook payload or an order note. Every grant is gated by an
 * atomic update that skips a Razorpay payment id already stored on the user.
 *
 *   GET  /plans                      plans, top-up packs and add-ons with GST
 *   POST /create-subscription        { planId: 'starter' | 'professional' | 'agency' }
 *   POST /create-addon-subscription  { addon: 'publish' | 'competitors' | 'inbox' | 'bundle' }
 *   POST /create-slot-subscription   (no body) one extra client slot, Agency accounts only
 *   POST /verify-subscription        checkout signature, then grant (plan, add-on or client slot)
 *   POST /create-order               { packInr } one of the top-up pack prices
 *   POST /verify                     checkout signature, then grant the pack's Quarks
 *   POST /webhook                    subscription.charged / halted / cancelled / completed
 *   GET  /status, /billing, POST /retry-invoices, /validate-coupon
 */
const express = require('express');
const crypto = require('crypto');
const bp = require('../services/billingPlans');
const quarkBuckets = require('../services/quarkBuckets');
const gstinRules = require('../services/gstin');

// What goes on an invoice from the details a customer added (a GSTIN, the name and the state the supply is made to).
function invoiceBillingOf(user) {
  const b = (user && user.billingDetails) || {};
  if (!b.gstin && !b.stateCode) return undefined;
  const st = gstinRules.stateByAbbr(b.stateCode);
  return { gstin: b.gstin || '', legalName: b.legalName || '', address: b.address || '', pin: b.pin || '', stateCode: b.stateCode || '', stateName: st ? st.name : '' };
}
const { resolveTier, addonsOf } = require('../config/entitlements');
const { chargePaise, AGENCY } = require('../config/apiCosts');
const agencyRules = require('../services/agency');

const PLAN_CURRENCY = 'INR';
const ENDING_EVENTS = ['subscription.cancelled', 'subscription.halted', 'subscription.completed'];

function createPaymentRouter(deps = {}) {
  const router = express.Router();
  const protect = deps.protect || require('../middleware/auth').protect;
  // Checkout attempts are limited per account and address: a person pays a handful of times, a card-testing script
  // tries hundreds. The test harness injects its own `protect`, and is not limited.
  const payLimiter = deps.protect ? (_req, _res, next) => next() : (() => {
    const rateLimit = require('express-rate-limit');
    return rateLimit({
      windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
      message: { success: false, message: 'Too many payment attempts. Please wait a few minutes and try again.' },
      keyGenerator: (req) => `${String(req.user?._id || req.user?.id || '')}|${rateLimit.ipKeyGenerator ? rateLimit.ipKeyGenerator(req.ip) : req.ip}`
    });
  })();
  const User = deps.User || require('../models/User');
  const Coupon = deps.Coupon || require('../models/Coupon');
  const createInvoice = deps.createInvoice || require('../services/zohoBooks').createInvoice;
  const env = () => deps.env || process.env;
  // Tells the owner about a payment that needs a person (best effort, never throws).
  const alert = deps.alert || ((category, detail) => { try { require('../services/opsAlerts').recordFailure(category, detail); } catch (_) { /* alerting never stops billing */ } });
  // Emails the owner at once about one refused payment, once per payment id (best effort, never throws).
  const notifyNow = deps.notifyNow || ((m) => require('../services/opsAlerts').notify(m));
  const settleQuarks = deps.settle || ((...a) => quarkBuckets.settle(...a));
  const syncWorkspacePlans = deps.syncWorkspacePlans || ((args) => require('../services/agencyWorkspaces').syncWorkspacePlans(args));
  const sendWelcome = deps.sendWelcome || require('../services/welcomeEmail').sendSubscriberWelcome;
  let defaultRazorpay = null;
  const rz = () => {
    if (deps.razorpay) return deps.razorpay;
    if (!defaultRazorpay) {
      const Razorpay = require('razorpay');
      defaultRazorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    }
    return defaultRazorpay;
  };
  // A client workspace never starts billing: money and plans stay with the agency account.
  const refuseWorkspace = (user, res) => {
    if (!agencyRules.isWorkspace(user)) return false;
    res.status(403).json({ success: false, message: 'Plans and payments are managed from the agency account.' });
    return true;
  };
  const userIdOf = (req) => req.user?.userId || req.user?.id || req.user?._id;
  const prefillOf = (user) => ({
    name: `${user.firstName} ${user.lastName || ''}`.trim(),
    email: user.email,
    contact: user.mobileNumber || ''
  });

  // Razorpay plan ids are created on first use and cached (or taken from env).
  const planIdCache = {};
  function getOrCreateRazorpayPlan(kind, key) {
    const fromEnv = env()[bp.envVarFor(kind, key)];
    if (fromEnv) return Promise.resolve(fromEnv);
    const cacheKey = `${kind}:${key}`;
    if (!planIdCache[cacheKey]) {
      planIdCache[cacheKey] = rz().plans.create(bp.razorpayPlanBody(kind, key)).then((p) => p.id).catch((e) => { delete planIdCache[cacheKey]; throw e; });
    }
    return planIdCache[cacheKey];
  }

  const storedSubscriptions = (user) => user.plan?.subscriptions || [];
  const findRecord = (user, subscriptionId) => storedSubscriptions(user).find((s) => s.subscriptionId === subscriptionId) || null;
  const hasActivePlanSubscription = (user) =>
    (user.subscription?.razorpaySubscriptionId && user.subscription?.status === 'active') ||
    storedSubscriptions(user).some((s) => s.kind === 'plan' && s.active);

  // Our stored record decides what a Razorpay subscription is for. The Razorpay
  // entity must agree with it (same Razorpay plan, same owner) or nothing is granted.
  function recordMatches(user, record, entity) {
    if (!record || !entity) return false;
    if (record.kind === 'plan' ? !bp.isPlanId(record.key) : record.kind === 'addon' ? !bp.isAddonId(record.key) : record.kind === 'slot' ? !bp.isSlotKey(record.key) : true) return false;
    if (!record.razorpayPlanId || entity.plan_id !== record.razorpayPlanId) return false;
    if (String(entity.notes?.userId || '') !== String(user._id)) return false;
    return true;
  }

  const alreadyCancelled = (e) => /already|cancelled|canceled|completed|not cancel/i.test(String((e && (e.error && e.error.description || e.message)) || ''));

  // When a plan ends, its add-ons and extra client slots must stop billing too (best effort per subscription).
  async function cancelAddonSubscriptions(user) {
    const addons = storedSubscriptions(user).filter((s) => s.kind === 'addon' && s.active);
    for (const a of addons) {
      try { await rz().subscriptions.cancel(a.subscriptionId, 0); }
      catch (e) { console.warn(`Could not cancel add-on subscription ${a.subscriptionId}:`, e.message); }
    }
    await User.updateOne({ _id: user._id }, { $set: { 'plan.subscriptions.$[addon].active': false } }, { arrayFilters: [{ 'addon.kind': 'addon' }] });
    for (const slot of storedSubscriptions(user).filter((s) => s.kind === 'slot' && s.active)) {
      try { await rz().subscriptions.cancel(slot.subscriptionId, 0); }
      catch (e) {
        // A slot that is already cancelled (a normal cancellation, or an earlier attempt) is done, not a problem.
        if (!alreadyCancelled(e)) {
          console.warn(`Could not cancel slot subscription ${slot.subscriptionId}:`, e.message);
          alert('payment', `could not stop extra client subscription ${slot.subscriptionId} after the Agency plan ended: cancel it in Razorpay`);
        }
      }
      await endSlot(user._id, slot);
    }
  }

  // Ends one slot subscription: lowers the limit by one, once, and only if it was active.
  async function endSlot(userId, record) {
    const built = bp.buildEndUpdate(null, record, 'subscription.cancelled');
    const doc = await User.findOneAndUpdate({ _id: userId, ...built.filter }, built.update, { new: true, arrayFilters: built.arrayFilters });
    // The limit can never go below zero extra slots, whatever the stored data says.
    await User.updateOne({ _id: userId, 'agency.extraSlots': { $lt: 0 } }, { $set: { 'agency.extraSlots': 0 } });
    return doc;
  }

  // After the agency plan or a client slot changes: copy the plan to every client and freeze (never delete) the ones above the limit.
  async function syncAgency(userId) {
    try {
      const owner = await User.findById(userId);
      if (owner) await syncWorkspacePlans({ owner, models: { User } });
    } catch (e) {
      console.warn('Client workspace sync failed (non-blocking):', e.message);
      alert('payment', `client sync after a billing change failed: ${e.message}`);
    }
  }
  const touchesAgency = (record) => record.kind === 'slot' || (record.kind === 'plan' && record.key === 'agency');

  // A slot payment is applied only to an agency account (never a client workspace), and a first payment only below the
  // most clients. The same conditions go into the one atomic update, so two payments at once cannot get past them.
  const MAX_EXTRA = bp.MAX_EXTRA_SLOTS;
  function slotRefusal(user, firstCycle) {
    if (!agencyRules.isAgency(user)) return 'no_agency_plan';
    if (firstCycle && !bp.canBuySlot(user).ok) return 'at_limit';
    return null;
  }
  function slotGate(record, firstCycle) {
    return {
      'plan.tier': 'agency', 'agency.ownerId': null,
      'plan.subscriptions': { $elemMatch: { subscriptionId: record.subscriptionId, active: firstCycle ? { $ne: true } : true } },
      ...(firstCycle ? { $or: [{ 'agency.extraSlots': null }, { 'agency.extraSlots': { $lt: MAX_EXTRA } }] } : {})
    };
  }
  // Money was taken that we cannot honour: grant nothing, keep a durable record staff can see and act on, and tell the
  // owner at once. The record is the payment itself (status 'failed', needsRefund) so the Money failures list shows it,
  // and it is added only if this payment id is not stored yet, so a replayed webhook or verify neither duplicates it
  // nor emails twice. Nothing in here may fail the request.
  const REASON_WORDS = {
    at_limit: 'the account already has the most clients',
    no_agency_plan: 'the Agency plan is not active',
    slot_conflict: 'the account changed while the payment was being applied',
    slot_ended: 'the extra client subscription had already ended',
    amount_mismatch: 'the amount paid does not match the price'
  };
  async function recordRefusal(user, record, paymentId, paidPaise, reason) {
    let recorded = false;
    try {
      const spec = bp.invoiceSpec(record.kind, record.key) || {};
      const doc = await User.findOneAndUpdate(
        { _id: user._id, 'payments.razorpayPaymentId': { $ne: paymentId } },
        { $push: { payments: {
          razorpayOrderId: record.subscriptionId, razorpayPaymentId: paymentId, subscriptionId: record.subscriptionId,
          amount: Number.isFinite(paidPaise) ? paidPaise / 100 : 0, currency: PLAN_CURRENCY, credits: 0,
          status: 'failed', needsRefund: true, reason, item: spec.itemName, paidAt: new Date()
        } } },
        { new: true }
      );
      recorded = !!doc;
    } catch (e) {
      console.error(`Could not record refused payment ${paymentId}:`, e.message);
      alert('payment', `could not record refused payment ${paymentId} for account ${user._id}: ${e.message}`);
      recorded = true; // we cannot tell if it is a repeat, so the owner is told rather than risk silence
    }
    if (!recorded) return false;
    alert('payment', `payment ${paymentId} for ${record.kind} ${record.key} on account ${user._id} was not applied (${reason}): refund or fix it`);
    try {
      const rupees = Number.isFinite(paidPaise) ? (paidPaise / 100).toFixed(2) : 'unknown';
      await notifyNow({
        key: `refused_payment:${paymentId}`, cooldownMs: 1e12,
        subject: 'Nebulaa: a payment was taken but not applied',
        text: [
          'A customer paid, but the payment could not be applied. Nothing was granted. It needs a refund or a fix.', '',
          `Account: ${user._id}`, `Subscription: ${record.subscriptionId}`, `Payment: ${paymentId}`, `Amount paid: Rs ${rupees}`,
          `Reason: ${reason} (${REASON_WORDS[reason] || 'see the Money page'})`, 'Needs refund: yes', '',
          'It is listed under Failures on the Money page. You will not get another email for this payment.'
        ].join('\n')
      });
    } catch (e) { console.warn('Could not email the refused payment alert:', e.message); }
    return true;
  }
  // A first Agency plan payment of the wrong amount: nothing was granted, so the subscription is stopped at Razorpay
  // (it would bill the wrong amount every month). A plan already running is only recorded and alerted: staff decide.
  async function stopUnappliedPlan(record) {
    if (record.kind !== 'plan' || record.active === true) return;
    try { await rz().subscriptions.cancel(record.subscriptionId, 0); }
    catch (e) {
      if (!alreadyCancelled(e)) alert('payment', `could not stop subscription ${record.subscriptionId} after a wrong-amount first payment: cancel it in Razorpay`);
    }
  }
  async function refuseSlot(user, record, paymentId, reason, paidPaise) {
    await recordRefusal(user, record, paymentId, paidPaise, reason);
    try { await rz().subscriptions.cancel(record.subscriptionId, 0); }
    catch (e) { console.warn(`Could not cancel slot subscription ${record.subscriptionId}:`, e.message); }
    return { applied: false, reason };
  }
  const REFUSALS = {
    no_agency_plan: 'We received your payment, but your Agency plan is not active, so the extra client could not be added. Our team has been told and will contact you about a refund.',
    at_limit: `We received your payment, but your account already has the most clients (${AGENCY.maxClients}), so the extra client could not be added. Our team has been told and will contact you about a refund.`,
    slot_ended: 'We received your payment, but this extra client subscription had already ended, so nothing was added. Our team has been told and will contact you about a refund.',
    slot_conflict: 'We received your payment, but could not add the extra client just now. Our team has been told and will contact you.',
    amount_mismatch: 'We received your payment, but the amount did not match the price of this plan, so it was not applied. Our team has been told and will refund or fix it.',
    amount_unconfirmed: 'We are still confirming your payment. It will show on your account shortly. If it does not, our team will sort it out.'
  };
  const isStrictAmount = (record) => record.kind === 'slot' || (record.kind === 'plan' && record.key === 'agency');
  // What this subscription must be charged: the price stored when it was bought, else today's price (older records).
  const expectedPaiseOf = (record) => bp.expectedPaiseOf(record, bp.invoiceSpec(record.kind, record.key));

  // One payment, applied once. Returns { applied:false } on a replay.
  async function applyCharge(user, record, { paymentId, paidPaise, subscription }, attempt = 0) {
    const existing = (user.payments || []).find((p) => p && p.razorpayPaymentId === paymentId);
    // A payment we already refused stays refused: a replayed verify or webhook says so again and records nothing more.
    if (existing && existing.status === 'failed' && existing.needsRefund) return { applied: false, reason: existing.reason || 'slot_conflict' };
    const alreadyApplied = !!existing;
    let firstCycle = true; let gate = {};
    if (record.kind === 'slot' && !alreadyApplied) {
      firstCycle = record.active !== true;
      // A charge that arrives after the slot was ended (webhook order is not guaranteed) must not bring it back.
      if (record.ended) return refuseSlot(user, record, paymentId, 'slot_ended', paidPaise);
      const refusal = slotRefusal(user, firstCycle);
      if (refusal) return refuseSlot(user, record, paymentId, refusal, paidPaise);
      gate = slotGate(record, firstCycle);
    }
    // A new month starts: last month's allowance ends now, so the new one replaces it instead of piling on. The
    // expiry is part of the same guarded update as the grant (never a separate step), so a verify and a webhook for
    // the same payment arriving together cannot expire what the other just granted. The update only applies if the
    // plan and held buckets are still what we read; when they moved, we read again and retry.
    let planGuard = {}; let expiring = 0;
    if (!alreadyApplied && record.kind === 'plan') {
      try { await settleQuarks(user._id, new Date()); } catch (e) { console.warn('Quark expiry before renewal failed:', e.message); }
      const fresh = (await User.findById(user._id)) || user;
      if ((fresh.payments || []).some((p) => p && p.razorpayPaymentId === paymentId)) return { applied: false, reason: 'already_processed' };
      const c = fresh.credits || {};
      expiring = Math.min(Math.max(0, Number(c.planBalance) || 0), Math.max(0, Number(c.balance) || 0));
      // Zero (or never stored: the model fills in 0 when it reads an older account) matches both a stored 0 and a missing field.
      const same = (v) => (Number(v) > 0 || Number(v) < 0 ? Number(v) : { $in: [0, null] });
      planGuard = { 'credits.planBalance': same(c.planBalance), 'credits.topupHeld': same(c.topupHeld) };
      // The Agency grant counts the active slots, so a slot bought or ended since we read makes us read again.
      if (record.key === 'agency') planGuard['agency.extraSlots'] = same(fresh.agency && fresh.agency.extraSlots);
      user = fresh;
    }
    const held = !alreadyApplied && record.kind === 'plan' ? Math.max(0, Number(user.credits?.topupHeld) || 0) : 0;
    const built = bp.buildChargeUpdate(record, {
      paymentId, paidPaise, subscription, heldToRelease: record.kind === 'plan' ? held : 0, firstCycle,
      extraSlots: record.kind === 'plan' && record.key === 'agency' ? user.agency?.extraSlots : 0
    });
    if (!built) return { applied: false, reason: 'unknown_item' };
    if (expiring > 0) {
      built.update.$inc['credits.balance'] -= expiring;
      built.update.$push['credits.history'] = { $each: [{ action: 'plan_quarks_expired', amount: -expiring, description: 'Monthly Quarks ended with the paid month', createdAt: new Date() }], $slice: -100 };
    }
    const opts = { new: true, ...(built.arrayFilters ? { arrayFilters: built.arrayFilters } : {}) };
    const doc = await User.findOneAndUpdate(
      { _id: user._id, 'payments.razorpayPaymentId': { $ne: paymentId }, ...planGuard, ...gate },
      built.update, opts
    );
    if (doc && expiring > 0) quarkBuckets.record({ user: user._id, type: 'expiry', bucket: 'plan', quarks: -expiring, balanceAfter: doc.credits && doc.credits.balance, action: 'plan_expired' });
    if (!doc && record.kind === 'plan' && !alreadyApplied) {
      const fresh = await User.findById(user._id);
      const freshRecord = fresh && findRecord(fresh, record.subscriptionId);
      const replay = !fresh || (fresh.payments || []).some((p) => p && p.razorpayPaymentId === paymentId);
      if (replay || !freshRecord) return { applied: false, reason: 'already_processed' };
      if (attempt < 4) return applyCharge(fresh, freshRecord, { paymentId, paidPaise, subscription }, attempt + 1);
      alert('payment', `plan payment ${paymentId} for account ${user._id} could not be applied after retries: check the account`);
      return { applied: false, reason: 'already_processed' };
    }
    if (!doc) {
      if (record.kind === 'slot' && !alreadyApplied) {
        // Either a replay, or the account changed between our read and the update (for example another payment
        // activated this slot first). Read again once and decide with the current record.
        const fresh = await User.findById(user._id);
        const freshRecord = fresh && findRecord(fresh, record.subscriptionId);
        const replay = !fresh || (fresh.payments || []).some((p) => p && p.razorpayPaymentId === paymentId);
        if (replay || !freshRecord) return { applied: false, reason: 'already_processed' };
        if (attempt < 1) return applyCharge(fresh, freshRecord, { paymentId, paidPaise, subscription }, attempt + 1);
        return refuseSlot(user, record, paymentId, 'slot_conflict', paidPaise);
      }
      return { applied: false, reason: 'already_processed' };
    }
    try {
      const out = await createInvoice({
        email: user.email, firstName: user.firstName, lastName: user.lastName || '',
        companyName: user.companyName || user.businessProfile?.name || '',
        razorpayPaymentId: paymentId, credits: built.quarks,
        itemName: built.spec.itemName, description: built.spec.description,
        amount: built.spec.amountInr, gstPercent: built.spec.gstPercent, totalAmount: built.spec.totalPaise / 100,
        billing: invoiceBillingOf(user)
      });
      if (out && out.invoiceUrl) {
        await User.updateOne({ _id: user._id }, { $set: { 'payments.$[p].invoiceUrl': out.invoiceUrl } }, { arrayFilters: [{ 'p.razorpayPaymentId': paymentId }] });
      }
    } catch (e) {
      console.warn('Invoice creation failed (non-blocking):', e.message);
    }
    await maybeSendWelcome(user, record, built.quarks);
    if (touchesAgency(record)) await syncAgency(user._id);
    return { applied: true, quarks: built.quarks, balance: doc.credits?.balance, doc };
  }

  // Once per account, on the first applied payment of a Starter or Professional plan.
  // Claimed atomically, so a replay or a renewal never sends it again. Never throws.
  async function maybeSendWelcome(user, record, quarks) {
    try {
      if (record.kind !== 'plan' || !['starter', 'professional', 'agency'].includes(record.key)) return;
      const claimed = await User.findOneAndUpdate(
        { _id: user._id, 'plan.welcomeEmailSentAt': null },
        { $set: { 'plan.welcomeEmailSentAt': new Date() } },
        { new: true }
      );
      if (!claimed) return;
      await sendWelcome(user, { tier: record.key, quarks });
    } catch (e) {
      console.warn('Welcome email step failed (non-blocking):', e.message);
    }
  }

  /**
   * POST /api/payment/validate-coupon
   * Validate a coupon code without redeeming it
   */
  router.post('/validate-coupon', protect, payLimiter, async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ success: false, message: 'Coupon code required' });

      const coupon = await Coupon.findOne({ code: code.toUpperCase().trim() });

      if (!coupon || !coupon.isActive) {
        return res.status(404).json({ success: false, message: 'Invalid or expired coupon code' });
      }
      if (coupon.usedCount >= coupon.maxUses) {
        return res.status(400).json({ success: false, message: 'This coupon has already been used' });
      }

      // Check if this user already used it
      const userId = req.user?.userId || req.user?.id || req.user?._id;
      const alreadyUsed = coupon.usedBy.some(u => u.userId?.toString() === userId?.toString());
      if (alreadyUsed) {
        return res.status(400).json({ success: false, message: 'You have already used this coupon' });
      }

      res.json({
        success: true,
        discountedAmount: coupon.discountedAmount,
        originalAmount: coupon.originalAmount,
        savings: coupon.originalAmount - coupon.discountedAmount
      });
    } catch (error) {
      console.error('Validate coupon error:', error);
      res.status(500).json({ success: false, message: 'Failed to validate coupon' });
    }
  });


  /**
   * GET /api/payment/plans
   * Public: the two plans, the top-up packs and the add-ons, with GST.
   */
  router.get('/plans', (_req, res) => {
    res.json({ success: true, ...bp.planCatalogue() });
  });

  /**
   * POST /api/payment/create-subscription  { planId: 'starter' | 'professional' }
   * Creates a Razorpay subscription at price plus GST.
   */
  router.post('/create-subscription', protect, payLimiter, async (req, res) => {
    try {
      const userId = userIdOf(req);
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (refuseWorkspace(user, res)) return;

      if (hasActivePlanSubscription(user)) {
        return res.status(400).json({ success: false, message: 'You already have an active subscription' });
      }
      // Accounts managed by Nebulaa (no plan.tier) do not buy plans: buying one would remove their access.
      if (resolveTier(user) === 'managed') {
        return res.status(400).json({ success: false, message: 'Your plan is managed by Nebulaa, so you do not need to choose a plan. You can still buy Quarks at any time.' });
      }

      const { planId, couponCode } = req.body || {};
      const quote = bp.planQuote(planId);
      if (!quote) {
        return res.status(400).json({ success: false, message: 'Please choose the Starter, Growth or Agency plan.' });
      }

      // Coupons only record discount metadata; the plan price is unchanged.
      let appliedCoupon = null;
      if (couponCode) {
        const coupon = await Coupon.findOne({ code: String(couponCode).toUpperCase().trim() });
        if (!coupon || !coupon.isActive || coupon.usedCount >= coupon.maxUses) {
          return res.status(400).json({ success: false, message: 'Invalid or expired coupon code' });
        }
        if (coupon.usedBy.some(u => u.userId?.toString() === userId?.toString())) {
          return res.status(400).json({ success: false, message: 'You have already used this coupon' });
        }
        appliedCoupon = coupon;
      }

      const razorpayPlanId = await getOrCreateRazorpayPlan('plan', planId);
      const subscription = await rz().subscriptions.create({
        plan_id: razorpayPlanId,
        customer_notify: 1,
        total_count: 120,
        notes: { userId: userId.toString(), email: user.email, tier: planId, couponCode: appliedCoupon?.code || '' }
      });
      await User.updateOne({ _id: user._id }, {
        $push: { 'plan.subscriptions': { subscriptionId: subscription.id, kind: 'plan', key: planId, razorpayPlanId, ...(planId === 'agency' ? { expectedPaise: quote.chargePaise } : {}), active: false, createdAt: new Date() } }
      });

      res.json({
        success: true,
        subscription_id: subscription.id,
        key: env().RAZORPAY_KEY_ID,
        amount: quote.chargePaise,
        gstPaise: quote.gstPaise,
        plan: { id: planId, tier: planId, quarks: quote.quarks },
        prefill: prefillOf(user)
      });
    } catch (error) {
      console.error('Create subscription error:', error);
      res.status(500).json({ success: false, message: 'Failed to create subscription' });
    }
  });

  /**
   * POST /api/payment/create-addon-subscription  { addon }
   * Add-ons need a Starter or Professional plan; Inbox needs Publish and schedule.
   */
  router.post('/create-addon-subscription', protect, payLimiter, async (req, res) => {
    try {
      const userId = userIdOf(req);
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (refuseWorkspace(user, res)) return;

      const { addon } = req.body || {};
      const check = bp.canBuyAddon(user, addon);
      if (!check.ok) return res.status(400).json({ success: false, message: check.message });
      const quote = bp.addonQuote(addon);

      const razorpayPlanId = await getOrCreateRazorpayPlan('addon', addon);
      const subscription = await rz().subscriptions.create({
        plan_id: razorpayPlanId,
        customer_notify: 1,
        total_count: 120,
        notes: { userId: userId.toString(), email: user.email, addon }
      });
      await User.updateOne({ _id: user._id }, {
        $push: { 'plan.subscriptions': { subscriptionId: subscription.id, kind: 'addon', key: addon, razorpayPlanId, active: false, createdAt: new Date() } }
      });

      res.json({
        success: true,
        subscription_id: subscription.id,
        key: env().RAZORPAY_KEY_ID,
        amount: quote.chargePaise,
        gstPaise: quote.gstPaise,
        addon: { id: addon },
        prefill: prefillOf(user)
      });
    } catch (error) {
      console.error('Create add-on subscription error:', error);
      res.status(500).json({ success: false, message: 'Failed to create the add-on subscription' });
    }
  });

  /**
   * POST /api/payment/create-slot-subscription   (no body)
   * One extra client slot for an Agency account: its own monthly subscription at the configured price plus GST.
   * Only an agency account on the Agency plan, and only while below the most clients.
   */
  router.post('/create-slot-subscription', protect, payLimiter, async (req, res) => {
    try {
      const userId = userIdOf(req);
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (refuseWorkspace(user, res)) return;

      const check = bp.canBuySlot(user);
      if (!check.ok) return res.status(400).json({ success: false, message: check.message });
      const quote = bp.slotQuote();

      const razorpayPlanId = await getOrCreateRazorpayPlan('slot', bp.SLOT_KEY);
      const subscription = await rz().subscriptions.create({
        plan_id: razorpayPlanId,
        customer_notify: 1,
        total_count: 120,
        notes: { userId: userId.toString(), email: user.email, slot: bp.SLOT_KEY }
      });
      await User.updateOne({ _id: user._id }, {
        $push: { 'plan.subscriptions': { subscriptionId: subscription.id, kind: 'slot', key: bp.SLOT_KEY, razorpayPlanId, expectedPaise: quote.chargePaise, active: false, createdAt: new Date() } }
      });

      res.json({
        success: true,
        subscription_id: subscription.id,
        key: env().RAZORPAY_KEY_ID,
        amount: quote.chargePaise,
        gstPaise: quote.gstPaise,
        slot: { id: bp.SLOT_KEY, quarks: quote.quarks },
        prefill: prefillOf(user)
      });
    } catch (error) {
      console.error('Create slot subscription error:', error);
      res.status(500).json({ success: false, message: 'Failed to create the extra client subscription' });
    }
  });

  /**
   * POST /api/payment/verify-subscription
   * Verifies the first payment of a plan, add-on or client slot subscription, then grants it.
   */
  router.post('/verify-subscription', protect, payLimiter, async (req, res) => {
    try {
      const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body || {};
      if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Missing payment details' });
      }
      if (!bp.verifyCheckoutSignature(`${razorpay_payment_id}|${razorpay_subscription_id}`, razorpay_signature, env().RAZORPAY_KEY_SECRET)) {
        { require('../services/opsAlerts').recordFailure('payment', 'checkout signature failed'); return res.status(400).json({ success: false, message: 'Payment verification failed: invalid signature' }); }
      }

      const user = await User.findById(userIdOf(req));
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const record = findRecord(user, razorpay_subscription_id);
      if (!record) return res.status(404).json({ success: false, message: 'We could not find this subscription on your account.' });
      const rzpSub = await rz().subscriptions.fetch(razorpay_subscription_id);
      if (!recordMatches(user, record, rzpSub)) {
        return res.status(400).json({ success: false, message: 'This subscription does not match your account.' });
      }

      const spec = bp.priceOfRecord(record, bp.invoiceSpec(record.kind, record.key));
      let paidPaise = spec.totalPaise;
      // The Agency plan and client slots are checked against the amount Razorpay says was paid, as the webhook does.
      // A payment we already hold a row for (applied, or refused earlier) is not looked up again.
      if (isStrictAmount(record) && !(user.payments || []).some((p) => p && p.razorpayPaymentId === razorpay_payment_id)) {
        const reported = await rz().payments.fetch(razorpay_payment_id);
        const amount = Number(reported && reported.amount);
        if (!reported || reported.amount === undefined || reported.amount === null || !Number.isFinite(amount)) {
          // Cannot confirm the amount: grant nothing here. The webhook for this payment applies it once it is confirmed.
          return res.status(409).json({ success: false, message: REFUSALS.amount_unconfirmed });
        }
        if (amount !== spec.totalPaise) {
          console.warn(`Verify payment ${razorpay_payment_id} for ${razorpay_subscription_id} has an unexpected amount: not applied`);
          await recordRefusal(user, record, razorpay_payment_id, amount, 'amount_mismatch');
          await stopUnappliedPlan(record);
          return res.status(409).json({ success: false, message: REFUSALS.amount_mismatch });
        }
        paidPaise = amount;
      }
      const result = await applyCharge(user, record, { paymentId: razorpay_payment_id, paidPaise, subscription: rzpSub });
      if (!result.applied && REFUSALS[result.reason]) {
        return res.status(409).json({ success: false, message: REFUSALS[result.reason] });
      }
      if (result.applied && record.kind === 'plan' && rzpSub.notes?.couponCode) {
        await Coupon.findOneAndUpdate(
          { code: rzpSub.notes.couponCode },
          { $inc: { usedCount: 1 }, $push: { usedBy: { userId: user._id, email: user.email, usedAt: new Date() } } }
        );
      }
      res.json({
        success: true,
        alreadyProcessed: !result.applied,
        message: record.kind === 'plan' ? 'Your plan is active.' : record.kind === 'slot' ? 'Your extra client is added.' : 'Your add-on is active.',
        kind: record.kind, key: record.key,
        quarksGranted: result.applied ? result.quarks : 0,
        balance: result.applied ? result.balance : user.credits?.balance,
        ...(touchesAgency(record) ? { clientLimit: agencyRules.clientLimitOf(result.applied ? result.doc : user) } : {})
      });
    } catch (error) {
      console.error('Verify subscription error:', error);
      require('../services/opsAlerts').recordFailure('payment', `verify-subscription: ${error.message}`);
      res.status(500).json({ success: false, message: 'Subscription verification failed' });
    }
  });

  /**
   * POST /api/payment/webhook
   * Razorpay webhook: monthly charges and subscription endings.
   * Needs the raw body (express.raw is registered in server-main.js before express.json).
   * Fails closed: without RAZORPAY_WEBHOOK_SECRET nothing is granted.
   */
  router.post('/webhook', async (req, res) => {
    try {
      const secret = env().RAZORPAY_WEBHOOK_SECRET;
      if (!secret) {
        console.error('RAZORPAY_WEBHOOK_SECRET is not set: webhook refused');
        return res.status(503).json({ success: false, message: 'Webhook is not configured' });
      }
      if (!bp.verifyWebhookSignature(req.body, req.headers['x-razorpay-signature'], secret)) {
        console.warn('Razorpay webhook signature mismatch');
        return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
      }

      const { event: eventName, payload } = JSON.parse(req.body.toString());
      const subscription = payload?.subscription?.entity;
      const payment = payload?.payment?.entity;
      if (!subscription?.id) return res.json({ success: true });

      const user = await User.findOne({ 'plan.subscriptions.subscriptionId': subscription.id });
      if (!user) return res.json({ success: true });
      const record = findRecord(user, subscription.id);
      if (!recordMatches(user, record, subscription)) {
        console.warn(`Webhook for ${subscription.id} does not match the stored subscription: ignored`);
        return res.json({ success: true });
      }

      if (eventName === 'subscription.charged') {
        if (!payment?.id) return res.json({ success: true });
        const spec = bp.invoiceSpec(record.kind, record.key);
        // The Agency plan and client slots only accept exactly the price stored when they were bought (GST included).
        // A different amount (a wrongly configured Razorpay plan, for example) grants nothing, is recorded for staff
        // and the owner is told at once.
        if (isStrictAmount(record) && payment.amount !== expectedPaiseOf(record)) {
          console.warn(`Webhook payment ${payment.id} for ${subscription.id} has an unexpected amount: not applied`);
          const existing = (user.payments || []).some((p) => p && p.razorpayPaymentId === payment.id);
          if (!existing) await recordRefusal(user, record, payment.id, Number(payment.amount), 'amount_mismatch');
          if (!existing) await stopUnappliedPlan(record);
          return res.json({ success: true });
        }
        const paidPaise = Number.isFinite(payment.amount) ? payment.amount : spec.totalPaise;
        await applyCharge(user, record, { paymentId: payment.id, paidPaise, subscription });
      } else if (ENDING_EVENTS.includes(eventName)) {
        const built = bp.buildEndUpdate(user, record, eventName);
        await User.findOneAndUpdate({ _id: user._id, ...(built.filter || {}) }, built.update, { new: true, arrayFilters: built.arrayFilters });
        if (built.endsPlan) await cancelAddonSubscriptions(user);
        if (built.endsSlot) await User.updateOne({ _id: user._id, 'agency.extraSlots': { $lt: 0 } }, { $set: { 'agency.extraSlots': 0 } });
        // The plan or a slot ended: the client limit changed, so clients above it are frozen (never deleted).
        if (touchesAgency(record) && (built.endsSlot || built.endsPlan)) await syncAgency(user._id);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Webhook error:', error);
      require('../services/opsAlerts').recordFailure('payment', `webhook: ${error.message}`);
      res.status(500).json({ success: false });
    }
  });

  /**
   * POST /api/payment/create-order  { packInr }
   * Quark top-up. Only the three pack prices are accepted; the Quarks are recorded
   * from config in the order notes.
   */
  router.post('/create-order', protect, payLimiter, async (req, res) => {
    try {
      const pack = bp.findTopupPack(req.body?.packInr);
      if (!pack) {
        return res.status(400).json({ success: false, message: 'Please choose one of the Quark packs.' });
      }
      const userId = userIdOf(req);
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (refuseWorkspace(user, res)) return;
      // Top-ups sit on top of a plan: bought without one they would only be held.
      if (resolveTier(user) === 'free') {
        return res.status(403).json({ success: false, upgradeRequired: true, reason: 'upgrade', message: 'Please choose a plan first. Quarks can be topped up once a plan is active.' });
      }

      const quote = bp.invoiceSpec('topup', pack.inr);
      const order = await rz().orders.create({
        amount: quote.totalPaise,
        currency: PLAN_CURRENCY,
        receipt: `neb_${userId.toString().slice(-8)}_${Date.now().toString(36)}`,
        notes: { userId: userId.toString(), email: user.email, kind: 'topup', packInr: String(pack.inr), quarks: String(pack.quarks) }
      });

      res.json({
        success: true,
        order: { id: order.id, amount: order.amount, currency: order.currency },
        pack: { inr: pack.inr, quarks: pack.quarks, gstPaise: quote.gstPaise, chargePaise: quote.totalPaise },
        key: env().RAZORPAY_KEY_ID,
        description: `Nebulaa: ${pack.quarks} Quarks`,
        prefill: prefillOf(user)
      });
    } catch (error) {
      console.error('Create order error:', error);
      require('../services/opsAlerts').recordFailure('payment', `create-order: ${error.message}`);
      res.status(500).json({ success: false, message: 'Failed to create payment order' });
    }
  });

  /**
   * POST /api/payment/verify
   * Verifies a top-up payment, then grants the pack's Quarks (from config).
   */
  router.post('/verify', protect, payLimiter, async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Missing payment details' });
      }
      if (!bp.verifyCheckoutSignature(`${razorpay_order_id}|${razorpay_payment_id}`, razorpay_signature, env().RAZORPAY_KEY_SECRET)) {
        { require('../services/opsAlerts').recordFailure('payment', 'checkout signature failed'); return res.status(400).json({ success: false, message: 'Payment verification failed: invalid signature' }); }
      }

      const user = await User.findById(userIdOf(req));
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const order = await rz().orders.fetch(razorpay_order_id);
      const pack = bp.findTopupPack(Number(order?.notes?.packInr));
      if (!order || order.notes?.kind !== 'topup' || String(order.notes?.userId) !== String(user._id)) {
        return res.status(403).json({ success: false, message: 'This order does not belong to your account.' });
      }
      if (!pack || order.amount !== chargePaise(pack.inr)) {
        return res.status(400).json({ success: false, message: 'This order does not match a Quark pack.' });
      }

      const result = await applyCharge(user, { kind: 'topup', key: pack.inr, orderId: razorpay_order_id }, {
        paymentId: razorpay_payment_id, paidPaise: order.amount
      });
      res.json({
        success: true,
        alreadyProcessed: !result.applied,
        message: result.applied ? `${pack.quarks} Quarks added to your account.` : 'This payment was already added to your account.',
        quarksGranted: result.applied ? result.quarks : 0,
        balance: result.applied ? result.balance : user.credits?.balance
      });
    } catch (error) {
      console.error('Payment verify error:', error);
      require('../services/opsAlerts').recordFailure('payment', `verify: ${error.message}`);
      res.status(500).json({ success: false, message: 'Payment verification failed' });
    }
  });

  /**
   * GET /api/payment/status
   * Check if user has paid and migration status
   */
  router.get('/status', protect, async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.user?._id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const lastPayment = user.payments?.length ? user.payments[user.payments.length - 1] : null;
      res.json({
        success: true,
        payment: {
          paid: lastPayment?.status === 'paid',
          paymentId: lastPayment?.razorpayPaymentId || null,
          paidAt: lastPayment?.paidAt || null,
          amount: lastPayment?.amount || null
        },
        migrated: user.trial?.migratedToProd || false,
        prodUrl: user.trial?.migratedToProd ? 'https://gravity.nebulaa.ai' : null
      });

    } catch (error) {
      console.error('Payment status error:', error);
      res.status(500).json({ success: false, message: 'Failed to get payment status' });
    }
  });

  /**
   * GET and PUT /api/payment/billing-details
   * The optional details for a tax invoice: a GSTIN with the business name, and the state the supply is made to.
   * Never needed to pay. They are read when an invoice is made, so they apply to payments made after they are saved.
   */
  const detailsOf = (u) => {
    const b = (u && u.billingDetails) || {};
    return { gstin: b.gstin || '', legalName: b.legalName || '', address: b.address || '', pin: b.pin || '', stateCode: b.stateCode || '' };
  };
  router.get('/billing-details', protect, async (req, res) => {
    try {
      const user = await User.findById(userIdOf(req));
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      res.json({ success: true, details: detailsOf(user), states: gstinRules.STATES.map((s) => ({ abbr: s.abbr, name: s.name })) });
    } catch (error) {
      console.error('Billing details fetch error:', error);
      res.status(500).json({ success: false, message: 'We could not load your invoice details. Please try again.' });
    }
  });
  router.put('/billing-details', protect, payLimiter, async (req, res) => {
    try {
      const user = await User.findById(userIdOf(req));
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      const b = req.body || {};
      const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
      const next = { gstin: '', legalName: clip(b.legalName, 120), address: clip(b.address, 240), pin: clip(b.pin, 6).replace(/\D/g, ''), stateCode: '' };
      if (b.pin && next.pin.length !== 6) return res.status(400).json({ success: false, errors: { pin: 'A PIN code has 6 digits.' }, message: 'Please check the PIN code.' });
      if (gstinRules.normalise(b.gstin)) {
        const v = gstinRules.validateGstin(b.gstin);
        if (!v.ok) return res.status(400).json({ success: false, errors: { gstin: v.message }, message: v.message });
        if (next.legalName.length < 2) return res.status(400).json({ success: false, errors: { legalName: 'Enter the business name exactly as it is registered for GST.' }, message: 'Enter the business name exactly as it is registered for GST.' });
        next.gstin = v.gstin;
        next.stateCode = v.stateAbbr; // a GSTIN fixes the state the supply is made to
      } else if (b.stateCode) {
        const st = gstinRules.stateByAbbr(b.stateCode);
        if (!st) return res.status(400).json({ success: false, errors: { stateCode: 'Choose a state from the list.' }, message: 'Choose a state from the list.' });
        next.stateCode = st.abbr;
      }
      await User.updateOne({ _id: user._id }, { $set: { billingDetails: { ...next, updatedAt: new Date() } } });
      res.json({ success: true, details: next, message: next.gstin ? 'Saved. Your next invoice will carry this GSTIN.' : 'Saved.' });
    } catch (error) {
      console.error('Billing details save error:', error);
      res.status(500).json({ success: false, message: 'We could not save your invoice details. Please try again.' });
    }
  });

  /**
   * POST /api/payment/cancel-subscription
   * One click stop. The plan (and any add-ons) is cancelled at Razorpay at the END of the month already paid for, so the
   * customer keeps using what they paid for and is not charged again. Safe to press twice.
   */
  router.post('/cancel-subscription', protect, payLimiter, async (req, res) => {
    try {
      const user = await User.findById(userIdOf(req));
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      const tier = resolveTier(user);
      const planRecs = storedSubscriptions(user).filter((s) => s.kind === 'plan' && s.active);
      const planIds = planRecs.map((s) => s.subscriptionId);
      const legacyId = user.subscription && user.subscription.razorpaySubscriptionId;
      if (legacyId && !planIds.includes(legacyId) && user.subscription.status === 'active') planIds.push(legacyId);
      const endsAt = (user.subscription && (user.subscription.currentPeriodEnd || user.subscription.nextBillingAt)) || null;
      if (tier === 'managed' || tier === 'free' || planIds.length === 0) {
        return res.status(400).json({ success: false, message: 'There is no plan to cancel on this account.' });
      }
      if (user.subscription && user.subscription.cancelAtPeriodEnd) {
        return res.json({ success: true, alreadyCancelling: true, endsAt, message: 'Your plan is already set to end. You can keep using it until then.' });
      }
      const addonIds = storedSubscriptions(user).filter((s) => (s.kind === 'addon' || s.kind === 'slot') && s.active).map((s) => s.subscriptionId);
      // "Already cancelled" counts as done, so a repeated press or an earlier partial attempt does not fail.
      const alreadyDone = alreadyCancelled;
      let planCancelled = 0;
      for (const id of planIds) {
        try { await rz().subscriptions.cancel(id, 1); planCancelled += 1; }
        catch (e) { if (alreadyDone(e)) planCancelled += 1; else console.error(`Could not cancel plan subscription ${id}:`, e && e.message); }
      }
      if (planCancelled === 0) {
        require('../services/opsAlerts').recordFailure('payment', 'cancel subscription failed');
        return res.status(502).json({ success: false, message: 'We could not cancel your plan just now. Please try again in a few minutes, or write to us and we will do it for you.' });
      }
      for (const id of addonIds) {
        try { await rz().subscriptions.cancel(id, 1); } catch (e) { if (!alreadyDone(e)) console.warn(`Could not cancel add-on subscription ${id}:`, e && e.message); }
      }
      await User.updateOne({ _id: user._id }, { $set: { 'subscription.cancelAtPeriodEnd': true, 'subscription.cancelRequestedAt': new Date() } });
      res.json({ success: true, endsAt, message: 'Your plan will not renew. You can keep using it until the end of the month you paid for.' });
    } catch (error) {
      console.error('Cancel subscription error:', error);
      require('../services/opsAlerts').recordFailure('payment', `cancel-subscription: ${error.message}`);
      res.status(500).json({ success: false, message: 'We could not cancel your plan just now. Please try again in a few minutes.' });
    }
  });

  /**
   * GET /api/payment/billing
   * Returns payment history, subscription status, and credits for the Billing tab
   */
  router.get('/billing', protect, async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.user?._id;
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const payments = user.payments || [];
      let needsSave = false;

      // Lazily enrich payments with Razorpay invoice URLs (fetched once, then cached)
      for (const payment of payments) {
        if (!payment.invoiceUrl && payment.razorpayPaymentId) {
          try {
            const rpPayment = await rz().payments.fetch(payment.razorpayPaymentId);
            if (rpPayment.invoice_id) {
              const invoice = await rz().invoices.fetch(rpPayment.invoice_id);
              payment.invoiceUrl = invoice.short_url || '';
              needsSave = true;
            }
          } catch (e) {
            console.warn(`Could not fetch invoice for ${payment.razorpayPaymentId}:`, e.message);
          }
        }
      }

      if (needsSave) await user.save();

      res.json({
        success: true,
        subscription: {
          ...(user.subscription && user.subscription.toObject ? user.subscription.toObject() : (user.subscription || { plan: 'free', status: 'active' })),
          cancelAtPeriodEnd: !!(user.subscription && user.subscription.cancelAtPeriodEnd),
          endsAt: (user.subscription && (user.subscription.currentPeriodEnd || user.subscription.nextBillingAt)) || null
        },
        plan: { tier: resolveTier(user), addons: addonsOf(user) },
        billingDetails: detailsOf(user),
        credits: {
          balance: user.credits?.balance ?? 0,
          totalUsed: user.credits?.totalUsed ?? 0
        },
        payments: payments.map(p => ({
          orderId: p.razorpayOrderId,
          paymentId: p.razorpayPaymentId,
          amount: p.amount,
          currency: p.currency,
          credits: p.credits,
          status: p.status,
          invoiceUrl: p.invoiceUrl || null,
          paidAt: p.paidAt
        }))
      });
    } catch (error) {
      console.error('Billing fetch error:', error);
      res.status(500).json({ success: false, message: 'Failed to load billing data' });
    }
  });

  /**
   * POST /api/payment/retry-invoices
   * Retry Zoho Books invoice creation for past payments that don't have an invoice
   */
  router.post('/retry-invoices', protect, async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.user?._id;
      console.log(`📄 [RETRY-INVOICES] Starting for user: ${userId}`);

      const user = await User.findById(userId);

      if (!user) {
        console.log(`📄 [RETRY-INVOICES] User not found: ${userId}`);
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      console.log(`📄 [RETRY-INVOICES] User: ${user.email}, Payments count: ${(user.payments || []).length}`);

      const payments = user.payments || [];
      const results = [];

      for (const payment of payments) {
        console.log(`📄 [RETRY-INVOICES] Processing payment: ${payment.razorpayPaymentId}, amount: ₹${payment.amount}, hasInvoice: ${!!payment.invoiceUrl}`);

        // Only money we kept gets a tax invoice: a refused or refunded payment is never invoiced.
        if ((payment.status || 'paid') !== 'paid') {
          results.push({ paymentId: payment.razorpayPaymentId, status: 'skipped_not_paid' });
          continue;
        }

        if (payment.invoiceUrl) {
          console.log(`📄 [RETRY-INVOICES] Skipping ${payment.razorpayPaymentId} — invoice already exists`);
          results.push({ paymentId: payment.razorpayPaymentId, status: 'already_exists' });
          continue;
        }

        try {
          console.log(`📄 [RETRY-INVOICES] Creating Zoho invoice for ${payment.razorpayPaymentId}...`);
          console.log(`📄 [RETRY-INVOICES] Zoho config — CLIENT_ID: ${process.env.ZOHO_BOOKS_CLIENT_ID ? process.env.ZOHO_BOOKS_CLIENT_ID.slice(0, 10) + '...' : 'NOT SET'}, ORG_ID: ${process.env.ZOHO_BOOKS_ORG_ID || 'NOT SET'}, REFRESH_TOKEN: ${process.env.ZOHO_BOOKS_REFRESH_TOKEN ? 'SET' : 'NOT SET'}`);

          // Newer payments remember their item name and ex-GST amount; older ones use the original invoice.
          const gstFields = payment.item && payment.exGstAmount
            ? { itemName: payment.item, description: payment.item, gstPercent: 18, amount: payment.exGstAmount, totalAmount: payment.amount }
            : { amount: payment.amount };
          const invoiceResult = await createInvoice({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName || '',
            companyName: user.companyName || user.businessProfile?.name || '',
            credits: payment.credits,
            razorpayPaymentId: payment.razorpayPaymentId,
            ...gstFields
          });

          console.log(`📄 [RETRY-INVOICES] ✅ Invoice created! Number: ${invoiceResult.invoiceNumber}, URL: ${invoiceResult.invoiceUrl}`);

          payment.invoiceUrl = invoiceResult.invoiceUrl || '';
          results.push({
            paymentId: payment.razorpayPaymentId,
            status: 'created',
            invoiceNumber: invoiceResult.invoiceNumber
          });
        } catch (err) {
          console.error(`📄 [RETRY-INVOICES] ❌ Failed for ${payment.razorpayPaymentId}:`, err.message);
          console.error(`📄 [RETRY-INVOICES] Full error:`, err.stack || err);
          results.push({
            paymentId: payment.razorpayPaymentId,
            status: 'failed',
            error: err.message
          });
        }
      }

      await user.save();
      console.log(`📄 [RETRY-INVOICES] Done. Results:`, JSON.stringify(results));

      res.json({ success: true, results });
    } catch (error) {
      console.error('📄 [RETRY-INVOICES] Fatal error:', error);
      res.status(500).json({ success: false, message: 'Failed to retry invoice creation' });
    }
  });


  return router;
}

const router = createPaymentRouter();
router.createPaymentRouter = createPaymentRouter;

module.exports = router;
