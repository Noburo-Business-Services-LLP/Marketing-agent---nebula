/** Wording and checks for the Owner tools in the staff area (resets, hide from numbers, coupons). Pure. */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
type Result = { success?: boolean; message?: string } & Record<string, any>;

/** What the plain confirm says before the Ayrshare reset: exactly what is cleared and what is not. */
export function ayrshareResetConfirm(profiles?: number | null): string {
  const what = typeof profiles === 'number' && profiles >= 0
    ? `${plural(profiles, 'stored social profile ID', 'stored social profile IDs')}`
    : "every customer's stored social profile ID";
  return `Reset Ayrshare IDs?\n\nUse this only after switching to a different Ayrshare account. It clears ${what}, so each client gets a new profile the next time they connect an account. Posts, drafts and Quarks are not touched. Nothing is sent to Ayrshare.`;
}

export function ayrshareResetNotice(res: Result | null | undefined): string {
  if (!res || res.success !== true) return (res && res.message) || 'We could not reset the profile IDs. Please try again.';
  const n = Number(res.cleared) || 0;
  if (n === 0) return 'Nothing to clear: no client has a stored profile ID.';
  return `Done. ${plural(n, 'stored profile ID was', 'stored profile IDs were')} cleared. Each client gets a new profile the next time they connect an account.`;
}

export function resetAccountConfirm(person: { name: string; email: string }): string {
  return `Reset ${person.name} (${person.email}) to a clean staff account?\n\nThis clears their business profile and connected social accounts, and archives their drafts (archived, not deleted). Their Quarks, sign-in, role and clients stay.`;
}

export function resetAccountNotice(name: string, res: Result | null | undefined): string {
  if (!res || res.success !== true) return (res && res.message) || 'We could not reset this account. Please try again.';
  const n = Number(res.archivedDrafts) || 0;
  const drafts = n === 0 ? 'No drafts needed archiving.' : `${plural(n, 'draft was', 'drafts were')} archived.`;
  return `${name}'s account is clean again. ${drafts}`;
}

/** The reset is for the Owner only; the server refuses everyone else, this only hides the button. */
export function canResetAccount(can: Record<string, boolean> | null | undefined): boolean {
  return Boolean(can && can.reset_accounts);
}

export function hideConfirm(name: string, hide: boolean): string {
  return hide
    ? `Leave ${name} out of the numbers?\n\nThey stay a client and can still sign in. They will not count in Home, Money and Usage, and the Clients list shows them only under Hidden. Use this for test accounts.`
    : `Count ${name} in the numbers again?\n\nThey will count in Home, Money and Usage again.`;
}

export function hideNotice(res: Result | null | undefined): string {
  if (!res || res.success !== true) return (res && res.message) || 'We could not change this. Please try again.';
  return res.hidden ? 'This client is now left out of the numbers.' : 'This client counts in the numbers again.';
}

const CODE = /^[A-Z0-9_-]{3,30}$/;

export function validateCouponForm(form: { code: string; discountedAmount: string; maxUses: string; note: string }):
  { ok: true; payload: { code: string; discountedAmount: number; maxUses: number; note: string } } | { ok: false; message: string } {
  const code = String(form.code || '').trim().toUpperCase();
  if (!CODE.test(code)) return { ok: false, message: 'Use 3 to 30 letters, numbers, dashes or underscores for the code.' };
  const discountedAmount = Number(form.discountedAmount);
  if (!Number.isFinite(discountedAmount) || discountedAmount <= 0) return { ok: false, message: 'Enter the discounted price as a number above 0.' };
  const maxUses = Number(form.maxUses);
  if (!Number.isInteger(maxUses) || maxUses < 1) return { ok: false, message: 'Enter how many times it can be used, as a whole number from 1.' };
  return { ok: true, payload: { code, discountedAmount, maxUses, note: String(form.note || '').trim().slice(0, 200) } };
}

export type CouponRow = { code: string; discountedAmount: number; maxUses: number; usedCount: number; isActive: boolean; note: string };

export function couponLine(c: CouponRow): string {
  const parts = [] as string[];
  if (!c.isActive) parts.push('Switched off');
  parts.push(`${c.usedCount} of ${c.maxUses} ${c.maxUses === 1 ? 'use' : 'uses'}`);
  parts.push(`INR ${Number(c.discountedAmount).toLocaleString('en-IN')}`);
  if (c.note) parts.push(c.note);
  return parts.join(' · ');
}
