/** Home drafts from a competitor's stored post: "Make a post in response" and "Draft a witty comment"
 *  (docs/superpowers/ops/home-drafts.md). Pure helpers, no React, so node --test can import them. The page sends only a
 *  reference to a stored post and a one-press key; the server writes and checks the draft. Nebulaa never posts anything
 *  from here: a comment is copied by the customer, a post opens in Create. */
import type { CarouselPrefill } from './prefill.ts';

export type DraftKind = 'response_post' | 'witty_comment';
export type DraftTone = 'friendly' | 'witty';
export interface DraftPrice { quarks: number; price: string; worth: string }
export interface DraftOptions {
  success?: boolean; staff?: boolean;
  enabled: boolean; entitled: boolean; locked: 'upgrade' | 'addon' | null;
  prices: Record<DraftKind, DraftPrice>;
  tones: DraftTone[]; languages: { key: string; label: string }[]; language: string;
  perDay: number; left: number | null; maxComment: number; maxCaption: number;
  /** Agency owners and client workspaces see the posts equivalent only, never Quarks. */
  postsOnly?: boolean;
}
export interface DraftText { comment?: string; caption?: string; imageIdea?: string }
export interface DraftAnswer { success?: boolean; kind?: DraftKind; draft?: DraftText; quarks?: number; price?: string; language?: string; replay?: boolean; message?: string }
/** The post a draft starts from, as the tile knows it. */
export interface DraftSource {
  ref: string; title: string; url: string | null;
  /** Who the post is from, for the picture in the sheet's header (nothing else about them is shown). */
  name?: string; handle?: string; avatarUrl?: string | null;
}

export const KIND_LABEL: Record<DraftKind, string> = { response_post: 'Make a post in response', witty_comment: 'Draft a witty comment' };
export const KIND_TITLE: Record<DraftKind, string> = { response_post: 'A post in response', witty_comment: 'A witty comment' };
export const TONE_LABEL: Record<DraftTone, string> = { friendly: 'Friendly', witty: 'Light and witty' };
export const SELF_POST_LINE = 'You post this yourself on their page. Nebulaa never posts on other pages.';
export const OWN_PAGE_LINE = 'This is for your own page. It opens in Create, where you can add a picture and review it before anything is posted.';
export const CHECK_LINE = 'Check this before you post it. You are responsible for what you publish.';
export const DECENT_LINE = 'Every draft is kept kind and about your own business. It never names or compares with anyone, and it is checked twice before you see it.';
export const WORKING_LINE = 'Writing and checking your draft. This takes a few seconds.';
const GENERIC = 'We could not write a draft just now. Nothing was charged. Please try again.';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isDraftOptions(v: unknown): v is DraftOptions {
  const o = v as DraftOptions;
  if (!o || typeof o !== 'object') return false;
  if (o.staff) return true;
  return typeof o.enabled === 'boolean' && typeof o.entitled === 'boolean' && !!o.prices
    && isNum(o.prices.response_post?.quarks) && isNum(o.prices.witty_comment?.quarks) && Array.isArray(o.languages);
}

/** The two buttons show only when the feature is on, the account may use it, and the post has a reference. */
export function draftsAvailable(opts: DraftOptions | null | undefined, ref?: string | null): boolean {
  return Boolean(opts && !opts.staff && opts.enabled && opts.entitled && String(ref || '').length > 0);
}

/** The price shown before pressing: "6 Quarks (about 1 post's worth)", or only "About 1 post's worth" where the account
 *  sees posts and videos rather than Quarks (agency owners and their clients). */
export function priceLabel(opts: DraftOptions | null | undefined, kind: DraftKind, postsOnly = false): string {
  const p = opts?.prices?.[kind];
  if (!p || !isNum(p.quarks)) return '';
  if (postsOnly || opts?.postsOnly) { const w = String(p.worth || '').trim(); return w ? w[0].toUpperCase() + w.slice(1) : ''; }
  return String(p.price || `${p.quarks} Quarks`);
}

/** A new key for one press of the button: a second press of the same key is never charged again. */
export function newDraftKey(now: number = Date.now(), rand: () => number = Math.random): string {
  const r = Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36) % 36]).join('');
  return `hd-${now.toString(36)}-${r}`;
}

export type SheetState = 'confirm' | 'working' | 'done' | 'blocked' | 'limit' | 'busy' | 'locked' | 'balance' | 'missing' | 'waiting' | 'error';
export interface Outcome { state: SheetState; message: string; canRetry: boolean }

/** What the sheet shows for a failed request (the error thrown by the api call, with the server's answer on `data`). */
export function outcomeOf(err: unknown): Outcome {
  const e = err as { status?: number; message?: string; data?: Record<string, unknown> } | null;
  const d = (e && e.data) || {};
  const message = String(d.message || e?.message || '').trim() || GENERIC;
  const status = Number(e?.status) || 0;
  if (d.blocked || status === 422) return { state: 'blocked', message, canRetry: true };
  if (d.limit || status === 429) return { state: 'limit', message, canRetry: d.limit === 'minute' };
  if (d.inProgress || status === 409) return { state: 'waiting', message, canRetry: true };
  if (d.locked || (status === 403 && !d.creditsExhausted && /add-on|paid plans/i.test(message))) return { state: 'locked', message, canRetry: false };
  if (d.creditsExhausted || /needs .*Quarks|top up/i.test(message)) return { state: 'balance', message, canRetry: false };
  if (d.serviceBusy || d.disabled || status === 503) return { state: 'busy', message, canRetry: !d.disabled };
  if (status === 404) return { state: 'missing', message, canRetry: false };
  return { state: 'error', message: status >= 500 || !status ? (d.message ? message : GENERIC) : message, canRetry: true };
}

/** Only a shown draft with text for its kind counts; anything else is treated as a failed request. */
export function draftOf(answer: DraftAnswer | null | undefined, kind: DraftKind): DraftText | null {
  const d = answer && answer.draft;
  if (!d) return null;
  if (kind === 'witty_comment') return typeof d.comment === 'string' && d.comment.trim() ? { comment: d.comment.trim() } : null;
  return typeof d.caption === 'string' && d.caption.trim() ? { caption: d.caption.trim(), imageIdea: String(d.imageIdea || '').trim() } : null;
}

/** "Use in Create": the caption and the picture idea go to Create content as a single post, through the one-shot prefill. */
export function createHandoff(draft: DraftText | null, language?: string | null): { route: string; data: CarouselPrefill } | null {
  const caption = String(draft?.caption || '').trim();
  if (!caption) return null;
  const idea = String(draft?.imageIdea || '').trim();
  const topic = idea ? `${caption}\n\nPicture idea: ${idea}` : caption;
  const lang = String(language || '').trim();
  return { route: '/campaigns', data: { mode: 'single', topic, ...(lang ? { language: lang } : {}), source: 'home' } };
}

/** "Drafts left today" line, or '' when unknown. */
export function leftLine(opts: DraftOptions | null | undefined): string {
  const n = opts?.left;
  if (!isNum(n)) return '';
  if (n <= 0) return "You have made today's drafts. You can make more tomorrow.";
  return `You can make ${n} more ${n === 1 ? 'draft' : 'drafts'} today.`;
}
