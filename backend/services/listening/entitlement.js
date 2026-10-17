'use strict';
const { canUse } = require('../../config/entitlements');

/** Who may be scored: active, onboarded, not staff, not CSM, not blocked, and entitled to the Inbox. */
function eligibleAccount(user, { blocked = new Set() } = {}) {
  if (!user) return false;
  if (user.isActive === false) return false;
  if (user.onboardingCompleted !== true) return false;
  if (user.staffRole) return false;
  if (user.isCsm) return false;
  if (user._id !== undefined && user._id !== null && blocked && blocked.has(String(user._id))) return false;
  return !!canUse(user, 'inbox').allowed;
}

module.exports = { eligibleAccount };
