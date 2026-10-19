'use strict';
/**
 * The Bin purge. Items moved to the Bin ('binned') more than 14 days ago are removed for good, with their stored files
 * (pictures, the clean copy kept before a logo, slides, thumbnails), once a day.
 *
 *  - One server at a time: an OpsState lease (key bin_purge_lease), the same single-runner lease the Home drafts sweep
 *    and the competitor tracker use. No lease, no run.
 *  - A bounded batch per run (BIN_PURGE_BATCH, default 50). What is left waits for the next run.
 *  - Only rows that are still 'binned' with binnedAt older than 14 days are removed: the delete repeats that condition,
 *    so a Restore that lands first always wins. Running twice removes nothing more (idempotent).
 *  - Never touches posted or scheduled items: they cannot be binned, and a binned row whose campaign is anything but
 *    unsent ('draft' or 'failed') is skipped and left alone.
 *  - Files are deleted only from our own "nebula" storage folders (services/cloudinaryCleanup.js), never brand,
 *    logo, product, Blueprint or competitor files, and never a file another post or campaign of the account still uses
 *    (language versions share their picture). Video drafts lose only their row: their files belong to the video record.
 *  - The row is removed first, then its files: a file that fails to delete is a leftover file, never a broken post.
 *  - Logs counts only (no account ids, no links). Off with ENABLE_BIN_PURGE=off.
 */
const { extractAssets, deleteAssets: realDeleteAssets } = require('./cloudinaryCleanup');

const BIN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = DAY_MS;
const LEASE_MS = 30 * 60 * 1000;
const DEFAULT_BATCH = 50;
const UNSENT_CAMPAIGN = ['draft', 'failed'];
const KEEP_FOLDERS = /^nebula-(brand-|logos|product-images|blueprint-|competitor-|hero-refs)/i;
const VIDEO_KINDS = ['reel', 'video'];

/** Every stored file named on a record, without repeats, minus the folders that are never ours to delete. */
function mediaOf(doc) {
  if (!doc) return [];
  const { _id, userId, ...rest } = doc;
  return extractAssets(JSON.stringify(rest)).filter((a) => !KEEP_FOLDERS.test(a.publicId));
}

const keyOf = (a) => `${a.resourceType}:${a.publicId}`;
const isVideo = (d) => VIDEO_KINDS.includes(String(d.sourceType || d.contentType || '').toLowerCase()) || !!(d.generationProgress && d.generationProgress.jobId);
const MEDIA_FIELDS = 'imageUrl imageUrlNoLogo creative carouselSlides';

async function runBinPurgeOnce({
  Draft = require('../models/Draft'),
  Campaign = require('../models/Campaign'),
  lease = require('./competitors/lease').createLease({ key: 'bin_purge_lease', ttlMs: LEASE_MS }),
  deleteAssets = realDeleteAssets,
  now = () => new Date(),
  batch = Number(process.env.BIN_PURGE_BATCH) || DEFAULT_BATCH,
  log = console,
  // Extra conditions on which rows may be removed, for scripts/approval-check.js (its own throwaway accounts only).
  only = null
} = {}) {
  const at = now();
  const token = await lease.claim(at);
  if (!token) return { skippedRun: true, purged: 0, skipped: 0, files: 0, fileErrors: 0 };
  const out = { purged: 0, skipped: 0, files: 0, fileErrors: 0 };
  try {
    const cutoff = new Date(at.getTime() - BIN_DAYS * DAY_MS);
    const rows = await Draft.find({ ...(only || {}), status: 'binned', binnedAt: { $lt: cutoff } }).limit(Math.max(1, Math.min(500, batch))).lean();
    if (!rows.length) return out;

    // Which linked campaigns may go with their post; a post whose campaign is scheduled or sent is never touched.
    const plan = [];
    for (const row of rows) {
      let campaign = null;
      if (row.campaignId) {
        campaign = await Campaign.findOne({ _id: row.campaignId, userId: row.userId }).lean();
        if (campaign && !UNSENT_CAMPAIGN.includes(String(campaign.status || '').toLowerCase())) { out.skipped += 1; continue; }
      }
      plan.push({ row, campaign });
    }

    // Files still used by anything else of the same account are kept.
    const byUser = new Map();
    for (const p of plan) {
      const k = String(p.row.userId);
      if (!byUser.has(k)) byUser.set(k, { userId: p.row.userId, draftIds: [], campaignIds: [] });
      const u = byUser.get(k);
      u.draftIds.push(p.row._id);
      if (p.campaign) u.campaignIds.push(p.campaign._id);
    }
    const stillUsed = new Map();
    for (const [k, u] of byUser) {
      const used = new Set();
      const others = await Draft.find({ userId: u.userId, _id: { $nin: u.draftIds } }).select(MEDIA_FIELDS).lean();
      for (const d of others) mediaOf(d).forEach((a) => used.add(keyOf(a)));
      const camps = await Campaign.find({ userId: u.userId, _id: { $nin: u.campaignIds } }).select('creative').lean();
      for (const c of camps) mediaOf(c).forEach((a) => used.add(keyOf(a)));
      stillUsed.set(k, used);
    }

    for (const { row, campaign } of plan) {
      const gone = await Draft.deleteOne({ _id: row._id, userId: row.userId, status: 'binned', binnedAt: { $lt: cutoff } });
      if (!(Number(gone && gone.deletedCount) > 0)) { out.skipped += 1; continue; }
      out.purged += 1;
      let files = [];
      if (!isVideo(row)) {
        files = mediaOf(row);
        if (campaign) files.push(...mediaOf(campaign));
        const used = stillUsed.get(String(row.userId)) || new Set();
        const seen = new Set();
        files = files.filter((a) => { const k = keyOf(a); if (used.has(k) || seen.has(k)) return false; seen.add(k); return true; });
      }
      if (campaign) {
        try { await Campaign.deleteOne({ _id: campaign._id, userId: row.userId, status: { $in: UNSENT_CAMPAIGN } }); } catch (_) { /* the post is gone; an unsent campaign row is harmless */ }
      }
      if (files.length) {
        try {
          const r = await deleteAssets(files);
          out.files += Number(r && r.requested) || 0;
          out.fileErrors += Number(r && r.failedBatches) || 0;
        } catch (_) { out.fileErrors += 1; }
      }
    }
    return out;
  } finally {
    await lease.release(token);
    if (out.purged || out.skipped || out.fileErrors) {
      log.log(`[bin purge] removed ${out.purged}, skipped ${out.skipped}, files ${out.files}, file errors ${out.fileErrors}`);
    }
  }
}

/** Once a few minutes after start, then daily. Off with ENABLE_BIN_PURGE=off. Never throws. */
function startBinPurge({ env = process.env, run = runBinPurgeOnce, logger = console } = {}) {
  if (String(env.ENABLE_BIN_PURGE || '').trim().toLowerCase() === 'off') return null;
  const tick = () => Promise.resolve().then(() => run()).catch((e) => logger.warn('[bin purge] run failed:', e && e.message));
  setTimeout(tick, 3 * 60 * 1000).unref();
  return setInterval(tick, EVERY_MS).unref();
}

module.exports = { runBinPurgeOnce, startBinPurge, mediaOf, BIN_DAYS };
