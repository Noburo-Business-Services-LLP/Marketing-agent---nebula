const { priceText, balanceText } = require('../config/quarkWording');
const User = require('../models/User');
const quarkBuckets = require('../services/quarkBuckets');
const agencyRules = require('../services/agency');

/**
 * Credit costs per action (demo version)
 */
// The Quark price of each action, DERIVED from what the action actually costs
// us in API spend (see config/apiCosts.js) rather than picked by feel. Every
// price here is per UNIT — per image, per carousel SLIDE, per video SCENE —
// because that is what the vendor bills us per. Change a vendor rate in
// apiCosts.js and these move with it; do not hardcode numbers back into here.
const { QUARK_COSTS: CREDIT_COSTS, ACTION_UNITS } = require('../config/apiCosts');

const NO_QUARKS_MESSAGE = 'You do not have enough Quarks for this. Please upgrade your plan, or buy an add-on pack or Quarks.';

/**
 * Middleware: stop the request when the Quarks are used up.
 * There is no time limit: an account keeps working until its Quarks reach zero.
 */
const checkTrial = async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    if (!userId) return next(); // Let auth middleware handle missing user

    // Quarks that have run out of time are taken off first, so the balance checked below is the real one.
    await quarkBuckets.settleWallet(userId).catch(() => null);
    const user = await User.findById(userId);
    if (!user) return next();

    // A client workspace spends from its agency's shared pool, so that is the balance to check.
    const balance = agencyRules.isWorkspace(user) ? await agencyRules.walletBalance(userId) : (user.credits?.balance ?? 0);

    // Check if credits are exhausted
    if (balance <= 0) {
      return res.status(403).json({
        success: false,
        creditsExhausted: true,
        upgradeRequired: true,
        reason: 'quarks',
        message: NO_QUARKS_MESSAGE,
        creditsRemaining: 0
      });
    }

    req.trialInfo = {
      creditsRemaining: balance
    };

    next();
  } catch (error) {
    console.error('Trial guard error:', error);
    next(); // Don't block on errors — let the request through
  }
};

/**
 * Deduct credits from user account
 * @param {string} userId - User ID
 * @param {string} action - Action type (from CREDIT_COSTS)
 * @param {number} count - Number of units (e.g., number of images)
 * @param {string} description - Human-readable description
 * @returns {{ success: boolean, creditsRemaining: number, creditsDeducted: number, error?: string }}
 */
const deductCredits = async (userId, action, count = 1, description = '', opts = {}) => {
  try {
    const cost = CREDIT_COSTS[action];
    if (cost === undefined) {
      console.warn(`Unknown credit action: ${action}`);
      return { success: true, creditsRemaining: -1, creditsDeducted: 0 };
    }

    // Free actions (like competitor scrape)
    if (cost === 0) {
      return { success: true, creditsRemaining: -1, creditsDeducted: 0 };
    }

    const totalCost = cost * count;

    // Anything past its date is taken off first, then one atomic step checks the balance and subtracts from the
    // buckets together, so many requests at the same moment cannot all pass the check and overdraw the account.
    await quarkBuckets.settleWallet(userId).catch(() => null);
    const spent = await quarkBuckets.spend(userId, totalCost, { action, description: description || `${action} x${count}`, units: count, ...(opts && opts.ref ? { ref: String(opts.ref) } : {}) });
    const result = spent.success ? spent.user : null;

    if (!result) {
      const user = await User.findById(userId).select('credits.balance agency.ownerId');
      if (!user) {
        return { success: false, creditsRemaining: 0, creditsDeducted: 0, error: 'User not found' };
      }
      // For a client this is the agency's pool (0 when the agency cannot pay), never the client's own record.
      const currentBalance = agencyRules.isWorkspace(user) ? await agencyRules.walletBalance(userId) : (user.credits?.balance ?? 0);
      return {
        success: false,
        creditsRemaining: currentBalance,
        creditsDeducted: 0,
        error: `Insufficient Quarks. Need ${priceText(totalCost)}, have ${balanceText(currentBalance)}. Please upgrade your plan, or buy an add-on pack or Quarks.`
      };
    }

    return {
      success: true,
      creditsRemaining: result.credits.balance,
      creditsDeducted: totalCost,
      // Who paid, so a job can refund the same wallet later even if the client or plan has changed.
      payerId: spent.payerId,
      workspaceId: spent.workspaceId
    };
  } catch (error) {
    console.error('Credit deduction error:', error);
    return { success: false, creditsRemaining: 0, creditsDeducted: 0, error: error.message };
  }
};

/**
 * Middleware factory: Check credits before expensive operations
 * Use: router.post('/route', protect, checkTrial, requireCredits('image_generated', 1), handler)
 * @param {string} action - Action type
 * @param {number|function} countOrFn - Fixed count or function(req) that returns count
 */
const requireCredits = (action, countOrFn = 1) => {
  return async (req, res, next) => {
    try {
      const cost = CREDIT_COSTS[action];
      if (cost === 0 || cost === undefined) return next(); // Free or unknown actions pass through

      const userId = req.user?.userId || req.user?.id || req.user?._id;
      if (!userId) return next();

      const count = typeof countOrFn === 'function' ? countOrFn(req) : countOrFn;
      const totalCost = cost * count;

      // The daily spend ceiling and the provider switches: refuse new work before anything is generated.
      const gate = await require('../services/spendGuard').check(action);
      if (!gate.ok) return res.status(503).json({ success: false, serviceBusy: true, message: gate.message });

      await quarkBuckets.settleWallet(userId).catch(() => null);
      const user = await User.findById(userId);
      const currentBalance = agencyRules.isWorkspace(user) ? await agencyRules.walletBalance(userId) : (user?.credits?.balance ?? 0);

      if (currentBalance < totalCost) {
        return res.status(403).json({
          success: false,
          creditsExhausted: true,
          upgradeRequired: true,
          reason: 'quarks',
          message: `This needs ${priceText(totalCost)} but you have ${balanceText(currentBalance)}. Please upgrade your plan, or buy an add-on pack or Quarks.`,
          creditsRequired: totalCost,
          creditsRemaining: currentBalance
        });
      }

      // Store for post-action deduction
      req.creditAction = { action, count, totalCost };
      next();
    } catch (error) {
      console.error('requireCredits error:', error);
      next();
    }
  };
};

/**
 * Refund credits to user account
 * @param {string} userId - User ID
 * @param {string} action - Action type that failed (from CREDIT_COSTS)
 * @param {number} count - Number of units to refund
 * @param {string} description - Human-readable description
 * @param {{ payerId?: string, ref?: string }} opts - payerId: the wallet that was charged. ref: the same ref the charge
 *   carried; it is written into the history entry (like quarkBuckets.refundTo) so chargeProof(ref) can see this refund.
 * @returns {{ success: boolean, creditsRemaining: number, creditsRefunded: number, error?: string }}
 */
const refundCredits = async (userId, action, count = 1, description = '', opts = {}) => {
  try {
    const cost = CREDIT_COSTS[action];
    if (cost === undefined || cost === 0) {
      return { success: true, creditsRemaining: -1, creditsRefunded: 0 };
    }

    const totalRefund = cost * count;

    // The refund goes to the wallet that was charged: `opts.payerId` when the charge recorded it, else whoever pays
    // for this user now (the agency for a client workspace). It never lands on a client record.
    let payerId = null;
    let workspaceId = null;
    if (opts && opts.payerId) {
      payerId = String(opts.payerId);
      workspaceId = payerId !== String(userId) ? String(userId) : null;
    } else {
      ({ payerId, workspaceId } = await agencyRules.resolvePayer(userId));
    }
    if (!payerId) {
      return { success: false, creditsRemaining: 0, creditsRefunded: 0, error: 'User not found' };
    }
    const target = workspaceId ? payerId : userId;

    const user = await User.findById(target);
    if (!user) {
      return { success: false, creditsRemaining: 0, creditsRefunded: 0, error: 'User not found' };
    }

    // A refund goes back where Quarks that expire come from: the monthly bucket while that month is still running.
    const planLive = user.credits?.planExpiresAt && new Date(user.credits.planExpiresAt) > new Date();
    const result = await User.findByIdAndUpdate(
      target,
      {
        $inc: {
          'credits.balance': totalRefund,
          'credits.totalUsed': -totalRefund,
          ...(planLive ? { 'credits.planBalance': totalRefund } : {})
        },
        $push: {
          'credits.history': {
            $each: [{
              action: `${action}_refund`,
              amount: totalRefund,
              description: description || `Refund: ${action} x${count}`,
              createdAt: new Date(),
              ...(opts && opts.ref ? { ref: String(opts.ref) } : {})
            }],
            $slice: -100 // Keep only last 100 entries
          }
        }
      },
      { new: true }
    );
    if (!result) {
      return { success: false, creditsRemaining: 0, creditsRefunded: 0, error: 'User not found' };
    }

    // Other accounts have no ledger row for a refund today and keep it that way; a client refund leaves one so
    // the agency's per-client report nets out correctly.
    if (workspaceId) {
      quarkBuckets.record({ user: target, workspace: workspaceId, type: 'refund', quarks: totalRefund, balanceAfter: result.credits.balance, action: `${action}_refund`, ...(opts && opts.ref ? { ref: String(opts.ref) } : {}) });
    }

    return {
      success: true,
      creditsRemaining: result.credits.balance,
      creditsRefunded: totalRefund
    };
  } catch (error) {
    console.error('Credit refund error:', error);
    return { success: false, creditsRemaining: 0, creditsRefunded: 0, error: error.message };
  }
};

module.exports = { checkTrial, deductCredits, requireCredits, refundCredits, CREDIT_COSTS, ACTION_UNITS };
