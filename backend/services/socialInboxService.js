const mongoose = require('mongoose');
const SocialInboxConversation = require('../models/SocialInboxConversation');
const SocialInboxMessage = require('../models/SocialInboxMessage');
const AutoReplySettings = require('../models/AutoReplySettings');
const User = require('../models/User');
const { generateWithLLM } = require('./llmRouter');
const { emitToUser } = require('./socketHub');
const { dispatchReply } = require('./socialInboxProviderService');

const PLATFORM_ALIASES = {
  instagram: 'instagram',
  facebook: 'facebook',
  linkedin: 'linkedin',
  x: 'x',
  twitter: 'x',
  youtube: 'youtube'
};

const MESSAGE_TYPE_ALIASES = {
  message: 'message',
  messages: 'message',
  dm: 'dm',
  direct_message: 'dm',
  comment: 'comment',
  comments: 'comment',
  mention: 'mention',
  mentions: 'mention',
  reply: 'reply',
  replies: 'reply'
};

function normalizePlatform(platform = '') {
  return PLATFORM_ALIASES[String(platform).toLowerCase()] || String(platform).toLowerCase();
}

function normalizeMessageType(type = '') {
  return MESSAGE_TYPE_ALIASES[String(type || '').toLowerCase()] || 'message';
}

function clampScore(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function analyzeEngagement(text = '') {
  const lower = String(text).toLowerCase();
  let sentiment = 'neutral';
  let priority = 'normal';
  let spamScore = 4;
  let leadScore = 18;
  let engagementScore = 35;

  if (/(refund|angry|bad|broken|complaint|not working|disappointed|cancel)/i.test(lower)) {
    sentiment = 'negative';
    priority = 'high';
    engagementScore += 20;
  }
  if (/(urgent|asap|immediately|legal|lawsuit|emergency)/i.test(lower)) {
    priority = 'urgent';
    engagementScore += 25;
  }
  if (/(love|great|thanks|awesome|interested|price|pricing|available|buy|demo|quote|call)/i.test(lower)) {
    sentiment = sentiment === 'negative' ? sentiment : 'positive';
    leadScore += 35;
    engagementScore += 20;
  }
  if (/(free money|crypto|airdrop|click here|guaranteed income|work from home|forex)/i.test(lower)) {
    spamScore = 92;
    priority = 'low';
    leadScore = 0;
  }

  return {
    sentiment,
    priority,
    spamScore: clampScore(spamScore),
    leadScore: clampScore(leadScore),
    engagementScore: clampScore(engagementScore),
    suggestions: [
      'Thanks for reaching out. We appreciate your message and will help you with this.',
      'Happy to clarify. Could you share one more detail so we can guide you better?',
      sentiment === 'negative'
        ? 'Sorry about the experience. Please send us the order/details and we will prioritize this.'
        : 'Absolutely. This is available, and we can help you pick the right option.'
    ]
  };
}

function extractBody(payload = {}) {
  return String(
    payload.text ||
    payload.message ||
    payload.body ||
    payload.comment ||
    payload.caption ||
    payload.content ||
    payload.entry?.[0]?.messaging?.[0]?.message?.text ||
    payload.entry?.[0]?.changes?.[0]?.value?.message ||
    payload.entry?.[0]?.changes?.[0]?.value?.text ||
    ''
  );
}

function normalizeWebhookPayload(platform, userId, payload = {}) {
  let sourcePlatform = platform;
  if (sourcePlatform === 'ayrshare' || !sourcePlatform) {
    sourcePlatform = payload.platform || payload.source || 'instagram';
  }
  const normalizedPlatform = normalizePlatform(sourcePlatform);
  const now = new Date();
  
  // Extract Ayrshare specific fields directly
  const ayrUser = payload.user || payload.sender || payload.from || payload.author || {};
  const authorId = ayrUser.id || 'unknown';
  const authorName = ayrUser.name || ayrUser.username || '';
  const authorUsername = ayrUser.username || '';
  const authorAvatar = ayrUser.profilePicture || ayrUser.picture || ayrUser.profile_pic || payload.avatar_url || '';
  
  const messageText = payload.message?.text || payload.text || extractBody(payload);
  const threadId = payload.conversation?.id || payload.threadId || payload.thread_id || payload.conversation_id || payload.parent_id || payload.post_id || payload.video_id || payload.entry?.[0]?.messaging?.[0]?.sender?.id || '';

  // Handle Instagram specific structure or fallbacks
  const rawMessageId =
    payload.id ||
    payload.message_id ||
    payload.comment_id ||
    payload.tweet_id ||
    payload.videoCommentId ||
    payload.entry?.[0]?.messaging?.[0]?.message?.mid ||
    payload.entry?.[0]?.changes?.[0]?.value?.id ||
    `${normalizedPlatform}-${now.getTime()}`;
    
  const providerMessageId = String(rawMessageId);
  const finalThreadId = String(threadId || providerMessageId);
  
  const messageType = normalizeMessageType(payload.type || payload.message_type || payload.field || payload.object || 'message');
  const recipientId = payload.recipient?.id || payload.to?.id || 'unknown';

  // Extract created_time properly
  const timestampRaw = payload.created_time || payload.createdAt || payload.timestamp || payload.entry?.[0]?.time || payload.entry?.[0]?.messaging?.[0]?.timestamp;
  const occurredAt = timestampRaw ? (typeof timestampRaw === 'number' && timestampRaw < 9999999999 ? new Date(timestampRaw * 1000) : new Date(timestampRaw)) : now;

  return {
    userId,
    platform: normalizedPlatform,
    workspaceId: String(payload.workspaceId || payload.workspace_id || 'default'),
    socialAccountId: String(payload.social_account_id || payload.account_id || payload.page_id || recipientId || ''),
    providerThreadId: finalThreadId,
    providerMessageId,
    providerParentId: String(payload.parent_id || payload.in_reply_to_id || ''),
    messageType,
    participantId: String(authorId),
    participantName: String(authorName),
    participantUsername: String(authorUsername),
    avatarUrl: String(authorAvatar),
    authorId: String(authorId),
    authorName: String(authorName),
    recipientId: String(recipientId),
    body: messageText,
    mediaUrls: Array.isArray(payload.media_urls) ? payload.media_urls : [],
    permalink: String(payload.permalink || payload.url || ''),
    rawPayload: payload,
    occurredAt
  };
}

async function getSettings(userId) {
  let settings = await AutoReplySettings.findOne({ userId });
  if (!settings) {
    settings = await AutoReplySettings.create({ userId });
  }
  return settings;
}

async function updateSettings(userId, data = {}, updatedBy = null) {
  const allowed = {
    enabled: data.enabled,
    automationMode: data.automationMode,
    channels: data.channels,
    platforms: data.platforms,
    businessTone: data.businessTone,
    replyStyle: data.replyStyle,
    responseRules: data.responseRules,
    guardrails: data.guardrails,
    updatedBy
  };

  Object.keys(allowed).forEach((key) => allowed[key] === undefined && delete allowed[key]);
  return AutoReplySettings.findOneAndUpdate(
    { userId },
    { $set: allowed },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function ruleMatches(rule, event, insights) {
  if (!rule?.enabled) return false;
  const value = String(rule.value || '').toLowerCase();
  const body = String(event.body || '').toLowerCase();
  if (!value && !['sentiment', 'messageType', 'platform'].includes(rule.matchType)) return false;

  if (rule.matchType === 'contains') return body.includes(value);
  if (rule.matchType === 'regex') {
    try {
      return new RegExp(rule.value, 'i').test(event.body || '');
    } catch (_) {
      return false;
    }
  }
  if (rule.matchType === 'sentiment') return insights.sentiment === value;
  if (rule.matchType === 'messageType') return event.messageType === value;
  if (rule.matchType === 'platform') return event.platform === normalizePlatform(value);
  return false;
}

function getChannelKey(messageType) {
  if (messageType === 'comment') return 'comments';
  if (messageType === 'mention') return 'mentions';
  if (messageType === 'reply') return 'replies';
  return 'messages';
}

async function countAutoRepliesToday(conversationId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return SocialInboxMessage.countDocuments({
    conversationId,
    direction: 'outbound',
    'ai.autoReplyStatus': 'sent',
    createdAt: { $gte: start }
  });
}

async function generateAIReply({ user, conversation, message, settings, insights }) {
  const business = user?.businessProfile || {};
  const recentHistory = await SocialInboxMessage.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();

  const prompt = `Generate a social inbox reply for Nebulaa Gravity.

Business:
- Name: ${business.name || user?.companyName || 'Business'}
- Industry: ${business.industry || 'General'}
- Description: ${business.description || business.niche || ''}
- Target audience: ${business.targetAudience || ''}
- Brand voice: ${JSON.stringify(business.brandVoice || settings.businessTone)}

Reply preferences:
- Tone: ${settings.businessTone}
- Style: ${settings.replyStyle}
- Platform: ${conversation.platform}
- Message type: ${message.messageType}
- Sentiment: ${insights.sentiment}
- Priority: ${insights.priority}

Recent conversation history:
${recentHistory.reverse().map(item => `${item.direction === 'outbound' ? 'Brand' : item.authorName}: ${item.body}`).join('\n')}

Latest incoming message:
${message.body}

Rules:
- Be concise and helpful.
- Do not invent policies, prices, inventory, or guarantees.
- Ask for a clarifying detail if needed.
- If the customer is upset, acknowledge and de-escalate.
- Return 3 reply options and one recommended reply.`;

  const schema = {
    required: ['recommendedReply', 'suggestedReplies', 'reason'],
    properties: {
      recommendedReply: { type: 'string' },
      suggestedReplies: { type: 'array' },
      reason: { type: 'string' }
    }
  };

  try {
    const result = await generateWithLLM({
      provider: process.env.CLAUDE_API_KEY ? 'claude' : 'gemini',
      taskType: 'social_inbox_ai_reply',
      prompt,
      jsonSchema: schema,
      temperature: 0.45,
      maxTokens: 1400
    });

    const suggestedReplies = Array.isArray(result.suggestedReplies)
      ? result.suggestedReplies.map(v => String(v || '').trim()).filter(Boolean).slice(0, 3)
      : [];
    const recommendedReply = String(result.recommendedReply || suggestedReplies[0] || '').trim();
    return {
      recommendedReply: recommendedReply || insights.suggestions[0],
      suggestedReplies: suggestedReplies.length ? suggestedReplies : insights.suggestions,
      reason: String(result.reason || 'Generated from conversation context.')
    };
  } catch (error) {
    console.warn('Social inbox AI reply fallback:', error.message);
    return {
      recommendedReply: insights.suggestions[0],
      suggestedReplies: insights.suggestions,
      reason: 'Fallback suggestion generated while AI provider was unavailable.'
    };
  }
}

async function decideAutomation({ settings, event, insights, conversation }) {
  if (!settings.enabled) return { action: 'suggest_only', reason: 'Automation disabled' };
  if (!settings.platforms?.[event.platform]) return { action: 'suggest_only', reason: 'Platform automation disabled' };
  if (!settings.channels?.[getChannelKey(event.messageType)]) return { action: 'suggest_only', reason: 'Channel automation disabled' };
  if (settings.guardrails?.skipSpam && insights.spamScore >= 80) return { action: 'skip', reason: 'Skipped spam-like message' };
  if (settings.guardrails?.requireApprovalForNegative && insights.sentiment === 'negative') return { action: 'needs_approval', reason: 'Negative sentiment requires approval' };
  if (settings.guardrails?.requireApprovalForHighPriority && ['high', 'urgent'].includes(insights.priority)) return { action: 'needs_approval', reason: 'High priority message requires approval' };

  const rules = [...(settings.responseRules || [])].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
  const matched = rules.find(rule => ruleMatches(rule, event, insights));
  if (matched) return { action: matched.action, reason: `Matched rule: ${matched.name || matched.matchType}` };

  if (settings.automationMode === 'fully_automatic') {
    const todayCount = conversation?._id ? await countAutoRepliesToday(conversation._id) : 0;
    const max = Number(settings.guardrails?.maxAutoRepliesPerConversationPerDay || 3);
    if (todayCount >= max) return { action: 'needs_approval', reason: 'Daily auto-reply limit reached' };
    return { action: 'auto_reply', reason: 'Fully automatic mode' };
  }
  if (settings.automationMode === 'approval_required') return { action: 'needs_approval', reason: 'Approval required mode' };
  return { action: 'suggest_only', reason: 'Suggested replies mode' };
}

async function ingestEvent(eventInput) {
  const event = {
    ...eventInput,
    platform: normalizePlatform(eventInput.platform),
    messageType: normalizeMessageType(eventInput.messageType)
  };
  const insights = analyzeEngagement(event.body);
  const messageTypes = Array.from(new Set([event.messageType].filter(Boolean)));

  const update = {
    userId: event.userId,
    platform: event.platform,
    workspaceId: event.workspaceId || 'default',
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
    leadScore: insights.leadScore,
    engagementScore: insights.engagementScore,
    webhookRegistered: true,
    lastSyncedAt: new Date()
  };

  let conversation = await SocialInboxConversation.findOne({
    userId: event.userId,
    platform: event.platform,
    providerThreadId: event.providerThreadId
  });

  if (!conversation) {
    conversation = await SocialInboxConversation.create({
      ...update,
      messageTypes,
      unreadCount: 1,
      messages: []
    });
  } else {
    Object.assign(conversation, update);
    conversation.messageTypes = Array.from(new Set([...(conversation.messageTypes || []), event.messageType]));
    conversation.unreadCount = Number(conversation.unreadCount || 0) + 1;
    await conversation.save();
  }

  const messagePayload = {
    userId: event.userId,
    conversationId: conversation._id,
    platform: event.platform,
    socialAccountId: event.socialAccountId,
    providerThreadId: event.providerThreadId,
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
    leadScore: insights.leadScore,
    engagementScore: insights.engagementScore,
    priority: insights.priority,
    rawPayload: event.rawPayload,
    createdAt: event.occurredAt
  };

  let message = await SocialInboxMessage.findOne({
    userId: event.userId,
    platform: event.platform,
    providerMessageId: event.providerMessageId
  });
  let duplicate = Boolean(message);

  if (!message) {
    message = await SocialInboxMessage.create(messagePayload);
    const embedded = {
      providerMessageId: message.providerMessageId,
      providerParentId: message.providerParentId,
      direction: message.direction,
      messageType: message.messageType,
      authorId: message.authorId,
      authorName: message.authorName,
      body: message.body,
      mediaUrls: message.mediaUrls,
      permalink: message.permalink,
      sentiment: message.sentiment,
      spamScore: message.spamScore,
      rawPayload: message.rawPayload,
      createdAt: message.createdAt
    };
    conversation.messages.push(embedded);
    if (conversation.messages.length > 50) {
      conversation.messages = conversation.messages.slice(-50);
    }
    await conversation.save();
  }

  let aiResult = null;
  let autoReply = null;
  if (!duplicate) {
    const user = await User.findById(event.userId);
    const settings = await getSettings(event.userId);
    aiResult = await generateAIReply({ user, conversation, message, settings, insights });
    const decision = await decideAutomation({ settings, event, insights, conversation });
    message.ai = {
      suggestedReplies: aiResult.suggestedReplies,
      autoReplyCandidate: aiResult.recommendedReply,
      autoReplyStatus: decision.action === 'auto_reply' ? 'suggested' : decision.action === 'needs_approval' ? 'pending_approval' : decision.action === 'skip' ? 'skipped' : 'suggested',
      autoReplyReason: decision.reason,
      generatedAt: new Date()
    };
    await message.save();

    if (decision.action === 'auto_reply' && aiResult.recommendedReply) {
      autoReply = await createOutboundReply(conversation, aiResult.recommendedReply, {
        user,
        aiAuto: true,
        dispatch: true
      });
      message.ai.autoReplyStatus = autoReply.dispatch?.success ? 'sent' : 'failed';
      await message.save();
    }
  }

  const conversationDto = toConversationDTO(conversation);
  const messageDto = toMessageDTO(message, conversation);
  emitToUser(event.userId, 'inbox.message.created', {
    conversation: conversationDto,
    message: messageDto,
    ai: aiResult,
    autoReply
  });
  
  // Specific real-time events required by UI
  emitToUser(event.userId, `${event.messageType}:new`, {
    conversation: conversationDto,
    message: messageDto
  });
  
  emitToUser(event.userId, 'inbox.notification', {
    type: `new_${event.messageType}`,
    title: `New ${event.messageType} on ${event.platform}`,
    message: event.body,
    conversation: conversationDto
  });

  return { conversation, message, duplicate, insights, ai: aiResult, autoReply };
}

async function createOutboundReply(conversation, body, options = {}) {
  const user = options.user || await User.findById(conversation.userId);
  const dispatch = options.dispatch ? await dispatchReply({ user, conversation, body }) : { success: true, provider: 'local' };
  const providerMessageId = dispatch?.providerResponse?.id || dispatch?.providerResponse?.postIds?.[0] || `nebulaa-reply-${Date.now()}`;

  const message = await SocialInboxMessage.create({
    userId: conversation.userId,
    conversationId: conversation._id,
    platform: conversation.platform,
    socialAccountId: conversation.socialAccountId || '',
    providerThreadId: conversation.providerThreadId,
    providerMessageId,
    direction: 'outbound',
    messageType: 'reply',
    authorId: 'nebulaa',
    authorName: 'Nebulaa',
    body,
    sentiment: 'neutral',
    spamScore: 0,
    priority: 'normal',
    ai: options.aiAuto ? { autoReplyStatus: dispatch.success ? 'sent' : 'failed' } : undefined,
    rawPayload: { dispatch }
  });

  conversation.messages.push({
    providerMessageId: message.providerMessageId,
    direction: 'outbound',
    messageType: 'reply',
    authorId: 'nebulaa',
    authorName: 'Nebulaa',
    body,
    sentiment: 'neutral',
    spamScore: 0,
    createdAt: message.createdAt
  });
  if (conversation.messages.length > 50) conversation.messages = conversation.messages.slice(-50);
  conversation.status = 'replied';
  conversation.unreadCount = 0;
  conversation.lastMessagePreview = body;
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();

  const dto = toMessageDTO(message, conversation);
  emitToUser(conversation.userId, 'inbox.message.replied', dto);
  emitToUser(conversation.userId, 'reply:new', {
    conversation: toConversationDTO(conversation),
    message: dto
  });
  return { message, dispatch };
}

async function listConversations(userId, filters = {}) {
  const query = { userId };
  if (filters.status) query.status = filters.status;
  if (filters.platform) query.platform = normalizePlatform(filters.platform);
  if (filters.priority) query.priority = filters.priority;
  if (filters.assignedUserId && mongoose.Types.ObjectId.isValid(String(filters.assignedUserId))) {
    query.assignedUserId = filters.assignedUserId;
  }
  if (filters.search) {
    query.$or = [
      { participantName: { $regex: filters.search, $options: 'i' } },
      { participantUsername: { $regex: filters.search, $options: 'i' } },
      { lastMessagePreview: { $regex: filters.search, $options: 'i' } },
      { tags: { $regex: filters.search, $options: 'i' } }
    ];
  }

  return SocialInboxConversation.find(query)
    .sort({ lastMessageAt: -1 })
    .skip(Math.max(0, Number(filters.offset) || 0))
    .limit(Math.min(100, Math.max(1, Number(filters.limit) || 50)));
}

async function getConversationThread(userId, conversationId) {
  const conversation = await SocialInboxConversation.findOne({ _id: conversationId, userId });
  if (!conversation) return null;
  const messages = await SocialInboxMessage.find({ conversationId: conversation._id, userId })
    .sort({ createdAt: 1 })
    .limit(200);

  const latestMessage = messages[messages.length - 1] || conversation.messages?.[conversation.messages.length - 1] || {};
  const insights = analyzeEngagement(latestMessage.body || conversation.lastMessagePreview);
  const aiSuggestions = latestMessage.ai?.suggestedReplies?.length
    ? latestMessage.ai.suggestedReplies
    : insights.suggestions;

  return {
    conversation,
    messages: messages.length ? messages : conversation.messages,
    ai: {
      ...insights,
      suggestions: aiSuggestions,
      autoReplyCandidate: latestMessage.ai?.autoReplyCandidate || ''
    }
  };
}

async function getSummary(user) {
  const userId = user._id;
  const connectedPlatforms = getConnectedInboxPlatforms(user);
  const connectedPlatformCount = connectedPlatforms.length;
  const unreadMessageCount = await SocialInboxConversation.countDocuments({ userId, status: 'unread' });
  const unreadByPlatform = await SocialInboxConversation.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), status: 'unread' } },
    { $group: { _id: '$platform', count: { $sum: 1 } } }
  ]);
  const latestConversation = await SocialInboxConversation.findOne({ userId })
    .sort({ lastSyncedAt: -1, updatedAt: -1 })
    .select('lastSyncedAt webhookRegistered')
    .lean();
  const settings = await getSettings(userId);
  const webhookRegistered = connectedPlatformCount > 0 && Boolean(user.ayrshare?.profileKey || user.connectedSocials?.some(s => s.accessToken));

  return {
    connectedPlatforms,
    connectedPlatformCount,
    unreadMessageCount,
    unreadByPlatform: unreadByPlatform.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    inboxEnabled: connectedPlatformCount > 0,
    inboxStatus: connectedPlatformCount > 0 ? (webhookRegistered ? 'active' : 'needs_setup') : 'disabled',
    syncStatus: {
      status: connectedPlatformCount > 0 ? (latestConversation?.lastSyncedAt ? 'synced' : 'pending') : 'not_started',
      lastSyncAt: latestConversation?.lastSyncedAt || user.ayrshare?.lastCheckedAt || user.updatedAt || null,
      nextSyncAt: connectedPlatformCount > 0 ? new Date(Date.now() + 15 * 60 * 1000) : null
    },
    webhookStatus: {
      registered: webhookRegistered,
      activePlatforms: webhookRegistered ? connectedPlatforms : [],
      missingPlatforms: INBOX_SUPPORTED_PLATFORMS.filter(platform => !connectedPlatforms.includes(platform))
    },
    aiEngagement: {
      replySuggestions: true,
      priorityTagging: true,
      unreadAlerts: true,
      autoReplyEnabled: Boolean(settings.enabled),
      automationMode: settings.automationMode
    }
  };
}

const INBOX_SUPPORTED_PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'X', 'YouTube'];

function normalizeDisplayPlatform(platform = '') {
  const value = String(platform).toLowerCase();
  if (value === 'twitter' || value === 'x') return 'X';
  if (value === 'youtube') return 'YouTube';
  if (value === 'linkedin') return 'LinkedIn';
  if (value === 'facebook') return 'Facebook';
  if (value === 'instagram') return 'Instagram';
  return platform;
}

function getConnectedInboxPlatforms(user) {
  const directPlatforms = (user.connectedSocials || [])
    .map(social => normalizeDisplayPlatform(social.platform))
    .filter(platform => INBOX_SUPPORTED_PLATFORMS.includes(platform));
  const ayrsharePlatforms = (user.ayrshare?.activeSocialAccounts || [])
    .map(platform => normalizeDisplayPlatform(platform))
    .filter(platform => INBOX_SUPPORTED_PLATFORMS.includes(platform));
  return Array.from(new Set([...directPlatforms, ...ayrsharePlatforms]));
}

function toConversationDTO(conversation) {
  return {
    id: String(conversation._id),
    user_id: String(conversation.userId),
    workspace_id: conversation.workspaceId || 'default',
    assigned_user_id: conversation.assignedUserId ? String(conversation.assignedUserId) : '',
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
    spam_score: Number(conversation.spamScore || 0) / 100,
    lead_score: conversation.leadScore || 0,
    engagement_score: conversation.engagementScore || 0,
    unread_count: conversation.unreadCount || 0,
    message_types: conversation.messageTypes || []
  };
}

function toMessageDTO(message, conversation) {
  const id = message._id ? String(message._id) : String(message.providerMessageId || Date.now());
  return {
    id,
    conversation_id: String(conversation._id),
    social_account_id: conversation.socialAccountId || message.socialAccountId || '',
    platform: conversation.platform || message.platform,
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
    spam_score: Number(message.spamScore || 0) / 100,
    lead_score: message.leadScore || 0,
    engagement_score: message.engagementScore || 0,
    priority: message.priority || 'normal',
    ai: message.ai || {},
    created_at: message.createdAt
  };
}

let pollingInterval = null;

function startInboxPolling() {
  if (pollingInterval) return;
  console.log('✅ Started Social Inbox fallback polling (every 30s)');
  
  pollingInterval = setInterval(async () => {
    try {
      // In a real production setup, this would query Ayrshare's history or Meta Graph API directly.
      // Here we stub the execution to simulate polling fetch logic.
      // We look for active users with social connections
      const activeUsers = await User.find({ isActive: true }).select('_id ayrshare connectedSocials');
      
      for (const user of activeUsers) {
        // Pseudo-code for actual implementation:
        // const missedEvents = await fetchMissedEventsFromAyrshare(user);
        // for (const event of missedEvents) {
        //   const normalized = normalizeWebhookPayload(event.platform, user._id, event);
        //   await ingestEvent(normalized);
        // }
      }
    } catch (error) {
      console.error('Social Inbox polling error:', error.message);
    }
  }, 30000);
}

module.exports = {
  normalizePlatform,
  normalizeMessageType,
  analyzeEngagement,
  normalizeWebhookPayload,
  ingestEvent,
  createOutboundReply,
  listConversations,
  getConversationThread,
  getSummary,
  getSettings,
  updateSettings,
  toConversationDTO,
  toMessageDTO,
  getConnectedInboxPlatforms,
  startInboxPolling
};
