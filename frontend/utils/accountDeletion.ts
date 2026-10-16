/** Small rules for the delete-account screens, kept apart so they can be tested. */

/** The delete button stays off until the password is filled in and DELETE is typed exactly. */
export function canConfirmDeletion(password: string, typed: string): boolean {
  return password.length > 0 && typed.trim() === 'DELETE';
}

/** Whole days left before the deletion happens, never below zero. A missing or invalid date counts as zero. */
export function daysUntil(purgeAfter: string | undefined | null, now: number = Date.now()): number {
  const t = purgeAfter ? new Date(purgeAfter).getTime() : NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 86400000));
}

/** "6 November 2026", in the reader's own language settings. */
export function longDate(iso: string | undefined | null): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** An existing customer who has never agreed to the current terms is asked once. Staff and unfinished sign-ups are not. */
export function needsTermsPrompt(user: { consent?: { acceptedAt?: string } | null; onboardingCompleted?: boolean; staffRole?: string | null; isCsm?: boolean; deletion?: { status?: string } | null } | null): boolean {
  if (!user || !user.onboardingCompleted || user.staffRole || user.isCsm) return false;
  if (user.deletion && user.deletion.status === 'pending') return false;
  return !(user.consent && user.consent.acceptedAt);
}
