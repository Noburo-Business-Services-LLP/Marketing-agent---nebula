/**
 * Order for looking through finished posts. The posts of one campaign are shown together and in the order they
 * were planned (the story: teaser, offer, reminder...), not newest first. Anything else keeps its place.
 */
export interface OrderedDraft<T> {
  draft: T;
  /** set for the posts of a campaign run, or for posts that share a theme */
  group?: { name: string; size: number; position: number; kind: 'campaign' | 'theme' };
}

const RUN_WINDOW_MS = 20 * 60 * 1000;
const time = (d: any): number => { const t = new Date(d && (d.createdAt || d.updatedAt) || 0).getTime(); return Number.isFinite(t) ? t : 0; };
const nameOf = (d: any): string => { const m = /^(.*) - Post \d+$/.exec(String((d && d.title) || '')); return m ? m[1].trim() : ''; };
const indexOf = (d: any): number | null => { const i = d && d.generationProgress && d.generationProgress.index; return typeof i === 'number' ? i : null; };
const themeOf = (d: any): string => String((d && d.theme) || '').replace(/\s+/g, ' ').trim();
const isCampaignPost = (d: any): boolean => (d && (d.sourceType === 'campaign' || d.contentType === 'campaign')) && indexOf(d) !== null;

export function orderForViewing<T extends Record<string, any>>(drafts: T[]): Array<OrderedDraft<T>> {
  const sorted = [...drafts].sort((a, b) => time(b) - time(a));
  type Group = { key: string; newest: number; items: T[]; kind: 'campaign' | 'theme' | 'single'; label: string };
  const out: Group[] = [];
  for (const d of sorted) {
    if (isCampaignPost(d)) {
      const name = nameOf(d);
      const total = d.generationProgress && d.generationProgress.total;
      const run = out.find((g) => g.kind === 'campaign' && g.key === `${name}|${total}` && Math.abs(g.newest - time(d)) < RUN_WINDOW_MS && !g.items.some((x) => indexOf(x) === indexOf(d)));
      if (run) { run.items.push(d); continue; }
      out.push({ key: `${name}|${total}`, newest: time(d), items: [d], kind: 'campaign', label: name || 'Campaign' });
      continue;
    }
    const theme = themeOf(d);
    if (theme) {
      const key = `theme|${theme.toLowerCase()}`;
      const same = out.find((g) => g.kind === 'theme' && g.key === key);
      if (same) { same.items.push(d); continue; }
      out.push({ key, newest: time(d), items: [d], kind: 'theme', label: theme });
      continue;
    }
    out.push({ key: String(d._id || Math.random()), newest: time(d), items: [d], kind: 'single', label: '' });
  }
  const flat: Array<OrderedDraft<T>> = [];
  for (const g of out) {
    if (g.kind === 'single') { flat.push({ draft: g.items[0] }); continue; }
    // A campaign in its planned story order; a theme in the order the posts were made.
    const items = g.kind === 'campaign'
      ? [...g.items].sort((a, b) => (indexOf(a) as number) - (indexOf(b) as number))
      : [...g.items].sort((a, b) => time(a) - time(b));
    if (g.kind === 'theme' && items.length === 1) { flat.push({ draft: items[0], group: { name: g.label, size: 1, position: 1, kind: 'theme' } }); continue; }
    items.forEach((d, i) => flat.push({ draft: d, group: { name: g.label, size: items.length, position: i + 1, kind: g.kind as 'campaign' | 'theme' } }));
  }
  return flat;
}
