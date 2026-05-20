const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Customer = require('../models/Customer');
const { PLANS, findPlan } = require('../config/plans');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

router.get('/plans', (_req, res) => {
  res.json({ success: true, plans: PLANS });
});

router.post('/create-subscription', async (req, res) => {
  try {
    const { name, email, mobileNumber, shopName, planId } = req.body;

    if (!name || !email || !mobileNumber || !shopName || !planId) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, mobile number, shop name and plan are all required.',
      });
    }

    const plan = findPlan(planId);
    if (!plan) {
      return res.status(400).json({ success: false, message: 'Invalid plan selected.' });
    }

    const totalCount = plan.cycle === 'monthly' ? 120 : plan.cycle === 'quarterly' ? 40 : 10;

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: totalCount,
      notes: { name, email, mobileNumber, shopName, tier: plan.tier, cycle: plan.cycle },
    });

    const customer = await Customer.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      mobileNumber: mobileNumber.trim(),
      shopName: shopName.trim(),
      selectedPlan: {
        tier: plan.tier,
        cycle: plan.cycle,
        planId,
        amount: plan.amount,
      },
      razorpaySubscriptionId: subscription.id,
      paymentStatus: 'pending',
    });

    res.json({
      success: true,
      subscription_id: subscription.id,
      key: process.env.RAZORPAY_KEY_ID,
      amount: plan.amount,
      customer_id: customer._id,
      prefill: { name, email, contact: mobileNumber },
    });
  } catch (err) {
    console.error('Create subscription error:', err);
    res.status(500).json({ success: false, message: 'Failed to create subscription.' });
  }
});

router.post('/verify-subscription', async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details.' });
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid signature.' });
    }

    const customer = await Customer.findOneAndUpdate(
      { razorpaySubscriptionId: razorpay_subscription_id },
      { paymentStatus: 'paid', razorpayPaymentId: razorpay_payment_id, paidAt: new Date() },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Payment verified.',
      customer: customer
        ? { name: customer.name, email: customer.email, plan: customer.selectedPlan }
        : null,
    });
  } catch (err) {
    console.error('Verify subscription error:', err);
    res.status(500).json({ success: false, message: 'Verification failed.' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
      if (expected !== signature) {
        return res.status(400).json({ success: false, message: 'Invalid signature.' });
      }
    }

    const event = JSON.parse(req.body.toString());
    const sub = event.payload?.subscription?.entity;
    if (!sub?.id) return res.json({ success: true });

    if (event.event === 'subscription.charged') {
      await Customer.findOneAndUpdate(
        { razorpaySubscriptionId: sub.id },
        { paymentStatus: 'paid', paidAt: new Date() }
      );
    } else if (event.event === 'subscription.halted') {
      await Customer.findOneAndUpdate(
        { razorpaySubscriptionId: sub.id },
        { paymentStatus: 'failed' }
      );
    } else if (event.event === 'subscription.cancelled') {
      await Customer.findOneAndUpdate(
        { razorpaySubscriptionId: sub.id },
        { paymentStatus: 'cancelled' }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
