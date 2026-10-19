/**
 * Real-database check of GET /api/competitors/best-posts (competitor tiles, What's working, Trending for you) against the
 * DEVELOPMENT database. Refuses any database except nebulaa_dev. NO read of any social page, NO model call: the route only
 * reads Mongo, and it runs inside this process on a random 127.0.0.1 port (never 3000 or 5000) with real tokens.
 *   node scripts/competitors-home-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/competitors-home-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.comphomechk-" (and the client workspace of
 * the throwaway agency, found by its owner). Exit code is non-zero on any FAIL, or if anything is left over.
 * Snapshots are written the way the tracker writes them (the real summarise() and the real snapshot store), from raw posts
 * shaped like the real read (12 posts, likesCount -1 when hidden, isPinned). Expected numbers are computed here from the raw
 * posts with plain code, never with the read model's own helpers.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.comphomechk-';
const DEV_DB = 'nebulaa_dev';
const DAY = 864e5;
const HOUR = 36e5;

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

const OWNED = { competitors: 'userId', competitor_snapshots: 'userId', ai_content_performance: 'userId', blueprints: 'userId' };

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
    for (const [name, field] of Object.entries(OWNED)) {
      const c = (await db.collection(name).deleteMany({ [field]: { $in: ids } })).deletedCount;
      if (c) removed[name] = c;
    }
    const c = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
    if (c) removed.users = c;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {};
  for (const [name, field] of Object.entries(OWNED)) left[name] = ids.length ? await db.collection(name).countDocuments({ [field]: { $in: ids } }) : 0;
  left.users = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }) + (ids.length ? await db.collection('users').countDocuments({ _id: { $in: ids } }) : 0);
  console.log('left', JSON.stringify(left));
  return { removed, left, removedTotal: Object.values(removed).reduce((a, b) => a + b, 0) };
}

// ---- independent India dates (Intl, not the service's arithmetic) ---------------------------------------------------
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function istParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}
const istMondayKey = (d) => { const p = istParts(d); const day = Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00Z`); return new Date(day - WEEKDAYS.indexOf(p.weekday) * DAY).toISOString().slice(0, 10); };

// ---------------------------------------------------------------------------------------------------------------------
async function runChecks() {
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const Competitor = require('../models/Competitor');
  const Snapshot = require('../models/CompetitorSnapshot');
  const Perf = require('../models/AIContentPerformance');
  const legal = require('../config/legalVersions');
  const { generateToken } = require('../middleware/auth');
  const { createWorkspace, issueAgencyPass } = require('../services/agencyWorkspaces');
  const route = require('../routes/competitorBestPosts');
  const { createBestPostsRouter, build } = route;
  const { summarise } = require('../services/competitors/snapshot');
  const { snapshotStore } = require('../services/competitors/snapshotStore');
  const { isPlainText } = require('../services/competitors/bestPosts');
  const { canUse } = require('../config/entitlements');
  const fixture = require('../tests/fixtures/instagram-profile-real-nebulaa-os.json');

  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  const stamp = Date.now();
  const tag = `${PREFIX}${stamp}`;
  // A fixed "now" (Thursday 15 October 2026, 18:00 India) so the India week is known: Monday 12 October.
  const SIM = new Date('2026-10-15T18:00:00+05:30');
  const WEEK = istMondayKey(SIM);
  const PREV = istMondayKey(new Date(SIM.getTime() - 7 * DAY));
  note(`simulated now ${SIM.toISOString()}, India week ${WEEK}, previous ${PREV}`);
  assert.strictEqual(WEEK, '2026-10-12');

  const mkUser = (suffix, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['competitors'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `Comp Home ${suffix}`, website: 'https://example.com', description: 'Bakery', targetAudience: 'Families nearby' },
    credits: { balance: 100 },
    ...extra
  });
  const tokenOf = (u) => generateToken(u._id);
  let created = 0;
  const mkComp = async (user, name, handle, extra = {}) => { created++; return Competitor.create({ userId: user._id, name, website: 'https://example.com', isActive: true, ...(handle ? { socialHandles: { instagram: handle } } : {}), handleStatus: 'confirmed', ...extra }); };
  const store = snapshotStore();
  // Raw posts in the shape of the real read: timestamp, type, likesCount (-1 when hidden), commentsCount, isPinned, url.
  let seq = 0;
  const raw = (at, type, likes, comments, extra = {}) => ({ id: `zz${++seq}`, timestamp: at.toISOString(), type, likesCount: likes, commentsCount: comments, isPinned: false, url: `https://www.instagram.com/p/ZZchk${stamp}${seq}/`, caption: `secret competitor caption ${seq}`, hashtags: ['secrettag'], displayUrl: 'https://scontent.cdninstagram.com/secret.jpg', ...extra });
  const ist = (iso) => new Date(`${iso}+05:30`);
  const saveSnap = async (user, comp, at, profile, posts) => {
    const fields = summarise({ profile, posts, now: at });
    await store.save({ userId: user._id, competitorId: comp._id, weekStart: fields.weekStart, takenAt: at, handle: comp.socialHandles && comp.socialHandles.instagram, ...fields, ok: true });
    return fields;
  };
  const saveFail = (user, comp, at, error) => store.save({ userId: user._id, competitorId: comp._id, weekStart: istMondayKey(at), takenAt: at, handle: comp.socialHandles && comp.socialHandles.instagram, ok: false, error });

  // ---- in-process server: the real route and middleware, real tokens, random port -----------------------------------
  const app = express();
  app.use('/api/competitors/best-posts', route);
  app.use('/sim', createBestPostsRouter({ now: () => SIM }));
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
    return { status: res.status, body, text, bytes: Buffer.byteLength(text), ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  };
  const sim = async (u) => { const r = await get('/sim', tokenOf(u)); assert.strictEqual(r.status, 200, `status ${r.status} ${r.text.slice(0, 200)}`); return r; };

  try {
    // =================================================================================================================
    // Seed
    // =================================================================================================================
    const owner = await mkUser('owner');
    const other = await mkUser('other');
    const noAddon = await mkUser('noaddon', { plan: { tier: 'starter', addons: [] } });
    const free = await mkUser('free', { plan: { tier: 'free' } });
    const noComp = await mkUser('nocomp');
    const waiting = await mkUser('waiting');

    // owner's plan with two themes (the newest finished plan run is the one read)
    await db.collection('blueprints').insertMany([
      { blueprintId: `${tag}-plan-old`, userId: owner._id, emailKey: `${tag}-o`, tierAtStart: 'starter', kind: 'plan', status: 'completed', createdAt: new Date(SIM - 60 * DAY), completedAt: new Date(SIM - 60 * DAY), result: { plan: { pillars: [{ name: 'Old theme' }] } } },
      { blueprintId: `${tag}-plan-new`, userId: owner._id, emailKey: `${tag}-o`, tierAtStart: 'starter', kind: 'plan', status: 'completed', createdAt: new Date(SIM - 5 * DAY), completedAt: new Date(SIM - 5 * DAY), result: { plan: { pillars: [{ name: 'Fresh bakes', why: { text: 'x' } }, { name: 'Behind the counter' }] } } }
    ]);

    // Competitors, newest first: E is the newest, the sixth (Oldest) is past the cap of five.
    const t = (n) => new Date(SIM - n * HOUR);
    const oldest = await mkComp(owner, 'ZZ Oldest Bakery', 'zz_oldest', { createdAt: t(600) });
    const A = await mkComp(owner, 'ZZ Sweet Rival', 'zz_sweetrival', { createdAt: t(500) });
    const B = await mkComp(owner, 'ZZ Private Cafe', 'zz_privatecafe', { createdAt: t(400) });
    const C = await mkComp(owner, 'ZZ Unreadable', 'zz_unreadable', { createdAt: t(300) });
    const D = await mkComp(owner, 'ZZ Old Style', 'zz_oldstyle', { createdAt: t(200) });
    const E = await mkComp(owner, 'ZZ Guessed', 'zz_guessed', { handleStatus: 'suggested', isAutoDiscovered: true, createdAt: t(100) });

    // A: 12 posts, all inside this India week (so the count is "at least 12"), one hidden-likes reel with many comments.
    const aPosts = [
      raw(ist('2026-10-15T11:00:00'), 'Video', 300, 10), raw(ist('2026-10-15T10:00:00'), 'Video', -1, 200), raw(ist('2026-10-15T09:00:00'), 'Image', 100, 1),
      raw(ist('2026-10-14T11:00:00'), 'Video', 320, 5), raw(ist('2026-10-14T10:00:00'), 'Image', 95, 0), raw(ist('2026-10-14T09:00:00'), 'Image', 105, 2),
      raw(ist('2026-10-13T11:00:00'), 'Video', 280, 2), raw(ist('2026-10-13T10:00:00'), 'Image', 90, 0), raw(ist('2026-10-13T09:00:00'), 'Image', 110, 3),
      raw(ist('2026-10-12T11:00:00'), 'Image', 100, 0), raw(ist('2026-10-12T10:00:00'), 'Image', 98, 1), raw(ist('2026-10-12T09:00:00'), 'Image', 102, 0)
    ];
    const aPrev = [raw(ist('2026-10-07T11:00:00'), 'Image', 40, 1)];
    await saveSnap(owner, A, new Date(SIM - 7 * DAY), { followersCount: 1000, postsCount: 400 }, aPrev);
    const aFields = await saveSnap(owner, A, new Date(SIM - HOUR), { followersCount: 1080, postsCount: 400 }, aPosts);
    // B private, C unreadable: failed readings this week.
    await saveFail(owner, B, new Date(SIM - 2 * HOUR), 'This account is private');
    await saveFail(owner, C, new Date(SIM - 2 * HOUR), 'Could not read this profile');
    // D: an older-style snapshot (before the post list was stored): only the stored best post.
    await db.collection('competitor_snapshots').insertOne({ userId: owner._id, competitorId: D._id, weekStart: WEEK, takenAt: new Date(SIM - 3 * HOUR), handle: 'zz_oldstyle', ok: true, followers: 640, postsInWindow: 2, postsInWindowMayBeTruncated: false, posts30: 6, avgLikes: 30, avgComments: 1, formats: { image: 6, video: 0, carousel: 0 }, topPost: { url: 'https://www.instagram.com/p/ZZoldstyle1/', likes: 77, comments: 3, type: 'Image', caption: 'secret old caption' }, topPostAt: new Date(SIM - 2 * DAY), hashtags: ['secrettag'] });
    // A forged row: another account's snapshot under A's id. It must never be used.
    await db.collection('competitor_snapshots').insertOne({ userId: other._id, competitorId: A._id, weekStart: '2026-10-19', takenAt: new Date(SIM - 60000), ok: true, followers: 999999, postsInWindow: 99, posts: [] });
    // The other account's own competitor and data.
    const O = await mkComp(other, 'ZZ Other Account Rival', 'zz_otherrival');
    await saveSnap(other, O, new Date(SIM - HOUR), { followersCount: 777777, postsCount: 9 }, [raw(ist('2026-10-14T11:00:00'), 'Video', 99999, 999)]);

    // Own measured posts (the account's own best post), and another account's much bigger one.
    const perf = (u, contentType, likes, comments, publishedAt, caption) => ({ organizationId: String(u._id), userId: u._id, platform: 'instagram', postId: `${tag}-${++seq}`, contentType, caption, metrics: { likes, comments }, publishedAt });
    await Perf.insertMany([
      perf(owner, 'video', 240, 18, new Date(SIM - 3 * DAY), 'Our new sourdough loaf is here! #bread @friend https://example.com'),
      perf(owner, 'image', 60, 2, new Date(SIM - 6 * DAY), 'Cookies'),
      perf(owner, 'image', 5000, 50, new Date(SIM - 45 * DAY), 'Too old to count'),
      perf(other, 'video', 99999, 999, new Date(SIM - 2 * DAY), 'Other account post')
    ]);
    await mkComp(waiting, 'ZZ Not Read Yet', 'zz_notreadyet');
    note(`seeded ${created} competitors, snapshots for A (2), B, C, D, a forged row and another account's`);

    // =================================================================================================================
    section = '(1) the account with data:';
    const r1 = await sim(owner);
    const b = r1.body;
    const by = Object.fromEntries(b.competitors.map((c) => [c.name, c]));
    await check('ready, entitled, the five newest tracked competitors in order; the sixth is not shown', async () => {
      assert.strictEqual(b.success, true);
      assert.strictEqual(b.entitled, true);
      assert.strictEqual(b.state, 'ready');
      assert.strictEqual(b.weekStart, WEEK);
      assert.deepStrictEqual(b.competitors.map((c) => c.name), ['ZZ Guessed', 'ZZ Old Style', 'ZZ Unreadable', 'ZZ Private Cafe', 'ZZ Sweet Rival']);
      assert.ok(!by['ZZ Oldest Bakery']);
      return `${r1.bytes} bytes, ${Math.round(r1.ms)} ms`;
    });
    await check('statuses: unconfirmed, tracking (older snapshot), failed, private, tracking', async () => {
      assert.strictEqual(by['ZZ Guessed'].status, 'unconfirmed');
      assert.strictEqual(by['ZZ Guessed'].profileUrl, null);
      assert.strictEqual(by['ZZ Old Style'].status, 'tracking');
      assert.strictEqual(by['ZZ Unreadable'].status, 'failed');
      assert.strictEqual(by['ZZ Private Cafe'].status, 'private');
      assert.strictEqual(by['ZZ Sweet Rival'].status, 'tracking');
      for (const n of ['ZZ Unreadable', 'ZZ Private Cafe', 'ZZ Guessed']) assert.strictEqual(by[n].followers, null, `${n} has no invented number`);
    });
    const a = by['ZZ Sweet Rival'];
    await check('followers and the week-on-week change come from the two stored weeks; the forged row is ignored', async () => {
      assert.deepStrictEqual(a.followers, { value: 1080, change: 80 });
      assert.strictEqual(a.profileUrl, 'https://www.instagram.com/zz_sweetrival/');
    });
    await check('posts this week is the stored count, marked "at least" because all 12 read posts are this week', async () => {
      assert.strictEqual(aFields.posts.length, 12, 'the snapshot keeps the 12 compact posts');
      assert.deepStrictEqual(a.postsThisWeek, { value: 12, atLeast: true });
    });
    await check('the best post is the highest likes + 3 x comments of this week, never the hidden-likes reel', async () => {
      const scored = aPosts.filter((p) => p.likesCount >= 0).map((p) => ({ p, s: p.likesCount + 3 * p.commentsCount })).sort((x, y) => y.s - x.s);
      const top = scored[0].p;
      assert.strictEqual(a.bestPost.period, 'week');
      assert.strictEqual(a.bestPost.likes, top.likesCount);
      assert.strictEqual(a.bestPost.comments, top.commentsCount);
      assert.strictEqual(a.bestPost.url, top.url);
      assert.strictEqual(a.bestPost.type, 'video');
      return `${top.likesCount} likes, ${top.commentsCount} comments`;
    });
    await check('what worked: reels against photos, computed from the stored posts (hidden likes left out)', async () => {
      // the last 30 days across both stored weeks (the previous week's photo counts too)
      const known = [...aPosts, ...aPrev].filter((p) => p.likesCount >= 0);
      const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const reels = mean(known.filter((p) => p.type === 'Video').map((p) => p.likesCount));
      const photos = mean(known.filter((p) => p.type === 'Image').map((p) => p.likesCount));
      const ratio = reels / photos;
      const words = ratio >= 3 ? `${Math.round(ratio)} times` : `${(Math.round(ratio * 10) / 10)} times`;
      assert.strictEqual(a.worked.text, `Reels got ${words} the likes of photos on average this month.`);
      return a.worked.text;
    });
    await check('an older snapshot without posts shows its stored best post and no pattern', async () => {
      const d = by['ZZ Old Style'];
      assert.strictEqual(d.bestPost.likes, 77);
      assert.strictEqual(d.bestPost.url, 'https://www.instagram.com/p/ZZoldstyle1/');
      assert.strictEqual(d.worked, null);
      assert.deepStrictEqual(d.followers, { value: 640, change: null });
    });
    await check('What\'s working: the owner\'s competitors only, strongest first, briefs never name a competitor', async () => {
      assert.ok(b.working.length >= 2 && b.working.length <= 3);
      assert.strictEqual(b.working[0].name, 'ZZ Sweet Rival');
      assert.ok(b.working.every((w) => !/Other Account/.test(w.name)));
      for (const w of b.working) for (const ban of ['ZZ ', 'zz_', 'secret', 'Rival']) assert.ok(!w.action.brief.includes(ban), `${ban} in ${w.action.brief}`);
      assert.strictEqual(b.working[0].action.brief, 'A reel about Fresh bakes, in the style that works: reels are getting the most likes this month.');
    });
    await check('Trending: competitor, own best post (this account only, inside 30 days), the next approved day, the plan theme', async () => {
      assert.deepStrictEqual(b.trending.map((x) => x.source).filter((s) => s !== 'news'), ['competitor', 'own', 'festival', 'plan']); // 'news': the dated public calendar
      const own = b.trending[1];
      assert.strictEqual(own.reason, 'Your reel on Monday 12 October got 240 likes and 18 comments.');
      assert.strictEqual(own.action.brief, 'A new reel about Our new sourdough loaf is here, in the style of your best post this month.');
      assert.strictEqual(b.trending[2].title, "Children's Day");
      assert.strictEqual(b.trending[2].reason, 'Saturday 14 November, in 30 days.');
      assert.strictEqual(b.trending.find((x) => x.source === 'plan').title, 'Fresh bakes', 'the newest plan run is read');
      for (const x of b.trending) for (const ban of ['ZZ ', 'zz_', 'secret', '#bread', '@friend', 'https://']) assert.ok(!x.action.brief.includes(ban), `${ban} in ${x.action.brief}`);
    });
    await check('nothing private leaks: no caption, hashtag, picture link, account id or another account\'s number', async () => {
      for (const leak of ['secret', 'cdninstagram', 'displayUrl', 'hashtags', String(owner._id), String(other._id), '999999', '777777', '99999']) assert.ok(!r1.text.includes(leak), leak);
    });
    await check('every sentence follows the wording rule', async () => {
      const texts = [];
      for (const c of b.competitors) if (c.worked) texts.push(c.worked.text);
      for (const w of b.working) texts.push(w.reason, w.action.brief, w.action.label);
      for (const x of b.trending) texts.push(x.title, x.reason, x.label, x.action.brief);
      for (const s of texts) assert.ok(isPlainText(s), s);
      return `${texts.length} sentences`;
    });
    await check('the answer is small', async () => { assert.ok(r1.bytes < 12000, `${r1.bytes} bytes`); return `${r1.bytes} bytes`; });

    // =================================================================================================================
    section = '(2) the tracker\'s own write path with the real 12-post read:';
    const R = await mkComp(owner, 'ZZ Real Shape', 'zz_realshape', { createdAt: t(50) });
    await check('the real read (nebulaa.os, 12 posts, pinned first) is stored with its compact posts and read back', async () => {
      const at = new Date('2026-10-17T06:00:00Z');
      await saveSnap(owner, R, at, fixture.data[0], fixture.data[0].latestPosts);
      const row = await Snapshot.findOne({ competitorId: R._id }).lean();
      assert.strictEqual(row.posts.length, 12);
      assert.strictEqual(row.posts[0].pinned, true);
      assert.strictEqual(row.posts[0].type, 'carousel');
      assert.ok(row.posts.every((p) => !('caption' in p) && !('displayUrl' in p)));
      const card = (await build({ user: await User.findById(owner._id), now: at })).competitors.find((c) => c.name === 'ZZ Real Shape');
      assert.strictEqual(card.status, 'tracking');
      assert.deepStrictEqual(card.followers, { value: 70, change: null });
      assert.deepStrictEqual(card.postsThisWeek, { value: 1, atLeast: false });
      assert.strictEqual(card.bestPost.likes, 2, 'the only post of that week (the pinned May post is not this week)');
      return `best post ${card.bestPost.type}, ${card.bestPost.likes} likes`;
    });

    // =================================================================================================================
    section = '(3) entitlement and empty states:';
    await check('no add-on: entitled false, no competitor in the answer, Trending keeps only the honest other sources', async () => {
      const r = (await sim(noAddon)).body;
      assert.strictEqual(r.entitled, false);
      assert.strictEqual(r.state, 'not_entitled');
      assert.deepStrictEqual(r.competitors, []);
      assert.deepStrictEqual(r.working, []);
      assert.deepStrictEqual(r.trending.map((x) => x.source).filter((s) => s !== 'news'), ['festival']);
    });
    await check('free account: entitled false, nothing about competitors', async () => {
      const r = (await sim(free)).body;
      assert.strictEqual(r.entitled, false);
      assert.deepStrictEqual(r.competitors, []);
    });
    await check('no competitors: no_competitors', async () => { assert.strictEqual((await sim(noComp)).body.state, 'no_competitors'); });
    await check('a competitor never read: tracker off says tracker_off, tracker on says waiting (stored data only either way)', async () => {
      const u = await User.findById(waiting._id);
      const off = await build({ user: u, now: SIM, deps: { trackerOn: () => false } });
      const on = await build({ user: u, now: SIM, deps: { trackerOn: () => true } });
      assert.strictEqual(off.state, 'tracker_off');
      assert.strictEqual(on.state, 'waiting');
      assert.strictEqual(on.competitors[0].status, 'waiting');
      const live = (await sim(waiting)).body;
      assert.strictEqual(live.trackerOn, String(process.env.ENABLE_COMPETITOR_TRACKER || '').trim() === 'on');
      return `this environment's switch: ${live.trackerOn ? 'on' : 'off'}`;
    });
    await check('the other account sees only its own competitor and numbers', async () => {
      const r = (await sim(other)).body;
      assert.deepStrictEqual(r.competitors.map((c) => c.name), ['ZZ Other Account Rival']);
      assert.ok(!JSON.stringify(r).includes('ZZ Sweet Rival'));
    });
    await check('the live route (real clock) answers for the owner too', async () => {
      const r = await get('/api/competitors/best-posts', tokenOf(owner));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.entitled, true);
      assert.strictEqual(r.body.competitors.length, 5);
      return `state ${r.body.state}`;
    });
    await check('without a token the route refuses', async () => { assert.strictEqual((await get('/api/competitors/best-posts')).status, 401); });

    // =================================================================================================================
    section = '(4) agency client workspace:';
    const agency = await mkUser('agency', { plan: { tier: 'agency', addons: [] }, credits: { balance: 1000 } });
    const made = await createWorkspace({ owner: agency, name: 'Comp Check Client', models: { User } });
    assert.ok(made.ok, made.message);
    const ws = made.workspace;
    const wsComp = await mkComp(ws, 'ZZ Client Rival', 'zz_clientrival');
    await saveSnap(ws, wsComp, new Date(SIM - HOUR), { followersCount: 4321, postsCount: 50 }, [raw(ist('2026-10-14T11:00:00'), 'Image', 50, 2)]);
    await mkComp(agency, 'ZZ Agency Own Rival', 'zz_agencyown');
    const passToken = issueAgencyPass({ workspaceId: ws._id, ownerId: agency._id });
    await check('inside the client the answer is the client\'s own competitors (never the agency\'s), by its own entitlement', async () => {
      const r = await get('/api/competitors/best-posts', passToken);
      assert.strictEqual(r.status, 200, r.text.slice(0, 200));
      const wsUser = await User.findById(ws._id).lean();
      const expected = canUse(wsUser, 'competitors').allowed;
      assert.strictEqual(r.body.entitled, expected);
      assert.ok(!r.text.includes('ZZ Agency Own Rival'));
      if (expected) assert.deepStrictEqual(r.body.competitors.map((c) => c.name), ['ZZ Client Rival']);
      return `client entitled: ${expected}`;
    });
    await check('the agency owner\'s own look shows its own competitor only', async () => {
      const r = (await sim(agency)).body;
      assert.strictEqual(r.entitled, true, 'agency holds the bundle');
      assert.deepStrictEqual(r.competitors.map((c) => c.name), ['ZZ Agency Own Rival']);
    });

    // =================================================================================================================
    section = '(5) bounded queries:';
    const explainOf = async (label, cursor) => {
      const rawPlan = await cursor.explain('executionStats');
      const e = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
      const stages = JSON.stringify(e.queryPlanner.winningPlan);
      const st = e.executionStats;
      return { label, collscan: /COLLSCAN/.test(stages), examined: st.totalDocsExamined, keys: st.totalKeysExamined, returned: st.nReturned, plan: [...new Set(stages.match(/"stage":"[A-Z_]+"/g) || [])].join(' ').replace(/"stage":/g, '') };
    };
    await check('every query uses an index and examines only this account\'s rows', async () => {
      const { competitorsQuery } = require('../services/competitors/tracked');
      const ids = [A._id, B._id, C._id, D._id, E._id];
      const Blueprint = require('../models/Blueprint');
      const qs = [
        await explainOf('competitors', competitorsQuery(Competitor, owner._id).limit(25)),
        await explainOf('snapshots', Snapshot.find({ userId: owner._id, competitorId: { $in: ids } }).sort({ weekStart: -1 }).limit(ids.length * 12)),
        await explainOf('own posts', Perf.find({ userId: owner._id, publishedAt: { $gte: new Date(SIM - 30 * DAY) } }).sort({ 'metrics.likes': -1 }).limit(25)),
        await explainOf('plan themes', Blueprint.findOne({ userId: owner._id, kind: 'plan', status: 'completed' }).sort({ createdAt: -1 }))
      ];
      for (const q of qs) note(`${q.label}: ${q.plan}; examined ${q.examined}, keys ${q.keys}, returned ${q.returned}`);
      const scans = qs.filter((q) => q.collscan).map((q) => q.label);
      assert.deepStrictEqual(scans, [], `collection scan in: ${scans.join(', ')}`);
      const ownSnapRows = await Snapshot.countDocuments({ userId: owner._id });
      const sn = qs.find((q) => q.label === 'snapshots');
      assert.ok(sn.examined <= ownSnapRows + 1, `snapshots examined ${sn.examined} (the account has ${ownSnapRows})`);
      const op = qs.find((q) => q.label === 'own posts');
      assert.ok(op.examined <= await Perf.countDocuments({ userId: owner._id }), `own posts examined ${op.examined}`);
      return `${qs.length} queries, none a collection scan`;
    });

    section = '(6) safety at the end:';
    await check('no outside call and no model call: only this process\'s own port was used, and the route file has no such call', async () => {
      const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'competitorBestPosts.js'), 'utf8');
      for (const bad of ['scrapeInstagram', 'socialMediaAPI', 'callLLM', 'axios']) assert.ok(!src.includes(bad), bad);
      assert.ok(port > 1024);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/competitors-home-check.js [run|cleanup]');
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
    const left = Object.values(out.left).reduce((x, y) => x + y, 0);
    if (mode === 'run') {
      const fails = results.filter((r) => !r.ok);
      console.log(`\n${results.length - fails.length} PASS, ${fails.length} FAIL; removed by cleanup: ${out.removedTotal}; left after cleanup: ${left}`);
      if (fails.length || left || failed) process.exitCode = 1;
    } else if (left) process.exitCode = 1;
  }
  await mongoose.disconnect();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
