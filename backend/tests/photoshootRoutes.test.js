// Photoshoot: the routes, the mount, the body size for the upload, the data registry and the resume loop.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createPhotoshootRouter } = require('../routes/photoshoot');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const routesOf = (r) => r.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, method: Object.keys(l.route.methods)[0], handlers: l.route.stack.map((s) => s.handle) }));
const mkRes = () => ({ code: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const last = (r) => r.handlers[r.handlers.length - 1];

test('nine routes, every one behind sign-in and a rate limit, mounted under /api/photoshoot', () => {
  const list = routesOf(createPhotoshootRouter({ service: {} }));
  assert.deepStrictEqual(list.map((r) => `${r.method} ${r.path}`), [
    'get /packs', 'get /options', 'post /jobs', 'get /jobs', 'get /jobs/:id', 'post /jobs/:id/photos/:index/redo', 'patch /jobs/:id/photos/:index', 'get /library', 'post /upload'
  ]);
  for (const r of list) { assert.strictEqual(r.handlers[0], require('../middleware/auth').protect); assert.strictEqual(r.handlers.length, 3); }
  const main = read('server-main.js');
  assert.match(main, /app\.use\('\/api\/photoshoot', require\('\.\/routes\/photoshoot'\)\);/);
  assert.match(main, /'\/api\/photoshoot\/upload'/, 'only the upload gets the big body allowance');
  assert.match(main, /require\('\.\/services\/photoshoot'\)\.startPhotoshootResume\(\)/);
});

test('each route passes the user, the params, the body and whether this is a CSM or agency pass', async () => {
  const seen = [];
  const ok = (name) => async (...a) => { seen.push([name, ...a]); return { status: 202, body: { success: true } }; };
  const service = {
    packs: () => ({ packs: [] }), options: async (u, o) => { seen.push(['options', u, o]); return { enabled: true }; },
    create: ok('create'), list: ok('list'), get: ok('get'), redo: ok('redo'), setInLibrary: ok('setInLibrary'), library: ok('library'), upload: ok('upload')
  };
  const list = routesOf(createPhotoshootRouter({ service }));
  const req = { user: { _id: 'u' }, params: { id: 'j', index: '2' }, body: { key: 'k', inLibrary: false }, actingCsm: { _id: 'c' } };
  for (const r of list) { const res = mkRes(); await last(r)(req, res); assert.ok([200, 202].includes(res.code), r.path); assert.strictEqual(res.headers['Cache-Control'], 'private, no-store'); }
  const byName = Object.fromEntries(seen.map((s) => [s[0], s.slice(1)]));
  assert.deepStrictEqual(byName.create[2], { pass: true });
  assert.deepStrictEqual(byName.redo.slice(1, 4), ['j', '2', { key: 'k', inLibrary: false }]);
  assert.deepStrictEqual(byName.setInLibrary.slice(1), ['j', '2', false]);
  assert.deepStrictEqual(byName.upload[2], { pass: true });
  assert.deepStrictEqual(byName.options[1], { pass: true });
});

test('a service error is a plain 500 without the error text', async () => {
  const boom = async () => { throw new Error('secret db detail'); };
  const service = { packs: () => { throw new Error('secret'); }, options: boom, create: boom, list: boom, get: boom, redo: boom, setInLibrary: boom, library: boom, upload: boom };
  const e = console.error; console.error = () => {};
  try {
    for (const r of routesOf(createPhotoshootRouter({ service }))) {
      const res = mkRes();
      await last(r)({ user: { _id: 'u' }, params: {}, body: {} }, res);
      assert.strictEqual(res.code, 500); assert.ok(!JSON.stringify(res.body).includes('secret'));
    }
  } finally { console.error = e; }
});

test('photoshoot jobs are erased with the account', () => {
  const { ruleFor } = require('../services/dataRegistry');
  assert.deepStrictEqual({ ...ruleFor('PhotoshootJob'), note: undefined }, { model: 'PhotoshootJob', field: 'user', action: 'delete', note: undefined });
});

test('the job model holds the ledger rules: one row per key, one job in flight per account', () => {
  const Job = require('../models/PhotoshootJob');
  const idx = Job.schema.indexes();
  assert.ok(idx.some(([f, o]) => f.user === 1 && f.key === 1 && o.unique));
  assert.ok(idx.some(([f, o]) => f.user === 1 && Object.keys(f).length === 1 && o.unique && o.partialFilterExpression && o.partialFilterExpression.inFlight === true));
  assert.strictEqual(Job.schema.path('photos').schema.path('attempts').options.default, 0);
});

test('the resume loop can be switched off and is otherwise started with a timer that does not keep the process alive', () => {
  const { startPhotoshootResume } = require('../services/photoshoot');
  assert.strictEqual(startPhotoshootResume({ env: { ENABLE_PHOTOSHOOT_RESUME: 'off' } }), null);
  const t = startPhotoshootResume({ env: {}, service: () => ({ resumeLost: async () => 0 }) });
  assert.ok(t); clearInterval(t);
});
