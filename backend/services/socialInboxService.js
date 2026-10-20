const mongoose = require('mongoose');
const SocialInboxConversation = require('../models/SocialInboxConversation');
const SocialInboxMessage = require('../models/SocialInboxMessage');
const AutoReplySettings = require('../models/AutoReplySettings');
const User = require('../models/User');
const { generateWithLLM } = require('./llmRouter');
const { emitToUser } = require('./socketHub');
const { dispatchReply, isReplyPlatform, REPLY_PLATFORMS, NOT_AVAILABLE_YET } = require('./socialInboxProviderService');
const { liveUpdatesOf } = require('./inboxWebhook');
const { hasGoogleProfile } = require('./googleReviews');

const inboxLimits = require('../config/socialInbox');

const NOT_AVAILABLE_MESSAGE = NOT_AVAILABLE_YET;
const SAFE_RULE_TYPES = ['contains', 'sentiment', 'messageType', 'platform'];
const MAX_AUTO_SEND_ATTEMPTS = 1;
const FALLBACK_HOLD_REASON = 'The reply could not be drafted in your tone';
const CONFIRM_AUTOMATIC_MESSAGE = 'Fully automatic replies send without your approval. Please confirm to turn them on.';

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

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

function normalizeChannelType(channelType = '') {
  const value = String(channelType || '').toLowerCase();
  if (['comment', 'comments'].includes(value)) return 'comment';
  return 'message';
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
      // General replies never claim stock, prices or dates: nothing here is known about the business.
      sentiment === 'negative'
        ? 'Sorry about the experience. Please send us your order details and we will look into it.'
        : 'Thank you for asking. Let us check this for you and get back to you shortly.'
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
  // Ayrshare message hooks carry senderDetails/senderId; comment hooks carry from { id, username }.
  const ayrUser = payload.senderDetails || payload.user || payload.sender || payload.from || payload.author || {};
  const authorId = ayrUser.id || payload.senderId || 'unknown';
  const authorName = ayrUser.name || ayrUser.username || '';
  const authorUsername = ayrUser.username || '';
  const authorAvatar = ayrUser.profilePicture || ayrUser.picture || ayrUser.profile_pic || payload.avatar_url || '';
  
  const messageText = payload.message?.text || payload.text || extractBody(payload);
  const threadId = payload.conversation?.id || payload.conversationId || payload.threadId || payload.thread_id || payload.conversation_id || payload.parent_id || payload.post_id || payload.postId || payload.media?.id || payload.video_id || payload.entry?.[0]?.messaging?.[0]?.sender?.id || payload.senderId || '';

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
    postId: String(payload.post_id || payload.media_id || ''),
    commentId: String(payload.comment_id || payload.id || ''),
    parentCommentId: String(payload.parent_id || payload.parent_comment_id || ''),
    platformPostType: String(payload.media_type || payload.post_type || '').toLowerCase(),
    rawPayload: payload,
    occurredAt
  };
}

async function ingestComment(platform, payload) {
  const event = normalizeWebhookPayload(platform, payload.userId, payload);
  // Enforce comment types if not set
  if (event.messageType === 'message' || !event.messageType) {
    event.messageType = 'comment';
  }
  return await ingestEvent(event);
}

async function getSettings(userId) {
  let settings = await AutoReplySettings.findOne({ userId });
  if (!settings) {
    settings = await AutoReplySettings.create({ userId });
  }
  return settings;
}

async function updateSettings(userId, data = {}, updatedBy = null) {
  const current = await AutoReplySettings.findOne({ userId });
  if (data.automationMode !== undefined && !['suggested', 'approval_required', 'fully_automatic'].includes(data.automationMode)) {
    throw httpError('That reply mode is not available.');
  }
  if (data.automationMode === 'fully_automatic' && current?.automationMode !== 'fully_automatic' && data.confirm !== true) {
    throw httpError(CONFIRM_AUTOMATIC_MESSAGE);
  }
  if (Array.isArray(data.responseRules)) {
    // Customers can use the safe rule types only. A rule already saved with another type may stay as it is.
    const stored = (current?.responseRules || []).map((rule) => ({ id: String(rule._id), type: rule.matchType }));
    data = { ...data, responseRules: data.responseRules.map((rule) => {
      if (SAFE_RULE_TYPES.includes(rule?.matchType)) return rule;
      const kept = rule?._id && stored.find((item) => item.id === String(rule._id) && item.type === rule.matchType);
      if (!kept) throw httpError('That rule type is not available.');
      return rule;
    }) };
  }
  const allowed = {
    enabled: data.enabled,
    automationMode: data.automationMode,
    channels: data.channels,
    platforms: data.platforms,
    businessTone: data.businessTone,
    replyStyle: data.replyStyle,
    responseRules: data.responseRules,
    channelOverrides: data.channelOverrides,
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

async function setAutoReplyToggle(userId, data = {}, updatedBy = null) {
  const platform = normalizePlatform(data.platform);
  const channelType = normalizeChannelType(data.channelType);

  if (!['instagram', 'facebook', 'linkedin', 'x', 'youtube'].includes(platform)) {
    throw httpError('Invalid platform');
  }

  if (typeof data.enabled !== 'boolean') {
    throw httpError('Enabled must be a boolean');
  }

  if (data.enabled && !isReplyPlatform(platform)) throw httpError(NOT_AVAILABLE_MESSAGE);
  // Turning automatic replies on needs an explicit yes. Turning them off never does.
  if (data.enabled && data.confirm !== true) throw httpError(CONFIRM_AUTOMATIC_MESSAGE);

  const settings = await getSettings(userId);
  const channelKey = channelType === 'comment' ? 'comments' : 'messages';
  const existingOverrides = (settings.channelOverrides || []).map(toggle => ({
    platform: toggle.platform,
    channelType: toggle.channelType,
    enabled: Boolean(toggle.enabled)
  }));
  const channelOverrides = existingOverrides.filter(toggle =>
    !(toggle.platform === platform && toggle.channelType === channelType)
  );
  channelOverrides.push({ platform, channelType, enabled: data.enabled });

  const nextPlatforms = {
    instagram: Boolean(settings.platforms?.instagram),
    facebook: Boolean(settings.platforms?.facebook),
    linkedin: Boolean(settings.platforms?.linkedin),
    x: Boolean(settings.platforms?.x),
    youtube: Boolean(settings.platforms?.youtube),
    [platform]: data.enabled
  };

  const nextChannels = {
    messages: Boolean(settings.channels?.messages),
    comments: Boolean(settings.channels?.comments),
    mentions: Boolean(settings.channels?.mentions),
    replies: Boolean(settings.channels?.replies),
    [channelKey]: data.enabled,
    ...(channelType === 'comment' ? { mentions: data.enabled } : {})
  };

  const anyEnabled = channelOverrides.some(toggle => toggle.enabled);
  return AutoReplySettings.findOneAndUpdate(
    { userId },
    {
      $set: {
        enabled: anyEnabled,
        automationMode: data.enabled ? 'fully_automatic' : settings.automationMode,
        platforms: nextPlatforms,
        channels: nextChannels,
        channelOverrides,
        updatedBy
      }
    },
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

function getAutomationChannelType(messageType) {
  return ['comment', 'mention', 'reply'].includes(messageType) ? 'comment' : 'message';
}

function isAutoReplyEnabled(settings, event) {
  if (!settings?.enabled) return false;

  const platform = normalizePlatform(event.platform);
  const channelType = getAutomationChannelType(event.messageType);
  const override = (settings.channelOverrides || []).find(toggle =>
    toggle.platform === platform && toggle.channelType === channelType
  );

  if (override) return Boolean(override.enabled);

  return Boolean(settings.platforms?.[platform]) &&
    Boolean(settings.channels?.[getChannelKey(event.messageType)]);
}


// ---- Limits on model drafts and automatic replies (see config/socialInbox.js) ----
// Required when used, so a test can replace them.
const draftDayModel = () => require('../models/SocialInboxDraftDay');
const spendGuard = () => require('./spendGuard');

const IST_OFFSET_MS = 5.5 * 3600000;
const indiaDay = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const localDay = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const isDuplicateKey = (error) => Boolean(error && (error.code === 11000 || /E11000|duplicate key/i.test(error.message || '')));

/** Claim one draft for the account on this India day. The cap is inside the update, so simultaneous messages cannot both pass. */
async function claimAccountDraft(userId, now = new Date(), cap = inboxLimits.DRAFTS_PER_ACCOUNT_PER_DAY) {
  const DraftDay = draftDayModel();
  const day = indiaDay(now);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = await DraftDay.findOneAndUpdate({ userId, day, count: { $lt: cap } }, { $inc: { count: 1 } }, { new: true });
    if (claimed) return true;
    if (await DraftDay.findOne({ userId, day })) return false; // the row exists and is at the cap
    try {
      await DraftDay.create({ userId, day, count: 1 });
      return true;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error; // another message made the row first: claim against it
    }
  }
  return false;
}

/** Claim one draft for the conversation in the current hour (a window that starts at its first draft). Same atomic idea. */
async function claimConversationDraft(conversationId, now = new Date(), cap = inboxLimits.DRAFTS_PER_CONVERSATION_PER_HOUR) {
  const hourAgo = new Date(now.getTime() - 3600000);
  // Two rounds: when several messages arrive together, one opens the window and the rest claim against it.
  for (let round = 0; round < 2; round += 1) {
    const within = await SocialInboxConversation.findOneAndUpdate(
      { _id: conversationId, 'draftWindow.start': { $gte: hourAgo }, 'draftWindow.count': { $lt: cap } },
      { $inc: { 'draftWindow.count': 1 } },
      { new: true }
    );
    if (within) return true;
    const fresh = await SocialInboxConversation.findOneAndUpdate(
      { _id: conversationId, 'draftWindow.start': { $not: { $gte: hourAgo } } },
      { $set: { draftWindow: { start: now, count: 1 } } },
      { new: true }
    );
    if (fresh) return true;
  }
  return false;
}

/** Claim one automatic reply for the conversation today. Failed attempts keep counting. */
async function claimAutoReply(conversationId, max, now = new Date()) {
  if (!(max > 0)) return false;
  const day = localDay(now);
  for (let round = 0; round < 2; round += 1) {
    const within = await SocialInboxConversation.findOneAndUpdate(
      { _id: conversationId, 'autoReplyClaim.day': day, 'autoReplyClaim.count': { $lt: max } },
      { $inc: { 'autoReplyClaim.count': 1 } },
      { new: true }
    );
    if (within) return true;
    const fresh = await SocialInboxConversation.findOneAndUpdate(
      { _id: conversationId, 'autoReplyClaim.day': { $ne: day } },
      { $set: { autoReplyClaim: { day, count: 1 } } },
      { new: true }
    );
    if (fresh) return true;
  }
  return false;
}

/** Whether a model draft may be made for this message: the spend guard, then the two caps. */
async function mayDraft({ userId, conversation, now = new Date() }) {
  const guard = spendGuard();
  const allowed = await guard.check(inboxLimits.SPEND_ACTION);
  if (!allowed || allowed.ok === false) return false;
  if (!(await claimAccountDraft(userId, now))) return false;
  if (!(await claimConversationDraft(conversation._id, now))) return false;
  return true;
}

function pausedDraft() {
  return {
    paused: true,
    recommendedReply: '',
    suggestedReplies: [],
    reason: inboxLimits.DRAFT_PAUSED_NOTE,
    source: 'paused'
  };
}

async function countAutoRepliesToday(conversationId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return SocialInboxMessage.countDocuments({
    conversationId,
    direction: 'outbound',
    'ai.autoReplyStatus': { $in: ['sent', 'failed'] }, // failed tries count too, so a broken connection cannot loop
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
- Write every reply in the same language as the latest incoming message (for example Tamil for Tamil, Hindi for Hindi).
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

    await spendGuard().record(inboxLimits.SPEND_ACTION, 1);
    const suggestedReplies = Array.isArray(result.suggestedReplies)
      ? result.suggestedReplies.map(v => String(v || '').trim()).filter(Boolean).slice(0, 3)
      : [];
    const recommendedReply = String(result.recommendedReply || suggestedReplies[0] || '').trim();
    // Anything the writing service left out is filled from the general replies, and then counts as a general reply.
    const drafted = Boolean(recommendedReply && suggestedReplies.length);
    return {
      recommendedReply: recommendedReply || insights.suggestions[0],
      suggestedReplies: suggestedReplies.length ? suggestedReplies : insights.suggestions,
      reason: String(result.reason || 'Generated from conversation context.'),
      source: drafted ? 'ai' : 'fallback'
    };
  } catch (error) {
    console.warn('Social inbox AI reply fallback:', error.message);
    return {
      recommendedReply: insights.suggestions[0],
      suggestedReplies: insights.suggestions,
      reason: 'Fallback suggestion generated while AI provider was unavailable.',
      source: 'fallback'
    };
  }
}

async function decideAutomation({ settings, event, insights, conversation }) {
  const autoReplyEnabled = isAutoReplyEnabled(settings, event);
  if (!autoReplyEnabled) return { action: 'suggest_only', reason: 'Auto reply disabled for this platform/channel' };
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
    return { action: 'auto_reply', reason: 'Fully automatic mode', capPerDay: max };
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
  if (!isReplyPlatform(event.platform)) {
    return { success: false, unsupported: true, platform: event.platform, message: NOT_AVAILABLE_MESSAGE };
  }
  // Ayrshare delivers at least once, so the same event can arrive again. A repeat changes nothing.
  const already = await SocialInboxMessage.findOne({
    userId: event.userId,
    platform: event.platform,
    providerMessageId: event.providerMessageId
  });
  if (already) {
    const existing = await SocialInboxConversation.findOne({ _id: already.conversationId, userId: event.userId });
    return { conversation: existing, message: already, duplicate: true, insights: analyzeEngagement(event.body), ai: null, autoReply: null };
  }
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
    postId: event.postId || '',
    commentId: event.commentId || '',
    parentCommentId: event.parentCommentId || '',
    platformPostType: ['post', 'reel', 'story'].includes(event.platformPostType) ? event.platformPostType : '',
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
    const drafting = await mayDraft({ userId: event.userId, conversation });
    aiResult = drafting ? await generateAIReply({ user, conversation, message, settings, insights }) : pausedDraft();
    let decision = aiResult.paused
      ? { action: 'suggest_only', reason: inboxLimits.DRAFT_PAUSED_NOTE }
      : await decideAutomation({ settings, event, insights, conversation });
    // A general reply (the writing service was unavailable) is never sent on its own: it waits for the owner.
    if (decision.action === 'auto_reply' && aiResult.source !== 'ai') {
      decision = { action: 'needs_approval', reason: FALLBACK_HOLD_REASON };
    }
    // The daily limit is claimed in one step, so two messages arriving together cannot both get through.
    if (decision.action === 'auto_reply' && decision.capPerDay !== undefined && !(await claimAutoReply(conversation._id, decision.capPerDay))) {
      decision = { action: 'needs_approval', reason: 'Daily auto-reply limit reached' };
    }
    message.ai = {
      suggestedReplies: aiResult.suggestedReplies,
      autoReplyCandidate: aiResult.recommendedReply,
      autoReplyStatus: aiResult.paused ? 'paused' : decision.action === 'auto_reply' ? 'suggested' : decision.action === 'needs_approval' ? 'pending_approval' : decision.action === 'skip' ? 'skipped' : 'suggested',
      autoReplyReason: decision.reason,
      sendAttempts: 0,
      generatedAt: new Date(),
      draftSource: aiResult.paused ? '' : aiResult.source === 'ai' ? 'ai' : 'fallback'
    };
    await message.save();

    if (decision.action === 'auto_reply' && aiResult.recommendedReply) {
      // One try only: claim the message first so it can never be sent twice, and a failure is not retried.
      const claimed = await SocialInboxMessage.findOneAndUpdate(
        { _id: message._id, 'ai.sendAttempts': { $not: { $gte: MAX_AUTO_SEND_ATTEMPTS } } },
        { $set: { 'ai.autoReplyStatus': 'sending' }, $inc: { 'ai.sendAttempts': 1 } },
        { new: true }
      );
      if (claimed) {
        let finalStatus = 'failed';
        try {
          autoReply = await createOutboundReply(conversation, aiResult.recommendedReply, {
            user,
            aiAuto: true,
            dispatch: true,
            inbound: message,
            commentId: event.commentId || event.providerMessageId
          });
          finalStatus = autoReply.ok ? 'sent' : 'failed';
        } catch (sendError) {
          console.error('Social inbox auto reply error:', sendError.message);
        }
        message.ai.autoReplyStatus = finalStatus;
        if (finalStatus === 'failed') message.ai.autoReplyReason = autoReply?.error || 'The automatic reply could not be sent.';
        message.autoReplied = finalStatus === 'sent';
        await SocialInboxMessage.updateOne({ _id: message._id }, { $set: { 'ai.autoReplyStatus': finalStatus, 'ai.autoReplyReason': message.ai.autoReplyReason, autoReplied: message.autoReplied } });
      }
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

function withSignature(body, signature) {
  const sig = String(signature || '').trim();
  const text = String(body || '').trim();
  if (!sig || text.endsWith(sig)) return text;
  return `${text}\n\n${sig}`;
}

// The message this reply answers: the given one, the one with the given comment id, or the latest from the customer.
async function findInboundTarget(conversation, options = {}) {
  if (options.inbound) return options.inbound;
  if (options.commentId) {
    const byComment = await SocialInboxMessage.findOne({
      conversationId: conversation._id,
      direction: 'inbound',
      $or: [{ commentId: String(options.commentId) }, { providerMessageId: String(options.commentId) }]
    });
    if (byComment) return byComment;
  }
  return SocialInboxMessage.findOne({ conversationId: conversation._id, direction: 'inbound' }).sort({ createdAt: -1 });
}

/**
 * Send a reply and record it honestly.
 * Sent: stored as sent, conversation marked replied.
 * Failed: stored as failed with a plain reason, conversation left as it was.
 * Returns { message, dispatch, ok, error }.
 */
async function createOutboundReply(conversation, body, options = {}) {
  const user = options.user || await User.findById(conversation.userId);
  const sending = options.dispatch !== false;
  const settings = sending ? await getSettings(conversation.userId) : null;
  const text = sending ? withSignature(body, settings?.guardrails?.signature) : String(body || '').trim();

  let dispatch = { success: true, provider: 'local' };
  if (sending) {
    const target = await findInboundTarget(conversation, options);
    dispatch = await dispatchReply({
      user,
      conversation,
      body: text,
      messageType: target?.messageType || options.messageType || '',
      commentId: options.commentId || target?.commentId || target?.providerMessageId || '',
      recipientId: target?.authorId || conversation.participantId || ''
    });
  }
  const ok = Boolean(dispatch?.success);
  const error = ok ? '' : (dispatch?.error || 'The reply could not be sent. Please try again in a moment.');
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const providerMessageId = (ok && dispatch?.providerResponse?.id) || `${ok ? 'nebulaa-reply' : 'nebulaa-failed'}-${unique}`;

  const message = await SocialInboxMessage.create({
    userId: conversation.userId,
    conversationId: conversation._id,
    platform: conversation.platform,
    socialAccountId: conversation.socialAccountId || '',
    providerThreadId: conversation.providerThreadId,
    providerMessageId,
    direction: 'outbound',
    senderType: options.aiAuto ? 'ai' : 'agent',
    autoSent: Boolean(options.aiAuto),
    messageType: 'reply',
    status: ok ? 'sent' : 'failed',
    errorMessage: error,
    authorId: 'nebulaa',
    authorName: options.aiAuto ? 'AI' : 'Nebulaa',
    body: text,
    sentiment: 'neutral',
    spamScore: 0,
    priority: 'normal',
    ai: options.aiAuto ? { autoReplyStatus: ok ? 'sent' : 'failed' } : undefined,
    rawPayload: { dispatch: { success: ok, provider: dispatch?.provider, code: dispatch?.code || 0 } }
  });

  conversation.messages.push({
    providerMessageId: message.providerMessageId,
    direction: 'outbound',
    senderType: message.senderType,
    autoSent: message.autoSent,
    messageType: 'reply',
    status: message.status,
    errorMessage: error,
    authorId: 'nebulaa',
    authorName: message.authorName,
    body: text,
    sentiment: 'neutral',
    spamScore: 0,
    createdAt: message.createdAt
  });
  if (conversation.messages.length > 50) conversation.messages = conversation.messages.slice(-50);
  if (ok) {
    conversation.status = 'replied';
    conversation.unreadCount = 0;
    conversation.lastMessagePreview = text;
    conversation.lastMessageAt = message.createdAt;
  }
  await conversation.save();

  const dto = toMessageDTO(message, conversation);
  if (ok) {
    emitToUser(conversation.userId, 'inbox.message.replied', dto);
    emitToUser(conversation.userId, 'reply:new', {
      conversation: toConversationDTO(conversation),
      message: dto
    });
  }
  return { message, dispatch, ok, error };
}

// ---- Approval queue: drafts the app wrote that wait for the owner's yes ----

function toPendingDTO(draft, conversation) {
  return {
    id: String(draft._id),
    conversation_id: String(draft.conversationId),
    platform: draft.platform,
    message_type: draft.messageType,
    draft_text: draft.ai?.autoReplyCandidate || '',
    suggested_replies: draft.ai?.suggestedReplies || [],
    reason: draft.ai?.autoReplyReason || '',
    original_message: draft.body,
    author_name: draft.authorName,
    created_at: draft.createdAt,
    conversation: conversation ? {
      id: String(conversation._id),
      participant_name: conversation.participantName,
      participant_username: conversation.participantUsername,
      avatar_url: conversation.avatarUrl,
      platform: conversation.platform,
      status: conversation.status,
      priority: conversation.priority
    } : null
  };
}

async function countPending(userId) {
  return SocialInboxMessage.countDocuments({ userId, direction: 'inbound', 'ai.autoReplyStatus': 'pending_approval' });
}

async function listPendingApprovals(userId) {
  const drafts = await SocialInboxMessage.find({ userId, direction: 'inbound', 'ai.autoReplyStatus': 'pending_approval' })
    .sort({ createdAt: -1 })
    .limit(100);
  const ids = Array.from(new Set(drafts.map((d) => String(d.conversationId))));
  const conversations = ids.length ? await SocialInboxConversation.find({ _id: { $in: ids }, userId }) : [];
  const byId = new Map(conversations.map((c) => [String(c._id), c]));
  return drafts.map((draft) => toPendingDTO(draft, byId.get(String(draft.conversationId))));
}

/**
 * Approve one waiting draft (optionally with edited text) and send it.
 * Returns { notFound } when the id is not this user's waiting draft, otherwise { ok, error, message, ... }.
 */
async function approvePending(user, draftId, editedText) {
  if (!mongoose.Types.ObjectId.isValid(String(draftId))) return { notFound: true };
  // Claim first: only one approval can ever send a given draft.
  const draft = await SocialInboxMessage.findOneAndUpdate(
    { _id: draftId, userId: user._id, direction: 'inbound', 'ai.autoReplyStatus': { $in: ['pending_approval', 'failed'] } },
    { $set: { 'ai.autoReplyStatus': 'sending' } },
    { new: true }
  );
  if (!draft) return { notFound: true };
  const text = String(editedText || '').trim() || draft.ai?.autoReplyCandidate || '';
  const conversation = await SocialInboxConversation.findOne({ _id: draft.conversationId, userId: user._id });
  if (!conversation || !text) {
    await SocialInboxMessage.updateOne({ _id: draft._id }, { $set: { 'ai.autoReplyStatus': 'pending_approval' } });
    return conversation ? { ok: false, error: 'There is no reply text to send.', badRequest: true } : { notFound: true };
  }
  let result;
  try {
    result = await createOutboundReply(conversation, text, { user, dispatch: true, inbound: draft });
  } catch (error) {
    console.error('Approve pending reply error:', error.message);
    result = { ok: false, error: 'The reply could not be sent. Please try again in a moment.' };
  }
  await SocialInboxMessage.updateOne(
    { _id: draft._id },
    { $set: { 'ai.autoReplyStatus': result.ok ? 'sent' : 'failed', autoReplied: false, 'ai.autoReplyReason': result.ok ? 'Approved and sent' : result.error } }
  );
  return { ok: result.ok, error: result.error || '', message: result.message, conversation };
}

async function discardPending(userId, draftId) {
  if (!mongoose.Types.ObjectId.isValid(String(draftId))) return false;
  const res = await SocialInboxMessage.updateOne(
    { _id: draftId, userId, direction: 'inbound', 'ai.autoReplyStatus': { $in: ['pending_approval', 'failed'] } },
    { $set: { 'ai.autoReplyStatus': 'skipped', 'ai.autoReplyReason': 'Discarded by you' } }
  );
  return Number(res.matchedCount ?? res.n ?? 0) > 0;
}

// Messages and comments arrive by themselves through Ayrshare webhooks; there is nothing to pull.
function syncPlatform(platform) {
  const normalized = normalizePlatform(platform);
  if (!isReplyPlatform(normalized)) return { success: false, platform: normalized, message: NOT_AVAILABLE_MESSAGE };
  return { success: true, mode: 'webhook', platform: normalized, message: 'New comments and messages arrive on their own as soon as they are posted.' };
}

// The Inbox filter bar's "Important" chip asks for both high and urgent conversations. Only known words are used.
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['unread', 'read', 'replied', 'closed'];
function priorityFilter(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'important') return { $in: ['high', 'urgent'] };
  return PRIORITIES.includes(v) ? v : undefined;
}

async function listConversations(userId, filters = {}) {
  const query = { userId };
  if (filters.status && STATUSES.includes(String(filters.status))) query.status = String(filters.status);
  if (filters.platform) query.platform = normalizePlatform(filters.platform);
  const priority = priorityFilter(filters.priority);
  if (priority) query.priority = priority;
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

  const all = messages.length ? messages : (conversation.messages || []);
  const latestMessage = all[all.length - 1] || {};
  // Suggestions answer the person: read them from their latest message, not from a reply that already went out.
  const latestInbound = [...all].reverse().find((m) => m && m.direction === 'inbound') || latestMessage;
  const insights = analyzeEngagement(latestInbound.body || conversation.lastMessagePreview);
  const stored = latestInbound.ai?.suggestedReplies?.length ? latestInbound.ai.suggestedReplies : null;
  const aiSuggestions = stored || insights.suggestions;
  // Drafted for this message, or the general replies (none stored, or stored while the writing service was unavailable).
  const suggestionsSource = latestInbound.ai?.autoReplyStatus === 'paused' ? 'paused' : stored && latestInbound.ai?.draftSource !== 'fallback' ? 'drafted' : 'general';

  return {
    conversation,
    messages: messages.length ? messages : conversation.messages,
    ai: {
      ...insights,
      suggestions: aiSuggestions,
      suggestionsSource,
      autoReplyCandidate: latestInbound.ai?.autoReplyCandidate || ''
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
  const pendingCount = await countPending(userId);
  // Live updates are on only after the comment and message hooks were registered successfully (inboxWebhook.js records it).
  // Connections made before that record existed read as 'off' until they are registered once more.
  const liveUpdates = connectedPlatformCount > 0 ? liveUpdatesOf(user) : 'off';
  const webhookRegistered = liveUpdates === 'on';

  return {
    connectedPlatforms,
    connectedPlatformCount,
    unreadMessageCount,
    unreadByPlatform: unreadByPlatform.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    pendingCount,
    inboxEnabled: connectedPlatformCount > 0,
    inboxStatus: connectedPlatformCount > 0 ? (webhookRegistered ? 'active' : 'needs_setup') : 'disabled',
    liveUpdates,
    reviewsConnected: hasGoogleProfile(user),
    syncStatus: {
      status: connectedPlatformCount > 0 ? (latestConversation?.lastSyncedAt ? 'synced' : 'pending') : 'not_started',
      // The time of the latest comment or message received (there is no scheduled sync).
      lastSyncAt: latestConversation?.lastSyncedAt || null
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
    sender_type: message.senderType || (message.direction === 'outbound' ? 'agent' : 'customer'),
    auto_sent: Boolean(message.autoSent),
    status: message.status || 'sent',
    error_message: message.errorMessage || '',
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
    auto_replied: message.autoReplied || false,
    created_at: message.createdAt
  };
}

module.exports = {
  claimAutoReply,
  claimAccountDraft,
  claimConversationDraft,
  priorityFilter,
  normalizePlatform,
  normalizeMessageType,
  analyzeEngagement,
  normalizeWebhookPayload,
  ingestEvent,
  ingestComment,
  createOutboundReply,
  listConversations,
  getConversationThread,
  getSummary,
  getSettings,
  updateSettings,
  setAutoReplyToggle,
  toConversationDTO,
  toMessageDTO,
  getConnectedInboxPlatforms,
  listPendingApprovals,
  approvePending,
  discardPending,
  countPending,
  syncPlatform,
  NOT_AVAILABLE_MESSAGE,
  REPLY_PLATFORMS
};
