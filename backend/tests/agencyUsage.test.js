const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const u = require('../services/agencyUsage');
const { QUARK_COSTS, outputsFor } = require('../config/apiCosts');

const IMG = QUARK_COSTS.image_generated;
const VID = QUARK_COSTS.studio_video;

test('every action named in the usage lists is a real Quark action', () => {
  for (const a of [...u.POST_ACTIONS, ...u.VIDEO_ACTIONS]) assert.ok(a in QUARK_COSTS && QUARK_COSTS[a] > 0, a);
});

test('usage is summed per client: posts, videos and Quarks, refunds taken off', () => {
  const rows = [
    { workspace: 'w1', type: 'spend', action: 'image_generated', quarks: -IMG },
    { workspace: 'w1', type: 'spend', action: 'image_generated', quarks: -IMG },
    { workspace: 'w1', type: 'spend', action: 'studio_video', quarks: -VID },
    { workspace: 'w2', type: 'spend', action: 'image_generated', quarks: -IMG },
    { workspace: 'w1', type: 'refund', action: 'image_generated', quarks: IMG },
    { workspace: null, type: 'spend', action: 'image_generated', quarks: -IMG }
  ];
  const s = u.summarise(rows, [{ id: 'w1', name: 'Sweet Co' }, { id: 'w2', name: 'Tea House' }, { id: 'w3', name: 'Quiet' }]);
  assert.deepStrictEqual(s.find((c) => c.id === 'w1'), { id: 'w1', name: 'Sweet Co', posts: 1, videos: 1, quarksSpent: 2 * IMG + VID - IMG });
  assert.deepStrictEqual(s.find((c) => c.id === 'w2'), { id: 'w2', name: 'Tea House', posts: 1, videos: 0, quarksSpent: IMG });
  assert.deepStrictEqual(s.find((c) => c.id === 'w3'), { id: 'w3', name: 'Quiet', posts: 0, videos: 0, quarksSpent: 0 });
  assert.strictEqual(s.length, 3, 'the agency\'s own spending is not a client');
});

test('a charge for several posts counts every post, and a refund named like a video refund counts as a video back', () => {
  const rows = [
    { workspace: 'w1', type: 'spend', action: 'campaign_full', quarks: -QUARK_COSTS.campaign_full * 4 },
    { workspace: 'w1', type: 'spend', action: 'studio_video', quarks: -VID },
    { workspace: 'w1', type: 'refund', action: 'studio_video_refund', quarks: VID }
  ];
  const [c] = u.summarise(rows, [{ id: 'w1', name: 'A' }]);
  assert.strictEqual(c.posts, 4);
  assert.strictEqual(c.videos, 0);
  assert.strictEqual(c.quarksSpent, QUARK_COSTS.campaign_full * 4);
});

test('spend on a client that no longer exists is kept under one plain Removed client line', () => {
  const rows = [
    { workspace: 'gone1', type: 'spend', action: 'image_generated', quarks: -IMG },
    { workspace: 'gone2', type: 'spend', action: 'studio_video', quarks: -VID }
  ];
  const s = u.summarise(rows, [{ id: 'w1', name: 'A' }]);
  assert.deepStrictEqual(s.find((c) => c.removed), { id: 'removed', name: 'Removed client', removed: true, posts: 1, videos: 1, quarksSpent: IMG + VID });
  assert.ok(!s.some((c) => /gone/.test(JSON.stringify(c))), 'the removed ids are not shown');
});

test('the CSV has a header, one line per client, quotes names with commas and never starts a cell with a formula character', () => {
  const csv = u.toCsv([{ id: 'w1', name: 'Sweet, Co', posts: 2, videos: 1, quarksSpent: 183 }, { id: 'w2', name: '=HYPERLINK("x")', posts: 0, videos: 0, quarksSpent: 0 }], 'October 2026');
  const lines = csv.trim().split('\n');
  assert.strictEqual(lines[0], 'Client,Posts,Videos');
  assert.strictEqual(lines[1], '"Sweet, Co",2,1');
  assert.ok(lines[2].startsWith(`"'=`) || lines[2].startsWith("'="), lines[2]);
  assert.ok(!/quark/i.test(csv), 'customers see posts and videos, not Quarks');
});

test('month parsing accepts YYYY-MM only and falls back to the current month', () => {
  assert.deepStrictEqual(u.monthRange('2026-10', new Date('2026-12-01')), { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-11-01T00:00:00.000Z'), label: 'October 2026', key: '2026-10' });
  assert.strictEqual(u.monthRange('nonsense', new Date('2026-12-15T00:00:00Z')).label, 'December 2026');
  assert.strictEqual(u.monthRange('2026-13', new Date('2026-12-15T00:00:00Z')).key, '2026-12');
  assert.strictEqual(u.monthRange({ $ne: 1 }, new Date('2026-12-15T00:00:00Z')).key, '2026-12');
});

// ---- in-memory models: the two calls the service makes against the ledger and the users ----
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function ledgerOf(rows) {
  return {
    seen: [],
    async aggregate(pipeline) {
      this.seen.push(pipeline);
      const m = pipeline.find((s) => s.$match).$match;
      const g = pipeline.find((s) => s.$group).$group;
      assert.ok(m.user, 'every ledger read is limited to the agency account');
      const kept = rows.filter((r) => String(r.user) === String(m.user)
        && (!m.workspace || !('$ne' in m.workspace) || (r.workspace != null))
        && (!m.type || m.type.$in.includes(r.type))
        && (!m.createdAt || (r.createdAt >= m.createdAt.$gte && r.createdAt < m.createdAt.$lt)));
      const out = new Map();
      for (const r of kept) {
        const key = `${r.workspace}|${r.type}|${r.action}`;
        const o = out.get(key) || { _id: { workspace: r.workspace, type: r.type, action: r.action }, quarks: 0, last: null };
        o.quarks += r.quarks; o.last = !o.last || r.createdAt > o.last ? r.createdAt : o.last;
        out.set(key, o);
      }
      assert.ok(g.quarks && g.last);
      return [...out.values()];
    }
  };
}
const usersOf = (list) => ({ find: (q) => ({ sort: () => ({ lean: async () => list.filter((x) => String(get(x, 'agency.ownerId')) === String(q['agency.ownerId'])) }) }) });

function world() {
  const ownerId = 'own1'; const other = 'own2';
  const ws = (id, name, at, extra = {}) => ({ _id: id, createdAt: new Date(at), agency: { ownerId, workspaceName: name, ...extra } });
  const users = [ws('w1', 'Sweet Co', '2026-01-01'), ws('w2', 'Tea House', '2026-01-02'), ws('w3', 'Quiet', '2026-01-03'), { _id: 'x1', createdAt: new Date('2026-01-01'), agency: { ownerId: other, workspaceName: 'Rival client' } }];
  const t = (d) => new Date(`2026-${d}T10:00:00Z`);
  const L = (user, workspace, type, action, quarks, d) => ({ user, workspace, type, action, quarks, createdAt: t(d) });
  const rows = [
    L(ownerId, 'w1', 'spend', 'image_generated', -IMG, '10-03'), L(ownerId, 'w1', 'spend', 'image_generated', -IMG, '10-04'),
    L(ownerId, 'w1', 'spend', 'studio_video', -VID, '10-05'), L(ownerId, 'w1', 'refund', 'image_generated', IMG, '10-06'),
    L(ownerId, 'w1', 'spend', 'image_generated', -IMG, '09-20'),
    L(ownerId, 'w2', 'spend', 'image_generated', -IMG, '10-07'),
    L(ownerId, 'gone', 'spend', 'image_generated', -IMG, '10-08'),
    L(ownerId, undefined, 'spend', 'image_generated', -IMG, '10-09'), // the agency's own use
    L(ownerId, undefined, 'purchase', 'topup', 6000, '10-01'), L(ownerId, undefined, 'grant', 'plan', 6000, '10-01'),
    L(other, 'x1', 'spend', 'image_generated', -IMG, '10-03'), L(other, undefined, 'purchase', 'topup', 500, '10-03')
  ];
  return { ownerId, owner: { _id: ownerId, plan: { tier: 'agency' }, credits: { balance: 4200 } }, models: { User: usersOf(users), QuarkLedger: ledgerOf(rows) }, rows };
}
const NOW = new Date('2026-10-20T00:00:00Z');

test('a month report shows this month, all time, last active, and only this agency\'s clients', async () => {
  const { owner, models } = world();
  const r = await u.usageForMonth({ owner, month: '2026-10', models, now: NOW });
  assert.strictEqual(r.month, '2026-10');
  assert.strictEqual(r.monthLabel, 'October 2026');
  const byName = Object.fromEntries(r.clients.map((c) => [c.name, c]));
  assert.ok(!byName['Rival client'], 'another agency\'s client never appears');
  assert.deepStrictEqual(byName['Sweet Co'], { id: 'w1', name: 'Sweet Co', frozen: false, posts: 1, videos: 1, quarksSpent: IMG + VID, total: { posts: 2, videos: 1, quarksSpent: 2 * IMG + VID }, lastActive: new Date('2026-10-05T10:00:00Z').toISOString() });
  assert.strictEqual(byName.Quiet.lastActive, null);
  assert.strictEqual(byName.Quiet.quarksSpent, 0);
  assert.deepStrictEqual(byName['Removed client'], { id: 'removed', name: 'Removed client', removed: true, frozen: false, posts: 1, videos: 0, quarksSpent: IMG, total: { posts: 1, videos: 0, quarksSpent: IMG }, lastActive: new Date('2026-10-08T10:00:00Z').toISOString() });
  assert.strictEqual(r.total, 4);
  for (const c of r.clients) for (const n of [c.posts, c.videos, c.quarksSpent, c.total.posts, c.total.videos, c.total.quarksSpent]) assert.ok(Number.isInteger(n));
});

test('a limited page returns part of the list and says whether there is more', async () => {
  const { owner, models } = world();
  const p1 = await u.usageForMonth({ owner, month: '2026-10', models, now: NOW, page: 1, limit: 2 });
  assert.deepStrictEqual(p1.clients.map((c) => c.name), ['Sweet Co', 'Tea House']);
  assert.strictEqual(p1.hasMore, true);
  const p2 = await u.usageForMonth({ owner, month: '2026-10', models, now: NOW, page: 2, limit: 2 });
  assert.deepStrictEqual(p2.clients.map((c) => c.name), ['Quiet', 'Removed client']);
  assert.strictEqual(p2.hasMore, false);
  const wild = await u.usageForMonth({ owner, month: '2026-10', models, now: NOW, page: -4, limit: 100000 });
  assert.strictEqual(wild.page, 1);
  assert.ok(wild.limit <= u.MAX_PAGE);
});

test('the report is read with two ledger queries however many clients there are', async () => {
  const { owner, models } = world();
  await u.usageForMonth({ owner, month: '2026-10', models, now: NOW });
  assert.strictEqual(models.QuarkLedger.seen.length, 2);
});

test('per-client usage over all time adds up to the pool\'s total spend, less the agency\'s own use', async () => {
  const { owner, ownerId, models, rows } = world();
  const r = await u.usageForMonth({ owner, month: '2026-10', models, now: NOW });
  const clientsTotal = r.clients.reduce((s, c) => s + c.total.quarksSpent, 0);
  const own = rows.filter((x) => x.user === ownerId && !x.workspace && (x.type === 'spend' || x.type === 'refund')).reduce((s, x) => s - x.quarks, 0);
  const pool = rows.filter((x) => x.user === ownerId && (x.type === 'spend' || x.type === 'refund')).reduce((s, x) => s - x.quarks, 0);
  assert.strictEqual(clientsTotal + own, pool);
  assert.strictEqual(r.clients.reduce((s, c) => s + c.quarksSpent, 0), IMG + VID + IMG + IMG);
});

test('the pool figures are whole numbers, shown as posts and videos', async () => {
  const { owner, models } = world();
  const r = await u.usageForMonth({ owner, month: '2026-10', models, now: NOW });
  assert.strictEqual(r.poolLeft, 4200);
  assert.strictEqual(r.poolPosts, outputsFor(4200).posts);
  assert.strictEqual(r.poolVideos, outputsFor(4200).videos);
});

test('nothing but posts, videos and names leaves the service for other accounts: no top-ups, no balances of others', async () => {
  const { owner, models } = world();
  const r = await u.usageForMonth({ owner, month: '2026-10', models, now: NOW });
  const text = JSON.stringify(r);
  assert.ok(!/topup|purchase|grant|own2|x1|Rival/.test(text));
});

// ---- the routes ----
const authPath = require.resolve('../middleware/auth');
let current = {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { protect: (req, _res, next) => { req.user = current.user; if (current.acting) req.actingAgency = current.acting; next(); } } };
const del = require('../services/accountDeletion');
const W = world();
const asAgency = { _id: W.ownerId, plan: { tier: 'agency' }, credits: { balance: 4200 } };
const usersById = { [W.ownerId]: asAgency, w1: { _id: 'w1', plan: { tier: 'agency' }, agency: { ownerId: W.ownerId } }, plain: { _id: 'plain', plan: { tier: 'growth' } } };
del.defaultModels = () => ({ User: { ...W.models.User, findById: async (id) => usersById[String(id)] || null }, QuarkLedger: W.models.QuarkLedger });
function serve() {
  const express = require('express');
  const app = express();
  app.use('/api/agency', require('../routes/agency'));
  return new Promise((ok) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => ok(s)); });
}
const call = (s, path) => new Promise((ok, no) => http.get(`http://127.0.0.1:${s.address().port}${path}`, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b })); }).on('error', no));

test('routes: an agency reads its report as JSON and as CSV, and a request id cannot change whose it is', async () => {
  const s = await serve();
  try {
    current = { user: usersById[W.ownerId] };
    const j = await call(s, '/api/agency/usage?month=2026-10&owner=own2&user=own2&agency=own2&workspace=x1');
    assert.strictEqual(j.status, 200);
    const body = JSON.parse(j.body);
    assert.strictEqual(body.success, true);
    assert.deepStrictEqual(body.clients.map((c) => c.name), ['Sweet Co', 'Tea House', 'Quiet', 'Removed client']);
    const c = await call(s, '/api/agency/usage.csv?month=2026-10&limit=1');
    assert.strictEqual(c.status, 200);
    assert.match(c.headers['content-disposition'], /attachment; filename="client-usage-2026-10\.csv"/);
    assert.match(c.headers['content-type'], /text\/csv/);
    const lines = c.body.trim().split('\n');
    assert.strictEqual(lines.length, 5, 'every client is in the file whatever limit is asked for');
    assert.ok(!/quark/i.test(c.body));
  } finally { s.close(); }
});

test('routes: a plain account, a client and a pass into a client are all refused', async () => {
  const s = await serve();
  try {
    current = { user: usersById.plain };
    assert.strictEqual((await call(s, '/api/agency/usage')).status, 403);
    assert.strictEqual((await call(s, '/api/agency/usage.csv')).status, 403);
    current = { user: usersById.w1 };
    assert.strictEqual((await call(s, '/api/agency/usage')).status, 403);
    current = { user: usersById.w1, acting: usersById[W.ownerId] };
    assert.strictEqual((await call(s, '/api/agency/usage')).status, 403);
  } finally { s.close(); }
});

test('routes: the usage paths are blocked inside a client pass', () => {
  const { isBlockedInsideClient } = require('../services/agencyWorkspaces');
  assert.strictEqual(isBlockedInsideClient('/api/agency/usage', 'GET'), true);
  assert.strictEqual(isBlockedInsideClient('/api/agency/usage.csv?month=2026-10', 'GET'), true);
});
