// backend/tests/adminBootstrap.test.js
// The old /admin page is gone. Only the first-Owner bootstrap stays on the server, behind the shared
// login, and it is refused once an Owner exists. Fakes only.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const jwt = require('jsonwebtoken');

let docs = [];
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('models/User', {
  countDocuments: async (q) => docs.filter((d) => Object.entries(q).every(([k, v]) => d[k] === v)).length,
  findOne: async (q) => docs.find((d) => d.email === q.email) || null
});
process.env.JWT_SECRET = 'test-secret-not-real';
process.env.ADMIN_EMAIL = 'shared@example.test';
process.env.ADMIN_PASSWORD = 'not-a-real-password';
const router = require('../routes/admin');

const routes = () => router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`).sort();

async function run(method, p, { body = {}, token } = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  assert.ok(layer, `${method} ${p}`);
  const req = { body, headers: token ? { authorization: `Bearer ${token}` } : {} };
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

test('only the shared login and Make Owner are left on /api/admin', () => {
  assert.deepStrictEqual(routes(), ['post /login', 'post /make-owner']);
});

test('the shared login still works with the env credentials and refuses anything else', async () => {
  const bad = await run('post', '/login', { body: { email: 'shared@example.test', password: 'wrong' } });
  assert.strictEqual(bad.statusCode, 401);
  const ok = await run('post', '/login', { body: { email: 'shared@example.test', password: 'not-a-real-password' } });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(jwt.verify(ok.body.token, process.env.JWT_SECRET).role, 'admin');
});

test('Make Owner needs the shared login token, works while no Owner exists, and is refused once one does', async () => {
  docs = [{ email: 'dk@example.test', staffRole: null }];
  assert.strictEqual((await run('post', '/make-owner', { body: { email: 'dk@example.test' } })).statusCode, 401);
  const customerToken = jwt.sign({ id: 'abc', role: 'user' }, process.env.JWT_SECRET);
  assert.strictEqual((await run('post', '/make-owner', { body: { email: 'dk@example.test' }, token: customerToken })).statusCode, 403);
  assert.strictEqual(docs[0].staffRole, null);

  const token = jwt.sign({ role: 'admin', email: 'shared@example.test' }, process.env.JWT_SECRET);
  docs[0].save = async function () {};
  const made = await run('post', '/make-owner', { body: { email: 'dk@example.test' }, token });
  assert.strictEqual(made.statusCode, 200);
  assert.strictEqual(docs[0].staffRole, 'owner');

  docs.push({ email: 'second@example.test', staffRole: null, save: async () => {} });
  const again = await run('post', '/make-owner', { body: { email: 'second@example.test' }, token });
  assert.strictEqual(again.statusCode, 409);
  assert.strictEqual(docs[1].staffRole, null);
});
