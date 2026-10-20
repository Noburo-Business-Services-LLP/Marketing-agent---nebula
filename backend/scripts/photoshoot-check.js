/**
 * Real-database check of the Photoshoot studio (routes/photoshoot.js, services/photoshoot) against the DEVELOPMENT
 * database. Refuses any database except nebulaa_dev. NO real image call: the image generator, the reference-photo loader
 * and the upload store are fakes inside this process (the OpenAI key is blanked before anything loads, and a guard counts
 * any attempt to reach the network). The real routes, middleware, tokens, wallet (quarkBuckets), Quark ledger, spend guard,
 * PhotoshootJob ledger, unique indexes, runner lease and resume run, inside this process on a random 127.0.0.1 port.
 *   node scripts/photoshoot-check.js          run every check, print PASS/FAIL, then delete everything it made
 *   node scripts/photoshoot-check.js cleanup  delete leftovers of an interrupted run and print what is left
 * Everything belongs to throwaway users whose email starts with "zz.photoshootchk-" (and the client workspace of the
 * throwaway agency, found by its owner). The estimated spend the charges add to today's AI spend record is taken off again
 * at the end, and the Photoshoots staff switch row this check writes is removed. Exit code is non-zero on any FAIL, or if
 * anything is left over.
 */
require('dotenv').config();
// No real image call can happen: the key the app would use is removed before any service loads.
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_PHOTOSHOOT = 'on';
process.env.ENABLE_PHOTOSHOOT_RESUME = 'off';
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const assert = require('assert');

const PREFIX = 'zz.photoshootchk-';
const DEV_DB = 'nebulaa_dev';
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]).toString('base64');

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

// The estimated spend this run adds to today's AI spend record (taken off again in cleanup).
const spent = { usd: 0, day: new Date().toISOString().slice(0, 10), switchWritten: false };

async function throwawayIds(db) {
  const base = await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray();
  const owners = base.map((u) => u._id);
  const clients = owners.length ? await db.collection('users').find({ 'agency.ownerId': { $in: owners } }, { projection: { _id: 1 } }).toArray() : [];
  return [...owners, ...clients.map((u) => u._id)];
}

async function cleanup(db) {
  const ids = await throwawayIds(db);
  const removed = {};
  const OWNED = { photoshoot_jobs: 'user', products: 'user', brandassets: 'user' };
  if (ids.length) {
    for (const [name, field] of Object.entries(OWNED)) {
      const c = (await db.collection(name).deleteMany({ [field]: { $in: ids } })).deletedCount;
      if (c) removed[name] = c;
    }
    const QuarkLedger = require('../models/QuarkLedger');
    const q = (await QuarkLedger.deleteMany({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] })).deletedCount;
    if (q) removed.quark_ledger = q;
    const c = (await db.collection('users').deleteMany({ _id: { $in: ids } })).deletedCount;
    if (c) removed.users = c;
  }
  if (spent.usd > 0) {
    await db.collection('ai_spend_days').updateOne({ day: spent.day }, { $inc: { totalUsd: -spent.usd, 'byProvider.photoshoot': -spent.usd } });
    removed.estimated_spend_usd = Math.round(spent.usd * 1e4) / 1e4;
    spent.usd = 0;
  }
  if (spent.switchWritten) {
    const s = (await db.collection('ai_switches').deleteMany({ provider: 'photoshoot', updatedBy: 'photoshoot-check' })).deletedCount;
    if (s) removed.ai_switches = s;
    spent.switchWritten = false;
  }
  console.log('removed', JSON.stringify(removed));
  const left = {};
  for (const [name, field] of Object.entries(OWNED)) left[name] = ids.length ? await db.collection(name).countDocuments({ [field]: { $in: ids } }) : 0;
  left.quark_ledger = ids.length ? await require('../models/QuarkLedger').countDocuments({ $or: [{ user: { $in: ids } }, { workspace: { $in: ids } }] }) : 0;
  left.users = await db.collection('users').countDocuments({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }) + (ids.length ? await db.collection('users').countDocuments({ _id: { $in: ids } }) : 0);
  left.ai_switches = await db.collection('ai_switches').countDocuments({ provider: 'photoshoot', updatedBy: 'photoshoot-check' });
  console.log('left', JSON.stringify(left));
  const { estimated_spend_usd: _, ...rows } = removed;
  return { removed, left, removedTotal: Object.values(rows).reduce((a, b) => a + b, 0) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(100); }
}

async function runChecks() {
  const User = require('../models/User');
  const Product = require('../models/Product');
  const BrandAsset = require('../models/BrandAsset');
  const Job = require('../models/PhotoshootJob');
  const QuarkLedger = require('../models/QuarkLedger');
  const legal = require('../config/legalVersions');
  const caps = require('../config/photoshoot');
  const { QUARK_COSTS, ACTION_USD } = require('../config/apiCosts');
  const { generateToken } = require('../middleware/auth');
  const { createWorkspace, issueAgencyPass } = require('../services/agencyWorkspaces');
  const { createPhotoshootRouter } = require('../routes/photoshoot');
  const { createPhotoshoot } = require('../services/photoshoot/service');
  const spendGuard = require('../services/spendGuard');
  const PER = QUARK_COSTS.photoshoot_image;

  section = '(0) safety:';
  await check('a database that is not nebulaa_dev is refused, and the live connection is the dev one', async () => {
    assert.throws(() => assertDevDatabase('nebulaa_prod'), /Refusing/);
    assert.throws(() => assertDevDatabase(''), /Refusing/);
    assert.strictEqual(mongoose.connection.name, DEV_DB);
  });
  const realFetch = global.fetch;
  let outside = 0;
  global.fetch = (url, opts) => {
    if (/^http:\/\/127\.0\.0\.1:\d+\//.test(String(url))) return realFetch(url, opts);
    outside += 1;
    return Promise.reject(new Error('outside call blocked by the check'));
  };
  await Job.init(); // the unique indexes (one row per key, one job in flight per account)
  // The resume loop looks at every running job: refuse to run if the dev database holds a running photoshoot that is not
  // this check's own, so a fake generator can never finish someone else's job.
  const foreign = await Job.countDocuments({ status: 'running', user: { $nin: await throwawayIds(mongoose.connection.db) } });
  if (foreign) throw new Error(`Refusing: ${foreign} running photoshoot(s) of other accounts in ${DEV_DB}`);

  // ---- fakes: the image generator, the reference loader, the upload store; counted --------------------------------------
  const removedUrls = [];
  const gen = { calls: 0, failScene: null, hold: null, extra: 0 };
  const fakes = {
    generate: async (args) => {
      gen.calls += 1;
      if (gen.hold) await gen.hold;
      if (gen.failScene && gen.failScene.test(args.prompt)) return { ok: false, reason: 'provider' };
      return { ok: true, url: `https://res.cloudinary.com/zz-check/image/upload/nebula-campaign-posts/zz-${Date.now()}-${gen.calls}.png` };
    },
    loadRef: async (src) => (src ? { mimeType: 'image/png', data: PNG_B64 } : null),
    upload: async () => ({ success: true, url: 'https://res.cloudinary.com/zz-check/image/upload/nebula-product-images/zz-upload.png' }),
    // The image host is a fake too: it only remembers which stored pictures it was asked to remove.
    deleteImage: async (url) => { removedUrls.push(url); return { success: true }; },
    recordSpend: (action, units) => { gen.extra += units; spent.usd += units * ACTION_USD[action]; return spendGuard.record(action, units); },
    env: { ENABLE_PHOTOSHOOT: 'on' }
  };

  // ---- in-process servers: the real routes and middleware, random port --------------------------------------------------
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/photoshoot', createPhotoshootRouter({ deps: { ...fakes, runnerId: 'check-a' } }));
  // A "process that dies" right after charging: its runner never starts.
  app.use('/dead/api/photoshoot', createPhotoshootRouter({ deps: { ...fakes, runnerId: 'check-dead', schedule: () => {} } }));
  app.use('/off/api/photoshoot', createPhotoshootRouter({ deps: { ...fakes, env: {}, runnerId: 'check-off' } }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  assert.ok(port !== 3000 && port !== 5000);
  note(`in-process server on 127.0.0.1:${port}; ${PER} Quarks per photo`);
  const call = async (method, path, token, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: res.status, body: json, text };
  };
  let keyN = 0;
  const key = () => `chk-${Date.now().toString(36)}-${++keyN}`;
  const balanceOf = async (id) => Number(((await User.findById(id).select('credits.balance').lean()) || {}).credits?.balance || 0);
  const charged = (photos) => { spent.usd += photos * ACTION_USD.photoshoot_image; };
  const finished = (id) => eventually(async () => { const j = await Job.findById(id).lean(); return j && ['done', 'partial', 'failed'].includes(j.status) ? j : null; });

  // ---- seed ----------------------------------------------------------------------------------------------------------------
  const stamp = Date.now();
  const tag = `${PREFIX}${stamp}`;
  const mkUser = (suffix, extra = {}) => User.create({
    email: `${tag}-${suffix}@example.test`, password: 'Check-only-1', firstName: `Check ${suffix}`, isVerified: true, onboardingCompleted: true,
    plan: { tier: 'starter', addons: [] },
    consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), source: 'realdb-check' },
    businessProfile: { name: `ZZ Shop ${suffix}`, industry: 'Bakery' },
    credits: { balance: 300 },
    ...extra
  });
  const mkProduct = (user, name, withPhoto = true) => Product.create({ user: user._id, name, imageUrl: withPhoto ? 'https://res.cloudinary.com/zz-check/image/upload/nebula-product-images/zz-p.png' : '' });
  const T = (u) => generateToken(u._id);
  const pack = (user, product, extra = {}) => ({ key: key(), pack: 'marketplace', productIds: [String(product._id)], ...extra });

  try {
    const owner = await mkUser('owner');
    const other = await mkUser('other');
    const free = await mkUser('free', { plan: { tier: 'free' } });
    const poor = await mkUser('poor', { credits: { balance: 4 * PER - 1 } });
    const minute = await mkUser('minute', { credits: { balance: 1000 } });
    const resumer = await mkUser('resumer');
    const failer = await mkUser('failer');
    const idem = await mkUser('idem');
    const deleter = await mkUser('deleter');
    const dead1 = await mkUser('dead1'); const dead2 = await mkUser('dead2'); const dead3 = await mkUser('dead3');
    const ownerP = await mkProduct(owner, 'ZZ Brownie box');
    const ownerNoPhoto = await mkProduct(owner, 'ZZ No photo', false);
    const otherP = await mkProduct(other, 'ZZ Other shop item');
    const ownerPlace = await BrandAsset.create({ user: owner._id, type: 'environment', name: 'ZZ Our counter', url: 'https://res.cloudinary.com/zz-check/image/upload/nebula-env/zz.png', cloudinaryPublicId: 'zz-check-env' });
    const poorP = await mkProduct(poor, 'ZZ Poor item'); const minuteP = await mkProduct(minute, 'ZZ Minute item'); const freeP = await mkProduct(free, 'ZZ Free item');
    const resumerP = await mkProduct(resumer, 'ZZ Resume item');
    const deleterP = await mkProduct(deleter, 'ZZ Delete item');
    const failerP = await mkProduct(failer, 'ZZ Failer item'); const idemP = await mkProduct(idem, 'ZZ Idem item');
    const dead1P = await mkProduct(dead1, 'ZZ Dead one'); const dead2P = await mkProduct(dead2, 'ZZ Dead two'); const dead3P = await mkProduct(dead3, 'ZZ Dead three');

    // =====================================================================================================================
    section = '(1) charge and ledger:';
    let first = null;
    await check('a pack is charged once for all its photos, recorded on the Quark ledger and on its job, and every photo is made', async () => {
      const before = await balanceOf(owner._id);
      const r = await call('POST', '/api/photoshoot/jobs', T(owner), pack(owner, ownerP));
      assert.strictEqual(r.status, 202, r.text.slice(0, 200));
      charged(4);
      first = await finished(r.body.job.id);
      assert.ok(first, 'finished');
      assert.strictEqual(first.status, 'done'); assert.strictEqual(first.quarks, 4 * PER); assert.strictEqual(first.payerId, String(owner._id));
      assert.ok(first.photos.every((p) => p.status === 'done' && p.attempts === 1 && /^https:/.test(p.url)));
      assert.strictEqual(first.inFlight, undefined); assert.strictEqual(first.leaseOwner, undefined);
      assert.strictEqual(await balanceOf(owner._id), before - 4 * PER);
      const led = await eventually(async () => { const l = await QuarkLedger.find({ user: owner._id }).lean(); return l.length ? l : null; });
      assert.deepStrictEqual(led.map((l) => [l.type, l.action, l.quarks, l.ref]), [['spend', 'photoshoot_image', -4 * PER, String(first._id)]]);
      return `balance ${before} -> ${before - 4 * PER}`;
    });
    await check('the page view of the job never carries the prompt, the payer or the lease', async () => {
      const r = await call('GET', `/api/photoshoot/jobs/${first._id}`, T(owner));
      assert.strictEqual(r.status, 200);
      assert.ok(!/Rules for this photo|payerId|leaseOwner/.test(r.text));
      assert.strictEqual(r.body.job.done, 4);
    });

    section = '(2) failures and refunds:';
    await check('one photo that fails twice is refunded alone; the others are kept', async () => {
      gen.failScene = /from the side/;
      const before = await balanceOf(failer._id);
      const calls = gen.calls;
      const r = await call('POST', '/api/photoshoot/jobs', T(failer), pack(failer, failerP));
      assert.strictEqual(r.status, 202, r.text.slice(0, 200));
      charged(4);
      const j = await finished(r.body.job.id);
      gen.failScene = null;
      assert.strictEqual(j.status, 'partial'); assert.strictEqual(j.refundedQuarks, PER);
      assert.strictEqual(gen.calls - calls, 5, 'four photos and one more call for the failed one');
      assert.strictEqual(j.photos.find((p) => p.status === 'failed').attempts, caps.MAX_CALLS_PER_PHOTO);
      assert.strictEqual(await balanceOf(failer._id), before - 3 * PER);
      const refund = await eventually(() => QuarkLedger.findOne({ user: failer._id, type: 'refund', ref: String(j._id) }).lean());
      assert.ok(refund && refund.quarks === PER && refund.action === 'photoshoot_image_refund');
    });
    await check('when no photo can be made the whole price goes back, once', async () => {
      gen.failScene = /./;
      const before = await balanceOf(failer._id);
      const r = await call('POST', '/api/photoshoot/jobs', T(failer), pack(failer, failerP));
      assert.strictEqual(r.status, 202, r.text.slice(0, 200));
      charged(4);
      const j = await finished(r.body.job.id);
      gen.failScene = null;
      assert.strictEqual(j.status, 'failed'); assert.strictEqual(j.refundedQuarks, 4 * PER);
      assert.strictEqual(await balanceOf(failer._id), before);
      const svc = createPhotoshoot({ ...fakes, runnerId: 'check-again' });
      await svc.finalize(j._id); await svc.runJob(j._id);
      await sleep(300);
      assert.strictEqual(await QuarkLedger.countDocuments({ user: failer._id, type: 'refund', ref: String(j._id) }), 1, 'never refunded twice');
    });

    section = '(3) idempotency, one at a time, caps:';
    await check('the same key twice is one job and one charge', async () => {
      const body = pack(idem, idemP);
      const before = await balanceOf(idem._id);
      const a = await call('POST', '/api/photoshoot/jobs', T(idem), body);
      const b = await call('POST', '/api/photoshoot/jobs', T(idem), body);
      assert.strictEqual(a.status, 202, a.text.slice(0, 200));
      assert.ok([200, 409].includes(b.status), String(b.status));
      if (b.status === 200) assert.strictEqual(b.body.job.id, a.body.job.id);
      charged(4);
      await finished(a.body.job.id);
      const c = await call('POST', '/api/photoshoot/jobs', T(idem), body);
      assert.strictEqual(c.status, 200); assert.strictEqual(c.body.replay, true); assert.strictEqual(c.body.job.id, a.body.job.id);
      assert.strictEqual(await Job.countDocuments({ user: idem._id, key: body.key }), 1);
      assert.strictEqual(await balanceOf(idem._id), before - 4 * PER);
    });
    await check('a second photoshoot while one is running is refused by the database lock, nothing charged', async () => {
      let release; gen.hold = new Promise((r) => { release = r; });
      const before = await balanceOf(resumer._id);
      const a = await call('POST', '/api/photoshoot/jobs', T(resumer), pack(resumer, resumerP));
      assert.strictEqual(a.status, 202, a.text.slice(0, 200));
      charged(4);
      // Straight at the database: a second in-flight row for the same account is refused by the unique index.
      let dup = null;
      try { await Job.create({ user: resumer._id, key: key(), pack: 'marketplace', day: '2026-10-19', inFlight: true }); } catch (e) { dup = e; }
      assert.ok(dup && dup.code === 11000, 'unique in-flight index');
      const b = await call('POST', '/api/photoshoot/jobs', T(resumer), pack(resumer, resumerP));
      assert.strictEqual(b.status, 409); assert.strictEqual(b.body.inProgress, true);
      release(); gen.hold = null;
      await finished(a.body.job.id);
      assert.strictEqual(await balanceOf(resumer._id), before - 4 * PER);
    });
    await check('per minute: the fourth start inside a minute is refused before any charge', async () => {
      for (let i = 0; i < caps.MAX_STARTS_PER_MINUTE; i += 1) {
        const r = await call('POST', '/api/photoshoot/jobs', T(minute), pack(minute, minuteP));
        assert.strictEqual(r.status, 202, r.text.slice(0, 200)); charged(4);
        await finished(r.body.job.id);
      }
      const before = await balanceOf(minute._id);
      const r = await call('POST', '/api/photoshoot/jobs', T(minute), pack(minute, minuteP));
      assert.strictEqual(r.status, 429); assert.strictEqual(r.body.limit, 'minute');
      assert.strictEqual(await balanceOf(minute._id), before);
    });
    await check('photos per India day: counted on the real aggregate, refused past the cap', async () => {
      const day = require('../services/photoshoot/service').istDay(new Date());
      await Job.create({ user: minute._id, key: key(), pack: 'marketplace', day, status: 'done', quarks: 1, photoCount: caps.MAX_PHOTOS_PER_DAY, photos: [], createdAt: new Date(Date.now() - 3600000) });
      const o = await call('GET', '/api/photoshoot/options', T(minute));
      assert.strictEqual(o.body.left, 0);
    });
    await check('not enough Quarks: refused, nothing made, nothing charged, the row is closed', async () => {
      const calls = gen.calls;
      const r = await call('POST', '/api/photoshoot/jobs', T(poor), pack(poor, poorP));
      assert.strictEqual(r.status, 403); assert.strictEqual(r.body.creditsExhausted, true);
      assert.strictEqual(await balanceOf(poor._id), 4 * PER - 1);
      assert.strictEqual(gen.calls, calls);
      const row = await Job.findOne({ user: poor._id }).lean();
      assert.strictEqual(row.status, 'refused'); assert.strictEqual(row.inFlight, undefined);
    });

    section = '(4) restart:';
    await check('a job whose process died after the charge is picked up by another process and finished', async () => {
      const r = await call('POST', '/dead/api/photoshoot/jobs', T(dead1), pack(dead1, dead1P));
      assert.strictEqual(r.status, 202, r.text.slice(0, 200)); charged(4);
      await sleep(300);
      const stuck = await Job.findById(r.body.job.id).lean();
      assert.strictEqual(stuck.status, 'running'); assert.ok(stuck.photos.every((p) => p.status === 'pending'));
      const svc = createPhotoshoot({ ...fakes, runnerId: 'check-b' });
      assert.ok((await svc.resumeLost()) >= 1);
      const j = await finished(stuck._id);
      assert.strictEqual(j.status, 'done');
    });
    await check('a photo left calling by a dead runner is tried once more after the lease runs out, never more', async () => {
      const r = await call('POST', '/dead/api/photoshoot/jobs', T(dead2), pack(dead2, dead2P));
      assert.strictEqual(r.status, 202, r.text.slice(0, 200)); charged(4);
      const id = r.body.job.id;
      // As if runner "check-dead" had started photo 0 and photo 1 (photo 1 already on its second call), then died.
      await Job.updateOne({ _id: id }, { $set: { leaseOwner: 'check-dead', leaseUntil: new Date(Date.now() + 60000), 'photos.0.status': 'calling', 'photos.0.attempts': 1, 'photos.1.status': 'calling', 'photos.1.attempts': 2 } });
      const svc = createPhotoshoot({ ...fakes, runnerId: 'check-c' });
      await svc.runJob(id);
      assert.strictEqual((await Job.findById(id).lean()).leaseOwner, 'check-dead', 'nothing is taken while the lease is valid');
      await Job.updateOne({ _id: id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } });
      await svc.runJob(id);
      const j = await finished(id);
      assert.strictEqual(j.photos[0].status, 'done'); assert.strictEqual(j.photos[0].attempts, 2);
      assert.strictEqual(j.photos[1].status, 'failed'); assert.strictEqual(j.photos[1].reason, 'lost'); assert.strictEqual(j.photos[1].attempts, 2);
      assert.strictEqual(j.status, 'partial'); assert.strictEqual(j.refundedQuarks, PER);
      assert.ok(await eventually(() => QuarkLedger.findOne({ user: dead2._id, type: 'refund', ref: String(id) }).lean()));
    });
    await check('a job far past its age limit is closed and its unfinished photos refunded', async () => {
      const r = await call('POST', '/dead/api/photoshoot/jobs', T(dead3), pack(dead3, dead3P));
      assert.strictEqual(r.status, 202, r.text.slice(0, 200)); charged(4);
      await Job.updateOne({ _id: r.body.job.id }, { $set: { chargedAt: new Date(Date.now() - caps.MAX_AGE_MS - 60000) } });
      const calls = gen.calls;
      await createPhotoshoot({ ...fakes, runnerId: 'check-d' }).runJob(r.body.job.id);
      const j = await finished(r.body.job.id);
      assert.strictEqual(gen.calls, calls, 'no call for an old job');
      assert.strictEqual(j.status, 'failed'); assert.strictEqual(j.outcome, 'stale'); assert.strictEqual(j.refundedQuarks, 4 * PER);
    });

    section = '(5) ownership:';
    await check('another account never sees, changes or redoes a job, and only its own products are accepted', async () => {
      assert.strictEqual((await call('GET', `/api/photoshoot/jobs/${first._id}`, T(other))).status, 404);
      assert.strictEqual((await call('PATCH', `/api/photoshoot/jobs/${first._id}/photos/0`, T(other), { inLibrary: false })).status, 404);
      assert.strictEqual((await call('POST', `/api/photoshoot/jobs/${first._id}/photos/0/redo`, T(other), { key: key() })).status, 404);
      assert.strictEqual((await call('GET', '/api/photoshoot/library', T(other))).body.photos.length, 0);
      assert.strictEqual((await call('GET', '/api/photoshoot/jobs', T(other))).body.jobs.length, 0);
      const useOthers = await call('POST', '/api/photoshoot/jobs', T(other), pack(other, ownerP));
      assert.strictEqual(useOthers.status, 400);
      const noPhoto = await call('POST', '/api/photoshoot/jobs', T(owner), pack(owner, ownerNoPhoto));
      assert.strictEqual(noPhoto.status, 400);
      const place = await call('POST', '/api/photoshoot/jobs', T(other), pack(other, otherP, { pack: 'product', placeId: String(ownerPlace._id) }));
      assert.strictEqual(place.status, 400);
      const o = await call('GET', '/api/photoshoot/options', T(other));
      assert.deepStrictEqual(o.body.products.map((p) => p.name), ['ZZ Other shop item']);
      assert.strictEqual(o.body.places.length, 0);
    });
    await check('Library: photos are in it, can be taken out and put back by their owner', async () => {
      const lib = (await call('GET', '/api/photoshoot/library', T(owner))).body.photos;
      assert.strictEqual(lib.length, 4, String(lib.length));
      assert.strictEqual((await call('PATCH', `/api/photoshoot/jobs/${first._id}/photos/0`, T(owner), { inLibrary: false })).status, 200);
      assert.strictEqual((await call('GET', '/api/photoshoot/library', T(owner))).body.photos.length, lib.length - 1);
      assert.strictEqual((await call('PATCH', `/api/photoshoot/jobs/${first._id}/photos/0`, T(owner), { inLibrary: true })).status, 200);
    });
    await check('make one photo again: one photo charged, shown as a version of the original', async () => {
      const before = await balanceOf(owner._id);
      const r = await call('POST', `/api/photoshoot/jobs/${first._id}/photos/2/redo`, T(owner), { key: key() });
      assert.strictEqual(r.status, 202, r.text.slice(0, 200)); charged(1);
      await finished(r.body.job.id);
      assert.strictEqual(await balanceOf(owner._id), before - PER);
      const v = (await call('GET', `/api/photoshoot/jobs/${first._id}`, T(owner))).body.job.versions;
      assert.deepStrictEqual(v.map((x) => [x.index, x.status]), [[2, 'done']]);
    });

    section = '(6) agency client pool:';
    const agency = await mkUser('agency', { plan: { tier: 'agency', addons: [] }, credits: { balance: 1000 } });
    const made = await createWorkspace({ owner: agency, name: 'Photoshoot Check Client', models: { User } });
    assert.ok(made.ok, made.message);
    const ws = made.workspace;
    const wsP = await mkProduct(ws, 'ZZ Client soap');
    const pass = issueAgencyPass({ workspaceId: ws._id, ownerId: agency._id });
    await check('inside the client a photoshoot is paid from the agency pool and failed photos go back to it', async () => {
      gen.failScene = /from the side/;
      const before = await balanceOf(agency._id);
      const r = await call('POST', '/api/photoshoot/jobs', pass, pack(ws, wsP));
      assert.strictEqual(r.status, 202, r.text.slice(0, 200)); charged(4);
      const j = await finished(r.body.job.id);
      gen.failScene = null;
      assert.strictEqual(String(j.user), String(ws._id)); assert.strictEqual(j.payerId, String(agency._id));
      assert.strictEqual(await balanceOf(agency._id), before - 3 * PER);
      assert.strictEqual(await balanceOf(ws._id), 0, 'nothing touches the client record');
      const rows = await eventually(async () => { const l = await QuarkLedger.find({ user: agency._id, workspace: ws._id }).lean(); return l.length >= 2 ? l : null; });
      assert.deepStrictEqual(rows.map((l) => l.type).sort(), ['refund', 'spend']);
      const o = await call('GET', '/api/photoshoot/options', pass);
      assert.strictEqual(o.body.postsOnly, true); assert.strictEqual(o.body.entitled, true);
    });
    await check('the agency\'s own account cannot see the client\'s photoshoot', async () => {
      assert.strictEqual((await call('GET', '/api/photoshoot/jobs', T(agency))).body.jobs.length, 0);
    });

    section = '(7) entitlement, switches, upload:';
    await check('free plan: refused with the plan note, nothing written; packs and prices still shown', async () => {
      const r = await call('POST', '/api/photoshoot/jobs', T(free), pack(free, freeP));
      assert.strictEqual(r.status, 403); assert.strictEqual(r.body.locked, 'upgrade');
      assert.strictEqual(await Job.countDocuments({ user: free._id }), 0);
      const o = await call('GET', '/api/photoshoot/options', T(free));
      assert.strictEqual(o.body.entitled, false); assert.ok(o.body.packs.length === 6);
    });
    await check('feature switch off: nothing charged, nothing written', async () => {
      const r = await call('POST', '/off/api/photoshoot/jobs', T(other), pack(other, otherP));
      assert.strictEqual(r.status, 503); assert.strictEqual(r.body.disabled, true);
      assert.strictEqual(await Job.countDocuments({ user: other._id }), 0);
    });
    await check('the Photoshoots staff switch refuses before any charge, and the row is removed afterwards', async () => {
      spent.switchWritten = true;
      await spendGuard.setSwitch('photoshoot', true, { note: 'photoshoot-check', by: 'photoshoot-check' });
      try {
        const before = await balanceOf(other._id);
        const r = await call('POST', '/api/photoshoot/jobs', T(other), pack(other, otherP));
        assert.strictEqual(r.status, 503); assert.match(r.body.message, /Nothing was charged/);
        assert.strictEqual(await balanceOf(other._id), before);
      } finally {
        await mongoose.connection.db.collection('ai_switches').deleteMany({ provider: 'photoshoot', updatedBy: 'photoshoot-check' });
        await spendGuard.setSwitch('photoshoot', false, { by: 'photoshoot-check' }).catch(() => null);
        await mongoose.connection.db.collection('ai_switches').deleteMany({ provider: 'photoshoot', updatedBy: 'photoshoot-check' });
      }
    });
    await check('upload: a PNG becomes the caller\'s product; a file that is not an image is refused', async () => {
      const ok = await call('POST', '/api/photoshoot/upload', T(other), { name: 'ZZ Uploaded jar', imageData: `data:image/png;base64,${PNG_B64}` });
      assert.strictEqual(ok.status, 201, ok.text.slice(0, 200));
      const p = await Product.findById(ok.body.product.id).lean();
      assert.strictEqual(String(p.user), String(other._id)); assert.deepStrictEqual(p.tags, ['photoshoot-upload']);
      const bad = await call('POST', '/api/photoshoot/upload', T(other), { name: 'ZZ Bad', imageData: `data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}` });
      assert.strictEqual(bad.status, 400);
    });

    section = '(9) review 2026-10-19 fixes:';
    const qb = require('../services/quarkBuckets');
    const realRepo = require('../services/photoshoot/repo').createPhotoshootRepo();
    // The stale sweep and the refund retry read every account; here they only see this run's throwaway accounts.
    const ours = () => throwawayIds(mongoose.connection.db);
    const scopedRepo = {
      ...realRepo,
      staleQueued: async (before, limit = 10) => Job.find({ status: 'queued', createdAt: { $lt: before }, user: { $in: await ours() } }).select('_id user').limit(limit).lean(),
      refundsDue: async (now, limit = 10) => {
        const due = (await realRepo.refundsDue(now, 200)).map((x) => x._id);
        return due.length ? Job.find({ _id: { $in: due }, user: { $in: await ours() } }).select('_id').limit(limit).lean() : [];
      }
    };
    const svcWith = (extra = {}) => createPhotoshoot({ ...fakes, repo: scopedRepo, runnerId: 'check-fix', alertNow: () => {}, ...extra });
    const failLedgerWrites = async (fn) => {
      const orig = QuarkLedger.create;
      QuarkLedger.create = () => Promise.reject(new Error('simulated ledger write failure'));
      const warn = console.warn; console.warn = () => {};
      try { return await fn(); } finally { await sleep(200); QuarkLedger.create = orig; console.warn = warn; }
    };
    const throwingSpend = (ledgerFails) => async (uid, cost, o) => {
      const run = () => qb.spend(uid, cost, o);
      await (ledgerFails ? failLedgerWrites(run) : run());
      throw new Error('simulated: the reply of the charge was lost');
    };
    const refundRows = (id) => QuarkLedger.countDocuments({ type: 'refund', ref: String(id) });
    const queuedDoc = (u, extra = {}) => ({ user: u._id, key: key(), kind: 'pack', pack: 'marketplace', day: '2026-10-19', status: 'queued', inFlight: true, photoCount: 4, quarksPerPhoto: PER, quarks: 0, photos: [{ index: 0, productIndex: 0, status: 'pending', attempts: 0 }], createdAt: new Date(Date.now() - 10 * 60000), ...extra });

    for (const [label, ledgerFails] of [['the ledger row was written', false], ['the ledger row also failed: only the history proves it', true]]) {
      await check(`S1: a charge that throws after the debit landed is refunded at once, never closed as refused (${label})`, async () => {
        const u = await mkUser(`throw-${ledgerFails ? 'h' : 'l'}`);
        const p = await mkProduct(u, 'ZZ Throw item');
        const before = await balanceOf(u._id);
        const r = await svcWith({ spend: throwingSpend(ledgerFails) }).create({ _id: u._id, plan: { tier: 'starter' } }, pack(u, p));
        charged(4);
        assert.strictEqual(r.status, 503, JSON.stringify(r.body)); assert.strictEqual(r.body.refunded, true);
        const row = await Job.findOne({ user: u._id }).lean();
        assert.strictEqual(row.status, 'failed'); assert.strictEqual(row.outcome, 'ledger'); assert.strictEqual(row.refunded, true); assert.strictEqual(row.inFlight, undefined);
        assert.strictEqual(await balanceOf(u._id), before);
        await svcWith().sweepStale(); await svcWith().retryRefunds();
        assert.strictEqual(await balanceOf(u._id), before, 'paid back once');
        if (!ledgerFails) assert.strictEqual(await eventually(() => refundRows(row._id)), 1);
      });
    }

    await check('S2: the stale sweep refunds a stuck queued job proven only by the history entry, once', async () => {
      const u = await mkUser('stale-history');
      const row = await Job.create(queuedDoc(u));
      await failLedgerWrites(() => qb.spend(u._id, 4 * PER, { action: 'photoshoot_image', ref: String(row._id), units: 4 }));
      charged(4);
      assert.strictEqual(await QuarkLedger.countDocuments({ ref: String(row._id) }), 0, 'no ledger row');
      const before = await balanceOf(u._id);
      assert.ok((await svcWith().sweepStale()) >= 1);
      const after = await Job.findById(row._id).lean();
      assert.strictEqual(after.refundedQuarks, 4 * PER); assert.strictEqual(after.payerId, String(u._id));
      assert.strictEqual(await balanceOf(u._id), before + 4 * PER);
      await svcWith().sweepStale(); await svcWith().retryRefunds();
      assert.strictEqual(await balanceOf(u._id), before + 4 * PER, 'once');
    });

    await check('S4: a refund that did not land is retried, lands once and the flag is cleared', async () => {
      const u = await mkUser('retry');
      await User.updateOne({ _id: u._id }, { $inc: { 'credits.balance': -4 * PER } });
      const row = await Job.create(queuedDoc(u, { status: 'failed', outcome: 'none', inFlight: undefined, quarks: 4 * PER, payerId: String(u._id), refunded: true, refundedQuarks: 4 * PER, refundFailed: true }));
      const before = await balanceOf(u._id);
      assert.strictEqual(await svcWith().retryRefunds(), 1);
      const after = await Job.findById(row._id).lean();
      assert.strictEqual(after.refundFailed, undefined); assert.strictEqual(after.refundAttempts, 1);
      assert.strictEqual(await balanceOf(u._id), before + 4 * PER);
      await Promise.all([svcWith().retryRefunds(), svcWith().retryRefunds()]);
      assert.strictEqual(await balanceOf(u._id), before + 4 * PER, 'never twice');
      assert.strictEqual(await eventually(() => refundRows(row._id)), 1);
    });

    await check('S4: a retry that fails waits (back-off) and a refund already proven by the history is not paid again', async () => {
      const u = await mkUser('retry-landed');
      const row = await Job.create(queuedDoc(u, { status: 'failed', outcome: 'none', inFlight: undefined, quarks: PER, payerId: String(u._id), refunded: true, refundedQuarks: PER, refundFailed: true }));
      const failing = svcWith({ refundTo: async () => ({ ok: false }) });
      await failing.retryRefunds();
      const held = await Job.findById(row._id).lean();
      assert.strictEqual(held.refundFailed, true); assert.strictEqual(held.refundAttempts, 1); assert.ok(new Date(held.refundRetryAt) > new Date());
      assert.strictEqual(await svcWith().retryRefunds(), 0, 'not due yet');
      await failLedgerWrites(() => qb.refundTo(String(u._id), PER, { action: 'photoshoot_image_refund', ref: String(row._id), payerId: String(u._id) }));
      await Job.updateOne({ _id: row._id }, { $set: { refundRetryAt: new Date(Date.now() - 1000) } });
      const before = await balanceOf(u._id);
      await svcWith().retryRefunds();
      assert.strictEqual((await Job.findById(row._id).lean()).refundFailed, undefined);
      assert.strictEqual(await balanceOf(u._id), before, 'nothing paid again');
    });

    await check('M1: the stale sweep refunded a slow charge first: the failed charged mark does not refund it again', async () => {
      const u = await mkUser('slow-charge');
      const p = await mkProduct(u, 'ZZ Slow item');
      const before = await balanceOf(u._id);
      const svc = svcWith({
        spend: async (uid, cost, o) => {
          const out = await qb.spend(uid, cost, o);
          await Job.updateOne({ _id: o.ref }, { $set: { createdAt: new Date(Date.now() - 10 * 60000) } });
          await sleep(200);
          await svcWith().sweepStale(); // another process closes and refunds the row while this charge is slow
          return out;
        }
      });
      const r = await svc.create({ _id: u._id, plan: { tier: 'starter' } }, pack(u, p));
      charged(4);
      assert.strictEqual(r.status, 503);
      const row = await Job.findOne({ user: u._id }).lean();
      assert.strictEqual(row.outcome, 'stale_queued');
      assert.strictEqual(await balanceOf(u._id), before, 'refunded once, not twice');
      assert.strictEqual(await eventually(() => refundRows(row._id)), 1);
    });

    await check('M5: the upload follows the plan and the switch: nothing stored for a free account or while off', async () => {
      const f = await call('POST', '/api/photoshoot/upload', T(free), { name: 'ZZ Free jar', imageData: `data:image/png;base64,${PNG_B64}` });
      assert.strictEqual(f.status, 403); assert.strictEqual(f.body.upgradeRequired, true);
      const off = await call('POST', '/off/api/photoshoot/upload', T(other), { name: 'ZZ Off jar', imageData: `data:image/png;base64,${PNG_B64}` });
      assert.strictEqual(off.status, 503);
      assert.strictEqual(await Product.countDocuments({ user: { $in: [free._id, other._id] }, name: { $in: ['ZZ Free jar', 'ZZ Off jar'] } }), 0);
    });

    await check('M7: a pack key is not replayed for a redo, and nothing is charged', async () => {
      const before = await balanceOf(owner._id);
      const r = await call('POST', `/api/photoshoot/jobs/${first._id}/photos/1/redo`, T(owner), { key: first.key });
      assert.strictEqual(r.status, 409); assert.strictEqual(r.body.keyReused, true);
      assert.strictEqual(await balanceOf(owner._id), before);
    });

    section = '(10) delete one photo:';
    await check('a photoshoot still being made cannot lose a photo; once finished one photo is deleted, the others stay', async () => {
      let release; gen.hold = new Promise((r) => { release = r; });
      const r = await call('POST', '/api/photoshoot/jobs', T(deleter), pack(deleter, deleterP));
      assert.strictEqual(r.status, 202, r.text.slice(0, 200)); charged(4);
      const running = await call('DELETE', `/api/photoshoot/jobs/${r.body.job.id}/photos/0`, T(deleter));
      assert.strictEqual(running.status, 409, running.text.slice(0, 200));
      release(); gen.hold = null;
      const j = await finished(r.body.job.id);
      assert.strictEqual(j.status, 'done');
      assert.strictEqual((await Job.findById(j._id).lean()).photos.filter((p) => p.deleted).length, 0, 'the refused delete changed nothing');
      const ledgerBefore = await QuarkLedger.countDocuments({ user: deleter._id });
      const balBefore = await balanceOf(deleter._id);
      const doomed = j.photos[1].url;
      const del = await call('DELETE', `/api/photoshoot/jobs/${j._id}/photos/1`, T(deleter));
      assert.strictEqual(del.status, 200, del.text.slice(0, 200)); assert.strictEqual(del.body.deleted, true);
      const after = await Job.findById(j._id).lean();
      assert.strictEqual(after.photos[1].deleted, true); assert.strictEqual(after.photos[1].url, undefined); assert.strictEqual(after.photos[1].inLibrary, false);
      assert.ok(after.photos.filter((p) => p.index !== 1).every((p) => !p.deleted && /^https:/.test(p.url)));
      assert.deepStrictEqual(removedUrls, [doomed], 'the stored picture was handed to the image host cleanup');
      assert.strictEqual(after.quarks, j.quarks); assert.strictEqual(after.refunded, j.refunded); assert.strictEqual(after.refundedQuarks, j.refundedQuarks); assert.strictEqual(after.photoCount, j.photoCount);
      assert.strictEqual(await balanceOf(deleter._id), balBefore, 'no refund');
      assert.strictEqual(await QuarkLedger.countDocuments({ user: deleter._id }), ledgerBefore, 'no ledger row');
      const view = await call('GET', `/api/photoshoot/jobs/${j._id}`, T(deleter));
      assert.strictEqual(view.body.job.photos.length, 3); assert.ok(!view.text.includes(doomed));
      const lib = await call('GET', '/api/photoshoot/library', T(deleter));
      assert.strictEqual(lib.body.photos.length, 3); assert.ok(!lib.text.includes(doomed));
      return 'photo 1 gone, 3 left, no refund, no ledger row';
    });
    await check('deleting is owner-only, twice is a plain not found, a deleted photo cannot be redone or put back', async () => {
      const j = await Job.findOne({ user: deleter._id }).lean();
      assert.strictEqual((await call('DELETE', `/api/photoshoot/jobs/${j._id}/photos/0`, T(other))).status, 404);
      assert.strictEqual((await Job.findById(j._id).lean()).photos[0].deleted, undefined, 'the other account changed nothing');
      assert.strictEqual((await call('DELETE', `/api/photoshoot/jobs/${j._id}/photos/1`, T(deleter))).status, 404);
      assert.strictEqual((await call('DELETE', `/api/photoshoot/jobs/${j._id}/photos/-1`, T(deleter))).status, 400);
      assert.strictEqual((await call('DELETE', `/api/photoshoot/jobs/nope/photos/0`, T(deleter))).status, 400);
      assert.strictEqual((await call('DELETE', `/api/photoshoot/jobs/${j._id}/photos/0`)).status, 401);
      const bal = await balanceOf(deleter._id);
      assert.strictEqual((await call('POST', `/api/photoshoot/jobs/${j._id}/photos/1/redo`, T(deleter), { key: key() })).status, 404);
      assert.strictEqual((await call('PATCH', `/api/photoshoot/jobs/${j._id}/photos/1`, T(deleter), { inLibrary: true })).status, 404);
      assert.strictEqual(await balanceOf(deleter._id), bal, 'nothing charged');
    });

    section = '(8) safety at the end:';
    await check('no outside call was made and no real image model was reached', async () => {
      assert.strictEqual(outside, 0);
      assert.ok(gen.calls > 0);
      return `${gen.calls} fake image calls, ${gen.extra} second calls added to the spend record`;
    });
    await check('no job of the throwaway accounts is left in flight', async () => {
      const ids = await throwawayIds(mongoose.connection.db);
      assert.strictEqual(await Job.countDocuments({ user: { $in: ids }, inFlight: true }), 0);
    });
  } finally {
    global.fetch = realFetch;
    await new Promise((r) => server.close(r));
  }
}

(async () => {
  const mode = process.argv[2] || 'run';
  if (mode !== 'run' && mode !== 'cleanup') throw new Error('Usage: node scripts/photoshoot-check.js [run|cleanup]');
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
