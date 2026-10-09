// Bulk actions on the staff client list: which actions a person may use, the request each one sends, and the plain
// sentence that asks "are you sure". Pure, so the rules are tested without a screen.

export type BulkChoice = 'on' | 'off' | 'csm' | 'quarks' | 'plan' | 'features_add' | 'features_remove' | 'hide' | 'show';
export type BulkValues = { csmId: string; amount: string; tier: string; addons: string[] };

export const PLAN_CHOICES: Array<{ value: string; label: string }> = [
  { value: 'managed', label: 'Managed (everything on, no payment)' },
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'professional', label: 'Professional' }
];

export const FEATURE_CHOICES: Array<{ value: string; label: string }> = [
  { value: 'publish', label: 'Publish and schedule' },
  { value: 'competitors', label: 'Competitors' },
  { value: 'inbox', label: 'Inbox and auto-reply' },
  { value: 'bundle', label: 'Everything (bundle)' }
];

const NEEDS: Record<BulkChoice, string> = {
  on: 'toggle_client', off: 'toggle_client', csm: 'assign_csm', quarks: 'add_quarks', plan: 'set_plan',
  features_add: 'set_plan', features_remove: 'set_plan', hide: 'hide_client', show: 'hide_client'
};
const LABEL: Record<BulkChoice, string> = {
  on: 'Switch accounts on', off: 'Switch accounts off', csm: 'Change CSM', quarks: 'Add Quarks', plan: 'Set plan',
  features_add: 'Add features', features_remove: 'Remove features', hide: 'Leave out of the numbers', show: 'Count in the numbers'
};

/** The actions this person may use, in a sensible order. */
export function bulkChoices(can: Record<string, boolean>): Array<{ value: BulkChoice; label: string }> {
  return (Object.keys(NEEDS) as BulkChoice[]).filter((c) => can[NEEDS[c]]).map((c) => ({ value: c, label: LABEL[c] }));
}

/** The request for one action, or the plain reason it cannot be sent yet. */
export function bulkRequest(choice: BulkChoice, v: BulkValues, ids: string[]): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  if (ids.length === 0) return { ok: false, message: 'Choose at least one client.' };
  switch (choice) {
    case 'on': return { ok: true, body: { ids, op: 'set_active', active: true } };
    case 'off': return { ok: true, body: { ids, op: 'set_active', active: false } };
    case 'hide': return { ok: true, body: { ids, op: 'set_hidden', hidden: true } };
    case 'show': return { ok: true, body: { ids, op: 'set_hidden', hidden: false } };
    case 'csm': return { ok: true, body: { ids, op: 'assign_csm', csmId: v.csmId || null } };
    case 'quarks': {
      const n = Number(v.amount);
      if (!Number.isInteger(n) || n < 1) return { ok: false, message: 'Enter a whole number of Quarks, 1 or more.' };
      return { ok: true, body: { ids, op: 'add_quarks', amount: n } };
    }
    case 'plan':
      if (!PLAN_CHOICES.some((p) => p.value === v.tier)) return { ok: false, message: 'Choose a plan.' };
      return { ok: true, body: { ids, op: 'set_plan', tier: v.tier } };
    case 'features_add':
    case 'features_remove':
      if (v.addons.length === 0) return { ok: false, message: 'Choose at least one feature.' };
      return { ok: true, body: { ids, op: 'set_features', mode: choice === 'features_add' ? 'add' : 'remove', addons: v.addons } };
    default: return { ok: false, message: 'Choose what to do.' };
  }
}

const plural = (n: number) => `${n} ${n === 1 ? 'client' : 'clients'}`;

/** The sentence shown before anything changes. */
export function bulkSummary(choice: BulkChoice, v: BulkValues, count: number, csmName = ''): string {
  const who = plural(count);
  switch (choice) {
    case 'on': return `Switch on ${who}?`;
    case 'off': return `Switch off ${who}? They will not be able to sign in until you switch them on again.`;
    case 'hide': return `Leave ${who} out of the staff numbers?`;
    case 'show': return `Count ${who} in the staff numbers again?`;
    case 'csm': return v.csmId ? `Assign ${csmName || 'this CSM'} to ${who}?` : `Remove the CSM from ${who}?`;
    case 'quarks': return `Add ${Number(v.amount).toLocaleString('en-IN')} Quarks to each of ${who}? That is ${(Number(v.amount) * count).toLocaleString('en-IN')} Quarks in total.`;
    case 'plan': return `Set the plan of ${who} to ${PLAN_CHOICES.find((p) => p.value === v.tier)?.label.split(' (')[0] || v.tier}?${v.tier === 'managed' ? ' Managed accounts have every feature on and are not asked to pay.' : ''}`;
    case 'features_add': return `Add ${v.addons.map((a) => FEATURE_CHOICES.find((f) => f.value === a)?.label || a).join(', ')} to ${who}?`;
    case 'features_remove': return `Remove ${v.addons.map((a) => FEATURE_CHOICES.find((f) => f.value === a)?.label || a).join(', ')} from ${who}?`;
    default: return `Apply to ${who}?`;
  }
}

/** What to tell the person afterwards. */
export function bulkResultNote(res: { updated?: number; skipped?: Array<{ reason: string }> }): string {
  const updated = res.updated || 0;
  const skipped = res.skipped || [];
  const head = `${updated} ${updated === 1 ? 'client' : 'clients'} updated.`;
  if (skipped.length === 0) return head;
  const reasons = Array.from(new Set(skipped.map((s) => s.reason))).join(' ');
  return `${head} ${skipped.length} skipped: ${reasons}`;
}
