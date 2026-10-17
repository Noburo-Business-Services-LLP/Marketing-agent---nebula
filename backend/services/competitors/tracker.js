'use strict';
/**
 * Weekly competitor tracker. Reads each tracked competitor's public Instagram profile once a week, stores a small
 * snapshot, and backs off from handles that keep failing. This is the only place scraper reads are spent, so the caps
 * live here and are checked on every single read:
 *   - one read per competitor per week (a failed week is not retried until next week) and a 12 hour cooldown,
 *   - at most MAX_TRACKED competitors per account,
 *   - at most READS_PER_DAY_MAX reads a day across all accounts: the stored count (rows by takenAt) AND an in-process
 *     count for this pass are both used, every read saves a row (ok or failed), and the pass stops at exactly the cap,
 *   - spendGuard.check before and spendGuard.record after each read, a refusal ends the pass quietly,
 *   - only one pass at a time (a second call while one runs does nothing).
 * Off in tests and with ENABLE_COMPETITOR_TRACKER=off. Competitors are processed one at a time with a 1 s pause.
 */
const defaultCaps = require('../../config/competitors');
const { weekStartOf } = require('../week/weekMath');
const { summarise } = require('./snapshot');

const HOUR = 36e5;
const EVERY_MS = 6 * HOUR;
const FIRST_MS = 20 * 60 * 1000;
const PAUSE_MS = 1000;
const ACTION = 'competitor_scrape';

let running = false;

const handleOf = (c) => String((c && c.socialHandles && c.socialHandles.instagram) || '').trim().replace(/^@/, '');
const asDate = (v) => (v ? new Date(v) : new Date());

function defaultDeps() {
  let store = null;
  const lazyStore = () => (store = store || require('./snapshotStore').snapshotStore());
  const Competitor = () => require('../../models/Competitor');
  return {
    caps: defaultCaps,
    store: {
      save: (...a) => lazyStore().save(...a),
      latest: (...a) => lazyStore().latest(...a),
      lastAttempt: (...a) => lazyStore().lastAttempt(...a),
      prune: (...a) => lazyStore().prune(...a),
      readsToday: (...a) => lazyStore().readsToday(...a)
    },
    accounts: (limit = 500) => require('../../models/User').find({
      isActive: { $ne: false }, onboardingCompleted: true, staffRole: null, isCsm: { $ne: true }, 'plan.tier': { $ne: 'free' }
    }).sort({ _id: 1 }).limit(limit).lean(),
    competitorsFor: (user) => Competitor().find({ userId: user._id, isActive: { $ne: false }, isIgnored: { $ne: true } }).sort({ createdAt: -1 }).lean(),
    saveTracking: (c, tracking) => Competitor().updateOne({ _id: c._id }, { $set: { tracking } }),
    canUse: (user, feature) => require('../../config/entitlements').canUse(user, feature),
    gate: () => require('../backgroundGate').blockedAccountIdsSafe(),
    spend: { check: (a) => require('../spendGuard').check(a), record: (a, n) => require('../spendGuard').record(a, n) },
    scrapeProfile: (handle) => require('../socialMediaAPI').scrapeInstagramProfile(handle),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms))
  };
}
const withDefaults = (deps) => ({ ...defaultDeps(), ...(deps || {}) });

/** A different handle than the one last read means the customer fixed it: failures and the pause are cleared. */
async function applyHandleChange(competitor, d) {
  const t = competitor.tracking || (competitor.tracking = {});
  const handle = handleOf(competitor);
  if (t.lastHandle && handle && t.lastHandle !== handle && (t.failures || t.pausedAt)) {
    t.failures = 0;
    t.pausedAt = null;
    t.lastHandle = handle;
    try { await d.saveTracking(competitor, { ...t }); } catch (_) { /* in-memory state is enough for this pass */ }
  }
}

const failReason = (profile) => (profile && (profile.private || profile.isPrivate) ? 'This account is private' : 'Could not read this profile');

/** Read one competitor and store the result. Never throws. Does not check due-ness: the pass does that. */
async function trackOne({ competitor, user, now, deps } = {}) {
  try {
    const d = withDefaults(deps);
    const at = asDate(now);
    const caps = d.caps || defaultCaps;
    if (!competitor || competitor.isIgnored || competitor.isActive === false) return { ok: false, skipped: true, reason: 'not_tracked' };
    const handle = handleOf(competitor);
    if (!handle) return { ok: false, skipped: true, reason: 'no_handle' };
    await applyHandleChange(competitor, d);
    const t = competitor.tracking || (competitor.tracking = {});
    if (t.pausedAt) return { ok: false, skipped: true, reason: 'paused' };

    let snapshotFields = null;
    let error = null;
    try {
      const res = await d.scrapeProfile(handle);
      const profile = res && res.success && Array.isArray(res.data) ? res.data[0] : null;
      if (!profile || typeof profile !== 'object') error = 'Could not read this profile';
      else if (profile.private || profile.isPrivate) error = failReason(profile);
      else snapshotFields = summarise({ profile, posts: profile.latestPosts || profile.posts || [], now: at });
    } catch (_) {
      error = 'Could not read this profile';
    }

    const week = weekStartOf(at);
    const base = { userId: (user && user._id) || competitor.userId, competitorId: competitor._id, weekStart: week, takenAt: at, handle };
    // A row is saved for every read, so the daily count can never undercount.
    try {
      await d.store.save(snapshotFields ? { ...base, ...snapshotFields, weekStart: week, ok: true } : { ...base, ok: false, error });
      if (snapshotFields) await d.store.prune(competitor._id, caps.KEEP_WEEKS).catch(() => {});
    } catch (e) {
      error = error || 'Could not save this check';
      snapshotFields = null;
    }

    t.lastCheckedAt = at;
    t.lastHandle = handle;
    if (snapshotFields) { t.failures = 0; t.pausedAt = null; }
    else {
      t.failures = (t.failures || 0) + 1;
      if (t.failures >= caps.FAIL_PAUSE_AFTER) t.pausedAt = at;
    }
    try { await d.saveTracking(competitor, { ...t }); } catch (_) { /* the snapshot is already stored */ }
    return snapshotFields ? { ok: true, read: true } : { ok: false, read: true, reason: error };
  } catch (e) {
    return { ok: false, read: false, reason: 'error' };
  }
}

/** Is this competitor due a read now? (cooldown, and nothing already stored for the current week) */
async function isDue(competitor, at, d) {
  const caps = d.caps || defaultCaps;
  const week = weekStartOf(at);
  const last = await d.store.lastAttempt(competitor._id);
  const changed = last && last.handle && last.handle !== handleOf(competitor);
  if (last && !changed) {
    if (last.takenAt && at - new Date(last.takenAt) < caps.COOLDOWN_HOURS * HOUR) return false;
    if (last.weekStart === week) return false; // a failed week is retried next week, not every 12 hours
  }
  const [good] = await d.store.latest(competitor._id, 1);
  if (good && good.weekStart === week && !changed) return false;
  return true;
}

/** One pass. `limit` is the most accounts that get read in one pass (accounts with nothing due do not count). */
async function runTrackerOnce({ deps, now, limit = 20 } = {}) {
  if (running) return { checked: 0, skipped: 0 };
  running = true;
  const out = { checked: 0, skipped: 0 };
  try {
    const d = withDefaults(deps);
    const caps = d.caps || defaultCaps;
    const at = asDate(now);

    let blocked;
    try { blocked = new Set(((await d.gate()) || []).map(String)); }
    catch (e) { console.warn('[competitors] could not read the paused accounts, skipping this pass:', e && e.message); return out; }

    const users = (await d.accounts()) || [];
    const stored = Number(await d.store.readsToday(at)) || 0;
    let passReads = 0;
    let accountsRead = 0;
    let stop = false;

    for (const user of users) {
      if (stop || accountsRead >= limit) break;
      if (!user || user.isActive === false || !user.onboardingCompleted || user.staffRole || user.isCsm) continue;
      if (user.plan && user.plan.tier === 'free') continue;
      if (blocked.has(String(user._id))) continue;
      let allowed = false;
      try { allowed = !!(d.canUse(user, 'competitors') || {}).allowed; } catch (_) { allowed = false; }
      if (!allowed) continue;

      const list = (await d.competitorsFor(user)) || [];
      for (const c of list) await applyHandleChange(c, d);
      const chosen = list
        .filter((c) => c && c.isActive !== false && !c.isIgnored && handleOf(c) && !(c.tracking && c.tracking.pausedAt))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, caps.MAX_TRACKED);

      let readHere = false;
      for (const c of chosen) {
        if (!(await isDue(c, at, d))) { out.skipped++; continue; }
        // Daily cap: the larger of the stored count and what this pass has spent, so it can never undercount.
        const used = Math.max(stored + passReads, Number(await d.store.readsToday(at)) || 0);
        if (used >= caps.READS_PER_DAY_MAX) { stop = true; break; }
        const verdict = await d.spend.check(ACTION);
        if (verdict && verdict.ok === false) { stop = true; break; }
        const res = await trackOne({ competitor: c, user, now: at, deps: d });
        if (res.read) {
          passReads++;
          out.checked++;
          readHere = true;
          try { await d.spend.record(ACTION, 1); } catch (_) { /* the read is already done */ }
          await d.sleep(PAUSE_MS);
        } else out.skipped++;
      }
      if (readHere) accountsRead++;
    }
    return out;
  } catch (e) {
    console.error('[competitors] tracker pass failed:', e && e.message);
    return out;
  } finally {
    running = false;
  }
}

function startCompetitorTracker({ env = process.env, intervalMs = EVERY_MS, firstDelayMs = FIRST_MS, logger = console, deps } = {}) {
  if (String(env.ENABLE_COMPETITOR_TRACKER || '').trim().toLowerCase() === 'off' || env.NODE_ENV === 'test') return null;
  const tick = async () => {
    try { await runTrackerOnce({ deps }); } catch (e) { logger.error('[competitors] tracker tick failed:', e && e.message); }
  };
  const first = setTimeout(tick, firstDelayMs);
  const timer = setInterval(tick, intervalMs);
  if (first.unref) first.unref();
  if (timer.unref) timer.unref();
  logger.log(`[competitors] weekly tracker on: every ${Math.round(intervalMs / HOUR)} h, first check in ${Math.round(firstDelayMs / 60000)} min`);
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { trackOne, runTrackerOnce, startCompetitorTracker };
