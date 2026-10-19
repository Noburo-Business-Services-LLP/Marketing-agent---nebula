'use strict';
// GET /api/analytics/performance: the Performance page in one answer, assembled from rows already read (pure: no
// database, no clock of its own). Inputs come from services/performance/service.js. Every figure is either a stored
// number or { available: false, reason } with a plain sentence; nothing is invented. See docs/superpowers/ops/performance-view.md.
const M = require('./metrics');
const L = require('./learnings');

const { isNum, DAY_MS } = M;
const TOP_N = 3;
const REASONS = {
  connectFree: 'Connecting accounts comes with a paid plan.',
  connect: 'Connect an account to see this.',
  soon: 'Your first numbers arrive within a day of connecting.',
  notReported: 'Your connected accounts have not reported this yet.',
  failed: 'We could not load this just now. Please try again in a moment.'
};

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const tms = (d) => { const t = d ? new Date(d).getTime() : NaN; return Number.isFinite(t) ? t : null; };
function changePct(value, previous) {
  if (!isNum(value) || !isNum(previous) || previous <= 0) return null;
  const pct = round1(((value - previous) / previous) * 100);
  return Object.is(pct, -0) ? 0 : pct;
}
const yes = (value, extra = {}) => ({ value, previous: null, change: null, changePct: null, available: true, reason: null, ...extra });
const no = (reason, extra = {}) => ({ value: null, previous: null, change: null, changePct: null, available: false, reason, ...extra });
function compared(value, previous, unit = 'count', extra = {}) {
  const prev = isNum(previous) ? previous : null;
  return yes(value, { previous: prev, change: prev === null ? null : round2(value - prev), changePct: changePct(value, prev), unit, ...extra });
}

/** One measured post, as learnings.js and the gallery use it. */
function measuredPost(row, campaign) {
  const m = M.postMetricsOf(row);
  const publishedAt = (campaign && campaign.publishedAt) || row.publishedAt || null;
  const wh = M.istWeekdayHour(publishedAt);
  const platform = M.normPlatform(row.platform);
  return {
    id: String(row._id), campaignId: campaign ? String(campaign._id) : (row.campaignId ? String(row.campaignId) : null), postId: row.postId || null,
    platform, platformLabel: M.labelOf(platform), format: M.formatOf(campaign, row), title: M.titleOf(campaign, row), caption: M.captionOf(campaign, row),
    thumbnail: M.thumbOf(campaign, row), url: M.postUrlOf(row, campaign),
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null, date: M.istDate(publishedAt),
    weekday: wh ? wh.weekday : null, hour: wh ? wh.hour : null,
    values: m.values, reported: m.reported, engagement: m.engagement,
    measuredAt: row.measuredAt ? new Date(row.measuredAt).toISOString() : null
  };
}

/** Each post once per platform: the newest measurement wins (rows are unique per post and platform, but be safe). */
function dedupe(posts) {
  const seen = new Map();
  for (const p of posts) {
    const k = `${p.platform}:${p.postId || p.id}`;
    const cur = seen.get(k);
    if (!cur || (tms(p.measuredAt) || 0) > (tms(cur.measuredAt) || 0)) seen.set(k, p);
  }
  return [...seen.values()];
}

const inWindow = (t, from, to) => t !== null && t >= from && t <= to;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Sum of one post metric over posts that reported it, or null when none did. */
function sumMetric(posts, metric) {
  const vals = posts.map((p) => L.valueOf(p, metric)).filter((v) => v !== null);
  return vals.length ? { total: sum(vals), posts: vals.length } : null;
}

// ---- snapshots ----------------------------------------------------------------------------------------------------------
function snapshotsFor(snapshots, platform) {
  return snapshots.map((s) => ({ t: tms(s.date), m: M.platformsOfSnapshot(s)[platform] })).filter((x) => x.t !== null && x.m && typeof x.m === 'object');
}
/** Newest point inside [from, to] and the newest at or before the start (within one more period, half a day of slack). */
function endsOf(points, w) {
  const from = w.from.getTime();
  const to = w.to.getTime();
  const inside = points.filter((p) => p.t >= from - DAY_MS / 2 && p.t <= to);
  const latest = inside.length ? inside[inside.length - 1] : null;
  const before = points.filter((p) => p.t <= from + DAY_MS / 2 && p.t >= w.previousFrom.getTime() && (!latest || p.t < latest.t));
  return { latest, base: before.length ? before[before.length - 1] : null, inside };
}

/**
 * The page answer. Input:
 *   now, range (key), platform (filter or ''), account { free, canConnect, clientWorkspace, staff }, connected (list of platform keys),
 *   snapshots (oldest first, from previousFrom), rows (measured posts, newest first), campaigns (by id: Map or object),
 *   published (posted campaigns in both periods: { platforms, publishedAt }), publishedCapped, rowsCapped, degraded (names)
 */
function buildPerformanceView(input) {
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const w = M.rangeWindow(M.rangeKey(input.range), now);
  const words = M.RANGE_WORDS[w.key];
  const filter = input.platform ? M.normPlatform(input.platform) : '';
  const account = input.account || {};
  const degraded = Array.isArray(input.degraded) ? input.degraded : [];
  const failed = (name) => degraded.includes(name);
  const connected = [...new Set((input.connected || []).map(M.normPlatform).filter(Boolean))];
  const noConnection = account.canConnect === false ? REASONS.connectFree : REASONS.connect;
  const snapshots = (Array.isArray(input.snapshots) ? input.snapshots : []).slice().sort((a, b) => (tms(a.date) || 0) - (tms(b.date) || 0));
  const camp = (id) => { if (!id) return null; const c = input.campaigns; return c instanceof Map ? c.get(String(id)) || null : (c && c[String(id)]) || null; };

  // Measured posts in both periods.
  const all = dedupe((Array.isArray(input.rows) ? input.rows : []).map((r) => measuredPost(r, camp(r.campaignId))));
  const from = w.from.getTime(); const to = w.to.getTime(); const pFrom = w.previousFrom.getTime();
  const cur = all.filter((p) => inWindow(tms(p.publishedAt), from, to));
  const prev = all.filter((p) => { const t = tms(p.publishedAt); return t !== null && t >= pFrom && t < from; });
  const onPlatform = (list, p) => (p ? list.filter((x) => x.platform === p) : list);

  // Published posts (Nebulaa's own posts, status posted).
  const pub = (Array.isArray(input.published) ? input.published : []).map((c) => ({ t: tms(c.publishedAt), platforms: (c.platforms || []).map(M.normPlatform) }));
  const pubCount = (p, a, b) => pub.filter((c) => c.t !== null && c.t >= a && c.t <= b && (!p || c.platforms.includes(p))).length;

  // ---- platforms ----
  const seen = new Set([...M.CORE_PLATFORMS, ...connected]);
  for (const s of snapshots) for (const k of Object.keys(M.platformsOfSnapshot(s))) if (connected.includes(M.normPlatform(k))) seen.add(M.normPlatform(k));
  for (const p of cur) if (p.platform) seen.add(p.platform);
  const order = (p) => { const i = M.PLATFORM_ORDER.indexOf(p); return i === -1 ? 99 : i; };
  const platformKeys = [...seen].filter(M.isKnownPlatform).sort((a, b) => order(a) - order(b));

  const followerFacts = [];
  const platforms = platformKeys.map((p) => {
    const label = M.labelOf(p);
    const isConnected = connected.includes(p);
    const curP = onPlatform(cur, p);
    const prevP = onPlatform(prev, p);
    const posts = failed('posts') ? no(REASONS.failed) : compared(pubCount(p, from, to), pubCount(p, pFrom, from - 1), 'count', input.publishedCapped ? { capped: true } : {});
    const base = { platform: p, label, connected: isConnected, postsMeasured: curP.length };
    if (!isConnected) {
      const reason = connected.length === 0 && account.canConnect === false ? REASONS.connectFree : `Connect ${label} to see its numbers here.`;
      return { ...base, state: 'notconnected', reason, asOf: null, metrics: {}, spark: {}, posts };
    }
    if (failed('snapshots')) {
      return { ...base, state: 'error', reason: REASONS.failed, asOf: null, metrics: { posts }, spark: {}, posts };
    }
    const pts = snapshotsFor(snapshots, p);
    const { latest, base: start, inside } = endsOf(pts, w);
    const gap = M.SNAPSHOT_GAPS[p] || {};
    const metrics = {};
    const spark = {};
    let state = 'ready';
    let reason = null;
    const last = pts.length ? pts[pts.length - 1] : null;
    if (!latest) {
      state = 'nodata';
      reason = last ? `No new numbers from ${label} in this period. The last ones arrived on ${M.istDate(last.t)}.` : REASONS.soon;
    }
    const account1 = (key, opts = {}) => {
      if (gap[key]) return no(gap[key]);
      if (!latest) return no(reason);
      const v = latest.m[key];
      const ok = isNum(v) && (opts.zeroOk ? v >= 0 : v > 0);
      if (!ok) return no(`${label} has not reported this yet.`);
      const pv = start && isNum(start.m[key]) && (opts.zeroOk ? start.m[key] >= 0 : start.m[key] > 0) ? start.m[key] : null;
      return compared(opts.round ? round2(v) : v, pv === null ? null : (opts.round ? round2(pv) : pv), opts.unit || 'count', { asOf: M.istDate(latest.t) });
    };
    metrics.followers = account1('followers', { zeroOk: true });
    metrics.reach = account1('reach');
    metrics.engagementRate = account1('engagementRate', { unit: 'percent', round: true });
    for (const key of ['followers', 'reach', 'engagementRate']) {
      if (!metrics[key].available) continue;
      const series = inside.map((x) => x.m[key]).filter((v) => isNum(v) && (key === 'followers' ? v >= 0 : v > 0));
      if (series.length >= 2) spark[key] = series.map((v) => (key === 'engagementRate' ? round2(v) : v));
    }
    if (metrics.followers.available && isNum(metrics.followers.change)) followerFacts.push({ platform: p, change: metrics.followers.change, days: inside.length });
    // Likes, comments and shares come from the measured posts on this platform.
    for (const key of ['likes', 'comments', 'shares']) {
      if (failed('measured')) { metrics[key] = no(REASONS.failed); continue; }
      const c = sumMetric(curP, key);
      if (!c) {
        metrics[key] = no(curP.length
          ? `${label} did not report ${key} for these posts.`
          : (posts.available && posts.value > 0 ? `Your ${label} posts from this period have not been measured yet.` : `No ${label} post was measured in this period.`));
        continue;
      }
      const pc = sumMetric(prevP, key);
      metrics[key] = compared(c.total, pc ? pc.total : null, 'count', { posts: c.posts });
    }
    metrics.posts = posts;
    if (state === 'ready' && !Object.values(metrics).some((x) => x.available && x !== posts)) { state = 'nodata'; reason = reason || `${label} has not reported numbers yet.`; }
    return { ...base, state, reason, asOf: latest ? M.istDate(latest.t) : null, metrics, spark, posts };
  });

  // ---- overall (the KPI tiles), for the chosen platform or all connected ones ----
  const scope = filter ? platforms.filter((x) => x.platform === filter) : platforms.filter((x) => x.connected);
  const overall = {};
  const sumScope = (key) => {
    const ok = scope.filter((x) => x.metrics[key] && x.metrics[key].available);
    if (!ok.length) return null;
    const value = sum(ok.map((x) => x.metrics[key].value));
    const withPrev = ok.filter((x) => isNum(x.metrics[key].previous));
    const previous = withPrev.length === ok.length ? sum(withPrev.map((x) => x.metrics[key].previous)) : null;
    return { value, previous, asOf: ok.map((x) => x.metrics[key].asOf).filter(Boolean).sort().pop() || null };
  };
  const scopeReason = () => {
    if (failed('snapshots')) return REASONS.failed;
    if (filter) { const x = scope[0]; return x ? (x.state === 'notconnected' ? x.reason : x.reason || REASONS.notReported) : REASONS.notReported; }
    if (!connected.length) return noConnection;
    return scope.some((x) => x.state === 'ready') ? REASONS.notReported : (scope.find((x) => x.reason) || {}).reason || REASONS.soon;
  };
  const f = sumScope('followers');
  overall.followers = f ? compared(f.value, f.previous, 'count', { asOf: f.asOf }) : no(scopeReason());
  const r = sumScope('reach');
  overall.reach = r ? compared(r.value, r.previous, 'count', { asOf: r.asOf }) : no(scopeReason());
  const rates = scope.filter((x) => x.metrics.engagementRate && x.metrics.engagementRate.available);
  if (rates.length) {
    const v = round2(sum(rates.map((x) => x.metrics.engagementRate.value)) / rates.length);
    const pv = rates.every((x) => isNum(x.metrics.engagementRate.previous)) ? round2(sum(rates.map((x) => x.metrics.engagementRate.previous)) / rates.length) : null;
    overall.engagementRate = compared(v, pv, 'percent');
  } else overall.engagementRate = no(scopeReason());
  const curScope = onPlatform(cur, filter);
  const prevScope = onPlatform(prev, filter);
  const likes = sumMetric(curScope, 'likes');
  const likesPrev = sumMetric(prevScope, 'likes');
  overall.likes = failed('measured') ? no(REASONS.failed)
    : likes ? compared(likes.total, likesPrev ? likesPrev.total : null, 'count', { posts: likes.posts })
      : no(curScope.length ? 'These posts did not report likes.' : 'Likes show once your posts from this period are measured.');
  overall.posts = failed('posts') ? no(REASONS.failed) : compared(pubCount(filter, from, to), pubCount(filter, pFrom, from - 1), 'count', input.publishedCapped ? { capped: true } : {});
  overall.postsMeasured = yes(curScope.length, { unit: 'count' });
  // Lines for the KPI tiles: the sum over the scope on each stored day (a day counts only when every platform reported).
  const daySeries = (key) => {
    if (!scope.length) return null;
    const byDay = new Map();
    for (const x of scope) {
      if (!x.metrics[key] || !x.metrics[key].available) continue;
      for (const s of snapshots) {
        const t = tms(s.date);
        if (t === null || t < from - DAY_MS / 2 || t > to) continue;
        const v = (M.platformsOfSnapshot(s)[x.platform] || {})[key];
        if (!isNum(v) || (key !== 'followers' && v <= 0)) continue;
        const e = byDay.get(t) || { n: 0, v: 0 };
        e.n += 1; e.v += v; byDay.set(t, e);
      }
    }
    const need = scope.filter((x) => x.metrics[key] && x.metrics[key].available).length;
    const pts = [...byDay.entries()].sort((a, b) => a[0] - b[0]).filter(([, e]) => e.n === need).map(([, e]) => (key === 'engagementRate' ? round2(e.v / e.n) : e.v));
    return pts.length >= 2 ? pts : null;
  };
  const buckets = w.key === 'week' ? 7 : w.key === 'month' ? 6 : 13;
  const size = (to - from) / buckets;
  const postBuckets = failed('posts') ? null : [...Array(buckets)].map((_, i) => pubCount(filter, from + i * size, from + (i + 1) * size - 1));
  overall.spark = { followers: daySeries('followers'), reach: daySeries('reach'), engagementRate: daySeries('engagementRate'), posts: postBuckets && postBuckets.some((n) => n > 0) ? postBuckets : null };

  // ---- top posts ----
  const measuredReason = () => {
    if (failed('measured')) return REASONS.failed;
    if (overall.posts.available && overall.posts.value > 0) return 'Your posts from this period have not been measured yet. Each post is measured 1, 3 and 7 days after it goes out.';
    return filter ? `Nothing was published on ${M.labelOf(filter)} in this period.` : 'Nothing was published in this period.';
  };
  const card = (p, metric) => ({
    id: p.id, campaignId: p.campaignId, platform: p.platform, platformLabel: p.platformLabel, title: p.title, thumbnail: p.thumbnail, url: p.url,
    publishedAt: p.publishedAt, date: p.date, format: p.format, metric, value: L.valueOf(p, metric),
    metrics: Object.fromEntries([...p.reported.map((k) => [k, p.values[k]]), ...(isNum(p.engagement) ? [['engagement', p.engagement]] : [])])
  });
  const topPosts = { measured: curScope.length, reason: curScope.length ? null : measuredReason(), lists: {} };
  for (const metric of ['engagement', 'likes', 'comments', 'reach']) {
    const ranked = curScope.filter((p) => { const v = L.valueOf(p, metric); return v !== null && v > 0; })
      .sort((a, b) => L.valueOf(b, metric) - L.valueOf(a, metric) || (metric === 'comments' ? (L.valueOf(b, 'shares') || 0) - (L.valueOf(a, 'shares') || 0) : 0) || (tms(b.publishedAt) || 0) - (tms(a.publishedAt) || 0));
    topPosts.lists[metric] = {
      posts: ranked.slice(0, TOP_N).map((p) => card(p, metric)),
      reason: ranked.length ? null : (curScope.length ? `None of the measured posts reported ${metric === 'engagement' ? 'likes, comments or shares' : metric} in this period.` : topPosts.reason)
    };
  }

  // ---- what works ----
  const byFormat = curScope.length ? L.formatComparison(curScope) : { available: false, reason: measuredReason(), metric: 'likes', minPerGroup: L.THRESHOLDS.minPerGroup, rows: [] };
  const timing = L.timingComparison(curScope);
  if (!curScope.length) { timing.byDay.reason = measuredReason(); timing.byTime.reason = measuredReason(); }
  const learnings = L.computeLearnings({ posts: curScope, followers: filter ? followerFacts.filter((x) => x.platform === filter) : followerFacts, range: { key: w.key, words } });
  const insights = L.insightsFromLearnings(learnings);
  const insightsReason = insights.length ? null
    : curScope.length < L.THRESHOLDS.minPostsForAny
      ? `Findings show once at least ${L.THRESHOLDS.minPostsForAny} posts from this period have been measured. So far: ${curScope.length}.`
      : 'Nothing stands out clearly yet. Your posts in this period performed about the same.';

  return {
    range: { key: w.key, days: w.days, from: w.from.toISOString(), to: w.to.toISOString(), previousFrom: w.previousFrom.toISOString(), words },
    platform: filter || null,
    account: { free: Boolean(account.free), canConnect: account.canConnect !== false, clientWorkspace: Boolean(account.clientWorkspace), staff: Boolean(account.staff) },
    connected: { count: Math.max(connected.length, Number(input.connectedCount) || 0), platforms: connected },
    overall, platforms, topPosts, byFormat, byDay: timing.byDay, byTime: timing.byTime,
    insights, insightsReason, thresholds: L.THRESHOLDS,
    capped: { posts: Boolean(input.publishedCapped), measured: Boolean(input.rowsCapped) },
    degraded
  };
}

module.exports = { buildPerformanceView, measuredPost, changePct, REASONS, TOP_N };
