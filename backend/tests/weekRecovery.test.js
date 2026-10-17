const test = require('node:test');
const assert = require('node:assert');
const { startWeekRecovery } = require('../services/week/weekRecovery');

test('recovery is off in tests and with ENABLE_WEEK_RECOVERY=off', () => {
  assert.strictEqual(startWeekRecovery({ service: {}, env: { NODE_ENV: 'test' } }), null);
  assert.strictEqual(startWeekRecovery({ service: {}, env: { ENABLE_WEEK_RECOVERY: 'off' } }), null);
});

test('recovery runs a pass at start and never overlaps passes', async () => {
  let calls = 0; let release;
  const gate = new Promise((r) => { release = r; });
  const svc = { recoverOpenWeeks: async () => { calls += 1; await gate; } };
  const h = startWeekRecovery({ service: svc, env: {}, intervalMs: 1e9, firstDelayMs: 1e9, logger: { error() {} } });
  const a = h.pass(); const b = h.pass();
  release(); await Promise.all([a, b]);
  assert.strictEqual(calls, 1);
  h.stop();
});
