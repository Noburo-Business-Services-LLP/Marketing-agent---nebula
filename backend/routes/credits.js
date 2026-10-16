const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { CREDIT_COSTS, ACTION_UNITS } = require('../middleware/trialGuard');
const { ensureCreditCycle } = require('../middleware/creditGuard');
const quarkBuckets = require('../services/quarkBuckets');
const agencyRules = require('../services/agency');

// Whose Quarks this person sees: their own, or the agency's shared pool for a client workspace
// (an empty pool when the agency cannot pay, so a client never sees its own record's numbers).
async function holderOf(user) {
  if (!agencyRules.isWorkspace(user)) return user;
  const owner = await User.findById(agencyRules.idOf(user.agency.ownerId));
  return owner && agencyRules.canPayForClients(owner) ? owner : null;
}

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
    const holder = await holderOf(user);
    const fresh = (settled.changed && holder) ? await User.findById(holder._id) : (holder || {});
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
      units: ACTION_UNITS
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

    // A client sees the agency's shared pool and its history.
    const holder = (await holderOf(user)) || {};
    res.json({
      success: true,
      history: holder.credits?.history || [],
      balance: holder.credits?.balance ?? 0,
      totalUsed: holder.credits?.totalUsed ?? 0
    });
  } catch (error) {
    console.error('Get credit history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get Quark history' });
  }
});

module.exports = router;
