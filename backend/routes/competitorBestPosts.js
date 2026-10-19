// GET /api/competitors/best-posts: what Home and the Competitors page show about competitors and trends, built ONLY from
// data we already hold: the weekly tracker's stored snapshots of the signed-in account's own competitors, the account's
// own measured posts, its plan themes and the approved India days (config/festivals.js). It reads nothing outside, calls
// no model and writes nothing. Inside an agency client or a CSM pass req.user already is the client.
// Without the competitors add-on no competitor data is read at all (entitled: false) and only the other honest sources
// appear under "Trending for you". How it works: docs/superpowers/ops/competitors-home.md
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const caps = require('../config/competitors');
const { upcoming } = require('../config/festivals');
const { weekStartOf } = require('../services/week/weekMath');
const { trackedCompetitors, competitorsQuery } = require('../services/competitors/tracked');
const { competitorCard, workingPosts, trendItems, MONTH_DAYS } = require('../services/competitors/bestPosts');
const { statusOf } = require('./competitorInsights');

const MAX_TIME_MS = 20000;
const COMPETITOR_LIMIT = 25;
const OWN_LIMIT = 25;
const DAY = 864e5;
const GENERIC_ERROR = 'We could not load your competitors just now. Please try again.';
const PRIVATE_ERROR = 'This account is private';

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, keyGenerator,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }
});

function defaultDeps() {
  const m = (name) => require(`../models/${name}`);
  return {
    // The same query and list the weekly tracker uses (newest first), bounded.
    competitorsFor: (userId) => competitorsQuery(m('Competitor'), userId).limit(COMPETITOR_LIMIT).maxTimeMS(MAX_TIME_MS),
    // One query for every tracked competitor: at most KEEP_WEEKS rows each, newest week first, no caption-sized fields.
    snapshotsFor: (userId, ids) => m('CompetitorSnapshot').find({ userId, competitorId: { $in: ids } })
      .sort({ weekStart: -1 }).limit(Math.max(1, ids.length) * caps.KEEP_WEEKS)
      .select('competitorId userId weekStart takenAt ok error followers postsInWindow postsInWindowMayBeTruncated topPost.url topPost.likes topPost.comments topPost.type topPostAt posts')
      .maxTimeMS(MAX_TIME_MS).lean(),
    // The account's own posts measured in the last 30 days, most liked first.
    ownPosts: (userId, since) => m('AIContentPerformance').find({ userId, publishedAt: { $gte: since } })
      .sort({ 'metrics.likes': -1 }).limit(OWN_LIMIT).select('contentType caption metrics.likes metrics.comments publishedAt').maxTimeMS(MAX_TIME_MS).lean(),
    // The newest finished plan's theme names only.
    planPillars: async (userId) => {
      const run = await m('Blueprint').findOne({ userId, kind: 'plan', status: 'completed' }).sort({ createdAt: -1 })
        .select('result.plan.pillars.name').maxTimeMS(MAX_TIME_MS).lean();
      const list = run && run.result && run.result.plan && Array.isArray(run.result.plan.pillars) ? run.result.plan.pillars : [];
      return list.map((p) => String((p && p.name) || '').trim()).filter(Boolean).slice(0, 5);
    },
    trackerOn: () => require('../services/competitors/readGuard').trackerEnabled(process.env),
    canUse: (user, feature) => require('../config/entitlements').canUse(user, feature)
  };
}

const ownRows = (rows, userId) => (Array.isArray(rows) ? rows : []).filter((r) => r && (r.userId === undefined || r.userId === null || String(r.userId) === userId));

/** The whole answer for one account (the route, staff tools and the real-database check use this). */
async function build({ user, deps: given, now = new Date(), pass = false } = {}) {
  const deps = { ...defaultDeps(), ...(given || {}) };
  const userId = toUserId(user);
  const week = weekStartOf(now);
  const base = { asOf: now.toISOString(), weekStart: week, entitled: false, trackerOn: false, state: 'not_entitled', competitors: [], working: [], trending: [], degraded: [] };
  if (user && (user.staffRole || user.isCsm) && !pass) return { ...base, staff: true };

  const degraded = [];
  const safe = async (name, fn, fallback) => {
    try { return await fn(); } catch (e) { console.error(`[best-posts] ${name} failed:`, e && e.message); degraded.push(name); return fallback; }
  };
  const trackerOn = deps.trackerOn() === true;
  let entitled = false;
  try { entitled = !!(deps.canUse(user, 'competitors') || {}).allowed; } catch (_) { entitled = false; }

  const [pillars, ownRaw] = await Promise.all([
    safe('plan', () => deps.planPillars(userId), []),
    safe('own', () => deps.ownPosts(userId, new Date(now.getTime() - MONTH_DAYS * DAY)), [])
  ]);
  const own = ownRows(ownRaw, userId).map((r) => ({
    type: r.contentType, caption: r.caption, likes: r.metrics && r.metrics.likes, comments: r.metrics && r.metrics.comments, at: r.publishedAt
  }));

  let cards = [];
  let state = 'not_entitled';
  if (entitled) {
    const all = await safe('competitors', () => deps.competitorsFor(userId), null);
    const mine = trackedCompetitors(ownRows(all, userId).filter((c) => String(c.userId) === userId), caps.MAX_TRACKED);
    let rows = [];
    if (all && mine.length) rows = ownRows(await safe('snapshots', () => deps.snapshotsFor(userId, mine.map((c) => c._id)), null), userId);
    const byComp = new Map();
    for (const r of rows) {
      const k = String(r.competitorId);
      if (!byComp.has(k)) byComp.set(k, []);
      byComp.get(k).push(r);
    }
    cards = mine.map((competitor) => {
      const list = (byComp.get(String(competitor._id)) || []).sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0));
      const good = list.filter((s) => s.ok !== false).slice(0, 4);
      const attempt = list.slice().sort((a, b) => new Date(b.takenAt || 0) - new Date(a.takenAt || 0))[0] || null;
      let status = statusOf({ competitor, attempt, snapshots: good, week });
      if (status === 'failed' && attempt && String(attempt.error || '').startsWith(PRIVATE_ERROR)) status = 'private';
      return competitorCard({ competitor, status, snapshots: good, now, lastCheckedAt: (competitor.tracking && competitor.tracking.lastCheckedAt) || (attempt && attempt.takenAt) || null });
    });
    const failed = degraded.includes('competitors') || degraded.includes('snapshots');
    if (failed) state = 'error';
    else if (!mine.length) state = 'no_competitors';
    else if (cards.some((c) => c.weekOf)) state = 'ready';
    else state = trackerOn ? 'waiting' : 'tracker_off';
  }

  const working = entitled ? workingPosts(cards, { pillars }) : [];
  const trending = trendItems({ cards, own, pillars, festivals: upcoming(now, 60), entitled, now });
  return {
    ...base, entitled, trackerOn, state,
    competitors: cards.map(({ bestPost, ...c }) => ({ ...c, bestPost: bestPost ? (({ score, ...b }) => b)(bestPost) : null })),
    working, trending, degraded
  };
}

function createBestPostsRouter(impl = {}) {
  const router = express.Router();
  const now = impl.now || (() => new Date());
  router.get('/', protect, readLimiter, async (req, res) => {
    try {
      if (!toUserId(req.user)) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      res.set('Cache-Control', 'private, no-store');
      const body = await build({ user: req.user, deps: impl.deps, now: now(), pass: Boolean(req.actingCsm || req.actingAgency) });
      return res.json({ success: true, ...body });
    } catch (err) {
      console.error('[best-posts] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  });
  return router;
}

const router = createBestPostsRouter();
router.createBestPostsRouter = createBestPostsRouter;
router.build = build;
module.exports = router;
