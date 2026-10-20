const test = require('node:test');
const assert = require('node:assert');
const { PersistentVideoGenerationQueue, JobCancelledError } = require('../services/videoGenerationQueue');
const { QUARK_COSTS } = require('../config/apiCosts');

// ---- an in-memory VideoJob collection: the calls the queue makes, with atomic conditional updates ----
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k]; }); c[ks[ks.length - 1]] = v; };
const time = (v) => new Date(v).getTime();
function matches(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    const v = getPath(doc, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, a]) => {
        if (op === '$in') return a.includes(v);
        if (op === '$nin') return !a.includes(v);
        if (op === '$ne') return v !== a;
        if (op === '$lt') return v != null && time(v) < time(a);
        throw new Error(`unsupported ${op}`);
      });
    }
    return (v === undefined ? null : v) === (cond === undefined ? null : cond);
  });
}
const clone = (d) => (d == null ? d : JSON.parse(JSON.stringify(d), (k, x) => (typeof x === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(x) ? new Date(x) : x)));
function apply(d, update) {
  Object.entries(update.$set || {}).forEach(([k, v]) => setPath(d, k, clone(v)));
  Object.entries(update.$push || {}).forEach(([k, v]) => { const arr = getPath(d, k) || []; arr.push(...(v.$each || [v])); setPath(d, k, v.$slice ? arr.slice(v.$slice) : arr); });
}
const query = (fn) => { const q = { lean: () => q, limit: () => q, then: (ok, bad) => Promise.resolve().then(fn).then(ok, bad), catch: (bad) => Promise.resolve().then(fn).catch(bad) }; return q; };
function makeModel(clock) {
  const docs = [];
  return {
    docs,
    findOne: (f) => query(() => clone(docs.find((d) => matches(d, f)) || null)),
    find: (f) => query(() => docs.filter((d) => matches(d, f)).map(clone)),
    findOneAndUpdate: (f, u, o = {}) => query(() => { const d = docs.find((x) => matches(x, f)); if (!d) return null; const before = clone(d); apply(d, u); return o.new ? clone(d) : before; }),
    updateOne: async (f, u) => { const d = docs.find((x) => matches(x, f)); if (d) apply(d, u); return { matchedCount: d ? 1 : 0 }; },
    countDocuments: async (f) => docs.filter((x) => matches(x, f)).length,
  };
}

const quiet = async (fn) => { const e = console.error; const l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };

function world({ charges, perScene = false, status = 'processing', jobType = 'generate_content' } = {}) {
  const model = makeModel();
  const calls = { refund: [], handler: 0 };
  const ledger = { spends: new Map(), refunds: new Set() };
  const alerts = [];
  const drafts = [];
  const q = new PersistentVideoGenerationQueue({
    model, draftModel: { updateMany: async (...a) => { drafts.push(a); } },
    refund: async (user, action, count, desc, opts) => { calls.refund.push({ user, action, count, opts }); if (q.refundFails) throw new Error('process died'); if (opts && opts.ref) ledger.refunds.add(opts.ref); return { success: true }; },
    chargeProof: async (ref) => ({ spend: ledger.spends.get(ref) || null, refunded: ledger.refunds.has(ref) }),
    alertOwner: async (a) => { alerts.push(a); },
  });
  const ch = charges === undefined ? [
    { action: 'video_base', count: 1, ref: 'video:v1:base', payerId: 'agency9' },
    { action: 'video_generated', count: 3, ref: 'video:v1:scenes', payerId: 'agency9' }
  ] : charges;
  ch && ch.forEach((c) => ledger.spends.set(c.ref, { payer: c.payerId || 'u1', quarks: QUARK_COSTS[c.action] * c.count }));
  model.docs.push({ jobId: 'j1', userId: 'u1', status, progress: 0, currentStep: 'queued', logs: [], attempts: 1, updatedAt: new Date(), metadata: { jobType, ...(ch ? { quarkCharge: ch } : {}), ...(perScene ? { perSceneCharging: true } : {}) } });
  const job = () => model.docs[0];
  return { q, model, calls, ledger, alerts, drafts, job };
}
const run = (w, handler) => { w.q.registerHandler('generate_content', handler); return w.q._runJob(JSON.parse(JSON.stringify(w.job()))); };

test('cancel: ONE conditional update ends the job and claims the refund; every charge is refunded once, with its ref, to its payer', async () => {
  const w = world();
  const v = await quiet(() => w.q.cancelJob('j1', 'u1'));
  assert.strictEqual(v.status, 'cancelled');
  assert.strictEqual(w.job().refundState, 'refunded');
  assert.strictEqual(w.calls.refund.length, 2);
  assert.deepStrictEqual(w.calls.refund.map((r) => r.opts), [{ ref: 'video:v1:base', payerId: 'agency9' }, { ref: 'video:v1:scenes', payerId: 'agency9' }]);
  assert.deepStrictEqual(w.calls.refund.map((r) => [r.action, r.count]), [['video_base', 1], ['video_generated', 3]]);
  assert.strictEqual(w.drafts.length, 1);
});

test('cancelling twice, or cancelling a finished job, refunds nothing more', async () => {
  const w = world();
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  assert.strictEqual(w.calls.refund.length, 2);
  const done = world({ status: 'completed' });
  await quiet(() => done.q.cancelJob('j1', 'u1'));
  assert.strictEqual(done.calls.refund.length, 0);
  assert.strictEqual(done.job().status, 'completed');
});

test('two cancels at the same moment: exactly one wins and refunds', async () => {
  const w = world();
  await quiet(() => Promise.all([w.q.cancelJob('j1', 'u1'), w.q.cancelJob('j1', 'u1')]));
  assert.strictEqual(w.calls.refund.length, 2, 'two charges, once each');
});

test('cancel then complete: the late result is discarded, the job stays cancelled and nothing is delivered or refunded again', async () => {
  const w = world();
  let release;
  const gate = new Promise((r) => { release = r; });
  const running = quiet(() => run(w, async () => { await gate; return { videoUrl: 'https://cdn/v.mp4' }; }));
  await new Promise((r) => setImmediate(r));
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  release();
  await running;
  assert.strictEqual(w.job().status, 'cancelled');
  assert.strictEqual(w.job().result, undefined, 'no video written onto the cancelled job');
  assert.strictEqual(w.calls.refund.length, 2);
});

test('cancel then failure: the failing worker neither fails the job nor refunds a second time', async () => {
  const w = world();
  let release;
  const gate = new Promise((r) => { release = r; });
  const running = quiet(() => run(w, async () => { await gate; throw new Error('fal exploded'); }));
  await new Promise((r) => setImmediate(r));
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  release();
  await running;
  assert.strictEqual(w.job().status, 'cancelled');
  assert.strictEqual(w.calls.refund.length, 2, 'refunded once, by the cancel');
});

test('failure then cancel: cancel finds a failed job and refunds nothing', async () => {
  const w = world();
  await quiet(() => run(w, async () => { throw new Error('fal exploded'); }));
  assert.strictEqual(w.job().status, 'failed');
  assert.strictEqual(w.calls.refund.length, 2);
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  assert.strictEqual(w.calls.refund.length, 2);
});

test('failure refunds exactly the recorded charges once, to the recorded payer; completion is conditional too', async () => {
  const w = world();
  await quiet(() => run(w, async () => { throw new Error('x'); }));
  assert.strictEqual(w.job().refundState, 'refunded');
  assert.deepStrictEqual(w.calls.refund.map((r) => r.opts.payerId), ['agency9', 'agency9']);
  const ok = world();
  await quiet(() => run(ok, async () => ({ videoUrl: 'u' })));
  assert.strictEqual(ok.job().status, 'completed');
  assert.strictEqual(ok.calls.refund.length, 0);
});

test('the worker stops between steps once the job is cancelled', async () => {
  const w = world();
  const stepsRun = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const running = quiet(() => run(w, async (payload, controls) => {
    for (const scene of [1, 2, 3]) {
      await controls.update({ progress: scene * 20, currentStep: `scene_${scene}` });
      stepsRun.push(scene);
      if (scene === 1) await gate;
    }
    return { videoUrl: 'u' };
  }));
  await new Promise((r) => setImmediate(r));
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  release();
  await running;
  assert.deepStrictEqual(stepsRun, [1], 'scene 2 never started');
  assert.strictEqual(w.job().status, 'cancelled');
  assert.strictEqual(w.calls.refund.length, 2);
  assert.ok(JobCancelledError);
});

test('a job cancelled before a worker takes it is never started, and refunded once', async () => {
  const w = world({ status: 'queued' });
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  assert.strictEqual(w.job().status, 'cancelled');
  assert.strictEqual(await w.model.countDocuments({ status: 'queued' }), 0, 'the drain finds nothing to start');
  assert.strictEqual(w.calls.refund.length, 2);
});

test('crash between claim and pay: the sweep pays what is unpaid once, to the recorded payer; a second sweep changes nothing', async () => {
  const w = world();
  w.q.refundFails = true;
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  assert.strictEqual(w.job().refundState, 'refunding');
  w.q.refundFails = false;
  assert.strictEqual(await quiet(() => w.q.sweepRefunds()), 0, 'inside two minutes nothing is touched');
  w.job().refundAt = new Date(Date.now() - 3 * 60 * 1000);
  const before = w.calls.refund.length;
  assert.strictEqual(await quiet(() => w.q.sweepRefunds()), 1);
  assert.strictEqual(w.job().refundState, 'refunded');
  assert.strictEqual(w.calls.refund.length - before, 2);
  assert.ok(w.calls.refund.slice(before).every((r) => r.opts.payerId === 'agency9'));
  await quiet(() => w.q.sweepRefunds());
  assert.strictEqual(w.calls.refund.length - before, 2);
});

test('a charge that was refunded before the crash is not paid again by the sweep', async () => {
  const w = world();
  w.ledger.refunds.add('video:v1:base');
  w.job().status = 'cancelled';
  w.job().refundState = 'refunding';
  w.job().refundAt = new Date(Date.now() - 3 * 60 * 1000);
  await quiet(() => w.q.sweepRefunds());
  assert.deepStrictEqual(w.calls.refund.map((r) => r.opts.ref), ['video:v1:scenes']);
  assert.strictEqual(w.job().refundState, 'refunded');
});

test('no refund without proof of the charge: nothing is paid, the job is flagged unproven and the owner is alerted', async () => {
  const w = world();
  w.q.refundFails = true;
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  w.ledger.spends.clear();
  w.q.refundFails = false;
  const before = w.calls.refund.length;
  w.job().refundAt = new Date(Date.now() - 3 * 60 * 1000);
  await quiet(() => w.q.sweepRefunds());
  assert.strictEqual(w.calls.refund.length, before);
  assert.strictEqual(w.job().refundState, 'unproven');
  assert.ok(w.alerts.length >= 1);
});

test('never more than the proven spend', async () => {
  const w = world();
  w.q.refundFails = true;
  await quiet(() => w.q.cancelJob('j1', 'u1'));
  w.ledger.spends.set('video:v1:scenes', { payer: 'agency9', quarks: 1 });
  w.q.refundFails = false;
  w.job().refundAt = new Date(Date.now() - 3 * 60 * 1000);
  w.ledger.refunds.add('video:v1:base');
  const before = w.calls.refund.length;
  await quiet(() => w.q.sweepRefunds());
  assert.strictEqual(w.calls.refund.length, before);
  assert.strictEqual(w.job().refundState, 'unproven');
});

test('a per-scene job (charged scene by scene) cancels with no refund claim; a job with no charge record keeps the one legacy refund', async () => {
  const per = world({ charges: null, perScene: true });
  await quiet(() => per.q.cancelJob('j1', 'u1'));
  assert.strictEqual(per.job().status, 'cancelled');
  assert.strictEqual(per.calls.refund.length, 0);
  assert.strictEqual(per.job().refundState, undefined);
  const legacy = world({ charges: null });
  await quiet(() => legacy.q.cancelJob('j1', 'u1'));
  assert.deepStrictEqual(legacy.calls.refund.map((r) => [r.action, r.count, r.opts.ref]), [['campaign_full', 1, 'j1:legacy']]);
});

test('stale recovery and a late failure never both refund; recovery leaves a job that moved on', async () => {
  const w = world();
  w.job().updatedAt = new Date(Date.now() - 60 * 60 * 1000);
  await quiet(() => w.q.recoverStaleJobs());
  assert.strictEqual(w.job().status, 'failed');
  assert.strictEqual(w.calls.refund.length, 2);
  // the hung worker finally throws: the job is no longer processing, so nothing is refunded again
  await quiet(() => run(w, async () => { throw new Error('late'); }));
  assert.strictEqual(w.calls.refund.length, 2);
  const live = world();
  live.job().updatedAt = new Date(Date.now() - 60 * 60 * 1000);
  const staleList = JSON.parse(JSON.stringify(live.job()));
  live.job().updatedAt = new Date(); // it reported in between the scan and the write
  const won = await live.q._failIfProcessing(staleList, { currentStep: 's', error: { message: 'm' }, log: 'l', extraFilter: { updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } } });
  assert.strictEqual(won, null);
  assert.strictEqual(live.job().status, 'processing');
});
