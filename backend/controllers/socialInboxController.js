const User = require('../models/User');
const SocialInboxConversation = require('../models/SocialInboxConversation');
const {
  normalizePlatform,
  normalizeWebhookPayload,
  ingestEvent,
  createOutboundReply,
  listConversations,
  getConversationThread,
  getSummary,
  getSettings,
  updateSettings,
  toConversationDTO,
  toMessageDTO
} = require('../services/socialInboxService');
const { addSseSubscriber, isSocketReady } = require('../services/socketHub');

function getUserId(req) {
  return req.user?._id || req.user?.id || req.user?.userId;
}

function verifyWebhookRequest(req) {
  const secret = process.env.SOCIAL_INBOX_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '';
  if (!secret) return true;
  const provided = req.headers['x-nebulaa-webhook-secret'] || req.query.secret || req.body?.secret;
  return String(provided || '') === secret;
}

exports.getSummary = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const summary = await getSummary(user);
    res.json({ success: true, ...summary, realtime: { socketIo: isSocketReady(), sse: true } });
  } catch (error) {
    console.error('Social inbox summary error:', error);
    res.status(500).json({ success: false, message: 'Failed to get social inbox summary' });
  }
};

exports.listConversations = async (req, res) => {
  try {
    const conversations = await listConversations(getUserId(req), req.query);
    res.json({
      success: true,
      conversations: conversations.map(toConversationDTO)
    });
  } catch (error) {
    console.error('List social inbox conversations error:', error);
    res.status(500).json({ success: false, message: 'Failed to load inbox conversations' });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const thread = await getConversationThread(getUserId(req), req.params.id);
    if (!thread) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    res.json({
      success: true,
      conversation: toConversationDTO(thread.conversation),
      messages: thread.messages.map(message => toMessageDTO(message, thread.conversation)),
      ai: thread.ai
    });
  } catch (error) {
    console.error('Get social inbox thread error:', error);
    res.status(500).json({ success: false, message: 'Failed to load inbox thread' });
  }
};

exports.reply = async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) {
      return res.status(400).json({ success: false, message: 'Reply body is required' });
    }

    const conversation = await SocialInboxConversation.findOne({
      _id: req.params.id,
      userId: getUserId(req)
    });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const user = await User.findById(getUserId(req));
    const result = await createOutboundReply(conversation, body, {
      user,
      dispatch: req.body?.dispatch !== false
    });

    res.json({
      success: true,
      message: toMessageDTO(result.message, conversation),
      dispatch: result.dispatch
    });
  } catch (error) {
    console.error('Reply social inbox error:', error);
    res.status(500).json({ success: false, message: 'Failed to send reply' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!['unread', 'read', 'replied', 'closed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    await SocialInboxConversation.updateOne(
      { _id: req.params.id, userId: getUserId(req) },
      { $set: { status, unreadCount: status === 'unread' ? 1 : 0 } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Update social inbox status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
};

exports.updateMeta = async (req, res) => {
  try {
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 12) : [];
    const priority = ['low', 'normal', 'high', 'urgent'].includes(req.body?.priority)
      ? req.body.priority
      : 'normal';
    const assignedUserId = req.body?.assignedUserId || null;

    await SocialInboxConversation.updateOne(
      { _id: req.params.id, userId: getUserId(req) },
      { $set: { tags, priority, assignedUserId: assignedUserId || null } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Update social inbox meta error:', error);
    res.status(500).json({ success: false, message: 'Failed to update conversation' });
  }
};

exports.syncPlatform = async (req, res) => {
  try {
    const platform = normalizePlatform(req.params.platform);
    await SocialInboxConversation.updateMany(
      { userId: getUserId(req), platform },
      { $set: { lastSyncedAt: new Date() } }
    );
    res.json({ success: true, queued: true, platform });
  } catch (error) {
    console.error('Social inbox sync error:', error);
    res.status(500).json({ success: false, message: 'Failed to queue inbox sync' });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const settings = await getSettings(getUserId(req));
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Get auto reply settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to load auto reply settings' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await updateSettings(getUserId(req), req.body || {}, getUserId(req));
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Update auto reply settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to update auto reply settings' });
  }
};

exports.stream = async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`event: inbox.connected\ndata: ${JSON.stringify({ connected: true })}\n\n`);

  const unsubscribe = addSseSubscriber(getUserId(req), (eventName, payload) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(`event: inbox.ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};

exports.verifyWebhook = (req, res) => {
  if (req.query['hub.challenge']) {
    return res.send(req.query['hub.challenge']);
  }
  if (req.query.challenge) {
    return res.send(req.query.challenge);
  }
  res.json({
    success: true,
    platform: normalizePlatform(req.params.platform),
    status: 'ready'
  });
};

exports.receiveWebhook = async (req, res) => {
  try {
    if (!verifyWebhookRequest(req)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
    }

    const userId = req.query.userId || req.body?.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Webhook userId is required' });
    }

    const payloads = Array.isArray(req.body?.events) ? req.body.events : [req.body || {}];
    const results = [];

    for (const payload of payloads) {
      const event = normalizeWebhookPayload(req.params.platform, userId, payload);
      results.push(await ingestEvent(event));
    }

    res.json({
      success: true,
      received: results.length,
      duplicates: results.filter(item => item.duplicate).length
    });
  } catch (error) {
    console.error('Social inbox webhook error:', error);
    res.status(500).json({ success: false, message: 'Failed to process webhook' });
  }
};

exports.devIngest = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    const event = normalizeWebhookPayload(req.body?.platform || 'instagram', getUserId(req), req.body || {});
    const result = await ingestEvent(event);
    res.json({
      success: true,
      conversation: toConversationDTO(result.conversation),
      message: toMessageDTO(result.message, result.conversation),
      ai: result.ai
    });
  } catch (error) {
    console.error('Dev social inbox ingest error:', error);
    res.status(500).json({ success: false, message: 'Failed to create test inbox event' });
  }
};
