'use strict';
// D74 item 2: POST /video-generation/generateClips (async). The duplicate guard comes BEFORE the charge, the charge
// carries a ref, and the job records exactly that charge, so a failure refunds N x 46 once to the payer. Fakes only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PersistentVideoGenerationQueue } = require('../services/videoGenerationQueue');
const { makeVideoJobModel } = require('./helpers/fakeVideoJobModel');
const { QUARK_COSTS } = require('../config/apiCosts');

const geminiPath = require.resolve('../services/geminiAI');
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: {} };
const router = require('../routes/videoGeneration');

const handler = () => {
  const layer = router.stack.find((l) => l.route && l.route.path === '/generateClips' && l.route.methods.post);
  assert.ok(layer);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const quiet = async (fn) => { const saved = ['log', 'error', 'warn', 'info'].map((k) => [k, console[k]]); saved.forEach(([k]) => { console[k] = () => {}; }); try { return await fn(); } finally { saved.forEach(([k, f]) => { console[k] = f; }); } };

function setup() {
  const model = makeVideoJobModel();
  const ledger = { spends: new Map(), refunds: [] };
  const calls = { deduct: [], routeRefunds: [] };
  const draft = { jobId: 'd1', images: { sceneData: [{ imageUrl: 'https://cdn/1.png' }, { imageUrl: 'https://cdn/2.png' }, { imageUrl: 'https://cdn/3.png' }] }, input: { durationSeconds: 15 }, jobs: {} };
  const q = new PersistentVideoGenerationQueue({
    model, draftModel: { updateMany: async () => ({}) }, runsJobsHere: false, workerId: 'w1',
    leaseLock: { withLease: async (n, t, fn) => ({ ran: true, result: await fn({ isLost: () => false }) }) },
    refund: async (user, action, count, desc, opts) => { ledger.refunds.push({ user, action, count, ref: opts && opts.ref, payerId: opts && opts.payerId }); return { success: true }; },
    chargeProof: async (ref) => ({ spend: ledger.spends.get(ref) || null, refunded: ledger.refunds.some((r) => r.ref === ref) }),
    alertOwner: async () => {}
  });
  q.registerHandler('generate_clips', async () => { throw new Error('kling down'); });
  router.testDeps = {
    loadDraftForUser: async () => draft,
    updateDraft: async (id, uid, fn) => { Object.assign(draft, fn(draft)); return draft; },
    deductCredits: async (userId, action, count, desc, opts) => {
      calls.deduct.push({ userId, action, count, ref: opts && opts.ref });
      ledger.spends.set(opts.ref, { payer: 'agency9', quarks: QUARK_COSTS[action] * count });
      return { success: true, payerId: 'agency9' };
    },
    refundCredits: async (...a) => { calls.routeRefunds.push(a); return { success: true }; },
    videoGenerationQueue: { getJob: (id, uid) => q.getJob(id, uid), enqueue: (j) => q.enqueue(j) }
  };
  return { model, ledger, calls, q, draft };
}
const req = () => ({ user: { _id: 'u1' }, body: { jobId: 'd1', async: true }, query: {}, protocol: 'https', headers: {}, get: () => 'x.test' });

test('a failing clips job refunds N x the clip price once, to the payer, with the ref it was charged under', async () => {
  const { model, ledger, calls, q } = setup();
  const res = mkRes();
  await quiet(() => handler()(req(), res));
  assert.equal(res.code, 202, JSON.stringify(res.body));
  assert.equal(calls.deduct.length, 1);
  assert.match(calls.deduct[0].ref, /^clips:/);
  assert.deepEqual(model.docs[0].metadata.quarkCharge, [{ action: 'video_scene_clip', count: 3, ref: calls.deduct[0].ref, payerId: 'agency9' }]);
  // the worker runs it and it fails
  model.docs[0].status = 'processing'; model.docs[0].workerId = 'w1'; model.docs[0].attempts = 1;
  await quiet(() => q._runJob(JSON.parse(JSON.stringify(model.docs[0]))));
  assert.equal(model.docs[0].status, 'failed');
  assert.deepEqual(ledger.refunds.map((r) => [r.user, r.action, r.count, r.ref, r.payerId]), [['u1', 'video_scene_clip', 3, calls.deduct[0].ref, 'agency9']]);
  assert.equal(ledger.refunds[0].count * QUARK_COSTS.video_scene_clip, 3 * 46);
  await quiet(() => q.sweepRefunds());
  assert.equal(ledger.refunds.length, 1, 'once');
  assert.equal(calls.routeRefunds.length, 0, 'the route itself refunds nothing once the job holds the charge');
  router.testDeps = undefined;
});

test('a repeat click while the job is queued or running returns that job and does not charge again', async () => {
  const { model, calls } = setup();
  const first = mkRes();
  await quiet(() => handler()(req(), first));
  const second = mkRes();
  await quiet(() => handler()(req(), second));
  assert.equal(second.code, 202);
  assert.equal(second.body.queueJobId, first.body.queueJobId);
  assert.equal(second.body.alreadyRunning, true);
  assert.equal(calls.deduct.length, 1, 'charged once');
  assert.equal(model.docs.length, 1, 'one job');
  // once that job has ended, a new click is a new, charged job
  model.docs[0].status = 'failed';
  const third = mkRes();
  await quiet(() => handler()(req(), third));
  assert.equal(calls.deduct.length, 2);
  assert.equal(model.docs.length, 2);
  router.testDeps = undefined;
});
