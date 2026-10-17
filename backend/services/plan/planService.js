'use strict';
// Plan runs: starts the system's own Blueprint run for an account, one at a time, never charged.
const { shouldHavePlan, canRefresh } = require('./planRules');
const { inputFromProfile } = require('./profileInput');

const ACTIVE = ['queued', 'processing'];

// Real dependencies are loaded on first use so requiring this file starts nothing.
function defaultDeps() {
  let svc = null;
  const blueprints = () => (svc = svc || require('../blueprint/service').createBlueprintService());
  return {
    loadUser: (id) => require('../../models/User').findById(id).lean(),
    findRuns: (q) => require('../../models/Blueprint').find({ kind: 'plan', ...q }).sort({ completedAt: -1, createdAt: -1 }).lean(),
    startSystem: (a) => blueprints().startSystem(a),
    saveState: (id, patch) => {
      const $set = {};
      Object.entries(patch).forEach(([k, v]) => { $set[`planState.${k}`] = v; });
      return require('../../models/User').updateOne({ _id: id }, { $set });
    },
    now: () => new Date()
  };
}

function createPlanService(deps = defaultDeps()) {
  const runsFor = (userId, extra = {}) => deps.findRuns({ userId, ...extra });

  async function inFlight(userId) {
    const rows = await runsFor(userId, { status: ACTIVE });
    return rows.length > 0;
  }

  async function startPlan({ userId /* , reason */ }) {
    const user = await deps.loadUser(userId);
    if (!user || !shouldHavePlan(user)) return { ok: false, reason: 'not_eligible' };
    if (await inFlight(userId)) return { ok: true, alreadyRunning: true };
    const out = await deps.startSystem({ user, input: inputFromProfile(user), kind: 'plan' });
    if (!out || out.ok === false) return { ok: false, reason: 'not_started', message: out && out.message };
    await deps.saveState(userId, { lastStartedAt: deps.now() });
    return { ok: true, id: out.id };
  }

  async function currentPlan(userId) {
    const rows = await runsFor(userId, { status: 'completed' });
    const done = rows.filter((d) => d.status === 'completed' && d.result)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    const d = done[0];
    return d ? { id: d.blueprintId, completedAt: d.completedAt, result: d.result } : null;
  }

  async function refresh({ userId, user: given, staff = false }) {
    const user = given || await deps.loadUser(userId || (given && given._id));
    const id = userId || (user && String(user._id));
    if (!user) return { ok: false, reason: 'not_eligible' };
    const rule = canRefresh({ user, now: deps.now(), staff });
    if (!rule.ok) return { ok: false, reason: 'too_soon', nextAt: rule.nextAt, message: rule.message };
    const r = await startPlan({ userId: id, reason: 'refresh' });
    if (r.ok && !r.alreadyRunning) await deps.saveState(id, { lastRefreshAt: deps.now() });
    return r;
  }

  return { startPlan, currentPlan, inFlight, refresh };
}

let sharedService = null;
const shared = () => (sharedService = sharedService || createPlanService());

// After a profile is saved: start the first plan if the account qualifies and has none yet.
async function maybeStartFirstPlan(userId, service = shared()) {
  if (!userId) return;
  if (await service.currentPlan(userId)) return;
  if (await service.inFlight(userId)) return;
  await service.startPlan({ userId, reason: 'first' });
}

// For routes: fire and forget. Never throws, never returns a promise the caller must wait for.
function maybeStartFirstPlanSafe(userId, { service, log = (m) => console.warn(m) } = {}) {
  try {
    Promise.resolve(maybeStartFirstPlan(userId, service || shared()))
      .catch((e) => log(`[plan] first plan not started for ${userId}: ${e && e.message}`));
  } catch (e) {
    log(`[plan] first plan not started for ${userId}: ${e && e.message}`);
  }
}

module.exports = { createPlanService, defaultDeps, maybeStartFirstPlan, maybeStartFirstPlanSafe };
