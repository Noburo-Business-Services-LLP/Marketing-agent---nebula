'use strict';
/**
 * A tracked competitor's profile picture, kept as our own small copy. Instagram's picture links expire within days and
 * must not be loaded from the customer's browser, so the weekly tracker (tracker.js), right after it has saved a good
 * read, hands the profile it ALREADY read to refreshAvatar. No extra paid call is made: the picture link is a field of
 * that same read (profilePicUrl / profilePicUrlHD).
 *
 * Rules (docs/superpowers/ops/competitors-home.md, "Profile pictures"):
 *   - best effort: it never throws and never fails the read; any failure leaves the old picture in place,
 *   - only https links on Instagram or Facebook picture hosts (allow-list), no user, no odd port, no IP literal,
 *   - every host (also after a redirect) must resolve to public addresses only, checked again at connect time,
 *   - a redirect is followed only to another allowed host, at most two,
 *   - only image/jpeg, image/png or image/webp, at most 200 KB, 5 s in all,
 *   - resized to 96 x 96 and stored under one key per competitor (nebula-competitor-avatars/<competitorId>),
 *   - refreshed at most once a week and only when the picture itself changed (the link's path, not its signature),
 *   - deleted when the competitor is removed or ignored (cleanup.js, routes/competitors.js) and with the account
 *     (the account erase finds every file in our nebula folders on the customer's records).
 */
const crypto = require('crypto');
const net = require('net');

const DAY = 864e5;
const MAX_BYTES = 200 * 1024;
const TIMEOUT_MS = 5000;
const SIZE = 96;
const MAX_REDIRECTS = 2;
const REFRESH_MS = 6.5 * DAY; // "at most weekly", with room for the tracker's own timing
const FOLDER = 'nebula-competitor-avatars';
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
// Our own stored copy: the only kind of picture link the API ever returns.
const STORED_URL = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/(?:[A-Za-z0-9_,.:-]+\/)*nebula-competitor-avatars\/[A-Za-z0-9_-]{1,64}\.(?:webp|jpg|jpeg|png)$/;

class AvatarError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new AvatarError(code); };

const isStoredAvatarUrl = (u) => typeof u === 'string' && u.length <= 300 && STORED_URL.test(u);

/** Is this an https link on an allowed picture host? */
function isAllowedUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  if (!host || net.isIP(host.replace(/^\[|\]$/g, ''))) return false;
  return ALLOWED_HOST.test(host);
}

function v4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 192 && b === 0 && p[2] === 2)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && p[2] === 100) || (a === 203 && b === 0 && p[2] === 113);
}

/** True for loopback, private, link-local, carrier, multicast, reserved and unparsable addresses. */
function isPrivateAddress(ip) {
  const s = String(ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  const kind = net.isIP(s);
  if (kind === 4) return v4Private(s);
  if (kind !== 6) return true;
  // An IPv4 address carried inside IPv6 (::ffff:10.0.0.1, ::ffff:a00:1, 64:ff9b::...) is judged as that IPv4 address.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) return v4Private(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hex) { const a = parseInt(hex[1], 16); const b = parseInt(hex[2], 16); return v4Private(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
  if (s === '::' || s === '::1' || s.startsWith('::ffff:') || s.startsWith('64:ff9b:')) return true;
  const first = parseInt(s.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && parseInt(s.split(':')[1] || '0', 16) === 0x0db8) return true; // documentation
  return false;
}

/** A dns.lookup stand-in that refuses private addresses, so the address actually connected to is checked too. */
function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'object' && options ? options : {};
  require('dns').lookup(hostname, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    const addrs = Array.isArray(list) ? list : [];
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return cb(new AvatarError('private_address'));
    if (opts.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

const resolveAll = (host) => require('dns').promises.lookup(host, { all: true });

/** One GET with no redirect following, a byte cap and an overall time limit. Resolves { status, headers, body }. */
function httpsGet(url, { timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, lookup = safeLookup } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const req = require('https').get(url, { lookup, headers: { accept: 'image/webp,image/jpeg,image/png' }, timeout: timeoutMs }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); finish(reject, new AvatarError('too_big')); return; }
        chunks.push(c);
      });
      res.on('end', () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', (e) => finish(reject, e));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, new AvatarError('timeout')); }, timeoutMs);
    req.on('timeout', () => { req.destroy(); finish(reject, new AvatarError('timeout')); });
    req.on('error', (e) => finish(reject, e && e.code ? e : new AvatarError((e && e.message) || 'network')));
  });
}

const header = (h, name) => { const v = h && (h[name] !== undefined ? h[name] : h[name.toLowerCase()]); return Array.isArray(v) ? v[0] : v; };

/**
 * Downloads one picture under every rule above. `request` and `resolve` are replaceable for tests.
 * Resolves { body, type } or rejects with an AvatarError code.
 */
async function fetchImage(url, { request = httpsGet, resolve = resolveAll, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  const started = Date.now();
  let current = String(url || '');
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedUrl(current)) fail(hop ? 'redirect_not_allowed' : 'host_not_allowed');
    const host = new URL(current).hostname;
    let addrs;
    try { addrs = await resolve(host); } catch (_) { fail('dns'); }
    const list = (Array.isArray(addrs) ? addrs : [addrs]).map((a) => (a && typeof a === 'object' ? a.address : a)).filter(Boolean);
    if (!list.length || list.some(isPrivateAddress)) fail('private_address');
    const left = timeoutMs - (Date.now() - started);
    if (left <= 0) fail('timeout');
    const res = await request(current, { timeoutMs: left, maxBytes });
    const status = Number(res && res.status);
    if (status >= 300 && status < 400) {
      const loc = header(res.headers, 'location');
      if (!loc) fail('bad_status');
      try { current = new URL(String(loc), current).href; } catch (_) { fail('redirect_not_allowed'); }
      continue;
    }
    if (status !== 200) fail('bad_status');
    const type = String(header(res.headers, 'content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.has(type)) fail('bad_type');
    const declared = Number(header(res.headers, 'content-length'));
    const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body || []);
    if ((Number.isFinite(declared) && declared > maxBytes) || body.length > maxBytes) fail('too_big');
    if (!body.length) fail('empty');
    return { body, type };
  }
  return fail('too_many_redirects');
}

/** 96 x 96, centre crop, WebP. Rejects anything sharp cannot read as a picture. */
async function resizeImage(buffer) {
  const sharp = require('sharp');
  try {
    return await sharp(buffer, { limitInputPixels: 4096 * 4096, failOn: 'error' }).rotate().resize(SIZE, SIZE, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  } catch (_) {
    return fail('bad_image');
  }
}

/** The picture's identity: the link's path (the CDN host and the signature in the query change on every read). */
function sourceKey(url) {
  try { return crypto.createHash('sha256').update(new URL(url).pathname).digest('hex').slice(0, 32); } catch (_) { return ''; }
}

/** The smaller picture is enough for 96 x 96 and keeps under the size cap; the large one is the fallback. */
function pickSource(profile) {
  const p = profile || {};
  for (const v of [p.profilePicUrl, p.profilePicUrlHD, p.profile_pic_url]) if (typeof v === 'string' && isAllowedUrl(v)) return v;
  return '';
}

/** Our image storage (the same Cloudinary account the app's uploads use), one fixed key per competitor. */
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
      const assets = extractAssets((urls || []).filter(isStoredAvatarUrl).join(' '));
      if (!assets.length) return { requested: 0, failedBatches: 0 };
      return deleteAssets(assets);
    }
  };
}

function defaultSave() {
  // Only a competitor that is still tracked gets a picture.
  return async (id, fields) => require('../../models/Competitor').updateOne({ _id: id, isActive: { $ne: false }, isIgnored: { $ne: true } }, { $set: fields });
}

const keyOf = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

/**
 * After a good weekly read: store the competitor's picture if there is none yet, or if it changed and the stored one is
 * at least a week old. Never throws. Returns { ok, url } or { ok: false, skipped | reason }.
 */
async function refreshAvatar({ competitor, profile, now = new Date(), deps = {} } = {}) {
  try {
    const c = competitor || {};
    const key = keyOf(c._id);
    if (!key) return { ok: false, skipped: 'no_id' };
    if (c.isActive === false || c.isIgnored) return { ok: false, skipped: 'not_tracked' };
    const src = pickSource(profile);
    if (!src) return { ok: false, skipped: 'no_source' };
    const srcKey = sourceKey(src);
    const has = isStoredAvatarUrl(c.avatarUrl);
    if (has && c.avatarSourceKey && c.avatarSourceKey === srcKey) return { ok: false, skipped: 'unchanged' };
    const last = c.avatarUpdatedAt ? new Date(c.avatarUpdatedAt).getTime() : 0;
    if (has && last && new Date(now).getTime() - last < REFRESH_MS) return { ok: false, skipped: 'recent' };

    const storage = deps.storage || defaultStorage();
    const save = deps.save || defaultSave();
    const img = await fetchImage(src, { request: deps.request, resolve: deps.resolve });
    const small = await (deps.resize || resizeImage)(img.body);
    if (!small || !small.length || small.length > MAX_BYTES) fail('bad_image');
    const url = await storage.put(key, small);
    if (!isStoredAvatarUrl(url)) fail('store_failed');
    const at = new Date(now);
    const r = await save(c._id, { avatarUrl: url, avatarUpdatedAt: at, avatarSourceKey: srcKey });
    if (r && r.matchedCount === 0) {
      // Removed or ignored while we worked: keep nothing.
      await Promise.resolve(storage.remove([url])).catch(() => {});
      return { ok: false, skipped: 'not_tracked' };
    }
    c.avatarUrl = url; c.avatarUpdatedAt = at; c.avatarSourceKey = srcKey;
    return { ok: true, url };
  } catch (e) {
    const reason = e instanceof AvatarError ? e.code : 'error';
    if (reason === 'error') console.warn('[competitors] picture not refreshed:', e && e.message);
    return { ok: false, reason };
  }
}

/** Deletes stored pictures by their links (only our own avatar links are touched). Never throws. */
async function removeAvatars(urls, { storage } = {}) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(isStoredAvatarUrl);
  if (!list.length) return { requested: 0, failedBatches: 0 };
  try { return (await (storage || defaultStorage()).remove(list)) || { requested: list.length, failedBatches: 0 }; }
  catch (e) { console.error('[competitors] could not delete a stored picture:', e && e.message); return { requested: list.length, failedBatches: 1 }; }
}

/**
 * The competitor stops being tracked as this account (ignored, or its handle now points at someone else): forget the
 * picture on the record and delete the stored file. Never throws.
 */
async function dropAvatar(competitor, { Competitor = null, storage = null } = {}) {
  const url = competitor && competitor.avatarUrl;
  if (!url) return { dropped: false };
  try {
    const M = Competitor || require('../../models/Competitor');
    await M.updateOne({ _id: competitor._id }, { $unset: { avatarUrl: '', avatarUpdatedAt: '', avatarSourceKey: '' } });
  } catch (e) {
    console.error('[competitors] could not clear a stored picture:', e && e.message);
    return { dropped: false };
  }
  await removeAvatars([url], { storage });
  return { dropped: true };
}

module.exports = {
  refreshAvatar, removeAvatars, dropAvatar, fetchImage, resizeImage, isAllowedUrl, isPrivateAddress, isStoredAvatarUrl, pickSource, sourceKey,
  safeLookup, httpsGet, AvatarError, FOLDER, MAX_BYTES, TIMEOUT_MS, SIZE, REFRESH_MS
};
