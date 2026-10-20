const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');
const { makeModel } = require('./helpers/fakeInboxDb');

// Fakes only: no database, no Ayrshare, no AI. Every outside module is replaced before the inbox code loads.
const calls = { comment: [], dm: [], post: [], hook: [] };
let commentResult = { success: true, replyId: 'rc1' };
let dmResult = { success: true, messageId: 'dm1' };

function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const User = makeModel();
const Conversation = makeModel(() => ({ messages: [], status: 'unread', unreadCount: 1, messageTypes: [] }));
const Message = makeModel(() => ({ ai: {}, status: 'sent' }));
const Settings = makeModel(() => ({
  enabled: false,
  automationMode: 'suggested',
  channels: { messages: true, comments: false, mentions: false, replies: false },
  platforms: { instagram: true, facebook: true, linkedin: true, x: true, youtube: true },
  responseRules: [],
  channelOverrides: [],
  guardrails: { requireApprovalForNegative: true, requireApprovalForHighPriority: true, skipSpam: true, maxAutoRepliesPerConversationPerDay: 3, signature: '' }
}));
const baseFind = Settings.findOne.bind(Settings);
Settings.findOneAndUpdate = async (q, update) => {
  let doc = await baseFind(q);
  if (!doc) doc = await Settings.create(q);
  Object.entries(update.$set || {}).forEach(([k, v]) => { doc[k] = v; });
  return doc;
};

stub('models/User', User);
stub('models/SocialInboxConversation', Conversation);
stub('models/SocialInboxMessage', Message);
stub('models/AutoReplySettings', Settings);
stub('models/SocialInboxDraftDay', makeModel(() => ({ count: 0 })));
stub('services/spendGuard', { check: async () => ({ ok: true }), record: async () => {} });
// No AI by default (the general replies are used). Tests of automatic sending set a drafted reply, because a general
// reply is held for approval and never sent on its own (inboxHonesty.test.js).
let llm = async () => { throw new Error('no AI in tests'); };
stub('services/llmRouter', { generateWithLLM: async (args) => llm(args) });
stub('services/socketHub', { emitToUser: () => {}, addSseSubscriber: () => () => {}, isSocketReady: () => false });
stub('services/socialMediaAPI', {
  replyToAyrshareComment: async (a) => { calls.comment.push(a); return commentResult; },
  sendAyrshareDirectMessage: async (a) => { calls.dm.push(a); return dmResult; },
  postToSocialMedia: async (...a) => { calls.post.push(a); return { success: true }; },
  setAyrshareWebhook: async (profileKey, url, action) => { calls.hook.push({ profileKey, url, action }); return { success: true }; }
});

const service = require('../services/socialInboxService');
const controller = require('../controllers/socialInboxController');
const inboxWebhook = require('../services/inboxWebhook');

const quiet = { log: console.log, warn: console.warn, error: console.error };
test.before(() => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; });
test.after(() => { Object.assign(console, quiet); });

function reset() {
  [User, Conversation, Message, Settings].forEach((m) => m.reset());
  calls.comment.length = 0; calls.dm.length = 0; calls.post.length = 0; calls.hook.length = 0;
  llm = async () => { throw new Error('no AI in tests'); };
  commentResult = { success: true, replyId: 'rc1' };
  dmResult = { success: true, messageId: 'dm1' };
}
async function makeUser(extra = {}) {
  return User.create({ ayrshare: { profileKey: 'PK', webhookToken: '' }, ...extra });
}
async function makeConversation(user, over = {}) {
  return Conversation.create({ userId: user._id, platform: 'instagram', providerThreadId: `t-${Math.random()}`, participantId: 'person1', ...over });
}
async function makeInbound(conversation, over = {}) {
  return Message.create({
    userId: conversation.userId, conversationId: conversation._id, platform: conversation.platform,
    providerMessageId: `m-${Math.random()}`, direction: 'inbound', messageType: 'message', authorId: 'person1', body: 'Is this available?', ...over
  });
}
function res() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test('a comment is answered under the comment, never as a DM or a public post', async () => {
  reset();
  const user = await makeUser();
  const conv = await makeConversation(user, { messageTypes: ['comment'] });
  await makeInbound(conv, { messageType: 'comment', commentId: 'c-77', providerMessageId: 'c-77' });
  const out = await service.createOutboundReply(conv, 'Thanks!', { user, dispatch: true, commentId: 'c-77' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(calls.comment.length, 1);
  assert.deepStrictEqual({ platform: calls.comment[0].platform, commentId: calls.comment[0].commentId, text: calls.comment[0].text, profileKey: calls.comment[0].profileKey },
    { platform: 'instagram', commentId: 'c-77', text: 'Thanks!', profileKey: 'PK' });
  assert.strictEqual(calls.dm.length, 0);
  assert.strictEqual(calls.post.length, 0);
});

test('a direct message is answered with a direct message to the sender', async () => {
  reset();
  const user = await makeUser();
  const conv = await makeConversation(user, { platform: 'facebook', participantId: 'psid-9' });
  await makeInbound(conv, { platform: 'facebook', authorId: 'psid-9' });
  const out = await service.createOutboundReply(conv, 'Yes, in stock.', { user, dispatch: true });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(calls.dm.length, 1);
  assert.strictEqual(calls.dm[0].recipientId, 'psid-9');
  assert.strictEqual(calls.dm[0].platform, 'facebook');
  assert.strictEqual(calls.comment.length, 0);
  assert.strictEqual(calls.post.length, 0);
});

test('a failed send is stored as failed in plain words and the conversation stays as it was', async () => {
  reset();
  const user = await makeUser();
  const conv = await makeConversation(user);
  await makeInbound(conv);
  dmResult = { success: false, code: 361, error: 'raw provider text' };
  const out = await service.createOutboundReply(conv, 'Hello', { user, dispatch: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.message.status, 'failed');
  assert.match(out.error, /not switched on/i);
  assert.ok(!/raw provider text/.test(out.error));
  assert.strictEqual(conv.status, 'unread');
  assert.strictEqual(conv.unreadCount, 1);
  assert.strictEqual(calls.post.length, 0);
});

test('a successful send is stored as sent and the conversation is marked replied', async () => {
  reset();
  const user = await makeUser();
  const conv = await makeConversation(user);
  await makeInbound(conv);
  const out = await service.createOutboundReply(conv, 'Hello', { user, dispatch: true });
  assert.strictEqual(out.message.status, 'sent');
  assert.strictEqual(conv.status, 'replied');
});

test('missing ids and unsupported platforms fail clearly with nothing sent', async () => {
  reset();
  const user = await makeUser();
  const noComment = await makeConversation(user);
  await makeInbound(noComment, { messageType: 'comment', commentId: '', providerMessageId: '' });
  const a = await service.createOutboundReply(noComment, 'Hi', { user, dispatch: true });
  assert.strictEqual(a.ok, false);
  const noPerson = await makeConversation(user, { participantId: 'unknown' });
  await makeInbound(noPerson, { authorId: 'unknown' });
  const b = await service.createOutboundReply(noPerson, 'Hi', { user, dispatch: true });
  assert.strictEqual(b.ok, false);
  const linkedin = await makeConversation(user, { platform: 'linkedin' });
  const c = await service.createOutboundReply(linkedin, 'Hi', { user, dispatch: true });
  assert.strictEqual(c.ok, false);
  assert.match(c.error, /not available yet/i);
  assert.strictEqual(calls.comment.length + calls.dm.length + calls.post.length, 0);
});

test('the reply route says success:false with a plain message when sending fails', async () => {
  reset();
  const user = await makeUser();
  const conv = await makeConversation(user);
  await makeInbound(conv);
  dmResult = { success: false, code: 0, error: 'boom' };
  const r = res();
  await controller.reply({ user: { _id: user._id }, params: { id: String(conv._id) }, body: { body: 'Hi', dispatch: false } }, r);
  assert.strictEqual(r.code, 502);
  assert.strictEqual(r.body.success, false);
  assert.strictEqual(typeof r.body.message, 'string');
  assert.strictEqual(r.body.sentMessage.status, 'failed');
  assert.strictEqual(calls.dm.length, 1, 'dispatch:false from the client is ignored');
});

test('the signature in the settings is added to what is sent', async () => {
  reset();
  const user = await makeUser();
  await Settings.create({ userId: user._id, guardrails: { signature: '- The Nebulaa team', maxAutoRepliesPerConversationPerDay: 3 } });
  const conv = await makeConversation(user);
  await makeInbound(conv);
  await service.createOutboundReply(conv, 'Hello', { user, dispatch: true });
  assert.strictEqual(calls.dm[0].text, 'Hello\n\n- The Nebulaa team');
});

async function makeDraft(user, over = {}) {
  const conv = await makeConversation(user);
  const draft = await makeInbound(conv, { ai: { autoReplyStatus: 'pending_approval', autoReplyCandidate: 'Draft text', suggestedReplies: ['a'], autoReplyReason: 'Approval required mode' }, ...over });
  return { conv, draft };
}

test('pending list shows only this user drafts, newest first, with a conversation summary', async () => {
  reset();
  const a = await makeUser();
  const b = await makeUser();
  const first = await makeDraft(a, { createdAt: new Date('2026-01-01') });
  const second = await makeDraft(a, { createdAt: new Date('2026-02-01') });
  await makeDraft(b);
  const r = res();
  await controller.listPending({ user: { _id: a._id } }, r);
  assert.strictEqual(r.body.pending.length, 2);
  assert.strictEqual(r.body.pending[0].id, String(second.draft._id));
  assert.strictEqual(r.body.pending[1].id, String(first.draft._id));
  assert.strictEqual(r.body.pending[0].conversation.id, String(second.conv._id));
  assert.strictEqual(r.body.pendingCount, 2);
});

test('approve sends the edited text once, marks sent, and cannot be approved twice', async () => {
  reset();
  const user = await makeUser();
  const { draft } = await makeDraft(user);
  const r = res();
  await controller.approvePending({ user: { _id: user._id }, params: { id: String(draft._id) }, body: { text: 'Edited text' } }, r);
  assert.strictEqual(r.body.success, true);
  assert.strictEqual(calls.dm[0].text, 'Edited text');
  assert.strictEqual(draft.ai.autoReplyStatus, 'sent');
  const again = res();
  await controller.approvePending({ user: { _id: user._id }, params: { id: String(draft._id) }, body: {} }, again);
  assert.strictEqual(again.code, 404);
  assert.strictEqual(calls.dm.length, 1);
});

test('approve with a failed send marks the draft failed and reports plainly', async () => {
  reset();
  const user = await makeUser();
  const { draft, conv } = await makeDraft(user);
  dmResult = { success: false, code: 362, error: 'x' };
  const r = res();
  await controller.approvePending({ user: { _id: user._id }, params: { id: String(draft._id) }, body: {} }, r);
  assert.strictEqual(r.code, 502);
  assert.strictEqual(r.body.success, false);
  assert.match(r.body.message, /reconnect/i);
  assert.strictEqual(draft.ai.autoReplyStatus, 'failed');
  assert.strictEqual(conv.status, 'unread');
});

test('approve and discard are refused for another user and for bad ids', async () => {
  reset();
  const owner = await makeUser();
  const other = await makeUser();
  const { draft } = await makeDraft(owner);
  for (const handler of ['approvePending', 'discardPending']) {
    const r = res();
    await controller[handler]({ user: { _id: other._id }, params: { id: String(draft._id) }, body: {} }, r);
    assert.strictEqual(r.code, 404, handler);
    const bad = res();
    await controller[handler]({ user: { _id: owner._id }, params: { id: 'not-an-id' }, body: {} }, bad);
    assert.strictEqual(bad.code, 404, handler);
  }
  assert.strictEqual(draft.ai.autoReplyStatus, 'pending_approval');
  assert.strictEqual(calls.dm.length, 0);
  const ok = res();
  await controller.discardPending({ user: { _id: owner._id }, params: { id: String(draft._id) } }, ok);
  assert.strictEqual(ok.body.success, true);
  assert.strictEqual(draft.ai.autoReplyStatus, 'skipped');
  assert.strictEqual(await service.countPending(owner._id), 0);
});

test('webhook: a missing or wrong token gets 401 and nothing is stored; the right token is accepted', async () => {
  reset();
  const user = await makeUser();
  const token = await inboxWebhook.ensureWebhookToken(user._id);
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.strictEqual(await inboxWebhook.ensureWebhookToken(user._id), token, 'token is stable');
  const body = { action: 'messages', subAction: 'messageCreated', id: 'mid1', platform: 'instagram', senderId: 'p1', senderDetails: { id: 'p1', username: 'pat' }, message: 'Hi there', conversationId: 'conv1' };
  for (const query of [{ userId: String(user._id) }, { userId: String(user._id), token: 'wrong' }, { token, userId: 'nope' }, { token }]) {
    const r = res();
    await controller.receiveWebhook({ params: { platform: 'ayrshare' }, query, body, headers: {} }, r);
    assert.strictEqual(r.code, 401, JSON.stringify(Object.keys(query)));
  }
  assert.strictEqual(Conversation.rows.length, 0);
  const good = res();
  await controller.receiveWebhook({ params: { platform: 'ayrshare' }, query: { userId: String(user._id), token }, body, headers: {} }, good);
  assert.strictEqual(good.body.success, true);
  assert.strictEqual(Conversation.rows.length, 1);
  assert.strictEqual(Conversation.rows[0].participantId, 'p1');
  const read = res();
  await controller.receiveWebhook({ params: { platform: 'ayrshare' }, query: { userId: String(user._id), token }, body: { ...body, subAction: 'messageRead', id: undefined }, headers: {} }, read);
  assert.strictEqual(Conversation.rows.length, 1, 'a read receipt is not a new message');
});

test('webhook: the comment route checks the token the same way', async () => {
  reset();
  const user = await makeUser();
  const token = await inboxWebhook.ensureWebhookToken(user._id);
  const body = { action: 'comments', subAction: 'comment', platform: 'instagram', id: 'cm1', text: 'Price?', from: { id: 'p2', username: 'sam' }, media: { id: 'media1' } };
  const bad = res();
  await controller.receiveCommentWebhook({ params: { platform: 'ayrshare' }, query: { userId: String(user._id), token: 'x' }, body }, bad);
  assert.strictEqual(bad.code, 401);
  const good = res();
  await controller.receiveCommentWebhook({ params: { platform: 'ayrshare' }, query: { userId: String(user._id), token }, body }, good);
  assert.strictEqual(good.body.success, true);
  assert.strictEqual(Message.rows[0].messageType, 'comment');
  assert.strictEqual(Message.rows[0].commentId, 'cm1');
});

test('registering the webhook sends the token in both addresses and needs https', async () => {
  reset();
  const user = await makeUser();
  const refused = await inboxWebhook.registerInboxWebhook(user, { baseUrl: 'http://localhost:5000' });
  assert.strictEqual(refused.success, false);
  assert.strictEqual(calls.hook.length, 0);
  const done = await inboxWebhook.registerInboxWebhook(user, { baseUrl: 'https://app.example.test' });
  assert.strictEqual(done.success, true);
  const token = await inboxWebhook.ensureWebhookToken(user._id);
  assert.deepStrictEqual(calls.hook.map((h) => h.action), ['messages', 'comments']);
  calls.hook.forEach((h) => assert.ok(h.url.includes(`token=${token}`) && h.url.includes(`userId=${user._id}`)));
  assert.ok(!JSON.stringify(done).includes(token));
});

test('sync is honest: webhook mode, no pretend pull, no made-up times', async () => {
  const ok = service.syncPlatform('instagram');
  assert.deepStrictEqual(ok, { success: true, mode: 'webhook', platform: 'instagram', message: 'New comments and messages arrive on their own as soon as they are posted.' });
  assert.strictEqual(service.syncPlatform('youtube').success, false);
  const r = res();
  controller.syncPlatform({ params: { platform: 'instagram' }, user: { _id: 'x' } }, r);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(r.body.mode, 'webhook');
  assert.ok(!('queued' in r.body) && !('nextSync' in r.body));
  assert.strictEqual(typeof service.startInboxPolling, 'undefined');
});

test('summary has a pending count and no made-up next sync time', async () => {
  reset();
  const user = await makeUser({ ayrshare: { profileKey: 'PK', activeSocialAccounts: ['instagram'] } });
  await makeDraft(user);
  const summary = await service.getSummary(user);
  assert.strictEqual(summary.pendingCount, 1);
  assert.ok(!('nextSyncAt' in summary.syncStatus));
});

test('turning on automatic replies needs confirm:true; turning off does not', async () => {
  reset();
  const user = await makeUser();
  await assert.rejects(() => service.setAutoReplyToggle(user._id, { platform: 'instagram', channelType: 'comment', enabled: true }), (e) => e.statusCode === 400 && /confirm/i.test(e.message));
  const r = res();
  await controller.toggleAutoReply({ user: { _id: user._id }, body: { platform: 'instagram', channelType: 'comment', enabled: true } }, r);
  assert.strictEqual(r.code, 400);
  const on = await service.setAutoReplyToggle(user._id, { platform: 'instagram', channelType: 'comment', enabled: true, confirm: true });
  assert.strictEqual(on.automationMode, 'fully_automatic');
  const off = await service.setAutoReplyToggle(user._id, { platform: 'instagram', channelType: 'comment', enabled: false });
  assert.strictEqual(off.enabled, false);
  await assert.rejects(() => service.setAutoReplyToggle(user._id, { platform: 'linkedin', channelType: 'comment', enabled: true, confirm: true }), (e) => /not available yet/i.test(e.message));
  // The settings screen cannot be used to skip the confirmation.
  await Settings.findOneAndUpdate({ userId: user._id }, { $set: { automationMode: 'suggested' } });
  await assert.rejects(() => service.updateSettings(user._id, { automationMode: 'fully_automatic' }), (e) => e.statusCode === 400);
  const saved = await service.updateSettings(user._id, { automationMode: 'fully_automatic', confirm: true });
  assert.strictEqual(saved.automationMode, 'fully_automatic');
});

test('customers cannot add regex rules; a stored one can stay; assigned user is ignored', async () => {
  reset();
  const user = await makeUser();
  await assert.rejects(() => service.updateSettings(user._id, { responseRules: [{ name: 'x', matchType: 'regex', value: '(a+)+$' }] }), (e) => e.statusCode === 400);
  const storedId = new mongoose.Types.ObjectId();
  await Settings.create({ userId: user._id, responseRules: [{ _id: storedId, matchType: 'regex', value: 'old', enabled: true }] });
  const kept = await service.updateSettings(user._id, { responseRules: [{ _id: String(storedId), matchType: 'regex', value: 'old' }, { matchType: 'contains', value: 'price' }] });
  assert.strictEqual(kept.responseRules.length, 2);

  const conv = await makeConversation(user);
  const r = res();
  await controller.updateMeta({ user: { _id: user._id }, params: { id: String(conv._id) }, body: { tags: ['a'], priority: 'high', assignedUserId: String(new mongoose.Types.ObjectId()) } }, r);
  assert.strictEqual(r.body.success, true);
  assert.strictEqual(conv.assignedUserId, undefined);
  assert.deepStrictEqual(conv.tags, ['a']);
});

async function enableAutomatic(user) {
  llm = async () => ({ recommendedReply: 'Yes, it is. Would you like one?', suggestedReplies: ['Yes, it is. Would you like one?'], reason: 'test' });
  await Settings.create({
    userId: user._id, enabled: true, automationMode: 'fully_automatic',
    channels: { messages: true, comments: true, mentions: true, replies: true },
    platforms: { instagram: true, facebook: true, linkedin: true, x: true, youtube: true },
    guardrails: { requireApprovalForNegative: true, requireApprovalForHighPriority: true, skipSpam: true, maxAutoRepliesPerConversationPerDay: 3, signature: '' }
  });
}
const dmEvent = (user, over = {}) => service.normalizeWebhookPayload('instagram', user._id, { id: 'in-1', senderId: 'p1', senderDetails: { id: 'p1', username: 'pat' }, message: 'Is this available?', conversationId: 'th1', ...over });

test('automatic reply: a failed send is not marked replied, is not retried, and never goes out twice', async () => {
  reset();
  const user = await makeUser();
  await enableAutomatic(user);
  dmResult = { success: false, code: 0, error: 'down' };
  const event = dmEvent(user);
  const first = await service.ingestEvent(event);
  assert.strictEqual(calls.dm.length, 1);
  assert.strictEqual(first.message.ai.autoReplyStatus, 'failed');
  assert.strictEqual(first.message.autoReplied, false);
  assert.notStrictEqual(first.conversation.status, 'replied');
  const again = await service.ingestEvent(event);
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(calls.dm.length, 1, 'a repeated delivery does not try again');
  assert.strictEqual(calls.post.length, 0);
});

test('automatic reply: a good send goes out exactly once and the conversation is replied', async () => {
  reset();
  const user = await makeUser();
  await enableAutomatic(user);
  const event = dmEvent(user, { id: 'in-2', conversationId: 'th2' });
  const first = await service.ingestEvent(event);
  await service.ingestEvent(event);
  assert.strictEqual(calls.dm.length, 1);
  assert.strictEqual(first.message.ai.autoReplyStatus, 'sent');
  assert.strictEqual(first.conversation.status, 'replied');
});

test('platforms other than Instagram and Facebook are refused plainly and not stored', async () => {
  reset();
  const user = await makeUser();
  const out = await service.ingestEvent(service.normalizeWebhookPayload('linkedin', user._id, { id: 'l1', text: 'Hi', from: { id: 'x' } }));
  assert.strictEqual(out.success, false);
  assert.strictEqual(out.unsupported, true);
  assert.match(out.message, /not available yet/i);
  assert.strictEqual(Conversation.rows.length, 0);
});
