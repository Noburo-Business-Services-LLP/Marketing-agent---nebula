// GET /api/staff/usage end to end with fake collections: Owner full, Admin summary, everyone else refused.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const OWNER = 'a'.repeat(24);
const ADMIN = 'b'.repeat(24);
const CSM = 'c'.repeat(24);
const CUST = 'd'.repeat(24);
const CUST2 = 'e'.repeat(24);
const HIDDEN = 'f'.repeat(24);
const NOW = Date.now();
const ago = (d) => new Date(NOW - d * 86400000);

let docs = [];
let aggregates = {};      // model name -> (pipeline) => rows
let failing = new Set();  // model names whose aggregate throws
const seen = [];          // [model, pipeline] for every aggregate run
function stub(rel, exports) {
  const id = require.resolve(path.join('..', rel));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const chain = (value) => { const p = Promise.resolve(value); p.select = () => p; p.lean = () => p; p.sort = () => p; return p; };
const User = {
  findById: (id) => chain(docs.filter((d) => String(d._id) === String(id)).map((d) => ({ ...d }))[0] || null),
  find: (q) => chain(docs.filter((d) => (q.staffRole === null ? !d.staffRole : true) && !d.isCsm).map((d) => ({ ...d })))
};
const model = (name) => ({
  aggregate: async (pipeline) => {
    seen.push([name, pipeline]);
    if (failing.has(name)) throw new Error('db hiccup');
    return (aggregates[name] || (() => []))(pipeline);
  }
});
stub('models/User', User);
stub('models/StaffAction', { create: async () => {} });
stub('models/FeatureEvent', model('FeatureEvent'));
for (const n of ['Draft', 'Campaign', 'VideoJob', 'HeroVideoJob', 'Blueprint', 'SocialInboxMessage']) stub(`models/${n}`, model(n));
stub('middleware/auth', { protect: (q, s, n) => n() });
const router = require('../routes/staff');

const hasKey = (pipeline, key) => JSON.stringify(pipeline[0]).includes(`"${key}"`);
function seed() {
  failing = new Set(); seen.length = 0;
  docs = [
    { _id: OWNER, email: 'o@x.com', staffRole: 'owner', isHidden: true },
    { _id: ADMIN, email: 'a@x.com', staffRole: 'admin', isHidden: true },
    { _id: CSM, email: 'c@x.com', staffRole: 'csm', isCsm: true, isHidden: true },
    { _id: CUST, email: 'u@x.com', staffRole: null, companyName: 'Acme', createdAt: ago(3), onboardingCompleted: true, plan: { tier: 'starter' },
      credits: { history: [{ action: 'blueprint', amount: -60, createdAt: new Date(NOW - 1000) }] } },
    { _id: CUST2, email: 'v@x.com', staffRole: null, companyName: 'Beta', createdAt: ago(40), onboardingCompleted: false },
    { _id: HIDDEN, email: 'h@x.com', staffRole: null, isHidden: true, createdAt: ago(2) }
  ];
  aggregates = {
    Draft: (p) => (hasKey(p, 'status') ? [{ _id: CUST, n: 1 }] : hasKey(p, 'languageVariantOf') ? [{ _id: CUST, n: 4 }, { _id: HIDDEN, n: 9 }] : [{ _id: CUST, n: 6 }]),
    Campaign: (p) => (hasKey(p, 'publishedAt') ? [{ _id: CUST, n: 2 }] : [{ _id: CUST, n: 1 }]),
    VideoJob: () => [{ _id: CUST, n: 1 }]
  };
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

test('the Owner gets the full Usage numbers', async () => {
  seed();
  const r = await call('/usage', { as: OWNER });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.level, 'full');
  const f = (k) => r.body.featureUse.items.find((i) => i.key === k);
  assert.deepStrictEqual([f('postsDrafted').count, f('postsDrafted').clients], [4, 1]); // the hidden account's 9 are left out
  assert.strictEqual(f('postsPublished').count, 2);
  assert.strictEqual(r.body.quarks.available, true);
  assert.strictEqual(r.body.quarks.total, 60);
  assert.strictEqual(r.body.funnel.days, 30);
  assert.strictEqual(r.body.funnel.steps[0].count, 1); // CUST signed up 3 days ago; CUST2 40 days ago; hidden never counted
});

test('an Admin gets the summary: no Quark spending', async () => {
  seed();
  const r = await call('/usage', { as: ADMIN });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.level, 'summary');
  assert.strictEqual(r.body.quarks.available, false);
  assert.strictEqual(r.body.quarks.restricted, true);
  assert.ok(!JSON.stringify(r.body).includes('"total":60'));
  assert.strictEqual(r.body.featureUse.items.length, 7);
});

test('a CSM, a customer and a signed-out caller are refused', async () => {
  seed();
  assert.strictEqual((await call('/usage', { as: CSM })).statusCode, 403);
  assert.strictEqual((await call('/usage', { as: CUST })).statusCode, 403);
  assert.strictEqual((await call('/usage', { as: null })).statusCode, 401);
  const r = await call('/usage', { as: CUST });
  assert.strictEqual(r.body.featureUse, undefined);
});

test('claims sent by the caller do not raise an Admin to the full view or open the page for a CSM', async () => {
  seed();
  const a = await call('/usage', { as: ADMIN, query: { role: 'owner', level: 'full', staffRole: 'owner' }, body: { staffRole: 'owner' }, headers: { 'x-staff-role': 'owner' } });
  assert.strictEqual(a.statusCode, 200);
  assert.strictEqual(a.body.level, 'summary');
  assert.strictEqual(a.body.quarks.available, false);
  const c = await call('/usage', { as: CSM, query: { role: 'owner' }, headers: { 'x-staff-role': 'owner' } });
  assert.strictEqual(c.statusCode, 403);
});

test('a switched-off Admin is refused', async () => {
  seed();
  docs.find((d) => d._id === ADMIN).isActive = false;
  assert.strictEqual((await call('/usage', { as: ADMIN })).statusCode, 403);
});

test('the window is 30 or 90 days; anything else is refused with a plain message', async () => {
  seed();
  assert.strictEqual((await call('/usage', { as: OWNER, query: { window: '90' } })).body.funnel.days, 90);
  const r90 = await call('/usage', { as: OWNER, query: { window: '90' } });
  assert.strictEqual(r90.body.funnel.steps[0].count, 2); // CUST2 (40 days) is now inside
  const bad = await call('/usage', { as: OWNER, query: { window: '7' } });
  assert.strictEqual(bad.statusCode, 400);
  assert.match(bad.body.message, /30 or 90/);
});

test('one source failing leaves the rest of the page working and says what could not be read', async () => {
  seed(); failing.add('VideoJob');
  const r = await call('/usage', { as: OWNER });
  assert.strictEqual(r.statusCode, 200);
  const v = r.body.featureUse.items.find((i) => i.key === 'videos');
  assert.strictEqual(v.available, false);
  assert.match(v.reason, /could not read/i);
  assert.strictEqual(r.body.featureUse.items.find((i) => i.key === 'postsDrafted').available, true);
  assert.strictEqual(r.body.funnel.available, true);
  assert.strictEqual(r.body.funnel.steps.find((s) => s.key === 'firstContent').available, false);
});

test('no database ids, provider text, keys or password fields leak into the response', async () => {
  seed();
  docs.find((d) => d._id === CUST).password = 'secret-hash';
  docs.find((d) => d._id === CUST).ayrshare = { profileKey: 'pk_live_1' };
  const text = JSON.stringify((await call('/usage', { as: OWNER })).body);
  assert.doesNotMatch(text, /secret-hash|pk_live|password|profileKey|u@x\.com|Acme|razorpay/i);
});
