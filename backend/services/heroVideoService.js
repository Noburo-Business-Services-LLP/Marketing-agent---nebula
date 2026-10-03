/**
 * Hero video (Seedance 2.0 via fal.ai): input builder, ref validation, monthly quota.
 *
 * fal research (read from fal.ai model API pages, 2026-10-03; no live calls made):
 *  - Text endpoint:      bytedance/seedance-2.0/text-to-video
 *  - Reference endpoint: bytedance/seedance-2.0/reference-to-video
 *  - Inputs (both): prompt (string, required), resolution (enum 480p|720p|1080p|4k, default 720p),
 *    duration (enum "auto" or 4..15 seconds, default auto), aspect_ratio (enum auto|21:9|16:9|4:3|1:1|3:4|9:16),
 *    generate_audio (boolean, default true), bitrate_mode, codec, end_user_id.
 *  - Reference-only inputs: image_urls (ARRAY of strings, up to 9; jpeg/png/webp, 30MB each),
 *    video_urls (up to 3), audio_urls (up to 3).
 *  - Output: { video: { url, content_type, file_name, file_size }, seed } -> video URL at `video.url`.
 *  - UNCONFIRMED: whether `duration` is sent as a string or number. The page lists it as an enum;
 *    we send a string ("15"), the usual fal enum encoding. Verify on first live call (Task for integration).
 *  - Also exist (unused): .../us/... and .../fast/... variants.
 */
const HERO_RESOLUTION = '720p';
const HERO_MAX_REFS = 4;
const MIN_SECONDS = 4;
const ASPECTS = ['9:16', '16:9', '1:1'];
const DEFAULT_TEXT_MODEL = 'bytedance/seedance-2.0/text-to-video';
const DEFAULT_REF_MODEL = 'bytedance/seedance-2.0/reference-to-video';
const DEFAULT_LIMIT = 2;

const { HERO_CLIP_SECONDS } = require('../config/apiCosts');

function validateRefUrls(urls) {
  if (urls === undefined || urls === null) return [];
  if (!Array.isArray(urls)) throw new Error('refImageUrls must be an array');
  if (urls.length > HERO_MAX_REFS) throw new Error(`At most ${HERO_MAX_REFS} reference images allowed`);
  return urls.map((u) => {
    if (typeof u !== 'string') throw new Error('Reference image URLs must be strings');
    const s = u.trim();
    let parsed;
    try { parsed = new URL(s); } catch (_) { throw new Error('Invalid reference image URL'); }
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error('Reference image URLs must be public https:// URLs');
    return s;
  });
}

function buildHeroInput({ prompt, refImageUrls, aspectRatio, duration } = {}) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) throw new Error('Prompt is required');
  const refs = validateRefUrls(refImageUrls);
  const d = Number.parseInt(duration, 10);
  const seconds = Number.isFinite(d) ? Math.min(HERO_CLIP_SECONDS, Math.max(MIN_SECONDS, d)) : HERO_CLIP_SECONDS;
  const input = {
    prompt: text,
    resolution: HERO_RESOLUTION,
    duration: String(seconds),
    aspect_ratio: ASPECTS.includes(aspectRatio) ? aspectRatio : '9:16',
    generate_audio: true
  };
  if (refs.length) {
    input.image_urls = refs;
    return { model: process.env.FAL_HERO_REF_MODEL || DEFAULT_REF_MODEL, input };
  }
  return { model: process.env.FAL_HERO_TEXT_MODEL || DEFAULT_TEXT_MODEL, input };
}

function heroMonthlyLimit() {
  const n = Number.parseInt(process.env.HERO_VIDEO_MONTHLY_LIMIT, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

function monthStartUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function nextMonthStartUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

async function getHeroQuota(userId, now = new Date(), JobModel) {
  const Model = JobModel || require('../models/HeroVideoJob');
  const used = await Model.countDocuments({
    userId,
    'metadata.kind': 'hero',
    status: { $in: ['queued', 'processing', 'completed'] },
    createdAt: { $gte: monthStartUTC(now) }
  });
  return { used, limit: heroMonthlyLimit(), resetsOn: nextMonthStartUTC(now).toISOString() };
}

// ---- fal queue (client bootstrap copied from videoService.getFalClient; that file is untouched) ----
let falClientPromise = null;

async function getFalClient() {
  const apiKey = String(process.env.FAL_KEY || '').trim();
  if (!apiKey) throw new Error('FAL_KEY environment variable is required for hero video generation');
  if (!falClientPromise) {
    falClientPromise = import('@fal-ai/serverless-client').then((mod) => {
      const fal = mod.default || mod;
      if (typeof fal.config === 'function') fal.config({ credentials: apiKey });
      return fal;
    });
  }
  return falClientPromise;
}

async function submitHeroClip({ model, input }, fal) {
  const client = fal || await getFalClient();
  const res = await client.queue.submit(model, { input });
  const id = res && (res.request_id || res.requestId);
  if (!id) throw new Error('fal did not return a request id');
  return id;
}

function extractVideoUrl(result) {
  const r = result || {};
  const url = (r.video && r.video.url) || (r.data && r.data.video && r.data.video.url);
  return typeof url === 'string' && url ? url : null;
}

async function getHeroClipStatus(model, requestId, fal) {
  const client = fal || await getFalClient();
  const st = await client.queue.status(model, { requestId });
  const status = st && st.status;
  if (status === 'IN_QUEUE') return { state: 'queued' };
  if (status === 'IN_PROGRESS') return { state: 'processing' };
  if (status !== 'COMPLETED') return { state: 'failed', error: `Unexpected fal status: ${status}` };
  try {
    const result = await client.queue.result(model, { requestId });
    const videoUrl = extractVideoUrl(result);
    if (!videoUrl) return { state: 'failed', error: 'fal completed without a video URL' };
    return { state: 'completed', videoUrl };
  } catch (err) {
    return { state: 'failed', error: (err && err.message) || 'fal result fetch failed' };
  }
}

// deps (download/upload/unlink) are injectable for tests; defaults are lazy-required so the module imports without Mongo/Cloudinary.
async function copyClipToStorage(remoteUrl, deps = {}) {
  let filePath = null;
  try {
    const download = deps.download || require('./videoDownload').downloadVideoFromUrl;
    const upload = deps.upload || require('./imageUploader').uploadVideoFile;
    const d = await download(remoteUrl);
    filePath = d && d.filePath;
    if (!filePath) throw new Error('Download returned no file path');
    const up = await upload(filePath, 'nebula-hero-videos');
    if (!up || !up.url) throw new Error('Upload returned no URL');
    return up.url;
  } catch (err) {
    console.error('Hero clip storage copy failed, using remote URL:', err && err.message);
    return remoteUrl;
  } finally {
    if (filePath) {
      try { await (deps.unlink || require('fs').promises.unlink)(filePath); } catch (_) { /* best effort */ }
    }
  }
}

module.exports = {
  HERO_RESOLUTION, HERO_MAX_REFS, buildHeroInput, validateRefUrls,
  heroMonthlyLimit, monthStartUTC, nextMonthStartUTC, getHeroQuota,
  submitHeroClip, getHeroClipStatus, copyClipToStorage
};
