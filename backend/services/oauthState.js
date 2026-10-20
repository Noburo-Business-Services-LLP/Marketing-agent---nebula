'use strict';
/**
 * OAuth `state` for the provider sign-ins (decision D33): 32 random bytes, single use, bound to the account that
 * started the sign-in, valid 10 minutes, kept in MongoDB (models/OAuthState.js) so a callback that lands on another
 * server task still finds it. Replaces the in-process Maps of routes/googleCalendar.js and routes/social.js (their
 * state was base64 JSON with Math.random and lived in one process only).
 *
 *   issue({ userId, purpose, platform })  -> the state string to put in the provider URL
 *   consume(state, { purpose })           -> { userId, platform } once, then null for ever; null when unknown,
 *                                            expired, for another purpose, or malformed
 */
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const STATE_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes in base64url

const hash = (state) => crypto.createHash('sha256').update(String(state)).digest('base64url');

function createOAuthStates({ model = () => require('../models/OAuthState'), now = Date.now, ttlMs = TTL_MS, random = crypto.randomBytes } = {}) {
  async function issue({ userId, purpose, platform = '' } = {}) {
    if (!userId || !purpose) throw new Error('userId and purpose are required');
    const state = random(32).toString('base64url');
    await model().create({ _id: hash(state), purpose: String(purpose), userId: String(userId), platform: String(platform || ''), expiresAt: new Date(now() + ttlMs) });
    return state;
  }

  async function consume(state, { purpose } = {}) {
    if (typeof state !== 'string' || !STATE_RE.test(state) || !purpose) return null;
    // Atomic: the first callback takes it, any replay finds nothing. An expired row (the TTL monitor runs once a
    // minute) is refused here as well.
    const row = await model().findOneAndDelete({ _id: hash(state), purpose: String(purpose), expiresAt: { $gt: new Date(now()) } }).lean();
    return row ? { userId: row.userId, platform: row.platform || '' } : null;
  }

  return { issue, consume };
}

let shared = null;
const get = () => (shared = shared || createOAuthStates());

module.exports = {
  createOAuthStates,
  issue: (...a) => get().issue(...a),
  consume: (...a) => get().consume(...a),
  hash,
  TTL_MS
};
