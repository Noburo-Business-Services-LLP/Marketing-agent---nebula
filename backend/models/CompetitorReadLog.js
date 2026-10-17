const mongoose = require('mongoose');

// One row per profile read ATTEMPT (tracker, staff check or a customer-triggered scrape), written before the result is
// stored, so the daily ceiling and the per-account cap count reads and not saved snapshots. Kept for 14 days.
const readLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  competitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Competitor' },
  day: { type: String, required: true }, // UTC day, YYYY-MM-DD
  at: { type: Date, default: Date.now, expires: 14 * 24 * 3600 },
  handle: String,
  source: { type: String, enum: ['tracker', 'staff', 'customer'], default: 'tracker' }
}, { collection: 'competitor_read_log' });

readLogSchema.index({ day: 1, userId: 1 });
readLogSchema.index({ competitorId: 1, at: -1 });
readLogSchema.index({ userId: 1 });

module.exports = mongoose.models.CompetitorReadLog || mongoose.model('CompetitorReadLog', readLogSchema);
