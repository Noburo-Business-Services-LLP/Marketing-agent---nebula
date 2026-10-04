/**
 * requireFeature(feature): blocks routes that call outside services (social connect,
 * publish, schedule, inbox, auto-reply, competitors) for plans that do not include them.
 * Accounts with no `plan.tier` (every account created before plans) resolve to
 * `managed` and are never blocked. Use after `protect`.
 */
const { canUse } = require('../config/entitlements');

function defaultLoadUser(userId) {
  return require('../models/User').findById(userId);
}

function requireFeature(feature, { loadUser = defaultLoadUser } = {}) {
  return async (req, res, next) => {
    const userId = req.user?.userId || req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Authentication required' });
    let user;
    try {
      user = await loadUser(userId);
    } catch (error) {
      console.error('requireFeature lookup error:', error.message);
      return res.status(500).json({ success: false, message: 'We could not check your plan right now. Please try again.' });
    }
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });

    const verdict = canUse(user, feature);
    if (!verdict.allowed) {
      return res.status(403).json({
        success: false,
        upgradeRequired: true,
        reason: verdict.reason,
        feature,
        message: verdict.message
      });
    }
    return next();
  };
}

module.exports = { requireFeature };
