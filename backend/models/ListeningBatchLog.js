const mongoose = require('mongoose');

// One row per scoring batch ATTEMPT, written before the model call so a failed save can never cause the same items to be
// paid for twice, and so the daily caps count calls and not saved scores. Kept for 14 days.
const batchLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  day: { type: String, required: true }, // UTC day, YYYY-MM-DD
  at: { type: Date, default: Date.now, expires: 14 * 24 * 3600 },
  itemIds: [{ type: mongoose.Schema.Types.ObjectId }],
  source: { type: String, enum: ['tracker', 'staff'], default: 'tracker' }
}, { collection: 'listening_batch_log' });

batchLogSchema.index({ day: 1, userId: 1 });
batchLogSchema.index({ userId: 1, at: -1 });

module.exports = mongoose.models.ListeningBatchLog || mongoose.model('ListeningBatchLog', batchLogSchema);
