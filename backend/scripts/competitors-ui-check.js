/**
 * Sets up throwaway accounts in the DEVELOPMENT database so the Stage 4 competitor card can be looked at in a browser.
 * Refuses any other database. No scraper and no AI model is called: the weekly tracker runs with a FAKE profile reader.
 *   node scripts/competitors-ui-check.js setup     makes the accounts and prints a login token for each
 *   node scripts/competitors-ui-check.js cleanup   deletes everything the setup made and prints how many rows are left
 * Accounts (all email addresses start with "uicheck4-"):
 *   entitled  has the add-on, 3 competitors with handles, two weekly snapshots (one a week ago, one now), a finished plan
 *   empty     has the add-on, competitors that have not been read yet (no snapshots), a finished plan
 *   none      has the add-on and no competitors at all, a finished plan
 *   locked    no add-on, a finished plan
 */
require('dotenv').config();
const mongoose = require('mongoose');

const PREFIX = 'uicheck4-';
const DAY = 864e5;

const profileFor = (name, followers, posts) => ({
  success: true,
  data: [{ username: name, followersCount: followers, latestPosts: posts }]
});

const post = (at, ago, likes, comments, type, tags) => ({
  timestamp: new Date(at - ago * DAY).toISOString(), likesCount: likes, commentsCount: comments, type, hashtags: tags || [], url: `https://www.instagram.com/p/${Math.random().toString(36).slice(2, 8)}/`, caption: 'check'
});

// What the fake reader returns, per handle and per simulated week (0 = a week ago, 1 = now).
function fakeReader(week, at) {
  return async (handle) => {
    if (handle === 'cakehouse.check') {
      return week === 0
        ? profileFor(handle, 4200, [post(at, 1, 80, 4, 'Image'), post(at, 3, 90, 5, 'Image'), post(at, 12, 85, 3, 'Image')])
        : profileFor(handle, 4310, [post(at, 0.5, 70, 2, 'Image'), post(at, 1, 75, 3, 'Image'), post(at, 2, 60, 2, 'Sidecar'), post(at, 3, 410, 38, 'Video', ['cakes']), post(at, 5, 66, 4, 'Image'), post(at, 6, 72, 1, 'Image'), post(at, 15, 80, 4, 'Image')]);
    }
    if (handle === 'brewlane.check') {
      return week === 0
        ? profileFor(handle, 9100, [post(at, 1, 300, 10, 'Image'), post(at, 2, 280, 9, 'Image'), post(at, 4, 310, 12, 'Image'), post(at, 6, 290, 8, 'Image')])
        : profileFor(handle, 9040, [post(at, 2, 260, 7, 'Image')]);
    }
    // studionine.check: read in week 0, fails (private) in week 1
    if (week === 1) return { success: true, data: [{ username: handle, private: true }] };
    return profileFor(handle, 1500, [post(at, 2, 40, 2, 'Image'), post(at, 5, 38, 1, 'Image')]);
  };
}

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== 'nebulaa_dev') throw new Error(`Refusing: database is ${mongoose.connection.name}, not nebulaa_dev`);
}

async function setup() {
  const User = require('../models/User');
  const Competitor = require('../models/Competitor');
  const Blueprint = require('../models/Blueprint');
  const { generateToken } = require('../middleware/auth');
  const tracker = require('../services/competitors/tracker');
  const legal = require('../config/legalVersions');
  const tag = `${PREFIX}${Date.now()}`;
  const now = Date.now();
  const mk = async (suffix, addons) => {
    const user = await User.create({
      email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
      plan: { tier: 'starter', addons },
      consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'ui-check' },
      credits: { balance: 600, planBalance: 600, planExpiresAt: new Date(now + 20 * DAY) },
      businessProfile: { name: 'Check Bakery', website: 'https://example.com', description: 'Fresh cakes and bread baked every morning', targetAudience: 'Families and office teams nearby' }
    });
    await Blueprint.create({
      blueprintId: `${tag}-${suffix}`, userId: user._id, emailKey: `${tag}-${suffix}`, tierAtStart: 'starter', status: 'completed', kind: 'plan', completedAt: new Date(),
      result: { plan: { promise: { text: 'Fresh cakes for your neighbourhood.', tag: 'proposed' }, positioning: { line: 'The neighbourhood bakery you can trust.' },
        roadmap: [{ phase: 'days_1_30', focus: { text: 'Show what you bake every day.', tag: 'proposed' }, actions: [{ text: 'Post three photos a week.', tag: 'proposed' }], measure: [{ text: 'More enquiries.', tag: 'proposed' }] }] } }
    });
    return user;
  };
  const rival = (user, name, handle) => Competitor.create({ userId: user._id, name, website: 'https://example.com', socialHandles: { instagram: handle }, isActive: true });
  // The tracker is off unless the switch is "on" and it takes a lease and a read ledger: here all three are in-memory fakes.
  const { createReadLedger } = require('../services/competitors/readLedger');
  const ledger = createReadLedger({ Model: null });
  const lease = { claim: async () => ({ value: 'check' }), renew: async (t) => t, release: async () => {} };
  const fakeDeps = (week, at) => ({
    scrapeProfile: fakeReader(week, at), sleep: async () => {}, gate: async () => [],
    spend: { check: async () => ({ ok: true }), record: async () => {} },
    env: { ENABLE_COMPETITOR_TRACKER: 'on' }, ledger, lease
  });

  const entitled = await mk('entitled', ['competitors']);
  await rival(entitled, 'Cake House', 'cakehouse.check');
  await rival(entitled, 'Brew Lane', 'brewlane.check');
  await rival(entitled, 'Studio Nine', 'studionine.check');
  const weekAgo = new Date(now - 7 * DAY);
  await tracker.runTrackerOnce({ deps: fakeDeps(0, weekAgo.getTime()), now: weekAgo, accountIds: [entitled._id], force: true });
  await tracker.runTrackerOnce({ deps: fakeDeps(1, now), now: new Date(now), accountIds: [entitled._id] });

  const empty = await mk('empty', ['competitors']);
  await rival(empty, 'Cake House', 'cakehouse.check');
  const noHandle = await Competitor.create({ userId: empty._id, name: 'Corner Sweets', isActive: true });
  const none = await mk('none', ['competitors']);
  const locked = await mk('locked', []);

  const ids = { entitled, empty, none, locked };
  const out = {};
  for (const [k, u] of Object.entries(ids)) out[k] = { id: String(u._id), token: generateToken(u._id) };
  void noHandle;
  console.log(JSON.stringify(out, null, 1));
}

async function cleanup() {
  const db = mongoose.connection.db;
  const users = await db.collection('users').find({ email: { $regex: `^${PREFIX}` } }, { projection: { _id: 1 } }).toArray();
  const ids = users.map((u) => u._id);
  const idStrings = ids.map(String);
  // Only the collections the setup writes to are cleaned. Every other collection is looked at (read only, a few
  // seconds each at most) so a stray row from a background job would be reported, not silently left.
  const removed = {};
  const del = async (name, filter) => { const n = (await db.collection(name).deleteMany(filter)).deletedCount; if (n) removed[name] = (removed[name] || 0) + n; };
  if (ids.length) {
    await del('competitor_snapshots', { userId: { $in: ids } });
    await del('competitors', { userId: { $in: ids } });
  }
  await del('blueprints', { blueprintId: { $regex: `^${PREFIX}` } });
  await del('users', { _id: { $in: ids } });
  console.log('removed', JSON.stringify(removed));
  const stray = {};
  if (ids.length) {
    for (const { name } of await db.listCollections().toArray()) {
      if (['users', 'competitors', 'competitor_snapshots', 'blueprints'].includes(name)) continue;
      try {
        const n = await db.collection(name).countDocuments({ userId: { $in: [...ids, ...idStrings] } }, { maxTimeMS: 4000 });
        if (n) stray[name] = n;
      } catch (_) { stray[name] = 'not checked'; }
    }
  }
  console.log('other collections with rows for these accounts', JSON.stringify(stray));
  // Anything left that could belong to the check accounts.
  const left = {
    users: await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX}` } }),
    competitors: ids.length ? await db.collection('competitors').countDocuments({ userId: { $in: ids } }) : 0,
    competitor_snapshots: ids.length ? await db.collection('competitor_snapshots').countDocuments({ userId: { $in: ids } }) : 0,
    blueprints: await db.collection('blueprints').countDocuments({ blueprintId: { $regex: `^${PREFIX}` } })
  };
  console.log('left', JSON.stringify(left));
}

(async () => {
  const mode = process.argv[2];
  if (mode !== 'setup' && mode !== 'cleanup') throw new Error('Usage: node scripts/competitors-ui-check.js setup|cleanup');
  await connect();
  if (mode === 'setup') await setup(); else await cleanup();
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
