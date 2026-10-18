// Pure helpers for the plans page and the upgrade prompts. No prices live here:
// every amount comes from GET /api/payment/plans, in integer paise.

export type UpgradeReason = 'upgrade' | 'addon' | 'quarks';

export interface UpgradeInfo {
  reason: UpgradeReason;
  feature?: string;
  message: string;
}

const BASE = 'Please upgrade your plan, or add more posts and videos.';

const FEATURE_LABELS: Record<string, string> = {
  social_connect: 'Connecting social accounts',
  publish: 'Publishing',
  schedule: 'Scheduling',
  inbox: 'The inbox',
  auto_reply: 'Automatic replies',
  competitors: 'Competitor insights',
};

export function featureLabel(feature?: string): string {
  return (feature && FEATURE_LABELS[feature]) || '';
}

/** The plain message for each reason, always ending with the one next step. */
export function upgradeMessage(reason: UpgradeReason, feature?: string): string {
  const label = featureLabel(feature);
  if (reason === 'quarks') return `This needs more than you have left. ${BASE}`;
  if (reason === 'addon') return `${label || 'This feature'} is available as an add-on. ${BASE}`;
  return `${label || 'This feature'} is not included in your current plan. ${BASE}`;
}

/**
 * Reads a failed API call. Returns the upgrade details when the server answered
 * with `upgradeRequired` (or `creditsExhausted`), otherwise null.
 */
export function upgradeInfoOf(err: any): UpgradeInfo | null {
  const d = err?.data;
  if (!d || typeof d !== 'object') return null;
  if (!d.upgradeRequired && !d.creditsExhausted) return null;
  const reason: UpgradeReason = d.reason === 'addon' || d.reason === 'quarks' || d.reason === 'upgrade'
    ? d.reason
    : d.creditsExhausted ? 'quarks' : 'upgrade';
  const feature = typeof d.feature === 'string' ? d.feature : undefined;
  return { reason, feature, message: upgradeMessage(reason, feature) };
}

/** Whole rupees, no decimals. */
export function formatInr(inr: number): string {
  return `₹${Math.round(inr).toLocaleString('en-IN')}`;
}

/** Integer paise to rupees without float maths: 117882 becomes ₹1,178.82. */
export function formatPaise(paise: number): string {
  const whole = Math.floor(paise / 100);
  const rem = paise % 100;
  return `₹${whole.toLocaleString('en-IN')}.${String(rem).padStart(2, '0')}`;
}

export function tierLabel(tier?: string): string {
  switch (tier) {
    case 'starter': return 'Starter';
    case 'professional': return 'Growth';
    case 'agency': return 'Agency';
    case 'managed': return 'Managed';
    default: return 'Free';
  }
}

/** An Error that keeps the server's answer, so `upgradeInfoOf` can read it (same shape `apiCall` throws). */
export function apiErrorFrom(data: any, status: number, fallback: string): Error {
  const d = data && typeof data === 'object' ? data : {};
  const err: any = new Error(d.message || d.error || fallback);
  err.status = status;
  err.reason = d.reason || '';
  err.data = d;
  return err;
}

// ---------------- the plans page: posts and videos, never Quarks ----------------

export const PLANS_INTRO = 'Choose a monthly plan, add the features you need, or add more posts and videos at any time. Prices are shown before GST; 18 percent GST is added at checkout.';

const PLAN_ORDER = ['starter', 'professional', 'agency'];

/** The cards are always Starter, Growth, Agency, whatever order the server sends. An unknown plan goes last. */
export function orderedPlans<T extends { id: string }>(plans: T[] | null | undefined): T[] {
  const rank = (id: string) => { const i = PLAN_ORDER.indexOf(id); return i < 0 ? PLAN_ORDER.length : i; };
  return (Array.isArray(plans) ? [...plans] : []).sort((a, b) => rank(a.id) - rank(b.id));
}

const count = (n: number): string => n.toLocaleString('en-IN');
const noun = (n: number, one: string, many: string): string => `${count(n)} ${n === 1 ? one : many}`;
const wholeCost = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/** What a balance still buys, from the per-post and per-video costs the server reports. Empty when the costs are unknown. */
export function leftText(balance: number | null | undefined, costs: Record<string, number> | null | undefined): string {
  const post = wholeCost(costs?.image_generated);
  const video = wholeCost(costs?.studio_video);
  if (typeof balance !== 'number' || !Number.isFinite(balance) || !post || !video) return '';
  const posts = Math.floor(Math.max(0, balance) / post);
  const videos = Math.floor(Math.max(0, balance) / video);
  if (!posts) return 'No posts or videos left. Add more below.';
  if (!videos) return `About ${noun(posts, 'post', 'posts')} left.`;
  return `About ${noun(posts, 'post', 'posts')} or ${noun(videos, 'short video', 'short videos')} left, in any mix.`;
}

/**
 * The header balance chip, in posts and videos. `compact` fits a phone header ("24 posts · 1 video"); `full` is the
 * desktop line ("About 24 posts or 1 video left"). The raw balance is never shown. Empty strings when the costs are unknown.
 */
export function balanceChip(balance: number | null | undefined, costs: Record<string, number> | null | undefined): { compact: string; full: string; low: boolean } {
  const post = wholeCost(costs?.image_generated);
  const video = wholeCost(costs?.studio_video);
  if (typeof balance !== 'number' || !Number.isFinite(balance) || !post) return { compact: '', full: '', low: false };
  const b = Math.max(0, balance);
  const posts = Math.floor(b / post);
  const videos = video ? Math.floor(b / video) : 0;
  const low = posts < 4;
  if (!posts) return { compact: 'None left', full: 'No posts or videos left', low: true };
  if (!videos) return { compact: noun(posts, 'post', 'posts'), full: `About ${noun(posts, 'post', 'posts')} left`, low };
  return {
    compact: `${noun(posts, 'post', 'posts')} · ${noun(videos, 'video', 'videos')}`,
    full: `About ${noun(posts, 'post', 'posts')} or ${noun(videos, 'video', 'videos')} left`,
    low,
  };
}

/** "You have enough for 3 Hero videos", from a balance and a price. Empty when it cannot be worked out or nothing is affordable. */
export function enoughFor(balance: number | null | undefined, price: number | null | undefined, one: string, many: string): string {
  const p = wholeCost(price);
  if (typeof balance !== 'number' || !Number.isFinite(balance) || !p) return '';
  const n = Math.floor(Math.max(0, balance) / p);
  return n > 0 ? `You have enough for ${noun(n, one, many)}.` : '';
}

/** One top-up pack, in the posts and videos it adds. */
export function topupLine(outputs: { posts?: number; videos?: number } | null | undefined): string {
  const posts = Math.floor(wholeCost(outputs?.posts));
  const videos = Math.floor(wholeCost(outputs?.videos));
  if (!posts) return '';
  return videos ? `About ${noun(posts, 'post', 'posts')} or ${noun(videos, 'short video', 'short videos')}` : `About ${noun(posts, 'post', 'posts')}`;
}

/** A message from the server, unless it names Quarks (customers never see them): then the plain fallback. */
export function plainMessage(message: unknown, fallback: string): string {
  const m = typeof message === 'string' ? message.trim() : '';
  return m && !/quark|credit/i.test(m) ? m : fallback;
}

/** The server sends "Up to N posts a month, or" and "up to M short videos..." as two lines; show them as one. */
export function planLines(features: string[] | null | undefined): string[] {
  const list = Array.isArray(features) ? features.filter((f) => typeof f === 'string' && f.trim()) : [];
  if (list.length >= 2 && /,\s*or$/i.test(list[0].trim())) return [`${list[0].trim()} ${list[1].trim()}`, ...list.slice(2)];
  return list;
}

/** 12 November 2026, in India time. Empty for anything that is not a date. */
export function renewalText(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** The line under the heading: the plan, what is left, and when it renews. */
export function currentPlanLine(i: { tier?: string; left: string; renews: string; ending?: boolean }): string {
  if (!i.tier || i.tier === 'free') return 'You do not have a plan yet.';
  return [`Your plan: ${tierLabel(i.tier)}.`, i.left, i.renews ? `${i.ending ? 'Ends' : 'Renews'} on ${i.renews}.` : ''].filter(Boolean).join(' ');
}

const ADDON_BLURBS: Record<string, string> = {
  publish: 'Post to your connected accounts straight from Nebulaa, or schedule posts for later.',
  competitors: 'Follow the competitors you choose and see what they post, so you can plan your own.',
  inbox: 'Read comments and messages in one place. Replies are drafted for you to approve, and are sent automatically only when you switch them on.',
  bundle: 'All three add-ons together, for less than buying them one by one.',
};

export function addonBlurb(id: string): string {
  return ADDON_BLURBS[id] || '';
}
