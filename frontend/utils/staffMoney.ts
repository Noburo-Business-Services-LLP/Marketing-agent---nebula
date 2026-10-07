/** Pure helpers for the staff Money page. Amounts arrive as integer paise and are never turned into floats for display. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`.trim() : day || '';
}

const INR_GROUPS = new Intl.NumberFormat('en-IN');

/** Integer paise as rupees with Indian digit grouping: 11788200 -> "₹1,17,882", 117882 -> "₹1,178.82". */
export function formatInr(paise: number | null | undefined, opts: { alwaysPaise?: boolean } = {}): string {
  const n = paise === null || paise === undefined ? NaN : Number(paise);
  if (!Number.isFinite(n)) return '—';
  const p = Math.round(n);
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const frac = rest === 0 && !opts.alwaysPaise ? '' : `.${String(rest).padStart(2, '0')}`;
  return `${sign}₹${INR_GROUPS.format(rupees)}${frac}`;
}

/** Short axis label: ₹1.2K, ₹3L (lakh), ₹1.5Cr (crore). */
export function formatInrShort(paise: number): string {
  const r = Math.round(Math.abs(paise) / 100);
  const trim = (x: number) => String(Math.round(x * 10) / 10);
  if (r >= 10000000) return `₹${trim(r / 10000000)}Cr`;
  if (r >= 100000) return `₹${trim(r / 100000)}L`;
  if (r >= 1000) return `₹${trim(r / 1000)}K`;
  return `₹${r}`;
}

/** US dollars from integer cents: 4495 -> "$44.95". */
export function formatUsd(cents: number | null | undefined): string {
  const n = cents === null || cents === undefined ? NaN : Number(cents);
  if (!Number.isFinite(n)) return '—';
  const c = Math.round(n);
  return `$${INR_GROUPS.format(Math.floor(Math.abs(c) / 100))}.${String(Math.abs(c) % 100).padStart(2, '0')}`.replace('$', c < 0 ? '-$' : '$');
}

export type MoneyDay = { day: string; label: string; exGst: number; gst: number; unsplit: number; total: number };
export type MoneySeries = { days: MoneyDay[]; total: number; max: number; hasData: boolean; hasUnsplit: boolean };

const whole = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

/** Sorts by day and turns anything that is not an amount into zero. */
export function shapeRevenueSeries(series: Array<Record<string, unknown>> | null | undefined): MoneySeries {
  const days = (Array.isArray(series) ? series : [])
    .filter((r) => r && typeof r.day === 'string')
    .map((r) => {
      const exGst = whole(r.exGstPaise); const gst = whole(r.gstPaise); const unsplit = whole(r.unsplitPaise);
      return { day: r.day as string, label: dayLabel(r.day as string), exGst, gst, unsplit, total: exGst + gst + unsplit };
    })
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const total = days.reduce((s, d) => s + d.total, 0);
  return { days, total, max: days.reduce((m, d) => Math.max(m, d.total), 0), hasData: total > 0, hasUnsplit: days.some((d) => d.unsplit > 0) };
}

/** One sentence describing the chart for people who cannot see it. */
export function revenueSummary(s: MoneySeries): string {
  if (!s.hasData || s.days.length === 0) return 'No payments in the last 30 days.';
  const best = s.days.reduce((b, d) => (d.total > b.total ? d : b), s.days[0]);
  const paid = s.days.filter((d) => d.total > 0).length;
  return `${formatInr(s.total)} collected over ${s.days.length} days, from ${s.days[0].label} to ${s.days[s.days.length - 1].label}. Payments on ${paid} ${paid === 1 ? 'day' : 'days'}. Best day: ${best.label}, ${formatInr(best.total)}.`;
}

export const PAYMENT_STATUS: Record<string, string> = { paid: 'Paid', failed: 'Failed', refunded: 'Refunded' };
export const FAILURE_KIND: Record<string, string> = { halted: 'Renewal failed', cancelled: 'Cancelled' };

/** Gauge for profiles against the included number: width of the bar and the markers' positions, as percentages of the scale. */
export function gaugeShape(profiles: number, included: number, max: number) {
  const top = Math.max(max, profiles, included, 1);
  const pct = (n: number) => Math.min(100, Math.max(0, Math.round((n / top) * 1000) / 10));
  return { used: pct(profiles), included: pct(included), over: profiles > included, top };
}

export function pageLabel(page: number, pages: number, total: number): string {
  if (total === 0) return 'No payments yet';
  return `Page ${page} of ${pages}, ${total.toLocaleString('en-IN')} ${total === 1 ? 'payment' : 'payments'}`;
}

/** Date and time in India time, so the screen matches the day boundaries the server uses. */
export function whenIst(iso: string | null | undefined, withTime = false): string {
  if (!iso) return 'Date not stored';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date not stored';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}
