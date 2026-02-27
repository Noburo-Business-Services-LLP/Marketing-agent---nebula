/**
 * Credit Guard Middleware (Production)
 * Monthly credit cycle with auto-reset and daily login bonus
 * 
 * Credit Costs:
 *   Image generated  → 5
 *   Image edit        → 3
 *   Campaign text     → 2
 *   Chat message      → 0.5
 *   Competitor scrape → 0 (free)
 */

const User = require('../models/User');

const MONTHLY_ALLOWANCE = 1000;
const DAILY_LOGIN_BONUS = 10;

/**
 * Auto-reset credits if current cycle has ended.
 * Also grants daily login bonus (+10) once per calendar day.
 */
async function ensureCreditCycle(user) {
  const now = new Date();
  let changed = false;

  // Initialize credits if missing (existing users)
  if (!user.credits || user.credits.balance === undefined) {
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    user.credits = {
      balance: MONTHLY_ALLOWANCE,
      monthlyAllowance: MONTHLY_ALLOWANCE,
      cycleStart,
      cycleEnd,
      totalUsed: 0,
      lastLoginBonus: null,
      history: [{
        action: 'cycle_init',
        cost: 0,
        balanceAfter: MONTHLY_ALLOWANCE,
        timestamp: now
      }]
    };
    changed = true;
  }

  // Auto-reset if cycle expired
  if (now >= user.credits.cycleEnd) {
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    user.credits.balance = MONTHLY_ALLOWANCE;
    user.credits.monthlyAllowance = MONTHLY_ALLOWANCE;
    user.credits.cycleStart = cycleStart;
    user.credits.cycleEnd = cycleEnd;
    user.credits.totalUsed = 0;
    user.credits.lastLoginBonus = null;
    // Keep only last 50 history items, then add reset entry
    user.credits.history = (user.credits.history || []).slice(-50);
    user.credits.history.push({
      action: 'cycle_reset',
      cost: 0,
      balanceAfter: MONTHLY_ALLOWANCE,
      timestamp: now
    });
    changed = true;
  }

  // Daily login bonus: if lastLoginBonus is not today, grant +10
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastBonus = user.credits.lastLoginBonus ? new Date(user.credits.lastLoginBonus) : null;
  const lastBonusDay = lastBonus ? new Date(lastBonus.getFullYear(), lastBonus.getMonth(), lastBonus.getDate()) : null;

  if (!lastBonusDay || lastBonusDay.getTime() < today.getTime()) {
    user.credits.balance += DAILY_LOGIN_BONUS;
    user.credits.lastLoginBonus = now;
    user.credits.history = (user.credits.history || []).slice(-50);
    user.credits.history.push({
      action: 'daily_login_bonus',
      cost: -DAILY_LOGIN_BONUS,
      balanceAfter: user.credits.balance,
      timestamp: now
    });
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
 * @param {string} userId
 * @param {number} amount - credits to deduct
 * @param {string} action - description of the action
 * @returns {{ balance, totalUsed }} updated values
 */
async function deductCredits(userId, amount, action) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  // Ensure cycle is current
  await ensureCreditCycle(user);

  user.credits.balance = Math.max(0, user.credits.balance - amount);
  user.credits.totalUsed += amount;
  
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
    balance: user.credits.balance,
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
  MONTHLY_ALLOWANCE,
  DAILY_LOGIN_BONUS
};
