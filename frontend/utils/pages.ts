/**
 * The Drafts and Campaigns lists come in pages (newest first, `?cursor=` for the next page, at most 50 a page). A screen
 * that needs everything (the calendar, the classic pages) reads page after page; the Library reads only as many as it
 * shows and offers "Load more". A safety stop keeps a runaway loop from reading forever.
 */
export type PageResult<T> = { items: T[]; nextCursor?: string | null };

export const PAGE_MAX = 50;
export const MAX_PAGES = 40;

export async function collectPages<T>(
  fetchPage: (cursor: string | null, limit: number) => Promise<PageResult<T>>,
  { maxItems = Infinity, maxPages = MAX_PAGES }: { maxItems?: number; maxPages?: number } = {},
): Promise<{ items: T[]; nextCursor: string | null }> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const want = Math.max(1, Math.min(PAGE_MAX, maxItems - items.length));
    const r = await fetchPage(cursor, want);
    const got = Array.isArray(r?.items) ? r.items : [];
    items.push(...got);
    cursor = r?.nextCursor || null;
    if (!cursor || !got.length || items.length >= maxItems) break;
  }
  return { items, nextCursor: cursor };
}

/** `?a=1&b=2` from the parts that are set ('' when none). */
export function queryString(parts: Record<string, string | number | null | undefined>): string {
  const q = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return q.length ? `?${q.join('&')}` : '';
}
