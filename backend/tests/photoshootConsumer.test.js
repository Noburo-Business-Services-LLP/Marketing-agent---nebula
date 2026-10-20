'use strict';
// E9 stage B step 2: Photoshoot on worker consumers (services/photoshootConsumer.js, services/photoshoot/service.js
// runClaimed and the consumer closes). Fake repo with the same conditional rules (tests/helpers/fakePhotoshootRepo.js),
// fake clock, fake image generator, fake wallet with a fake charge proof. No network, no database, no provider.
const test = require('node:test');
const assert = require('node:assert');
const { createPhotoshoot } = require('../services/photoshoot/service');
const { createFakePhotoshootRepo } = require('./helpers/fakePhotoshootRepo');
const { PhotoshootConsumer, enabled, startPhotoshootConsumer } = require('../services/photoshootConsumer');
const { QUARK_COSTS } = require('../config/apiCosts');
const caps = require('../config/photoshoot');

const NOW = new Date('2026-10-20T06:00:00Z');
const MIN = 60000;
const U1 = '6a0000000000000000000001';
const U2 = '6a0000000000000000000002';
const U3 = '6a0000000000000000000003';
const P = { [U1]: '6d0000000000000000000001', [U2]: '6d0000000000000000000002', [U3]: '6d0000000000000000000003' };
const PER = QUARK_COSTS.photoshoot_image;
const SETTINGS = { slots: { image: 2, video: 2, omni: 2, photoshoot: 2 }, cpu: 1, globalCeiling: 0, perUserRunning: 2, leaseMs: 60000, heartbeatMs: 20000, maxAttempts: 2, shutdownGraceMs: 0, warnings: [] };
let keyN = 0;
const key = () => `pc-key-${String(++keyN).padStart(6, '0')}`;
const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 60) { for (let i = 0; i < n; i += 1) await tick(); }
const quiet = async (fn) => { const saved = ['log', 'error', 'warn', 'info'].map((k) => [k, console[k]]); saved.forEach(([k]) => { console[k] = () => {}; }); try { return await fn(); } finally { saved.forEach(([k, f]) => { console[k] = f; }); } };
const userOf = (id) => ({ _id: id, plan: { tier: 'starter' } });
const body = (uid = U1, extra = {}) => ({ key: key(), pack: 'marketplace', productIds: [P[uid]], ...extra });

/** One shared database (fake repo), one wallet, one clock; every "server" gets its own service instance (its own process). */
function world({ consumer = true, settings = {}, guard = null, refundFails = false, wallet = 1000 } = {}) {
  const repo = createFakePhotoshootRepo();
  const clock = { t: NOW };
  const purse = new Map([[U1, wallet], [U2, wallet], [U3, wallet]]);
  const money = []; const alerts = []; const queue = []; const recorded = []; const deleted = []; const kicks = [];
  const calls = { gen: 0 };
  const hung = [];
  const st = { ...SETTINGS, ...settings, slots: { ...SETTINGS.slots, ...(settings.slots || {}) } };
  const w = { repo, clock, purse, money, alerts, queue, recorded, deleted, calls, hung, settings: st, hangIf: null, failIf: null, kicks };
  const deps = {
    repo,
    productsOf: async (uid, ids) => Object.entries(P).filter(([u, id]) => u === String(uid) && (!ids || ids.includes(id))).map(([u, id]) => ({ _id: id, user: u, name: `Product ${u.slice(-1)}`, imageUrl: `https://res.cloudinary.com/x/image/upload/nebula-product-images/${u}.png`, images: [] })),
    placesOf: async () => [],
    settle: async () => null,
    spend: async (uid, cost, o) => {
      if ((purse.get(uid) || 0) < cost) return { success: false };
      purse.set(uid, purse.get(uid) - cost);
      money.push({ type: 'spend', uid, payer: uid, cost, action: o.action, ref: o.ref, units: o.units });
      return { success: true, payerId: uid };
    },
    refundTo: async (uid, q, o) => {
      await tick();
      if (typeof refundFails === 'function' ? refundFails() : refundFails) return { ok: false };
      const payer = o.payerId || uid;
      purse.set(payer, (purse.get(payer) || 0) + q);
      money.push({ type: 'refund', uid, payer, q, action: o.action, ref: o.ref });
      return { ok: true, payerId: payer };
    },
    guard: async (a) => (guard ? guard(a) : { ok: true }),
    ledgerFor: async (id) => {
      const sp = money.find((m) => m.type === 'spend' && m.ref === String(id));
      return { spend: sp ? { payer: sp.payer, quarks: sp.cost } : null, refunded: money.some((m) => m.type === 'refund' && m.ref === String(id)) };
    },
    recordSpend: (a, u) => recorded.push([a, u]),
    loadRef: async (src) => (src ? { mimeType: 'image/png', data: 'eA==' } : null),
    deleteImage: async (url) => { deleted.push(url); return { success: true }; },
    generate: async (args) => {
      calls.gen += 1;
      const n = calls.gen;
      const url = `https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/p${n}.png`;
      if (w.hangIf && w.hangIf(args, n)) return new Promise((resolve) => hung.push({ n, args, release: (out) => resolve(out || { ok: true, url }) }));
      if (w.failIf && w.failIf(args, n)) return { ok: false, reason: 'provider' };
      return { ok: true, url };
    },
    alert: (k, t) => alerts.push([k, t]),
    alertNow: (k, t) => alerts.push([k, t]),
    schedule: (fn) => queue.push(fn),
    env: { ENABLE_PHOTOSHOOT: 'on', ...(consumer ? { ENABLE_PHOTOSHOOT_CONSUMER: 'on' } : {}) },
    now: () => clock.t,
    slots: () => st,
    kick: () => kicks.push(1),
    runnerId: 'web-runner'
  };
  w.deps = deps;
  w.web = createPhotoshoot(deps);
  w.server = (name) => createPhotoshoot({ ...deps, runnerId: `runner-${name}` });
  w.consumer = (name, extra = {}) => {
    const svc = w.server(name);
    const c = new PhotoshootConsumer({ service: svc, settings: st, workerId: `w:${name}`, now: () => clock.t.getTime(), leaseLock: { withLease: async (n, ttl, fn) => fn() }, spend: { check: async (a) => (guard ? guard(a) : { ok: true }) }, alert: (t) => alerts.push(['consumer', t]), ...extra });
    c.started = true; // driven by hand in the tests
    return c;
  };
  w.advance = (ms) => { clock.t = new Date(clock.t.getTime() + ms); };
  w.row = (id) => repo.rows.find((r) => String(r._id) === String(id));
  w.spends = (id) => money.filter((m) => m.type === 'spend' && (!id || m.ref === String(id)));
  w.refunds = (id) => money.filter((m) => m.type === 'refund' && (!id || m.ref === String(id)));
  return w;
}

async function create(w, uid = U1, svc = w.web, extra = {}) {
  const r = await svc.create(userOf(uid), body(uid, extra));
  return r;
}

// ---- switch and start ------------------------------------------------------------------------------------------------

test('the switch is off by default and the consumer starts only with the switch AND job consumers on', () => {
  assert.strictEqual(enabled({}), false);
  assert.strictEqual(enabled({ ENABLE_PHOTOSHOOT_CONSUMER: 'on' }), true);
  assert.strictEqual(enabled({ ENABLE_PHOTOSHOOT_CONSUMER: 'off' }), false);
  assert.strictEqual(startPhotoshootConsumer({ env: { RUN_BACKGROUND: '1' } }), null, 'switch off');
  assert.strictEqual(startPhotoshootConsumer({ env: { ENABLE_PHOTOSHOOT_CONSUMER: 'on', RUN_BACKGROUND: '0' } }), null, 'web task without consumers');
  assert.strictEqual(startPhotoshootConsumer({ env: { ENABLE_PHOTOSHOOT_CONSUMER: 'on', RUN_BACKGROUND: '1', RUN_JOB_CONSUMERS: '0' } }), null, 'consumers off');
});

test('switch OFF: the request schedules the in-process runner exactly as before and writes no consumer marker', async () => {
  const w = world({ consumer: false });
  const r = await create(w);
  assert.strictEqual(r.status, 202);
  const row = w.repo.rows[0];
  assert.strictEqual(row.status, 'running');
  assert.strictEqual(row.via, undefined);
  assert.strictEqual(row.quarkCharge, undefined);
  assert.strictEqual(w.queue.length, 1, 'runJob scheduled in this process');
  assert.strictEqual(w.kicks.length, 0);
  await w.queue.shift()();
  assert.strictEqual(w.row(row._id).status, 'done');
  assert.strictEqual(w.calls.gen, 4);
});

test('switch ON: the charged row waits for a worker (queued, charge recorded with its ref), nothing runs in the request, the page sees running', async () => {
  const w = world();
  const r = await create(w);
  assert.strictEqual(r.status, 202, JSON.stringify(r.body));
  assert.strictEqual(r.body.job.status, 'running');
  const row = w.repo.rows[0];
  assert.strictEqual(row.status, 'queued');
  assert.strictEqual(row.via, 'consumer');
  assert.ok(row.chargedAt instanceof Date);
  assert.ok(row.queuedAt instanceof Date);
  assert.strictEqual(row.quarks, 4 * PER);
  assert.deepStrictEqual(row.quarkCharge, { action: 'photoshoot_image', ref: String(row._id), quarks: 4 * PER, payerId: U1 });
  assert.strictEqual(w.queue.length, 0, 'no in-process runner');
  assert.strictEqual(w.kicks.length, 1, 'the consumer of this process is kicked');
  assert.deepStrictEqual(w.spends().map((m) => [m.cost, m.ref, m.units]), [[4 * PER, String(row._id), 4]]);
  assert.strictEqual(w.calls.gen, 0);
});

// ---- claims ----------------------------------------------------------------------------------------------------------

test('a waiting row is claimed exactly once when three workers race for it', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  const out = await Promise.all(['a', 'b', 'c'].map((n) => w.repo.claimConsumer(id, `w:${n}`, NOW, new Date(NOW.getTime() + MIN))));
  assert.strictEqual(out.filter(Boolean).length, 1);
  assert.strictEqual(w.row(id).runs, 1);
});

test('three workers draining at once: every job is claimed by exactly one, every photo made once, one charge each, no refund', async () => {
  const w = world();
  for (const u of [U1, U2, U3]) assert.strictEqual((await create(w, u)).status, 202);
  const cs = ['a', 'b', 'c'].map((n) => w.consumer(n));
  await quiet(async () => { await Promise.all(cs.map((c) => c._drain())); await settle(200); });
  assert.strictEqual(cs.reduce((s, c) => s + c.stats.claims, 0), 3);
  assert.ok(w.repo.rows.every((r) => r.status === 'done' && r.runs === 1 && r.inFlight === undefined), JSON.stringify(w.repo.rows.map((r) => [r.status, r.runs])));
  assert.strictEqual(w.calls.gen, 12);
  assert.ok(w.repo.rows.every((r) => r.photos.every((p) => p.attempts === 1 && /^https:/.test(p.url))));
  assert.strictEqual(w.spends().length, 3);
  assert.strictEqual(w.refunds().length, 0);
  assert.ok(cs.every((c) => c.running.size === 0));
});

test('per-account cap is counted across workers: two workers claiming at the same instant never START more than the cap for one account', async () => {
  const w = world({ settings: { perUserRunning: 1 } });
  await create(w, U1);
  // A second waiting row of the same account (the unique in-flight index normally forbids it; the cap is the second line).
  const first = w.repo.rows[0];
  w.repo.rows.push({ ...JSON.parse(JSON.stringify(first)), _id: '6c9999999999999999999999', key: 'second-key', chargedAt: NOW, queuedAt: new Date(NOW.getTime() + 1) });
  w.hangIf = () => true; // keep every run busy so the count stays
  const a = w.consumer('a'); const b = w.consumer('b');
  await quiet(async () => { await Promise.all([a._drain(), b._drain()]); await settle(40); });
  const running = w.repo.rows.filter((r) => r.status === 'running');
  assert.ok(running.length <= 1, `at most one RUN for the account, got ${running.length}`);
  assert.ok(a.stats.capHandBacks + b.stats.capHandBacks >= 1, 'the over-cap claim was handed back');
  assert.ok(w.repo.rows.filter((r) => r.status === 'queued').every((r) => (r.runs || 0) === 0), 'a hand-back is not counted as a run');
  w.hung.forEach((h) => h.release()); await quiet(() => settle(100));
});

// ---- resume after a lost worker -------------------------------------------------------------------------------------

test('a lost worker: the job resumes on another worker, finished photos are not made again, one charge, no refund, the dead run\'s late photo is deleted', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.hangIf = (args, n) => n === 3; // the third call (photo 2) never returns on worker A
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(80); });
  const mid = w.row(id);
  assert.strictEqual(mid.status, 'running');
  assert.strictEqual(mid.photos.filter((p) => p.status === 'done').length, 3, 'photos 0, 1 and 3 stored as made');
  assert.strictEqual(mid.photos[2].status, 'calling');
  // A dies (no heartbeat): the lease runs out; another worker's sweep re-queues the job (run 1 of 2).
  w.advance(SETTINGS.leaseMs + SETTINGS.heartbeatMs + 1000);
  const b = w.consumer('b');
  const sw = await quiet(() => b.sweepLeases());
  assert.strictEqual(sw.requeued, 1);
  assert.strictEqual(w.row(id).status, 'queued');
  w.hangIf = null;
  await quiet(async () => { await b._drain(); await settle(80); });
  const done = w.row(id);
  assert.strictEqual(done.status, 'done');
  assert.strictEqual(done.runs, 2);
  assert.strictEqual(w.calls.gen, 5, '4 photos + one more call for the photo the dead run left calling');
  assert.deepStrictEqual(done.photos.map((p) => p.attempts), [1, 1, 2, 1]);
  assert.deepStrictEqual(w.recorded, [['photoshoot_image', 1]], 'the second call of photo 2 is recorded in the spend guard');
  assert.strictEqual(w.spends(id).length, 1);
  assert.strictEqual(w.refunds(id).length, 0);
  // The dead run's call comes back late: its write matches nothing, the job stays as delivered, the file is deleted.
  const late = w.hung[0];
  late.release();
  await quiet(() => settle(80));
  assert.deepStrictEqual(w.row(id).photos.map((p) => p.url), done.photos.map((p) => p.url));
  assert.deepStrictEqual(w.deleted, ['https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/p3.png']);
  assert.strictEqual(w.refunds(id).length, 0);
});

test('lost twice (the run cap): closed by two sweeps at the same moment exactly once, finished photos kept, only the open ones refunded', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.hangIf = (args, n) => n >= 3; // photos 2 and 3 never come back
  for (let i = 0; i < 2; i += 1) {
    const c = w.consumer(`dead${i}`);
    await quiet(async () => { await c._drain(); await settle(60); });
    assert.strictEqual(w.row(id).runs, i + 1);
    w.advance(SETTINGS.leaseMs + SETTINGS.heartbeatMs + 1000);
    if (i === 0) await quiet(() => w.consumer('sweeper').sweepLeases());
  }
  const [s1, s2] = await quiet(() => Promise.all([w.consumer('s1').sweepLeases(), w.consumer('s2').sweepLeases()]));
  assert.strictEqual(s1.failed + s2.failed, 1, 'one sweep closed it');
  const r = w.row(id);
  assert.strictEqual(r.status, 'partial');
  assert.strictEqual(r.outcome, 'lost');
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [2 * PER]);
  assert.ok(r.refundSettledAt, 'paid and settled');
  assert.strictEqual(r.refundPayer, U1);
  w.hung.forEach((h) => h.release()); await quiet(() => settle(80));
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [2 * PER], 'late results refund nothing more');
  assert.strictEqual(w.row(id).status, 'partial');
  assert.strictEqual(w.deleted.length, 4, 'every late photo of the two dead runs is deleted');
});

// ---- lost reply, double click ----------------------------------------------------------------------------------------

test('lost reply after the queue write: the job was accepted, so the answer is 202 and nothing is refunded', async () => {
  const w = world();
  w.repo.fail.queueCharged = 'after';
  const r = await quiet(() => create(w));
  assert.strictEqual(r.status, 202, JSON.stringify(r.body));
  delete w.repo.fail.queueCharged;
  const id = w.repo.rows[0]._id;
  assert.strictEqual(w.row(id).status, 'queued');
  assert.ok(w.row(id).chargedAt);
  assert.strictEqual(w.refunds().length, 0);
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(80); });
  assert.strictEqual(w.row(id).status, 'done');
  assert.strictEqual(w.spends().length, 1);
  assert.strictEqual(w.refunds().length, 0);
});

test('the queue write failed before landing: the proven charge is refunded once and the row is never claimable', async () => {
  const w = world();
  w.repo.fail.queueCharged = 'before';
  const r = await quiet(() => create(w));
  assert.strictEqual(r.status, 503);
  const row = w.repo.rows[0];
  assert.strictEqual(row.status, 'failed');
  assert.deepStrictEqual(w.refunds().map((m) => m.q), [4 * PER]);
  assert.strictEqual(await w.repo.claimConsumer(row._id, 'w:x', NOW, NOW), null);
});

test('double click: the same key from two web tasks is one job and one charge', async () => {
  const w = world();
  const b = body();
  const [r1, r2] = await Promise.all([w.web.create(userOf(U1), b), w.server('web2').create(userOf(U1), b)]);
  assert.deepStrictEqual([r1.status, r2.status].sort(), [200, 202]);
  assert.strictEqual(w.repo.rows.length, 1);
  assert.strictEqual(w.spends().length, 1);
  const again = await w.web.create(userOf(U1), b);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.replay, true);
  assert.strictEqual(w.spends().length, 1);
});

// ---- refunds ---------------------------------------------------------------------------------------------------------

test('partial failure: only the failed photo is refunded, once, to the payer, with proof', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.failIf = (args) => /from the side/.test(args.prompt);
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(80); });
  const r = w.row(id);
  assert.strictEqual(r.status, 'partial');
  assert.deepStrictEqual(w.refunds(id).map((m) => [m.q, m.payer, m.ref]), [[PER, U1, String(id)]]);
  assert.strictEqual(r.refundedQuarks, PER);
  assert.ok(r.refundSettledAt);
  // The settle sweep later finds nothing to pay.
  w.advance(10 * MIN);
  assert.strictEqual(await quiet(() => w.web.sweepUnsettled()), 0);
  assert.strictEqual(w.refunds(id).length, 1);
});

test('all photos fail: everything is refunded once', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.failIf = () => true;
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(80); });
  assert.strictEqual(w.row(id).status, 'failed');
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [4 * PER]);
  assert.strictEqual(w.calls.gen, 8, 'each photo had its one extra call');
});

test('a consumer close never refunds more than the proven charge, and nothing without proof', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.failIf = () => true;
  // The proof shows a smaller charge than the job records (a ledger mismatch): the refund is capped at the proof.
  w.money[0].cost = PER;
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(80); });
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [PER]);

  const w2 = world();
  await create(w2);
  const id2 = w2.repo.rows[0]._id;
  w2.failIf = () => true;
  w2.money.length = 0; // no proof of any charge
  const c2 = w2.consumer('a');
  await quiet(async () => { await c2._drain(); await settle(80); });
  assert.strictEqual(w2.row(id2).status, 'failed');
  assert.strictEqual(w2.refunds(id2).length, 0);
  assert.ok(w2.alerts.some(([k]) => k === 'photoshoot_refund'), 'a person is told');
});

test('a consumer close that crashed after the refund claim is paid once by the settle sweep, with proof, even with two sweeps at once', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.failIf = () => true;
  let die = true;
  const realRefund = w.deps.refundTo;
  w.deps.refundTo = async (...a) => { if (die) throw new Error('process died'); return realRefund(...a); };
  // the refund attempt "dies" and also its refundFailed write is lost: the row is claimed but neither paid nor flagged
  const realFlag = w.repo.setRefundFailed;
  w.repo.setRefundFailed = async () => { throw new Error('process died'); };
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(80); });
  const r = w.row(id);
  assert.strictEqual(r.refunded, true);
  assert.strictEqual(r.refundedQuarks, 4 * PER);
  assert.ok(!r.refundSettledAt);
  assert.strictEqual(w.refunds(id).length, 0);
  die = false; w.repo.setRefundFailed = realFlag;
  w.advance(caps.SETTLE_AFTER_MS + 1000);
  const [a, b] = await quiet(() => Promise.all([w.server('x').sweepUnsettled(), w.server('y').sweepUnsettled()]));
  assert.strictEqual(a + b, 1);
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [4 * PER]);
  w.advance(caps.SETTLE_HOLD_MS + 1000);
  assert.strictEqual(await quiet(() => w.web.sweepUnsettled()), 0);
  assert.strictEqual(w.refunds(id).length, 1);
});

test('the settle sweep pays a consumer row only with proof (an older-style row without proof is still paid as before)', async () => {
  const w = world();
  const base = { user: U1, key: 'k1', kind: 'pack', pack: 'marketplace', day: '2026-10-20', photos: [{ index: 0, status: 'failed' }], photoCount: 1, quarksPerPhoto: PER, quarks: PER, payerId: U1, refunded: true, refundedQuarks: PER, status: 'failed', finishedAt: new Date(NOW.getTime() - 10 * MIN), createdAt: NOW };
  w.repo.rows.push({ ...base, _id: 'c1', via: 'consumer', key: 'kc' });
  w.repo.rows.push({ ...base, _id: 'c2', key: 'ko' });
  const n = await quiet(() => w.web.sweepUnsettled());
  assert.deepStrictEqual(w.refunds().map((m) => m.ref), ['c2'], 'the consumer row without proof is not paid');
  assert.strictEqual(n, 1);
  assert.ok(w.alerts.length >= 1);
});

test('a refund that did not land on a consumer close is retried by the retry loop through the proof', async () => {
  let fails = 1;
  const w = world({ refundFails: () => fails-- > 0 });
  await create(w);
  const id = w.repo.rows[0]._id;
  w.failIf = () => true;
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(80); });
  assert.strictEqual(w.row(id).refundFailed, true);
  assert.strictEqual(w.refunds(id).length, 0);
  assert.strictEqual(await quiet(() => w.web.retryRefunds()), 1);
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [4 * PER]);
  w.advance(60 * MIN);
  await quiet(() => w.web.retryRefunds());
  await quiet(() => w.web.sweepUnsettled());
  assert.strictEqual(w.refunds(id).length, 1);
});

// ---- stale closes ----------------------------------------------------------------------------------------------------

test('a worker alive but stuck past the hard ceiling: the sweep closes the claim it read, the late run cannot overwrite it, its photo is deleted', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.hangIf = (args, n) => n === 2;
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(60); });
  // its heartbeat keeps the lease fresh
  w.advance(caps.MAX_AGE_MS + SETTINGS.heartbeatMs + 1000);
  const row = w.row(id);
  assert.ok(await w.repo.heartbeat(id, { leaseOwner: row.leaseOwner, runs: row.runs }, new Date(w.clock.t.getTime() + MIN)));
  const out = await quiet(() => w.consumer('s').sweepLeases());
  assert.strictEqual(out.ceiling, 1);
  const closed = w.row(id);
  assert.strictEqual(closed.outcome, 'stale');
  const open = closed.photos.filter((p) => p.reason === 'stale').length;
  assert.ok(open >= 1);
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [open * PER]);
  w.hung[0].release();
  await quiet(() => settle(80));
  const after = w.row(id);
  assert.strictEqual(after.status, closed.status);
  assert.deepStrictEqual(after.photos.map((p) => [p.status, p.url || '']), closed.photos.map((p) => [p.status, p.url || '']));
  assert.strictEqual(w.refunds(id).length, 1);
  assert.ok(w.deleted.includes('https://res.cloudinary.com/x/image/upload/nebula-campaign-posts/p2.png'));
});

test('a lease sweep and a late completion race: exactly one close wins and pays', async () => {
  const w = world({ settings: { maxAttempts: 1 } });
  await create(w);
  const id = w.repo.rows[0]._id;
  w.failIf = (args) => /from the side/.test(args.prompt);
  w.hangIf = (args, n) => n === 4;
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(60); });
  w.advance(SETTINGS.leaseMs + SETTINGS.heartbeatMs + 1000);
  // the sweep (lost at the cap) and the run's own finish happen together
  const sweeping = quiet(() => w.consumer('s').sweepLeases());
  w.hung[0].release();
  await sweeping; await quiet(() => settle(80));
  const r = w.row(id);
  assert.ok(['partial', 'failed', 'done'].includes(r.status));
  assert.strictEqual(w.refunds(id).length <= 1, true);
  const refunded = w.refunds(id).reduce((s, m) => s + m.q, 0);
  assert.strictEqual(refunded, r.refundedQuarks);
  assert.ok(refunded <= 4 * PER);
});

// ---- SIGTERM ---------------------------------------------------------------------------------------------------------

test('SIGTERM hands the job back (runs not counted); another worker finishes it; one charge, no refund; the cut-off call\'s file is deleted', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.hangIf = (args, n) => n === 1;
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(40); });
  const out = await quiet(() => a.shutdown({ graceMs: 0 }));
  assert.strictEqual(out.released, 1);
  const back = w.row(id);
  assert.strictEqual(back.status, 'queued');
  assert.strictEqual(back.runs, 0);
  assert.strictEqual(back.releases, 1);
  assert.strictEqual(back.leaseOwner, null);
  assert.strictEqual(a.stats.released, 1);
  w.hung[0].release();
  await quiet(() => settle(40));
  assert.strictEqual(w.deleted.length, 1, 'the late photo of the stopped run is deleted');
  w.hangIf = null;
  const b = w.consumer('b');
  await quiet(async () => { await b._drain(); await settle(80); });
  const r = w.row(id);
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(r.runs, 1);
  assert.strictEqual(w.spends(id).length, 1);
  assert.strictEqual(w.refunds(id).length, 0);
});

test('SIGTERM: a run stops before its next batch, so calls already made are kept and the job is handed back at once', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  let release;
  const gate = new Promise((r) => { release = r; });
  const realGen = w.deps.generate;
  w.deps.generate = async (args) => { await gate; return realGen(args); };
  const a2 = w.consumer('a2');
  await quiet(async () => { await a2._drain(); await settle(20); });
  const stopping = quiet(() => a2.shutdown({ graceMs: 5000 }));
  release();
  const out = await stopping;
  assert.strictEqual(out.released, 1);
  const r = w.row(id);
  assert.strictEqual(r.status, 'queued');
  assert.strictEqual(r.photos.filter((p) => p.status === 'done').length, 2, 'the two photos of the batch in flight are kept');
  assert.strictEqual(r.photos.filter((p) => p.status === 'pending').length, 2);
  assert.strictEqual(w.deleted.length, 0);
});

test('a claim that resolves after SIGTERM began is handed back and never started', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  const a = w.consumer('a');
  const real = w.repo.claimConsumer;
  w.repo.claimConsumer = async (...args) => { const r = await real(...args); a.stopping = true; return r; };
  await quiet(async () => { await a._drainOnce(); await settle(20); });
  const r = w.row(id);
  assert.strictEqual(r.status, 'queued');
  assert.strictEqual(r.runs, 0);
  assert.strictEqual(w.calls.gen, 0);
});

test('SIGTERM over the hand-back limit closes the job with the per-photo refund once', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.row(id).releases = 3;
  w.hangIf = (args, n) => n === 2;
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(40); });
  const out = await quiet(() => a.shutdown({ graceMs: 0 }));
  assert.strictEqual(out.failed, 1);
  const r = w.row(id);
  assert.strictEqual(r.outcome, 'stopped');
  const open = r.photos.filter((p) => p.reason === 'stopped').length;
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [open * PER]);
  w.hung.forEach((h) => h.release()); await quiet(() => settle(40));
  assert.strictEqual(w.refunds(id).length, 1);
});

// ---- queued timeout, the in-process paths, spend guard ---------------------------------------------------------------

test('queued timeout: a waiting row nobody claims for 30 minutes is closed and refunded once (resume loop and opening the job)', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.advance(29 * MIN);
  await quiet(() => w.web.resumeLost());
  assert.strictEqual(w.row(id).status, 'queued', 'not yet');
  w.advance(2 * MIN);
  await quiet(() => Promise.all([w.web.resumeLost(), w.server('other').resumeLost()]));
  const r = w.row(id);
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.outcome, 'queued_timeout');
  assert.strictEqual(r.inFlight, undefined, 'the account can start another photoshoot');
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [4 * PER]);

  const w2 = world();
  await create(w2);
  const id2 = w2.repo.rows[0]._id;
  w2.advance(31 * MIN);
  const view = await quiet(() => w2.web.get(userOf(U1), id2));
  assert.strictEqual(view.body.job.status, 'failed');
  assert.deepStrictEqual(w2.refunds(id2).map((m) => m.q), [4 * PER]);
});

test('switch turned off with rows still waiting: the resume loop (a scheduler) still closes and refunds them; a create does not run the consumer sweeps', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  const off = createPhotoshoot({ ...w.deps, env: { ENABLE_PHOTOSHOOT: 'on' }, runnerId: 'off' });
  w.advance(31 * MIN);
  await quiet(() => off.resumeLost());
  assert.strictEqual(w.row(id).status, 'queued', 'the request-time call does not touch consumer rows while the switch is off');
  await quiet(() => off.resumeLost({ fromLoop: true }));
  assert.strictEqual(w.row(id).status, 'failed');
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [4 * PER]);
  assert.strictEqual(w.queue.length, 0);
});

test('the in-process paths leave consumer rows alone: the stale sweep, the resume loop and opening the job never run or close them', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.advance(5 * MIN);
  assert.strictEqual(await quiet(() => w.web.sweepStale()), 0, 'a waiting row is charged, not stale');
  assert.strictEqual(w.row(id).status, 'queued');
  const a = w.consumer('a');
  w.hangIf = () => true;
  await quiet(async () => { await a._drain(); await settle(40); });
  w.advance(SETTINGS.leaseMs + SETTINGS.heartbeatMs + 1000);
  await quiet(() => w.web.get(userOf(U1), id));
  await quiet(() => w.web.resumeLost());
  assert.strictEqual(w.queue.length, 0, 'never scheduled in-process');
  assert.strictEqual(w.row(id).status, 'queued', 're-queued for a worker by the lease sweep the resume loop also runs');
  assert.strictEqual(w.refunds().length, 0);
  w.hung.forEach((h) => h.release()); await quiet(() => settle(40));
});

test('S5: daily spend ceiling reached: a job that is already charged still completes, a new start is refused, its spend is recorded; a staff switch still closes at once with the full refund', async () => {
  let mode = 'daily_cap';
  const w = world({ guard: () => ({ ok: false, reason: mode }) });
  // created while the guard allowed it (the charge counts its units in the daily counter)
  const allow = w.deps.guard; w.deps.guard = async () => ({ ok: true });
  const web = w.server('web-ok');
  await web.create(userOf(U1), body());
  w.deps.guard = allow;
  const id = w.repo.rows[0]._id;
  assert.deepStrictEqual(w.spends(id).map((m) => m.units), [4], 'the job\'s units were recorded at the charge');
  // the ceiling is reached: a NEW start is refused (no charge) ...
  const refused = await w.server('web-late').create(userOf(U2), body(U2));
  assert.strictEqual(refused.status, 503);
  assert.strictEqual(refused.body.serviceBusy, true);
  assert.strictEqual(w.spends().length, 1, 'no charge for the refused start');
  // ... but the charged job is made, not held for 30 minutes and refunded
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(80); });
  assert.strictEqual(a.stats.spendHolds, 0);
  assert.strictEqual(w.row(id).status, 'done');
  assert.strictEqual(w.calls.gen, 4);
  assert.strictEqual(w.refunds().length, 0);
  // the staff switch is different: the claimed run closes the job at once with the full refund
  mode = 'switched_off';
  w.deps.guard = async () => ({ ok: true });
  await w.server('web-ok2').create(userOf(U2), body(U2));
  w.deps.guard = allow;
  const id2 = w.repo.rows.find((r) => String(r.user) === U2)._id;
  const b = w.consumer('b');
  const genBefore = w.calls.gen;
  await quiet(async () => { await b._drain(); await settle(60); });
  const r = w.row(id2);
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.outcome, 'switched_off');
  assert.deepStrictEqual(w.refunds(id2).map((m) => m.q), [4 * PER]);
  assert.strictEqual(w.calls.gen, genBefore);
});

test('the all-accounts running cap counts consumer rows that wait for a worker', async () => {
  const w = world();
  for (let i = 0; i < caps.MAX_RUNNING_ALL_ACCOUNTS; i += 1) w.repo.rows.push({ _id: `z${i}`, user: `6a00000000000000000009${String(i).padStart(2, '0')}`, key: `z${i}`, status: 'queued', via: 'consumer', chargedAt: NOW, queuedAt: NOW, inFlight: true, photos: [], createdAt: new Date(NOW.getTime() - 10 * MIN) });
  const r = await create(w);
  assert.strictEqual(r.status, 503);
  assert.strictEqual(w.spends().length, 0);
});

// ---- metrics ---------------------------------------------------------------------------------------------------------

test('metrics: queue depth, running, oldest wait, running per worker and this worker\'s counters', async () => {
  const w = world();
  await create(w, U1);
  await create(w, U2);
  w.hangIf = () => true;
  const a = w.consumer('a', {});
  a.settings.slots.photoshoot = 1;
  await quiet(async () => { await a._drain(); await settle(20); });
  w.advance(12000);
  const m = await a.metrics();
  assert.strictEqual(m.queueDepth, 1);
  assert.strictEqual(m.running, 1);
  assert.strictEqual(m.oldestQueuedAgeSeconds, 12);
  assert.deepStrictEqual(m.runningByWorker, { 'w:a': 1 });
  assert.deepStrictEqual(m.thisWorker.slots, { photoshoot: 1 });
  assert.deepStrictEqual(m.thisWorker.slotsInUse, { photoshoot: 1 });
  for (const k of ['claims', 'finished', 'lostRuns', 'leaseRequeues', 'leaseFailures', 'ceilingCloses', 'released', 'shutdownFailed', 'capHandBacks', 'spendHolds', 'orphansDeleted']) assert.strictEqual(typeof m.thisWorker[k], 'number', k);
  a.settings.slots.photoshoot = 2;
  w.hung.forEach((h) => h.release()); await quiet(() => settle(60));
});

test('GET /api/metrics/queue includes the Photoshoot consumer', async () => {
  const metrics = require('../routes/metrics');
  const orig = { ...metrics.queues };
  metrics.queues.video = () => ({ metrics: async () => ({ queueDepth: 0 }) });
  metrics.queues.image = () => ({ metrics: async () => ({ queueDepth: 0 }) });
  metrics.queues.studio = () => ({ metrics: async () => ({ queueDepth: 0 }) });
  metrics.queues.photoshoot = () => ({ metrics: async () => ({ queueDepth: 2, running: 1 }) });
  try {
    const layer = metrics.stack.find((l) => l.route && l.route.path === '/queue');
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
    await layer.route.stack.slice(-1)[0].handle({}, res);
    assert.deepStrictEqual(res.body.photoshoot, { queueDepth: 2, running: 1 });
    assert.ok(res.body.videoJobs && res.body.imageJobs && res.body.studioVideos);
  } finally { Object.assign(metrics.queues, orig); }
});

test('the CloudWatch data has a Queue=photoshoot dimension', () => {
  const { toMetricData } = require('../services/queueMetricsEmitter');
  const data = toMetricData({ photoshoot: { queueDepth: 3, oldestQueuedAgeSeconds: 9, running: 1, thisWorker: { slots: { photoshoot: 2 }, slotsInUse: { photoshoot: 1 } } } });
  const rows = data.filter((d) => d.Dimensions[0].Value === 'photoshoot').map((d) => [d.MetricName, d.Value]);
  assert.deepStrictEqual(rows, [['QueueDepth', 3], ['OldestQueuedAge', 9], ['Running', 1], ['SlotsInUse', 1], ['SlotsTotal', 2]]);
});

test('SIGTERM helper stops the Photoshoot consumer with the others', async () => {
  const { stopJobConsumers } = require('../services/jobConsumersShutdown');
  const seen = [];
  const fake = (name) => ({ shutdown: async ({ graceMs }) => { seen.push([name, graceMs]); return { finished: true }; } });
  const r = await stopJobConsumers({ env: { RUN_BACKGROUND: '1' }, video: fake('video'), image: fake('image'), studio: fake('studio'), photoshoot: fake('photoshoot'), graceMs: 77 });
  assert.deepStrictEqual(seen.map((s) => s[0]).sort(), ['image', 'photoshoot', 'studio', 'video']);
  assert.deepStrictEqual(r.photoshoot, { finished: true });
});

// ---- agency client removal --------------------------------------------------------------------------------------------

test('agency client removal waits for a photoshoot in flight or a refund not yet settled', async () => {
  const ws = require('../services/agencyWorkspaces');
  const asked = {};
  const models = {};
  for (const k of ['VideoJob', 'HeroVideoJob', 'Blueprint', 'StudioVideo', 'Draft', 'Campaign', 'SocialPostAttempt', 'PhotoshootJob']) models[k] = { exists: async (f) => { asked[k] = f; return k === 'PhotoshootJob'; } };
  const busy = await ws.runningWork('w1', models, NOW.getTime());
  assert.deepStrictEqual(busy, ['photoshoots']);
  assert.strictEqual(asked.PhotoshootJob.user, 'w1');
  assert.ok(JSON.stringify(asked.PhotoshootJob.$or).includes('inFlight'));
  assert.ok(JSON.stringify(asked.PhotoshootJob.$or).includes('refundFailed'));
  assert.ok(JSON.stringify(asked.PhotoshootJob.$or).includes('refundSettledAt'));
});

// ---- review fixes (docs/superpowers/ops/review-photoshoot-consumer-2026-10-20.md) ------------------------------------

test('S1: the close stamps finishedAt at the close WRITE, so a slow proof read cannot let another process\'s settle sweep pay the same refund', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.failIf = () => true;
  const other = w.server('other');
  let slow = true; let raced = 0;
  const svc = createPhotoshoot({
    ...w.deps,
    runnerId: 'runner-slow',
    ledgerFor: async (...a) => { if (slow) { slow = false; w.advance(3 * MIN); } return w.deps.ledgerFor(...a); }, // the proof read takes 3 minutes
    refundTo: async (...a) => { if (!raced) { raced += 1; await other.sweepUnsettled(); } return w.deps.refundTo(...a); } // another process sweeps right after the close write
  });
  const c = w.consumer('a', { service: svc });
  await quiet(async () => { await c._drain(); await settle(120); });
  assert.strictEqual(raced, 1);
  assert.strictEqual(w.row(id).status, 'failed');
  assert.deepStrictEqual(w.refunds(id).map((m) => m.q), [4 * PER], 'exactly one refund');
});

test('S2: a photo write that times out on the client and lands afterwards: the file is KEPT (never deleted behind a landed record)', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  const real = w.repo.finishPhotoOwned;
  const late = []; let first = true;
  w.repo.finishPhotoOwned = async (...a) => {
    if (first && a[3].status === 'done') { first = false; late.push(() => real(...a)); throw new Error('timed out'); }
    return real(...a);
  };
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(80); });
  assert.deepStrictEqual(w.deleted, [], 'unknown outcome: nothing deleted');
  assert.strictEqual(late.length, 1);
  await late[0](); // the write lands after the read-back
  const kept = w.row(id).photos.filter((p) => p.status === 'done' && p.url);
  assert.ok(kept.length >= 1);
  assert.ok(kept.every((p) => !w.deleted.includes(p.url)), 'no recorded photo points at a deleted file');
  assert.strictEqual(c.stats.orphansDeleted, 0);
});

test('S2: a write that definitely did not match (the claim is gone) still deletes the file', async () => {
  const w = world();
  await create(w);
  w.hangIf = (args, n) => n === 1;
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(40); });
  const row = w.repo.rows[0];
  row.leaseOwner = 'someone-else'; // the claim moved on
  w.hung[0].release();
  await quiet(() => settle(60));
  assert.ok(w.deleted.length >= 1);
});

for (const mode of ['consumer', 'in-process']) {
  test(`S3 (${mode}): a charge slower than the stale window lands on a row the stale sweep already closed with a 0 refund: it is refunded once from the proof`, async () => {
    const w = world({ consumer: mode === 'consumer' });
    const other = w.server('other');
    const realSpend = w.deps.spend;
    const svc = createPhotoshoot({
      ...w.deps,
      runnerId: 'runner-slowcharge',
      spend: async (...a) => { w.advance(4 * MIN); await other.sweepStale(); return realSpend(...a); } // the sweep reads the proof before the charge lands
    });
    const r = await quiet(() => svc.create(userOf(U1), body()));
    assert.strictEqual(r.status, 503, 'the customer is told it comes back by itself');
    const row = w.repo.rows[0];
    assert.strictEqual(row.status, 'failed');
    assert.strictEqual(w.spends().length, 1, 'the charge did land');
    assert.strictEqual(w.refunds().length, 0, 'nothing refunded yet');
    assert.strictEqual(row.refundedQuarks, 4 * PER, 'the late charge is claimed for refund on the closed row');
    assert.ok(!row.refundSettledAt);
    w.advance(caps.SETTLE_AFTER_MS + 1000);
    const [a, b] = await quiet(() => Promise.all([w.server('x').sweepUnsettled(), w.server('y').sweepUnsettled()]));
    assert.strictEqual(a + b, 1);
    assert.deepStrictEqual(w.refunds().map((m) => [m.q, m.ref]), [[4 * PER, String(row._id)]], 'exactly one refund');
    w.advance(caps.SETTLE_HOLD_MS + 1000);
    assert.strictEqual(await quiet(() => w.web.sweepUnsettled()), 0);
    assert.strictEqual(w.refunds().length, 1);
  });
}

test('S3: the late-refund claim does not touch a row that was refunded in full, or one that was accepted', async () => {
  const w = world();
  await create(w);
  const accepted = w.repo.rows[0];
  assert.strictEqual(await w.repo.claimLateRefund(accepted._id, { refundedQuarks: 40, payerId: U1, now: NOW }), null, 'a queued, charged row');
  w.repo.rows.push({ _id: 'cl1', user: U1, status: 'failed', outcome: 'stale_queued', refunded: true, refundedQuarks: 40, chargedAt: null, createdAt: NOW });
  assert.strictEqual(await w.repo.claimLateRefund('cl1', { refundedQuarks: 40, payerId: U1, now: NOW }), null, 'a row that already carries a refund');
});

// ---- S6: tests that fail when a guard the docs rely on is removed ----------------------------------------------------

test('S6 M12: a lease sweep never re-queues a run whose heartbeat renewed the lease after the sweep read it', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.hangIf = () => true;
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(30); });
  w.advance(SETTINGS.leaseMs + SETTINGS.heartbeatMs + 1000); // the lease looks expired
  const realRead = w.repo.expiredConsumerLeases;
  w.repo.expiredConsumerLeases = async (...args) => {
    const rows = await realRead(...args);
    const r = w.row(id);
    assert.ok(await w.repo.heartbeat(id, { leaseOwner: r.leaseOwner, runs: r.runs }, new Date(w.clock.t.getTime() + MIN))); // the heartbeat lands after the read
    return rows;
  };
  const out = await quiet(() => w.consumer('s').sweepLeases());
  assert.strictEqual(out.requeued, 0);
  assert.strictEqual(out.failed, 0);
  assert.strictEqual(w.row(id).status, 'running');
  assert.strictEqual(w.row(id).leaseOwner, 'w:a');
  // and the same at the run cap (a close instead of a re-queue)
  w.row(id).runs = SETTINGS.maxAttempts;
  w.repo.expiredConsumerLeases = async (...args) => {
    const rows = await realRead(...args);
    const r = w.row(id);
    await w.repo.heartbeat(id, { leaseOwner: r.leaseOwner, runs: r.runs }, new Date(w.clock.t.getTime() + 3 * MIN));
    return rows;
  };
  w.advance(5 * MIN);
  const out2 = await quiet(() => w.consumer('s2').sweepLeases());
  assert.strictEqual(out2.failed, 0);
  assert.strictEqual(w.refunds(id).length, 0);
  w.hung.forEach((h) => h.release()); await quiet(() => settle(40));
});

test('S6 M22: a result write whose reply was lost (it landed) is recognised by the read-back: the photo stays, the run goes on, nothing is deleted', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  const real = w.repo.finishPhotoOwned;
  w.repo.finishPhotoOwned = async (...a) => { const ok = await real(...a); if (a[3].status === 'done') throw new Error('reply lost'); return ok; };
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(100); });
  const r = w.row(id);
  assert.strictEqual(r.status, 'done');
  assert.ok(r.photos.every((p) => p.status === 'done' && /^https:/.test(p.url)));
  assert.deepStrictEqual(w.deleted, []);
  assert.strictEqual(w.refunds().length, 0);
  assert.strictEqual(c.stats.lostRuns, 0);
});

test('S6 M2: a refund that already exists for the job is never paid again by a consumer close', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.failIf = () => true;
  w.money.push({ type: 'refund', uid: U1, payer: U1, q: 4 * PER, action: 'photoshoot_image_refund', ref: String(id) }); // paid by another path
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(100); });
  const r = w.row(id);
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(r.refundedQuarks, 0);
  assert.ok(r.refundSettledAt, 'nothing left to settle');
  assert.strictEqual(w.refunds(id).length, 1, 'only the existing refund');
});

test('S6 M16: the retry loop sends a recorded consumer refund the proof does not support to a person, and pays nothing', async () => {
  for (const [label, proofCost] of [['no charge found', null], ['above the charge', PER]]) {
    const w = world();
    const base = { user: U1, kind: 'pack', pack: 'marketplace', day: '2026-10-20', photos: [{ index: 0, status: 'failed' }], photoCount: 1, quarksPerPhoto: PER, quarks: 4 * PER, payerId: U1, refunded: true, refundedQuarks: 4 * PER, refundFailed: true, status: 'failed', via: 'consumer', finishedAt: new Date(NOW.getTime() - 10 * MIN), createdAt: NOW };
    w.repo.rows.push({ ...base, _id: 'rr1', key: 'rr1' });
    if (proofCost) w.money.push({ type: 'spend', uid: U1, payer: U1, cost: proofCost, ref: 'rr1' });
    const n = await quiet(() => w.web.retryRefunds());
    assert.strictEqual(n, 0, label);
    assert.strictEqual(w.refunds().length, 0, label);
    const r = w.row('rr1');
    assert.strictEqual(r.refundGaveUp, true, label);
    assert.ok(w.alerts.some(([k]) => k === 'photoshoot_refund_gave_up'), label);
  }
});

test('S6 M11: the queued-timeout close only acts on the waiting period it read (a re-queue in between wins)', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.advance(31 * MIN);
  const real = w.repo.waitingTooLong;
  w.repo.waitingTooLong = async (...a) => {
    const rows = await real(...a);
    w.row(id).queuedAt = new Date(w.clock.t.getTime()); // handed back / re-queued after the sweep read it: a new wait began
    return rows;
  };
  assert.strictEqual(await quiet(() => w.web.sweepConsumerQueued()), 0);
  assert.strictEqual(w.row(id).status, 'queued');
  assert.strictEqual(w.refunds().length, 0);
  assert.ok(w.row(id).photos.every((p) => p.status === 'pending'));
});

test('S6 M7: a claim that resolves after SIGTERM began is handed back WITHOUT counting a release, and no run is started', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  const a = w.consumer('a');
  const real = w.repo.claimConsumer;
  w.repo.claimConsumer = async (...args) => { const r = await real(...args); a.stopping = true; return r; };
  await quiet(async () => { await a._drainOnce(); await settle(20); });
  const r = w.row(id);
  assert.strictEqual(r.status, 'queued');
  assert.ok(!(r.releases > 0), 'a claim handed back before it started is not a SIGTERM release');
  assert.strictEqual(a.running.size, 0);
  assert.strictEqual(a.stats.claims, 0);
});

test('S6 M20: with the switch off, the in-process resume loop never runs a consumer row, even one whose lease ran out', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  w.hangIf = () => true;
  const a = w.consumer('a');
  await quiet(async () => { await a._drain(); await settle(30); });
  w.advance(SETTINGS.leaseMs + SETTINGS.heartbeatMs + 1000);
  const off = createPhotoshoot({ ...w.deps, env: { ENABLE_PHOTOSHOOT: 'on' }, runnerId: 'off' });
  const lost = await quiet(() => off.resumeLost()); // no fromLoop: no consumer sweeps either
  assert.strictEqual(lost, 0, 'not taken over in-process');
  assert.strictEqual(w.queue.length, 0);
  assert.strictEqual(w.row(id).status, 'running');
  w.hung.forEach((h) => h.release()); await quiet(() => settle(40));
});

test('S6 M20 (real repo): the in-process lostJobs filter leaves consumer rows out; the consumer queries carry their claim fields', () => {
  const { createPhotoshootRepo } = require('../services/photoshoot/repo');
  const seen = {};
  const q = (name) => (...a) => { seen[name] = a; const r = { select: () => r, limit: () => r, sort: () => r, lean: () => r, then: (f) => f([]) }; return r; };
  const model = { find: q('find'), findOne: q('findOne'), countDocuments: q('count'), updateOne: async (...a) => { seen.updateOne = a; return { modifiedCount: 0, matchedCount: 0 }; }, findOneAndUpdate: q('findOneAndUpdate') };
  const repo = createPhotoshootRepo({ Job: () => model });
  repo.lostJobs(NOW, 10);
  assert.deepStrictEqual(seen.find[0].via, { $ne: 'consumer' });
  repo.requeueLost('x', { status: 'running', leaseOwner: 'w', runs: 1, leaseUntil: NOW }, NOW);
  assert.strictEqual(seen.findOneAndUpdate[0].via, 'consumer');
  assert.deepStrictEqual(seen.findOneAndUpdate[0].leaseUntil, NOW);
  repo.queueCharged('x', { quarks: 1, payerId: 'p', now: NOW, quarkCharge: {} });
  assert.strictEqual(seen.findOneAndUpdate[0].chargedAt, null);
  assert.strictEqual(seen.findOneAndUpdate[0].via, 'consumer');
  repo.staleQueued(NOW, 10);
  assert.strictEqual(seen.find[0].chargedAt, null);
  repo.closeStale('x', { now: NOW });
  assert.strictEqual(seen.findOneAndUpdate[0].chargedAt, null);
});

test('S6 M4: a run whose claim moved on before its next round stops as lost, and makes no call', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  const a = w.consumer('a');
  const claimed = await w.repo.claimConsumer(id, 'w:a', NOW, new Date(NOW.getTime() + MIN));
  w.row(id).leaseOwner = 'w:b'; // another worker took the row over
  const ctl = { owner: { leaseOwner: 'w:a', runs: claimed.runs }, leaseEnd: () => new Date(NOW.getTime() + MIN), lose() { this.lostFlag = true; }, isLost() { return !!this.lostFlag; }, stopping: () => false, orphan() {} };
  const out = await quiet(() => a.service.runClaimed(claimed, ctl));
  assert.strictEqual(out, 'lost');
  assert.strictEqual(w.calls.gen, 0);
  assert.strictEqual(w.row(id).photos.filter((p) => p.status !== 'pending').length, 0);
});

test('S6 M3: a run already marked lost (the heartbeat said so between rounds) pays for no photo, even if the row still looks like its own', async () => {
  const w = world();
  await create(w);
  const id = w.repo.rows[0]._id;
  const a = w.consumer('a');
  const claimed = await w.repo.claimConsumer(id, 'w:a', NOW, new Date(NOW.getTime() + MIN));
  const ctl = { owner: { leaseOwner: 'w:a', runs: claimed.runs }, leaseEnd: () => new Date(NOW.getTime() + MIN), lose() {}, isLost: () => true, stopping: () => false, orphan() {} };
  const out = await quiet(() => a.service.runClaimed(claimed, ctl));
  assert.strictEqual(out, 'lost');
  assert.strictEqual(w.calls.gen, 0, 'no paid call');
  assert.ok(w.row(id).photos.every((p) => p.status === 'pending' && !p.attempts));
});

test('S6 M23: the consumer heartbeat marks a run lost when the lease renewal matches nothing, and the run stops after its batch', async () => {
  const w = world({ settings: { heartbeatMs: 5 } });
  await create(w);
  const id = w.repo.rows[0]._id;
  let failRenewals = true;
  w.repo.heartbeat = async () => !failRenewals; // fails only while the first batch is out; the run's own renewals later succeed
  w.hangIf = (args, n) => n <= 2; // both photos of the first batch stay out
  const c = w.consumer('a');
  await quiet(async () => { await c._drain(); await settle(5); });
  await new Promise((r) => setTimeout(r, 40)); // a few heartbeat ticks
  failRenewals = false;
  w.hung.forEach((h) => h.release());
  await quiet(() => settle(100));
  assert.strictEqual(c.stats.lostRuns, 1);
  assert.strictEqual(c.stats.finished, 0);
  assert.strictEqual(w.calls.gen, 2, 'no second batch');
  assert.notStrictEqual(w.row(id).status, 'done');
});

// ---- minors fixed with the review (M-a, M-e) -------------------------------------------------------------------------

test('M-a: agency client removal does not wait forever on a refund that was set aside for a person', async () => {
  const ws = require('../services/agencyWorkspaces');
  const asked = {};
  const models = {};
  for (const k of ['VideoJob', 'HeroVideoJob', 'Blueprint', 'StudioVideo', 'Draft', 'Campaign', 'SocialPostAttempt', 'PhotoshootJob']) models[k] = { exists: async (f) => { asked[k] = f; return false; } };
  await ws.runningWork('w1', models, NOW.getTime());
  const third = asked.PhotoshootJob.$or.find((c) => c.refundedQuarks);
  assert.deepStrictEqual(third.refundGaveUp, { $ne: true });
});

test('M-e: a failure in the Photoshoot numbers does not take down the staff queue endpoint', async () => {
  const metrics = require('../routes/metrics');
  const orig = { ...metrics.queues };
  metrics.queues.video = () => ({ metrics: async () => ({ queueDepth: 0 }) });
  metrics.queues.image = () => ({ metrics: async () => ({ queueDepth: 0 }) });
  metrics.queues.studio = () => ({ metrics: async () => ({ queueDepth: 0 }) });
  metrics.queues.photoshoot = () => ({ metrics: async () => { throw new Error('db down'); } });
  try {
    const layer = metrics.stack.find((l) => l.route && l.route.path === '/queue');
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
    await quiet(() => layer.route.stack.slice(-1)[0].handle({}, res));
    assert.strictEqual(res.code, 200);
    assert.ok(res.body.videoJobs && res.body.imageJobs && res.body.studioVideos);
    assert.strictEqual(res.body.photoshoot.unavailable, true);
  } finally { Object.assign(metrics.queues, orig); }
});
