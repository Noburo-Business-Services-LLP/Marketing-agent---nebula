const test = require('node:test');
const assert = require('node:assert');
const { startHeroGeneration, pollHeroJob } = require('../services/heroVideoFlow');

// ---- in-memory fake JobModel (create / findOne / findOneAndUpdate / updateOne) ----
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
function matches(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    const v = getPath(doc, k);
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$ne' in cond) return String(v) !== String(cond.$ne) && v !== cond.$ne;
      if ('$in' in cond) return cond.$in.includes(v);
      throw new Error('fake: unsupported operator ' + JSON.stringify(cond));
    }
    return String(v) === String(cond);
  });
}
function makeJobModel() {
  const docs = [];
  return {
    docs,
    async create(data) { const d = JSON.parse(JSON.stringify(data)); docs.push(d); return d; },
    async findOne(filter) { return docs.find((d) => matches(d, filter)) || null; },
    // atomic in-memory: find + mutate in one synchronous step; returns pre-update doc (Mongoose default)
    async findOneAndUpdate(filter, update) {
      const d = docs.find((x) => matches(x, filter));
      if (!d) return null;
      const before = JSON.parse(JSON.stringify(d));
      for (const [k, v] of Object.entries(update.$set || {})) setPath(d, k, v);
      return before;
    },
    async updateOne(filter, update) {
      const d = docs.find((x) => matches(x, filter));
      if (!d) return { matchedCount: 0 };
      for (const [k, v] of Object.entries(update.$set || {})) setPath(d, k, v);
      return { matchedCount: 1 };
    }
  };
}

function makeDeps(over = {}) {
  const JobModel = makeJobModel();
  const calls = { deduct: [], refund: [], submit: [], getStatus: [], copy: [], quota: 0 };
  const deps = {
    JobModel,
    calls,
    quotaFn: async () => { calls.quota++; return { used: 0, limit: 2, resetsOn: 'x' }; },
    deduct: async (...a) => { calls.deduct.push(a); return { success: true }; },
    refund: async (...a) => { calls.refund.push(a); return { success: true }; },
    submit: async (...a) => { calls.submit.push(a); return 'req-1'; },
    getStatus: async (...a) => { calls.getStatus.push(a); return { state: 'processing' }; },
    copyToStorage: async (u) => { calls.copy.push(u); return 'https://cdn.example/' + 'stored.mp4'; },
    now: () => new Date('2026-10-03T00:00:00Z'),
    ...over
  };
  return deps;
}
const body = (o = {}) => ({ prompt: 'a hero shot', ...o });

test('happy path creates processing hero job with falRequestId', async () => {
  const d = makeDeps();
  const r = await startHeroGeneration(d, { userId: 'u1', body: body({ aspectRatio: '16:9' }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.success, true);
  const job = d.JobModel.docs[0];
  assert.strictEqual(r.json.jobId, job.jobId);
  assert.strictEqual(job.status, 'processing');
  assert.strictEqual(job.metadata.kind, 'hero');
  assert.strictEqual(job.metadata.falRequestId, 'req-1');
  assert.strictEqual(job.payload.aspectRatio, '16:9');
  assert.ok(job.payload.model);
  assert.strictEqual(d.calls.deduct.length, 1);
  assert.strictEqual(d.calls.deduct[0][1], 'hero_video_clip');
  assert.strictEqual(d.calls.refund.length, 0);
});

test('quota exhausted: no deduct, no job, 403', async () => {
  const d = makeDeps({ quotaFn: async () => ({ used: 2, limit: 2, resetsOn: 'r' }) });
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.quotaExhausted, true);
  assert.strictEqual(r.json.used, 2);
  assert.strictEqual(r.json.limit, 2);
  assert.strictEqual(d.calls.deduct.length, 0);
  assert.strictEqual(d.JobModel.docs.length, 0);
});

test('credits exhausted: no job, no submit, 403 creditsExhausted', async () => {
  const d = makeDeps({ deduct: async () => ({ success: false, error: 'Insufficient credits' }) });
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.creditsExhausted, true);
  assert.strictEqual(d.JobModel.docs.length, 0);
  assert.strictEqual(d.calls.submit.length, 0);
  assert.strictEqual(d.calls.refund.length, 0);
});

test('submit throws: refund once, job failed, 500', async () => {
  const d = makeDeps({ submit: async () => { throw new Error('fal down'); } });
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(d.calls.refund.length, 1);
  assert.strictEqual(d.JobModel.docs[0].status, 'failed');
  assert.strictEqual(d.JobModel.docs[0].metadata.refunded, true);
});

test('post-create recheck: concurrent overflow cancels newer job, refunds once, 403', async () => {
  let n = 0;
  const d = makeDeps({ quotaFn: async () => { n++; return { used: n === 1 ? 1 : 3, limit: 2, resetsOn: 'r' }; } });
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.quotaExhausted, true);
  assert.strictEqual(d.JobModel.docs[0].status, 'cancelled');
  assert.strictEqual(d.calls.refund.length, 1);
  assert.strictEqual(d.calls.submit.length, 0);
});

test('recheck with used == limit (this job included) is allowed', async () => {
  let n = 0;
  const d = makeDeps({ quotaFn: async () => { n++; return { used: n === 1 ? 1 : 2, limit: 2, resetsOn: 'r' }; } });
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 200);
});

test('bad refs: http and 5 refs -> 400, no deduct', async () => {
  for (const refs of [['http://x.com/a.png'], ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4', 'https://a/5']]) {
    const d = makeDeps();
    const r = await startHeroGeneration(d, { userId: 'u1', body: body({ refImageUrls: refs }) });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(d.calls.deduct.length, 0);
  }
});

test('empty prompt, overlong prompt, bad aspect ratio -> 400, no deduct', async () => {
  for (const b of [{ prompt: '   ' }, {}, { prompt: 'x'.repeat(6001) }, { prompt: 'ok', aspectRatio: '4:3' }, { prompt: 42 }]) {
    const d = makeDeps();
    const r = await startHeroGeneration(d, { userId: 'u1', body: b });
    assert.strictEqual(r.status, 400, JSON.stringify(b).slice(0, 40));
    assert.strictEqual(d.calls.deduct.length, 0);
  }
  const d = makeDeps();
  const ok = await startHeroGeneration(d, { userId: 'u1', body: { prompt: 'x'.repeat(6000) } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(d.JobModel.docs[0].payload.aspectRatio, '9:16');
});

test('job create failure after deduct refunds once, 500', async () => {
  const d = makeDeps();
  d.JobModel.create = async () => { throw new Error('mongo down'); };
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 500);
  assert.strictEqual(d.calls.refund.length, 1);
});

test('prompt text is never logged', async () => {
  const logs = [];
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => logs.push(a.join(' '));
  try {
    const d = makeDeps({ submit: async () => { throw new Error('boom'); } });
    await startHeroGeneration(d, { userId: 'u1', body: body({ prompt: 'SECRET-PROMPT-XYZ' }) });
  } finally { Object.assign(console, orig); }
  assert.ok(!logs.join('\n').includes('SECRET-PROMPT-XYZ'));
});

async function startedJob(over) {
  const d = makeDeps(over);
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  return { d, jobId: r.json.jobId };
}

test('poll completed stores copied url; second poll does not call getStatus', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async (...a) => { d.calls.getStatus.push(a); return { state: 'completed', videoUrl: 'https://fal/v.mp4' }; };
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(r.json.videoUrl, 'https://cdn.example/stored.mp4');
  const job = d.JobModel.docs[0];
  assert.strictEqual(job.result.videoUrl, 'https://cdn.example/stored.mp4');
  assert.strictEqual(job.progress, 100);
  assert.ok(job.completedAt);
  assert.strictEqual(d.calls.getStatus[0][0], job.payload.model);
  assert.strictEqual(d.calls.getStatus[0][1], 'req-1');
  const r2 = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r2.json.videoUrl, 'https://cdn.example/stored.mp4');
  assert.strictEqual(d.calls.getStatus.length, 1);
  assert.strictEqual(d.calls.refund.length, 0);
});

test('poll failed: refund once even when polled twice', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async (...a) => { d.calls.getStatus.push(a); return { state: 'failed', error: 'nsfw' }; };
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(r.json.error, 'nsfw');
  await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(d.calls.refund.length, 1);
  assert.strictEqual(d.calls.getStatus.length, 1);
});

test('concurrent polls on a failed job refund exactly once', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'failed', error: 'x' });
  await Promise.all([1, 2, 3].map(() => pollHeroJob(d, { userId: 'u1', jobId })));
  assert.strictEqual(d.calls.refund.length, 1);
});

test('completed without video url refunds once and fails', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'completed' });
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(d.calls.refund.length, 1);
});

test('getStatus throws: stays processing, no refund, not failed (ruling 4)', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => { throw new Error('ECONNRESET'); };
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.calls.refund.length, 0);
  assert.strictEqual(d.JobModel.docs[0].status, 'processing');
});

test('copyToStorage throws: stays processing, no refund', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'completed', videoUrl: 'https://fal/v.mp4' });
  d.copyToStorage = async () => { throw new Error('cloud down'); };
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.calls.refund.length, 0);
});

test('still queued/processing returns processing', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'queued' });
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.JobModel.docs[0].status, 'processing');
});

test("other user's job and unknown job: 404, no getStatus", async () => {
  const { d, jobId } = await startedJob();
  const r = await pollHeroJob(d, { userId: 'intruder', jobId });
  assert.strictEqual(r.status, 404);
  assert.strictEqual((await pollHeroJob(d, { userId: 'u1', jobId: 'nope' })).status, 404);
  assert.strictEqual(d.calls.getStatus.length, 0);
});

test('non-hero job with same id is 404', async () => {
  const { d, jobId } = await startedJob();
  d.JobModel.docs[0].metadata.kind = 'kling';
  assert.strictEqual((await pollHeroJob(d, { userId: 'u1', jobId })).status, 404);
});

test('refund failure releases the guard so a later poll retries', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'failed', error: 'x' });
  let ok = false;
  d.refund = async (...a) => { d.calls.refund.push(a); if (!ok) throw new Error('db blip'); return { success: true }; };
  await pollHeroJob(d, { userId: 'u1', jobId });
  assert.notStrictEqual(d.JobModel.docs[0].metadata.refunded, true);
  ok = true;
  await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(d.JobModel.docs[0].metadata.refunded, true);
  await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(d.calls.refund.length, 2); // one failed attempt + one success, none after
});

test('module imports without Mongo/FAL_KEY', () => {
  assert.strictEqual(typeof require('../services/heroVideoFlow').defaultDeps, 'function');
});
