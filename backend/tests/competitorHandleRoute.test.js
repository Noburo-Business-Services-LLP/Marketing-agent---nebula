// PUT /api/competitors/:id/handle (Stage 4 fix round A, I8/I9): the customer confirms or edits a competitor's Instagram
// handle. Fakes only. The entitlement gate and the owner check are the real ones.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const { createHandleRouter } = require('../routes/competitorHandle');

const ID = new mongoose.Types.ObjectId().toString();
const OTHER_ID = new mongoose.Types.ObjectId().toString();
const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const owner = (extra = {}) => ({ _id: 'u1', isActive: true, plan: { tier: 'starter', addons: ['competitors'] }, ...extra });

function fakeModel(docs) {
  const updates = [];
  return {
    updates,
    async findOne(filter) { return docs.find((d) => String(d._id) === String(filter._id) && String(d.userId) === String(filter.userId)) || null; },
    async updateOne(filter, update) { updates.push({ filter, update }); return { modifiedCount: 1 }; }
  };
}

async function put({ model, user, params = { id: ID }, body = {}, loadUser }) {
  const router = createHandleRouter({ Competitor: model, loadUser: loadUser || (async () => user) });
  const r = routesOf(router).find((x) => x.method === 'put' && x.path === '/:id/handle');
  assert.ok(r, 'the route exists');
  assert.strictEqual(r.handlers.length, 4, 'protect, limiter, entitlement, handler');
  const res = mkRes();
  const req = { user, params, body };
  const chain = r.handlers.slice(2); // after protect (needs a signed token) and the limiter
  let i = 0;
  const next = async () => { const h = chain[i++]; if (h) await h(req, res, next); };
  await next();
  return res;
}

const doc = (extra = {}) => ({ _id: ID, userId: 'u1', name: 'Sweet Co', socialHandles: { instagram: 'guess_handle' }, handleStatus: 'suggested', tracking: { failures: 3, pausedAt: new Date('2026-10-01'), lastCheckedAt: new Date('2026-10-02'), lastHandle: 'guess_handle' }, ...extra });

test('confirming a handle sets it confirmed, clears the pause and failures, and makes it due for a read', async () => {
  const model = fakeModel([doc()]);
  const res = await put({ model, user: owner(), body: { handle: '@Sweet.Co_1' } });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  assert.deepStrictEqual(res.body.competitor, { id: ID, name: 'Sweet Co', handle: 'Sweet.Co_1', handleStatus: 'confirmed' });
  assert.strictEqual(model.updates.length, 1);
  assert.deepStrictEqual(model.updates[0].filter, { _id: ID, userId: 'u1' }, 'the update is scoped to the owner');
  const set = model.updates[0].update.$set;
  assert.strictEqual(set['socialHandles.instagram'], 'Sweet.Co_1');
  assert.strictEqual(set.handleStatus, 'confirmed');
  assert.strictEqual(set['tracking.failures'], 0);
  assert.strictEqual(set['tracking.pausedAt'], null);
  assert.strictEqual(set['tracking.lastCheckedAt'], null);
});

test('a paused competitor is no longer a dead end: confirming the same handle clears the pause too', async () => {
  const model = fakeModel([doc({ handleStatus: 'confirmed', socialHandles: { instagram: 'same_handle' } })]);
  const res = await put({ model, user: owner(), body: { handle: 'same_handle' } });
  assert.strictEqual(res.code, 200);
  const set = model.updates[0].update.$set;
  assert.strictEqual(set['tracking.pausedAt'], null);
  assert.strictEqual(set['tracking.failures'], 0);
  assert.strictEqual(set['tracking.lastCheckedAt'], null, 'a paused competitor is read again soon');
});

test('the handle format is strict: letters, digits, dots, underscores, 1 to 30', async () => {
  const bad = ['', '   ', 'n/a', 'https://instagram.com/x', 'a b', 'a-b', 'x'.repeat(31), '@@x', 'é', '<script>', { $ne: 1 }, ['a'], null, undefined, 12];
  for (const handle of bad) {
    const model = fakeModel([doc()]);
    const res = await put({ model, user: owner(), body: { handle } });
    assert.strictEqual(res.code, 400, JSON.stringify(handle));
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(model.updates.length, 0, 'nothing is saved');
  }
  const model = fakeModel([doc()]);
  assert.strictEqual((await put({ model, user: owner(), body: { handle: 'x'.repeat(30) } })).code, 200);
});

test('only the owner\'s own competitor can be edited; someone else\'s and a malformed id are 404', async () => {
  const model = fakeModel([doc({ userId: 'u2' })]);
  const res = await put({ model, user: owner(), body: { handle: 'fine_handle' } });
  assert.strictEqual(res.code, 404);
  assert.strictEqual(model.updates.length, 0);
  const bad = await put({ model: fakeModel([doc()]), user: owner(), params: { id: 'not-an-id' }, body: { handle: 'fine_handle' } });
  assert.strictEqual(bad.code, 404);
  const missing = await put({ model: fakeModel([doc()]), user: owner(), params: { id: OTHER_ID }, body: { handle: 'fine_handle' } });
  assert.strictEqual(missing.code, 404);
});

test('a body that tries to set other fields (userId, status, tracking) changes nothing but the handle', async () => {
  const model = fakeModel([doc()]);
  await put({ model, user: owner(), body: { handle: 'fine_handle', userId: 'u2', handleStatus: 'suggested', tracking: { failures: 9 }, isIgnored: true } });
  const set = model.updates[0].update.$set;
  assert.deepStrictEqual(Object.keys(set).sort(), ['handleStatus', 'socialHandles.instagram', 'tracking.failures', 'tracking.lastCheckedAt', 'tracking.pausedAt']);
  assert.strictEqual(set.handleStatus, 'confirmed');
});

test('accounts without the add-on get the standard 403; the user is loaded server-side, not trusted from the token', async () => {
  const model = fakeModel([doc()]);
  const res = await put({ model, user: { _id: 'u1' }, loadUser: async () => owner({ plan: { tier: 'starter', addons: [] } }), body: { handle: 'fine_handle' } });
  assert.strictEqual(res.code, 403);
  assert.strictEqual(res.body.upgradeRequired, true);
  assert.strictEqual(res.body.feature, 'competitors');
  assert.strictEqual(model.updates.length, 0);
  const free = await put({ model, user: { _id: 'u1' }, loadUser: async () => owner({ plan: { tier: 'free' } }), body: { handle: 'fine_handle' } });
  assert.strictEqual(free.code, 403);
  // a token whose claims say "entitled" does not matter: the gate reads the loaded user
  const loaded = [];
  await put({ model, user: { _id: 'u1', plan: { tier: 'agency' } }, loadUser: async (id) => { loaded.push(id); return owner({ plan: { tier: 'starter', addons: [] } }); }, body: { handle: 'fine_handle' } });
  assert.deepStrictEqual(loaded, ['u1']);
});

test('a database failure is a generic 500 without the error text', async () => {
  const model = { findOne: async () => { throw new Error('mongo secret detail'); }, updateOne: async () => {} };
  const e = console.error; console.error = () => {};
  let res;
  try { res = await put({ model, user: owner(), body: { handle: 'fine_handle' } }); } finally { console.error = e; }
  assert.strictEqual(res.code, 500);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('the route is rate limited and mounted under /api/competitors', () => {
  const r = routesOf(createHandleRouter({ Competitor: fakeModel([]) })).find((x) => x.path === '/:id/handle');
  const { handleLimiter } = require('../routes/competitorHandle');
  assert.strictEqual(r.handlers[1], handleLimiter);
  const src = fs.readFileSync(path.join(__dirname, '../routes/competitors.js'), 'utf8');
  assert.match(src, /require\('\.\/competitorHandle'\)/);
});
