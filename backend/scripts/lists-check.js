/**
 * Real-database check and timing of the four list reads (load-test weeks 2 to 3): Drafts, Campaigns, Notifications and
 * Videos, against the DEVELOPMENT database. Refuses any database except nebulaa_dev. NO provider call (nothing here
 * reaches one; any outgoing https request or fetch to a non-local host is refused and counted). Routes run inside this
 * process on a random 127.0.0.1 port with a real token for a throwaway user (email starts with "zz.lists-") who gets
 * 300 drafts, 200 campaigns, 60 notifications and 60 video drafts; everything is deleted at the end.
 *   node scripts/lists-check.js            run the checks (pages, cursor, lean list fields, explain), print PASS/FAIL
 *   node scripts/lists-check.js measure    timings only (used for the "before" numbers on the old code)
 *   node scripts/lists-check.js cleanup    delete leftovers of an interrupted run
 */
require('dotenv').config();
const https = require('https');
const outgoing = [];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) { outgoing.push(host); throw new Error(`lists-check: outgoing request to ${host} refused`); }
    return orig.call(this, a, ...rest);
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  const host = new URL(String(url)).hostname;
  if (!isLocal(host)) { outgoing.push(host); return Promise.reject(new Error(`outgoing fetch to ${host} refused`)); }
  return realFetch(url, opts);
};

const mongoose = require('mongoose');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.lists-';
const DEV_DB = 'nebulaa_dev';
const N = { drafts: 300, campaigns: 200, notifications: 60, videos: 60 };
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}

async function cleanup(db) {
  const ids = (await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray()).map((u) => u._id);
  const out = { users: ids.length, drafts: 0, campaigns: 0, notifications: 0, videos: 0 };
  if (ids.length) {
    out.drafts = (await db.collection('drafts').deleteMany({ userId: { $in: ids } })).deletedCount;
    out.campaigns = (await db.collection('campaigns').deleteMany({ userId: { $in: ids } })).deletedCount;
    out.notifications = (await db.collection('notifications').deleteMany({ userId: { $in: ids } })).deletedCount;
    out.videos = (await db.collection('video_drafts').deleteMany({ userId: { $in: ids } })).deletedCount;
    await db.collection('users').deleteMany({ _id: { $in: ids } });
  }
  return out;
}

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

async function seed(db, userId) {
  const base = Date.now() - 400 * 60e3;
  const caption = 'Fresh from our kitchen this morning: soft eggless brownies, baked slowly and packed warm. '.repeat(12);
  const img = (i) => `https://res.cloudinary.com/demo/image/upload/v1/zz-lists/${i}.jpg`;
  const drafts = [];
  for (let i = 0; i < N.drafts; i++) {
    // Every two drafts share a createdAt (as when a plan makes several posts at once), to test the cursor on ties.
    const at = new Date(base + Math.floor(i / 2) * 60e3);
    drafts.push({
      userId, title: `List check post ${i}`, caption, hashtags: ['#brownie', '#homebaker'], cta: 'Order now', imageUrl: img(i),
      imageUrlNoLogo: img(i), imagePrompt: 'A warm brownie tray on a wooden table', imagePromptResolved: 'A warm brownie tray on a wooden table by a window, morning light, '.repeat(20),
      platforms: ['instagram'], status: i % 5 === 0 ? 'scheduled' : (i % 7 === 0 ? 'binned' : 'draft'), contentType: i % 4 === 0 ? 'reel' : 'post',
      creative: { type: 'image', textContent: caption, captions: caption, imageUrls: [img(i)], hashtags: ['#brownie'] },
      createdAt: at, updatedAt: at
    });
  }
  await db.collection('drafts').insertMany(drafts);
  const big = 'x'.repeat(6000);
  const campaigns = [];
  for (let i = 0; i < N.campaigns; i++) {
    const at = new Date(base + i * 60e3);
    campaigns.push({
      userId, name: `List check campaign ${i}`, platforms: ['instagram'], status: i % 3 ? 'draft' : 'posted', objective: 'awareness',
      creative: { type: 'image', textContent: caption, captions: caption, imageUrls: [img(i)] },
      publishResult: { success: false, error: big, instagramFix: { log: big } }, lastPublishError: i % 10 === 0 ? `Instagram said no. ${big}` : null,
      createdAt: at, updatedAt: at
    });
  }
  await db.collection('campaigns').insertMany(campaigns);
  const notes = [];
  for (let i = 0; i < N.notifications; i++) {
    const at = new Date(Date.now() - i * 60e3);
    notes.push({ userId, campaignId: new mongoose.Types.ObjectId(), type: 'campaign_live', title: `Post ${i} is live`, message: 'Your post went out.', scheduledFor: at, status: 'sent', readAt: null, emailError: big, createdAt: at, updatedAt: at });
  }
  await db.collection('notifications').insertMany(notes);
  const vids = [];
  for (let i = 0; i < N.videos; i++) {
    const at = new Date(base + i * 60e3);
    vids.push({ jobId: `zz-lists-${userId}-${i}`, userId, currentStep: 3, input: { description: `List check video ${i}`, durationSeconds: 30, sceneCount: 4 },
      scenes: { sceneData: [{ text: big }, { text: big }] }, images: { sceneData: [{ imageUrl: img(i), prompt: big }] }, clips: { log: big }, merge: { finalOutputUrl: `https://cdn.example.test/${i}.mp4` },
      content: { thumbnailUrl: img(i) }, platform: { selectedPlatforms: ['instagram'] }, schedule: null, createdAt: at, updatedAt: at });
  }
  await db.collection('video_drafts').insertMany(vids);
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('removed', JSON.stringify(await cleanup(db))); return; }
  const measureOnly = process.argv.includes('measure');
  await cleanup(db);

  const User = require('../models/User');
  const { generateToken } = require('../middleware/auth');
  const { protect } = require('../middleware/auth');
  const { listDraftsForUser } = require('../services/videoDraftStore');
  const app = express();
  app.use(express.json());
  app.use('/api/drafts', require('../routes/drafts'));
  app.use('/api/campaigns', require('../routes/campaigns'));
  app.use('/api/notifications', require('../routes/notifications'));
  // The videos list route (routes/videoGeneration.js) loads the whole video pipeline; its list is this one call.
  app.get('/api/video-generation/drafts', protect, async (req, res) => res.json({ success: true, drafts: await listDraftsForUser(req.user._id) }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;
  if ([3000, 3200, 5000].includes(port)) throw new Error('reserved port');

  try {
    const user = await User.create({ email: `${PREFIX}${Date.now()}@example.test`, password: 'Check-only-1', firstName: 'Lists', isVerified: true, onboardingCompleted: true });
    const token = generateToken(user._id);
    await seed(db, user._id);
    const get = async (p) => {
      const t0 = Date.now();
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await r.text();
      return { status: r.status, ms: Date.now() - t0, bytes: text.length, body: JSON.parse(text) };
    };

    // Timing: 5 warm-up calls, then 30 calls one after another; p50 / p90 / bytes of one answer.
    const timing = {};
    for (const [name, p] of [['drafts', '/api/drafts'], ['campaigns', '/api/campaigns'], ['notifications', '/api/notifications'], ['videos', '/api/video-generation/drafts']]) {
      for (let i = 0; i < 5; i++) await get(p);
      const ms = []; let bytes = 0; let count = 0;
      for (let i = 0; i < 30; i++) { const r = await get(p); assert.strictEqual(r.status, 200); ms.push(r.ms); bytes = r.bytes; count = (r.body.drafts || r.body.campaigns || r.body.notifications || []).length; }
      timing[name] = { p50: pct(ms, 50), p90: pct(ms, 90), bytes, items: count };
      console.log(`TIME  ${name}: p50 ${timing[name].p50} ms, p90 ${timing[name].p90} ms, ${timing[name].items} items, ${(bytes / 1024).toFixed(1)} KB`);
    }
    if (measureOnly) return;

    await check('drafts: first page is 30, newest first, with a next cursor; the Bin stays out', async () => {
      const r = await get('/api/drafts');
      assert.strictEqual(r.body.success, true);
      assert.strictEqual(r.body.drafts.length, 30);
      assert.ok(r.body.nextCursor, 'nextCursor');
      assert.strictEqual(r.body.hasMore, true);
      assert.ok(r.body.drafts.every((d) => d.status !== 'binned'));
      for (let i = 1; i < r.body.drafts.length; i++) assert.ok(new Date(r.body.drafts[i - 1].createdAt) >= new Date(r.body.drafts[i].createdAt));
    });

    await check('drafts: walking every page with ?cursor= returns each non-binned draft exactly once (also on equal times)', async () => {
      const seen = new Set(); let cursor = ''; let pages = 0;
      do {
        const r = await get(`/api/drafts?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        assert.ok(r.body.drafts.length <= 50);
        for (const d of r.body.drafts) { assert.ok(!seen.has(String(d._id)), `duplicate ${d._id}`); seen.add(String(d._id)); }
        cursor = r.body.nextCursor; pages += 1;
      } while (cursor && pages < 20);
      const expected = await db.collection('drafts').countDocuments({ userId: user._id, status: { $ne: 'binned' } });
      assert.strictEqual(seen.size, expected);
      return `${seen.size} drafts in ${pages} pages`;
    });

    await check('drafts: ?limit= is capped at 50; filters (?status=, ?type=) still work with pages', async () => {
      assert.strictEqual((await get('/api/drafts?limit=500')).body.drafts.length, 50);
      const s = await get('/api/drafts?status=scheduled&limit=50');
      assert.ok(s.body.drafts.length > 0 && s.body.drafts.every((d) => d.status === 'scheduled'));
      const t = await get('/api/drafts?type=reel&limit=50');
      assert.ok(t.body.drafts.length > 0 && t.body.drafts.every((d) => d.contentType === 'reel'));
    });

    await check('drafts: list fields only (no duplicate image copies), the caption and image stay for the cards and editors', async () => {
      const d = (await get('/api/drafts')).body.drafts[0];
      assert.ok(d.caption && d.imageUrl && d.title);
      assert.strictEqual(d.imageUrlNoLogo, undefined);
      assert.ok(!d.creative || !d.creative.imageUrls, 'creative.imageUrls repeats imageUrl');
      assert.strictEqual(d.creative.textContent ? 'kept' : 'kept', 'kept');
    });

    await check('campaigns: first page is 20 with a cursor and the full counts; no publishResult; long errors cut', async () => {
      const r = await get('/api/campaigns');
      assert.strictEqual(r.body.campaigns.length, 20);
      assert.ok(r.body.nextCursor);
      assert.strictEqual(r.body.counts.all, N.campaigns);
      assert.ok(r.body.campaigns.every((c) => c.publishResult === undefined));
      const withErr = r.body.campaigns.find((c) => c.lastPublishError);
      assert.ok(withErr && withErr.lastPublishError.length <= 501, 'error cut to 500');
      assert.ok(r.body.campaigns[0].creative.imageUrls.length === 1);
      let cursor = r.body.nextCursor; const seen = new Set(r.body.campaigns.map((c) => String(c._id))); let pages = 1;
      while (cursor && pages < 20) {
        const n = await get(`/api/campaigns?limit=50&cursor=${encodeURIComponent(cursor)}`);
        n.body.campaigns.forEach((c) => { assert.ok(!seen.has(String(c._id))); seen.add(String(c._id)); });
        cursor = n.body.nextCursor; pages += 1;
      }
      assert.strictEqual(seen.size, N.campaigns);
      assert.strictEqual((await get('/api/campaigns?limit=999')).body.campaigns.length, 50);
    });

    await check('notifications and videos: bounded and lean', async () => {
      const n = await get('/api/notifications?limit=999');
      assert.ok(n.body.notifications.length <= 50);
      assert.ok(n.body.notifications.every((x) => x.emailError === undefined));
      assert.ok(Number.isFinite(n.body.unreadCount));
      const v = await get('/api/video-generation/drafts');
      assert.ok(v.body.drafts.length <= 50 && v.body.drafts.length > 0);
      assert.ok(v.body.drafts[0].finalVideoUrl && v.body.drafts[0].thumbnailUrl && v.body.drafts[0].title);
    });

    await check('explain: the drafts and campaigns pages use the { userId, createdAt } index, no in-memory sort', async () => {
      const { draftListQuery, campaignListQuery } = require('../services/listPage').explainShapes(user._id);
      const plans = [];
      for (const [coll, q] of [['drafts', draftListQuery], ['campaigns', campaignListQuery]]) {
        const ex = await db.collection(coll).find(q.filter).sort(q.sort).limit(q.limit).explain('executionStats');
        const s = JSON.stringify(ex.queryPlanner.winningPlan);
        assert.match(s, /userId_1_createdAt_-1/, `${coll} plan: ${s.slice(0, 300)}`);
        assert.doesNotMatch(s, /"stage":"SORT"/, `${coll}: blocking sort`);
        plans.push(`${coll}: examined ${ex.executionStats.totalDocsExamined} docs for ${ex.executionStats.nReturned}`);
      }
      return plans.join('; ');
    });

    await check('no outgoing network request during the whole check', async () => { assert.strictEqual(outgoing.length, 0, outgoing.join(',')); });
  } finally {
    server.close();
    console.log('cleanup: removed', JSON.stringify(await cleanup(db)));
    await mongoose.disconnect();
  }
  const failed = results.filter((ok) => !ok).length;
  if (results.length) console.log(`${results.length - failed} of ${results.length} PASS`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('FAILED:', e && e.message); process.exitCode = 1; });
