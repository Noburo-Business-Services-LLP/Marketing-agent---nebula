/**
 * Payment Routes: Razorpay billing for Starter and Professional plans, add-on
 * subscriptions and Quark top-up packs.
 *
 * Every price is GST-exclusive in config/apiCosts.js; 18 percent GST is added at
 * checkout (integer paise). Quarks are granted from that config only: never from
 * a request body, a webhook payload or an order note. Every grant is gated by an
 * atomic update that skips a Razorpay payment id already stored on the user.
 *
 *   GET  /plans                      plans, top-up packs and add-ons with GST
 *   POST /create-subscription        { planId: 'starter' | 'professional' }
 *   POST /create-addon-subscription  { addon: 'publish' | 'competitors' | 'inbox' | 'bundle' }
 *   POST /verify-subscription        checkout signature, then grant (plan or add-on)
 *   POST /create-order               { packInr } one of the top-up pack prices
 *   POST /verify                     checkout signature, then grant the pack's Quarks
 *   POST /webhook                    subscription.charged / halted / cancelled / completed
 *   GET  /status, /billing, POST /retry-invoices, /validate-coupon
 */
const express = require('express');
const crypto = require('crypto');
const bp = require('../services/billingPlans');
const { resolveTier, addonsOf } = require('../config/entitlements');
const { chargePaise } = require('../config/apiCosts');

const PLAN_CURRENCY = 'INR';
const ENDING_EVENTS = ['subscription.cancelled', 'subscription.halted', 'subscription.completed'];

function createPaymentRouter(deps = {}) {
  const router = express.Router();
  const protect = deps.protect || require('../middleware/auth').protect;
  const User = deps.User || require('../models/User');
  const Coupon = deps.Coupon || require('../models/Coupon');
  const createInvoice = deps.createInvoice || require('../services/zohoBooks').createInvoice;
  const env = () => deps.env || process.env;
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
    if (record.kind === 'plan' ? !bp.isPlanId(record.key) : record.kind === 'addon' ? !bp.isAddonId(record.key) : true) return false;
    if (!record.razorpayPlanId || entity.plan_id !== record.razorpayPlanId) return false;
    if (String(entity.notes?.userId || '') !== String(user._id)) return false;
    return true;
  }

  // When a plan ends, its add-ons must stop billing too (best effort per subscription).
  async function cancelAddonSubscriptions(user) {
    const addons = storedSubscriptions(user).filter((s) => s.kind === 'addon' && s.active);
    for (const a of addons) {
      try { await rz().subscriptions.cancel(a.subscriptionId, 0); }
      catch (e) { console.warn(`Could not cancel add-on subscription ${a.subscriptionId}:`, e.message); }
    }
    await User.updateOne({ _id: user._id }, { $set: { 'plan.subscriptions.$[addon].active': false } }, { arrayFilters: [{ 'addon.kind': 'addon' }] });
  }

  // One payment, applied once. Returns { applied:false } on a replay.
  async function applyCharge(user, record, { paymentId, paidPaise, subscription }) {
    const built = bp.buildChargeUpdate(record, { paymentId, paidPaise, subscription });
    if (!built) return { applied: false, reason: 'unknown_item' };
    const opts = { new: true, ...(built.arrayFilters ? { arrayFilters: built.arrayFilters } : {}) };
    const doc = await User.findOneAndUpdate(
      { _id: user._id, 'payments.razorpayPaymentId': { $ne: paymentId } },
      built.update, opts
    );
    if (!doc) return { applied: false, reason: 'already_processed' };
    try {
      const out = await createInvoice({
        email: user.email, firstName: user.firstName, lastName: user.lastName || '',
        companyName: user.companyName || user.businessProfile?.name || '',
        razorpayPaymentId: paymentId, credits: built.quarks,
        itemName: built.spec.itemName, description: built.spec.description,
        amount: built.spec.amountInr, gstPercent: built.spec.gstPercent, totalAmount: built.spec.totalPaise / 100
      });
      if (out && out.invoiceUrl) {
        await User.updateOne({ _id: user._id }, { $set: { 'payments.$[p].invoiceUrl': out.invoiceUrl } }, { arrayFilters: [{ 'p.razorpayPaymentId': paymentId }] });
      }
    } catch (e) {
      console.warn('Invoice creation failed (non-blocking):', e.message);
    }
    await maybeSendWelcome(user, record, built.quarks);
    return { applied: true, quarks: built.quarks, balance: doc.credits?.balance, doc };
  }

  // Once per account, on the first applied payment of a Starter or Professional plan.
  // Claimed atomically, so a replay or a renewal never sends it again. Never throws.
  async function maybeSendWelcome(user, record, quarks) {
    try {
      if (record.kind !== 'plan' || !['starter', 'professional'].includes(record.key)) return;
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
  router.post('/validate-coupon', protect, async (req, res) => {
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
  router.post('/create-subscription', protect, async (req, res) => {
    try {
      const userId = userIdOf(req);
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

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
        return res.status(400).json({ success: false, message: 'Please choose the Starter or Professional plan.' });
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
        $push: { 'plan.subscriptions': { subscriptionId: subscription.id, kind: 'plan', key: planId, razorpayPlanId, active: false, createdAt: new Date() } }
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
  router.post('/create-addon-subscription', protect, async (req, res) => {
    try {
      const userId = userIdOf(req);
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

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
   * POST /api/payment/verify-subscription
   * Verifies the first payment of a plan or add-on subscription, then grants it.
   */
  router.post('/verify-subscription', protect, async (req, res) => {
    try {
      const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body || {};
      if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Missing payment details' });
      }
      if (!bp.verifyCheckoutSignature(`${razorpay_payment_id}|${razorpay_subscription_id}`, razorpay_signature, env().RAZORPAY_KEY_SECRET)) {
        return res.status(400).json({ success: false, message: 'Payment verification failed: invalid signature' });
      }

      const user = await User.findById(userIdOf(req));
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const record = findRecord(user, razorpay_subscription_id);
      if (!record) return res.status(404).json({ success: false, message: 'We could not find this subscription on your account.' });
      const rzpSub = await rz().subscriptions.fetch(razorpay_subscription_id);
      if (!recordMatches(user, record, rzpSub)) {
        return res.status(400).json({ success: false, message: 'This subscription does not match your account.' });
      }

      const spec = bp.invoiceSpec(record.kind, record.key);
      const result = await applyCharge(user, record, { paymentId: razorpay_payment_id, paidPaise: spec.totalPaise, subscription: rzpSub });
      if (result.applied && record.kind === 'plan' && rzpSub.notes?.couponCode) {
        await Coupon.findOneAndUpdate(
          { code: rzpSub.notes.couponCode },
          { $inc: { usedCount: 1 }, $push: { usedBy: { userId: user._id, email: user.email, usedAt: new Date() } } }
        );
      }
      res.json({
        success: true,
        alreadyProcessed: !result.applied,
        message: record.kind === 'plan' ? 'Your plan is active.' : 'Your add-on is active.',
        kind: record.kind, key: record.key,
        quarksGranted: result.applied ? result.quarks : 0,
        balance: result.applied ? result.balance : user.credits?.balance
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
        const paidPaise = Number.isFinite(payment.amount) ? payment.amount : spec.totalPaise;
        await applyCharge(user, record, { paymentId: payment.id, paidPaise, subscription });
      } else if (ENDING_EVENTS.includes(eventName)) {
        const built = bp.buildEndUpdate(user, record, eventName);
        await User.findOneAndUpdate({ _id: user._id }, built.update, { new: true, arrayFilters: built.arrayFilters });
        if (built.endsPlan) await cancelAddonSubscriptions(user);
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
  router.post('/create-order', protect, async (req, res) => {
    try {
      const pack = bp.findTopupPack(req.body?.packInr);
      if (!pack) {
        return res.status(400).json({ success: false, message: 'Please choose one of the Quark packs.' });
      }
      const userId = userIdOf(req);
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

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
  router.post('/verify', protect, async (req, res) => {
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Missing payment details' });
      }
      if (!bp.verifyCheckoutSignature(`${razorpay_order_id}|${razorpay_payment_id}`, razorpay_signature, env().RAZORPAY_KEY_SECRET)) {
        return res.status(400).json({ success: false, message: 'Payment verification failed: invalid signature' });
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
        subscription: user.subscription || { plan: 'free', status: 'active' },
        plan: { tier: resolveTier(user), addons: addonsOf(user) },
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
