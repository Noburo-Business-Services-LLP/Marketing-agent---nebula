// The weekly proposal routes (/api/week) and the setup path (/api/setup). The user id is always the signed-in account's
// (inside an agency or CSM pass req.user already is the client). Approve only claims posts and answers at once; the slow
// work (charging and making each post) runs in the background and is picked up again on the next page load if it stops.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { resolveTier } = require('../config/entitlements');
const { shouldHavePlan } = require('../services/plan/planRules');
const { setupSteps } = require('../services/week/setupSteps');
const { connectedCount } = require('../services/staff/clientStatus');

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const GENERIC_ERROR = 'We could not complete that request. Please try again.';
const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const makeLimiter = (max, message) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message }, keyGenerator });
const writeLimiter = makeLimiter(30, 'You have sent too many requests. Please try again in a few minutes.');
const readLimiter = makeLimiter(600, 'You have sent too many requests. Please try again in a few minutes.');

// Unset or anything but "off" means on.
const weekIsOff = () => String(process.env.ENABLE_WEEKLY_PROPOSAL || '').trim().toLowerCase() === 'off';
const isStaff = (user) => Boolean(user && (user.staffRole || user.isCsm));
const STALE_MS = 10 * 60 * 1000;
// A page load starts a run only when there is something to make: an approved post, or one left 'making' for over ten
// minutes. A post that is merely being made right now must not start a parallel runner on every poll.
const needsRun = (proposal, now = Date.now()) => Boolean(proposal && Array.isArray(proposal.items) && proposal.items.some((i) => i && i.kind === 'post'
  && (i.status === 'approved' || (i.status === 'making' && i.makingAt && now - new Date(i.makingAt).getTime() > STALE_MS))));
// Only the customer's own session counts for setup steps, not a CSM, agency or staff pass.
const isOwnSession = (req) => !req.actingCsm && !req.actingAgency && !req.user.staffRole && !req.user.isCsm;

function createWeekRouter(impl = {}) {
  const router = express.Router();
  let week = impl.week || null;
  const getWeek = () => (week = week || require('../services/week/weekService').createWeekService());
  // Accounts background work must leave alone (paused, frozen, waiting to be deleted).
  const gate = impl.gate || (() => require('../services/backgroundGate').blockedAccountIds());
  const eligibleFor = impl.shouldHavePlan || shouldHavePlan;
  const blocked = async (userId) => (await gate()).some((id) => String(id) === userId);

  const run = (svc, user) => {
    // Fire and forget: never awaited, an error is only logged.
    try { Promise.resolve(svc.runApprovedPosts({ user })).catch((e) => console.error('[week] background run failed:', e && e.message)); }
    catch (e) { console.error('[week] background run failed:', e && e.message); }
  };

  const handle = (fn, { write = false } = {}) => async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      if (write) {
        if (weekIsOff()) return res.status(403).json({ success: false, message: 'Weekly posts are switched off for now.' });
        if (isStaff(req.user)) return res.status(403).json({ success: false, message: 'Staff accounts do not have a weekly plan.' });
      }
      const out = await fn(getWeek(), req, userId);
      return res.status(out.status).json(out.json);
    } catch (err) {
      console.error('[week] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  };

  router.get('/', protect, readLimiter, handle(async (svc, req, userId) => {
    if (weekIsOff()) return { status: 200, json: { success: true, eligible: false, reason: 'off', proposal: null } };
    const out = await svc.getOrCreate({ user: req.user });
    const proposal = out.proposal || null;
    // A crash in the middle of a run is picked up again here.
    if (out.eligible && needsRun(proposal)) {
      // If the gate cannot be read the run is skipped (a later load tries again); the page itself still loads.
      let skip = true;
      try { skip = await blocked(userId); } catch (e) { console.error('[week] background gate unreadable, run skipped:', e && e.message); }
      if (!skip) run(svc, req.user);
    }
    return { status: 200, json: { success: true, eligible: Boolean(out.eligible), reason: out.reason || '', proposal, topUp: out.reason === 'empty' } };
  }));

  router.post('/approve', protect, writeLimiter, handle(async (svc, req, userId) => {
    if (!eligibleFor(req.user)) return { status: 403, json: { success: false, message: 'Your weekly posts are not available for this account.' } };
    if (await blocked(userId)) return { status: 403, json: { success: false, message: 'This account is paused, so posts cannot be made right now.' } };
    const ids = req.body && req.body.itemIds;
    const itemIds = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, 50) : undefined;
    const out = await svc.approve({ user: req.user, itemIds, stampFirst: isOwnSession(req) });
    if (out.message && !out.started && !(out.prefills && out.prefills.length)) return { status: 409, json: { success: false, message: out.message, proposal: out.proposal || null } };
    if ((out.started > 0) || needsRun(out.proposal)) run(svc, req.user);
    return { status: 200, json: { success: true, proposal: out.proposal || null, prefills: out.prefills || [] } };
  }, { write: true }));

  router.post('/items/:id', protect, writeLimiter, handle(async (svc, req) => {
    const action = req.body && req.body.action;
    if (action !== 'skip' && action !== 'swap') return { status: 400, json: { success: false, message: 'Choose skip or swap.' } };
    const topic = typeof (req.body && req.body.topic) === 'string' ? req.body.topic.trim().slice(0, 200) : undefined;
    const out = await svc.change({ user: req.user, itemId: req.params.id, action, topic });
    if (out && out.ok) return { status: 200, json: { success: true, proposal: out.proposal || null } };
    if (out && out.error === 'topic_required') return { status: 400, json: { success: false, message: 'Write the topic you want instead.' } };
    return { status: 409, json: { success: false, message: 'That post can no longer be changed.' } };
  }, { write: true }));

  // The create screen reports back a carousel or video it made, so the card stops offering it again.
  router.post('/items/:id/made', protect, writeLimiter, handle(async (svc, req) => {
    const ref = req.body && req.body.ref;
    if (typeof ref !== 'string' || !ref.trim() || ref.length > 100) return { status: 400, json: { success: false, message: 'Tell us which one was made.' } };
    const weekStart = req.body && typeof req.body.weekId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.weekId) ? req.body.weekId : undefined;
    const out = await svc.markMade({ user: req.user, itemId: req.params.id, ref: ref.trim(), weekStart });
    if (out && out.ok) return { status: 200, json: { success: true, proposal: out.proposal || null } };
    return { status: 409, json: { success: false, message: 'That item cannot be marked as made.' } };
  }, { write: true }));

  router.post('/skip', protect, writeLimiter, handle(async (svc, req) => {
    const out = await svc.skipWeek({ user: req.user });
    if (out && out.ok) return { status: 200, json: { success: true, proposal: out.proposal || null } };
    return { status: 409, json: { success: false, message: 'This week can no longer be skipped.' } };
  }, { write: true }));

  return router;
}

// connectedCount is the larger of the accounts saved on the user and the ones the posting provider reports active, the
// same count staff see, because either side can lag behind the other.
function createSetupRouter(impl = {}) {
  const router = express.Router();
  let plan = impl.plan || null;
  const getPlan = () => (plan = plan || require('../services/plan/planService').createPlanService());
  router.get('/', protect, readLimiter, async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      const user = req.user;
      const current = await getPlan().currentPlan(userId);
      const setup = user.setup || {};
      const out = setupSteps({ user, state: {
        connectedCount: connectedCount(user), hasPlan: Boolean(current), planOpened: Boolean(setup.planOpenedAt),
        firstWeekApproved: Boolean(setup.firstWeekApprovedAt), isPaid: resolveTier(user) !== 'free'
      } });
      return res.status(200).json({ success: true, steps: out.steps, next: out.next, allDone: out.allDone });
    } catch (err) {
      console.error('[setup] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  });
  return router;
}

const router = createWeekRouter();
router.createWeekRouter = createWeekRouter;
router.createSetupRouter = createSetupRouter;
router.setupRouter = createSetupRouter();
module.exports = router;
