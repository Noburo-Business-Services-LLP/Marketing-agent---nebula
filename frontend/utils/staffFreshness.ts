/** Pure helpers for the "still loading" and "last updated" lines on the heavy staff pages (Home, Clients, Team, Usage). */

/** After this long a page that is still loading says so, instead of spinning silently. */
export const SLOW_AFTER_MS = 8000;
export const SLOW_NOTICE = 'Still loading. This page reads a lot of data and can take a minute.';

export type Freshness = { updatedAt: string; fromCache: boolean; stale?: boolean } | null | undefined;

/** True once a load has been running for the slow-notice time. */
export function isSlow(startedAt: number | null, now: number, afterMs: number = SLOW_AFTER_MS): boolean {
  return typeof startedAt === 'number' && now - startedAt >= afterMs;
}

/**
 * "Last updated 2:14 pm" (today) or "Last updated 17 Oct, 2:14 pm", only when the numbers came from the server's stored copy.
 * An empty string means: say nothing (fresh numbers, or no time to show).
 */
export function lastUpdatedText(freshness: Freshness, now: Date = new Date()): string {
  if (!freshness || freshness.fromCache !== true) return '';
  const at = new Date(freshness.updatedAt);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(/\u202f/g, ' ');
  const sameDay = at.toDateString() === now.toDateString();
  const text = sameDay ? `Last updated ${time}` : `Last updated ${at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
  return freshness.stale ? `${text}. Updating in the background.` : text;
}
