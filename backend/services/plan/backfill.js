'use strict';
// Pure planning for the one-off backfill of existing managed clients: who, in what order, how fast.
const { shouldHavePlan } = require('./planRules');

const HARD_MAX = 200;
const PLAN_RUN_INR_ESTIMATE = 5;

function selectForBackfill({ users, hasPlanIds = new Set(), blockedIds = new Set(), limit = 20 }) {
  const blocked = new Set([...blockedIds].map(String));
  const asked = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 20;
  const cap = Math.min(asked, HARD_MAX);
  const has = new Set([...hasPlanIds].map(String));
  const sorted = [...(users || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const chosen = [];
  const skipped = [];
  for (const user of sorted) {
    const id = user._id;
    if (!shouldHavePlan(user)) skipped.push({ id, why: 'not_eligible' });
    else if (blocked.has(String(id))) skipped.push({ id, why: 'blocked' });
    else if (has.has(String(id))) skipped.push({ id, why: 'has_plan' });
    else if (chosen.length >= cap) skipped.push({ id, why: 'over_limit' });
    else chosen.push(user);
  }
  return { chosen, skipped };
}

const TERMINAL = ['completed', 'failed', 'stopped'];

// Polls one run until it ends. The runs live in the calling process, so the caller must not exit before this returns.
async function waitForRun({ id, findRun, sleep, now = () => Date.now(), pollMs = 15000, timeoutMs = 10 * 60 * 1000 }) {
  const t0 = now();
  for (;;) {
    const d = await findRun(id);
    if (!d) return { status: 'missing' };
    if (TERMINAL.includes(d.status)) return { status: d.status, stop: d.stop, error: d.error };
    if (now() - t0 >= timeoutMs) return { status: 'timeout' };
    await sleep(pollMs);
  }
}

const throttleDelayMs = (perMinute) => (perMinute > 0 ? Math.round(60000 / perMinute) : 60000);

module.exports = { waitForRun, selectForBackfill, throttleDelayMs, HARD_MAX, PLAN_RUN_INR_ESTIMATE };
