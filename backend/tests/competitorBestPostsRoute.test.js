// GET /api/competitors/best-posts: the signed-in account's own stored competitor snapshots, own best posts, plan themes
// and the approved days, as tiles, "What's working" and "Trending for you". No read, no model call, nothing written.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const route = require('../routes/competitorBestPosts');
const { createBestPostsRouter, build } = route;
const { weekStartOf } = require('../services/week/weekMath');

const NOW = new Date('2026-10-17T06:00:00Z');
const WEEK = weekStartOf(NOW);
const PREV = '2026-10-05';
const DAY = 864e5;
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

const owner = (extra = {}) => ({ _id: 'u1', isActive: true, plan: { tier: 'starter', addons: ['competitors'] }, ...extra });
const comp = (id, extra = {}) => ({ _id: id, userId: 'u1', name: `Rival ${id}`, isActive: true, isIgnored: false, socialHandles: { instagram: `h_${id}` }, handleStatus: 'confirmed', createdAt: new Date(2026, 5, 10), tracking: {}, ...extra });
let n = 0;
const post = (daysAgo, type, likes, comments = 0) => ({ at: new Date(NOW - daysAgo * DAY - 3600e3), type, likes, comments, pinned: false, url: `https://www.instagram.com/p/r${++n}/` });
const snap = (competitorId, weekStart, extra = {}) => ({ competitorId, userId: 'u1', weekStart, ok: true, takenAt: new Date(NOW - 3600e3), followers: 2000, postsInWindow: 2, postsInWindowMayBeTruncated: false, posts: [post(1, 'video', 120, 4), post(3, 'image', 40)], ...extra });

function world({ competitors = [], snapshots = [], own = [], pillars = [], trackerOn = true, user = owner(), fail = {} } = {}) {
  const calls = { competitors: 0, snapshots: 0, own: 0, pillars: 0, ids: null };
  const deps = {
    competitorsFor: async (userId) => { calls.competitors++; if (fail.competitors) throw new Error('db secret'); return competitors.filter((c) => String(c.userId) === String(userId)); },
    snapshotsFor: async (userId, ids) => { calls.snapshots++; calls.ids = ids.map(String); if (fail.snapshots) throw new Error('db secret'); return snapshots.filter((s) => ids.map(String).includes(String(s.competitorId))); },
    ownPosts: async () => { calls.own++; if (fail.own) throw new Error('db secret'); return own; },
    planPillars: async () => { calls.pillars++; return pillars; },
    trackerOn: () => trackerOn,
    canUse: (u, f) => ({ allowed: f === 'competitors' && Array.isArray(u.plan && u.plan.addons) && u.plan.addons.includes('competitors') })
  };
  return { deps, calls, user };
}

const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function call(w, req = {}) {
  const r = routesOf(createBestPostsRouter({ deps: w.deps, now: () => NOW })).find((x) => x.method === 'get' && x.path === '/');
  assert.strictEqual(r.handlers.length, 3, 'protect, limiter, handler');
  const res = mkRes();
  await r.handlers[2]({ user: w.user, ...req }, res, () => {});
  return res;
}

test('the route is mounted before the general competitors router, behind sign-in and a rate limit', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server-main.js'), 'utf8');
  const a = src.indexOf("app.use('/api/competitors/best-posts'"); const b = src.indexOf("app.use('/api/competitors', competitorRoutes)");
  assert.ok(a > 0 && b > a, 'mounted, and before /api/competitors');
  const r = routesOf(createBestPostsRouter({}))[0];
  assert.strictEqual(r.handlers[0], require('../middleware/auth').protect);
});

test('no signed-in user id is a 401; a failure that stops everything is a generic 500 without the error text', async () => {
  const w = world();
  assert.strictEqual((await call({ ...w, user: {} })).code, 401);
  const bad = { ...world(), deps: { ...world().deps, trackerOn: () => { throw new Error('secret'); } } };
  const res = await quiet(() => call(bad));
  assert.strictEqual(res.code, 500);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
  assert.strictEqual(res.body.message, 'We could not load your competitors just now. Please try again.');
});

test('without the add-on no competitor data is even read; Trending still shows the honest non-competitor sources', async () => {
  const w = world({ user: owner({ plan: { tier: 'starter', addons: [] } }), competitors: [comp('a')], snapshots: [snap('a', WEEK)], pillars: ['Fresh bakes'], own: [{ contentType: 'image', caption: 'Our cakes', metrics: { likes: 30, comments: 2 }, publishedAt: new Date(NOW - 2 * DAY) }] });
  const res = await call(w);
  assert.strictEqual(res.code, 200);
  const b = res.body;
  assert.strictEqual(b.entitled, false);
  assert.strictEqual(b.state, 'not_entitled');
  assert.deepStrictEqual(b.competitors, []);
  assert.deepStrictEqual(b.working, []);
  assert.strictEqual(w.calls.competitors, 0);
  assert.strictEqual(w.calls.snapshots, 0);
  // 'news' is the dated public calendar (config/trendingEvents.js); it is there whenever an event falls in the window.
  assert.deepStrictEqual(b.trending.map((t) => t.source).filter((s) => s !== 'news'), ['own', 'festival', 'plan']);
  assert.strictEqual(res.headers['Cache-Control'], 'private, no-store');
});

test('states: no competitors; tracker off with nothing stored; first read pending; ready', async () => {
  assert.strictEqual((await call(world())).body.state, 'no_competitors');
  const off = await call(world({ competitors: [comp('a')], trackerOn: false }));
  assert.strictEqual(off.body.state, 'tracker_off');
  assert.strictEqual(off.body.trackerOn, false);
  assert.strictEqual(off.body.competitors[0].status, 'waiting');
  assert.strictEqual((await call(world({ competitors: [comp('a')] }))).body.state, 'waiting');
  const ready = await call(world({ competitors: [comp('a')], snapshots: [snap('a', WEEK)], trackerOn: false }));
  assert.strictEqual(ready.body.state, 'ready', 'stored data is shown even while the tracker is off');
});

test('each handle state is told apart, private accounts included, and only confirmed handles get a profile link', async () => {
  const competitors = [
    comp('ok', { createdAt: new Date(2026, 5, 9) }),
    comp('nohandle', { createdAt: new Date(2026, 5, 8), socialHandles: {} }),
    comp('sugg', { createdAt: new Date(2026, 5, 7), handleStatus: 'suggested', isAutoDiscovered: true }),
    comp('private', { createdAt: new Date(2026, 5, 6) }),
    comp('failed', { createdAt: new Date(2026, 5, 5) }),
    comp('paused', { createdAt: new Date(2026, 5, 4), tracking: { pausedAt: new Date('2026-10-01'), failures: 3 } })
  ];
  const snapshots = [
    snap('ok', WEEK), snap('ok', PREV, { followers: 1900 }),
    { competitorId: 'private', userId: 'u1', weekStart: WEEK, ok: false, error: 'This account is private', takenAt: new Date(NOW - DAY) },
    { competitorId: 'failed', userId: 'u1', weekStart: WEEK, ok: false, error: 'Could not read this profile', takenAt: new Date(NOW - DAY) }
  ];
  const b = (await call(world({ competitors, snapshots }))).body;
  const by = Object.fromEntries(b.competitors.map((c) => [c.id, c]));
  assert.deepStrictEqual(b.competitors.map((c) => c.id), ['ok', 'nohandle', 'sugg', 'private', 'failed']);
  assert.strictEqual(by.ok.status, 'tracking');
  assert.deepStrictEqual(by.ok.followers, { value: 2000, change: 100 });
  assert.strictEqual(by.ok.profileUrl, 'https://www.instagram.com/h_ok/');
  assert.strictEqual(by.nohandle.status, 'no_handle');
  assert.strictEqual(by.sugg.status, 'unconfirmed');
  assert.strictEqual(by.sugg.profileUrl, null);
  assert.strictEqual(by.private.status, 'private');
  assert.strictEqual(by.failed.status, 'failed');
  assert.strictEqual(b.competitors.length, 5, 'at most five, the same list the tracker reads');
});

test('another account\'s snapshots are never used, even if a store returned them', async () => {
  const theirs = snap('a', WEEK, { userId: 'u2', followers: 999999 });
  const b = (await call(world({ competitors: [comp('a')], snapshots: [theirs] }))).body;
  assert.strictEqual(b.competitors[0].followers, null);
  assert.strictEqual(b.competitors[0].status, 'waiting');
  const other = await call(world({ competitors: [comp('x', { userId: 'u2' })] }));
  assert.strictEqual(other.body.state, 'no_competitors');
});

test('the answer carries no caption, hashtag, account id or picture link, and stays small', async () => {
  const competitors = ['a', 'b', 'c', 'd', 'e'].map((id, i) => comp(id, { createdAt: new Date(2026, 5, 10 - i) }));
  const snapshots = competitors.flatMap((c) => [
    snap(c._id, WEEK, { hashtags: ['secrettag'], topPost: { caption: 'secret caption', url: 'https://www.instagram.com/p/z/', likes: 1, comments: 0, type: 'Image' }, posts: Array.from({ length: 12 }, (_, i) => post(i, i % 2 ? 'video' : 'image', 50 + i * 10, i)) }),
    snap(c._id, PREV)
  ]);
  const res = await call(world({ competitors, snapshots, pillars: ['Fresh bakes'] }));
  const text = JSON.stringify(res.body);
  for (const leak of ['secret', 'userId', 'displayUrl', 'hashtags', 'cdninstagram', 'u1']) assert.ok(!text.includes(leak), leak);
  assert.ok(Buffer.byteLength(text) < 12000, `${Buffer.byteLength(text)} bytes`);
  assert.strictEqual(res.body.working.length, 3);
  assert.ok(res.body.trending.length <= 4);
});

test('a failed source is named in degraded and the rest still loads', async () => {
  const w = world({ competitors: [comp('a')], snapshots: [snap('a', WEEK)], fail: { own: true } });
  const b = (await quiet(() => call(w))).body;
  assert.deepStrictEqual(b.degraded, ['own']);
  assert.strictEqual(b.state, 'ready');
  const w2 = world({ competitors: [comp('a')], fail: { snapshots: true } });
  const b2 = (await quiet(() => call(w2))).body;
  assert.ok(b2.degraded.includes('snapshots'));
  assert.strictEqual(b2.state, 'error');
});

test('staff on their own page get an empty answer and nothing is read', async () => {
  const w = world({ user: owner({ staffRole: 'owner' }), competitors: [comp('a')] });
  const b = (await call(w)).body;
  assert.strictEqual(b.staff, true);
  assert.strictEqual(w.calls.competitors + w.calls.snapshots + w.calls.own + w.calls.pillars, 0);
  const csmInside = world({ user: owner({ isCsm: true }), competitors: [comp('a')] });
  const b2 = (await call(csmInside, { actingCsm: true })).body;
  assert.strictEqual(b2.staff, undefined, 'a CSM inside a client sees the client');
});

test('the route file makes no outside call and writes nothing', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'competitorBestPosts.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'services', 'competitors', 'bestPosts.js'), 'utf8');
  for (const bad of ['scrapeInstagram', 'socialMediaAPI', 'fetch(', 'axios', 'callLLM', 'openAI', 'spendGuard', '.save(', 'updateOne', 'insert', 'deleteMany', 'findOneAndUpdate']) assert.ok(!src.includes(bad), bad);
});

test('build() is the same answer the route gives, for staff tools and the real-database check', async () => {
  const w = world({ competitors: [comp('a')], snapshots: [snap('a', WEEK)] });
  const direct = await build({ user: w.user, deps: w.deps, now: NOW });
  assert.strictEqual(direct.state, 'ready');
  assert.strictEqual(direct.weekStart, WEEK);
});
