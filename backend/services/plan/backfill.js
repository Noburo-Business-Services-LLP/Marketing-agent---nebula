'use strict';
// Pure planning for the one-off backfill of existing managed clients: who, in what order, how fast.
const { shouldHavePlan } = require('./planRules');

const HARD_MAX = 200;
const PLAN_RUN_INR_ESTIMATE = 5;

function selectForBackfill({ users, hasPlanIds = new Set(), limit = 20 }) {
  const asked = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 20;
  const cap = Math.min(asked, HARD_MAX);
  const has = new Set([...hasPlanIds].map(String));
  const sorted = [...(users || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const chosen = [];
  const skipped = [];
  for (const user of sorted) {
    const id = user._id;
    if (!shouldHavePlan(user)) skipped.push({ id, why: 'not_eligible' });
    else if (has.has(String(id))) skipped.push({ id, why: 'has_plan' });
    else if (chosen.length >= cap) skipped.push({ id, why: 'over_limit' });
    else chosen.push(user);
  }
  return { chosen, skipped };
}

const throttleDelayMs = (perMinute) => (perMinute > 0 ? Math.round(60000 / perMinute) : 60000);

module.exports = { selectForBackfill, throttleDelayMs, HARD_MAX, PLAN_RUN_INR_ESTIMATE };
