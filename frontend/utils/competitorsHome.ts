/** Competitor tiles, "What's working for your competitors" and "Trending for you" (Home and the Competitors page), from
 *  GET /api/competitors/best-posts (docs/superpowers/ops/competitors-home.md). Pure helpers, no React, so node --test can
 *  import them. Every number shown comes from the answer; an unknown one is left out, never shown as 0. */
import { formatCount } from './formatCount.ts';
import type { Handoff } from './homeLayout.ts';

export type BoardStatus = 'tracking' | 'no_handle' | 'unconfirmed' | 'waiting' | 'failed' | 'private' | 'paused';
export type PostKind = 'video' | 'image' | 'carousel';
export interface BestPost { period: 'week' | 'month'; type: PostKind; likes: number; comments: number | null; at: string; url: string; ref?: string }
export interface WorkedLine { kind: 'format' | 'day' | 'time'; best: string; ratio: number; text: string }
export interface CompetitorCard {
  id: string; name: string; handle: string; status: BoardStatus; profileUrl: string | null;
  followers: { value: number; change: number | null } | null;
  postsThisWeek: { value: number; atLeast: boolean } | null;
  bestPost: BestPost | null; worked: WorkedLine | null;
  weekOf: string | null; isCurrentWeek: boolean; lastCheckedOn: string | null;
}
export interface MakeAction { label: string; kind: 'post' | 'video'; mode: 'single' | 'carousel' | null; brief: string }
export interface WorkingPost {
  competitorId: string; name: string; handle: string; period: 'week' | 'month'; type: PostKind; likes: number; comments: number | null;
  at: string; url: string; ref?: string; reason: string; worked: string | null; action: MakeAction;
}
export type TrendSource = 'competitor' | 'own' | 'festival' | 'plan';
export interface TrendItem { id: string; source: TrendSource; label: string; title: string; reason: string; action: MakeAction }
export interface BestPostsResponse {
  success?: boolean; staff?: boolean; entitled: boolean; trackerOn: boolean;
  state: 'not_entitled' | 'no_competitors' | 'tracker_off' | 'waiting' | 'ready' | 'error';
  competitors: CompetitorCard[]; working: WorkingPost[]; trending: TrendItem[]; degraded: string[]; weekStart: string; asOf: string;
}
export type BoardState = 'loading' | 'error' | 'staff' | 'locked' | 'none' | 'pending' | 'ready';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NOUN: Record<PostKind, string> = { video: 'reel', image: 'photo', carousel: 'carousel' };
const POST_LINK = /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{1,64}\/?$/;
const PROFILE_LINK = /^https:\/\/www\.instagram\.com\/[A-Za-z0-9._]{1,30}\/$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

export function isBestPostsResponse(v: unknown): v is BestPostsResponse {
  const r = v as BestPostsResponse;
  return Boolean(r && typeof r === 'object' && (r.staff || (typeof r.state === 'string' && Array.isArray(r.competitors) && Array.isArray(r.trending))));
}

export function boardState(res: unknown, failed: boolean): BoardState {
  if (!res) return failed ? 'error' : 'loading';
  if (!isBestPostsResponse(res)) return 'error';
  if (res.staff) return 'staff';
  if (res.state === 'error') return 'error';
  if (!res.entitled || res.state === 'not_entitled') return 'locked';
  if (res.state === 'no_competitors') return 'none';
  if (res.state === 'tracker_off' || res.state === 'waiting') return 'pending';
  return 'ready';
}

/** 'Saturday 17 October' in India time. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const x = new Date(d.getTime() + 330 * 60000);
  return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}
/** '15 September' from 'YYYY-MM-DD'. */
function shortDay(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
}

const STATUS_CHIP: Record<Exclude<BoardStatus, 'tracking'>, { text: string; tone: 'neutral' | 'warn' }> = {
  no_handle: { text: 'Needs a handle', tone: 'warn' },
  unconfirmed: { text: 'Confirm handle', tone: 'warn' },
  waiting: { text: 'First check pending', tone: 'neutral' },
  failed: { text: 'Could not read', tone: 'warn' },
  private: { text: 'Private account', tone: 'neutral' },
  paused: { text: 'Paused', tone: 'warn' },
};
const STATUS_NOTE: Record<Exclude<BoardStatus, 'tracking'>, string> = {
  no_handle: 'Add their Instagram handle to start tracking them.',
  unconfirmed: 'We found this handle. Confirm it so we can track them.',
  waiting: 'Their first weekly check has not happened yet.',
  failed: 'We could not read this account. Check the handle.',
  private: 'This account is private, so its posts cannot be seen.',
  paused: 'Paused after repeated problems. Edit the handle to resume.',
};
const NO_PATTERN = 'Not enough posts yet to see a pattern.';

export interface ChangeChip { text: string; dir: 'up' | 'down' | 'flat'; label: string }
export interface TileView {
  id: string; initial: string; name: string; handleText: string; profileUrl: string | null;
  chip: { text: string; tone: 'good' | 'neutral' | 'warn' };
  note: string | null;
  followers: { value: string; chip: ChangeChip | null } | null;
  posts: string | null;
  best: { text: string; counts: string; url: string | null; kind: PostKind } | null;
  worked: string | null; workedIsQuiet: boolean;
  handleAction: 'confirm' | 'edit' | null;
}

function changeChip(change: number | null | undefined): ChangeChip | null {
  if (!isNum(change)) return null;
  if (change === 0) return { text: 'No change', dir: 'flat', label: 'no change since last week' };
  const n = formatCount(Math.abs(change));
  return change > 0 ? { text: `+${n}`, dir: 'up', label: `up ${n} since last week` } : { text: `-${n}`, dir: 'down', label: `down ${n} since last week` };
}

export function tileView(c: CompetitorCard): TileView {
  const name = String(c?.name || 'A competitor');
  const status: BoardStatus = c?.status || 'waiting';
  const tracking = status === 'tracking';
  const hasData = Boolean(c?.weekOf);
  const chip = tracking
    ? (c.isCurrentWeek ? { text: 'Tracking', tone: 'good' as const } : { text: shortDay(c.lastCheckedOn) ? `Last checked ${shortDay(c.lastCheckedOn)}` : 'Tracking', tone: 'neutral' as const })
    : STATUS_CHIP[status] || STATUS_CHIP.waiting;
  const note = tracking ? (hasData ? null : STATUS_NOTE.waiting) : STATUS_NOTE[status] || STATUS_NOTE.waiting;
  const f = c?.followers && isNum(c.followers.value) ? { value: formatCount(c.followers.value), chip: changeChip(c.followers.change) } : null;
  let posts: string | null = null;
  if (c?.isCurrentWeek && c.postsThisWeek && isNum(c.postsThisWeek.value)) {
    const v = c.postsThisWeek.value;
    posts = c.postsThisWeek.atLeast ? `At least ${plural(v, 'post', 'posts')}` : v === 0 ? 'No posts yet' : plural(v, 'post', 'posts');
  }
  const b = c?.bestPost;
  const best = b && isNum(b.likes)
    ? {
      text: `Best this ${b.period === 'week' ? 'week' : 'month'}: a ${NOUN[b.type] || 'post'}${dayOf(b.at) ? ` on ${dayOf(b.at)}` : ''}`,
      counts: [plural(b.likes, 'like', 'likes'), isNum(b.comments) && b.comments > 0 ? plural(b.comments, 'comment', 'comments') : ''].filter(Boolean).join(', '),
      url: POST_LINK.test(String(b.url || '')) ? b.url : null, kind: b.type,
    }
    : null;
  const showWorked = tracking && hasData;
  const handleAction = status === 'unconfirmed' ? 'confirm' : ['no_handle', 'failed', 'private', 'paused'].includes(status) ? 'edit' : null;
  return {
    id: String(c?.id || ''), initial: (name.trim()[0] || 'C').toUpperCase(), name,
    handleText: c?.handle ? `@${c.handle}` : '', profileUrl: c?.profileUrl && PROFILE_LINK.test(c.profileUrl) ? c.profileUrl : null,
    chip, note, followers: showWorked ? f : null, posts: showWorked ? posts : null, best: showWorked ? best : null,
    worked: showWorked ? (c.worked?.text || NO_PATTERN) : null, workedIsQuiet: showWorked && !c.worked?.text,
    handleAction: handleAction as TileView['handleAction'],
  };
}

/** Up to `max` tiles for Home: tracked competitors with a best post first (most liked first), then the rest in order. */
export function homeCards(res: BestPostsResponse | null, max = 3): CompetitorCard[] {
  const list = Array.isArray(res?.competitors) ? res!.competitors : [];
  const rank = (c: CompetitorCard) => (c.status === 'tracking' && c.bestPost ? 0 : c.status === 'tracking' ? 1 : 2);
  return list.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || ((b.c.bestPost?.likes ?? 0) - (a.c.bestPost?.likes ?? 0)) || a.i - b.i)
    .slice(0, max).map((x) => x.c);
}

export interface BoardNote { text: string; link: { to: string; text: string } | null }
export function boardNote(state: BoardState, opts: { clientWorkspace?: boolean }): BoardNote | null {
  if (state === 'locked') return { text: 'Following your competitors is an add-on.', link: opts.clientWorkspace ? null : { to: '/trial-expired', text: 'See plans' } };
  if (state === 'none') return { text: 'Add the competitors you want to follow. We look at their public posts each week.', link: { to: '/competitors', text: 'Add competitors' } };
  if (state === 'pending') return { text: "Your competitors' public posts have not been checked yet. Their numbers appear here after the first weekly check.", link: { to: '/competitors', text: 'Open Competitors' } };
  if (state === 'error') return { text: 'We could not load your competitors just now.', link: null };
  return null;
}

const MAX_TOPIC = 500;
/** "Make a post like this": the brief goes to Create (single post or carousel) or Videos through the one-shot prefill. */
export function trendHandoff(a: MakeAction | null | undefined, language: string | null | undefined): Handoff | null {
  const brief = String(a?.brief || '').trim().slice(0, MAX_TOPIC);
  if (!a || !brief) return null;
  const lang = String(language || '').trim();
  if (a.kind === 'video') return { target: 'video', route: '/reels', data: { idea: brief, ...(lang ? { language: lang } : {}), source: 'home' } };
  return { target: 'carousel', route: '/campaigns', data: { mode: a.mode === 'carousel' ? 'carousel' : 'single', topic: brief, ...(lang ? { language: lang } : {}), source: 'home' } };
}

export interface WorkingRow { key: string; title: string; reason: string; worked: string | null; kind: PostKind; url: string | null; ref: string; action: MakeAction }
export function workingView(w: WorkingPost): WorkingRow {
  return { key: `${w.competitorId}:${w.at}`, title: w.name, reason: w.reason, worked: w.worked, kind: w.type, url: POST_LINK.test(String(w.url || '')) ? w.url : null, ref: String(w.ref || ''), action: w.action };
}

/** How a draft names the post it starts from: "Sweet Co Bakery's reel". */
export function draftSourceTitle(name: string | null | undefined, kind: PostKind | null | undefined): string {
  const n = String(name || '').trim() || 'A competitor';
  return `${n}'s ${NOUN[kind as PostKind] || 'post'}`;
}

export interface TrendRow { key: string; tone: TrendSource; label: string; title: string; reason: string; action: MakeAction }
export function trendView(t: TrendItem): TrendRow {
  const tone: TrendSource = (['competitor', 'own', 'festival', 'plan'] as const).includes(t.source) ? t.source : 'plan';
  return { key: t.id, tone, label: t.label, title: t.title, reason: t.reason, action: t.action };
}

/** Each Home section shows only with real data; the competitors one also shows its quiet note. Staff see none. */
export function sectionsToShow(res: BestPostsResponse | null, state: BoardState): { competitors: boolean; working: boolean; trending: boolean } {
  if (state === 'staff') return { competitors: false, working: false, trending: false };
  return {
    competitors: true,
    working: state === 'ready' && Array.isArray(res?.working) && res!.working.length > 0,
    trending: Array.isArray(res?.trending) && res!.trending.length > 0 && state !== 'error',
  };
}

const BANNED = [
  /!/, /[\u2014\u2013]/, /\bcredits?\b/i, /\btrials?\b/i, /\b7 days\b/i,
  /\b(apify|ayrshare|openai|gemini|gpt|anthropic|scrap\w*)\b/i,
  /\b(worse|worst|bad|beat|beats|crush\w*|weak\w*|poor\w*|mock\w*|destroy\w*|flop\w*|loser\w*|losing|savage|roast\w*|shame\w*|terrible|awful|useless)\b/i,
];
/** The same rule the server applies to its sentences, for the copy written on the page. */
export function isPlainCopy(s: string): boolean {
  return !BANNED.some((re) => re.test(String(s || '')));
}
