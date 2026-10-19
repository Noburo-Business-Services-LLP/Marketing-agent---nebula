'use strict';
// Learnings from post performance: pure functions that turn MEASURED posts (and the account's daily numbers) into
// structured findings, each with its source and how many posts (or days) it rests on. The Performance page shows them as
// plain sentences; the Brand memory job is meant to read the same objects (it does not yet: see
// docs/superpowers/ops/performance-view.md, "Learnings for Brand memory").
//
// Rules: a finding is made only when enough posts back it (THRESHOLDS below) and the difference is large enough to be
// worth saying. Nothing is guessed: groups compare only posts that reported the figure being compared.
//
// A measured post here is the object built by services/performance/view.js (measuredPost):
//   { id, campaignId, platform, platformLabel, format, title, caption, publishedAt, weekday (0 Monday), hour (India),
//     values: { likes, comments, shares, saves, reach, impressions, views, clicks }, reported: [names], engagement }

const { FORMAT_WORD, FORMAT_ONE, labelOf, isNum } = require('./metrics');

const THRESHOLDS = {
  minPostsForAny: 5,       // no post finding at all below this many measured posts in the period
  minPerGroup: 3,          // each side of a comparison (format, platform, caption length) needs this many posts
  minPostsForTiming: 8,    // best day and best time of day need this many measured posts
  minPerDay: 2,            // a day counts as "best" only with at least this many posts on it
  minPerTimeBand: 3,       // a time of day counts only with at least this many posts in it
  minRatio: 1.25,          // a comparison is said only when one side is at least 25 percent ahead
  minLift: 1.2,            // a day or time is said only when it is at least 20 percent above the average
  topPostLift: 1.5,        // the best post is called out only at 1.5 times the average of the others
  shortCaption: 120,       // characters: short captions are under this
  maxInsights: 5
};

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Time of day in India time: [start hour, end hour), label, the hours in words.
const TIME_BANDS = [
  { key: 'morning', label: 'Morning', hours: '6 am to 12 pm', from: 6, to: 12 },
  { key: 'afternoon', label: 'Afternoon', hours: '12 pm to 5 pm', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', hours: '5 pm to 9 pm', from: 17, to: 21 },
  { key: 'night', label: 'Night', hours: '9 pm to 6 am', from: 21, to: 30 }
];
const bandOf = (hour) => {
  if (!isNum(hour)) return null;
  const h = hour < 6 ? hour + 24 : hour;
  return TIME_BANDS.find((b) => h >= b.from && h < b.to) || null;
};

const round1 = (v) => Math.round(v * 10) / 10;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The value a post gives for a metric, or null when the platform did not report it. "engagement" is the sum. */
function valueOf(post, metric) {
  if (!post) return null;
  if (metric === 'engagement') return isNum(post.engagement) ? post.engagement : null;
  return Array.isArray(post.reported) && post.reported.includes(metric) && isNum(post.values && post.values[metric]) ? post.values[metric] : null;
}
const withMetric = (posts, metric) => posts.filter((p) => valueOf(p, metric) !== null);

/** Likes when enough posts report likes, else engagement: the measure a comparison uses. */
function measureFor(posts, min) {
  return withMetric(posts, 'likes').length >= min ? 'likes' : 'engagement';
}

/** "2.1 times the likes of" or "40 percent more likes than". */
function ratioWords(ratio, metric) {
  const noun = metric === 'likes' ? 'likes' : 'engagement';
  if (ratio >= 1.5) return { text: `${round1(ratio)} times the ${noun} of` };
  return { text: `${Math.round((ratio - 1) * 100)} percent more ${noun} than` };
}

/** "2.1 times your average engagement" or "40 percent more engagement than your average". */
function liftWords(lift) {
  if (lift >= 1.5) return `${round1(lift)} times your average engagement`;
  return `${Math.round((lift - 1) * 100)} percent more engagement than your average`;
}

function bestByMetric(posts, metric) {
  return withMetric(posts, metric).sort((a, b) => valueOf(b, metric) - valueOf(a, metric))[0] || null;
}

const actionFor = (format, post, platform) => {
  const ref = post && post.title && post.title !== 'Your post' ? ` in the style of "${post.title}"` : '';
  const where = platform ? ` for ${labelOf(platform)}` : '';
  const one = FORMAT_ONE[format] || 'post';
  return {
    kind: format === 'video' ? 'video' : 'post',
    mode: format === 'carousel' ? 'carousel' : 'single',
    platform: platform || (post && post.platform) || null,
    brief: `A new ${one}${where}${ref}: the same kind of picture and caption, with a fresh angle.`.slice(0, 300)
  };
};

// ---- comparisons the page also draws -----------------------------------------------------------------------------------

/** Formats side by side: { available, reason, metric, rows: [{ format, label, posts, average }] }. */
function formatComparison(posts) {
  const list = Array.isArray(posts) ? posts : [];
  const metric = measureFor(list, THRESHOLDS.minPerGroup * 2);
  const groups = {};
  for (const p of withMetric(list, metric)) (groups[p.format] = groups[p.format] || []).push(p);
  const rows = Object.entries(groups)
    .map(([format, ps]) => ({ format, label: FORMAT_WORD[format] || format, posts: ps.length, average: round1(mean(ps.map((p) => valueOf(p, metric)))) }))
    .sort((a, b) => b.average - a.average || b.posts - a.posts);
  const enough = rows.filter((r) => r.posts >= THRESHOLDS.minPerGroup);
  const available = enough.length >= 2;
  const reason = available ? null : `Comparing formats needs at least ${THRESHOLDS.minPerGroup} measured posts in each of two formats. ${list.length ? `So far: ${rows.map((r) => `${r.label.toLowerCase()} ${r.posts}`).join(', ') || 'none with numbers'}.` : 'No post has been measured in this period yet.'}`;
  return { available, reason, metric, minPerGroup: THRESHOLDS.minPerGroup, rows };
}

/** Days of the week and times of day: { byDay, byTime } each { available, reason, metric, rows, best }. */
function timingComparison(posts) {
  const list = (Array.isArray(posts) ? posts : []).filter((p) => isNum(p.weekday) && isNum(p.hour));
  const metric = 'engagement';
  const usable = withMetric(list, metric);
  const avg = mean(usable.map((p) => valueOf(p, metric)));
  const enough = usable.length >= THRESHOLDS.minPostsForTiming;
  const why = enough ? null : `The best day and time show once at least ${THRESHOLDS.minPostsForTiming} posts in this period have numbers. So far: ${usable.length}.`;

  const dayRows = DAY_NAMES.map((label, weekday) => {
    const ps = usable.filter((p) => p.weekday === weekday);
    return { weekday, label, posts: ps.length, average: ps.length ? round1(mean(ps.map((p) => valueOf(p, metric)))) : null };
  });
  const bandRows = TIME_BANDS.map((b) => {
    const ps = usable.filter((p) => { const x = bandOf(p.hour); return x && x.key === b.key; });
    return { key: b.key, label: b.label, hours: b.hours, posts: ps.length, average: ps.length ? round1(mean(ps.map((p) => valueOf(p, metric)))) : null };
  });
  const pickBest = (rows, minPosts, lift) => {
    if (!enough || !avg) return null;
    const best = rows.filter((r) => r.posts >= minPosts && isNum(r.average)).sort((a, b) => b.average - a.average)[0];
    return best && best.average >= avg * lift ? { ...best, lift: round1(best.average / avg) } : null;
  };
  const bestDay = pickBest(dayRows, THRESHOLDS.minPerDay, THRESHOLDS.minLift);
  const bestBand = pickBest(bandRows, THRESHOLDS.minPerTimeBand, THRESHOLDS.minLift);
  const noClear = 'No day stands out yet: they are within 20 percent of your average.';
  return {
    byDay: { available: enough, reason: why || (bestDay ? null : noClear), metric, average: avg === null ? null : round1(avg), posts: usable.length, rows: dayRows, best: bestDay },
    byTime: { available: enough, reason: why || (bestBand ? null : 'No time of day stands out yet: they are within 20 percent of your average.'), metric, average: avg === null ? null : round1(avg), posts: usable.length, rows: bandRows, best: bestBand }
  };
}

// ---- the findings --------------------------------------------------------------------------------------------------------

/**
 * Structured learnings for one period. `range` is { key, words } ("this month"); `followers` is a list of
 * { platform, change, days } from the daily snapshots (optional). Returns at most THRESHOLDS.maxInsights, strongest first:
 * { id, kind, source, statement, metric, value, comparedWith, ratio, evidence: { posts | days, platform?, range }, strength,
 *   subject, action }.
 */
function computeLearnings({ posts = [], followers = [], range = { key: 'month', words: 'this month' } } = {}) {
  const list = Array.isArray(posts) ? posts : [];
  const words = range.words || 'this month';
  const out = [];
  const add = (l) => out.push({ source: 'post_performance', ...l, evidence: { range: range.key, ...l.evidence } });

  if (list.length >= THRESHOLDS.minPostsForAny) {
    // 1. Formats.
    const fc = formatComparison(list);
    const groups = fc.rows.filter((r) => r.posts >= THRESHOLDS.minPerGroup);
    if (fc.available && groups.length >= 2) {
      const hi = groups[0];
      const lo = groups[groups.length - 1];
      const ratio = lo.average > 0 ? hi.average / lo.average : null;
      if (ratio && ratio >= THRESHOLDS.minRatio) {
        const n = hi.posts + lo.posts;
        const rw = ratioWords(ratio, fc.metric);
        const best = bestByMetric(list.filter((p) => p.format === hi.format), fc.metric);
        add({
          id: `format-${hi.format}-${lo.format}`, kind: 'format', metric: fc.metric, value: hi.average, comparedWith: lo.average, ratio: round1(ratio), strength: ratio * Math.log2(n + 1),
          statement: `${hi.label} got ${rw.text} ${lo.label.toLowerCase()} ${words} (from ${plural(n, 'post', 'posts')}).`,
          evidence: { posts: n }, subject: { format: hi.format, comparedFormat: lo.format }, action: actionFor(hi.format, best, null)
        });
      }
    }

    // 2. Platforms (posts on one platform against another).
    const pMetric = measureFor(list, THRESHOLDS.minPerGroup * 2);
    const byPlatform = {};
    for (const p of withMetric(list, pMetric)) (byPlatform[p.platform] = byPlatform[p.platform] || []).push(p);
    const pRows = Object.entries(byPlatform).filter(([, ps]) => ps.length >= THRESHOLDS.minPerGroup)
      .map(([platform, ps]) => ({ platform, posts: ps.length, average: mean(ps.map((p) => valueOf(p, pMetric))) }))
      .sort((a, b) => b.average - a.average);
    if (pRows.length >= 2) {
      const hi = pRows[0];
      const lo = pRows[pRows.length - 1];
      const ratio = lo.average > 0 ? hi.average / lo.average : null;
      if (ratio && ratio >= THRESHOLDS.minRatio) {
        const n = hi.posts + lo.posts;
        const rw = ratioWords(ratio, pMetric);
        const best = bestByMetric(byPlatform[hi.platform], pMetric);
        add({
          id: `platform-${hi.platform}-${lo.platform}`, kind: 'platform', metric: pMetric, value: round1(hi.average), comparedWith: round1(lo.average), ratio: round1(ratio), strength: ratio * Math.log2(n + 1) * 0.95,
          statement: `Your ${labelOf(hi.platform)} posts got ${rw.text} your ${labelOf(lo.platform)} posts ${words} (from ${plural(n, 'post', 'posts')}).`,
          evidence: { posts: n, platform: hi.platform }, subject: { platform: hi.platform, comparedPlatform: lo.platform }, action: actionFor(best ? best.format : 'image', best, hi.platform)
        });
      }
    }

    // 3. The best post against the rest.
    const lMetric = measureFor(list, THRESHOLDS.minPostsForAny);
    const ranked = withMetric(list, lMetric).sort((a, b) => valueOf(b, lMetric) - valueOf(a, lMetric));
    if (ranked.length >= THRESHOLDS.minPostsForAny) {
      const top = ranked[0];
      const rest = mean(ranked.slice(1).map((p) => valueOf(p, lMetric)));
      const ratio = rest > 0 ? valueOf(top, lMetric) / rest : null;
      if (ratio && ratio >= THRESHOLDS.topPostLift) {
        const noun = lMetric === 'likes' ? 'likes' : 'engagement';
        add({
          id: `top-${top.id}`, kind: 'top_post', metric: lMetric, value: valueOf(top, lMetric), comparedWith: round1(rest), ratio: round1(ratio), strength: ratio * Math.log2(ranked.length + 1) * 0.9,
          statement: `"${top.title}" got the most ${noun} ${words}: ${valueOf(top, lMetric)} ${lMetric === 'likes' ? 'likes' : 'likes, comments, shares and saves together'}, ${round1(ratio)} times the average of your other posts (from ${plural(ranked.length, 'post', 'posts')}).`,
          evidence: { posts: ranked.length, platform: top.platform }, subject: { postId: top.id, campaignId: top.campaignId || null, format: top.format }, action: actionFor(top.format, top, top.platform)
        });
      }
    }

    // 4. Caption length.
    const cMetric = 'engagement';
    const withCaption = withMetric(list, cMetric).filter((p) => typeof p.caption === 'string' && p.caption.trim());
    const short = withCaption.filter((p) => p.caption.trim().length < THRESHOLDS.shortCaption);
    const long = withCaption.filter((p) => p.caption.trim().length >= THRESHOLDS.shortCaption);
    if (short.length >= THRESHOLDS.minPerGroup && long.length >= THRESHOLDS.minPerGroup) {
      const a = mean(short.map((p) => valueOf(p, cMetric)));
      const b = mean(long.map((p) => valueOf(p, cMetric)));
      const shortWins = a >= b;
      const ratio = shortWins ? (b > 0 ? a / b : null) : (a > 0 ? b / a : null);
      if (ratio && ratio >= THRESHOLDS.minRatio) {
        const n = short.length + long.length;
        const rw = ratioWords(ratio, cMetric);
        const best = bestByMetric(shortWins ? short : long, cMetric);
        add({
          id: `caption-${shortWins ? 'short' : 'long'}`, kind: 'caption_length', metric: cMetric, value: round1(shortWins ? a : b), comparedWith: round1(shortWins ? b : a), ratio: round1(ratio), strength: ratio * Math.log2(n + 1) * 0.8,
          statement: shortWins
            ? `Posts with short captions (under ${THRESHOLDS.shortCaption} characters) got ${rw.text} longer ones ${words} (from ${plural(n, 'post', 'posts')}).`
            : `Posts with longer captions (${THRESHOLDS.shortCaption} characters or more) got ${rw.text} short ones ${words} (from ${plural(n, 'post', 'posts')}).`,
          evidence: { posts: n }, subject: { captionLength: shortWins ? 'short' : 'long', limit: THRESHOLDS.shortCaption },
          action: { ...actionFor(best ? best.format : 'image', best, null), brief: `A new post with a ${shortWins ? 'short caption, under 120 characters' : 'longer caption that tells the full story'}${best && best.title !== 'Your post' ? `, like "${best.title}"` : ''}.`.slice(0, 300) }
        });
      }
    }
  }

  // 5 and 6. Best day and best time of day.
  const tc = timingComparison(list);
  if (tc.byDay.best) {
    const d = tc.byDay.best;
    const best = bestByMetric(list.filter((p) => p.weekday === d.weekday), 'engagement');
    add({
      id: `day-${d.weekday}`, kind: 'day', metric: 'engagement', value: d.average, comparedWith: tc.byDay.average, ratio: d.lift, strength: d.lift * Math.log2(tc.byDay.posts + 1) * 0.85,
      statement: `Posts published on a ${d.label} got ${liftWords(d.lift)} ${words} (${plural(d.posts, 'post', 'posts')} on ${d.label}s, from ${plural(tc.byDay.posts, 'post', 'posts')}).`,
      evidence: { posts: tc.byDay.posts, onThisDay: d.posts }, subject: { weekday: d.weekday, day: d.label }, action: actionFor(best ? best.format : 'image', best, null)
    });
  }
  if (tc.byTime.best) {
    const b = tc.byTime.best;
    const best = bestByMetric(list.filter((p) => { const x = bandOf(p.hour); return x && x.key === b.key; }), 'engagement');
    add({
      id: `time-${b.key}`, kind: 'time', metric: 'engagement', value: b.average, comparedWith: tc.byTime.average, ratio: b.lift, strength: b.lift * Math.log2(tc.byTime.posts + 1) * 0.85,
      statement: `Posts published in the ${b.label.toLowerCase()} (${b.hours}, India time) got ${liftWords(b.lift)} ${words} (${plural(b.posts, 'post', 'posts')} then, from ${plural(tc.byTime.posts, 'post', 'posts')}).`,
      evidence: { posts: tc.byTime.posts, inThisBand: b.posts }, subject: { timeOfDay: b.key, hours: b.hours }, action: actionFor(best ? best.format : 'image', best, null)
    });
  }

  // 7. Followers gained (daily account numbers).
  for (const f of Array.isArray(followers) ? followers : []) {
    if (!f || !isNum(f.change) || f.change <= 0 || !isNum(f.days) || f.days < 2) continue;
    out.push({
      id: `followers-${f.platform}`, kind: 'followers', source: 'account_snapshots', metric: 'followers', value: f.change, comparedWith: isNum(f.previousChange) ? f.previousChange : null, ratio: null,
      strength: Math.log2(f.days + 1) * 0.6,
      statement: `${labelOf(f.platform)} gained ${plural(f.change, 'follower', 'followers')} ${words} (from ${plural(f.days, 'daily number', 'daily numbers')}).`,
      evidence: { days: f.days, platform: f.platform, range: range.key }, subject: { platform: f.platform }, action: null
    });
  }

  return out.sort((a, b) => b.strength - a.strength).slice(0, THRESHOLDS.maxInsights).map((l) => ({ ...l, strength: round1(l.strength) }));
}

/** The best post for each measure (engagement, likes, comments, reach) with the average of the others: plain facts. */
function topPostFacts(posts = [], range = { key: 'month' }) {
  const list = Array.isArray(posts) ? posts : [];
  const facts = [];
  for (const metric of ['engagement', 'likes', 'comments', 'reach']) {
    const ranked = withMetric(list, metric).filter((p) => valueOf(p, metric) > 0).sort((a, b) => valueOf(b, metric) - valueOf(a, metric));
    if (!ranked.length) continue;
    const top = ranked[0];
    const rest = ranked.length > 1 ? round1(mean(ranked.slice(1).map((p) => valueOf(p, metric)))) : null;
    facts.push({
      id: `top-${metric}-${top.id}`, kind: 'top_post_fact', source: 'post_performance', metric, value: valueOf(top, metric), averageOfOthers: rest,
      post: { id: top.id, campaignId: top.campaignId || null, platform: top.platform, format: top.format, title: top.title, publishedAt: top.publishedAt },
      evidence: { posts: ranked.length, range: range.key }
    });
  }
  return facts;
}

const TONES = { format: 'gold', platform: 'lilac', top_post: 'coral', caption_length: 'teal', day: 'teal', time: 'gold', followers: 'lilac' };
/** The sentences the page shows: { id, kind, tone, text, evidence, action }. */
function insightsFromLearnings(learnings = []) {
  return (Array.isArray(learnings) ? learnings : []).map((l) => ({
    id: l.id, kind: l.kind, tone: TONES[l.kind] || 'gold', text: l.statement, source: l.source, evidence: l.evidence, action: l.action || null
  }));
}

module.exports = { THRESHOLDS, DAY_NAMES, TIME_BANDS, bandOf, valueOf, formatComparison, timingComparison, computeLearnings, topPostFacts, insightsFromLearnings };
