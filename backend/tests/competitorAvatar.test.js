// Competitor profile pictures (services/competitors/avatar.js). Everything outside is faked: no network, no storage.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const A = require('../services/competitors/avatar');
const { trackOne } = require('../services/competitors/tracker');
const { removeCompetitorsWithSnapshots } = require('../services/competitors/cleanup');
const { createHandleRouter } = require('../routes/competitorHandle');
const { extractAssets } = require('../services/cloudinaryCleanup');
const { erasable } = require('../services/dataRegistry');
const { competitorCard } = require('../services/competitors/bestPosts');

const NOW = new Date('2026-10-19T06:00:00Z');
const DAY = 864e5;
const SRC = 'https://scontent-bom1-1.cdninstagram.com/v/t51.2885-19/123_n.jpg?stp=dst-jpg&_nc_ht=x&oh=SIG1';
const SRC_SAME_PIC = 'https://scontent-del2-1.cdninstagram.com/v/t51.2885-19/123_n.jpg?oh=SIG2&oe=OTHER';
const SRC_NEW_PIC = 'https://scontent-bom1-1.cdninstagram.com/v/t51.2885-19/456_n.jpg?oh=SIG3';
const STORED = (id) => `https://res.cloudinary.com/demo/image/upload/v1760000000/nebula-competitor-avatars/${id}.webp`;
const ID = '64b7f0c2a1b2c3d4e5f60718';

const publicDns = async () => [{ address: '157.240.1.1', family: 4 }];
const ok = (body, type = 'image/jpeg', extra = {}) => async () => ({ status: 200, headers: { 'content-type': type, ...extra }, body });
let png;
test.before(async () => { png = await sharp({ create: { width: 150, height: 150, channels: 3, background: { r: 245, g: 166, b: 35 } } }).png().toBuffer(); });

function fakes(over = {}) {
  const calls = { put: [], removed: [], saved: [], requests: [] };
  const storage = { put: async (key, buf) => { calls.put.push([key, buf.length]); if (over.putFails) throw new Error('store down'); return STORED(key); }, remove: async (urls) => { calls.removed.push(...urls); return { requested: urls.length, failedBatches: 0 }; } };
  const save = async (id, fields) => { calls.saved.push([String(id), fields]); return { matchedCount: over.gone ? 0 : 1 }; };
  const request = async (u, o) => { calls.requests.push([u, o]); return over.request ? over.request(u, o) : ok(png, 'image/png')(); };
  return { calls, deps: { storage, save, request, resolve: over.resolve || publicDns } };
}

test('allow-list: only https on Instagram or Facebook picture hosts, no user, port or IP literal', () => {
  for (const u of [SRC, 'https://instagram.fbom1-1.fna.fbcdn.net/v/a.jpg', 'https://cdninstagram.com/a.jpg']) assert.ok(A.isAllowedUrl(u), u);
  for (const u of ['http://scontent.cdninstagram.com/a.jpg', 'https://evil.com/a.jpg', 'https://cdninstagram.com.evil.com/a.jpg', 'https://evilcdninstagram.com/a.jpg',
    'https://user:pw@scontent.cdninstagram.com/a.jpg', 'https://scontent.cdninstagram.com:8443/a.jpg', 'https://157.240.1.1/a.jpg', 'https://[::1]/a.jpg', 'ftp://x.fbcdn.net/a', '[url removed]', '', null]) {
    assert.ok(!A.isAllowedUrl(u), String(u));
  }
});

test('private addresses are refused (v4, v6 and v4 inside v6)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::10.0.0.1', 'nonsense']) {
    assert.ok(A.isPrivateAddress(ip), ip);
  }
  for (const ip of ['157.240.1.1', '31.13.79.35', '2a03:2880:f12f:83:face:b00c:0:25de', '172.32.0.1']) assert.ok(!A.isPrivateAddress(ip), ip);
});

test('fetch: a good picture comes back; a host that resolves to a private address is never requested (SSRF)', async () => {
  const got = await A.fetchImage(SRC, { request: ok(png, 'image/png; charset=binary'), resolve: publicDns });
  assert.strictEqual(got.type, 'image/png');
  let asked = 0;
  await assert.rejects(A.fetchImage(SRC, { request: async () => { asked++; return ok(png)(); }, resolve: async () => [{ address: '157.240.1.1' }, { address: '10.0.0.5' }] }), { code: 'private_address' });
  await assert.rejects(A.fetchImage(SRC, { request: async () => { asked++; return ok(png)(); }, resolve: async () => [{ address: '169.254.169.254' }] }), { code: 'private_address' });
  await assert.rejects(A.fetchImage(SRC, { request: async () => { asked++; return ok(png)(); }, resolve: async () => { throw new Error('ENOTFOUND'); } }), { code: 'dns' });
  await assert.rejects(A.fetchImage('https://evil.com/a.jpg', { request: async () => { asked++; return ok(png)(); }, resolve: publicDns }), { code: 'host_not_allowed' });
  assert.strictEqual(asked, 0);
});

test('fetch: the connect-time lookup refuses private addresses too', async () => {
  const dns = require('dns');
  const real = dns.lookup;
  dns.lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
  try {
    const err = await new Promise((r) => A.safeLookup('scontent.cdninstagram.com', {}, (e) => r(e)));
    assert.strictEqual(err.code, 'private_address');
    dns.lookup = (h, o, cb) => cb(null, [{ address: '157.240.1.1', family: 4 }]);
    const one = await new Promise((r) => A.safeLookup('scontent.cdninstagram.com', {}, (e, addr, fam) => r([e, addr, fam])));
    assert.deepStrictEqual(one, [null, '157.240.1.1', 4]);
    const all = await new Promise((r) => A.safeLookup('scontent.cdninstagram.com', { all: true }, (e, list) => r(list)));
    assert.deepStrictEqual(all, [{ address: '157.240.1.1', family: 4 }]);
  } finally { dns.lookup = real; }
});

test('fetch: redirects only to another allowed host, at most two', async () => {
  const hop = (to) => async () => ({ status: 302, headers: { location: to }, body: Buffer.alloc(0) });
  await assert.rejects(A.fetchImage(SRC, { request: hop('https://evil.com/x.jpg'), resolve: publicDns }), { code: 'redirect_not_allowed' });
  await assert.rejects(A.fetchImage(SRC, { request: hop('http://scontent.cdninstagram.com/x.jpg'), resolve: publicDns }), { code: 'redirect_not_allowed' });
  // to an allowed name that resolves privately
  let n = 0;
  await assert.rejects(A.fetchImage(SRC, { request: hop('https://internal.fbcdn.net/x.jpg'), resolve: async (h) => (n++ ? [{ address: '10.0.0.1' }] : [{ address: '157.240.1.1' }]) }), { code: 'private_address' });
  // one allowed hop is fine
  let calls = 0;
  const two = async () => (calls++ === 0 ? { status: 301, headers: { location: '/v/other.jpg' }, body: Buffer.alloc(0) } : { status: 200, headers: { 'content-type': 'image/jpeg' }, body: png });
  assert.ok((await A.fetchImage(SRC, { request: two, resolve: publicDns })).body.length);
  // a loop stops
  await assert.rejects(A.fetchImage(SRC, { request: hop(SRC), resolve: publicDns }), { code: 'too_many_redirects' });
});

test('fetch: size cap (declared or actual), bad type, bad status, empty', async () => {
  const big = Buffer.alloc(A.MAX_BYTES + 1, 1);
  await assert.rejects(A.fetchImage(SRC, { request: ok(big), resolve: publicDns }), { code: 'too_big' });
  await assert.rejects(A.fetchImage(SRC, { request: ok(png, 'image/jpeg', { 'content-length': String(A.MAX_BYTES + 5) }), resolve: publicDns }), { code: 'too_big' });
  for (const t of ['text/html', 'image/svg+xml', 'image/gif', 'application/octet-stream', '']) {
    await assert.rejects(A.fetchImage(SRC, { request: ok(png, t), resolve: publicDns }), { code: 'bad_type' }, t);
  }
  await assert.rejects(A.fetchImage(SRC, { request: async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }), resolve: publicDns }), { code: 'bad_status' });
  await assert.rejects(A.fetchImage(SRC, { request: ok(Buffer.alloc(0)), resolve: publicDns }), { code: 'empty' });
});

test('the real request gives up after the time limit and over the byte cap', async () => {
  const http = require('http');
  // A local plain server stands in; httpsGet is only used here to check the timer and the cap, not TLS.
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') return setTimeout(() => res.end('x'), 400);
    res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.alloc(5000, 1));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const https = require('https');
  const realGet = https.get;
  https.get = (url, opts, cb) => http.get(String(url).replace('https://x.cdninstagram.com', `http://127.0.0.1:${port}`), { headers: opts.headers }, cb);
  try {
    await assert.rejects(A.httpsGet('https://x.cdninstagram.com/slow', { timeoutMs: 100, maxBytes: 100000 }), { code: 'timeout' });
    await assert.rejects(A.httpsGet('https://x.cdninstagram.com/big', { timeoutMs: 2000, maxBytes: 1000 }), { code: 'too_big' });
    const r = await A.httpsGet('https://x.cdninstagram.com/big', { timeoutMs: 2000, maxBytes: 10000 });
    assert.strictEqual(r.body.length, 5000);
  } finally { https.get = realGet; server.close(); }
});

test('resize: 96 x 96 WebP from a real picture; something that is not a picture is refused', async () => {
  const out = await A.resizeImage(png);
  const meta = await sharp(out).metadata();
  assert.deepStrictEqual([meta.width, meta.height, meta.format], [96, 96, 'webp']);
  await assert.rejects(A.resizeImage(Buffer.from('<html>not a picture</html>')), { code: 'bad_image' });
});

test('refresh: the first picture is stored under the competitor key and only our link is saved', async () => {
  const f = fakes();
  const c = { _id: ID, isActive: true };
  const r = await A.refreshAvatar({ competitor: c, profile: { profilePicUrl: SRC, profilePicUrlHD: 'https://evil.com/x.jpg' }, now: NOW, deps: f.deps });
  assert.deepStrictEqual(r, { ok: true, url: STORED(ID) });
  assert.strictEqual(f.calls.put[0][0], ID);
  assert.ok(f.calls.put[0][1] > 0 && f.calls.put[0][1] < A.MAX_BYTES);
  assert.strictEqual(f.calls.saved.length, 1);
  const [, fields] = f.calls.saved[0];
  assert.strictEqual(fields.avatarUrl, STORED(ID));
  assert.strictEqual(+fields.avatarUpdatedAt, +NOW);
  assert.match(fields.avatarSourceKey, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(fields).includes('cdninstagram'), 'the Instagram link is never stored');
  assert.strictEqual(c.avatarUrl, STORED(ID));
});

test('refresh: falls back to the large picture, skips without any allowed link', async () => {
  const f = fakes();
  assert.strictEqual((await A.refreshAvatar({ competitor: { _id: ID }, profile: { profilePicUrl: '[url removed]', profilePicUrlHD: SRC }, now: NOW, deps: f.deps })).ok, true);
  const g = fakes();
  assert.deepStrictEqual(await A.refreshAvatar({ competitor: { _id: ID }, profile: { profilePicUrl: 'https://evil.com/a.jpg' }, now: NOW, deps: g.deps }), { ok: false, skipped: 'no_source' });
  assert.deepStrictEqual(await A.refreshAvatar({ competitor: { _id: ID }, profile: {}, now: NOW, deps: g.deps }), { ok: false, skipped: 'no_source' });
  assert.deepStrictEqual(await A.refreshAvatar({ competitor: { _id: ID, isIgnored: true }, profile: { profilePicUrl: SRC }, now: NOW, deps: g.deps }), { ok: false, skipped: 'not_tracked' });
  assert.strictEqual(g.calls.requests.length + g.calls.put.length + g.calls.saved.length, 0);
});

test('weekly rule: the same picture (new signature, other CDN host) is not fetched again; a changed one only after a week', async () => {
  const f = fakes();
  const c = { _id: ID };
  await A.refreshAvatar({ competitor: c, profile: { profilePicUrl: SRC }, now: NOW, deps: f.deps });
  const g = fakes();
  // same picture, a day later and a month later: nothing happens
  assert.deepStrictEqual(await A.refreshAvatar({ competitor: { ...c }, profile: { profilePicUrl: SRC_SAME_PIC }, now: new Date(+NOW + DAY), deps: g.deps }), { ok: false, skipped: 'unchanged' });
  assert.deepStrictEqual(await A.refreshAvatar({ competitor: { ...c }, profile: { profilePicUrl: SRC_SAME_PIC }, now: new Date(+NOW + 30 * DAY), deps: g.deps }), { ok: false, skipped: 'unchanged' });
  // a new picture two days later waits for the week
  assert.deepStrictEqual(await A.refreshAvatar({ competitor: { ...c }, profile: { profilePicUrl: SRC_NEW_PIC }, now: new Date(+NOW + 2 * DAY), deps: g.deps }), { ok: false, skipped: 'recent' });
  assert.strictEqual(g.calls.requests.length, 0);
  // a week later it is refreshed, under the same key
  const r = await A.refreshAvatar({ competitor: { ...c }, profile: { profilePicUrl: SRC_NEW_PIC }, now: new Date(+NOW + 7 * DAY), deps: g.deps });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(g.calls.put[0][0], ID);
  assert.notStrictEqual(g.calls.saved[0][1].avatarSourceKey, c.avatarSourceKey);
});

test('failures keep the old picture: nothing is saved and nothing throws', async () => {
  const old = { _id: ID, avatarUrl: STORED(ID), avatarUpdatedAt: new Date(+NOW - 10 * DAY), avatarSourceKey: 'old' };
  const cases = [
    ['bad_type', fakes({ request: ok(png, 'text/html') })],
    ['too_big', fakes({ request: ok(Buffer.alloc(A.MAX_BYTES + 1)) })],
    ['private_address', fakes({ resolve: async () => [{ address: '127.0.0.1' }] })],
    ['bad_image', fakes({ request: ok(Buffer.from('not a picture')) })],
    ['error', fakes({ putFails: true })],
    ['error', fakes({ request: async () => { throw new Error('socket hang up'); } })]
  ];
  for (const [reason, f] of cases) {
    const c = { ...old };
    const r = await A.refreshAvatar({ competitor: c, profile: { profilePicUrl: SRC_NEW_PIC }, now: NOW, deps: f.deps });
    assert.deepStrictEqual(r, { ok: false, reason }, reason);
    assert.strictEqual(f.calls.saved.length, 0, reason);
    assert.strictEqual(c.avatarUrl, STORED(ID), reason);
  }
  // storage answering with a link that is not ours is refused too
  const f = fakes();
  f.deps.storage.put = async () => 'https://scontent.cdninstagram.com/x.jpg';
  assert.deepStrictEqual(await A.refreshAvatar({ competitor: { _id: ID }, profile: { profilePicUrl: SRC }, now: NOW, deps: f.deps }), { ok: false, reason: 'store_failed' });
  assert.strictEqual(f.calls.saved.length, 0);
});

test('a competitor removed while the picture was made: the stored file is deleted again', async () => {
  const f = fakes({ gone: true });
  const r = await A.refreshAvatar({ competitor: { _id: ID }, profile: { profilePicUrl: SRC }, now: NOW, deps: f.deps });
  assert.deepStrictEqual(r, { ok: false, skipped: 'not_tracked' });
  assert.deepStrictEqual(f.calls.removed, [STORED(ID)]);
});

test('tracker: the picture is refreshed after a good read from the same profile, never on a failed read, and its failure never fails the read', async () => {
  const seen = [];
  const base = {
    caps: { KEEP_WEEKS: 12, FAIL_PAUSE_AFTER: 3 },
    store: { save: async (s) => s, prune: async () => {} },
    saveTracking: async () => {},
    refreshAvatar: async (a) => { seen.push(a); throw new Error('boom'); }
  };
  const profile = { followersCount: 10, postsCount: 1, profilePicUrl: SRC, latestPosts: [] };
  const c = { _id: ID, userId: 'u1', socialHandles: { instagram: 'sweetco' }, tracking: {} };
  const r = await trackOne({ competitor: c, user: { _id: 'u1' }, now: NOW, deps: { ...base, scrapeProfile: async () => ({ success: true, data: [profile] }) } });
  assert.deepStrictEqual(r, { ok: true, read: true });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].profile, profile, 'the profile already read is passed on: no second read');
  const bad = await trackOne({ competitor: { ...c, tracking: {} }, user: { _id: 'u1' }, now: NOW, deps: { ...base, scrapeProfile: async () => ({ success: true, data: [{ private: true, followersCount: 1 }] }) } });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(seen.length, 1, 'no picture for a failed read');
});

test('removal deletes the stored pictures with the competitors; nothing else is touched', async () => {
  const docs = [{ _id: 'a', userId: 'u1', avatarUrl: STORED('a') }, { _id: 'b', userId: 'u1' }, { _id: 'c', userId: 'u2', avatarUrl: STORED('c') }];
  const Competitor = {
    find: (f) => ({ select: () => ({ lean: async () => docs.filter((d) => d.userId === f.userId) }) }),
    deleteMany: async (f) => ({ deletedCount: docs.filter((d) => d.userId === f.userId).length })
  };
  const removed = [];
  const out = await removeCompetitorsWithSnapshots({ userId: 'u1' }, { Competitor, Snapshot: { deleteMany: async () => {} }, removeAvatars: async (urls) => { removed.push(...urls); } });
  assert.strictEqual(out.deletedCount, 2);
  assert.deepStrictEqual(removed, [STORED('a')]);
  // a storage failure never blocks the removal
  const out2 = await removeCompetitorsWithSnapshots({ userId: 'u1' }, { Competitor, Snapshot: { deleteMany: async () => {} }, removeAvatars: async () => { throw new Error('down'); } });
  assert.strictEqual(out2.deletedCount, 2);
});

test('removeAvatars only ever deletes our own avatar links', async () => {
  const removed = [];
  const storage = { remove: async (urls) => { removed.push(...urls); return { requested: urls.length, failedBatches: 0 }; } };
  await A.removeAvatars([STORED('a'), 'https://res.cloudinary.com/demo/image/upload/v1/nebula-campaign-posts/x.jpg', 'https://scontent.cdninstagram.com/x.jpg', null], { storage });
  assert.deepStrictEqual(removed, [STORED('a')]);
  const failing = await A.removeAvatars([STORED('a')], { storage: { remove: async () => { throw new Error('down'); } } });
  assert.strictEqual(failing.failedBatches, 1);
});

test('ignoring or re-pointing a competitor drops its picture', async () => {
  const updates = []; const removed = [];
  const Competitor = { updateOne: async (f, u) => { updates.push([f, u]); return { matchedCount: 1 }; } };
  const storage = { remove: async (urls) => { removed.push(...urls); } };
  assert.deepStrictEqual(await A.dropAvatar({ _id: ID, avatarUrl: STORED(ID) }, { Competitor, storage }), { dropped: true });
  assert.deepStrictEqual(updates[0][1], { $unset: { avatarUrl: '', avatarUpdatedAt: '', avatarSourceKey: '' } });
  assert.deepStrictEqual(removed, [STORED(ID)]);
  assert.deepStrictEqual(await A.dropAvatar({ _id: ID }, { Competitor, storage }), { dropped: false });

  // the handle route: a new handle drops it, the same handle keeps it
  const dropped = [];
  const doc = { _id: ID, userId: 'u1', name: 'Sweet Co', socialHandles: { instagram: 'sweetco' }, avatarUrl: STORED(ID) };
  const router = createHandleRouter({ Competitor: { findOne: async () => doc, updateOne: async () => ({}) }, dropAvatar: async (c) => dropped.push(c._id), loadUser: async () => ({ _id: 'u1', plan: { tier: 'growth' } }) });
  const layer = router.stack.find((l) => l.route && l.route.path === '/:id/handle');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const run = (handle) => new Promise((resolve) => handler({ params: { id: ID }, body: { handle }, user: { _id: 'u1' } }, { status() { return this; }, json: resolve }));
  await run('@sweetco');
  assert.strictEqual(dropped.length, 0);
  await run('someoneelse');
  assert.deepStrictEqual(dropped, [ID]);
});

test('account deletion: competitors are erased and their stored pictures are among the files deleted', () => {
  assert.ok(erasable().some((r) => r.model === 'Competitor'));
  const doc = { _id: ID, userId: 'u1', name: 'Sweet Co', avatarUrl: STORED(ID) };
  assert.deepStrictEqual(extractAssets(JSON.stringify(doc)), [{ resourceType: 'image', publicId: `nebula-competitor-avatars/${ID}` }]);
});

test('the API returns only our stored link (or null), never an outside one', () => {
  const card = (avatarUrl) => competitorCard({ competitor: { _id: ID, name: 'Sweet Co', socialHandles: { instagram: 'sweetco' }, avatarUrl }, status: 'waiting', snapshots: [], now: NOW });
  assert.strictEqual(card(STORED(ID)).avatarUrl, STORED(ID));
  for (const bad of [undefined, null, '', SRC, 'https://res.cloudinary.com/demo/image/upload/v1/nebula-campaign-posts/x.jpg', 'javascript:alert(1)', `${STORED(ID)}?x=1`]) {
    assert.strictEqual(card(bad).avatarUrl, null, String(bad));
  }
});
