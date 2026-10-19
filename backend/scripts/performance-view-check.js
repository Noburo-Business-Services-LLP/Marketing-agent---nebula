/**
 * Real-database check of GET /api/analytics/performance against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO AI call, NO outside call: the view only reads Mongo; the route runs inside
 * this process on a random 127.0.0.1 port (never 3000 or 5000), with real tokens for throwaway users.
 *   node scripts/performance-view-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/performance-view-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.perfchk-" (and the client workspace of the
 * throwaway agency, found by its owner). Exit code is non-zero on any FAIL, or if anything is left over.
 * Expected numbers are counted here from the seeded rows with plain loops (not the view's helpers).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.perfchk-';
const DEV_DB = 'nebulaa_dev';
const DAY = 864e5;

const results = [];
let section = '';
const note = (s) => console.log(`      ${s}`);
async function check(name, fn) {
  const label = `${section} ${name}`;
  try {
    const detail = await fn();
    results.push({ label, ok: true });
    console.log(`PASS  ${label}${detail ? ` (${detail})` : ''}`);
  } catch (e) {
    results.push({ label, ok: false, error: e && e.message });
    console.log(`FAIL  ${label}: ${e && e.message}`);
  }
}

function assertDevDatabase(name) {
  if (name !== DEV_DB) throw new Error(`Refusing: database is ${name}, not ${DEV_DB}`);
}
async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  assertDevDatabase(mongoose.connection.name);
}

const OWNED = { socialsnapshots: 'userId', ai_content_performance: 'userId', campaigns: 'userId' };
async function throwawayIds(db) {
  const base = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  const owners = base.map((u) => u._id);
  const clients = owners.length ? await db.collection('users').find({ 'agency.ownerId': { $in: owners } }, { projection: { _id: 1 } }).toArray() : [];
  return [...owners, ...clients.map((u) => u._id)];
}
async function cleanup(db) {
  const ids = await throwawayIds(db);
  const removed = {};
  if (ids.length) {
    for (const [c, field] of Object.entries(OWNED)) {
      const n = (await db.collection(c).deleteMany({ [field]: { $in: ids } })).deletedCount;
      if (n) removed[c] = n;
    }
    const n = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
    if (n) removed.users = n;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {};
  for (const [c, field] of Object.entries(OWNED)) left[c] = ids.length ? await db.collection(c).countDocuments({ [field]: { $in: ids } }) : 0;
  left.users = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }) + (ids.length ? await db.collection('users').countDocuments({ _id: { $in: ids } }) : 0);
  console.log('left', JSON.stringify(left));
  return { removed, left, removedTotal: Object.values(removed).reduce((a, b) => a + b, 0) };
}

// Plain-loop helpers for the expected numbers.
const utcMidnight = (msAgo) => { const d = new Date(Date.now() - msAgo); d.setUTCHours(0, 0, 0, 0); return d; };
const forbidden = /[!—]|credit|trial|7 days/i;

async function runChecks() {
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const Campaign = require('../models/Campaign');
  const Snapshot = require('../models/SocialSnapshot');
  const Perf = require('../models/AIContentPerformance');
  const legal = require('../config/legalVersions');
  const { generateToken } = require('../middleware/auth');
  const { createWorkspace, issueAgencyPass } = require('../services/agencyWorkspaces');
  const perfRouter = require('../routes/performanceView');
  const { forgetAccount } = require('../services/performance/cache');

  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  const tag = `${PREFIX}${Date.now()}`;
  const mkUser = (suffix, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['publish'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `Perf Check ${suffix}`, website: 'https://example.com', description: 'Hand poured soy candles', targetAudience: 'Young homeowners' },
    connectedSocials: [{ platform: 'instagram', username: 'zz.perfchk' }, { platform: 'facebook', accountName: 'Perf Check' }],
    credits: { balance: 600 },
    ...extra
  });

  const app = express();
  app.use(express.json());
  app.use('/api/analytics', require('../routes/analytics'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.ok(port !== 3000 && port !== 5000);
  note(`in-process server on 127.0.0.1:${port}`);
  const get = async (path, token) => {
    const t0 = process.hrtime.bigint();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: res.status, body, ms: Number(process.hrtime.bigint() - t0) / 1e6, bytes: Buffer.byteLength(text) };
  };
  const view = async (u, q = '') => { const r = await get(`/api/analytics/performance${q}`, generateToken(u._id)); assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

  try {
    // ================================================================================================================
    // Seed. "main": Instagram and Facebook connected, 100 days of daily numbers, 24 published posts over 100 days with
    // measurements in the publishing service's shape (zeros in metrics, the answer in rawAnalytics), LinkedIn numbers
    // left from an old connection. "other": its own posts and numbers, never visible to main.
    // ================================================================================================================
    const main = await mkUser('main');
    const other = await mkUser('other');
    const snaps = [];
    for (let d = 100; d >= 0; d--) {
      snaps.push({ userId: main._id, date: utcMidnight(d * DAY), platforms: { instagram: { followers: 5000 + (100 - d) * 10, reach: 2000 + d, engagementRate: 3 + (d % 3) / 10, likes: 1 }, facebook: { followers: 800 + (100 - d), reach: 0, engagementRate: 0, likes: 800 }, linkedin: { followers: 300, reach: 90, engagementRate: 1 } }, totals: { followers: 0, reach: 0 } });
      snaps.push({ userId: other._id, date: utcMidnight(d * DAY), platforms: { instagram: { followers: 99999, reach: 77777, engagementRate: 9 } }, totals: {} });
    }
    await Snapshot.insertMany(snaps);

    const types = ['reel', 'image', 'carousel', 'image'];
    const camps = [];
    for (let i = 0; i < 24; i++) {
      const platform = i % 3 === 2 ? 'facebook' : 'instagram';
      camps.push({ userId: main._id, name: `Perf post ${i}`, status: 'posted', platforms: [platform], creative: { type: types[i % 4], imageUrls: [`https://res.cloudinary.com/demo/image/upload/zzperf${i}.jpg`], captions: i % 2 ? 'Short one' : 'A long caption '.repeat(12) }, publishedAt: new Date(Date.now() - (i * 4 + 1) * DAY - (i % 5) * 3600e3), publishResult: { postIds: [{ platform, postUrl: `https://www.${platform}.com/p/zzperf${i}` }] } });
    }
    camps.push({ userId: main._id, name: 'Not published', status: 'scheduled', platforms: ['instagram'], creative: { type: 'image' }, scheduledFor: new Date(Date.now() + DAY) });
    const otherCamps = [...Array(6)].map((_, i) => ({ userId: other._id, name: `Secret other post ${i}`, status: 'posted', platforms: ['instagram'], creative: { type: 'reel' }, publishedAt: new Date(Date.now() - (i + 1) * DAY) }));
    const inserted = await Campaign.insertMany([...camps, ...otherCamps]);
    const mainPosted = inserted.filter((c) => String(c.userId) === String(main._id) && c.status === 'posted');
    const otherPosted = inserted.filter((c) => String(c.userId) === String(other._id));
    const rawFor = (platform, i) => (platform === 'facebook'
      ? { status: 'success', facebook: { analytics: { reactions: { like: 10 + i, total: 12 + i }, commentCount: i % 4, sharesCount: 1, impressionsUnique: 300 + i * 5 }, postUrl: `https://www.facebook.com/p/zzperf${i}` } }
      : { status: 'success', instagram: { analytics: { likeCount: 50 + i * 7 + (i % 4 === 0 ? 120 : 0), commentsCount: i % 6, sharesCount: i % 3, savedCount: i % 2, reachCount: 1000 + i * 40 }, postUrl: `https://www.instagram.com/p/zzperf${i}` } });
    const perfRows = mainPosted.map((c, i) => ({
      organizationId: String(main._id), userId: main._id, campaignId: c._id, platform: c.platforms[0], postId: `zzperf-post-${i}`, contentType: 'post', caption: c.creative.captions,
      metrics: { likes: 0, comments: 0, shares: 0, reach: 0 }, rawAnalytics: rawFor(c.platforms[0], i), publishedAt: c.publishedAt, measuredAt: new Date()
    }));
    // Two posts are published but not measured yet: they count as published, not as measured.
    const measuredRows = perfRows.filter((_, i) => i !== 0 && i !== 5);
    await Perf.insertMany([
      ...measuredRows,
      ...otherPosted.map((c, i) => ({ organizationId: String(other._id), userId: other._id, campaignId: c._id, platform: 'instagram', postId: `zzperf-other-${i}`, rawAnalytics: { instagram: { analytics: { likeCount: 90000 + i } } }, publishedAt: c.publishedAt }))
    ]);
    note(`seeded ${snaps.length} snapshots, ${inserted.length} campaigns, ${measuredRows.length + otherPosted.length} measured rows`);

    // Independent expectations.
    const now = Date.now();
    const inRange = (t, days) => t >= now - days * DAY && t <= now + 60e3;
    const likesOf = (r) => (r.platform === 'facebook' ? r.rawAnalytics.facebook.analytics.reactions.total : r.rawAnalytics.instagram.analytics.likeCount);

    section = '(1) this month, all platforms:';
    const month = await view(main, '?range=month&refresh=1');
    await check('posts published equals the count of posted campaigns in the last 30 days', async () => {
      const n = mainPosted.filter((c) => inRange(c.publishedAt.getTime(), 30)).length;
      assert.strictEqual(month.overall.posts.value, n);
      const prev = mainPosted.filter((c) => { const t = c.publishedAt.getTime(); return t >= now - 60 * DAY && t < now - 30 * DAY; }).length;
      assert.strictEqual(month.overall.posts.previous, prev);
      return `${n} this period, ${prev} the period before`;
    });
    await check('likes equal the sum of the stored platform answers of measured posts in the period', async () => {
      const rows = measuredRows.filter((r) => inRange(r.publishedAt.getTime(), 30));
      const sum = rows.reduce((a, r) => a + likesOf(r), 0);
      assert.strictEqual(month.overall.likes.value, sum);
      assert.strictEqual(month.overall.postsMeasured.value, rows.length);
      return `${sum} likes from ${rows.length} measured posts`;
    });
    await check('Instagram followers are the newest stored number and the change is against the number 30 days back', async () => {
      const ig = month.platforms.find((p) => p.platform === 'instagram');
      assert.strictEqual(ig.state, 'ready');
      const mine = snaps.filter((s) => String(s.userId) === String(main._id));
      const newest = mine[mine.length - 1];
      const startCut = now - 30 * DAY + DAY / 2;
      const start = mine.filter((s) => s.date.getTime() <= startCut).pop();
      assert.strictEqual(ig.metrics.followers.value, newest.platforms.instagram.followers);
      assert.strictEqual(ig.metrics.followers.previous, start.platforms.instagram.followers);
      assert.strictEqual(ig.metrics.followers.change, newest.platforms.instagram.followers - start.platforms.instagram.followers);
      assert.ok(Array.isArray(ig.spark.followers) && ig.spark.followers.length >= 29);
      return `${ig.metrics.followers.value}, change ${ig.metrics.followers.change}`;
    });
    await check('Facebook reports no reach: a reason, not a zero; LinkedIn is not connected so its stored numbers stay hidden', async () => {
      const fb = month.platforms.find((p) => p.platform === 'facebook');
      assert.strictEqual(fb.metrics.reach.available, false);
      assert.strictEqual(fb.metrics.reach.value, null);
      const li = month.platforms.find((p) => p.platform === 'linkedin');
      assert.strictEqual(li.state, 'notconnected');
      assert.ok(!JSON.stringify(li).includes('300'));
      assert.deepStrictEqual(month.platforms.map((p) => p.platform), ['instagram', 'facebook', 'linkedin', 'twitter']);
    });
    await check('top posts by likes are the three highest, in order, with picture, link and date', async () => {
      const rows = measuredRows.filter((r) => inRange(r.publishedAt.getTime(), 30)).sort((a, b) => likesOf(b) - likesOf(a)).slice(0, 3);
      const got = month.topPosts.lists.likes.posts;
      assert.deepStrictEqual(got.map((p) => p.value), rows.map(likesOf));
      for (const p of got) { assert.match(p.thumbnail, /^https:\/\/res\.cloudinary\.com/); assert.match(p.url, /^https:\/\/www\./); assert.ok(p.date); }
      return got.map((p) => `${p.title} ${p.value}`).join(', ');
    });
    await check('formats and findings only with enough posts; every finding names its post count and has no forbidden words', async () => {
      const rows = measuredRows.filter((r) => inRange(r.publishedAt.getTime(), 30));
      for (const i of month.insights) {
        assert.ok(!forbidden.test(i.text), i.text);
        const m = i.text.match(/from (\d+) (posts?|daily numbers?)\)/);
        assert.ok(m, i.text);
        if (/post/.test(m[2])) assert.ok(Number(m[1]) <= rows.length, `${m[1]} <= ${rows.length}`);
      }
      const counted = {};
      for (const r of rows) { const c = mainPosted.find((x) => String(x._id) === String(r.campaignId)); const f = c.creative.type === 'reel' ? 'video' : c.creative.type; counted[f] = (counted[f] || 0) + 1; }
      for (const r of month.byFormat.rows) assert.strictEqual(r.posts, counted[r.format], r.format);
      if (rows.length < 5) assert.strictEqual(month.insights.length, 0);
      return `${rows.length} measured, ${month.insights.length} findings: ${month.insights.map((i) => i.kind).join(', ')}`;
    });

    section = '(2) ranges and platform filter:';
    await check('this week and last 90 days count their own posts', async () => {
      const week = await view(main, '?range=week&refresh=1');
      const q = await view(main, '?range=90d&refresh=1');
      assert.strictEqual(week.overall.posts.value, mainPosted.filter((c) => inRange(c.publishedAt.getTime(), 7)).length);
      assert.strictEqual(q.overall.posts.value, mainPosted.filter((c) => inRange(c.publishedAt.getTime(), 90)).length);
      return `week ${week.overall.posts.value}, 90 days ${q.overall.posts.value}`;
    });
    await check('Facebook only: posts, likes and top posts reflect Facebook alone', async () => {
      const fb = await view(main, '?range=90d&platform=facebook&refresh=1');
      const rows = measuredRows.filter((r) => r.platform === 'facebook' && inRange(r.publishedAt.getTime(), 90));
      assert.strictEqual(fb.platform, 'facebook');
      assert.strictEqual(fb.overall.likes.value, rows.reduce((a, r) => a + likesOf(r), 0));
      assert.strictEqual(fb.overall.posts.value, mainPosted.filter((c) => c.platforms[0] === 'facebook' && inRange(c.publishedAt.getTime(), 90)).length);
      assert.ok(fb.topPosts.lists.likes.posts.every((p) => p.platform === 'facebook'));
      return `${fb.overall.likes.value} likes on ${rows.length} measured Facebook posts`;
    });

    section = '(3) isolation:';
    await check('the other account\'s posts, numbers and titles never appear in this account\'s answer', async () => {
      const all = JSON.stringify([month, await view(main, '?range=90d&refresh=1')]);
      assert.ok(!all.includes('Secret other post'));
      assert.ok(!all.includes('99999') && !all.includes('77777') && !all.includes('9000'));
      for (const c of otherPosted) assert.ok(!all.includes(String(c._id)));
      const theirs = await view(other, '?range=month&refresh=1');
      assert.strictEqual(theirs.platforms[0].metrics.followers.value, 99999);
      assert.ok(!JSON.stringify(theirs).includes('Perf post'));
      return 'checked both ways';
    });
    await check('an id in the query is ignored: the signed-in account is used', async () => {
      const r = await view(main, `?range=month&refresh=1&userId=${other._id}`);
      assert.ok(!JSON.stringify(r).includes('Secret other post'));
    });

    section = '(4) empty states:';
    const free = await mkUser('free', { plan: { tier: 'free', addons: [] }, connectedSocials: [] });
    const fresh = await mkUser('fresh');
    await check('free account without connections: the paid plan reason everywhere, no numbers', async () => {
      const b = await view(free, '?refresh=1');
      assert.strictEqual(b.account.free, true);
      assert.ok(b.platforms.every((p) => p.state === 'notconnected' && p.reason === 'Connecting accounts comes with a paid plan.'));
      assert.strictEqual(b.overall.reach.reason, 'Connecting accounts comes with a paid plan.');
      assert.strictEqual(b.topPosts.reason, 'Nothing was published in this period.');
      assert.deepStrictEqual(b.insights, []);
    });
    await check('connected but nothing stored yet: first numbers within a day', async () => {
      const b = await view(fresh, '?refresh=1');
      const ig = b.platforms.find((p) => p.platform === 'instagram');
      assert.strictEqual(ig.state, 'nodata');
      assert.strictEqual(ig.reason, 'Your first numbers arrive within a day of connecting.');
    });

    section = '(5) agency client workspace:';
    const agency = await mkUser('agency', { plan: { tier: 'agency', addons: [] }, credits: { balance: 3000 } });
    const created = await createWorkspace({ owner: agency, name: 'Perf Client', models: { User } });
    assert.ok(created.ok, created.message);
    const ws = created.workspace;
    await User.updateOne({ _id: ws._id }, { $set: { connectedSocials: [{ platform: 'instagram', username: 'zz.perfchk.client' }] } });
    await Snapshot.create({ userId: ws._id, date: utcMidnight(0), platforms: { instagram: { followers: 4321, reach: 1000, engagementRate: 2 } } });
    await check('the agency pass shows the client\'s own numbers, flagged as a client workspace', async () => {
      const r = await get('/api/analytics/performance?refresh=1', issueAgencyPass({ workspaceId: ws._id, ownerId: agency._id }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.account.clientWorkspace, true);
      assert.strictEqual(r.body.platforms[0].metrics.followers.value, 4321);
      const own = await view(agency, '?refresh=1');
      assert.ok(!JSON.stringify(own).includes('4321'), 'the client\'s number is not the owner\'s');
    });

    section = '(6) bounds:';
    const explainOf = async (label, cursor) => {
      const raw = await cursor.explain('executionStats');
      const e = Array.isArray(raw) ? raw[0] : raw;
      const stages = JSON.stringify(e.queryPlanner.winningPlan);
      return { label, collscan: /COLLSCAN/.test(stages), examined: e.executionStats.totalDocsExamined, returned: e.executionStats.nReturned, plan: [...new Set(stages.match(/"stage":"[A-Z_]+"/g) || [])].join(' ').replace(/"stage":/g, '') };
    };
    await check('every query uses an index and examines only this account\'s rows', async () => {
      const uid = main._id;
      const since = new Date(now - 181 * DAY);
      const qs = [
        await explainOf('snapshots', Snapshot.find({ userId: uid, date: { $gte: since } }).sort({ date: 1 }).limit(200)),
        await explainOf('measured posts', Perf.find({ userId: uid, publishedAt: { $gte: since } }).sort({ publishedAt: -1 }).limit(400)),
        await explainOf('campaigns by id', Campaign.find({ userId: uid, _id: { $in: mainPosted.map((c) => c._id) } }).limit(400)),
        await explainOf('posted campaigns', Campaign.find({ userId: uid, status: 'posted', publishedAt: { $gte: since, $lte: new Date() } }).limit(1001))
      ];
      for (const q of qs) note(`${q.label}: ${q.plan}; examined ${q.examined}, returned ${q.returned}`);
      assert.deepStrictEqual(qs.filter((q) => q.collscan).map((q) => q.label), []);
      assert.ok(qs[0].examined <= 101, `snapshots examined ${qs[0].examined}`);
      assert.ok(qs[1].examined <= measuredRows.length, `measured examined ${qs[1].examined}`);
      assert.ok(qs[3].examined <= mainPosted.length + 1, `posted examined ${qs[3].examined}`);
      const r = await get('/api/analytics/performance?range=90d&refresh=1', generateToken(main._id));
      assert.ok(r.bytes < 40000, `${r.bytes} bytes`);
      return `${qs.length} queries, answer ${r.bytes} bytes in ${Math.round(r.ms)} ms`;
    });
    await check('the query time limit is set on every read', async () => {
      const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'performance', 'service.js'), 'utf8');
      assert.strictEqual((src.match(/\.maxTimeMS\(MAX_TIME_MS\)/g) || []).length, 4);
    });

    section = '(7) cache and errors:';
    await check('a second call is served from the cache; a stored snapshot clears it', async () => {
      const a = await view(main, '?range=week');
      const b = await view(main, '?range=week');
      assert.strictEqual(b.cached, true);
      assert.strictEqual(b.overall.posts.value, a.overall.posts.value);
      forgetAccount(main._id); // what services/snapshotScheduler.js calls after it stores a day
      const c = await view(main, '?range=week');
      assert.strictEqual(c.cached, false);
      assert.ok(perfRouter.createPerformanceRouter, 'route module exported');
    });
    await check('no sign-in gives 401; an unknown platform gives 400', async () => {
      assert.strictEqual((await get('/api/analytics/performance')).status, 401);
      assert.strictEqual((await get('/api/analytics/performance?platform=myspace', generateToken(main._id))).status, 400);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/performance-view-check.js [run|cleanup]');
  await connect();
  console.log(`Database: ${DEV_DB}`);
  let failed = false;
  try {
    if (mode === 'run') await runChecks();
  } catch (e) {
    failed = true;
    console.log(`FAIL  (script) ${e && e.stack ? e.stack : e}`);
  } finally {
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

