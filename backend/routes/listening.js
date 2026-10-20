// Social listening card (/api/listening). What the weekly scorer found in the signed-in account's own comments and
// messages: counts, whole-number percentages, a trend sentence built in code, up to three short quotes and a few recent
// negative comments. Everything is read for the signed-in account only (the id comes from the verified sign-in, never
// from the request), quotes and previews are read live from the inbox so a deleted or edited item is never shown from
// a copy, and the model name, vendor names and the model's raw reasons are never returned.
const express = require('express');
const rateLimit = require('../services/rateLimitStore').rateLimit;
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const cfg = require('../config/listening');
const { aggregate, trendSentence, pickQuotes, eligibleItem, kindOf } = require('../services/listening/helpers');

const DAY = 864e5;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const NOT_ENOUGH = 'Not enough comments yet to show a score.';
const WAITING = 'Your comments are waiting for the next weekly check.';
const GENERIC_ERROR = 'We could not complete that request. Please try again.';
const TOO_MANY = 'You have sent too many requests. Please try again in a few minutes.';
const TYPES = ['comment', 'mention', 'dm', 'message'];
const SCORE_ROWS_MAX = 300;
const PREVIEW_CHARS = 80;
const BUCKET = { pos: 'positive', neu: 'neutral', neg: 'negative' };
// Plain words for the most common negative reason; the model's codes are never sent as they are.
const REASON_WORD = { delivery: 'delivery', price: 'price', quality: 'quality', service: 'service', product: 'the product', question: 'questions' };

const toUserId = (user) => (!user ? null : user._id ? String(user._id) : user.id ? String(user.id) : null);
const istDay = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const makeLimiter = (max, message) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message }, keyGenerator });
const readLimiter = makeLimiter(600, TOO_MANY);
const checkLimiter = makeLimiter(20, TOO_MANY);

function defaultDeps() {
  let store = null;
  const lazyStore = () => (store = store || require('../services/listening/store').listeningStore());
  const Inbox = () => require('../models/SocialInboxMessage');
  return {
    env: process.env,
    store: { scoresSince: (...a) => lazyStore().scoresSince(...a), lastScoredAt: (...a) => lazyStore().lastScoredAt(...a) },
    // Only this account's own inbox items, whatever ids are asked for.
    inboxByIds: (userId, ids) => Inbox().find({ _id: { $in: ids }, userId })
      .select('_id userId conversationId platform messageType direction senderType spamScore body authorId createdAt').lean(),
    eligibleInbox: (userId, since) => Inbox().find({ userId, direction: 'inbound', createdAt: { $gte: since }, messageType: { $in: TYPES } })
      .select('_id userId messageType direction senderType spamScore body createdAt').sort({ createdAt: -1 }).limit(cfg.MIN_ITEMS * 4).lean(),
    batchesSince: (userId, since) => require('../models/ListeningBatchLog').countDocuments({ userId, at: { $gte: since } })
  };
}
const withDefaults = (deps) => ({ ...defaultDeps(), ...(deps || {}) });

const preview = (body) => Array.from(String(body || '').replace(/\s+/g, ' ').trim()).slice(0, PREVIEW_CHARS).join('');

function topReasonOf(agg) {
  const negatives = agg.period.negative;
  if (negatives <= 0) return null;
  let best = null;
  for (const k of cfg.REASONS) {
    const v = Number(agg.reasons[k]) || 0;
    if (v > 0 && REASON_WORD[k] && (!best || v > best.v)) best = { k, v };
  }
  return best && best.v * 2 > negatives ? REASON_WORD[best.k] : null;
}

const STALE_AFTER_DAYS = 10; // an older last scoring is shown to the customer as "Last checked on ..."
const dayNumber = (iso) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / DAY);

// The body for one account. Scoring is weekly, so every window ends on the day of the LAST scoring (never "today"), and a
// scoring older than STALE_AFTER_DAYS is flagged so the card can say when it was last checked. While the feature is off, or
// before this account has ever been scored, the state is `off` and the card shows nothing at all.
async function viewFor(user, { deps, now = new Date() } = {}) {
  const d = withDefaults(deps);
  const userId = toUserId(user);
  const enabled = String((d.env && d.env.ENABLE_LISTENING) || '').trim() === 'on';
  const lastScored = enabled ? await d.store.lastScoredAt(userId) : null;
  const end = lastScored || now;
  const windows = aggregate([], end);
  const empty = () => ({
    success: true,
    enabled,
    state: 'off',
    message: null,
    period: { from: windows.period.from, to: windows.period.to },
    asOf: windows.period.to,
    total: 0,
    counts: { positive: 0, neutral: 0, negative: 0 },
    percentages: { positive: 0, neutral: 0, negative: 0 },
    trend: null,
    topReason: null,
    quotes: [],
    recentNegative: [],
    lastScoredAt: null,
    lastScoredOn: null,
    stale: false
  });
  if (!enabled || !lastScored) return empty();

  // 35 days of scores: the last 28 for the card and, before the newest 7 of them, the 28 days the trend is compared with.
  const loadFrom = new Date(`${windows.baselineFrom}T00:00:00+05:30`);
  const all = (await d.store.scoresSince(userId, loadFrom)) || [];
  // Only this account's own rows, and only labelled ones, even if a store hands back more.
  const rows = all.filter((r) => r && (r.userId === undefined || r.userId === null || String(r.userId) === userId));
  const agg = aggregate(rows, end);
  const periodStart = new Date(`${agg.period.from}T00:00:00+05:30`);

  const out = empty();
  out.state = 'not_enough';
  out.message = NOT_ENOUGH;
  out.period = { from: agg.period.from, to: agg.period.to };
  out.asOf = agg.period.to;
  out.lastScoredAt = lastScored.toISOString();
  out.lastScoredOn = istDay(lastScored);
  out.stale = dayNumber(istDay(now)) - dayNumber(out.lastScoredOn) > STALE_AFTER_DAYS;

  if (!agg.enough) {
    // Never invent a score: no numbers at all below the minimum.
    if (agg.period.total === 0) {
      const eligible = ((await d.eligibleInbox(userId, periodStart)) || []).filter((it) => eligibleItem(it, now, { userId }));
      if (eligible.length >= cfg.MIN_ITEMS) { out.state = 'waiting'; out.message = WAITING; }
    }
    return out;
  }

  out.state = 'ready';
  out.message = null;
  out.total = agg.period.total;
  out.counts = { positive: agg.period.positive, neutral: agg.period.neutral, negative: agg.period.negative };
  out.percentages = { ...agg.period.pct };
  out.trend = trendSentence(agg);
  out.topReason = topReasonOf(agg);

  const inPeriod = rows.filter((r) => r && BUCKET[r.label] && r.itemAt && istDay(r.itemAt) >= agg.period.from && new Date(r.itemAt) <= end)
    .sort((a, b) => new Date(b.itemAt) - new Date(a.itemAt));
  const quotable = inPeriod.filter((r) => r.kind === 'public' && (r.label === 'pos' || r.label === 'neg')).slice(0, SCORE_ROWS_MAX);
  const negatives = inPeriod.filter((r) => r.label === 'neg' && r.kind !== 'private').slice(0, SCORE_ROWS_MAX);
  const ids = [...new Set([...quotable, ...negatives].map((r) => String(r.inboxItemId)))];
  const live = new Map();
  if (ids.length) {
    for (const m of (await d.inboxByIds(userId, ids)) || []) {
      if (!m || (m.userId !== undefined && m.userId !== null && String(m.userId) !== userId)) continue;
      if (m.direction !== 'inbound') continue;
      live.set(String(m._id), m);
    }
  }

  // Candidates: this account's scored rows joined to the live inbox item. An item that is gone is dropped here. Whether
  // a quote may be public is decided again from the live item (not the stored label), and the safety filter runs on the
  // live text, so an edited comment is judged as it reads now.
  const candidates = [];
  for (const r of quotable) {
    const m = live.get(String(r.inboxItemId));
    if (!m) continue;
    candidates.push({
      id: String(r.inboxItemId), conversationId: m.conversationId, authorKey: m.authorId || null, kind: kindOf(m),
      label: r.label, reason: r.reason, platform: m.platform || r.platform, spamScore: m.spamScore, itemAt: m.createdAt || r.itemAt, text: m.body
    });
  }
  out.quotes = pickQuotes(candidates, end).map((q) => ({
    id: String(q.id), label: BUCKET[q.label], platform: q.platform, date: istDay(q.itemAt), text: q.text
  }));

  for (const r of negatives) {
    if (out.recentNegative.length >= cfg.RECENT_NEGATIVE_MAX) break;
    const m = live.get(String(r.inboxItemId));
    if (!m) continue;
    // Private messages are counted but never shown outside the Inbox, not even as a short preview (the live item decides).
    if (r.kind === 'private' || kindOf(m) !== 'public') continue;
    const text = preview(m.body);
    if (!text) continue;
    out.recentNegative.push({ id: String(r.inboxItemId), conversationId: m.conversationId ? String(m.conversationId) : null, platform: m.platform || r.platform, date: istDay(m.createdAt || r.itemAt), preview: text });
  }
  return out;
}

// Staff see the same body plus the counts the ledger keeps for this client.
async function staffViewFor(client, { deps, now = new Date() } = {}) {
  const d = withDefaults(deps);
  const body = await viewFor(client, { deps, now });
  let batches = 0;
  try { batches = Number(await d.batchesSince(toUserId(client), new Date(now.getTime() - cfg.PERIOD_DAYS * DAY))) || 0; } catch (_) { batches = 0; }
  const failures = Number(client && client.listeningFailures) || 0;
  return {
    ...body,
    ledger: {
      batches, scoredItems: body.total, failures, paused: failures >= cfg.FAIL_PAUSE_AFTER,
      lastRunAt: client && client.listeningRunAt ? new Date(client.listeningRunAt).toISOString() : null
    }
  };
}

// Staff: score this one client now. `force` skips only the weekly cadence; the switch, the daily caps, the spend guard,
// the lease and the pause still apply, the attempt is counted in the ledger, and the action is logged.
async function staffScore({ client, staff, record, runScorer, now = new Date() }) {
  const run = runScorer || ((args) => require('../services/listening/scorer').runScorerOnce(args));
  const out = (await run({ accountIds: [String(client._id)], force: true, now, limit: 1 })) || {};
  const scored = Number(out.scored) || 0;
  const busy = !!out.busy;
  const disabled = !!out.disabled;
  const skipped = busy || disabled || !(Number(out.accounts) > 0) ? 1 : 0;
  await record({ actor: staff, action: 'score_listening', client: client._id, details: { scored } });
  return { success: true, scored, skipped, busy, disabled };
}

function createListeningRouter(impl = {}) {
  const router = express.Router();
  const now = impl.now || (() => new Date());
  const gate = requireFeature('inbox', impl.loadUser ? { loadUser: impl.loadUser } : {});

  const handler = async (req, res) => {
    try {
      const userId = toUserId(req.user);
      if (!userId) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      return res.json(await viewFor({ _id: userId }, { deps: impl.deps, now: now() }));
    } catch (err) {
      console.error('[listening] route error:', err && err.name);
      return res.status(500).json({ success: false, message: GENERIC_ERROR });
    }
  };
  router.get('/', protect, readLimiter, gate, handler);
  return router;
}

const router = createListeningRouter();
router.createListeningRouter = createListeningRouter;
router.viewFor = viewFor;
router.staffViewFor = staffViewFor;
router.staffScore = staffScore;
router.checkLimiter = checkLimiter;
module.exports = router;
