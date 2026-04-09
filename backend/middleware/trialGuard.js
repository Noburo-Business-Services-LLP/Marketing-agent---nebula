const User = require('../models/User');

/**
 * Credit costs per action (demo version)
 */
const CREDIT_COSTS = {
  image_generated: 5,    // Per image generated via AI
  image_edit: 3,         // Edit/regenerate an image
  campaign_text: 2,      // Campaign text/caption generation
  campaign_full: 7,      // Full campaign (image + text)
  chat_message: 0.5,     // Chatbot message
  competitor_scrape: 0,  // FREE
  rival_post: 7,         // Create rival post (image + text)
  strategic_post: 7,     // Strategic advisor post (image + text)
  event_post: 7,         // Event post (image + text)
  refine_image: 3,       // Refine/edit image with AI
};

/**
 * Middleware: Check if trial is still active
 * Returns 403 with trialExpired: true if expired
 */
const checkTrial = async (req, res, next) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    if (!userId) return next(); // Let auth middleware handle missing user

    const user = await User.findById(userId);
    if (!user) return next();

    // Check if credits are exhausted (no time-based expiry)
    if ((user.credits?.balance ?? 100) <= 0) {
      return res.status(403).json({
        success: false,
        creditsExhausted: true,
        message: 'You\'ve used all your credits. Subscribe to continue using Nebulaa Gravity.',
        creditsRemaining: 0
      });
    }

    req.trialInfo = {
      creditsRemaining: user.credits?.balance ?? 100
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
const deductCredits = async (userId, action, count = 1, description = '') => {
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

    const user = await User.findById(userId);
    if (!user) {
      return { success: false, creditsRemaining: 0, creditsDeducted: 0, error: 'User not found' };
    }

    const currentBalance = user.credits?.balance ?? 100;

    if (currentBalance < totalCost) {
      return {
        success: false,
        creditsRemaining: currentBalance,
        creditsDeducted: 0,
        error: `Insufficient credits. Need ${totalCost}, have ${currentBalance}.`
      };
    }

    // Deduct credits and log history
    const result = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          'credits.balance': -totalCost,
          'credits.totalUsed': totalCost
        },
        $push: {
          'credits.history': {
            $each: [{
              action,
              amount: -totalCost,
              description: description || `${action} x${count}`,
              createdAt: new Date()
            }],
            $slice: -100 // Keep only last 100 entries
          }
        }
      },
      { new: true }
    );

    return {
      success: true,
      creditsRemaining: result.credits.balance,
      creditsDeducted: totalCost
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

      const user = await User.findById(userId);
      const currentBalance = user?.credits?.balance ?? 100;

      if (currentBalance < totalCost) {
        return res.status(403).json({
          success: false,
          creditsExhausted: true,
          message: `This action requires ${totalCost} credits but you only have ${currentBalance}.`,
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

module.exports = { checkTrial, deductCredits, requireCredits, CREDIT_COSTS };
