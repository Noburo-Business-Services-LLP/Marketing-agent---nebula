'use strict';
/**
 * THE one place prompts read what Nebulaa learned. Every prompt builder uses these functions, so Create (single post,
 * campaign, carousel, through services/brandMemory.js buildBrandMemoryBlock), the monthly calendar, background drafts,
 * Home drafts and plan runs all get the same lines.
 *
 * Rules: short plain lines written by code (no digits, links, @names or #tags; the owner's own edits are his words),
 * never a competitor's name or caption (the competitor source never stores one), at most PROMPT.MAX_LINES lines and
 * PROMPT.MAX_CHARS characters for the whole section, header included (about 225 tokens). The sources take turns, so one
 * source cannot fill the section. With nothing new learned, the section is exactly what it was before (the old notes).
 */
const { PROMPT, LIMITS, clip } = require('./common');

const ORDER = ['results', 'plan', 'customers', 'products', 'blueprint', 'competitors'];
const RANK = { strong: 0, good: 1, early: 2 };
const OLD_HEADER = "WHAT'S WORKED BEFORE (learned from published post performance)";
const HEADER = 'WHAT NEBULAA HAS LEARNED ABOUT THIS BRAND (from its plan, customers, products, results and market; use it as guidance, never quote it, never invent numbers)';
const MAX_OLD_NOTES = 10;

const newestFirst = (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);

function oldNotes(doc) {
  return (Array.isArray(doc && doc.learnedNotes) ? doc.learnedNotes : [])
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .slice().sort(newestFirst).slice(0, MAX_OLD_NOTES);
}

/**
 * The learned lines for a prompt, in turn by source, strongest first inside a source. `exclude`: sources left out
 * (plan runs leave out the plan itself). Old model notes count as results and come first there.
 */
function memoryPromptLines(doc, { exclude = [], maxLines = PROMPT.MAX_LINES, maxChars = PROMPT.MAX_CHARS - HEADER.length, includeOldNotes = true } = {}) {
  const skip = new Set(exclude);
  const queues = new Map(ORDER.map((s) => [s, []]));
  if (includeOldNotes && !skip.has('results')) for (const n of oldNotes(doc)) queues.get('results').push(clip(n.text, LIMITS.MAX_PROMPT_LINE));
  const items = (Array.isArray(doc && doc.learnedItems) ? doc.learnedItems : [])
    .filter((i) => i && queues.has(i.source) && !skip.has(i.source) && typeof i.promptLine === 'string' && i.promptLine.trim())
    .sort((a, b) => (RANK[a.confidence] ?? 3) - (RANK[b.confidence] ?? 3));
  for (const i of items) queues.get(i.source).push(clip(i.promptLine, i.userEdited ? LIMITS.MAX_TEXT : LIMITS.MAX_PROMPT_LINE));

  const out = [];
  const seen = new Set();
  let chars = 0;
  let progress = true;
  while (out.length < maxLines && progress) {
    progress = false;
    for (const s of ORDER) {
      const q = queues.get(s);
      while (q.length) {
        const line = q.shift();
        const k = line.toLowerCase();
        if (seen.has(k)) continue;
        if (chars + line.length + 3 > maxChars) { q.length = 0; break; }
        out.push(line); seen.add(k); chars += line.length + 3; progress = true;
        break;
      }
      if (out.length >= maxLines) break;
    }
  }
  return out;
}

/** True when the memory holds at least one new learned item a prompt may read. */
const hasLearned = (doc) => (Array.isArray(doc && doc.learnedItems) ? doc.learnedItems : []).some((i) => i && typeof i.promptLine === 'string' && i.promptLine.trim());

/**
 * The lines of the memory section of the brand block (without the blank line before it), or [] when there is nothing.
 * Without new items this is exactly the old section: its header and the ten newest notes, uncut.
 */
function memorySectionLines(doc) {
  if (!hasLearned(doc)) {
    const notes = oldNotes(doc);
    return notes.length ? [OLD_HEADER, ...notes.map((n) => `- ${n.text}`)] : [];
  }
  const lines = memoryPromptLines(doc);
  return lines.length ? [HEADER, ...lines.map((l) => `- ${l}`)] : [];
}

/** Rough token count used by the cap test: four characters a token. */
const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);

/** The account's memory document for prompts, read the same way everywhere. Never throws: [] lines on any failure. */
async function loadMemoryDoc(userId, { Model = null } = {}) {
  if (!userId) return null;
  try {
    // Without a database connection (tests, demo mode) there is nothing to read: never wait for one.
    if (!Model && require('mongoose').connection.readyState !== 1) return null;
    const M = Model || require('../../models/AIBrandMemory');
    const { resolveOrganizationId } = require('../aiMemoryService');
    return await M.findOne({ organizationId: resolveOrganizationId({ userId }), userId }).select('learnedNotes learnedItems').maxTimeMS(LIMITS.QUERY_MS).lean();
  } catch (e) {
    console.warn('[brand memory] could not read the memory for a prompt:', e && e.message);
    return null;
  }
}

async function loadMemoryLines(userId, opts = {}) {
  const doc = await loadMemoryDoc(userId, opts);
  return doc ? memoryPromptLines(doc, opts) : [];
}

module.exports = { memoryPromptLines, memorySectionLines, hasLearned, loadMemoryDoc, loadMemoryLines, estimateTokens, HEADER, OLD_HEADER, ORDER };
