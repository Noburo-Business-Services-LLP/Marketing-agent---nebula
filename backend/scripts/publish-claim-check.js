/**
 * Real-database check of the per-campaign publish claim (D107), against the DEVELOPMENT database. Refuses any database
 * except nebulaa_dev. NO provider call: the publisher is a counting fake injected before the scheduler loads, and any
 * outgoing https request or fetch to a non-local host is refused and counted. Throwaway users (email starts with
 * "zz.pubclaim-") and their campaigns, deleted at the end; the scheduler's campaign query is scoped to them, so no other
 * dev row is touched. Exit code is non-zero on any FAIL or when anything is left behind.
 *   node scripts/publish-claim-check.js          run, print PASS/FAIL, clean up
 *   node scripts/publish-claim-check.js cleanup  delete leftovers of an interrupted run
 * Shows, on real MongoDB: 8 claimers at once on one campaign give exactly one winner; an expired claim is taken over; a
 * stale holder's late write changes nothing; a failed send frees the claim; the real scheduler sends a due campaign once
 * even when two ticks run together.
 */
require('dotenv').config();
const https = require('https');
const path = require('path');
const outgoing = [];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) { outgoing.push(host); throw new Error(`publish-claim-check: outgoing request to ${host} refused`); }
    return orig.call(this, a, ...rest);
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  const host = new URL(String(url)).hostname;
  if (!isLocal(host)) { outgoing.push(host); return Promise.reject(new Error(`outgoing fetch to ${host} refused`)); }
  return realFetch(url, opts);
};

// The publisher and the helpers around the scheduler are fakes, injected before the scheduler loads.
const sent = [];
let publisherImpl = async () => ({ success: true, postId: 'fake-post', platformPostIds: {}, data: { fake: true } });
const stub = (rel, exports) => {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
stub('services/campaignPublisher', { publishCampaignToSocial: async (c) => { sent.push(String(c._id)); return publisherImpl(c); } });
stub('services/aiCampaignLearning', { learnCampaignPublish: async () => {} });
stub('services/backgroundGate', { blockedAccountIdsSafe: async () => [] });
stub('services/socialMediaAPI', { getPostStatus: async () => ({ success: false }) });

const mongoose = require('mongoose');
const assert = require('assert');

const PREFIX = 'zz.pubclaim-';
const DEV_DB = 'nebulaa_dev';
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}

async function cleanup(db) {
  const ids = (await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray()).map((u) => u._id);
  let campaigns = 0;
  if (ids.length) {
    campaigns = (await db.collection('campaigns').deleteMany({ userId: { $in: ids } })).deletedCount;
    await db.collection('drafts').deleteMany({ userId: { $in: ids } });
    await db.collection('users').deleteMany({ _id: { $in: ids } });
  }
  return { users: ids.length, campaigns };
}
const leftover = async (db) => {
  const users = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } });
  return users;
};

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('removed', await cleanup(db)); return; }
  await cleanup(db);

  const User = require('../models/User');
  const Campaign = require('../models/Campaign');
  const claims = require('../services/publishClaim');
  // The scheduler looks up a linked Draft by campaignId (no index on the shared dev cluster: a full scan). These
  // throwaway campaigns have none, so the lookup is answered without touching the database.
  const Draft = require('../models/Draft');
  Draft.findOne = () => { const p = Promise.resolve(null); p.select = () => p; p.lean = () => p; return p; };
  const stamp = Date.now();
  const user = await User.create({ email: `${PREFIX}own-${stamp}@example.test`, password: 'Check-only-1', firstName: 'Claim', isVerified: true, onboardingCompleted: true, plan: { tier: 'starter' }, ayrshare: { profileKey: 'FAKE-PROFILE-KEY' } });
  const ours = [user._id];
  const mk = (n, extra = {}) => ({ userId: user._id, name: `Claim check ${n}`, platforms: ['instagram'], status: 'scheduled', scheduling: { startDate: new Date(Date.now() - 3600e3), frequency: 'once' }, createdAt: new Date(), updatedAt: new Date(), ...extra });
  const ids = (await db.collection('campaigns').insertMany([1, 2, 3, 4, 5].map((n) => mk(n)))).insertedIds;
  const id = (n) => ids[n - 1];
  const rowOf = (n) => db.collection('campaigns').findOne({ _id: id(n), userId: { $in: ours } });

  try {
    await check('8 claimers at once on one campaign: exactly one wins', async () => {
      const rs = await Promise.all(Array.from({ length: 8 }, () => claims.claim(Campaign, id(1), { statuses: ['scheduled'] })));
      assert.strictEqual(rs.filter((r) => r.claimed).length, 1);
      const row = await rowOf(1);
      assert.ok(row.publishClaim && row.publishClaim.by && row.publishClaim.until > new Date());
      assert.strictEqual(row.status, 'scheduled', 'the claim is not a status');
      return '1 of 8';
    });

    await check('expired claim is taken over; the stale holder cannot record or fail anything', async () => {
      const old = await rowOf(1);
      // age the claim: until in the past
      await db.collection('campaigns').updateOne({ _id: id(1), userId: { $in: ours } }, { $set: { 'publishClaim.until': new Date(Date.now() - 1000) } });
      const second = await claims.claim(Campaign, id(1), { statuses: ['scheduled'] });
      assert.ok(second.claimed && second.tookOver);
      assert.strictEqual(await claims.finish(Campaign, id(1), old.publishClaim.by, { status: 'posted', socialPostId: 'STALE' }), false);
      assert.strictEqual(await claims.fail(Campaign, id(1), old.publishClaim.by, { lastPublishError: 'late' }), false);
      const row = await rowOf(1);
      assert.strictEqual(row.status, 'scheduled');
      assert.strictEqual(row.socialPostId, undefined);
      assert.strictEqual(await claims.finish(Campaign, id(1), second.token, { status: 'posted', socialPostId: 'NEW' }), true);
      const done = await rowOf(1);
      assert.strictEqual(done.status, 'posted');
      assert.strictEqual(done.socialPostId, 'NEW');
      assert.strictEqual(done.publishClaim, undefined);
    });

    await check('a failed send frees the claim so a retry can claim again', async () => {
      const a = await claims.claim(Campaign, id(2), { statuses: ['scheduled'] });
      assert.ok(a.claimed);
      assert.strictEqual((await claims.claim(Campaign, id(2), { statuses: ['scheduled'] })).claimed, false);
      assert.strictEqual(await claims.fail(Campaign, id(2), a.token, { lastPublishError: 'fake', publishFailureCount: 1 }), true);
      assert.strictEqual((await claims.claim(Campaign, id(2), { statuses: ['scheduled'] })).claimed, true);
    });

    await check('the real scheduler, two ticks at once: the due campaign is sent exactly once', async () => {
      const origFind = Campaign.find.bind(Campaign);
      Campaign.find = (q, ...rest) => origFind({ $and: [q, { userId: { $in: ours } }] }, ...rest);
      try {
        // rows 1 (posted) and 2 (claimed above) are out of the way; 3 is the one under test, 4 and 5 are made not due
        await db.collection('campaigns').updateMany({ _id: { $in: [id(2), id(4), id(5)] }, userId: { $in: ours } }, { $set: { status: 'draft' }, $unset: { publishClaim: '' } });
        sent.length = 0;
        publisherImpl = async () => { await new Promise((r) => setTimeout(r, 300)); return { success: true, postId: 'fake-post-3', platformPostIds: {}, data: { fake: true } }; };
        const { processDueCampaigns } = require('../services/campaignScheduler');
        const quiet = console.warn; console.warn = () => {};
        try { await Promise.all([processDueCampaigns(), processDueCampaigns()]); } finally { console.warn = quiet; }
        assert.deepStrictEqual(sent, [String(id(3))]);
        const row = await rowOf(3);
        assert.strictEqual(row.status, 'posted');
        assert.strictEqual(row.socialPostId, 'fake-post-3');
        assert.strictEqual(row.publishClaim, undefined);
      } finally { Campaign.find = origFind; }
    });

    await check('a live claim from elsewhere makes the scheduler skip; an expired one is taken over', async () => {
      const origFind = Campaign.find.bind(Campaign);
      Campaign.find = (q, ...rest) => origFind({ $and: [q, { userId: { $in: ours } }] }, ...rest);
      try {
        await db.collection('campaigns').updateOne({ _id: id(4), userId: { $in: ours } }, { $set: { status: 'scheduled', publishClaim: { by: 'other', at: new Date(), until: new Date(Date.now() + 600e3) } } });
        sent.length = 0;
        publisherImpl = async () => ({ success: true, postId: 'fake-post-4', platformPostIds: {}, data: {} });
        const { processDueCampaigns } = require('../services/campaignScheduler');
        const quiet = console.warn; console.warn = () => {};
        try {
          await processDueCampaigns();
          assert.deepStrictEqual(sent, []);
          await db.collection('campaigns').updateOne({ _id: id(4), userId: { $in: ours } }, { $set: { 'publishClaim.until': new Date(Date.now() - 1000) } });
          await processDueCampaigns();
        } finally { console.warn = quiet; }
        assert.deepStrictEqual(sent, [String(id(4))]);
        assert.strictEqual((await rowOf(4)).status, 'posted');
      } finally { Campaign.find = origFind; }
    });

    await check('no outgoing network request during the whole check', async () => { assert.strictEqual(outgoing.length, 0, outgoing.join(',')); });
  } finally {
    console.log('cleanup: removed', JSON.stringify(await cleanup(db)));
    const left = await leftover(db);
    const leftCampaigns = await db.collection('campaigns').countDocuments({ userId: { $in: ours } });
    if (left || leftCampaigns) { results.push(false); console.log(`FAIL  leftover: ${left} users, ${leftCampaigns} campaigns`); }
    await mongoose.disconnect();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`${results.length - failed} of ${results.length} PASS`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('FAILED:', e && e.message); process.exitCode = 1; });
