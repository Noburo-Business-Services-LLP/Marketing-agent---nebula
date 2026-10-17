/** Pure helpers for the My plan page: which sections to show, plain-word tags, the effort split and the refresh wording. */

export type PlanSectionId = 'today' | 'customer' | 'channels' | 'roadmap' | 'mix' | 'first';
export type PlanBannerState = 'building' | 'failed' | 'stopped' | 'can_build' | 'stale' | 'ready' | 'profile_incomplete' | 'free' | 'none';

export interface PlanClaim { text?: string | null; tag?: string }
export interface PlanSection { id: PlanSectionId; title: string; kind: string }
export interface EffortRow { channel: string; organicPct: number; paidPct: number; nebulaaDoes: string; youDo: string[] }

const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const has = (c: any): boolean => !!c && typeof c.text === 'string' && c.text.trim().length > 0;
const anyClaim = (v: unknown): boolean => list(v).some(has);
const planOf = (p: any): any => (p && p.result && p.result.plan) || {};

/** The sections that have something to show, in the agreed order. */
export function sectionsOf(plan: any): PlanSection[] {
  const p = planOf(plan);
  const pos = p.positioning || {};
  const icp = p.icp || {};
  const out: PlanSection[] = [];
  if (has(p.promise) || has(pos.line) || anyClaim(pos.audience) || anyClaim(p.whereToday) || list(p.competitors).length) {
    out.push({ id: 'today', title: 'Your business today', kind: 'claims' });
  }
  if (anyClaim(icp.who) || anyClaim(icp.pains) || anyClaim(icp.where) || anyClaim(icp.triggers)) {
    out.push({ id: 'customer', title: 'Your customer', kind: 'icp' });
  }
  if (list(p.channels).length || list(p.effort).length) out.push({ id: 'channels', title: 'Where to show up', kind: 'channels' });
  if (list(p.roadmap).some((r: any) => has(r && r.focus) || anyClaim(r && r.actions))) out.push({ id: 'roadmap', title: 'The next 90 days', kind: 'phases' });
  if (list(p.calendar).length || list(p.pillars).length) out.push({ id: 'mix', title: "This month's content mix", kind: 'mix' });
  if (anyClaim(p.firstSteps)) out.push({ id: 'first', title: 'What to do first', kind: 'steps' });
  return out;
}

const TAGS: Record<string, string> = { verified: 'Confirmed', inference: 'Our reading', proposed: 'Suggested', unverified: 'Not confirmed' };

/** A tag in plain words. An unknown tag reads as a suggestion. */
export function tagLabel(tag: string | null | undefined): string {
  return TAGS[String(tag)] || TAGS.proposed;
}

/** What Nebulaa makes for a channel, as one phrase: "posts", "posts and videos", "posts, videos and ads". */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] || '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** One row per channel: the organic and paid split, what Nebulaa does and what the owner does. */
export function effortRows(plan: any): EffortRow[] {
  return list(planOf(plan).effort).filter((e: any) => e && e.channel).map((e: any) => ({
    channel: String(e.channel),
    organicPct: Number(e.organicPct) || 0,
    paidPct: Number(e.paidPct) || 0,
    nebulaaDoes: joinWords(list(e.nebulaaDoes).map((w) => String(w)).filter(Boolean)),
    youDo: list(e.youDo).filter(has).map((c: any) => String(c.text)),
  }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "24 October", in Indian time like the rest of the app. */
export function dayMonth(iso: string | Date | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.valueOf())) return '';
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}`;
}

/** The refresh button text: ready now, or the date the next refresh opens. */
export function refreshLabel(state: { nextRefreshAt?: string | null } | null | undefined, now: Date = new Date()): string {
  const next = state && state.nextRefreshAt ? new Date(state.nextRefreshAt) : null;
  if (next && !Number.isNaN(next.valueOf()) && next.getTime() > now.getTime()) return `Next refresh on ${dayMonth(next)}`;
  return 'Refresh my plan';
}

/** Which state the page is in. */
export function planBanner(state: any): PlanBannerState {
  const s = state || {};
  if (s.running) return 'building';
  if (s.eligible === false && s.reason === 'free') return 'free';
  if (s.eligible === false && s.reason === 'profile_incomplete') return 'profile_incomplete';
  if (s.failed && !s.plan) return 'failed';
  if (s.eligible && s.stopped && !s.plan) return 'stopped';
  if (s.plan && s.plan.stale) return 'stale';
  if (s.plan) return 'ready';
  if (s.eligible === true) return 'can_build';
  return 'none';
}

/** The plain-words reason the last run stopped, or '' when there is none to show. */
export function stoppedMessage(state: any): string {
  const s = state || {};
  return s.eligible && !s.running && s.stopped && typeof s.stopped.message === 'string' ? s.stopped.message : '';
}

/** Keep looking again while a plan is being built. One failed look does not end it. */
export function shouldPoll(state: any): boolean {
  return Boolean(state && state.running);
}

/** The words shown for each state. */
export const BANNER_TEXT: Record<PlanBannerState, string> = {
  building: 'We are building your plan. This takes about a minute.',
  failed: 'We could not build your plan just now. Try again.',
  stopped: 'We could not build your plan yet.',
  can_build: 'This takes about a minute. It is free.',
  stale: 'This plan is a few weeks old. Refresh it to match your business as it is now.',
  ready: '',
  profile_incomplete: 'Your plan is made from your business profile. A few details are still missing.',
  free: 'Choose a plan to turn this into weekly posts and videos.',
  none: 'Your plan will appear here once it is made.',
};

export const PHASE_TITLES: Record<string, string> = { foundation: 'Foundation', storytelling: 'Storytelling', growth: 'Growth' };
