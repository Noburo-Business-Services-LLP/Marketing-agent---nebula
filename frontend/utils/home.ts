/** Small data helpers for the Home page. The numbers, actions and week come from GET /api/home/summary
 *  (see docs/superpowers/ops/home-summary.md); nothing here invents a figure. All times are India time. */
import type { HomeSummary } from '../types';
import { istDay, compareTimeOfDay } from './week.ts';

/** Is this answer shaped like a Home summary? Anything else (an old server, a proxy page) is treated as "no answer". */
export function isHomeSummary(v: unknown): v is HomeSummary {
  const o = v as Record<string, any> | null;
  return !!o && typeof o === 'object' && !!o.numbers && typeof o.numbers === 'object' && !!o.week && typeof o.week === 'object'
    && !!o.week.posts && !!o.connected && !!o.numbers.postsPublishedThisWeek && !!o.numbers.draftsWaiting;
}

export const CACHE_MS = 60 * 1000;
const KEY_PREFIX = 'nb.home.summary:';
const MAX_ROWS = 6;
const PLATFORM_CODES: Record<string, string> = { instagram: 'IG', facebook: 'FB', linkedin: 'LI', twitter: 'X', x: 'X', youtube: 'YT', pinterest: 'PI', gmb: 'GB' };
const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** "9:00 AM" for an instant, in India time (not the browser's timezone). Empty when it is not a date. */
export function timeLabel(at: unknown): string {
  const t = at ? new Date(at as string).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  const minutes = Math.floor((((t + 330 * 60000) % 86400000) + 86400000) % 86400000 / 60000);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h24 % 12 || 12}:${String(m).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

export interface TodayRow { id: string; time: string; at: number | null; title: string; subtitle: string; image: string | null; status: string }

/** Today's posts, earliest first. "10:00 AM" comes after "9:00 AM" because the real time is compared, never the text. */
export function todayRows(items: unknown): TodayRow[] {
  const list = Array.isArray(items) ? items : [];
  const rows: TodayRow[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const ms = r.at ? new Date(r.at as string).getTime() : NaN;
    rows.push({
      id: String(r.id ?? rows.length),
      time: Number.isFinite(ms) ? timeLabel(r.at) : (typeof r.time === 'string' ? r.time : ''),
      at: Number.isFinite(ms) ? ms : null,
      title: String(r.title || 'Untitled post'),
      subtitle: String(r.subtitle || ''),
      image: typeof r.image === 'string' && r.image ? r.image : null,
      status: String(r.status || 'scheduled')
    });
  }
  // Array.prototype.sort is stable, so posts at the same minute keep the server's order.
  return rows.sort((a, b) => {
    if (a.at !== null && b.at !== null) return a.at - b.at;
    return compareTimeOfDay(a.time, b.time);
  }).slice(0, MAX_ROWS);
}

// ---- the last summary, kept for a minute so Home opens at once and refreshes quietly (stale while revalidate) ----
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export const summaryKey = (userId: string): string => `${KEY_PREFIX}${userId}`;
const defaultStore = (): Store | undefined => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined; } catch { return undefined; } };

export function readCachedSummary(userId: string, now: number = Date.now(), store: Store | undefined = defaultStore()): HomeSummary | null {
  if (!userId || !store) return null;
  try {
    const raw = store.getItem(summaryKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.at !== 'number' || now - parsed.at > CACHE_MS || !isHomeSummary(parsed.data)) return null;
    return parsed.data as HomeSummary;
  } catch { return null; }
}

export function writeCachedSummary(userId: string, data: HomeSummary, now: number = Date.now(), store: Store | undefined = defaultStore()): void {
  if (!userId || !store) return;
  try { store.setItem(summaryKey(userId), JSON.stringify({ at: now, data })); } catch { /* storage can be blocked: Home works without it */ }
}

// ---- plain sentences from the summary ----
export function weekPostsLine(posts: { planned: number | null; made: number | null; published: number | null; scheduled: number | null } | null | undefined): string {
  if (!posts || typeof posts.published !== 'number') return '';
  const parts = [`${posts.published} published so far`];
  if (typeof posts.scheduled === 'number' && posts.scheduled > 0) parts.push(`${posts.scheduled} scheduled`);
  return parts.join(', ');
}

export function platformsLine(platforms: string[] | null | undefined): string {
  const list = Array.isArray(platforms) ? platforms.filter(Boolean) : [];
  return list.length ? `Connected: ${list.join(', ')}` : 'No accounts are connected yet.';
}

export interface StackCard { img: string; tag: string }
/** The artwork stack: the customer's own recent posts only. Nothing when they have none (never a stock photo). */
export function stackCards(recent: HomeSummary['recent'] | null | undefined, now?: Date): StackCard[] {
  const list = Array.isArray(recent) ? recent : [];
  return list.filter((r) => r && typeof r.image === 'string' && r.image).slice(0, 4).map((r) => {
    const name = r.platform ? String(r.platform).toLowerCase() : '';
    const platform = name ? (PLATFORM_CODES[name] || name.slice(0, 2).toUpperCase()) : '';
    let label = '';
    if (now && r.when) {
      const when = new Date(r.when);
      if (Number.isFinite(when.getTime())) {
        const diff = Math.round((istDay(when).startsAt.getTime() - istDay(now).startsAt.getTime()) / 86400000);
        label = diff === 0 ? 'TODAY' : diff === 1 ? 'TOMORROW' : DAY_LABELS[new Date(when.getTime() + 330 * 60000).getUTCDay()];
      }
    }
    return { img: r.image, tag: [platform, label].filter(Boolean).join(' · ') };
  });
}
