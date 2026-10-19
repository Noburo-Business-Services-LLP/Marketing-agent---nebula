'use strict';
/**
 * Brand memory ("What Nebulaa learned"): shared settings and small pure helpers. No database, no network.
 * How it works: docs/superpowers/ops/brand-memory.md. Impact map: docs/superpowers/impact-maps/brand-memory.md.
 */

/** The six sources, in the order the page shows them. */
const SOURCES = ['plan', 'blueprint', 'customers', 'products', 'results', 'competitors'];

const SOURCE_LABEL = {
  plan: 'your plan',
  blueprint: 'your Blueprint',
  customers: 'your customers',
  products: 'your products',
  results: 'your results',
  competitors: 'your competitors'
};

const CONFIDENCE = ['strong', 'good', 'early'];

const LIMITS = {
  MAX_ITEMS_PER_SOURCE: 6,
  MAX_TEXT: 200,           // characters an item's shown text may have
  MAX_PROMPT_LINE: 160,    // characters a prompt line may have
  MAX_HIDDEN: 200,         // deleted keys kept
  PRODUCTS_READ: 50,
  MEASURED_READ: 400,
  CAMPAIGNS_READ: 400,
  RESULTS_DAYS: 90,
  COMPETITOR_WEEKS: 8,
  SNAPSHOTS_READ: 60,      // 5 competitors x 8 weeks plus room
  QUERY_MS: 5000           // maxTimeMS on every read
};

const TIMING = {
  COOLDOWN_MS: 10 * 60 * 1000,      // Refresh now: once every 10 minutes per account
  LOCK_MS: 60 * 1000,               // one refresh at a time per account
  ACCOUNT_BUDGET_MS: 10 * 1000,     // one account's refresh is cut off after this
  JOB_EVERY_MS: 24 * 3600 * 1000,
  JOB_FIRST_MS: 10 * 60 * 1000,
  JOB_TIME_BOX_MS: 5 * 60 * 1000,
  JOB_BATCH: 100,
  JOB_STALE_MS: 7 * 24 * 3600 * 1000, // recompute even without a change once a week
  JOB_RECHECK_MS: 20 * 3600 * 1000,    // an account is looked at again after this
  TRIGGER_DEBOUNCE_MS: 2 * 60 * 1000
};

const PROMPT = { MAX_LINES: 10, MAX_CHARS: 900 }; // about 225 tokens at four characters a token

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** Cut by characters (not bytes, so Tamil and Hindi are never broken), at a word where possible. */
function clip(s, max) {
  const chars = Array.from(str(s));
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, max - 1).join('');
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${(atWord.length > max / 2 ? atWord : cut).replace(/[\s,;:.-]+$/, '')}…`;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toDate = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return Number.isFinite(d.getTime()) ? d : null; };

/** "Instagram, LinkedIn and Facebook". */
function listWords(xs) {
  const a = xs.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "12 October" in India time. */
function dayMonth(d) {
  const t = toDate(d);
  if (!t) return '';
  const x = new Date(t.getTime() + 330 * 60000);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}

/**
 * A line a prompt may carry: plain words, no digits, links, @names, #tags or markup. Returns '' when the text needs any
 * of those to make sense (the item is then shown on the page but never sent to a model).
 */
function promptSafe(text, max = LIMITS.MAX_PROMPT_LINE) {
  const s = str(text);
  if (!s) return '';
  if (/\p{Nd}|https?:|www\.|@|#|[<>{}[\]`\\|]/u.test(s)) return '';
  return clip(s, max);
}

/** Confidence words from how many things back an item. */
function confidenceFrom(n, { strong, good }) {
  if (!isNum(n)) return 'early';
  if (n >= strong) return 'strong';
  if (n >= good) return 'good';
  return 'early';
}

/** One learned item. `text` is shown; `promptLine` is what prompts read (code-written, no digits). */
function makeItem({ key, source, kind, text, promptLine = '', evidenceCount, evidenceUnit, evidenceText, confidence }) {
  const t = clip(text, LIMITS.MAX_TEXT);
  if (!key || !SOURCES.includes(source) || !t) return null;
  return {
    key: String(key).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80),
    source,
    kind: String(kind || 'fact'),
    text: t,
    promptLine: promptSafe(promptLine),
    evidenceCount: isNum(evidenceCount) && evidenceCount >= 0 ? Math.floor(evidenceCount) : 0,
    evidenceUnit: String(evidenceUnit || ''),
    evidenceText: clip(evidenceText || '', 120),
    confidence: CONFIDENCE.includes(confidence) ? confidence : 'early'
  };
}

/** The result of one source: { state, reason, evidenceCount, evidenceUnit, items }. */
function sourceResult(state, reason, { evidenceCount = 0, evidenceUnit = '', items = [] } = {}) {
  const list = items.filter(Boolean).slice(0, LIMITS.MAX_ITEMS_PER_SOURCE);
  return { state: list.length ? 'learned' : state, reason: list.length ? '' : reason, evidenceCount, evidenceUnit, items: list };
}

const claimText = (c) => str(c && typeof c === 'object' ? c.text : c);

module.exports = {
  SOURCES, SOURCE_LABEL, CONFIDENCE, LIMITS, TIMING, PROMPT,
  str, clip, plural, isNum, toDate, listWords, dayMonth, promptSafe, confidenceFrom, makeItem, sourceResult, claimText
};
