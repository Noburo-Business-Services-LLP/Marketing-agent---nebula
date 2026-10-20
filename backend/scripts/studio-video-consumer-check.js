/**
 * Real-database check of the Videos (Omni) consumer (E9 stage B1, docs/superpowers/ops/generation-parallelism.md), against
 * the DEVELOPMENT database only: refuses any database except nebulaa_dev. FAKE Omni (waits, then returns bytes), FAKE
 * clip storage and ffmpeg, a FAKE wallet (charges and refunds counted in memory), no outgoing request to a non-local host.
 *
 * It runs the real create route (charge, then queue) and the real consumer code (services/studioVideoConsumer.js,
 * routes/studioVideos.js runClaimed) as 3 in-process consumers, on a THROWAWAY collection `zz_studio_video_check` with the
 * StudioVideo schema (like D72: a dev server running against nebulaa_dev must never see a test row; the StudioVideo model
 * is pointed at the throwaway collection for this process only). Throwaway accounts are new ids, titles `zz.studio-check`.
 *   1. no video runs twice and each completes once, with 1 consumer and with 3 (3 videos each);
 *   2. throughput scales with consumers (3 consumers at least 1.4x faster than 1);
 *   3. a killed consumer's 3-clip video is resumed by another one: clip 1 is not made again, one charge, no refund, and
 *      the dead run's late result is discarded;
 *   4. refunds are exact: a failed video refunds its whole price once, a short video the missing clip once, and a video
 *      lost twice (the cap) is failed and refunded once by two sweeps at the same moment.
 * At most 12 videos; the collection is dropped at the end; exits non-zero on any FAIL.
 *   node scripts/studio-video-consumer-check.js          run, print PASS/FAIL, clean up
 *   node scripts/studio-video-consumer-check.js cleanup  drop leftovers of an interrupted run
 */
require('dotenv').config();
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const https = require('https');
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
for (const fn of ['request', 'get']) {
  const orig = https[fn];
  https[fn] = function guarded(a, ...rest) {
    const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
    if (!isLocal(host)) throw new Error(`studio-video-consumer-check: outgoing request to ${host} refused`);
    return orig.call(this, a, ...rest);
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const host = new URL(String(url)).hostname;
  if (!isLocal(host)) throw new Error(`studio-video-consumer-check: outgoing fetch to ${host} refused`);
  return realFetch(url, ...rest);
};

const mongoose = require('mongoose');
const assert = require('assert');

const DEV_DB = 'nebulaa_dev';
const COLLECTION = 'zz_studio_video_check';
const TAG = 'zz.studio-check';
const MAX_VIDEOS = 12;
const results = [];
async function check(name, fn) {
  try { const d = await fn(); results.push(true); console.log(`PASS  ${name}${d ? ` (${d})` : ''}`); } catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e && e.message}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, every = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = Date.now();
    const ok = await fn();
    if (process.env.CHECK_DEBUG) console.log(`  until: ${ok} in ${Date.now() - t} ms`);
    if (ok) return true;
    await sleep(every);
  }
  return false;
}

async function dropCheckCollection(db) {
  const exists = (await db.listCollections({ name: COLLECTION }).toArray()).length > 0;
  if (exists) await db.dropCollection(COLLECTION);
  return exists;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000, maxPoolSize: 10, monitorCommands: !!process.env.CHECK_DEBUG });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  if (process.argv.includes('cleanup')) { console.log('dropped', await dropCheckCollection(db)); return 0; }
  await dropCheckCollection(db);

  const alerts = require('../services/opsAlerts');
  alerts.recordFailure = async () => false;
  alerts.notify = async () => false;

  // The StudioVideo model, for this process only, reads and writes the throwaway collection.
  const StudioVideo = require('../models/StudioVideo');
  const Zz = mongoose.model('ZzStudioVideoCheck', StudioVideo.schema.clone(), COLLECTION);
  await Zz.createIndexes();
  for (const m of ['create', 'countDocuments', 'deleteOne', 'updateOne', 'findOneAndUpdate', 'findOne', 'find', 'aggregate', 'findById', 'exists']) StudioVideo[m] = Zz[m].bind(Zz);
  if (process.env.CHECK_DEBUG) {
    const client = mongoose.connection.getClient();
    client.on('commandSucceeded', (e) => { if (e.duration > 300) console.log(`  slow ${e.commandName} ${e.duration} ms`); });
  }

  // Fake wallet and account reads (never the real Quarks).
  const User = require('../models/User');
  const quarkBuckets = require('../services/quarkBuckets');
  const spendGuard = require('../services/spendGuard');
  const ledger = { spends: [], refunds: [] };
  User.findById = () => ({ select: () => ({ lean: async () => ({ companyName: TAG }) }) });
  quarkBuckets.settleWallet = async () => null;
  quarkBuckets.spend = async (user, amount, meta) => { ledger.spends.push({ user: String(user), amount, ref: meta.ref }); return { success: true, payerId: String(user) }; };
  quarkBuckets.refundTo = async (user, amount, meta) => { ledger.refunds.push({ user: String(user), amount, ref: meta.ref, payerId: meta.payerId }); return { ok: true }; };
  quarkBuckets.chargeProof = async (ref) => {
    const sp = ledger.spends.find((s) => s.ref === ref);
    return { spend: sp ? { payer: sp.user, quarks: sp.amount, source: 'ledger' } : null, refunded: ledger.refunds.some((r) => r.ref === ref) };
  };
  spendGuard.check = async () => ({ ok: true });

  const route = require('../routes/studioVideos');
  const { StudioVideoConsumer } = require('../services/studioVideoConsumer');
  const { createSemaphore } = require('../services/cpuSlots');
  const { QUARK_COSTS } = require('../config/apiCosts');
  const COST1 = QUARK_COSTS.studio_video;

  // Fake Omni: waits 2.5 s in the throughput part and 300 ms elsewhere (a provider call), records each prompt; a marker in the prompt makes it fail or hang.
  const calls = [];
  const hung = [];
  const clips = new Map();
  let n = 0;
  Object.assign(route._io, {
    generate: async (a) => {
      calls.push(a.prompt);
      if (/HANG/.test(a.prompt) && hung.length < 99 && (!/ONCE/.test(a.prompt) || !hung.some((h) => h.prompt === a.prompt))) {
        return new Promise((resolve) => hung.push({ prompt: a.prompt, release: () => resolve({ ok: true, buffer: Buffer.from(`late:${a.prompt}`) }) }));
      }
      await sleep(/zz check (one|three)/.test(a.prompt) ? 2500 : 300);
      if (/FAILALL/.test(a.prompt) || /FAILTHIS/.test(a.prompt)) return { ok: false, message: 'busy' };
      return { ok: true, buffer: Buffer.from(`clip:${a.prompt.slice(-40)}`) };
    },
    loadRefs: async () => [],
    lastFrame: async (b) => Buffer.from(`F:${String(b).slice(0, 20)}`),
    concat: async (bufs) => Buffer.from(bufs.map(String).join('+')),
    storeClip: async (buf) => { const url = `https://cdn.check.test/clip/${++n}`; clips.set(url, Buffer.from(buf)); return url; },
    loadClip: async (url) => clips.get(url) || null,
    store: async () => `https://cdn.check.test/final/${++n}.mp4`,
    discard: async () => {},
    logoUrl: async () => '',
    alert: () => {}
  });

  let made = 0;
  const handler = route.stack.find((l) => l.route && l.route.path === '/create' && l.route.methods.post).route.stack.slice(-1)[0].handle;
  async function createVideo(concept, parts = null) {
    if (made >= MAX_VIDEOS) throw new Error('video budget reached');
    made += 1;
    process.env.ENABLE_STUDIO_VIDEO_CONSUMER = 'on';
    const user = String(new mongoose.Types.ObjectId());
    const body = { title: TAG, concept, language: 'english', clips: parts ? parts.length : 1, ...(parts ? { parts: parts.map((s) => ({ beats: [s], spokenLine: s })) } : {}) };
    const res = { code: 0, body: null, headersSent: false, status(c) { this.code = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; } };
    await handler({ user: { userId: user }, body }, res);
    assert.strictEqual(res.code, 202, `create answered ${res.code}: ${res.body && res.body.message}`);
    return { id: res.body.video.id, user };
  }

  // Lease 6 s (production: 60 s) so the check takes seconds; not shorter, because the dev cluster from a laptop has write
  // latency spikes of 2 to 4 s, and a lease shorter than a spike lets a sweep take a LIVE run's video (money-safe: it is
  // failed and refunded once, the live run's writes then lose; but the check would not test what it means to).
  const BASE = { slots: { image: 2, video: 2, omni: 1 }, cpu: 2, globalCeiling: 0, perUserRunning: 2, leaseMs: 6000, heartbeatMs: 1000, maxAttempts: 2, shutdownGraceMs: 0, warnings: [] };
  const direct = { withLease: async (name, ttl, fn) => fn() };
  const loops = [];
  /** A model view that stops answering when its consumer is killed (a dead process writes nothing: no heartbeat). */
  function killable() {
    const state = { dead: false };
    const model = new Proxy(StudioVideo, {
      get(target, prop) {
        const v = target[prop];
        if (typeof v !== 'function') return v;
        return (...args) => {
          if (state.dead) {
            const err = Promise.reject(new Error('consumer is dead')); err.catch(() => {});
            const q = { lean: () => q, sort: () => q, limit: () => q, select: () => q, then: (a, b) => err.then(a, b), catch: (b) => err.catch(b) };
            return q;
          }
          return v.apply(target, args);
        };
      }
    });
    return { model, kill: () => { state.dead = true; } };
  }
  function consumer(name, { model, drain = true, sweep = false } = {}) {
    const c = new StudioVideoConsumer({ model: model || StudioVideo, workerId: `${TAG}:${name}`, settings: BASE, leaseLock: direct, cpu: createSemaphore(2), alert: () => {} });
    c.started = true; // driven by the loops below (a faster drain than production's 5 s, so the check takes seconds)
    const entry = { c, timers: [] };
    if (drain) entry.timers.push(setInterval(() => { c._drain().catch(() => null); }, 200));
    if (sweep) entry.timers.push(setInterval(() => { c.sweepLeases().catch(() => null); }, 1000));
    loops.push(entry);
    return { c, stop: () => { entry.timers.forEach(clearInterval); c.stopping = true; } };
  }
  const row = (id) => Zz.findById(id).lean();
  const done = (ids) => async () => {
    if (process.env.CHECK_DEBUG) console.log('  rows:', (await Zz.find({ _id: { $in: ids } }).select({ status: 1, refundState: 1, clipsDone: 1, workerId: 1 }).lean()).map((r) => `${r.status}/${r.refundState}/${r.clipsDone}`).join(' '));
    return (await Zz.countDocuments({ _id: { $in: ids }, status: { $in: ['completed', 'failed'] }, refundState: { $ne: 'refunding' } })) === ids.length;
  };
  // Elapsed time from the start to the last completion, read from the rows (the polling loop adds network jitter).
  const span = (rows, start) => Math.max(...rows.map((r) => new Date(r.completedAt).getTime())) - start;
  const callsFor = (word) => calls.filter((p) => p.includes(word)).length;

  try {
    // 1 and 2: throughput with 1 and 3 consumers, no double run.
    let t1 = 0; let t3 = 0;
    await check('1 consumer: 3 videos, each made once and completed once', async () => {
      const vids = [];
      for (let i = 0; i < 3; i += 1) vids.push(await createVideo(`zz check one ${i}`));
      const start = Date.now();
      const one = consumer('one');
      assert.ok(await until(done(vids.map((v) => v.id))), 'not all finished');
      one.stop();
      for (let i = 0; i < 3; i += 1) assert.strictEqual(callsFor(`zz check one ${i}`), 1, `video ${i} made ${callsFor(`zz check one ${i}`)} times`);
      const rows = await Zz.find({ _id: { $in: vids.map((v) => v.id) } }).lean();
      assert.ok(rows.every((r) => r.status === 'completed' && r.attempts === 1), rows.map((r) => `${r.status}/${r.attempts}`).join());
      t1 = span(rows, start);
      return `${t1} ms from start to the last completion`;
    });
    await check('3 consumers: 3 videos, each made once by exactly one consumer', async () => {
      const vids = [];
      for (let i = 0; i < 3; i += 1) vids.push(await createVideo(`zz check three ${i}`));
      const start = Date.now();
      const cs = ['a', 'b', 'c'].map((x) => consumer(x));
      assert.ok(await until(done(vids.map((v) => v.id))), 'not all finished');
      cs.forEach((x) => x.stop());
      for (let i = 0; i < 3; i += 1) assert.strictEqual(callsFor(`zz check three ${i}`), 1);
      const rows = await Zz.find({ _id: { $in: vids.map((v) => v.id) } }).lean();
      assert.ok(rows.every((r) => r.status === 'completed' && r.attempts === 1));
      t3 = span(rows, start);
      const claims = cs.reduce((s, x) => s + x.c.stats.claims, 0);
      assert.strictEqual(claims, 3);
      const tl = rows.map((r) => `${new Date(r.startedAt).getTime() - start}->${new Date(r.completedAt).getTime() - start}`).join(' ');
      return `${t3} ms from start to the last completion, split ${cs.map((x) => x.c.stats.claims).join('/')}, claim->done ms: ${tl}`;
    });
    await check('throughput scales with consumers (3 at least 1.4x faster than 1)', async () => {
      assert.ok(t1 > 0 && t3 > 0);
      const ratio = t1 / t3;
      assert.ok(ratio >= 1.4, `ratio ${ratio.toFixed(2)}`);
      return `${ratio.toFixed(2)}x`;
    });

    // 3: a killed consumer's video is resumed after clip 1.
    await check('a killed consumer\'s 3-clip video is resumed: clip 1 not made again, one charge, no refund, late result discarded', async () => {
      const k = killable();
      const dying = consumer('dying', { model: k.model });
      const v = await createVideo('zz check resume', ['Part one.', 'Part two HANG ONCE.', 'Part three.']);
      assert.ok(await until(async () => (hung.some((h) => /Part two/.test(h.prompt)))), 'clip 2 never started');
      const mid = await row(v.id);
      assert.strictEqual(mid.clipUrls.length, 1, 'clip 1 stored before the kill');
      k.kill(); dying.stop();
      const killedAt = Date.now();
      const others = ['r1', 'r2'].map((x) => consumer(x, { sweep: true }));
      assert.ok(await until(done([v.id]), 40000), 'not resumed');
      const r = await row(v.id);
      others.forEach((x) => x.stop());
      assert.strictEqual(r.status, 'completed');
      assert.strictEqual(r.attempts, 2);
      assert.strictEqual(r.clipsDone, 3);
      assert.strictEqual(callsFor('Part one.'), 1, 'clip 1 made again');
      assert.strictEqual(ledger.spends.filter((s) => s.ref === v.id).length, 1);
      assert.strictEqual(ledger.refunds.filter((x) => x.ref === v.id).length, 0);
      // The dead run's provider call returns late: its clip write matches nothing, the video stays as delivered.
      hung.filter((h) => /Part two/.test(h.prompt)).forEach((h) => h.release());
      await sleep(500);
      const after = await row(v.id);
      assert.strictEqual(after.videoUrl, r.videoUrl);
      assert.strictEqual(after.status, 'completed');
      return `resumed ${Math.round((r.updatedAt - killedAt) / 100) / 10} s after the kill`;
    });

    // 4: refunds exact.
    await check('a failed video (clip 1 fails) is refunded its whole price once; a short video the missing clip once', async () => {
      const failed = await createVideo('zz check FAILALL', ['A FAILALL.', 'B FAILALL.']);
      const short = await createVideo('zz check short', ['First.', 'Second.', 'Third FAILTHIS.']);
      const cs = ['f1', 'f2'].map((x) => consumer(x));
      assert.ok(await until(done([failed.id, short.id]), 20000), 'not finished');
      cs.forEach((x) => x.stop());
      const f = await row(failed.id); const s = await row(short.id);
      assert.strictEqual(f.status, 'failed');
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === failed.id).map((x) => x.amount), [2 * COST1]);
      assert.strictEqual(s.status, 'completed');
      assert.strictEqual(s.clipsDone, 2);
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === short.id).map((x) => x.amount), [COST1]);
      assert.strictEqual(f.refundState, 'done');
      assert.strictEqual(s.refundState, 'done');
    });
    await check('a video lost twice (the cap) is failed and refunded exactly once by two sweeps at the same moment', async () => {
      const v = await createVideo('zz check cap HANG', ['One HANG.', 'Two.']);
      for (let i = 0; i < 2; i += 1) {
        const k = killable();
        const c = consumer(`cap${i}`, { model: k.model });
        assert.ok(await until(async () => { const r = await row(v.id); return r && r.status === 'processing' && r.attempts === i + 1; }), `run ${i + 1} not claimed`);
        k.kill(); c.stop();
        if (i === 0) {
          const s = consumer('capsweep', { drain: false });
          assert.ok(await until(async () => { await s.c.sweepLeases(); const r = await row(v.id); return r && r.status === 'queued'; }, 30000, 500), 'not re-queued');
          s.stop();
        }
      }
      await sleep(BASE.leaseMs + BASE.heartbeatMs + 200);
      // Two sweepers at the same moment, repeated (a heartbeat the killed consumer sent just before it died can still land
      // and renew the lease once: the sweep then correctly backs off and the next pass takes it).
      const a = consumer('sa', { drain: false }); const b = consumer('sb', { drain: false });
      let failedBy = 0;
      const closedOk = await until(async () => {
        const [ra, rb] = await Promise.all([a.c.sweepLeases(), b.c.sweepLeases()]);
        failedBy += ra.failed + rb.failed;
        return done([v.id])();
      }, 30000, 500);
      a.stop(); b.stop();
      if (!closedOk) { const x = await row(v.id); throw new Error(`not closed: ${JSON.stringify({ status: x.status, attempts: x.attempts, workerId: x.workerId, leaseUntil: x.leaseUntil, refundState: x.refundState, now: new Date() })}`); }
      const r = await row(v.id);
      assert.strictEqual(r.status, 'failed');
      assert.strictEqual(failedBy, 1, `failed by ${failedBy} sweeps`);
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === v.id).map((x) => x.amount), [2 * COST1]);
      hung.forEach((h) => h.release());
      await sleep(300);
      assert.deepStrictEqual(ledger.refunds.filter((x) => x.ref === v.id).map((x) => x.amount), [2 * COST1], 'late results refund nothing more');
    });
    await check('every refund went to the wallet that paid, never above its charge, and no row is left open', async () => {
      for (const r of ledger.refunds) {
        const sp = ledger.spends.find((s) => s.ref === r.ref);
        assert.ok(sp, `refund without a charge: ${r.ref}`);
        assert.ok(r.amount <= sp.amount);
        assert.strictEqual(String(r.payerId), sp.user);
      }
      const open = await Zz.countDocuments({ $or: [{ status: { $in: ['queued', 'processing'] } }, { refundState: 'refunding' }] });
      assert.strictEqual(open, 0, `${open} rows still open`);
      return `${made} videos, ${ledger.spends.length} charges, ${ledger.refunds.length} refunds`;
    });
  } finally {
    for (const l of loops) { l.timers.forEach(clearInterval); l.c.stopping = true; }
    hung.forEach((h) => h.release());
    await sleep(300);
    delete process.env.ENABLE_STUDIO_VIDEO_CONSUMER;
    console.log('cleanup: dropped', await dropCheckCollection(db));
  }
  const pass = results.filter(Boolean).length;
  const fail = results.length - pass;
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  return fail ? 1 : 0;
}

main()
  .then((code) => mongoose.disconnect().then(() => process.exit(code)))
  .catch(async (e) => { console.error('check aborted:', e && e.message); try { await dropCheckCollection(mongoose.connection.db); } catch (_) { /* best effort */ } await mongoose.disconnect().catch(() => {}); process.exit(2); });
