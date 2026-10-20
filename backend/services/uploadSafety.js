'use strict';
/**
 * What a user upload really is, from its bytes (docs/superpowers/ops/security-hardening.md, decision D43).
 *
 * SVG and HTML are refused at every upload: both can carry script, and a browser runs it when the file is opened
 * from a page address. A file passes only when the type it claims (mime), its name (extension) AND its first bytes
 * (magic number) all agree with a type the route allows. Pictures: png, jpeg, webp, gif. Videos: mp4/mov, webm.
 * Documents: pdf.
 */

const IMAGE_TYPES = Object.freeze(['png', 'jpeg', 'webp', 'gif']);
const VIDEO_TYPES = Object.freeze(['mp4', 'webm']);
const PDF_TYPES = Object.freeze(['pdf']);

const MIME_OF = { png: ['image/png'], jpeg: ['image/jpeg', 'image/jpg', 'image/pjpeg'], webp: ['image/webp'], gif: ['image/gif'], mp4: ['video/mp4', 'video/quicktime', 'video/x-m4v'], webm: ['video/webm'], pdf: ['application/pdf'] };
const EXT_OF = { png: ['png'], jpeg: ['jpg', 'jpeg', 'jfif', 'pjpeg'], webp: ['webp'], gif: ['gif'], mp4: ['mp4', 'mov', 'm4v'], webm: ['webm'], pdf: ['pdf'] };
const DANGEROUS_EXT = /\.(svgz?|html?|xhtml|xht|xml|shtml|mht|mhtml|js|mjs)$/i;
const DANGEROUS_MIME = /(svg|html|xml|javascript|ecmascript)/i;

/** The type named by the first bytes: png, jpeg, webp, gif, mp4, webm, pdf, svg, html or 'unknown'. */
function sniffType(buf) {
  if (!buf || !buf.length) return 'unknown';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const at = (i, bytes) => bytes.every((x, k) => b[i + k] === x);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
  if (at(0, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (at(4, [0x66, 0x74, 0x79, 0x70])) return 'mp4'; // ....ftyp: mp4, mov, m4v
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (at(0, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  // Text formats: look past a byte-order mark and white space at the start.
  const head = b.slice(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (/^<\?xml[\s\S]*<svg|^<svg|^<!doctype svg/.test(head) || /<svg[\s>]/.test(head.slice(0, 600))) return 'svg';
  if (/^<!doctype html|^<html|^<head|^<body|^<script|^<iframe|^<img|^<div|^<a\s/.test(head)) return 'html';
  if (/^<\?xml/.test(head)) return 'html'; // other XML documents can also run script (XHTML)
  return 'unknown';
}

const extOf = (name) => { const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };

/**
 * { ok, type } or { ok: false, reason }. `mime` and `name` are what the client claimed (either may be empty); `allow`
 * is the list of types this route takes.
 */
function checkUpload({ mime = '', name = '', buffer, allow = IMAGE_TYPES } = {}) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (DANGEROUS_MIME.test(m)) return { ok: false, reason: 'type' };
  if (DANGEROUS_EXT.test(String(name || ''))) return { ok: false, reason: 'name' };
  const type = sniffType(buffer);
  if (type === 'svg' || type === 'html') return { ok: false, reason: 'content' };
  if (!allow.includes(type)) return { ok: false, reason: 'content' };
  // The claimed type and the name must each be one of the allowed types (a PNG labelled image/jpeg by a browser is
  // fine: it is stored under the type read from its bytes); anything else is refused.
  if (m && !allow.some((t) => MIME_OF[t].includes(m))) return { ok: false, reason: 'mismatch' };
  const ext = extOf(name);
  if (ext && !allow.some((t) => EXT_OF[t].includes(ext))) return { ok: false, reason: 'mismatch' };
  return { ok: true, type, mime: MIME_OF[type][0] };
}

/** A data URL ("data:<mime>;base64,<data>") or bare base64: the claimed mime and the first bytes. */
function parseDataUrl(value, headBytes = 2048) {
  const s = String(value || '');
  const m = /^data:([^;,]*)(;[^,]*)?,/i.exec(s);
  const mime = m ? m[1] : '';
  const isBase64 = m ? /;base64/i.test(m[2] || '') : true;
  const data = m ? s.slice(m[0].length) : s;
  const chunk = data.slice(0, Math.ceil(headBytes / 3) * 4).replace(/\s+/g, '');
  let head;
  try { head = isBase64 ? Buffer.from(chunk, 'base64') : Buffer.from(decodeURIComponent(chunk), 'utf8'); } catch (_) { head = Buffer.alloc(0); }
  return { mime, head, isDataUrl: Boolean(m) };
}

/** checkUpload for a picture sent as text (data URL or bare base64). */
function checkDataUrl(value, { allow = IMAGE_TYPES, name = '' } = {}) {
  const { mime, head } = parseDataUrl(value);
  return checkUpload({ mime, name, buffer: head, allow });
}

const MESSAGE = 'Please use a PNG, JPG, WebP or GIF picture.';

/**
 * Route middleware: when req.body[field] is set (a picture as text), refuse it unless it really is an allowed type.
 * Missing or empty fields pass (the route answers its own "required" message).
 */
function rejectUnsafeImage(field = 'imageData', { allow = IMAGE_TYPES, message = MESSAGE } = {}) {
  return (req, res, next) => {
    const v = req.body && req.body[field];
    if (v == null || v === '') return next();
    if (typeof v !== 'string') return res.status(400).json({ success: false, message });
    // A link to a picture already stored (https) is not an upload.
    if (/^https:\/\//i.test(v)) return next();
    const r = checkDataUrl(v, { allow, name: req.body && (req.body.fileName || req.body.filename || '') });
    if (!r.ok) return res.status(400).json({ success: false, unsupportedFile: true, message });
    return next();
  };
}

module.exports = { sniffType, checkUpload, checkDataUrl, parseDataUrl, rejectUnsafeImage, IMAGE_TYPES, VIDEO_TYPES, PDF_TYPES, MESSAGE };
