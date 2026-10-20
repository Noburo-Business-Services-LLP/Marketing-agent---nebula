/**
 * Credit Guard Middleware
 * New accounts get 100 Quarks once (stored as credits.balance). There is no time
 * limit, no auto-reset and no daily bonus: the balance simply runs down to zero.
 * 
 * Credit Costs:
 *   Image generated  → 5
 *   Image edit        → 3
 *   Campaign text     → 2
 *   Chat message      → 0.5
 *   Competitor scrape → 0 (free)
 */

const quarkBuckets = require('../services/quarkBuckets');
const logger = require('../utils/logger');
const agencyRules = require('../services/agency');
const User = require('../models/User');

// There is no free grant: a new account starts at zero and gets Quarks with a plan or a top-up.
const TRIAL_CREDITS = 0;
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

  // Record the start date only. There is no expiry date any more; the
  // `trial.expiresAt` field stays in the schema for older accounts.
  if (!user.trial || !user.trial.startDate) {
    user.trial = {
      startDate: now,
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

      // A client workspace spends from its agency's shared pool.
      const balance = agencyRules.isWorkspace(user) ? await agencyRules.walletBalance(userId) : user.credits.balance;

      if (balance < requiredCredits) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient Quarks',
          creditsRemaining: balance,
          required: requiredCredits,
          cycleEnd: user.credits.cycleEnd
        });
      }

      // Attach user and credits info to request
      req.creditUser = user;
      req.creditsAvailable = balance;
      next();
    } catch (error) {
      logger.error('Credit check error:', error);
      res.status(500).json({ success: false, message: 'Quark check failed' });
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

  // Ensure cycle is current, and take off anything that has run out of time
  await ensureCreditCycle(user);
  await quarkBuckets.settleWallet(userId).catch(() => null);

  // Callers have already checked the balance, so this takes what is there up to the amount (never below zero),
  // in one atomic step per try. Two jobs finishing together cannot lose each other's deduction.
  let spent = null;
  for (let attempt = 0; attempt < 3 && !spent; attempt += 1) {
    // For a client this is the agency's pool, and 0 when the agency cannot pay.
    const available = agencyRules.isWorkspace(user)
      ? await agencyRules.walletBalance(userId)
      : Math.max(0, Number((await User.findById(userId).select('credits.balance').lean())?.credits?.balance) || 0);
    const take = Math.min(amount, available);
    if (take <= 0) break;
    const r = await quarkBuckets.spend(userId, take, { action });
    if (r.success) spent = r;
  }
  const after = spent ? spent.user : await User.findById(agencyRules.isWorkspace(user) ? agencyRules.idOf(user.agency.ownerId) : userId);
  return {
    success: true,
    balance: after?.credits?.balance ?? 0,
    creditsRemaining: after?.credits?.balance ?? 0, // a client whose agency is gone has no pool: 0
    creditsDeducted: spent ? spent.spent : 0,
    totalUsed: after?.credits?.totalUsed ?? 0
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

  // A client workspace spends from its agency's shared pool.
  const balance = agencyRules.isWorkspace(user) ? await agencyRules.walletBalance(userId) : user.credits.balance;
  if (balance < amount) {
    const err = new Error('Insufficient Quarks');
    err.creditsRemaining = balance;
    err.required = amount;
    throw err;
  }
  return balance;
}

module.exports = {
  ensureCreditCycle,
  checkCredits,
  deductCredits,
  requireCredits,
  TRIAL_CREDITS,
  TRIAL_DAYS
};
