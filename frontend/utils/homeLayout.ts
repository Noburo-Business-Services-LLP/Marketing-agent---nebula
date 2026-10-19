/** What the Home control room shows, worked out from GET /api/home/summary (docs/superpowers/ops/home-summary.md).
 *  Pure helpers, no React, so node --test can import them. Nothing here invents a figure: a number the summary cannot
 *  source shows its reason and a link to fix it, never a zero. India time throughout. */
import type { HomeAction, HomeNumber, HomeSummary } from '../types';
import { changeText, formatCount, formatPercent, formatShort } from './formatCount.ts';
import type { CarouselPrefill, VideoPrefill } from './prefill.ts';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ---- numbers strip -------------------------------------------------------------------------------------------------
export type NumberKey = 'reach' | 'engagement' | 'followers' | 'posts' | 'drafts' | 'messages';
export interface NumberChip { text: string; dir: 'up' | 'down' | 'flat' }
export interface NumberPrompt { text: string; link: { to: string; text: string } | null }
export interface NumberTile {
  key: NumberKey; title: string; value: string | null; chip: NumberChip | null; prompt: NumberPrompt | null;
  /** The full sentence a screen reader says for the tile. */
  label: string; to: string | null;
}

const NUMBER_DEFS: ReadonlyArray<{ key: NumberKey; field: keyof HomeSummary['numbers']; title: string; to: string | null }> = [
  { key: 'reach', field: 'reach', title: 'Reach', to: '/analytics' },
  { key: 'engagement', field: 'engagement', title: 'Engagement', to: '/analytics' },
  { key: 'followers', field: 'followers', title: 'Followers', to: '/analytics' },
  { key: 'posts', field: 'postsPublishedThisWeek', title: 'Posts this week', to: '/content-calendar' },
  { key: 'drafts', field: 'draftsWaiting', title: 'Drafts waiting', to: '/drafts' },
  { key: 'messages', field: 'unrepliedMessages', title: 'Unread messages', to: '/inbox' },
];

const NOT_LOADED = 'We could not load this just now.';

/** The link under a "not available" reason. Plan and add-on links never show inside a client workspace. */
function promptLink(reason: string, clientWorkspace: boolean): NumberPrompt['link'] {
  const r = reason.toLowerCase();
  if (r.includes('connect an account')) return { to: '/connect-socials', text: 'Connect an account' };
  if (clientWorkspace) return null;
  if (r.includes('paid plan')) return { to: '/trial-expired', text: 'See plans' };
  if (r.includes('add-on')) return { to: '/trial-expired', text: 'See add-ons' };
  return null;
}

function valueText(num: HomeNumber, key: NumberKey): string | null {
  if (!isNum(num.value)) return null;
  if (key === 'engagement' || num.unit === 'percent') return formatPercent(num.value);
  return Math.abs(num.value) >= 100000 ? formatShort(num.value) : formatCount(num.value);
}

function chipOf(num: HomeNumber): NumberChip | null {
  if (!isNum(num.previous) || !isNum(num.changePct)) return null;
  const text = changeText(num.changePct);
  if (!text) return null;
  return { text, dir: text === 'No change' ? 'flat' : num.changePct > 0 ? 'up' : 'down' };
}

export function numberTiles(s: HomeSummary): NumberTile[] {
  const client = Boolean(s?.account?.clientWorkspace);
  return NUMBER_DEFS.map((d) => {
    const num = (s?.numbers?.[d.field] || null) as HomeNumber | null;
    const value = num && num.available ? valueText(num, d.key) : null;
    if (!num || value === null) {
      const given = (num && !num.available && typeof num.reason === 'string' && num.reason.trim()) || '';
      // The server's "could not load" sentence is long for a small tile; the short one says the same.
      const text = !given || /^we could not load/i.test(given) ? NOT_LOADED : given;
      return { key: d.key, title: d.title, value: null, chip: null, prompt: { text, link: promptLink(text, client) }, label: `${d.title}: ${text}`, to: null };
    }
    const chip = chipOf(num);
    const full = d.key === 'engagement' ? value : formatCount(num.value);
    return { key: d.key, title: d.title, value, chip, prompt: null, label: `${d.title}: ${full}${chip ? `. ${chip.text} compared with last week` : ''}`, to: d.to };
  });
}

/** 'quiet' when nothing in the strip can be shown yet (no figures, no drafts, nothing published): one welcoming line instead of six empty tiles. */
export function numbersMode(s: HomeSummary): 'full' | 'quiet' {
  const nums = s?.numbers;
  if (!nums) return 'quiet';
  const has = (x: HomeNumber | undefined) => Boolean(x && x.available && isNum(x.value));
  const social = has(nums.reach) || has(nums.engagement) || has(nums.followers) || has(nums.unrepliedMessages);
  const posts = has(nums.postsPublishedThisWeek) && ((nums.postsPublishedThisWeek.value as number) > 0 || (isNum(nums.postsPublishedThisWeek.previous) && nums.postsPublishedThisWeek.previous > 0));
  const drafts = has(nums.draftsWaiting) && (nums.draftsWaiting.value as number) > 0;
  return social || posts || drafts ? 'full' : 'quiet';
}

// ---- Do this next --------------------------------------------------------------------------------------------------
export interface ActionRow { id: string; title: string; detail: string; to: string | null; scrollTo: string | null; button: string; count: number | null; primary: boolean; info: boolean }

const BUTTONS: Record<string, string> = {
  finish_profile: 'Finish details', choose_plan: 'See plans', fix_plan: 'Try again', read_plan: 'Read your plan',
  approve_week: 'Review the week', top_up: 'Add more', review_drafts: 'Review', reply_messages: 'Reply',
  connect_account: 'Connect', confirm_competitor: 'Confirm', add_product_photo: 'Add a photo',
};
const PLAN_ROWS = new Set(['fix_plan', 'plan_building']);
export const MAX_ACTIONS = 5;

export function actionRows(actions: HomeAction[] | null | undefined, opts: { planBanner: boolean }): ActionRow[] {
  const list = (Array.isArray(actions) ? actions : []).filter((a) => a && a.id && !(opts.planBanner && PLAN_ROWS.has(a.id)));
  return list.slice(0, MAX_ACTIONS).map((a, i) => {
    const info = Boolean(a.info) || !a.to;
    const hash = typeof a.to === 'string' && a.to.startsWith('/dashboard#') ? a.to.slice('/dashboard#'.length) : null;
    return {
      id: a.id, title: String(a.title || ''), detail: String(a.detail || ''),
      to: info || hash ? null : (a.to as string), scrollTo: info ? null : hash,
      button: info ? '' : BUTTONS[a.id] || 'Open',
      count: isNum(a.count) && a.count > 0 ? a.count : null,
      primary: i === 0 && !info, info,
    };
  });
}

// ---- plan banner, balance, greeting --------------------------------------------------------------------------------
export interface Banner { tone: 'info' | 'warn'; text: string; action: { label: string; to: string } | null }

export function planBanner(plan: Partial<HomeSummary['plan']> | null | undefined): Banner | null {
  if (!plan) return null;
  if (plan.state === 'building') return { tone: 'info', text: 'Your plan is being built. It usually takes a few minutes, and you can keep working meanwhile.', action: null };
  if (plan.state === 'failed') {
    return plan.stopped
      ? { tone: 'warn', text: 'We need a little more about your business before we can build your plan.', action: { label: 'Open My plan', to: '/plan' } }
      : { tone: 'warn', text: 'We could not build your plan this time.', action: { label: 'Try again', to: '/plan' } };
  }
  if (plan.state === 'stale') return { tone: 'info', text: 'Your plan is more than six weeks old and is due for a refresh.', action: { label: 'Open My plan', to: '/plan' } };
  return null;
}

export interface BalanceView { state: 'ok' | 'empty' | 'error' | 'paused'; label: string; main: string; side: string | null; link: { to: string; text: string } | null }

const plural = (v: number, one: string, many: string) => `${formatCount(v)} ${v === 1 ? one : many}`;

export function balanceView(s: HomeSummary): BalanceView {
  const b = s?.balance;
  const client = Boolean(s?.account?.clientWorkspace);
  const canBuy = !client && !s?.account?.managed && !s?.account?.staff;
  if (!b || !b.available || (s?.degraded || []).includes('balance') || !isNum(b.posts)) return { state: 'error', label: 'Balance', main: 'We could not load your balance.', side: null, link: null };
  if (b.paused) return { state: 'paused', label: 'Balance', main: 'Your account is paused.', side: null, link: null };
  const side = b.showQuarks && isNum(b.quarks) ? `${formatCount(b.quarks)} Quarks` : null;
  if (b.posts <= 0) return { state: 'empty', label: client ? 'Shared with your agency' : 'Balance', main: 'Nothing left to make posts with.', side, link: canBuy ? { to: '/trial-expired', text: 'Add more' } : null };
  const main = isNum(b.videos) && b.videos > 0 ? `${plural(b.posts, 'post', 'posts')} or ${plural(b.videos, 'video', 'videos')}` : plural(b.posts, 'post', 'posts');
  return { state: 'ok', label: client ? 'Shared with your agency: about' : 'Enough for about', main, side, link: null };
}

/** "Good morning, Sunrise Bakery" by the India clock. */
export function greeting(name: string | null | undefined, now: Date = new Date()): string {
  const hour = new Date(now.getTime() + 330 * 60000).getUTCHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const n = String(name || '').trim();
  return n ? `${part}, ${n}` : part;
}

export function isNewAccount(s: HomeSummary | null | undefined): boolean {
  return Boolean(s && s.setup && !s.setup.allDone && s.setup.done === 0);
}

/** `actionCount` is the number of Do this next rows actually shown (plan rows can move to the plan banner). */
export function headline(s: HomeSummary, actionCount?: number): string {
  if (isNewAccount(s)) return 'Welcome to Nebulaa. A few short steps and your first posts are on their way.';
  const d = s?.numbers?.draftsWaiting;
  if (d && d.available && isNum(d.value) && d.value > 0) return d.value === 1 ? '1 post is waiting for your review.' : `${formatCount(d.value)} posts are waiting for your review.`;
  const count = isNum(actionCount) ? actionCount : Array.isArray(s?.nextActions) ? s.nextActions.length : 0;
  if (count > 0) return 'Here is what needs you today.';
  return s?.plan?.state === 'building' ? 'Your plan is on its way. You can make a post in the meantime.' : 'You are up to date.';
}

// ---- create tiles and the describe box -----------------------------------------------------------------------------
export const DESCRIBE_MAX = 500;
export type Handoff =
  | { target: 'carousel'; route: string; data: CarouselPrefill }
  | { target: 'video'; route: string; data: VideoPrefill };

/** The typed idea goes to Create (Post) or Videos through the same one-shot prefill the plan uses. No model call here. */
export function describeHandoff(tab: 'post' | 'video', text: string, language: string | null | undefined): Handoff | null {
  const idea = String(text || '').trim().slice(0, DESCRIBE_MAX);
  if (!idea) return null;
  const lang = String(language || '').trim();
  if (tab === 'video') return { target: 'video', route: '/reels', data: { idea, ...(lang ? { language: lang } : {}), source: 'home' } };
  return { target: 'carousel', route: '/campaigns', data: { mode: 'single', topic: idea, ...(lang ? { language: lang } : {}), source: 'home' } };
}

export type HomeCreateKey = 'single' | 'carousel' | 'campaign' | 'video';
export const HOME_CREATE_TILES: ReadonlyArray<{ key: HomeCreateKey; title: string; subtitle: string; accent: 'create' | 'video' }> = [
  { key: 'single', title: 'Post', subtitle: 'One image with a caption', accent: 'create' },
  { key: 'carousel', title: 'Carousel', subtitle: 'Swipeable slides', accent: 'create' },
  { key: 'campaign', title: 'Campaign', subtitle: 'A series for one goal', accent: 'create' },
  { key: 'video', title: 'Video', subtitle: 'A short video', accent: 'video' },
];

export function createTileHandoff(key: HomeCreateKey): { target: 'carousel' | null; route: string; data: CarouselPrefill | null } {
  if (key === 'video') return { target: null, route: '/reels', data: null };
  return { target: 'carousel', route: '/campaigns', data: { mode: key, source: 'home' } };
}

// ---- smaller blocks ------------------------------------------------------------------------------------------------
export function competitorsStrip(c: HomeSummary['competitors'] | null | undefined): { title: string; detail: string; to: string } | null {
  if (!c || !c.held || !isNum(c.tracked) || c.tracked <= 0) return null;
  const title = `${formatCount(c.tracked)} ${c.tracked === 1 ? 'competitor' : 'competitors'} tracked`;
  const detail = isNum(c.needHandle) && c.needHandle > 0
    ? `${formatCount(c.needHandle)} ${c.needHandle === 1 ? 'needs' : 'need'} a confirmed handle.`
    : 'We look at their public posts each week.';
  return { title, detail, to: '/competitors' };
}

export function blockFailed(s: HomeSummary | null | undefined, name: string): boolean {
  return Boolean(s && Array.isArray(s.degraded) && s.degraded.includes(name));
}

export function statusWord(status: string): string {
  const v = String(status || '').toLowerCase();
  if (v === 'posted' || v === 'published') return 'Posted';
  if (v === 'scheduled') return 'Scheduled';
  if (v === 'failed') return 'Needs attention';
  return 'Planned';
}
