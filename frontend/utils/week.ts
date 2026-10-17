/** Plain-language helpers for the "This week" card. Customers see posts, carousels and videos, never Quarks. */
import type { WeekCounts, WeekItem, WeekProposal, WeekResponse } from '../types';

export type CardState = 'ready' | 'approved' | 'partly' | 'skipped' | 'top_up' | 'no_plan' | 'not_eligible' | 'empty';

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
    if (item.status === 'failed') return 'Could not be made, try again';
    return '';
  }
  if (item.status === 'approved') return 'Ready to make';
  if (item.status === 'made') return 'Made';
  return '';
}

export function cardState(res: Partial<WeekResponse> | null | undefined): CardState {
  if (!res) return 'not_eligible';
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
  if (!parts.length) return 'Your pool covers most of the week, so we scaled this week down. Top up to add the rest back.';
  return `Your pool covers most of the week, so we left out ${join(parts)}. Top up to add ${parts.length === 1 && /^1 /.test(parts[0]) ? 'it' : 'them'} back.`;
}

/** Whether any post is still being made, so the card keeps checking. */
export function isWorking(proposal: Partial<WeekProposal> | null | undefined): boolean {
  return Boolean(proposal && (proposal.items || []).some((i) => i && (i.status === 'approved' || i.status === 'making') && i.kind === 'post'));
}
