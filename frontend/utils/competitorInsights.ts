// What your competitors did: pure helpers for the card on My plan and the Competitors page.
export type CompetitorStatus = 'tracking' | 'no_handle' | 'unconfirmed' | 'failed' | 'paused' | 'waiting';
export type HandleStatus = 'suggested' | 'verified' | 'confirmed';
export type HandleAction = 'confirm' | 'edit';
export interface CompetitorTrendPoint { weekStart: string; postsInWindow: number; avgLikes: number }
export interface CompetitorRow {
  id: string; name: string; handle?: string; handleStatus?: HandleStatus; status: CompetitorStatus; trend: CompetitorTrendPoint[]; lastCheckedAt?: string | null;
  /** Week (Monday, YYYY-MM-DD) of the newest good snapshot. */
  weekOf?: string | null;
  /** False: do not say "this week"; say when it was last checked. */
  isCurrentWeek?: boolean;
  /** Set only when it is exactly the week before weekOf. */
  previousWeekOf?: string | null;
  lastCheckedOn?: string | null;
  /** Followers from the newest good reading; change only when the reading before is exactly the week before. */
  followers?: { value: number; change: number | null } | null;
  avatarUrl?: string | null;
}
export interface CompetitorHighlight { competitorId?: string; name?: string; text: string }
export interface CompetitorInsightsResponse {
  success?: boolean;
  /** True when the account does not have the competitor insights add-on (the server answered 403). */
  locked?: boolean;
  weekStart?: string;
  highlights?: CompetitorHighlight[];
  competitors?: CompetitorRow[];
  error?: boolean;
  message?: string;
}
export type CompetitorCardState = 'locked' | 'none' | 'started' | 'ready' | 'error';

const MAX_HIGHLIGHTS = 3;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DAY_MS = 24 * 60 * 60 * 1000;
const weekMs = (w?: string | null): number => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(w || '')); return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN; };
const isNextWeek = (prev?: string | null, next?: string | null): boolean => { const a = weekMs(prev); const b = weekMs(next); return Number.isFinite(a) && Number.isFinite(b) && b - a === 7 * DAY_MS; };

/** A week over week claim is allowed only when the response says the previous snapshot is the week before this one. */
export function weekOverWeekOk(c?: Pick<CompetitorRow, 'isCurrentWeek' | 'weekOf' | 'previousWeekOf'> | null): boolean {
  return !!c && c.isCurrentWeek === true && !!c.previousWeekOf && isNextWeek(c.previousWeekOf, c.weekOf);
}

const COMPARES = /\b(up|down) from\b|\blast week\b|\bgained\b|\blost\b/i;

export function highlightsFor(res?: CompetitorInsightsResponse | null): string[] {
  const list = res && Array.isArray(res.highlights) ? res.highlights : [];
  const rows = res && Array.isArray(res.competitors) ? res.competitors : [];
  const keep = (h: CompetitorHighlight): boolean => {
    const row = h && h.competitorId !== undefined ? rows.find((r) => r && r.id === h.competitorId) : undefined;
    if (!row) return true;
    if (row.isCurrentWeek === false) return false;
    if ('previousWeekOf' in row && !row.previousWeekOf && COMPARES.test(h.text || '')) return false;
    return true;
  };
  return list.filter(keep).map((h) => (h && typeof h.text === 'string' ? h.text.trim() : '')).filter(Boolean).slice(0, MAX_HIGHLIGHTS);
}

export function cardState(res?: CompetitorInsightsResponse | null): CompetitorCardState {
  if (res && res.locked) return 'locked';
  if (!res || res.error || res.success === false) return 'error';
  if (!Array.isArray(res.competitors) || res.competitors.length === 0) return 'none';
  return highlightsFor(res).length > 0 ? 'ready' : 'started';
}

/** 'Monday 12 October' from a 'YYYY-MM-DD' week start (read as a plain date, no time zone shift). */
function longDay(weekStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(weekStart || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return '';
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** '9 September' from 'YYYY-MM-DD' (read as a plain date). Empty when it is not a date. */
function shortDay(day?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? '' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

type StatusLike = Pick<CompetitorRow, 'status' | 'trend'> & Partial<Pick<CompetitorRow, 'isCurrentWeek' | 'lastCheckedOn'>>;

/** "Last checked on 9 September" when the newest numbers are not from this week. */
export function lastCheckedLine(c: Partial<Pick<CompetitorRow, 'isCurrentWeek' | 'lastCheckedOn'>>): string {
  if (!c || c.isCurrentWeek !== false) return '';
  const day = shortDay(c.lastCheckedOn);
  return day ? `Last checked on ${day}` : '';
}

export function statusText(c: StatusLike): string {
  switch (c.status) {
    case 'no_handle': return 'Add their Instagram handle to track them';
    case 'unconfirmed': return 'We found this handle. Confirm it so we can track them.';
    case 'failed': return 'We could not read this account. Check the handle.';
    case 'paused': return 'Paused after repeated problems. Edit the handle to resume.';
    case 'tracking': {
      if (c.isCurrentWeek === false) return lastCheckedLine(c) || 'Checked again next week';
      const n = Array.isArray(c.trend) ? c.trend.length : 0;
      if (n >= 4) return 'Tracked for at least 4 weeks';
      const first = n ? longDay(c.trend[0].weekStart) : '';
      return first ? `Tracking since ${first}` : 'First results next week';
    }
    default: return 'First results next week';
  }
}

/** The newest run of weeks that follow each other. Weeks that were skipped are not joined to later ones. */
export function consecutiveTrend(trend?: CompetitorTrendPoint[] | null): CompetitorTrendPoint[] {
  if (!Array.isArray(trend) || trend.length === 0) return [];
  if (trend.some((t) => !Number.isFinite(weekMs(t && t.weekStart)))) return trend;
  let start = trend.length - 1;
  while (start > 0 && isNextWeek(trend[start - 1].weekStart, trend[start].weekStart)) start--;
  return trend.slice(start);
}

export function trendLabel(trend?: CompetitorTrendPoint[] | null): string {
  const run = consecutiveTrend(trend);
  if (run.length === 0) return '';
  return `Posts a week: ${run.map((t) => t.postsInWindow).join(', ')}`;
}

/** Which small handle control a competitor row gets. */
export function handleAction(c?: Pick<CompetitorRow, 'status'> | null): HandleAction | null {
  if (!c) return null;
  if (c.status === 'unconfirmed') return 'confirm';
  if (c.status === 'no_handle' || c.status === 'paused' || c.status === 'failed') return 'edit';
  return null;
}
export const handleActionLabel = (a: HandleAction): string => (a === 'confirm' ? 'Confirm handle' : 'Edit handle');

/** The Competitors page list only knows the handle and its state. */
export function listHandleAction(c?: { handle?: string | null; handleStatus?: HandleStatus | string | null } | null): HandleAction {
  return c && c.handle && c.handleStatus === 'suggested' ? 'confirm' : 'edit';
}

/** Same rule as the server: letters, digits, dots and underscores, 1 to 30, no @ and no link. */
export function validateHandle(input: unknown): { ok: true; handle: string } | { ok: false; message: string } {
  const v = typeof input === 'string' ? input.trim() : '';
  if (!v) return { ok: false, message: 'Enter their Instagram handle.' };
  if (/[@/:]/.test(v) || /^www\./i.test(v)) return { ok: false, message: 'Enter the handle only, without @ or a link. For example: sweetco.' };
  if (!/^[A-Za-z0-9._]+$/.test(v)) return { ok: false, message: 'Use letters, numbers, dots and underscores only.' };
  if (v.length > 30) return { ok: false, message: 'A handle has 30 characters at most.' };
  return { ok: true, handle: v };
}

export const handleSavedNote = (c: { name?: string; handle: string }): string => `Saved. We will check @${c.handle} in the next weekly check.`;

/** The link to the Competitors page says what is needed only when a competitor actually needs it. */
export function linkLabel(competitors?: Pick<CompetitorRow, 'status'>[] | null): string {
  const list = Array.isArray(competitors) ? competitors : [];
  if (list.some((c) => c && (c.status === 'no_handle' || c.status === 'failed' || c.status === 'paused'))) return 'Open Competitors to fix handles';
  if (list.some((c) => c && c.status === 'unconfirmed')) return 'Open Competitors to confirm handles';
  return 'Open Competitors';
}

/** The calm note on the Competitors page for an account without the add-on. */
export const LOCKED_NOTE = { before: 'Tracking competitors is an add-on. ', link: 'See plans', after: ' to add it.' };

/** Copy for the shared upgrade prompt on the Competitors page. Never names Quarks, trials or credit. */
export function competitorsUpgradeCopy(reason: 'upgrade' | 'addon' | 'quarks'): { message: string; actionLabel: string } {
  if (reason === 'quarks') return { message: 'You have used everything your plan includes for now. See plans to continue.', actionLabel: 'See plans' };
  if (reason === 'upgrade') return { message: 'Tracking competitors is not included in your current plan. See plans to change it.', actionLabel: 'See plans' };
  return { message: 'Tracking competitors is an add-on. See plans to add it.', actionLabel: 'See plans' };
}

export interface WeekBar { weekStart: string; posts: number; height: number; label: string; current: boolean }
/**
 * The small bar line of posts per week, one bar per stored week (up to four, oldest first), each labelled with its week.
 * Heights are shares of the largest week (a week with posts is at least 12 so it stays visible; 0 posts is a flat stub).
 */
export function weekBars(trend?: CompetitorTrendPoint[] | null, currentWeek?: string | null): WeekBar[] {
  const list = (Array.isArray(trend) ? trend : []).filter((t) => t && Number.isFinite(weekMs(t.weekStart))).slice(-4);
  const max = Math.max(0, ...list.map((t) => (Number.isFinite(t.postsInWindow) ? t.postsInWindow : 0)));
  return list.map((t) => {
    const n = Number.isFinite(t.postsInWindow) && t.postsInWindow > 0 ? Math.round(t.postsInWindow) : 0;
    const day = shortDay(t.weekStart);
    return {
      weekStart: t.weekStart, posts: n, height: n === 0 || max === 0 ? 0 : Math.max(12, Math.round((n / max) * 100)),
      label: `Week of ${day}: ${n === 1 ? '1 post' : `${n} posts`}`, current: !!currentWeek && t.weekStart === currentWeek,
    };
  });
}

/** One sentence for the whole bar line, so nothing depends on seeing it. */
export function weekBarsSummary(bars: WeekBar[]): string {
  return bars.length ? `Posts a week: ${bars.map((b) => b.label.replace(/^Week of /, '')).join('; ')}.` : '';
}
