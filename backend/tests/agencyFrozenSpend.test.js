// A frozen client workspace (over the limit after a slot or the plan ended) must not spend or reserve the agency's
// shared pool by any path, with or without a pass. Refunds are still allowed. In-memory fakes only.
const test = require('node:test');
const assert = require('node:assert');

const users = {};
const ledger = [];
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const clone = (d) => (d ? JSON.parse(JSON.stringify(d)) : d);
const chain = (d) => ({ select() { return this; }, lean: async () => clone(d) });
const UserStub = {
  findById: (id) => chain(users[String(id)]),
  updateOne: async (q, u) => { const d = users[String(q._id)]; if (!d) return { modifiedCount: 0 }; for (const [k, n] of Object.entries(u.$inc || {})) { const ks = k.split('.'); let c = d; ks.slice(0, -1).forEach((x) => { c = c[x]; }); c[ks.at(-1)] = (c[ks.at(-1)] || 0) + n; } return { modifiedCount: 1 }; },
  findOneAndUpdate: async (q, u) => {
    const d = users[String(q._id)];
    if (!d) return null;
    const cost = u[0].$set['credits.balance'].$subtract[1];
    if (!(d.credits.balance >= cost)) return null;
    d.credits.balance -= cost;
    return clone(d);
  }
};
const reg = (p, exports) => { const f = require.resolve(p); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
reg('../models/User', UserStub);
reg('../models/QuarkLedger', { create: async (row) => { ledger.push(row); return row; } });
const qb = require('../services/quarkBuckets');
const agencyRules = require('../services/agency');

function reset(frozen) {
  Object.keys(users).forEach((k) => delete users[k]);
  ledger.length = 0;
  users.o1 = { _id: 'o1', plan: { tier: 'agency' }, credits: { balance: 100, totalUsed: 0 } };
  users.w1 = { _id: 'w1', plan: { tier: 'agency' }, agency: { ownerId: 'o1', frozen }, credits: { balance: 0, totalUsed: 0 } };
}

test('a frozen client cannot spend the shared pool, even with no pass (a scheduled job or an automatic reply)', async () => {
  reset(true);
  const r = await qb.spend('w1', 5, { action: 'scheduled_batch' });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.spent, 0);
  assert.strictEqual(users.o1.credits.balance, 100, 'the pool is untouched');
  assert.strictEqual(ledger.length, 0);
});

test('an active client still spends the pool, and the agency itself is never blocked by a client being frozen', async () => {
  reset(false);
  assert.strictEqual((await qb.spend('w1', 5, { action: 'x' })).success, true);
  assert.strictEqual(users.o1.credits.balance, 95);
  reset(true);
  assert.strictEqual((await qb.spend('o1', 5, { action: 'x' })).success, true);
  assert.strictEqual(users.o1.credits.balance, 95);
});

test('a frozen client sees a pool balance of 0 so every guard refuses with the not enough Quarks wording', async () => {
  reset(true);
  assert.strictEqual(await agencyRules.walletBalance('w1'), 0);
  assert.deepStrictEqual(await agencyRules.publicCredits(clone(users.w1)), { balance: 0, totalUsed: 0 });
  reset(false);
  assert.strictEqual(await agencyRules.walletBalance('w1'), 100);
  assert.deepStrictEqual(await agencyRules.publicCredits(clone(users.w1)), { balance: 100, totalUsed: 0 });
});

test('a refund for work done earlier still lands in the pool when the client is frozen', async () => {
  reset(true);
  const r = await qb.refundTo('w1', 4, { action: 'x_refund', payerId: 'o1' });
  assert.deepStrictEqual(r, { ok: true, payerId: 'o1' });
  assert.strictEqual(users.o1.credits.balance, 104);
  const r2 = await qb.refundTo('w1', 3, { action: 'x_refund' });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(users.o1.credits.balance, 107);
});
