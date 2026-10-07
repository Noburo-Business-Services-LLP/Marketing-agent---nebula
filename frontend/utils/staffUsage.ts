/** Pure helpers for the staff Usage page: wording, bar sizes and text summaries of the charts. */

export const WINDOWS = [{ days: 30, label: 'Last 30 days' }, { days: 90, label: 'Last 90 days' }] as const;

export type FeatureItem = { key: string; label: string; definition?: string; available: boolean; reason?: string; count?: number; clients?: number };
export type FunnelStep = { key: string; label: string; definition?: string; available: boolean; reason?: string; count?: number; reached?: number; fromPrevious?: number | null; fromStart?: number | null };
export type QuarkCategory = { key: string; label: string; quarks: number; percent: number | null };

export function percentText(p: number | null | undefined): string {
  return typeof p === 'number' && Number.isFinite(p) ? `${Math.round(p)}%` : '—';
}

/** Width of a bar as a whole percent of the largest value. A real value always shows at least a sliver. */
export function barPercent(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(100, Math.max(1, Math.round((value / max) * 100)));
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function funnelSummary(steps: FunnelStep[] | null | undefined, days: number): string {
  const list = Array.isArray(steps) ? steps : [];
  const first = list[0];
  if (!first || !first.available || !first.count) return `No clients signed up in the last ${days} days.`;
  const parts: string[] = []; const missing: string[] = [];
  let worst: { from: string; to: string; lost: number } | null = null;
  for (let i = 1; i < list.length; i++) {
    const s = list[i];
    if (!s.available) { missing.push(s.label); continue; }
    parts.push(`${s.count} ${s.label.charAt(0).toLowerCase()}${s.label.slice(1)}`);
    const prev = list[i - 1];
    if (prev.available) {
      const lost = (prev.count || 0) - (s.count || 0);
      if (lost > 0 && (!worst || lost > worst.lost)) worst = { from: prev.label, to: s.label, lost };
    }
  }
  let text = `Of ${first.count} ${plural(first.count, 'client', 'clients')} who signed up in the last ${days} days${parts.length ? `, ${parts.join(', ')}` : ''}.`;
  if (worst) text += ` Biggest drop: from ${worst.from} to ${worst.to}, ${worst.lost} ${plural(worst.lost, 'client', 'clients')} fewer.`;
  missing.forEach((m) => { text += ` ${m} could not be counted.`; });
  return text;
}

export function shapeFeatures(items: FeatureItem[] | null | undefined) {
  const rows = Array.isArray(items) ? items.filter((i) => i && typeof i.key === 'string') : [];
  const max = rows.reduce((m, r) => (r.available && (r.count || 0) > m ? (r.count as number) : m), 0);
  return { rows, max, hasData: max > 0 };
}

export function featureSummary(items: FeatureItem[] | null | undefined): string {
  const { rows, hasData } = shapeFeatures(items);
  const ok = rows.filter((r) => r.available);
  const missing = rows.filter((r) => !r.available).map((r) => `${r.label} could not be counted.`);
  if (!hasData) return ['Nothing was made in the last 30 days.', ...missing].join(' ');
  const body = ok.map((r) => `${r.label}: ${r.count} by ${r.clients} ${plural(r.clients || 0, 'client', 'clients')}.`);
  return [...body, ...missing].join(' ');
}

export function quarksSummary(q: { available?: boolean; total?: number; categories?: QuarkCategory[] } | null | undefined): string {
  if (!q || !q.available || !q.total) return 'No Quarks spent this month.';
  const parts = (q.categories || []).filter((c) => c.quarks > 0).map((c) => `${c.label} ${percentText(c.percent)}`);
  return `${q.total.toLocaleString('en-IN')} Quarks spent this month: ${parts.join(', ')}.`;
}
