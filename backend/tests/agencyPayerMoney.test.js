// Money paths for a client workspace (charged to the agency) and for every other account (exactly as before).
// In-memory User and QuarkLedger stand in for MongoDB: no database, no network.
const test = require('node:test');
const assert = require('node:assert');

const users = {};
const ledger = [];
const calls = { spendFilters: [], refunds: [], updateOne: [] };
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function matches(doc, q) {
  return Object.entries(q).every(([k, c]) => {
    const v = k === '_id' ? doc._id : get(doc, k);
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      if ('$gte' in c && !(v >= c.$gte)) return false;
      if ('$ne' in c && v === c.$ne) return false;
      return true;
    }
    if (c === null) return v === null || v === undefined;
    return String(v) === String(c);
  });
}
const clone = (d) => (d ? JSON.parse(JSON.stringify(d)) : d);
const chain = (d) => { const c = { select: () => c, lean: async () => clone(d), then: (res, rej) => Promise.resolve(clone(d)).then(res, rej) }; return c; };
const UserStub = {
  findById: (id) => chain(users[String(id)]),
  findOneAndUpdate: async (q, u) => {
    if (!Array.isArray(u)) return null;
    calls.spendFilters.push(q);
    const doc = users[String(q._id)];
    if (!doc || !matches(doc, q)) return null;
    const cost = u[0].$set['credits.balance'].$subtract[1];
    doc.credits.balance -= cost;
    doc.credits.totalUsed = (doc.credits.totalUsed || 0) + cost;
    return clone(doc);
  },
  findByIdAndUpdate: async (id, update) => {
    calls.refunds.push({ id, update });
    const doc = users[String(id)];
    if (!doc) return null;
    Object.entries(update.$inc || {}).forEach(([k, n]) => { const [, f] = k.split('.'); doc.credits[f] = (doc.credits[f] || 0) + n; });
    return clone(doc);
  },
  updateOne: async (q, update) => {
    calls.updateOne.push({ q, update });
    const doc = users[String(q._id)];
    if (!doc) return { modifiedCount: 0 };
    Object.entries(update.$inc || {}).forEach(([k, n]) => { const [, f] = k.split('.'); doc.credits[f] = (doc.credits[f] || 0) + n; });
    return { modifiedCount: 1 };
  }
};
const reg = (p, exports) => { const f = require.resolve(p); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
reg('../models/User', UserStub);
reg('../models/QuarkLedger', { create: async (row) => { ledger.push(row); return row; } });
const guard = require('../middleware/trialGuard');
const cg = require('../middleware/creditGuard');
const qb = require('../services/quarkBuckets');
const { QUARK_COSTS } = require('../config/apiCosts');

const ACTION = 'image_generated';
const COST = QUARK_COSTS[ACTION];
const settleTick = () => new Promise((r) => setImmediate(r));
const T = { startDate: '2026-01-01T00:00:00.000Z' };
const agency = (balance, extra = {}) => ({ _id: 'o1', trial: T, plan: { tier: 'agency' }, credits: { balance, totalUsed: 0, planBalance: balance, planExpiresAt: new Date(Date.now() + 864e5) }, ...extra });
const client = (own = 1000) => ({ _id: 'w1', trial: T, agency: { ownerId: 'o1' }, credits: { balance: own, totalUsed: 0 } });
function reset(docs) {
  Object.keys(users).forEach((k) => delete users[k]);
  ledger.length = 0; calls.spendFilters.length = 0; calls.refunds.length = 0; calls.updateOne.length = 0;
  docs.forEach((d) => { users[d._id] = d; });
}
const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test('a client spend is charged to the agency pool, the ledger names the client, and the client record is untouched', async () => {
  reset([agency(100), client(1000)]);
  const r = await guard.deductCredits('w1', ACTION, 1, 'test');
  await settleTick();
  assert.strictEqual(r.success, true);
  assert.strictEqual(users.o1.credits.balance, 100 - COST);
  assert.strictEqual(r.creditsRemaining, 100 - COST);
  assert.deepStrictEqual(users.w1.credits, { balance: 1000, totalUsed: 0 });
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(String(ledger[0].user), 'o1');
  assert.strictEqual(String(ledger[0].workspace), 'w1');
  assert.strictEqual(ledger[0].type, 'spend');
});

test('a client of an agency with too few Quarks is refused on the plain not-enough path and nothing is charged', async () => {
  reset([agency(COST - 1), client(1000)]);
  const r = await guard.deductCredits('w1', ACTION, 1, 'test');
  assert.strictEqual(r.success, false);
  assert.match(r.error, /Insufficient Quarks/);
  assert.strictEqual(users.o1.credits.balance, COST - 1);
  assert.strictEqual(users.w1.credits.balance, 1000);
  assert.strictEqual(ledger.length, 0);
});

test('a client of an agency with no active agency plan cannot spend, even when the pool still holds Quarks', async () => {
  for (const owner of [agency(500, { plan: { tier: 'free' } }), agency(500, { subscription: { status: 'halted' } }), agency(500, { isActive: false }), agency(500, { agency: { ownerId: 'x' } })]) {
    reset([owner, client(1000)]);
    const r = await guard.deductCredits('w1', ACTION, 1, 'test');
    assert.strictEqual(r.success, false);
    assert.match(r.error, /Insufficient Quarks/);
    assert.strictEqual(users.o1.credits.balance, 500);
    assert.strictEqual(users.w1.credits.balance, 1000);
    assert.strictEqual(ledger.length, 0);
  }
});

test('a client whose agency account is gone is refused and the client record is never charged', async () => {
  reset([client(1000)]);
  const r = await guard.deductCredits('w1', ACTION, 1, 'test');
  assert.strictEqual(r.success, false);
  assert.strictEqual(users.w1.credits.balance, 1000);
  assert.strictEqual(ledger.length, 0);
  const s = await qb.spend('w1', COST, { action: ACTION });
  assert.deepStrictEqual(s, { success: false, balance: null, spent: 0 });
});

test('concurrent client spends cannot overdraw the shared pool', async () => {
  reset([agency(COST * 2), client(0), { ...client(0), _id: 'w2' }]);
  const results = await Promise.all(['w1', 'w2', 'w1', 'w2', 'w1'].map((id) => guard.deductCredits(id, ACTION, 1, 'race')));
  assert.strictEqual(results.filter((r) => r.success).length, 2);
  assert.strictEqual(users.o1.credits.balance, 0);
});

test('an account without an agency block is charged exactly as before (managed and starter)', async () => {
  for (const id of ['managed1', 'starter1']) {
    const tier = id === 'managed1' ? 'managed' : 'starter';
    reset([{ _id: id, plan: { tier }, credits: { balance: 100, totalUsed: 0, planBalance: 100, planExpiresAt: new Date(Date.now() + 864e5) } }]);
    const r = await guard.deductCredits(id, ACTION, 1, 'test');
    await settleTick();
    assert.strictEqual(r.success, true);
    assert.strictEqual(users[id].credits.balance, 100 - COST);
    assert.deepStrictEqual(calls.spendFilters, [{ _id: id, 'credits.balance': { $gte: COST } }]);
    assert.strictEqual(ledger.length, 1);
    assert.strictEqual(String(ledger[0].user), id);
    assert.ok(!('workspace' in ledger[0]) || ledger[0].workspace === undefined);
    // too little: refused with the same message shape
    const poor = await guard.deductCredits(id, ACTION, 100, 'test');
    assert.strictEqual(poor.success, false);
    assert.match(poor.error, new RegExp(`^Insufficient Quarks. Need ${COST * 100}, have ${100 - COST}\\.`));
  }
});

test('a refund for a client goes to the agency pool with a ledger row naming the client', async () => {
  reset([agency(100), client(1000)]);
  const r = await guard.refundCredits('w1', ACTION, 1, 'test');
  await settleTick();
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.creditsRefunded, COST);
  assert.strictEqual(users.o1.credits.balance, 100 + COST);
  assert.deepStrictEqual(users.w1.credits, { balance: 1000, totalUsed: 0 });
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(ledger[0].type, 'refund');
  assert.strictEqual(String(ledger[0].user), 'o1');
  assert.strictEqual(String(ledger[0].workspace), 'w1');
  assert.strictEqual(ledger[0].quarks, COST);
});

test('a refund still reaches the agency when its plan has ended since the charge', async () => {
  reset([agency(0, { plan: { tier: 'free' } }), client(1000)]);
  const r = await guard.refundCredits('w1', ACTION, 1, 'test');
  assert.strictEqual(r.success, true);
  assert.strictEqual(users.o1.credits.balance, COST);
  assert.strictEqual(users.w1.credits.balance, 1000);
});

test('a refund uses the payer recorded at charge time even if the client record was removed since', async () => {
  reset([agency(100)]);
  const r = await guard.refundCredits('w1', ACTION, 1, 'test', { payerId: 'o1' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(users.o1.credits.balance, 100 + COST);
  assert.strictEqual(String(ledger[0].workspace), 'w1');
});

test('a refund for a client with no agency and no recorded payer is refused and credits nobody', async () => {
  reset([client(1000)]);
  const r = await guard.refundCredits('w1', ACTION, 1, 'test');
  assert.strictEqual(r.success, false);
  assert.strictEqual(calls.refunds.length, 0);
  assert.strictEqual(users.w1.credits.balance, 1000);
  const gone = await guard.refundCredits('nobody', ACTION, 1, 'test');
  assert.strictEqual(gone.success, false);
});

test('a refund for an account without an agency block is the same update as before and writes no ledger row', async () => {
  reset([{ _id: 'm1', plan: { tier: 'managed' }, credits: { balance: 10, totalUsed: 5, planBalance: 0 } }]);
  const r = await guard.refundCredits('m1', ACTION, 2, 'why');
  await settleTick();
  assert.strictEqual(r.success, true);
  assert.strictEqual(calls.refunds.length, 1);
  assert.strictEqual(calls.refunds[0].id, 'm1');
  assert.deepStrictEqual(calls.refunds[0].update.$inc, { 'credits.balance': COST * 2, 'credits.totalUsed': -COST * 2 });
  assert.strictEqual(calls.refunds[0].update.$push['credits.history'].$each[0].action, `${ACTION}_refund`);
  assert.strictEqual(ledger.length, 0);
});

test('checkTrial and requireCredits read the agency pool for a client, and the user own balance for everyone else', async () => {
  reset([agency(COST), client(0), { _id: 'm1', credits: { balance: 0 } }]);
  let r = res(); let nexted = false;
  await guard.checkTrial({ user: { userId: 'w1' } }, r, () => { nexted = true; });
  assert.ok(nexted, 'a client with Quarks in the pool may go on');
  r = res(); nexted = false;
  await guard.requireCredits(ACTION, 1)({ user: { userId: 'w1' } }, r, () => { nexted = true; });
  assert.ok(nexted);
  reset([agency(0), client(1000)]);
  r = res(); nexted = false;
  await guard.checkTrial({ user: { userId: 'w1' } }, r, () => { nexted = true; });
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.body.creditsExhausted, true);
  r = res(); nexted = false;
  await guard.requireCredits(ACTION, 1)({ user: { userId: 'w1' } }, r, () => { nexted = true; });
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.body.creditsRemaining, 0);
  reset([{ _id: 'm1', credits: { balance: 0 } }]);
  r = res();
  await guard.checkTrial({ user: { userId: 'm1' } }, r, () => assert.fail('must be refused'));
  assert.strictEqual(r.code, 403);
});

test('the creditGuard helpers charge and check the agency pool for a client', async () => {
  reset([agency(50), client(1000)]);
  const d = await cg.deductCredits('w1', 7, 'action');
  await settleTick();
  assert.strictEqual(d.creditsDeducted, 7);
  assert.strictEqual(d.balance, 43);
  assert.strictEqual(users.o1.credits.balance, 43);
  assert.strictEqual(users.w1.credits.balance, 1000);
  assert.strictEqual(String(ledger[0].workspace), 'w1');
  assert.strictEqual(await cg.requireCredits('w1', 40), 43);
  await assert.rejects(() => cg.requireCredits('w1', 44), (e) => e.message === 'Insufficient Quarks' && e.creditsRemaining === 43);
  const r = res(); let nexted = false;
  await cg.checkCredits(44)({ user: { userId: 'w1' } }, r, () => { nexted = true; });
  assert.strictEqual(r.code, 403);
  assert.strictEqual(r.body.creditsRemaining, 43);
});

test('the creditGuard helpers behave as before for an account without an agency block', async () => {
  reset([{ _id: 'm1', credits: { balance: 20, totalUsed: 0 }, trial: { startDate: new Date() }, save: undefined }]);
  assert.strictEqual(await cg.requireCredits('m1', 20), 20);
  await assert.rejects(() => cg.requireCredits('m1', 21), (e) => e.creditsRemaining === 20 && e.required === 21);
  const d = await cg.deductCredits('m1', 5, 'action');
  assert.strictEqual(d.creditsDeducted, 5);
  assert.strictEqual(users.m1.credits.balance, 15);
});
