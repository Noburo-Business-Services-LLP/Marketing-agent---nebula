// Money code added for the shared agency pool that other tests did not reach: refundTo, settleWallet, the PAID_TIERS
// change, the Videos payer stamp and refund, the Blueprint payer, the credits route's pool lookup and the pool balance
// shown on profile routes. In-memory fakes only: no database, no network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const users = {};
const ledger = [];
const videos = { docs: {}, updates: [] };
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const set = (o, p, v) => { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { c[k] = c[k] || {}; c = c[k]; }); c[ks.at(-1)] = v; };
const clone = (d) => (d ? JSON.parse(JSON.stringify(d), (k, x) => (typeof x === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(x) ? new Date(x) : x)) : d);
const chain = (d) => { const c = { select: () => c, lean: async () => clone(d), then: (res, rej) => Promise.resolve(d ? { ...clone(d), save: async () => {} } : d).then(res, rej) }; return c; };
function applyUpdate(doc, u) {
  Object.entries(u.$set || {}).forEach(([k, v]) => set(doc, k, v));
  Object.entries(u.$inc || {}).forEach(([k, n]) => set(doc, k, (get(doc, k) || 0) + n));
}
const UserStub = {
  findById: (id) => chain(users[String(id)]),
  updateOne: async (q, u) => { const d = users[String(q._id)]; if (!d) return { modifiedCount: 0 }; applyUpdate(d, u); return { modifiedCount: 1 }; },
  findOneAndUpdate: async (q, u) => {
    const d = users[String(q._id)];
    if (!d) return null;
    if (Array.isArray(u)) { // the atomic spend: balance must cover the cost
      const cost = u[0].$set['credits.balance'].$subtract[1];
      if (!(d.credits.balance >= cost)) return null;
      d.credits.balance -= cost; d.credits.totalUsed = (d.credits.totalUsed || 0) + cost;
      return clone(d);
    }
    if (q['credits.balance'] !== undefined && typeof q['credits.balance'] !== 'object' && d.credits.balance !== q['credits.balance']) return null;
    applyUpdate(d, u);
    return clone(d);
  }
};
const StudioVideoStub = {
  updateOne: async (q, u) => { videos.updates.push({ q, u }); },
  findOneAndUpdate: async (q, u) => { const d = videos.docs[String(q._id)]; if (!d) return null; Object.assign(d, (u && u.$set) || {}); return d; }
};
const reg = (p, exports) => { const f = require.resolve(p); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
reg('../models/User', UserStub);
reg('../models/QuarkLedger', { create: async (row) => { ledger.push(row); return row; } });
reg('../models/StudioVideo', StudioVideoStub);
const qb = require('../services/quarkBuckets');
const agencyRules = require('../services/agency');
const { createBlueprintService } = require('../services/blueprint/service');
const { makeDeps } = require('./blueprintFakes');

const DAY = 864e5;
const T = { startDate: '2026-01-01T00:00:00.000Z' };
const agency = (balance, extra = {}) => ({ _id: 'o1', trial: T, plan: { tier: 'agency' }, credits: { balance, totalUsed: 5, planBalance: balance, planExpiresAt: new Date(Date.now() + DAY), history: [{ action: 'agency_only_line' }] }, ...extra });
const client = (own = 777) => ({ _id: 'w1', trial: T, agency: { ownerId: 'o1' }, credits: { balance: own, totalUsed: 0 } });
const plain = (balance = 50) => ({ _id: 'p1', trial: T, plan: { tier: 'starter' }, credits: { balance, totalUsed: 0 } });
function reset(docs) {
  Object.keys(users).forEach((k) => delete users[k]);
  ledger.length = 0; videos.updates.length = 0; Object.keys(videos.docs).forEach((k) => delete videos.docs[k]);
  docs.forEach((d) => { users[d._id] = clone(d); });
}
const tick = () => new Promise((r) => setImmediate(r));

// ---- refundTo ----
test('refundTo with a recorded payer credits that payer, never the client, and the ledger names the client', async () => {
  reset([agency(10), client(777)]);
  const r = await qb.refundTo('w1', 4, { action: 'x_refund', ref: 'r1', payerId: 'o1' });
  await tick();
  assert.deepStrictEqual(r, { ok: true, payerId: 'o1' });
  assert.strictEqual(users.o1.credits.balance, 14);
  assert.strictEqual(users.o1.credits.totalUsed, 1);
  assert.deepStrictEqual({ b: users.w1.credits.balance, u: users.w1.credits.totalUsed }, { b: 777, u: 0 });
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(String(ledger[0].user), 'o1');
  assert.strictEqual(String(ledger[0].workspace), 'w1');
  assert.strictEqual(ledger[0].type, 'refund');
  assert.strictEqual(ledger[0].quarks, 4);
});

test('refundTo with no recorded payer finds the agency of the client', async () => {
  reset([agency(10), client(777)]);
  const r = await qb.refundTo('w1', 3, { action: 'x_refund' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(users.o1.credits.balance, 13);
  assert.strictEqual(users.w1.credits.balance, 777);
});

test('refundTo still lands on the recorded payer after the client record was removed', async () => {
  reset([agency(10)]);
  const r = await qb.refundTo('w1', 2, { payerId: 'o1' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(users.o1.credits.balance, 12);
});

test('refundTo for a plain account credits that account and writes no workspace key', async () => {
  reset([plain(50)]);
  const r = await qb.refundTo('p1', 6, { action: 'x_refund' });
  await tick();
  assert.deepStrictEqual(r, { ok: true, payerId: 'p1' });
  assert.strictEqual(users.p1.credits.balance, 56);
  assert.strictEqual(String(ledger[0].user), 'p1');
  assert.strictEqual(ledger[0].workspace, undefined);
});

test('refundTo does nothing for a non-positive amount, an unplaceable client, or a wallet that is gone', async () => {
  reset([agency(10), client(777)]);
  for (const q of [0, -5, 'abc', undefined]) assert.deepStrictEqual(await qb.refundTo('w1', q, { payerId: 'o1' }), { ok: false, payerId: null });
  reset([client(777)]); // agency record missing and no recorded payer: no wallet to return the Quarks to
  assert.deepStrictEqual(await qb.refundTo('w1', 3), { ok: false, payerId: null });
  assert.strictEqual(users.w1.credits.balance, 777);
  assert.deepStrictEqual(await qb.refundTo('w1', 3, { payerId: 'gone' }), { ok: false, payerId: null });
  assert.strictEqual(users.w1.credits.balance, 777);
  assert.strictEqual(ledger.length, 0);
});

// ---- settleWallet and PAID_TIERS ----
test('an agency counts as a paid tier, so its top-ups are not held when its plan month ends', async () => {
  assert.strictEqual(qb.hasActivePlan({ plan: { tier: 'agency' } }), true);
  assert.strictEqual(qb.hasActivePlan({ plan: { tier: 'agency' }, subscription: { status: 'halted' } }), false);
  assert.strictEqual(qb.hasActivePlan({ plan: { tier: 'free' } }), false);
  const ended = { balance: 150, planBalance: 100, planExpiresAt: new Date(Date.now() - 1000), topupBalance: 50, topupExpiresAt: new Date(Date.now() + 30 * DAY), totalUsed: 0 };
  reset([{ _id: 'o1', plan: { tier: 'agency' }, credits: { ...ended } }, { _id: 'o2', plan: { tier: 'free' }, credits: { ...ended } }]);
  const paid = await qb.settle('o1');
  assert.strictEqual(paid.held, 0);
  assert.strictEqual(users.o1.credits.topupBalance, 50);
  assert.strictEqual(users.o1.credits.balance, 50);
  const lapsed = await qb.settle('o2');
  assert.strictEqual(lapsed.held, 50);
});

test('settleWallet expires the agency pool for a client and leaves the client record alone', async () => {
  const ended = { balance: 150, planBalance: 100, planExpiresAt: new Date(Date.now() - 1000), topupBalance: 50, topupExpiresAt: new Date(Date.now() + 30 * DAY), totalUsed: 0 };
  reset([{ ...agency(0), credits: ended }, client(777)]);
  const r = await qb.settleWallet('w1');
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.expiredPlan, 100);
  assert.strictEqual(users.o1.credits.balance, 50);
  assert.deepStrictEqual({ b: users.w1.credits.balance, p: users.w1.credits.planBalance }, { b: 777, p: undefined });
});

test('settleWallet for a plain account settles that account', async () => {
  reset([{ _id: 'p1', plan: { tier: 'starter' }, credits: { balance: 100, planBalance: 100, planExpiresAt: new Date(Date.now() - 1000), totalUsed: 0 } }]);
  const r = await qb.settleWallet('p1');
  assert.strictEqual(r.expiredPlan, 100);
  assert.strictEqual(users.p1.credits.balance, 0);
});

// ---- Videos: payer stamped at charge time, refund goes to it ----
const videosRoute = require('../routes/studioVideos');
const { charge, fail } = videosRoute._money;

test('a Videos charge for a client stamps the agency as payer on the video', async () => {
  reset([agency(1000), client(777)]);
  const ok = await charge('w1', 'v1');
  assert.strictEqual(ok, true);
  assert.ok(users.o1.credits.balance < 1000);
  assert.strictEqual(users.w1.credits.balance, 777);
  assert.strictEqual(videos.updates.length, 1);
  assert.strictEqual(videos.updates[0].q._id, 'v1');
  assert.strictEqual(String(videos.updates[0].u.$set.payer), 'o1');
});

// The Videos refund is paid only against the charge proof: fake it as "this wallet paid this many Quarks".
const withProof = async (spend, fn) => {
  const orig = qb.chargeProof;
  qb.chargeProof = async () => ({ spend, refunded: false });
  try { return await fn(); } finally { qb.chargeProof = orig; }
};

test('a failed Videos job refunds the recorded payer, not the client, and a plain account gets its own Quarks back', async () => {
  reset([agency(10), client(777), plain(50)]);
  videos.docs.v1 = { _id: 'v1', user: 'w1', quarks: 8, payer: 'o1' };
  await withProof({ payer: 'o1', quarks: 8 }, () => fail({ _id: 'v1', user: 'w1', quarks: 8, payer: 'o1' }, 'boom'));
  assert.strictEqual(users.o1.credits.balance, 18);
  assert.strictEqual(users.w1.credits.balance, 777);
  videos.docs.v2 = { _id: 'v2', user: 'p1', quarks: 8, payer: 'p1' };
  await withProof({ payer: 'p1', quarks: 8 }, () => fail({ _id: 'v2', user: 'p1', quarks: 8, payer: 'p1' }, 'boom'));
  assert.strictEqual(users.p1.credits.balance, 58);
  // no Quarks charged: nothing is refunded
  videos.docs.v3 = { _id: 'v3', user: 'w1', quarks: 0 };
  await withProof(null, () => fail({ _id: 'v3', user: 'w1', quarks: 0 }, 'boom'));
  assert.strictEqual(users.o1.credits.balance, 18);
});

test('a failed Videos job whose client was removed still refunds the recorded payer', async () => {
  reset([agency(10)]);
  videos.docs.v1 = { _id: 'v1', user: 'w1', quarks: 5, payer: 'o1' };
  await withProof({ payer: 'o1', quarks: 5 }, () => fail({ _id: 'v1', user: 'w1', quarks: 5, payer: 'o1' }, 'boom'));
  assert.strictEqual(users.o1.credits.balance, 15);
});

// ---- Blueprint: payer recorded on the charge, refund goes to it ----
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const form = () => ({ businessName: 'Sweet Co', website: 'https://sweetco.in', whatYouSell: 'Custom cakes baked to order.', whoItsFor: 'Families in Chennai', goal: 'enquiries' });

test('a client Blueprint records the agency as payer and a failed run refunds that payer', async () => {
  const deps = makeDeps({ deduct: async (...a) => { deps.calls.deduct.push(a); return { success: true, payerId: 'o1', workspaceId: 'w1' }; } });
  deps.plan.build = async () => { throw new Error('model down'); };
  const svc = createBlueprintService(deps);
  const r = await svc.start({ user: { _id: 'w1', email: 'c@example.com', isVerified: true }, tier: 'agency', body: form(), ip: '1.1.1.1' });
  assert.strictEqual(r.status, 202);
  assert.strictEqual(deps.Blueprint.docs[0].charge.payerId, 'o1');
  await quiet(() => deps.drain());
  assert.strictEqual(deps.calls.refund.length, 1);
  assert.deepStrictEqual(deps.calls.refund[0].slice(0, 3), ['w1', 'blueprint', 1]);
  assert.deepStrictEqual(deps.calls.refund[0][4], { ref: 'bp-1', payerId: 'o1' });
});

test('a Blueprint for an ordinary account records no payer and refunds with the old arguments', async () => {
  const deps = makeDeps({ deduct: async (...a) => { deps.calls.deduct.push(a); return { success: true, payerId: 'u1', workspaceId: null }; } });
  deps.plan.build = async () => { throw new Error('model down'); };
  const svc = createBlueprintService(deps);
  await svc.start({ user: { _id: 'u1', email: 'o@example.com', isVerified: true }, tier: 'free', body: form(), ip: '1.1.1.1' });
  assert.strictEqual(deps.Blueprint.docs[0].charge.payerId, undefined);
  await quiet(() => deps.drain());
  assert.deepStrictEqual(deps.calls.refund[0][4], { ref: 'bp-1' }, 'a ref and no payer: it lands on whoever pays for this account');
});

// ---- credits route: pool lookup for a client ----
function handler(router, p, method) {
  const layer = router.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle; // the last handler: protect is skipped
}
const resp = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const creditsRouter = require('../routes/credits');

test('the credits route shows a client the agency pool, not the client record', async () => {
  reset([agency(321), client(777)]);
  const res = resp();
  await handler(creditsRouter, '/', 'get')({ user: { userId: 'w1' } }, res);
  assert.strictEqual(res.body.credits.balance, 321);
  assert.notStrictEqual(res.body.credits.balance, 777);
});

test('the credits route shows a client nothing when the agency can no longer pay', async () => {
  for (const owner of [agency(321, { plan: { tier: 'free' } }), agency(321, { isActive: false }), agency(321, { subscription: { status: 'halted' } })]) {
    reset([owner, client(777)]);
    const res = resp();
    await handler(creditsRouter, '/', 'get')({ user: { userId: 'w1' } }, res);
    assert.strictEqual(res.body.credits.balance, 0);
    const h = resp();
    await handler(creditsRouter, '/history', 'get')({ user: { userId: 'w1' } }, h);
    assert.strictEqual(h.body.balance, 0);
  }
});

test('the credits route shows an ordinary account its own balance', async () => {
  reset([plain(50)]);
  const res = resp();
  await handler(creditsRouter, '/', 'get')({ user: { userId: 'p1' } }, res);
  assert.strictEqual(res.body.credits.balance, 50);
});

// ---- profile routes: pool balance for a client, without the agency's history ----
test('publicCredits gives a client the pool balance and total used only, never the agency history', async () => {
  reset([agency(321), client(777)]);
  const c = await agencyRules.publicCredits(clone(client(777)));
  assert.deepStrictEqual(c, { balance: 321, totalUsed: 5 });
});

test('publicCredits gives a client 0 when the agency cannot pay, and nothing for an ordinary account', async () => {
  reset([agency(321, { plan: { tier: 'free' } }), client(777)]);
  assert.deepStrictEqual(await agencyRules.publicCredits(client(777)), { balance: 0, totalUsed: 0 });
  reset([]);
  assert.deepStrictEqual(await agencyRules.publicCredits(client(777)), { balance: 0, totalUsed: 0 });
  assert.strictEqual(await agencyRules.publicCredits(plain(50)), null);
});

test('/me and both profile routes put the pool balance on the response through publicCredits', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  assert.strictEqual((src.match(/await withPoolCredits\(user\)/g) || []).length, 3);
  assert.match(src, /agencyRules\.publicCredits\(user\)/);
  assert.ok(!/select\('credits\.balance credits\.totalUsed'\)/.test(src), '/me must not read the agency record directly');
});

// ---- final review: a client sees the pool balance only, and a frozen client is refused ----
test('A-M10/B-M8: inside a client the credits routes show the pool balance and no history', async () => {
  reset([agency(321), client(777)]);
  const res = resp();
  await handler(creditsRouter, '/', 'get')({ user: { userId: 'w1' } }, res);
  assert.strictEqual(res.body.credits.balance, 321);
  assert.deepStrictEqual(res.body.credits.history, []);
  assert.doesNotMatch(JSON.stringify(res.body), /agency_only_line/);
  const h = resp();
  await handler(creditsRouter, '/history', 'get')({ user: { userId: 'w1' } }, h);
  assert.deepStrictEqual(h.body.history, []);
  assert.strictEqual(h.body.balance, 321);
  assert.doesNotMatch(JSON.stringify(h.body), /agency_only_line/);
  // the agency itself still sees its own history
  const own = resp();
  await handler(creditsRouter, '/history', 'get')({ user: { userId: 'o1' } }, own);
  assert.strictEqual(own.body.history.length, 1);
});

test('A-M10/B-M8: a frozen client is refused on the credits routes', async () => {
  reset([agency(321), { ...client(777), agency: { ownerId: 'o1', frozen: true } }]);
  for (const p of ['/', '/history']) {
    const res = resp();
    await handler(creditsRouter, p, 'get')({ user: { userId: 'w1' } }, res);
    assert.strictEqual(res.code, 403, p);
    assert.doesNotMatch(JSON.stringify(res.body), /321/);
  }
});
