'use strict';
/**
 * The numbers of the demo brand: what each published post earned (the rows the Performance view and Brand memory read,
 * `ai_content_performance`) and the daily follower and reach snapshots (`SocialSnapshot`) for every connected platform.
 *
 * The numbers are written in the PUBLISHING SERVICE'S OWN shape (rawAnalytics.<platform>.analytics.likeCount ...), and the
 * `metrics` object is worked out by the app's own services/performance/metrics.js metricsFromRaw, so the two can never
 * disagree and the Performance page reads them exactly like a real account's. Nothing is random between runs: every
 * number comes from a seeded generator keyed on the post.
 *
 * The story the numbers tell (so the Performance page has findings): followers grew from about half to the current
 * count over 180 days; reels do about 2.5 times the likes of image posts, carousels about 1.2 times and get saved more;
 * Fridays and Sundays and the evening hours do best.
 */
const { SOCIALS } = require('./constants');
const { seeded } = require('./images');
const { metricsFromRaw, istWeekdayHour } = require('../../services/performance/metrics');

const DAY = 86400000;
const WINDOW_DAYS = 180;

const finalOf = (platform) => {
  const s = SOCIALS.find((x) => x.platform === platform);
  const a = (s && s.analytics) || {};
  const followers = a.followersCount || (a.followers && a.followers.totalFollowerCount) || 0;
  return { followers, a };
};

/** Followers of a platform `daysAgo` days ago: about half of today's count 180 days ago, growing faster at first. */
function followersOn(platform, daysAgo) {
  const { followers } = finalOf(platform);
  const t = Math.min(1, Math.max(0, (WINDOW_DAYS - daysAgo) / WINDOW_DAYS));
  return Math.round(followers * (0.5 + 0.5 * (t ** 0.8)));
}

const DAY_MULT = [0.85, 0.9, 0.9, 1.0, 1.35, 1.1, 1.3]; // Monday .. Sunday
const FORMAT_MULT = { image: 1, carousel: 1.2, reel: 2.5 };
const hourMult = (h) => (h >= 18 ? 1.25 : h >= 12 ? 1.0 : 0.85);
const int = (v) => Math.max(0, Math.round(v));

/**
 * The platform answer for one published post: { instagram: { analytics: { likeCount, ... } }, facebook: {...} }.
 * `post`: { key, format, platforms, publishedAt (Date) }.
 */
function numbersFor(post, now = new Date()) {
  const r = seeded(`zaya-numbers-${post.key}`);
  const wh = istWeekdayHour(post.publishedAt) || { weekday: 0, hour: 12 };
  const daysAgo = Math.max(0, (now.getTime() - post.publishedAt.getTime()) / DAY);
  const fmt = FORMAT_MULT[post.format] || 1;
  const noise = 0.82 + r() * 0.4 + (r() > 0.94 ? 0.7 : 0); // an occasional standout
  const lift = DAY_MULT[wh.weekday] * hourMult(wh.hour) * noise;
  const out = {};
  for (const p of post.platforms) {
    const f = followersOn(p, daysAgo);
    if (p === 'instagram') {
      const reach = int(f * 0.17 * fmt * lift);
      const likes = int(reach * (0.05 + r() * 0.02));
      out.instagram = { analytics: {
        reachCount: reach, impressionCount: int(reach * 1.25), likeCount: likes, commentsCount: int(likes * (0.035 + r() * 0.02)),
        savedCount: int(likes * (post.format === 'carousel' ? 0.34 : post.format === 'reel' ? 0.16 : 0.1)),
        sharesCount: int(likes * (post.format === 'reel' ? 0.11 : 0.04)), ...(post.format === 'reel' ? { viewsCount: int(reach * 1.6) } : {})
      } };
    } else if (p === 'facebook') {
      const reach = int(f * 0.13 * (post.format === 'reel' ? 1.8 : 1) * lift);
      const likes = int(reach * (0.038 + r() * 0.014));
      out.facebook = { analytics: { reachCount: reach, impressionCount: int(reach * 1.3), likeCount: likes, commentsCount: int(likes * 0.05), sharesCount: int(likes * 0.07) } };
    } else if (p === 'youtube') {
      const views = int(f * 0.55 * lift * (0.8 + r() * 0.5));
      const likes = int(views * 0.045);
      out.youtube = { analytics: { viewsCount: views, reachCount: views, likeCount: likes, commentsCount: int(likes * 0.04), sharesCount: int(likes * 0.05) } };
    } else if (p === 'linkedin') {
      const imp = int(f * 1.4 * (0.8 + r() * 0.5));
      const likes = int(imp * 0.026);
      out.linkedin = { analytics: { impressionCount: imp, reachCount: int(imp * 0.8), likeCount: likes, commentsCount: int(likes * 0.08), sharesCount: int(likes * 0.1) } };
    }
  }
  return out;
}

/** Sum over platforms of one post's figures, for the Campaign's own `performance` object. */
function totalsOf(numbers) {
  const t = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, engagement: 0 };
  for (const node of Object.values(numbers)) {
    const a = node.analytics;
    t.impressions += a.impressionCount || a.viewsCount || 0; t.reach += a.reachCount || 0;
    t.likes += a.likeCount || 0; t.comments += a.commentsCount || 0; t.shares += a.sharesCount || 0;
  }
  t.engagement = t.likes + t.comments + t.shares;
  return t;
}

/**
 * The `ai_content_performance` rows (pure). `items`: posted items with { key, id (draft key), campaignId, productId, productName,
 * format, platforms, publishedAt, caption, hashtags, cta, tone, postId, thumbnail, numbers }.
 * One row per post and platform. Learning tier by rank of the engagement rate (top 10 percent winners).
 */
function performanceRows({ userId, items, now }) {
  const rows = [];
  for (const it of items) {
    for (const platform of Object.keys(it.numbers)) {
      const raw = { [platform]: it.numbers[platform] };
      const measuredAt = new Date(Math.min(it.publishedAt.getTime() + 7 * DAY, now.getTime() - 3600 * 1000));
      rows.push({
        organizationId: String(userId), userId, campaignId: it.campaignId, platform, postId: it.postId[platform],
        contentType: it.format === 'reel' ? 'reel' : it.format === 'carousel' ? 'carousel' : 'post',
        caption: it.caption, hashtags: it.hashtags.map((h) => h.replace(/^#/, '')), cta: it.cta, tone: it.tone, language: 'English',
        inventoryReferences: it.productId ? [{ productId: it.productId, name: it.productName, category: it.category, tags: [] }] : [],
        assets: { images: [it.thumbnail], videos: [], thumbnails: [it.thumbnail] },
        metrics: metricsFromRaw(raw, platform), rawAnalytics: raw, publishedAt: it.publishedAt, measuredAt,
        learning: { score: 0, tier: 'unknown', winningHashtags: [], winningTone: '', winningCTA: '', winningSceneStyles: [], notes: [], learnedAt: measuredAt },
        createdAt: it.publishedAt, updatedAt: measuredAt
      });
    }
  }
  const ranked = rows.map((r, i) => ({ i, er: r.metrics.engagementRate })).sort((a, b) => b.er - a.er);
  ranked.forEach((x, n) => {
    const share = n / Math.max(1, ranked.length);
    const row = rows[x.i];
    const tier = share < 0.1 ? 'winner' : share < 0.35 ? 'high' : share < 0.75 ? 'average' : 'low';
    row.learning.tier = tier;
    row.learning.score = Math.round((1 - share) * 100);
    if (tier === 'winner' || tier === 'high') { row.learning.winningHashtags = row.hashtags.slice(0, 4); row.learning.winningTone = row.tone; row.learning.winningCTA = row.cta; row.learning.notes = [`Engagement rate ${x.er} percent, among the best of ${rows.length} measured posts.`]; }
  });
  return rows;
}

/** The daily snapshots, oldest first: one document per day for `days + 1` days ending today. */
function snapshotRows({ userId, now, days = WINDOW_DAYS }) {
  const rows = [];
  const r = seeded('zaya-snapshots');
  const platforms = SOCIALS.map((s) => s.platform);
  for (let daysAgo = days; daysAgo >= 0; daysAgo -= 1) {
    const day = new Date(now.getTime() - daysAgo * DAY);
    const date = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const t = (days - daysAgo) / days;
    const entry = {};
    for (const p of platforms) {
      const { followers, a } = finalOf(p);
      const wobble = daysAgo === 0 ? 1 : 1 + (r() - 0.5) * 0.006;
      const f = daysAgo === 0 ? followers : Math.round(followersOn(p, daysAgo) * wobble);
      const m = { followers: f, following: (a.followsCount || a.followingCount || 0), posts: Math.max(0, (a.mediaCount || a.postsCount || 0) - Math.round(daysAgo * 0.32)), reach: 0, impressions: 0, engagementRate: 0, likes: 0 };
      const bump = daysAgo === 0 ? 1 : 0.94 + r() * 0.14;
      if (p === 'instagram') {
        m.reach = Math.round(f * (a.reachCount / a.followersCount) * bump);
        m.impressions = Math.round(m.reach * 0.8);
        m.engagementRate = daysAgo === 0 ? Math.round(((a.likeCount + a.commentsCount) / a.followersCount) * 10000) / 100 : Math.round((3.9 + 2.0 * (t ** 1.1) + (r() - 0.5) * 0.3) * 100) / 100;
        m.likes = Math.round(a.likeCount * (0.55 + 0.45 * t) * bump);
      } else if (p === 'facebook') {
        m.reach = Math.round(f * (a.pagePostsImpressionsUnique / a.followersCount) * bump);
        m.impressions = Math.round(a.pagePostsImpressions * (f / a.followersCount) * bump);
        m.engagementRate = daysAgo === 0 ? Math.round((a.pagePostEngagements / a.pagePostsImpressions) * 10000) / 100 : Math.round((2.5 + 0.7 * t + (r() - 0.5) * 0.2) * 100) / 100;
        m.likes = Math.round((a.fanCount) * (0.9 + 0.1 * t));
      } else if (p === 'linkedin') {
        m.reach = Math.round(a.uniqueImpressionsCount * (f / finalOf('linkedin').followers) * bump);
        m.impressions = Math.round(a.impressionCount * (f / finalOf('linkedin').followers) * bump);
        m.engagementRate = daysAgo === 0 ? Math.round(a.engagement * 10000) / 100 : Math.round((4.6 + 0.6 * t + (r() - 0.5) * 0.2) * 100) / 100;
      }
      entry[p] = m;
    }
    const totals = Object.values(entry).reduce((s, m) => ({ followers: s.followers + m.followers, reach: s.reach + m.reach, impressions: s.impressions + m.impressions, posts: s.posts + m.posts }), { followers: 0, reach: 0, impressions: 0, posts: 0 });
    rows.push({ userId, date, platforms: entry, totals, createdAt: date, updatedAt: date });
  }
  return rows;
}

module.exports = { WINDOW_DAYS, followersOn, numbersFor, totalsOf, performanceRows, snapshotRows };
