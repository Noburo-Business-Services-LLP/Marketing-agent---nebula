/**
 * Real-database check of the per-post metrics fix against the DEVELOPMENT database. Refuses any database except nebulaa_dev.
 * NO AI call, NO outside call. Seeds rows through the real tracker path (aiMemoryService.trackPerformance) with answers that
 * hold figures in rawAnalytics only, then checks the stored `metrics`, the Performance view numbers, and the backfill script
 * on old-shape rows (zeros in metrics) of a second throwaway user.
 *   node scripts/performance-metrics-check.js          run, print PASS/FAIL, delete everything it made
 *   node scripts/performance-metrics-check.js cleanup  delete leftovers of an interrupted run
 * Throwaway users have emails starting "zz.permetchk-". Exit code is non-zero on any FAIL or any leftover.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const PREFIX = 'zz.permetchk-';
const DEV_DB = 'nebulaa_dev';
const DAY = 864e5;
const OWNED = { ai_content_performance: 'userId', campaigns: 'userId', aibrandmemories: 'userId' };

const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`FAIL  ${name}: ${e && e.message}`); }
}
function assertDevDatabase(name) { if (name !== DEV_DB) throw new Error(`Refusing: database is ${name}, not ${DEV_DB}`); }
async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder).');
  const named = (process.env.MONGODB_URI.match(/^mongodb(?:\+srv)?:\/\/[^/]*\/([^?]*)/) || [])[1] || '';
  assertDevDatabase(named);
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  assertDevDatabase(mongoose.connection.name);
}
const emailRe = `^${PREFIX.replace(/\./g, '\\.')}`;
async function cleanup(db) {
  const users = await db.collection('users').find({ email: { $regex: emailRe } }, { projection: { _id: 1 } }).toArray();
  const ids = users.map((u) => u._id);
  const removed = {};
  if (ids.length) {
    for (const [c, f] of Object.entries(OWNED)) { const n = (await db.collection(c).deleteMany({ [f]: { $in: ids } })).deletedCount; if (n) removed[c] = n; }
    const n = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount; if (n) removed.users = n;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {};
  for (const [c, f] of Object.entries(OWNED)) left[c] = ids.length ? await db.collection(c).countDocuments({ [f]: { $in: ids } }) : 0;
  left.users = await db.collection('users').countDocuments({ email: { $regex: emailRe } });
  console.log('left', JSON.stringify(left));
  return { removedTotal: Object.values(removed).reduce((a, b) => a + b, 0), left };
}

// Answers as the publishing service gives them; the expected metrics are written out here by hand.
const CASES = [
  { platform: 'instagram', raw: { status: 'success', instagram: { analytics: { likeCount: 120, commentsCount: 14, sharesCount: 6, savedCount: 10, reachCount: 2400, impressionsCount: 3000, viewsCount: 3100 }, postUrl: 'https://www.instagram.com/p/zzmet1' } }, expect: { likes: 120, comments: 14, shares: 6, saves: 10, reach: 2400, impressions: 3000, views: 3100, clicks: 0, engagement: 150, engagementRate: 5 } },
  { platform: 'facebook', raw: { status: 'success', facebook: { analytics: { reactions: { like: 30, total: 41 }, commentCount: 5, shareCount: 3, impressionsUnique: 800, clickCount: 22 }, postUrl: 'https://www.facebook.com/p/zzmet2' } }, expect: { likes: 41, comments: 5, shares: 3, saves: 0, reach: 800, impressions: 0, views: 0, clicks: 22, engagement: 49, engagementRate: 6.13 } },
  { platform: 'linkedin', raw: { status: 'success', linkedin: { analytics: { likeCount: '18', commentCount: 2, shareCount: 1, uniqueImpressionsCount: 500, impressionCount: 700, clickCount: 14 }, postUrl: 'https://www.linkedin.com/p/zzmet3' } }, expect: { likes: 18, comments: 2, shares: 1, saves: 0, reach: 500, impressions: 700, views: 0, clicks: 14, engagement: 21, engagementRate: 3 } },
  { platform: 'twitter', raw: { status: 'success', twitter: { analytics: { likeCount: 9, replyCount: 0, retweetCount: 2, impressionCount: 400 }, postUrl: 'https://x.com/p/zzmet4' } }, expect: { likes: 9, comments: 0, shares: 2, saves: 0, reach: 0, impressions: 400, views: 0, clicks: 0, engagement: 11, engagementRate: 2.75 } }
];

async function runChecks() {
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const Campaign = require('../models/Campaign');
  const legal = require('../config/legalVersions');
  const { generateToken } = require('../middleware/auth');
  const { trackPerformance } = require('../services/aiMemoryService');
  const { forgetAccount } = require('../services/performance/cache');
  const backfill = require('./backfill-performance-metrics');

  await check('a database that is not nebulaa_dev is refused, and the live one is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  const tag = `${PREFIX}${Date.now()}`;
  const mk = (s) => User.create({
    email: `${tag}-${s}@example.test`, password: 'Check-only-1', firstName: `Check ${s}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['publish'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `Metrics Check ${s}`, website: 'https://example.com', description: 'Hand poured soy candles', targetAudience: 'Young homeowners' },
    connectedSocials: [{ platform: 'instagram', username: 'zz.permetchk' }], credits: { balance: 600 }
  });
  const fresh = await mk('fresh');
  const legacy = await mk('legacy');

  const app = express();
  app.use(express.json());
  app.use('/api/analytics', require('../routes/analytics'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.ok(port !== 3000 && port !== 5000);
  const view = async (u) => {
    forgetAccount(u._id);
    const res = await fetch(`http://127.0.0.1:${port}/api/analytics/performance?range=month&refresh=1`, { headers: { Authorization: `Bearer ${generateToken(u._id)}` } });
    assert.strictEqual(res.status, 200);
    return res.json();
  };

  try {
    const seedCampaigns = (u) => Campaign.insertMany(CASES.map((c, i) => ({ userId: u._id, name: `Metrics post ${i}`, status: 'posted', platforms: [c.platform], creative: { type: 'image', imageUrls: [`https://res.cloudinary.com/demo/image/upload/zzmet${i}.jpg`], captions: 'Check caption' }, publishedAt: new Date(Date.now() - (i + 2) * DAY), publishResult: { postIds: [{ platform: c.platform, postUrl: c.raw[c.platform].postUrl }] } })));
    const freshCamps = await seedCampaigns(fresh);
    const legacyCamps = await seedCampaigns(legacy);

    // Fresh user: through the real tracker path (no metrics passed, only rawAnalytics, as the tracker does).
    for (let i = 0; i < CASES.length; i++) {
      const doc = await trackPerformance({ userId: fresh._id, campaignId: freshCamps[i]._id, postId: `zzmet-fresh-${i}`, platform: CASES[i].platform, rawAnalytics: CASES[i].raw, publishedAt: freshCamps[i].publishedAt });
      assert.ok(doc, `trackPerformance saved nothing for ${CASES[i].platform}`);
    }
    // Legacy user: old shape, zeros in metrics, same answers.
    await db.collection('ai_content_performance').insertMany(CASES.map((c, i) => ({
      organizationId: String(legacy._id), userId: legacy._id, campaignId: legacyCamps[i]._id, platform: c.platform, postId: `zzmet-legacy-${i}`, contentType: 'post',
      metrics: { likes: 0, views: 0, comments: 0, shares: 0, saves: 0, clicks: 0, impressions: 0, reach: 0, ctr: 0, engagement: 0, engagementRate: 0, conversions: 0, spend: 0 },
      learning: { score: 0, tier: 'low' }, rawAnalytics: c.raw, publishedAt: legacyCamps[i].publishedAt, measuredAt: new Date()
    })));

    await check('rows saved by the tracker path hold the figures from rawAnalytics, equal to the hand-written expectations', async () => {
      const rows = await db.collection('ai_content_performance').find({ userId: fresh._id }).toArray();
      assert.strictEqual(rows.length, CASES.length);
      for (const c of CASES) {
        const r = rows.find((x) => x.platform === c.platform);
        for (const [k, v] of Object.entries(c.expect)) assert.strictEqual(r.metrics[k], v, `${c.platform}.${k}: ${r.metrics[k]} vs ${v}`);
        assert.ok(r.learning.score > 0, `${c.platform} learning score should be above 0`);
      }
      return `${rows.length} platforms`;
    });

    const vFresh = await view(fresh);
    const vLegacyBefore = await view(legacy);
    const pick = (v) => ({ likes: v.overall.likes.value, posts: v.overall.postsMeasured, byPlatform: Object.fromEntries(v.platforms.filter((p) => p.state !== 'notconnected').map((p) => [p.platform, p.metrics.likes && p.metrics.likes.value])) });

    await check('the view shows the same numbers for the new rows as for the old rows read from rawAnalytics', async () => {
      assert.deepStrictEqual(pick(vFresh), pick(vLegacyBefore));
      assert.strictEqual(pick(vFresh).likes, 120 + 41 + 18 + 9);
      return `likes ${pick(vFresh).likes}`;
    });

    const run = (env) => spawnSync(process.execPath, [path.join(__dirname, 'backfill-performance-metrics.js')], { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });
    await check('the backfill dry run reports the 4 old rows and writes nothing', async () => {
      const r = run({ ONLY_USER: String(legacy._id), CONFIRM_BACKFILL: '' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stdout, /DRY RUN/);
      assert.match(r.stdout, /4 would change/);
      const rows = await db.collection('ai_content_performance').find({ userId: legacy._id }).toArray();
      assert.ok(rows.every((x) => x.metrics.likes === 0 && x.metrics.reach === 0));
    });
    await check('the backfill with CONFIRM_BACKFILL=yes recomputes the old rows to the same figures, and a second run changes nothing', async () => {
      const r = run({ ONLY_USER: String(legacy._id), CONFIRM_BACKFILL: 'yes' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stdout, /4 recomputed, 4 written/);
      const rows = await db.collection('ai_content_performance').find({ userId: legacy._id }).toArray();
      for (const c of CASES) { const x = rows.find((y) => y.platform === c.platform); for (const [k, v] of Object.entries(c.expect)) assert.strictEqual(x.metrics[k], v, `${c.platform}.${k}`); assert.ok(x.learning.score > 0); assert.deepStrictEqual(x.rawAnalytics, c.raw); }
      const again = run({ ONLY_USER: String(legacy._id), CONFIRM_BACKFILL: 'yes' });
      assert.match(again.stdout, /0 recomputed, 0 written/);
    });
    await check('the view numbers are unchanged after the backfill', async () => {
      const after = await view(legacy);
      assert.deepStrictEqual(pick(after), pick(vLegacyBefore));
      const tops = (v) => Object.fromEntries(Object.entries(v.topPosts.lists).map(([k, l]) => [k, l.posts.map((p) => `${p.platform}:${p.value !== undefined ? p.value : ''}`)]));
      assert.ok(tops(after).likes.length > 0, 'the likes list should not be empty');
      assert.deepStrictEqual(tops(after), tops(vLegacyBefore));
    });
    await check('no other user\'s rows were touched (the script is limited to the throwaway user)', async () => {
      const r = run({ ONLY_USER: String(fresh._id), CONFIRM_BACKFILL: '' });
      assert.match(r.stdout, /0 would change/);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/performance-metrics-check.js [run|cleanup]');
  await connect();
  console.log(`Database: ${DEV_DB}`);
  let failed = false;
  try { if (mode === 'run') await runChecks(); }
  catch (e) { failed = true; console.log(`FAIL  (script) ${e && e.stack ? e.stack : e}`); }
  finally {
    console.log('--- cleanup ---');
    const out = await cleanup(mongoose.connection.db);
    const left = Object.values(out.left).reduce((a, b) => a + b, 0);
    if (mode === 'run') {
      const fails = results.filter((r) => !r.ok);
      console.log(`\n${results.length - fails.length} PASS, ${fails.length} FAIL; removed by cleanup: ${out.removedTotal}; left after cleanup: ${left}`);
      if (fails.length || left || failed) process.exitCode = 1;
    } else if (left) process.exitCode = 1;
  }
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
