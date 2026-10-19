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
  setAutoReplyToggle,
  listPendingApprovals,
  approvePending,
  discardPending,
  syncPlatform: syncPlatformService,
  toConversationDTO,
  toMessageDTO
} = require('../services/socialInboxService');
const { verifyWebhookToken, registerInboxWebhook } = require('../services/inboxWebhook');
const { addSseSubscriber, isSocketReady } = require('../services/socketHub');

function getUserId(req) {
  return req.user?._id || req.user?.id || req.user?.userId;
}

// The registered address carries ?userId=...&token=... . The call is accepted only when the token matches the one
// stored for that user. The token is never logged.
async function verifyWebhookRequest(req) {
  try {
    return await verifyWebhookToken(req.query.userId, req.query.token);
  } catch (err) {
    console.error('Webhook token check failed:', err.message);
    return false;
  }
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
    // Replies are always sent for real. There is no "save without sending" switch.
    const result = await createOutboundReply(conversation, body, {
      user,
      dispatch: true,
      commentId: req.body?.commentId || ''
    });

    if (!result.ok) {
      return res.status(502).json({
        success: false,
        message: result.error,
        sentMessage: toMessageDTO(result.message, conversation)
      });
    }

    res.json({
      success: true,
      message: toMessageDTO(result.message, conversation),
      dispatch: { success: true, provider: result.dispatch?.provider }
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
    // Customers cannot assign conversations: any assignedUserId in the request is ignored.
    await SocialInboxConversation.updateOne(
      { _id: req.params.id, userId: getUserId(req) },
      { $set: { tags, priority } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Update social inbox meta error:', error);
    res.status(500).json({ success: false, message: 'Failed to update conversation' });
  }
};

exports.syncPlatform = async (req, res) => {
  const result = syncPlatformService(req.params.platform);
  res.status(result.success ? 200 : 400).json(result);
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
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    console.error('Update auto reply settings error:', error);
    res.status(500).json({ success: false, message: 'Failed to update auto reply settings' });
  }
};

exports.toggleAutoReply = async (req, res) => {
  try {
    const settings = await setAutoReplyToggle(getUserId(req), req.body || {}, getUserId(req));
    res.json({ success: true, settings });
  } catch (error) {
    if (!error.statusCode) console.error('Toggle auto reply error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : 'Failed to update auto reply toggle'
    });
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

// Check the token first and touch nothing (no logging of the body, no database writes) until it passes.
async function rejectUnlessTrusted(req, res, label) {
  if (await verifyWebhookRequest(req)) return false;
  console.warn(`[${label}] Rejected a webhook call with a missing or wrong token (platform: ${req.params.platform})`);
  res.status(401).json({ success: false, message: 'Invalid webhook token' });
  return true;
}

// Message hooks also announce reads, reactions and edits. Only a new message is a conversation event.
function isNewMessageEvent(payload) {
  const sub = payload?.subAction;
  return !sub || sub === 'messageCreated';
}

exports.receiveWebhook = async (req, res) => {
  try {
    if (await rejectUnlessTrusted(req, res, 'Webhook')) return;
    const userId = req.query.userId;

    const payloads = Array.isArray(req.body?.events) ? req.body.events : [req.body || {}];
    const results = [];

    for (const payload of payloads) {
      if (!isNewMessageEvent(payload)) continue;
      const event = normalizeWebhookPayload(req.params.platform, userId, payload);
      console.log(`[Webhook] Processing event for user: ${userId}, platform: ${event.platform}, type: ${event.messageType}`);
      results.push(await ingestEvent(event));
    }

    res.json({
      success: true,
      received: results.filter(item => !item.unsupported).length,
      duplicates: results.filter(item => item.duplicate).length,
      unsupported: results.filter(item => item.unsupported).length
    });
  } catch (error) {
    console.error('Social inbox webhook error:', error);
    res.status(500).json({ success: false, message: 'Failed to process webhook' });
  }
};

exports.receiveCommentWebhook = async (req, res) => {
  try {
    if (await rejectUnlessTrusted(req, res, 'Comment Webhook')) return;
    const userId = req.query.userId;

    const payloads = Array.isArray(req.body?.events) ? req.body.events : [req.body || {}];
    const results = [];
    const { ingestComment } = require('../services/socialInboxService');

    for (const payload of payloads) {
      console.log(`[Comment Webhook] Processing comment event for user: ${userId}, platform: ${req.params.platform}`);
      results.push(await ingestComment(req.params.platform, { ...payload, userId }));
    }

    res.json({
      success: true,
      received: results.filter(item => item && !item.unsupported).length,
      duplicates: results.filter(item => item && item.duplicate).length,
      unsupported: results.filter(item => item && item.unsupported).length
    });
  } catch (error) {
    console.error('Social inbox comment webhook error:', error);
    res.status(500).json({ success: false, message: 'Failed to process comment webhook' });
  }
};

// ---- Approval queue ----

exports.listPending = async (req, res) => {
  try {
    const pending = await listPendingApprovals(getUserId(req));
    res.json({ success: true, pending, pendingCount: pending.length });
  } catch (error) {
    console.error('List pending replies error:', error);
    res.status(500).json({ success: false, message: 'Failed to load replies waiting for approval' });
  }
};

exports.approvePending = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const result = await approvePending(user, req.params.id, req.body?.text);
    if (result.notFound) return res.status(404).json({ success: false, message: 'That reply is not waiting for approval' });
    if (result.badRequest) return res.status(400).json({ success: false, message: result.error });
    if (!result.ok) {
      return res.status(502).json({
        success: false,
        message: result.error,
        sentMessage: toMessageDTO(result.message, result.conversation)
      });
    }
    res.json({ success: true, message: toMessageDTO(result.message, result.conversation) });
  } catch (error) {
    console.error('Approve pending reply error:', error);
    res.status(500).json({ success: false, message: 'Failed to send the reply' });
  }
};

exports.discardPending = async (req, res) => {
  try {
    const discarded = await discardPending(getUserId(req), req.params.id);
    if (!discarded) return res.status(404).json({ success: false, message: 'That reply is not waiting for approval' });
    res.json({ success: true });
  } catch (error) {
    console.error('Discard pending reply error:', error);
    res.status(500).json({ success: false, message: 'Failed to discard the reply' });
  }
};

exports.registerWebhook = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user || !user.ayrshare?.profileKey) {
      return res.status(400).json({ success: false, message: 'Please connect a social account first' });
    }
    const result = await registerInboxWebhook(user);
    if (!result.success) {
      return res.status(502).json({ success: false, message: 'We could not switch on live updates. Please try again later.' });
    }
    res.json({ success: true, message: 'Live updates are on' });
  } catch (error) {
    console.error('Webhook registration error:', error);
    res.status(500).json({ success: false, message: 'We could not switch on live updates. Please try again later.' });
  }
};

// Developer tools: they add made-up conversations (each runs a model call, and with automatic replies on a send attempt).
// They never run on the live site.
function refuseInProduction(res) {
  if (process.env.NODE_ENV !== 'production') return false;
  res.status(404).json({ success: false, message: 'Not found' });
  return true;
}

exports.devIngest = async (req, res) => {
  if (refuseInProduction(res)) return;
  try {

    const event = normalizeWebhookPayload(req.body?.platform || 'instagram', getUserId(req), req.body || {});
    const result = await ingestEvent(event);
    if (result.unsupported) return res.status(400).json({ success: false, message: result.message });
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

exports.testWebhook = async (req, res) => {
  if (refuseInProduction(res)) return;
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const testPayload = {
      platform: req.body?.platform || 'instagram',
      userId: userId,
      events: [
        {
          id: `test-msg-${Date.now()}`,
          message_id: `test-msg-${Date.now()}`,
          message_type: req.body?.type || 'message',
          text: req.body?.message || 'Hello, this is a test message from Instagram.',
          thread_id: req.body?.thread_id || `test-thread-${Date.now()}`,
          author_id: req.body?.author_id || 'testuser123',
          author_name: req.body?.author_name || 'Test User',
          author_username: req.body?.author_username || 'test.user',
          created_time: new Date().toISOString()
        }
      ]
    };

    req.body = testPayload;
    req.params.platform = testPayload.platform;
    req.query.userId = userId;

    // Call the receiveWebhook handler directly to simulate an inbound webhook
    // Bypassing verifyWebhookRequest explicitly for this dev endpoint
    const payloads = testPayload.events;
    const results = [];

    console.log(`[TestWebhook] Simulating incoming payload:`, JSON.stringify(payloads, null, 2));

    for (const payload of payloads) {
      const event = normalizeWebhookPayload(testPayload.platform, userId, payload);
      results.push(await ingestEvent(event));
    }

    if (results[0]?.unsupported) return res.status(400).json({ success: false, message: results[0].message });
    res.json({
      success: true,
      received: results.length,
      conversation: toConversationDTO(results[0].conversation),
      message: toMessageDTO(results[0].message, results[0].conversation),
      ai: results[0].ai
    });

  } catch (error) {
    console.error('Social inbox dev test error:', error);
    res.status(500).json({ success: false, message: 'Failed to simulate webhook' });
  }
};
