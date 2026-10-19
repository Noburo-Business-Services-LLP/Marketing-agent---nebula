'use strict';
/**
 * What may happen to a post (a Draft) and when: approve, unapprove, unschedule, Bin, archive, restore, the publish gate
 * and the Library counts. routes/drafts.js is a thin layer over this file. See
 * docs/superpowers/impact-maps/simplify-navigation.md, "Phase 1 backend built".
 *
 * Rules (owner decisions, 2026-10-19):
 *  - Approve never posts. With a planned date ahead and the right to schedule (Publish add-on rules), it schedules the
 *    post for that date through the existing scheduler (a Campaign in 'scheduled'). Otherwise the post waits as 'approved'.
 *  - Automation posts must be approved (or scheduled through approve) before publish or schedule accept them (409).
 *    Manual posts can be posted or scheduled straight away.
 *  - Delete moves to the Bin ('binned', binnedAt, binnedFrom): restorable for 14 days, then services/binPurge.js removes
 *    it for good. Posted items cannot be binned (archive them). Scheduled items must be unscheduled first.
 *  - Archive (and Reject, which is an archive that also marks the calendar day) is restorable any time.
 */
const mongoose = require('mongoose');
const { canUse } = require('../config/entitlements');
const { originOf, needsApprovalFilter, awaitingFilter, automationClauses } = require('./draftStatus');

const BIN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
// Approving schedules only when the planned time is at least this far ahead; closer than that it waits as approved.
const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;
// A scheduled post this close to its time may already be in the scheduler's hands, so it cannot be unscheduled.
const UNSCHEDULE_CUTOFF_MS = 2 * 60 * 1000;

const MSG = Object.freeze({
  notFound: 'Draft not found',
  approveFirst: 'Approve this post first.',
  restoreFromBin: 'Restore this post from the Bin first.',
  restoreFirst: 'Restore this post first.',
  stillMaking: 'This post is still being made. Please try again when it is ready.',
  didNotFinish: 'This post did not finish. Make it again before approving it.',
  alreadyPosted: 'This post has already gone out.',
  unscheduleFirst: 'Unschedule this post first.',
  postedNoBin: 'Posted items cannot go to the Bin. Archive them instead.',
  aboutToGo: 'This post is about to go out and can no longer be unscheduled.',
  goingOut: 'This post is already going out and can no longer be unscheduled.',
  notScheduled: 'This post is not scheduled.',
  notApproved: 'This post is not approved.',
  binExpired: 'This item was in the Bin for more than 14 days and can no longer be restored.',
  notRestorable: 'Only items in the Bin or in Archived can be restored.',
  changed: 'This item changed in the meantime. Please refresh and try again.',
  approvedWaits: 'Approved. You can schedule it, post it now or download it.',
  approvedScheduled: 'Approved and scheduled for its planned date.',
  binned: 'Moved to the Bin. You can restore it for 14 days.',
  archived: 'Archived. You can restore it at any time.',
  restored: 'Restored.',
  unscheduled: 'Unscheduled. The post is approved and waits for a new time.',
  unapproved: 'Moved back to Needs approval.'
});

const clean = (s) => String(s === undefined || s === null || s === '' ? 'draft' : s).trim().toLowerCase();
const WAITING = ['pending', 'draft', 'ready', 'completed'];
const AUTOMATION_SENDABLE = ['approved', 'scheduled', 'published'];
const RESTORE_TARGETS = ['draft', 'pending', 'ready', 'completed', 'approved', 'failed', 'published', 'archived'];

// Fields an edit (PUT /drafts/:id, POST /drafts/save) may never set: status and origin change only through the routes
// that enforce the rules above, and the calendar link is what old rows derive their origin from.
const PROTECTED_FIELDS = Object.freeze([
  '_id', 'userId', 'status', 'origin', 'approvedAt', 'binnedAt', 'binnedFrom', 'archivedFrom', 'plannedDate',
  'contentCalendarId', 'calendarDay', 'calendarWeek', 'campaignId', 'createdAt', 'updatedAt'
]);

function editableFields(body) {
  const out = {};
  for (const [k, v] of Object.entries(body && typeof body === 'object' ? body : {})) {
    if (!PROTECTED_FIELDS.includes(k)) out[k] = v;
  }
  return out;
}

/** GET /drafts ?status=: the Bin is never part of a normal list. */
function listStatusFilter(status) {
  if (!status || status === 'all') return { $ne: 'binned' };
  if (status === 'draft') return { $in: ['draft', 'processing', 'completed', 'failed'] };
  return String(status);
}

/** null when the post may be published or scheduled now; else { status, message }. */
function publishGate(draft) {
  const s = clean(draft && draft.status);
  if (s === 'binned') return { status: 409, message: MSG.restoreFromBin };
  if (originOf(draft) === 'automation' && !AUTOMATION_SENDABLE.includes(s)) return { status: 409, message: MSG.approveFirst };
  return null;
}

/** 10:00 India time on a planned day, from 'YYYY-MM-DD' or a calendar month 'YYYY-MM' plus a day. null when unknown. */
function plannedDateFor({ isoDate, month, day } = {}) {
  let iso = '';
  if (typeof isoDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)) iso = isoDate;
  else if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) && Number.isInteger(Number(day)) && Number(day) >= 1 && Number(day) <= 31) {
    iso = `${month}-${String(Number(day)).padStart(2, '0')}`;
  }
  if (!iso) return null;
  const d = new Date(`${iso}T10:00:00+05:30`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return d;
}

/** The date the post was planned for: plannedDate, else a date saved with it (not the time of a live schedule). */
function plannedDateOf(draft) {
  const raw = (draft && draft.plannedDate) || (draft && clean(draft.status) !== 'scheduled' && draft.scheduledDate) || null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeRestoreTarget(previous) {
  const s = clean(previous);
  if (s === 'scheduled') return 'approved';
  if (s === 'processing') return 'failed';
  return RESTORE_TARGETS.includes(s) ? s : 'draft';
}

/** For the campaign routes: a campaign linked to an automation post that is not approved may not go out. */
async function campaignApprovalBlock(campaign, userId, { Draft = require('../models/Draft') } = {}) {
  if (!campaign || !campaign._id) return null;
  const draft = await Draft.findOne({ userId, campaignId: campaign._id });
  if (!draft) return null;
  const gate = publishGate(draft);
  return gate && gate.message === MSG.approveFirst ? gate : null;
}

const ok = (json) => ({ status: 200, json: { success: true, ...json } });
const no = (status, message) => ({ status, json: { success: false, message } });

function createPostActions({
  Draft = require('../models/Draft'),
  Campaign = require('../models/Campaign'),
  loadUser = (id) => require('../models/User').findById(id),
  upsertCampaign,
  now = () => new Date()
} = {}) {
  const owned = async (userId, id) => {
    if (!mongoose.isValidObjectId(id)) return null;
    return Draft.findOne({ _id: id, userId });
  };
  const changeIf = async (userId, draft, from, $set) => {
    const r = await Draft.updateOne({ _id: draft._id, userId, status: from }, { $set });
    return Number(r && (r.matchedCount !== undefined ? r.matchedCount : r.n)) > 0;
  };
  const canSchedule = async (userId) => {
    try {
      const user = await loadUser(userId);
      return !!(user && canUse(user, 'schedule').allowed);
    } catch (_) { return false; }
  };

  async function approve(userId, id) {
    const draft = await owned(userId, id);
    if (!draft) return no(404, MSG.notFound);
    const s = clean(draft.status);
    if (s === 'binned') return no(409, MSG.restoreFromBin);
    if (s === 'archived' || s === 'rejected') return no(409, MSG.restoreFirst);
    if (s === 'processing') return no(409, MSG.stillMaking);
    if (s === 'failed') return no(409, MSG.didNotFinish);
    if (s === 'published' || s === 'posted') return no(409, MSG.alreadyPosted);
    if (s === 'scheduled') return ok({ outcome: 'scheduled', draft, message: MSG.approvedScheduled });
    if (!WAITING.includes(s) && s !== 'approved') return no(409, MSG.changed);

    const at = now();
    const planned = plannedDateOf(draft);
    if (planned && planned.getTime() > at.getTime() + MIN_SCHEDULE_LEAD_MS && await canSchedule(userId)) {
      draft.scheduledDate = planned;
      draft.status = 'scheduled';
      draft.approvedAt = at;
      await draft.save();
      const campaign = await upsertCampaign(draft, userId, 'scheduled');
      draft.campaignId = campaign._id;
      await draft.save();
      return ok({ outcome: 'scheduled', draft, message: MSG.approvedScheduled });
    }
    draft.status = 'approved';
    draft.approvedAt = at;
    await draft.save();
    return ok({ outcome: 'approved', draft, message: MSG.approvedWaits });
  }

  async function unapprove(userId, id) {
    const draft = await owned(userId, id);
    if (!draft) return no(404, MSG.notFound);
    if (clean(draft.status) !== 'approved') return no(409, MSG.notApproved);
    if (!(await changeIf(userId, draft, 'approved', { status: 'draft', approvedAt: null }))) return no(409, MSG.changed);
    return ok({ message: MSG.unapproved });
  }

  async function unschedule(userId, id) {
    const draft = await owned(userId, id);
    if (!draft) return no(404, MSG.notFound);
    if (clean(draft.status) !== 'scheduled') return no(409, MSG.notScheduled);
    const at = now();
    if (draft.scheduledDate && new Date(draft.scheduledDate).getTime() <= at.getTime() + UNSCHEDULE_CUTOFF_MS) return no(409, MSG.aboutToGo);
    if (draft.campaignId) {
      const r = await Campaign.updateOne({ _id: draft.campaignId, userId, status: 'scheduled' }, { $set: { status: 'draft' } });
      if (!(Number(r && r.matchedCount) > 0)) {
        const c = await Campaign.findOne({ _id: draft.campaignId, userId }).lean();
        if (c && clean(c.status) !== 'draft') return no(409, MSG.goingOut);
      }
    }
    const planned = draft.scheduledDate || draft.plannedDate || null;
    if (!(await changeIf(userId, draft, 'scheduled', { status: 'approved', scheduledDate: null, plannedDate: planned }))) return no(409, MSG.changed);
    return ok({ message: MSG.unscheduled });
  }

  async function bin(userId, id) {
    const draft = await owned(userId, id);
    if (!draft) return no(404, MSG.notFound);
    const s = clean(draft.status);
    if (s === 'binned') return ok({ message: MSG.binned });
    if (s === 'published' || s === 'posted') return no(409, MSG.postedNoBin);
    if (s === 'scheduled') return no(409, MSG.unscheduleFirst);
    if (s === 'processing') return no(409, MSG.stillMaking);
    if (!(await changeIf(userId, draft, draft.status, { status: 'binned', binnedAt: now(), binnedFrom: s }))) return no(409, MSG.changed);
    return ok({ message: MSG.binned });
  }

  async function archive(userId, id) {
    const draft = await owned(userId, id);
    if (!draft) return no(404, MSG.notFound);
    const s = clean(draft.status);
    if (s === 'archived') return ok({ message: MSG.archived, draft });
    if (s === 'binned') return no(409, MSG.restoreFromBin);
    if (s === 'scheduled') return no(409, MSG.unscheduleFirst);
    if (s === 'processing') return no(409, MSG.stillMaking);
    if (!(await changeIf(userId, draft, draft.status, { status: 'archived', archivedFrom: s }))) return no(409, MSG.changed);
    return ok({ message: MSG.archived, draft });
  }

  async function restore(userId, id) {
    const draft = await owned(userId, id);
    if (!draft) return no(404, MSG.notFound);
    const s = clean(draft.status);
    if (s === 'binned') {
      const cutoff = new Date(now().getTime() - BIN_DAYS * DAY_MS);
      if (!draft.binnedAt || new Date(draft.binnedAt) < cutoff) return no(410, MSG.binExpired);
      const target = safeRestoreTarget(draft.binnedFrom);
      const r = await Draft.updateOne({ _id: draft._id, userId, status: 'binned', binnedAt: { $gte: cutoff } }, { $set: { status: target, binnedAt: null, binnedFrom: '' } });
      if (!(Number(r && r.matchedCount) > 0)) return no(410, MSG.binExpired);
      return ok({ message: MSG.restored, restoredTo: target });
    }
    if (s === 'archived') {
      let target = draft.archivedFrom ? safeRestoreTarget(draft.archivedFrom) : 'draft';
      if (!draft.archivedFrom && draft.campaignId) {
        // An archive from before archivedFrom existed: a post whose campaign went out comes back as posted.
        const c = await Campaign.findOne({ _id: draft.campaignId, userId }).lean();
        if (c && clean(c.status) === 'posted') target = 'published';
      }
      if (target === 'archived') target = 'draft';
      if (!(await changeIf(userId, draft, draft.status, { status: target, archivedFrom: '' }))) return no(409, MSG.changed);
      return ok({ message: MSG.restored, restoredTo: target });
    }
    return no(409, MSG.notRestorable);
  }

  async function counts(userId) {
    const n = (filter) => {
      const q = Draft.countDocuments(filter);
      return q && typeof q.maxTimeMS === 'function' ? q.maxTimeMS(5000) : q;
    };
    const [needsApproval, drafts, approved, scheduled, posted, archived, binned] = await Promise.all([
      n(needsApprovalFilter(userId)),
      n({ ...awaitingFilter(userId), $and: [{ $nor: automationClauses() }] }),
      n({ userId, status: 'approved' }),
      n({ userId, status: 'scheduled' }),
      n({ userId, status: 'published' }),
      n({ userId, status: 'archived' }),
      n({ userId, status: 'binned' })
    ]);
    return ok({ counts: { needsApproval, drafts, approved, scheduled, posted, archived, binned } });
  }

  return { approve, unapprove, unschedule, bin, archive, restore, counts };
}

module.exports = {
  BIN_DAYS, MSG, PROTECTED_FIELDS,
  createPostActions, publishGate, campaignApprovalBlock, plannedDateFor, plannedDateOf, safeRestoreTarget,
  editableFields, listStatusFilter
};
