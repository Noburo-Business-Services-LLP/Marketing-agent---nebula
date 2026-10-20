'use strict';
// D74 item 3: the pipeline's progress callbacks are not awaited. When the queue's progress call throws
// JobCancelledError (job cancelled, lost or handed back) the rejection must not be unhandled (the crash policy would
// exit the worker) and the run must stop BEFORE the next paid step. Fakes only: the paid calls are counters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
const paid = { clips: 0 };
stub('../services/geminiAI', {});
stub('../services/videoService', { generateVideoClip: async () => { paid.clips += 1; throw new Error('stop: the fake provider was called'); }, getKlingDuration: () => 5 });
stub('../services/imageUploader', { uploadVideoFile: async () => ({ success: false }) });
stub('../models/VideoDraft', { findOne: () => ({ lean: async () => null }) });
const pipeline = require('../services/videoGenerationPipeline');
const { createRunGate } = require('../services/runGate');
const { JobCancelledError } = require('../services/jobCancelled');
const { PersistentVideoGenerationQueue } = require('../services/videoGenerationQueue');
const { makeVideoJobModel } = require('./helpers/fakeVideoJobModel');

const tick = (n = 6) => new Promise((resolve) => { let i = 0; const go = () => (++i >= n ? resolve() : setImmediate(go)); setImmediate(go); });
const quiet = async (fn) => { const saved = ['log', 'error', 'warn', 'info'].map((k) => [k, console[k]]); saved.forEach(([k]) => { console[k] = () => {}; }); try { return await fn(); } finally { saved.forEach(([k, f]) => { console[k] = f; }); } };
const watchUnhandled = () => { const seen = []; const h = (e) => seen.push(e); process.on('unhandledRejection', h); return { seen, stop: () => process.off('unhandledRejection', h) }; };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const scene = (i, cached) => ({ sceneId: `s${i}`, index: i, title: `t${i}`, durationSeconds: 5, imageUrl: PNG, imagePrompt: 'p', videoPrompt: 'v', voiceLine: '', onScreenText: '', ...(cached ? { clipCloudUrl: 'https://cdn.example/clip.mp4' } : {}) });
const cleanup = (jobId) => fs.rmSync(path.join(pipeline.STORAGE_ROOT, jobId), { recursive: true, force: true });

test('gate: a rejected progress call is recorded, never unhandled, and check() throws it', async () => {
  const w = watchUnhandled();
  const gate = createRunGate({ onProgress: async () => { throw new JobCancelledError('j1'); }, jobId: 'j1' });
  gate.notify({ progress: 1 });
  await tick();
  assert.equal(gate.stopped, true);
  await assert.rejects(() => gate.check(), (e) => e instanceof JobCancelledError);
  const sync = createRunGate({ onProgress: () => { throw new Error('sync boom'); } });
  sync.notify({});
  await assert.rejects(() => sync.check(), /sync boom/);
  w.stop();
  assert.deepEqual(w.seen, []);
});

test('gate: isCancelled() ends the run too; an isCancelled that throws does not stop paid work', async () => {
  const gate = createRunGate({ isCancelled: async () => true, jobId: 'j2' });
  await assert.rejects(() => gate.check(), (e) => e instanceof JobCancelledError && e.jobId === 'j2');
  const flaky = createRunGate({ isCancelled: async () => { throw new Error('db blip'); } });
  await flaky.check();
  const ok = createRunGate({ onProgress: async () => {}, isCancelled: async () => false });
  ok.notify({});
  await tick();
  await ok.check();
});

test('generateSceneClips with the pipeline\'s wiring: progress is not awaited and rejects with JobCancelledError after scene 2: the next scene makes no paid call and nothing is unhandled', async () => {
  const w = watchUnhandled();
  paid.clips = 0;
  const jobId = `ztest-cancel-${process.pid}-${Date.now()}`;
  let calls = 0;
  try {
    const context = pipeline.createJobContext({ baseUrl: 'https://x.test', providedJobId: jobId });
    // like the real pipeline: onSceneDone reports progress through the gate, returns a promise nobody awaits
    const gate = createRunGate({ onProgress: () => { calls += 1; return calls >= 2 ? Promise.reject(new JobCancelledError('j')) : Promise.resolve(); }, jobId });
    const err = await quiet(() => pipeline.generateSceneClips({
      scenes: [scene(1, true), scene(2, true), scene(3), scene(4)],
      context,
      guard: () => gate.check(),
      onSceneDone: (i, total) => gate.notify({ progress: i, total })
    }).then(() => null, (e) => e));
    await tick(10);
    assert.ok(err instanceof JobCancelledError, `got ${err && err.message}`);
    assert.equal(paid.clips, 0, 'no paid clip call after the cancel');
    assert.deepEqual(w.seen, [], 'no unhandled rejection');
  } finally { w.stop(); cleanup(jobId); }
});

test('control: with progress that succeeds, the paid clip call IS made for the uncached scene', async () => {
  paid.clips = 0;
  const jobId = `ztest-control-${process.pid}-${Date.now()}`;
  try {
    const context = pipeline.createJobContext({ baseUrl: 'https://x.test', providedJobId: jobId });
    const gate = createRunGate({ onProgress: async () => {}, jobId });
    const err = await quiet(() => pipeline.generateSceneClips({
      scenes: [scene(1, true), scene(2, true), scene(3)], context, guard: () => gate.check(), onSceneDone: (i, t) => gate.notify({ i, t })
    }).then(() => null, (e) => e));
    assert.match(String(err && err.message), /fake provider was called/);
    assert.equal(paid.clips, 1);
  } finally { cleanup(jobId); }
});

test('runGenerateVideoClips: the queue\'s isCancelled() stops the run before the first paid call (job lost or handed back)', async () => {
  paid.clips = 0;
  const jobId = `ztest-lost-${process.pid}-${Date.now()}`;
  try {
    const err = await quiet(() => pipeline.runGenerateVideoClips({
      payload: { jobId, sceneData: [scene(1), scene(2)] },
      baseUrl: 'https://x.test',
      onProgress: () => {},
      isCancelled: async () => true
    }).then(() => null, (e) => e));
    assert.ok(err instanceof JobCancelledError);
    assert.equal(paid.clips, 0);
  } finally { cleanup(jobId); }
});

test('queue + handler that calls progress WITHOUT awaiting (like the real pipeline): cancel stops the next paid step, no unhandled rejection, no refund by the worker', async () => {
  const w = watchUnhandled();
  const model = makeVideoJobModel();
  const refunds = [];
  const q = new PersistentVideoGenerationQueue({
    model, draftModel: { updateMany: async () => ({}) }, runsJobsHere: false, workerId: 'w1',
    leaseLock: { withLease: async (n, t, fn) => ({ ran: true, result: await fn({ isLost: () => false }) }) },
    refund: async (...a) => { refunds.push(a); return { success: true }; },
    chargeProof: async () => ({ spend: null, refunded: false }), alertOwner: async () => {}
  });
  const steps = [];
  q.registerHandler('create_video_pipeline', async (payload, controls) => {
    const gate = createRunGate({ onProgress: (p) => controls.update(p), isCancelled: controls.isCancelled, jobId: 'j1' });
    for (const step of ['plan', 'images', 'clips', 'thumbnail']) {
      await gate.check();            // before each paid step
      gate.notify({ progress: 10, currentStep: step }); // NOT awaited
      steps.push(step);
      if (step === 'plan') { await model.updateOne({ jobId: 'j1' }, { $set: { status: 'cancelled' } }); }
      await tick(4);
    }
    return { videoUrl: 'x' };
  });
  await model.create({ jobId: 'j1', userId: 'u1', status: 'processing', workerId: 'w1', attempts: 1, metadata: { jobType: 'create_video_pipeline', quarkCharge: [{ action: 'campaign_full', count: 1, ref: 'r1', payerId: '' }] } });
  await quiet(() => q._runJob(JSON.parse(JSON.stringify(model.docs[0]))));
  await tick(10);
  w.stop();
  assert.deepEqual(steps, ['plan'], 'the step after the cancel never started');
  assert.deepEqual(w.seen, []);
  assert.equal(model.docs[0].status, 'cancelled');
  assert.equal(refunds.length, 0, 'the cancel path owns the refund, not the worker');
});

test('no bare onProgress call is left in the two pipeline entry points (all go through the gate)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/videoGenerationPipeline.js'), 'utf8');
  for (const name of ['runCreateVideoPipeline', 'runGenerateVideoClips']) {
    const start = src.indexOf(`async function ${name}(`);
    const body = src.slice(start, src.indexOf('\nasync function ', start + 10));
    assert.ok(!/\bonProgress\(/.test(body), `${name} calls onProgress directly`);
    assert.match(body, /createRunGate\(/);
  }
});
