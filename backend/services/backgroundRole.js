'use strict';
/**
 * Which role this server process plays (docs/superpowers/ops/ecs-web-worker.md, decision D31).
 *
 *   RUN_BACKGROUND unset  -> one process does everything (today's single ECS task). Background jobs run here, and the
 *                            boot clean-ups may assume that nothing else is running work.
 *   RUN_BACKGROUND=1      -> the WORKER of a split deployment: background jobs run here, but web tasks are running
 *                            customer work at the same time, so boot clean-ups must only take over work that is stale
 *                            (lease, heartbeat or age), never "everything that is open".
 *   RUN_BACKGROUND=0      -> a WEB task: serves every request, starts no scheduler, sweep, queue consumer or loop. Work a
 *                            request starts is either run by the request itself (as today) or persisted for the worker.
 *
 * Anything other than "0" means background jobs run (the default stays ON so a task without the variable behaves
 * exactly as before).
 */
const raw = (env) => String(env.RUN_BACKGROUND == null ? '' : env.RUN_BACKGROUND).trim().toLowerCase();

function runsBackground(env = process.env) {
  const v = raw(env);
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no');
}

// RUN_JOB_CONSUMERS / RUN_SCHEDULERS (E9 stage A, docs/superpowers/ops/generation-parallelism.md): each defaults to
// RUN_BACKGROUND, so nothing changes until one is set. Consumers (the generation queues) may run on every worker task;
// schedulers may too, because every scheduler tick takes a lease (services/leaseLock.js), but a task can opt out.
const flag = (v) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return null;
  return !(s === '0' || s === 'off' || s === 'false' || s === 'no');
};

/** True when this process claims and runs generation jobs (video queue, campaign image jobs). */
function runsJobConsumers(env = process.env) {
  const v = flag(env.RUN_JOB_CONSUMERS);
  return v == null ? runsBackground(env) : v;
}

/** True when this process starts the schedulers, sweeps and loops (everything in startBackgroundJobs but the consumers). */
function runsSchedulers(env = process.env) {
  const v = flag(env.RUN_SCHEDULERS);
  return v == null ? runsBackground(env) : v;
}

/** True when this process is one part of a web/worker split (the variable is set either way). */
function isSplit(env = process.env) {
  return raw(env) !== '';
}

function describe(env = process.env) {
  const parts = `job consumers ${runsJobConsumers(env) ? 'on' : 'off'}, schedulers ${runsSchedulers(env) ? 'on' : 'off'}`;
  if (!runsBackground(env)) return `[role] web only (RUN_BACKGROUND=0): background jobs do NOT run in this process (${parts})`;
  if (isSplit(env)) return `[role] worker (RUN_BACKGROUND=1): background jobs run in this process (${parts})`;
  return `[role] single process (RUN_BACKGROUND not set): background jobs run in this process (${parts})`;
}

module.exports = { runsBackground, runsJobConsumers, runsSchedulers, isSplit, describe };
