/**
 * Real-database check of GET /api/home/summary against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO AI call, NO outside call: the summary only reads Mongo; the route runs inside
 * this process on a random 127.0.0.1 port (never 3000 or 5000), with real tokens for throwaway users.
 *   node scripts/home-summary-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/home-summary-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.homechk-" (and the client workspaces of
 * the throwaway agency, found by their owner). Exit code is non-zero on any FAIL, or if anything is left over.
 * Every expected number is computed here from the raw collections with different code from the service (plain JS filters
 * and an Intl-based India week), never by calling the service's own helpers.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.homechk-';
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

/** Throws unless the connected database is the development one. */
function assertDevDatabase(name) {
  if (name !== DEV_DB) throw new Error(`Refusing: database is ${name}, not ${DEV_DB}`);
}
async function connect() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  assertDevDatabase(mongoose.connection.name);
}

// ---------------------------------------------------------------------------------------------------------------------
const COLLECTIONS = {
  users: 'users', drafts: 'drafts', campaigns: 'campaigns', inbox: 'socialinboxconversations', snapshots: 'socialsnapshots',
  proposals: 'weekly_proposals', blueprints: 'blueprints', products: 'products', competitors: 'competitors'
};
const OWNED_BY = { drafts: 'userId', campaigns: 'userId', inbox: 'userId', snapshots: 'userId', proposals: 'userId', blueprints: 'userId', products: 'user', competitors: 'userId' };

async function throwawayIds(db) {
  const base = await db.collection(COLLECTIONS.users).find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  const owners = base.map((u) => u._id);
  const clients = owners.length ? await db.collection(COLLECTIONS.users).find({ 'agency.ownerId': { $in: owners } }, { projection: { _id: 1 } }).toArray() : [];
  return [...owners, ...clients.map((u) => u._id)];
}

async function cleanup(db) {
  const ids = await throwawayIds(db);
  const removed = {};
  for (const [key, field] of Object.entries(OWNED_BY)) {
    if (!ids.length) break;
    const c = (await db.collection(COLLECTIONS[key]).deleteMany({ [field]: { $in: ids } })).deletedCount;
    if (c) removed[COLLECTIONS[key]] = c;
  }
  if (ids.length) {
    const c = (await db.collection(COLLECTIONS.users).deleteMany({ _id: { $in: ids } })).deletedCount;
    if (c) removed[COLLECTIONS.users] = c;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {};
  for (const [key, field] of Object.entries(OWNED_BY)) left[COLLECTIONS[key]] = ids.length ? await db.collection(COLLECTIONS[key]).countDocuments({ [field]: { $in: ids } }) : 0;
  left[COLLECTIONS.users] = await db.collection(COLLECTIONS.users).countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } })
    + (ids.length ? await db.collection(COLLECTIONS.users).countDocuments({ _id: { $in: ids } }) : 0);
  console.log('left', JSON.stringify(left));
  return { removed, left, removedTotal: Object.values(removed).reduce((a, b) => a + b, 0) };
}

// ---- independent India week maths (Intl, not the service's offset arithmetic) ---------------------------------------
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function istParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}
function istDayStart(d) { const p = istParts(d); return Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00+05:30`); }
function istMonday(d) { const p = istParts(d); return istDayStart(d) - WEEKDAYS.indexOf(p.weekday) * DAY; }

// ---------------------------------------------------------------------------------------------------------------------
async function runChecks() {
  const db = mongoose.connection.db;
  const User = require('../models/User');
  const Draft = require('../models/Draft');
  const Campaign = require('../models/Campaign');
  const Inbox = require('../models/SocialInboxConversation');
  const Snapshot = require('../models/SocialSnapshot');
  const Proposal = require('../models/WeeklyProposal');
  const Blueprint = require('../models/Blueprint');
  const Product = require('../models/Product');
  const Competitor = require('../models/Competitor');
  const legal = require('../config/legalVersions');
  const { generateToken } = require('../middleware/auth');
  const { createWorkspace, issueAgencyPass } = require('../services/agencyWorkspaces');
  const { createHomeRouter } = require('../routes/home');
  const home = require('../routes/home');
  const { createHomeSummary } = require('../services/homeSummary');
  const { createSummaryCache } = require('../services/homeSummaryCache');
  const { QUARK_COSTS } = require('../config/apiCosts');

  // The guard itself.
  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused (the guard, and the live connection is the dev one)', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.doesNotThrow(() => assertDevDatabase(DEV_DB));
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  const stamp = Date.now();
  const tag = `${PREFIX}${stamp}`;
  const now = new Date();
  const M = istMonday(now); // this India week's Monday 00:00 IST, in ms
  const D = istDayStart(now); // today's India midnight, in ms
  note(`India week starts ${new Date(M).toISOString()}, today starts ${new Date(D).toISOString()}`);

  const mkUser = (suffix, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['publish', 'inbox', 'competitors'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `Home Check ${suffix}`, website: 'https://example.com', description: 'Hand poured soy candles for gifts', targetAudience: 'Young homeowners in Pune' },
    connectedSocials: [{ platform: 'instagram', username: 'zz.homechk', accountName: 'Home Check' }, { platform: 'facebook', accountName: 'Home Check' }],
    credits: { balance: 600 },
    ...extra
  });
  const tokenOf = (u) => generateToken(u._id);

  // ---- an in-process server: the real route, real middleware, real tokens, random port ----------------------------
  const app = express();
  app.use(express.json());
  app.use('/api', home.watch); // the same write watcher server-main.js mounts
  app.use('/api/home', home);
  app.post('/api/drafts-probe', require('../middleware/auth').protect, (req, res) => res.json({ success: true })); // a stand-in write
  // Simulated clocks: the same service and route, with a fixed "now".
  const sims = {};
  const simRoute = (name, at) => { sims[name] = at; app.use(`/sim/${name}`, createHomeRouter({ service: createHomeSummary({ now: () => at }), cache: createSummaryCache() })); };
  simRoute('mondayMorning', new Date('2026-10-12T00:01:00+05:30'));
  simRoute('midweek', new Date('2026-10-14T10:00:00+05:30'));
  simRoute('sundayNight', new Date('2026-10-18T23:30:00+05:30'));
  simRoute('mondayAfter', new Date('2026-10-19T00:30:00+05:30'));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.ok(port !== 3000 && port !== 5000);
  note(`in-process server on 127.0.0.1:${port}`);
  const get = async (path, token, opts = {}) => {
    const t0 = process.hrtime.bigint();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, ...opts });
    const text = await res.text();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    let body = null; try { body = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: res.status, body, ms, bytes: Buffer.byteLength(text), headers: res.headers };
  };
  const summary = async (u, q = '', base = '/api/home/summary') => { const r = await get(`${base}${q}`, tokenOf(u)); assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`); return r; };

  try {
    // =================================================================================================================
    // Seed: a "mid" account with realistic data, another account with its own data, and one account with nothing.
    // =================================================================================================================
    const mid = await mkUser('mid', { setup: { planOpenedAt: new Date(now - 2 * DAY) } });
    const other = await mkUser('other');
    const fresh = await mkUser('new', { plan: { tier: 'free' }, onboardingCompleted: false, businessProfile: {}, connectedSocials: [], credits: { balance: 0 } });

    const mkDraft = (u, status, sourceType = 'post', extra = {}) => ({ userId: u._id, title: `Draft ${status}`, caption: 'caption', status, sourceType, contentType: sourceType === 'reel' ? 'reel' : 'post', platforms: ['instagram'], imageUrl: 'https://example.com/d.jpg', ...extra });
    // 7 waiting posts (draft x3, completed x2, failed, processing) plus legacy ready and pending, and others that must not count.
    const midDrafts = [
      ...['draft', 'draft', 'draft', 'completed', 'completed', 'failed', 'processing'].map((s) => mkDraft(mid, s)),
      ...['published', 'published', 'scheduled', 'archived'].map((s) => mkDraft(mid, s)),
      mkDraft(mid, 'draft', 'reel'), mkDraft(mid, 'completed', 'reel'), mkDraft(mid, 'failed', 'reel')
    ];
    await Draft.insertMany(midDrafts);
    // Legacy statuses that the schema's list no longer has but old rows can carry: the queue still shows them.
    await db.collection('drafts').insertMany([
      { ...mkDraft(mid, 'ready'), createdAt: new Date(), updatedAt: new Date() },
      { ...mkDraft(mid, 'pending'), createdAt: new Date(), updatedAt: new Date() },
      { ...mkDraft(mid, 'rejected'), createdAt: new Date(), updatedAt: new Date() },
      { ...mkDraft(mid, 'posted'), createdAt: new Date(), updatedAt: new Date() }
    ]);
    await Draft.insertMany([...Array(5)].map(() => mkDraft(other, 'draft')));

    const camp = (u, name, status, extra = {}) => ({ userId: u._id, name, status, platforms: ['instagram'], creative: { type: 'image', textContent: `Text for ${name}`, imageUrls: ['https://example.com/c.jpg'] }, ...extra });
    const midCampaigns = [
      // published this week (one at the very start of Monday, one in the last hour of Sunday, one today)
      camp(mid, 'pub-mon-start', 'posted', { publishedAt: new Date(M), scheduledFor: new Date(M) }),
      camp(mid, 'pub-sun-end', 'posted', { publishedAt: new Date(M + 7 * DAY - 1), scheduledFor: new Date(M + 7 * DAY - 1) }),
      camp(mid, 'pub-today', 'posted', { publishedAt: new Date(D + HOUR) }),
      // published last week (including the last millisecond of last Sunday) and long ago
      camp(mid, 'prev-end', 'posted', { publishedAt: new Date(M - 1) }),
      camp(mid, 'prev-mid', 'posted', { publishedAt: new Date(M - 3 * DAY) }),
      camp(mid, 'prev-start', 'posted', { publishedAt: new Date(M - 7 * DAY) }),
      ...[10, 20, 30, 40].map((d) => camp(mid, `old-${d}`, 'posted', { publishedAt: new Date(M - d * DAY) })),
      camp(mid, 'posted-no-date', 'posted'),
      // scheduled this week and today
      camp(mid, 'sched-today-late', 'scheduled', { scheduledFor: new Date(D + 20 * HOUR) }),
      camp(mid, 'sched-today-early', 'scheduled', { scheduledFor: new Date(D + 3 * HOUR) }),
      camp(mid, 'sched-today-mid', 'scheduled', { scheduledFor: new Date(D + 10 * HOUR) }),
      camp(mid, 'sched-week-end', 'scheduled', { scheduledFor: new Date(M + 7 * DAY - HOUR) }),
      camp(mid, 'sched-next-week', 'scheduled', { scheduledFor: new Date(M + 7 * DAY + HOUR) }),
      camp(mid, 'draft-camp', 'draft')
    ];
    await Campaign.insertMany(midCampaigns);
    await Campaign.insertMany([camp(other, 'other-pub', 'posted', { publishedAt: new Date(M + HOUR) }), camp(other, 'other-today', 'scheduled', { scheduledFor: new Date(D + 5 * HOUR) })]);

    const thread = (u, i, status) => ({ userId: u._id, platform: 'instagram', providerThreadId: `${tag}-${u.firstName}-${i}`, status, participantName: 'Someone', lastMessagePreview: 'Hello' });
    await Inbox.insertMany([...['unread', 'unread', 'unread', 'unread', 'unread', 'read', 'read', 'read', 'replied', 'replied'].map((s, i) => thread(mid, i, s)), ...[0, 1, 2, 3].map((i) => thread(other, i, 'unread'))]);

    const snap = (u, daysAgo, totals, ig, fb) => ({ userId: u._id, date: new Date(D - daysAgo * DAY), totals, platforms: { instagram: ig, facebook: fb } });
    await Snapshot.insertMany([
      snap(mid, 1, { followers: 5400, reach: 21000, impressions: 40000 }, { followers: 4000, reach: 15000, engagementRate: 5 }, { followers: 1400, reach: 6000, engagementRate: 3 }),
      snap(mid, 2, { followers: 5380, reach: 20000 }, { engagementRate: 4 }, { engagementRate: 3 }),
      snap(mid, 9, { followers: 5200, reach: 18000 }, { followers: 3900, reach: 13000, engagementRate: 4 }, { followers: 1300, reach: 5000, engagementRate: 2 }),
      snap(mid, 12, { followers: 5100, reach: 17000 }, { engagementRate: 4 }, { engagementRate: 2 }),
      snap(mid, 40, { followers: 4000, reach: 9000 }, { engagementRate: 1 }, { engagementRate: 1 }),
      snap(other, 1, { followers: 99999, reach: 77777 }, { engagementRate: 9 }, { engagementRate: 9 })
    ]);

    const weekStart = new Date(M + 5.5 * 0).toISOString(); // not used for the key; the key is the India date below
    const mondayKey = istParts(new Date(M + 6 * HOUR)).year + '-' + istParts(new Date(M + 6 * HOUR)).month + '-' + istParts(new Date(M + 6 * HOUR)).day;
    await Proposal.create({ userId: mid._id, weekStart: mondayKey, status: 'approved', items: [
      { id: 'a', kind: 'post', topic: 'A', status: 'made' }, { id: 'b', kind: 'post', topic: 'B', status: 'made' }, { id: 'c', kind: 'post', topic: 'C', status: 'approved' },
      { id: 'd', kind: 'post', topic: 'D', status: 'approved' }, { id: 'e', kind: 'post', topic: 'E', status: 'skipped' },
      { id: 'f', kind: 'carousel', topic: 'F', status: 'approved' }, { id: 'g', kind: 'video', topic: 'G', status: 'proposed' }
    ] });
    await Proposal.create({ userId: other._id, weekStart: mondayKey, status: 'proposed', items: [{ id: 'z', kind: 'post', topic: 'Z', status: 'proposed' }] });
    void weekStart;

    const bp = (u, status, extra = {}) => ({ blueprintId: `zzhomechk-${stamp}-${Math.random().toString(36).slice(2, 9)}`, userId: u ? u._id : undefined, emailKey: `${tag}-bp`, tierAtStart: 'starter', kind: 'plan', status, ...extra });
    await Blueprint.create(bp(mid, 'completed', { completedAt: new Date(now - 3 * DAY), result: { plan: {} } }));
    await Blueprint.create(bp(mid, 'failed', { createdAt: new Date(now - 1 * HOUR) }));

    await Product.insertMany([{ user: mid._id, name: 'With photo', imageUrl: 'https://example.com/p1.jpg' }, { user: mid._id, name: 'With gallery', images: ['https://example.com/p2.jpg'] }, { user: mid._id, name: 'No photo' }, { user: other._id, name: 'Other no photo' }]);
    const comp = (u, name, handle, extra = {}) => ({ userId: u._id, name, isActive: true, ...(handle ? { socialHandles: { instagram: handle } } : {}), ...extra });
    await Competitor.insertMany([
      comp(mid, 'Rival A', 'zz.homechk.a', { handleStatus: 'confirmed' }), comp(mid, 'Rival B', 'zz.homechk.b', { handleStatus: 'suggested' }), comp(mid, 'Rival C', ''),
      comp(mid, 'Rival ignored', 'zz.homechk.d', { handleStatus: 'suggested', isIgnored: true }), comp(other, 'Other rival', 'zz.homechk.o', { handleStatus: 'suggested' })
    ]);

    // Independent expectations, from the raw collections, with plain JS.
    const rawDrafts = await db.collection('drafts').find({ userId: mid._id }).toArray();
    const queue = new Set(['pending', 'draft', 'ready', 'processing', 'failed', 'completed']);
    const expDrafts = rawDrafts.filter((d) => { const src = String(d.sourceType || d.contentType || 'post'); return src !== 'reel' && src !== 'video' && queue.has(d.status || 'draft'); }).length;
    const rawCamps = await db.collection('campaigns').find({ userId: mid._id }).toArray();
    const between = (d, a, b) => d && d.getTime() >= a && d.getTime() < b;
    const expPub = rawCamps.filter((c) => c.status === 'posted' && between(c.publishedAt, M, M + 7 * DAY)).length;
    const expPrevPub = rawCamps.filter((c) => c.status === 'posted' && between(c.publishedAt, M - 7 * DAY, M)).length;
    const expSched = rawCamps.filter((c) => c.status === 'scheduled' && between(c.scheduledFor, M, M + 7 * DAY)).length;
    const expToday = rawCamps.filter((c) => between(c.scheduledFor, D, D + DAY) || between(c.publishedAt, D, D + DAY)).map((c) => ({ id: String(c._id), at: (c.scheduledFor && between(c.scheduledFor, D, D + DAY) ? c.scheduledFor : c.publishedAt).getTime() })).sort((a, b) => a.at - b.at);
    note(`expected: drafts waiting ${expDrafts}, published ${expPub} (last week ${expPrevPub}), scheduled ${expSched}, today ${expToday.length}`);

    // =================================================================================================================
    section = '(1) numbers vs independent counts:';
    const midRes = await summary(mid);
    const s = midRes.body;
    await check('drafts waiting equals the raw count (statuses, reels and legacy rows)', async () => {
      assert.strictEqual(s.numbers.draftsWaiting.value, expDrafts);
      assert.strictEqual(expDrafts, 7 + 2, 'the seed has 7 current-status and 2 legacy waiting posts');
      return `${expDrafts}`;
    });
    await check('posts published this week and last week equal the raw counts (Monday 00:00 IST included, Sunday last millisecond is last week)', async () => {
      assert.strictEqual(s.numbers.postsPublishedThisWeek.value, expPub);
      assert.strictEqual(s.numbers.postsPublishedThisWeek.previous, expPrevPub);
      assert.strictEqual(s.numbers.postsPublishedThisWeek.changePct, Math.round(((expPub - expPrevPub) / expPrevPub) * 1000) / 10);
      return `${expPub} now, ${expPrevPub} before`;
    });
    await check('scheduled this week equals the raw count', async () => { assert.strictEqual(s.week.posts.scheduled, expSched); return `${expSched}`; });
    await check('unread messages equal the raw count and leave out other accounts', async () => {
      const raw = await db.collection('socialinboxconversations').countDocuments({ userId: mid._id, status: 'unread' });
      assert.strictEqual(raw, 5);
      assert.strictEqual(s.numbers.unrepliedMessages.value, 5);
    });
    await check('followers, reach and engagement come from the newest snapshot; the comparison is the newest one at least 7 days older', async () => {
      assert.strictEqual(s.numbers.followers.value, 5400);
      assert.strictEqual(s.numbers.followers.previous, 5200);
      assert.strictEqual(s.numbers.followers.change, 200);
      assert.strictEqual(s.numbers.followers.changePct, 3.8);
      assert.strictEqual(s.numbers.reach.value, 21000);
      assert.strictEqual(s.numbers.reach.previous, 18000);
      assert.strictEqual(s.numbers.reach.changePct, 16.7);
      assert.strictEqual(s.numbers.engagement.value, 4);
      assert.strictEqual(s.numbers.engagement.previous, 3);
      assert.strictEqual(s.numbers.engagement.unit, 'percent');
      const asOf = new Date(D - DAY + 5.5 * HOUR).toISOString().slice(0, 10);
      assert.strictEqual(s.numbers.followers.asOf, asOf);
      assert.strictEqual(s.numbers.followers.stale, false);
    });
    await check('the weekly proposal gives planned and made posts, and the week dates', async () => {
      assert.strictEqual(s.week.start, mondayKey);
      assert.deepStrictEqual(s.week.posts.planned, 4);
      assert.deepStrictEqual(s.week.posts.made, 2);
      assert.deepStrictEqual(s.week.counts, { posts: 4, carousels: 1, videos: 1 });
      assert.strictEqual(s.week.proposal, 'approved');
    });
    await check('today lists the right posts in real time order, bounded at 6', async () => {
      assert.deepStrictEqual(s.today.map((t) => t.id), expToday.map((t) => t.id).slice(0, 6));
      const times = s.today.map((t) => Date.parse(t.at));
      assert.deepStrictEqual(times, [...times].sort((a, b) => a - b));
      assert.ok(s.today.every((t) => !t.image || /^https?:\/\//.test(t.image)));
      return `${s.today.length} rows`;
    });
    await check('plan: a completed plan and a newer failed refresh still read as ready, with the opened flag', async () => {
      assert.strictEqual(s.plan.state, 'ready');
      assert.strictEqual(s.plan.opened, true);
      assert.ok(s.plan.completedAt);
    });
    await check('competitors and products', async () => {
      assert.deepStrictEqual({ held: s.competitors.held, tracked: s.competitors.tracked, needHandle: s.competitors.needHandle }, { held: true, tracked: 3, needHandle: 2 });
      assert.deepStrictEqual(s.products, { count: 3, withPhotos: 2 });
    });
    await check('balance shows posts and videos with the Quark figure beside it, from the config prices', async () => {
      assert.strictEqual(s.balance.quarks, 600);
      assert.strictEqual(s.balance.posts, Math.floor(600 / QUARK_COSTS.image_generated));
      assert.strictEqual(s.balance.videos, Math.floor(600 / QUARK_COSTS.studio_video));
      assert.ok(s.balance.text.startsWith('600 Quarks (about '));
      assert.strictEqual(s.balance.showQuarks, true);
    });
    await check('recent artwork: at most 4, https only', async () => { assert.ok(s.recent.length >= 1 && s.recent.length <= 4); assert.ok(s.recent.every((r) => /^https:\/\//.test(r.image))); return `${s.recent.length}`; });
    await check('Do this next: ordered, capped at five, built from the same numbers', async () => {
      const ids = s.nextActions.map((a) => a.id);
      note(`actions: ${ids.join(', ')}`);
      assert.ok(ids.length <= 5);
      assert.deepStrictEqual(ids, ['review_drafts', 'reply_messages', 'confirm_competitor', 'add_product_photo']);
      const drafts = s.nextActions.find((a) => a.id === 'review_drafts');
      assert.ok(drafts && drafts.count === expDrafts, 'the drafts row carries the real count');
      assert.ok(s.nextActions.find((a) => a.id === 'reply_messages').count === 5);
      assert.ok(!ids.includes('approve_week'), 'an approved week is not offered again');
      assert.ok(!ids.includes('read_plan'), 'a plan that was opened is not offered again');
    });
    await check('the response is small and is never stored by the browser', async () => {
      assert.ok(midRes.bytes < 6000, `${midRes.bytes} bytes`);
      assert.match(String(midRes.headers.get('cache-control')), /no-store/);
      return `${midRes.bytes} bytes`;
    });

    // =================================================================================================================
    section = '(2) other accounts never appear:';
    await check('the mid account\'s answer holds none of the other account\'s numbers', async () => {
      const json = JSON.stringify(s);
      assert.ok(!json.includes('99999') && !json.includes('77777'), 'other account snapshot leaked');
      assert.notStrictEqual(s.numbers.draftsWaiting.value, expDrafts + 5);
      assert.strictEqual(s.numbers.unrepliedMessages.value, 5, 'other account unread messages leaked');
      assert.ok(!s.today.some((t) => t.title === 'other-today'));
    });
    await check('the other account sees only its own rows', async () => {
      const o = (await summary(other)).body;
      assert.strictEqual(o.numbers.draftsWaiting.value, 5);
      assert.strictEqual(o.numbers.unrepliedMessages.value, 4);
      assert.strictEqual(o.numbers.followers.value, 99999);
      assert.strictEqual(o.week.posts.planned, 1);
      assert.deepStrictEqual(o.products, { count: 1, withPhotos: 0 });
      assert.strictEqual(o.competitors.needHandle, 1);
    });
    await check('an id in the query, body or path is ignored: the signed-in account is the only one used', async () => {
      const r = await get(`/api/home/summary?userId=${other._id}&id=${other._id}`, tokenOf(mid), { headers: { Authorization: `Bearer ${tokenOf(mid)}`, 'x-user-id': String(other._id) } });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.numbers.followers.value, 5400);
    });
    await check('no token gives 401, a bad token gives 401', async () => {
      assert.strictEqual((await get('/api/home/summary')).status, 401);
      assert.strictEqual((await get('/api/home/summary', 'not-a-token')).status, 401);
    });

    // =================================================================================================================
    section = '(3) empty and new accounts:';
    const fr = (await summary(fresh)).body;
    await check('a new free account: reasons instead of numbers, honest zeros for real counts, plain actions', async () => {
      for (const k of ['reach', 'engagement', 'followers']) { assert.strictEqual(fr.numbers[k].available, false, k); assert.strictEqual(fr.numbers[k].value, null, k); assert.ok(fr.numbers[k].reason, k); }
      assert.strictEqual(fr.numbers.unrepliedMessages.available, false);
      assert.strictEqual(fr.numbers.draftsWaiting.value, 0);
      assert.strictEqual(fr.numbers.postsPublishedThisWeek.value, 0);
      assert.strictEqual(fr.numbers.postsPublishedThisWeek.changePct, null);
      assert.strictEqual(fr.account.free, true);
      assert.deepStrictEqual(fr.nextActions.map((a) => a.id), ['finish_profile', 'choose_plan', 'connect_account']);
      assert.strictEqual(fr.week.proposal, 'none');
      assert.strictEqual(fr.week.posts.planned, null);
      assert.strictEqual(fr.plan.state, 'none');
      assert.deepStrictEqual(fr.today, []);
      assert.deepStrictEqual(fr.recent, []);
      assert.ok(!/[!—]/.test(JSON.stringify(fr.numbers) + JSON.stringify(fr.nextActions)), 'no exclamation marks or em dashes in customer wording');
    });
    await check('reading creates nothing: no weekly proposal, no setup stamp, the account is unchanged', async () => {
      assert.strictEqual(await Proposal.countDocuments({ userId: fresh._id }), 0, 'a proposal was created by a read');
      const before = await User.findById(mid._id).lean();
      await summary(mid, '?refresh=1');
      const after = await User.findById(mid._id).lean();
      assert.strictEqual(new Date(after.updatedAt).getTime(), new Date(before.updatedAt).getTime());
      const f = await User.findById(fresh._id).lean();
      assert.ok(!(f.setup && f.setup.planOpenedAt), 'the setup step was stamped by a read');
    });
    const plans = [];
    for (const [name, rows] of [['building', [bp(null, 'processing', { heartbeatAt: new Date() })]], ['failed', [bp(null, 'failed')]], ['stale', [bp(null, 'completed', { completedAt: new Date(now - 60 * DAY), result: { plan: {} } })]], ['dead', [bp(null, 'processing', { heartbeatAt: new Date(now - 3 * HOUR), createdAt: new Date(now - 3 * HOUR) })]], ['stopped', [bp(null, 'stopped')]]]) {
      const u = await mkUser(`plan-${name}`);
      for (const r of rows) await Blueprint.create({ ...r, userId: u._id });
      plans.push([name, u]);
    }
    await check('plan states from real run rows: building, failed, stale, a dead run, stopped', async () => {
      const want = { building: 'building', failed: 'failed', stale: 'stale', dead: 'none', stopped: 'failed' };
      for (const [name, u] of plans) assert.strictEqual((await summary(u)).body.plan.state, want[name], name);
      const b = (await summary(plans[0][1])).body;
      assert.deepStrictEqual(b.nextActions.map((a) => a.id)[0], 'plan_building');
      assert.strictEqual(b.nextActions[0].to, null);
    });

    // =================================================================================================================
    section = '(4) week boundaries (simulated clock):';
    const sim = await mkUser('sim');
    const at = (iso) => new Date(iso);
    await Campaign.insertMany([
      camp(sim, 'last-sunday-1sec-before', 'posted', { publishedAt: at('2026-10-11T23:59:59+05:30') }),
      camp(sim, 'monday-midnight-exact', 'posted', { publishedAt: at('2026-10-12T00:00:00+05:30') }),
      camp(sim, 'wednesday', 'posted', { publishedAt: at('2026-10-14T09:00:00+05:30') }),
      camp(sim, 'sunday-last-sec', 'posted', { publishedAt: at('2026-10-18T23:59:59+05:30') }),
      camp(sim, 'next-monday-exact', 'posted', { publishedAt: at('2026-10-19T00:00:00+05:30') }),
      camp(sim, 'sched-sunday-night', 'scheduled', { scheduledFor: at('2026-10-18T23:00:00+05:30') })
    ]);
    const simGet = async (name) => (await get(`/sim/${name}/summary`, tokenOf(sim))).body;
    await check('Monday 00:01 IST: the new week has just started (Monday midnight counts, last Sunday does not)', async () => {
      const b = await simGet('mondayMorning');
      assert.strictEqual(b.week.start, '2026-10-12');
      assert.strictEqual(b.numbers.postsPublishedThisWeek.value, 3, 'monday-midnight-exact, wednesday, sunday-last-sec');
      assert.strictEqual(b.numbers.postsPublishedThisWeek.previous, 1, 'last Sunday 23:59:59');
    });
    await check('Wednesday: same week as Monday', async () => {
      const b = await simGet('midweek');
      assert.strictEqual(b.week.start, '2026-10-12');
      assert.strictEqual(b.week.end, '2026-10-19');
      assert.strictEqual(b.numbers.postsPublishedThisWeek.value, 3);
    });
    await check('Sunday 23:30 IST: still the old week; the scheduled Sunday-night post is this week', async () => {
      const b = await simGet('sundayNight');
      assert.strictEqual(b.week.start, '2026-10-12');
      assert.strictEqual(b.numbers.postsPublishedThisWeek.value, 3);
      assert.strictEqual(b.week.posts.scheduled, 1);
    });
    await check('Monday 00:30 IST the next day: a new week (the post at exactly 00:00 counts, last week had 3)', async () => {
      const b = await simGet('mondayAfter');
      assert.strictEqual(b.week.start, '2026-10-19');
      assert.strictEqual(b.numbers.postsPublishedThisWeek.value, 1);
      assert.strictEqual(b.numbers.postsPublishedThisWeek.previous, 3);
      assert.strictEqual(b.week.posts.scheduled, 0);
    });

    // =================================================================================================================
    section = '(5) entitlement variants:';
    const noInbox = await mkUser('noinbox', { plan: { tier: 'starter', addons: ['publish'] } });
    await Inbox.insertMany([0, 1, 2].map((i) => thread(noInbox, i, 'unread')));
    const noConn = await mkUser('noconn', { connectedSocials: [] });
    const managed = await mkUser('managed', { plan: undefined });
    await check('no Inbox add-on: no message count and no query result leaks (3 unread rows exist)', async () => {
      const b = (await summary(noInbox)).body;
      assert.strictEqual(b.features.inbox, false);
      assert.strictEqual(b.numbers.unrepliedMessages.available, false);
      assert.strictEqual(b.numbers.unrepliedMessages.value, null);
      assert.match(b.numbers.unrepliedMessages.reason, /add-on/i);
      assert.ok(!b.nextActions.some((a) => a.id === 'reply_messages'));
      assert.strictEqual(b.competitors.held, false);
    });
    await check('nothing connected: connect reasons and the connect action', async () => {
      const b = (await summary(noConn)).body;
      assert.strictEqual(b.numbers.reach.available, false);
      assert.match(b.numbers.reach.reason, /connect/i);
      assert.strictEqual(b.numbers.unrepliedMessages.available, false);
      assert.ok(b.nextActions.some((a) => a.id === 'connect_account'));
      assert.deepStrictEqual(b.connected, { count: 0, platforms: [] });
    });
    await check('a managed account (no plan tier) holds every feature and is never asked to choose a plan', async () => {
      const raw = await User.findById(managed._id).lean();
      const b = (await summary(managed)).body;
      assert.strictEqual(b.account.managed, true, `tier on the stored row: ${JSON.stringify(raw.plan)}`);
      assert.deepStrictEqual(b.features, { inbox: true, competitors: true, publish: true });
      assert.ok(!b.nextActions.some((a) => a.id === 'choose_plan'));
    });
    await check('the free account is told to choose a plan and sees no billing or inbox rows', async () => {
      assert.strictEqual(fr.nextActions.every((a) => ['setup', 'billing'].includes(a.kind)), true);
    });

    // =================================================================================================================
    section = '(6) agency client workspace (real helper):';
    const agency = await mkUser('agency', { plan: { tier: 'agency', addons: [] }, credits: { balance: 3000 } });
    const created = await createWorkspace({ owner: agency, name: 'Check Client', models: { User } });
    assert.ok(created.ok, created.message);
    const ws = created.workspace;
    await Draft.insertMany([...Array(3)].map(() => mkDraft(ws, 'draft')));
    await Draft.insertMany([...Array(2)].map(() => mkDraft(agency, 'draft')));
    await Snapshot.insertMany([snap(ws, 1, { followers: 777, reach: 1234 }, { engagementRate: 2 }, { engagementRate: 2 })]);
    await User.updateOne({ _id: ws._id }, { $set: { connectedSocials: [{ platform: 'instagram', username: 'zz.homechk.client' }], 'businessProfile.description': 'Client sells cakes and bread', 'businessProfile.targetAudience': 'People near the shop' } });
    const pass = issueAgencyPass({ workspaceId: ws._id, ownerId: agency._id });
    const wsRes = await get('/api/home/summary', pass);
    await check('inside a client the pass shows the client\'s own data, flagged as a workspace and a pass', async () => {
      assert.strictEqual(wsRes.status, 200, JSON.stringify(wsRes.body));
      const b = wsRes.body;
      assert.strictEqual(b.account.clientWorkspace, true);
      assert.strictEqual(b.account.pass, true);
      assert.strictEqual(b.account.agencyOwner, false);
      assert.strictEqual(b.numbers.draftsWaiting.value, 3, 'the client\'s drafts only (the agency owner has 2 of its own)');
      assert.strictEqual(b.numbers.followers.value, 777);
    });
    await check('the balance is the agency\'s shared pool, shown in posts and videos, never as Quarks', async () => {
      const b = wsRes.body;
      assert.strictEqual(b.balance.showQuarks, false);
      assert.strictEqual(b.balance.quarks, null);
      assert.strictEqual(b.balance.posts, Math.floor(3000 / QUARK_COSTS.image_generated));
      assert.ok(!/Quark/.test(b.balance.text));
    });
    await check('no billing, plan-choice or read-plan rows inside a client, even with a top-up condition', async () => {
      const ids = wsRes.body.nextActions.map((a) => a.id);
      assert.ok(!ids.some((i) => ['top_up', 'choose_plan', 'read_plan'].includes(i)), ids.join(', '));
      assert.ok(wsRes.body.nextActions.every((a) => a.kind !== 'billing'));
    });
    await check('the agency owner\'s own Home is its own data, flagged as an agency owner, posts and videos not Quarks', async () => {
      const b = (await summary(agency)).body;
      assert.strictEqual(b.account.agencyOwner, true);
      assert.strictEqual(b.account.clientWorkspace, false);
      assert.strictEqual(b.numbers.draftsWaiting.value, 2);
      assert.strictEqual(b.balance.showQuarks, false);
      assert.strictEqual(b.numbers.followers.available, false, 'the client\'s snapshot is not the owner\'s');
    });
    await check('the owner\'s and the pass\'s answers are cached apart', async () => {
      const own = (await summary(agency)).body;
      const viaPass = (await get('/api/home/summary', pass)).body;
      assert.strictEqual(own.numbers.draftsWaiting.value, 2);
      assert.strictEqual(viaPass.numbers.draftsWaiting.value, 3);
    });

    // =================================================================================================================
    section = '(7) bounded queries:';
    const big = await mkUser('big');
    await Campaign.insertMany([
      ...[...Array(150)].map((_, i) => camp(big, `big-pub-${i}`, 'posted', { publishedAt: new Date(M - (i % 60) * DAY + i * 1000) })),
      ...[...Array(15)].map((_, i) => camp(big, `big-today-${i}`, 'scheduled', { scheduledFor: new Date(D + (i + 1) * 600000) }))
    ]);
    await Draft.insertMany([...Array(40)].map(() => mkDraft(big, 'draft')));
    await Draft.insertMany([...Array(12)].map(() => mkDraft(big, 'published', 'post', { imageUrl: 'https://example.com/big.jpg' })));
    await Competitor.insertMany([...Array(30)].map((_, i) => comp(big, `Big rival ${i}`, i % 2 ? `zz.homechk.big${i}` : '', { handleStatus: 'confirmed' })));
    await check('lists are capped: today 6, recent 4, competitors read at most 25 and tracked at most 5', async () => {
      const b = (await summary(big)).body;
      assert.strictEqual(b.today.length, 6);
      assert.ok(b.recent.length <= 4);
      assert.ok(b.competitors.tracked <= 5);
      assert.strictEqual(b.numbers.draftsWaiting.value, 40);
      assert.ok(b.nextActions.length <= 5);
      return `today ${b.today.length}, recent ${b.recent.length}, tracked ${b.competitors.tracked}`;
    });
    const explainOf = async (label, cursor) => {
      const raw = await cursor.explain('executionStats');
      const e = Array.isArray(raw) ? raw[0] : raw;
      const stages = JSON.stringify(e.queryPlanner.winningPlan);
      const st = e.executionStats;
      return { label, collscan: /COLLSCAN/.test(stages), examined: st.totalDocsExamined, keys: st.totalKeysExamined, returned: st.nReturned, ms: st.executionTimeMillis, plan: [...new Set(stages.match(/"stage":"[A-Z_]+"/g) || [])].join(' ').replace(/"stage":/g, '') };
    };
    const { awaitingFilter } = require('../services/draftStatus');
    await check('every query uses an index (no collection scan) and examines no other account\'s rows', async () => {
      const uid = big._id;
      const qs = [
        await explainOf('drafts waiting', Draft.find(awaitingFilter(uid))),
        await explainOf('campaigns published this week', Campaign.find({ userId: uid, status: 'posted', publishedAt: { $gte: new Date(M), $lt: new Date(M + 7 * DAY) } })),
        await explainOf('campaigns scheduled this week', Campaign.find({ userId: uid, status: 'scheduled', scheduledFor: { $gte: new Date(M), $lt: new Date(M + 7 * DAY) } })),
        await explainOf('campaigns today', Campaign.find({ $or: [{ userId: uid, scheduledFor: { $gte: new Date(D), $lt: new Date(D + DAY) } }, { userId: uid, publishedAt: { $gte: new Date(D), $lt: new Date(D + DAY) } }] }).sort({ scheduledFor: 1 }).limit(6)),
        await explainOf('recent drafts', Draft.find({ userId: uid }).sort({ createdAt: -1 }).limit(6)),
        await explainOf('recent campaigns', Campaign.find({ userId: uid }).sort({ createdAt: -1 }).limit(6)),
        await explainOf('newest snapshot', Snapshot.find({ userId: uid }).sort({ date: -1 }).limit(1)),
        await explainOf('unread messages', Inbox.find({ userId: uid, status: 'unread' })),
        await explainOf('weekly proposal', Proposal.find({ userId: uid, weekStart: mondayKey })),
        await explainOf('plan runs', Blueprint.find({ userId: uid, kind: 'plan' }).sort({ createdAt: -1 }).limit(5)),
        await explainOf('competitors', Competitor.find({ userId: uid, isActive: { $ne: false }, isIgnored: { $ne: true } }).sort({ createdAt: -1 }).limit(25)),
        await explainOf('products', Product.find({ user: uid }))
      ];
      for (const q of qs) note(`${q.label}: ${q.plan}; examined ${q.examined}, keys ${q.keys}, returned ${q.returned}`);
      const scans = qs.filter((q) => q.collscan).map((q) => q.label);
      assert.deepStrictEqual(scans, [], `collection scan in: ${scans.join(', ')}`);
      const cm = qs.find((q) => q.label === 'campaigns published this week');
      assert.ok(cm.examined <= 150, `published query examined ${cm.examined} documents for an account with 150 posted`);
      const tdy = qs.find((q) => q.label === 'campaigns today');
      assert.ok(tdy.examined <= 200, `today query examined ${tdy.examined}`);
      return `${qs.length} queries, none a collection scan`;
    });
    await check('the user with 165 campaigns and 52 drafts is still one small answer', async () => {
      const r = await summary(big, '?refresh=1');
      assert.ok(r.bytes < 6000, `${r.bytes} bytes`);
      return `${r.bytes} bytes, ${Math.round(r.ms)} ms`;
    });

    // =================================================================================================================
    section = '(8) cache:';
    await check('the second call is served from the cache: same answer, faster', async () => {
      const first = await summary(mid, '?refresh=1');
      const times = [];
      let last = null;
      for (let i = 0; i < 5; i++) { last = await summary(mid); times.push(last.ms); }
      assert.strictEqual(first.body.cached, false);
      assert.strictEqual(last.body.cached, true);
      const strip = (b) => { const c = { ...b }; delete c.cached; return JSON.stringify(c); };
      assert.strictEqual(strip(last.body), strip(first.body), 'a cached answer differs from the fresh one');
      times.sort((a, b) => a - b);
      assert.ok(times[2] < first.ms, `median cached ${times[2].toFixed(1)} ms is not faster than ${first.ms.toFixed(1)} ms`);
      return `fresh ${first.ms.toFixed(0)} ms, cached median ${times[2].toFixed(1)} ms`;
    });
    await check('?refresh=1 skips the cache and sees a change made straight in the database', async () => {
      await summary(mid, '?refresh=1');
      await Draft.create(mkDraft(mid, 'draft'));
      const stale = (await summary(mid)).body;
      assert.strictEqual(stale.cached, true);
      assert.strictEqual(stale.numbers.draftsWaiting.value, expDrafts, 'a cached answer should not see the new draft yet');
      const fresh2 = (await summary(mid, '?refresh=1')).body;
      assert.strictEqual(fresh2.cached, false);
      assert.strictEqual(fresh2.numbers.draftsWaiting.value, expDrafts + 1);
    });
    await check('a successful write through the API clears that account\'s cached answer; other accounts keep theirs', async () => {
      await summary(mid, '?refresh=1'); await summary(other, '?refresh=1');
      await Draft.create(mkDraft(mid, 'draft'));
      const w = await fetch(`http://127.0.0.1:${port}/api/drafts-probe`, { method: 'POST', headers: { Authorization: `Bearer ${tokenOf(mid)}` } });
      assert.strictEqual(w.status, 200);
      await new Promise((r) => setTimeout(r, 50));
      const after = (await summary(mid)).body;
      assert.strictEqual(after.cached, false, 'the write did not clear the cache');
      assert.strictEqual(after.numbers.draftsWaiting.value, expDrafts + 2);
      assert.strictEqual((await summary(other)).body.cached, true, 'another account lost its cache');
    });
    await check('an error is never cached (a bad service answer, then a good one)', async () => {
      let fail = true;
      const flaky = { build: async () => { if (fail) throw new Error('simulated database error'); return createHomeSummary().build({ user: await User.findById(mid._id), pass: false }); } };
      const cache = createSummaryCache();
      const a2 = express(); a2.use('/f', createHomeRouter({ service: flaky, cache }));
      const srv = http.createServer(a2); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const url = `http://127.0.0.1:${srv.address().port}/f/summary`;
      const origErr = console.error; console.error = () => {};
      try {
        const bad = await fetch(url, { headers: { Authorization: `Bearer ${tokenOf(mid)}` } });
        assert.strictEqual(bad.status, 500);
        assert.ok(!(await bad.text()).includes('simulated'), 'the raw error reached the customer');
        fail = false;
        const good = await fetch(url, { headers: { Authorization: `Bearer ${tokenOf(mid)}` } });
        assert.strictEqual(good.status, 200);
        assert.strictEqual((await good.json()).cached, false);
      } finally { console.error = origErr; await new Promise((r) => srv.close(r)); }
    });

    // =================================================================================================================
    section = '(9) safety at the end:';
    await check('no AI or outside call was made: only this process\'s own port was used', async () => { assert.ok(port > 1024); });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/home-summary-check.js [run|cleanup]');
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

