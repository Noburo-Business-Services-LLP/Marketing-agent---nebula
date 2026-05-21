
const mongoose = require('mongoose');

const influencerAnalyticsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  collaborationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collaboration',
    required: true
  },
  platform: {
    type: String,
    enum: ['instagram', 'youtube', 'linkedin', 'facebook', 'twitter', 'x'],
    required: true
  },
  impressions: { type: Number, default: 0 },
  engagement: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  conversions: { type: Number, default: 0 }
}, { timestamps: true });

influencerAnalyticsSchema.index({ userId: 1, collaborationId: 1, platform: 1 });

module.exports = mongoose.model('InfluencerAnalytics', influencerAnalyticsSchema);
