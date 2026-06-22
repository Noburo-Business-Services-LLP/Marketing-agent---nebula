const mongoose = require('mongoose');

const socialPostAttemptSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    default: null
  },
  accountKey: {
    type: String,
    index: true,
    default: ''
  },
  profileKey: {
    type: String,
    default: ''
  },
  platforms: {
    type: [String],
    default: []
  },
  status: {
    type: String,
    enum: ['queued', 'blocked', 'scheduled', 'success', 'failure'],
    default: 'queued'
  },
  attemptNumber: {
    type: Number,
    default: 1
  },
  maxRetries: {
    type: Number,
    default: 3
  },
  scheduledFor: {
    type: Date,
    default: null
  },
  contentHash: {
    type: String,
    default: ''
  },
  captionLength: {
    type: Number,
    default: 0
  },
  hashtagCount: {
    type: Number,
    default: 0
  },
  errorCode: {
    type: String,
    default: ''
  },
  errorCategory: {
    type: String,
    enum: ['', 'rate_limit', 'auth', 'validation', 'duplicate', 'network', 'unknown'],
    default: ''
  },
  message: {
    type: String,
    default: ''
  },
  requiresReconnect: {
    type: Boolean,
    default: false
  },
  rateLimited: {
    type: Boolean,
    default: false
  },
  retryScheduledFor: {
    type: Date,
    default: null
  },
  requestSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  responseSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: true
});

socialPostAttemptSchema.index({ createdAt: -1 });
socialPostAttemptSchema.index({ accountKey: 1, createdAt: -1 });
socialPostAttemptSchema.index({ errorCode: 1, createdAt: -1 });
socialPostAttemptSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.SocialPostAttempt || mongoose.model('SocialPostAttempt', socialPostAttemptSchema);
