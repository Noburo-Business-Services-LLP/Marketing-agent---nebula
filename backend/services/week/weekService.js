'use strict';
// The week: one stored proposal per account per week, Approve, and the one place a post is charged and made.
//
// Charging (checked 2026-10-17): generateSingleCalendarItem, the image generator under it, and the monthly
// auto-generation do NOT charge. So makePost charges one image-post price before generating and refunds if no post
// comes out. Nothing here changes the generator itself.
const { shouldHavePlan } = require('../plan/planRules');
const { weekProposal } = require('./weekProposal');
const { weekStartOf, weekDays, dayOfMonth } = require('./weekMath');

const DAY_MS = 86400000;
const SLIDES = 5;   // the carousel screen's default slide count (also the route's default)
const STALE_MS = 10 * 60 * 1000; // a post 'making' for longer than this was left by a crash

// Quarks per unit for the proposal, built only from the price list: a post is one image; a carousel is its slides
// at the per-slide price (as the carousel route charges); a video is the single Videos flow's price.
function weekCosts() {
  const { QUARK_COSTS } = require('../../config/apiCosts');
  return {
    post: QUARK_COSTS.image_generated,
    carousel: SLIDES * QUARK_COSTS.carousel_generated,
    video: QUARK_COSTS.studio_video
  };
}

const DONE_STATUSES = ['rejected', 'published', 'scheduled', 'generated', 'generating'];

// Real dependencies load on first use, so requiring this file touches no database.
function defaultDeps() {
  const model = () => require('../../models/WeeklyProposal');
  const Calendar = () => require('../../models/ContentCalendar');
  const key = (q) => ({ userId: q.userId, weekStart: q.weekStart });
  let plans = null;
  return {
    get costs() { return weekCosts(); },
    pool: (userId) => require('../agency').walletBalance(userId),
    cadence: async (user) => require('../contentCalendarService').getContentCadence(user),
    // This week's rows from the account's own calendar(s), leaving out rows already made or rejected.
    calendarItemsForWeek: async ({ user, weekStart }) => {
      const days = weekDays(weekStart);
      const months = [...new Set(days.map((d) => d.slice(0, 7)))];
      const calendars = await Calendar().find({ userId: user._id, month: { $in: months } }).lean();
      const out = [];
      for (const cal of calendars) {
        const wanted = new Set(days.filter((d) => d.slice(0, 7) === cal.month).map(dayOfMonth));
        for (const week of cal.weeks || []) {
          for (const it of week.items || []) {
            if (!wanted.has(Number(it.day))) continue;
            if (it.generatedDraftId || DONE_STATUSES.includes(String(it.status || '').toLowerCase())) continue;
            out.push({ _id: it._id, day: it.day, format: it.format, headline: it.headline, contentPillar: it.contentPillar, platform: null });
          }
        }
      }
      return out.sort((a, b) => a.day - b.day);
    },
    // How many calendar rows exist for the week's days, whatever their status: the plan stands in only when this is 0.
    calendarRowCountForWeek: async ({ user, weekStart }) => {
      const days = weekDays(weekStart);
      const months = [...new Set(days.map((d) => d.slice(0, 7)))];
      const calendars = await Calendar().find({ userId: user._id, month: { $in: months } }).lean();
      let n = 0;
      for (const cal of calendars) {
        const wanted = new Set(days.filter((d) => d.slice(0, 7) === cal.month).map(dayOfMonth));
        for (const week of cal.weeks || []) for (const it of week.items || []) if (wanted.has(Number(it.day))) n += 1;
      }
      return n;
    },
    // The plan's thirty days, repeated from the day the plan was made: the entries for this week's seven days.
    planCalendarForWeek: async ({ user, weekStart }) => {
      plans = plans || require('../plan/planService').createPlanService();
      const plan = await plans.currentPlan(String(user._id));
      const entries = plan && plan.result && plan.result.plan && Array.isArray(plan.result.plan.calendar) ? plan.result.plan.calendar : [];
      if (!entries.length) return [];
      const start = new Date(`${weekStartOf(new Date(plan.completedAt))}T00:00:00Z`).getTime();
      const out = [];
      for (const d of weekDays(weekStart)) {
        const gone = Math.round((new Date(`${d}T00:00:00Z`).getTime() - start) / DAY_MS);
        if (gone < 0) continue;
        const entry = entries.find((e) => e.day === (gone % 30) + 1);
        if (entry) out.push(entry);
      }
      return out;
    },
    store: {
      find: (q) => model().findOne(key(q)).lean(),
      create: async (doc) => { const d = await model().create(doc); return d.toObject(); },
      // One conditional update: only the caller that finds the item in `from` moves it to `to`.
      claimItem: async (q, itemId, from, to, extra = {}) => {
        const $set = { 'items.$.status': to };
        Object.entries(extra).forEach(([k, v]) => { $set[`items.$.${k}`] = v; });
        const r = await model().findOneAndUpdate(
          { ...key(q), items: { $elemMatch: { id: itemId, status: from } } },
          { $set }
        ).select('_id').lean();
        return !!r;
      },
      // Takes over a post left 'making' since before `before`: one conditional update, so one runner wins.
      claimStale: async (q, itemId, before, at) => {
        const r = await model().findOneAndUpdate(
          { ...key(q), items: { $elemMatch: { id: itemId, status: 'making', makingAt: { $lt: before } } } },
          { $set: { 'items.$.makingAt': at } }
        ).select('_id').lean();
        return !!r;
      },
      // Accounts with a post approved or being made since before `before` (a crash or a stuck run left it).
      findStaleAccounts: async (before, fromWeek, limit) => {
        const docs = await model().find({
          weekStart: { $gte: fromWeek },
          items: { $elemMatch: { $or: [{ status: 'approved', approvedAt: { $lt: before } }, { status: 'making', makingAt: { $lt: before } }] } }
        }).select('userId').limit(limit * 3).lean();
        return [...new Set(docs.map((d) => String(d.userId)))].slice(0, limit);
      },
      // Weeks (from `fromWeek` on) in which this account still has posts approved or being made.
      findOpen: (userId, fromWeek) => model().find({ userId, weekStart: { $gte: fromWeek }, 'items.status': { $in: ['approved', 'making'] } }).lean(),
      // A final write by the runner that owns the post: only while it is still 'making' with the same makingAt.
      settleItem: async (q, itemId, token, patch) => {
        const $set = {};
        Object.entries(patch).forEach(([k, v]) => { $set[`items.$.${k}`] = v; });
        const r = await model().findOneAndUpdate(
          { ...key(q), items: { $elemMatch: { id: itemId, status: 'making', makingAt: token } } }, { $set }
        ).select('_id').lean();
        return !!r;
      },
      // Flips `charged` from -> to for the owning runner in one conditional update, so only one actor can refund.
      flipCharged: async (q, itemId, token, from, to, extra = {}) => {
        const $set = { 'items.$.charged': to };
        Object.entries(extra).forEach(([k, v]) => { $set[`items.$.${k}`] = v; });
        const r = await model().findOneAndUpdate(
          { ...key(q), items: { $elemMatch: { id: itemId, status: 'making', makingAt: token, charged: from } } }, { $set }
        ).select('_id').lean();
        return !!r;
      },
      setItem: async (q, itemId, patch) => {
        const $set = {};
        Object.entries(patch).forEach(([k, v]) => { $set[`items.$[i].${k}`] = v; });
        await model().updateOne(key(q), { $set }, { arrayFilters: [{ 'i.id': itemId }] });
      },
      setStatus: (q, status) => model().updateOne(key(q), { $set: { status } })
    },
    deduct: (...a) => require('../../middleware/trialGuard').deductCredits(...a),
    refund: (...a) => require('../../middleware/trialGuard').refundCredits(...a),
    // Makes one post and leaves the draft in Review and approve. A calendar row is saved afterwards so the
    // monthly auto-generation does not make the same day again.
    generate: async (calendar, calItem, weekNumber) => {
      const { generateSingleCalendarItem } = require('../backgroundQueue');
      const out = await generateSingleCalendarItem(calendar, calItem, weekNumber);
      // No picture: the post is not what was paid for. Remove what the generator made so Review and approve does not
      // show it and the calendar row is not left marked as made; the caller refunds and a retry starts clean.
      if (out && out.draft && !out.draft.imageUrl) {
        try { await require('../../models/Draft').deleteOne({ _id: out.draft._id }); } catch (e) { console.error('[week] draft cleanup failed:', e && e.message); }
        try { if (out.campaign) await require('../../models/Campaign').deleteOne({ _id: out.campaign._id }); } catch (e) { console.error('[week] campaign cleanup failed:', e && e.message); }
        return out;
      }
      // A failed save must not turn a made post into a refunded one; the generator's own row update is in memory only.
      try { if (calendar && typeof calendar.save === 'function') await calendar.save(); } catch (e) { console.error('[week] calendar save failed:', e && e.message); }
      return out;
    },
    // The calendar and row a post is made from. A plan row has no calendar row: it is made from a one-off
    // in-memory calendar (no month is generated, nothing extra is charged or saved).
    calendarFor: async ({ user, item }) => {
      if (item.calendarItemId) {
        const cal = await Calendar().findOne({ userId: user._id, 'weeks.items._id': item.calendarItemId }).sort({ createdAt: -1 });
        if (!cal) return null;
        const week = (cal.weeks || []).find((w) => (w.items || []).some((i) => String(i._id) === String(item.calendarItemId)));
        return { calendar: cal, find: (id) => require('../contentCalendarService').findItem(cal, id), weekNumber: (week && week.weekNumber) || 1 };
      }
      const p = user.businessProfile || {};
      const idx = Number(String(item.id).split(':')[1]) || 0;
      const plannedOn = weekDays(String(item.id).split(':')[0])[idx % 7];
      const day = dayOfMonth(plannedOn);
      const calendar = {
        userId: user._id, _id: null,
        businessName: p.businessName || p.name || '', niche: p.niche || '',
        businessVertical: p.businessVertical || p.industry || '', language: p.language || 'English'
      };
      const row = { day, plannedOn, headline: item.topic, creativeConcept: item.topic, format: 'image post', cta: '', objective: 'awareness' };
      return { calendar, find: () => row, weekNumber: 1 };
    },
    // First approved week: stamped once, never overwritten.
    markFirstApproval: (userId, at) => require('../../models/User').updateOne(
      { _id: userId, 'setup.firstWeekApprovedAt': { $exists: false } }, { $set: { 'setup.firstWeekApprovedAt': at } }
    ),
    loadUser: (id) => require('../../models/User').findById(id).lean(),
    blockedAccounts: () => require('../backgroundGate').blockedAccountIds(),
    spendCheck: (action) => require('../spendGuard').check(action),
    alertOwner: (a) => require('../opsAlerts').notify(a),
    now: () => new Date()
  };
}

// The display name of the account's content language (the same source the home screen uses), English when unset.
function languageOf(user) {
  const raw = user && user.businessProfile && user.businessProfile.contentLanguage;
  if (!raw) return 'English';
  try { return require('../contentCalendarService').normalizeLanguage(raw) || 'English'; } catch (e) { return 'English'; }
}
const MAX_ATTEMPTS = 3;
const GAVE_UP_MESSAGE = 'We could not make this post. Please try again later or contact support.';

// weekItemId and weekId let the create screen report back (markMade) which proposal item it made.
function prefillFor(user, item, weekStart) {
  const ids = { weekItemId: item.id, weekId: weekStart };
  if (item.kind === 'carousel') {
    return { itemId: item.id, target: 'carousel', route: '/campaigns', prefill: { mode: 'carousel', topic: item.topic, platform: item.channel || 'instagram', language: languageOf(user), ...ids } };
  }
  return { itemId: item.id, target: 'video', route: '/reels', prefill: { idea: item.topic, language: languageOf(user), ...ids } };
}

function createWeekService(given = {}) {
  const base = given.store && given.deduct && given.generate && given.calendarFor ? null : defaultDeps();
  const deps = base ? { ...base, ...given, store: given.store || base.store } : given;
  const nowOf = (now) => now || deps.now();
  // The week is the stored proposal's when one is known; the clock is used only to find this week's proposal.
  const keyOf = (user, now, weekStart) => ({ userId: user._id, weekStart: weekStart || weekStartOf(nowOf(now)) });

  async function getOrCreate({ user, now }) {
    const q = keyOf(user, now);
    if (!shouldHavePlan(user)) return { proposal: null, eligible: false, reason: 'not_eligible' };
    const existing = await deps.store.find(q);
    if (existing) return { proposal: existing, eligible: true, reason: '' };

    const [pool, cadence, calendarItems] = await Promise.all([
      deps.pool(user._id), deps.cadence(user), deps.calendarItemsForWeek({ user, weekStart: q.weekStart })
    ]);
    // The plan stands in only when the account has no calendar rows at all for these days. Rows that exist but are
    // all made, rejected or generated mean the week is done: nothing is proposed and nothing is charged.
    let planCalendar = [];
    if (!(calendarItems && calendarItems.length)) {
      const rows = deps.calendarRowCountForWeek ? await deps.calendarRowCountForWeek({ user, weekStart: q.weekStart }) : 0;
      if (rows > 0) {
        return { proposal: { ...q, status: 'proposed', items: [], scaledDown: false, removed: { videos: 0, carousels: 0, posts: 0 }, createdAt: nowOf(now) }, eligible: true, reason: 'nothing_left' };
      }
      planCalendar = await deps.planCalendarForWeek({ user, weekStart: q.weekStart });
      if (!(planCalendar && planCalendar.length)) return { proposal: null, eligible: false, reason: 'no_plan' };
    }

    const built = weekProposal({ planCalendar, calendarItems, cadence, pool, costs: deps.costs, weekStart: q.weekStart, language: languageOf(user) });
    const shell = { ...q, status: 'proposed', items: built.items.map((i) => ({ ...i, status: 'proposed', ref: null, error: null, madeAt: null })), scaledDown: built.scaledDown, removed: built.removed, createdAt: nowOf(now) };
    // A pool that pays for nothing is shown, not stored: the week stays open for after a top-up.
    if (built.empty) return { proposal: shell, eligible: true, reason: 'empty' };
    try {
      return { proposal: await deps.store.create(shell), eligible: true, reason: '' };
    } catch (e) {
      if (e && e.code === 11000) { const again = await deps.store.find(q); if (again) return { proposal: again, eligible: true, reason: '' }; }
      throw e;
    }
  }

  const isMade = (row) => !!row && (!!row.generatedDraftId || ['generated', 'scheduled', 'published'].includes(String(row.status || '').toLowerCase()));

  // A refund by the owner, at most once: `charged` flips true -> false first, so only one actor can refund. If the
  // refund itself fails the flag goes back to true (the customer has paid), the post is failed as 'refund_failed' and
  // the owner is alerted to refund by hand; such a post is never charged again.
  async function refundOwned({ q, user, item, token }) {
    const won = await deps.store.flipCharged(q, item.id, token, true, false);
    if (!won) return { refunded: false, lost: true };
    let r;
    try { r = await deps.refund(String(user._id), 'image_generated', 1, 'Refund: weekly plan post could not be made', item.chargedTo ? { payerId: item.chargedTo } : {}); } catch (e) { r = { success: false }; }
    if (r && r.success) return { refunded: true };
    try { await deps.store.flipCharged(q, item.id, token, false, true); } catch (e) { console.error('[week] could not restore charged flag:', e && e.message); }
    await alertRefund(user, item, q);
    return { refunded: false, refundFailed: true };
  }

  async function alertRefund(user, item, q) {
    console.error(`[week] REFUND FAILED user=${user._id} week=${q.weekStart} item=${item.id}`);
    try {
      if (deps.alertOwner) await deps.alertOwner({ key: `week_refund_failed:${user._id}:${item.id}`, cooldownMs: 6 * 3600000, subject: 'Nebulaa alert: a weekly post refund failed', text: `A weekly plan post could not be made and its refund also failed. Account ${user._id}, week ${q.weekStart}, item ${item.id}. The customer has been charged one post and the post is marked failed. Please refund it by hand. It will not be charged again if retried.` });
    } catch (_) { /* alerting never blocks */ }
  }

  // Charge, make, and settle one post this runner owns (`token` is the makingAt it set when it took the post).
  // Every final write is conditional on that token: a runner that lost the post stops without writing or refunding.
  async function makePost({ user, item: given, token, weekStart, now }) {
    const q = keyOf(user, now, weekStart || (given && given.weekStart));
    const id = String(user._id);
    // Read the item fresh: a snapshot taken before the claim may not show a charge another runner has made since.
    const doc = await deps.store.find(q);
    const item = (doc && doc.items.find((i) => i.id === given.id)) || given;
    if (item.status === 'made') return { ok: true, ref: item.ref };
    const own = token === undefined ? item.makingAt : token;
    const settle = (patch) => deps.store.settleItem(q, item.id, own, patch);
    // After MAX_ATTEMPTS failed attempts the post shows 'gave_up' and no longer takes "Try again". A shortage of
    // Quarks ('no_pool') and a failed refund keep their own reasons: the first points to top-up, the second to staff.
    const fail = async (error) => {
      const shown = (item.attempts || 0) >= MAX_ATTEMPTS && error !== 'no_pool' && error !== 'refund_failed' ? 'gave_up' : error;
      const ok = await settle({ status: 'failed', error: shown });
      return ok ? { ok: false, error: shown } : { ok: false, lost: true };
    };

    const ctx = await deps.calendarFor({ user, item, weekStart: q.weekStart });
    if (!ctx) return fail('no_calendar');
    const calItem = ctx.find(item.calendarItemId, item);
    if (!calItem) return fail('no_calendar');

    // A row already made (by auto-generation or another path): adopt its draft, charge nothing.
    if (isMade(calItem)) {
      if (!calItem.generatedDraftId) return fail('already_made');
      const ok = await settle({ status: 'made', ref: String(calItem.generatedDraftId), error: null, madeAt: nowOf(now) });
      return ok ? { ok: true, ref: String(calItem.generatedDraftId), adopted: true } : { ok: false, lost: true };
    }

    // The daily spend ceiling and provider switches: leave the post approved to be picked up later, charge nothing.
    const gate = deps.spendCheck ? await deps.spendCheck('image_generated') : { ok: true };
    if (gate && gate.ok === false) {
      await settle({ status: 'approved', makingAt: null });
      return { ok: false, reason: 'busy' };
    }

    // Charged once: a post picked up again after a crash already carries charged: true and is not charged again.
    if (!item.charged) {
      let paid;
      try { paid = await deps.deduct(id, 'image_generated', 1, 'Weekly plan post'); } catch (e) { paid = { success: false }; }
      if (!paid || !paid.success) return fail('no_pool');
      let stored = false;
      try { stored = await deps.store.flipCharged(q, item.id, own, false, true, { chargedTo: paid.payerId ? String(paid.payerId) : null }); } catch (e) { stored = false; }
      if (!stored) {
        // The charge could not be recorded: give it back at once (to the wallet that paid), and fail the post.
        let r;
        try { r = await deps.refund(id, 'image_generated', 1, 'Refund: weekly plan post charge could not be recorded', paid.payerId ? { payerId: paid.payerId } : {}); } catch (e) { r = { success: false }; }
        if (!(r && r.success)) { await alertRefund(user, item, q); await settle({ status: 'failed', error: 'refund_failed' }); return { ok: false, error: 'refund_failed' }; }
        return fail('charge_not_recorded');
      }
      item.chargedTo = paid.payerId ? String(paid.payerId) : null;
    }

    const failRefunded = async (error) => {
      const r = await refundOwned({ q, user, item, token: own });
      if (r.lost) return { ok: false, lost: true };
      if (r.refundFailed) { await settle({ status: 'failed', error: 'refund_failed' }); return { ok: false, error: 'refund_failed' }; }
      return fail(error);
    };
    // A swapped idea is what gets made.
    if (item.topic && calItem.headline !== item.topic && item.source === 'calendar') Object.assign(calItem, { headline: item.topic, creativeConcept: item.topic });
    let out;
    try {
      out = await deps.generate(ctx.calendar, calItem, ctx.weekNumber);
    } catch (e) {
      return failRefunded('generation_failed');
    }
    const draft = out && out.draft;
    const ref = draft ? draft._id : out && out.draftId;
    // The generator keeps a post whose picture failed; a post without a picture is not what was paid for.
    if (!ref || (draft && !draft.imageUrl)) return failRefunded('generation_failed');
    const ok = await settle({ status: 'made', ref: String(ref), error: null, madeAt: nowOf(now) });
    return ok ? { ok: true, ref: String(ref) } : { ok: false, lost: true };
  }

  // Approve only claims: proposed -> approved, atomically, and returns at once. Posts are made by runApprovedPosts.
  async function approve({ user, itemIds, now, weekStart, stampFirst = true }) {
    const doc = await deps.store.find(keyOf(user, now, weekStart));
    if (!doc || doc.status === 'skipped') return { proposal: doc || null, started: 0, prefills: [], gaveUp: [] };
    const q = keyOf(user, now, doc.weekStart);
    const at = nowOf(now);
    const selected = doc.items.filter((i) => !Array.isArray(itemIds) || itemIds.includes(i.id));
    const prefills = [];
    let started = 0;
    let claimed = 0;
    const gaveUp = [];
    for (const it of selected) {
      if (it.status === 'failed' && it.error === 'gave_up') { gaveUp.push(it.id); continue; }
      // Failed posts are retried; everything else must still be proposed. One conditional update decides who owns it.
      const froms = it.kind === 'post' ? ['proposed', 'failed'] : ['proposed'];
      let won = false;
      for (const from of froms) { if (await deps.store.claimItem(q, it.id, from, 'approved', { approvedAt: at })) { won = true; break; } }
      if (!won) continue;
      claimed += 1;
      if (it.kind === 'post') started += 1; else prefills.push(prefillFor(user, it, q.weekStart));
    }
    if (doc.status === 'proposed') await deps.store.setStatus(q, 'approved');
    // Only the customer's own approval counts for setup: a CSM or agency pass passes stampFirst: false.
    if (claimed > 0 && stampFirst && deps.markFirstApproval) await deps.markFirstApproval(user._id, at);
    return { proposal: await deps.store.find(q), started, prefills, gaveUp, message: gaveUp.length && !claimed ? GAVE_UP_MESSAGE : undefined };
  }

  // Makes every approved post, one at a time (each is a paid image), across this account's open weeks of the last
  // 14 days. A post is owned by whoever moves it approved -> making; one left 'making' for over ten minutes is taken
  // over (and not charged again). Each post is handled in the week of the proposal it belongs to.
  async function runApprovedPosts({ user, now }) {
    const at = nowOf(now);
    const before = new Date(at.getTime() - STALE_MS);
    const fromWeek = weekStartOf(new Date(at.getTime() - 14 * 86400000));
    const docs = await deps.store.findOpen(user._id, fromWeek);
    let made = 0; let failed = 0; let busy = false;
    for (const doc of docs || []) {
      const q = keyOf(user, now, doc.weekStart);
      for (const it of doc.items) {
        if (busy) break;
        if (it.kind !== 'post') continue;
        let mine = false;
        if (it.status === 'approved') mine = await deps.store.claimItem(q, it.id, 'approved', 'making', { makingAt: at });
        else if (it.status === 'making' && it.makingAt && new Date(it.makingAt) < before && deps.store.claimStale) mine = await deps.store.claimStale(q, it.id, before, at);
        if (!mine) continue;
        // One more attempt has started (counted on the post, written only while this runner owns it).
        it.attempts = (it.attempts || 0) + 1;
        try { await deps.store.settleItem(q, it.id, at, { attempts: it.attempts }); } catch (e) { console.error('[week] could not count the attempt:', e && e.message); }
        let out;
        try { out = await makePost({ user, item: it, token: at, weekStart: doc.weekStart, now }); } catch (e) {
          // The post stays 'making'; a later run takes it over after ten minutes, without a second charge.
          console.error('[week] makePost crashed:', e && e.message); out = { ok: false, crashed: true };
        }
        if (out.reason === 'busy') { busy = true; break; }
        if (out.ok) made += 1; else if (!out.lost) failed += 1;
      }
    }
    return { made, failed, busy, proposal: await deps.store.find(keyOf(user, now)) };
  }

  async function change({ user, itemId, action, topic, now, weekStart }) {
    const doc = await deps.store.find(keyOf(user, now, weekStart));
    if (!doc) return { ok: false };
    const q = keyOf(user, now, doc.weekStart);
    if (action === 'skip') {
      const ok = await deps.store.claimItem(q, itemId, 'proposed', 'skipped');
      return { ok, proposal: ok ? await deps.store.find(q) : undefined };
    }
    if (action === 'swap') {
      const t = String(topic || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!t) return { ok: false, error: 'topic_required' };
      // One conditional update: the topic is written only if the item is still proposed.
      const ok = await deps.store.claimItem(q, itemId, 'proposed', 'proposed', { topic: t });
      return ok ? { ok: true, proposal: await deps.store.find(q) } : { ok: false };
    }
    return { ok: false, error: 'bad_action' };
  }

  async function skipWeek({ user, now, weekStart }) {
    const doc = await deps.store.find(keyOf(user, now, weekStart));
    if (!doc || doc.status !== 'proposed') return { ok: false, proposal: doc || null };
    const q = keyOf(user, now, doc.weekStart);
    for (const it of doc.items) await deps.store.claimItem(q, it.id, 'proposed', 'skipped');
    await deps.store.setStatus(q, 'skipped');
    return { ok: true, proposal: await deps.store.find(q) };
  }

  // The create screen reports back a carousel or video it made: approved -> made, once, with the id it made.
  async function markMade({ user, itemId, ref, now, weekStart }) {
    const id = String(itemId || '');
    const made = String(ref === undefined || ref === null ? '' : ref).trim().slice(0, 100);
    if (!id || !made) return { ok: false, error: 'bad_request' };
    const doc = await deps.store.find(keyOf(user, now, weekStart));
    const it = doc && doc.items.find((i) => i.id === id);
    if (!it || it.kind === 'post') return { ok: false, error: 'not_found' };
    if (it.status === 'made') return { ok: true, proposal: doc }; // already recorded: nothing changes
    if (it.status !== 'approved') return { ok: false, error: 'not_approved' };
    const q = keyOf(user, now, doc.weekStart);
    const ok = await deps.store.claimItem(q, id, 'approved', 'made', { ref: made, madeAt: nowOf(now), error: null });
    if (!ok) {
      const again = await deps.store.find(q);
      const now2 = again && again.items.find((i) => i.id === id);
      return now2 && now2.status === 'made' ? { ok: true, proposal: again } : { ok: false, error: 'not_approved' };
    }
    return { ok: true, proposal: await deps.store.find(q) };
  }

  // Crash recovery without anyone opening Home: accounts with posts approved or being made for over ten minutes get
  // their run, one account at a time. Gated accounts and accounts that no longer qualify are left alone.
  async function recoverOpenWeeks({ limit = 50, now } = {}) {
    const at = nowOf(now);
    const before = new Date(at.getTime() - STALE_MS);
    const fromWeek = weekStartOf(new Date(at.getTime() - 14 * DAY_MS));
    const ids = (await deps.store.findStaleAccounts(before, fromWeek, limit)) || [];
    let blocked = [];
    try { blocked = deps.blockedAccounts ? await deps.blockedAccounts() : []; } catch (e) { return { ran: 0, skipped: ids.length }; }
    let ran = 0; let skipped = 0;
    for (const id of ids) {
      if (blocked.some((b) => String(b) === String(id))) { skipped += 1; continue; }
      try {
        const user = await deps.loadUser(id);
        if (!user || !shouldHavePlan(user)) { skipped += 1; continue; }
        const out = await runApprovedPosts({ user, now: at });
        ran += 1;
        if (out.busy) break;
      } catch (e) { console.error('[week] recovery failed for one account:', e && e.message); skipped += 1; }
    }
    return { ran, skipped };
  }

  return { getOrCreate, approve, runApprovedPosts, change, skipWeek, makePost, markMade, recoverOpenWeeks };
}

module.exports = { createWeekService, weekCosts, defaultCosts: weekCosts, defaultDeps };
