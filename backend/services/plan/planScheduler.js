'use strict';
// The monthly plan refresh and the retries for a first plan that failed. Deps are injected for tests; the defaults use Mongo.
const { shouldHavePlan, monthlyDue, PLAN_MONTHLY_DAYS } = require('./planRules');

const RETRY_PAUSE_MS = 30 * 60 * 1000;
const MAX_RETRIES = 2;
const MONTHLY_COOLDOWN_MS = 12 * 3600 * 1000;
const FAILED_COOLDOWN_MS = 24 * 3600 * 1000;
const MAX_MONTHLY_FAILURES = 3;
const DEFAULT_INTERVAL_MS = 6 * 3600 * 1000;
const FIRST_TICK_MS = 15 * 60 * 1000;
const PER_TICK_LIMIT = 5;
const FAILED_LOOKBACK_MS = 14 * 86400000;
const FAILED_SCAN_LIMIT = 200;
const HALT_REASONS = ['busy', 'daily_cap'];

function defaultDeps({ User = () => require('../../models/User'), Blueprint = () => require('../../models/Blueprint'), gate = () => require('../backgroundGate').blockedAccountIdsSafe() } = {}) {
  let svc = null;
  const plans = () => (svc = svc || require('./planService').createPlanService());
  const active = (id) => Blueprint().exists({ userId: id, kind: 'plan', status: { $in: ['queued', 'processing'] } });
  const newest = (id) => Blueprint().findOne({ userId: id, kind: 'plan' }).sort({ createdAt: -1 }).select('status').lean();
  return {
    // Only accounts that already have a completed plan older than 30 days can be due: first plans start from the
    // profile save, the backfill script or the button, never here. Ineligible accounts never enter the window.
    candidates: async (now = new Date()) => {
      const blocked = await gate();
      const old = await Blueprint().distinct('userId', { kind: 'plan', status: 'completed', completedAt: { $lt: new Date(new Date(now).getTime() - PLAN_MONTHLY_DAYS * 86400000) } });
      if (!old.length) return [];
      const ids = blocked.length ? old.filter((id) => !blocked.map(String).includes(String(id))) : old;
      return User().find({
        _id: { $in: ids }, onboardingCompleted: true, isActive: { $ne: false }, staffRole: null, isCsm: { $ne: true }, 'plan.tier': { $ne: 'free' }
      }).sort({ 'planState.lastStartedAt': 1 }).limit(200).lean();
    },
    lastPlanAt: async (id) => {
      const d = await Blueprint().findOne({ userId: id, kind: 'plan', status: 'completed' }).sort({ completedAt: -1 }).select('completedAt').lean();
      return d ? d.completedAt : null;
    },
    inFlight: async (id) => !!(await active(id)),
    lastRunFailed: async (id) => { const d = await newest(id); return !!d && d.status === 'failed'; },
    lastRunStopped: async (id) => { const d = await newest(id); return !!d && d.status === 'stopped'; },
    startPlan: (a) => plans().startPlan(a),
    // Failed first plans from the last two weeks, newest run failed, no plan and nothing running. Stopped runs are not here.
    failedFirst: async (now = new Date()) => {
      const rows = await Blueprint().find({ kind: 'plan', status: 'failed', createdAt: { $gte: new Date(new Date(now).getTime() - FAILED_LOOKBACK_MS) } }).sort({ createdAt: -1 }).limit(FAILED_SCAN_LIMIT).select('userId').lean();
      const ids = [...new Set(rows.map((r) => String(r.userId)))];
      if (!ids.length) return [];
      const blockedSet = new Set((await gate()).map(String));
      const out = [];
      for (const id of ids) {
        if (blockedSet.has(id)) continue;
        if (await Blueprint().exists({ userId: id, kind: 'plan', status: { $in: ['completed', 'queued', 'processing'] } })) continue;
        const d = await newest(id);
        if (!d || d.status !== 'failed') continue;
        const user = await User().findOne({ _id: id, 'planState.firstPlanFailedAt': null }).lean();
        if (user) out.push({ user, state: user.planState || {} });
      }
      return out;
    },
    saveState: (id, patch) => {
      const $set = {};
      Object.entries(patch).forEach(([k, v]) => { $set[`planState.${k}`] = v; });
      return User().updateOne({ _id: id }, { $set });
    },
    countAttempt: (id) => User().updateOne({ _id: id }, { $inc: { 'planState.attempts': 1 } }),
    alert: (m) => { try { require('../opsAlerts').recordFailure('plan', m); } catch (_) { /* alerting never stops the run */ } }
  };
}

async function runMonthlyOnce({ deps = defaultDeps(), now = new Date(), limit = PER_TICK_LIMIT } = {}) {
  const rows = await deps.candidates(now);
  let started = 0; let skipped = 0; let halted = null;
  for (const user of rows) {
    if (halted) break;
    if (started >= limit) { skipped += 1; continue; }
    try {
      if (!shouldHavePlan(user)) { skipped += 1; continue; }
      const id = String(user._id);
      if (await deps.inFlight(id)) { skipped += 1; continue; }
      const state = user.planState || {};
      if (state.firstPlanFailedAt) { skipped += 1; continue; }
      const lastPlanAt = await deps.lastPlanAt(id);
      const failed = deps.lastRunFailed ? !!(await deps.lastRunFailed(id)) : false;
      if (!lastPlanAt) { skipped += 1; continue; } // no plan yet: the profile save, the backfill or the button start it, and the retry logic owns a failed one
      if (deps.lastRunStopped && await deps.lastRunStopped(id)) { skipped += 1; continue; } // stopped runs are never retried automatically
      if (!failed && (state.attempts || 0) > 0 && deps.saveState) await deps.saveState(id, { attempts: 0 });
      if (failed && (state.attempts || 0) >= MAX_MONTHLY_FAILURES) {
        if (deps.saveState) await deps.saveState(id, { firstPlanFailedAt: new Date(now) });
        if (deps.alert) deps.alert(`monthly plan failed ${MAX_MONTHLY_FAILURES} times for ${id}`);
        skipped += 1; continue;
      }
      const since = state.lastStartedAt ? new Date(now).getTime() - new Date(state.lastStartedAt).getTime() : Infinity;
      if (since < (failed ? FAILED_COOLDOWN_MS : MONTHLY_COOLDOWN_MS)) { skipped += 1; continue; }
      if (!monthlyDue({ lastPlanAt, now })) { skipped += 1; continue; }
      const r = await deps.startPlan({ userId: id, reason: 'monthly' });
      if (r && r.ok && !r.alreadyRunning) {
        started += 1;
        if (deps.countAttempt) await deps.countAttempt(id);
      } else {
        skipped += 1;
        if (r && HALT_REASONS.includes(r.reason)) halted = r.reason; // the system is busy or at its cap: stop for this tick
      }
    } catch (e) {
      skipped += 1;
      console.warn(`[plan] monthly run skipped ${user && user._id}: ${e && e.message}`);
    }
  }
  return { started, skipped, halted };
}

// A first plan that failed: retry up to twice, 30 minutes apart (each start counts an attempt), then alert once.
async function retryFailedFirstPlans({ deps = defaultDeps(), now = new Date() } = {}) {
  const rows = await deps.failedFirst(now);
  let halted = null;
  for (const { user, state = {} } of rows) {
    if (halted) break;
    try {
      const id = String(user._id);
      if (state.firstPlanFailedAt) continue;
      if ((state.attempts || 0) >= MAX_RETRIES) {
        await deps.saveState(id, { firstPlanFailedAt: new Date(now) });
        deps.alert(`first plan failed for ${id}`);
        continue;
      }
      const last = state.lastStartedAt ? new Date(state.lastStartedAt).getTime() : 0;
      if (new Date(now).getTime() - last < RETRY_PAUSE_MS) continue;
      const r = await deps.startPlan({ userId: id, reason: 'retry' });
      if (r && HALT_REASONS.includes(r.reason)) halted = r.reason;
    } catch (e) {
      console.warn(`[plan] retry failed for ${user && user._id}: ${e && e.message}`);
    }
  }
  return { halted };
}

// One pass: end plan runs the process lost, retry failed first plans, then the monthly refreshes.
async function runSchedulerTick({ deps = defaultDeps(), plans = null, now = new Date() } = {}) {
  try { await (plans || require('./planService').createPlanService()).reapStalePlanRuns({ now }); } catch (e) { console.warn('[plan] could not end stale plan runs:', e && e.message); }
  // The retry path counts each start as an attempt.
  const retryDeps = { ...deps, startPlan: async (a) => { const r = await deps.startPlan(a); if (r && r.ok && !r.alreadyRunning && deps.countAttempt) await deps.countAttempt(a.userId); return r; } };
  const retried = await retryFailedFirstPlans({ deps: retryDeps, now });
  if (retried && retried.halted) return { halted: retried.halted };
  return runMonthlyOnce({ deps, now });
}

function startPlanScheduler({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (process.env.NODE_ENV === 'test') return null;
  if (String(process.env.ENABLE_PLAN_SCHEDULER || 'on').toLowerCase() === 'off') return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick({ now: new Date() });
    } catch (e) {
      console.warn('[plan] scheduler tick failed:', e && e.message);
    } finally { running = false; }
  };
  console.log(`[plan] scheduler on, every ${Math.round(intervalMs / 3600000)}h`);
  const t = setInterval(tick, intervalMs); t.unref();
  const first = setTimeout(tick, FIRST_TICK_MS); first.unref();
  return t;
}

module.exports = { runMonthlyOnce, retryFailedFirstPlans, runSchedulerTick, startPlanScheduler, defaultDeps, FIRST_TICK_MS, PER_TICK_LIMIT };
