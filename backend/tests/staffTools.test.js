// backend/tests/staffTools.test.js
// The Owner tools that replaced the old /admin page: Reset Ayrshare IDs, Reset a staff account,
// hide a client from the numbers, coupons. Fakes only: no database, no Ayrshare, no network.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const OWNER = 'a'.repeat(24);
const ADMIN = 'b'.repeat(24);
const CSM = 'c'.repeat(24);
const CLIENT = 'd'.repeat(24);
const CLIENT2 = '9'.repeat(24);
const CUSTOMER_USER = 'e'.repeat(24);

let docs = [];
let drafts = [];
let coupons = [];
const actions = [];
const network = [];

function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const get = (o, k) => k.split('.').reduce((v, p) => (v == null ? v : v[p]), o);
function setPath(o, k, val) {
  const parts = k.split('.');
  let cur = o;
  parts.slice(0, -1).forEach((p) => { if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p]; });
  cur[parts[parts.length - 1]] = val;
}
function unsetPath(o, k) {
  const parts = k.split('.');
  let cur = o;
  for (const p of parts.slice(0, -1)) { if (cur[p] == null) return; cur = cur[p]; }
  delete cur[parts[parts.length - 1]];
}
function matches(d, q) {
  return Object.entries(q || {}).every(([k, cond]) => {
    const v = get(d, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('$exists' in cond && (v !== undefined) !== cond.$exists) return false;
      if ('$nin' in cond && cond.$nin.includes(v)) return false;
      if ('$ne' in cond && String(v ?? null) === String(cond.$ne)) return false;
      if ('$in' in cond && !cond.$in.map(String).includes(String(v))) return false;
      return true;
    }
    return String(v ?? null) === String(cond ?? null);
  });
}
function applyUpdate(d, u) {
  Object.entries(u.$set || {}).forEach(([k, v]) => setPath(d, k, v));
  Object.keys(u.$unset || {}).forEach((k) => unsetPath(d, k));
}
const chain = (value) => { const p = Promise.resolve(value); p.select = () => p; p.lean = () => p; p.sort = () => p; return p; };
const User = {
  find: (q) => chain(docs.filter((d) => matches(d, q)).map((d) => ({ ...d }))),
  findOne: (q) => chain(docs.filter((d) => matches(d, q)).map((d) => ({ ...d }))[0] || null),
  findById: (id) => chain(docs.filter((d) => String(d._id) === String(id)).map((d) => ({ ...d }))[0] || null),
  countDocuments: async (q) => docs.filter((d) => matches(d, q)).length,
  updateOne: async (q, u) => { docs.filter((d) => matches(d, q)).forEach((d) => applyUpdate(d, u)); },
  updateMany: async (q, u) => { const hit = docs.filter((d) => matches(d, q)); hit.forEach((d) => applyUpdate(d, u)); return { modifiedCount: hit.length }; }
};
stub('models/User', User);
stub('models/StaffAction', { create: async (row) => { actions.push(row); } });
stub('models/FeatureEvent', { aggregate: async () => [] });
stub('models/Draft', {
  aggregate: async () => [],
  updateMany: async (q, u) => { const hit = drafts.filter((d) => matches(d, q)); hit.forEach((d) => applyUpdate(d, u)); return { modifiedCount: hit.length }; }
});
stub('models/Coupon', {
  find: () => chain(coupons.map((c) => ({ ...c }))),
  create: async (doc) => {
    if (coupons.some((c) => c.code === doc.code)) { const e = new Error('dup'); e.code = 11000; throw e; }
    const row = { isActive: true, usedCount: 0, ...doc }; coupons.push(row); return { ...row };
  },
  findOneAndUpdate: (q, u) => { const c = coupons.find((x) => x.code === q.code); if (c) Object.assign(c, u); return chain(c ? { ...c } : null); },
  findOneAndDelete: (q) => { const i = coupons.findIndex((x) => x.code === q.code); const c = i >= 0 ? coupons.splice(i, 1)[0] : null; return chain(c ? { ...c } : null); }
});
stub('middleware/auth', { protect: (q, s, n) => n() });
// Any call that would reach Ayrshare is recorded; the reset must never make one.
stub('services/socialMediaAPI', new Proxy({}, { get: (_t, name) => (...a) => { network.push([String(name), ...a]); return Promise.resolve({}); } }));
const router = require('../routes/staff');

function seed() {
  actions.length = 0; network.length = 0;
  docs = [
    { _id: OWNER, email: 'owner@x.com', firstName: 'Olga', staffRole: 'owner', isCsm: false, isHidden: true,
      businessProfile: { name: 'Test shop' }, connectedSocials: ['instagram'], onboardingCompleted: false, credits: { balance: 250 }, ayrshare: { profileKey: 'K_O' } },
    { _id: ADMIN, email: 'admin@x.com', firstName: 'Adam', staffRole: 'admin', isCsm: false, isHidden: true },
    { _id: CSM, email: 'csm@x.com', firstName: 'Cleo', staffRole: 'csm', isCsm: true, isHidden: true,
      businessProfile: { name: 'Old test business', industry: 'cafe' }, connectedSocials: ['instagram', 'facebook'], onboardingCompleted: false,
      credits: { balance: 500 }, ayrshare: { profileKey: 'K_C', refId: 'r1', title: 't', activeSocialAccounts: ['instagram'], displayNames: [{}], lastCheckedAt: new Date() } },
    { _id: CLIENT, email: 'client@x.com', firstName: 'Cli', companyName: 'Acme', assignedCsm: CSM, staffRole: null, onboardingCompleted: true,
      businessProfile: { name: 'Acme' }, connectedSocials: ['instagram'], ayrshare: { profileKey: 'K_1', refId: 'r2', title: 't2', activeSocialAccounts: ['facebook'], displayNames: [{}], lastCheckedAt: new Date() } },
    { _id: CLIENT2, email: 'two@x.com', firstName: 'Two', staffRole: null, ayrshare: { profileKey: '' } },
    { _id: CUSTOMER_USER, email: 'plain@x.com', firstName: 'Plain', staffRole: null, businessProfile: { name: 'Plain Co' }, connectedSocials: ['x'], ayrshare: { profileKey: 'K_P' } }
  ];
  drafts = [
    { userId: CSM, status: 'draft' }, { userId: CSM, status: 'published' }, { userId: CSM, status: 'archived' },
    { userId: CLIENT, status: 'draft' }
  ];
  coupons = [{ code: 'WELCOME', discountedAmount: 5000, maxUses: 1, usedCount: 0, isActive: true, note: '' }];
}

async function call(method, route, { as, body = {}, params = {}, query = {} } = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === route && l.route.methods[method]);
  assert.ok(layer, `${method} ${route} is not registered`);
  const req = { user: as ? { _id: as } : null, body, params, query };
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
const doc = (id) => docs.find((d) => d._id === id);

const TOOLS = [
  ['post', '/ayrshare/reset-ids', {}, { confirm: true }],
  ['post', '/team/:id/reset-account', { id: CSM }, { confirm: true }],
  ['get', '/coupons', {}, {}],
  ['post', '/coupons', {}, { code: 'NEWONE', discountedAmount: 4000, maxUses: 2 }],
  ['post', '/coupons/:code/deactivate', { code: 'WELCOME' }, {}],
  ['delete', '/coupons/:code', { code: 'WELCOME' }, {}]
];

test('the Owner-only tools refuse an Admin, a CSM, a customer and a signed-out caller, and change and log nothing', async () => {
  seed();
  const before = JSON.stringify([docs, drafts, coupons]);
  for (const [m, r, params, body] of TOOLS) {
    for (const [who, code] of [[ADMIN, 403], [CSM, 403], [CUSTOMER_USER, 403], [null, 401]]) {
      const res = await call(m, r, { as: who, params, body });
      assert.strictEqual(res.statusCode, code, `${who} ${m} ${r}`);
    }
  }
  assert.strictEqual(JSON.stringify([docs, drafts, coupons]), before);
  assert.strictEqual(actions.length, 0);
  assert.strictEqual(network.length, 0);
});

test('role claims sent in the body or query do not lift an Admin into the Owner tools', async () => {
  seed();
  const res = await call('post', '/ayrshare/reset-ids', { as: ADMIN, body: { confirm: true, staffRole: 'owner', role: 'owner', isAdmin: true }, query: { role: 'owner' } });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(doc(CLIENT).ayrshare.profileKey, 'K_1');
});

test('Reset Ayrshare IDs: needs confirm, clears only the Ayrshare fields of accounts that hold an id, logs once, calls nothing external', async () => {
  seed();
  const noConfirm = await call('post', '/ayrshare/reset-ids', { as: OWNER, body: {} });
  assert.strictEqual(noConfirm.statusCode, 400);
  assert.strictEqual(doc(CLIENT).ayrshare.profileKey, 'K_1');
  assert.strictEqual(actions.length, 0);

  const res = await call('post', '/ayrshare/reset-ids', { as: OWNER, body: { confirm: true } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.cleared, 4, 'owner, csm, client and plain customer held an id; the empty one is not counted');
  for (const id of [OWNER, CSM, CLIENT, CUSTOMER_USER]) {
    assert.strictEqual(doc(id).ayrshare.profileKey, '');
    assert.strictEqual(doc(id).ayrshare.refId, '');
    assert.deepStrictEqual(doc(id).ayrshare.activeSocialAccounts, []);
    assert.strictEqual(doc(id).ayrshare.lastCheckedAt, null);
  }
  // nothing else is touched
  assert.strictEqual(doc(CLIENT).businessProfile.name, 'Acme');
  assert.deepStrictEqual(doc(CLIENT).connectedSocials, ['instagram']);
  assert.strictEqual(doc(CSM).credits.balance, 500);
  assert.deepStrictEqual(drafts.map((d) => d.status), ['draft', 'published', 'archived', 'draft']);
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, 'reset_ayrshare_ids');
  assert.strictEqual(actions[0].actorRole, 'owner');
  assert.strictEqual(String(actions[0].actor), OWNER);
  assert.strictEqual(actions[0].details.cleared, 4);
  assert.strictEqual(network.length, 0);
});

test('Reset to a clean staff account: clears the test business profile and connected accounts, archives drafts, keeps Quarks, login and role, logs it', async () => {
  seed();
  const noConfirm = await call('post', '/team/:id/reset-account', { as: OWNER, params: { id: CSM }, body: {} });
  assert.strictEqual(noConfirm.statusCode, 400);
  assert.strictEqual(doc(CSM).businessProfile.name, 'Old test business');

  const res = await call('post', '/team/:id/reset-account', { as: OWNER, params: { id: CSM }, body: { confirm: true } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.archivedDrafts, 2, 'the draft and the published one; the archived one is not counted again');
  const c = doc(CSM);
  assert.strictEqual(c.businessProfile, undefined);
  assert.deepStrictEqual(c.connectedSocials, []);
  assert.strictEqual(c.onboardingCompleted, true);
  assert.strictEqual(c.credits.balance, 500);
  assert.strictEqual(c.email, 'csm@x.com');
  assert.strictEqual(c.staffRole, 'csm');
  assert.strictEqual(c.isHidden, true);
  assert.deepStrictEqual(drafts.filter((d) => String(d.userId) === CSM).map((d) => d.status), ['archived', 'archived', 'archived']);
  assert.strictEqual(drafts.find((d) => d.userId === CLIENT).status, 'draft', 'another account\'s drafts are untouched');
  assert.strictEqual(doc(CLIENT).businessProfile.name, 'Acme');
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, 'reset_staff_account');
  assert.strictEqual(String(actions[0].client), CSM);
  assert.strictEqual(actions[0].details.archivedDrafts, 2);
});

test('Reset staff account works on the Owner\'s own test profile but never on a customer, and a bad id is 404', async () => {
  seed();
  assert.strictEqual((await call('post', '/team/:id/reset-account', { as: OWNER, params: { id: CUSTOMER_USER }, body: { confirm: true } })).statusCode, 404);
  assert.strictEqual((await call('post', '/team/:id/reset-account', { as: OWNER, params: { id: CLIENT }, body: { confirm: true } })).statusCode, 404);
  assert.strictEqual((await call('post', '/team/:id/reset-account', { as: OWNER, params: { id: 'nope' }, body: { confirm: true } })).statusCode, 404);
  assert.strictEqual(doc(CUSTOMER_USER).businessProfile.name, 'Plain Co');
  assert.strictEqual(doc(CLIENT).businessProfile.name, 'Acme');
  assert.strictEqual(actions.length, 0);
  const own = await call('post', '/team/:id/reset-account', { as: OWNER, params: { id: OWNER }, body: { confirm: true } });
  assert.strictEqual(own.statusCode, 200);
  assert.strictEqual(doc(OWNER).businessProfile, undefined);
  assert.strictEqual(doc(OWNER).staffRole, 'owner');
});

test('hide a client from the numbers: Owner and Admin may, a CSM may not, staff and bad ids are refused, each change is logged', async () => {
  seed();
  assert.strictEqual((await call('post', '/clients/:id/hidden', { as: CSM, params: { id: CLIENT }, body: { hidden: true } })).statusCode, 403);
  assert.strictEqual((await call('post', '/clients/:id/hidden', { as: CUSTOMER_USER, params: { id: CLIENT }, body: { hidden: true } })).statusCode, 403);
  assert.strictEqual(doc(CLIENT).isHidden, undefined);

  const hide = await call('post', '/clients/:id/hidden', { as: ADMIN, params: { id: CLIENT }, body: { hidden: true } });
  assert.strictEqual(hide.statusCode, 200);
  assert.strictEqual(hide.body.hidden, true);
  assert.strictEqual(doc(CLIENT).isHidden, true);
  const show = await call('post', '/clients/:id/hidden', { as: OWNER, params: { id: CLIENT }, body: { hidden: false } });
  assert.strictEqual(show.body.hidden, false);
  assert.strictEqual(doc(CLIENT).isHidden, false);
  assert.deepStrictEqual(actions.map((a) => a.action), ['hide_client', 'show_client']);
  assert.strictEqual(String(actions[0].client), CLIENT);

  assert.strictEqual((await call('post', '/clients/:id/hidden', { as: OWNER, params: { id: CLIENT }, body: { hidden: 'yes' } })).statusCode, 400);
  assert.strictEqual((await call('post', '/clients/:id/hidden', { as: OWNER, params: { id: CSM }, body: { hidden: false } })).statusCode, 404);
  assert.strictEqual(doc(CSM).isHidden, true, 'a staff account stays hidden');
  assert.strictEqual((await call('post', '/clients/:id/hidden', { as: OWNER, params: { id: 'nope' }, body: { hidden: true } })).statusCode, 404);
  assert.strictEqual(actions.length, 2);
});

test('coupons: the Owner lists, creates (code cleaned), switches off and deletes; each write is logged; bad input and duplicates are refused', async () => {
  seed();
  const list = await call('get', '/coupons', { as: OWNER });
  assert.strictEqual(list.statusCode, 200);
  assert.deepStrictEqual(list.body.coupons.map((c) => c.code), ['WELCOME']);

  const bad = await call('post', '/coupons', { as: OWNER, body: { code: '  ', discountedAmount: 100 } });
  assert.strictEqual(bad.statusCode, 400);
  assert.strictEqual((await call('post', '/coupons', { as: OWNER, body: { code: 'has space!', discountedAmount: 100, maxUses: 1 } })).statusCode, 400);
  assert.strictEqual((await call('post', '/coupons', { as: OWNER, body: { code: 'OKCODE', discountedAmount: -5, maxUses: 1 } })).statusCode, 400);
  assert.strictEqual((await call('post', '/coupons', { as: OWNER, body: { code: 'OKCODE', discountedAmount: 100, maxUses: 0 } })).statusCode, 400);
  assert.strictEqual(coupons.length, 1);

  const ok = await call('post', '/coupons', { as: OWNER, body: { code: ' spring25 ', discountedAmount: 4000, maxUses: 3, note: 'For Bobby' } });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(coupons.find((c) => c.code === 'SPRING25').maxUses, 3);
  const dup = await call('post', '/coupons', { as: OWNER, body: { code: 'welcome', discountedAmount: 100, maxUses: 1 } });
  assert.strictEqual(dup.statusCode, 409);

  const off = await call('post', '/coupons/:code/deactivate', { as: OWNER, params: { code: 'spring25' } });
  assert.strictEqual(off.statusCode, 200);
  assert.strictEqual(coupons.find((c) => c.code === 'SPRING25').isActive, false);
  assert.strictEqual((await call('post', '/coupons/:code/deactivate', { as: OWNER, params: { code: 'ZZZ' } })).statusCode, 404);

  const del = await call('delete', '/coupons/:code', { as: OWNER, params: { code: 'welcome' } });
  assert.strictEqual(del.statusCode, 200);
  assert.deepStrictEqual(coupons.map((c) => c.code), ['SPRING25']);
  assert.strictEqual((await call('delete', '/coupons/:code', { as: OWNER, params: { code: 'WELCOME' } })).statusCode, 404);
  assert.deepStrictEqual(actions.map((a) => a.action), ['coupon_create', 'coupon_deactivate', 'coupon_delete']);
  assert.strictEqual(actions[0].details.code, 'SPRING25');
});

test('the Ayrshare reset definition only touches Ayrshare fields', () => {
  const { AYRSHARE_RESET } = require('../services/staff/tools');
  const keys = Object.keys(AYRSHARE_RESET.update.$set);
  assert.ok(keys.length > 0 && keys.every((k) => k.startsWith('ayrshare.')));
  assert.strictEqual(AYRSHARE_RESET.update.$set['ayrshare.profileKey'], '');
});
