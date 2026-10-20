'use strict';
/**
 * Safe handling of the photos a photoshoot reads: the customer's upload, and the reference photos loaded from their own
 * product and place records. The type is read from the file's first bytes (never from its name or a header), and the
 * size is limited. Links must be https on port 443 and point at a public host name (no IP address, no local name).
 */
const caps = require('../../config/photoshoot');

/** 'image/png', 'image/jpeg', 'image/webp' or '' from the first bytes. */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

const DATA_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/** Reads a data URL into { ok, mime, buffer } or { ok: false, reason } (reason: 'format', 'type', 'size', 'empty'). */
function readDataUrl(dataUrl, maxBytes = caps.UPLOAD_MAX_BYTES) {
  const s = String(dataUrl || '');
  // A base64 string is a third larger than the file: refuse obviously oversized input before decoding it.
  if (s.length > Math.ceil(maxBytes * 1.37) + 100) return { ok: false, reason: 'size' };
  const m = DATA_RE.exec(s);
  if (!m) return { ok: false, reason: 'format' };
  const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) return { ok: false, reason: 'empty' };
  if (buffer.length > maxBytes) return { ok: false, reason: 'size' };
  const mime = sniffImage(buffer);
  if (!mime) return { ok: false, reason: 'type' };
  return { ok: true, mime, buffer };
}

/** True for an https link to a public host name on the standard port (443). */
function safeUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return true;
}

const MAX_REDIRECTS = 2;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const header = (h, name) => { const v = h && (h[name] !== undefined ? h[name] : h[name.toLowerCase()]); return Array.isArray(v) ? v[0] : v; };

/**
 * One reference photo as { mimeType, data } (base64) for the image model, or null. Accepts the product's stored data URL
 * or a safe https link. The link comes from the customer's own records, so it is treated as hostile: every host (also
 * after a redirect, at most two) must resolve to public addresses only, checked again when the connection is made
 * (services/safeFetch.js, the same rules as every other download of a link); only port 443, only image types, and the body is read with a running
 * byte cap, so an endless stream is cut off early. Never throws.
 * `request` (url, { timeoutMs, maxBytes }) -> { status, headers, body } and `resolve` (host) are replaceable for tests.
 */
async function loadRef(src, { request = null, resolve = null, maxBytes = caps.UPLOAD_MAX_BYTES, timeoutMs = 20000 } = {}) {
  try {
    const s = String(src || '');
    if (s.startsWith('data:')) {
      const r = readDataUrl(s, maxBytes);
      return r.ok ? { mimeType: r.mime, data: r.buffer.toString('base64') } : null;
    }
    // The address rules and the connect-time lookup are the shared SSRF helper's (services/safeFetch.js);
    // the capped https GET is the competitor-picture one, which already uses that lookup.
    const sf = require('../safeFetch');
    const avatar = require('../competitors/avatar');
    const get = request || ((url, o) => avatar.httpsGet(url, { ...o, lookup: sf.safeLookup }));
    const lookupAll = resolve || ((host) => require('dns').promises.lookup(host, { all: true }));
    const started = Date.now();
    let current = s;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!safeUrl(current)) return null;
      const addrs = await lookupAll(new URL(current).hostname);
      const list = (Array.isArray(addrs) ? addrs : [addrs]).map((a) => (a && typeof a === 'object' ? a.address : a)).filter(Boolean);
      if (!list.length || list.some(sf.isBlockedAddress)) return null;
      const left = timeoutMs - (Date.now() - started);
      if (left <= 0) return null;
      const res = await get(current, { timeoutMs: left, maxBytes });
      const status = Number(res && res.status);
      if (status >= 300 && status < 400) {
        const loc = header(res.headers, 'location');
        if (!loc) return null;
        current = new URL(String(loc), current).href;
        continue;
      }
      if (status !== 200) return null;
      const type = String(header(res.headers, 'content-type') || '').split(';')[0].trim().toLowerCase();
      if (!TYPES.has(type)) return null;
      const declared = Number(header(res.headers, 'content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) return null;
      const buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body || []);
      if (!buffer.length || buffer.length > maxBytes) return null;
      const mime = sniffImage(buffer);
      return mime ? { mimeType: mime, data: buffer.toString('base64') } : null;
    }
    return null;
  } catch (_) { return null; }
}

module.exports = { sniffImage, readDataUrl, safeUrl, loadRef };
