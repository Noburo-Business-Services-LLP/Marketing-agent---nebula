// Pure helpers for the plans page and the upgrade prompts. No prices live here:
// every amount comes from GET /api/payment/plans, in integer paise.

export type UpgradeReason = 'upgrade' | 'addon' | 'quarks';

export interface UpgradeInfo {
  reason: UpgradeReason;
  feature?: string;
  message: string;
}

const BASE = 'Please upgrade your plan, or buy an add-on pack or Quarks.';

const FEATURE_LABELS: Record<string, string> = {
  social_connect: 'Connecting social accounts',
  publish: 'Publishing',
  schedule: 'Scheduling',
  inbox: 'The inbox',
  auto_reply: 'Automatic replies',
  competitors: 'Competitor insights',
};

export function featureLabel(feature?: string): string {
  return (feature && FEATURE_LABELS[feature]) || '';
}

/** The plain message for each reason, always ending with the one next step. */
export function upgradeMessage(reason: UpgradeReason, feature?: string): string {
  const label = featureLabel(feature);
  if (reason === 'quarks') return `You do not have enough Quarks for this action. ${BASE}`;
  if (reason === 'addon') return `${label || 'This feature'} is available as an add-on. ${BASE}`;
  return `${label || 'This feature'} is not included in your current plan. ${BASE}`;
}

/**
 * Reads a failed API call. Returns the upgrade details when the server answered
 * with `upgradeRequired` (or `creditsExhausted`), otherwise null.
 */
export function upgradeInfoOf(err: any): UpgradeInfo | null {
  const d = err?.data;
  if (!d || typeof d !== 'object') return null;
  if (!d.upgradeRequired && !d.creditsExhausted) return null;
  const reason: UpgradeReason = d.reason === 'addon' || d.reason === 'quarks' || d.reason === 'upgrade'
    ? d.reason
    : d.creditsExhausted ? 'quarks' : 'upgrade';
  const feature = typeof d.feature === 'string' ? d.feature : undefined;
  return { reason, feature, message: upgradeMessage(reason, feature) };
}

/** Whole rupees, no decimals. */
export function formatInr(inr: number): string {
  return `₹${Math.round(inr).toLocaleString('en-IN')}`;
}

/** Integer paise to rupees without float maths: 117882 becomes ₹1,178.82. */
export function formatPaise(paise: number): string {
  const whole = Math.floor(paise / 100);
  const rem = paise % 100;
  return `₹${whole.toLocaleString('en-IN')}.${String(rem).padStart(2, '0')}`;
}

export function tierLabel(tier?: string): string {
  switch (tier) {
    case 'starter': return 'Starter';
    case 'professional': return 'Professional';
    case 'managed': return 'Managed';
    default: return 'Free';
  }
}

/** An Error that keeps the server's answer, so `upgradeInfoOf` can read it (same shape `apiCall` throws). */
export function apiErrorFrom(data: any, status: number, fallback: string): Error {
  const d = data && typeof data === 'object' ? data : {};
  const err: any = new Error(d.message || d.error || fallback);
  err.status = status;
  err.reason = d.reason || '';
  err.data = d;
  return err;
}
