// The four heavy staff pages through their real routes with the cache switched on by injection:
// each permission level keeps its own copy, a CSM only ever gets their own clients, refresh=1 re-reads,
// a staff change clears everything, errors are not kept, and with no cache the response has no extra field.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createStaffCache } = require('../services/staff/cache');

const OWNER = 'a'.repeat(24);
const ADMIN = 'b'.repeat(24);
const CSM1 = 'c'.repeat(24);
const CSM2 = '1'.repeat(24);
const MINE1 = 'd'.repeat(24);
const MINE2 = 'e'.repeat(24);
const NOBODY = 'f'.repeat(24);
const NOW = Date.now();
const ago = (d) => new Date(NOW - d * 86400000);

let docs = [];
let customerReads = 0;       // how many times the customer list was read from the "database"
let failAggregates = false;
const get = (o, k) => k.split('.').reduce((v, p) => (v == null ? v : v[p]), o);
function matches(d, q) {
  return Object.entries(q || {}).every(([k, cond]) => {
    if (k === '$or') return cond.some((c) => matches(d, c));
    const v = get(d, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('$ne' in cond) return String(v ?? null) !== String(cond.$ne);
      if ('$in' in cond) return cond.$in.map(String).includes(String(v));
    }
    return String(v ?? null) === String(cond ?? null);
  });
}
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const chain = (value) => { const p = Promise.resolve(value); p.select = () => p; p.lean = () => p; p.sort = () => p; return p; };
const User = {
  find: (q) => {
    if (q && q.staffRole === null) customerReads += 1;
    return chain(docs.filter((d) => matches(d, q)).map((d) => ({ ...d })));
  },
  findById: (id) => chain(docs.filter((d) => String(d._id) === String(id)).map((d) => ({ ...d }))[0] || null)
};
const agg = (name) => ({ aggregate: async () => { if (failAggregates) throw new Error('db hiccup'); return []; } });
stub('models/User', User);
stub('models/StaffAction', { create: async () => {} });
for (const n of ['FeatureEvent', 'Draft', 'Campaign', 'VideoJob', 'HeroVideoJob', 'Blueprint', 'SocialInboxMessage']) stub(`models/${n}`, agg(n));
stub('middleware/auth', { protect: (q, s, n) => n() });
const router = require('../routes/staff');

function seed() {
  customerReads = 0; failAggregates = false;
  docs = [
    { _id: OWNER, email: 'o@x.com', firstName: 'Olga', staffRole: 'owner', isHidden: true },
    { _id: ADMIN, email: 'a@x.com', firstName: 'Adam', staffRole: 'admin', isHidden: true },
    { _id: CSM1, email: 'c1@x.com', firstName: 'Cleo', staffRole: 'csm', isCsm: true, isHidden: true },
    { _id: CSM2, email: 'c2@x.com', firstName: 'Cass', staffRole: 'csm', isCsm: true, isHidden: true },
    { _id: MINE1, email: 'm1@x.com', companyName: 'Mine One', assignedCsm: CSM1, staffRole: null, createdAt: ago(3), onboardingCompleted: true, lastLoginAt: ago(1), credits: { balance: 500, history: [{ action: 'blueprint', amount: -60, createdAt: new Date(NOW - 1000) }] } },
    { _id: MINE2, email: 'm2@x.com', companyName: 'Mine Two', assignedCsm: CSM2, staffRole: null, createdAt: ago(4), onboardingCompleted: true, lastLoginAt: ago(1), credits: { balance: 500 } },
    { _id: NOBODY, email: 'n@x.com', companyName: 'Unassigned', staffRole: null, createdAt: ago(5), onboardingCompleted: true, lastLoginAt: ago(1), credits: { balance: 500 } }
  ];
}

async function run(method, route, { as, query = {} } = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === route && l.route.methods[method.toLowerCase()]);
  assert.ok(layer, `${method} ${route} is not registered`);
  const req = { method, user: as ? { _id: as } : null, body: {}, params: {}, query, headers: {} };
  const res = { statusCode: 200, body: null, done: false, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.done = true; return this; } };
  const q = console.error; console.error = () => {};
  try {
    for (const l of layer.route.stack) {
      if (res.done) break;
      let advanced = false;
      await new Promise((resolve) => {
        const next = () => { advanced = true; resolve(); };
        Promise.resolve(l.handle(req, res, next)).then(() => { if (res.done) resolve(); }, resolve);
      });
      if (!advanced && !res.done) break;
    }
  } finally { console.error = q; }
  return res;
}
const GET = (route, opts) => run('GET', route, opts);

test('with no cache switched on, the response has no extra field and every request reads again', async () => {
  seed(); router._setCache(null);
  const a = await GET('/clients', { as: OWNER });
  const b = await GET('/clients', { as: OWNER });
  assert.strictEqual(a.statusCode, 200);
  assert.strictEqual('freshness' in a.body, false);
  assert.ok(customerReads >= 2 && b.body.total === 3);
});

test('Clients: the second request is served from the stored copy and says when it was read', async () => {
  seed(); router._setCache(createStaffCache());
  const a = await GET('/clients', { as: OWNER });
  const reads = customerReads;
  const b = await GET('/clients', { as: OWNER });
  assert.strictEqual(customerReads, reads, 'no new database read');
  assert.deepStrictEqual([a.body.freshness.fromCache, b.body.freshness.fromCache], [false, true]);
  assert.ok(!Number.isNaN(Date.parse(b.body.freshness.updatedAt)));
  assert.deepStrictEqual(b.body.rows, a.body.rows);
});

test('Clients: the filter, search and page are applied fresh on a stored copy', async () => {
  seed(); router._setCache(createStaffCache());
  await GET('/clients', { as: OWNER });
  const reads = customerReads;
  const r = await GET('/clients', { as: OWNER, query: { q: 'unassigned' } });
  assert.strictEqual(customerReads, reads);
  assert.strictEqual(r.body.total, 1);
  assert.strictEqual(r.body.rows[0].id, NOBODY);
});

test('a CSM sees only their own clients, and never the Owner\'s or another CSM\'s stored copy', async () => {
  seed(); router._setCache(createStaffCache());
  const owner = await GET('/clients', { as: OWNER });
  assert.strictEqual(owner.body.total, 3);
  const c1 = await GET('/clients', { as: CSM1 });
  const c2 = await GET('/clients', { as: CSM2 });
  assert.deepStrictEqual(c1.body.rows.map((r) => r.id), [MINE1]);
  assert.deepStrictEqual(c2.body.rows.map((r) => r.id), [MINE2]);
  assert.strictEqual(c1.body.freshness.fromCache, false);
  assert.strictEqual(c2.body.freshness.fromCache, false);
  const again = await GET('/clients', { as: CSM1 });
  assert.deepStrictEqual(again.body.rows.map((r) => r.id), [MINE1]);
  assert.strictEqual(again.body.freshness.fromCache, true);
  const admin = await GET('/clients', { as: ADMIN });
  assert.strictEqual(admin.body.freshness.fromCache, false, 'an Admin does not use the Owner\'s copy');
  assert.strictEqual(admin.body.total, 3);
});

test('Home: a CSM\'s numbers are their own clients only, from their own stored copy', async () => {
  seed(); router._setCache(createStaffCache());
  const owner = await GET('/home', { as: OWNER });
  assert.strictEqual(owner.statusCode, 200);
  assert.strictEqual(owner.body.growth.totalClients, 3);
  const csm = await GET('/home', { as: CSM1 });
  assert.strictEqual(csm.body.growth.totalClients, 1);
  assert.strictEqual(csm.body.freshness.fromCache, false);
  const csm2 = await GET('/home', { as: CSM2 });
  assert.strictEqual(csm2.body.growth.totalClients, 1);
  const again = await GET('/home', { as: OWNER });
  assert.deepStrictEqual([again.body.freshness.fromCache, again.body.growth.totalClients], [true, 3]);
  assert.ok(Array.isArray(again.body.health.cards), 'health is still read live');
});

test('Usage: the Admin never receives the Owner\'s full copy, whichever asked first; each window has its own copy', async () => {
  seed(); router._setCache(createStaffCache());
  const owner = await GET('/usage', { as: OWNER });
  assert.strictEqual(owner.body.level, 'full');
  assert.strictEqual(owner.body.quarks.available, true);
  const admin = await GET('/usage', { as: ADMIN });
  assert.strictEqual(admin.body.level, 'summary');
  assert.strictEqual(admin.body.quarks.available, false);
  assert.strictEqual(admin.body.freshness.fromCache, false);
  assert.strictEqual((await GET('/usage', { as: OWNER })).body.freshness.fromCache, true);
  assert.strictEqual((await GET('/usage', { as: ADMIN })).body.level, 'summary');
  const w90 = await GET('/usage', { as: OWNER, query: { window: '90' } });
  assert.strictEqual(w90.body.freshness.fromCache, false);
  assert.strictEqual(w90.body.funnel.days, 90);
});

test('Usage: a CSM is still refused when an Owner copy is stored', async () => {
  seed(); router._setCache(createStaffCache());
  await GET('/usage', { as: OWNER });
  const r = await GET('/usage', { as: CSM1 });
  assert.strictEqual(r.statusCode, 403);
  assert.strictEqual(r.body.featureUse, undefined);
  assert.strictEqual((await GET('/usage', { as: NOBODY })).statusCode, 403);
});

test('Team: Owner and Admin each get their own copy; a CSM is refused', async () => {
  seed(); router._setCache(createStaffCache());
  const owner = await GET('/team', { as: OWNER });
  assert.deepStrictEqual(owner.body.grantable, ['owner', 'admin', 'csm']);
  const admin = await GET('/team', { as: ADMIN });
  assert.deepStrictEqual(admin.body.grantable, ['csm'], 'per-person fields are never taken from the stored copy');
  assert.strictEqual(admin.body.me, ADMIN);
  assert.strictEqual(admin.body.freshness.fromCache, false);
  const again = await GET('/team', { as: OWNER });
  assert.deepStrictEqual([again.body.freshness.fromCache, again.body.me], [true, OWNER]);
  assert.strictEqual((await GET('/team', { as: CSM1 })).statusCode, 403);
});

test('?refresh=1 reads again and keeps the new copy', async () => {
  seed(); router._setCache(createStaffCache());
  await GET('/usage', { as: OWNER });
  const reads = customerReads;
  const r = await GET('/usage', { as: OWNER, query: { refresh: '1' } });
  assert.ok(customerReads > reads);
  assert.strictEqual(r.body.freshness.fromCache, false);
  assert.strictEqual((await GET('/usage', { as: OWNER })).body.freshness.fromCache, true);
  assert.strictEqual((await GET('/usage', { as: OWNER, query: { refresh: 'yes' } })).body.freshness.fromCache, true, 'only refresh=1 counts');
});

test('refresh=1 does not open a page the person may not see', async () => {
  seed(); router._setCache(createStaffCache());
  assert.strictEqual((await GET('/usage', { as: CSM1, query: { refresh: '1' } })).statusCode, 403);
  assert.strictEqual((await GET('/team', { as: NOBODY, query: { refresh: '1' } })).statusCode, 403);
});

test('a change made by staff clears every stored copy; a failed change does not', async () => {
  seed(); const cache = createStaffCache(); router._setCache(cache);
  await GET('/clients', { as: OWNER }); await GET('/team', { as: OWNER });
  assert.strictEqual(cache.size(), 2);
  const guards = router.stack.filter((l) => !l.route && l.handle.length === 3 && l.name !== 'protect');
  const touch = (method, statusCode) => {
    const finish = [];
    const res = { statusCode, on: (ev, fn) => { if (ev === 'finish') finish.push(fn); } };
    guards.forEach((g) => g.handle({ method }, res, () => {}));
    finish.forEach((f) => f());
  };
  touch('GET', 200);
  assert.strictEqual(cache.size(), 2, 'reading changes nothing');
  touch('POST', 403);
  assert.strictEqual(cache.size(), 2, 'a refused change changes nothing');
  touch('POST', 200);
  assert.strictEqual(cache.size(), 0);
});

test('a failed read is a plain error and is not stored: the next request tries again', async () => {
  seed(); router._setCache(createStaffCache());
  const origFind = User.find;
  let fail = true;
  User.find = (q, ...rest) => (fail && q && q.staffRole === null ? { lean: () => Promise.reject(new Error('db down')) } : origFind(q, ...rest));
  try {
    const bad = await GET('/clients', { as: OWNER });
    assert.strictEqual(bad.statusCode, 500);
    assert.strictEqual(bad.body.message, 'We could not load the clients. Please try again.');
    fail = false;
    const good = await GET('/clients', { as: OWNER });
    assert.strictEqual(good.statusCode, 200);
    assert.strictEqual(good.body.freshness.fromCache, false);
  } finally { User.find = origFind; }
});

test.after(() => { router._setCache(null); });
