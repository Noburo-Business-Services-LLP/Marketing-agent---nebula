'use strict';
/**
 * The LOCAL decency filter for Home drafts. PURE: no database, no network, no model. Runs on every draft before the
 * second (model) check; a draft must pass both. It never edits a draft: it says yes or no and gives rule codes (never
 * the offending words, so nothing unkind is ever logged or shown).
 *
 * Rules, in order (all run on the text as written AND on a normalised form, so look-alike letters, accents, invisible
 * characters, l33t spelling and s p a c e d letters do not get through):
 *   abuse     a word of the comment-scoring abuse list (config/listening.js ABUSE_WORDS, the same filter as the quotes)
 *   word      a word of the extended list (config/decency.js WORDS and NATIVE): mockery, put-downs, groups and beliefs,
 *             bodies, politics, threats, and common insults in Hindi, Tamil, Telugu, Kannada and Malayalam
 *   phrase    a phrase that compares with or puts down another business, or sells on someone else's page
 *   name      the name or handle of any of the account's competitors
 *   copy      four words in a row from the competitor's stored caption (the writer never sees it; this is a backstop)
 *   contact   @, links, email addresses, phone numbers, street addresses
 *   number    any digit (the writer is given no numbers, so any number would be invented)
 *   hashtags  any hashtag in a comment or an idea, more than POST_MAX_HASHTAGS in a post
 *   emoji     more emoji than allowed
 *   shouting  two or more words in capitals, or more than two exclamation marks
 *   markup    code or markup characters
 *   length    shorter or longer than allowed
 */
const caps = require('../../config/homeDrafts');
const lists = require('../../config/decency');
const helpers = require('../listening/helpers');

let segmenter;
const graphemeCount = (s) => {
  if (!segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let n = 0;
  for (const _ of segmenter.segment(String(s))) n += 1; // eslint-disable-line no-unused-vars
  return n;
};

let wordRes;
const wordRegexes = () => (wordRes = wordRes || helpers.wordRegexes(lists.WORDS));
let phraseRes;
const BOUND_L = '(?<![\\p{L}\\p{M}\\p{N}])';
const BOUND_R = '(?![\\p{L}\\p{M}\\p{N}])';
const phraseRegexes = () => (phraseRes = phraseRes || lists.PHRASES.map((src) => new RegExp(`${BOUND_L}(?:${src})${BOUND_R}`, 'iu')));
const nativeWords = lists.NATIVE.map((w) => String(w).normalize('NFKC'));

const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
/** Lower case, look-alikes and accents folded, spaces collapsed: the form phrases and names are matched on. */
const plainForm = (s) => collapse(helpers.foldText(String(s)).replace(/[_*~|]+/g, ' '));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The forms a name or handle can take in a text: "Cake Zone", "cakezone", "cake_zone" -> "cake zone". */
function nameForms(raw) {
  const base = collapse(helpers.foldText(String(raw || '').trim().replace(/^@/, '')));
  if (base.length < 3) return [];
  const spaced = collapse(base.replace(/[._\-]+/g, ' '));
  const joined = spaced.replace(/\s+/g, '');
  return [...new Set([base, spaced, joined].filter((x) => x.length >= 3))];
}

/** One pattern per name form, whole words only (so "Bake" does not match "baker"). */
function namePatterns(banned) {
  const out = [];
  for (const raw of Array.isArray(banned) ? banned : []) {
    for (const f of nameForms(raw)) out.push(new RegExp(`${BOUND_L}${escapeRe(f)}${BOUND_R}`, 'iu'));
  }
  return out;
}

const wordsOf = (s) => plainForm(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
/** True when `text` repeats four words in a row from `source`. */
function copiesFrom(text, source, run = 4) {
  const src = wordsOf(source);
  if (src.length < run) return false;
  const grams = new Set();
  for (let i = 0; i + run <= src.length; i++) grams.add(src.slice(i, i + run).join(' '));
  const t = wordsOf(text);
  for (let i = 0; i + run <= t.length; i++) if (grams.has(t.slice(i, i + run).join(' '))) return true;
  return false;
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const HASHTAG = /#[\p{L}\p{M}\p{N}_]+/gu;
const MARKUP = /[<>{}[\]`\\]|```/;

const LIMITS = {
  comment: { min: caps.COMMENT_MIN, max: caps.COMMENT_MAX, hashtags: 0, emoji: caps.COMMENT_MAX_EMOJI },
  caption: { min: caps.CAPTION_MIN, max: caps.CAPTION_MAX, hashtags: caps.POST_MAX_HASHTAGS, emoji: caps.POST_MAX_EMOJI },
  imageIdea: { min: caps.IMAGE_IDEA_MIN, max: caps.IMAGE_IDEA_MAX, hashtags: 0, emoji: 0 }
};

/**
 * Rule codes that one piece of text breaks ([] = it passes). `field` is comment, caption or imageIdea.
 * `banned` = competitor names and handles, `source` = the competitor's stored caption (or '').
 */
function textProblems(text, { field = 'comment', banned = [], source = '' } = {}) {
  const reasons = new Set();
  if (typeof text !== 'string' || !text.trim()) return ['empty'];
  const raw = text.length > 4000 ? text.slice(0, 4000) : text;
  const t = collapse(raw).normalize('NFKC');
  const lim = LIMITS[field] || LIMITS.comment;
  const len = graphemeCount(t);
  if (len < lim.min || len > lim.max) reasons.add('length');

  if (!helpers.isDecentText(t)) reasons.add('abuse');
  const lower = t.toLowerCase();
  const folded = helpers.abuseForm(t);
  if (wordRegexes().some((re) => re.test(lower) || re.test(folded))) reasons.add('word');
  const foldedNative = helpers.foldText(t);
  if (nativeWords.some((w) => t.includes(w) || foldedNative.includes(w))) reasons.add('word');
  const plain = plainForm(t);
  if (phraseRegexes().some((re) => re.test(lower) || re.test(plain))) reasons.add('phrase');
  if (namePatterns(banned).some((re) => re.test(plain) || re.test(collapse(plain.replace(/[._\-]+/g, ' '))))) reasons.add('name');
  if (source && copiesFrom(t, source)) reasons.add('copy');

  // Hashtags are counted before the contact rule so a hashtag is never mistaken for a link.
  const tags = (t.match(HASHTAG) || []).length;
  if (tags > lim.hashtags) reasons.add('hashtags');
  const noTags = t.replace(HASHTAG, ' ');
  for (const v of new Set([noTags, helpers.contactForm(noTags)])) if (helpers.contactUnsafe(v)) reasons.add('contact');
  if (/\p{Nd}/u.test(t)) reasons.add('number');
  if ((t.match(EMOJI) || []).length > lim.emoji) reasons.add('emoji');
  const capsWords = (t.match(/(?<![\p{L}])[A-Z]{4,}(?![\p{L}])/gu) || []).length;
  if (capsWords >= 2 || (t.match(/!/g) || []).length > 2) reasons.add('shouting');
  if (MARKUP.test(t)) reasons.add('markup');
  return [...reasons];
}

/**
 * The whole draft: { comment } for a witty comment, { caption, imageIdea } for a response post.
 * Returns { ok, reasons } where reasons are rule codes (sorted, unique).
 */
function checkDraft(kind, draft, { banned = [], source = '' } = {}) {
  const d = draft && typeof draft === 'object' ? draft : {};
  const fields = kind === 'response_post' ? ['caption', 'imageIdea'] : ['comment'];
  const reasons = new Set();
  for (const f of fields) for (const r of textProblems(d[f], { field: f, banned, source })) reasons.add(r);
  return { ok: reasons.size === 0, reasons: [...reasons].sort() };
}

module.exports = { textProblems, checkDraft, copiesFrom, nameForms, graphemeCount, LIMITS };
