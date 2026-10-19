const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { CREDIT_COSTS, ACTION_UNITS } = require('../middleware/trialGuard');
const { ensureCreditCycle } = require('../middleware/creditGuard');
const quarkBuckets = require('../services/quarkBuckets');
const agencyRules = require('../services/agency');
const { pricingExtras } = require('../services/costList');

// Inside a client, only the shared pool's balance is shown: never the agency's history, buckets or other clients' spend.
// A frozen client (over the agency's limit) is refused outright.
const FROZEN_MESSAGE = 'This client is paused because the agency is over its client limit.';

/**
 * GET /api/credits
 * Get current credit balance and trial status
 */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Initialize credits + trial if not set yet
    await ensureCreditCycle(user);
    // Take off anything that has run out of time, then read the account again.
    const settled = await quarkBuckets.settleWallet(userId).catch(() => ({ changed: false }));
    if (agencyRules.isWorkspace(user)) {
      if (user.agency.frozen) return res.status(403).json({ success: false, message: FROZEN_MESSAGE });
      const pool = await agencyRules.publicCredits(user);
      return res.json({
        success: true,
        credits: {
          balance: pool.balance, totalUsed: pool.totalUsed, history: [],
          parts: { plan: 0, planExpiresAt: null, topup: 0, topupExpiresAt: null, held: 0, kept: pool.balance }
        },
        trial: { startDate: user.trial?.startDate || user.createdAt, isExpired: false },
        costs: CREDIT_COSTS,
        units: ACTION_UNITS,
        pricing: pricingExtras()
      });
    }
    const fresh = settled.changed ? await User.findById(user._id) : user;
    const parts = quarkBuckets.summarise(fresh);

    res.json({
      success: true,
      credits: {
        balance: fresh.credits?.balance ?? 0,
        totalUsed: fresh.credits?.totalUsed ?? 0,
        history: (fresh.credits?.history || []).slice(-20), // Last 20 entries
        // What the balance is made of, and when each part ends. Kept Quarks never expire.
        parts: {
          plan: parts.plan, planExpiresAt: parts.planExpiresAt,
          topup: parts.topup, topupExpiresAt: parts.topupExpiresAt,
          held: parts.held, kept: parts.kept
        }
      },
      trial: {
        startDate: user.trial?.startDate || user.createdAt,
        // No expiry date or day count is shown any more.
        isExpired: false
      },
      costs: CREDIT_COSTS,
      // Prices are per unit, and the unit differs per action (per slide,
      // per scene, per post). Shipping the units alongside the numbers is
      // what stops the UI rendering "Carousel 4.5" as if that were the
      // price of a whole carousel.
      units: ACTION_UNITS,
      // Video part length and packs for the price list in Settings > Billing (no prices: see services/costList.js).
      pricing: pricingExtras()
    });
  } catch (error) {
    console.error('Get credits error:', error);
    res.status(500).json({ success: false, message: 'Failed to get Quark info' });
  }
});

/**
 * GET /api/credits/history
 * Get full credit usage history
 */
router.get('/history', protect, async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // A client sees the shared pool's balance only, with no history.
    if (agencyRules.isWorkspace(user)) {
      if (user.agency.frozen) return res.status(403).json({ success: false, message: FROZEN_MESSAGE });
      const pool = await agencyRules.publicCredits(user);
      return res.json({ success: true, history: [], balance: pool.balance, totalUsed: pool.totalUsed });
    }
    res.json({
      success: true,
      history: user.credits?.history || [],
      balance: user.credits?.balance ?? 0,
      totalUsed: user.credits?.totalUsed ?? 0
    });
  } catch (error) {
    console.error('Get credit history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get Quark history' });
  }
});

module.exports = router;
