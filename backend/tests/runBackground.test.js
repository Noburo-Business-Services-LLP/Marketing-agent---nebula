'use strict';
// RUN_BACKGROUND (web/worker split, docs/superpowers/ops/ecs-web-worker.md): every scheduler, sweep, queue consumer and
// loop of server-main.js starts inside startBackgroundJobs(), which only runs where background jobs run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const role = require('../services/backgroundRole');

function gatedBody(src) {
  const start = src.indexOf('function startBackgroundJobs() {');
  assert.ok(start > 0, 'startBackgroundJobs exists');
  // The function ends at the first line that is exactly "}" after it.
  const end = src.indexOf('\n}\n', start);
  return { body: src.slice(start, end), outside: src.slice(0, start) + src.slice(end) };
}

test('role: default on, 0/off means web only, set either way means split', () => {
  assert.strictEqual(role.runsBackground({}), true);
  assert.strictEqual(role.isSplit({}), false);
  assert.strictEqual(role.runsBackground({ RUN_BACKGROUND: '1' }), true);
  assert.strictEqual(role.isSplit({ RUN_BACKGROUND: '1' }), true);
  for (const v of ['0', 'off', 'false', 'no', ' 0 ']) assert.strictEqual(role.runsBackground({ RUN_BACKGROUND: v }), false, v);
  assert.strictEqual(role.isSplit({ RUN_BACKGROUND: '0' }), true);
  assert.match(role.describe({ RUN_BACKGROUND: '0' }), /web only/);
  assert.match(role.describe({ RUN_BACKGROUND: '1' }), /worker/);
  assert.match(role.describe({}), /single process/);
});

test('server-main: the gate calls startBackgroundJobs only when background jobs run, and logs the role once', () => {
  const src = read('server-main.js');
  assert.match(src, /console\.log\(backgroundRole\.describe\(\)\);\s*\n\s*if \(backgroundRole\.runsBackground\(\)\) startBackgroundJobs\(\);/);
  assert.strictEqual((src.match(/startBackgroundJobs\(\)/g) || []).length, 2, 'defined once and called once');
});

test('server-main: every starter is inside startBackgroundJobs, none outside', () => {
  const { body, outside } = gatedBody(read('server-main.js'));
  const expected = [
    'videoGenerationQueue.startWorker()', 'notificationScheduler.start()', 'snapshotScheduler.start()', 'startCampaignScheduler()',
    'startCampaignStatusSync()', 'startContentCalendarScheduler()', 'startPhotoshootResume()', 'startStudioVideoSweep()',
    'startHomeDraftsSweep()', 'startBinPurge()', 'startWeekRecovery()', 'startPerformanceTrackerScheduler()', 'startBillingScheduler()',
    'setInterval(run, 60 * 60 * 1000)', 'startAccountPurge()', 'startRenewalReminders()', 'startStaleDraftReaper()', 'reapOnBoot()',
    'startCompetitorTracker()', 'startListeningScorer()', 'startPlanScheduler()', 'startBrandMemoryJob()', 'startMemoryDistillationScheduler()',
    'startImageJobRunner()'
  ];
  for (const call of expected) assert.ok(body.includes(call), `inside the gate: ${call}`);
  // Outside the gate: no setInterval, no start...() other than the server itself, no .start() other than the memory
  // diagnostic, no queue worker, no boot reap.
  assert.ok(!/setInterval\(/.test(outside), 'no setInterval outside the gate');
  const starts = (outside.match(/\bstart[A-Z]\w*\(/g) || []).filter((m) => !['startServer(', 'startBackgroundJobs('].includes(m));
  assert.deepStrictEqual(starts, [], 'no start...() outside the gate');
  const dotStarts = (outside.match(/[\w)]\.start\(\)/g) || []);
  assert.deepStrictEqual(dotStarts, [").start()"], 'only the memory diagnostic (memoryWatchdog).start() outside');
  assert.match(outside, /require\('\.\/utils\/memoryWatchdog'\)\.start\(\)/);
  assert.ok(!/startWorker\(|reapOnBoot\(|\.schedule\(/.test(outside));
});

test('no module starts a timer at load time except the allowed local caches', () => {
  // A top-level setInterval runs in every process, web tasks included. Allowed: per-process cache cleanups only.
  const allowed = new Set(['services/geminiAI.js']);
  const found = [];
  for (const dir of ['routes', 'services', 'controllers', 'middleware', 'utils']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (e.name.endsWith('.js') && /^setInterval\(/m.test(read(rel))) found.push(rel);
      }
    };
    walk(dir);
  }
  assert.deepStrictEqual(found.filter((f) => !allowed.has(f)), []);
});

test('plan boot reap: all runs in a single process, only stale ones in a split', () => {
  const src = read('services/plan/planService.js');
  assert.match(src, /reapStalePlanRuns\(\{ all: !require\('\.\.\/backgroundRole'\)\.isSplit\(env\) \}\)/);
});

test('video queue: a web-only process stores the job and does not run it; the worker drain claims it', async () => {
  const { PersistentVideoGenerationQueue } = require('../services/videoGenerationQueue');
  const rows = [];
  const model = { create: async (doc) => { rows.push(doc); return { toObject: () => doc }; } };
  const web = new PersistentVideoGenerationQueue({ model, runsJobsHere: false });
  let drained = 0;
  web._drainQueue = async () => { drained += 1; };
  web.registerHandler('x', async () => ({}));
  const job = await web.enqueue({ userId: 'u1', jobType: 'x', payload: { a: 1 } });
  assert.strictEqual(job.status, 'queued');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(drained, 0, 'web task does not start the job');

  const single = new PersistentVideoGenerationQueue({ model, runsJobsHere: true });
  let drainedHere = 0;
  single._drainQueue = async () => { drainedHere += 1; };
  await single.enqueue({ userId: 'u1', jobType: 'x' });
  assert.strictEqual(drainedHere, 1, 'single process starts it at once, as before');
});
