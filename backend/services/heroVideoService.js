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
  const Model = JobModel || require('../models/VideoJob');
  const used = await Model.countDocuments({
    userId,
    'metadata.kind': 'hero',
    status: { $in: ['queued', 'processing', 'completed'] },
    createdAt: { $gte: monthStartUTC(now) }
  });
  return { used, limit: heroMonthlyLimit(), resetsOn: nextMonthStartUTC(now).toISOString() };
}

module.exports = {
  HERO_RESOLUTION, HERO_MAX_REFS, buildHeroInput, validateRefUrls,
  heroMonthlyLimit, monthStartUTC, nextMonthStartUTC, getHeroQuota
};
