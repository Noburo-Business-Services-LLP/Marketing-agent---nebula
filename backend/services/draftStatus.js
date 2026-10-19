'use strict';
// ONE definition of what a draft's status means to the customer. The Home summary counts with it, and
// frontend/utils/draftStatus.ts (checked against this file by a test) is what the Approve page and Home use.
//
//   waiting    made, nobody has said yes or no yet (pending, draft, ready, processing, completed)
//   approved   the customer said yes, it is queued to go out (approved, scheduled)
//   published  it went out (published, posted)
//   failed     it could not be made or sent; it stays in the queue so it can be retried
//   closed     rejected or archived: out of sight
//
// "Completed" means the picture is ready but not yet approved, so it is still waiting.
// The Approve page lists both waiting and failed posts, so "awaiting review" is waiting + failed.
const DRAFT_STATES = Object.freeze(['waiting', 'approved', 'published', 'failed']);
const WAITING = ['pending', 'draft', 'ready', 'processing', 'completed'];
const AWAITING_STATUSES = Object.freeze([...WAITING, 'failed']);
const VIDEO_KINDS = ['reel', 'video'];

const clean = (status) => String(status === undefined || status === null || status === '' ? 'draft' : status).trim().toLowerCase();

function stateOf(status) {
  const s = clean(status);
  if (WAITING.includes(s)) return 'waiting';
  if (s === 'approved' || s === 'scheduled') return 'approved';
  if (s === 'published' || s === 'posted') return 'published';
  if (s === 'failed') return 'failed';
  return 'closed';
}

/** Does this draft belong in the Approve queue? Videos and reels have their own flow. */
function isAwaitingReview(draft) {
  if (!draft || typeof draft !== 'object') return false;
  const source = String(draft.sourceType || draft.contentType || 'post').toLowerCase();
  if (VIDEO_KINDS.includes(source)) return false;
  return AWAITING_STATUSES.includes(clean(draft.status));
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

module.exports = { DRAFT_STATES, AWAITING_STATUSES, stateOf, isAwaitingReview, awaitingFilter };
