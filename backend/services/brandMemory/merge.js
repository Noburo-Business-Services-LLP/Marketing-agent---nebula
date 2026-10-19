'use strict';
/**
 * Joining a fresh refresh with what the memory already holds. PURE.
 * - The same key keeps the date it was first learned (`learnedAt`); `updatedAt` moves only when the item changed.
 * - An item the owner edited keeps his words on every refresh (and they become its prompt line); it stays even when
 *   its evidence is gone, because they are his words.
 * - A deleted key (in `hidden`) never comes back.
 * - A source that could not be read keeps its previous items.
 */
const crypto = require('crypto');
const { SOURCES, LIMITS, clip, promptSafe } = require('./common');

const same = (a, b) => a && b && a.text === b.text && a.promptLine === b.promptLine && a.evidenceCount === b.evidenceCount && a.confidence === b.confidence && a.evidenceText === b.evidenceText;

function mergeItems({ previous = [], results = {}, hidden = [], now = new Date() } = {}) {
  const hiddenSet = new Set((Array.isArray(hidden) ? hidden : []).map(String));
  const prevByKey = new Map((Array.isArray(previous) ? previous : []).filter((i) => i && i.key).map((i) => [i.key, i]));
  const out = [];
  const used = new Set();
  for (const source of SOURCES) {
    const r = results[source];
    if (!r || r.state === 'error') {
      for (const old of prevByKey.values()) if (old.source === source && !hiddenSet.has(old.key)) { out.push(old); used.add(old.key); }
      continue;
    }
    for (const item of r.items || []) {
      if (!item || hiddenSet.has(item.key) || used.has(item.key)) continue;
      const old = prevByKey.get(item.key);
      if (old && old.userEdited) {
        out.push({ ...item, text: old.text, promptLine: old.promptLine, userEdited: true, learnedAt: old.learnedAt || now, updatedAt: old.updatedAt || now });
      } else if (old && same(old, item)) {
        out.push({ ...item, userEdited: false, learnedAt: old.learnedAt || now, updatedAt: old.updatedAt || now });
      } else {
        out.push({ ...item, userEdited: false, learnedAt: (old && old.learnedAt) || now, updatedAt: now });
      }
      used.add(item.key);
    }
    // The owner's own edits stay even when the evidence is gone.
    for (const old of prevByKey.values()) {
      if (old.source === source && old.userEdited && !used.has(old.key) && !hiddenSet.has(old.key)) { out.push(old); used.add(old.key); }
    }
  }
  return out;
}

/** A fingerprint of what was learned: the same inputs give the same fingerprint (dates are left out). */
function fingerprint(items, sources) {
  const body = JSON.stringify({
    items: (items || []).map((i) => [i.key, i.text, i.promptLine, i.evidenceCount, i.confidence, !!i.userEdited]),
    sources: SOURCES.map((s) => { const x = (sources || {})[s] || {}; return [s, x.state, x.reason, x.evidenceCount]; })
  });
  return crypto.createHash('sha1').update(body).digest('hex');
}

/** The owner edits an item: his words, cut to size, become both the shown text and the prompt line. */
function editedItem(item, text, now = new Date()) {
  const t = clip(text, LIMITS.MAX_TEXT);
  return { ...item, text: t, promptLine: promptSafe(t, LIMITS.MAX_TEXT) || clip(t.replace(/https?:\/\/\S+|[@#]\S+/g, ' '), LIMITS.MAX_TEXT), userEdited: true, updatedAt: now };
}

/** Keys the owner deleted, newest last, capped. */
function addHidden(hidden, key) {
  const list = (Array.isArray(hidden) ? hidden : []).filter((k) => k !== key);
  list.push(key);
  return list.slice(-LIMITS.MAX_HIDDEN);
}

module.exports = { mergeItems, fingerprint, editedItem, addHidden };
