// What your competitors did: pure helpers for the card on My plan and the Competitors page.
export type CompetitorStatus = 'tracking' | 'no_handle' | 'failed' | 'paused' | 'waiting';
export interface CompetitorTrendPoint { weekStart: string; postsInWindow: number; avgLikes: number }
export interface CompetitorRow { id: string; name: string; handle?: string; status: CompetitorStatus; trend: CompetitorTrendPoint[]; lastCheckedAt?: string | null }
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

export function highlightsFor(res?: CompetitorInsightsResponse | null): string[] {
  const list = res && Array.isArray(res.highlights) ? res.highlights : [];
  return list.map((h) => (h && typeof h.text === 'string' ? h.text.trim() : '')).filter(Boolean).slice(0, MAX_HIGHLIGHTS);
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

export function statusText(c: Pick<CompetitorRow, 'status' | 'trend'>): string {
  switch (c.status) {
    case 'no_handle': return 'Add their Instagram handle to track them';
    case 'failed': return 'We could not read this account. Check the handle.';
    case 'paused': return 'Paused after repeated problems. Update the handle to resume.';
    case 'tracking': {
      const first = Array.isArray(c.trend) && c.trend.length ? longDay(c.trend[0].weekStart) : '';
      return first ? `Tracking since ${first}` : 'First results next week';
    }
    default: return 'First results next week';
  }
}

export function trendLabel(trend?: CompetitorTrendPoint[] | null): string {
  if (!Array.isArray(trend) || trend.length === 0) return '';
  return `Posts a week: ${trend.map((t) => t.postsInWindow).join(', ')}`;
}
