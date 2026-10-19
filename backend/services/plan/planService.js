'use strict';
// Plan runs: starts the system's own Blueprint run for an account, one at a time, never charged.
const { shouldHavePlan, canRefresh } = require('./planRules');
const { inputFromProfile } = require('./profileInput');
const { LIMITS, PLAN_LIMITS } = require('../../config/blueprint');

const ACTIVE = ['queued', 'processing'];
const CLAIM_MS = 60 * 1000;          // a start claim holds this long
const HOOK_PAUSE_MS = 60 * 60 * 1000; // the profile-save hook starts nothing within this long of the last start
const PASS_THROUGH = ['busy', 'daily_cap', 'invalid_input'];

// Real dependencies are loaded on first use so requiring this file starts nothing.
function defaultDeps() {
  let svc = null;
  const blueprints = () => (svc = svc || require('../blueprint/service').createBlueprintService());
  const User = () => require('../../models/User');
  const Blueprint = () => require('../../models/Blueprint');
  return {
    loadUser: (id) => User().findById(id).lean(),
    // The account's own catalogue for the planner: a few fields, oldest first, capped.
    loadProducts: (id) => require('../../models/Product').find({ user: id }).sort({ createdAt: 1 }).limit(PLAN_LIMITS.MAX_PRODUCTS)
      .select('name type price priceNote currency description keyFeatures').lean(),
    // What Nebulaa learned (the shared prompt helper), without the plan's own items: a new plan is not fed its old self.
    loadLearned: (id) => require('../brandMemory/prompt').loadMemoryLines(id, { exclude: ['plan'], maxLines: PLAN_LIMITS.MAX_LEARNED }),
    findRuns: (q) => Blueprint().find({ kind: 'plan', ...q }).sort({ completedAt: -1, createdAt: -1 }).lean(),
    latestRun: (userId) => Blueprint().findOne({ kind: 'plan', userId }).sort({ createdAt: -1 }).lean(),
    failRun: (blueprintId, at) => Blueprint().updateOne(
      { blueprintId, kind: 'plan', status: { $in: ACTIVE } },
      { $set: { status: 'failed', step: 'failed', freeSlot: false, error: { message: 'interrupted' }, heartbeatAt: at } }
    ),
    startSystem: (a) => blueprints().startSystem(a),
    saveState: (id, patch) => {
      const $set = {};
      Object.entries(patch).forEach(([k, v]) => { $set[`planState.${k}`] = v; });
      return User().updateOne({ _id: id }, { $set });
    },
    // One conditional update: the first caller sets the claim, a second one inside the window gets nothing back.
    claimStart: (id, now) => User().findOneAndUpdate(
      { _id: id, $or: [{ 'planState.startingAt': null }, { 'planState.startingAt': { $exists: false } }, { 'planState.startingAt': { $lt: new Date(now.getTime() - CLAIM_MS) } }] },
      { $set: { 'planState.startingAt': now } }
    ).select('_id').lean(),
    releaseStart: (id) => User().updateOne({ _id: id }, { $set: { 'planState.startingAt': null } }),
    now: () => new Date()
  };
}

const at = (v) => (v ? new Date(v).getTime() : NaN);

function createPlanService(deps = defaultDeps()) {
  const runsFor = (userId, extra = {}) => deps.findRuns({ userId, ...extra });
  // A run whose heartbeat stopped is dead (a restart or deploy took it), never "in flight". A run with no heartbeat is trusted.
  const isLive = (d, now) => { const hb = at(d.heartbeatAt || d.createdAt); return !(Number.isFinite(hb) && now.getTime() - hb > LIMITS.STALE_MS); };

  async function inFlight(userId) {
    const rows = await runsFor(userId, { status: ACTIVE });
    const now = deps.now();
    return rows.some((d) => isLive(d, now));
  }

  // The newest run, when it stopped (not enough to go on, or the website could not be read).
  async function stoppedRun(userId) {
    const d = deps.latestRun ? await deps.latestRun(userId) : null;
    if (!d || d.status !== 'stopped') return null;
    return { message: (d.stop && d.stop.message) || 'We could not find enough about your business to build a plan.', createdAt: d.createdAt };
  }

  // Marks plan runs the process lost as failed ("interrupted"), never touching a charge. `all` is for boot: the
  // queue lives in this process, so after a restart every queued or processing plan run is dead.
  async function reapStalePlanRuns({ now = deps.now(), all = false } = {}) {
    const rows = await deps.findRuns({ status: ACTIVE });
    let reaped = 0;
    for (const d of rows) {
      if (!all && isLive(d, now)) continue;
      try { await deps.failRun(d.blueprintId, now); reaped += 1; } catch (e) { console.warn(`[plan] could not end stale run ${d.blueprintId}: ${e && e.message}`); }
    }
    return { reaped };
  }

  async function startPlan({ userId /* , reason */ }) {
    const user = await deps.loadUser(userId);
    if (!user || !shouldHavePlan(user)) return { ok: false, reason: 'not_eligible' };
    if (await inFlight(userId)) return { ok: true, alreadyRunning: true };
    if (deps.claimStart && !(await deps.claimStart(userId, deps.now()))) return { ok: true, alreadyRunning: true };
    let out = null;
    try {
      // The products are a help, never a blocker: if they cannot be read the plan is built without them.
      let products = [];
      if (deps.loadProducts) { try { products = (await deps.loadProducts(userId)) || []; } catch (e) { console.warn(`[plan] products not read for ${userId}: ${e && e.message}`); } }
      // What Nebulaa learned is a help too: never a blocker.
      let learned = [];
      if (deps.loadLearned) { try { learned = (await deps.loadLearned(userId)) || []; } catch (e) { console.warn(`[plan] learned lines not read for ${userId}: ${e && e.message}`); } }
      out = await deps.startSystem({ user, input: inputFromProfile(user, { products, learned }), kind: 'plan' });
    } catch (e) {
      if (deps.releaseStart) await deps.releaseStart(userId);
      throw e;
    }
    if (!out || out.ok === false) {
      if (deps.releaseStart) await deps.releaseStart(userId);
      const reason = out && PASS_THROUGH.includes(out.reason) ? out.reason : 'not_started';
      return { ok: false, reason, message: out && out.message, ...(out && out.errors ? { errors: out.errors } : {}) };
    }
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

  // The weekly limit applies only when there is a plan to refresh, and not right after a stopped run for a profile
  // the customer has since changed.
  async function refreshRule({ user, now, staff = false }) {
    if (staff) return { ok: true };
    const id = String(user._id);
    if (!(await currentPlan(id))) return { ok: true };
    const stopped = await stoppedRun(id);
    if (stopped && at(user.updatedAt) > at(stopped.createdAt)) return { ok: true };
    return canRefresh({ user, now, staff });
  }

  async function refresh({ userId, user: given, staff = false }) {
    const user = given || await deps.loadUser(userId || (given && given._id));
    const id = userId || (user && String(user._id));
    if (!user) return { ok: false, reason: 'not_eligible' };
    const hadPlan = !!(await currentPlan(id));
    const rule = await refreshRule({ user, now: deps.now(), staff });
    if (!rule.ok) return { ok: false, reason: 'too_soon', nextAt: rule.nextAt, message: rule.message };
    const r = await startPlan({ userId: id, reason: 'refresh' });
    if (r.ok && !r.alreadyRunning) {
      // A staff refresh does not use up the customer's week, and building the first plan is not a refresh.
      await deps.saveState(id, { ...(staff || !hadPlan ? {} : { lastRefreshAt: deps.now() }), firstPlanFailedAt: null, attempts: 0 });
    }
    return r;
  }

  // The profile-save hook: only when a first plan has not failed for good, nothing started in the last hour, and a
  // stopped run is followed by a real change to the profile.
  async function firstPlanAllowed(userId) {
    const user = await deps.loadUser(userId);
    if (!user) return { ok: false, reason: 'no_user' };
    const st = user.planState || {};
    if (st.firstPlanFailedAt) return { ok: false, reason: 'failed_before' };
    if (st.lastStartedAt && deps.now().getTime() - at(st.lastStartedAt) < HOOK_PAUSE_MS) return { ok: false, reason: 'recent' };
    const stopped = await stoppedRun(userId);
    if (stopped && !(at(user.updatedAt) > at(stopped.createdAt))) return { ok: false, reason: 'stopped_unchanged' };
    return { ok: true };
  }

  return { startPlan, currentPlan, inFlight, refresh, reapStalePlanRuns, stoppedRun, firstPlanAllowed, refreshRule };
}

let sharedService = null;
const shared = () => (sharedService = sharedService || createPlanService());

// After a profile is saved: start the first plan if the account qualifies and has none yet.
async function maybeStartFirstPlan(userId, service = shared()) {
  if (!userId) return;
  if (await service.currentPlan(userId)) return;
  if (await service.inFlight(userId)) return;
  const gate = await service.firstPlanAllowed(userId);
  if (!gate.ok) return;
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

// Boot and the scheduler tick call these. Never throw.
const reapOnBoot = () => shared().reapStalePlanRuns({ all: true });

module.exports = { createPlanService, defaultDeps, maybeStartFirstPlan, maybeStartFirstPlanSafe, reapOnBoot };
