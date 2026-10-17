'use strict';
/**
 * Weekly competitor tracker. Reads each tracked competitor's public Instagram profile once a week, stores a small
 * snapshot, and backs off from handles that keep failing. The caps live here and in readGuard.js and are checked on
 * every single read (the customer-triggered scrapes in routes/competitors.js go through the same guard):
 *   - OFF unless ENABLE_COMPETITOR_TRACKER is exactly "on" (every environment, production included),
 *   - one read per competitor per week (a failed week is not retried until next week) and a 12 hour cooldown, kept in the
 *     read ledger so it holds even when a snapshot or tracking save fails,
 *   - the same five competitors the insights route shows (trackedCompetitors), and only confirmed or verified handles,
 *   - at most READS_PER_DAY_MAX reads a day across all accounts and maxReadsPerAccountPerDay for one account; both count
 *     real read attempts from the ledger, not saved rows,
 *   - spendGuard.check before and spendGuard.record on each read; a refusal ends the pass quietly,
 *   - one pass at a time across ALL server instances (a lease in OpsState), released at the end of the pass,
 *   - fair rotation: every entitled account is considered, oldest last read first.
 * Competitors are processed one at a time with a 1 s pause.
 */
const defaultCaps = require('../../config/competitors');
const { weekStartOf } = require('../week/weekMath');
const { summarise } = require('./snapshot');
const { handleOf, trackedCompetitors, isReadable, competitorsQuery } = require('./tracked');
const { createReadGuard, trackerEnabled } = require('./readGuard');

const HOUR = 36e5;
const EVERY_MS = 6 * HOUR;
const FIRST_MS = 20 * 60 * 1000;
const PAUSE_MS = 1000;
const PAGE = 500;

let running = false;

const asDate = (v) => (v ? new Date(v) : new Date());

function defaultDeps() {
  let store = null;
  const lazyStore = () => (store = store || require('./snapshotStore').snapshotStore());
  const Competitor = () => require('../../models/Competitor');
  const User = () => require('../../models/User');
  return {
    caps: defaultCaps,
    env: process.env,
    ledger: require('./readLedger').sharedLedger(),
    lease: require('./lease').createLease({ ttlMs: defaultCaps.LEASE_MINUTES * 60 * 1000 }),
    store: {
      save: (...a) => lazyStore().save(...a),
      latest: (...a) => lazyStore().latest(...a),
      lastAttempt: (...a) => lazyStore().lastAttempt(...a),
      prune: (...a) => lazyStore().prune(...a)
    },
    // Every non-free, active, onboarded account (the entitlement check is canUse), read in pages by _id so none is cut off.
    accounts: async ({ ids = null, pageSize } = {}) => {
      const size = Number(pageSize) > 0 ? Number(pageSize) : PAGE;
      const out = [];
      let last = null;
      for (;;) {
        const page = await User().find({
          isActive: { $ne: false }, onboardingCompleted: true, staffRole: null, isCsm: { $ne: true }, 'plan.tier': { $ne: 'free' },
          ...(ids ? { _id: { $in: ids } } : {}),
          ...(last ? { _id: { ...(ids ? { $in: ids } : {}), $gt: last } } : {})
        }).select('_id isActive onboardingCompleted staffRole isCsm plan competitorsReadAt').sort({ _id: 1 }).limit(size).lean();
        out.push(...page);
        if (page.length < size) break;
        last = page[page.length - 1]._id;
      }
      return out;
    },
    markAccountRead: (user, at) => User().updateOne({ _id: user._id }, { $set: { competitorsReadAt: at } }, { timestamps: false }),
    competitorsFor: (user) => competitorsQuery(Competitor(), user._id),
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
  if (t.lastHandle && handle && t.lastHandle !== handle) {
    t.failures = 0;
    t.pausedAt = null;
    t.lastCheckedAt = null; // a fixed handle is read again straight away
    t.lastHandle = handle;
    try { await d.saveTracking(competitor, { ...t }); } catch (_) { /* in-memory state is enough for this pass */ }
  }
}

// A handle that does not exist may come back as an item carrying an error, or with no profile numbers at all
// (assumed, not yet seen from the real scraper). Either way there is nothing to count.
const notAProfile = (p) => !!p.error || (typeof p.followersCount !== 'number' && !Array.isArray(p.latestPosts) && !Array.isArray(p.posts));

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

    // The read attempt is recorded (ledger + spend guard) BEFORE the scrape, so it counts even if every save fails.
    if (d.onRead) await d.onRead({ competitor, user, handle, at });

    let snapshotFields = null;
    let error = null;
    try {
      const res = await d.scrapeProfile(handle);
      const profile = res && res.success && Array.isArray(res.data) ? res.data[0] : null;
      if (!profile || typeof profile !== 'object' || notAProfile(profile)) error = 'Could not read this profile';
      else if (profile.private || profile.isPrivate) error = failReason(profile);
      else snapshotFields = summarise({ profile, posts: profile.latestPosts || profile.posts || [], now: at });
    } catch (_) {
      error = 'Could not read this profile';
    }

    const week = weekStartOf(at);
    const base = { userId: (user && user._id) || competitor.userId, competitorId: competitor._id, weekStart: week, takenAt: at, handle };
    try {
      await d.store.save(snapshotFields ? { ...base, ...snapshotFields, weekStart: week, ok: true } : { ...base, ok: false, error });
      if (snapshotFields) await d.store.prune(competitor._id, caps.KEEP_WEEKS).catch(() => {});
    } catch (e) {
      console.error('[competitors] could not save a check:', e && e.message);
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

/**
 * Is this competitor due a read now? Cooldown and "already read this week" are judged from three places: the competitor's
 * tracking state, the read ledger (which survives a failed save) and the newest stored attempt. `force` (staff "check now")
 * skips all of those; the caps and the guard are applied by the pass, not here.
 */
async function isDue(competitor, at, d, force = false) {
  if (force) return true;
  const caps = d.caps || defaultCaps;
  const week = weekStartOf(at);
  const handle = handleOf(competitor);
  const t = competitor.tracking || {};
  const ledgerLast = await d.ledger.lastRead(competitor._id).catch(() => null);
  let lastRow = null;
  try { lastRow = await d.store.lastAttempt(competitor._id); } catch (_) { lastRow = null; }
  // A different handle than the one last read means the customer fixed it: read it again straight away.
  const changed = !!((lastRow && lastRow.handle && lastRow.handle !== handle) || (ledgerLast && ledgerLast.handle && ledgerLast.handle !== handle));
  if (changed) return true;
  for (const mark of [t.lastCheckedAt, ledgerLast && ledgerLast.at, lastRow && lastRow.takenAt]) {
    if (!mark) continue;
    const when = new Date(mark);
    if (at - when < caps.COOLDOWN_HOURS * HOUR) return false;
    if (weekStartOf(when) === week) return false; // one read a week; a failed week is retried next week
  }
  if (lastRow && lastRow.weekStart === week) return false;
  const [good] = await d.store.latest(competitor._id, 1);
  if (good && good.weekStart === week) return false;
  return true;
}

/**
 * One pass. `limit` is the most accounts that get read in one pass (accounts with nothing due do not count).
 * `accountIds` restricts the pass to those accounts. `force` (staff "check now") skips the cooldown and the weekly
 * rules; the switch, the daily ceiling, the per-account cap, the spend guard and the entitlement gate still apply, and
 * the read is counted like any other. Returns { checked, skipped } plus `busy` (a pass is running somewhere) or
 * `disabled` (the switch is off) when that is why nothing happened.
 */
async function runTrackerOnce({ deps, now, limit, accountIds = null, force = false } = {}) {
  if (running) return { checked: 0, skipped: 0, busy: true };
  running = true;
  const out = { checked: 0, skipped: 0 };
  let token = null;
  let d = null;
  try {
    d = withDefaults(deps);
    const caps = d.caps || defaultCaps;
    const at = asDate(now);
    const maxAccounts = limit || caps.ACCOUNTS_PER_PASS || 60;
    const guard = createReadGuard({ ledger: d.ledger, spend: d.spend, caps, env: d.env });
    if (!guard.enabled()) return { ...out, disabled: true };

    token = await d.lease.claim(at);
    if (!token) return { ...out, busy: true };

    let blocked;
    try { blocked = new Set(((await d.gate()) || []).map(String)); }
    catch (e) { console.warn('[competitors] could not read the paused accounts, skipping this pass:', e && e.message); return out; }

    const only = Array.isArray(accountIds) ? new Set(accountIds.map(String)) : null;
    let users = (await d.accounts({ ids: only ? [...only] : null, pageSize: caps.ACCOUNTS_PAGE })) || [];
    if (only) users = users.filter((u) => u && only.has(String(u._id)));
    // Fair rotation: accounts never read first, then the oldest last read.
    const readAt = (u) => (u && u.competitorsReadAt ? new Date(u.competitorsReadAt).getTime() : 0);
    users = [...users].sort((a, b) => readAt(a) - readAt(b) || (String(a && a._id) < String(b && b._id) ? -1 : 1));

    const source = force ? 'staff' : 'tracker';
    let accountsRead = 0;
    let stop = false;

    for (const user of users) {
      if (stop || accountsRead >= maxAccounts) break;
      if (!user || user.isActive === false || !user.onboardingCompleted || user.staffRole || user.isCsm) continue;
      if (user.plan && user.plan.tier === 'free') continue;
      if (blocked.has(String(user._id))) continue;
      let allowed = false;
      try { allowed = !!(d.canUse(user, 'competitors') || {}).allowed; } catch (_) { allowed = false; }
      if (!allowed) continue;

      token = (await d.lease.renew(token, new Date(Math.max(at.getTime(), Date.now())))) || token; // from the current time: a pass longer than the lease must not lose it
      const list = (await d.competitorsFor(user)) || [];
      for (const c of list) await applyHandleChange(c, d);
      // The same list the insights route shows; of those, only confirmed or verified, valid, unpaused handles are read.
      const chosen = trackedCompetitors(list, caps.MAX_TRACKED).filter(isReadable);

      const withNote = { ...d, onRead: (info) => guard.note({ userId: user._id, competitorId: info.competitor._id, handle: info.handle, at, source }) };
      let readHere = false;
      for (const c of chosen) {
        if (!(await isDue(c, at, d, force))) { out.skipped++; continue; }
        const verdict = await guard.allow({ userId: user._id, at });
        if (!verdict.ok) {
          if (verdict.reason !== 'account_cap') stop = true; // this account is full for today; the next account may go on
          break;
        }
        const res = await trackOne({ competitor: c, user, now: at, deps: withNote });
        if (res.read) {
          out.checked++;
          readHere = true;
          await d.sleep(PAUSE_MS);
        } else out.skipped++;
      }
      if (readHere) {
        accountsRead++;
        user.competitorsReadAt = at;
        try { await d.markAccountRead(user, at); } catch (_) { /* the rotation order is only a preference */ }
      }
    }
    return out;
  } catch (e) {
    console.error('[competitors] tracker pass failed:', e && e.message);
    return out;
  } finally {
    if (token && d) { try { await d.lease.release(token); } catch (_) { /* it expires by itself */ } }
    running = false;
  }
}

function startCompetitorTracker({ env = process.env, intervalMs = EVERY_MS, firstDelayMs = FIRST_MS, logger = console, deps } = {}) {
  // Off unless ENABLE_COMPETITOR_TRACKER is exactly "on", in every environment. The owner sets it on deliberately.
  if (!trackerEnabled(env) || env.NODE_ENV === 'test') return null;
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

module.exports = { trackOne, runTrackerOnce, startCompetitorTracker, defaultDeps };
