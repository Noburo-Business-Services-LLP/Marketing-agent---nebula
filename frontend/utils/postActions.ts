/**
 * ONE set of post actions, in ONE fixed order, for every screen that shows a post (Library, Review and approve, the
 * post sheet; later Create, Videos and Photoshoot results, Calendar and Home). Pure: no network, no React.
 *
 * Order (owner, 2026-10-19): Approve, Schedule, Post now, Download, Edit, Make again, Unschedule, Unapprove, Archive,
 * Delete (to the Bin), Restore. A screen never reorders them. An action the customer cannot use right now stays in its
 * place, disabled, with the reason in plain words ("Needs the Publish add-on"), so screens keep their shape.
 *
 * The rules follow the server (backend/services/postLifecycle.js, docs/superpowers/impact-maps/simplify-navigation.md):
 *  - Only posts Nebulaa made for the customer (origin automation) need approval. Approve never posts.
 *  - Automation posts can be scheduled or posted only once approved. Manual posts can be scheduled or posted at once.
 *  - Delete moves to the Bin (restorable for 14 days). Posted items cannot go to the Bin (archive them).
 *    Scheduled items are unscheduled first. Archive is restorable at any time.
 *  - Scheduling and posting need a paid plan with the Publish add-on (managed accounts: always) and a connected account.
 * The server stays the judge: a refusal it sends back is shown as it comes.
 */
import { needsApproval, originOf } from './draftStatus.ts';

export { needsApproval };

export type PostActionKey =
  | 'approve' | 'schedule' | 'postNow' | 'download' | 'edit' | 'makeAgain'
  | 'unschedule' | 'unapprove' | 'archive' | 'delete' | 'restore';

export const ACTION_ORDER: readonly PostActionKey[] = Object.freeze([
  'approve', 'schedule', 'postNow', 'download', 'edit', 'makeAgain', 'unschedule', 'unapprove', 'archive', 'delete', 'restore',
] as PostActionKey[]);

/** The actions that sit in the "More" menu, never as the main button. */
export const MENU_ACTIONS: readonly PostActionKey[] = Object.freeze(['unschedule', 'unapprove', 'archive', 'delete'] as PostActionKey[]);

export const BIN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the account may schedule and post: 'ok', 'upgrade' (free plan), 'addon' (paid without Publish), 'unknown'. */
export type PublishAccess = 'ok' | 'upgrade' | 'addon' | 'unknown';

export interface PostActionContext {
  /** from the plan (publishAccessOf); 'unknown' leaves the buttons open and lets the server decide */
  publish?: PublishAccess;
  /** at least one social account connected; null or undefined when not known */
  hasAccount?: boolean | null;
  /** the Quark price of Make again for this post (0 or unknown: no amount shown) */
  makeAgainQuarks?: number | null;
  /** staff looking at an account without a client open: download only */
  staffView?: boolean;
  /** the screen has no editor to open: Edit is left out */
  canEdit?: boolean;
  /** for tests: the time now */
  now?: number;
}

export interface ConfirmText { title: string; message: string; confirmLabel: string; danger?: boolean }

export interface PostAction {
  key: PostActionKey;
  label: string;
  /** a short line for the button's tooltip and screen readers */
  hint: string;
  disabled: boolean;
  /** why it is disabled, in plain words; '' when it can be used */
  reason: string;
  /** asked before it runs; undefined for the safe ones */
  confirm?: ConfirmText;
  /** the Quark amount shown beside Make again */
  quarks?: number;
  /** the one main button for this post */
  primary: boolean;
  /** lives in the "More" menu */
  menu: boolean;
}

export interface DraftForActions {
  status?: unknown;
  origin?: unknown;
  sourceType?: unknown;
  contentType?: unknown;
  contentCalendarId?: unknown;
  calendarDay?: unknown;
  imageUrl?: unknown;
  carouselSlides?: unknown;
  creative?: { imageUrls?: unknown; videoUrl?: unknown } | null;
  platforms?: unknown;
  scheduledDate?: unknown;
  binnedAt?: unknown;
  title?: unknown;
}

const clean = (s: unknown): string => String(s === undefined || s === null || s === '' ? 'draft' : s).trim().toLowerCase();
const WAITING = ['pending', 'draft', 'ready', 'completed'];

const LABELS: Record<PostActionKey, string> = {
  approve: 'Approve', schedule: 'Schedule', postNow: 'Post now', download: 'Download', edit: 'Edit',
  makeAgain: 'Make again', unschedule: 'Unschedule', unapprove: 'Unapprove', archive: 'Archive',
  delete: 'Delete', restore: 'Restore',
};

const HINTS: Record<PostActionKey, string> = {
  approve: 'Say this post is good to go out. Nothing is posted yet.',
  schedule: 'Pick a date and time for it to go out.',
  postNow: 'Post it to your accounts now.',
  download: 'Save the picture to your device.',
  edit: 'Change the words or the picture.',
  makeAgain: 'Make a new picture for this post.',
  unschedule: 'Stop it going out at its time. It stays approved.',
  unapprove: 'Move it back to Needs approval.',
  archive: 'Put it away. You can restore it at any time.',
  delete: `Move it to the Bin. You can restore it for ${BIN_DAYS} days.`,
  restore: 'Bring it back to where it was.',
};

export const REASONS = Object.freeze({
  approveFirst: 'Approve this post first',
  paidPlan: 'Needs a paid plan',
  addon: 'Needs the Publish add-on',
  account: 'Connect an account first',
  platforms: 'Choose where to post first',
  binExpired: `It was in the Bin for more than ${BIN_DAYS} days`,
});

/** The plan's answer for scheduling and posting, the same rule as backend/config/entitlements.js canUse('publish'). */
export function publishAccessOf(plan: { tier?: unknown; addons?: unknown } | null | undefined): PublishAccess {
  if (!plan || typeof plan !== 'object') return 'unknown';
  const tier = String(plan.tier || '');
  // Accounts without a tier are the original managed accounts, which are never blocked.
  if (!tier || tier === 'managed' || tier === 'agency') return 'ok';
  if (tier === 'free') return 'upgrade';
  if (tier !== 'starter' && tier !== 'professional') return 'unknown';
  const addons = Array.isArray(plan.addons) ? plan.addons.map(String) : [];
  return addons.includes('publish') || addons.includes('bundle') ? 'ok' : 'addon';
}

/** The pictures a post has, in order: carousel slides, else its one picture. */
export function picturesOf(d: DraftForActions | null | undefined): string[] {
  if (!d) return [];
  const slides = Array.isArray(d.carouselSlides) ? (d.carouselSlides as any[]) : [];
  const fromSlides = slides.slice().sort((a, b) => ((a && a.order) || 0) - ((b && b.order) || 0))
    .map((s) => String((s && s.imageUrl) || '')).filter((u) => /^(https?:|data:image\/)/i.test(u));
  if (fromSlides.length) return fromSlides;
  const one = String(d.imageUrl || (d.creative && Array.isArray(d.creative.imageUrls) && d.creative.imageUrls[0]) || '');
  return /^(https?:|data:image\/)/i.test(one) ? [one] : [];
}

/** Days left before a post in the Bin is removed for good (0 when it is due or the date is unknown). */
export function binDaysLeft(binnedAt: unknown, now = Date.now()): number {
  const t = new Date(String(binnedAt || '')).getTime();
  if (!Number.isFinite(t) || !binnedAt) return 0;
  return Math.max(0, Math.ceil((t + BIN_DAYS * DAY_MS - now) / DAY_MS));
}

const PLATFORM_WORD: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', twitter: 'X', x: 'X', youtube: 'YouTube', gmb: 'Google Business', tiktok: 'TikTok', pinterest: 'Pinterest', threads: 'Threads',
};

/** "Instagram and Facebook", "Instagram, Facebook and LinkedIn". */
export function platformList(platforms: unknown): string {
  const list = (Array.isArray(platforms) ? platforms : []).map((p) => String(p || '').toLowerCase()).filter(Boolean)
    .map((p) => PLATFORM_WORD[p] || p.charAt(0).toUpperCase() + p.slice(1));
  const uniq = Array.from(new Set(list));
  if (uniq.length <= 1) return uniq[0] || '';
  return `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`;
}

const quarkWord = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'Quark' : 'Quarks'}`;

/** The confirm text for the actions that ask first. */
export function confirmFor(key: PostActionKey, d: DraftForActions, ctx: PostActionContext = {}): ConfirmText | undefined {
  const quarks = Number(ctx.makeAgainQuarks) > 0 ? Number(ctx.makeAgainQuarks) : 0;
  const where = platformList(d && d.platforms);
  switch (key) {
    case 'postNow':
      return { title: 'Post this now?', message: where ? `This posts it to ${where} now.` : 'This posts it to your accounts now.', confirmLabel: 'Post now' };
    case 'makeAgain':
      return {
        title: 'Make this again?',
        message: quarks ? `This makes a new picture for ${quarkWord(quarks)} and replaces the current one.` : 'This makes a new picture and replaces the current one.',
        confirmLabel: 'Make again',
      };
    case 'unschedule':
      return { title: 'Unschedule this post?', message: 'It will not go out at its time. It stays approved, so you can pick a new time.', confirmLabel: 'Unschedule' };
    case 'delete':
      return {
        title: 'Move this to the Bin?',
        message: `It stays in the Bin for ${BIN_DAYS} days, so you can restore it. After that it is removed for good.`,
        confirmLabel: 'Move to the Bin', danger: true,
      };
    default:
      return undefined;
  }
}

/** Which actions apply to a post in this state, before plan and account locks. */
function keysFor(d: DraftForActions): PostActionKey[] {
  const s = clean(d.status);
  const source = String(d.sourceType || d.contentType || 'post').toLowerCase();
  const isVideo = source === 'reel' || source === 'video';
  const pics = picturesOf(d).length > 0 || Boolean(isVideo && d.creative && d.creative.videoUrl);
  const dl: PostActionKey[] = pics ? ['download'] : [];
  if (s === 'processing') return [];
  if (s === 'binned') return [...dl, 'restore'];
  if (s === 'archived' || s === 'rejected') return [...dl, 'restore', 'delete'];
  if (s === 'published' || s === 'posted') return [...dl, 'makeAgain', 'archive'];
  if (s === 'scheduled') return ['schedule', 'postNow', ...dl, 'edit', 'unschedule'];
  if (s === 'approved') return ['schedule', 'postNow', ...dl, 'edit', 'makeAgain', 'unapprove', 'archive', 'delete'];
  if (s === 'failed') return ['edit', 'makeAgain', 'archive', 'delete'];
  if (WAITING.includes(s)) {
    const base: PostActionKey[] = ['schedule', 'postNow', ...dl, 'edit', 'makeAgain', 'archive', 'delete'];
    return originOf(d as any) === 'automation' ? ['approve', ...base] : base;
  }
  return [...dl];
}

/**
 * The ordered actions for one post. Each says whether it can be used now and, if not, why.
 * The primary is the first usable one that is not a menu action (Approve when a post needs approval).
 */
export function postActionsFor(d: DraftForActions | null | undefined, ctx: PostActionContext = {}): PostAction[] {
  if (!d || typeof d !== 'object') return [];
  const s = clean(d.status);
  let keys = keysFor(d);
  if (ctx.staffView) keys = keys.filter((k) => k === 'download');
  if (ctx.canEdit === false) keys = keys.filter((k) => k !== 'edit');
  // Make again redraws the picture; video posts are made again from their own page.
  const source = String(d.sourceType || d.contentType || 'post').toLowerCase();
  if (source === 'reel' || source === 'video') keys = keys.filter((k) => k !== 'makeAgain' && k !== 'approve');

  const waitingForOk = needsApproval(d as any);
  const access = ctx.publish || 'unknown';
  const noPlatforms = Array.isArray(d.platforms) && d.platforms.length === 0;
  const quarks = Number(ctx.makeAgainQuarks) > 0 ? Math.round(Number(ctx.makeAgainQuarks)) : 0;

  const reasonFor = (k: PostActionKey): string => {
    if (k === 'schedule' || k === 'postNow') {
      if (waitingForOk) return REASONS.approveFirst;
      if (access === 'upgrade') return REASONS.paidPlan;
      if (access === 'addon') return REASONS.addon;
      if (ctx.hasAccount === false) return REASONS.account;
      if (k === 'postNow' && noPlatforms) return REASONS.platforms;
    }
    if (k === 'restore' && s === 'binned' && d.binnedAt && binDaysLeft(d.binnedAt, ctx.now ?? Date.now()) <= 0) return REASONS.binExpired;
    return '';
  };

  const ordered = ACTION_ORDER.filter((k) => keys.includes(k));
  const out: PostAction[] = ordered.map((k) => {
    const reason = reasonFor(k);
    return {
      key: k,
      label: k === 'schedule' && s === 'scheduled' ? 'Change time' : LABELS[k],
      hint: k === 'schedule' && s === 'scheduled' ? 'Pick a new date and time.' : HINTS[k],
      disabled: Boolean(reason),
      reason,
      confirm: confirmFor(k, d, ctx),
      ...(k === 'makeAgain' && quarks ? { quarks } : {}),
      primary: false,
      menu: MENU_ACTIONS.includes(k),
    };
  });
  // Restore is the main button wherever it appears (Archived and the Bin).
  // A post that did not finish leads with Make again.
  const main = out.find((a) => a.key === 'restore' && !a.disabled)
    || (s === 'failed' ? out.find((a) => a.key === 'makeAgain' && !a.disabled) : undefined)
    || out.find((a) => !a.disabled && !a.menu);
  if (main) { main.primary = true; main.menu = false; }
  return out;
}

/** The one-line state of a post for its sheet and tiles, in words. */
export function postStateWord(d: DraftForActions | null | undefined): string {
  if (!d) return '';
  const s = clean(d.status);
  if (needsApproval(d as any)) return s === 'failed' ? 'Did not finish' : 'Needs approval';
  if (s === 'processing') return 'Creating';
  if (s === 'approved') return 'Approved';
  if (s === 'scheduled') return 'Scheduled';
  if (s === 'published' || s === 'posted') return 'Posted';
  if (s === 'archived' || s === 'rejected') return 'Archived';
  if (s === 'binned') return 'In the Bin';
  if (s === 'failed') return 'Did not finish';
  if (s === 'completed' || s === 'ready') return 'Ready';
  return 'Draft';
}

/** What to say after an action worked, when the server did not send its own words. */
export const DONE_WORDS: Record<PostActionKey, string> = {
  approve: 'Approved. You can schedule it, post it now or download it.',
  schedule: 'Scheduled.',
  postNow: 'Posted.',
  download: 'Downloading.',
  edit: '',
  makeAgain: 'A new picture is being made. It shows here when it is ready.',
  unschedule: 'Unscheduled. The post is approved and waits for a new time.',
  unapprove: 'Moved back to Needs approval.',
  archive: 'Archived. You can restore it at any time.',
  delete: `Moved to the Bin. You can restore it for ${BIN_DAYS} days.`,
  restore: 'Restored.',
};
