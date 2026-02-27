/**
 * Credits Route (Production)
 * Endpoints for checking balance, cycle info, cost table, and history
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { ensureCreditCycle, MONTHLY_ALLOWANCE, DAILY_LOGIN_BONUS } = require('../middleware/creditGuard');
const User = require('../models/User');

// Credit cost table
const CREDIT_COSTS = {
  image_generated: 5,
  image_edit: 3,
  campaign_text: 2,
  chat_message: 0.5,
  competitor_scrape: 0
};

/**
 * GET /api/credits
 * Get current credit balance, cycle info, costs, and recent history
 */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Ensure cycle is fresh and login bonus applied
    await ensureCreditCycle(user);

    const now = new Date();
    const cycleEnd = new Date(user.credits.cycleEnd);
    const daysLeft = Math.max(0, Math.ceil((cycleEnd - now) / (1000 * 60 * 60 * 24)));

    res.json({
      success: true,
      credits: {
        balance: user.credits.balance,
        monthlyAllowance: user.credits.monthlyAllowance,
        totalUsed: user.credits.totalUsed,
        cycleStart: user.credits.cycleStart,
        cycleEnd: user.credits.cycleEnd,
        daysLeft,
        lastLoginBonus: user.credits.lastLoginBonus
      },
      costs: CREDIT_COSTS,
      history: (user.credits.history || []).slice(-20).reverse()
    });
  } catch (error) {
    console.error('Credits fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch credits' });
  }
});

/**
 * POST /api/credits/login-bonus
 * Explicitly claim daily login bonus (also auto-applied on any credit check)
 */
router.post('/login-bonus', protect, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id || req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const balanceBefore = user.credits?.balance || 0;
    await ensureCreditCycle(user);
    const balanceAfter = user.credits.balance;
    const bonusGranted = balanceAfter - balanceBefore;

    res.json({
      success: true,
      bonusGranted: bonusGranted > 0 ? bonusGranted : 0,
      message: bonusGranted > 0
        ? `+${bonusGranted} daily login bonus credited!`
        : 'Login bonus already claimed today',
      creditsRemaining: balanceAfter
    });
  } catch (error) {
    console.error('Login bonus error:', error);
    res.status(500).json({ success: false, message: 'Failed to process login bonus' });
  }
});

module.exports = router;
