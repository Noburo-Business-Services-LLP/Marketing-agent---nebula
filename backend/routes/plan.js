// My plan routes (/api/plan). The plan is made by the system from the business profile; the customer can only read it
// and ask for a refresh (once a week). The user id is always read from the signed-in account, never from the request.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { resolveTier } = require('../config/entitlements');
const { shouldHavePlan, canRefresh, isStale, PLAN_REFRESH_DAYS } = require('../services/plan/planRules');
const { profileComplete } = require('../services/plan/profileInput');

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const GENERIC_ERROR = 'We could not complete that request. Please try again.';
const DAY_MS = 24 * 60 * 60 * 1000;

const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const makeLimiter = (max, message) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message }, keyGenerator });
const refreshLimiter = makeLimiter(5, 'You have sent too many requests. Please try again in a few minutes.');
const readLimiter = makeLimiter(600, 'You have sent too many requests. Please try again in a few minutes.');

// Blueprints made before plan runs existed have no kind, so "not a plan" is the test, as in the list and staff Usage.
const defaultFreeBlueprint = (userId, Model = require('../models/Blueprint')) => Model
  .findOne({ userId, kind: { $ne: 'plan' }, status: 'completed', freeSlot: true }).select('blueprintId').lean();

// The body of GET /api/plan for one account (the customer's own, or a client's when staff look).
async function viewFor(user, { service, now = new Date(), findFreeBlueprint = defaultFreeBlueprint }) {
  const userId = toUserId(user);
  const [plan, running, stoppedRun] = await Promise.all([service.currentPlan(userId), service.inFlight(userId), service.stoppedRun ? service.stoppedRun(userId) : null]);
  let eligible = false; let reason = ''; let missing = [];
  let freeBlueprint = null;
  if (shouldHavePlan(user)) {
    eligible = true;
  } else if (!user.staffRole && !user.isCsm && resolveTier(user) === 'free') {
    reason = 'free';
    const fb = await findFreeBlueprint(userId);
    freeBlueprint = fb ? { id: fb.blueprintId || String(fb._id) } : null;
  } else {
    const p = profileComplete(user);
    if (!p.complete) { reason = 'profile_incomplete'; missing = p.missing; } else reason = 'not_eligible';
  }
  // No plan yet means nothing to refresh, so the weekly limit does not apply.
  const rule = eligible && plan ? (service.refreshRule ? await service.refreshRule({ user, now }) : canRefresh({ user, now })) : { ok: true };
  const stopped = eligible && !running && stoppedRun ? { message: stoppedRun.message } : null;
  const failed = Boolean(eligible && !plan && !running && !stopped && user.planState && user.planState.firstPlanFailedAt);
  return {
    success: true,
    plan: plan ? { id: plan.id, completedAt: plan.completedAt, stale: isStale(plan, now), result: plan.result } : null,
    running: Boolean(running),
    failed,
    stopped,
    nextRefreshAt: !rule.ok && rule.nextAt ? new Date(rule.nextAt).toISOString() : null,
    eligible, reason, missing, freeBlueprint
  };
}

const startedMessage = 'We are updating your plan. It usually takes a few minutes.';

// Turns the service's answer for a refresh into a status and body. Used by the customer and the staff route.
function refreshReply(out, nextRefreshAt) {
  if (out && out.ok) return { status: 200, json: { success: true, message: out.alreadyRunning ? 'Your plan is already being updated.' : startedMessage, nextRefreshAt } };
  if (out && out.reason === 'too_soon') return { status: 429, json: { success: false, message: out.message, nextRefreshAt: out.nextAt ? new Date(out.nextAt).toISOString() : null } };
  if (out && out.reason === 'not_eligible') return { status: 400, json: { success: false, message: 'A plan is made once your business profile is complete on a paid plan.' } };
  if (out && out.reason === 'invalid_input') return { status: 400, json: { success: false, message: 'Your plan needs a website or Instagram page we can read. Check it in your Business profile.' } };
  if (out && (out.reason === 'busy' || out.reason === 'daily_cap')) return { status: 503, json: { success: false, message: 'We are busy right now, please try again later' } };
  return { status: 503, json: { success: false, message: 'We could not start your plan just now. Please try again later.' } };
}

// Staff: refresh a client's plan. Ignores the weekly limit and is written to the staff log.
async function staffRefresh({ client, staff, service, record, now = new Date() }) {
  const out = await service.refresh({ userId: String(client._id), staff: true });
  if (out && out.ok && !out.alreadyRunning) await record({ actor: staff, action: 'refresh_plan', client: client._id });
  return refreshReply(out, null);
}

// Staff: the same body the customer sees, plus the last run.
async function staffView({ client, service, lastRun, now = new Date(), findFreeBlueprint }) {
  const body = await viewFor(client, { service, now, findFreeBlueprint });
  const run = (await lastRun(String(client._id))) || null;
  return { ...body, lastRunAt: run ? (run.completedAt || run.createdAt || null) : null, lastStatus: run ? run.status : null };
}

function createPlanRouter(impl = {}) {
  const router = express.Router();
  let service = impl.service || null;
  const getService = () => (service = service || require('../services/plan/planService').createPlanService());
  const now = impl.now || (() => new Date());

  const handle = (fn) => async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      const out = await fn(getService(), req, userId);
      return res.status(out.status).json(out.json);
    } catch (err) {
      console.error('[plan] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  };

  router.get('/', protect, readLimiter, handle(async (svc, req) => ({
    status: 200, json: await viewFor(req.user, { service: svc, now: now(), findFreeBlueprint: impl.findFreeBlueprint })
  })));
  router.post('/refresh', protect, refreshLimiter, handle(async (svc, req, userId) => {
    const out = await svc.refresh({ userId, user: req.user, staff: false });
    return refreshReply(out, new Date(now().getTime() + PLAN_REFRESH_DAYS * DAY_MS).toISOString());
  }));

  return router;
}

const router = createPlanRouter();
router.createPlanRouter = createPlanRouter;
router.viewFor = viewFor;
router.staffView = staffView;
router.staffRefresh = staffRefresh;
router.refreshReply = refreshReply;
router.defaultFreeBlueprint = defaultFreeBlueprint;
module.exports = router;
