'use strict';
/**
 * Compact copies of provider answers before they are stored (impact map inline-images.md section 2b, decision D103).
 *
 * Ayrshare's answers and our own publish errors used to be stored whole: an error that echoed the request carried the
 * base64 picture (a campaign's `publishResult.error`, `publishResult.instagramFix` and `lastPublishError` each held
 * the same 3.3 MB picture on the dev database). What every reader needs is kept: keys, ids, platforms, statuses,
 * links, codes, counters, short messages.
 *
 *   compactAnswer(value)   data URIs -> a marker; strings over 500 characters cut (http(s) links up to 2048 kept);
 *                          arrays at most 25 items; depth at most 6; at most 60 keys per object; when the result is
 *                          still over 32 KB, only the summary keys (SUMMARY_KEYS) are kept.
 *   capMessage(text)       data URIs inside the text -> a marker, then at most 500 characters.
 *   setters: compactSetter / messageSetter for mongoose (they run on documents and on update queries).
 */

const MAX_MESSAGE = 500;
const MAX_LINK = 2048;
const MAX_ITEMS = 25;
const MAX_DEPTH = 6;
const MAX_KEYS = 60;
const MAX_BYTES = 32 * 1024;
const MARK = '[inline data removed]';
const SUMMARY_KEYS = ['success', 'status', 'code', 'id', 'refId', 'platform', 'postIds', 'postUrl', 'errors', 'errorDetails', 'message', 'error',
  'retryCount', 'retryRequestedAt', 'simulated', 'reason', 'initial', 'verified', 'retry', 'data', 'posts', 'accountKey', 'adjustedScheduleDate'];

const DATA_URI_IN_TEXT = /data:[a-z0-9.+/-]*(;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]{16,}/gi;

function capMessage(value, max = MAX_MESSAGE) {
  if (value == null) return value;
  let s = typeof value === 'string' ? value : String(value);
  if (s.length > 64 && /data:/i.test(s)) s = s.replace(DATA_URI_IN_TEXT, MARK);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function compactString(s) {
  if (/^\s*data:/i.test(s)) return MARK;
  if (/^https?:\/\/\S+$/i.test(s) && s.length <= MAX_LINK) return s;
  return capMessage(s);
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v) && !v._bsontype;

function walk(value, depth) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return compactString(value);
  if (value instanceof Date || value._bsontype) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return '[binary removed]';
  if (depth >= MAX_DEPTH) return '[nested data removed]';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => walk(v, depth + 1));
  if (typeof value.toObject === 'function') return walk(value.toObject(), depth);
  if (isPlain(value)) {
    const out = {};
    for (const k of Object.keys(value).slice(0, MAX_KEYS)) {
      const v = walk(value[k], depth + 1);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return capMessage(String(value));
}

function pickSummary(value, depth = 0) {
  if (!isPlain(value) || depth > 3) return value;
  const out = {};
  for (const k of SUMMARY_KEYS) {
    if (value[k] === undefined) continue;
    out[k] = isPlain(value[k]) ? pickSummary(value[k], depth + 1) : value[k];
  }
  return out;
}

const sizeOf = (v) => { try { return Buffer.byteLength(JSON.stringify(v) || ''); } catch (_) { return Infinity; } };

function compactAnswer(value) {
  if (value == null || typeof value !== 'object') return typeof value === 'string' ? compactString(value) : value;
  let out = walk(value, 0);
  if (sizeOf(out) <= MAX_BYTES) return out;
  out = pickSummary(out);
  if (sizeOf(out) <= MAX_BYTES) return { ...out, compacted: true };
  return { compacted: true, status: out.status || null, id: out.id || null, error: typeof out.error === 'string' ? out.error : null };
}

/** True when a stored answer is already within the limits (the migration skips it). */
function isCompact(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.length <= MAX_LINK && !/data:[^,]*;base64,/i.test(value);
  return sizeOf(value) <= MAX_BYTES && !/data:[^,"]*;base64,/i.test(JSON.stringify(value) || '');
}

const compactSetter = (v) => (v == null ? v : compactAnswer(v));
const messageSetter = (v) => (v == null ? v : capMessage(v));
/** A [String] setter that keeps only http(s) links (a copy of a picture is only useful as a link). */
const linksOnlySetter = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^https?:\/\/\S+$/i.test(x) && x.length <= 2048) : v);

module.exports = { compactAnswer, capMessage, isCompact, compactSetter, messageSetter, linksOnlySetter, MAX_MESSAGE, MAX_BYTES, MARK, SUMMARY_KEYS };
