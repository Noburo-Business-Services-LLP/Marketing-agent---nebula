'use strict';
/**
 * Generation job slots per worker (tester task E9 stage A, docs/superpowers/ops/generation-parallelism.md, D68 to D71).
 *
 * Capacity is per WORKER PROCESS, so total capacity = worker tasks x slots (no database-wide count any more).
 *
 *   PROVIDER_SLOTS_IMAGE   default 2 (1..32)  image jobs waiting on the image provider at once, per worker
 *   PROVIDER_SLOTS_VIDEO   default 2 (1..32)  video jobs waiting on the video provider at once, per worker
 *   PROVIDER_SLOTS_OMNI    default 2 (1..32)  Videos (Gemini Omni) jobs making clips at once, per worker (stage B1)
 *   PROVIDER_SLOTS         one value for all three when the specific one is not set
 *                          (legacy: VIDEO_QUEUE_CONCURRENCY sets the video default, IMAGE_JOB_CONCURRENCY the image default)
 *   CPU_SLOTS              default min(2, vCPUs) (1..16)  ffmpeg processes at once per worker
 *   FFMPEG_THREADS         default 2 (1..8)   -threads given to each ffmpeg of the queue pipeline
 *   JOB_GLOBAL_CEILING     default 200 (0 = off, max 2000)  safety net: no worker claims while this many run in total
 *   JOB_PER_USER_RUNNING   default JOB_CAP_ACTIVE or 2 (1..20)  running jobs per account at claim time
 *   JOB_LEASE_MS           default 60000 (20000..600000)  a claim's lease; renewed by the heartbeat
 *   JOB_HEARTBEAT_MS       default 20000, at most a third of the lease (5000..)
 *   JOB_MAX_ATTEMPTS       default 2 (1..5)   runs per job when a lease runs out (1 = never re-run, the old rule)
 *   JOB_SHUTDOWN_GRACE_MS  default SHUTDOWN_DRAIN_MS - 5000 (0..115000)  how long SIGTERM waits for running jobs
 *
 * A value that is not a whole number in range falls back to the default (or is clamped) with one warning line.
 */
const os = require('os');

const LIMITS = Object.freeze({
  providerMax: 32,
  cpuMax: 16,
  ffmpegThreadsMax: 8,
  ceilingMax: 2000,
  perUserMax: 20,
  leaseMin: 20000,
  leaseMax: 600000,
  heartbeatMin: 5000,
  attemptsMax: 5,
  graceMax: 115000
});

function vcpus() {
  try { return typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length; } catch (_) { return 1; }
}

function readJobSlots(env = process.env, { cpuCount = vcpus() } = {}) {
  const warnings = [];
  const has = (k) => env[k] != null && String(env[k]).trim() !== '';
  // A whole number in [min, max]: out of range is clamped (with a warning), not a number falls back to def.
  const int = (key, def, min, max) => {
    if (!has(key)) return def;
    const raw = String(env[key]).trim();
    if (!/^-?\d+$/.test(raw)) { warnings.push(`${key}="${raw}" is not a whole number: using ${def}`); return def; }
    const n = Number.parseInt(raw, 10);
    if (n < min) { warnings.push(`${key}=${n} is below ${min}: using ${min}`); return min; }
    if (n > max) { warnings.push(`${key}=${n} is above ${max}: using ${max}`); return max; }
    return n;
  };
  const firstSet = (keys) => keys.find(has);

  const videoKey = firstSet(['PROVIDER_SLOTS_VIDEO', 'PROVIDER_SLOTS', 'VIDEO_QUEUE_CONCURRENCY']);
  const imageKey = firstSet(['PROVIDER_SLOTS_IMAGE', 'PROVIDER_SLOTS', 'IMAGE_JOB_CONCURRENCY']);
  const video = videoKey ? int(videoKey, 2, 1, LIMITS.providerMax) : 2;
  const image = imageKey ? int(imageKey, 2, 1, LIMITS.providerMax) : 2;
  const omniKey = firstSet(['PROVIDER_SLOTS_OMNI', 'PROVIDER_SLOTS']);
  const omni = omniKey ? int(omniKey, 2, 1, LIMITS.providerMax) : 2;
  const cpuDefault = Math.max(1, Math.min(2, Number(cpuCount) || 1));
  const cpu = int('CPU_SLOTS', cpuDefault, 1, LIMITS.cpuMax);
  const ffmpegThreads = int('FFMPEG_THREADS', 2, 1, LIMITS.ffmpegThreadsMax);
  const globalCeiling = int('JOB_GLOBAL_CEILING', 200, 0, LIMITS.ceilingMax);
  const capActive = Number.parseInt(String(env.JOB_CAP_ACTIVE || ''), 10);
  const perUserDefault = Number.isFinite(capActive) && capActive >= 1 ? Math.min(capActive, LIMITS.perUserMax) : 2;
  const perUserRunning = int('JOB_PER_USER_RUNNING', perUserDefault, 1, LIMITS.perUserMax);
  const leaseMs = int('JOB_LEASE_MS', 60000, LIMITS.leaseMin, LIMITS.leaseMax);
  let heartbeatMs = int('JOB_HEARTBEAT_MS', 20000, LIMITS.heartbeatMin, LIMITS.leaseMax);
  const heartbeatMax = Math.floor(leaseMs / 3);
  if (heartbeatMs > heartbeatMax) { warnings.push(`JOB_HEARTBEAT_MS=${heartbeatMs} must be at most a third of the lease (${leaseMs}): using ${heartbeatMax}`); heartbeatMs = heartbeatMax; }
  const maxAttempts = int('JOB_MAX_ATTEMPTS', 2, 1, LIMITS.attemptsMax);
  const drain = Number.parseInt(String(env.SHUTDOWN_DRAIN_MS || ''), 10);
  const drainMs = Number.isFinite(drain) ? Math.max(1000, Math.min(115000, drain)) : 20000;
  const shutdownGraceMs = int('JOB_SHUTDOWN_GRACE_MS', Math.max(0, drainMs - 5000), 0, LIMITS.graceMax);

  return {
    slots: { image, video, omni },
    cpu,
    ffmpegThreads,
    globalCeiling,
    perUserRunning,
    leaseMs,
    heartbeatMs,
    maxAttempts,
    shutdownGraceMs,
    warnings
  };
}

let cached = null;
/** The process-wide settings, read once; warnings are logged once. */
function jobSlots() {
  if (cached) return cached;
  cached = readJobSlots();
  if (cached.warnings.length) {
    try { const log = require('../utils/logger'); cached.warnings.forEach((w) => log.warn(`[job slots] ${w}`)); } catch (_) { /* logging never blocks */ }
  }
  return cached;
}

module.exports = { readJobSlots, jobSlots, LIMITS, _reset: () => { cached = null; } };
