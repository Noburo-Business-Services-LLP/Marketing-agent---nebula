// The Bin purge: items binned more than 14 days ago are removed for good, with their stored files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { runBinPurgeOnce, startBinPurge, mediaOf } = require('../services/binPurge');

const OID = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-19T06:00:00Z');
const CLD = (folder, name, type = 'image') => `https://res.cloudinary.com/demo/${type}/upload/v1/${folder}/${name}.${type === 'video' ? 'mp4' : 'png'}`;

function model(seed) {
  const rows = seed.map((r) => ({ _id: OID(), ...r }));
  const ok = (r, q) => Object.entries(q).every(([k, c]) => {
    const v = r[k];
    if (c && typeof c === 'object' && !(c instanceof mongoose.Types.ObjectId)) {
      if ('$lt' in c) return v != null && new Date(v) < new Date(c.$lt);
      if ('$in' in c) return c.$in.some((x) => String(x) === String(v));
      if ('$nin' in c) return !c.$nin.some((x) => String(x) === String(v));
      if ('$ne' in c) return String(v) !== String(c.$ne);
    }
    return String(v) === String(c);
  });
  const chain = (p) => { p.lean = () => p; p.select = () => p; p.limit = (n) => chain(p.then((x) => x.slice(0, n))); p.maxTimeMS = () => p; return p; };
  return {
    rows,
    find: (q) => chain(Promise.resolve(rows.filter((r) => ok(r, q)))),
    findOne: (q) => chain(Promise.resolve(rows.find((r) => ok(r, q)) || null)),
    async deleteOne(q) { const i = rows.findIndex((r) => ok(r, q)); if (i < 0) return { deletedCount: 0 }; rows.splice(i, 1); return { deletedCount: 1 }; }
  };
}

const lease = () => ({ claims: 0, releases: 0, async claim() { this.claims += 1; return { value: 'x' }; }, async release() { this.releases += 1; } });

function setup({ drafts, campaigns = [] }) {
  const Draft = model(drafts);
  const Campaign = model(campaigns);
  const deleted = [];
  const deps = { Draft, Campaign, lease: lease(), deleteAssets: async (a) => { deleted.push(...a); return { requested: a.length, failedBatches: 0 }; }, now: () => NOW, log: { log() {}, warn() {}, error() {} } };
  return { Draft, Campaign, deleted, deps };
}

const U = OID();
const OLD = new Date(NOW.getTime() - 15 * DAY);
const YOUNG = new Date(NOW.getTime() - 13 * DAY);

test('removes items binned more than 14 days ago with their files and thumbnails, keeps younger ones', async () => {
  const camp = { _id: OID(), userId: U, status: 'draft', creative: { imageUrls: [CLD('nebula-campaign-posts', 'a')] } };
  const { Draft, Campaign, deleted, deps } = setup({
    drafts: [
      { userId: U, status: 'binned', binnedAt: OLD, sourceType: 'post', imageUrl: CLD('nebula-campaign-posts', 'a'), imageUrlNoLogo: CLD('nebula-posters', 'a0'), campaignId: camp._id, creative: { thumbnailUrl: CLD('nebula-posters', 'thumb') } },
      { userId: U, status: 'binned', binnedAt: YOUNG, sourceType: 'post', imageUrl: CLD('nebula-campaign-posts', 'b') }
    ],
    campaigns: [camp]
  });
  const out = await runBinPurgeOnce(deps);
  assert.deepStrictEqual({ purged: out.purged, skipped: out.skipped }, { purged: 1, skipped: 0 });
  assert.strictEqual(Draft.rows.length, 1);
  assert.strictEqual(Draft.rows[0].binnedAt, YOUNG);
  assert.strictEqual(Campaign.rows.length, 0, 'its unsent campaign goes with it');
  assert.deepStrictEqual(deleted.map((a) => a.publicId).sort(), ['nebula-campaign-posts/a', 'nebula-posters/a0', 'nebula-posters/thumb']);
  assert.strictEqual(deps.lease.releases, 1);
  // Idempotent: a second run finds nothing more.
  const again = await runBinPurgeOnce(deps);
  assert.strictEqual(again.purged, 0);
});

test('never removes a file another post still uses, nor brand, logo or product files', async () => {
  const shared = CLD('nebula-campaign-posts', 'shared');
  const { deleted, deps, Draft } = setup({
    drafts: [
      { userId: U, status: 'binned', binnedAt: OLD, sourceType: 'post', imageUrl: shared, creative: { logo: CLD('nebula-brand-logos', 'logo'), product: CLD('nebula-product-images', 'p') } },
      { userId: U, status: 'published', sourceType: 'post', imageUrl: shared, languageVariantOf: OID() }
    ]
  });
  const out = await runBinPurgeOnce(deps);
  assert.strictEqual(out.purged, 1);
  assert.deepStrictEqual(deleted, []);
  assert.strictEqual(Draft.rows.length, 1);
});

test('never touches an item whose campaign is scheduled or posted, nor anything not in the Bin', async () => {
  const camp = { _id: OID(), userId: U, status: 'posted' };
  const { Draft, deleted, deps } = setup({
    drafts: [
      { userId: U, status: 'binned', binnedAt: OLD, sourceType: 'post', imageUrl: CLD('nebula-campaign-posts', 'c'), campaignId: camp._id },
      { userId: U, status: 'archived', binnedAt: OLD, sourceType: 'post' },
      { userId: U, status: 'scheduled', binnedAt: OLD, sourceType: 'post' }
    ],
    campaigns: [camp]
  });
  const out = await runBinPurgeOnce(deps);
  assert.strictEqual(out.purged, 0);
  assert.strictEqual(out.skipped, 1);
  assert.strictEqual(Draft.rows.length, 3);
  assert.deepStrictEqual(deleted, []);
});

test('video drafts lose only their row: the video files belong to the video record', async () => {
  const { Draft, deleted, deps } = setup({ drafts: [{ userId: U, status: 'binned', binnedAt: OLD, sourceType: 'reel', creative: { merge: { finalVideoUrl: CLD('nebula-final-videos', 'v', 'video') } }, generationProgress: { jobId: 'j1' } }] });
  const out = await runBinPurgeOnce(deps);
  assert.strictEqual(out.purged, 1);
  assert.strictEqual(Draft.rows.length, 0);
  assert.deepStrictEqual(deleted, []);
});

test('a bounded batch per run, nothing without the lease, and counts only in the log', async () => {
  const drafts = Array.from({ length: 7 }, () => ({ userId: U, status: 'binned', binnedAt: OLD, sourceType: 'post' }));
  const { Draft, deps } = setup({ drafts });
  const lines = [];
  deps.log = { log: (...a) => lines.push(a.join(' ')), warn: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) };
  const out = await runBinPurgeOnce({ ...deps, batch: 5 });
  assert.strictEqual(out.purged, 5);
  assert.strictEqual(Draft.rows.length, 2);
  for (const l of lines) assert.ok(!l.includes(String(U)), 'no account ids in the log');
  const none = await runBinPurgeOnce({ ...deps, lease: { async claim() { return null; }, async release() {} } });
  assert.strictEqual(none.skippedRun, true);
  assert.strictEqual(Draft.rows.length, 2);
});

test('a file deletion failure is counted and does not stop the run', async () => {
  const { deps } = setup({ drafts: [{ userId: U, status: 'binned', binnedAt: OLD, sourceType: 'post', imageUrl: CLD('nebula-campaign-posts', 'z') }] });
  deps.deleteAssets = async (a) => ({ requested: a.length, failedBatches: 1 });
  const out = await runBinPurgeOnce(deps);
  assert.strictEqual(out.purged, 1);
  assert.strictEqual(out.fileErrors, 1);
});

test('mediaOf finds every stored file on a draft, without repeats', () => {
  const m = mediaOf({ imageUrl: CLD('nebula-uploads', 'u'), carouselSlides: [{ imageUrl: CLD('nebula-posters', 's1') }, { imageUrl: CLD('nebula-uploads', 'u') }], creative: { videoUrl: CLD('nebula-uploads', 'clip', 'video') } });
  assert.deepStrictEqual(m.map((a) => `${a.resourceType}:${a.publicId}`).sort(), ['image:nebula-posters/s1', 'image:nebula-uploads/u', 'video:nebula-uploads/clip']);
});

test('the job can be switched off and is started once by the server', () => {
  assert.strictEqual(startBinPurge({ env: { ENABLE_BIN_PURGE: 'off' } }), null);
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  assert.ok(src.includes("require('./services/binPurge').startBinPurge()"));
});
