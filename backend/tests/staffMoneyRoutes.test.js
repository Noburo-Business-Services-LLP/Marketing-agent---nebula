// GET /api/staff/money end to end with a fake User collection: Owner only, never trusts client claims.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const OWNER = 'a'.repeat(24);
const ADMIN = 'b'.repeat(24);
const CSM = 'c'.repeat(24);
const CUST = 'd'.repeat(24);
const NOW = Date.now();
const ago = (d) => new Date(NOW - d * 86400000);

let docs = [];
let failCount = false;
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const get = (o, k) => k.split('.').reduce((v, p) => (v == null ? v : v[p]), o);
const chain = (value) => { const p = Promise.resolve(value); p.select = () => p; p.lean = () => p; p.sort = () => p; return p; };
const User = {
  // Only the shapes the code under test uses: staff lookups by id, and the customers query.
  findById: (id) => chain(docs.filter((d) => String(d._id) === String(id)).map((d) => ({ ...d }))[0] || null),
  find: (q) => chain(docs.filter((d) => (q.staffRole === null ? !d.staffRole : true) && !d.isCsm).map((d) => ({ ...d }))),
  countDocuments: async () => { if (failCount) throw new Error('db hiccup'); return docs.filter((d) => get(d, 'ayrshare.profileKey')).length; }
};
stub('models/User', User);
stub('models/StaffAction', { create: async () => {} });
stub('models/FeatureEvent', { aggregate: async () => [] });
stub('models/Draft', { aggregate: async () => [] });
stub('middleware/auth', { protect: (q, s, n) => n() });
const router = require('../routes/staff');

const paid = (id, at, over = {}) => ({ razorpayOrderId: 'o', razorpayPaymentId: id, amount: 1178.82, exGstAmount: 999, currency: 'INR', credits: 500, status: 'paid', item: 'Nebulaa Quarks', paidAt: at, ...over });
function seed() {
  failCount = false;
  docs = [
    { _id: OWNER, email: 'o@x.com', staffRole: 'owner', isHidden: true },
    { _id: ADMIN, email: 'a@x.com', staffRole: 'admin', isHidden: true },
    { _id: CSM, email: 'c@x.com', staffRole: 'csm', isCsm: true, isHidden: true },
    { _id: CUST, email: 'u@x.com', staffRole: null, companyName: 'Acme', payments: [paid('p1', ago(1)), paid('p2', ago(2)), paid('p3', ago(3))], ayrshare: { profileKey: 'k1' } },
    { _id: 'e'.repeat(24), email: 'v@x.com', staffRole: null, companyName: 'Beta', ayrshare: { profileKey: '' } }
  ];
}

async function call(route, { as, query = {}, body = {}, headers = {} } = {}) {
  const layer = router.stack.find((l) => l.route && l.route.path === route && l.route.methods.get);
  assert.ok(layer, `GET ${route} is not registered`);
  const req = { user: as ? { _id: as } : null, body, params: {}, query, headers };
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

test('the Owner gets the money numbers', async () => {
  seed();
  const r = await call('/money', { as: OWNER });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.revenue.allTime.count, 3);
  assert.strictEqual(r.body.revenue.allTime.exGstPaise, 3 * 99900);
  assert.strictEqual(r.body.ayrshare.profiles, 1);
  assert.strictEqual(r.body.planMix.customers, 2);
  assert.strictEqual(r.body.payments.rows.length, 3);
});

test('an Admin, a CSM, a customer and a signed-out caller are all refused, on both money routes', async () => {
  seed();
  for (const route of ['/money', '/money/payments']) {
    assert.strictEqual((await call(route, { as: ADMIN })).statusCode, 403, `admin ${route}`);
    assert.strictEqual((await call(route, { as: CSM })).statusCode, 403, `csm ${route}`);
    assert.strictEqual((await call(route, { as: CUST })).statusCode, 403, `customer ${route}`);
    assert.strictEqual((await call(route, { as: null })).statusCode, 401, `signed out ${route}`);
  }
});

test('claims sent by the caller (role in the query, body or headers) do not open the page', async () => {
  seed();
  const r = await call('/money', { as: ADMIN, query: { role: 'owner', staffRole: 'owner' }, body: { staffRole: 'owner' }, headers: { 'x-staff-role': 'owner' } });
  assert.strictEqual(r.statusCode, 403);
  assert.strictEqual(r.body.money, undefined);
  assert.ok(!JSON.stringify(r.body).includes('Paise'));
});

test('a switched-off Owner is refused', async () => {
  seed();
  docs.find((d) => d._id === OWNER).isActive = false;
  assert.strictEqual((await call('/money', { as: OWNER })).statusCode, 403);
});

test('the payments route pages, and never returns another account\'s staff or hidden data', async () => {
  seed();
  docs.push({ _id: 'f'.repeat(24), email: 'h@x.com', staffRole: null, isHidden: true, payments: [paid('hid', ago(1))] });
  const r = await call('/money/payments', { as: OWNER, query: { page: '2', pageSize: '2' } });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual([r.body.total, r.body.pages, r.body.page, r.body.rows.length], [3, 2, 2, 1]);
});

test('if the profile count cannot be read the rest of the page still loads and that panel says so', async () => {
  seed(); failCount = true;
  const r = await call('/money', { as: OWNER });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.ayrshare.available, false);
  assert.strictEqual(r.body.revenue.allTime.count, 3);
});

test('no provider text, keys or password fields appear in the response', async () => {
  seed();
  docs.find((d) => d._id === CUST).payments.push({ razorpayOrderId: 'x', razorpayPaymentId: 'pay_secret_1', status: 'failed', item: 'Razorpay error BAD_REQUEST', amount: 100, paidAt: ago(1) });
  const text = JSON.stringify((await call('/money', { as: OWNER })).body);
  assert.doesNotMatch(text, /razorpay|BAD_REQUEST|password|profileKey|k1|pay_secret/i);
});
