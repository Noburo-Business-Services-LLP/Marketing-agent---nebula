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

function world({ ledger = [], refundFails = false, clock = { t: NOW } } = {}) {
  const repo = createFakePhotoshootRepo();
  const refunds = []; const alerts = []; const queue = [];
  const deps = {
    repo,
    ledgerFor: async (id) => {
      const spend = ledger.find((l) => l.type === 'spend' && l.ref === String(id));
      return { spend: spend ? { payer: spend.payer, quarks: spend.quarks } : null, refunded: ledger.some((l) => l.type === 'refund' && l.ref === String(id)) };
    },
    refundTo: async (uid, q, o) => {
      if (typeof refundFails === 'function' ? refundFails() : refundFails) return { ok: false };
      refunds.push({ uid, q, payerId: o.payerId, ref: o.ref });
      ledger.push({ type: 'refund', ref: o.ref, quarks: q });
      return { ok: true };
    },
    alert: (k, t) => alerts.push([k, t]),
    schedule: (fn) => queue.push(fn),
    env: { ENABLE_PHOTOSHOOT: 'on' },
    now: () => clock.t,
    runnerId: 'r'
  };
  deps.alertNow = (k, t) => alerts.push([k, t]);
  return { svc: createPhotoshoot(deps), deps, repo, refunds, alerts, ledger, clock };
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

// ---- review 2026-10-19: the history proof by default (S2) and the refund retry (S4) ----
test('S2: by default the stale sweep reads the charge proof (history entry when the ledger row is missing)', async () => {
  const qb = require('../services/quarkBuckets');
  const orig = qb.chargeProof;
  const w = world();
  const row = await w.repo.insert(queuedDoc('key-000101'));
  qb.chargeProof = async (ref, o) => (ref === String(row._id) && o.userId === U1 ? { spend: { payer: AGENCY, workspace: U1, quarks: 40, source: 'history' }, refunded: false } : { spend: null, refunded: false });
  try {
    delete w.deps.ledgerFor;
    await createPhotoshoot(w.deps).sweepStale();
  } finally { qb.chargeProof = orig; }
  assert.deepStrictEqual(w.refunds, [{ uid: U1, q: 40, payerId: AGENCY, ref: String(row._id) }]);
});

const failedRefundRow = (key, extra = {}) => queuedDoc(key, { status: 'failed', outcome: 'none', refunded: true, refundedQuarks: 40, refundFailed: true, payerId: AGENCY, inFlight: undefined, ...extra });

test('S4: a refund that did not land is retried, lands once, and the notice goes away', async () => {
  const w = world();
  const row = await w.repo.insert(failedRefundRow('key-000102'));
  assert.strictEqual(await w.svc.retryRefunds(), 1);
  assert.deepStrictEqual(w.refunds, [{ uid: U1, q: 40, payerId: AGENCY, ref: String(row._id) }]);
  const after = await w.repo.findById(row._id);
  assert.strictEqual(after.refundFailed, undefined);
  await w.svc.retryRefunds(); await w.svc.resumeLost();
  assert.strictEqual(w.refunds.length, 1, 'never twice');
});

test('S4: a refund that already landed (proof on the ledger) is marked, not paid again', async () => {
  const w = world();
  const row = await w.repo.insert(failedRefundRow('key-000103'));
  w.ledger.push({ type: 'refund', ref: String(row._id), quarks: 40 });
  await w.svc.retryRefunds();
  assert.deepStrictEqual(w.refunds, []);
  assert.strictEqual((await w.repo.findById(row._id)).refundFailed, undefined);
});

test('S4: retries back off, two at once claim once, and after the last one a person is alerted', async () => {
  const clock = { t: NOW };
  let tries = 0;
  const w = world({ clock, refundFails: () => { tries += 1; return true; } });
  const row = await w.repo.insert(failedRefundRow('key-000104'));
  await Promise.all([w.svc.retryRefunds(), w.svc.retryRefunds()]);
  assert.strictEqual(tries, 1);
  await w.svc.retryRefunds();
  assert.strictEqual(tries, 1, 'waits for the back-off');
  const caps = require('../config/photoshoot');
  for (let i = 0; i < caps.REFUND_RETRY_MAX + 3; i += 1) { clock.t = new Date(clock.t.getTime() + 24 * 3600000); await w.svc.retryRefunds(); }
  assert.strictEqual(tries, caps.REFUND_RETRY_MAX);
  const after = await w.repo.findById(row._id);
  assert.strictEqual(after.refundGaveUp, true); assert.strictEqual(after.refundFailed, true);
  assert.ok(w.alerts.some(([k]) => k === 'photoshoot_refund_gave_up'));
});

test('S4: the stale sweep records the payer, so a later retry pays the same wallet', async () => {
  let fail = true;
  const w = world({ refundFails: () => fail });
  const row = await w.repo.insert(queuedDoc('key-000105'));
  w.ledger.push({ type: 'spend', ref: String(row._id), payer: AGENCY, quarks: 40 });
  await w.svc.sweepStale();
  assert.strictEqual((await w.repo.findById(row._id)).refundFailed, true);
  fail = false;
  await w.svc.resumeLost();
  assert.deepStrictEqual(w.refunds, [{ uid: U1, q: 40, payerId: AGENCY, ref: String(row._id) }]);
});
