'use strict';
// Campaign image jobs in MongoDB (services/imageJobQueue.js), with an in-memory repo: persistence across "tasks",
// claim exactly once, per-account caps (2 running, 5 waiting, then 429), lost jobs failed and never re-run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Q = require('../services/imageJobQueue');

function memoryRepo() {
  const rows = new Map();
  const clone = (r) => (r ? JSON.parse(JSON.stringify(r), (k, v) => (/At$|Until$/.test(k) && typeof v === 'string' ? new Date(v) : v)) : r);
  return {
    rows,
    insert: async (doc) => { rows.set(doc.jobId, clone(doc)); },
    countFor: async (userId, status) => [...rows.values()].filter((r) => r.userId === String(userId) && r.status === status).length,
    countProcessing: async () => [...rows.values()].filter((r) => r.status === 'processing').length,
    oldestQueued: async (limit) => [...rows.values()].filter((r) => r.status === 'queued').sort((a, b) => a.createdAt - b.createdAt).slice(0, limit).map(clone),
    claim: async (jobId, owner, now, leaseUntil) => {
      const r = rows.get(jobId);
      if (!r || r.status !== 'queued') return null;
      Object.assign(r, { status: 'processing', leaseOwner: owner, leaseUntil, startedAt: now, attempts: r.attempts + 1 });
      return clone(r);
    },
    update: async (jobId, owner, set) => {
      const r = rows.get(jobId);
      if (!r || r.status !== 'processing' || r.leaseOwner !== owner) return false;
      for (const [k, v] of Object.entries(set)) { if (k.startsWith('metadata.')) { r.metadata = r.metadata || {}; r.metadata[k.slice(9)] = v; } else r[k] = v; }
      return true;
    },
    pushLog: async (jobId, line) => { const r = rows.get(jobId); if (r) r.logs.push(line); },
    expired: async (now) => [...rows.values()].filter((r) => r.status === 'processing' && r.leaseUntil < now).map(clone),
    failLost: async (job, now) => {
      const r = rows.get(job.jobId);
      if (!r || r.status !== 'processing' || r.leaseOwner !== job.leaseOwner || !(r.leaseUntil < now)) return false;
      Object.assign(r, { status: 'failed', error: { message: Q.LOST_MESSAGE }, completedAt: now });
      return true;
    },
    get: async (jobId, userId) => { const r = rows.get(jobId); return r && (!userId || r.userId === userId) ? clone(r) : null; },
    position: async (job) => [...rows.values()].filter((r) => r.status === 'queued' && r.createdAt < job.createdAt).length
  };
}

const quiet = { log() {}, warn() {}, error() {} };
let t0 = 1_700_000_000_000;
const clock = () => new Date((t0 += 1));
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

test('a web-only task stores the job and runs nothing; the worker claims and runs it; any task reads the status', async () => {
  const repo = memoryRepo();
  const web = Q.createImageJobQueue({ repo, now: clock, runsJobsHere: false, log: quiet, owner: 'web-1' });
  const worker = Q.createImageJobQueue({ repo, now: clock, runsJobsHere: true, log: quiet, owner: 'worker' });
  let calls = 0;
  web.registerHandler('img', async () => { throw new Error('the web task must not run jobs'); });
  worker.registerHandler('img', async ({ userId, payload }, { update, log }) => { calls += 1; update({ progress: 45, currentStep: 'generating_image' }); log('working'); return { imageUrl: `https://x/${payload.n}.png`, userId }; });
  const job = await web.enqueue({ userId: 'u1', type: 'img', payload: { n: 1 } });
  assert.strictEqual(job.status, 'queued');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(repo.rows.get(job.jobId).status, 'queued', 'still waiting: nothing ran on the web task');
  const seen = await web.getJob(job.jobId, 'u1');
  assert.strictEqual(seen.queuePosition, 1);
  await worker.drain();
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(calls, 1);
  const done = await web.getJob(job.jobId, 'u1');
  assert.strictEqual(done.status, 'completed');
  assert.deepStrictEqual(done.result, { imageUrl: 'https://x/1.png', userId: 'u1' });
  assert.strictEqual(done.progress, 100);
  assert.ok(done.logs.some((l) => /working/.test(l)));
  assert.strictEqual(await web.getJob(job.jobId, 'someone-else'), null, 'only the account itself can read it');
  assert.strictEqual(await web.getJob(job.jobId), null);
});

test('two runners: each job is claimed exactly once', async () => {
  const repo = memoryRepo();
  const ran = [];
  const mk = (owner) => { const q = Q.createImageJobQueue({ repo, now: clock, runsJobsHere: false, concurrency: 5, log: quiet, owner }); q.registerHandler('img', async ({ jobId }) => { ran.push(`${owner}:${jobId}`); return {}; }); return q; };
  const a = mk('a'); const b = mk('b');
  const ids = [];
  for (let u = 0; u < 4; u += 1) ids.push((await a.enqueue({ userId: `u${u}`, type: 'img' })).jobId);
  await Promise.all([a.drain(), b.drain(), a.drain(), b.drain()]);
  await new Promise((r) => setTimeout(r, 5));
  const jobsRun = ran.map((x) => x.split(':')[1]).sort();
  assert.deepStrictEqual(jobsRun, ids.slice().sort(), 'every job ran once, none twice');
  for (const id of ids) assert.strictEqual(repo.rows.get(id).attempts, 1);
});

test('per account: 5 waiting then 429; at most 2 running while other accounts still get their turn', async () => {
  const repo = memoryRepo();
  const q = Q.createImageJobQueue({ repo, now: clock, runsJobsHere: false, concurrency: 4, log: quiet, owner: 'w' });
  const gates = [];
  q.registerHandler('img', async () => { const d = deferred(); gates.push(d); await d.p; return {}; });
  for (let i = 0; i < 5; i += 1) await q.enqueue({ userId: 'heavy', type: 'img' });
  await assert.rejects(() => q.enqueue({ userId: 'heavy', type: 'img' }), (e) => e instanceof Q.QueueFullError && e.status === 429);
  await q.enqueue({ userId: 'light', type: 'img' });
  await q.drain();
  const running = [...repo.rows.values()].filter((r) => r.status === 'processing');
  assert.strictEqual(running.filter((r) => r.userId === 'heavy').length, 2, 'the heavy account has 2 running');
  assert.strictEqual(running.filter((r) => r.userId === 'light').length, 1, 'the light account is not stuck behind it');
  // With 2 running and 3 waiting, the heavy account may add 2 more waiting (5), then 429 again.
  await q.enqueue({ userId: 'heavy', type: 'img' });
  await q.enqueue({ userId: 'heavy', type: 'img' });
  await assert.rejects(() => q.enqueue({ userId: 'heavy', type: 'img' }), Q.QueueFullError);
  gates.forEach((g) => g.resolve());
  await new Promise((r) => setTimeout(r, 10));
});

test('IMAGE_JOB_CONCURRENCY: jobs at once per runner (default 2)', async () => {
  assert.strictEqual(Q.concurrencySetting({}), 2);
  assert.strictEqual(Q.concurrencySetting({ IMAGE_JOB_CONCURRENCY: '6' }), 6);
  assert.strictEqual(Q.concurrencySetting({ IMAGE_JOB_CONCURRENCY: 'x' }), 2);
  assert.strictEqual(Q.concurrencySetting({ CAMPAIGN_IMAGE_QUEUE_CONCURRENCY: '3' }), 3, 'the old name still works');
  const repo = memoryRepo();
  const q = Q.createImageJobQueue({ repo, now: clock, runsJobsHere: false, concurrency: 2, log: quiet, owner: 'w' });
  const gates = [];
  q.registerHandler('img', async () => { const d = deferred(); gates.push(d); await d.p; return {}; });
  for (let u = 0; u < 5; u += 1) await q.enqueue({ userId: `c${u}`, type: 'img' });
  await q.drain();
  assert.strictEqual(q.activeCount(), 2);
  gates.forEach((g) => g.resolve());
  await new Promise((r) => setTimeout(r, 10));
});

test('a lost job (lease ran out) is failed once and never run again; its late result is not written', async () => {
  const repo = memoryRepo();
  let now = 1_800_000_000_000;
  const at = () => new Date(now);
  const dying = Q.createImageJobQueue({ repo, now: at, runsJobsHere: false, log: quiet, owner: 'dead-task' });
  const gate = deferred();
  let runs = 0;
  dying.registerHandler('img', async () => { runs += 1; await gate.p; return { imageUrl: 'late' }; });
  const job = await dying.enqueue({ userId: 'u1', type: 'img' });
  await dying.drain();
  now += Q.LEASE_MS + 1;
  const sweeper = Q.createImageJobQueue({ repo, now: at, runsJobsHere: false, log: quiet, owner: 'worker-2' });
  sweeper.registerHandler('img', async () => { runs += 1; return {}; });
  assert.strictEqual(await sweeper.sweepLost(), 1);
  assert.strictEqual(await sweeper.sweepLost(), 0, 'only once');
  await sweeper.drain();
  assert.strictEqual(runs, 1, 'not run again');
  gate.resolve();
  await new Promise((r) => setTimeout(r, 5));
  const row = repo.rows.get(job.jobId);
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.error.message, Q.LOST_MESSAGE);
  assert.strictEqual(row.result, null, 'the lost runner cannot overwrite the failure');
});

test('a handler error fails the job with a plain message; an oversized payload is refused with 413', async () => {
  const repo = memoryRepo();
  const q = Q.createImageJobQueue({ repo, now: clock, runsJobsHere: false, log: quiet, owner: 'w' });
  q.registerHandler('img', async () => { throw new Error('provider said no'); });
  const job = await q.enqueue({ userId: 'u1', type: 'img' });
  await q.drain();
  await new Promise((r) => setTimeout(r, 5));
  const row = await q.getJob(job.jobId, 'u1');
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.error.message, 'provider said no');
  await assert.rejects(() => q.enqueue({ userId: 'u1', type: 'img', payload: { big: 'x'.repeat(Q.MAX_PAYLOAD_BYTES + 1) } }), (e) => e instanceof Q.PayloadTooLargeError && e.status === 413);
});

test('the campaign route uses the stored queue (429/413 answered), and the old in-process queue is gone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'campaigns.js'), 'utf8');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'services', 'campaignImageQueue.js')));
  assert.match(src, /imageJobQueue\(\)\.enqueue\(\{ userId: String\(userId\), type: CAMPAIGN_IMAGE_JOB, payload: req\.body \|\| \{\} \}\)/);
  assert.match(src, /queueError instanceof QueueFullError \|\| queueError instanceof PayloadTooLargeError/);
  assert.match(src, /await imageJobQueue\(\)\.getJob\(req\.params\.jobId, String\(userId\)\)/);
  assert.match(src, /imageJobQueue\(\)\.registerHandler\(CAMPAIGN_IMAGE_JOB,/);
});
