const test = require('node:test');
const assert = require('node:assert');
const M = require('../services/performance/metrics');
const L = require('../services/performance/learnings');
const { buildPerformanceView } = require('../services/performance/view');
const { createPerformanceService } = require('../services/performance/service');
const { createPerformanceRouter } = require('../routes/performanceView');
const { createSummaryCache } = require('../services/homeSummaryCache');
const { protect } = require('../middleware/auth');

const DAY = 864e5;
const NOW = new Date('2026-10-19T12:00:00Z');
const ago = (d, h = 0) => new Date(NOW.getTime() - d * DAY + h * 36e5);
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

// A measured row in the shape the tracker stores: zeros in `metrics`, the platform's answer in `rawAnalytics`.
let seq = 0;
const row = (platform, daysAgo, a, extra = {}) => ({
  _id: `r${++seq}`, campaignId: extra.campaignId || null, platform, postId: `p${seq}`, contentType: 'post', caption: extra.caption || '',
  metrics: { likes: 0, comments: 0, shares: 0, reach: 0 }, rawAnalytics: { status: 'success', [platform]: { analytics: a, postUrl: `https://www.${platform}.com/p/${seq}` } },
  publishedAt: ago(daysAgo, extra.hour || 0), measuredAt: ago(Math.max(0, daysAgo - 1)), ...extra.row
});
const snap = (daysAgo, platforms) => ({ date: ago(daysAgo), platforms });

test('per-post numbers are read from the platform answer when the stored metrics are zero', () => {
  const r = row('instagram', 2, { likeCount: 40, commentsCount: 5, sharesCount: 2, savedCount: 3, reachCount: 900 });
  const m = M.postMetricsOf(r);
  assert.deepStrictEqual(m.values, { likes: 40, comments: 5, shares: 2, saves: 3, reach: 900 });
  assert.strictEqual(m.engagement, 50);
  const fb = M.postMetricsOf(row('facebook', 2, { reactions: { like: 7, total: 9 }, commentCount: 1 }));
  assert.strictEqual(fb.values.likes, 9);
  assert.ok(!fb.reported.includes('shares'), 'a figure the platform did not give is not reported');
  const x = M.postMetricsOf(row('twitter', 2, { likeCount: 3, replyCount: 1, retweetCount: 2, impressionCount: 300 }));
  assert.deepStrictEqual(x.values, { likes: 3, comments: 1, shares: 2, impressions: 300 });
  const flat = M.postMetricsOf({ platform: 'instagram', metrics: { likes: 12, comments: 0 }, rawAnalytics: {} });
  assert.deepStrictEqual(flat.values, { likes: 12 });
  const none = M.postMetricsOf({ platform: 'instagram', metrics: {}, rawAnalytics: {} });
  assert.deepStrictEqual(none.reported, []);
  assert.strictEqual(none.engagement, null);
});

test('formats, links, ranges and India time', () => {
  assert.strictEqual(M.formatOf({ creative: { type: 'reel' } }), 'video');
  assert.strictEqual(M.formatOf({ creative: { type: 'carousel' } }), 'carousel');
  assert.strictEqual(M.formatOf({ creative: { type: 'image', imageUrls: ['a', 'b'] } }), 'carousel');
  assert.strictEqual(M.formatOf({ creative: { type: 'image', imageUrls: ['a'] } }), 'image');
  assert.strictEqual(M.formatOf({ creative: { type: 'text' } }), 'text');
  assert.strictEqual(M.postUrlOf({ platform: 'instagram', rawAnalytics: { instagram: { postUrl: 'javascript:alert(1)' } } }, { publishResult: { postIds: [{ platform: 'instagram', postUrl: 'https://instagram.com/p/x' }] } }), 'https://instagram.com/p/x');
  assert.strictEqual(M.rangeKey('week'), 'week');
  assert.strictEqual(M.rangeKey('90d'), '90d');
  assert.strictEqual(M.rangeKey('anything'), 'month');
  const w = M.rangeWindow('week', NOW);
  assert.strictEqual(w.to.getTime() - w.from.getTime(), 7 * DAY);
  assert.strictEqual(w.from.getTime() - w.previousFrom.getTime(), 7 * DAY);
  assert.deepStrictEqual(M.istWeekdayHour('2026-10-19T13:00:00Z'), { weekday: 0, hour: 18 }); // Monday 6:30 pm in India
  assert.strictEqual(M.normPlatform('X'), 'twitter');
  assert.strictEqual(M.labelOf('twitter'), 'X');
  assert.strictEqual(M.labelOf('gmb'), 'Google');
});

const base = (extra = {}) => ({ now: NOW, range: 'month', account: { canConnect: true }, connected: ['instagram', 'facebook'], connectedCount: 2, snapshots: [], rows: [], campaigns: new Map(), published: [], ...extra });

test('platforms: core four always listed, connected ones with stored numbers, others with reasons', () => {
  const v = buildPerformanceView(base({
    snapshots: [
      snap(40, { instagram: { followers: 900, reach: 3000, engagementRate: 2 } }),
      snap(31, { instagram: { followers: 1000, reach: 4000, engagementRate: 3 }, facebook: { followers: 50, reach: 0, engagementRate: 0 } }),
      snap(10, { instagram: { followers: 1100, reach: 5000, engagementRate: 3.5 }, facebook: { followers: 60, reach: 0, engagementRate: 0 } }),
      snap(1, { instagram: { followers: 1200, reach: 6000, engagementRate: 4 }, facebook: { followers: 70, reach: 0, engagementRate: 0 }, linkedin: { followers: 999 } })
    ]
  }));
  assert.deepStrictEqual(v.platforms.map((p) => p.platform), ['instagram', 'facebook', 'linkedin', 'twitter']);
  const ig = v.platforms[0];
  assert.strictEqual(ig.state, 'ready');
  assert.strictEqual(ig.metrics.followers.value, 1200);
  assert.strictEqual(ig.metrics.followers.previous, 1000, 'previous is the newest number at the start of the period');
  assert.strictEqual(ig.metrics.followers.change, 200);
  assert.deepStrictEqual(ig.spark.followers, [1100, 1200]);
  assert.strictEqual(ig.metrics.reach.value, 6000);
  const fb = v.platforms[1];
  assert.strictEqual(fb.metrics.reach.available, false);
  assert.match(fb.metrics.reach.reason, /Facebook has not reported this yet/);
  const li = v.platforms[2];
  assert.strictEqual(li.state, 'notconnected', 'a platform that is not connected never shows old numbers');
  assert.deepStrictEqual(li.metrics, {});
  assert.match(li.reason, /Connect LinkedIn/);
  assert.strictEqual(v.overall.followers.value, 1270);
  assert.strictEqual(v.overall.followers.previous, 1050);
  assert.strictEqual(v.overall.reach.value, 6000);
  assert.strictEqual(v.overall.engagementRate.value, 4);
});

test('X has no account reach and Google has no followers: the reason says so instead of a zero', () => {
  const v = buildPerformanceView(base({ connected: ['twitter', 'gmb'], snapshots: [snap(1, { twitter: { followers: 80, reach: 0 }, gmb: { followers: 0, reach: 40 } })] }));
  const x = v.platforms.find((p) => p.platform === 'twitter');
  assert.strictEqual(x.metrics.followers.value, 80);
  assert.match(x.metrics.reach.reason, /not reported for X accounts/);
  const g = v.platforms.find((p) => p.platform === 'gmb');
  assert.match(g.metrics.followers.reason, /no followers/);
  assert.strictEqual(g.label, 'Google');
});

test('nothing connected: free accounts read the paid plan reason, paid ones the connect reason', () => {
  const free = buildPerformanceView(base({ connected: [], connectedCount: 0, account: { canConnect: false, free: true } }));
  assert.ok(free.platforms.every((p) => p.state === 'notconnected'));
  assert.strictEqual(free.platforms[0].reason, 'Connecting accounts comes with a paid plan.');
  assert.strictEqual(free.overall.reach.reason, 'Connecting accounts comes with a paid plan.');
  const paid = buildPerformanceView(base({ connected: [], connectedCount: 0 }));
  assert.strictEqual(paid.overall.reach.reason, 'Connect an account to see this.');
  const fresh = buildPerformanceView(base({ connected: ['instagram'] }));
  assert.strictEqual(fresh.platforms[0].state, 'nodata');
  assert.strictEqual(fresh.platforms[0].reason, 'Your first numbers arrive within a day of connecting.');
});

function measuredSet() {
  seq = 0;
  const camps = new Map();
  const rows = [];
  const add = (platform, daysAgo, type, a, hour = 0, caption = '') => {
    const id = `c${rows.length + 1}`;
    camps.set(id, { _id: id, name: `Post ${rows.length + 1}`, platforms: [platform], creative: { type, imageUrls: [`https://res.cloudinary.com/x/image/upload/${id}.jpg`], captions: caption }, publishedAt: ago(daysAgo, hour) });
    rows.push(row(platform, daysAgo, a, { campaignId: id, hour, caption }));
  };
  // 4 videos with many likes, 4 images with fewer, 2 on facebook; one post in the previous period.
  add('instagram', 2, 'reel', { likeCount: 300, commentsCount: 20, reachCount: 5000 }, 1);
  add('instagram', 5, 'reel', { likeCount: 220, commentsCount: 9, reachCount: 4100 }, 1);
  add('instagram', 9, 'reel', { likeCount: 200, commentsCount: 30, reachCount: 3900 }, 1);
  add('instagram', 12, 'reel', { likeCount: 180, commentsCount: 4, reachCount: 3000 }, 1);
  add('instagram', 3, 'image', { likeCount: 60, commentsCount: 2, reachCount: 1200 }, 4);
  add('instagram', 6, 'image', { likeCount: 50, commentsCount: 3, reachCount: 1100 }, 4);
  add('instagram', 10, 'image', { likeCount: 70, commentsCount: 1, reachCount: 1000 }, 4);
  add('instagram', 14, 'image', { likeCount: 40, commentsCount: 0, reachCount: 900 }, 4);
  add('facebook', 4, 'image', { reactions: { total: 10 }, commentCount: 1 }, 4);
  add('facebook', 8, 'image', { reactions: { total: 12 }, commentCount: 0 }, 4);
  add('instagram', 40, 'image', { likeCount: 99, commentsCount: 1 }, 4);
  const published = [...camps.values()].map((c) => ({ platforms: c.platforms, publishedAt: c.publishedAt }));
  return { rows, campaigns: camps, published };
}

test('top posts: best three by each measure, only from measured posts of the period, with picture, link and numbers', () => {
  const v = buildPerformanceView(base(measuredSet()));
  assert.strictEqual(v.topPosts.measured, 10);
  const likes = v.topPosts.lists.likes.posts;
  assert.deepStrictEqual(likes.map((p) => p.value), [300, 220, 200]);
  assert.strictEqual(likes[0].title, 'Post 1');
  assert.strictEqual(likes[0].format, 'video');
  assert.match(likes[0].thumbnail, /^https:\/\/res\.cloudinary\.com/);
  assert.match(likes[0].url, /^https:\/\/www\.instagram\.com\/p\//);
  assert.deepStrictEqual(v.topPosts.lists.comments.posts.map((p) => p.value), [30, 20, 9]);
  assert.deepStrictEqual(v.topPosts.lists.reach.posts.map((p) => p.value), [5000, 4100, 3900]);
  assert.strictEqual(v.topPosts.lists.engagement.posts[0].value, 320);
  assert.ok(!likes.some((p) => p.value === 99), 'the post from the previous period is not in this period');
  // Platform filter: everything below reflects Facebook only.
  const fb = buildPerformanceView(base({ ...measuredSet(), platform: 'facebook' }));
  assert.deepStrictEqual(fb.topPosts.lists.likes.posts.map((p) => p.value), [12, 10]);
  assert.strictEqual(fb.topPosts.lists.reach.posts.length, 0);
  assert.match(fb.topPosts.lists.reach.reason, /reported reach/);
  assert.strictEqual(fb.overall.likes.value, 22);
  assert.strictEqual(fb.overall.posts.value, 2);
  // Platform likes and previous period.
  const ig = buildPerformanceView(base(measuredSet())).platforms[0];
  assert.strictEqual(ig.metrics.likes.value, 1120);
  assert.strictEqual(ig.metrics.likes.previous, 99);
  assert.strictEqual(ig.metrics.posts.value, 8);
  assert.strictEqual(ig.metrics.posts.previous, 1);
});

test('formats, best day and time only with enough posts; findings carry evidence counts and a Create hand-over', () => {
  const v = buildPerformanceView(base(measuredSet()));
  assert.strictEqual(v.byFormat.available, true);
  assert.strictEqual(v.byFormat.metric, 'likes');
  assert.deepStrictEqual(v.byFormat.rows.map((r) => [r.format, r.posts]), [['video', 4], ['image', 6]]);
  const fmt = v.insights.find((i) => i.kind === 'format');
  assert.ok(fmt, 'a format finding');
  // videos 225 likes on average, images (6 posts: 60, 50, 70, 40, 10, 12) 40.3: 5.6 times
  assert.strictEqual(fmt.text, 'Videos got 5.6 times the likes of image posts this month (from 10 posts).');
  assert.strictEqual(fmt.evidence.posts, 10);
  assert.strictEqual(fmt.action.kind, 'video');
  assert.match(fmt.action.brief, /^A new video in the style of "Post 1"/);
  assert.ok(v.insights.length >= 2 && v.insights.length <= 5);
  for (const i of v.insights) {
    assert.ok(!/[!—]/.test(i.text), `no exclamation mark or em dash: ${i.text}`);
    assert.ok(!/credit|trial|7 days/i.test(i.text));
    assert.ok(/from \d+ (post|posts|daily number|daily numbers)\)/.test(i.text), `evidence in the sentence: ${i.text}`);
  }
  assert.strictEqual(v.byTime.available, true);
  assert.strictEqual(v.byTime.best.key, 'evening'); // NOW is 12:00 UTC; one hour later is 6:30 pm in India
  // Too few posts: no findings, a reason with the count.
  const few = measuredSet();
  const small = buildPerformanceView(base({ ...few, rows: few.rows.slice(0, 3) }));
  assert.deepStrictEqual(small.insights, []);
  assert.match(small.insightsReason, /at least 5 posts .* So far: 3/);
  assert.strictEqual(small.byFormat.available, false);
  assert.strictEqual(small.byDay.available, false);
  assert.match(small.byDay.reason, /at least 8 posts/);
});

test('learnings: thresholds hold, structured with source and evidence', () => {
  const p = (i, format, likes, extra = {}) => ({ id: `x${i}`, platform: 'instagram', format, title: `T${i}`, caption: '', weekday: i % 7, hour: 10, values: { likes }, reported: ['likes'], engagement: likes, ...extra });
  // Two per group: no format finding.
  const two = [p(1, 'video', 100), p(2, 'video', 100), p(3, 'image', 10), p(4, 'image', 10), p(5, 'image', 10)];
  assert.ok(!L.computeLearnings({ posts: two }).some((l) => l.kind === 'format'));
  // Close results: nothing said.
  const close = [1, 2, 3].map((i) => p(i, 'video', 110)).concat([4, 5, 6].map((i) => p(i, 'image', 100)));
  assert.ok(!L.computeLearnings({ posts: close }).some((l) => l.kind === 'format'));
  const clear = [1, 2, 3].map((i) => p(i, 'video', 140)).concat([4, 5, 6].map((i) => p(i, 'image', 100)));
  const f = L.computeLearnings({ posts: clear, range: { key: 'week', words: 'this week' } }).find((l) => l.kind === 'format');
  assert.strictEqual(f.statement, 'Videos got 40 percent more likes than image posts this week (from 6 posts).');
  assert.strictEqual(f.source, 'post_performance');
  assert.deepStrictEqual(f.evidence, { range: 'week', posts: 6 });
  const facts = L.topPostFacts(clear, { key: 'week' });
  assert.strictEqual(facts.find((x) => x.metric === 'likes').value, 140);
  assert.strictEqual(facts.find((x) => x.metric === 'likes').evidence.posts, 6);
  const grown = L.computeLearnings({ posts: [], followers: [{ platform: 'instagram', change: 42, days: 6 }] });
  assert.strictEqual(grown[0].statement, 'Instagram gained 42 followers this month (from 6 daily numbers).');
  assert.strictEqual(grown[0].source, 'account_snapshots');
  assert.deepStrictEqual(L.computeLearnings({ posts: [], followers: [{ platform: 'instagram', change: -3, days: 6 }] }), []);
});

test('the service reads only the signed-in account, in bounded queries, and names a failed source', async () => {
  const calls = [];
  const deps = {
    now: () => NOW,
    snapshots: async (id, since) => { calls.push(['snapshots', id, since]); return []; },
    measured: async (id) => { calls.push(['measured', id]); throw new Error('boom'); },
    campaigns: async (id, ids) => { calls.push(['campaigns', id, ids.length]); return []; },
    published: async (id) => { calls.push(['published', id]); return []; }
  };
  const svc = createPerformanceService(deps);
  const user = { _id: 'u1', plan: { tier: 'starter' }, connectedSocials: [{ platform: 'instagram' }] };
  const v = await quiet(() => svc.build({ user, range: 'week' }));
  assert.ok(calls.every((c) => c[1] === 'u1'));
  assert.deepStrictEqual(v.degraded, ['measured']);
  assert.match(v.platforms[0].metrics.likes.reason, /could not load/);
  const since = calls.find((c) => c[0] === 'snapshots')[2];
  assert.strictEqual(NOW.getTime() - since.getTime(), 15 * DAY);
  // No connection: snapshots are not read.
  calls.length = 0;
  await quiet(() => svc.build({ user: { _id: 'u2', plan: { tier: 'free' } }, range: 'month' }));
  assert.ok(!calls.some((c) => c[0] === 'snapshots'));
});

const mkRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } });
const routeOf = (router) => router.stack.find((l) => l.route && l.route.path === '/performance');

test('route: sign-in first, own account only, 60 second cache by range and platform, bad platform refused', async () => {
  const log = [];
  const service = { build: async ({ user, range, platform }) => { log.push([user._id, range, platform]); return { degraded: [], n: log.length }; } };
  let t = 0;
  const router = createPerformanceRouter({ service, cache: createSummaryCache({ now: () => t }) });
  const layer = routeOf(router);
  assert.strictEqual(layer.route.stack[0].handle, protect);
  const h = layer.route.stack[layer.route.stack.length - 1].handle;
  const call = async (req) => { const res = mkRes(); await h({ query: {}, ...req }, res); return res; };
  const a = await call({ user: { _id: 'u1' }, query: { range: 'week', userId: 'u9' } });
  assert.deepStrictEqual(log[0], ['u1', 'week', '']);
  const b = await call({ user: { _id: 'u1' }, query: { range: 'week' } });
  assert.strictEqual(b.body.cached, true);
  assert.strictEqual(a.headers['Cache-Control'], 'private, no-store');
  await call({ user: { _id: 'u1' }, query: { range: 'week', platform: 'X' } });
  assert.deepStrictEqual(log[1], ['u1', 'week', 'twitter']);
  t += 61000;
  await call({ user: { _id: 'u1' }, query: { range: 'week' } });
  assert.strictEqual(log.length, 3);
  const bad = await call({ user: { _id: 'u1' }, query: { platform: 'myspace' } });
  assert.strictEqual(bad.code, 400);
  const none = await call({ user: null });
  assert.strictEqual(none.code, 401);
  const err = await quiet(() => { const r = createPerformanceRouter({ service: { build: async () => { throw new Error('x'); } }, cache: createSummaryCache() }); const hh = routeOf(r).route.stack.slice(-1)[0].handle; const res = mkRes(); return hh({ query: {}, user: { _id: 'u1' } }, res).then(() => res); });
  assert.strictEqual(err.code, 500);
  assert.strictEqual(err.body.message, 'We could not load your performance numbers. Please try again.');
});

test('route is mounted on the analytics router before GET /:id', () => {
  const analytics = require('../routes/analytics');
  const idx = analytics.stack.findIndex((l) => !l.route && l.handle && l.handle.stack && l.handle.stack.some((x) => x.route && x.route.path === '/performance'));
  const idRoute = analytics.stack.findIndex((l) => l.route && l.route.path === '/:id');
  assert.ok(idx >= 0, 'performance router is mounted');
  assert.ok(idx < idRoute, 'before /:id');
});

test('writers clear the cached view: the snapshot job and the post measuring job', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8');
  assert.match(read('snapshotScheduler.js'), /performance\/cache'\)\.forgetAccount\(userId\)/);
  assert.match(read('performanceTracker.js'), /performance\/cache'\)\.forgetAccount\(campaign\.userId\)/);
  const { sharedCache, forgetAccount } = require('../services/performance/cache');
  sharedCache().set('u5:0:week:all', { a: 1 });
  sharedCache().set('u55:0:week:all', { a: 1 });
  forgetAccount('u5');
  assert.strictEqual(sharedCache().get('u5:0:week:all'), undefined);
  assert.ok(sharedCache().get('u55:0:week:all'));
});
