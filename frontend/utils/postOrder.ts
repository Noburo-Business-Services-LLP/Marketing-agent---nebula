/**
 * Order for looking through finished posts. The posts of one campaign are shown together and in the order they
 * were planned (the story: teaser, offer, reminder...), not newest first. Anything else keeps its place.
 */
export interface OrderedDraft<T> {
  draft: T;
  /** set for the posts of a campaign run */
  group?: { name: string; size: number; position: number };
}

const RUN_WINDOW_MS = 20 * 60 * 1000;
const time = (d: any): number => { const t = new Date(d && (d.createdAt || d.updatedAt) || 0).getTime(); return Number.isFinite(t) ? t : 0; };
const nameOf = (d: any): string => { const m = /^(.*) - Post \d+$/.exec(String((d && d.title) || '')); return m ? m[1].trim() : ''; };
const indexOf = (d: any): number | null => { const i = d && d.generationProgress && d.generationProgress.index; return typeof i === 'number' ? i : null; };
const isCampaignPost = (d: any): boolean => (d && (d.sourceType === 'campaign' || d.contentType === 'campaign')) && indexOf(d) !== null;

export function orderForViewing<T extends Record<string, any>>(drafts: T[]): Array<OrderedDraft<T>> {
  const sorted = [...drafts].sort((a, b) => time(b) - time(a));
  const out: Array<{ key: string; newest: number; items: T[]; campaign: boolean }> = [];
  for (const d of sorted) {
    if (isCampaignPost(d)) {
      const name = nameOf(d);
      const total = d.generationProgress && d.generationProgress.total;
      const run = out.find((g) => g.campaign && g.key === `${name}|${total}` && Math.abs(g.newest - time(d)) < RUN_WINDOW_MS && !g.items.some((x) => indexOf(x) === indexOf(d)));
      if (run) { run.items.push(d); continue; }
      out.push({ key: `${name}|${total}`, newest: time(d), items: [d], campaign: true });
    } else {
      out.push({ key: String(d._id || Math.random()), newest: time(d), items: [d], campaign: false });
    }
  }
  const flat: Array<OrderedDraft<T>> = [];
  for (const g of out) {
    if (!g.campaign) { flat.push({ draft: g.items[0] }); continue; }
    const items = [...g.items].sort((a, b) => (indexOf(a) as number) - (indexOf(b) as number));
    const name = nameOf(items[0]) || 'Campaign';
    items.forEach((d, i) => flat.push({ draft: d, group: { name, size: items.length, position: i + 1 } }));
  }
  return flat;
}
