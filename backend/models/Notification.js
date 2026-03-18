const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true
  },
  type: {
    type: String,
    enum: ['campaign_reminder_30', 'campaign_reminder_15', 'campaign_live', 'campaign_completed'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  scheduledFor: {
    type: Date,
    required: true,
    index: true
  },
  sentAt: {
    type: Date,
    default: null
  },
  readAt: {
    type: Date,
    default: null
  },
  emailSent: {
    type: Boolean,
    default: false
  },
  emailError: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'read', 'failed'],
    default: 'pending'
  },
  metadata: {
    campaignName: String,
    platforms: [String],
    scheduledTime: String,
    scheduledTimeISO: String // ISO format for accurate time calculation
  }
}, {
  timestamps: true
});

// Compound index for efficient querying
notificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ scheduledFor: 1, status: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
