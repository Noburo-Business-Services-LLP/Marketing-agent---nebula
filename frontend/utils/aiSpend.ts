/** Small rules for the staff "AI spend and switches" card, kept apart from the page so they can be tested. */

export const INR_PER_USD = 88;

export type SpendTone = 'ok' | 'warn' | 'over';

/** How full today's ceiling is, as a whole percent that never reads over 100 on the bar. */
export function spendPercent(totalUsd: number, capUsd: number): number {
  if (!Number.isFinite(totalUsd) || !Number.isFinite(capUsd) || capUsd <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((totalUsd / capUsd) * 100)));
}

/** Green below 70 percent (the first warning email), amber from 70, red at the ceiling. */
export function spendTone(totalUsd: number, capUsd: number): SpendTone {
  if (!Number.isFinite(capUsd) || capUsd <= 0) return 'ok';
  const share = totalUsd / capUsd;
  return share >= 1 ? 'over' : share >= 0.7 ? 'warn' : 'ok';
}

/** "$12.40 (about ₹1,091)". */
export function money(usd: number): string {
  const n = Number.isFinite(usd) ? usd : 0;
  const inr = Math.round(n * INR_PER_USD);
  return `$${n.toFixed(2)} (about ₹${inr.toLocaleString('en-IN')})`;
}

/** The sentence under the card title, so a glance says whether anything is wrong. */
export function spendSummary(totalUsd: number, capUsd: number, switchedOff: number): string {
  if (switchedOff > 0) return `${switchedOff} kind${switchedOff === 1 ? '' : 's'} of work switched off. Customers see a busy message for them.`;
  const tone = spendTone(totalUsd, capUsd);
  if (capUsd <= 0) return 'No daily ceiling is set.';
  if (tone === 'over') return 'The daily ceiling is reached. New work is refused until tomorrow.';
  if (tone === 'warn') return 'Spend is above 70% of today’s ceiling.';
  return 'Everything is on and spend is normal.';
}
