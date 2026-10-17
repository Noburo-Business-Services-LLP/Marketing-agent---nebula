const mongoose = require('mongoose');

// Weekly totals rebuilt from ListeningScore (counts only). `reasons` holds negative counts by reason code.
const weeklySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekStart: { type: String, required: true }, // Monday, YYYY-MM-DD (India time)
  counts: {
    positive: { type: Number, default: 0 },
    neutral: { type: Number, default: 0 },
    negative: { type: Number, default: 0 }
  },
  total: { type: Number, default: 0 },
  reasons: mongoose.Schema.Types.Mixed,
  computedAt: Date
}, { collection: 'listening_weekly' });

weeklySchema.index({ userId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.models.ListeningWeekly || mongoose.model('ListeningWeekly', weeklySchema);
