/**
 * Real-database check of the Inbox second pass (docs/superpowers/impact-maps/inbox-reviews.md) against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO provider and NO model call: the publishing provider (webhook registration,
 * replies), the model router and the live socket are fakes loaded before the inbox code (every call is counted).
 * Throwaway users are named "zz.inboxcheck-..." and are deleted with their conversations, messages and settings at the end.
 *   node scripts/inbox-view-check.js            run the checks, print PASS/FAIL, clean up (exit 1 on any FAIL or leftover)
 *   node scripts/inbox-view-check.js cleanup    delete leftovers of an interrupted run and print what is left
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const assert = require('assert');

const PREFIX = 'zz.inboxcheck-';
const results = [];
const calls = { hook: 0, send: 0, llm: 0 };
let hookOk = true;
let llm = async () => { throw new Error('no model in this check'); };

// Fakes first, so the inbox code never reaches the provider or a model.
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('services/socialMediaAPI', {
  setAyrshareWebhook: async () => { calls.hook += 1; return { success: hookOk }; },
  replyToAyrshareComment: async () => { calls.send += 1; return { success: true, replyId: 'zz' }; },
  sendAyrshareDirectMessage: async () => { calls.send += 1; return { success: true, messageId: 'zz' }; },
  postToSocialMedia: async () => { calls.send += 1; throw new Error('never posts'); }
});
stub('services/llmRouter', { generateWithLLM: async (a) => { calls.llm += 1; return llm(a); } });
stub('services/socketHub', { emitToUser: () => {}, addSseSubscriber: () => () => {}, isSocketReady: () => false });

async function check(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`FAIL  ${name}: ${e && e.message}`); }
}

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}, not nebulaa_dev`);
}

async function cleanup() {
  const User = require('../models/User');
  const Conv = require('../models/SocialInboxConversation');
  const Msg = require('../models/SocialInboxMessage');
  const Settings = require('../models/AutoReplySettings');
  const rx = { $regex: `^${PREFIX.replace(/\./g, '\\.')}` };
  const ids = (await User.find({ email: rx }).select('_id').lean()).map((u) => u._id);
  const removed = {
    messages: ids.length ? (await Msg.deleteMany({ userId: { $in: ids } })).deletedCount : 0,
    conversations: ids.length ? (await Conv.deleteMany({ userId: { $in: ids } })).deletedCount : 0,
    settings: ids.length ? (await Settings.deleteMany({ userId: { $in: ids } })).deletedCount : 0,
    users: ids.length ? (await User.deleteMany({ _id: { $in: ids } })).deletedCount : 0
  };
  console.log('removed', JSON.stringify(removed));
  const left = (await User.countDocuments({ email: rx }))
    + (ids.length ? await Msg.countDocuments({ userId: { $in: ids } }) + await Conv.countDocuments({ userId: { $in: ids } }) + await Settings.countDocuments({ userId: { $in: ids } }) : 0);
  console.log('left', left);
  return left;
}

async function runChecks() {
  const User = require('../models/User');
  const service = require('../services/socialInboxService');
  const inboxWebhook = require('../services/inboxWebhook');
  const googleReviews = require('../services/googleReviews');
  const tag = `${PREFIX}${Date.now().toString(36)}`;
  const mkUser = (s, ayrshare) => User.create({
    email: `${tag}-${s}@example.test`, password: 'Check-only-1', firstName: `Check ${s}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'professional', addons: ['publish', 'inbox'] }, ayrshare
  });
  const dm = (user, id, text = 'Is this available?') => service.normalizeWebhookPayload('instagram', user._id, {
    id: `${tag}-${id}`, senderId: 'p1', senderDetails: { id: 'p1', username: 'zz.person' }, message: text, conversationId: `${tag}-th-${id}`
  });

  const live = await mkUser('live', { profileKey: 'zz-not-a-real-key', activeSocialAccounts: ['instagram', 'gmb'], lastCheckedAt: new Date() });

  await check('a connection never registered reads as live updates off and needs setup', async () => {
    const s = await service.getSummary(await User.findById(live._id));
    assert.strictEqual(s.liveUpdates, 'off');
    assert.strictEqual(s.inboxStatus, 'needs_setup');
    assert.strictEqual(s.reviewsConnected, true);
  });

  await check('a failed registration is stored and read back as failed', async () => {
    hookOk = false;
    const r = await inboxWebhook.registerInboxWebhook(await User.findById(live._id), { baseUrl: 'https://check.example.test' });
    assert.strictEqual(r.success, false);
    const fresh = await User.findById(live._id).lean();
    assert.ok(fresh.ayrshare.inboxWebhookError, 'error stored');
    assert.ok(!fresh.ayrshare.inboxWebhookAt, 'no success time');
    assert.strictEqual((await service.getSummary(await User.findById(live._id))).liveUpdates, 'failed');
  });

  await check('a registration that works is stored, read back as on, and kept after a later failure', async () => {
    hookOk = true;
    assert.strictEqual((await inboxWebhook.registerInboxWebhook(await User.findById(live._id), { baseUrl: 'https://check.example.test' })).success, true);
    let fresh = await User.findById(live._id).lean();
    assert.ok(fresh.ayrshare.inboxWebhookAt instanceof Date);
    assert.strictEqual(fresh.ayrshare.inboxWebhookError, '');
    let s = await service.getSummary(await User.findById(live._id));
    assert.deepStrictEqual([s.liveUpdates, s.inboxStatus, s.webhookStatus.registered], ['on', 'active', true]);
    hookOk = false;
    await inboxWebhook.registerInboxWebhook(await User.findById(live._id), { baseUrl: 'https://check.example.test' });
    s = await service.getSummary(await User.findById(live._id));
    assert.strictEqual(s.liveUpdates, 'on');
    hookOk = true;
    return `${calls.hook} fake registration calls`;
  });

  await check('the webhook token stays hidden from normal reads', async () => {
    const plain = await User.findById(live._id).lean();
    assert.strictEqual(plain.ayrshare.webhookToken, undefined);
  });

  await check('reviews: the Google profile is found from the stored accounts; a provider failure reads as could not load', async () => {
    let fetched = 0;
    const user = await User.findById(live._id).lean();
    const v = await googleReviews.reviewsView({ user, fetchReviews: async () => { fetched += 1; return { success: false, reviews: [] }; } });
    assert.deepStrictEqual([v.connected, v.loadFailed, fetched], [true, true, 1]);
    const other = await mkUser('nogoogle', { profileKey: 'zz-not-a-real-key', activeSocialAccounts: ['facebook'], lastCheckedAt: new Date() });
    const n = await googleReviews.reviewsView({ user: await User.findById(other._id).lean(), fetchReviews: async () => { fetched += 1; return { success: true, reviews: [] }; } });
    assert.deepStrictEqual([n.connected, fetched], [false, 1], 'no provider call without a Google profile');
  });

  await check('a general reply is stored as fallback and the thread says general', async () => {
    const out = await service.ingestEvent(dm(live, 'g1'));
    const Msg = require('../models/SocialInboxMessage');
    const stored = await Msg.findById(out.message._id).lean();
    assert.strictEqual(stored.ai.draftSource, 'fallback');
    const t = await service.getConversationThread(live._id, out.conversation._id);
    assert.strictEqual(t.ai.suggestionsSource, 'general');
    t.ai.suggestions.forEach((x) => assert.doesNotMatch(x, /is available|in stock/i));
  });

  await check('with Fully automatic on, a general reply waits for approval and nothing is sent', async () => {
    const Settings = require('../models/AutoReplySettings');
    await Settings.findOneAndUpdate({ userId: live._id }, { $set: { enabled: true, automationMode: 'fully_automatic', platforms: { instagram: true, facebook: true }, channels: { messages: true, comments: true, mentions: false, replies: false } } }, { upsert: true, new: true });
    const before = calls.send;
    const out = await service.ingestEvent(dm(live, 'g2'));
    assert.strictEqual(calls.send, before, 'nothing sent');
    assert.strictEqual(out.message.ai.autoReplyStatus, 'pending_approval');
    const pending = await service.listPendingApprovals(live._id);
    assert.ok(pending.some((p) => p.id === String(out.message._id)), 'in the approval list');
  });

  await check('a drafted reply is stored as ai, the thread says drafted, and Fully automatic sends it once (fake send)', async () => {
    llm = async () => ({ recommendedReply: 'Yes. Shall we keep one for you?', suggestedReplies: ['Yes. Shall we keep one for you?'], reason: 'check' });
    const before = calls.send;
    const out = await service.ingestEvent(dm(live, 'd1'));
    const Msg = require('../models/SocialInboxMessage');
    const stored = await Msg.findById(out.message._id).lean();
    assert.strictEqual(stored.ai.draftSource, 'ai');
    assert.strictEqual(calls.send, before + 1);
    const t = await service.getConversationThread(live._id, out.conversation._id);
    assert.strictEqual(t.ai.suggestionsSource, 'drafted');
    return `${calls.llm} fake model calls, ${calls.send} fake sends, 0 real`;
  });
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/inbox-view-check.js [run|cleanup]');
  await connect();
  console.log('Database: nebulaa_dev');
  let failed = false;
  try { if (mode === 'run') await runChecks(); } catch (e) { failed = true; console.log(`FAIL  (script) ${e && e.stack ? e.stack : e}`); }
  console.log('--- cleanup ---');
  const left = await cleanup();
  const fails = results.filter((r) => !r.ok).length;
  if (mode === 'run') console.log(`\n${results.length - fails} PASS, ${fails} FAIL; left after cleanup: ${left}`);
  if (fails || left || failed) process.exitCode = 1;
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
