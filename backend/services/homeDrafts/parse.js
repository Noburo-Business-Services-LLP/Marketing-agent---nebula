'use strict';
/**
 * Strict reading of the two model replies for Home drafts. PURE. Never throws, never trusts the model.
 *   parseDraft: the writing reply -> { comment } or { caption, imageIdea }, or null when the shape is wrong.
 *   parseCheck: the check reply -> { valid, decent, reasons }. Anything that is not exactly the asked-for shape is
 *               { valid: false }, which the service treats as "not decent" (fail closed: no draft shown, refund).
 */
const { extractJson } = require('../listening/helpers');

const MAX_RAW = 20000;
const str = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : null);

function parseDraft(kind, raw) {
  try {
    if (typeof raw !== 'string' || raw.length > MAX_RAW) return null;
    const o = extractJson(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (kind === 'response_post') {
      const caption = str(o.caption); const imageIdea = str(o.imageIdea);
      if (!caption || !imageIdea) return null;
      return { caption, imageIdea: imageIdea.replace(/\s+/g, ' ') };
    }
    const comment = str(o.comment);
    if (!comment) return null;
    return { comment: comment.replace(/\s+/g, ' ') };
  } catch (_) { return null; }
}

function parseCheck(raw) {
  const invalid = { valid: false, decent: false, reasons: [] };
  try {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_RAW) return invalid;
    const o = extractJson(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return invalid;
    if (typeof o.decent !== 'boolean') return invalid;
    if (!Array.isArray(o.reasons) || o.reasons.length > 10 || !o.reasons.every((r) => typeof r === 'string')) return invalid;
    const reasons = o.reasons.map((r) => r.trim().slice(0, 80)).filter(Boolean).slice(0, 5);
    // A "yes" that still lists a reason is read as a "no": when the checker has a doubt, the draft is not shown.
    return { valid: true, decent: o.decent === true && reasons.length === 0, reasons };
  } catch (_) { return invalid; }
}

module.exports = { parseDraft, parseCheck };
