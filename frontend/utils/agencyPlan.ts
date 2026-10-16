/**
 * Pure rules for the Agency plan card, extra client purchase and usage view. Every amount and limit
 * is passed in from the server (GET /api/payment/plans, /api/agency/clients, /api/agency/usage).
 * Nothing here shows Quarks: customers see posts and videos.
 */
import { agencyErrorMessage } from './agency.ts';
import { formatInr, formatPaise } from './plans.ts';

type Agency = { includedClients: number; maxClients: number; slotInr?: number } | undefined | null;
type Slot = { inr?: number; gstPaise?: number; chargePaise?: number } | undefined | null;
type Outputs = { posts?: number; videos?: number } | undefined | null;

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const fmt = (n: number): string => n.toLocaleString('en-IN');
const plural = (n: number, one: string, many: string): string => `${fmt(n)} ${n === 1 ? one : many}`;

// ---------------- the Agency card on the plans page ----------------

/** One plain list for the card, built from the plan's own figures. The generic Starter/Growth lines are not used. */
export function agencyFeatureLines(plan: { outputs?: Outputs } | undefined | null, agency: Agency): string[] {
  const clients = num(agency?.includedClients);
  const posts = num(plan?.outputs?.posts);
  const videos = num(plan?.outputs?.videos);
  const lines: string[] = [];
  lines.push(clients ? `${clients} client brands, each with its own workspace` : 'Several client brands, each with its own workspace');
  lines.push(posts && videos
    ? `One shared pool each month: up to ${fmt(posts)} posts, or up to ${fmt(videos)} short videos with voice and music, in any mix`
    : 'One shared pool of posts and videos each month, used in any mix');
  lines.push('Publishing, inbox and competitor insights included');
  lines.push('A usage report for each client');
  lines.push('Top up the shared pool any time');
  return lines;
}

export function agencyExtraClientLine(agency: Agency, slot: Slot): string {
  const inr = num(slot?.inr) || num(agency?.slotInr);
  const max = num(agency?.maxClients);
  if (!inr || !max) return '';
  return `Extra clients are ${formatInr(inr)} a month plus GST each, up to ${max} clients in total.`;
}

export type AgencyCardState = 'managed' | 'current' | 'other-plan' | 'available';

export function agencyCardState(tier: string | null | undefined): AgencyCardState {
  if (tier === 'managed') return 'managed';
  if (tier === 'agency') return 'current';
  if (tier === 'starter' || tier === 'professional') return 'other-plan';
  return 'available';
}

export function agencyCardNote(state: AgencyCardState): string {
  return state === 'other-plan' ? 'You already have an active plan.' : '';
}

// ---------------- extra client purchase ----------------

export function slotPrice(slot: Slot, agency: Agency): { exGst: string; withGst: string; monthly: string; monthlyWithGst: string } | null {
  const inr = num(slot?.inr) || num(agency?.slotInr);
  if (!inr) return null;
  const charge = num(slot?.chargePaise);
  const exGst = formatInr(inr);
  const withGst = charge ? formatPaise(charge) : '';
  return {
    exGst,
    withGst,
    monthly: `${exGst} a month plus GST`,
    monthlyWithGst: withGst ? `${withGst} a month including 18 percent GST` : '',
  };
}

export function slotAvailability(i: { limit: unknown; used: unknown; maxClients: unknown }): { canBuy: boolean; atMax: boolean; nextLimit: number; message: string; hint: string } {
  const limit = num(i.limit);
  const used = num(i.used);
  const max = num(i.maxClients) || 25;
  if (!limit) return { canBuy: false, atMax: false, nextLimit: 0, message: 'Extra clients are part of an active Agency plan.', hint: '' };
  if (limit >= max) {
    return { canBuy: false, atMax: true, nextLimit: limit, message: `You are at the most clients one agency account can have (${max}). Contact us for a larger set-up.`, hint: '' };
  }
  const free = Math.max(0, limit - used);
  const hint = free === 0 ? '' : free === 1 ? 'You have 1 client place not in use.' : `You have ${free} client places not in use.`;
  return { canBuy: true, atMax: false, nextLimit: limit + 1, message: `Your limit goes from ${limit} to ${limit + 1} clients.`, hint };
}

/** The lines of the purchase dialog, before any payment window opens. */
export function slotConfirmText(slot: Slot, agency: Agency, limit: number): string[] {
  const price = slotPrice(slot, agency);
  const lines: string[] = [];
  if (price) {
    lines.push(`One more client is ${price.monthly}.`);
    if (price.monthlyWithGst) lines.push(`You will pay ${price.monthlyWithGst}.`);
  } else {
    lines.push('One more client is added to your Agency plan.');
  }
  lines.push(`Your limit goes from ${limit} to ${limit + 1} clients. It renews monthly with your plan.`);
  return lines;
}

export function slotCreateMessage(err: unknown): string {
  return agencyErrorMessage(err, 'The payment could not be started. Please try again.');
}

const REFUND_TIME = 'If it cannot be added, we will refund the payment. A refund can take several working days to reach your account.';

/** What to say when the server cannot confirm a payment. A 409 means the payment was taken but the client was not added yet. */
export function slotVerifyMessage(err: unknown): string {
  const status = err && typeof err === 'object' ? Number((err as { status?: unknown }).status) : 0;
  if (status === 409) {
    const own = agencyErrorMessage(err, '');
    const lead = own || 'We received your payment, but the extra client could not be added yet. Our team has been told and will confirm it with you.';
    return `${lead.replace(/\s+$/, '')} Please do not pay again. ${REFUND_TIME}`;
  }
  if (status >= 400 && status < 500) {
    const own = agencyErrorMessage(err, '');
    if (own) return own;
  }
  return 'We could not confirm the payment just now. If money was taken, please do not pay again; contact us and we will check it.';
}

export function slotConfirmedText(result: { clientLimit?: unknown; message?: unknown } | null | undefined): string {
  const limit = num(result?.clientLimit);
  const base = 'Your extra client is added.';
  return limit ? `${base} You can now have ${limit} clients.` : base;
}

// ---------------- months ----------------

export const monthKeyOf = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
export const isMonthKey = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function shiftMonth(key: string, delta: number): string {
  if (!isMonthKey(key)) return key;
  const [y, m] = key.split('-').map(Number);
  return monthKeyOf(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(key: string): string {
  if (!isMonthKey(key)) return '';
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const canGoNext = (key: string, currentKey: string): boolean => isMonthKey(key) && isMonthKey(currentKey) && key < currentKey;
/** A report can go back up to two years from this month. */
export const canGoPrev = (key: string, currentKey: string): boolean => isMonthKey(key) && isMonthKey(currentKey) && key > shiftMonth(currentKey, -24);
export const monthChoices = (currentKey: string, count = 12): string[] => Array.from({ length: count }, (_, i) => shiftMonth(currentKey, -i));

// ---------------- usage view ----------------

export type UsageLine = { id: string; name: string; removed: boolean; frozen: boolean; posts: number; videos: number; lastActive: string | null };

/** Only what a customer may see. Quark figures in the answer are dropped here. */
export function usageRowsOf(resp: { clients?: unknown } | null | undefined): UsageLine[] {
  const list = Array.isArray(resp?.clients) ? (resp!.clients as any[]) : [];
  return list.filter((c) => c && typeof c === 'object').map((c) => ({
    id: String(c.id ?? ''),
    name: String(c.name ?? ''),
    removed: !!c.removed,
    frozen: !!c.frozen,
    posts: num(c.posts),
    videos: num(c.videos),
    lastActive: typeof c.lastActive === 'string' ? c.lastActive : null,
  }));
}

export function poolText(posts: unknown, videos: unknown): string {
  if (posts === undefined || posts === null || (typeof posts === 'number' && !Number.isFinite(posts))) return '';
  const p = num(posts);
  const hasVideos = videos !== undefined && videos !== null && !(typeof videos === 'number' && !Number.isFinite(videos));
  const v = hasVideos ? num(videos) : 0;
  if (!p && !v) return 'Your shared pool is empty. Add more to keep making posts and videos.';
  if (!hasVideos) return `Your shared pool has about ${plural(p, 'post', 'posts')} left this month.`;
  return `Your shared pool has about ${plural(p, 'post', 'posts')} or ${plural(v, 'video', 'videos')} left this month.`;
}

export function pagerState(r: { page?: number; limit?: number; total?: number; hasMore?: boolean } | null | undefined): { page: number; canPrev: boolean; canNext: boolean; text: string } {
  const page = num(r?.page) || 1;
  const limit = num(r?.limit) || 25;
  const total = num(r?.total);
  const canPrev = page > 1;
  const canNext = !!r?.hasMore;
  if (total <= limit && page === 1) return { page, canPrev: false, canNext: false, text: '' };
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return { page, canPrev, canNext, text: total ? `Showing ${from} to ${to} of ${total} clients` : '' };
}

export const removedClientNote = (): string => 'Clients you removed are shown together as Removed client. Their use is kept so the totals add up.';

export function usageLoadMessage(err: unknown): string {
  const status = err && typeof err === 'object' ? Number((err as { status?: unknown }).status) : 0;
  if (status === 403) return 'Usage reports are available while your Agency plan is active.';
  return 'We could not load this month\'s usage. Please try again.';
}

export const csvLinkLabel = (month: string): string => (isMonthKey(month) ? `Download ${monthLabel(month)} as CSV` : 'Download as CSV');

/** What the plans page says to someone who reached it from inside a client. Billing stays with the agency account. */
export function insideClientBillingNotice(): { title: string; body: string; action: string } {
  return {
    title: 'Plans and payments are handled in your agency account',
    body: 'You are working inside a client. To change the plan, add an extra client or add more posts and videos to the shared pool, go back to your clients first.',
    action: 'Back to my clients',
  };
}

/** The heading of the plans page for an agency account. */
export function agencyHeadline(poolEmpty: boolean): { title: string; body: string } {
  return poolEmpty
    ? { title: 'Your shared pool is used up', body: 'Add more posts and videos to the shared pool below, or add an extra client, to keep going.' }
    : { title: 'Your Agency plan', body: 'See your plan, add an extra client or add more posts and videos to the shared pool. Prices are shown before GST; 18 percent GST is added at checkout.' };
}
