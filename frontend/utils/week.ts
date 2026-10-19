/** Plain-language helpers for the "This week" card. Customers see posts, carousels and videos, never Quarks. */
import type { WeekCounts, WeekItem, WeekProposal, WeekResponse } from '../types';

export type CardState = 'ready' | 'done' | 'approved' | 'partly' | 'skipped' | 'top_up' | 'no_plan' | 'not_eligible' | 'empty';

const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const join = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);

export function headline(counts: Partial<WeekCounts> | null | undefined): string {
  const c = counts || {};
  const parts: string[] = [];
  if (num(c.posts)) parts.push(noun(num(c.posts), 'post', 'posts'));
  if (num(c.carousels)) parts.push(noun(num(c.carousels), 'carousel', 'carousels'));
  if (num(c.videos)) parts.push(noun(num(c.videos), 'video', 'videos'));
  return parts.length ? `This week we will make ${join(parts)}, based on your plan.` : 'Nothing is planned for this week yet.';
}

/** The server's counts, or counts worked out from the items that are not skipped. */
export function countsOf(proposal: Partial<WeekProposal> | null | undefined): WeekCounts {
  if (proposal && proposal.counts) return { posts: num(proposal.counts.posts), carousels: num(proposal.counts.carousels), videos: num(proposal.counts.videos) };
  const out = { posts: 0, carousels: 0, videos: 0 };
  for (const i of (proposal && proposal.items) || []) {
    if (!i || i.status === 'skipped') continue;
    if (i.kind === 'post') out.posts += 1; else if (i.kind === 'carousel') out.carousels += 1; else if (i.kind === 'video') out.videos += 1;
  }
  return out;
}

export function itemLine(item: Partial<WeekItem>): string {
  if (item.kind === 'post') {
    if (item.status === 'making' || item.status === 'approved') return 'Making…';
    if (item.status === 'made') return 'In Review and approve';
    if (item.status === 'failed') {
      if (item.error === 'gave_up') return 'We could not make this post. Please try again later or contact support.';
      if (item.error === 'no_pool') return 'Top up to make this post';
      if (item.error === 'refund_failed') return 'Something went wrong with this post. Our team has been told.';
      return 'Could not be made, try again';
    }
    return '';
  }
  if (item.status === 'approved') return 'Ready to make';
  if (item.status === 'made') return 'Made';
  return '';
}

/** What a post offers when it failed: try again, top up, or nothing (the team has it). */
export function itemAction(item: Partial<WeekItem>): 'retry' | 'top_up' | 'none' {
  if (item.kind !== 'post' || item.status !== 'failed') return 'none';
  if (item.error === 'no_pool') return 'top_up';
  if (item.error === 'gave_up' || item.error === 'refund_failed') return 'none';
  return 'retry';
}

export const SLOW_AFTER_MS = 3 * 60 * 1000;
export const isSlow = (elapsedMs: number): boolean => elapsedMs > SLOW_AFTER_MS;
export const pollDelay = (elapsedMs: number): number => (isSlow(elapsedMs) ? 15000 : 5000);

export function cardState(res: Partial<WeekResponse> | null | undefined): CardState {
  if (!res) return 'not_eligible';
  if (res.eligible && res.reason === 'nothing_left') return 'done';
  if (!res.eligible) return res.reason === 'no_plan' ? 'no_plan' : 'not_eligible';
  const p = res.proposal;
  if (!p) return 'no_plan';
  if (res.topUp || p.empty) return 'top_up';
  if (p.status === 'skipped') return 'skipped';
  if (p.status === 'approved') {
    const pending = (p.items || []).some((i) => i && i.kind !== 'post' && i.status === 'approved');
    return pending ? 'partly' : 'approved';
  }
  if (p.status === 'proposed') return (p.items || []).some((i) => i && i.status !== 'skipped') ? 'ready' : 'empty';
  return 'not_eligible';
}

export interface Actions { approve: boolean; skipWeek: boolean; changeItems: boolean }
export function actionsFor(state: CardState): Actions {
  const ready = state === 'ready';
  return { approve: ready, skipWeek: ready, changeItems: ready };
}

export function scaledNote(proposal: Partial<WeekProposal> | null | undefined): string {
  if (!proposal || !proposal.scaledDown) return '';
  const r = proposal.removed || { posts: 0, carousels: 0, videos: 0 };
  const parts: string[] = [];
  if (num(r.posts)) parts.push(noun(num(r.posts), 'post', 'posts'));
  if (num(r.carousels)) parts.push(noun(num(r.carousels), 'carousel', 'carousels'));
  if (num(r.videos)) parts.push(noun(num(r.videos), 'video', 'videos'));
  if (!parts.length) return 'Your balance covers most of the week, so we scaled this week down. Top up to add the rest back.';
  return `Your balance covers most of the week, so we left out ${join(parts)}. Top up to add ${parts.length === 1 && /^1 /.test(parts[0]) ? 'it' : 'them'} back.`;
}

/** Whether any post is still being made, so the card keeps checking. */
export function isWorking(proposal: Partial<WeekProposal> | null | undefined): boolean {
  return Boolean(proposal && (proposal.items || []).some((i) => i && (i.status === 'approved' || i.status === 'making') && i.kind === 'post'));
}

/** The hand-over for a carousel or video entry, rebuilt from the item itself (used when the server's prefill is not in this session). */
export function buildPrefill(item: Partial<WeekItem>, language?: string | null, weekId?: string | null):
  { target: 'carousel'; prefill: { mode: 'carousel'; topic: string; platform: string; language: string; weekItemId?: string; weekId?: string } }
  | { target: 'video'; prefill: { idea: string; language: string; weekItemId?: string; weekId?: string } } {
  const ids: { weekItemId?: string; weekId?: string } = {};
  if (item.id) ids.weekItemId = String(item.id);
  if (weekId) ids.weekId = String(weekId);
  const lang = (language && String(language).trim()) || 'English';
  const topic = String(item.topic || '');
  if (item.kind === 'video') return { target: 'video', prefill: { idea: topic, language: lang, ...ids } };
  return { target: 'carousel', prefill: { mode: 'carousel', topic, platform: (item.channel && String(item.channel)) || 'instagram', language: lang, ...ids } };
}

export const COLLAPSE_AFTER = 5;
export const COLLAPSED_ROWS = 4;
/** How many rows to show: all of them up to five, otherwise the first four until the customer asks for the rest. */
export function visibleCount(total: number, expanded: boolean): number {
  return total > COLLAPSE_AFTER && !expanded ? COLLAPSED_ROWS : total;
}

// ---- Monday-start weeks and days in India time (IST, UTC+5:30) ----------------------------------------------------
// The same rules as backend/services/weekIst.js (a test compares them hour by hour), so Home, the weekly proposal and
// the server never disagree about "this week". These do not use the browser's own timezone.
export const IST_OFFSET_MINUTES = 330;
const DAY_MS = 86400000;
const OFFSET_MS = IST_OFFSET_MINUTES * 60000;

export interface IstWeek { start: string; end: string; startsAt: Date; endsAt: Date; previousStart: string; previousStartsAt: Date; days: string[] }
export interface IstDay { date: string; startsAt: Date; endsAt: Date }

const asDate = (value?: Date | number | string | null): Date => {
  const d = value instanceof Date ? value : new Date(value === undefined || value === null ? Date.now() : value);
  return Number.isFinite(d.getTime()) ? d : new Date();
};
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const istMidnight = (d: Date): number => Math.floor((d.getTime() + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;

export function istDay(now?: Date | number | string | null): IstDay {
  const start = istMidnight(asDate(now));
  return { date: isoDay(start + OFFSET_MS), startsAt: new Date(start), endsAt: new Date(start + DAY_MS) };
}

export function istWeek(now?: Date | number | string | null): IstWeek {
  const dayStart = istMidnight(asDate(now));
  const weekday = new Date(dayStart + OFFSET_MS).getUTCDay();
  const startMs = dayStart - ((weekday + 6) % 7) * DAY_MS;
  const endMs = startMs + 7 * DAY_MS;
  const prevMs = startMs - 7 * DAY_MS;
  return {
    start: isoDay(startMs + OFFSET_MS), end: isoDay(endMs + OFFSET_MS), startsAt: new Date(startMs), endsAt: new Date(endMs),
    previousStart: isoDay(prevMs + OFFSET_MS), previousStartsAt: new Date(prevMs),
    days: Array.from({ length: 7 }, (_, i) => isoDay(startMs + i * DAY_MS + OFFSET_MS))
  };
}

/** "9:00 AM", "12:30 pm" or "18:45" as minutes after midnight; null when it is not a time. */
export function parseTimeOfDay(text: unknown): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/.exec(String(text === undefined || text === null ? '' : text));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** Sort comparator for times of day ("10:00 AM" after "9:00 AM"). Anything that is not a time goes last. */
export function compareTimeOfDay(a: unknown, b: unknown): number {
  const x = parseTimeOfDay(a);
  const y = parseTimeOfDay(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}
