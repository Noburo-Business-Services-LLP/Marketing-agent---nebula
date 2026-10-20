const mongoose = require('mongoose');

/** How many model drafts an account has used on one India day. One row per account per day; the cap is applied in the update. */
const SocialInboxDraftDaySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  day: { type: String, required: true }, // YYYY-MM-DD, India time
  count: { type: Number, default: 0 }
}, { collection: 'social_inbox_draft_days', timestamps: true });
SocialInboxDraftDaySchema.index({ userId: 1, day: 1 }, { unique: true });
SocialInboxDraftDaySchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 3600 });

module.exports = mongoose.models.SocialInboxDraftDay || mongoose.model('SocialInboxDraftDay', SocialInboxDraftDaySchema);
