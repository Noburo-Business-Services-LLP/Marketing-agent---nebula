// The tracker's normaliser must fill `metrics` from the publishing service's per-platform answer (real shapes), never zeros.
const test = require('node:test');
const assert = require('node:assert');
const { normalizeAnalyticsMetrics, scorePerformance } = require('../services/aiMemoryService');
const M = require('../services/performance/metrics');

const answer = (platform, analytics) => ({ status: 'success', id: 'abc', [platform]: { analytics, postUrl: `https://www.${platform}.com/p/1` } });

test('Instagram: likes, comments, shares, saves, reach, views and engagement come from the platform answer', () => {
  const m = normalizeAnalyticsMetrics(answer('instagram', { likeCount: 40, commentsCount: 5, sharesCount: 2, savedCount: 3, reachCount: 900, viewsCount: 1200, impressionsCount: 1500 }), 'instagram');
  assert.strictEqual(m.likes, 40);
  assert.strictEqual(m.comments, 5);
  assert.strictEqual(m.shares, 2);
  assert.strictEqual(m.saves, 3);
  assert.strictEqual(m.reach, 900);
  assert.strictEqual(m.views, 1200);
  assert.strictEqual(m.impressions, 1500);
  assert.strictEqual(m.engagement, 50);
  assert.strictEqual(m.engagementRate, Number(((50 / 1500) * 100).toFixed(2)));
});

test('Facebook: reactions total counts as likes, comment and share counts are read', () => {
  const m = normalizeAnalyticsMetrics(answer('facebook', { reactions: { like: 7, love: 2, total: 9 }, commentCount: 4, shareCount: 1, impressionsUnique: 600, clickCount: 11 }), 'facebook');
  assert.strictEqual(m.likes, 9);
  assert.strictEqual(m.comments, 4);
  assert.strictEqual(m.shares, 1);
  assert.strictEqual(m.reach, 600);
  assert.strictEqual(m.clicks, 11);
  assert.strictEqual(m.engagement, 14);
});

test('LinkedIn: likeCount, commentCount, shareCount, unique impressions and clicks', () => {
  const m = normalizeAnalyticsMetrics(answer('linkedin', { likeCount: 12, commentCount: 3, shareCount: 2, uniqueImpressionsCount: 700, impressionCount: 800, clickCount: 20 }), 'linkedin');
  assert.deepStrictEqual([m.likes, m.comments, m.shares, m.reach, m.impressions, m.clicks], [12, 3, 2, 700, 800, 20]);
  assert.strictEqual(m.engagement, 17);
  assert.strictEqual(m.ctr, 2.5);
});

test('X (twitter): replies are comments, reposts are shares, impressions are read', () => {
  const m = normalizeAnalyticsMetrics(answer('twitter', { likeCount: 3, replyCount: 1, retweetCount: 2, impressionCount: 300 }), 'twitter');
  assert.deepStrictEqual([m.likes, m.comments, m.shares, m.impressions, m.engagement], [3, 1, 2, 300, 6]);
  assert.strictEqual(m.reach, 0);
  // the alias "x" in the stored answer
  const y = normalizeAnalyticsMetrics({ x: { analytics: { likeCount: 5 } } }, 'twitter');
  assert.strictEqual(y.likes, 5);
});

test('missing fields stay 0, a real 0 stays 0, and strings are read as numbers', () => {
  const none = normalizeAnalyticsMetrics(answer('instagram', {}), 'instagram');
  assert.ok(Object.values(none).every((v) => v === 0));
  const zero = normalizeAnalyticsMetrics(answer('instagram', { likeCount: 0, commentsCount: 0, reachCount: 0 }), 'instagram');
  assert.strictEqual(zero.likes, 0);
  assert.strictEqual(zero.engagement, 0);
  const str = normalizeAnalyticsMetrics(answer('instagram', { likeCount: '25', commentsCount: ' 4 ', reachCount: '300', sharesCount: 'n/a', savedCount: '' }), 'instagram');
  assert.deepStrictEqual([str.likes, str.comments, str.reach, str.shares, str.saves], [25, 4, 300, 0, 0]);
  const neg = normalizeAnalyticsMetrics(answer('instagram', { likeCount: -3 }), 'instagram');
  assert.strictEqual(neg.likes, 0);
});

test('the right platform node is read when the answer holds several, and the platform can be left out when only one is there', () => {
  const both = { instagram: { analytics: { likeCount: 10 } }, facebook: { analytics: { reactions: { total: 99 } } } };
  assert.strictEqual(normalizeAnalyticsMetrics(both, 'facebook').likes, 99);
  assert.strictEqual(normalizeAnalyticsMetrics(both, 'instagram').likes, 10);
  assert.strictEqual(normalizeAnalyticsMetrics(answer('linkedin', { likeCount: 8 })).likes, 8);
});

test('older flat answers keep working', () => {
  assert.strictEqual(normalizeAnalyticsMetrics({ analytics: { likes: 6, comments: 2 } }, 'instagram').likes, 6);
  assert.strictEqual(normalizeAnalyticsMetrics({ likes: 7, shares: 1, impressions: 100 }).engagement, 8);
  assert.strictEqual(normalizeAnalyticsMetrics({ posts: [{ likeCount: 4 }] }).likes, 4);
  assert.strictEqual(normalizeAnalyticsMetrics(undefined).likes, 0);
  assert.strictEqual(normalizeAnalyticsMetrics(null, 'instagram').likes, 0);
});

test('the normaliser and the Performance view read the same numbers from the same answer', () => {
  const raw = answer('instagram', { likeCount: 40, commentsCount: 5, sharesCount: 2, savedCount: 3, reachCount: 900 });
  const n = normalizeAnalyticsMetrics(raw, 'instagram');
  const v = M.postMetricsOf({ platform: 'instagram', metrics: {}, rawAnalytics: raw });
  for (const k of Object.keys(v.values)) assert.strictEqual(n[k], v.values[k], k);
  assert.strictEqual(n.engagement, v.engagement);
});

test('the learning score reads the corrected figures (reach counts when impressions are absent, saves count)', () => {
  const real = normalizeAnalyticsMetrics(answer('instagram', { likeCount: 40, commentsCount: 3, sharesCount: 1, savedCount: 6, reachCount: 5000 }), 'instagram');
  const zeros = normalizeAnalyticsMetrics({}, 'instagram');
  assert.ok(scorePerformance(real) > scorePerformance(zeros) + 5);
  assert.ok(real.engagementRate > 0, 'rate is worked out over reach when impressions are absent');
  assert.ok(scorePerformance({ ...real, saves: 0 }) < scorePerformance(real));
  assert.ok(scorePerformance(real) <= 100);
});
