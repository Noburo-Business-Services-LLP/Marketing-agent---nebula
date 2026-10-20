const mongoose = require('mongoose');
// Stored addresses are http/https only (services/safeUrl.js): a refused one is stored as ''.
const { urlSetter } = require('../services/safeUrl');

const competitorPostSchema = new mongoose.Schema({
  platform: {
    type: String,
    enum: ['instagram', 'facebook', 'twitter', 'linkedin', 'youtube'],
    required: true
  },
  postUrl: { type: String, set: urlSetter() },
  content: String,
  imageUrl: { type: String, set: urlSetter({ allowDataImage: true }) },
  likes: { type: Number, default: 0 },
  comments: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  sentiment: {
    type: String,
    enum: ['positive', 'negative', 'neutral'],
    default: 'neutral'
  },
  postedAt: Date,
  postedAtTimestamp: Number,
  fetchedAt: {
    type: Date,
    default: Date.now
  },
  isRealData: {
    type: Boolean,
    default: false
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
  website: { type: String, set: urlSetter({ allowBareDomain: true }) },
  industry: String,
  socialHandles: {
    instagram: String,
    facebook: String,
    twitter: String,
    linkedin: String,
    youtube: String
  },
  logo: { type: String, set: urlSetter({ allowDataImage: true }) },
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
  },
  // Who stands behind the Instagram handle: suggested (we found or guessed it; never read until the customer confirms),
  // verified (our own profile check matched), confirmed (the customer confirmed or typed it). Older records have none.
  handleStatus: { type: String, enum: ['suggested', 'verified', 'confirmed'] },
  // Our own 96 x 96 copy of their public profile picture, kept only while they are tracked (services/competitors/avatar.js).
  avatarUrl: { type: String, set: urlSetter() },
  avatarUpdatedAt: Date,
  avatarSourceKey: String, // which picture it was made from (a hash of the link's path), so an unchanged picture is not fetched again
  // Our own 360 x 450 copies of their top public posts (services/competitors/postThumbs.js), at most six, only while tracked
  // and only when ENABLE_COMPETITOR_THUMBS is on. postKey is 'p-<shortcode>'; Instagram's picture link is never stored.
  postThumbs: [{ _id: false, postKey: String, thumbUrl: String, sourceKey: String, at: Date }],
  // Weekly tracking state (see services/competitors/tracker.js)
  tracking: {
    failures: { type: Number, default: 0 },
    pausedAt: Date,
    lastCheckedAt: Date,
    lastHandle: String // the Instagram handle last read; a different handle resets the failure count
  }
}, {
  timestamps: true
});

// Index for efficient queries
competitorSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('Competitor', competitorSchema);
