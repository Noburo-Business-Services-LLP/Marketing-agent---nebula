const mongoose = require('mongoose');

const competitorPostSchema = new mongoose.Schema({
  platform: {
    type: String,
    enum: ['instagram', 'facebook', 'twitter', 'linkedin', 'youtube'],
    required: true
  },
  postUrl: String,
  content: String,
  imageUrl: String,
  likes: { type: Number, default: 0 },
  comments: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  sentiment: {
    type: String,
    enum: ['positive', 'negative', 'neutral'],
    default: 'neutral'
  },
  postedAt: Date,
  fetchedAt: {
    type: Date,
    default: Date.now
  }
});

const competitorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  website: String,
  industry: String,
  socialHandles: {
    instagram: String,
    facebook: String,
    twitter: String,
    linkedin: String,
    youtube: String
  },
  logo: String,
  description: String,
  location: String,
  posts: [competitorPostSchema],
  analysis: {
    strengths: [String],
    weaknesses: [String],
    opportunities: [String],
    threats: [String],
    lastAnalyzedAt: Date
  },
  metrics: {
    avgEngagement: { type: Number, default: 0 },
    postFrequency: String,
    topPerformingContent: String,
    audienceSize: { type: Number, default: 0 },
    followers: { type: Number, default: 0 },
    following: { type: Number, default: 0 },
    lastFetched: Date,
    realTimeData: mongoose.Schema.Types.Mixed
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isAutoDiscovered: {
    type: Boolean,
    default: false
  },
  isIgnored: {
    type: Boolean,
    default: false
  },
  competitorType: {
    type: String,
    enum: ['local', 'regional', 'national', 'global', 'startup', 'emerging', 'direct', 'indirect', 'market_leader', 'unknown'],
    default: 'unknown'
  }
}, {
  timestamps: true
});

// Index for efficient queries
competitorSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('Competitor', competitorSchema);
