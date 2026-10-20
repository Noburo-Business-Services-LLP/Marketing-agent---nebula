// Inbox second pass (docs/superpowers/impact-maps/inbox-reviews.md): the backend keeps what the screens promise.
// Fakes only: no database, no provider, no model. Every outside module is replaced before the inbox code loads.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { makeModel } = require('./helpers/fakeInboxDb');

const calls = { dm: [], comment: [], hook: [], llm: [] };
let hookResult = { success: true };
let llm = async () => { throw new Error('no AI in tests'); };

function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const User = makeModel();
const Conversation = makeModel(() => ({ messages: [], status: 'unread', unreadCount: 1, messageTypes: [] }));
const Message = makeModel(() => ({ ai: {}, status: 'sent' }));
const Settings = makeModel(() => ({
  enabled: false, automationMode: 'suggested',
  channels: { messages: true, comments: false, mentions: false, replies: false },
  platforms: { instagram: true, facebook: true }, responseRules: [], channelOverrides: [],
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
stub('services/llmRouter', { generateWithLLM: async (args) => { calls.llm.push(args); return llm(args); } });
stub('services/socketHub', { emitToUser: () => {}, addSseSubscriber: () => () => {}, isSocketReady: () => false });
stub('services/socialMediaAPI', {
  replyToAyrshareComment: async (a) => { calls.comment.push(a); return { success: true, replyId: 'r1' }; },
  sendAyrshareDirectMessage: async (a) => { calls.dm.push(a); return { success: true, messageId: 'd1' }; },
  postToSocialMedia: async () => { throw new Error('never posts'); },
  setAyrshareWebhook: async (profileKey, url, action) => { calls.hook.push({ profileKey, action }); return hookResult; }
});

const service = require('../services/socialInboxService');
const controller = require('../controllers/socialInboxController');
const inboxWebhook = require('../services/inboxWebhook');
const googleReviews = require('../services/googleReviews');

const quiet = { log: console.log, warn: console.warn, error: console.error };
test.before(() => { console.log = () => {}; console.warn = () => {}; console.error = () => {}; });
test.after(() => { Object.assign(console, quiet); });

function reset() {
  [User, Conversation, Message, Settings].forEach((m) => m.reset());
  Object.values(calls).forEach((a) => { a.length = 0; });
  hookResult = { success: true };
  llm = async () => { throw new Error('no AI in tests'); };
}
const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const goodDraft = async () => ({ recommendedReply: 'Yes, it is in stock. Shall we keep one for you?', suggestedReplies: ['Yes, it is in stock.', 'Shall we keep one for you?'], reason: 'Asked about stock' });
async function automatic(user) {
  await Settings.create({
    userId: user._id, enabled: true, automationMode: 'fully_automatic',
    channels: { messages: true, comments: true, mentions: true, replies: true }, platforms: { instagram: true, facebook: true },
    guardrails: { requireApprovalForNegative: true, requireApprovalForHighPriority: true, skipSpam: true, maxAutoRepliesPerConversationPerDay: 3, signature: '' }
  });
}
const dm = (user, id = 'in-1') => service.normalizeWebhookPayload('instagram', user._id, { id, senderId: 'p1', senderDetails: { id: 'p1', username: 'pat' }, message: 'Is this available?', conversationId: `th-${id}` });

// ---- developer endpoints ----

test('the developer endpoints answer 404 in production and store nothing', async () => {
  reset();
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const user = await User.create({});
    for (const handler of [controller.devIngest, controller.testWebhook]) {
      const r = res();
      await handler({ user: { _id: user._id }, body: { platform: 'instagram', message: 'Hi' }, params: {}, query: {} }, r);
      assert.strictEqual(r.code, 404);
    }
    assert.strictEqual(Conversation.rows.length, 0);
    assert.strictEqual(calls.llm.length, 0, 'no model call');
  } finally {
    process.env.NODE_ENV = before;
  }
});

test('the developer endpoints still work outside production', async () => {
  reset();
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const user = await User.create({});
    const r = res();
    await controller.devIngest({ user: { _id: user._id }, body: { platform: 'instagram', text: 'Hi', id: 'd1', from: { id: 'x' } }, params: {}, query: {} }, r);
    assert.strictEqual(r.code, 200);
    assert.strictEqual(Conversation.rows.length, 1);
  } finally {
    process.env.NODE_ENV = before;
  }
});

// ---- live updates (webhook registration) ----

test('registering live updates records the result; the summary says on, off or failed', async () => {
  reset();
  const user = await User.create({ ayrshare: { profileKey: 'PK', activeSocialAccounts: ['instagram'] } });
  let summary = await service.getSummary(user);
  assert.strictEqual(summary.liveUpdates, 'off');
  assert.strictEqual(summary.inboxStatus, 'needs_setup', 'a connection that never registered is not shown as working');

  hookResult = { success: false };
  const failed = await inboxWebhook.registerInboxWebhook(user, { baseUrl: 'https://app.example.test' });
  assert.strictEqual(failed.success, false);
  summary = await service.getSummary(await User.findById(user._id));
  assert.strictEqual(summary.liveUpdates, 'failed');
  assert.strictEqual(summary.webhookStatus.registered, false);

  hookResult = { success: true };
  const done = await inboxWebhook.registerInboxWebhook(user, { baseUrl: 'https://app.example.test' });
  assert.strictEqual(done.success, true);
  const fresh = await User.findById(user._id);
  assert.ok(fresh.ayrshare.inboxWebhookAt instanceof Date);
  assert.strictEqual(fresh.ayrshare.inboxWebhookError, '');
  summary = await service.getSummary(fresh);
  assert.strictEqual(summary.liveUpdates, 'on');
  assert.strictEqual(summary.inboxStatus, 'active');
  assert.strictEqual(summary.webhookStatus.registered, true);

  // A later failed try does not undo a registration that worked (the earlier hooks keep the same token).
  hookResult = { success: false };
  await inboxWebhook.registerInboxWebhook(fresh, { baseUrl: 'https://app.example.test' });
  summary = await service.getSummary(await User.findById(user._id));
  assert.strictEqual(summary.liveUpdates, 'on');
});

test('a missing public address is recorded as a failed registration, without a provider call', async () => {
  reset();
  const user = await User.create({ ayrshare: { profileKey: 'PK', activeSocialAccounts: ['facebook'] } });
  const out = await inboxWebhook.registerInboxWebhook(user, { baseUrl: '' });
  assert.strictEqual(out.success, false);
  assert.strictEqual(calls.hook.length, 0);
  assert.strictEqual((await service.getSummary(await User.findById(user._id))).liveUpdates, 'failed');
});

test('without Instagram or Facebook the summary says off and disabled', async () => {
  reset();
  const user = await User.create({ ayrshare: { profileKey: 'PK', activeSocialAccounts: ['gmb'], inboxWebhookAt: new Date() } });
  const summary = await service.getSummary(user);
  assert.strictEqual(summary.inboxStatus, 'disabled');
  assert.strictEqual(summary.liveUpdates, 'off');
  assert.strictEqual(summary.reviewsConnected, true);
});

test('the summary says whether a Google Business Profile is connected', async () => {
  reset();
  assert.strictEqual((await service.getSummary(await User.create({ ayrshare: { activeSocialAccounts: ['instagram'] } }))).reviewsConnected, false);
  assert.strictEqual((await service.getSummary(await User.create({ connectedSocials: [{ platform: 'Google Business' }] }))).reviewsConnected, true);
});

// ---- drafted replies ----

test('when the writing service fails the general reply waits for approval and is never sent on its own', async () => {
  reset();
  const user = await User.create({ ayrshare: { profileKey: 'PK' } });
  await automatic(user);
  const out = await service.ingestEvent(dm(user));
  assert.strictEqual(calls.dm.length, 0, 'nothing sent');
  assert.strictEqual(out.message.ai.autoReplyStatus, 'pending_approval');
  assert.match(out.message.ai.autoReplyReason, /could not be drafted in your tone/);
  assert.strictEqual(out.message.ai.draftSource, 'fallback');
  const pending = await service.listPendingApprovals(user._id);
  assert.strictEqual(pending.length, 1);
});

test('a reply drafted by the writing service still goes out once in Fully automatic', async () => {
  reset();
  llm = goodDraft;
  const user = await User.create({ ayrshare: { profileKey: 'PK' } });
  await automatic(user);
  const out = await service.ingestEvent(dm(user, 'in-2'));
  assert.strictEqual(calls.dm.length, 1);
  assert.strictEqual(out.message.ai.autoReplyStatus, 'sent');
  assert.strictEqual(out.message.ai.draftSource, 'ai');
});

test('general replies never claim stock, prices or availability', () => {
  for (const text of ['Is this available?', 'I want a refund, this is broken', 'price?', 'hello']) {
    for (const s of service.analyzeEngagement(text).suggestions) {
      assert.doesNotMatch(s, /\bis available\b|in stock|we have it|price is/i, s);
    }
  }
});

test('the reply prompt asks for the language of the person\'s message', async () => {
  reset();
  llm = goodDraft;
  const user = await User.create({ ayrshare: { profileKey: 'PK' } });
  await service.ingestEvent(dm(user, 'in-3'));
  assert.strictEqual(calls.llm.length, 1);
  assert.match(calls.llm[0].prompt, /same language as the latest incoming message/i);
});

test('the thread says whether its suggestions were drafted for it or are general ones', async () => {
  reset();
  const user = await User.create({ ayrshare: { profileKey: 'PK' } });
  const general = await service.ingestEvent(dm(user, 'in-4'));
  const t1 = await service.getConversationThread(user._id, general.conversation._id);
  assert.strictEqual(t1.ai.suggestionsSource, 'general');
  llm = goodDraft;
  const drafted = await service.ingestEvent(dm(user, 'in-5'));
  const t2 = await service.getConversationThread(user._id, drafted.conversation._id);
  assert.strictEqual(t2.ai.suggestionsSource, 'drafted');
  assert.deepStrictEqual(t2.ai.suggestions, ['Yes, it is in stock.', 'Shall we keep one for you?']);
});

// ---- Google reviews ----

test('reviews: no Google profile means no provider call and "not connected"', async () => {
  let fetched = 0;
  const out = await googleReviews.reviewsView({
    user: { ayrshare: { profileKey: 'PK', activeSocialAccounts: ['instagram'], lastCheckedAt: new Date() } },
    fetchReviews: async () => { fetched += 1; return { success: true, reviews: [] }; }
  });
  assert.strictEqual(fetched, 0);
  assert.deepStrictEqual([out.connected, out.loadFailed], [false, false]);
});

test('reviews: a connected profile whose reviews fail to load says so, not "not connected"', async () => {
  const out = await googleReviews.reviewsView({
    user: { ayrshare: { profileKey: 'PK', activeSocialAccounts: ['gmb'] } },
    fetchReviews: async () => ({ success: false, reason: 'provider_error', reviews: [] })
  });
  assert.deepStrictEqual([out.connected, out.loadFailed, out.reviews.length], [true, true, 0]);
  assert.match(out.message, /could not be loaded/);
});

test('reviews: a connected profile lists reviews with the approval flag and the summary', async () => {
  const out = await googleReviews.reviewsView({
    user: { connectedSocials: [{ platform: 'google business' }], ayrshare: { profileKey: 'PK' } },
    fetchReviews: async () => ({ success: true, reviews: [{ id: 'a', rating: 2, text: 'Late', reviewer: 'Sam' }], summary: { averageRating: 4.1, totalReviewCount: 9 } })
  });
  assert.deepStrictEqual([out.connected, out.loadFailed], [true, false]);
  assert.strictEqual(out.reviews[0].needsApproval, true);
  assert.deepStrictEqual(out.summary, { averageRating: 4.1, totalReviewCount: 9 });
});

test('reviews: accounts never checked are asked once; a failure there reads as not connected', async () => {
  let fetched = 0;
  const out = await googleReviews.reviewsView({
    user: { ayrshare: { profileKey: 'PK', activeSocialAccounts: [], lastCheckedAt: null } },
    fetchReviews: async () => { fetched += 1; return { success: false, reviews: [] }; }
  });
  assert.strictEqual(fetched, 1);
  assert.deepStrictEqual([out.connected, out.loadFailed], [false, false]);
  const none = await googleReviews.reviewsView({ user: { ayrshare: {} }, fetchReviews: async () => { fetched += 1; return { success: true, reviews: [] }; } });
  assert.strictEqual(none.connected, false, 'no profile key: nothing to ask');
  assert.strictEqual(fetched, 1);
});

test('after a reply goes out, the thread still offers the drafts for the person\'s latest message', async () => {
  reset();
  llm = goodDraft;
  const user = await User.create({ ayrshare: { profileKey: 'PK' } });
  await automatic(user);
  const out = await service.ingestEvent(dm(user, 'in-6'));
  assert.strictEqual(calls.dm.length, 1, 'the automatic reply went out');
  const t = await service.getConversationThread(user._id, out.conversation._id);
  assert.strictEqual(t.ai.suggestionsSource, 'drafted');
  assert.deepStrictEqual(t.ai.suggestions, ['Yes, it is in stock.', 'Shall we keep one for you?']);
});
