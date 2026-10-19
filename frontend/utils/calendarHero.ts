/**
 * The Calendar month hero and the "What this plan was built from" card (owner, 2026-10-18: a month hero and a plan
 * inputs card, "<Business>'s October posts, in one tap"). Everything shown comes from fields stored on the calendar;
 * nothing is invented. Pure functions only: no React, no locale or timezone use (Node runs this in tests).
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type ItemLike = { status?: string; format?: string; contentPillar?: string; productNeeded?: string; objective?: string };
type CalLike = {
  _id?: string; month?: string; businessName?: string; language?: string; businessVertical?: string; niche?: string;
  approved?: boolean; themeTitle?: string; weeks?: Array<{ items?: ItemLike[] }>;
};

const parse = (month?: string | null): { y: number; m: number } | null => {
  const hit = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim());
  if (!hit) return null;
  const m = Number(hit[2]);
  return m >= 1 && m <= 12 ? { y: Number(hit[1]), m } : null;
};

export const monthName = (month?: string | null): string => {
  const p = parse(month);
  return p ? MONTHS[p.m - 1] : '';
};

/** "2026-10" for a moment, on the India calendar (UTC + 5:30). */
export function indiaMonthKey(nowMs: number): string {
  const d = new Date(nowMs + 330 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month after "2026-12" is "2027-01". */
export function addMonth(month: string, n = 1): string {
  const p = parse(month);
  if (!p) return month;
  const idx = p.y * 12 + (p.m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** The month "Plan next month" makes: the one after the newest plan, or this month when there is none (as the server does). */
export function nextPlanMonth(history: CalLike[], todayMonth: string): string {
  const months = history.map((c) => String(c.month || '')).filter((m) => parse(m)).sort();
  return months.length ? addMonth(months[months.length - 1]) : todayMonth;
}

/** The month the hero shows: this month's plan, else the nearest coming one, else the newest past one. */
export function pickHeroCalendar<T extends CalLike>(history: T[], todayMonth: string): T | null {
  const valid = history.filter((c) => parse(c.month));
  if (!valid.length) return history[0] || null;
  const now = valid.find((c) => c.month === todayMonth);
  if (now) return now;
  const coming = valid.filter((c) => String(c.month) > todayMonth).sort((a, b) => String(a.month).localeCompare(String(b.month)));
  if (coming.length) return coming[0];
  return valid.slice().sort((a, b) => String(b.month).localeCompare(String(a.month)))[0];
}

/** "Audit Bakery's October posts"; "Sweets' October posts"; "Your October posts" without a name. */
export function heroTitle(businessName: string | undefined, month: string | undefined): string {
  const name = String(businessName || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const mn = monthName(month) || 'monthly';
  if (!name) return `Your ${mn} posts`;
  return `${name}${/s$/i.test(name) ? "'" : "'s"} ${mn} posts`;
}

export const allItems = (cal?: CalLike | null): ItemLike[] => (cal?.weeks || []).flatMap((w) => w?.items || []);

const APPROVED = new Set(['approved', 'generating', 'generated', 'scheduled', 'published']);

/** Planned days (everything not turned down), approved ones (approved or further along) and published ones. */
export function monthCounts(items: ItemLike[]): { planned: number; approved: number; published: number } {
  let planned = 0; let approved = 0; let published = 0;
  for (const it of items || []) {
    const s = String(it?.status || 'draft').toLowerCase();
    if (s === 'rejected') continue;
    planned++;
    if (APPROVED.has(s)) approved++;
    if (s === 'published') published++;
  }
  return { planned, approved, published };
}

/** The week of the month for a day number, as the week button has always counted it (1 to 4). */
export function weekOfMonth(day: number): number {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

export type HeroAction = { kind: 'plan' | 'open' | 'approve' | 'make-week'; label: string };

/** The one primary button of the hero. */
export function heroAction(cal: CalLike | null, opts: { inList: boolean; week: number; nextMonth?: string }): HeroAction {
  if (!cal) return { kind: 'plan', label: `Plan ${monthName(opts.nextMonth) || 'next month'}` };
  if (opts.inList) return { kind: 'open', label: `Open ${monthName(cal.month) || 'this month'}` };
  if (!cal.approved) return { kind: 'approve', label: 'Approve this month' };
  return { kind: 'make-week', label: `Make week ${opts.week} posts` };
}

const tidy = (v: unknown): string => String(v || '').replace(/\s+/g, ' ').trim();
const cap = (v: string): string => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

/** Distinct values by how often they appear (ties keep first-seen order), case-insensitive. */
export function topValues(values: unknown[], n = 3): Array<{ value: string; count: number }> {
  const map = new Map<string, { value: string; count: number }>();
  for (const raw of values) {
    const v = tidy(raw).slice(0, 60);
    if (!v) continue;
    const k = v.toLowerCase();
    const hit = map.get(k);
    if (hit) hit.count++; else map.set(k, { value: v, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, n);
}

const FORMAT_WORDS: Record<string, [string, string]> = {
  post: ['post', 'posts'], carousel: ['carousel', 'carousels'], reel: ['reel', 'reels'], story: ['story', 'stories'], video: ['video', 'videos'],
};

/** "18 posts, 7 reels, 6 carousels". */
export function formatMix(items: ItemLike[]): string {
  return topValues(items.map((i) => tidy(i.format).toLowerCase() || 'post'), 4)
    .map(({ value, count }) => {
      const w = FORMAT_WORDS[value] || [value, value];
      return `${count} ${count === 1 ? w[0] : w[1]}`;
    }).join(', ');
}

export interface PlanInput { key: 'language' | 'business' | 'goals' | 'pillars' | 'products' | 'formats'; label: string; values: string[]; empty: boolean }

export const NOT_SET = 'Not set in this plan';

/** What the plan was built from, as six tiles. A tile with nothing stored says so instead of disappearing. */
export function planInputs(cal: CalLike | null): PlanInput[] {
  if (!cal) return [];
  const items = allItems(cal);
  const one = (key: PlanInput['key'], label: string, values: string[]): PlanInput => {
    const clean = values.map(tidy).filter(Boolean);
    return { key, label, values: clean.length ? clean : [NOT_SET], empty: !clean.length };
  };
  const business = [tidy(cal.businessVertical), tidy(cal.niche)].filter(Boolean);
  const dedupBusiness = business.filter((v, i) => business.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
  return [
    one('language', 'Language', [cap(tidy(cal.language))]),
    one('business', 'Business', dedupBusiness.map(cap)),
    one('goals', 'Goals', topValues(items.map((i) => i.objective)).map((x) => cap(x.value.toLowerCase()))),
    one('pillars', 'Content pillars', topValues(items.map((i) => i.contentPillar)).map((x) => x.value)),
    one('products', 'Products', topValues(items.map((i) => i.productNeeded)).map((x) => x.value)),
    one('formats', 'Formats', items.length ? [formatMix(items)] : []),
  ];
}
