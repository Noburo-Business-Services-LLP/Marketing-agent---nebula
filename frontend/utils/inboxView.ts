// Pure helpers for the look of the Inbox screens: conversation rows, the thread details, approval reasons, alerts,
// Google reviews and which state each part shows. No network, no React. Chips are made only from real data that is
// not a default value (the server stores "neutral" and "normal" when it knows nothing). See impact-maps/inbox-reviews.md.

import { conversationKind, kindLabel, platformLabel } from './inbox.ts';

/** Up to two initials for the round avatar; "?" when there is no name. Works for any script. */
export function initialsOf(name?: string | null): string {
  const words = String(name || '').replace(/[@_.]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = (w: string) => Array.from(w)[0] || '';
  return (first(words[0]) + (words.length > 1 ? first(words[1]) : '')).toUpperCase();
}

export type MarkKey = 'instagram' | 'facebook' | 'google' | 'other';

/** Which small platform mark to draw. */
export function markOf(platform?: string | null): MarkKey {
  const key = String(platform || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'instagram') return 'instagram';
  if (key === 'facebook') return 'facebook';
  if (['gmb', 'google', 'googlebusiness', 'googlebusinessprofile'].includes(key)) return 'google';
  return 'other';
}

export type ChipTone = 'kind' | 'warn' | 'alert' | 'good' | 'muted';
export interface Chip { label: string; tone: ChipTone }

interface ConvLike {
  message_types?: ReadonlyArray<string> | null;
  sentiment?: string | null;
  priority?: string | null;
  spam_score?: number | null;
  status?: string | null;
}

const SPAM_LINE = 0.8;

/** Chips for a conversation row: the kind always, then importance, mood and spam only when known and not the default. */
export function conversationChips(c: ConvLike): Chip[] {
  const chips: Chip[] = [{ label: kindLabel(conversationKind(c.message_types)), tone: 'kind' }];
  if (c.priority === 'urgent') chips.push({ label: 'Urgent', tone: 'alert' });
  else if (c.priority === 'high') chips.push({ label: 'Important', tone: 'warn' });
  if (c.sentiment === 'negative') chips.push({ label: 'Unhappy', tone: 'alert' });
  else if (c.sentiment === 'positive') chips.push({ label: 'Positive', tone: 'good' });
  if (Number(c.spam_score) >= SPAM_LINE) chips.push({ label: 'Looks like spam', tone: 'muted' });
  return chips;
}

const STATUS_WORDS: Record<string, string> = { unread: 'Not read yet', read: 'Read', replied: 'Replied', closed: 'Closed' };

/** The facts shown beside a thread, only those that say something. */
export function threadFacts(c?: ConvLike | null): Array<{ label: string; value: string }> {
  if (!c) return [];
  const out: Array<{ label: string; value: string }> = [];
  if (c.sentiment === 'negative') out.push({ label: 'Mood', value: 'Sounds unhappy' });
  else if (c.sentiment === 'positive') out.push({ label: 'Mood', value: 'Sounds positive' });
  if (c.priority === 'urgent') out.push({ label: 'Importance', value: 'Looks urgent' });
  else if (c.priority === 'high') out.push({ label: 'Importance', value: 'Looks important' });
  if (Number(c.spam_score) >= SPAM_LINE) out.push({ label: 'Spam', value: 'Looks like spam' });
  if (c.status && STATUS_WORDS[c.status]) out.push({ label: 'Status', value: STATUS_WORDS[c.status] });
  return out;
}

/** Why a drafted reply waits for the owner, in plain words. Unknown internal reasons are not shown. */
export function approvalReason(reason?: string | null): string {
  const r = String(reason || '').trim();
  if (!r) return '';
  if (r === 'Approval required mode') return 'You asked to approve each reply.';
  if (r === 'Negative sentiment requires approval') return 'The person sounds unhappy.';
  if (r === 'High priority message requires approval') return 'The message looks important.';
  if (r === 'Daily auto-reply limit reached') return 'This person already had the most automatic replies for today.';
  if (/^The reply could not be drafted in your tone/.test(r)) return 'The reply could not be drafted in your tone, so it is a general one.';
  const rule = /^Matched rule: (.+)$/.exec(r);
  if (rule) return `Your rule "${rule[1].trim()}" asks you first.`;
  return '';
}

const ALERT_KINDS: Record<string, string> = {
  new_comment: 'comment', new_reply: 'reply to a comment', new_mention: 'mention', new_dm: 'direct message', new_message: 'direct message',
};

/** "New comment on Instagram" for a live alert. */
export function alertTitle(type?: string | null, platform?: string | null): string {
  const kind = ALERT_KINDS[String(type || '')];
  if (!kind || !platform) return 'New activity';
  return `New ${kind} on ${platformLabel(platform)}`;
}

/** "4.6 average from 128 reviews", only when the provider sent both numbers. */
export function reviewsSummaryLine(s?: { averageRating?: number | null; totalReviewCount?: number | null } | null): string {
  const avg = Number(s?.averageRating);
  const total = Number(s?.totalReviewCount);
  if (!Number.isFinite(avg) || !Number.isFinite(total) || avg <= 0 || total <= 0) return '';
  return `${avg.toFixed(1)} average from ${Math.floor(total)} ${Math.floor(total) === 1 ? 'review' : 'reviews'}`;
}

/** Whole stars for an average (rounded to the nearest star). */
export const avgStars = (avg?: number | null): number => (Number.isFinite(Number(avg)) && Number(avg) > 0 ? Math.min(5, Math.round(Number(avg))) : 0);

export type LiveUpdates = 'on' | 'off' | 'failed';
export type MessagesBodyState = 'addon' | 'connect' | 'live_off' | 'live_failed' | 'list';

/** What the Messages part shows first. The conversation list still shows under a live-updates note. */
export function messagesBodyState(i: { entitled: boolean; connectedCount: number; liveUpdates?: string | null }): MessagesBodyState {
  if (!i.entitled) return 'addon';
  if (i.connectedCount < 1) return 'connect';
  if (i.liveUpdates === 'off') return 'live_off';
  if (i.liveUpdates === 'failed') return 'live_failed';
  return 'list';
}

/** The note shown while live updates are not on, with its one button. */
export function liveNote(live?: string | null): { title: string; text: string; action: string } | null {
  if (live === 'off') {
    return {
      title: 'Live updates are not on yet',
      text: 'Your accounts are connected, but new comments and messages will not arrive here until live updates are switched on.',
      action: 'Switch on live updates',
    };
  }
  if (live === 'failed') {
    return {
      title: 'Live updates could not be switched on',
      text: 'New comments and messages will not arrive here until this works. Please try again in a few minutes.',
      action: 'Try again',
    };
  }
  return null;
}

export type ReviewsState = 'not_connected' | 'failed' | 'empty' | 'list';

export function reviewsState(res?: { connected?: boolean; loadFailed?: boolean; reviews?: unknown[] } | null): ReviewsState {
  if (!res) return 'failed';
  if (res.connected === false) return 'not_connected';
  if (res.loadFailed) return 'failed';
  return Array.isArray(res.reviews) && res.reviews.length ? 'list' : 'empty';
}

/** Drafted for this message, or general replies to start from (the writing service was not available). */
export const suggestionsHeading = (source?: string | null): string => (source === 'general' ? 'Quick replies to start from' : 'Suggested replies');

/** The welcome list on an empty inbox: what will show up here. */
export const WHAT_WILL_APPEAR = [
  { id: 'comment', mark: 'instagram' as MarkKey, title: 'Comments on your posts', text: 'Each one with a reply drafted in your tone.' },
  { id: 'message', mark: 'facebook' as MarkKey, title: 'Direct messages', text: 'Questions people send your page, in the same list.' },
  { id: 'approve', mark: 'other' as MarkKey, title: 'Replies waiting for you', text: 'Read, change if you like, then send.' },
] as const;

/** True while working inside a client's account (agency) or with a staff pass: there is a pass to go back to. */
export function holdsClientPass(storage?: { getItem: (k: string) => string | null } | null): boolean {
  try {
    return Boolean(storage && storage.getItem('csmReturnToken'));
  } catch {
    return false;
  }
}

// ---- the labelled filter bar (owner, 2026-10-19: segmented chips instead of three cramped dropdowns) ----
export type InboxView = 'all' | 'needs_reply' | 'important';
export const INBOX_VIEWS: ReadonlyArray<{ key: InboxView; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'needs_reply', label: 'Needs reply' }, { key: 'important', label: 'Important' },
];
/** What one chip asks the server for: Needs reply = not read yet, Important = high or urgent (server word 'important'). */
export function inboxFilterFor(view: InboxView): { status: string; priority: string } {
  if (view === 'needs_reply') return { status: 'unread', priority: '' };
  if (view === 'important') return { status: '', priority: 'important' };
  return { status: '', priority: '' };
}
/** The thread's one calm line: '@handle', the platform and the kind, in that order, only those that are known. */
export function threadLine(c?: { participant_username?: string | null; platform?: string | null } | null, kind?: string | null): string[] {
  if (!c) return [];
  const platform = String(c.platform || '').toLowerCase();
  const name = platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : platform ? platform[0].toUpperCase() + platform.slice(1) : '';
  return [c.participant_username ? `@${c.participant_username}` : '', name, kind || ''].filter(Boolean);
}
