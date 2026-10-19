const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const router = require('../routes/tour');
const { createTourRouter, TOUR_STEP_IDS } = router;
const { protect } = require('../middleware/auth');
const User = require('../models/User');

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const find = (r, method, p) => routesOf(r).find((x) => x.method === method && x.path === p);
const handlerFor = (r, method, p) => { const f = find(r, method, p); return f.handlers[f.handlers.length - 1]; };

const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? undefined : a[p]), o);
const put = (o, k, v) => { const parts = k.split('.'); let c = o; parts.slice(0, -1).forEach((p) => { c[p] = c[p] || {}; c = c[p]; }); c[parts[parts.length - 1]] = v; };

// A fake User model holding one document in memory and applying the small subset of update operators the route uses.
function fakeUser(initial = {}) {
  const doc = { _id: 'u1', tour: {}, ...initial };
  const calls = [];
  const matches = (filter) => Object.entries(filter).every(([k, v]) => {
    if (k === '_id') return String(doc._id) === String(v);
    if (v && typeof v === 'object' && '$exists' in v) return (get(doc, k) !== undefined) === v.$exists;
    return get(doc, k) === v;
  });
  const model = {
    doc, calls,
    updateOne: async (filter, update) => {
      calls.push({ filter, update });
      if (!matches(filter)) return { matchedCount: 0, modifiedCount: 0 };
      Object.entries(update.$set || {}).forEach(([k, v]) => put(doc, k, v));
      Object.entries(update.$inc || {}).forEach(([k, v]) => put(doc, k, (get(doc, k) || 0) + v));
      return { matchedCount: 1, modifiedCount: 1 };
    },
    findById: () => ({ select: () => ({ lean: async () => JSON.parse(JSON.stringify(doc)) }) })
  };
  return model;
}
const mk = (Model) => createTourRouter({ User: Model });
const own = (extra = {}) => ({ _id: 'u1', ...extra });
const put_ = async (r, req) => { const res = mkRes(); await handlerFor(r, 'put', '/')({ body: {}, ...req }, res); return res; };

test('route shape: PUT / only, protect first, then a limiter, then the handler', () => {
  const routes = routesOf(router);
  assert.deepStrictEqual(routes.map((x) => `${x.method} ${x.path}`), ['put /']);
  assert.strictEqual(routes[0].handlers[0], protect);
  assert.strictEqual(routes[0].handlers.length, 3);
});

test('TOUR_STEP_IDS equals the ids of TOUR_STEPS in frontend/utils/tour.ts', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'utils', 'tour.ts'), 'utf8');
  const block = src.slice(src.indexOf('TOUR_STEPS'));
  const ids = [...block.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 5);
  assert.deepStrictEqual([...TOUR_STEP_IDS], ids);
  assert.deepStrictEqual([...TOUR_STEP_IDS], ['welcome', 'create', 'library', 'plan', 'help']);
});

test('complete stamps completedAt once and a second complete does not change it', async () => {
  const Model = fakeUser();
  const r = mk(Model);
  let res = await put_(r, { user: own(), body: { action: 'complete' } });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.success, true);
  const first = Model.doc.tour.completedAt;
  assert.ok(first instanceof Date);
  assert.deepStrictEqual(Object.keys(res.body.tour).sort(), ['completedAt', 'skippedAt']);
  assert.ok(res.body.tour.completedAt);
  // the write is conditional on completedAt not existing
  assert.deepStrictEqual(Model.calls[0].filter, { _id: 'u1', 'tour.completedAt': { $exists: false } });
  await new Promise((x) => setTimeout(x, 5));
  res = await put_(r, { user: own(), body: { action: 'complete' } });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(Model.doc.tour.completedAt, first, 'not overwritten');
  assert.strictEqual(Model.doc.tour.skippedAt, undefined);
});

test('skip stamps skippedAt once; replay only counts', async () => {
  const Model = fakeUser();
  const r = mk(Model);
  await put_(r, { user: own(), body: { action: 'skip' } });
  const first = Model.doc.tour.skippedAt;
  assert.ok(first instanceof Date);
  assert.deepStrictEqual(Model.calls[0].filter, { _id: 'u1', 'tour.skippedAt': { $exists: false } });
  await new Promise((x) => setTimeout(x, 5));
  await put_(r, { user: own(), body: { action: 'skip' } });
  assert.strictEqual(Model.doc.tour.skippedAt, first);
  assert.strictEqual(Model.doc.tour.completedAt, undefined);

  const before = JSON.stringify({ ...Model.doc.tour, replays: undefined });
  let res = await put_(r, { user: own(), body: { action: 'replay' } });
  assert.strictEqual(res.code, 200);
  await put_(r, { user: own(), body: { action: 'replay' } });
  assert.strictEqual(Model.doc.tour.replays, 2);
  assert.strictEqual(JSON.stringify({ ...Model.doc.tour, replays: undefined }), before, 'replay changes nothing else');
  assert.strictEqual(Model.doc.tour.step, undefined);
  assert.deepStrictEqual(Object.keys(res.body.tour).sort(), ['completedAt', 'skippedAt']);
});

test('step accepts known ids only and unknown actions are 400', async () => {
  const Model = fakeUser();
  const r = mk(Model);
  for (const id of TOUR_STEP_IDS) {
    const res = await put_(r, { user: own(), body: { action: 'step', step: id } });
    assert.strictEqual(res.code, 200);
    assert.strictEqual(Model.doc.tour.step, id);
  }
  const writes = Model.calls.length;
  for (const bad of [undefined, 'nope', '', 7, null, { $ne: 1 }, ['welcome'], '__proto__']) {
    const res = await put_(r, { user: own(), body: { action: 'step', step: bad } });
    assert.strictEqual(res.code, 400, String(bad));
    assert.strictEqual(res.body.success, false);
  }
  assert.strictEqual(Model.calls.length, writes, 'a bad step writes nothing');
  assert.strictEqual(Model.doc.tour.step, 'help');
  for (const action of [undefined, 'reset', 'COMPLETE', '', 5, { $set: 1 }]) {
    const res = await put_(r, { user: own(), body: { action } });
    assert.strictEqual(res.code, 400, String(action));
  }
  assert.strictEqual((await put_(r, { user: own(), body: undefined })).code, 400);
  assert.strictEqual(Model.calls.length, writes);
});

test('staff accounts, a CSM pass and an agency client pass cannot write tour state (403)', async () => {
  const Model = fakeUser();
  const r = mk(Model);
  const reqs = [
    { user: own({ staffRole: 'support' }) },
    { user: own({ isCsm: true }) },
    { user: own(), actingCsm: { _id: 'c1' } },
    { user: own(), actingAgency: { _id: 'a1' } }
  ];
  for (const base of reqs) {
    for (const action of ['step', 'complete', 'skip', 'replay']) {
      const res = await put_(r, { ...base, body: { action, step: 'welcome' } });
      assert.strictEqual(res.code, 403, JSON.stringify(base) + action);
      assert.strictEqual(res.body.success, false);
    }
  }
  assert.strictEqual(Model.calls.length, 0, 'nothing was written');
  assert.deepStrictEqual(Model.doc.tour, {});
});

test('401 without a user id; a failing write is a generic 500 that never leaks the error', async () => {
  const Model = fakeUser();
  const r = mk(Model);
  assert.strictEqual((await put_(r, { user: null, body: { action: 'complete' } })).code, 401);
  assert.strictEqual((await put_(r, { user: {}, body: { action: 'complete' } })).code, 401);
  assert.strictEqual(Model.calls.length, 0);
  const boom = { ...Model, updateOne: async () => { throw new Error('mongo secret host'); } };
  const res = await quiet(() => put_(mk(boom), { user: own(), body: { action: 'complete' } }));
  assert.strictEqual(res.code, 500);
  assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('toPublicJSON carries tour.completedAt and tour.skippedAt and nothing else', async () => {
  const done = new Date('2026-10-17T10:00:00Z');
  const json = new User({ email: 'a@example.com', firstName: 'A', tour: { completedAt: done, step: 'plan', replays: 3 } }).toPublicJSON();
  assert.deepStrictEqual(Object.keys(json.tour).sort(), ['completedAt', 'skippedAt']);
  assert.strictEqual(json.tour.completedAt.getTime(), done.getTime());
  assert.strictEqual(json.tour.skippedAt, undefined);
  const fresh = new User({ email: 'b@example.com', firstName: 'B' }).toPublicJSON();
  assert.deepStrictEqual(Object.keys(fresh.tour).sort(), ['completedAt', 'skippedAt']);
  assert.strictEqual(fresh.tour.completedAt, undefined);
});

test('a page loaded before the five-step tour can still save its old step ids', async () => {
  const Model = fakeUser();
  const r = mk(Model);
  for (const id of ['review', 'calendar']) {
    const res = await put_(r, { user: own(), body: { action: 'step', step: id } });
    assert.strictEqual(res.code, 200, id);
  }
});
