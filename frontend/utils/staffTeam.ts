/** Pure helpers for the staff Team page: role wording, workload bars, who may change or remove whom, form checks. */

export type TeamRole = 'owner' | 'admin' | 'csm';
export type TeamRow = {
  id: string; name: string; email: string; role: TeamRole; status: 'active' | 'switched_off';
  lastActiveAt: string | null; clients: number | null; draftsWaiting: number | null; needAttention: number | null;
};

const ROLE_TEXT: Record<string, string> = { owner: 'Owner', admin: 'Admin', csm: 'CSM' };
export const ROLE_HELP: Record<string, string> = {
  owner: 'Full access, including money and the team.',
  admin: 'Sees every client, assigns CSMs and switches accounts on or off.',
  csm: 'Sees and opens only the clients assigned to them.'
};

export function roleLabel(role: string): string {
  return ROLE_TEXT[role] || 'Team member';
}

export function statusLabel(status: string): string {
  return status === 'switched_off' ? 'Switched off' : 'Active';
}

/** Bar width as a percentage of the busiest CSM. Anyone with clients gets a visible sliver. */
export function workloadShare(clients: number | null | undefined, max: number): number {
  const n = Number(clients);
  if (!Number.isFinite(n) || n <= 0 || !(max > 0)) return 0;
  return Math.min(100, Math.max(4, Math.round((n / max) * 100)));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function workloadText(row: TeamRow): string {
  if (row.role !== 'csm') return '';
  const clients = row.clients || 0;
  if (clients === 0) return 'No clients yet';
  const drafts = plural(row.draftsWaiting || 0, 'draft waiting', 'drafts waiting');
  const attention = row.needAttention ? `${row.needAttention} needs attention` : 'none need attention';
  const attentionText = row.needAttention && row.needAttention > 1 ? `${row.needAttention} need attention` : attention;
  return `${plural(clients, 'client', 'clients')}, ${drafts}, ${attentionText}`;
}

const SENIOR = ['owner', 'admin'];

/** Roles the signed-in person may switch this team member to. The server checks again; this only hides what it would refuse. */
export function changeableRoles({ meId, grantable, target }: { meId: string; grantable: string[]; target: TeamRow }): string[] {
  if (!target || target.id === meId) return [];
  if (SENIOR.includes(target.role) && !grantable.includes('owner')) return [];
  return grantable.filter((r) => r !== target.role);
}

export function removalCheck({ meId, grantable, target, owners }: { meId: string; grantable: string[]; target: TeamRow; owners: number }): { ok: boolean; reason?: string } {
  if (target.id === meId) return { ok: false, reason: 'You cannot remove yourself. Ask another Owner.' };
  if (grantable.length === 0) return { ok: false, reason: 'Your role cannot remove team members.' };
  if (SENIOR.includes(target.role) && !grantable.includes('owner')) return { ok: false, reason: 'Only the Owner can remove Admins and Owners.' };
  if (target.role === 'owner' && owners <= 1) return { ok: false, reason: 'The last Owner cannot be removed. Add another Owner first.' };
  return { ok: true };
}

export function removeConfirmText(target: TeamRow): string {
  const base = `Remove ${target.name} from the team? They will no longer have access to the Staff area. Their account and sign in stay.`;
  const n = target.role === 'csm' ? target.clients || 0 : 0;
  return n > 0 ? `${base} ${plural(n, 'client', 'clients')} will have no CSM until you assign someone else.` : base;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns a plain message for the first problem, or an empty string when the form is fine. */
export function validateAddForm(form: { email: string; firstName: string; role: string }, grantable: string[]): string {
  if (!EMAIL.test(String(form.email || '').trim())) return 'Enter a valid email address.';
  if (!String(form.firstName || '').trim()) return 'Enter their first name.';
  if (!grantable.includes(form.role)) return 'Choose a role.';
  return '';
}

export function unassignedNote(u: { count: number; clients: Array<{ id: string; name: string }> } | null | undefined): string {
  if (!u || !u.count) return '';
  const shown = u.clients.slice(0, 3).map((c) => c.name);
  const rest = u.count - shown.length;
  const names = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
  return `${plural(u.count, 'client now has', 'clients now have')} no CSM: ${names}. Assign them from the Clients page.`;
}
