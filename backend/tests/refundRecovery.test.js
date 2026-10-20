const test = require('node:test');
const assert = require('node:assert');
const { startRefundRecovery } = require('../services/refundRecovery');

test('off in tests and with ENABLE_REFUND_SWEEP=off', () => {
  assert.strictEqual(startRefundRecovery({ env: { NODE_ENV: 'test' } }), null);
  assert.strictEqual(startRefundRecovery({ env: { ENABLE_REFUND_SWEEP: 'off' } }), null);
});

test('a pass runs every sweep, one failing sweep does not stop the next, and passes never overlap', async () => {
  const ran = []; let release;
  const gate = new Promise((r) => { release = r; });
  const h = startRefundRecovery({ env: {}, intervalMs: 1e9, firstDelayMs: 1e9, logger: { error() {} }, sweeps: [['a', async () => { ran.push('a'); throw new Error('x'); }], ['b', async () => { ran.push('b'); await gate; }]] });
  const p1 = h.pass(); const p2 = h.pass();
  release(); await Promise.all([p1, p2]);
  assert.deepStrictEqual(ran, ['a', 'b']);
  h.stop();
});
