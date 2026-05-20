const mongoose = require('mongoose');

const socialInboxMessageSchema = new mongoose.Schema({
  providerMessageId: { type: String, default: '' },
  providerParentId: { type: String, default: '' },
  direction: { type: String, enum: ['inbound', 'outbound'], default: 'inbound' },
  messageType: { type: String, default: 'message' },
  authorId: { type: String, default: '' },
  authorName: { type: String, default: '' },
  body: { type: String, default: '' },
  mediaUrls: { type: [String], default: [] },
  permalink: { type: String, default: '' },
  sentiment: { type: String, default: 'neutral' },
  spamScore: { type: Number, default: 0 },
  rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const socialInboxConversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  platform: {
    type: String,
    enum: ['instagram', 'facebook', 'linkedin', 'x', 'youtube'],
    required: true,
    index: true
  },
  socialAccountId: { type: String, default: '' },
  providerThreadId: { type: String, required: true },
  participantId: { type: String, default: '' },
  participantName: { type: String, default: '' },
  participantUsername: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  subject: { type: String, default: '' },
  lastMessagePreview: { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  status: { type: String, enum: ['unread', 'read', 'replied', 'closed'], default: 'unread', index: true },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true },
  tags: { type: [String], default: [] },
  sentiment: { type: String, default: 'neutral' },
  spamScore: { type: Number, default: 0 },
  webhookRegistered: { type: Boolean, default: false },
  lastSyncedAt: { type: Date, default: null },
  messages: { type: [socialInboxMessageSchema], default: [] }
}, {
  timestamps: true
});

socialInboxConversationSchema.index({ userId: 1, platform: 1, providerThreadId: 1 }, { unique: true });
socialInboxConversationSchema.index({ userId: 1, status: 1, platform: 1, priority: 1, lastMessageAt: -1 });

module.exports = mongoose.models.SocialInboxConversation ||
  mongoose.model('SocialInboxConversation', socialInboxConversationSchema);
