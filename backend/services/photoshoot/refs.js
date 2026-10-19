'use strict';
/**
 * Safe handling of the photos a photoshoot reads: the customer's upload, and the reference photos loaded from their own
 * product and place records. The type is read from the file's first bytes (never from its name or a header), and the
 * size is limited. Links must be https and point at a public host name (no IP address, no local name).
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

/** True for an https link to a public host name. */
function safeUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return true;
}

/**
 * One reference photo as { mimeType, data } (base64) for the image model, or null. Accepts the product's stored data URL
 * or a safe https link. Never throws.
 */
async function loadRef(src, { fetchImpl = (...a) => fetch(...a), maxBytes = caps.UPLOAD_MAX_BYTES, timeoutMs = 20000 } = {}) {
  try {
    const s = String(src || '');
    if (s.startsWith('data:')) {
      const r = readDataUrl(s, maxBytes);
      return r.ok ? { mimeType: r.mime, data: r.buffer.toString('base64') } : null;
    }
    if (!safeUrl(s)) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try { res = await fetchImpl(s, { redirect: 'error', signal: ctl.signal }); } finally { clearTimeout(timer); }
    if (!res || !res.ok) return null;
    const len = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0);
    if (len && len > maxBytes) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) return null;
    const mime = sniffImage(buffer);
    return mime ? { mimeType: mime, data: buffer.toString('base64') } : null;
  } catch (_) { return null; }
}

module.exports = { sniffImage, readDataUrl, safeUrl, loadRef };
