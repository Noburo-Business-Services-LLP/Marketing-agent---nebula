'use strict';
// Performance view: pure helpers that read the numbers we really store. No database, no clock of its own.
//   - Platforms: names, labels, the order on the page, which account-level figures our daily snapshot stores for each.
//   - Per-post numbers: read from an `ai_content_performance` row (the tracker measures each published post 1, 3, 7, 14
//     and 30 days after it went out). The stored `metrics` object is often all zero because the tracker's normaliser reads
//     a flat shape, while the publishing service answers per platform ({ instagram: { analytics: { likeCount } } }), and
//     that answer is kept in `rawAnalytics`. So a figure is read from the platform's own stored answer first, then from
//     the stored metrics. A figure counts as reported only when the platform gave it; nothing is ever made up.
//   - Ranges in India time and the format of a post.
// See docs/superpowers/ops/performance-view.md.

const DAY_MS = 86400000;
const IST_OFFSET_MS = 330 * 60000;

const RANGES = { week: 7, month: 30, '90d': 90 };
const RANGE_WORDS = { week: 'this week', month: 'this month', '90d': 'in the last 90 days' };

// Stored platform key -> label. "twitter" is how the publishing service names X; "gmb" is the Google Business Profile.
const PLATFORM_LABEL = {
  instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', twitter: 'X', gmb: 'Google',
  youtube: 'YouTube', tiktok: 'TikTok', pinterest: 'Pinterest', threads: 'Threads'
};
const ALIASES = { x: 'twitter', google: 'gmb', googlebusiness: 'gmb', google_business: 'gmb' };
// Always shown (as "Not connected" when not connected); the rest only when connected or holding numbers.
const CORE_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'twitter'];
const PLATFORM_ORDER = ['instagram', 'facebook', 'linkedin', 'twitter', 'gmb', 'youtube', 'tiktok', 'pinterest', 'threads'];

// Account-level figures our daily snapshot does not store for a platform (services/snapshotScheduler.js maps no field
// for them). The sentence is shown instead of a number.
const SNAPSHOT_GAPS = {
  twitter: { reach: 'Reach is not reported for X accounts.', engagementRate: 'An engagement rate is not reported for X accounts.' },
  gmb: { followers: 'Google Business Profiles have no followers.', engagementRate: 'An engagement rate is not reported for Google Business Profiles.' }
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nonNeg = (v) => (isNum(v) && v >= 0 ? v : null);

function normPlatform(p) {
  const s = String(p || '').trim().toLowerCase();
  if (!s) return '';
  return ALIASES[s] || s;
}
const labelOf = (p) => PLATFORM_LABEL[normPlatform(p)] || (p ? String(p).charAt(0).toUpperCase() + String(p).slice(1) : 'Other');
const isKnownPlatform = (p) => Object.prototype.hasOwnProperty.call(PLATFORM_LABEL, normPlatform(p));

/** A range key from the query, or 'month'. */
function rangeKey(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === '90' || s === '90d' || s === 'quarter') return '90d';
  if (s === 'week' || s === '7' || s === '7d') return 'week';
  return 'month';
}

/** The rolling window ending at `now`: { key, days, from, to, previousFrom } (previous = the same length just before). */
function rangeWindow(key, now) {
  const k = RANGES[key] ? key : 'month';
  const days = RANGES[k];
  const to = new Date(now);
  const from = new Date(to.getTime() - days * DAY_MS);
  const previousFrom = new Date(from.getTime() - days * DAY_MS);
  return { key: k, days, from, to, previousFrom };
}

/** India weekday (0 Monday .. 6 Sunday) and hour (0..23) of a date. */
function istWeekdayHour(d) {
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  const x = new Date(t + IST_OFFSET_MS);
  return { weekday: (x.getUTCDay() + 6) % 7, hour: x.getUTCHours() };
}
const istDate = (d) => { const t = new Date(d).getTime(); return Number.isFinite(t) ? new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10) : null; };

// ---- per-post numbers ---------------------------------------------------------------------------------------------------
// The platform's own field names in the publishing service's answer, in the order we trust them.
const POST_FIELDS = {
  likes: ['likeCount', 'likesCount', 'likes', 'favoriteCount'],
  comments: ['commentsCount', 'commentCount', 'replyCount', 'comments'],
  shares: ['sharesCount', 'shareCount', 'retweetCount', 'repostCount', 'shares'],
  saves: ['savedCount', 'saveCount', 'saves'],
  reach: ['reachCount', 'impressionsUnique', 'postImpressionsUnique', 'uniqueImpressionsCount', 'reach'],
  impressions: ['impressionCount', 'impressionsCount', 'impressions'],
  views: ['viewsCount', 'videoViews', 'totalVideoViews', 'viewCount', 'views'],
  clicks: ['clickCount', 'clicks']
};
const POST_METRICS = Object.keys(POST_FIELDS);

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (isNum(v) && v >= 0) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0) return Number(v);
  }
  return undefined;
}

/** The platform's analytics object inside a stored answer (several shapes are kept in old rows). */
function platformNode(raw, platform) {
  if (!raw || typeof raw !== 'object') return null;
  const p = normPlatform(platform);
  const keys = [p, p === 'twitter' ? 'x' : null, p === 'gmb' ? 'google' : null].filter(Boolean);
  for (const k of keys) {
    const node = raw[k];
    if (node && typeof node === 'object') return node.analytics && typeof node.analytics === 'object' ? node.analytics : node;
  }
  if (raw.analytics && typeof raw.analytics === 'object') return raw.analytics;
  return null;
}

/**
 * The numbers of one measured post: { values: { likes, comments, ... }, reported: [names], engagement, engagementReported }.
 * A name is in `reported` only when the platform gave that figure (or a stored metric above zero holds it).
 * Engagement is likes + comments + shares + saves of the reported parts; without any part, the platform's own
 * engagement count when it gave one.
 */
function postMetricsOf(row) {
  const node = platformNode(row && row.rawAnalytics, row && row.platform);
  const stored = (row && row.metrics) || {};
  const values = {};
  const reported = [];
  for (const m of POST_METRICS) {
    let v = pick(node, POST_FIELDS[m]);
    if (m === 'likes' && v === undefined && node && node.reactions && typeof node.reactions === 'object') v = pick(node.reactions, ['total', 'like']);
    if (v === undefined && isNum(stored[m]) && stored[m] > 0) v = stored[m];
    if (v !== undefined) { values[m] = v; reported.push(m); }
  }
  const parts = ['likes', 'comments', 'shares', 'saves'].filter((k) => reported.includes(k));
  let engagement = null;
  if (parts.length) engagement = parts.reduce((a, k) => a + values[k], 0);
  else {
    const own = pick(node, ['engagementCount', 'engagement']);
    if (own !== undefined) engagement = own;
    else if (isNum(stored.engagement) && stored.engagement > 0) engagement = stored.engagement;
  }
  return { values, reported, engagement, engagementReported: engagement !== null };
}

/** The post's link on the platform, when one was stored (https only). */
function postUrlOf(row, campaign) {
  const node = row && row.rawAnalytics && row.rawAnalytics[normPlatform(row.platform)];
  const cands = [];
  if (node && typeof node === 'object') cands.push(node.postUrl, node.url);
  const ids = campaign && campaign.publishResult && Array.isArray(campaign.publishResult.postIds) ? campaign.publishResult.postIds : [];
  for (const p of ids) if (p && normPlatform(p.platform) === normPlatform(row && row.platform)) cands.push(p.postUrl, p.url);
  if (campaign && campaign.publishResult) cands.push(campaign.publishResult.postUrl);
  return cands.find((u) => typeof u === 'string' && /^https:\/\/[^\s]{4,600}$/i.test(u)) || null;
}

const FORMAT_WORD = { image: 'Image posts', carousel: 'Carousels', video: 'Videos', text: 'Text posts' };
const FORMAT_ONE = { image: 'image post', carousel: 'carousel', video: 'video', text: 'text post' };
/** image, carousel, video or text, from the campaign's stored type, else the measured row's content type. */
function formatOf(campaign, row) {
  const t = String((campaign && campaign.creative && campaign.creative.type) || (row && row.contentType) || '').toLowerCase();
  if (/reel|video|story/.test(t)) return 'video';
  if (/carousel|slides?/.test(t)) return 'carousel';
  if (t === 'text') return 'text';
  if (t === 'image' || t === 'post' || t === 'photo' || t === 'single') {
    const imgs = campaign && campaign.creative && Array.isArray(campaign.creative.imageUrls) ? campaign.creative.imageUrls.length : 0;
    if (imgs > 1) return 'carousel';
    if (imgs === 0 && campaign && !(campaign.creative && campaign.creative.videoUrl)) return 'text';
    return 'image';
  }
  return 'image';
}

const MAX_TITLE = 80;
function titleOf(campaign, row) {
  const raw = (campaign && (campaign.name || (campaign.creative && (campaign.creative.captions || campaign.creative.textContent)))) || (row && row.caption) || '';
  const t = String(raw).replace(/\s+/g, ' ').trim();
  if (!t) return 'Your post';
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 3).trim()}...` : t;
}
function captionOf(campaign, row) {
  return String((campaign && campaign.creative && (campaign.creative.captions || campaign.creative.textContent)) || (row && row.caption) || '').trim();
}
const httpsUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s]{4,600}$/i.test(u) ? u : null);
function thumbOf(campaign, row) {
  const list = [
    ...((campaign && campaign.creative && Array.isArray(campaign.creative.imageUrls)) ? campaign.creative.imageUrls : []),
    ...((row && row.assets && Array.isArray(row.assets.thumbnails)) ? row.assets.thumbnails : []),
    ...((row && row.assets && Array.isArray(row.assets.images)) ? row.assets.images : [])
  ];
  return list.map(httpsUrl).find(Boolean) || null;
}

/** Snapshot platforms as a plain object (a Map in a model, an object from lean()). */
function platformsOfSnapshot(s) {
  const p = s && s.platforms;
  if (!p) return {};
  if (p instanceof Map) return Object.fromEntries(p);
  return typeof p === 'object' ? p : {};
}

module.exports = {
  DAY_MS, RANGES, RANGE_WORDS, PLATFORM_LABEL, CORE_PLATFORMS, PLATFORM_ORDER, SNAPSHOT_GAPS, POST_METRICS, FORMAT_WORD, FORMAT_ONE,
  isNum, nonNeg, normPlatform, labelOf, isKnownPlatform, rangeKey, rangeWindow, istWeekdayHour, istDate,
  postMetricsOf, postUrlOf, formatOf, titleOf, captionOf, thumbOf, platformsOfSnapshot
};
