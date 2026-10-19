// A job row stuck in "queued" (the process died after the insert, or a close failed) must not lock the account out, and
// a spend that landed must be refunded once, to the payer. Fakes only: tests/helpers/fakePhotoshootRepo.js, an in-memory ledger.
const test = require('node:test');
const assert = require('node:assert');
const { createPhotoshoot } = require('../services/photoshoot/service');
const { createFakePhotoshootRepo } = require('./helpers/fakePhotoshootRepo');

const NOW = new Date('2026-10-19T06:00:00Z');
const U1 = '6a0000000000000000000001';
const AGENCY = '6a0000000000000000000004';
const ago = (ms) => new Date(NOW.getTime() - ms);
const MIN = 60000;

function world({ ledger = [], refundFails = false } = {}) {
  const repo = createFakePhotoshootRepo();
  const refunds = []; const alerts = []; const queue = [];
  const deps = {
    repo,
    ledgerFor: async (id) => {
      const spend = ledger.find((l) => l.type === 'spend' && l.ref === String(id));
      return { spend: spend ? { payer: spend.payer, quarks: spend.quarks } : null, refunded: ledger.some((l) => l.type === 'refund' && l.ref === String(id)) };
    },
    refundTo: async (uid, q, o) => {
      if (refundFails) return { ok: false };
      refunds.push({ uid, q, payerId: o.payerId, ref: o.ref });
      ledger.push({ type: 'refund', ref: o.ref, quarks: q });
      return { ok: true };
    },
    alert: (k, t) => alerts.push([k, t]),
    schedule: (fn) => queue.push(fn),
    env: { ENABLE_PHOTOSHOOT: 'on' },
    now: () => NOW,
    runnerId: 'r'
  };
  return { svc: createPhotoshoot(deps), repo, refunds, alerts, ledger };
}

const queuedDoc = (key, extra = {}) => ({
  user: U1, key, kind: 'pack', pack: 'marketplace', day: '2026-10-19', status: 'queued', inFlight: true, photoCount: 4, quarksPerPhoto: 10, quarks: 0,
  photos: [{ index: 0, productIndex: 0, status: 'pending', attempts: 0 }], createdAt: ago(10 * MIN), ...extra
});

test('a stuck queued row with no spend is closed, nothing is refunded, and the account is unlocked', async () => {
  const w = world();
  const row = await w.repo.insert(queuedDoc('key-000001'));
  assert.ok(await w.repo.anyInFlight(U1), 'locked before the sweep');
  assert.strictEqual(await w.svc.sweepStale(), 1);
  const after = await w.repo.findById(row._id);
  assert.strictEqual(after.status, 'failed'); assert.strictEqual(after.outcome, 'stale_queued');
  assert.strictEqual(after.inFlight, undefined); assert.strictEqual(after.refundedQuarks, 0);
  assert.strictEqual(await w.repo.anyInFlight(U1), null);
  assert.deepStrictEqual(w.refunds, []);
  // a new job can now be inserted
  await w.repo.insert(queuedDoc('key-000002', { createdAt: NOW }));
});

test('a stuck row whose spend landed is refunded once, to the payer, even when the sweep runs twice or at once', async () => {
  const w = world();
  const row = await w.repo.insert(queuedDoc('key-000003'));
  w.ledger.push({ type: 'spend', ref: String(row._id), payer: AGENCY, quarks: 40 });
  const runs = await Promise.all([w.svc.sweepStale(), w.svc.sweepStale()]);
  await w.svc.sweepStale();
  assert.strictEqual(runs[0] + runs[1], 1, 'only one sweep closes it');
  assert.deepStrictEqual(w.refunds, [{ uid: U1, q: 40, payerId: AGENCY, ref: String(row._id) }]);
  const after = await w.repo.findById(row._id);
  assert.strictEqual(after.status, 'failed'); assert.strictEqual(after.outcome, 'stale_queued'); assert.strictEqual(after.refundedQuarks, 40);
  assert.strictEqual(await w.repo.anyInFlight(U1), null);
});

test('a spend that already has a refund on the ledger is not refunded again', async () => {
  const w = world();
  const row = await w.repo.insert(queuedDoc('key-000004'));
  w.ledger.push({ type: 'spend', ref: String(row._id), payer: U1, quarks: 40 }, { type: 'refund', ref: String(row._id), quarks: 40 });
  await w.svc.sweepStale();
  assert.deepStrictEqual(w.refunds, []);
  assert.strictEqual((await w.repo.findById(row._id)).status, 'failed');
});

test('a refund that does not land alerts and flags the row, and the account is still unlocked', async () => {
  const w = world({ refundFails: true });
  const row = await w.repo.insert(queuedDoc('key-000005'));
  w.ledger.push({ type: 'spend', ref: String(row._id), payer: U1, quarks: 40 });
  await w.svc.sweepStale();
  assert.strictEqual(w.alerts.length, 1); assert.strictEqual(w.alerts[0][0], 'photoshoot_refund');
  const after = await w.repo.findById(row._id);
  assert.strictEqual(after.refundFailed, true); assert.strictEqual(after.status, 'failed');
  assert.strictEqual(await w.repo.anyInFlight(U1), null);
});

test('a young queued row and a running job are left alone', async () => {
  const w = world();
  const young = await w.repo.insert(queuedDoc('key-000006', { createdAt: ago(60 * 1000) }));
  assert.strictEqual(await w.svc.sweepStale(), 0);
  assert.strictEqual((await w.repo.findById(young._id)).status, 'queued');
  const w2 = world();
  const run = await w2.repo.insert(queuedDoc('key-000007', { status: 'running', quarks: 40, payerId: U1, chargedAt: ago(20 * MIN) }));
  w2.ledger.push({ type: 'spend', ref: String(run._id), payer: U1, quarks: 40 });
  assert.strictEqual(await w2.svc.sweepStale(), 0);
  const after = await w2.repo.findById(run._id);
  assert.strictEqual(after.status, 'running'); assert.strictEqual(after.inFlight, true);
  assert.deepStrictEqual(w2.refunds, []);
});

test('the sweep runs with the resume check, so a create is no longer locked out by a stuck row', async () => {
  const w = world();
  await w.repo.insert(queuedDoc('key-000008'));
  await w.svc.resumeLost();
  assert.strictEqual(await w.repo.anyInFlight(U1), null);
});
