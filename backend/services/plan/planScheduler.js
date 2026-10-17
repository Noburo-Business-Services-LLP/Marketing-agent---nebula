'use strict';
// The monthly plan refresh and the retries for a first plan that failed. Deps are injected for tests; the defaults use Mongo.
const { shouldHavePlan, monthlyDue } = require('./planRules');

const RETRY_PAUSE_MS = 30 * 60 * 1000;
const MAX_RETRIES = 2;
const DEFAULT_INTERVAL_MS = 6 * 3600 * 1000;

function defaultDeps() {
  const Blueprint = () => require('../../models/Blueprint');
  const User = () => require('../../models/User');
  let svc = null;
  const plans = () => (svc = svc || require('./planService').createPlanService());
  const active = (id) => Blueprint().exists({ userId: id, kind: 'plan', status: { $in: ['queued', 'processing'] } });
  return {
    candidates: async () => {
      const blocked = await require('../backgroundGate').blockedAccountIdsSafe();
      return User().find({
        onboardingCompleted: true, isActive: { $ne: false }, staffRole: null, isCsm: { $ne: true },
        ...(blocked.length ? { _id: { $nin: blocked } } : {})
      }).sort({ 'planState.lastStartedAt': 1 }).limit(200).lean();
    },
    lastPlanAt: async (id) => {
      const d = await Blueprint().findOne({ userId: id, kind: 'plan', status: 'completed' }).sort({ completedAt: -1 }).select('completedAt').lean();
      return d ? d.completedAt : null;
    },
    inFlight: async (id) => !!(await active(id)),
    startPlan: (a) => plans().startPlan(a),
    failedFirst: async () => {
      const ids = await Blueprint().distinct('userId', { kind: 'plan', status: 'failed' });
      if (!ids.length) return [];
      const blocked = await require('../backgroundGate').blockedAccountIdsSafe();
      const blockedSet = new Set(blocked.map(String));
      const out = [];
      for (const id of ids) {
        if (blockedSet.has(String(id))) continue;
        if (await Blueprint().exists({ userId: id, kind: 'plan', status: { $in: ['completed', 'queued', 'processing'] } })) continue;
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

async function runMonthlyOnce({ deps = defaultDeps(), now = new Date(), limit = 20 } = {}) {
  const rows = await deps.candidates();
  let started = 0; let skipped = 0;
  for (const user of rows) {
    if (started >= limit) { skipped += 1; continue; }
    try {
      if (!shouldHavePlan(user)) { skipped += 1; continue; }
      const id = String(user._id);
      if (await deps.inFlight(id)) { skipped += 1; continue; }
      if (!monthlyDue({ lastPlanAt: await deps.lastPlanAt(id), now })) { skipped += 1; continue; }
      const r = await deps.startPlan({ userId: id, reason: 'monthly' });
      if (r && r.ok && !r.alreadyRunning) started += 1; else skipped += 1;
    } catch (e) {
      skipped += 1;
      console.warn(`[plan] monthly run skipped ${user && user._id}: ${e && e.message}`);
    }
  }
  return { started, skipped };
}

// A first plan that failed: retry up to twice, 30 minutes apart (each start counts an attempt), then alert once.
async function retryFailedFirstPlans({ deps = defaultDeps(), now = new Date() } = {}) {
  const rows = await deps.failedFirst();
  for (const { user, state = {} } of rows) {
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
      await deps.startPlan({ userId: id, reason: 'retry' });
    } catch (e) {
      console.warn(`[plan] retry failed for ${user && user._id}: ${e && e.message}`);
    }
  }
}

function startPlanScheduler({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (process.env.NODE_ENV === 'test') return null;
  if (String(process.env.ENABLE_PLAN_SCHEDULER || 'on').toLowerCase() === 'off') return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const deps = defaultDeps();
      // The retry path counts each start as an attempt.
      const retryDeps = { ...deps, startPlan: async (a) => { const r = await deps.startPlan(a); if (r && r.ok && !r.alreadyRunning) await deps.countAttempt(a.userId); return r; } };
      await retryFailedFirstPlans({ deps: retryDeps });
      await runMonthlyOnce({ deps });
    } catch (e) {
      console.warn('[plan] scheduler tick failed:', e && e.message);
    } finally { running = false; }
  };
  console.log(`[plan] scheduler on, every ${Math.round(intervalMs / 3600000)}h`);
  const t = setInterval(tick, intervalMs); t.unref();
  const first = setTimeout(tick, 2 * 60 * 1000); first.unref();
  return t;
}

module.exports = { runMonthlyOnce, retryFailedFirstPlans, startPlanScheduler, defaultDeps };
