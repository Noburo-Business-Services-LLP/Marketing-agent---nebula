/** What a draft's status means to the customer: ONE definition, shared by Home and the Approve page.
 *  backend/services/draftStatus.js is the server's copy (a test fails if the two lists differ).
 *    waiting    made, nobody has said yes or no yet (pending, draft, ready, processing, completed)
 *    approved   the customer said yes, it is queued to go out (approved, scheduled)
 *    published  it went out (published, posted)
 *    failed     it could not be made or sent; it stays in the queue so it can be retried
 *    closed     rejected or archived
 *  The Approve queue lists waiting and failed posts ("awaiting review"); videos and reels have their own flow. */
export type DraftState = 'waiting' | 'approved' | 'published' | 'failed' | 'closed';

export const DRAFT_STATES = ['waiting', 'approved', 'published', 'failed'] as const;
const WAITING = ['pending', 'draft', 'ready', 'processing', 'completed'];
export const AWAITING_STATUSES: readonly string[] = Object.freeze([...WAITING, 'failed']);
const VIDEO_KINDS = ['reel', 'video'];

const clean = (status: unknown): string => String(status === undefined || status === null || status === '' ? 'draft' : status).trim().toLowerCase();

export function stateOf(status: unknown): DraftState {
  const s = clean(status);
  if (WAITING.includes(s)) return 'waiting';
  if (s === 'approved' || s === 'scheduled') return 'approved';
  if (s === 'published' || s === 'posted') return 'published';
  if (s === 'failed') return 'failed';
  return 'closed';
}

/** Does this draft belong in the Approve queue? */
export function isAwaitingReview(draft: { status?: unknown; sourceType?: unknown; contentType?: unknown } | null | undefined): boolean {
  if (!draft || typeof draft !== 'object') return false;
  const source = String(draft.sourceType || draft.contentType || 'post').toLowerCase();
  if (VIDEO_KINDS.includes(source)) return false;
  return AWAITING_STATUSES.includes(clean(draft.status));
}
