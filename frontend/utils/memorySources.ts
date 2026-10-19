/**
 * What Nebulaa learned, by source (pages/AIMemory.tsx). Pure helpers for the answer of GET /api/ai-memory/learned
 * (backend/services/brandMemory/runner.js buildView). Nothing here makes up an item: the page shows the stored items
 * with their stored evidence and confidence words. Tested in tests/memorySources.test.mjs.
 */

export type SourceKey = 'plan' | 'blueprint' | 'customers' | 'products' | 'results' | 'competitors';
export type Confidence = 'strong' | 'good' | 'early';
export type SourceState = 'learned' | 'not_enough' | 'none' | 'not_on_plan' | 'error';

export interface LearnedItem {
  id: string;
  type: 'item' | 'note';
  kind?: string;
  text: string;
  evidenceText?: string;
  evidenceCount?: number;
  confidence?: Confidence | string;
  learnedAt?: string | null;
  updatedAt?: string | null;
  userEdited?: boolean;
}

export interface SourceBlock {
  key: SourceKey;
  label: string;
  title: string;
  state: SourceState | string;
  reason: string;
  evidenceCount: number;
  evidenceUnit: string;
  checkedAt: string | null;
  items: LearnedItem[];
}

export interface LearnedView {
  sources: SourceBlock[];
  refreshedAt: string | null;
  itemCount: number;
  cooldown: { until: string; seconds: number } | null;
  cooldownMinutes?: number;
  tracked?: number;
  staff?: boolean;
  staffReason?: string;
}

export const SOURCE_ORDER: SourceKey[] = ['plan', 'blueprint', 'customers', 'products', 'results', 'competitors'];

export interface SourceInfo { chip: string; title: string; line: string; tone: 'gold' | 'coral' | 'teal' | 'sage' | 'lilac' | 'sand'; action: { label: string; to: string } }

/** Chip words, tile titles and the place to add more, per source. */
export const SOURCE_INFO: Record<SourceKey, SourceInfo> = {
  plan: { chip: 'Your plan', title: 'Learned from your plan', line: 'Themes, position and where to show up', tone: 'gold', action: { label: 'Open My plan', to: '/plan' } },
  blueprint: { chip: 'Your Blueprint', title: 'Learned from your Blueprint', line: 'What your Growth Blueprint suggests', tone: 'lilac', action: { label: 'Make a Blueprint', to: '/blueprint/new' } },
  customers: { chip: 'Your customers', title: 'Learned about your customers', line: 'Who buys, what worries them, your market', tone: 'teal', action: { label: 'Open Settings', to: '/settings' } },
  products: { chip: 'Your products', title: 'Learned from your products', line: 'What you sell and what it costs', tone: 'sage', action: { label: 'Add products', to: '/brand-assets?tab=products' } },
  results: { chip: 'Your results', title: 'Learned from your results', line: 'How your published posts did', tone: 'coral', action: { label: 'Open Performance', to: '/analytics?tab=performance' } },
  competitors: { chip: 'Your competitors', title: 'Learned from your competitors', line: 'What works in your market', tone: 'sand', action: { label: 'Open Competitors', to: '/analytics?tab=competitors' } },
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = { strong: 'Strong', good: 'Good', early: 'Early' };
export const confidenceOf = (c: unknown): Confidence => (c === 'strong' || c === 'good' || c === 'early' ? c : 'early');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const asDate = (v: unknown): Date | null => { if (!v) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };

/** "today", "yesterday", "3 days ago", else "12 October" (India time). */
export function whenWords(iso: unknown, now: Date = new Date()): string {
  const d = asDate(iso);
  if (!d) return '';
  const ist = (x: Date) => new Date(x.getTime() + 330 * 60000);
  const day = (x: Date) => Math.floor(ist(x).getTime() / 864e5);
  const diff = day(now) - day(d);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff} days ago`;
  const x = ist(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}

/** "Refresh again in 7 minutes" while the cooldown runs, else ''. */
export function cooldownWords(seconds: unknown): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!s) return '';
  const m = Math.max(1, Math.ceil(s / 60));
  return `Refresh again in ${m} ${m === 1 ? 'minute' : 'minutes'}`;
}

/** The sources in page order (a missing one shows as not looked at yet). */
export function sourcesInOrder(view: Partial<LearnedView> | null | undefined): SourceBlock[] {
  const list = Array.isArray(view?.sources) ? view!.sources : [];
  return SOURCE_ORDER.map((key) => list.find((s) => s && s.key === key) || {
    key, label: SOURCE_INFO[key].chip.toLowerCase(), title: SOURCE_INFO[key].title, state: 'none',
    reason: 'Nebulaa has not looked at this yet.', evidenceCount: 0, evidenceUnit: '', checkedAt: null, items: [],
  });
}

/** Hero numbers: items learned and how many of the six sources gave something. */
export function heroCounts(view: Partial<LearnedView> | null | undefined): { items: number; sources: number; total: number } {
  const s = sourcesInOrder(view);
  return { items: s.reduce((n, b) => n + b.items.length, 0), sources: s.filter((b) => b.items.length > 0).length, total: s.length };
}

/** The chip under the hero: "3 learned", "Not enough yet", "Not on your plan", "Not yet", "Could not check". */
export function chipStatus(block: SourceBlock): string {
  if (block.items.length) return `${block.items.length} learned`;
  if (block.state === 'not_enough') return 'Not enough yet';
  if (block.state === 'not_on_plan') return 'Not on your plan';
  if (block.state === 'error') return 'Could not check';
  return 'Not yet';
}

/** The line under a tile title: what backs it and when it was last looked at. */
export function sourceLine(block: SourceBlock, now: Date = new Date()): string {
  const when = whenWords(block.checkedAt, now);
  const n = Math.max(0, Math.floor(Number(block.evidenceCount) || 0));
  const unit = String(block.evidenceUnit || '');
  const what = n && unit ? `From ${n} ${n === 1 ? unit.replace(/s$/, '') : unit}` : '';
  return [what, when ? `checked ${when}` : ''].filter(Boolean).join(', ').replace(/^checked/, 'Checked');
}

/** One item's footer: "Strong, from 14 posts, learned 3 days ago" (edited items say so). */
export function itemFoot(item: LearnedItem, now: Date = new Date()): string {
  const parts = [item.evidenceText || ''];
  const when = whenWords(item.learnedAt, now);
  if (when) parts.push(`learned ${when}`);
  if (item.userEdited) parts.push('your words');
  return parts.filter(Boolean).join(', ');
}

export const MAX_SHOWN = 2;
/** The items a tile shows before "Show all": strongest first, at most MAX_SHOWN unless opened. */
export function shownItems(items: LearnedItem[], open: boolean): { list: LearnedItem[]; hidden: number } {
  const rank: Record<Confidence, number> = { strong: 0, good: 1, early: 2 };
  const sorted = (Array.isArray(items) ? items : []).slice().sort((a, b) => rank[confidenceOf(a.confidence)] - rank[confidenceOf(b.confidence)]);
  if (open || sorted.length <= MAX_SHOWN) return { list: sorted, hidden: 0 };
  return { list: sorted.slice(0, MAX_SHOWN), hidden: sorted.length - MAX_SHOWN };
}
