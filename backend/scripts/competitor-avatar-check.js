/**
 * Real-database check of competitor profile pictures (services/competitors/avatar.js) against the DEVELOPMENT database.
 * Refuses any database except nebulaa_dev. NO read of any social page, NO picture download, NO upload: the Instagram read,
 * the picture host, its DNS answer and the image storage are all fakes in this process. Only Mongo is real.
 *   node scripts/competitor-avatar-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/competitor-avatar-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything it creates belongs to throwaway users whose email starts with "zz.avatarchk-". Exit code is non-zero on any
 * FAIL, or if anything is left over.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');

const PREFIX = 'zz.avatarchk-';
const DEV_DB = 'nebulaa_dev';
const DAY = 864e5;

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
  const A = require('../services/competitors/avatar');
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
  const NOW = new Date();
  const mkUser = (suffix) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: ['competitors'] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `Avatar ${suffix}`, website: 'https://example.com', description: 'Bakery', targetAudience: 'Families nearby' },
    credits: { balance: 100 }
  });
  const owner = await mkUser('owner');
  const other = await mkUser('other');
  const mkComp = (user, name, handle) => Competitor.create({ userId: user._id, name, website: 'https://example.com', isActive: true, socialHandles: { instagram: handle }, handleStatus: 'confirmed' });
  const withPic = await mkComp(owner, 'Avatar Check Bakery', 'zz_avatar_bakery');
  const noPic = await mkComp(owner, 'Avatar Check Cafe', 'zz_avatar_cafe');
  const theirs = await mkComp(other, 'Avatar Check Other', 'zz_avatar_other');

  // ---- fakes: the read, the picture host, its DNS and the storage ----------------------------------------------------
  const png = await sharp({ create: { width: 150, height: 150, channels: 3, background: { r: 238, g: 99, b: 48 } } }).png().toBuffer();
  const PIC1 = 'https://scontent-bom1-1.cdninstagram.com/v/t51.2885-19/zzcheck_1_n.jpg?oh=SIG';
  const PIC2 = 'https://scontent-bom1-1.cdninstagram.com/v/t51.2885-19/zzcheck_2_n.jpg?oh=SIG';
  const profile = (pic) => ({ ...fixture.data[0], username: 'zz_avatar_bakery', profilePicUrl: pic, profilePicUrlHD: pic });
  const calls = { requests: 0, puts: [], removed: [] };
  let serve = { status: 200, type: 'image/png', body: png };
  const fakeDeps = {
    request: async () => { calls.requests++; return { status: serve.status, headers: { 'content-type': serve.type }, body: serve.body }; },
    resolve: async () => [{ address: '157.240.1.1', family: 4 }],
    storage: {
      put: async (key, buf) => { calls.puts.push([key, buf.length]); return `https://res.cloudinary.com/zzcheck/image/upload/v${Date.now()}/nebula-competitor-avatars/${key}.webp`; },
      remove: async (urls) => { calls.removed.push(...urls); return { requested: urls.length, failedBatches: 0 }; }
    }
  };
  const read = (comp, prof, at) => trackOne({
    competitor: comp, user: owner, now: at,
    deps: {
      scrapeProfile: async () => ({ success: true, data: [prof] }),
      refreshAvatar: (args) => A.refreshAvatar({ ...args, deps: fakeDeps })
    }
  });
  const fresh = (id) => Competitor.findById(id).lean();

  section = '(1) the weekly read stores the picture:';
  let first;
  await check('a good read saves the snapshot and our own 96 x 96 copy, and only our link is on the record', async () => {
    const r = await read(await fresh(withPic._id), profile(PIC1), NOW);
    assert.deepStrictEqual(r, { ok: true, read: true });
    first = await fresh(withPic._id);
    assert.ok(A.isStoredAvatarUrl(first.avatarUrl), first.avatarUrl);
    assert.ok(first.avatarUrl.includes(`/nebula-competitor-avatars/${withPic._id}.webp`));
    assert.strictEqual(+first.avatarUpdatedAt, +NOW);
    assert.match(first.avatarSourceKey, /^[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(first).includes('cdninstagram'), 'no Instagram link stored');
    assert.strictEqual(await Snapshot.countDocuments({ competitorId: withPic._id, ok: true }), 1);
    assert.deepStrictEqual(calls.puts.map((p) => p[0]), [String(withPic._id)]);
    assert.ok(calls.puts[0][1] > 0 && calls.puts[0][1] <= A.MAX_BYTES);
    return `${calls.puts[0][1]} bytes stored`;
  });
  await check('a profile without a picture link stores nothing and the read still counts', async () => {
    const prof = { ...profile(''), profilePicUrl: undefined, profilePicUrlHD: undefined };
    const r = await read(await fresh(noPic._id), prof, NOW);
    assert.strictEqual(r.ok, true);
    const c = await fresh(noPic._id);
    assert.strictEqual(c.avatarUrl, undefined);
    assert.strictEqual(calls.puts.length, 1);
  });

  section = '(2) the endpoint:';
  await check('best-posts returns our link for the competitor with a picture and null for the other, never an Instagram link', async () => {
    const out = await build({ user: await User.findById(owner._id).lean(), now: NOW, deps: { canUse: () => ({ allowed: true }), trackerOn: () => true } });
    const byId = Object.fromEntries(out.competitors.map((c) => [c.id, c]));
    assert.strictEqual(byId[String(withPic._id)].avatarUrl, first.avatarUrl);
    assert.strictEqual(byId[String(noPic._id)].avatarUrl, null);
    assert.ok(!byId[String(theirs._id)], 'another account\'s competitor is never shown');
    assert.ok(!JSON.stringify(out).includes('cdninstagram'));
  });

  section = '(3) weekly refresh rule:';
  await check('the same picture next week (new signature) is not fetched again; a new picture within the week waits', async () => {
    const before = calls.requests;
    const sameSig = PIC1.replace('oh=SIG', 'oh=OTHER');
    assert.deepStrictEqual(await A.refreshAvatar({ competitor: await fresh(withPic._id), profile: profile(sameSig), now: new Date(+NOW + 8 * DAY), deps: fakeDeps }), { ok: false, skipped: 'unchanged' });
    assert.deepStrictEqual(await A.refreshAvatar({ competitor: await fresh(withPic._id), profile: profile(PIC2), now: new Date(+NOW + 2 * DAY), deps: fakeDeps }), { ok: false, skipped: 'recent' });
    assert.strictEqual(calls.requests, before);
  });
  await check('a failed download a week later keeps the old picture on the record', async () => {
    serve = { status: 200, type: 'text/html', body: Buffer.from('<html></html>') };
    const r = await A.refreshAvatar({ competitor: await fresh(withPic._id), profile: profile(PIC2), now: new Date(+NOW + 8 * DAY), deps: fakeDeps });
    assert.deepStrictEqual(r, { ok: false, reason: 'bad_type' });
    const c = await fresh(withPic._id);
    assert.strictEqual(c.avatarUrl, first.avatarUrl);
    assert.strictEqual(+c.avatarUpdatedAt, +first.avatarUpdatedAt);
    serve = { status: 200, type: 'image/png', body: png };
  });
  await check('a changed picture a week later replaces it under the same key', async () => {
    const r = await A.refreshAvatar({ competitor: await fresh(withPic._id), profile: profile(PIC2), now: new Date(+NOW + 8 * DAY), deps: fakeDeps });
    assert.strictEqual(r.ok, true);
    const c = await fresh(withPic._id);
    assert.notStrictEqual(c.avatarSourceKey, first.avatarSourceKey);
    assert.ok(c.avatarUrl.includes(`/nebula-competitor-avatars/${withPic._id}.webp`));
    assert.strictEqual(calls.puts.at(-1)[0], String(withPic._id));
  });

  section = '(4) privacy:';
  await check('account deletion finds the stored picture among the files to delete', async () => {
    const c = await fresh(withPic._id);
    const assets = extractAssets(JSON.stringify(c));
    assert.deepStrictEqual(assets, [{ resourceType: 'image', publicId: `nebula-competitor-avatars/${withPic._id}` }]);
  });
  await check('ignoring a competitor clears the picture on the record and deletes the file', async () => {
    const c = await fresh(withPic._id);
    await Competitor.updateOne({ _id: withPic._id }, { $set: { isIgnored: true } });
    const out = await A.dropAvatar(c, { storage: fakeDeps.storage });
    assert.deepStrictEqual(out, { dropped: true });
    const after = await fresh(withPic._id);
    assert.strictEqual(after.avatarUrl, undefined);
    assert.strictEqual(after.avatarSourceKey, undefined);
    assert.deepStrictEqual(calls.removed, [c.avatarUrl]);
    // an ignored competitor never gets a picture again until it is tracked again
    assert.deepStrictEqual(await A.refreshAvatar({ competitor: after, profile: profile(PIC1), now: new Date(+NOW + 30 * DAY), deps: fakeDeps }), { ok: false, skipped: 'not_tracked' });
    await Competitor.updateOne({ _id: withPic._id }, { $set: { isIgnored: false } });
  });
  await check('removing a competitor deletes its stored picture and snapshots, and nothing of another account', async () => {
    await A.refreshAvatar({ competitor: await fresh(withPic._id), profile: profile(PIC1), now: new Date(+NOW + 30 * DAY), deps: fakeDeps });
    const c = await fresh(withPic._id);
    assert.ok(A.isStoredAvatarUrl(c.avatarUrl));
    await Competitor.updateOne({ _id: theirs._id }, { $set: { avatarUrl: `https://res.cloudinary.com/zzcheck/image/upload/v1/nebula-competitor-avatars/${theirs._id}.webp` } });
    const removedBefore = calls.removed.length;
    const out = await removeCompetitorsWithSnapshots({ _id: withPic._id, userId: owner._id }, { removeAvatars: (urls) => A.removeAvatars(urls, { storage: fakeDeps.storage }) });
    assert.strictEqual(out.deletedCount, 1);
    assert.deepStrictEqual(calls.removed.slice(removedBefore), [c.avatarUrl]);
    assert.strictEqual(await Competitor.countDocuments({ _id: withPic._id }), 0);
    assert.strictEqual(await Snapshot.countDocuments({ competitorId: withPic._id }), 0);
    assert.strictEqual(await Competitor.countDocuments({ _id: theirs._id }), 1);
  });
  await check('a picture finished after the competitor was removed is deleted again', async () => {
    const ghost = { _id: withPic._id, isActive: true };
    const r = await A.refreshAvatar({ competitor: ghost, profile: profile(PIC1), now: NOW, deps: fakeDeps });
    assert.deepStrictEqual(r, { ok: false, skipped: 'not_tracked' });
    assert.strictEqual(calls.removed.at(-1).includes(`/nebula-competitor-avatars/${withPic._id}.webp`), true);
  });
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/competitor-avatar-check.js [run|cleanup]');
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
