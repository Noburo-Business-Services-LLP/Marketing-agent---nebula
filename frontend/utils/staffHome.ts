/** Pure helpers for the staff Home screen: wording for changes, shaping the 30-day series, ordering clients. */

export type Change = { text: string; dir: 'up' | 'down' | 'flat' | 'new' };

/** `change` is the server's whole-number percentage against the period before, or null when there was nothing before. */
export function formatChange(change: number | null | undefined, _before?: number): Change {
  if (change === null || change === undefined || !Number.isFinite(change)) return { text: 'nothing to compare with yet', dir: 'new' };
  if (change === 0) return { text: 'same as the period before', dir: 'flat' };
  return change > 0
    ? { text: `up ${change}% on the period before`, dir: 'up' }
    : { text: `down ${Math.abs(change)}% on the period before`, dir: 'down' };
}

export type SeriesDay = { day: string; label: string; signups: number; active: number };
export type ShapedSeries = { days: SeriesDay[]; totalSignups: number; maxSignups: number; maxActive: number; hasData: boolean };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function count(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  if (!m) return day || '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`.trim();
}

/** Sorts by day, turns anything that is not a count into zero, and reports the totals the chart needs. */
export function shapeSeries(series: Array<{ day: string; signups?: unknown; active?: unknown }> | null | undefined): ShapedSeries {
  const days = (Array.isArray(series) ? series : [])
    .filter((r) => r && typeof r.day === 'string')
    .map((r) => ({ day: r.day, label: dayLabel(r.day), signups: count(r.signups), active: count(r.active) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const totalSignups = days.reduce((s, d) => s + d.signups, 0);
  const maxSignups = days.reduce((m, d) => Math.max(m, d.signups), 0);
  const maxActive = days.reduce((m, d) => Math.max(m, d.active), 0);
  return { days, totalSignups, maxSignups, maxActive, hasData: totalSignups > 0 || maxActive > 0 };
}

/** A round top for the chart scale (never zero), so the axis labels are tidy numbers. */
export function niceMax(n: number): number {
  const v = Number.isFinite(n) && n > 0 ? n : 0;
  if (v <= 4) return 4;
  if (v <= 8) return 8;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [1, 1.5, 2, 3, 5, 10].map((f) => f * pow).find((c) => c >= v);
  return step || 10 * pow;
}

/** One sentence describing the chart for people who cannot see it. */
export function seriesSummary(s: ShapedSeries): string {
  if (!s.hasData || s.days.length === 0) return 'No sign-up or activity data yet.';
  const first = s.days[0].label;
  const last = s.days[s.days.length - 1].label;
  return `${s.totalSignups} sign-ups over ${s.days.length} days, from ${first} to ${last}. Most clients active in one day: ${s.maxActive}.`;
}

const URGENCY: Record<string, number> = { failed_posts: 5, quarks_low: 4, drafts_waiting: 3, inactive: 2, no_social: 2, onboarding_unfinished: 1 };

export type AttentionItem = { id: string; quarks: number; reasons: string[]; [k: string]: any };

function urgency(i: AttentionItem): number {
  const base = (i.reasons || []).reduce((s, r) => s + (URGENCY[r] || 0), 0);
  return base + (i.reasons && i.reasons.includes('quarks_low') && Number(i.quarks) <= 0 ? 3 : 0);
}

/** Most urgent first, fewest Quarks next, otherwise the order the server gave. Same rule as the server; never changes the input. */
export function orderAttention<T extends AttentionItem>(items: T[] | null | undefined): T[] {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => urgency(b.item) - urgency(a.item) || (Number(a.item.quarks) || 0) - (Number(b.item.quarks) || 0) || a.index - b.index)
    .map((x) => x.item);
}

export const STATUS_TEXT: Record<string, string> = { green: 'Working', amber: 'Watch', red: 'Needs action' };

export function healthSummary(cards: Array<{ status: string }> | null | undefined) {
  const list = Array.isArray(cards) ? cards : [];
  const green = list.filter((c) => c.status === 'green').length;
  const amber = list.filter((c) => c.status === 'amber').length;
  const red = list.filter((c) => c.status === 'red').length;
  let text = 'No health data yet';
  if (list.length > 0) {
    const parts: string[] = [];
    if (red) parts.push(`${red} needs action`);
    if (amber) parts.push(`${amber} to watch`);
    text = parts.length ? `${parts.join(', ')}, ${green} working` : 'Everything is working';
  }
  return { green, amber, red, text };
}

export function sinceLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `Counted since the server last restarted, ${d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`;
}

type Who = { staffRole?: string | null; isCsm?: boolean } | null | undefined;

/** Where someone goes after signing in. `acting` is true while a staff member is inside a client's account. */
export function landingPath(user: Who, acting: boolean): string {
  if (acting || !user) return '/dashboard';
  if (user.staffRole === 'owner' || user.staffRole === 'admin') return '/staff/home';
  if (user.isCsm || user.staffRole === 'csm') return '/clients';
  return '/dashboard';
}

/** The main-menu link to the staff area: first in the menu for Owner and Admin, further down for a CSM. */
export function staffMenuEntry(user: Who, acting: boolean): { path: string; label: string; primary: boolean } | null {
  if (acting || !user) return null;
  if (user.staffRole === 'owner' || user.staffRole === 'admin') return { path: '/staff/home', label: 'Staff home', primary: true };
  if (user.staffRole === 'csm' || user.isCsm) return { path: '/staff', label: 'Staff area', primary: false };
  return null;
}
