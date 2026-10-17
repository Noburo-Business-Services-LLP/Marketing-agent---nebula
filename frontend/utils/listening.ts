// What people say about you: pure helpers for the card on My plan and the Inbox page.
export type ListeningLabel = 'positive' | 'neutral' | 'negative';
export interface ListeningCounts { positive: number; neutral: number; negative: number }
export interface ListeningQuote { id?: string; label: 'positive' | 'negative'; platform: string; date: string; text: string }
export interface ListeningRecent { id?: string; conversationId?: string; platform: string; date: string; preview: string }
export interface ListeningResponse {
  success?: boolean;
  /** True when the account does not have the Inbox add-on (the server answered 403). */
  locked?: boolean;
  error?: boolean;
  enabled?: boolean;
  state?: 'ready' | 'not_enough' | 'waiting';
  message?: string | null;
  period?: { from: string; to: string };
  asOf?: string;
  total?: number;
  counts?: ListeningCounts;
  percentages?: ListeningCounts;
  trend?: string | null;
  quotes?: ListeningQuote[];
  recentNegative?: ListeningRecent[];
  lastScoredOn?: string | null;
}
export type ListeningCardState = 'locked' | 'not_enough' | 'waiting' | 'ready' | 'error';
export interface BarRow { key: ListeningLabel; label: string; count: number; percent: number; width: number; text: string }

export const TITLE = 'What people say about you';
export const LOAD_ERROR = 'We could not load this card. Please try again.';
/** The calm note for an account without the Inbox add-on. */
export const LOCKED_NOTE = { before: 'Comment insights come with the Inbox add-on. ', link: 'See plans', after: '.' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KEYS: ListeningLabel[] = ['positive', 'neutral', 'negative'];
const LABELS: Record<ListeningLabel, string> = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' };
const MAX_RECENT = 5;
const MIN_WIDTH = 2;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const countsOf = (c?: Partial<ListeningCounts> | null): ListeningCounts => ({ positive: num(c && c.positive), neutral: num(c && c.neutral), negative: num(c && c.negative) });

export function cardState(res?: ListeningResponse | null): ListeningCardState {
  if (res && res.locked) return 'locked';
  if (!res || res.error || res.success === false) return 'error';
  if (res.state === 'not_enough') return 'not_enough';
  if (res.state === 'waiting') return 'waiting';
  if (res.state === 'ready') {
    const c = countsOf(res.counts);
    return c.positive + c.neutral + c.negative > 0 ? 'ready' : 'error';
  }
  return 'error';
}

/** Whole-number shares that add up to 100 (largest remainder). All zero when there is nothing. */
export function percentsOf(counts?: Partial<ListeningCounts> | null): ListeningCounts {
  const c = countsOf(counts);
  const total = c.positive + c.neutral + c.negative;
  const out: ListeningCounts = { positive: 0, neutral: 0, negative: 0 };
  if (total === 0) return out;
  const parts = KEYS.map((k) => { const raw = (c[k] / total) * 100; return { k, floor: Math.floor(raw), rem: raw - Math.floor(raw) }; });
  let left = 100 - parts.reduce((n, p) => n + p.floor, 0);
  parts.slice().sort((a, b) => b.rem - a.rem).forEach((p) => { if (left > 0) { p.floor += 1; left -= 1; } });
  parts.forEach((p) => { out[p.k] = p.floor; });
  return out;
}

/** Bar widths in percent: sum to 100, and a part that exists is at least 2 so it stays visible. */
export function splitBar(counts?: Partial<ListeningCounts> | null): ListeningCounts {
  const c = countsOf(counts);
  const w = percentsOf(c);
  for (const k of KEYS) {
    if (c[k] > 0 && w[k] < MIN_WIDTH) {
      const need = MIN_WIDTH - w[k];
      const donor = KEYS.filter((o) => o !== k).sort((a, b) => w[b] - w[a])[0];
      w[donor] -= need;
      w[k] += need;
    }
  }
  return w;
}

export const commentsText = (n: number): string => `${n} ${n === 1 ? 'comment' : 'comments'}`;

export function barRows(res?: ListeningResponse | null): BarRow[] {
  const c = countsOf(res && res.counts);
  const given = res && res.percentages;
  const sum = given ? KEYS.reduce((n, k) => n + (typeof given[k] === 'number' ? given[k] : NaN), 0) : NaN;
  const pct = given && sum === 100 ? given : percentsOf(c);
  const width = splitBar(c);
  return KEYS.map((k) => ({ key: k, label: LABELS[k], count: c[k], percent: pct[k], width: width[k], text: `${LABELS[k]}: ${commentsText(c[k])}, ${pct[k]}%` }));
}

/** The text alternative for the bar, so nothing depends on colour. */
export function barSummary(res?: ListeningResponse | null): string {
  const parts = barRows(res).map((r) => `${r.label.toLowerCase()} ${r.percent}% (${r.count})`);
  const s = parts.join(', ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

const parts = (day?: string | null): { y: number; m: number; d: number } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(dt.getTime()) || dt.getUTCMonth() !== mo - 1 ? null : { y, m: mo, d };
};

/** '5 March' from 'YYYY-MM-DD' (India calendar day, read as a plain date). Empty when it is not a date. */
export function dayText(day?: string | null): string {
  const p = parts(day);
  return p ? `${p.d} ${MONTHS[p.m - 1]}` : '';
}

/** '20 September to 17 October'; the year is added to both ends only when the range crosses a year. */
export function dateRange(period?: { from?: string; to?: string } | null): string {
  const a = parts(period && period.from); const b = parts(period && period.to);
  if (!a || !b) return '';
  const cross = a.y !== b.y;
  return `${a.d} ${MONTHS[a.m - 1]}${cross ? ` ${a.y}` : ''} to ${b.d} ${MONTHS[b.m - 1]}${cross ? ` ${b.y}` : ''}`;
}

export function basedOn(res?: ListeningResponse | null): string {
  const c = countsOf(res && res.counts);
  const total = num(res && res.total) || c.positive + c.neutral + c.negative;
  const what = total === 1 ? '1 comment or message' : `${total} comments and messages`;
  const range = dateRange(res && res.period);
  return range ? `Based on ${what}, ${range}.` : `Based on ${what}.`;
}

export const notEnoughText = (): string => 'Not enough comments yet to show a score.';
export const waitingText = (): string => 'Your comments are waiting for the next weekly check.';

/** Headline and plain note for the not enough state. Never any numbers. */
export function notEnoughLines(res?: ListeningResponse | null): { headline: string; note: string } {
  const msg = res && typeof res.message === 'string' ? res.message.trim() : '';
  const headline = msg || notEnoughText();
  const note = headline === notEnoughText()
    ? 'A score shows here once enough of your recent comments and messages have been checked.'
    : 'Comments are checked once a week. A score shows here when there are enough of them.';
  return { headline, note };
}

/** 'As of 17 October.' when the weekly check is switched off but an older score is shown. */
export function asOfLine(res?: ListeningResponse | null): string {
  if (!res || res.enabled !== false) return '';
  const d = dayText(res.lastScoredOn);
  return d ? `As of ${d}.` : '';
}

export function platformName(p?: string | null): string {
  const s = String(p || '').trim();
  if (!s) return '';
  const known: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', twitter: 'X', youtube: 'YouTube', threads: 'Threads', tiktok: 'TikTok', gmb: 'Google Business Profile', google: 'Google' };
  return known[s.toLowerCase()] || `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/** 'Positive, Instagram, 14 October'. */
export function quoteLabel(q: Pick<ListeningQuote, 'label' | 'platform' | 'date'>): string {
  const label = q && q.label === 'negative' ? 'Negative' : 'Positive';
  return [label, platformName(q && q.platform), dayText(q && q.date)].filter(Boolean).join(', ');
}

export const quoteText = (q?: Partial<ListeningQuote> | null): string => (q && typeof q.text === 'string' ? q.text.trim() : '');

export function quotesFor(res?: ListeningResponse | null): ListeningQuote[] {
  const list = res && Array.isArray(res.quotes) ? res.quotes : [];
  return list.filter((q) => q && quoteText(q)).slice(0, 3);
}

export interface RecentRow { id: string; href: string; platform: string; date: string; preview: string }
export function recentNegativeRows(res?: ListeningResponse | null): RecentRow[] {
  const list = res && Array.isArray(res.recentNegative) ? res.recentNegative : [];
  return list.filter((r) => r && typeof r.preview === 'string' && r.preview.trim()).slice(0, MAX_RECENT).map((r, i) => ({
    id: r.id || `${r.conversationId || 'row'}-${i}`,
    href: r.conversationId ? `/inbox?conversation=${encodeURIComponent(r.conversationId)}` : '/inbox',
    platform: r.platform,
    date: r.date,
    preview: r.preview.trim(),
  }));
}

export function recentLinkLabel(r: { platform?: string; date?: string }): string {
  const p = platformName(r && r.platform);
  const d = dayText(r && r.date);
  return `Open the conversation${p ? ` on ${p}` : ''}${d ? ` from ${d}` : ''}`;
}
