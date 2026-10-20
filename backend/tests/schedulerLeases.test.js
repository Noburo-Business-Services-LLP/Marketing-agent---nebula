'use strict';
// E2 guard: every scheduler started by startBackgroundJobs() in server-main.js runs its tick through the lease helper
// (services/leaseLock.js), or already holds an OpsState lease (competitors/lease.js), or is on a reviewed allowlist with a reason.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// starter (as it appears in server-main.js) -> file that holds its tick
const STARTERS = {
  'notificationScheduler.start()': 'services/notificationScheduler.js',
  'snapshotScheduler.start()': 'services/snapshotScheduler.js',
  'startCampaignScheduler()': 'services/campaignScheduler.js',
  'startContentCalendarScheduler()': 'services/contentCalendarService.js',
  'startPhotoshootResume()': 'services/photoshoot/index.js',
  'startStudioVideoSweep()': 'routes/studioVideos.js',
  'startWeekRecovery()': 'services/week/weekRecovery.js',
  'startPerformanceTrackerScheduler()': 'services/performanceTracker.js',
  'startBillingScheduler()': 'services/billingScheduler.js',
  'startAccountPurge()': 'services/accountDeletion.js',
  'startRenewalReminders()': 'services/renewalReminders.js',
  'startStaleDraftReaper()': 'services/staleDrafts.js',
  'startPlanScheduler()': 'services/plan/planScheduler.js',
  'startMemoryDistillationScheduler()': 'services/memoryDistillation.js',
  // inline in server-main.js
  'setInterval(run, 60 * 60 * 1000)': 'server-main.js',
  // already hold an OpsState lease (competitors/lease.js)
  'startCampaignStatusSync()': 'services/campaignStatusSync.js',
  'startHomeDraftsSweep()': 'services/homeDrafts/service.js',
  'startBinPurge()': 'services/binPurge.js',
  'startCompetitorTracker()': 'services/competitors/tracker.js',
  'startListeningScorer()': 'services/listening/scorer.js',
  'startBrandMemoryJob()': 'services/brandMemory/runner.js',
  // reviewed allowlist
  'videoGenerationQueue.startWorker()': 'services/videoGenerationQueue.js',
  'startImageJobRunner()': 'services/imageJobQueue.js',
  'startQueueMetricsEmitter()': 'services/queueMetricsEmitter.js',
  'reapOnBoot()': 'services/plan/planService.js'
};

const ALLOW = {
  'videoGenerationQueue.startWorker()': 'a queue consumer, not a timer job: every job is claimed by one atomic queued->processing update with this worker id and a per-job lease, refunds are claimed in the same write; its expired-lease sweep runs through the lease helper; several workers are meant to be safe',
  'startQueueMetricsEmitter()': 'off by default; only pushes queue counts to CloudWatch from each consumer (no send, charge or refund), so every worker reporting is intended',
  'startImageJobRunner()': 'a queue consumer: each job is claimed by an atomic update with its own per-job lease (LEASE_MS) and heartbeat',
  'reapOnBoot()': 'one run at boot, not a timer; in a split deployment it only ends runs that are stale by heartbeat/age, and ending a run twice is a no-op'
};

const body = (() => {
  const src = read('server-main.js');
  const start = src.indexOf('function startBackgroundJobs() {');
  return src.slice(start, src.indexOf('\n}\n', start));
})();

test('the starter table covers every starter inside startBackgroundJobs()', () => {
  for (const call of Object.keys(STARTERS)) assert.ok(body.includes(call), `listed starter is in server-main.js: ${call}`);
  const known = new Set(Object.keys(STARTERS).map((k) => k.replace(/^.*\./, '')));
  const found = (body.match(/\bstart[A-Z]\w*\(\)|\w+Scheduler\.start\(\)|\breapOnBoot\(\)|setInterval\(run, 60 \* 60 \* 1000\)/g) || [])
    .map((s) => s.replace(/^.*\./, ''))
    .filter((s) => s !== 'startBackgroundJobs()');
  assert.ok(found.length >= 20, 'the pattern finds the starters');
  for (const s of found) assert.ok(known.has(s), `a starter in startBackgroundJobs() is missing from this guard table (lease it, or allowlist it with a reason): ${s}`);
});

test('every scheduler tick runs through the lease helper, holds an OpsState lease, or is on the reviewed allowlist', () => {
  for (const [call, file] of Object.entries(STARTERS)) {
    const src = read(file);
    const viaHelper = /leaseLock'\)\s*\.\s*(leased|withLease)\(|\bleased\(|\bwithLease\(/.test(src) && /leaseLock/.test(src);
    const viaOpsLease = /competitors\/lease'\)\.createLease|createLease\(/.test(src);
    if (ALLOW[call]) { assert.ok(ALLOW[call].length > 30, `allowlist reason for ${call}`); continue; }
    assert.ok(viaHelper || viaOpsLease, `${call} (${file}) must run its tick through services/leaseLock.js or hold a lease`);
  }
});

test('lease names are unique per scheduler', () => {
  const names = [];
  for (const file of new Set(Object.values(STARTERS))) {
    const src = read(file);
    for (const m of src.matchAll(/(?:leased|withLease)\(\s*[`'"](scheduler:[a-z0-9:\-${}]+)[`'"]/g)) names.push(m[1]);
  }
  assert.ok(names.length >= 14, `expected at least 14 lease names, found ${names.length}`);
  assert.strictEqual(new Set(names).size, names.length, `duplicate lease names: ${names.join(', ')}`);
});

test('the lease helper is not bypassed by a raw timer in the wrapped files', () => {
  // The tick given to setInterval/setTimeout in these files is the leased one, never the raw run function.
  const raw = {
    'services/campaignScheduler.js': /setInterval\(\(\) => \{\s*processDueCampaigns\(\)/,
    'services/billingScheduler.js': /setInterval\(\(\) => \{ runBillingOnce\(\)/,
    'services/performanceTracker.js': /setInterval\(\(\) => \{\s*runPerformanceTrackerOnce\(\)/,
    'services/memoryDistillation.js': /setInterval\(\(\) => \{\s*runDistillationOnce\(\)/,
    'services/notificationScheduler.js': /this\.checkAndSendNotifications\(\);\s*\n\s*\}, this\.checkInterval/
  };
  for (const [file, re] of Object.entries(raw)) assert.ok(!re.test(read(file)), `${file} still calls the raw tick from its timer`);
});
