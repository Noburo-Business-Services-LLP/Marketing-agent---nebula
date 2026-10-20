// D20: model drafts in the Inbox are counted in the spend guard and capped; the auto-reply daily cap is an atomic claim.
// Fakes only: no database, no provider, no model.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const mongoose = require('mongoose');
const { makeModel } = require('./helpers/fakeInboxDb');

function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const llmCalls = [];
let llm = async () => ({ recommendedReply: 'Yes, it is.', suggestedReplies: ['Yes, it is.', 'Sure.', 'Happy to help.'], reason: 'ok' });
const guardLog = { checks: [], records: [] };
let guardAllows = true;

const User = makeModel();
const Conversation = makeModel(() => ({ messages: [], status: 'unread', unreadCount: 1, messageTypes: [] }));
const Message = makeModel(() => ({ ai: {}, status: 'sent' }));
const DraftDay = makeModel(() => ({ count: 0 }));
const createDay = DraftDay.create.bind(DraftDay);
// Like the real unique index on (userId, day): a second row for the same day is refused.
DraftDay.create = async (data) => {
  if (DraftDay.rows.some((r) => String(r.userId) === String(data.userId) && r.day === data.day)) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; }
  return createDay(data);
};
const Settings = makeModel(() => ({
  enabled: false, automationMode: 'suggested',
  channels: { messages: true, comments: false, mentions: false, replies: false },
  platforms: { instagram: true }, responseRules: [], channelOverrides: [],
  guardrails: { requireApprovalForNegative: true, requireApprovalForHighPriority: true, skipSpam: true, maxAutoRepliesPerConversationPerDay: 3, signature: '' }
}));
Settings.findOneAndUpdate = async (q, update) => {
  let doc = await Settings.findOne(q);
  if (!doc) doc = await Settings.create(q);
  Object.entries(update.$set || {}).forEach(([k, v]) => { doc[k] = v; });
  return doc;
};

stub('models/User', User);
stub('models/SocialInboxConversation', Conversation);
stub('models/SocialInboxMessage', Message);
stub('models/AutoReplySettings', Settings);
stub('models/SocialInboxDraftDay', DraftDay);
stub('services/spendGuard', {
  check: async (a) => { guardLog.checks.push(a); return guardAllows ? { ok: true } : { ok: false }; },
  record: async (a, n) => { guardLog.records.push([a, n]); }
});
stub('services/llmRouter', { generateWithLLM: async (args) => { llmCalls.push(args); return llm(args); } });
stub('services/socketHub', { emitToUser: () => {}, addSseSubscriber: () => () => {}, isSocketReady: () => false });
stub('services/socialMediaAPI', {
  replyToAyrshareComment: async () => ({ success: true, replyId: 'rc' }),
  sendAyrshareDirectMessage: async () => ({ success: true, messageId: 'dm' }),
  postToSocialMedia: async () => ({ success: true }),
  setAyrshareWebhook: async () => ({ success: true })
});

const service = require('../services/socialInboxService');
const limits = require('../config/socialInbox');

const quiet = { log: console.log, warn: console.warn, error: console.error };
test.before(() => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; });
test.after(() => { Object.assign(console, quiet); });
test.beforeEach(() => {
  [User, Conversation, Message, DraftDay, Settings].forEach((m) => m.reset());
  llmCalls.length = 0; guardLog.checks.length = 0; guardLog.records.length = 0; guardAllows = true;
  llm = async () => ({ recommendedReply: 'Yes, it is.', suggestedReplies: ['Yes, it is.', 'Sure.', 'Happy to help.'], reason: 'ok' });
});

let n = 0;
const event = (user, over = {}) => ({
  userId: user._id, platform: 'instagram', messageType: 'message', providerThreadId: 'thread-1', providerMessageId: `pm-${++n}`,
  participantId: 'p1', participantName: 'Asha', body: 'Is this available?', occurredAt: new Date(), ...over
});

test('success: guard checked once before the call and one unit recorded', async () => {
  const user = await User.create({});
  const out = await service.ingestEvent(event(user));
  assert.equal(llmCalls.length, 1);
  assert.deepEqual(guardLog.checks, ['campaign_text']);
  assert.deepEqual(guardLog.records, [['campaign_text', 1]]);
  assert.equal(out.message.ai.autoReplyStatus, 'suggested');
  assert.equal(out.message.ai.draftSource, 'ai');
});

test('guard blocked: no model call, message stored, draft paused with the plain note', async () => {
  guardAllows = false;
  const user = await User.create({});
  const out = await service.ingestEvent(event(user));
  assert.equal(llmCalls.length, 0);
  assert.equal(guardLog.records.length, 0);
  assert.equal(Message.rows.length, 1);
  assert.equal(out.message.ai.autoReplyStatus, 'paused');
  assert.equal(out.message.ai.autoReplyReason, 'Draft paused for now');
  assert.deepEqual(out.message.ai.suggestedReplies, []);
  assert.equal(DraftDay.rows.length, 0, 'a blocked draft does not use up the account cap');
});

test('a failed model call is not recorded as spend', async () => {
  llm = async () => { throw new Error('down'); };
  const user = await User.create({});
  const out = await service.ingestEvent(event(user));
  assert.equal(guardLog.records.length, 0);
  assert.equal(out.message.ai.draftSource, 'fallback');
});

test('per-conversation cap: the 11th draft in an hour is paused, stored and shown', async () => {
  const user = await User.create({});
  for (let i = 0; i < limits.DRAFTS_PER_CONVERSATION_PER_HOUR; i += 1) await service.ingestEvent(event(user));
  assert.equal(llmCalls.length, 10);
  const out = await service.ingestEvent(event(user));
  assert.equal(llmCalls.length, 10);
  assert.equal(Message.rows.length, 11);
  assert.equal(out.message.ai.autoReplyStatus, 'paused');
  assert.equal(guardLog.records.length, 10);
});

test('per-conversation window restarts after an hour', async () => {
  const conv = await Conversation.create({ userId: new mongoose.Types.ObjectId() });
  const t0 = new Date('2026-10-20T10:00:00Z');
  for (let i = 0; i < 10; i += 1) assert.equal(await service.claimConversationDraft(conv._id, t0), true);
  assert.equal(await service.claimConversationDraft(conv._id, t0), false);
  assert.equal(await service.claimConversationDraft(conv._id, new Date(t0.getTime() + 3600001)), true);
});

test('per-account daily cap: counted per India day, and paused beyond it', async () => {
  const user = await User.create({});
  await DraftDay.create({ userId: user._id, day: new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10), count: limits.DRAFTS_PER_ACCOUNT_PER_DAY });
  const out = await service.ingestEvent(event(user));
  assert.equal(llmCalls.length, 0);
  assert.equal(out.message.ai.autoReplyStatus, 'paused');
  assert.equal(Message.rows.length, 1);
});

test('account claims: simultaneous messages pass exactly up to the cap, and the India day rolls at 18:30 UTC', async () => {
  const uid = new mongoose.Types.ObjectId();
  const now = new Date('2026-10-20T10:00:00Z');
  const results = await Promise.all(Array.from({ length: 12 }, () => service.claimAccountDraft(uid, now, 5)));
  assert.equal(results.filter(Boolean).length, 5);
  assert.equal(await service.claimAccountDraft(uid, new Date('2026-10-20T18:29:00Z'), 5), false);
  assert.equal(await service.claimAccountDraft(uid, new Date('2026-10-20T18:31:00Z'), 5), true);
});

test('auto-reply claims: simultaneous messages pass exactly up to the cap', async () => {
  const conv = await Conversation.create({ userId: new mongoose.Types.ObjectId() });
  const results = await Promise.all(Array.from({ length: 8 }, () => service.claimAutoReply(conv._id, 3)));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await service.claimAutoReply(conv._id, 3), false);
  // a new day starts a new count
  assert.equal(await service.claimAutoReply(conv._id, 3, new Date(Date.now() + 36 * 3600000)), true);
});

test('fully automatic: the 4th message in a day is held for approval, the first three are sent', async () => {
  const user = await User.create({ ayrshare: { profileKey: 'PK' } });
  await Settings.create({
    userId: user._id, enabled: true, automationMode: 'fully_automatic',
    channels: { messages: true, comments: false, mentions: false, replies: false },
    platforms: { instagram: true }, responseRules: [], channelOverrides: [],
    guardrails: { requireApprovalForNegative: true, requireApprovalForHighPriority: true, skipSpam: true, maxAutoRepliesPerConversationPerDay: 3, signature: '' }
  });
  const outs = [];
  for (let i = 0; i < 4; i += 1) outs.push(await service.ingestEvent(event(user)));
  const statuses = outs.map((o) => o.message.ai.autoReplyStatus);
  assert.equal(statuses.filter((s) => s === 'sent').length, 3);
  assert.equal(statuses[3], 'pending_approval');
});

test('below the caps nothing changes: suggest-only message gets its draft and no claim on the auto-reply counter', async () => {
  const user = await User.create({});
  const out = await service.ingestEvent(event(user));
  assert.equal(out.message.ai.autoReplyStatus, 'suggested');
  assert.equal(out.conversation.autoReplyClaim, undefined);
});
