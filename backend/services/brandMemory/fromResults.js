'use strict';
/**
 * What the memory learns from how the account's own posts did. PURE.
 * The measured posts of the last 90 days are built exactly as the Performance view builds them
 * (services/performance/view.js measuredPost) and the findings come from services/performance/learnings.js with its
 * thresholds unchanged. Only posts that really reported a figure count: old rows that hold zeros and no platform answer
 * are counted as measured "without numbers" and never used.
 */
const { measuredPost } = require('../performance/view');
const { computeLearnings, THRESHOLDS } = require('../performance/learnings');
const { FORMAT_WORD, FORMAT_ONE, labelOf } = require('../performance/metrics');
const { plural, makeItem, sourceResult, confidenceFrom, toDate, LIMITS } = require('./common');

const RANGE = { key: '90d', words: 'in the last 90 days' };
const DAY_MS = 864e5;
const TIME_WORD = { morning: 'the morning', afternoon: 'the afternoon', evening: 'the evening', night: 'the night' };

function promptLineOf(l) {
  const s = l.subject || {};
  switch (l.kind) {
    case 'format': return FORMAT_WORD[s.format] && FORMAT_WORD[s.comparedFormat] ? `${FORMAT_WORD[s.format]} have done better than ${FORMAT_WORD[s.comparedFormat].toLowerCase()} for this brand.` : '';
    case 'platform': return s.platform && s.comparedPlatform ? `Posts on ${labelOf(s.platform)} have done better than posts on ${labelOf(s.comparedPlatform)}.` : '';
    case 'top_post': return FORMAT_ONE[s.format] ? `A recent ${FORMAT_ONE[s.format]} did far better than the brand's other posts; more like it is worth trying.` : '';
    case 'caption_length': return s.captionLength === 'short' ? 'Short captions have done better than long ones.' : s.captionLength === 'long' ? 'Longer captions that tell the full story have done better than short ones.' : '';
    case 'day': return s.day ? `Posts published on ${s.day}s have done best.` : '';
    case 'time': return TIME_WORD[s.timeOfDay] ? `Posts published in ${TIME_WORD[s.timeOfDay]} (India time) have done best.` : '';
    default: return '';
  }
}

const KEY_OF = { top_post: () => 'results-top-post' };

/** rows: AIContentPerformance rows; campaigns: Map of campaign id to campaign. */
function learnFromResults({ rows = [], campaigns = new Map(), now = new Date() } = {}) {
  const since = now.getTime() - LIMITS.RESULTS_DAYS * DAY_MS;
  const seen = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const c = r.campaignId ? campaigns.get(String(r.campaignId)) : null;
    const p = measuredPost(r, c || null);
    const t = toDate(p.publishedAt);
    if (!t || t.getTime() < since || t.getTime() > now.getTime()) continue;
    const k = `${p.platform}:${p.postId || p.id}`;
    const cur = seen.get(k);
    if (!cur || (toDate(p.measuredAt) || 0) > (toDate(cur.measuredAt) || 0)) seen.set(k, p);
  }
  const posts = [...seen.values()];
  const withNumbers = posts.filter((p) => p.engagement !== null || (Array.isArray(p.reported) && p.reported.length));
  const without = posts.length - withNumbers.length;
  const zeroNote = without > 0 ? ` ${plural(posts.length, 'post was', 'posts were')} measured, but the platforms sent no numbers for ${without} of them.` : '';

  if (!posts.length) {
    return sourceResult('none', 'None of your posts has been measured yet. Each post is measured a day, three days and a week after it goes out, then Nebulaa learns from it.', { evidenceUnit: 'posts' });
  }
  if (withNumbers.length < THRESHOLDS.minPostsForAny) {
    return sourceResult('not_enough', `Nebulaa has numbers for ${plural(withNumbers.length, 'post', 'posts')} from the last 90 days. It needs at least ${THRESHOLDS.minPostsForAny} to find a pattern.${zeroNote}`, { evidenceCount: withNumbers.length, evidenceUnit: 'posts' });
  }

  const learnings = computeLearnings({ posts: withNumbers, followers: [], range: RANGE });
  const items = learnings.map((l) => {
    const n = (l.evidence && (l.evidence.posts || l.evidence.days)) || 0;
    return makeItem({
      key: (KEY_OF[l.kind] || (() => `results-${l.id}`))(l), source: 'results', kind: l.kind,
      text: l.statement.replace(/\s*\(from [^)]*\)\.?$/, '.').replace(/\.\.$/, '.'),
      promptLine: promptLineOf(l),
      evidenceCount: n, evidenceUnit: l.evidence && l.evidence.days ? 'days' : 'posts',
      evidenceText: l.evidence && l.evidence.days ? `from ${plural(n, 'daily number', 'daily numbers')}` : `from ${plural(n, 'post', 'posts')}`,
      confidence: confidenceFrom(n, { strong: 20, good: 10 })
    });
  });
  return sourceResult('not_enough', `No clear pattern yet in ${plural(withNumbers.length, 'measured post', 'measured posts')}: the differences are still too small to call.${zeroNote}`, {
    evidenceCount: withNumbers.length, evidenceUnit: 'posts', items
  });
}

module.exports = { learnFromResults, promptLineOf, RANGE };
