'use strict';
// Reading the planner's answer. A model that runs out of room stops mid-answer, which leaves JSON that does not
// parse. repairTruncated cuts such an answer back to the last value that was complete and closes what is still
// open, in the right order. It never invents content: it can only keep less. Pure, no model call.

function stripFence(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.search(/[{[]/);
  return start > 0 ? t.slice(start) : t;
}

// Walk the text once, tracking strings and the open brackets. Every point where a value has just finished inside
// an object or array is a safe place to cut. A cut at a comma drops the half-written member after it.
function repairTruncated(text) {
  const t = stripFence(text);
  if (!t || (t[0] !== '{' && t[0] !== '[')) return null;
  const stack = [];
  let inStr = false;
  let esc = false;
  let safe = null; // { at, closers }
  const closersOf = () => stack.slice().reverse().map((c) => (c === '{' ? '}' : ']')).join('');
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) return null; // not a cut answer, a broken one
      if (!stack.length) return null; // the whole answer closed: nothing to repair here
      safe = { at: i + 1, closers: closersOf() };
      continue;
    }
    if (ch === ',' && stack.length) safe = { at: i, closers: closersOf() };
  }
  if (!stack.length || !safe) return null;
  const body = t.slice(0, safe.at).replace(/[\s,]+$/, '');
  try { return JSON.parse(body + safe.closers); } catch (_) { return null; }
}

// The answer as an object, and whether it had to be repaired.
function readPlanAnswer(raw, parseJSON) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { parsed: raw, repaired: false };
  const text = String(raw || '');
  try {
    const v = JSON.parse(stripFence(text));
    if (v && typeof v === 'object' && !Array.isArray(v)) return { parsed: v, repaired: false };
  } catch (_) { /* fall through to the repair */ }
  const fixed = repairTruncated(text);
  if (fixed && typeof fixed === 'object' && !Array.isArray(fixed)) return { parsed: fixed, repaired: true };
  if (typeof parseJSON === 'function') {
    try {
      const v = parseJSON(text);
      if (v && typeof v === 'object' && !Array.isArray(v)) return { parsed: v, repaired: true };
    } catch (_) { /* nothing usable */ }
  }
  return { parsed: null, repaired: false };
}

module.exports = { repairTruncated, readPlanAnswer, stripFence };
