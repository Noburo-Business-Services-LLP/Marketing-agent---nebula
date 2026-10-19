/**
 * Real-database check of competitor post pictures (services/competitors/postThumbs.js) against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO read of any social page, NO picture download, NO upload: the Instagram read,
 * the picture host, its DNS answer and the image storage are fakes in this process. Only Mongo is real.
 *   node scripts/competitor-thumbs-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/competitor-thumbs-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.thumbchk-". Exit code is non-zero on any
 * FAIL, or if anything is left over.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');

const PREFIX = 'zz.thumbchk-';
const DEV_DB = 'nebulaa_dev';
const DAY = 864e5;
const ON = { ENABLE_COMPETITOR_THUMBS: 'on' };

const results = [];
let section = '';
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

const OWNED = { competitors: 'userId', competitor_snapshots: 'userId', competitor_read_log: 'userId' };

async function cleanup(db) {
  const users = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  const ids = users.map((u) => u._id);
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
  left.users = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } });
  console.log('left', JSON.stringify(left));
  return { removed, left, removedTotal: Object.values(removed).reduce((a, b) => a + b, 0) };
}

async function runChecks() {
  const sharp = require('sharp');
  const User = require('../models/User');
  const Competitor = require('../models/Competitor');
  const Snapshot = require('../models/CompetitorSnapshot');
  const legal = require('../config/legalVersions');
  const T = require('../services/competitors/postThumbs');
  const { trackOne } = require('../services/competitors/tracker');
  const { removeCompetitorsWithSnapshots } = require('../services/competitors/cleanup');
  const { build } = require('../routes/competitorBestPosts');
  const { extractAssets } = require('../services/cloudinaryCleanup');
  const fixture = require('../tests/fixtures/instagram-profile-real-nebulaa-os.json');

  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });

  const tag = `${PREFIX}${Date.now()}`;
  const stamp = String(Date.now()).slice(-7);
  const NOW = new Date();
  const mkUser = (suffix) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['competitors'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `Thumbs ${suffix}`, website: 'https://example.com', description: 'Bakery', targetAudience: 'Families nearby', industry: 'Food & Beverage' },
    credits: { balance: 100 }
  });
  const owner = await mkUser('owner');
  const other = await mkUser('other');
  const mkComp = (user, name, handle) => Competitor.create({ userId: user._id, name, website: 'https://example.com', isActive: true, socialHandles: { instagram: handle }, handleStatus: 'confirmed' });
  const rival = await mkComp(owner, 'Thumbs Check Bakery', 'zz_thumb_bakery');
  const theirs = await mkComp(other, 'Thumbs Check Other', 'zz_thumb_other');
  const THEIR_URL = `https://res.cloudinary.com/zzcheck/image/upload/v1/nebula-competitor-posts/${theirs._id}-p-OTHER.webp`;
  await Competitor.updateOne({ _id: theirs._id }, { $set: { postThumbs: [{ postKey: 'p-OTHER', thumbUrl: THEIR_URL, at: NOW }] } });

  // ---- fakes: the read (real field names from the fixture), the picture host, its DNS and the storage ---------------
  const jpg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 245, g: 166, b: 35 } } }).jpeg({ quality: 90 }).toBuffer();
  const base = fixture.data[0].latestPosts;
  const posts = (prefix, n, startDays) => Array.from({ length: n }, (_, i) => {
    const code = `ZZ${prefix}${stamp}${i}`;
    return { ...base[i % base.length], id: code, shortCode: code, url: `https://www.instagram.com/p/${code}/`, timestamp: new Date(+NOW - (startDays + i * 0.5) * DAY).toISOString(),
      likesCount: 40 + ((i * 37) % 90), commentsCount: i % 4, isPinned: false, displayUrl: `https://scontent-bom1-1.cdninstagram.com/v/t51.29350-15/${code}_n.jpg?oh=SIG`, images: [] };
  });
  const profile = (list) => ({ ...fixture.data[0], username: 'zz_thumb_bakery', latestPosts: list });
  const calls = { requests: 0, puts: [], removed: [] };
  const fakeDeps = (env = ON, extra = {}) => ({
    env,
    request: async () => { calls.requests++; return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: jpg }; },
    resolve: async () => [{ address: '157.240.1.1', family: 4 }],
    storage: {
      put: async (key, buf) => { calls.puts.push([key, buf.length]); return `https://res.cloudinary.com/zzcheck/image/upload/v${Date.now()}/nebula-competitor-posts/${key}.webp`; },
      remove: async (urls) => { calls.removed.push(...urls); return { requested: urls.length, failedBatches: 0 }; }
    },
    ...extra
  });
  const read = (comp, prof, at, env = ON, extra = {}) => trackOne({
    competitor: comp, user: owner, now: at,
    deps: {
      env: { ENABLE_COMPETITOR_TRACKER: 'on', ...env },
      scrapeProfile: async () => ({ success: true, data: [prof] }),
      refreshAvatar: async () => ({ ok: false, skipped: 'check' }),
      refreshPostThumbs: (args) => T.refreshPostThumbs({ ...args, deps: fakeDeps(env, extra) })
    }
  });
  const fresh = (id) => Competitor.findById(id).lean();
  const week1 = posts('A', 12, 0.1);

  section = '(1) switch:';
  await check('with ENABLE_COMPETITOR_THUMBS off the read is saved and no picture is fetched or stored', async () => {
    const r = await read(await fresh(rival._id), profile(week1), NOW, {});
    assert.deepStrictEqual(r, { ok: true, read: true });
    assert.strictEqual(calls.requests + calls.puts.length, 0);
    assert.strictEqual(((await fresh(rival._id)).postThumbs || []).length, 0);
    assert.strictEqual(await Snapshot.countDocuments({ competitorId: rival._id, ok: true }), 1);
  });

  section = '(2) the weekly read stores the top posts:';
  let stored;
  await check('switched on: at most six pictures, 360 x 450 WebP within 40 KB, only our links on the record and the snapshot', async () => {
    await Competitor.updateOne({ _id: rival._id }, { $set: { 'tracking.lastCheckedAt': null } });
    const r = await T.refreshPostThumbs({ competitor: await fresh(rival._id), profile: profile(week1), snapshots: await Snapshot.find({ competitorId: rival._id }).lean(), now: NOW, deps: fakeDeps() });
    assert.strictEqual(r.ok, true);
    stored = (await fresh(rival._id)).postThumbs;
    assert.ok(stored.length >= 3 && stored.length <= 6, `stored ${stored.length}`);
    for (const t of stored) assert.ok(T.isStoredThumbUrl(t.thumbUrl) && t.thumbUrl.includes(`/nebula-competitor-posts/${rival._id}-${t.postKey}.webp`), t.thumbUrl);
    for (const [, size] of calls.puts) assert.ok(size > 0 && size <= T.MAX_STORED_BYTES, `size ${size}`);
    const meta = await sharp(await T.resizeThumb(jpg)).metadata();
    assert.deepStrictEqual([meta.width, meta.height, meta.format], [360, 450, 'webp']);
    const snap = await Snapshot.findOne({ competitorId: rival._id }).lean();
    assert.ok(!JSON.stringify(await fresh(rival._id)).includes('cdninstagram') && !JSON.stringify(snap).includes('cdninstagram'), 'no Instagram picture link stored');
    return `${stored.length} stored, largest ${Math.max(...calls.puts.map((p) => p[1]))} bytes`;
  });

  section = '(3) the endpoint:';
  await check('best-posts gives our link on the best post, What is working and the gallery when on; null everywhere when off', async () => {
    const user = await User.findById(owner._id).lean();
    const on = await build({ user, now: NOW, deps: { canUse: () => ({ allowed: true }), trackerOn: () => true, thumbsOn: () => true } });
    const card = on.competitors.find((c) => c.id === String(rival._id));
    assert.ok(card && card.bestPost && T.isStoredThumbUrl(card.bestPost.thumbUrl), 'best post has our picture');
    assert.ok(card.gallery.length >= 3 && card.gallery.filter((g) => g.thumbUrl).every((g) => T.isStoredThumbUrl(g.thumbUrl)));
    assert.ok(on.working[0] && T.isStoredThumbUrl(on.working[0].thumbUrl));
    assert.strictEqual(on.thumbsOn, true);
    assert.ok(!on.competitors.some((c) => c.id === String(theirs._id)), 'another account is never shown');
    assert.ok(!JSON.stringify(on).includes('cdninstagram') && !JSON.stringify(on).includes(THEIR_URL));
    assert.ok(on.trending.some((t) => t.source === 'news') || on.trending.length > 0);
    const off = await build({ user, now: NOW, deps: { canUse: () => ({ allowed: true }), trackerOn: () => true, thumbsOn: () => false } });
    const c2 = off.competitors.find((c) => c.id === String(rival._id));
    assert.strictEqual(c2.bestPost.thumbUrl, null);
    assert.ok(c2.gallery.every((g) => g.thumbUrl === null) && off.working.every((w) => w.thumbUrl === null));
    return `${card.gallery.filter((g) => g.thumbUrl).length} of ${card.gallery.length} gallery posts with a picture`;
  });

  section = '(4) weekly refresh:';
  await check('a week later: stored posts still chosen are not fetched again, new top posts are added, drop-outs deleted', async () => {
    const later = new Date(+NOW + 8 * DAY);
    const week2 = [...posts('B', 4, 0.1).map((p) => ({ ...p, likesCount: 900 })), ...week1.slice(0, 2)];
    const putsBefore = calls.puts.length; const removedBefore = calls.removed.length;
    const r = await read(await fresh(rival._id), profile(week2), later);
    assert.deepStrictEqual(r, { ok: true, read: true });
    const now2 = (await fresh(rival._id)).postThumbs;
    assert.ok(now2.length <= 6);
    const newKeys = now2.map((t) => t.postKey);
    const fetched = calls.puts.slice(putsBefore).map((p) => p[0].replace(`${rival._id}-`, ''));
    for (const k of fetched) assert.ok(!stored.some((t) => t.postKey === k), `${k} was already stored and was fetched again`);
    const removed = calls.removed.slice(removedBefore);
    for (const u of removed) assert.ok(!now2.some((t) => t.thumbUrl === u));
    assert.ok(stored.filter((t) => !newKeys.includes(t.postKey)).every((t) => removed.includes(t.thumbUrl)), 'every drop-out is deleted');
    assert.ok(newKeys.some((k) => k.startsWith(`p-ZZB${stamp}`)));
    stored = now2;
    return `${fetched.length} added, ${removed.length} deleted, ${now2.length} kept`;
  });

  section = '(5) caps:';
  await check('the global count reads the real collection; at the cap nothing new is added', async () => {
    const n = await T.countStored(Competitor);
    assert.ok(n >= stored.length + 1, `count ${n}`);
    const putsBefore = calls.puts.length;
    const r = await T.refreshPostThumbs({ competitor: await fresh(rival._id), profile: profile(posts('C', 6, 0.05).map((p) => ({ ...p, likesCount: 5000 }))), now: new Date(+NOW + 9 * DAY),
      deps: fakeDeps(ON, { countStored: async () => require('../config/competitors').THUMBS_GLOBAL_MAX }) });
    assert.strictEqual(calls.puts.length, putsBefore);
    assert.strictEqual(r.added, 0);
    return `${n} stored in nebulaa_dev`;
  });

  section = '(6) privacy:';
  await check('account deletion finds every stored post picture among the files to delete', async () => {
    const c = await fresh(rival._id);
    const ids = extractAssets(JSON.stringify(c)).map((a) => a.publicId);
    for (const t of c.postThumbs) assert.ok(ids.includes(`nebula-competitor-posts/${rival._id}-${t.postKey}`));
  });
  await check('ignoring (or a new handle) clears the pictures on the record and deletes the files', async () => {
    const c = await fresh(rival._id);
    const out = await T.dropThumbs(c, { storage: fakeDeps().storage });
    assert.strictEqual(out.dropped, c.postThumbs.length);
    assert.strictEqual(((await fresh(rival._id)).postThumbs || []).length, 0);
    for (const t of c.postThumbs) assert.ok(calls.removed.includes(t.thumbUrl));
    await Competitor.updateOne({ _id: rival._id }, { $set: { isIgnored: true } });
    assert.deepStrictEqual(await T.refreshPostThumbs({ competitor: await fresh(rival._id), profile: profile(week1), now: NOW, deps: fakeDeps() }), { ok: false, skipped: 'not_tracked' });
    await Competitor.updateOne({ _id: rival._id }, { $set: { isIgnored: false } });
  });
  await check('removing the competitor deletes its pictures and snapshots; the other account is untouched', async () => {
    await T.refreshPostThumbs({ competitor: await fresh(rival._id), profile: profile(week1), now: NOW, deps: fakeDeps() });
    const c = await fresh(rival._id);
    assert.ok(c.postThumbs.length > 0);
    const removedBefore = calls.removed.length;
    const out = await removeCompetitorsWithSnapshots({ _id: rival._id, userId: owner._id }, { removeAvatars: async () => ({}), removeThumbs: (urls) => T.removeThumbs(urls, { storage: fakeDeps().storage }) });
    assert.strictEqual(out.deletedCount, 1);
    assert.deepStrictEqual(calls.removed.slice(removedBefore).sort(), c.postThumbs.map((t) => t.thumbUrl).sort());
    assert.strictEqual(await Competitor.countDocuments({ _id: rival._id }), 0);
    assert.strictEqual(await Snapshot.countDocuments({ competitorId: rival._id }), 0);
    const them = await fresh(theirs._id);
    assert.deepStrictEqual(them.postThumbs.map((t) => t.thumbUrl), [THEIR_URL]);
    assert.ok(!calls.removed.includes(THEIR_URL));
  });
  await check('pictures finished after the competitor was removed are deleted again', async () => {
    const before = calls.removed.length;
    const r = await T.refreshPostThumbs({ competitor: { _id: rival._id, isActive: true }, profile: profile(week1), now: NOW, deps: fakeDeps() });
    assert.deepStrictEqual(r, { ok: false, skipped: 'not_tracked' });
    assert.ok(calls.removed.length > before);
  });
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/competitor-thumbs-check.js [run|cleanup]');
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
