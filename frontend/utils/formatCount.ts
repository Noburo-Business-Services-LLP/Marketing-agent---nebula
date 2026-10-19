/** Number wording for Home and other tiles: Indian digit grouping (12,50,000), short forms (1.3K, 12.5L, 1.3Cr) and
 *  plain-words change text. Anything that is not a finite number gives an empty string, never "NaN" or "undefined". */

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** 1250000 -> "12,50,000". Whole numbers; the sign is kept. */
export function formatCount(value: unknown): string {
  const n = asNumber(value);
  if (n === null) return '';
  const rounded = Math.round(Math.abs(n));
  if (rounded === 0) return '0';
  // BigInt keeps numbers beyond 2^53 and above 1e21 as plain digits (String(1e21) would be "1e+21").
  const digits = BigInt(rounded).toString();
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  // Pairs of digits from the right, then the last three.
  const pairs: string[] = [];
  for (let end = head.length; end > 0; end -= 2) pairs.unshift(head.slice(Math.max(0, end - 2), end));
  const grouped = head ? `${pairs.join(',')},${tail}` : tail;
  return `${n < 0 ? '-' : ''}${grouped}`;
}

const trim = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/** 12345 -> "12.3K", 125000 -> "1.3L", 12500000 -> "1.3Cr". Under 1,000 the number is shown as it is. */
export function formatShort(value: unknown): string {
  const n = asNumber(value);
  if (n === null) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1000) return formatCount(n);
  // Round first, then pick the unit, so 99,950 is "1L" and not "100K".
  if (Math.round((abs / 1000) * 10) / 10 < 100 && abs < 100000) return `${sign}${trim(abs / 1000)}K`;
  if (Math.round((abs / 100000) * 10) / 10 < 100 && abs < 10000000) return `${sign}${trim(abs / 100000)}L`;
  const crores = abs / 10000000;
  return crores < 1000 ? `${sign}${trim(crores)}Cr` : `${sign}${formatCount(Math.round(crores))}Cr`;
}

/** 4.25 -> "4.3%". One decimal at most. */
export function formatPercent(value: unknown): string {
  const n = asNumber(value);
  if (n === null) return '';
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}%`;
}

/** "Up 12.5%", "Down 3%", "No change". The direction is in words, so colour is never the only signal. */
export function changeText(pct: unknown): string {
  const n = asNumber(pct);
  if (n === null) return '';
  const r = Math.round(Math.abs(n) * 10) / 10;
  if (r === 0) return 'No change';
  const body = Number.isInteger(r) ? formatCount(r) : r.toFixed(1);
  return `${n > 0 ? 'Up' : 'Down'} ${body}%`;
}
