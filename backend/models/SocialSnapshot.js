/**
 * Social Snapshot Model
 * Stores daily social media analytics snapshots for historical tracking
 */

const mongoose = require('mongoose');

const platformMetricsSchema = new mongoose.Schema({
  followers: { type: Number, default: 0 },
  following: { type: Number, default: 0 },
  posts: { type: Number, default: 0 },
  reach: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  engagementRate: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
}, { _id: false });

const socialSnapshotSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  platforms: {
    type: Map,
    of: platformMetricsSchema,
    default: {}
  },
  // Aggregated totals
  totals: {
    followers: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    posts: { type: Number, default: 0 },
  }
}, {
  timestamps: true
});

// Compound index: one snapshot per user per day
socialSnapshotSchema.index({ userId: 1, date: -1 }, { unique: true });

module.exports = mongoose.model('SocialSnapshot', socialSnapshotSchema);
