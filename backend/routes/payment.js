/**
 * Payment Routes — Razorpay integration for demo → prod subscription
 * 
 * Flow:
 * 1. POST /api/payment/create-order  → Create Razorpay order (₹10,000/month)
 * 2. POST /api/payment/verify        → Verify payment + trigger migration + send email
 * 3. GET  /api/payment/status        → Check payment/migration status
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { migrateUserData } = require('../services/migrationService');
const { createInvoice } = require('../services/zohoBooks');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const PLAN_CURRENCY = 'INR';
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 20000;
const MONTHLY_AMOUNT = 7500;   // ₹7,500/month
const MONTHLY_CREDITS = 1000;  // credits per billing cycle

// Cache plan ID so we don't create duplicates
let cachedPlanId = process.env.RAZORPAY_PLAN_ID || null;

async function getOrCreatePlan() {
  if (cachedPlanId) return cachedPlanId;
  const plan = await razorpay.plans.create({
    period: 'monthly',
    interval: 1,
    item: {
      name: 'Nebulaa Gravity — Starter Pack',
      amount: MONTHLY_AMOUNT * 100,
      currency: PLAN_CURRENCY,
      description: '1,000 credits per month'
    },
    notes: { product: 'nebulaa_gravity' }
  });
  cachedPlanId = plan.id;
  console.log(`✅ Razorpay Plan created/cached: ${plan.id}`);
  return plan.id;
}

/**
 * POST /api/payment/create-subscription
 * Creates a Razorpay monthly subscription (₹7,500/month)
 */
router.post('/create-subscription', protect, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.subscription?.razorpaySubscriptionId && user.subscription?.status === 'active') {
      return res.status(400).json({ success: false, message: 'You already have an active subscription' });
    }

    const planId = await getOrCreatePlan();

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 120,
      notes: {
        userId: userId.toString(),
        email: user.email
      }
    });

    res.json({
      success: true,
      subscription_id: subscription.id,
      key: process.env.RAZORPAY_KEY_ID,
      prefill: {
        name: `${user.firstName} ${user.lastName || ''}`.trim(),
        email: user.email,
        contact: ''
      }
    });
  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ success: false, message: 'Failed to create subscription' });
  }
});

/**
 * POST /api/payment/verify-subscription
 * Verifies first payment of a subscription, then triggers demo→prod migration
 */
router.post('/verify-subscription', protect, async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    // Verify signature (subscription variant)
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed — invalid signature' });
    }

    console.log(`✅ Subscription payment verified: ${razorpay_payment_id}`);

    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Fetch subscription details from Razorpay
    const rzpSub = await razorpay.subscriptions.fetch(razorpay_subscription_id);

    // Update subscription on user
    user.subscription = {
      plan: 'pro',
      status: 'active',
      razorpaySubscriptionId: razorpay_subscription_id,
      razorpayPlanId: rzpSub.plan_id,
      currentPeriodEnd: rzpSub.current_end ? new Date(rzpSub.current_end * 1000) : null,
      nextBillingAt: rzpSub.charge_at ? new Date(rzpSub.charge_at * 1000) : null
    };

    // Record payment
    user.payments.push({
      razorpayOrderId: razorpay_subscription_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: MONTHLY_AMOUNT,
      currency: PLAN_CURRENCY,
      credits: MONTHLY_CREDITS,
      status: 'paid',
      paidAt: new Date()
    });
    await user.save();

    // Create Zoho invoice (non-blocking)
    try {
      const invoiceResult = await createInvoice({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName || '',
        companyName: user.companyName || user.businessProfile?.name || '',
        amount: MONTHLY_AMOUNT,
        credits: MONTHLY_CREDITS,
        razorpayPaymentId: razorpay_payment_id
      });
      const lastPayment = user.payments[user.payments.length - 1];
      if (lastPayment && invoiceResult.invoiceUrl) {
        lastPayment.invoiceUrl = invoiceResult.invoiceUrl;
        await user.save();
      }
      console.log(`📄 Zoho invoice created: ${invoiceResult.invoiceNumber}`);
    } catch (zohoErr) {
      console.warn('Zoho invoice creation failed (non-blocking):', zohoErr.message);
    }

    // Migrate demo → prod
    console.log(`🚀 Starting migration for user: ${userId}`);
    const migrationResult = await migrateUserData(userId.toString(), MONTHLY_CREDITS);
    if (!migrationResult.success) {
      return res.status(500).json({
        success: false,
        message: `Payment successful but migration failed: ${migrationResult.error}. Contact support.`,
        paymentId: razorpay_payment_id
      });
    }

    // Send welcome email (non-blocking)
    try { await sendWelcomeEmail(user.email, user.firstName); } catch (_) {}

    // Mark as migrated
    user.trial = { ...user.trial?.toObject?.() || {}, isExpired: true, migratedToProd: true };
    await user.save();

    res.json({
      success: true,
      message: 'Subscription activated and account migrated to production!',
      migration: migrationResult.summary,
      prodUrl: 'https://gravity.nebulaa.ai',
      email: user.email
    });
  } catch (error) {
    console.error('Verify subscription error:', error);
    res.status(500).json({ success: false, message: 'Subscription verification failed' });
  }
});

/**
 * POST /api/payment/webhook
 * Razorpay webhook — handles recurring monthly charges & subscription state changes
 * NOTE: Requires raw body (express.raw middleware registered in server.js BEFORE express.json)
 */
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret) {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.body)
        .digest('hex');
      if (expectedSignature !== signature) {
        console.warn('⚠️ Razorpay webhook signature mismatch');
        return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
      }
    } else {
      console.warn('⚠️ RAZORPAY_WEBHOOK_SECRET not set — skipping signature check');
    }

    const event = JSON.parse(req.body.toString());
    const { event: eventName, payload } = event;
    console.log(`🔔 Razorpay webhook: ${eventName}`);

    const subscription = payload?.subscription?.entity;
    const payment = payload?.payment?.entity;
    const userId = subscription?.notes?.userId;

    if (!userId) return res.json({ success: true });

    const user = await User.findById(userId);
    if (!user) return res.json({ success: true });

    if (eventName === 'subscription.charged') {
      // Monthly renewal — add credits
      user.credits = user.credits || {};
      user.credits.balance = (user.credits.balance || 0) + MONTHLY_CREDITS;

      user.subscription.status = 'active';
      if (subscription.current_end) user.subscription.currentPeriodEnd = new Date(subscription.current_end * 1000);
      if (subscription.charge_at) user.subscription.nextBillingAt = new Date(subscription.charge_at * 1000);

      if (payment) {
        user.payments.push({
          razorpayOrderId: subscription.id,
          razorpayPaymentId: payment.id,
          amount: payment.amount / 100,
          currency: PLAN_CURRENCY,
          credits: MONTHLY_CREDITS,
          status: 'paid',
          paidAt: new Date()
        });
      }
      await user.save();
      console.log(`✅ Monthly credits added for user: ${userId} (${MONTHLY_CREDITS} credits)`);
    }

    if (eventName === 'subscription.halted') {
      await User.findByIdAndUpdate(userId, { 'subscription.status': 'halted' });
      console.log(`⚠️ Subscription halted for user: ${userId}`);
    }

    if (eventName === 'subscription.cancelled') {
      await User.findByIdAndUpdate(userId, { 'subscription.status': 'cancelled' });
      console.log(`❌ Subscription cancelled for user: ${userId}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false });
  }
});

/**
 * POST /api/payment/create-order
 * Creates a Razorpay order for chosen credit amount
 */
router.post('/create-order', protect, async (req, res) => {
  try {
    const { amount } = req.body;
    const numAmount = Number(amount);
    if (!numAmount || numAmount < MIN_AMOUNT || numAmount > MAX_AMOUNT) {
      return res.status(400).json({ success: false, message: `Choose an amount between ₹${MIN_AMOUNT.toLocaleString()} and ₹${MAX_AMOUNT.toLocaleString()}.` });
    }
    const credits = 1000; // Fixed 1000 credits for ₹7,500 starter pack

    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if already migrated
    if (user.subscription?.plan === 'pro' && user.subscription?.status === 'active') {
      return res.status(400).json({ 
        success: false, 
        message: 'You already have an active subscription' 
      });
    }

    const options = {
      amount: numAmount * 100,
      currency: PLAN_CURRENCY,
      receipt: `neb_${userId.toString().slice(-8)}_${Date.now().toString(36)}`,
      notes: {
        userId: userId.toString(),
        email: user.email,
        credits: credits.toString()
      }
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency
      },
      key: process.env.RAZORPAY_KEY_ID,
      description: `Nebulaa Gravity — ${credits} credits`,
      prefill: {
        name: `${user.firstName} ${user.lastName || ''}`.trim(),
        email: user.email,
        contact: ''
      }
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: 'Failed to create payment order' });
  }
});

/**
 * POST /api/payment/verify
 * Verify Razorpay payment signature, then migrate user data demo → prod
 */
router.post('/verify', protect, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed — invalid signature' });
    }

    console.log(`✅ Payment verified: ${razorpay_payment_id}`);

    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Store payment in history array
    const paidAmount = (await razorpay.orders.fetch(razorpay_order_id))?.amount;
    const paidCredits = 1000; // Fixed 1000 credits per payment
    user.payments.push({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: paidAmount ? paidAmount / 100 : 0,
      currency: PLAN_CURRENCY,
      credits: paidCredits,
      status: 'paid',
      paidAt: new Date()
    });
    await user.save();

    // Create invoice in Zoho Books (non-blocking)
    try {
      const invoiceResult = await createInvoice({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName || '',
        companyName: user.companyName || user.businessProfile?.name || '',
        amount: paidAmount ? paidAmount / 100 : 0,
        credits: paidCredits,
        razorpayPaymentId: razorpay_payment_id
      });

      // Store Zoho invoice URL on the payment record
      const lastPayment = user.payments[user.payments.length - 1];
      if (lastPayment && invoiceResult.invoiceUrl) {
        lastPayment.invoiceUrl = invoiceResult.invoiceUrl;
        await user.save();
      }

      console.log(`📄 Zoho Books invoice created: ${invoiceResult.invoiceNumber}`);
    } catch (zohoErr) {
      console.warn('Zoho Books invoice creation failed (non-blocking):', zohoErr.message);
    }

    // Run migration: demo → prod
    console.log(`🚀 Starting migration for user: ${userId} with ${paidCredits} credits`);
    const migrationResult = await migrateUserData(userId.toString(), paidCredits);

    if (!migrationResult.success) {
      return res.status(500).json({ 
        success: false, 
        message: `Payment successful but migration failed: ${migrationResult.error}. Contact support.`,
        paymentId: razorpay_payment_id
      });
    }

    // Send welcome email with prod login details
    try {
      await sendWelcomeEmail(user.email, user.firstName);
    } catch (emailErr) {
      console.warn('Welcome email failed (non-blocking):', emailErr.message);
    }

    // Mark demo user as migrated
    user.trial = { ...user.trial?.toObject?.() || {}, isExpired: true, migratedToProd: true };
    await user.save();

    res.json({
      success: true,
      message: 'Payment verified and account migrated to production!',
      migration: migrationResult.summary,
      prodUrl: 'https://gravity.nebulaa.ai',
      email: user.email
    });

  } catch (error) {
    console.error('Payment verify error:', error);
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
          const rpPayment = await razorpay.payments.fetch(payment.razorpayPaymentId);
          if (rpPayment.invoice_id) {
            const invoice = await razorpay.invoices.fetch(rpPayment.invoice_id);
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

        const invoiceResult = await createInvoice({
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName || '',
          companyName: user.companyName || user.businessProfile?.name || '',
          amount: payment.amount,
          credits: payment.credits,
          razorpayPaymentId: payment.razorpayPaymentId
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

/**
 * Send welcome email to user after successful migration
 */
async function sendWelcomeEmail(email, firstName) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai',
    to: email,
    subject: '🚀 Welcome to Nebulaa Gravity — Your Production Account is Ready!',
    html: `
      <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #070A12; color: #ededed; padding: 40px; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #ffcc29; font-size: 28px; margin: 0;">Nebulaa Gravity</h1>
          <p style="color: #ededed99; font-size: 14px; margin-top: 8px;">Your AI Marketing Command Center</p>
        </div>
        
        <h2 style="color: #ededed; font-size: 22px;">Hey ${firstName || 'there'} 👋</h2>
        
        <p style="color: #edededd0; line-height: 1.7; font-size: 15px;">
          Your payment has been received and your <strong style="color: #ffcc29;">production account</strong> is now live! 
          All your data from the demo — campaigns, competitors, brand assets, analytics — has been migrated.
        </p>
        
        <div style="background: #0d1117; border: 1px solid #ffcc2930; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <p style="color: #ffcc29; font-weight: 600; margin: 0 0 12px 0; font-size: 14px;">YOUR PRODUCTION LOGIN</p>
          <p style="color: #ededed; margin: 4px 0;"><strong>URL:</strong> <a href="https://gravity.nebulaa.ai" style="color: #ffcc29;">gravity.nebulaa.ai</a></p>
          <p style="color: #ededed; margin: 4px 0;"><strong>Email:</strong> ${email}</p>
          <p style="color: #ededed99; margin: 8px 0 0 0; font-size: 13px;">Use the same password you set during signup.</p>
        </div>
        
        <div style="background: #0d1117; border-radius: 12px; padding: 24px; margin: 24px 0;">
          <p style="color: #ffcc29; font-weight: 600; margin: 0 0 12px 0; font-size: 14px;">WHAT'S INCLUDED</p>
          <ul style="color: #ededed; padding-left: 20px; line-height: 2;">
            <li>1,000 monthly credits (auto-resets)</li>
            <li>+10 daily login bonus credits</li>
            <li>All AI features: campaigns, competitor analysis, content generation</li>
            <li>Multi-platform social media posting</li>
            <li>Priority support</li>
          </ul>
        </div>
        
        <a href="https://gravity.nebulaa.ai" style="display: block; background: #ffcc29; color: #070A12; text-align: center; padding: 16px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 32px 0;">
          Go to Gravity →
        </a>
        
        <p style="color: #ededed60; font-size: 12px; text-align: center; margin-top: 32px;">
          Questions? Reply to this email or reach out at support@nebulaa.ai
        </p>
      </div>
    `
  });

  console.log(`📧 Welcome email sent to ${email}`);
}

module.exports = router;
