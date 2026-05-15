const SocialInboxConversation = require('../models/SocialInboxConversation');

const PLATFORM_ALIASES = {
  instagram: 'instagram',
  facebook: 'facebook',
  linkedin: 'linkedin',
  x: 'x',
  twitter: 'x',
  youtube: 'youtube'
};

function normalizePlatform(platform = '') {
  return PLATFORM_ALIASES[String(platform).toLowerCase()] || String(platform).toLowerCase();
}

function analyzeEngagement(text = '') {
  const lower = String(text).toLowerCase();
  let sentiment = 'neutral';
  let priority = 'normal';
  let spamScore = 0.04;

  if (/(refund|angry|bad|broken|complaint|not working)/i.test(lower)) {
    sentiment = 'negative';
    priority = 'high';
  }
  if (/(urgent|asap|immediately|legal)/i.test(lower)) {
    priority = 'urgent';
  }
  if (/(love|great|thanks|awesome|interested)/i.test(lower)) {
    sentiment = 'positive';
  }
  if (/(free money|crypto|airdrop|click here|guaranteed income)/i.test(lower)) {
    spamScore = 0.92;
    priority = 'low';
  }

  return {
    sentiment,
    priority,
    spamScore,
    suggestions: [
      'Thanks for reaching out. We appreciate your message and will help you with this.',
      'Happy to clarify. Could you share one more detail so we can guide you better?',
      sentiment === 'negative'
        ? 'Sorry about the experience. Please send us the order/details and we will prioritize this.'
        : 'Absolutely. This is available, and we can help you pick the right option.'
    ]
  };
}

function normalizeWebhookPayload(platform, userId, payload = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  const now = new Date();
  const providerMessageId = String(payload.id || payload.message_id || `${normalizedPlatform}-${now.getTime()}`);
  const body = String(payload.text || payload.message || payload.body || '');

  return {
    userId,
    platform: normalizedPlatform,
    socialAccountId: String(payload.social_account_id || payload.account_id || ''),
    providerThreadId: String(payload.thread_id || payload.conversation_id || payload.parent_id || providerMessageId),
    providerMessageId,
    providerParentId: String(payload.parent_id || ''),
    messageType: String(payload.type || payload.message_type || 'message'),
    participantId: String(payload.author_id || payload.from?.id || 'unknown'),
    participantName: String(payload.author_name || payload.from?.name || 'Social user'),
    participantUsername: String(payload.author_username || payload.username || ''),
    avatarUrl: String(payload.avatar_url || ''),
    authorId: String(payload.author_id || payload.from?.id || 'unknown'),
    authorName: String(payload.author_name || payload.from?.name || 'Social user'),
    body,
    mediaUrls: Array.isArray(payload.media_urls) ? payload.media_urls : [],
    permalink: String(payload.permalink || ''),
    rawPayload: payload,
    occurredAt: payload.created_time ? new Date(payload.created_time) : now
  };
}

async function ingestEvent(event) {
  const insights = analyzeEngagement(event.body);
  const update = {
    userId: event.userId,
    platform: event.platform,
    socialAccountId: event.socialAccountId,
    providerThreadId: event.providerThreadId,
    participantId: event.participantId,
    participantName: event.participantName,
    participantUsername: event.participantUsername,
    avatarUrl: event.avatarUrl,
    lastMessagePreview: event.body,
    lastMessageAt: event.occurredAt,
    status: 'unread',
    priority: insights.priority,
    sentiment: insights.sentiment,
    spamScore: insights.spamScore,
    webhookRegistered: true,
    lastSyncedAt: new Date()
  };

  const message = {
    providerMessageId: event.providerMessageId,
    providerParentId: event.providerParentId,
    direction: 'inbound',
    messageType: event.messageType,
    authorId: event.authorId,
    authorName: event.authorName,
    body: event.body,
    mediaUrls: event.mediaUrls,
    permalink: event.permalink,
    sentiment: insights.sentiment,
    spamScore: insights.spamScore,
    rawPayload: event.rawPayload,
    createdAt: event.occurredAt
  };

  let conversation = await SocialInboxConversation.findOne({
    userId: event.userId,
    platform: event.platform,
    providerThreadId: event.providerThreadId
  });

  if (!conversation) {
    conversation = await SocialInboxConversation.create({
      ...update,
      messages: [message]
    });
  } else {
    Object.assign(conversation, update);
    const exists = conversation.messages.some(item => item.providerMessageId === message.providerMessageId);
    if (!exists) conversation.messages.push(message);
    await conversation.save();
  }

  return { conversation, message: conversation.messages[conversation.messages.length - 1], insights };
}

async function createOutboundReply(conversation, body) {
  const message = {
    providerMessageId: `nebulaa-reply-${Date.now()}`,
    direction: 'outbound',
    messageType: 'reply',
    authorId: 'nebulaa',
    authorName: 'Nebulaa',
    body,
    sentiment: 'neutral',
    spamScore: 0,
    createdAt: new Date()
  };

  conversation.messages.push(message);
  conversation.status = 'replied';
  conversation.lastMessagePreview = body;
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();
  return conversation.messages[conversation.messages.length - 1];
}

function toConversationDTO(conversation) {
  return {
    id: String(conversation._id),
    user_id: String(conversation.userId),
    social_account_id: conversation.socialAccountId || '',
    platform: conversation.platform,
    provider_thread_id: conversation.providerThreadId,
    participant_id: conversation.participantId,
    participant_name: conversation.participantName,
    participant_username: conversation.participantUsername,
    avatar_url: conversation.avatarUrl,
    subject: conversation.subject,
    last_message_preview: conversation.lastMessagePreview,
    last_message_at: conversation.lastMessageAt,
    status: conversation.status,
    priority: conversation.priority,
    tags: conversation.tags || [],
    sentiment: conversation.sentiment,
    spam_score: conversation.spamScore
  };
}

function toMessageDTO(message, conversation) {
  return {
    id: String(message._id),
    conversation_id: String(conversation._id),
    social_account_id: conversation.socialAccountId || '',
    platform: conversation.platform,
    provider_message_id: message.providerMessageId,
    provider_parent_id: message.providerParentId,
    direction: message.direction,
    message_type: message.messageType,
    author_id: message.authorId,
    author_name: message.authorName,
    body: message.body,
    media_urls: message.mediaUrls || [],
    permalink: message.permalink,
    sentiment: message.sentiment,
    spam_score: message.spamScore,
    created_at: message.createdAt
  };
}

module.exports = {
  normalizePlatform,
  analyzeEngagement,
  normalizeWebhookPayload,
  ingestEvent,
  createOutboundReply,
  toConversationDTO,
  toMessageDTO
};
