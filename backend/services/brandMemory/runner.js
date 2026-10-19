'use strict';
/**
 * Brand memory runner: reads the six sources for one account, learns from each in code (no model call, no provider
 * call, nothing charged), merges with what the memory holds and stores it on the account's ai_brand_memory document.
 *
 * - One refresh at a time per account (a lock on the document, LOCK_MS), "Refresh now" once every COOLDOWN_MS (stored on
 *   the document, so it holds across restarts and servers), each refresh cut off after ACCOUNT_BUDGET_MS.
 * - A source that fails is marked `error` and keeps its old items; the others still learn.
 * - Idempotent: the same inputs give the same fingerprint, and then only the check time moves.
 * - The daily job (startBrandMemoryJob) looks at up to JOB_BATCH accounts, oldest check first, and recomputes only those
 *   with a changed source (or older than a week); one server at a time (OpsState lease).
 * Deps are injected for tests; the defaults use Mongo. See docs/superpowers/ops/brand-memory.md.
 */
const { SOURCES, SOURCE_LABEL, LIMITS, TIMING, toDate } = require('./common');
const { learnFromPlan, learnFromBlueprint } = require('./fromPlan');
const { learnFromCustomers } = require('./fromCustomers');
const { learnFromProducts } = require('./fromProducts');
const { learnFromResults } = require('./fromResults');
const { learnFromCompetitors } = require('./fromCompetitors');
const { mergeItems, fingerprint, editedItem, addHidden } = require('./merge');

const ERROR_REASON = 'We could not read this just now. Nebulaa will try again soon.';
const STAFF_REASON = 'Staff accounts have no memory of their own.';
const DAY_MS = 864e5;

const idOf = (u) => (u ? String(u._id || u.id || u) : '');
const isStaff = (u) => Boolean(u && (u.staffRole || u.isCsm));
const orgOf = (userId) => require('../aiMemoryService').resolveOrganizationId({ userId });
const latest = (...ds) => ds.map(toDate).filter(Boolean).reduce((m, d) => (!m || d > m ? d : m), null);

function defaultDeps() {
  const m = (name) => require(`../../models/${name}`);
  const T = LIMITS.QUERY_MS;
  const key = (userId) => ({ organizationId: orgOf(userId), userId });
  const newest = (q, field) => q.sort({ [field]: -1 }).limit(1).select(field).maxTimeMS(T).lean().then((r) => (r[0] ? r[0][field] : null));
  return {
    now: () => new Date(),
    loadUser: (id) => m('User').findById(id).select('businessProfile plan staffRole isCsm isActive updatedAt agency').maxTimeMS(T).lean(),
    findDoc: (userId) => m('AIBrandMemory').findOne(key(userId)).select('learnedItems learnedHidden learnedSources learnedRefreshedAt learnedCheckedAt learnedFingerprint learnedManualAt learnedLockUntil learnedNotes learnedNotesUpdatedAt').maxTimeMS(T).lean(),
    /** One conditional update claims the lock (and, for Refresh now, the cooldown). Returns true when claimed. */
    claimLock: async (userId, now, { manual }) => {
      const free = { $or: [{ learnedLockUntil: null }, { learnedLockUntil: { $lt: now } }] };
      const cool = { $or: [{ learnedManualAt: null }, { learnedManualAt: { $lt: new Date(now.getTime() - TIMING.COOLDOWN_MS) } }] };
      try {
        const doc = await m('AIBrandMemory').findOneAndUpdate(
          { ...key(userId), $and: manual ? [free, cool] : [free] },
          { $set: { learnedLockUntil: new Date(now.getTime() + TIMING.LOCK_MS), ...(manual ? { learnedManualAt: now } : {}) } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ).select('_id').lean();
        return !!doc;
      } catch (e) {
        if (e && e.code === 11000) return false; // the document exists and is locked or cooling down
        throw e;
      }
    },
    save: (userId, set) => m('AIBrandMemory').updateOne(key(userId), { $set: { ...set, learnedLockUntil: null } }),
    release: (userId, set = {}) => m('AIBrandMemory').updateOne(key(userId), { $set: { ...set, learnedLockUntil: null } }),
    touchChecked: (userId, now) => m('AIBrandMemory').updateOne(key(userId), { $set: { learnedCheckedAt: now } }),
    editItem: (userId, itemKey, item) => m('AIBrandMemory').updateOne({ ...key(userId), 'learnedItems.key': itemKey }, { $set: { 'learnedItems.$': item } }),
    hideItem: (userId, itemKey, hidden) => m('AIBrandMemory').updateOne(key(userId), { $pull: { learnedItems: { key: itemKey } }, $set: { learnedHidden: hidden } }),
    plan: (userId) => m('Blueprint').findOne({ userId, kind: 'plan', status: 'completed' }).sort({ completedAt: -1 }).select('blueprintId completedAt result.plan').maxTimeMS(T).lean(),
    blueprint: (userId) => m('Blueprint').findOne({ userId, kind: { $ne: 'plan' }, status: 'completed' }).sort({ completedAt: -1 }).select('blueprintId completedAt result.plan.pillars result.plan.positioning result.plan.channels').maxTimeMS(T).lean(),
    products: (userId) => m('Product').find({ user: userId }).sort({ createdAt: 1 }).limit(LIMITS.PRODUCTS_READ).select('name type price currency category imageUrl images').maxTimeMS(T).lean(),
    measured: (userId, since) => m('AIContentPerformance').find({ userId, publishedAt: { $gte: since } }).sort({ publishedAt: -1 }).limit(LIMITS.MEASURED_READ)
      .select('campaignId platform postId contentType caption metrics rawAnalytics publishedAt measuredAt').maxTimeMS(T).lean(),
    campaigns: (userId, ids) => (ids.length ? m('Campaign').find({ userId, _id: { $in: ids } }).limit(LIMITS.CAMPAIGNS_READ)
      .select('name platforms creative.type creative.imageUrls creative.videoUrl creative.captions creative.textContent publishedAt').maxTimeMS(T).lean() : []),
    competitors: (userId) => require('../competitors/tracked').competitorsQuery(m('Competitor'), userId).limit(25).select('_id isActive isIgnored createdAt').maxTimeMS(T),
    snapshots: (userId, ids, since) => (ids.length ? m('CompetitorSnapshot').find({ userId, competitorId: { $in: ids }, ok: true, takenAt: { $gte: since } })
      .sort({ weekStart: -1 }).limit(LIMITS.SNAPSHOTS_READ).select('competitorId weekStart takenAt ok posts postsInWindow postsInWindowMayBeTruncated').maxTimeMS(T).lean() : []),
    trackedCount: (userId) => m('AIContentPerformance').countDocuments({ userId }).maxTimeMS(T),
    /** The newest change among the sources: six small reads, each on an index that leads with the account. */
    latestChange: async (userId, user) => {
      const [plan, product, measured, snap, comp] = await Promise.all([
        newest(m('Blueprint').find({ userId, status: 'completed' }), 'completedAt'),
        newest(m('Product').find({ user: userId }), 'updatedAt'),
        newest(m('AIContentPerformance').find({ userId }), 'measuredAt'),
        newest(m('CompetitorSnapshot').find({ userId }), 'takenAt'),
        newest(m('Competitor').find({ userId }), 'updatedAt')
      ]);
      return latest(plan, product, measured, snap, comp, user && user.updatedAt);
    },
    dueAccounts: (now, limit) => m('AIBrandMemory').find({ $or: [{ learnedCheckedAt: null }, { learnedCheckedAt: { $lt: new Date(now.getTime() - TIMING.JOB_RECHECK_MS) } }] })
      .sort({ learnedCheckedAt: 1 }).limit(limit).select('userId learnedRefreshedAt').maxTimeMS(20000).lean(),
    lease: require('../competitors/lease').createLease({ key: 'brand_memory_refresh_lease', ttlMs: TIMING.JOB_TIME_BOX_MS + 60000 }),
    canUseCompetitors: (user) => { try { return require('../../config/entitlements').canUse(user, 'competitors').allowed; } catch (_) { return false; } }
  };
}

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Object.assign(new Error('time box'), { code: 'TIMEBOX' })), ms);
  if (t.unref) t.unref();
  Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

function createBrandMemory(given = {}) {
  const deps = { ...defaultDeps(), ...given };

  /** Reads every source and learns from it. Each source on its own: one failing never stops the others. */
  async function learnAll(userId, user, now) {
    const safe = async (fn) => { try { return await fn(); } catch (e) { console.warn(`[brand memory] a source could not be read for ${userId}: ${e && e.message}`); return { error: true }; } };
    const since = new Date(now.getTime() - LIMITS.RESULTS_DAYS * DAY_MS);
    const compSince = new Date(now.getTime() - LIMITS.COMPETITOR_WEEKS * 7 * DAY_MS);
    const entitled = deps.canUseCompetitors(user);
    const [plan, blueprint, products, results, competitors] = await Promise.all([
      safe(() => deps.plan(userId)),
      safe(() => deps.blueprint(userId)),
      safe(() => deps.products(userId)),
      safe(async () => {
        const rows = (await deps.measured(userId, since)) || [];
        const ids = [...new Set(rows.map((r) => r.campaignId).filter(Boolean).map(String))].slice(0, LIMITS.CAMPAIGNS_READ);
        const camps = (await deps.campaigns(userId, ids)) || [];
        return { rows, campaigns: new Map(camps.map((c) => [String(c._id), c])) };
      }),
      safe(async () => {
        if (!entitled) return { competitors: [], snapshots: [] };
        const list = (await deps.competitors(userId)) || [];
        const ids = list.map((c) => c._id);
        return { competitors: list, snapshots: (await deps.snapshots(userId, ids, compSince)) || [] };
      })
    ]);
    const err = (x) => x && x.error === true;
    const planDoc = err(plan) ? null : plan;
    const run = (bad, fn) => (bad ? { state: 'error', reason: ERROR_REASON, items: [] } : fn());
    return {
      plan: run(err(plan), () => learnFromPlan(planDoc)),
      blueprint: run(err(blueprint), () => learnFromBlueprint(blueprint, planDoc)),
      customers: run(err(plan) && !user, () => learnFromCustomers({ user, planDoc })),
      products: run(err(products), () => learnFromProducts(products)),
      results: run(err(results), () => learnFromResults({ ...results, now })),
      competitors: run(err(competitors), () => learnFromCompetitors({ entitled, ...(competitors || {}), now }))
    };
  }

  function sourcesSummary(results, items, prevSources, now) {
    const out = {};
    for (const s of SOURCES) {
      const r = results[s] || { state: 'error', reason: ERROR_REASON };
      const kept = items.filter((i) => i.source === s).length;
      out[s] = {
        state: kept && r.state !== 'error' ? 'learned' : r.state,
        reason: kept && r.state !== 'error' ? '' : r.reason,
        evidenceCount: r.state === 'error' ? ((prevSources && prevSources[s] && prevSources[s].evidenceCount) || 0) : (r.evidenceCount || 0),
        evidenceUnit: r.evidenceUnit || ((prevSources && prevSources[s] && prevSources[s].evidenceUnit) || ''),
        itemCount: kept,
        checkedAt: now
      };
    }
    return out;
  }

  /**
   * Refresh one account. `manual`: the Refresh now button (cooldown applies). Returns
   * { ok: true, changed } or { ok: false, reason: 'no_user' | 'staff' | 'busy' | 'cooldown' | 'timeout' | 'failed', retryAfterMs? }.
   */
  async function refreshAccount(userId, { manual = false, user: given = null } = {}) {
    const id = idOf(userId);
    const now = deps.now();
    const user = given || await deps.loadUser(id);
    if (!user) return { ok: false, reason: 'no_user' };
    if (isStaff(user)) return { ok: false, reason: 'staff' };
    const before = await deps.findDoc(id);
    if (!(await deps.claimLock(id, now, { manual }))) {
      const doc = await deps.findDoc(id);
      const lockedUntil = toDate(doc && doc.learnedLockUntil);
      const manualAt = toDate(doc && doc.learnedManualAt);
      if (manual && manualAt && now.getTime() - manualAt.getTime() < TIMING.COOLDOWN_MS && !(lockedUntil && lockedUntil > now)) {
        return { ok: false, reason: 'cooldown', retryAfterMs: TIMING.COOLDOWN_MS - (now.getTime() - manualAt.getTime()) };
      }
      return { ok: false, reason: 'busy' };
    }
    const restore = manual ? { learnedManualAt: (before && before.learnedManualAt) || null } : {};
    try {
      const results = await withTimeout(learnAll(id, user, now), deps.budgetMs || TIMING.ACCOUNT_BUDGET_MS);
      const hidden = ((before && before.learnedHidden) || []).slice(-LIMITS.MAX_HIDDEN);
      const items = mergeItems({ previous: (before && before.learnedItems) || [], results, hidden, now });
      const sources = sourcesSummary(results, items, before && before.learnedSources, now);
      const fp = fingerprint(items, sources);
      const changed = !before || before.learnedFingerprint !== fp;
      const base = { learnedRefreshedAt: now, learnedCheckedAt: now };
      await deps.save(id, changed ? { ...base, learnedItems: items, learnedSources: sources, learnedFingerprint: fp, learnedHidden: hidden } : { ...base, learnedSources: sources });
      return { ok: true, changed };
    } catch (e) {
      try { await deps.release(id, restore); } catch (_) { /* the lock runs out on its own */ }
      if (e && e.code === 'TIMEBOX') return { ok: false, reason: 'timeout' };
      console.warn(`[brand memory] refresh failed for ${id}: ${e && e.message}`);
      return { ok: false, reason: 'failed' };
    }
  }

  /** True when a source changed after the last refresh (or there was none). Never throws (a failed check says yes). */
  async function needsRefresh(userId, user, doc, now = deps.now()) {
    const at = toDate(doc && doc.learnedRefreshedAt);
    if (!at) return true;
    if (now.getTime() - at.getTime() > TIMING.JOB_STALE_MS) return true;
    try {
      const changed = await deps.latestChange(userId, user);
      return !!(changed && changed > at);
    } catch (_) { return false; }
  }

  /** The page's answer. Refreshes first when nothing was learned yet or a source changed since. */
  async function getView(userId, { user: given = null } = {}) {
    const id = idOf(userId);
    const now = deps.now();
    const user = given || await deps.loadUser(id);
    if (isStaff(user)) return { ...buildView(null, { now }), staff: true, staffReason: STAFF_REASON };
    let doc = await deps.findDoc(id);
    let refresh = null;
    if (user && await needsRefresh(id, user, doc, now)) {
      refresh = await refreshAccount(id, { user });
      if (refresh.ok) doc = await deps.findDoc(id);
    }
    let tracked = 0;
    try { tracked = (await deps.trackedCount(id)) || 0; } catch (_) { tracked = 0; }
    return { ...buildView(doc, { now }), tracked, refreshed: Boolean(refresh && refresh.ok) };
  }

  async function editItem(userId, itemKey, text) {
    const id = idOf(userId);
    const doc = await deps.findDoc(id);
    const item = ((doc && doc.learnedItems) || []).find((i) => i.key === itemKey);
    if (!item) return { ok: false, reason: 'not_found' };
    const next = editedItem(item, text, deps.now());
    await deps.editItem(id, itemKey, next);
    return { ok: true, item: next };
  }

  async function hideItem(userId, itemKey) {
    const id = idOf(userId);
    const doc = await deps.findDoc(id);
    if (!((doc && doc.learnedItems) || []).some((i) => i.key === itemKey)) return { ok: false, reason: 'not_found' };
    await deps.hideItem(id, itemKey, addHidden(doc.learnedHidden || [], itemKey));
    return { ok: true };
  }

  /** The daily job's one run. Bounded in accounts and time; one server at a time. */
  async function runDailyOnce({ limit = TIMING.JOB_BATCH, timeBoxMs = TIMING.JOB_TIME_BOX_MS } = {}) {
    const started = Date.now();
    const token = await deps.lease.claim(deps.now());
    if (!token) return { ran: false, reason: 'lease' };
    const out = { ran: true, looked: 0, refreshed: 0, unchanged: 0, skipped: 0, failed: 0, timedOut: false };
    try {
      const rows = (await deps.dueAccounts(deps.now(), limit)) || [];
      for (const row of rows) {
        if (Date.now() - started > timeBoxMs) { out.timedOut = true; break; }
        out.looked += 1;
        const id = idOf(row.userId);
        try {
          const user = await deps.loadUser(id);
          if (!user || isStaff(user) || user.isActive === false) { out.skipped += 1; await deps.touchChecked(id, deps.now()); continue; }
          if (!(await needsRefresh(id, user, row))) { out.unchanged += 1; await deps.touchChecked(id, deps.now()); continue; }
          const r = await refreshAccount(id, { user });
          if (r.ok) out.refreshed += 1;
          else { out.failed += 1; await deps.touchChecked(id, deps.now()); }
        } catch (e) {
          out.failed += 1;
          console.warn(`[brand memory] daily refresh failed for ${id}: ${e && e.message}`);
        }
      }
    } finally {
      try { await deps.lease.release(token); } catch (_) { /* runs out on its own */ }
    }
    return out;
  }

  return { refreshAccount, getView, editItem, hideItem, runDailyOnce, needsRefresh, learnAll };
}

const CONF_OF_NOTE = (c) => { const n = Number(c); const v = Number.isFinite(n) ? n : 0.5; return v >= 0.75 ? 'strong' : v >= 0.5 ? 'good' : 'early'; };
const TITLE = { plan: 'Learned from your plan', blueprint: 'Learned from your Blueprint', customers: 'Learned about your customers', products: 'Learned from your products', results: 'Learned from your results', competitors: 'Learned from your competitors' };

/** The page's shape: one block per source with its items (old model notes are items of "your results"). PURE. */
function buildView(doc, { now = new Date() } = {}) {
  const d = doc || {};
  const items = Array.isArray(d.learnedItems) ? d.learnedItems : [];
  const notes = (Array.isArray(d.learnedNotes) ? d.learnedNotes : []).filter((n) => n && typeof n.text === 'string' && n.text.trim());
  const sources = SOURCES.map((s) => {
    const sum = (d.learnedSources && d.learnedSources[s]) || null;
    const own = items.filter((i) => i.source === s).map((i) => ({
      id: i.key, type: 'item', kind: i.kind, text: i.text, evidenceText: i.evidenceText, evidenceCount: i.evidenceCount,
      confidence: i.confidence, learnedAt: i.learnedAt || null, updatedAt: i.updatedAt || null, userEdited: !!i.userEdited
    }));
    const extra = s === 'results' ? notes.map((n) => ({
      id: String(n._id), type: 'note', kind: n.category || 'copy', text: n.text,
      evidenceText: Array.isArray(n.sourceIds) && n.sourceIds.length ? `from ${n.sourceIds.length} published ${n.sourceIds.length === 1 ? 'post' : 'posts'}` : 'from your published posts',
      evidenceCount: Array.isArray(n.sourceIds) ? n.sourceIds.length : 0, confidence: CONF_OF_NOTE(n.confidence),
      learnedAt: n.createdAt || null, updatedAt: n.updatedAt || null, userEdited: !!n.userEdited
    })) : [];
    const all = [...own, ...extra];
    return {
      key: s, label: SOURCE_LABEL[s], title: TITLE[s],
      state: all.length ? 'learned' : (sum ? sum.state : 'none'),
      reason: all.length ? '' : (sum ? sum.reason : 'Nebulaa has not looked at this yet.'),
      evidenceCount: sum ? sum.evidenceCount || 0 : 0, evidenceUnit: sum ? sum.evidenceUnit || '' : '',
      checkedAt: sum ? sum.checkedAt || null : null, items: all
    };
  });
  const manualAt = toDate(d.learnedManualAt);
  const left = manualAt ? TIMING.COOLDOWN_MS - (now.getTime() - manualAt.getTime()) : 0;
  return {
    sources,
    refreshedAt: d.learnedRefreshedAt || null,
    itemCount: sources.reduce((n, s) => n + s.items.length, 0),
    cooldown: left > 0 ? { until: new Date(manualAt.getTime() + TIMING.COOLDOWN_MS).toISOString(), seconds: Math.ceil(left / 1000) } : null,
    cooldownMinutes: TIMING.COOLDOWN_MS / 60000
  };
}

// ---- the daily job and the change triggers -------------------------------------------------------------------------
let shared = null;
const sharedMemory = () => (shared = shared || createBrandMemory());
let triggersOn = false;
const pending = new Map();

/** A source changed for this account: refresh it a little later (debounced). Does nothing unless the job started. */
function refreshSoon(userId, reason = 'change') {
  try {
    if (!triggersOn || !userId) return;
    const id = idOf(userId);
    if (pending.has(id)) return;
    const t = setTimeout(() => {
      pending.delete(id);
      sharedMemory().refreshAccount(id).catch((e) => console.warn(`[brand memory] refresh after ${reason} failed: ${e && e.message}`));
    }, TIMING.TRIGGER_DEBOUNCE_MS);
    if (t.unref) t.unref();
    pending.set(id, t);
    if (pending.size > 5000) { const [k, old] = pending.entries().next().value; clearTimeout(old); pending.delete(k); }
  } catch (_) { /* a trigger never breaks the caller */ }
}

/** On by default (cheap, bounded, idempotent, no model call); ENABLE_MEMORY_REFRESH=off stops the job and the triggers. */
function startBrandMemoryJob({ env = process.env, logger = console, memory = null } = {}) {
  if (String(env.ENABLE_MEMORY_REFRESH || '').trim().toLowerCase() === 'off') {
    logger.log('[brand memory] daily refresh off (ENABLE_MEMORY_REFRESH=off)');
    return null;
  }
  triggersOn = true;
  const svc = memory || sharedMemory();
  const tick = () => Promise.resolve().then(() => svc.runDailyOnce())
    .then((r) => { if (r && r.ran && r.looked) logger.log(`[brand memory] daily refresh: looked ${r.looked}, refreshed ${r.refreshed}, unchanged ${r.unchanged}`); })
    .catch((e) => logger.warn('[brand memory] daily refresh failed:', e && e.message));
  setTimeout(tick, TIMING.JOB_FIRST_MS).unref();
  return setInterval(tick, TIMING.JOB_EVERY_MS).unref();
}

module.exports = { createBrandMemory, buildView, refreshSoon, startBrandMemoryJob, sharedMemory, STAFF_REASON, ERROR_REASON, _triggers: { set: (v) => { triggersOn = v; }, pending } };
