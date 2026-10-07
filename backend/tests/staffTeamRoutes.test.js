// backend/tests/staffTeamRoutes.test.js
// The Team routes end to end with fakes: a fake User collection, a fake StaffAction log, a fake mailer.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const OWNER = 'a'.repeat(24);
const ADMIN = 'b'.repeat(24);
const CSM = 'c'.repeat(24);
const CLIENT = 'd'.repeat(24);
const CUSTOMER_USER = 'e'.repeat(24);

let docs = [];
const actions = [];
const mails = [];
let seq = 0;

function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
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
const chain = (value) => { const p = Promise.resolve(value); p.select = () => p; p.lean = () => p; p.sort = () => p; return p; };
const User = {
  find: (q) => chain(docs.filter((d) => matches(d, q)).map((d) => ({ ...d }))),
  findOne: (q) => chain(docs.filter((d) => matches(d, q)).map((d) => ({ ...d }))[0] || null),
  findById: (id) => chain(docs.filter((d) => String(d._id) === String(id)).map((d) => ({ ...d }))[0] || null),
  countDocuments: async (q) => docs.filter((d) => matches(d, q)).length,
  updateOne: async (q, u) => { docs.filter((d) => matches(d, q)).forEach((d) => Object.assign(d, u.$set)); },
  updateMany: async (q, u) => { docs.filter((d) => matches(d, q)).forEach((d) => Object.assign(d, u.$set)); },
  create: async (doc) => { const d = { _id: `f${String(++seq).padStart(23, '0')}`, ...doc }; docs.push(d); return { ...d, toObject: () => ({ ...d }) }; }
};
stub('models/User', User);
stub('models/StaffAction', { create: async (row) => { actions.push(row); } });
stub('models/FeatureEvent', { aggregate: async () => [] });
stub('models/Draft', { aggregate: async () => [] });
stub('middleware/auth', { protect: (q, s, n) => n() });
const invite = require('../services/staff/invite');
invite.send = async (mail) => { mails.push(mail); return true; };
const router = require('../routes/staff');

function seed() {
  seq = 0; actions.length = 0; mails.length = 0;
  docs = [
    { _id: OWNER, email: 'owner@x.com', firstName: 'Olga', staffRole: 'owner', isCsm: false, isHidden: true },
    { _id: ADMIN, email: 'admin@x.com', firstName: 'Adam', staffRole: 'admin', isCsm: false, isHidden: true },
    { _id: CSM, email: 'csm@x.com', firstName: 'Cleo', staffRole: 'csm', isCsm: true, isHidden: true },
    { _id: CLIENT, email: 'client@x.com', firstName: 'Cli', companyName: 'Acme', assignedCsm: CSM, staffRole: null, onboardingCompleted: true },
    { _id: CUSTOMER_USER, email: 'plain@x.com', firstName: 'Plain', staffRole: null }
  ];
}

async function call(method, route, { as, body = {}, params = {} } = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === route && l.route.methods[method]);
  assert.ok(layer, `${method} ${route} is not registered`);
  const req = { user: as ? { _id: as } : null, body, params, query: {} };
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

test('GET /team: the Owner sees the team with CSM workload; an Admin sees it but may grant only CSM', async () => {
  seed();
  const o = await call('get', '/team', { as: OWNER });
  assert.strictEqual(o.statusCode, 200);
  assert.deepStrictEqual(o.body.rows.map((r) => r.role), ['owner', 'admin', 'csm']);
  assert.strictEqual(o.body.rows.find((r) => r.role === 'csm').clients, 1);
  assert.deepStrictEqual(o.body.grantable, ['owner', 'admin', 'csm']);
  const a = await call('get', '/team', { as: ADMIN });
  assert.deepStrictEqual(a.body.grantable, ['csm']);
  assert.strictEqual(o.body.can.reset_accounts, true);
  assert.strictEqual(a.body.can.reset_accounts, false);
  assert.ok(!JSON.stringify(o.body).includes('password'));
});

test('every Team route refuses a CSM and a customer, and a signed-out caller', async () => {
  seed();
  const targets = [['get', '/team'], ['post', '/team'], ['patch', '/team/:id'], ['delete', '/team/:id']];
  for (const [m, r] of targets) {
    assert.strictEqual((await call(m, r, { as: CSM, params: { id: ADMIN }, body: { role: 'csm', email: 'n@x.com', firstName: 'N' } })).statusCode, 403, `csm ${m} ${r}`);
    assert.strictEqual((await call(m, r, { as: CUSTOMER_USER, params: { id: ADMIN }, body: {} })).statusCode, 403, `customer ${m} ${r}`);
    assert.strictEqual((await call(m, r, { as: null })).statusCode, 401, `no login ${m} ${r}`);
  }
  assert.strictEqual(docs.find((d) => d._id === ADMIN).staffRole, 'admin');
});

test('POST /team: a client-supplied claim cannot make an Admin grant Admin; the Owner can; the invite goes through the fake mailer', async () => {
  seed();
  const bad = await call('post', '/team', { as: ADMIN, body: { email: 'n@x.com', firstName: 'Nia', role: 'admin', staffRole: 'owner', isAdmin: true } });
  assert.strictEqual(bad.statusCode, 403);
  assert.strictEqual(mails.length, 0);
  const ok = await call('post', '/team', { as: OWNER, body: { email: 'n@x.com', firstName: 'Nia', role: 'admin', staffRole: 'owner' } });
  assert.strictEqual(ok.statusCode, 200);
  const made = docs.find((d) => d.email === 'n@x.com');
  assert.strictEqual(made.staffRole, 'admin');
  assert.strictEqual(mails.length, 1);
  assert.strictEqual(mails[0].to, 'n@x.com');
  assert.match(mails[0].text, /Forgot password/);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, 'team_add');
  assert.strictEqual(actions[0].actorRole, 'owner');
});

test('PATCH then DELETE: a CSM becomes an Admin, then is removed; the client of a CSM is unassigned and listed', async () => {
  seed();
  const removeCsm = await call('delete', '/team/:id', { as: ADMIN, params: { id: CSM } });
  assert.strictEqual(removeCsm.statusCode, 200);
  assert.deepStrictEqual(removeCsm.body.unassigned, { count: 1, clients: [{ id: CLIENT, name: 'Acme' }] });
  assert.strictEqual(docs.find((d) => d._id === CLIENT).assignedCsm, null);
  assert.strictEqual(docs.find((d) => d._id === CSM).staffRole, null);
  assert.strictEqual(actions[0].action, 'team_remove');

  seed();
  const promote = await call('patch', '/team/:id', { as: OWNER, params: { id: CSM }, body: { role: 'admin' } });
  assert.strictEqual(promote.statusCode, 200);
  assert.strictEqual(docs.find((d) => d._id === CSM).staffRole, 'admin');
  assert.strictEqual(docs.find((d) => d._id === CLIENT).assignedCsm, null);
  assert.strictEqual(actions[0].action, 'role_change');
});

test('the last Owner cannot be removed or changed, by anyone, and an Admin cannot touch an Owner', async () => {
  seed();
  assert.strictEqual((await call('delete', '/team/:id', { as: ADMIN, params: { id: OWNER } })).statusCode, 403);
  assert.strictEqual((await call('patch', '/team/:id', { as: ADMIN, params: { id: OWNER }, body: { role: 'csm' } })).statusCode, 403);
  assert.strictEqual((await call('delete', '/team/:id', { as: OWNER, params: { id: OWNER } })).statusCode, 403);
  assert.strictEqual(docs.find((d) => d._id === OWNER).staffRole, 'owner');
  assert.strictEqual(actions.length, 0);
});

test('a bad id and a customer id give 404 and change nothing', async () => {
  seed();
  assert.strictEqual((await call('patch', '/team/:id', { as: OWNER, params: { id: 'not-an-id' }, body: { role: 'csm' } })).statusCode, 404);
  assert.strictEqual((await call('delete', '/team/:id', { as: OWNER, params: { id: CUSTOMER_USER } })).statusCode, 404);
  assert.strictEqual(actions.length, 0);
});
