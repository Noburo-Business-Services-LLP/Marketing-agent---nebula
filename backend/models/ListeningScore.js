const mongoose = require('mongoose');

// One label per inbox item for the customer's own comments and messages. Only the label and a reason code are kept:
// never the text or the author. Private messages are marked so they can never be quoted.
const scoreSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  inboxItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  platform: String,
  kind: { type: String, enum: ['public', 'private'] },
  label: { type: String, enum: ['pos', 'neu', 'neg'] },
  reason: String,
  itemAt: Date,
  scoredAt: Date,
  modelVersion: String
}, { collection: 'listening_scores' });

scoreSchema.index({ userId: 1, inboxItemId: 1 }, { unique: true });
scoreSchema.index({ userId: 1, itemAt: -1 });
scoreSchema.index({ userId: 1, scoredAt: -1 }); // the card asks for the newest scoring date
scoreSchema.index({ itemAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // the card needs 35 days; a label is kept for about 90

module.exports = mongoose.models.ListeningScore || mongoose.model('ListeningScore', scoreSchema);
