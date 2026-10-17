'use strict';
// Picks up weekly posts a restart or crash left half-done, without anyone opening Home. Off in tests and with
// ENABLE_WEEK_RECOVERY=off. The first look is a minute after start, then every 15 minutes; one pass at a time.
const FIRST_MS = 60 * 1000;
const EVERY_MS = 15 * 60 * 1000;

function startWeekRecovery({ service, env = process.env, intervalMs = EVERY_MS, firstDelayMs = FIRST_MS, logger = console } = {}) {
  if (String(env.ENABLE_WEEK_RECOVERY || '').trim().toLowerCase() === 'off' || env.NODE_ENV === 'test') return null;
  const svc = service || require('./weekService').createWeekService();
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try { await svc.recoverOpenWeeks({}); } catch (e) { logger.error('[week] recovery pass failed:', e && e.message); } finally { running = false; }
  };
  const first = setTimeout(pass, firstDelayMs);
  const timer = setInterval(pass, intervalMs);
  if (first.unref) first.unref();
  if (timer.unref) timer.unref();
  return { stop: () => { clearTimeout(first); clearInterval(timer); }, pass };
}

module.exports = { startWeekRecovery };
