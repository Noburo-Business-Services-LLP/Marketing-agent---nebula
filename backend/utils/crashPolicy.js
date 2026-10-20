'use strict';
/**
 * What the process does after an error nobody caught (A6, docs/superpowers/ops/security-hardening.md section 9).
 *
 *  - unhandledRejection: one structured log line. Known-safe cases (a client hung up or aborted, a busy password
 *    hasher, a stream closed early) keep running. Anything else sets exit code 1 and, after a short grace period
 *    (CRASH_GRACE_MS, 5 s, so the log is flushed), stops the process like an uncaught exception: the task supervisor
 *    (ECS) starts a fresh one. UNHANDLED_REJECTION_POLICY=log is the kill switch back to "log only".
 *  - uncaughtException: log, health and ready turn 503 (the load balancer stops sending), the server stops taking
 *    connections, idle keep-alive connections close, open requests get up to CRASH_DRAIN_MS (10 s), then exit 1.
 *  - SIGTERM keeps its own drain in server-main.js (SHUTDOWN_DRAIN_MS); this is only for crashes.
 */
const SAFE_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END', 'ERR_HTTP_HEADERS_SENT', 'PASSWORD_HASH_BUSY', 'ERR_CANCELED']);
const SAFE_NAMES = new Set(['AbortError', 'CanceledError', 'PasswordHashBusyError']);

/** A rejection that says a client went away or the server was briefly busy, not that the program is broken. */
function isKnownSafe(reason) {
  if (!reason || typeof reason !== 'object') return false;
  return SAFE_CODES.has(reason.code) || SAFE_NAMES.has(reason.name) || reason.type === 'aborted' || reason.message === 'aborted';
}

const ms = (v, fallback) => { const n = Number.parseInt(String(v == null ? '' : v), 10); return Number.isFinite(n) && n >= 0 ? n : fallback; };

function describe(type, reason, action) {
  const e = reason instanceof Error ? reason : null;
  return JSON.stringify({
    level: 'error', type, action, at: new Date().toISOString(),
    name: e ? e.name : typeof reason, message: e ? e.message : String(reason).slice(0, 500), code: e && e.code ? e.code : undefined,
    stack: e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : undefined
  });
}

function createCrashHandlers({
  env = process.env,
  getServer = () => null,
  onStop = () => {},
  exit = (code) => process.exit(code),
  setExitCode = (code) => { process.exitCode = code; },
  log = console,
  setTimer = (fn, t) => setTimeout(fn, t)
} = {}) {
  let stopping = false;
  const graceMs = () => ms(env.CRASH_GRACE_MS, 5000);
  const drainMs = () => ms(env.CRASH_DRAIN_MS, 10000);

  /** Stop taking connections, let open requests finish (at most the drain time), exit 1. Runs once. */
  function shutdown() {
    let done = false;
    const finish = () => { if (done) return; done = true; exit(1); };
    try { onStop(); } catch (_) { /* never in the way of stopping */ }
    const server = (() => { try { return getServer(); } catch (_) { return null; } })();
    if (!server) return finish();
    setTimer(finish, drainMs());
    try {
      server.close(() => finish());
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    } catch (_) { finish(); }
    return undefined;
  }

  function onUnhandledRejection(reason) {
    if (stopping) { log.error(describe('unhandledRejection', reason, 'already-stopping')); return 'stopping'; }
    const logOnly = String(env.UNHANDLED_REJECTION_POLICY || '').trim().toLowerCase() === 'log';
    if (isKnownSafe(reason) || logOnly) { log.error(describe('unhandledRejection', reason, 'continued')); return 'continued'; }
    stopping = true;
    setExitCode(1);
    log.error(describe('unhandledRejection', reason, 'exiting'));
    log.error(`[crash] Unhandled promise rejection: stopping in ${Math.round(graceMs() / 1000)} s (open requests get up to ${Math.round(drainMs() / 1000)} s), then exit 1. UNHANDLED_REJECTION_POLICY=log switches this off.`);
    setTimer(shutdown, graceMs());
    return 'exiting';
  }

  function onUncaughtException(err) {
    if (stopping) { log.error(describe('uncaughtException', err, 'already-stopping')); return 'stopping'; }
    stopping = true;
    setExitCode(1);
    log.error(describe('uncaughtException', err, 'exiting'));
    log.error(`[crash] Uncaught exception: no new connections, open requests get up to ${Math.round(drainMs() / 1000)} s, then exit 1.`);
    shutdown();
    return 'exiting';
  }

  return { onUnhandledRejection, onUncaughtException, isStopping: () => stopping };
}

module.exports = { createCrashHandlers, isKnownSafe };
