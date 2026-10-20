/**
 * Real-database check of the inline-images migration (impact map inline-images.md section 5), on nebulaa_dev ONLY
 * (refuses any other database). NO network: a FAKE picture store and a FAKE HEAD check; any outgoing https request
 * or fetch to a non-local host is refused and counted. Works only on a throwaway user (email starts with
 * "zz.inline-images-") and the 6 small documents it makes (pictures of about 200 KB); everything is deleted at the end.
 *   node scripts/inline-images-check.js           run the checks, print PASS/FAIL
 *   node scripts/inline-images-check.js cleanup   delete leftovers of an interrupted run
 */
require('dotenv').config();
const https = require('https');
const outgoing = [];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) { outgoing.push(host); throw new Error(`inline-images-check: outgoing request to ${host} refused`); }
    return orig.call(this, a, ...rest);
  };
}
globalThis.fetch = (url) => { outgoing.push(new URL(String(url)).hostname); return Promise.reject(new Error('outgoing fetch refused')); };

const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const mongoose = require('mongoose');
const { migrateCollection, dropBackups, databaseRule } = require('./migrate-inline-images');

const PREFIX = 'zz.inline-images-';
const DEV_DB = 'nebulaa_dev';
const COLLS = ['drafts', 'campaigns', 'ai_content_performance', 'ai_campaign_history'];
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}

async function cleanup(db) {
  const ids = (await db.collection('users').find({ email: { $regex: `^${PREFIX.replace(/\./g, '\\.')}` } }, { projection: { _id: 1 } }).toArray()).map((u) => u._id);
  const out = { users: ids.length };
  if (ids.length) {
    for (const c of COLLS) out[c] = (await db.collection(c).deleteMany({ userId: { $in: ids } })).deletedCount;
    await db.collection('users').deleteMany({ _id: { $in: ids } });
  }
  return out;
}

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const picture = (seed, kb = 200) => `data:image/png;base64,${Buffer.concat([PNG_HEAD, Buffer.alloc(kb * 1024, seed)]).toString('base64')}`;

async function sizes(db, userId) {
  const out = {};
  for (const c of COLLS) {
    const rows = await db.collection(c).aggregate([{ $match: { userId } }, { $project: { s: { $bsonSize: '$$ROOT' } } }], { maxTimeMS: 15000 }).toArray();
    out[c] = rows.reduce((n, r) => n + r.s, 0);
  }
  return out;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv[2] === 'cleanup') { console.log('cleanup', await cleanup(db)); await mongoose.disconnect(); return; }
  await cleanup(db);

  const now = new Date();
  const user = { _id: new mongoose.Types.ObjectId(), email: `${PREFIX}${Date.now()}@example.test`, name: 'zz inline images check', createdAt: now, updatedAt: now };
  await db.collection('users').insertOne(user);
  const userId = user._id;
  const shared = picture(1);
  const huge = picture(2);
  // Inserted through the driver, as old rows were written (the new save hook and setters would clean them up).
  await db.collection('drafts').insertMany([
    { userId, title: 'zz draft with a picture', caption: 'Fresh brownies', sourceType: 'post', contentType: 'post', status: 'draft', imageUrl: shared, imageUrlNoLogo: '', creative: { imageUrls: [shared], captions: 'Fresh brownies' }, carouselSlides: [], createdAt: now, updatedAt: now },
    { userId, title: 'zz carousel', caption: 'Slides', sourceType: 'carousel', contentType: 'carousel', status: 'draft', imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/zz/ok.png', carouselSlides: [{ order: 1, imageUrl: picture(3, 50) }, { order: 2, imageUrl: 'https://res.cloudinary.com/demo/zz/2.png' }], errorMessage: `upload failed ${picture(4, 20)}`, createdAt: now, updatedAt: now },
    { userId, title: 'zz clean draft', caption: 'Nothing to do', sourceType: 'post', contentType: 'post', status: 'draft', imageUrl: 'https://res.cloudinary.com/demo/zz/clean.png', createdAt: now, updatedAt: now }
  ]);
  const campaign = { userId, name: 'zz campaign', status: 'scheduled', platforms: ['instagram'], scheduling: { startDate: new Date(now.getTime() + 864e5) }, scheduledFor: new Date(now.getTime() + 864e5),
    creative: { type: 'image', imageUrls: [huge], captions: 'Diwali offer' },
    publishResult: { error: `Ayrshare rejected the media ${huge}`, instagramFix: { accountKey: 'k1', mediaUrls: [huge] }, postIds: [{ platform: 'instagram', id: '1789', postUrl: 'https://www.instagram.com/p/zz/' }], retryCount: 1 },
    lastPublishError: `Media is not a URL: ${huge}`, createdAt: now, updatedAt: now };
  const { insertedId: campaignId } = await db.collection('campaigns').insertOne(campaign);
  await db.collection('ai_content_performance').insertOne({ userId, organizationId: String(userId), campaignId, platform: 'instagram', postId: '1789', assets: { images: [huge], thumbnails: [huge], videos: [] }, metrics: { likes: 3 }, rawAnalytics: { instagram: { likeCount: 3, postUrl: 'https://www.instagram.com/p/zz/' } }, createdAt: now, updatedAt: now });
  await db.collection('ai_campaign_history').insertOne({ userId, organizationId: String(userId), action: 'publish', generatedImages: [huge, 'https://res.cloudinary.com/demo/zz/a.png'], sourceResponse: { raw: huge, id: 'ay1' }, createdAt: now, updatedAt: now });

  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zz-inline-')), 'state.json');
  const env = { MIGRATE_SLEEP_MS: '0' };
  const stored = [];
  const store = { isConfigured: () => true, storeImage: async (d) => { stored.push(d.length); return { url: `https://res.cloudinary.com/zz-fake/image/upload/v1/zz-${stored.length}.png`, stored: true }; } };
  const heads = [];
  const head = async (u) => { heads.push(u); return /^https:\/\/res\.cloudinary\.com\/zz-fake\//.test(u); };
  const run = (name, act, extra = {}) => migrateCollection(name, { db, ObjectId: mongoose.Types.ObjectId, act, store, head, stateFile, env: { ...env, ...extra }, filter: { userId }, logger: { warn() {}, error() {}, log() {} } });
  const before = await sizes(db, userId);
  const dry = {};

  try {
    await check('the database rule refuses production and is a dry run by default', () => {
      assert.strictEqual(databaseRule('nebulaa', {}).ok, false);
      assert.strictEqual(databaseRule(DEV_DB, {}).act, false);
    });
    await check('dry run: counts and bytes, nothing stored or written', async () => {
      for (const c of COLLS) dry[c] = await run(c, false);
      assert.strictEqual(dry.drafts.needing, 2, `drafts needing ${dry.drafts.needing}`);
      assert.strictEqual(dry.campaigns.needing, 1);
      assert.strictEqual(dry.ai_content_performance.needing, 1);
      assert.strictEqual(dry.ai_campaign_history.needing, 1);
      assert.strictEqual(stored.length, 0);
      assert.deepStrictEqual(await sizes(db, userId), before);
      return COLLS.map((c) => `${c} ${dry[c].changed} docs ${(dry[c].savedBytes / 1024).toFixed(0)} KB`).join(', ');
    });
    const acted = {};
    await check('migration replaces the pictures with checked links and compacts the answers', async () => {
      for (const c of COLLS) acted[c] = await run(c, true);
      assert.strictEqual(acted.drafts.changed, 2);
      assert.strictEqual(acted.campaigns.changed, 1);
      assert.strictEqual(stored.length, 3, `uploads ${stored.length}: the shared draft picture once, the slide, the campaign picture`);
      assert.strictEqual(heads.length, 3);
      const d = await db.collection('drafts').findOne({ userId, title: 'zz draft with a picture' });
      assert.match(d.imageUrl, /^https:\/\/res\.cloudinary\.com\/zz-fake\//);
      assert.deepStrictEqual(d.creative.imageUrls, [d.imageUrl]);
      assert.match(d.legacyInline.imageUrlSha256, /^[0-9a-f]{64}$/, 'over the backup cap: hash and size only');
      const car = await db.collection('drafts').findOne({ userId, title: 'zz carousel' });
      assert.match(car.carouselSlides[0].imageUrl, /^https:\/\//);
      assert.ok(car.errorMessage.length <= 500 && !car.errorMessage.includes('base64'));
      assert.ok(String(car.legacyInline.carouselSlides_0_imageUrl).startsWith('data:image/png'), 'a small picture keeps its original until drop-backups');
      const c = await db.collection('campaigns').findOne({ _id: campaignId });
      assert.match(c.creative.imageUrls[0], /^https:\/\//);
      assert.ok(!JSON.stringify(c.publishResult).includes('base64'));
      assert.deepStrictEqual(c.publishResult.postIds, campaign.publishResult.postIds);
      assert.strictEqual(c.publishResult.retryCount, 1);
      assert.ok(c.lastPublishError.length <= 500);
      assert.match(c.legacyInline.creative_imageUrlsSha256, /^[0-9a-f]{64}$/);
      const p = await db.collection('ai_content_performance').findOne({ userId });
      assert.deepStrictEqual(p.assets.images, []);
      const h = await db.collection('ai_campaign_history').findOne({ userId });
      assert.deepStrictEqual(h.generatedImages, ['https://res.cloudinary.com/demo/zz/a.png']);
      return `${stored.length} pictures stored`;
    });
    await check('a rerun is a no-op', async () => {
      const again = {};
      for (const c of COLLS) again[c] = await run(c, true, { MIGRATE_RESTART: 'yes' });
      assert.ok(COLLS.every((c) => again[c].changed === 0), JSON.stringify(COLLS.map((c) => again[c].changed)));
      assert.strictEqual(stored.length, 3);
    });
    let after;
    await check('documents got smaller', async () => {
      after = await sizes(db, userId);
      assert.ok(after.campaigns < before.campaigns / 5, `campaigns ${before.campaigns} -> ${after.campaigns}`);
      assert.ok(after.ai_content_performance < before.ai_content_performance / 5);
      return COLLS.map((c) => `${c} ${(before[c] / 1024).toFixed(0)} -> ${(after[c] / 1024).toFixed(0)} KB`).join(', ');
    });
    await check('readers still work: drafts list page, scheduler projection, Performance thumbnail and post link', async () => {
      const Draft = require('../models/Draft');
      const Campaign = require('../models/Campaign');
      const { pageQuery, pagePipeline, DRAFT_TRIM } = require('../services/listPage');
      const q = pageQuery({ userId, status: { $ne: 'binned' } }, { limit: 30 });
      const list = await Draft.aggregate(pagePipeline(q, DRAFT_TRIM)).option({ maxTimeMS: 15000 });
      assert.strictEqual(list.length, 3);
      assert.ok(list.every((r) => /^https:\/\//.test(r.imageUrl)));
      const due = await Campaign.find({ _id: campaignId }).select('-publishResult -lastPublishError').lean();
      assert.match(due[0].creative.imageUrls[0], /^https:\/\//);
      const { thumbOf, postUrlOf } = require('../services/performance/metrics');
      const camp = await Campaign.findById(campaignId).select('creative.imageUrls publishResult.postIds publishResult.postUrl').lean();
      const row = await db.collection('ai_content_performance').findOne({ userId });
      assert.match(thumbOf(camp, row), /^https:\/\/res\.cloudinary\.com\/zz-fake\//);
      assert.strictEqual(postUrlOf(row, camp), 'https://www.instagram.com/p/zz/');
    });
    await check('drop-backups removes legacyInline only on these documents', async () => {
      const dryDrop = await dropBackups('drafts', { db, act: false, filter: { userId }, env });
      assert.ok(dryDrop.withBackup >= 1);
      const drop = await dropBackups('drafts', { db, act: true, filter: { userId }, env });
      assert.strictEqual(drop.dropped, dryDrop.withBackup);
      assert.strictEqual(await db.collection('drafts').countDocuments({ userId, legacyInline: { $exists: true } }), 0);
    });
    await check('no network call left this process', () => { assert.deepStrictEqual(outgoing, []); });
  } finally {
    const removed = await cleanup(db);
    console.log('cleanup', removed);
    try { fs.rmSync(path.dirname(stateFile), { recursive: true, force: true }); } catch (_) { /* ignore */ }
    await mongoose.disconnect();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e.message); try { await mongoose.disconnect(); } catch (_) { /* ignore */ } process.exit(1); });
