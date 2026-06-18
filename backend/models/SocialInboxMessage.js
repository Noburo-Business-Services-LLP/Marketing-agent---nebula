const mongoose = require('mongoose');

const socialInboxMessageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SocialInboxConversation',
    required: true,
    index: true
  },
  platform: {
    type: String,
    enum: ['instagram', 'facebook', 'linkedin', 'x', 'youtube'],
    required: true,
    index: true
  },
  socialAccountId: { type: String, default: '' },
  providerThreadId: { type: String, default: '', index: true },
  providerMessageId: { type: String, required: true },
  providerParentId: { type: String, default: '' },
  postId: { type: String, default: '' },
  commentId: { type: String, default: '' },
  parentCommentId: { type: String, default: '' },
  platformPostType: { type: String, enum: ['post', 'reel', 'story', ''], default: '' },
  direction: { type: String, enum: ['inbound', 'outbound'], default: 'inbound', index: true },
  messageType: {
    type: String,
    enum: ['message', 'comment', 'mention', 'reply', 'dm', 'system'],
    default: 'message',
    index: true
  },
  authorId: { type: String, default: '' },
  authorName: { type: String, default: '' },
  body: { type: String, default: '' },
  mediaUrls: { type: [String], default: [] },
  permalink: { type: String, default: '' },
  sentiment: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },
  spamScore: { type: Number, default: 0 },
  leadScore: { type: Number, default: 0 },
  engagementScore: { type: Number, default: 0 },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
  ai: {
    suggestedReplies: { type: [String], default: [] },
    autoReplyCandidate: { type: String, default: '' },
    autoReplyStatus: {
      type: String,
      enum: ['none', 'suggested', 'pending_approval', 'sent', 'failed', 'skipped'],
      default: 'none'
    },
    autoReplyReason: { type: String, default: '' },
    generatedAt: { type: Date, default: null }
  },
  autoReplied: { type: Boolean, default: false },
  rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
}, {
  timestamps: true
});

socialInboxMessageSchema.index(
  { userId: 1, platform: 1, providerMessageId: 1 },
  { unique: true }
);
socialInboxMessageSchema.index({ conversationId: 1, createdAt: 1 });
socialInboxMessageSchema.index({ userId: 1, messageType: 1, direction: 1, createdAt: -1 });

module.exports = mongoose.models.SocialInboxMessage ||
  mongoose.model('SocialInboxMessage', socialInboxMessageSchema);
