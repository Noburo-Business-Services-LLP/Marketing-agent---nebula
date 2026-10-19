/** What a draft's status means to the customer: ONE definition, shared by Home, Library and the Approve page.
 *  backend/services/draftStatus.js is the server's copy (a test fails if the two differ).
 *    waiting    made, nobody has said yes or no yet (pending, draft, ready, processing, completed)
 *    approved   the customer said yes: it waits to be scheduled or posted (approved), or it is queued (scheduled)
 *    published  it went out (published, posted)
 *    failed     it could not be made or sent; it stays in the queue so it can be retried
 *    closed     rejected, archived or in the Bin (binned)
 *  The Approve queue lists waiting and failed posts ("awaiting review"); videos and reels have their own flow.
 *  Origin: 'manual' (the customer made it by hand) or 'automation' (Nebulaa made it: weekly plan, calendar). Only
 *  automation posts need approval. Old rows without an origin are automation when they carry a calendar link. */
export type DraftState = 'waiting' | 'approved' | 'published' | 'failed' | 'closed';
export type DraftOrigin = 'manual' | 'automation';

export const DRAFT_STATES = ['waiting', 'approved', 'published', 'failed'] as const;
const WAITING = ['pending', 'draft', 'ready', 'processing', 'completed'];
export const AWAITING_STATUSES: readonly string[] = Object.freeze([...WAITING, 'failed']);
export const ORIGINS: readonly DraftOrigin[] = Object.freeze(['manual', 'automation'] as DraftOrigin[]);
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

type DraftLike = { status?: unknown; sourceType?: unknown; contentType?: unknown; origin?: unknown; contentCalendarId?: unknown; calendarDay?: unknown };

/** 'manual' or 'automation'; derived for rows written before origin existed. */
export function originOf(draft: DraftLike | null | undefined): DraftOrigin {
  if (!draft || typeof draft !== 'object') return 'manual';
  if ((ORIGINS as readonly unknown[]).includes(draft.origin)) return draft.origin as DraftOrigin;
  if (draft.contentCalendarId) return 'automation';
  if (typeof draft.calendarDay === 'number' && Number.isFinite(draft.calendarDay)) return 'automation';
  return 'manual';
}

/** Does this draft belong in the Approve queue? */
export function isAwaitingReview(draft: DraftLike | null | undefined): boolean {
  if (!draft || typeof draft !== 'object') return false;
  const source = String(draft.sourceType || draft.contentType || 'post').toLowerCase();
  if (VIDEO_KINDS.includes(source)) return false;
  return AWAITING_STATUSES.includes(clean(draft.status));
}

/** Needs the customer's approval before it can go out: an automation post that is still waiting (or failed). */
export function needsApproval(draft: DraftLike | null | undefined): boolean {
  return isAwaitingReview(draft) && originOf(draft) === 'automation';
}
