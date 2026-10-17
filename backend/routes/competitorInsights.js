// Competitor insights (/api/competitors/insights). What the weekly tracker found for the signed-in account's own
// competitors, as short sentences and a small trend. Raw snapshots are never returned, and only competitors that belong
// to the signed-in account are ever read. Refused for accounts without the competitors add-on (the standard message).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const caps = require('../config/competitors');
const { weekStartOf } = require('../services/week/weekMath');
const { insights } = require('../services/competitors/snapshot');
const { handleOf, handleStatusOf, isValidHandle, trackedCompetitors, competitorsQuery } = require('../services/competitors/tracked');

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const GENERIC_ERROR = 'We could not complete that request. Please try again.';

const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const makeLimiter = (max, message) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message }, keyGenerator });
const TOO_MANY = 'You have sent too many requests. Please try again in a few minutes.';
const readLimiter = makeLimiter(600, TOO_MANY);
const checkLimiter = makeLimiter(20, TOO_MANY);

function defaultDeps() {
  let store = null;
  const lazyStore = () => (store = store || require('../services/competitors/snapshotStore').snapshotStore());
  return {
    // The same query and the same trackedCompetitors() list the weekly tracker uses.
    competitorsFor: (userId) => competitorsQuery(require('../models/Competitor'), userId),
    store: { latest: (...a) => lazyStore().latest(...a), lastAttempt: (...a) => lazyStore().lastAttempt(...a) }
  };
}
const withDefaults = (deps) => ({ ...defaultDeps(), ...(deps || {}) });

// Why a competitor shows the way it does. Order matters: no (usable) handle, a handle nobody confirmed yet, paused,
// a failed latest check, then waiting.
function statusOf({ competitor, attempt, snapshots, week }) {
  const handle = handleOf(competitor);
  if (!handle || !isValidHandle(handle)) return 'no_handle';
  if (handleStatusOf(competitor) === 'suggested') return 'unconfirmed';
  if (competitor.tracking && competitor.tracking.pausedAt) return 'paused';
  const okThisWeek = snapshots.some((s) => s.weekStart === week);
  if (attempt && attempt.ok === false && !okThisWeek) return 'failed';
  if (!attempt && !snapshots.length) return 'waiting';
  if (!snapshots.length && !(attempt && attempt.ok === false)) return 'waiting';
  return 'tracking';
}

// The body for one account: the customer's own look, and the same thing for a client when staff look.
async function viewFor(user, { deps, now = new Date() } = {}) {
  const d = withDefaults(deps);
  const userId = toUserId(user);
  const week = weekStartOf(now);
  const all = (await d.competitorsFor(userId)) || [];
  // The competitors shown are the ones the tracker reads: one shared list (trackedCompetitors), owner's own only.
  const mine = trackedCompetitors(all.filter((c) => c && String(c.userId) === userId), caps.MAX_TRACKED);

  const items = [];
  const rows = [];
  for (const competitor of mine) {
    const own = (r) => r && (r.userId === undefined || r.userId === null || String(r.userId) === userId);
    const snapshots = ((await d.store.latest(competitor._id, 4)) || []).filter((s) => s && s.ok !== false && own(s));
    const lastAttempt = await d.store.lastAttempt(competitor._id);
    const attempt = own(lastAttempt) ? lastAttempt : null;
    const status = statusOf({ competitor, attempt, snapshots, week });
    items.push({ competitor: { _id: competitor._id, name: competitor.name }, snapshots });
    const checked = (competitor.tracking && competitor.tracking.lastCheckedAt) || (attempt && attempt.takenAt) || null;
    rows.push({ competitor, status, lastCheckedAt: checked ? new Date(checked).toISOString() : null });
  }

  const made = insights({ items, now });
  const madeOf = new Map(made.competitors.map((c) => [String(c.id), c]));
  return {
    success: true,
    weekStart: week,
    highlights: made.highlights.map((h) => ({ competitorId: String(h.competitorId), name: h.name, text: h.text, weight: h.weight })),
    competitors: rows.map(({ competitor, status, lastCheckedAt }) => {
      const m = madeOf.get(String(competitor._id)) || {};
      return {
        id: String(competitor._id), name: competitor.name, handle: handleOf(competitor), handleStatus: handleStatusOf(competitor), status,
        trend: m.trend || [], lastCheckedAt,
        // Which week the numbers are from: when isCurrentWeek is false say "last checked on <lastCheckedOn>", not "this week".
        weekOf: m.weekOf || null, isCurrentWeek: !!m.isCurrentWeek, previousWeekOf: m.previousWeekOf || null, lastCheckedOn: m.lastCheckedOn || null
      };
    })
  };
}

// Staff: read this one client's competitors now. `force` skips the weekly cooldown (so it works on competitors already
// checked this week) but never the switch, the daily ceiling, the per-account daily cap or the spend guard; the read is
// counted and logged. `busy` means another pass is running; `disabled` means the competitor checks switch is off.
async function staffCheck({ client, staff, record, runTracker, now = new Date() }) {
  const run = runTracker || ((args) => require('../services/competitors/tracker').runTrackerOnce(args));
  const out = (await run({ accountIds: [String(client._id)], force: true, now, limit: 1 })) || { checked: 0, skipped: 0 };
  await record({ actor: staff, action: 'check_competitors', client: client._id, details: { checked: out.checked || 0 } });
  return { success: true, checked: out.checked || 0, skipped: out.skipped || 0, busy: !!out.busy, disabled: !!out.disabled };
}

function createCompetitorInsightsRouter(impl = {}) {
  const router = express.Router();
  const now = impl.now || (() => new Date());
  const gate = requireFeature('competitors', impl.loadUser ? { loadUser: impl.loadUser } : {});

  const handler = async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      return res.json(await viewFor(req.user, { deps: impl.deps, now: now() }));
    } catch (err) {
      console.error('[competitor-insights] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  };
  router.get('/', protect, readLimiter, gate, handler);
  return router;
}

const router = createCompetitorInsightsRouter();
router.createCompetitorInsightsRouter = createCompetitorInsightsRouter;
router.viewFor = viewFor;
router.staffCheck = staffCheck;
router.statusOf = statusOf;
router.checkLimiter = checkLimiter;
module.exports = router;
