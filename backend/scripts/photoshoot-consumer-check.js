/**
 * Real-database check of the Photoshoot consumer (E9 stage B2, docs/superpowers/ops/generation-parallelism.md), against the
 * DEVELOPMENT database only: refuses any database except nebulaa_dev. FAKE image generator (waits, then returns a link),
 * FAKE wallet and charge proof (charges and refunds counted in memory), FAKE image delete, no spend-guard write, no
 * outgoing request to a non-local host.
 *
 * It runs the real service code (services/photoshoot/service.js create, runClaimed, the consumer closes and sweeps), the
 * real repo (services/photoshoot/repo.js, every conditional MongoDB write) and the real consumer
 * (services/photoshootConsumer.js) as up to 3 in-process workers, on a THROWAWAY collection `zz_photoshoot_consumer_check`
 * with the PhotoshootJob schema and indexes (like D72 and D82: a dev server running against nebulaa_dev must never see a
 * test row, its resume loop would run the REAL generator). Throwaway accounts are new ids; keys start with `zzpc`.
 *   1. 1 worker and 3 workers: no job runs twice, every photo is made once, each job completes once;
 *   2. throughput scales with workers (3 at least 1.4x faster than 1);
 *   3. a killed worker's job is resumed by another one: photos made before the kill are not made again, one charge, no
 *      refund, the dead run's late result is not recorded (the unit tests cover deleting such a file);
 *   4. refunds are exact: all photos failing refunds the price once, one failing photo refunds that photo once, a job lost
 *      twice (the run cap) is closed once by two sweeps at the same moment with only its open photos refunded;
 *   5. the per-account cap holds across 3 workers; a waiting row nobody claims is closed and refunded once by two sweeps;
 *   6. the staff queue numbers; every refund to the paying wallet, never above its charge; no row left open.
 * At most 16 jobs; the collection is dropped at the end; exits non-zero on any FAIL or a leftover.
 *   node scripts/photoshoot-consumer-check.js          run, print PASS/FAIL, clean up
 *   node scripts/photoshoot-consumer-check.js cleanup  drop leftovers of an interrupted run
 */
require('dotenv').config();
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.OPENAI_API_KEY = ''; // no real image call can happen: the key the app would use is removed before anything loads
const https = require('https');
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
let outside = 0;
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) { outside += 1; throw new Error(`photoshoot-consumer-check: outgoing request to ${host} refused`); }
    return orig.call(this, a, ...rest);
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const host = new URL(String(url)).hostname;
  if (!isLocal(host)) { outside += 1; throw new Error(`photoshoot-consumer-check: outgoing fetch to ${host} refused`); }
  return realFetch(url, ...rest);
};

const mongoose = require('mongoose');
const assert = require('assert');

const DEV_DB = 'nebulaa_dev';
const COLLECTION = 'zz_photoshoot_consumer_check';
const MAX_JOBS = 16;
const results = [];
const loops = [];
// Every worker a check started is stopped when the check ends, pass or fail (a failed check must not leave a worker draining).
const stopLoops = () => { for (const l of loops) { l.timers.forEach(clearInterval); l.c.stopping = true; } };
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); } finally { stopLoops(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, every = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(every); }
  return false;
}
async function dropCheckCollection(db) {
  const exists = (await db.listCollections({ name: COLLECTION }).toArray()).length > 0;
  if (exists) await db.dropCollection(COLLECTION);
  return exists;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000, maxPoolSize: 10 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('dropped', await dropCheckCollection(db)); return 0; }
  await dropCheckCollection(db);

  const PhotoshootJob = require('../models/PhotoshootJob');
  const Zz = mongoose.model('ZzPhotoshootConsumerCheck', PhotoshootJob.schema.clone(), COLLECTION);
  await Zz.createIndexes();
  const repo = require('../services/photoshoot/repo').createPhotoshootRepo({ Job: () => Zz });
  const { createPhotoshoot } = require('../services/photoshoot/service');
  const { PhotoshootConsumer } = require('../services/photoshootConsumer');
  const { QUARK_COSTS } = require('../config/apiCosts');
  const PER = QUARK_COSTS.photoshoot_image;

  // Fake wallet and proof (never the real Quarks).
  const ledger = { spends: [], refunds: [] };
  const products = new Map(); // userId -> { _id, name }
  const calls = []; // { job prompt marker }
  const hung = [];
  const deleted = [];
  let delayMs = 300;
  let n = 0;
  const inflight = new Map(); // tag -> image calls in flight now
  const peakCalls = new Map(); // tag -> the most image calls in flight at once
  /** One fake image call: a marker in the product name makes it hang (once per prompt) or fail. */
  async function makeOne(args, tag) {
    const url = `https://res.cloudinary.com/zz/image/upload/zz/${++n}.png`;
    if (/zzhang/.test(tag) && !hung.some((h) => h.prompt === args.prompt)) {
      const sideOnly = /zzhangside/.test(tag);
      if (!sideOnly || /from the side/.test(args.prompt)) return new Promise((resolve) => hung.push({ prompt: args.prompt, tag, release: () => resolve({ ok: true, url }) }));
    }
    await sleep(delayMs);
    if (/zzfailall/.test(tag) || (/zzfailside/.test(tag) && /from the side/.test(args.prompt))) return { ok: false, reason: 'provider' };
    return { ok: true, url };
  }
  // Lease 6 s (production: 60 s) so the check takes seconds; not shorter (dev cluster write spikes from a laptop, D82).
  const BASE = { slots: { image: 2, video: 2, omni: 2, photoshoot: 1 }, cpu: 1, globalCeiling: 0, perUserRunning: 2, leaseMs: 6000, heartbeatMs: 1000, maxAttempts: 2, shutdownGraceMs: 0, warnings: [] };
  const deps = {
    repo,
    productsOf: async (uid, ids) => { const p = products.get(String(uid)); return p && (!ids || ids.includes(String(p._id))) ? [{ ...p, user: String(uid), imageUrl: 'https://res.cloudinary.com/zz/image/upload/zz/p.png', images: [] }] : []; },
    placesOf: async () => [],
    settle: async () => null,
    spend: async (uid, cost, o) => { ledger.spends.push({ user: String(uid), amount: cost, ref: o.ref }); return { success: true, payerId: String(uid) }; },
    refundTo: async (uid, q, o) => { ledger.refunds.push({ user: String(uid), amount: q, ref: o.ref, payerId: o.payerId }); return { ok: true, payerId: o.payerId }; },
    ledgerFor: async (id) => {
      const sp = ledger.spends.find((s) => s.ref === String(id));
      return { spend: sp ? { payer: sp.user, quarks: sp.amount } : null, refunded: ledger.refunds.some((r) => r.ref === String(id)) };
    },
    guard: async () => ({ ok: true }),
    recordSpend: () => {},
    loadRef: async () => ({ mimeType: 'image/png', data: 'eA==' }),
    deleteImage: async (url) => { deleted.push(url); return { success: true }; },
    generate: async (args) => {
      const m = /(zz[a-z0-9]+)/.exec(String(args.prompt));
      const tag = m ? m[1] : '?';
      calls.push({ tag, prompt: args.prompt });
      inflight.set(tag, (inflight.get(tag) || 0) + 1);
      peakCalls.set(tag, Math.max(peakCalls.get(tag) || 0, inflight.get(tag)));
      try { return await makeOne(args, tag); } finally { inflight.set(tag, inflight.get(tag) - 1); }
    },
    alert: () => {}, alertNow: () => {},
    schedule: () => { throw new Error('nothing may be scheduled in-process on the consumer path'); },
    env: { ENABLE_PHOTOSHOOT: 'on', ENABLE_PHOTOSHOOT_CONSUMER: 'on', PHOTOSHOOT_QUEUED_MAX_MS: '4000' },
    slots: () => BASE,
    kick: () => {},
    runnerId: 'zzpc-web'
  };
  const web = createPhotoshoot(deps);
  let made = 0;
  let keyN = 0;
  async function createJob(tag) {
    if (made >= MAX_JOBS) throw new Error('job budget reached');
    made += 1;
    const user = String(new mongoose.Types.ObjectId());
    const pid = String(new mongoose.Types.ObjectId());
    products.set(user, { _id: pid, name: `Product ${tag}` });
    const r = await web.create({ _id: user, plan: { tier: 'starter' } }, { key: `zzpc-${Date.now().toString(36)}-${++keyN}`, pack: 'marketplace', productIds: [pid] });
    assert.strictEqual(r.status, 202, `create answered ${r.status}: ${r.body && r.body.message}`);
    return { id: r.body.job.id, user };
  }

  const direct = { withLease: async (name, ttl, fn) => fn() };
  /** A repo view that stops answering when its worker is killed (a dead process writes nothing: no heartbeat). */
  function killable() {
    const state = { dead: false };
    const view = new Proxy(repo, { get(t, prop) { const v = t[prop]; if (typeof v !== 'function') return v; return (...a) => (state.dead ? Promise.reject(new Error('worker is dead')) : v.apply(t, a)); } });
    return { repo: view, kill: () => { state.dead = true; } };
  }
  function worker(name, { repoView = null, drain = true, sweep = false, settings = BASE } = {}) {
    const svc = createPhotoshoot({ ...deps, repo: repoView || repo, runnerId: `zzpc-${name}`, slots: () => settings });
    const c = new PhotoshootConsumer({ service: svc, settings, workerId: `zzpc:${name}`, leaseLock: direct, spend: { check: async () => ({ ok: true }) }, alert: () => {} });
    c.started = true; // driven by the loops below (faster than production's 5 s)
    const entry = { c, timers: [] };
    if (drain) entry.timers.push(setInterval(() => { c._drain().catch(() => null); }, 200));
    if (sweep) entry.timers.push(setInterval(() => { c.sweepLeases().catch(() => null); }, 1000));
    loops.push(entry);
    return { c, stop: () => { entry.timers.forEach(clearInterval); c.stopping = true; } };
  }
  const row = (id) => Zz.findById(id).lean();
  const closed = (ids) => async () => (await Zz.countDocuments({ _id: { $in: ids }, status: { $in: ['done', 'partial', 'failed'] } })) === ids.length;
  const callsFor = (tag) => calls.filter((c) => c.tag === tag).length;
  const span = (rows, start) => Math.max(...rows.map((r) => new Date(r.finishedAt).getTime())) - start;

  try {
    let t1 = 0; let t3 = 0;
    delayMs = 1500;
    await check('1 worker: 3 jobs, every photo made once, each job completed once', async () => {
      const jobs = [];
      for (let i = 0; i < 3; i += 1) jobs.push(await createJob(`zzone${i}`));
      const start = Date.now();
      const one = worker('one');
      assert.ok(await until(closed(jobs.map((j) => j.id)), 40000), 'not all finished');
      one.stop();
      for (let i = 0; i < 3; i += 1) assert.strictEqual(callsFor(`zzone${i}`), 4, `job ${i} made ${callsFor(`zzone${i}`)} calls`);
      const rows = await Zz.find({ _id: { $in: jobs.map((j) => j.id) } }).lean();
      assert.ok(rows.every((r) => r.status === 'done' && r.runs === 1), rows.map((r) => `${r.status}/${r.runs}`).join());
      t1 = span(rows, start);
      return `${t1} ms from start to the last completion`;
    });
    await check('3 workers: 3 jobs, each claimed by exactly one worker, every photo made once', async () => {
      const jobs = [];
      for (let i = 0; i < 3; i += 1) jobs.push(await createJob(`zzthree${i}`));
      const start = Date.now();
      const ws = ['a', 'b', 'c'].map((x) => worker(x));
      assert.ok(await until(closed(jobs.map((j) => j.id)), 40000), 'not all finished');
      ws.forEach((x) => x.stop());
      for (let i = 0; i < 3; i += 1) assert.strictEqual(callsFor(`zzthree${i}`), 4);
      const rows = await Zz.find({ _id: { $in: jobs.map((j) => j.id) } }).lean();
      assert.ok(rows.every((r) => r.status === 'done' && r.runs === 1));
      assert.strictEqual(ws.reduce((s, x) => s + x.c.stats.claims, 0), 3);
      t3 = span(rows, start);
      return `${t3} ms, split ${ws.map((x) => x.c.stats.claims).join('/')}`;
    });
    await check('throughput scales with workers (3 at least 1.4x faster than 1)', async () => {
      assert.ok(t1 > 0 && t3 > 0);
      const ratio = t1 / t3;
      assert.ok(ratio >= 1.4, `ratio ${ratio.toFixed(2)}`);
      return `${ratio.toFixed(2)}x`;
    });
    delayMs = 300;

    await check('a killed worker\'s job is resumed: photos made before the kill are not made again, one charge, no refund, the dead run\'s late result changes nothing', async () => {
      const k = killable();
      const dying = worker('dying', { repoView: k.repo, settings: { ...BASE, slots: { ...BASE.slots, photoshoot: 1 } } });
      const j = await createJob('zzhangside');
      // Killed once the front photo is stored and the side photo hangs (a photo still in flight at the kill is called again: our cost).
      assert.ok(await until(async () => hung.some((h) => h.tag === 'zzhangside') && (await row(j.id)).photos.some((p) => p.status === 'done')), 'the side photo never started');
      const mid = await row(j.id);
      const doneBefore = mid.photos.filter((p) => p.status === 'done').length;
      k.kill(); dying.stop();
      const killedAt = Date.now();
      const others = ['r1', 'r2'].map((x) => worker(x, { sweep: true }));
      assert.ok(await until(closed([j.id]), 40000), 'not resumed');
      others.forEach((x) => x.stop());
      const r = await row(j.id);
      assert.strictEqual(r.status, 'done');
      assert.strictEqual(r.runs, 2);
      assert.strictEqual(callsFor('zzhangside'), 5, `calls ${callsFor('zzhangside')}: 4 photos + one more for the photo left calling`);
      assert.ok(doneBefore >= 1, 'at least one photo was stored before the kill');
      assert.strictEqual(ledger.spends.filter((s) => s.ref === j.id).length, 1);
      assert.strictEqual(ledger.refunds.filter((x) => x.ref === j.id).length, 0);
      const before = deleted.length;
      hung.filter((h) => h.tag === 'zzhangside').forEach((h) => h.release());
      await sleep(800);
      const after = await row(j.id);
      assert.deepStrictEqual(after.photos.map((p) => p.url), r.photos.map((p) => p.url), 'the delivered photos are unchanged');
      // The dead worker's repo view is dead too, so its late write cannot even be tried: nothing lands, nothing changes.
      assert.ok(deleted.length >= before);
      return `resumed ${Math.round((new Date(r.finishedAt).getTime() - killedAt) / 100) / 10} s after the kill, ${doneBefore} photo(s) kept from the dead run`;
    });

    await check('all photos failing refunds the price once; one failing photo refunds that photo once', async () => {
      const all = await createJob('zzfailall');
      const side = await createJob('zzfailside');
      const ws = ['f1', 'f2'].map((x) => worker(x));
      assert.ok(await until(closed([all.id, side.id]), 30000), 'not finished');
      ws.forEach((x) => x.stop());
      const a = await row(all.id); const s = await row(side.id);
      assert.strictEqual(a.status, 'failed');
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === all.id).map((x) => x.amount), [4 * PER]);
      assert.strictEqual(s.status, 'partial');
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === side.id).map((x) => x.amount), [PER]);
      assert.ok(a.refundSettledAt && s.refundSettledAt, 'both refunds settled');
    });

    await check('a job lost twice (the run cap) is closed exactly once by two sweeps at the same moment, only its open photos refunded', async () => {
      const j = await createJob('zzhangcap');
      for (let i = 0; i < 2; i += 1) {
        const k = killable();
        const w = worker(`cap${i}`, { repoView: k.repo });
        assert.ok(await until(async () => { const r = await row(j.id); return r && r.status === 'running' && r.runs === i + 1; }), `run ${i + 1} not claimed`);
        await sleep(500);
        k.kill(); w.stop();
        if (i === 0) {
          const s = worker('capsweep', { drain: false });
          assert.ok(await until(async () => { await s.c.sweepLeases(); const r = await row(j.id); return r && r.status === 'queued'; }, 30000, 500), 'not re-queued');
          s.stop();
        }
      }
      await sleep(BASE.leaseMs + BASE.heartbeatMs + 300);
      const a = worker('sa', { drain: false }); const b = worker('sb', { drain: false });
      let failedBy = 0;
      const ok = await until(async () => {
        const [ra, rb] = await Promise.all([a.c.sweepLeases(), b.c.sweepLeases()]);
        failedBy += ra.failed + rb.failed;
        return closed([j.id])();
      }, 30000, 500);
      a.stop(); b.stop();
      assert.ok(ok, 'not closed');
      const r = await row(j.id);
      assert.strictEqual(failedBy, 1, `closed by ${failedBy} sweeps`);
      const open = r.photos.filter((p) => p.reason === 'lost').length;
      assert.ok(open >= 1);
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === j.id).map((x) => x.amount), [open * PER]);
      hung.forEach((h) => h.release());
      await sleep(500);
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === j.id).map((x) => x.amount), [open * PER], 'late results refund nothing more');
      return `${r.status}: ${r.photos.length - open} kept, ${open} refunded`;
    });

    await check('the per-account cap holds across 3 workers; the staff queue numbers are right while it runs', async () => {
      const capped = { ...BASE, perUserRunning: 1, slots: { ...BASE.slots, photoshoot: 2 } };
      const j = await createJob('zzcap1');
      // A second waiting row of the same account (the in-flight index normally forbids it; the cap is the second line).
      const first = await Zz.findById(j.id).lean();
      const second = { ...first, _id: new mongoose.Types.ObjectId(), key: `${first.key}-b`, queuedAt: new Date(Date.now() + 1) };
      delete second.inFlight;
      await Zz.create(second);
      delayMs = 1200;
      const ws = ['k1', 'k2', 'k3'].map((x) => worker(x, { settings: capped }));
      let sawMetrics = null;
      const ids = [j.id, String(second._id)];
      const ok = await until(async () => {
        if (!sawMetrics && (await Zz.countDocuments({ user: first.user, status: 'running' })) === 1) sawMetrics = await ws[0].c.metrics();
        return closed(ids)();
      }, 40000, 150);
      // RUN, not claimed: one job makes at most 2 photos at once, so more than 2 image calls at once would mean 2 jobs ran.
      const peak = Math.ceil((peakCalls.get('zzcap1') || 0) / 2);
      ws.forEach((x) => x.stop());
      delayMs = 300;
      assert.ok(ok, 'not finished');
      assert.ok(peak <= 1, `${peakCalls.get('zzcap1')} image calls at once for one account: two jobs ran`);
      const rows = await Zz.find({ _id: { $in: ids } }).lean();
      assert.ok(rows.every((r) => r.status === 'done' && r.runs === 1), 'a hand-back is not a run');
      assert.ok(sawMetrics && sawMetrics.running >= 1 && typeof sawMetrics.queueDepth === 'number' && Object.keys(sawMetrics.runningByWorker).every((k) => k.startsWith('zzpc:')), JSON.stringify(sawMetrics && { q: sawMetrics.queueDepth, r: sawMetrics.running, w: sawMetrics.runningByWorker }));
      return `peak ${peak}, hand-backs ${ws.reduce((s, x) => s + x.c.stats.capHandBacks, 0)}, metrics queueDepth ${sawMetrics.queueDepth} running ${sawMetrics.running}`;
    });

    await check('a waiting job nobody claims is closed and refunded once by two sweeps at the same moment', async () => {
      const j = await createJob('zzwait');
      await sleep(4500);
      const a = createPhotoshoot({ ...deps, runnerId: 'zzpc-qa' }); const b = createPhotoshoot({ ...deps, runnerId: 'zzpc-qb' });
      const [na, nb] = await Promise.all([a.sweepConsumerQueued(), b.sweepConsumerQueued()]);
      assert.strictEqual(na + nb, 1);
      const r = await row(j.id);
      assert.strictEqual(r.status, 'failed');
      assert.strictEqual(r.outcome, 'queued_timeout');
      assert.strictEqual(r.inFlight, undefined);
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === j.id).map((x) => x.amount), [4 * PER]);
    });

    await check('a charge that lands on a row the stale sweep already closed is claimed for refund exactly once (review S3, real filters)', async () => {
      const j = await createJob('zzlate');
      await Zz.updateOne({ _id: j.id }, { $set: { status: 'failed', outcome: 'stale_queued', refunded: true, refundedQuarks: 0, chargedAt: null }, $unset: { inFlight: 1 } });
      const args = { refundedQuarks: 4 * PER, payerId: j.user, now: new Date() };
      const got = await Promise.all([repo.claimLateRefund(j.id, args), repo.claimLateRefund(j.id, args), repo.claimLateRefund(j.id, args)]);
      assert.strictEqual(got.filter(Boolean).length, 1, 'exactly one caller wins');
      const r = await row(j.id);
      assert.strictEqual(r.refundedQuarks, 4 * PER);
      assert.strictEqual(r.refundSettledAt || null, null);
      assert.strictEqual(await repo.claimLateRefund(j.id, args), null, 'and not again');
      // a queued, charged row (an accepted job) is never touched
      const k = await createJob('zzlate2');
      assert.strictEqual(await repo.claimLateRefund(k.id, args), null);
      await Zz.updateOne({ _id: j.id }, { $set: { refundSettledAt: new Date() } }); // stands in for the settle sweep (paid in the unit tests)
      await Zz.updateOne({ _id: k.id }, { $set: { status: 'failed', outcome: 'check_done', refunded: true, refundedQuarks: 0, refundSettledAt: new Date() }, $unset: { inFlight: 1 } });
    });

    await check('every refund went to the wallet that paid, never above its charge; no row left open; nothing reached the network', async () => {
      for (const r of ledger.refunds) {
        const sp = ledger.spends.find((s) => s.ref === r.ref);
        assert.ok(sp, `refund without a charge: ${r.ref}`);
        assert.ok(r.amount <= sp.amount);
        assert.strictEqual(String(r.payerId), sp.user);
      }
      const perRef = new Map(); for (const r of ledger.refunds) perRef.set(r.ref, (perRef.get(r.ref) || 0) + 1);
      assert.ok([...perRef.values()].every((v) => v === 1), 'one refund per job at most');
      const open = await Zz.countDocuments({ $or: [{ status: { $in: ['queued', 'running'] } }, { refunded: true, refundedQuarks: { $gt: 0 }, refundSettledAt: null }] });
      assert.strictEqual(open, 0, `${open} rows still open`);
      assert.strictEqual(outside, 0, `${outside} outside requests`);
      return `${made} jobs, ${ledger.spends.length} charges, ${ledger.refunds.length} refunds, ${calls.length} fake image calls`;
    });
  } finally {
    stopLoops();
    hung.forEach((h) => h.release());
    await sleep(500);
    const rowsLeft = await Zz.countDocuments({});
    console.log(`cleanup: ${rowsLeft} rows in the throwaway collection, dropped ${await dropCheckCollection(db)}`);
    const still = (await db.listCollections({ name: COLLECTION }).toArray()).length;
    if (still) { console.log('LEFTOVER: the throwaway collection still exists'); results.push(false); }
  }
  const pass = results.filter(Boolean).length;
  const fail = results.length - pass;
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  return fail ? 1 : 0;
}

main()
  .then((code) => mongoose.disconnect().then(() => process.exit(code)))
  .catch(async (e) => { console.error('check aborted:', e && e.message); try { await dropCheckCollection(mongoose.connection.db); } catch (_) { /* best effort */ } await mongoose.disconnect().catch(() => {}); process.exit(2); });
