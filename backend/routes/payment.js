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

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const PLAN_AMOUNT = 1000000; // ₹10,000 in paise
const PLAN_CURRENCY = 'INR';

/**
 * POST /api/payment/create-order
 * Creates a Razorpay order for subscription
 */
router.post('/create-order', protect, async (req, res) => {
  try {
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
      amount: PLAN_AMOUNT,
      currency: PLAN_CURRENCY,
      receipt: `neb_${userId.toString().slice(-8)}_${Date.now().toString(36)}`,
      notes: {
        userId: userId.toString(),
        email: user.email,
        plan: 'pro_monthly'
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

    // Store payment info on demo user before migration
    user.payment = {
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: PLAN_AMOUNT / 100,
      currency: PLAN_CURRENCY,
      status: 'paid',
      paidAt: new Date()
    };
    await user.save();

    // Run migration: demo → prod
    console.log(`🚀 Starting migration for user: ${userId}`);
    const migrationResult = await migrateUserData(userId.toString());

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

    res.json({
      success: true,
      payment: {
        paid: user.payment?.status === 'paid',
        paymentId: user.payment?.razorpayPaymentId || null,
        paidAt: user.payment?.paidAt || null,
        amount: user.payment?.amount || null
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
