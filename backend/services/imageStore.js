'use strict';
/**
 * The one place a finished picture goes to storage (docs/superpowers/impact-maps/inline-images.md, decision D101).
 *
 * Pictures must not live inside Draft/Campaign documents as base64 (a draft averaged 723 KB and a campaign 1.62 MB on
 * the dev database). Storage is Cloudinary (services/imageUploader.js); this seam adds the checks and the rules:
 *
 *   storeImage(input, { folder })   input: a data URI, a Buffer, or an https link (returned unchanged).
 *     - png, jpeg, webp or gif only, by claimed type AND first bytes; SVG/HTML refused; at most IMAGE_STORE_MAX_BYTES.
 *     - storage not configured: development/test return the data URI ({ inline: true }); production THROWS.
 *     - an upload failure THROWS everywhere (the caller's existing error/refund path runs), never returns base64.
 *     -> { url, stored: true, publicId } | { url, stored: false } for a link | { url: dataUri, stored: false, inline: true }
 *   finishGeneratedImage(dataUri, opts)   the generator helper: { ok: true, url, stored } or
 *     { ok: false, storageFailed: true, error } with a customer-safe message (no provider wording).
 *
 * INLINE_IMAGE_MODE=legacy (emergency switch, no deploy): a failed or impossible upload keeps the data URI, as before.
 * createImageStore({ upload, env }) makes a fake-able instance; an injected `upload` counts as configured.
 */

const { parseDataUrl, checkUpload, sniffType, IMAGE_TYPES } = require('./uploadSafety');

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const CUSTOMER_MESSAGE = 'We could not save the picture. Please try again in a moment.';
const MIME_OF_TYPE = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

class ImageStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'ImageStoreError'; this.code = code; }
}

const isDataUri = (v) => typeof v === 'string' && /^\s*data:/i.test(v);
const isHttpsUrl = (v) => typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v.trim());

/** Decoded byte length of a base64 data URI without decoding it. */
function dataUriBytes(uri) {
  const s = String(uri);
  const comma = s.indexOf(',');
  const b64 = (comma >= 0 ? s.slice(comma + 1) : s).replace(/\s+/g, '');
  const pad = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

function createImageStore({ upload, env = process.env, logger = console } = {}) {
  const maxBytes = () => Number(env.IMAGE_STORE_MAX_BYTES) > 0 ? Number(env.IMAGE_STORE_MAX_BYTES) : DEFAULT_MAX_BYTES;
  const legacy = () => String(env.INLINE_IMAGE_MODE || '').toLowerCase() === 'legacy';
  const production = () => env.NODE_ENV === 'production';
  const isConfigured = () => Boolean(upload) || Boolean(env.CLOUDINARY_URL) || Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
  const doUpload = upload || ((data, folder) => require('./imageUploader').uploadBase64Image(data, folder));

  /** A checked data URI, or throws ImageStoreError('type' | 'size'). */
  function toCheckedDataUri(input) {
    let dataUri;
    if (Buffer.isBuffer(input)) {
      const type = sniffType(input);
      if (!IMAGE_TYPES.includes(type)) throw new ImageStoreError('type', 'Unsupported picture type');
      if (input.length > maxBytes()) throw new ImageStoreError('size', 'Picture too large');
      return `data:${MIME_OF_TYPE[type]};base64,${input.toString('base64')}`;
    }
    if (!isDataUri(input)) throw new ImageStoreError('type', 'Not a picture');
    dataUri = input.trim();
    const { mime, head } = parseDataUrl(dataUri);
    if (!/;base64,/i.test(dataUri.slice(0, 200))) throw new ImageStoreError('type', 'Not a base64 picture');
    const check = checkUpload({ mime, buffer: head, allow: IMAGE_TYPES });
    if (!check.ok) throw new ImageStoreError('type', 'Unsupported picture type');
    if (dataUriBytes(dataUri) > maxBytes()) throw new ImageStoreError('size', 'Picture too large');
    return dataUri;
  }

  async function storeImage(input, { folder = 'nebula-campaign-posts' } = {}) {
    if (isHttpsUrl(input)) return { url: input.trim(), stored: false };
    const dataUri = toCheckedDataUri(input);
    if (!isConfigured()) {
      if (production() && !legacy()) throw new ImageStoreError('not_configured', 'Picture storage is not configured');
      return { url: dataUri, stored: false, inline: true };
    }
    let res;
    try { res = await doUpload(dataUri, folder); } catch (e) { res = { success: false, error: e && e.message }; }
    if (res && res.success && isHttpsUrl(res.url)) return { url: res.url, stored: true, publicId: res.publicId || null };
    if (legacy()) {
      logger.warn('[image-store] upload failed, legacy mode keeps the data URI:', res && res.error);
      return { url: dataUri, stored: false, inline: true };
    }
    throw new ImageStoreError('upload_failed', (res && res.error) || 'Upload failed');
  }

  async function finishGeneratedImage(dataUri, opts = {}) {
    try {
      const out = await storeImage(dataUri, opts);
      return { ok: true, url: out.url, stored: out.stored };
    } catch (e) {
      logger.error('[image-store] could not store a generated picture:', e && e.code, e && e.message);
      return { ok: false, storageFailed: true, error: CUSTOMER_MESSAGE, code: (e && e.code) || 'upload_failed' };
    }
  }

  return { storeImage, finishGeneratedImage, isConfigured };
}

const defaultStore = createImageStore();

module.exports = {
  createImageStore,
  ImageStoreError,
  isDataUri,
  dataUriBytes,
  CUSTOMER_MESSAGE,
  storeImage: (...a) => defaultStore.storeImage(...a),
  finishGeneratedImage: (...a) => defaultStore.finishGeneratedImage(...a),
  isConfigured: () => defaultStore.isConfigured()
};
