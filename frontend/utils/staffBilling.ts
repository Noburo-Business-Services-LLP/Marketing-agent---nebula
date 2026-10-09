// Billing screen helpers for managed clients: money in whole paise, the GST split, and the plain labels. Pure.

export const STATUS_LABEL: Record<string, string> = {
  not_invoiced: 'Not invoiced', invoiced: 'Invoiced', overdue: 'Overdue', paid: 'Paid', void: 'Cancelled'
};

/** Whole paise as rupees with Indian grouping and two decimals, for example 2118644 -> "₹21,186.44". */
export function formatInr(paise: number): string {
  const n = Math.round(Number(paise) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const r = String(rupees);
  const grouped = r.length > 3 ? `${r.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${r.slice(-3)}` : r;
  return `${sign}₹${grouped}.${frac}`;
}

/** The split of an amount: including GST works the net out from it; excluding GST adds the GST on top. */
export function splitAmount(amountInr: number, gstPercent: number, gstInclusive: boolean): { exPaise: number; gstPaise: number; totalPaise: number } | null {
  const paise = Math.round(Number(amountInr) * 100);
  if (!Number.isFinite(paise) || paise <= 0) return null;
  if (gstInclusive) {
    const ex = Math.round((paise * 100) / (100 + gstPercent));
    return { exPaise: ex, gstPaise: paise - ex, totalPaise: paise };
  }
  const gst = Math.round((paise * gstPercent) / 100);
  return { exPaise: paise, gstPaise: gst, totalPaise: paise + gst };
}

/** The one-line preview shown under the amount field. */
export function previewLine(amountInr: number, gstPercent: number, gstInclusive: boolean): string {
  const s = splitAmount(amountInr, gstPercent, gstInclusive);
  if (!s) return '';
  return `Net ${formatInr(s.exPaise)} + GST ${formatInr(s.gstPaise)} = ${formatInr(s.totalPaise)} a month`;
}

/** 'YYYY-MM-DD' for today in the browser's time zone (the default payment date). */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
