const test = require('node:test');
const assert = require('node:assert');
const { startHeroGeneration, pollHeroJob, HERO_MAX_AGE_MS, HERO_HARD_MAX_AGE_MS, COPY_LEASE_MS } = require('../services/heroVideoFlow');

const { makeDeps } = require('./heroFakes');

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
  for (const id of ['older1', 'older2']) {
    await d.JobModel.create({ jobId: id, userId: 'u1', status: 'processing', createdAt: new Date('2026-10-01T00:00:00Z'), metadata: { kind: 'hero', refunded: false } });
  }
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.json.quotaExhausted, true);
  assert.strictEqual(d.JobModel.docs[2].status, 'cancelled');
  assert.strictEqual(d.JobModel.docs[0].status, 'processing');
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

// ---- stale orphan handling ----
async function orphan(createdAtMs, nowMs, extra = {}) {
  const d = makeDeps({ now: () => new Date(nowMs) });
  await d.JobModel.create({
    jobId: 'orph', userId: 'u1', status: 'queued', createdAt: new Date(createdAtMs),
    payload: { model: 'm' }, metadata: { kind: 'hero', refunded: false, ...extra }
  });
  return d;
}
const T0 = Date.parse('2026-10-03T00:00:00Z');

test('stale unsubmitted orphan: failed, one refund, second poll no extra refund', async () => {
  const d = await orphan(T0, T0 + 11 * 60 * 1000);
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(r.json.status, 'failed');
  assert.ok(r.json.error);
  await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(d.calls.refund.length, 1);
  assert.strictEqual(d.calls.getStatus.length, 0);
  assert.strictEqual(d.JobModel.docs[0].status, 'failed');
});

test('fresh unsubmitted orphan stays processing, no refund', async () => {
  const d = await orphan(T0, T0 + 9 * 60 * 1000);
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.calls.refund.length, 0);
});

test('job with falRequestId is never an unsubmitted orphan (30 min old, under max age)', async () => {
  const d = await orphan(T0, T0 + 30 * 60 * 1000, { falRequestId: 'req-9' });
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.calls.refund.length, 0);
  assert.strictEqual(d.calls.getStatus.length, 1);
});

// ---- deterministic oldest-wins recheck ----
async function raceSetup(createdA, createdB, idA = 'job-a', idB = 'job-b') {
  // two requests each created a job (limit 2, one pre-existing completed job -> used 3 > 2)
  const d = makeDeps();
  const seed = (jobId, createdAt) => d.JobModel.create({
    jobId, userId: 'u1', status: 'queued', createdAt, payload: {}, metadata: { kind: 'hero', refunded: false }
  });
  await seed('old', new Date('2026-10-01T00:00:00Z'));
  await seed(idA, createdA);
  await seed(idB, createdB);
  return d;
}

test('race: both see overflow, exactly one (the newer) is cancelled+refunded, other submits', async () => {
  const outcomes = [];
  for (const mine of ['job-a', 'job-b']) {
    const d = await raceSetup(new Date('2026-10-02T00:00:00Z'), new Date('2026-10-02T00:00:01Z'));
    // simulate: this request's own job is `mine`; start() creates a fresh job, so pre-seed
    // by making create return the seeded doc id via randomUUID stub.
    const crypto = require('crypto');
    const orig = crypto.randomUUID;
    crypto.randomUUID = () => mine;
    d.JobModel.docs = d.JobModel.docs.filter((x) => x.jobId !== mine);
    d.JobModel.create = (function (c) { return async (data) => c(data); })(d.JobModel.create);
    let first = true;
    d.quotaFn = async () => { if (first) { first = false; return { used: 1, limit: 2, resetsOn: 'r' }; } return { used: 3, limit: 2, resetsOn: 'r' }; };
    try {
      // use the real create so doc exists with createdAt = deps.now(); set now to the seeded time
      d.now = () => new Date(mine === 'job-a' ? '2026-10-02T00:00:00Z' : '2026-10-02T00:00:01Z');
      const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
      outcomes.push({ mine, status: r.status, refunds: d.calls.refund.length, submits: d.calls.submit.length });
    } finally { crypto.randomUUID = orig; }
  }
  const a = outcomes.find((o) => o.mine === 'job-a');
  const b = outcomes.find((o) => o.mine === 'job-b');
  assert.strictEqual(a.status, 200); assert.strictEqual(a.submits, 1); assert.strictEqual(a.refunds, 0);
  assert.strictEqual(b.status, 403); assert.strictEqual(b.submits, 0); assert.strictEqual(b.refunds, 1);
});

test('race tie on createdAt broken by jobId ascending', async () => {
  const same = '2026-10-02T00:00:00Z';
  const res = {};
  for (const mine of ['job-a', 'job-b']) {
    const d = await raceSetup(new Date(same), new Date(same));
    d.JobModel.docs = d.JobModel.docs.filter((x) => x.jobId !== mine);
    const crypto = require('crypto');
    const orig = crypto.randomUUID;
    crypto.randomUUID = () => mine;
    let first = true;
    d.quotaFn = async () => { if (first) { first = false; return { used: 1, limit: 2 }; } return { used: 3, limit: 2 }; };
    d.now = () => new Date(same);
    try { res[mine] = (await startHeroGeneration(d, { userId: 'u1', body: body() })).status; } finally { crypto.randomUUID = orig; }
  }
  assert.deepStrictEqual(res, { 'job-a': 200, 'job-b': 403 });
});

// ---- I3: missing FAL_KEY is caught before any charge ----
test('no FAL_KEY: 500 friendly message, no quota/deduct/create/submit', async () => {
  const d = makeDeps({ hasFalKey: () => false });
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 500);
  assert.deepStrictEqual(r.json, { success: false, message: 'Hero video is not available right now.' });
  assert.strictEqual(d.calls.quota, 0);
  assert.strictEqual(d.calls.deduct.length, 0);
  assert.strictEqual(d.calls.submit.length, 0);
  assert.strictEqual(d.JobModel.docs.length, 0);
});

test('hasFalKey dep absent defaults to available', async () => {
  const d = makeDeps();
  delete d.hasFalKey;
  const r = await startHeroGeneration(d, { userId: 'u1', body: body() });
  assert.strictEqual(r.status, 200);
});

test('defaultDeps().hasFalKey reflects FAL_KEY', () => {
  const saved = process.env.FAL_KEY;
  try {
    const { defaultDeps } = require('../services/heroVideoFlow');
    process.env.FAL_KEY = '   ';
    assert.strictEqual(defaultDeps().hasFalKey(), false);
    process.env.FAL_KEY = 'k';
    assert.strictEqual(defaultDeps().hasFalKey(), true);
  } finally {
    if (saved === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = saved;
  }
});

// ---- I2: a transient result-fetch error through the real status mapper keeps the job processing ----
test('getStatus rejecting (fal 503 on result) keeps job processing, no refund', async () => {
  const hero = require('../services/heroVideoService');
  const fal = { queue: {
    status: async () => ({ status: 'COMPLETED' }),
    result: async () => { throw Object.assign(new Error('upstream'), { status: 503 }); }
  } };
  const { d, jobId } = await startedJob({ getStatus: (m, r) => hero.getHeroClipStatus(m, r, fal) });
  const origErr = console.error; console.error = () => {};
  let r;
  try { r = await pollHeroJob(d, { userId: 'u1', jobId }); } finally { console.error = origErr; }
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.JobModel.docs[0].status, 'processing');
  assert.strictEqual(d.calls.refund.length, 0);
});

// ---- C2(b): max job age ----
test('HERO_MAX_AGE_MS is 60 minutes', () => {
  assert.strictEqual(HERO_MAX_AGE_MS, 60 * 60 * 1000);
});

test('submitted job older than max age: failed, refunded once, later polls do not refund again', async () => {
  const d = await orphan(T0, T0 + HERO_MAX_AGE_MS + 1000, { falRequestId: 'req-9' });
  d.JobModel.docs[0].status = 'processing';
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(r.json.status, 'failed');
  assert.ok(r.json.error);
  assert.strictEqual(d.JobModel.docs[0].status, 'failed');
  await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(d.calls.refund.length, 1);
  // fal is now asked once (on the first poll) before age-failing; terminal polls do not ask again.
  assert.strictEqual(d.calls.getStatus.length, 1);
});

test('job just under max age is untouched', async () => {
  const d = await orphan(T0, T0 + HERO_MAX_AGE_MS - 1000, { falRequestId: 'req-9' });
  d.JobModel.docs[0].status = 'processing';
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.JobModel.docs[0].status, 'processing');
  assert.strictEqual(d.calls.refund.length, 0);
  assert.strictEqual(d.calls.getStatus.length, 1);
});

// ---- max-age: ask fal before giving up ----
const MAXAGE_MSG = 'This video took too long to finish, so we stopped it.';
const OLD = HERO_MAX_AGE_MS + 5 * 60 * 1000; // 65 min
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

test('HERO_HARD_MAX_AGE_MS is 24 hours', () => {
  assert.strictEqual(HERO_HARD_MAX_AGE_MS, 24 * 60 * 60 * 1000);
});

test('old job (>60min) that fal finished is delivered, not refunded', async () => {
  const d = await orphan(T0, T0 + OLD, { falRequestId: 'req-9' });
  d.getStatus = async (...a) => { d.calls.getStatus.push(a); return { state: 'completed', videoUrl: 'https://fal/x.mp4' }; };
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(r.json.videoUrl, 'https://cdn.example/stored.mp4');
  assert.strictEqual(d.JobModel.docs[0].status, 'completed');
  assert.strictEqual(d.JobModel.docs[0].result.videoUrl, 'https://cdn.example/stored.mp4');
  assert.strictEqual(d.calls.refund.length, 0);
  assert.strictEqual(d.calls.copy.length, 1);
});

test('old job where fal reports failed: failed, one refund, second poll no second refund', async () => {
  const d = await orphan(T0, T0 + OLD, { falRequestId: 'req-9' });
  d.getStatus = async (...a) => { d.calls.getStatus.push(a); return { state: 'failed', error: 'bad prompt' }; };
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(d.JobModel.docs[0].status, 'failed');
  await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(d.calls.refund.length, 1);
});

test('old job fal still processing: age-failed with max-age message, one refund', async () => {
  const d = await orphan(T0, T0 + OLD, { falRequestId: 'req-9' });
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(d.calls.getStatus.length, 1);
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(r.json.error, MAXAGE_MSG);
  assert.strictEqual(d.JobModel.docs[0].status, 'failed');
  assert.strictEqual(d.JobModel.docs[0].error.message, MAXAGE_MSG);
  await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(d.calls.refund.length, 1);
});

test('old job (between 60min and 24h) getStatus throws: stays processing, no refund', async () => {
  const d = await orphan(T0, T0 + OLD, { falRequestId: 'req-9' });
  d.getStatus = async () => { throw new Error('fal 503'); };
  const r = await quiet(() => pollHeroJob(d, { userId: 'u1', jobId: 'orph' }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.JobModel.docs[0].status, 'queued');
  assert.strictEqual(d.calls.refund.length, 0);
});

test('job older than hard cap and getStatus throws: age-failed, one refund', async () => {
  const d = await orphan(T0, T0 + HERO_HARD_MAX_AGE_MS + 1000, { falRequestId: 'req-9' });
  d.getStatus = async () => { throw new Error('fal 503'); };
  const r = await quiet(() => pollHeroJob(d, { userId: 'u1', jobId: 'orph' }));
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(r.json.error, MAXAGE_MSG);
  assert.strictEqual(d.JobModel.docs[0].status, 'failed');
  await quiet(() => pollHeroJob(d, { userId: 'u1', jobId: 'orph' }));
  assert.strictEqual(d.calls.refund.length, 1);
});

test('old job WITHOUT falRequestId: failed, one refund, getStatus never called', async () => {
  const d = await orphan(T0, T0 + OLD);
  const r = await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(r.json.status, 'failed');
  assert.strictEqual(r.json.error, MAXAGE_MSG);
  await pollHeroJob(d, { userId: 'u1', jobId: 'orph' });
  assert.strictEqual(d.calls.refund.length, 1);
  assert.strictEqual(d.calls.getStatus.length, 0);
});

// ---- I1: copy lease ----
test('COPY_LEASE_MS is 5 minutes', () => {
  assert.strictEqual(COPY_LEASE_MS, 5 * 60 * 1000);
});

test('two concurrent polls on a completed-on-fal job copy exactly once', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'completed', videoUrl: 'https://fal/v.mp4' });
  d.copyToStorage = async (u) => { d.calls.copy.push(u); await new Promise((ok) => setTimeout(ok, 20)); return 'https://cdn.example/stored.mp4'; };
  const rs = await Promise.all([1, 2, 3].map(() => pollHeroJob(d, { userId: 'u1', jobId })));
  assert.strictEqual(d.calls.copy.length, 1);
  const statuses = rs.map((r) => r.json.status).sort();
  assert.deepStrictEqual(statuses, ['completed', 'processing', 'processing']);
  for (const r of rs.filter((x) => x.json.status === 'processing')) assert.deepStrictEqual(r, { status: 200, json: { success: true, status: 'processing' } });
  assert.strictEqual(d.JobModel.docs[0].status, 'completed');
  assert.strictEqual(d.JobModel.docs[0].result.videoUrl, 'https://cdn.example/stored.mp4');
});

test('an active (unexpired) copy lease blocks another copy', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'completed', videoUrl: 'https://fal/v.mp4' });
  d.JobModel.docs[0].metadata.copyingAt = new Date(d.now().getTime() - 60 * 1000).toISOString();
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'processing');
  assert.strictEqual(d.calls.copy.length, 0);
});

test('an expired copy lease can be re-claimed', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'completed', videoUrl: 'https://fal/v.mp4' });
  d.JobModel.docs[0].metadata.copyingAt = new Date(d.now().getTime() - COPY_LEASE_MS - 1000).toISOString();
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(d.calls.copy.length, 1);
});

test('a thrown copy releases the lease so the next poll retries and completes', async () => {
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'completed', videoUrl: 'https://fal/v.mp4' });
  let fail = true;
  d.copyToStorage = async (u) => { d.calls.copy.push(u); if (fail) throw new Error('disk full'); return 'https://cdn.example/stored.mp4'; };
  const origErr = console.error; console.error = () => {};
  try {
    const r1 = await pollHeroJob(d, { userId: 'u1', jobId });
    assert.strictEqual(r1.json.status, 'processing');
    assert.strictEqual(d.JobModel.docs[0].metadata.copyingAt, undefined);
    fail = false;
    const r2 = await pollHeroJob(d, { userId: 'u1', jobId });
    assert.strictEqual(r2.json.status, 'completed');
  } finally { console.error = origErr; }
  assert.strictEqual(d.calls.copy.length, 2);
  assert.strictEqual(d.calls.refund.length, 0);
});

test('copy falling back to the remote URL still completes the job', async () => {
  const hero = require('../services/heroVideoService');
  const { d, jobId } = await startedJob();
  d.getStatus = async () => ({ state: 'completed', videoUrl: 'https://fal/v.mp4' });
  d.copyToStorage = (u) => hero.copyClipToStorage(u, { download: async () => { throw new Error('nope'); } });
  const origErr = console.error; console.error = () => {};
  let r;
  try { r = await pollHeroJob(d, { userId: 'u1', jobId }); } finally { console.error = origErr; }
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(r.json.videoUrl, 'https://fal/v.mp4');
});

test('module imports without Mongo/FAL_KEY', () => {
  assert.strictEqual(typeof require('../services/heroVideoFlow').defaultDeps, 'function');
});

// ---- Task 3: confirmed references ----
const refUrls = (n) => Array.from({ length: n }, (_, i) => `https://cdn.example.com/ref-${i + 1}.png`);

test('9 valid references: reference model, 9 urls submitted, payload.references stored', async () => {
  const urls = refUrls(9);
  const references = urls.map((url, i) => ({ tag: `@image${i + 1}`, kind: 'logo', label: `Ref ${i + 1}`, url }));
  const d = makeDeps();
  const r = await startHeroGeneration(d, { userId: 'u1', body: body({ refImageUrls: urls, references }) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(d.calls.submit.length, 1);
  const arg = d.calls.submit[0][0];
  assert.deepStrictEqual(arg.input.image_urls, urls);
  assert.ok(/reference/.test(arg.model));
  const job = d.JobModel.docs[0];
  assert.deepStrictEqual(job.payload.refImageUrls, urls);
  assert.deepStrictEqual(job.payload.references, references);
});

test('10 refs, http, loopback, private and non-string refs -> 400, no deduct, no job', async () => {
  const cases = [
    refUrls(10),
    ['http://cdn.example.com/a.png'],
    ['https://localhost/a.png'],
    ['https://127.0.0.1/a.png'],
    ['https://192.168.1.5/a.png'],
    ['https://cdn.example.com/logo.svg'],
    ['https://cdn.example.com/a.GIF?v=1'],
    [42],
    'https://cdn.example.com/a.png'
  ];
  for (const refs of cases) {
    const d = makeDeps();
    const r = await startHeroGeneration(d, { userId: 'u1', body: body({ refImageUrls: refs }) });
    assert.strictEqual(r.status, 400, JSON.stringify(refs));
    assert.strictEqual(typeof r.json.message, 'string');
    assert.strictEqual(d.calls.deduct.length, 0);
    assert.strictEqual(d.JobModel.docs.length, 0);
  }
});

test('duplicate reference urls collapse; metadata filtered to validated set, capped and deduped', async () => {
  const a = 'https://cdn.example.com/a.png';
  const b = 'https://cdn.example.com/b.png';
  const d = makeDeps();
  const r = await startHeroGeneration(d, {
    userId: 'u1',
    body: body({
      refImageUrls: [a, b, a, ` ${b} `],
      references: [
        { tag: 'T'.repeat(40), kind: 'k'.repeat(40), label: 'l'.repeat(200), url: a },
        { tag: '@x', kind: 'logo', label: 'not validated', url: 'https://cdn.example.com/other.png' },
        { tag: '@dup', kind: 'logo', label: 'dup', url: a },
        'junk',
        { tag: 5, kind: null, label: undefined, url: b }
      ]
    })
  });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(d.calls.submit[0][0].input.image_urls, [a, b]);
  const refs = d.JobModel.docs[0].payload.references;
  assert.strictEqual(refs.length, 2);
  assert.deepStrictEqual(refs[0], { tag: 'T'.repeat(12), kind: 'k'.repeat(16), label: 'l'.repeat(80), url: a });
  assert.deepStrictEqual(refs[1], { tag: '', kind: '', label: '', url: b });
});

test('no references: text-to-video, empty payload.references', async () => {
  const d = makeDeps();
  const r = await startHeroGeneration(d, { userId: 'u1', body: body({ references: [{ tag: 'a', kind: 'b', label: 'c', url: 'https://cdn.example.com/a.png' }] }) });
  assert.strictEqual(r.status, 200);
  const arg = d.calls.submit[0][0];
  assert.strictEqual(arg.input.image_urls, undefined);
  assert.ok(/text-to-video/.test(arg.model));
  assert.deepStrictEqual(d.JobModel.docs[0].payload.references, []);
  assert.deepStrictEqual(d.JobModel.docs[0].payload.refImageUrls, []);
});

test('non-array references metadata is ignored, never a 400', async () => {
  const d = makeDeps();
  const r = await startHeroGeneration(d, { userId: 'u1', body: body({ references: 'nope' }) });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(d.JobModel.docs[0].payload.references, []);
});

// ---- Task 6: finish options, finalizeClip, raw-clip fallback ----
const fsp = require('fs').promises;
const os = require('os');
const pathMod = require('path');

const doneStatus = (d) => { d.getStatus = async () => ({ state: 'completed', videoUrl: 'https://fal/v.mp4' }); };
const FINISHED = { videoUrl: 'https://cdn.example/finished.mp4', rawVideoUrl: 'https://cdn.example/raw.mp4' };

test('start stores normalized finish options; bad input falls back to defaults and never throws', async () => {
  for (const bad of [undefined, null, 'x', 42, [], { endCard: 'no', unknown: 1 }]) {
    const d = makeDeps();
    const r = await startHeroGeneration(d, { userId: 'u1', body: body({ finish: bad }) });
    assert.strictEqual(r.status, 200, JSON.stringify(bad));
    const f = d.JobModel.docs[0].payload.finish;
    assert.strictEqual(f.fades, true);
    assert.strictEqual(f.captions, false);
    assert.strictEqual(f.endCard.enabled, true);
  }
  const d = makeDeps();
  await startHeroGeneration(d, { userId: 'u1', body: body({ finish: { captions: true, endCard: { ctaText: 'Buy now', website: 'https://example.com' } } }) });
  const f = d.JobModel.docs[0].payload.finish;
  assert.strictEqual(f.captions, true);
  assert.strictEqual(f.endCard.ctaText, 'Buy now');
});

test('start stores beatSheet and dialogue only when supplied, capped', async () => {
  const d0 = makeDeps();
  await startHeroGeneration(d0, { userId: 'u1', body: body() });
  assert.ok(!('beatSheet' in d0.JobModel.docs[0].payload));
  assert.ok(!('dialogue' in d0.JobModel.docs[0].payload));
  const d = makeDeps();
  const beatSheet = Array.from({ length: 40 }, (_, i) => ({ time: '0-2s', beat: 'b'.repeat(900) + i, emotion: 'calm', junk: 'x' }));
  await startHeroGeneration(d, { userId: 'u1', body: body({ beatSheet, dialogue: '"Hi" '.repeat(1000) }) });
  const p = d.JobModel.docs[0].payload;
  assert.ok(p.beatSheet.length > 0 && p.beatSheet.length <= 12);
  assert.ok(p.beatSheet.every((b) => b.beat.length <= 200 && !('junk' in b)));
  assert.ok(p.dialogue.length <= 2000);
  const d2 = makeDeps();
  await startHeroGeneration(d2, { userId: 'u1', body: body({ beatSheet: 'nope', dialogue: 7 }) });
  assert.ok(!('beatSheet' in d2.JobModel.docs[0].payload) && !('dialogue' in d2.JobModel.docs[0].payload));
});

test('completion with finalizeClip sets finished videoUrl and rawVideoUrl; copyToStorage not used', async () => {
  const calls = [];
  const { d, jobId } = await startedJob({ finalizeClip: async (a) => { calls.push(a); return { ...FINISHED }; } });
  doneStatus(d);
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(r.json.videoUrl, FINISHED.videoUrl);
  assert.strictEqual(r.json.rawVideoUrl, FINISHED.rawVideoUrl);
  assert.ok(!('finishError' in r.json));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].remoteUrl, 'https://fal/v.mp4');
  assert.strictEqual(calls[0].job.userId, 'u1');
  assert.ok(calls[0].job.payload.finish);
  assert.strictEqual(d.calls.copy.length, 0);
  const job = d.JobModel.docs[0];
  assert.deepStrictEqual(job.result, { videoUrl: FINISHED.videoUrl, rawVideoUrl: FINISHED.rawVideoUrl });
  const r2 = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r2.json.rawVideoUrl, FINISHED.rawVideoUrl);
});

test('finalizeClip may report finishError: job completes with raw clip and the message', async () => {
  const { d, jobId } = await startedJob({ finalizeClip: async () => ({ videoUrl: 'https://cdn.example/raw.mp4', rawVideoUrl: 'https://cdn.example/raw.mp4', finishError: 'Plain message.' }) });
  doneStatus(d);
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(r.json.finishError, 'Plain message.');
  assert.strictEqual(d.JobModel.docs[0].result.finishError, 'Plain message.');
  assert.strictEqual(d.calls.refund.length, 0);
});

test('finalizeClip rejecting: completed with raw copy, finishError set (plain, no vendor names), no refund', async () => {
  const { d, jobId } = await startedJob({ finalizeClip: async () => { throw new Error('ffmpeg exploded via fal Cloudinary canvas'); } });
  doneStatus(d);
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(r.json.videoUrl, 'https://cdn.example/stored.mp4');
  assert.strictEqual(r.json.rawVideoUrl, 'https://cdn.example/stored.mp4');
  assert.ok(r.json.finishError && r.json.finishError.length > 10);
  assert.ok(!/ffmpeg|fal|cloudinary|canvas/i.test(r.json.finishError));
  assert.deepStrictEqual(d.calls.copy, ['https://fal/v.mp4']);
  assert.strictEqual(d.calls.refund.length, 0);
  assert.strictEqual(d.JobModel.docs[0].status, 'completed');
});

test('finalizeClip that never resolves within the injected cap: raw fallback, poll does not hang', async () => {
  const { d, jobId } = await startedJob({ finishCapMs: 25, finalizeClip: () => new Promise(() => {}) });
  doneStatus(d);
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'completed');
  assert.strictEqual(r.json.videoUrl, 'https://cdn.example/stored.mp4');
  assert.ok(r.json.finishError);
  assert.strictEqual(d.calls.refund.length, 0);
});

test('fallback copy also failing keeps the job processing and releases the lease', async () => {
  const { d, jobId } = await startedJob({ finalizeClip: async () => { throw new Error('x'); }, copyToStorage: async () => { throw new Error('storage down'); } });
  doneStatus(d);
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.status, 'processing');
  assert.ok(!d.JobModel.docs[0].metadata.copyingAt);
  assert.strictEqual(d.calls.refund.length, 0);
});

test('two concurrent polls at completion call finalizeClip exactly once', async () => {
  let n = 0;
  const { d, jobId } = await startedJob({ finalizeClip: async () => { n++; await new Promise((r) => setTimeout(r, 20)); return { ...FINISHED }; } });
  doneStatus(d);
  const [a, b] = await Promise.all([pollHeroJob(d, { userId: 'u1', jobId }), pollHeroJob(d, { userId: 'u1', jobId })]);
  assert.strictEqual(n, 1);
  assert.deepStrictEqual([a.json.status, b.json.status].sort(), ['completed', 'processing']);
});

test('a job without payload.finish completes through copyToStorage, finalizeClip untouched', async () => {
  let n = 0;
  const { d, jobId } = await startedJob({ finalizeClip: async () => { n++; return { ...FINISHED }; } });
  delete d.JobModel.docs[0].payload.finish;
  doneStatus(d);
  const r = await pollHeroJob(d, { userId: 'u1', jobId });
  assert.strictEqual(r.json.videoUrl, 'https://cdn.example/stored.mp4');
  assert.ok(!('rawVideoUrl' in r.json));
  assert.strictEqual(n, 0);
  assert.deepStrictEqual(d.JobModel.docs[0].result, { videoUrl: 'https://cdn.example/stored.mp4' });
});

test('submit failure logs fal status and detail, never the prompt', async () => {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const err = new Error('Unprocessable Entity: echo SECRET-PROMPT-XYZ');
    err.status = 422;
    err.body = { detail: [{ msg: 'image rejected by content checker for SECRET-PROMPT-XYZ' }] };
    const d = makeDeps({ submit: async () => { throw err; } });
    await startHeroGeneration(d, { userId: 'u1', body: body({ prompt: 'SECRET-PROMPT-XYZ' }) });
  } finally { console.error = orig; }
  const text = logs.join('\n');
  assert.ok(text.includes('422'));
  assert.ok(text.includes('image rejected by content checker'));
  assert.ok(!text.includes('SECRET-PROMPT-XYZ'));
});

// default finalizeClip (all I/O injected)
function mkIo(over = {}) {
  const io = { uploads: [], tmpDirs: [], finishArgs: [] };
  Object.assign(io, {
    mkdtemp: async () => { const dir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'hero-test-')); io.tmpDirs.push(dir); return dir; },
    download: async (url, opts) => { const p = pathMod.join(opts.downloadsDir, 'raw.mp4'); await fsp.writeFile(p, 'raw'); return { filePath: p }; },
    upload: async (p, folder) => { io.uploads.push([pathMod.basename(p), folder]); return { url: `https://cdn.example/${pathMod.basename(p)}` }; },
    loadBrand: async () => ({ name: 'Acme', website: 'https://acme.com', logoUrl: 'https://acme.com/l.png', colors: ['red', '#12ab34', '#000000'] }),
    finishHeroClip: async (a) => { io.finishArgs.push(a); await fsp.writeFile(a.outputPath, 'fin'); return { outputPath: a.outputPath }; },
    ...over
  });
  return io;
}
const job0 = { userId: 'u1', payload: { finish: { realism: true }, beatSheet: [{ time: '0-2s', beat: 'b' }], dialogue: '"Hi"' } };

test('default finalizeClip: finished + raw uploaded to the hero folder, brand adapted, temp dir removed', async () => {
  const { finalizeClipDefault } = require('../services/heroVideoFlow');
  const io = mkIo();
  const r = await finalizeClipDefault({ remoteUrl: 'https://fal/v.mp4', job: job0 }, io);
  assert.deepStrictEqual(r, { videoUrl: 'https://cdn.example/finished.mp4', rawVideoUrl: 'https://cdn.example/raw.mp4' });
  assert.ok(io.uploads.every(([, folder]) => folder === 'nebula-hero-videos'));
  assert.strictEqual(io.uploads.length, 2);
  const a = io.finishArgs[0];
  assert.deepStrictEqual(a.brand, { name: 'Acme', logoUrl: 'https://acme.com/l.png', color: '#12ab34', website: 'https://acme.com' });
  assert.deepStrictEqual(a.options, job0.payload.finish);
  assert.deepStrictEqual(a.beatSheet, job0.payload.beatSheet);
  assert.strictEqual(a.dialogue, '"Hi"');
  assert.ok(!('lookup' in a) && !('fetchImpl' in a));
  await assert.rejects(fsp.stat(io.tmpDirs[0]));
});

test('default finalizeClip: no valid brand colour omits color', async () => {
  const { finalizeClipDefault } = require('../services/heroVideoFlow');
  const io = mkIo({ loadBrand: async () => ({ name: 'A', colors: ['blue'] }) });
  await finalizeClipDefault({ remoteUrl: 'https://fal/v.mp4', job: job0 }, io);
  assert.ok(!('color' in io.finishArgs[0].brand));
});

test('default finalizeClip: finishing error returns raw only with a plain finishError and cleans up', async () => {
  const { finalizeClipDefault } = require('../services/heroVideoFlow');
  const io = mkIo({ finishHeroClip: async () => { throw new Error('ffmpeg fal Cloudinary canvas'); } });
  const r = await finalizeClipDefault({ remoteUrl: 'https://fal/v.mp4', job: job0 }, io);
  assert.strictEqual(r.videoUrl, 'https://cdn.example/raw.mp4');
  assert.strictEqual(r.rawVideoUrl, 'https://cdn.example/raw.mp4');
  assert.ok(r.finishError && !/ffmpeg|fal|cloudinary|canvas/i.test(r.finishError));
  assert.strictEqual(io.uploads.length, 1);
  await assert.rejects(fsp.stat(io.tmpDirs[0]));
});

test('default finalizeClip: finishing that hangs hits the cap and falls back to raw', async () => {
  const { finalizeClipDefault } = require('../services/heroVideoFlow');
  const io = mkIo({ capMs: 30, finishHeroClip: () => new Promise(() => {}) });
  const r = await finalizeClipDefault({ remoteUrl: 'https://fal/v.mp4', job: job0 }, io);
  assert.strictEqual(r.videoUrl, 'https://cdn.example/raw.mp4');
  assert.ok(r.finishError);
  await assert.rejects(fsp.stat(io.tmpDirs[0]));
});

test('default finalizeClip: upload of the finished file failing falls back to raw; raw upload failing rejects; both clean up', async () => {
  const { finalizeClipDefault } = require('../services/heroVideoFlow');
  const io = mkIo({ upload: async (p) => { if (p.endsWith('finished.mp4')) throw new Error('up'); return { url: 'https://cdn.example/raw.mp4' }; } });
  const r = await finalizeClipDefault({ remoteUrl: 'https://fal/v.mp4', job: job0 }, io);
  assert.strictEqual(r.videoUrl, 'https://cdn.example/raw.mp4');
  assert.ok(r.finishError);
  await assert.rejects(fsp.stat(io.tmpDirs[0]));
  const io2 = mkIo({ upload: async () => { throw new Error('up'); } });
  await assert.rejects(finalizeClipDefault({ remoteUrl: 'https://fal/v.mp4', job: job0 }, io2));
  await assert.rejects(fsp.stat(io2.tmpDirs[0]));
});

test('defaultDeps provides finalizeClip', () => {
  assert.strictEqual(typeof require('../services/heroVideoFlow').defaultDeps().finalizeClip, 'function');
});
