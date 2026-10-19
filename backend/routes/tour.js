// The guided tour's saved progress (/api/tour). Only the customer's own session writes it: staff accounts, a CSM pass and
// an agency client pass are refused, so looking at a customer's account never marks their tour done.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');

// Must equal the ids of TOUR_STEPS in frontend/utils/tour.ts (a test reads that file and compares).
const TOUR_STEP_IDS = Object.freeze(['welcome', 'create', 'library', 'plan', 'help']);
// The six-step tour before navigation phase 3 (2026-10-19): still accepted, so a page loaded before a release can save its step.
const OLD_STEP_IDS = Object.freeze(['review', 'calendar']);
const ACTIONS = ['step', 'complete', 'skip', 'replay'];

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const GENERIC_ERROR = 'We could not complete that request. Please try again.';
const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }, keyGenerator });
const isStaff = (user) => Boolean(user && (user.staffRole || user.isCsm));

function createTourRouter(impl = {}) {
  const router = express.Router();
  let UserModel = impl.User || null;
  const getUser = () => (UserModel = UserModel || require('../models/User'));

  router.put('/', protect, writeLimiter, async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      if (isStaff(req.user) || req.actingCsm || req.actingAgency) {
        return res.status(403).json({ success: false, message: 'The tour is only saved for the customer’s own session.' });
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = typeof body.action === 'string' ? body.action : '';
      if (!ACTIONS.includes(action)) return res.status(400).json({ success: false, message: 'Choose step, complete, skip or replay.' });
      if (action === 'step' && !(typeof body.step === 'string' && (TOUR_STEP_IDS.includes(body.step) || OLD_STEP_IDS.includes(body.step)))) {
        return res.status(400).json({ success: false, message: 'That tour step is not known.' });
      }
      const User = getUser();
      const now = new Date();
      if (action === 'complete') await User.updateOne({ _id: userId, 'tour.completedAt': { $exists: false } }, { $set: { 'tour.completedAt': now } });
      else if (action === 'skip') await User.updateOne({ _id: userId, 'tour.skippedAt': { $exists: false } }, { $set: { 'tour.skippedAt': now } });
      else if (action === 'replay') await User.updateOne({ _id: userId }, { $inc: { 'tour.replays': 1 } });
      else await User.updateOne({ _id: userId }, { $set: { 'tour.step': body.step } });
      const fresh = await User.findById(userId).select('tour').lean();
      const tour = (fresh && fresh.tour) || {};
      return res.status(200).json({ success: true, tour: { completedAt: tour.completedAt, skippedAt: tour.skippedAt } });
    } catch (err) {
      console.error('[tour] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  });

  return router;
}

const router = createTourRouter();
router.createTourRouter = createTourRouter;
router.TOUR_STEP_IDS = TOUR_STEP_IDS;
module.exports = router;
