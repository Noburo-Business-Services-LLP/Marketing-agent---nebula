const mongoose = require('mongoose');

const autoReplyRuleSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  matchType: {
    type: String,
    enum: ['contains', 'regex', 'sentiment', 'messageType', 'platform'],
    default: 'contains'
  },
  value: { type: String, default: '' },
  action: {
    type: String,
    enum: ['auto_reply', 'suggest_only', 'skip', 'needs_approval'],
    default: 'suggest_only'
  },
  priority: { type: Number, default: 0 }
}, { _id: true });

const autoReplyToggleSchema = new mongoose.Schema({
  platform: {
    type: String,
    enum: ['instagram', 'facebook', 'linkedin', 'x', 'youtube'],
    required: true
  },
  channelType: {
    type: String,
    enum: ['message', 'comment'],
    required: true
  },
  enabled: { type: Boolean, default: false }
}, { _id: false });

const autoReplySettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  workspaceId: { type: String, default: 'default', index: true },
  enabled: { type: Boolean, default: false },
  automationMode: {
    type: String,
    enum: ['suggested', 'approval_required', 'fully_automatic'],
    default: 'suggested'
  },
  channels: {
    messages: { type: Boolean, default: true },
    comments: { type: Boolean, default: false },
    mentions: { type: Boolean, default: false },
    replies: { type: Boolean, default: false }
  },
  platforms: {
    instagram: { type: Boolean, default: true },
    facebook: { type: Boolean, default: true },
    linkedin: { type: Boolean, default: true },
    x: { type: Boolean, default: true },
    youtube: { type: Boolean, default: true }
  },
  businessTone: { type: String, default: 'professional' },
  replyStyle: {
    type: String,
    enum: ['concise', 'friendly', 'detailed', 'sales', 'support'],
    default: 'friendly'
  },
  responseRules: { type: [autoReplyRuleSchema], default: [] },
  channelOverrides: { type: [autoReplyToggleSchema], default: [] },
  guardrails: {
    requireApprovalForNegative: { type: Boolean, default: true },
    requireApprovalForHighPriority: { type: Boolean, default: true },
    skipSpam: { type: Boolean, default: true },
    maxAutoRepliesPerConversationPerDay: { type: Number, default: 3 },
    signature: { type: String, default: '' }
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

autoReplySettingsSchema.index({ userId: 1, workspaceId: 1 });
autoReplySettingsSchema.index({ userId: 1, 'channelOverrides.platform': 1, 'channelOverrides.channelType': 1 });

module.exports = mongoose.models.AutoReplySettings ||
  mongoose.model('AutoReplySettings', autoReplySettingsSchema);
