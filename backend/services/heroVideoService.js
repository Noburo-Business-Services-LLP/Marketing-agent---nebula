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
const HERO_MAX_REFS = 9; // the model's limit (was 4 before Hero Studio)
const MAX_URL_LENGTH = 2048;
const MIN_SECONDS = 4;
const ASPECTS = ['9:16', '16:9', '1:1'];
const DEFAULT_TEXT_MODEL = 'bytedance/seedance-2.0/text-to-video';
const DEFAULT_REF_MODEL = 'bytedance/seedance-2.0/reference-to-video';
const DEFAULT_LIMIT = 2;

const net = require('net');
const { HERO_CLIP_SECONDS } = require('../config/apiCosts');
const { heroLimitForUser } = require('../config/entitlements');

// True for IPv4 ranges that must never be fetched: this-network, private, loopback, link-local, CGNAT,
// IETF/documentation/benchmark blocks, multicast and reserved.
function isBlockedIPv4(a, b, c) {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

// Expands an IPv6 literal into 8 16-bit groups, or null when malformed. Handles :: and a trailing dotted quad.
function parseIPv6(ip) {
  let s = String(ip).toLowerCase().split('%')[0];
  const dq = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dq) {
    const o = dq.slice(2).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${dq[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

// True only for a globally routable unicast address (IPv4 or IPv6). Anything unparsable is not public.
function isPublicIp(ip) {
  if (typeof ip !== 'string') return false;
  const kind = net.isIP(ip.split('%')[0]);
  if (kind === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return !isBlockedIPv4(a, b, c);
  }
  if (kind !== 6) return false;
  const g = parseIPv6(ip);
  if (!g) return false;
  const v4 = (hi, lo) => !isBlockedIPv4(hi >> 8, hi & 255, lo >> 8);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4(g[6], g[7]); // IPv4-mapped
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 6to4 embeds an IPv4 address
  if ((g[0] & 0xe000) !== 0x2000) return false; // only 2000::/3 is global unicast (drops ::, ::1, fc00::/7, fe80::/10, ff00::/8, NAT64)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  return true;
}

// True only for a public https: URL (<= 2048 chars). Rejects http, loopback, private,
// link-local, CGNAT, .local/.internal/.localhost hosts, single-label hosts and IPv6 literals.
function isPublicHttpsUrl(url) {
  if (typeof url !== 'string') return false;
  const s = url.trim();
  if (!s || s.length > MAX_URL_LENGTH) return false;
  let u;
  try { u = new URL(s); } catch (_) { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[') || host.includes(':')) return false; // IPv6 literal
  if (host === 'localhost' || !host.includes('.')) return false;
  if (/\.(localhost|local|internal|lan|home|corp|test)$/.test(host)) return false;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m && isBlockedIPv4(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
  return true;
}

function validateRefUrls(urls) {
  if (urls === undefined || urls === null) return [];
  if (!Array.isArray(urls)) throw new Error('refImageUrls must be an array');
  if (urls.length > HERO_MAX_REFS) throw new Error(`At most ${HERO_MAX_REFS} reference images allowed`);
  return urls.map((u) => {
    if (typeof u !== 'string') throw new Error('Reference image URLs must be strings');
    const s = u.trim();
    try { new URL(s); } catch (_) { throw new Error('Invalid reference image URL'); }
    if (!isPublicHttpsUrl(s)) throw new Error('Reference image URLs must be public https:// URLs');
    if (/\.(svg|gif|avif|heic|heif|bmp|tiff?)$/i.test(new URL(s).pathname)) throw new Error("This image type isn't supported, use a JPG, PNG or WebP photo");
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

async function getHeroQuota(userId, now = new Date(), JobModel, UserModel) {
  const Model = JobModel || require('../models/HeroVideoJob');
  const used = await Model.countDocuments({
    userId,
    'metadata.kind': 'hero',
    status: { $in: ['queued', 'processing', 'completed'] },
    createdAt: { $gte: monthStartUTC(now) }
  });
  let user = null;
  if (UserModel) {
    try { user = await UserModel.findById(userId).select('plan').lean(); } catch (e) { user = null; }
  }
  const limit = heroLimitForUser(user, process.env.HERO_VIDEO_MONTHLY_LIMIT);
  return { used, limit, resetsOn: nextMonthStartUTC(now).toISOString() };
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

// The provider's own explanation of a refusal lives in the error body (`detail`), not in `message`,
// which only says "Unprocessable Entity". Keep it so the reason can be seen in the log.
function describeFalError(err) {
  const base = (err && err.message) || 'fal request failed';
  const body = err && err.body;
  let detail = '';
  if (body && Array.isArray(body.detail)) {
    detail = body.detail.map((d) => [Array.isArray(d && d.loc) ? d.loc.join('.') : '', d && (d.msg || d.message || d.type)].filter(Boolean).join(': ')).filter(Boolean).join('; ');
  } else if (body && typeof body.detail === 'string') {
    detail = body.detail;
  } else if (body && typeof body.message === 'string') {
    detail = body.message;
  }
  if (!detail && body && typeof body === 'object') {
    // Another shape (for example {error, code}): keep it short so the log shows what the provider said.
    try { const raw = JSON.stringify(body); if (raw && raw !== '{}') detail = raw.slice(0, 300); } catch (e) { detail = ''; }
  }
  return detail ? `${base}: ${detail}`.slice(0, 500) : base;
}

// The provider refuses reference images that may show a real person's likeness. Customers get a plain
// message with no vendor names; the stored job and the staff log keep the provider's own text.
const PEOPLE_REFUSAL_MESSAGE = 'The video model cannot use photos that show people. We have refunded your Quarks. Try again without the people photos, or use the default setting.';
const PEOPLE_REFUSAL_RE = /likenesses? of real people|private information that cannot be processed/i;
function customerFailureMessage(raw) {
  const text = typeof raw === 'string' ? raw : '';
  return PEOPLE_REFUSAL_RE.test(text) ? PEOPLE_REFUSAL_MESSAGE : raw;
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
    // A finished clip is paid for: only a definite client error (4xx other than 429) fails it.
    // Network errors (no numeric status), 5xx and 429 are rethrown so the flow treats them as
    // transient and retries on the next poll (bounded by the flow's max job age).
    const code = err && typeof err.status === 'number' ? err.status : null;
    if (code === null || code >= 500 || code === 429 || code < 400) throw err;
    return { state: 'failed', error: describeFalError(err) };
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
  HERO_RESOLUTION, HERO_MAX_REFS, isPublicHttpsUrl, isPublicIp, buildHeroInput, validateRefUrls,
  heroMonthlyLimit, monthStartUTC, nextMonthStartUTC, getHeroQuota,
  submitHeroClip, getHeroClipStatus, copyClipToStorage, describeFalError,
  customerFailureMessage, PEOPLE_REFUSAL_MESSAGE
};
