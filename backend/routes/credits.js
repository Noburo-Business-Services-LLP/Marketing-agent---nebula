const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const { CREDIT_COSTS } = require('../middleware/trialGuard');
const { ensureCreditCycle } = require('../middleware/creditGuard');

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

    const now = new Date();
    const trialEnd = user.trial?.expiresAt ? new Date(user.trial.expiresAt) : null;
    const daysLeft = trialEnd ? Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))) : 0;
    const isTrialExpired = trialEnd ? now > trialEnd : false;

    res.json({
      success: true,
      credits: {
        balance: user.credits?.balance ?? 100,
        totalUsed: user.credits?.totalUsed ?? 0,
        history: (user.credits?.history || []).slice(-20) // Last 20 entries
      },
      trial: {
        startDate: user.trial?.startDate || user.createdAt,
        expiresAt: trialEnd,
        daysLeft,
        isExpired: isTrialExpired || (user.trial?.isExpired ?? false)
      },
      costs: CREDIT_COSTS
    });
  } catch (error) {
    console.error('Get credits error:', error);
    res.status(500).json({ success: false, message: 'Failed to get credit info' });
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

    res.json({
      success: true,
      history: user.credits?.history || [],
      balance: user.credits?.balance ?? 100,
      totalUsed: user.credits?.totalUsed ?? 0
    });
  } catch (error) {
    console.error('Get credit history error:', error);
    res.status(500).json({ success: false, message: 'Failed to get credit history' });
  }
});

module.exports = router;
