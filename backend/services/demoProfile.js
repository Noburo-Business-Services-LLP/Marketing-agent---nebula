'use strict';
/**
 * Demo accounts (decision D101): an account whose social profile key starts with `demo-` was made by a seed script
 * (for example `scripts/seed-demo-brand.js`) on the development database. Its "connected" social accounts are fake, so:
 *   - nothing is ever sent to the social provider for it (every request carrying a demo key is answered here, offline),
 *   - the reads that show connected accounts and their numbers are served from what is stored on the account,
 *   - background jobs leave it alone (see services/backgroundGate.js).
 * No real account can have such a key: real keys come from the provider and never start with `demo-`.
 */

const DEMO_PROFILE_PREFIX = 'demo-';
const DEMO_MESSAGE = 'This is a demo account: nothing is sent to the social networks.';
// The query that finds demo accounts (used by the background gate and the profile count).
const DEMO_PROFILE_QUERY = { 'ayrshare.profileKey': { $regex: '^demo-' } };

const isDemoProfileKey = (key) => typeof key === 'string' && key.trim().startsWith(DEMO_PROFILE_PREFIX);
const isDemoProfile = (user) => isDemoProfileKey(user && user.ayrshare && user.ayrshare.profileKey);

/** True when an outgoing provider request carries a demo profile key (header or body). */
function requestUsesDemoKey(options = {}) {
  const h = options.headers || {};
  if (isDemoProfileKey(h['Profile-Key']) || isDemoProfileKey(h['X-Profile-Key'])) return true;
  let body = options.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  return Boolean(body && typeof body === 'object' && isDemoProfileKey(body.profileKey));
}

/** The answer a demo request gets instead of a network call. Not shaped like a suspension, so no circuit breaker trips. */
function blockedReply() {
  return { status: 400, data: { status: 'error', code: 'demo_account', message: DEMO_MESSAGE } };
}

const storedNames = (user) => (Array.isArray(user && user.ayrshare && user.ayrshare.displayNames) ? user.ayrshare.displayNames : []);

/** The connected accounts as the provider's /user answer would list them, from the stored record. */
function profileFromUser(user) {
  const active = Array.isArray(user && user.ayrshare && user.ayrshare.activeSocialAccounts) ? user.ayrshare.activeSocialAccounts : [];
  // Returned as stored (numbers included): /social/status writes this list back as its cache, so dropping a field here
  // would erase it from the account.
  const displayNames = storedNames(user);
  return { success: true, data: { activeSocialAccounts: active, displayNames }, activeSocialAccounts: active, demo: true };
}

/** Per-platform numbers in the provider's shape ({ instagram: { analytics: {...} } }), from the stored record. */
function analyticsFromUser(user, platforms) {
  const want = Array.isArray(platforms) && platforms.length ? platforms.map((p) => String(p).toLowerCase()) : null;
  const data = {};
  for (const d of storedNames(user)) {
    const p = d && d.platform ? String(d.platform).toLowerCase() : '';
    if (!p || (want && !want.includes(p)) || !d.analytics) continue;
    data[p] = { analytics: d.analytics };
  }
  return { success: true, data, demo: true };
}

async function findByKey(key, User) {
  const Model = User || require('../models/User');
  return Model.findOne({ 'ayrshare.profileKey': String(key).trim() }).select('ayrshare').lean();
}

/** getAyrshareUserProfile for a demo key: stored data only. */
async function storedProfile(key, { User } = {}) {
  const user = await findByKey(key, User);
  if (!user) return { success: false, error: DEMO_MESSAGE, demo: true };
  return profileFromUser(user);
}

/** getUserSocialAnalytics for a demo key: stored data only. */
async function storedAnalytics(key, platforms, { User } = {}) {
  const user = await findByKey(key, User);
  if (!user) return { success: false, error: DEMO_MESSAGE, demo: true };
  return analyticsFromUser(user, platforms);
}

module.exports = {
  DEMO_PROFILE_PREFIX, DEMO_MESSAGE, DEMO_PROFILE_QUERY,
  isDemoProfileKey, isDemoProfile, requestUsesDemoKey, blockedReply,
  profileFromUser, analyticsFromUser, storedProfile, storedAnalytics
};
