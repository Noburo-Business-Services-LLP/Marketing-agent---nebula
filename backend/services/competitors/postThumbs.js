'use strict';
/**
 * Small stored copies of a tracked competitor's TOP public posts, so Home and the Competitors page can show the actual
 * posts. Instagram's picture links expire within days and must never be loaded from the customer's browser, so, exactly
 * like the profile picture (avatar.js), the weekly tracker hands the profile it ALREADY read to refreshPostThumbs right
 * after a good read has been saved. No extra paid call: the picture link is the `displayUrl` field of each post in that
 * same read (`images[0]` as the fallback; see tests/fixtures/instagram-profile-real-nebulaa-os.json).
 *
 * Rules (docs/superpowers/ops/competitors-home.md, "Post pictures"):
 *   - OFF unless ENABLE_COMPETITOR_THUMBS is exactly "on" (every environment); when off nothing is fetched and the
 *     best-posts answer carries no picture (the page shows tiles without images),
 *   - only the posts the page can show: the best post of this India week, the best 3 of the last 30 days (likes + 3 x
 *     comments, the same score as everywhere else) and the latest 3; at most THUMBS_PER_COMPETITOR, and no new file
 *     once THUMBS_GLOBAL_MAX files are stored across all accounts,
 *   - the same safe download as the profile picture (avatar.fetchImage: https only, Instagram or Facebook picture hosts,
 *     public addresses only also after a redirect, at most two redirects, jpeg/png/webp only), with a 1.5 MB and 8 s cap,
 *   - resized to 360 x 450 (4:5, centre crop), WebP, at most 40 KB, stored as nebula-competitor-posts/<competitorId>-<code>,
 *   - a post already stored is never fetched again (a post's picture does not change); a post that drops out of the
 *     chosen set is deleted at the next weekly read; all of them go when the competitor is removed, ignored, given
 *     another handle, or with the account (the erase finds every file in our nebula folders on the customer's records),
 *   - best effort: it never throws and never fails the read; any failure leaves the stored ones as they were.
 * Only our own link is kept (Competitor.postThumbs[].thumbUrl); Instagram's link is never stored or sent to a browser.
 */
const crypto = require('crypto');

const DAY = 864e5;
const MONTH_DAYS = 30;
const FOLDER = 'nebula-competitor-posts';
const WIDTH = 360;
const HEIGHT = 450;
const MAX_STORED_BYTES = 40 * 1024;
const MAX_SOURCE_BYTES = 1536 * 1024;
const TIMEOUT_MS = 8000;
const QUALITIES = [72, 60, 48, 38];
const SHORTCODE = /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]{1,64})\/?$/;
// Our own stored copy: the only kind of post picture link the API ever returns.
const STORED_URL = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/(?:[A-Za-z0-9_,.:-]+\/)*nebula-competitor-posts\/[A-Za-z0-9_-]{1,140}\.(?:webp|jpg|jpeg|png)$/;

const caps = () => require('../../config/competitors');
const asArray = (v) => (Array.isArray(v) ? v : []);
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const toDate = (v) => { if (v === undefined || v === null || v === '') return null; const d = v instanceof Date ? v : new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v); return Number.isFinite(d.getTime()) ? d : null; };

/** The switch: exactly "on", like the other competitor switches. */
const thumbsEnabled = (env = process.env) => String((env && env.ENABLE_COMPETITOR_THUMBS) || '').trim() === 'on';
const isStoredThumbUrl = (u) => typeof u === 'string' && u.length <= 320 && STORED_URL.test(u);

/** "p-<shortcode>" from a post's own Instagram link (the same key bestPosts.postKeyOf makes), or ''. */
function keyOfUrl(url) {
  const m = SHORTCODE.exec(String(url || ''));
  return m ? `p-${m[1]}` : '';
}
const postUrlOf = (p) => String((p && (p.url || p.postUrl)) || (p && p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : ''));
const rawDate = (p) => { for (const k of ['timestamp', 'takenAt', 'takenAtTimestamp', 'date', 'at']) { const d = toDate(p && p[k]); if (d) return d; } return null; };
const rawLikes = (p) => (p && p.likesCount !== undefined ? p.likesCount : p && p.likes);
const rawComments = (p) => (p && p.commentsCount !== undefined ? p.commentsCount : p && p.comments);
const scoreOf = (likes, comments) => (isCount(likes) ? likes + 3 * (isCount(comments) ? comments : 0) : null);
const weekOf = (d) => require('../week/weekMath').weekStartOf(d);

/** The picture link of one raw post from the read: displayUrl, else the first of images. Only allowed hosts. */
function sourceOf(p) {
  const { isAllowedUrl } = require('./avatar');
  const list = [p && p.displayUrl, ...asArray(p && p.images)];
  for (const v of list) if (typeof v === 'string' && isAllowedUrl(v)) return v;
  return '';
}

/**
 * Which posts get a stored picture, in priority order: best of this week, best 3 of 30 days, latest 3; at most `max`.
 * `posts`: { key, at, likes, comments } from the stored snapshots and this read together (one per key).
 */
function chooseKeys(posts, { now = new Date(), max = caps().THUMBS_PER_COMPETITOR } = {}) {
  const at = toDate(now) || new Date();
  const list = asArray(posts).filter((p) => p && p.key && p.at instanceof Date && p.at <= at);
  const month = list.filter((p) => at - p.at <= MONTH_DAYS * DAY);
  const scored = (xs) => xs.map((p) => ({ p, s: scoreOf(p.likes, p.comments) })).filter((x) => x.s !== null && x.s > 0)
    .sort((a, b) => b.s - a.s || b.p.at - a.p.at).map((x) => x.p.key);
  const thisWeek = weekOf(at);
  const weekBest = scored(month.filter((p) => weekOf(p.at) === thisWeek)).slice(0, 1);
  const best = scored(month).slice(0, 3);
  const latest = [...list].sort((a, b) => b.at - a.at).slice(0, 3).map((p) => p.key);
  const out = [];
  for (const k of [...weekBest, ...best, ...latest]) if (!out.includes(k) && out.length < max) out.push(k);
  return out;
}

/** One entry per post key from the stored snapshots (newest reading first) and this read's raw posts. */
function candidatePosts(snapshots, rawPosts, now) {
  const at = toDate(now) || new Date();
  const seen = new Map();
  for (const p of asArray(rawPosts)) {
    if (!p || typeof p !== 'object') continue;
    const key = keyOfUrl(postUrlOf(p));
    const d = rawDate(p);
    if (!key || !d || d > at || seen.has(key)) continue;
    const likes = rawLikes(p); const comments = rawComments(p);
    seen.set(key, { key, at: d, likes: isCount(likes) ? likes : null, comments: isCount(comments) ? comments : null, source: sourceOf(p) });
  }
  for (const s of asArray(snapshots)) {
    for (const p of asArray(s && s.posts)) {
      const key = keyOfUrl(p && p.url);
      const d = toDate(p && p.at);
      if (!key || !d || d > at || seen.has(key)) continue;
      seen.set(key, { key, at: d, likes: isCount(p.likes) ? p.likes : null, comments: isCount(p.comments) ? p.comments : null, source: '' });
    }
  }
  return [...seen.values()];
}

/** 360 x 450, centre crop, WebP; the quality steps down until it fits 40 KB. Rejects anything sharp cannot read. */
async function resizeThumb(buffer) {
  const sharp = require('sharp');
  for (const quality of QUALITIES) {
    let out;
    try {
      out = await sharp(buffer, { limitInputPixels: 4096 * 4096, failOn: 'error' }).rotate().resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' }).webp({ quality }).toBuffer();
    } catch (_) {
      throw new (require('./avatar').AvatarError)('bad_image');
    }
    if (out.length <= MAX_STORED_BYTES) return out;
  }
  throw new (require('./avatar').AvatarError)('too_big');
}

const keyOf = (competitorId, postKey) => `${String(competitorId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)}-${String(postKey || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 70)}`;
const sourceKey = (url) => { try { return crypto.createHash('sha256').update(new URL(url).pathname).digest('hex').slice(0, 32); } catch (_) { return ''; } };

/** Our image storage (the same Cloudinary account the uploads and the profile pictures use). */
function defaultStorage() {
  return {
    async put(key, buffer) {
      require('../imageUploader'); // configures the shared Cloudinary client
      const cloudinary = require('cloudinary').v2;
      const r = await cloudinary.uploader.upload(`data:image/webp;base64,${buffer.toString('base64')}`, {
        folder: FOLDER, public_id: key, overwrite: true, invalidate: true, resource_type: 'image', timeout: 20000
      });
      return r && r.secure_url;
    },
    async remove(urls) {
      const { extractAssets, deleteAssets } = require('../cloudinaryCleanup');
      require('../imageUploader');
      const assets = extractAssets((urls || []).filter(isStoredThumbUrl).join(' '));
      if (!assets.length) return { requested: 0, failedBatches: 0 };
      return deleteAssets(assets);
    }
  };
}

function defaultModel() { return require('../../models/Competitor'); }

/** How many post pictures are stored across all accounts (one small aggregate over the competitors that have any). */
async function countStored(Competitor = defaultModel()) {
  const rows = await Competitor.aggregate([
    { $match: { 'postThumbs.0': { $exists: true } } },
    { $group: { _id: null, n: { $sum: { $size: '$postThumbs' } } } }
  ]).option({ maxTimeMS: 10000 });
  return (rows && rows[0] && rows[0].n) || 0;
}

/** Deletes stored post pictures by their links (only our own post picture links are touched). Never throws. */
async function removeThumbs(urls, { storage } = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(isStoredThumbUrl);
  if (!list.length) return { requested: 0, failedBatches: 0 };
  try { return (await (storage || defaultStorage()).remove(list)) || { requested: list.length, failedBatches: 0 }; }
  catch (e) { console.error('[competitors] could not delete stored post pictures:', e && e.message); return { requested: list.length, failedBatches: 1 }; }
}

const thumbUrlsOf = (competitor) => asArray(competitor && competitor.postThumbs).map((t) => t && t.thumbUrl).filter(isStoredThumbUrl);

/** The competitor stops being tracked as this account (ignored, or another handle): forget and delete its post pictures. Never throws. */
async function dropThumbs(competitor, { Competitor = null, storage = null } = {}) {
  const urls = thumbUrlsOf(competitor);
  if (!urls.length) return { dropped: 0 };
  try {
    await (Competitor || defaultModel()).updateOne({ _id: competitor._id }, { $unset: { postThumbs: '' } });
  } catch (e) {
    console.error('[competitors] could not clear stored post pictures:', e && e.message);
    return { dropped: 0 };
  }
  await removeThumbs(urls, { storage });
  return { dropped: urls.length };
}

/**
 * After a good weekly read: keep pictures of the chosen posts, fetch the chosen ones not stored yet (from this read
 * only), delete the ones that dropped out. Never throws. Returns { ok, added, kept, removed } or { ok: false, skipped | reason }.
 * deps: { env, storage, save, countStored, request, resolve, resize, Competitor }.
 */
async function refreshPostThumbs({ competitor, profile, snapshots = [], now = new Date(), deps = {} } = {}) {
  try {
    if (!thumbsEnabled(deps.env || process.env)) return { ok: false, skipped: 'switched_off' };
    const c = competitor || {};
    if (!c._id) return { ok: false, skipped: 'no_id' };
    if (c.isActive === false || c.isIgnored) return { ok: false, skipped: 'not_tracked' };
    const cfg = caps();
    const at = toDate(now) || new Date();
    const raw = asArray(profile && (profile.latestPosts || profile.posts));
    const candidates = candidatePosts(snapshots, raw, at);
    const wanted = chooseKeys(candidates, { now: at, max: cfg.THUMBS_PER_COMPETITOR });
    const byKey = new Map(candidates.map((p) => [p.key, p]));
    const stored = asArray(c.postThumbs).filter((t) => t && t.postKey && isStoredThumbUrl(t.thumbUrl));

    const storage = deps.storage || defaultStorage();
    const kept = stored.filter((t) => wanted.includes(t.postKey));
    const dropped = stored.filter((t) => !wanted.includes(t.postKey));
    const missing = wanted.filter((k) => !kept.some((t) => t.postKey === k) && byKey.get(k) && byKey.get(k).source);

    const added = [];
    if (missing.length) {
      let room = cfg.THUMBS_GLOBAL_MAX;
      try { room = cfg.THUMBS_GLOBAL_MAX - (await (deps.countStored || (() => countStored(deps.Competitor)))()); } catch (_) { room = 0; } // unknown: add nothing
      const { fetchImage } = require('./avatar');
      for (const key of missing) {
        if (room <= 0) break;
        try {
          const src = byKey.get(key).source;
          const img = await fetchImage(src, { request: deps.request, resolve: deps.resolve, timeoutMs: TIMEOUT_MS, maxBytes: MAX_SOURCE_BYTES });
          const small = await (deps.resize || resizeThumb)(img.body);
          if (!small || !small.length || small.length > MAX_STORED_BYTES) continue;
          const url = await storage.put(keyOf(c._id, key), small);
          if (!isStoredThumbUrl(url)) continue;
          added.push({ postKey: key, thumbUrl: url, sourceKey: sourceKey(src), at });
          room -= 1;
        } catch (_) { /* this post keeps no picture this week; the tile shows its type instead */ }
      }
    }

    if (!added.length && !dropped.length) return { ok: true, added: 0, kept: kept.length, removed: 0 };
    const next = [...kept, ...added].sort((a, b) => wanted.indexOf(a.postKey) - wanted.indexOf(b.postKey));
    const save = deps.save || ((id, list) => (deps.Competitor || defaultModel()).updateOne({ _id: id, isActive: { $ne: false }, isIgnored: { $ne: true } }, { $set: { postThumbs: list } }));
    const r = await save(c._id, next);
    if (r && r.matchedCount === 0) {
      // Removed or ignored while we worked: keep nothing new. (Removal paths delete the stored ones themselves.)
      await removeThumbs(added.map((t) => t.thumbUrl), { storage });
      return { ok: false, skipped: 'not_tracked' };
    }
    const removeUrls = dropped.map((t) => t.thumbUrl).filter((u) => !next.some((t) => t.thumbUrl === u));
    if (removeUrls.length) await removeThumbs(removeUrls, { storage });
    c.postThumbs = next;
    return { ok: true, added: added.length, kept: kept.length, removed: removeUrls.length };
  } catch (e) {
    console.warn('[competitors] post pictures not refreshed:', e && e.message);
    return { ok: false, reason: 'error' };
  }
}

/** postKey -> our stored link, for the read model. Empty when the switch is off. */
function thumbMap(competitor, { on = thumbsEnabled() } = {}) {
  const m = new Map();
  if (!on) return m;
  for (const t of asArray(competitor && competitor.postThumbs)) if (t && t.postKey && isStoredThumbUrl(t.thumbUrl)) m.set(t.postKey, t.thumbUrl);
  return m;
}

module.exports = {
  refreshPostThumbs, removeThumbs, dropThumbs, thumbUrlsOf, thumbMap, thumbsEnabled, isStoredThumbUrl, chooseKeys, candidatePosts, sourceOf,
  keyOfUrl, resizeThumb, countStored, FOLDER, WIDTH, HEIGHT, MAX_STORED_BYTES, MAX_SOURCE_BYTES, TIMEOUT_MS
};
