'use strict';
// A6: what the process does with an unhandled rejection or an uncaught exception. Handler functions with fakes (no
// real server, no real exit).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createCrashHandlers, isKnownSafe } = require('../utils/crashPolicy');

function rig({ env = {}, closeAfter = 0 } = {}) {
  const timers = [];
  let now = 0;
  const calls = { exit: [], exitCode: null, closed: 0, idleClosed: 0, stopped: 0, logs: [] };
  const server = {
    close(cb) { calls.closed += 1; if (closeAfter >= 0) timers.push({ at: now + closeAfter, fn: cb }); },
    closeIdleConnections() { calls.idleClosed += 1; }
  };
  const h = createCrashHandlers({
    env,
    getServer: () => server,
    onStop: () => { calls.stopped += 1; },
    exit: (c) => { calls.exit.push(c); },
    setExitCode: (c) => { calls.exitCode = c; },
    log: { error: (...a) => calls.logs.push(a.map(String).join(' ')), warn: (...a) => calls.logs.push(a.map(String).join(' ')) },
    setTimer: (fn, ms) => { timers.push({ at: now + ms, fn }); return { unref() {} }; }
  });
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((x) => !x.done && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = Math.max(now, due.at); due.done = true; due.fn();
    }
    now = end;
  };
  return { h, calls, advance, server };
}

test('known-safe rejections (a client hung up, an aborted request, a busy hasher) are logged and the process keeps running', () => {
  for (const reason of [Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), Object.assign(new Error('x'), { code: 'EPIPE' }), Object.assign(new Error('aborted'), { name: 'AbortError' }), Object.assign(new Error('busy'), { code: 'PASSWORD_HASH_BUSY' }), Object.assign(new Error('closed'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })]) {
    assert.strictEqual(isKnownSafe(reason), true, reason.code || reason.name);
    const r = rig();
    assert.strictEqual(r.h.onUnhandledRejection(reason), 'continued');
    r.advance(60000);
    assert.deepStrictEqual(r.calls.exit, []);
    assert.strictEqual(r.calls.exitCode, null);
    assert.strictEqual(r.calls.closed, 0);
    assert.ok(r.calls.logs.some((l) => l.includes('"type":"unhandledRejection"')), 'one structured line');
  }
});

test('any other rejection: exit code 1, then after the grace period the server stops taking connections and the process exits 1', () => {
  const r = rig({ closeAfter: 500 });
  assert.strictEqual(r.h.onUnhandledRejection(new TypeError('cannot read x of undefined')), 'exiting');
  assert.strictEqual(r.calls.exitCode, 1);
  assert.strictEqual(r.calls.closed, 0, 'not at once: a short grace period for the log to flush');
  r.advance(5000);
  assert.strictEqual(r.calls.closed, 1);
  assert.strictEqual(r.calls.stopped, 1, 'health turns 503 so the load balancer stops sending');
  r.advance(500);
  assert.deepStrictEqual(r.calls.exit, [1]);
  assert.ok(r.calls.logs.some((l) => l.includes('TypeError')));
});

test('UNHANDLED_REJECTION_POLICY=log keeps the old behaviour (log only) as a kill switch', () => {
  const r = rig({ env: { UNHANDLED_REJECTION_POLICY: 'log' } });
  assert.strictEqual(r.h.onUnhandledRejection(new Error('boom')), 'continued');
  r.advance(60000);
  assert.deepStrictEqual(r.calls.exit, []);
});

test('uncaught exception: log, stop accepting connections at once, exit 1 when the open requests finish', () => {
  const r = rig({ closeAfter: 2000 });
  r.h.onUncaughtException(new Error('kaboom'));
  assert.strictEqual(r.calls.closed, 1);
  assert.strictEqual(r.calls.idleClosed, 1, 'idle keep-alive connections are closed so the drain can finish');
  assert.deepStrictEqual(r.calls.exit, []);
  r.advance(2000);
  assert.deepStrictEqual(r.calls.exit, [1]);
});

test('uncaught exception: requests still open after 10 s do not keep the process alive', () => {
  const r = rig({ closeAfter: -1 }); // close never calls back
  r.h.onUncaughtException(new Error('kaboom'));
  r.advance(9999);
  assert.deepStrictEqual(r.calls.exit, []);
  r.advance(1);
  assert.deepStrictEqual(r.calls.exit, [1]);
});

test('a second fatal error during the drain is logged only (one shutdown, one exit)', () => {
  const r = rig({ closeAfter: 1000 });
  r.h.onUncaughtException(new Error('first'));
  r.h.onUncaughtException(new Error('second'));
  r.h.onUnhandledRejection(new Error('third'));
  r.advance(20000);
  assert.strictEqual(r.calls.closed, 1);
  assert.deepStrictEqual(r.calls.exit, [1]);
});

test('no server yet (a crash during start-up): exits 1 straight away', () => {
  const calls = [];
  const h = createCrashHandlers({ env: {}, getServer: () => null, exit: (c) => calls.push(c), setExitCode() {}, log: { error() {}, warn() {} }, setTimer: (fn) => { fn(); return { unref() {} }; } });
  h.onUncaughtException(new Error('early'));
  assert.deepStrictEqual(calls, [1]);
});

test('server-main installs both handlers from the policy and keeps the SIGTERM drain (SHUTDOWN_DRAIN_MS)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server-main.js'), 'utf8');
  assert.match(src, /require\('\.\/utils\/crashPolicy'\)\.createCrashHandlers/);
  assert.match(src, /process\.on\('unhandledRejection', crash\.onUnhandledRejection\)/);
  assert.match(src, /process\.on\('uncaughtException', crash\.onUncaughtException\)/);
  assert.match(src, /SHUTDOWN_DRAIN_MS/);
  assert.match(src, /process\.on\('SIGTERM'/);
});
