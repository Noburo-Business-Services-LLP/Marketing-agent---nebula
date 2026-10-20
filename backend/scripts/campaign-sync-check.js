/**
 * Real-database check of the campaigns status sync (load-test week 1), against the DEVELOPMENT database. Refuses any
 * database except nebulaa_dev. NO provider call: every Ayrshare function is replaced by a counting fake before the
 * routes load, and any outgoing https request or fetch to a non-local host is refused and counted. Routes run inside
 * this process on a random 127.0.0.1 port, with a real token for throwaway users (email starts with "zz.campsync-"),
 * deleted at the end with their campaigns and the check's own lease row.
 *   node scripts/campaign-sync-check.js          run, print PASS/FAIL, clean up
 *   node scripts/campaign-sync-check.js cleanup  delete leftovers of an interrupted run
 * What it shows: GET /api/campaigns answers with past-due scheduled posts unchanged and makes zero provider calls; the
 * background job updates them (posted / back to draft / still pending), one batch at a time, under a single-runner
 * lease, and never asks about an account without its own social profile.
 */
require('dotenv').config();
const https = require('https');
const outgoing = [];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) { outgoing.push(host); throw new Error(`campaign-sync-check: outgoing request to ${host} refused`); }
    return orig.call(this, a, ...rest);
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  const host = new URL(String(url)).hostname;
  if (!isLocal(host)) { outgoing.push(host); return Promise.reject(new Error(`outgoing fetch to ${host} refused`)); }
  return realFetch(url, opts);
};

// Every Ayrshare function is a counting fake: the GET must never reach one.
const social = require('../services/socialMediaAPI');
const providerCalls = [];
for (const k of Object.keys(social)) {
  if (typeof social[k] === 'function') social[k] = async (...a) => { providerCalls.push(k); return { success: false, error: 'fake' }; };
}

const mongoose = require('mongoose');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.campsync-';
const DEV_DB = 'nebulaa_dev';
const LEASE_KEY = 'campaign_status_sync_lease_check';
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
  const lease = (await db.collection('ops_state').deleteMany({ key: LEASE_KEY })).deletedCount;
  return { users: ids.length, campaigns, lease };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('removed', await cleanup(db)); return; }
  await cleanup(db);

  const User = require('../models/User');
  const Campaign = require('../models/Campaign');
  const { generateToken } = require('../middleware/auth');
  const { createLease } = require('../services/competitors/lease');
  const { runCampaignStatusSyncOnce } = require('../services/campaignStatusSync');
  const app = express();
  app.use(express.json());
  app.use('/api/campaigns', require('../routes/campaigns'));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;
  if ([3000, 3200, 5000].includes(port)) throw new Error('reserved port');

  try {
    const stamp = Date.now();
    const owner = await User.create({ email: `${PREFIX}own-${stamp}@example.test`, password: 'Check-only-1', firstName: 'Sync', isVerified: true, onboardingCompleted: true, plan: { tier: 'starter' }, ayrshare: { profileKey: 'FAKE-PROFILE-KEY' } });
    const nokey = await User.create({ email: `${PREFIX}nokey-${stamp}@example.test`, password: 'Check-only-1', firstName: 'Nokey', isVerified: true, onboardingCompleted: true, plan: { tier: 'starter' } });
    const token = generateToken(owner._id);
    const ours = [owner._id, nokey._id];
    const past = new Date(Date.now() - 2 * 3600e3);
    const mk = (userId, n, extra = {}) => ({ userId, name: `Sync check ${n}`, platforms: ['facebook'], status: 'scheduled', scheduledFor: past, socialPostId: `fake-ayr-${stamp}-${n}`, createdAt: new Date(stamp - n * 1000), updatedAt: new Date(), ...extra });
    // 1 posted, 2 failed, 3 still pending, 4 and 5 more past-due rows (for the batch), 6 belongs to the account without a key.
    await db.collection('campaigns').insertMany([1, 2, 3, 4, 5].map((n) => mk(owner._id, n)).concat([mk(nokey._id, 6)]));
    const get = async () => { const r = await fetch(`http://127.0.0.1:${port}/api/campaigns`, { headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, body: await r.json() }; };
    // Always by userId (indexed): the dev campaigns collection is slow to scan (large documents).
    const rowOf = (n) => db.collection('campaigns').findOne({ userId: { $in: ours }, socialPostId: `fake-ayr-${stamp}-${n}` });
    const statusOf = async (n) => (await rowOf(n)).status;

    await check('GET /api/campaigns: lists the past-due posts unchanged and makes zero provider calls', async () => {
      providerCalls.length = 0;
      const t0 = Date.now();
      const r = await get();
      const ms = Date.now() - t0;
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.campaigns.length, 5);
      assert.ok(r.body.campaigns.every((c) => c.status === 'scheduled'));
      assert.strictEqual(r.body.counts.scheduled, 5);
      assert.strictEqual(providerCalls.length, 0, `provider calls: ${providerCalls.join(',')}`);
      assert.strictEqual(outgoing.length, 0);
      for (const n of [1, 2, 3, 4, 5]) assert.strictEqual(await statusOf(n), 'scheduled');
      return `${ms} ms, 0 provider calls`;
    });

    // The job, with a fake Ayrshare status answer, scoped to this check's accounts (the dev database has other rows).
    const fakeAnswers = {
      [`fake-ayr-${stamp}-1`]: { success: true, data: { status: 'success' } },
      [`fake-ayr-${stamp}-2`]: { success: true, data: { status: 'error', message: 'Fake failure for the check' } }
    };
    const asked = [];
    const scoped = {
      find: (q) => Campaign.find({ $and: [q, { userId: { $in: ours } }] }),
      updateOne: (...a) => Campaign.updateOne(...a)
    };
    const deps = {
      Campaign: scoped,
      getPostStatus: async (id, opts) => { asked.push({ id, profileKey: opts.profileKey }); return fakeAnswers[id] || { success: true, data: { status: 'scheduled' } }; },
      retryAyrsharePost: async () => { throw new Error('no retry in this check'); },
      publishCampaignToSocial: async () => { throw new Error('no re-post in this check'); }
    };
    const run = (lease, batch) => runCampaignStatusSyncOnce({ deps, lease, batch, log: { log() {} } });

    await check('lease: while another runner holds it, the job reads nothing and asks nothing', async () => {
      const other = createLease({ key: LEASE_KEY, ttlMs: 60000, holder: 'other-runner' });
      const held = await other.claim(new Date());
      assert.ok(held, 'could not claim the check lease');
      const out = await run(createLease({ key: LEASE_KEY, ttlMs: 60000, holder: 'this-runner' }), 10);
      assert.strictEqual(out.skippedRun, true);
      assert.strictEqual(asked.length, 0);
      await other.release(held);
    });

    await check('bounded batch: one run looks at 3 rows only; the account without a profile is never asked', async () => {
      const out = await run(createLease({ key: LEASE_KEY, ttlMs: 60000 }), 3);
      assert.strictEqual(out.checked + out.skippedNoProfile, 3);
      assert.ok(asked.every((a) => a.profileKey === 'FAKE-PROFILE-KEY'));
      assert.ok(!asked.some((a) => a.id.endsWith('-6')));
      return `checked ${out.checked}, no profile ${out.skippedNoProfile}`;
    });

    await check('the job (not the GET) updates past-due posts: posted, back to draft with the reason, still pending', async () => {
      await run(createLease({ key: LEASE_KEY, ttlMs: 60000 }), 10);
      assert.strictEqual(await statusOf(1), 'posted');
      assert.strictEqual(await statusOf(2), 'draft');
      const failed = await rowOf(2);
      assert.match(failed.lastPublishError, /Fake failure for the check/);
      for (const n of [3, 4, 5, 6]) assert.strictEqual(await statusOf(n), 'scheduled');
      assert.strictEqual(new Set(asked.map((a) => a.id)).size, 5, 'each of the 5 own rows asked once');
      const stamped = await db.collection('campaigns').countDocuments({ userId: { $in: ours }, ayrshareCheckedAt: { $ne: null } });
      assert.strictEqual(stamped, 6);
      const r = await get();
      assert.strictEqual(r.body.counts.posted, 1);
      assert.strictEqual(r.body.counts.draft, 1);
      assert.strictEqual(providerCalls.length, 0);
    });

    await check('no outgoing network request to any provider during the whole check', async () => {
      assert.strictEqual(outgoing.length, 0, outgoing.join(','));
      assert.strictEqual(providerCalls.length, 0);
    });
  } finally {
    server.close();
    console.log('cleanup: removed', JSON.stringify(await cleanup(db)));
    await mongoose.disconnect();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`${results.length - failed} of ${results.length} PASS`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('FAILED:', e && e.message); process.exitCode = 1; });
