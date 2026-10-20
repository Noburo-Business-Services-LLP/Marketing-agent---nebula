// The proof that a charge (or a refund) happened is written in the SAME atomic update as the balance change: the
// `ref` goes into the credits.history entry. Crash recovery must not depend on the Quark ledger row, which is written
// after the debit and may fail. In-memory User and ledger only: no database.
const test = require('node:test');
const assert = require('node:assert');

const users = {};
const ledger = [];
const flags = { ledgerFails: false, ledgerDelay: false };
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const set = (o, p, v) => { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { c[k] = c[k] || {}; c = c[k]; }); c[ks.at(-1)] = v; };
const clone = (d) => (d ? JSON.parse(JSON.stringify(d)) : d);
const chain = (v) => { const c = { select: () => c, maxTimeMS: () => c, lean: async () => clone(v), then: (a, b) => Promise.resolve(clone(v)).then(a, b) }; return c; };
const historyRefMatch = (doc, ref) => ((doc.credits && doc.credits.history) || []).some((h) => h && h.ref === ref);
const UserStub = {
  findById: (id) => chain(users[String(id)] || null),
  find: (q) => chain(Object.values(users).filter((d) => (q._id.$in || []).map(String).includes(String(d._id)) && historyRefMatch(d, q['credits.history.ref']))),
  findOne: (q) => chain(Object.values(users).find((d) => (q._id.$in || []).map(String).includes(String(d._id)) && historyRefMatch(d, q['credits.history.ref'])) || null),
  findOneAndUpdate: async (q, u) => {
    const d = users[String(q._id)];
    if (!d || !Array.isArray(u)) return null;
    const cost = u[0].$set['credits.balance'].$subtract[1];
    if (!(d.credits.balance >= cost)) return null;
    d.credits.balance -= cost;
    const entry = u[0].$set['credits.history'].$slice[0].$concatArrays[1][0].$literal;
    d.credits.history = [...(d.credits.history || []), clone(entry)];
    return clone(d);
  },
  updateOne: async (q, u) => {
    const d = users[String(q._id)];
    if (!d) return { modifiedCount: 0 };
    Object.entries(u.$inc || {}).forEach(([k, n]) => set(d, k, (get(d, k) || 0) + n));
    Object.entries(u.$push || {}).forEach(([k, v]) => set(d, k, [...(get(d, k) || []), ...clone(v.$each)]));
    return { modifiedCount: 1 };
  }
};
const LedgerStub = {
  create: async (row) => { if (flags.ledgerDelay) await new Promise((r) => setTimeout(r, 20)); if (flags.ledgerFails) throw new Error('disk full'); ledger.push(row); return row; },
  findOne: (q) => chain(ledger.find((r) => r.type === q.type && r.ref === q.ref) || null)
};
const reg = (p, exports) => { const f = require.resolve(p); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
reg('../models/User', UserStub);
reg('../models/QuarkLedger', LedgerStub);
const qb = require('../services/quarkBuckets');

const tick = () => new Promise((r) => setImmediate(r));
function reset(docs) {
  Object.keys(users).forEach((k) => delete users[k]);
  ledger.length = 0; flags.ledgerFails = false; flags.ledgerDelay = false;
  docs.forEach((d) => { users[d._id] = clone(d); });
}
const plain = (id = 'p1', balance = 100) => ({ _id: id, plan: { tier: 'starter' }, credits: { balance, totalUsed: 0, history: [] } });

test('the spend history entry carries the ref, written in the same update as the debit', async () => {
  reset([plain()]);
  const r = await qb.spend('p1', 30, { action: 'photoshoot_image', ref: 'job-1' });
  assert.strictEqual(r.success, true);
  const h = users.p1.credits.history.at(-1);
  assert.strictEqual(h.ref, 'job-1'); assert.strictEqual(h.amount, -30);
});

test('a ledger write that fails after the debit: the charge is still proven from the history', async () => {
  reset([plain()]);
  flags.ledgerFails = true;
  const warn = console.warn; console.warn = () => {};
  try {
    const r = await qb.spend('p1', 30, { action: 'home_witty_comment', ref: 'draft-1' });
    await tick();
    assert.strictEqual(r.success, true);
  } finally { console.warn = warn; }
  assert.strictEqual(ledger.length, 0, 'no ledger row was written');
  const proof = await qb.chargeProof('draft-1', { userId: 'p1' });
  assert.deepStrictEqual(proof.spend, { payer: 'p1', workspace: '', quarks: 30, source: 'history' });
  assert.strictEqual(proof.refunded, false);
});

test('the ledger row is used first when it exists', async () => {
  reset([plain()]);
  await qb.spend('p1', 30, { action: 'x', ref: 'r-ledger' });
  await tick();
  const proof = await qb.chargeProof('r-ledger', { userId: 'p1' });
  assert.strictEqual(proof.spend.source, 'ledger'); assert.strictEqual(proof.spend.quarks, 30);
});

test('an agency client: the charge is proven on the agency pool that paid, and named for the client', async () => {
  reset([{ _id: 'o1', plan: { tier: 'agency' }, credits: { balance: 100, history: [] } }, { _id: 'w1', agency: { ownerId: 'o1' }, credits: { balance: 0 } }]);
  flags.ledgerFails = true;
  const warn = console.warn; console.warn = () => {};
  try { await qb.spend('w1', 10, { action: 'x', ref: 'pool-1' }); await tick(); } finally { console.warn = warn; }
  const proof = await qb.chargeProof('pool-1', { userId: 'w1' });
  assert.deepStrictEqual(proof.spend, { payer: 'o1', workspace: 'w1', quarks: 10, source: 'history' });
});

test('no proof at all: no spend, not refunded', async () => {
  reset([plain()]);
  const proof = await qb.chargeProof('never', { userId: 'p1' });
  assert.deepStrictEqual(proof, { spend: null, refunded: false });
});

test('a refund leaves its own proof in the same update, so a refund whose ledger row failed is never paid twice', async () => {
  reset([plain()]);
  await qb.spend('p1', 30, { action: 'x', ref: 'r2' });
  flags.ledgerFails = true;
  const warn = console.warn; console.warn = () => {};
  try { assert.strictEqual((await qb.refundTo('p1', 30, { action: 'x_refund', ref: 'r2' })).ok, true); await tick(); } finally { console.warn = warn; }
  assert.strictEqual(users.p1.credits.balance, 100);
  const h = users.p1.credits.history.at(-1);
  assert.strictEqual(h.ref, 'r2'); assert.strictEqual(h.amount, 30); assert.strictEqual(h.action, 'x_refund');
  const proof = await qb.chargeProof('r2', { userId: 'p1' });
  assert.strictEqual(proof.refunded, true);
});

test('the Home summary of the payer is forgotten after a spend and after a refund', async () => {
  const cache = require('../services/homeSummaryCache').sharedCache();
  reset([plain()]);
  cache.set('p1:0', { balance: 100 }); cache.set('p1:1', { balance: 100 });
  await qb.spend('p1', 5, { action: 'x', ref: 'c1' });
  assert.strictEqual(cache.get('p1:0'), undefined); assert.strictEqual(cache.get('p1:1'), undefined);
  cache.set('p1:0', { balance: 95 });
  await qb.refundTo('p1', 5, { action: 'x_refund', ref: 'c1' });
  assert.strictEqual(cache.get('p1:0'), undefined);
  assert.strictEqual(require('../routes/home').cache, cache, 'the route uses the same cache');
});

test('spend and refund return only after the ledger row is written, and the debit is already in place', async () => {
  reset([plain()]);
  flags.ledgerDelay = true;
  await qb.spend('p1', 30, { action: 'x', ref: 'w1' });
  assert.strictEqual(ledger.length, 1, 'ledger row written before spend returned');
  assert.strictEqual(ledger[0].balanceAfter, 70);
  await qb.refundTo('p1', 30, { action: 'x_refund', ref: 'w1' });
  assert.strictEqual(ledger.length, 2, 'refund row written before refund returned');
  assert.strictEqual(ledger[1].type, 'refund');
});

test('a failing ledger write does not fail the spend or the refund (awaited, error swallowed)', async () => {
  reset([plain()]);
  flags.ledgerFails = true;
  const warn = console.warn; console.warn = () => {};
  try {
    const r = await qb.spend('p1', 30, { action: 'x', ref: 'f1' });
    assert.strictEqual(r.success, true); assert.strictEqual(r.balance, 70);
    assert.strictEqual((await qb.refundTo('p1', 30, { action: 'x_refund', ref: 'f1' })).ok, true);
  } finally { console.warn = warn; }
});
