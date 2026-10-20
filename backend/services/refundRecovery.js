'use strict';
// Pays refunds that a crash or an outage left claimed but unpaid (see refundSettle.js): Blueprint, the designed
// Blueprint PDF and Hero video. Each flow's sweep is bounded and pays a row only when chargeProof says the charge
// landed and no refund did. Off in tests and with ENABLE_REFUND_SWEEP=off. Every three minutes; one pass at a time.
const EVERY_MS = 3 * 60 * 1000;
const FIRST_MS = 90 * 1000;

function startRefundRecovery({ env = process.env, intervalMs = EVERY_MS, firstDelayMs = FIRST_MS, logger = console, sweeps } = {}) {
  if (String(env.ENABLE_REFUND_SWEEP || '').trim().toLowerCase() === 'off' || env.NODE_ENV === 'test') return null;
  const list = sweeps || [
    ['blueprint', () => require('./blueprint/service').createBlueprintService().sweepUnsettled()],
    ['hero', () => { const f = require('./heroVideoFlow'); return f.sweepHeroRefunds(f.defaultDeps()); }]
  ];
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      for (const [name, run] of list) {
        try { await run(); } catch (e) { logger.error(`[refunds] ${name} sweep failed:`, e && e.message); }
      }
    } finally { running = false; }
  };
  const first = setTimeout(pass, firstDelayMs);
  const timer = setInterval(pass, intervalMs);
  if (first.unref) first.unref();
  if (timer.unref) timer.unref();
  return { stop: () => { clearTimeout(first); clearInterval(timer); }, pass };
}

module.exports = { startRefundRecovery };
