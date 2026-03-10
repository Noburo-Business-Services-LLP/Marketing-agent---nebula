/**
 * Credit Guard Middleware (Demo)
 * 7-day trial with 100 credits — no auto-reset, no daily bonus.
 * Whichever runs out first (credits or 7 days) ends the trial.
 * 
 * Credit Costs:
 *   Image generated  → 5
 *   Image edit        → 3
 *   Campaign text     → 2
 *   Chat message      → 0.5
 *   Competitor scrape → 0 (free)
 */

const User = require('../models/User');

const TRIAL_CREDITS = 100;
const TRIAL_DAYS = 7;

/**
 * Initialize credits + trial if not set yet.
 * No auto-reset — once trial expires or credits run out, user must upgrade.
 */
async function ensureCreditCycle(user) {
  const now = new Date();
  let changed = false;

  // Initialize credits if missing OR migrate from old monthly-cycle style
  if (!user.credits || user.credits.balance === undefined || user.credits.monthlyAllowance) {
    user.credits = {
      balance: TRIAL_CREDITS,
      totalUsed: 0,
      history: [{
        action: 'trial_init',
        cost: 0,
        balanceAfter: TRIAL_CREDITS,
        timestamp: now
      }]
    };
    changed = true;
  }

  // Initialize trial if missing
  if (!user.trial || !user.trial.expiresAt) {
    const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    user.trial = {
      startDate: now,
      expiresAt: trialEnd,
      isExpired: false
    };
    changed = true;
  }

  if (changed) {
    await user.save();
  }

  return user;
}

/**
 * Check if user has enough credits. Returns { ok, balance } or sends 403.
 */
function checkCredits(requiredCredits) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId || req.user?.id || req.user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Ensure cycle is current and apply login bonus
      await ensureCreditCycle(user);

      if (user.credits.balance < requiredCredits) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient credits',
          creditsRemaining: user.credits.balance,
          required: requiredCredits,
          cycleEnd: user.credits.cycleEnd
        });
      }

      // Attach user and credits info to request
      req.creditUser = user;
      req.creditsAvailable = user.credits.balance;
      next();
    } catch (error) {
      console.error('Credit check error:', error);
      res.status(500).json({ success: false, message: 'Credit check failed' });
    }
  };
}

/**
 * Deduct credits from a user. Call after successful AI generation.
 * Supports two calling conventions:
 *   deductCredits(userId, amount, action)
 *   deductCredits(userId, action, amount, description)
 */
async function deductCredits(userId, amountOrAction, actionOrAmount, description) {
  let amount, action;
  if (typeof amountOrAction === 'string') {
    // Called as deductCredits(userId, 'campaign_text', 1, 'description')
    action = description || amountOrAction;
    amount = Number(actionOrAmount) || 1;
  } else {
    // Called as deductCredits(userId, 7, 'action')
    amount = Number(amountOrAction) || 1;
    action = actionOrAmount || 'unknown';
  }

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  // Ensure cycle is current
  await ensureCreditCycle(user);

  user.credits.balance = Math.max(0, Number(user.credits.balance) - amount);
  user.credits.totalUsed = Number(user.credits.totalUsed || 0) + amount;
  
  // Trim history to last 50 entries before pushing
  user.credits.history = (user.credits.history || []).slice(-50);
  user.credits.history.push({
    action,
    cost: amount,
    balanceAfter: user.credits.balance,
    timestamp: new Date()
  });

  await user.save();

  return {
    success: true,
    balance: user.credits.balance,
    creditsRemaining: user.credits.balance,
    creditsDeducted: amount,
    totalUsed: user.credits.totalUsed
  };
}

/**
 * Pre-check that enough credits exist for batch operations.
 * Does NOT deduct — just validates.
 */
async function requireCredits(userId, amount) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  await ensureCreditCycle(user);
  
  if (user.credits.balance < amount) {
    const err = new Error('Insufficient credits');
    err.creditsRemaining = user.credits.balance;
    err.required = amount;
    throw err;
  }
  return user.credits.balance;
}

module.exports = {
  ensureCreditCycle,
  checkCredits,
  deductCredits,
  requireCredits,
  TRIAL_CREDITS,
  TRIAL_DAYS
};
