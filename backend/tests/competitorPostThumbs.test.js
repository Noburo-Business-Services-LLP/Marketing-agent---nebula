// Competitor post pictures (services/competitors/postThumbs.js). Everything outside is faked: no network, no storage.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const T = require('../services/competitors/postThumbs');
const { competitorCard, workingPosts } = require('../services/competitors/bestPosts');
const { removeCompetitorsWithSnapshots } = require('../services/competitors/cleanup');
const { trackOne } = require('../services/competitors/tracker');
const { extractAssets } = require('../services/cloudinaryCleanup');
const { weekStartOf } = require('../services/week/weekMath');

const NOW = new Date('2026-10-19T06:00:00Z');
const DAY = 864e5;
const ID = '64b7f0c2a1b2c3d4e5f60718';
const ON = { ENABLE_COMPETITOR_THUMBS: 'on' };
const STORED = (key) => `https://res.cloudinary.com/demo/image/upload/v1760000000/nebula-competitor-posts/${key}.webp`;
const publicDns = async () => [{ address: '157.240.1.1', family: 4 }];
let jpg;
test.before(async () => { jpg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 238, g: 99, b: 48 } } }).jpeg({ quality: 90 }).toBuffer(); });

/** A raw post exactly as the weekly read returns it (field names from tests/fixtures/instagram-profile-real-nebulaa-os.json). */
const raw = (code, daysAgo, likes, comments, extra = {}) => ({
  id: code, type: 'Image', shortCode: code, url: `https://www.instagram.com/p/${code}/`, likesCount: likes, commentsCount: comments,
  timestamp: new Date(NOW - daysAgo * DAY).toISOString(), displayUrl: `https://scontent-bom1-1.cdninstagram.com/v/t51/${code}_n.jpg?oh=SIG`, images: [], isPinned: false, ...extra
});

function fakes(over = {}) {
  const calls = { put: [], removed: [], saved: [], requests: [] };
  const storage = {
    put: async (key, buf) => { calls.put.push([key, buf.length]); if (over.putFails) throw new Error('down'); return STORED(key); },
    remove: async (urls) => { calls.removed.push(...urls); return { requested: urls.length, failedBatches: 0 }; }
  };
  const save = async (id, list) => { calls.saved.push([String(id), list]); return { matchedCount: over.gone ? 0 : 1 }; };
  const request = async (u, o) => { calls.requests.push([u, o]); return over.request ? over.request(u, o) : { status: 200, headers: { 'content-type': 'image/jpeg' }, body: jpg }; };
  return { calls, deps: { env: over.env || ON, storage, save, request, resolve: over.resolve || publicDns, countStored: over.countStored || (async () => 0) } };
}

test('the real read carries displayUrl and images on each post (field names verified, never invented)', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/instagram-profile-real-nebulaa-os.json'), 'utf8'));
  const posts = fx.data[0].latestPosts;
  assert.ok(posts.length > 0);
  for (const p of posts) { assert.ok('displayUrl' in p, 'displayUrl'); assert.ok(Array.isArray(p.images), 'images'); assert.ok(!('thumbnailUrl' in p)); }
  // A real-looking source is picked from displayUrl; an unsafe host is never picked.
  assert.match(T.sourceOf(raw('A1', 1, 1, 1)), /cdninstagram\.com/);
  assert.strictEqual(T.sourceOf({ displayUrl: 'https://evil.com/x.jpg', images: ['http://scontent.cdninstagram.com/x.jpg'] }), '');
  assert.match(T.sourceOf({ displayUrl: '[url removed]', images: ['https://instagram.fbom1-1.fna.fbcdn.net/x.jpg'] }), /fbcdn/);
});

test('the switch: off unless exactly "on"; when off nothing is read, fetched or stored', async () => {
  for (const v of [undefined, '', 'true', '1', 'yes', 'ON ', 'off']) assert.strictEqual(T.thumbsEnabled({ ENABLE_COMPETITOR_THUMBS: v }), v === 'ON ' ? false : false, String(v));
  assert.strictEqual(T.thumbsEnabled(ON), true);
  const f = fakes({ env: {} });
  const r = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: [raw('A1', 1, 50, 2)] }, now: NOW, deps: f.deps });
  assert.deepStrictEqual(r, { ok: false, skipped: 'switched_off' });
  assert.strictEqual(f.calls.requests.length + f.calls.put.length + f.calls.saved.length, 0);
});

test('chooses the best of this week, the best 3 of 30 days and the latest 3, at most six', () => {
  const p = (key, daysAgo, likes, comments = 0) => ({ key, at: new Date(NOW - daysAgo * DAY), likes, comments });
  const posts = [p('new1', 0.1, 1), p('new2', 0.2, 2), p('new3', 0.3, 3), p('top1', 10, 900), p('top2', 12, 800), p('top3', 14, 700), p('top4', 15, 600), p('old', 40, 5000), p('hidden', 1, null)];
  const keys = T.chooseKeys(posts, { now: NOW, max: 6 });
  assert.strictEqual(keys.length, 6);
  assert.deepStrictEqual(keys.slice(0, 4), ['new3', 'top1', 'top2', 'top3']); // best of the week first, then best 3
  for (const k of ['new1', 'new2']) assert.ok(keys.includes(k));
  assert.ok(!keys.includes('old'), 'older than 30 days and not among the latest is never chosen');
  assert.ok(!keys.includes('top4'));
  assert.deepStrictEqual(T.chooseKeys([], { now: NOW }), []);
  assert.strictEqual(T.chooseKeys(posts, { now: NOW, max: 2 }).length, 2);
});

test('fetch, resize to 360 x 450 WebP within 40 KB, store under our folder; Instagram links never stored', async () => {
  const f = fakes();
  const c = { _id: ID };
  const r = await T.refreshPostThumbs({ competitor: c, profile: { latestPosts: [raw('A1', 1, 50, 2), raw('A2', 2, 10, 0)] }, now: NOW, deps: f.deps });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 2);
  assert.deepStrictEqual(f.calls.put.map((x) => x[0]).sort(), [`${ID}-p-A1`, `${ID}-p-A2`]);
  for (const [, size] of f.calls.put) assert.ok(size > 0 && size <= T.MAX_STORED_BYTES, `size ${size}`);
  const [, list] = f.calls.saved[0];
  assert.deepStrictEqual(list.map((t) => t.postKey), ['p-A1', 'p-A2']);
  for (const t of list) { assert.ok(T.isStoredThumbUrl(t.thumbUrl)); assert.ok(!JSON.stringify(t).includes('cdninstagram')); }
  // The download asked for at most the source cap.
  for (const [, o] of f.calls.requests) assert.ok(o.maxBytes <= T.MAX_SOURCE_BYTES && o.timeoutMs <= T.TIMEOUT_MS);
  const out = await T.resizeThumb(jpg);
  const meta = await sharp(out).metadata();
  assert.deepStrictEqual([meta.width, meta.height, meta.format], [360, 450, 'webp']);
});

test('safe download: private address, bad type, too big and a redirect off the allow-list store nothing', async () => {
  const cases = [
    { resolve: async () => [{ address: '10.0.0.5' }] },
    { request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>') }) },
    { request: async () => ({ status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(T.MAX_SOURCE_BYTES + 1) }, body: jpg }) },
    { request: async () => ({ status: 302, headers: { location: 'https://evil.com/x.jpg' }, body: Buffer.alloc(0) }) },
    { request: async () => ({ status: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('not a picture') }) }
  ];
  for (const over of cases) {
    const f = fakes(over);
    const r = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: [raw('A1', 1, 50, 2)] }, now: NOW, deps: f.deps });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.added, 0);
    assert.strictEqual(f.calls.put.length, 0);
  }
});

test('caps: never more than six per competitor; none added once the global cap is reached or unknown', async () => {
  const many = Array.from({ length: 12 }, (_, i) => raw(`M${i}`, i * 0.4, 10 + i * 10, 0));
  let f = fakes();
  let r = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: many }, now: NOW, deps: f.deps });
  assert.strictEqual(r.added, 6);
  assert.strictEqual(f.calls.put.length, 6);
  f = fakes({ countStored: async () => 3000 });
  r = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: many }, now: NOW, deps: f.deps });
  assert.strictEqual(f.calls.put.length, 0);
  f = fakes({ countStored: async () => 2998 });
  r = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: many }, now: NOW, deps: f.deps });
  assert.strictEqual(f.calls.put.length, 2);
  f = fakes({ countStored: async () => { throw new Error('db'); } });
  r = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: many }, now: NOW, deps: f.deps });
  assert.strictEqual(f.calls.put.length, 0);
});

test('weekly refresh: a stored post is never fetched again; a post that drops out is deleted', async () => {
  const keep = { postKey: 'p-A1', thumbUrl: STORED(`${ID}-p-A1`), at: new Date(NOW - 7 * DAY) };
  const gone = { postKey: 'p-OLD', thumbUrl: STORED(`${ID}-p-OLD`), at: new Date(NOW - 7 * DAY) };
  const f = fakes();
  const c = { _id: ID, postThumbs: [keep, gone] };
  const r = await T.refreshPostThumbs({ competitor: c, profile: { latestPosts: [raw('A1', 1, 50, 2), raw('A2', 2, 10, 0)] }, now: NOW, deps: f.deps });
  assert.deepStrictEqual([r.added, r.kept, r.removed], [1, 1, 1]);
  assert.deepStrictEqual(f.calls.put.map((x) => x[0]), [`${ID}-p-A2`]);
  assert.deepStrictEqual(f.calls.removed, [gone.thumbUrl]);
  assert.deepStrictEqual(c.postThumbs.map((t) => t.postKey), ['p-A1', 'p-A2']);
  // Nothing changed: no write, no download.
  const f2 = fakes();
  const r2 = await T.refreshPostThumbs({ competitor: c, profile: { latestPosts: [raw('A1', 1, 50, 2), raw('A2', 2, 10, 0)] }, now: NOW, deps: f2.deps });
  assert.deepStrictEqual([r2.added, r2.removed], [0, 0]);
  assert.strictEqual(f2.calls.saved.length + f2.calls.requests.length, 0);
});

test('a best post kept from an older stored week keeps its picture even when it is not in this read', async () => {
  const best = { postKey: 'p-BIG', thumbUrl: STORED(`${ID}-p-BIG`), at: new Date(NOW - 10 * DAY) };
  const snapshots = [{ weekStart: weekStartOf(new Date(NOW - 10 * DAY)), posts: [{ at: new Date(NOW - 10 * DAY), type: 'image', likes: 5000, comments: 10, url: 'https://www.instagram.com/p/BIG/' }] }];
  const f = fakes();
  const c = { _id: ID, postThumbs: [best] };
  await T.refreshPostThumbs({ competitor: c, profile: { latestPosts: [raw('A1', 1, 5, 0)] }, snapshots, now: NOW, deps: f.deps });
  assert.ok(c.postThumbs.some((t) => t.postKey === 'p-BIG'));
  assert.strictEqual(f.calls.removed.length, 0);
});

test('a competitor removed or ignored while it worked keeps nothing; failures never throw', async () => {
  const f = fakes({ gone: true });
  const r = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: [raw('A1', 1, 50, 2)] }, now: NOW, deps: f.deps });
  assert.deepStrictEqual(r, { ok: false, skipped: 'not_tracked' });
  assert.deepStrictEqual(f.calls.removed, [STORED(`${ID}-p-A1`)]);
  assert.deepStrictEqual((await T.refreshPostThumbs({ competitor: { _id: ID, isIgnored: true }, profile: {}, now: NOW, deps: fakes().deps })), { ok: false, skipped: 'not_tracked' });
  const bad = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: [raw('A1', 1, 50, 2)] }, now: NOW, deps: { ...fakes().deps, save: async () => { throw new Error('db down'); } } });
  assert.deepStrictEqual(bad, { ok: false, reason: 'error' });
  const putFails = fakes({ putFails: true });
  const r3 = await T.refreshPostThumbs({ competitor: { _id: ID }, profile: { latestPosts: [raw('A1', 1, 50, 2)] }, now: NOW, deps: putFails.deps });
  assert.strictEqual(r3.added, 0);
});

test('deletion: with the competitor (cleanup), on ignore or a new handle (dropThumbs), and with the account (erase finds the folder)', async () => {
  const url = STORED(`${ID}-p-A1`);
  const removed = [];
  const Competitor = { find: () => ({ select: () => ({ lean: async () => [{ _id: ID, avatarUrl: null, postThumbs: [{ postKey: 'p-A1', thumbUrl: url }] }] }) }), deleteMany: async () => ({ deletedCount: 1 }) };
  await removeCompetitorsWithSnapshots({ userId: 'u1' }, { Competitor, Snapshot: { deleteMany: async () => ({}) }, removeAvatars: async () => ({}), removeThumbs: async (u) => { removed.push(...u); } });
  assert.deepStrictEqual(removed, [url]);
  const updates = []; const deleted = [];
  const out = await T.dropThumbs({ _id: ID, postThumbs: [{ postKey: 'p-A1', thumbUrl: url }, { postKey: 'p-X', thumbUrl: 'https://scontent.cdninstagram.com/x.jpg' }] },
    { Competitor: { updateOne: async (q, u) => { updates.push(u); } }, storage: { remove: async (u) => { deleted.push(...u); } } });
  assert.strictEqual(out.dropped, 1);
  assert.deepStrictEqual(updates, [{ $unset: { postThumbs: '' } }]);
  assert.deepStrictEqual(deleted, [url], 'only our own links are ever deleted');
  assert.deepStrictEqual(extractAssets(JSON.stringify({ postThumbs: [{ thumbUrl: url }] })), [{ resourceType: 'image', publicId: `nebula-competitor-posts/${ID}-p-A1` }]);
});

test('the tracker hands the read it already made to the post pictures, after a good read only', async () => {
  const seen = [];
  const competitor = { _id: ID, userId: 'u1', name: 'Rival', socialHandles: { instagram: 'rival' }, handleStatus: 'confirmed', tracking: {} };
  const profile = { followersCount: 100, postsCount: 2, latestPosts: [raw('A1', 1, 50, 2)] };
  const deps = {
    scrapeProfile: async () => ({ success: true, data: [profile] }),
    store: { save: async () => ({}), prune: async () => {}, latest: async () => [{ weekStart: '2026-10-19', posts: [] }] },
    saveTracking: async () => {}, refreshAvatar: async () => ({}),
    refreshPostThumbs: async (args) => { seen.push(args); return { ok: true }; }, env: ON
  };
  await trackOne({ competitor, user: { _id: 'u1' }, now: NOW, deps });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].profile, profile);
  assert.strictEqual(seen[0].snapshots.length, 1);
  await trackOne({ competitor, user: { _id: 'u1' }, now: NOW, deps: { ...deps, scrapeProfile: async () => ({ success: true, data: [{ error: 'not found' }] }) } });
  assert.strictEqual(seen.length, 1, 'a failed read touches no picture');
});

test('the read model: thumbUrl only from our stored links and only when the switch is on; gallery of best and latest', () => {
  const at = (d) => new Date(NOW - d * DAY);
  const snap = { weekStart: weekStartOf(NOW), takenAt: NOW, ok: true, followers: 500, posts: [
    { at: at(0.2), type: 'video', likes: 900, comments: 40, url: 'https://www.instagram.com/p/R1/' },
    { at: at(3), type: 'image', likes: 300, comments: 1, url: 'https://www.instagram.com/p/I1/' },
    { at: at(5), type: 'carousel', likes: 200, comments: 0, url: 'https://www.instagram.com/p/C1/' },
    { at: at(6), type: 'image', likes: 2, comments: 0, url: 'https://www.instagram.com/p/I2/' },
    { at: at(7), type: 'image', likes: 1, comments: 0, url: 'https://www.instagram.com/p/I3/' }
  ] };
  const competitor = { _id: ID, name: 'Rival', socialHandles: { instagram: 'rival' }, postThumbs: [
    { postKey: 'p-R1', thumbUrl: STORED(`${ID}-p-R1`) }, { postKey: 'p-I1', thumbUrl: 'https://scontent.cdninstagram.com/hot.jpg' }
  ] };
  const on = competitorCard({ competitor, status: 'tracking', snapshots: [snap], now: NOW, thumbs: T.thumbMap(competitor, { on: true }) });
  assert.strictEqual(on.bestPost.thumbUrl, STORED(`${ID}-p-R1`));
  assert.deepStrictEqual(on.gallery.map((g) => [g.pick, g.url.split('/p/')[1], g.thumbUrl ? 'ours' : null]), [
    ['best', 'R1/', 'ours'], ['best', 'I1/', null], ['best', 'C1/', null], ['latest', 'I2/', null], ['latest', 'I3/', null]
  ]);
  assert.ok(!JSON.stringify(on).includes('cdninstagram'), 'a hotlink is never passed on');
  const work = workingPosts([on]);
  assert.strictEqual(work[0].thumbUrl, STORED(`${ID}-p-R1`));
  const off = competitorCard({ competitor, status: 'tracking', snapshots: [snap], now: NOW, thumbs: T.thumbMap(competitor, { on: false }) });
  assert.strictEqual(off.bestPost.thumbUrl, null);
  assert.ok(off.gallery.every((g) => g.thumbUrl === null));
  assert.strictEqual(workingPosts([off])[0].thumbUrl, null);
});

test('the module makes no call of its own outside the shared safe download and storage', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/competitors/postThumbs.js'), 'utf8');
  assert.doesNotMatch(src, /require\(['"](https?|node-fetch|axios)['"]\)|\bfetch\(/);
  assert.match(src, /fetchImage/);
});
