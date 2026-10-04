/**
 * Guards against a request reaching Nebulaa's master Ayrshare profile on behalf of
 * an account that has no profile of its own. Managed accounts (no `plan.tier`) keep
 * their existing behaviour, including the master profile when they have no key.
 */
const { resolveTier, canUse } = require('../config/entitlements');

function requireOwnProfileKey(user) {
  const key = String(user?.ayrshare?.profileKey || '').trim();
  if (key) return key;
  if (resolveTier(user) === 'managed') return null;
  const err = new Error('Please connect your own social profile first. This account has no social profile yet.');
  err.code = 'NO_PROFILE_KEY';
  err.status = 403;
  throw err;
}

// Used by the scheduler/publisher: may this account post right now?
function checkPublishAllowed(user) {
  const verdict = canUse(user, 'publish');
  if (!verdict.allowed) return { allowed: false, error: verdict.message };
  try {
    requireOwnProfileKey(user);
  } catch (e) {
    return { allowed: false, error: e.message };
  }
  return { allowed: true, error: '' };
}

module.exports = { requireOwnProfileKey, checkPublishAllowed };
