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
const SLIDES = 5;   // slides in a carousel, as the carousel screen makes by default
const SCENES = 5;   // scenes in a video, as the calendar's own reel build uses

// Quarks per unit for the proposal, from the price list. A post is one image; a carousel is its slides; a video is
// the base plus its scenes (the same sum the video route charges).
function defaultCosts() {
  const { QUARK_COSTS } = require('../../config/apiCosts');
  return {
    post: QUARK_COSTS.image_generated,
    carousel: SLIDES * QUARK_COSTS.carousel_generated,
    video: QUARK_COSTS.video_base + SCENES * QUARK_COSTS.video_generated
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
    get costs() { return defaultCosts(); },
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
      claimItem: async (q, itemId, from, to) => {
        const r = await model().findOneAndUpdate(
          { ...key(q), items: { $elemMatch: { id: itemId, status: from } } },
          { $set: { 'items.$.status': to } }
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
      if (calendar && typeof calendar.save === 'function') await calendar.save();
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
      const day = dayOfMonth(weekDays(String(item.id).split(':')[0])[idx % 7]);
      const calendar = {
        userId: user._id, _id: null,
        businessName: p.businessName || p.name || '', niche: p.niche || '',
        businessVertical: p.businessVertical || p.industry || '', language: p.language || 'English'
      };
      const row = { day, headline: item.topic, creativeConcept: item.topic, format: 'image post', cta: '', objective: 'awareness' };
      return { calendar, find: () => row, weekNumber: 1 };
    },
    now: () => new Date()
  };
}

const languageOf = (user) => (user && user.businessProfile && user.businessProfile.language) || 'English';
const POST_DONE = ['made', 'skipped'];

function prefillFor(user, item) {
  if (item.kind === 'carousel') {
    return { itemId: item.id, target: 'carousel', route: '/campaigns', prefill: { mode: 'carousel', topic: item.topic, platform: item.channel || 'instagram', language: languageOf(user) } };
  }
  return { itemId: item.id, target: 'video', route: '/reels', prefill: { idea: item.topic, language: languageOf(user) } };
}

function createWeekService(given = {}) {
  const base = given.store && given.deduct && given.generate && given.calendarFor ? null : defaultDeps();
  const deps = base ? { ...base, ...given, store: given.store || base.store } : given;
  const nowOf = (now) => now || deps.now();
  const keyOf = (user, now) => ({ userId: user._id, weekStart: weekStartOf(nowOf(now)) });

  async function getOrCreate({ user, now }) {
    const q = keyOf(user, now);
    if (!shouldHavePlan(user)) return { proposal: null, eligible: false, reason: 'not_eligible' };
    const existing = await deps.store.find(q);
    if (existing) return { proposal: existing, eligible: true, reason: '' };

    const [pool, cadence, calendarItems, planCalendar] = await Promise.all([
      deps.pool(user._id), deps.cadence(user), deps.calendarItemsForWeek({ user, weekStart: q.weekStart }), deps.planCalendarForWeek({ user, weekStart: q.weekStart })
    ]);
    if (!(calendarItems && calendarItems.length) && !(planCalendar && planCalendar.length)) return { proposal: null, eligible: false, reason: 'no_plan' };

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

  // Charge, make, and settle one post that this caller has already claimed (status 'approved').
  async function makePost({ user, item, now }) {
    const q = keyOf(user, now);
    const id = String(user._id);
    if (item.status === 'made') return { ok: true, ref: item.ref };
    const fail = async (error) => { await deps.store.setItem(q, item.id, { status: 'failed', error }); return { ok: false, error }; };

    const ctx = await deps.calendarFor({ user, item, weekStart: q.weekStart });
    if (!ctx) return fail('no_calendar');
    const calItem = ctx.find(item.calendarItemId, item);
    if (!calItem) return fail('no_calendar');

    let paid;
    try { paid = await deps.deduct(id, 'image_generated', 1, 'Weekly plan post'); } catch (e) { paid = { success: false }; }
    if (!paid || !paid.success) return fail('no_pool');

    const refund = async () => { try { await deps.refund(id, 'image_generated', 1, 'Refund: weekly plan post could not be made'); } catch (e) { console.error('[week] refund failed:', e && e.message); } };
    // A swapped idea is what gets made.
    if (item.topic && calItem.headline !== item.topic && item.source === 'calendar') Object.assign(calItem, { headline: item.topic, creativeConcept: item.topic });
    let out;
    try {
      out = await deps.generate(ctx.calendar, calItem, ctx.weekNumber);
    } catch (e) {
      await refund();
      return fail('generation_failed');
    }
    const draft = out && out.draft;
    const ref = draft ? draft._id : out && out.draftId;
    // The generator keeps a post whose picture failed; a post without a picture is not what was paid for.
    if (!ref || (draft && !draft.imageUrl)) { await refund(); return fail('generation_failed'); }
    await deps.store.setItem(q, item.id, { status: 'made', ref: String(ref), error: null, madeAt: nowOf(now) });
    return { ok: true, ref: String(ref) };
  }

  async function approve({ user, itemIds, now }) {
    const q = keyOf(user, now);
    const doc = await deps.store.find(q);
    if (!doc || doc.status === 'skipped') return { proposal: doc || null, started: 0, prefills: [] };
    const selected = doc.items.filter((i) => !Array.isArray(itemIds) || itemIds.includes(i.id));
    const prefills = [];
    const toMake = [];
    for (const it of selected) {
      // Failed posts are retried; everything else must still be proposed. One conditional update decides who owns it.
      const froms = it.kind === 'post' ? ['proposed', 'failed'] : ['proposed'];
      let won = false;
      for (const from of froms) { if (await deps.store.claimItem(q, it.id, from, 'approved')) { won = true; break; } }
      if (!won) continue;
      if (it.kind === 'post') toMake.push(it); else prefills.push(prefillFor(user, it));
    }
    if (doc.status === 'proposed') await deps.store.setStatus(q, 'approved');
    // One at a time: each is a paid image, and a failure of one must not stop the rest.
    for (const it of toMake) {
      try { await makePost({ user, item: it, now }); } catch (e) { console.error('[week] makePost crashed:', e && e.message); await deps.store.setItem(q, it.id, { status: 'failed', error: 'generation_failed' }); }
    }
    return { proposal: await deps.store.find(q), started: toMake.length, prefills };
  }

  async function change({ user, itemId, action, topic, now }) {
    const q = keyOf(user, now);
    if (action === 'skip') {
      const ok = await deps.store.claimItem(q, itemId, 'proposed', 'skipped');
      return { ok, proposal: ok ? await deps.store.find(q) : undefined };
    }
    if (action === 'swap') {
      const t = String(topic || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!t) return { ok: false, error: 'topic_required' };
      // A no-op conditional update proves the item is still proposed; the topic is written right after.
      const ok = await deps.store.claimItem(q, itemId, 'proposed', 'proposed');
      if (!ok) return { ok: false };
      await deps.store.setItem(q, itemId, { topic: t });
      return { ok: true, proposal: await deps.store.find(q) };
    }
    return { ok: false, error: 'bad_action' };
  }

  async function skipWeek({ user, now }) {
    const q = keyOf(user, now);
    const doc = await deps.store.find(q);
    if (!doc || doc.status !== 'proposed') return { ok: false, proposal: doc || null };
    for (const it of doc.items) await deps.store.claimItem(q, it.id, 'proposed', 'skipped');
    await deps.store.setStatus(q, 'skipped');
    return { ok: true, proposal: await deps.store.find(q) };
  }

  return { getOrCreate, approve, change, skipWeek, makePost };
}

module.exports = { createWeekService, defaultCosts };
