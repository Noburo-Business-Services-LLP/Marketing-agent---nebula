'use strict';
// Checks a finished page: a vision model only READS the text out of the picture; this code decides whether the page
// is acceptable by comparing that transcript with the planned lines.

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);

// A small integer is always fine on a page (days, page numbers, "30" and "90"); longer or formatted numbers must be planned.
const numberTokens = (s) => (String(s || '').match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/[,.]/g, ''));
const SMALL_OK = (n) => /^\d{1,2}$/.test(n) && Number(n) <= 31 || n === '90' || n === '30';

/** How much of the planned text is readable in the picture, and what is wrong with it. */
function matchTranscript(expectedLines, transcript, { minLineMatch = 0.8 } = {}) {
  const expected = (expectedLines || []).map((l) => String(l || '')).filter((l) => norm(l));
  const got = new Set(tokens(transcript));
  const missing = [];
  let found = 0;
  for (const line of expected) {
    const t = tokens(line);
    const hit = t.filter((w) => got.has(w)).length;
    if (t.length && hit / t.length >= minLineMatch) found += 1; else missing.push(line);
  }
  const allowed = new Set(numberTokens(expected.join(' ')));
  const invented = Array.from(new Set(numberTokens(transcript))).filter((n) => !allowed.has(n) && !SMALL_OK(n));
  const coverage = expected.length ? found / expected.length : 1;
  return { coverage, missing, invented };
}

/** A page passes when at least 75 percent of the lines are readable and no unplanned number appears. */
function pageAccepted(match, { minCoverage = 0.75 } = {}) {
  return match.coverage >= minCoverage && match.invented.length === 0;
}

module.exports = { matchTranscript, pageAccepted, norm };
