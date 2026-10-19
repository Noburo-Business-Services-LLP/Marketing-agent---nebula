'use strict';
/**
 * What the memory learns from the competitors the account tracks. PURE.
 * Only the weekly snapshots the tracker already stored are read (post type, time, likes, comments, posts in the week).
 * Never a competitor's name, handle, caption, picture or hashtag: every sentence talks about "the competitors you
 * track" and a count, so nothing here can carry a competitor into a prompt.
 */
const { mergePosts } = require('../competitors/bestPosts');
const { trackedCompetitors } = require('../competitors/tracked');
const { plural, makeItem, sourceResult, confidenceFrom, toDate, isNum, LIMITS } = require('./common');

const MIN_COMPETITORS = 2;
const MIN_POSTS = 10;
const MIN_GROUP = 3;
const MIN_RATIO = 1.25;
const MIN_WEEKS_EACH = 2;
const DAY_MS = 864e5;
const PLURAL = { video: 'reels', image: 'photo posts', carousel: 'carousels' };
const CAP = { video: 'Reels', image: 'Photo posts', carousel: 'Carousels' };

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (v) => Math.round(v * 10) / 10;
const ratioWords = (r) => (r >= 1.5 ? `${round1(r)} times the likes of` : `${Math.round((r - 1) * 100)} percent more likes than`);
const istDay = (d) => new Date(d.getTime() + 330 * 60000).getUTCDay();

function learnFromCompetitors({ entitled = true, competitors = [], snapshots = [], now = new Date() } = {}) {
  if (!entitled) return sourceResult('not_on_plan', 'Learning from competitors comes with the competitor add-on.');
  const tracked = trackedCompetitors(competitors);
  if (!tracked.length) return sourceResult('none', 'Add the competitors you watch, and Nebulaa learns from their best posts each week.');

  const ids = new Set(tracked.map((c) => String(c._id)));
  const since = now.getTime() - LIMITS.COMPETITOR_WEEKS * 7 * DAY_MS;
  const byCompetitor = new Map();
  for (const s of Array.isArray(snapshots) ? snapshots : []) {
    if (!s || s.ok === false || !ids.has(String(s.competitorId))) continue;
    const t = toDate(s.takenAt);
    if (t && t.getTime() < since) continue;
    const list = byCompetitor.get(String(s.competitorId)) || [];
    list.push(s);
    byCompetitor.set(String(s.competitorId), list);
  }
  if (!byCompetitor.size) {
    return sourceResult('not_enough', `Nebulaa has not read your ${plural(tracked.length, 'competitor', 'competitors')} yet. Their posts are read once a week.`, { evidenceUnit: 'posts' });
  }

  // Posts of every competitor, each post once, inside the window, likes known.
  const posts = [];
  let withPosts = 0;
  for (const list of byCompetitor.values()) {
    const ordered = list.slice().sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)));
    const mine = mergePosts(ordered).filter((p) => p.at.getTime() >= since && p.at.getTime() <= now.getTime() && isNum(p.likes));
    if (mine.length) withPosts += 1;
    posts.push(...mine);
  }

  const items = [];
  if (withPosts >= MIN_COMPETITORS && posts.length >= MIN_POSTS) {
    const who = `the ${plural(withPosts, 'competitor', 'competitors')} you track`;
    // Format: the best type against the rest.
    const byType = {};
    for (const p of posts) if (PLURAL[p.type]) (byType[p.type] = byType[p.type] || []).push(p);
    const groups = Object.entries(byType).filter(([, xs]) => xs.length >= MIN_GROUP).sort((a, b) => mean(b[1].map((p) => p.likes)) - mean(a[1].map((p) => p.likes)));
    if (groups.length >= 2) {
      const [hiType, hi] = groups[0];
      const [loType, lo] = groups[groups.length - 1];
      const a = mean(hi.map((p) => p.likes));
      const b = mean(lo.map((p) => p.likes));
      if (b >= 1 && a / b >= MIN_RATIO) {
        const n = hi.length + lo.length;
        items.push(makeItem({
          key: `competitors-format-${hiType}-${loType}`, source: 'competitors', kind: 'format',
          text: `Across ${who}, ${PLURAL[hiType]} got ${ratioWords(a / b)} ${PLURAL[loType]} in the last eight weeks.`,
          promptLine: `In this market, ${PLURAL[hiType]} are getting more likes than ${PLURAL[loType]}.`,
          evidenceCount: n, evidenceUnit: 'posts', evidenceText: `from ${plural(n, 'competitor post', 'competitor posts')}`,
          confidence: confidenceFrom(n, { strong: 30, good: 15 })
        }));
      }
    }
    // Weekend (India Saturday and Sunday) against weekdays, either way round.
    const weekend = posts.filter((p) => [0, 6].includes(istDay(p.at)));
    const weekday = posts.filter((p) => ![0, 6].includes(istDay(p.at)));
    if (weekend.length >= MIN_GROUP && weekday.length >= MIN_GROUP) {
      const a = mean(weekend.map((p) => p.likes));
      const b = mean(weekday.map((p) => p.likes));
      const weekendWins = a >= b;
      const r = weekendWins ? (b >= 1 ? a / b : 0) : (a >= 1 ? b / a : 0);
      if (r >= MIN_RATIO) {
        const n = weekend.length + weekday.length;
        items.push(makeItem({
          key: `competitors-day-${weekendWins ? 'weekend' : 'weekday'}`, source: 'competitors', kind: 'day',
          text: `Across ${who}, ${weekendWins ? 'weekend' : 'weekday'} posts got ${ratioWords(r)} ${weekendWins ? 'weekday' : 'weekend'} posts.`,
          promptLine: `In this market, ${weekendWins ? 'weekend' : 'weekday'} posts are getting more likes.`,
          evidenceCount: n, evidenceUnit: 'posts', evidenceText: `from ${plural(n, 'competitor post', 'competitor posts')}`,
          confidence: confidenceFrom(n, { strong: 30, good: 15 })
        }));
      }
    }
  }

  // Posting rhythm: competitors with two or more weekly readings.
  const weekly = [];
  for (const list of byCompetitor.values()) {
    const counts = list.filter((s) => isNum(s.postsInWindow) && !s.postsInWindowMayBeTruncated).map((s) => s.postsInWindow);
    if (counts.length >= MIN_WEEKS_EACH) weekly.push({ avg: mean(counts), weeks: counts.length });
  }
  if (weekly.length >= MIN_COMPETITORS) {
    const avg = mean(weekly.map((w) => w.avg));
    const weeks = weekly.reduce((n, w) => n + w.weeks, 0);
    const per = avg < 1 ? 'less than once a week' : `about ${plural(Math.round(avg), 'time', 'times')} a week`;
    items.push(makeItem({
      key: 'competitors-rhythm', source: 'competitors', kind: 'rhythm',
      text: `The ${plural(weekly.length, 'competitor', 'competitors')} you track post ${per} on Instagram.`,
      promptLine: '',
      evidenceCount: weeks, evidenceUnit: 'weeks', evidenceText: `from ${plural(weeks, 'weekly reading', 'weekly readings')}`,
      confidence: confidenceFrom(weeks, { strong: 12, good: 6 })
    }));
  }

  const reason = posts.length < MIN_POSTS || withPosts < MIN_COMPETITORS
    ? `Nebulaa has read ${plural(posts.length, 'post', 'posts')} with likes from ${plural(withPosts, 'competitor', 'competitors')}. It needs at least ${MIN_POSTS}, from two or more competitors, to find a pattern.`
    : `No clear pattern yet in ${plural(posts.length, 'competitor post', 'competitor posts')}: the differences are still too small to call.`;
  return sourceResult('not_enough', reason, { evidenceCount: posts.length, evidenceUnit: 'posts', items });
}

module.exports = { learnFromCompetitors, MIN_COMPETITORS, MIN_POSTS, MIN_GROUP, MIN_RATIO };
