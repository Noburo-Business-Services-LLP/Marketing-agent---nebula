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

/** True when this process is one part of a web/worker split (the variable is set either way). */
function isSplit(env = process.env) {
  return raw(env) !== '';
}

function describe(env = process.env) {
  if (!runsBackground(env)) return '[role] web only (RUN_BACKGROUND=0): background jobs do NOT run in this process';
  if (isSplit(env)) return '[role] worker (RUN_BACKGROUND=1): background jobs run in this process';
  return '[role] single process (RUN_BACKGROUND not set): background jobs run in this process';
}

module.exports = { runsBackground, isSplit, describe };
