'use strict';
// Checks a finished page: a vision model only READS the text out of the picture; this code decides whether the page
// is acceptable by comparing that transcript with the planned lines.

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);

// A small integer is always fine on a page (days, page numbers, "30" and "90"); longer or formatted numbers must be planned.
const numberTokens = (s) => (String(s || '').match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/[,.]/g, ''));
const SMALL_OK = (n) => /^\d{1,2}$/.test(n) && Number(n) <= 31 || n === '90' || n === '30';

const MIN_FRAGMENT_SHARE = 0.7;   // a read line counts as "ours" when this share of its words is planned text
const DUPLICATE_MIN_WORDS = 3;    // only lines of at least this many words can count as printed twice
const MAX_EXTRA_WORDS = 3;        // a page may carry at most this many unplanned words (stray noise from reading)

/**
 * How much of the planned text is readable in the picture, and what is wrong with it.
 * `allowed` is other text the page is meant to carry (the heading and the small label); it is not a planned line,
 * but it is not "extra" either.
 */
function matchTranscript(expectedLines, transcript, { minLineMatch = 0.8, allowed = [], headings = [] } = {}) {
  const expected = (expectedLines || []).map((l) => String(l || '')).filter((l) => norm(l));
  const got = new Set(tokens(transcript));
  const missing = [];
  let found = 0;
  for (const line of expected) {
    const t = tokens(line);
    const hit = t.filter((w) => got.has(w)).length;
    if (t.length && hit / t.length >= minLineMatch) found += 1; else missing.push(line);
  }
  const allowedNumbers = new Set(numberTokens([...expected, ...allowed].join(' ')));
  // A small number is fine as a day or a count, but never as a percentage: "15% off" must have been planned.
  const percentOf = (txt) => (String(txt || '').match(/\d[\d,.]*\s*%/g) || []).map((x) => x.replace(/[^\d]/g, ''));
  const plannedPercents = new Set(percentOf([...expected, ...allowed].join(' ')));
  const inventedPercents = percentOf(transcript).filter((n) => !plannedPercents.has(n));
  const invented = Array.from(new Set([
    ...numberTokens(transcript).filter((n) => !allowedNumbers.has(n) && !SMALL_OK(n)),
    ...inventedPercents,
  ]));
  const coverage = expected.length ? found / expected.length : 1;

  // Text that is not ours: lines the reader found that are not made of planned or allowed words.
  const known = new Set([...expected, ...allowed].flatMap(tokens));
  const readLines = String(transcript || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => tokens(l).length);
  const extraLines = [];
  for (const line of readLines) {
    const t = tokens(line);
    const share = t.filter((w) => known.has(w) || /^\d+$/.test(w)).length / t.length;
    if (share < MIN_FRAGMENT_SHARE) extraLines.push(line);
  }
  const extraWords = extraLines.reduce((n, l) => n + tokens(l).length, 0);

  // A planned line printed twice: two read lines that each contain (nearly) all of its words.
  const duplicates = [];
  for (const line of expected) {
    const t = tokens(line);
    if (t.length < DUPLICATE_MIN_WORDS) continue;
    const copies = readLines.filter((r) => { const rt = new Set(tokens(r)); return t.filter((w) => rt.has(w)).length / t.length >= minLineMatch; }).length;
    if (copies >= 2) duplicates.push(line);
  }
  // The heading and the small label must be spelled exactly: every word of them has to be readable on the page.
  const headingWordsMissing = Array.from(new Set(headings.flatMap(tokens))).filter((w) => !got.has(w));
  return { coverage, missing, invented, extraLines, extraWords, duplicates, headingWordsMissing };
}

/**
 * A page passes when at least 75 percent of the lines are readable, no unplanned number appears, no unplanned words
 * (beyond a few stray ones) appear, and no planned line is printed twice.
 */
function pageAccepted(match, { minCoverage = 0.75 } = {}) {
  return match.coverage >= minCoverage
    && match.invented.length === 0
    && (match.extraWords || 0) <= MAX_EXTRA_WORDS
    && (match.duplicates || []).length === 0
    && (match.headingWordsMissing || []).length === 0;
}

/** One plain sentence for the page note, in the order that matters most. */
function rejectionNote(match) {
  if (match.invented.length) return 'A number that is not in your Blueprint appeared.';
  if ((match.extraWords || 0) > MAX_EXTRA_WORDS) return 'Words that are not in your Blueprint appeared.';
  if ((match.duplicates || []).length) return 'A line appeared twice.';
  if ((match.headingWordsMissing || []).length) return 'A heading was misspelled.';
  return 'Some of the text was not readable.';
}

module.exports = { matchTranscript, pageAccepted, rejectionNote, norm, MAX_EXTRA_WORDS };
