const mongoose = require('mongoose');

/**
 * One pending OAuth sign-in (Google Calendar, YouTube, the social connect callbacks): which account started it and
 * for what. Stored by the SHA-256 of the random state (the state itself is only in the browser and the provider's
 * redirect), used once (deleted when read) and removed by the TTL index after 10 minutes if never used.
 * Shared by every server task, so the callback may land on another task than the one that started it.
 */
const OAuthStateSchema = new mongoose.Schema({
  _id: { type: String },            // sha256(state), base64url
  purpose: { type: String, required: true },
  userId: { type: String, required: true },
  platform: { type: String, default: '' },
  expiresAt: { type: Date, required: true }
}, { collection: 'oauth_states', versionKey: false });

OAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });

module.exports = mongoose.models.OAuthState || mongoose.model('OAuthState', OAuthStateSchema);
