'use strict';
// ONE definition of what a draft's status means to the customer. The Home summary and the Library counts use it, and
// frontend/utils/draftStatus.ts (checked against this file by a test) is what the Approve page, Library and Home use.
//
//   waiting    made, nobody has said yes or no yet (pending, draft, ready, processing, completed)
//   approved   the customer said yes: it waits to be scheduled or posted (approved), or it is queued (scheduled)
//   published  it went out (published, posted)
//   failed     it could not be made or sent; it stays in the queue so it can be retried
//   closed     rejected, archived or in the Bin (binned): out of sight
//
// "Completed" means the picture is ready but not yet approved, so it is still waiting.
// The Approve page lists both waiting and failed posts, so "awaiting review" is waiting + failed.
//
// Origin: who made it. 'manual' = the customer made it by hand (Create, Videos, Photoshoot, Upload); 'automation' =
// Nebulaa made it for them (weekly plan posts, calendar auto-generation). Only automation posts need approval.
// Rows written before origin existed have no value: they are automation when they came from the calendar or weekly
// generator (they carry contentCalendarId or calendarDay, which no other path sets), else manual. No backfill needed.
const DRAFT_STATES = Object.freeze(['waiting', 'approved', 'published', 'failed']);
const WAITING = ['pending', 'draft', 'ready', 'processing', 'completed'];
const AWAITING_STATUSES = Object.freeze([...WAITING, 'failed']);
const VIDEO_KINDS = ['reel', 'video'];
const ORIGINS = Object.freeze(['manual', 'automation']);

const clean = (status) => String(status === undefined || status === null || status === '' ? 'draft' : status).trim().toLowerCase();

function stateOf(status) {
  const s = clean(status);
  if (WAITING.includes(s)) return 'waiting';
  if (s === 'approved' || s === 'scheduled') return 'approved';
  if (s === 'published' || s === 'posted') return 'published';
  if (s === 'failed') return 'failed';
  return 'closed';
}

/** 'manual' or 'automation'. Reads the stored value, else derives it for rows written before the field existed. */
function originOf(draft) {
  if (!draft || typeof draft !== 'object') return 'manual';
  if (ORIGINS.includes(draft.origin)) return draft.origin;
  if (draft.contentCalendarId) return 'automation';
  if (typeof draft.calendarDay === 'number' && Number.isFinite(draft.calendarDay)) return 'automation';
  return 'manual';
}

/** Does this draft belong in the Approve queue? Videos and reels have their own flow. */
function isAwaitingReview(draft) {
  if (!draft || typeof draft !== 'object') return false;
  const source = String(draft.sourceType || draft.contentType || 'post').toLowerCase();
  if (VIDEO_KINDS.includes(source)) return false;
  return AWAITING_STATUSES.includes(clean(draft.status));
}

/** Needs the customer's approval before it can go out: an automation post that is still waiting (or failed). */
function needsApproval(draft) {
  return isAwaitingReview(draft) && originOf(draft) === 'automation';
}

/** The same rule as a database filter, for one account. Uses the { userId, status } index. */
function awaitingFilter(userId) {
  return {
    userId,
    status: { $in: [...AWAITING_STATUSES] },
    $nor: [
      { sourceType: { $in: VIDEO_KINDS } },
      { sourceType: { $in: [null, ''] }, contentType: { $in: VIDEO_KINDS } }
    ]
  };
}

/** Matches automation-origin rows, including old rows without an origin (same rule as originOf). */
function automationClauses() {
  return [
    { origin: 'automation' },
    { origin: { $in: [null] }, contentCalendarId: { $type: 'objectId' } },
    { origin: { $in: [null] }, calendarDay: { $type: 'number' } }
  ];
}

/** needsApproval as a database filter: the Library "Needs approval" count and Home "drafts waiting". */
function needsApprovalFilter(userId) {
  return { ...awaitingFilter(userId), $or: automationClauses() };
}

module.exports = {
  DRAFT_STATES, AWAITING_STATUSES, ORIGINS, VIDEO_KINDS,
  stateOf, originOf, isAwaitingReview, needsApproval, awaitingFilter, needsApprovalFilter, automationClauses
};
