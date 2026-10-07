import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, UserPlus, RefreshCw, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import { whenLabel } from './staffLabels';
import {
  ROLE_HELP, changeableRoles, removalCheck, removeConfirmText, roleLabel, statusLabel,
  unassignedNote, validateAddForm, workloadShare, workloadText
} from '../../utils/staffTeam';
import type { TeamRow } from '../../utils/staffTeam';
import { canResetAccount, resetAccountConfirm, resetAccountNotice } from '../../utils/staffTools';

const LOAD_ERROR = 'We could not load the team. Please try again.';
const ROLE_STYLE: Record<string, string> = {
  owner: 'bg-amber-100 text-amber-900',
  admin: 'bg-sky-100 text-sky-900',
  csm: 'bg-emerald-100 text-emerald-900'
};
const FIELD = 'w-full rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] px-3 py-2 text-sm text-[var(--gv-text-primary)]';
const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-primary)] disabled:opacity-50';
const BTN_MAIN = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#F5A623] px-4 py-2 text-sm font-bold text-black disabled:opacity-50';

type Team = { me: string; grantable: string[]; rows: TeamRow[]; maxClients: number; owners: number; can?: Record<string, boolean> };

/** A plain dialog: Escape closes it, focus starts inside it, and the page behind stays put. */
const Dialog: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('input, select, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-[var(--gv-panel)] p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--gv-text-primary)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--gv-text-secondary)]"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
};

const AddDialog: React.FC<{ grantable: string[]; onClose: () => void; onDone: (text: string) => void }> = ({ grantable, onClose, onDone }) => {
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', role: grantable.includes('csm') ? 'csm' : grantable[0] || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateAddForm(form, grantable);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      const res = await apiService.staffAddTeamMember({ ...form, email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim() });
      if (!res.success) throw new Error(res.message);
      const who = res.member?.name || form.email;
      onDone(res.emailed
        ? `${who} was added as ${roleLabel(res.member?.role || form.role)}. We emailed them how to set a password.`
        : `${who} was added as ${roleLabel(res.member?.role || form.role)}, but the invite email could not be sent. Ask them to choose Forgot password on the sign-in page.`);
    } catch (err: any) {
      setError(customerMessage(err && err.message, 'Could not add this person. Please try again.'));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add team member" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className="block text-sm font-semibold text-[var(--gv-text-primary)]">Email
          <input type="email" value={form.email} onChange={set('email')} autoComplete="off" className={`${FIELD} mt-1 font-normal`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold text-[var(--gv-text-primary)]">First name
            <input value={form.firstName} onChange={set('firstName')} autoComplete="off" className={`${FIELD} mt-1 font-normal`} />
          </label>
          <label className="block text-sm font-semibold text-[var(--gv-text-primary)]">Last name
            <input value={form.lastName} onChange={set('lastName')} autoComplete="off" className={`${FIELD} mt-1 font-normal`} />
          </label>
        </div>
        <label className="block text-sm font-semibold text-[var(--gv-text-primary)]">Role
          <select value={form.role} onChange={set('role')} className={`${FIELD} mt-1 font-normal`}>
            {grantable.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </label>
        <p className="text-xs text-[var(--gv-text-secondary)]">{ROLE_HELP[form.role] || ''} We email an invite with steps to set a password. If the email already has an account, it becomes a team account and keeps its sign in.</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" disabled={busy} className={BTN_MAIN}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Add and send invite</button>
        </div>
      </form>
    </Dialog>
  );
};

type Pending = { kind: 'role'; row: TeamRow; role: string } | { kind: 'remove'; row: TeamRow };

const ConfirmDialog: React.FC<{ pending: Pending; onClose: () => void; onDone: (text: string) => void }> = ({ pending, onClose, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const row = pending.row;
  const text = pending.kind === 'remove'
    ? removeConfirmText(row)
    : `Change ${row.name} from ${roleLabel(row.role)} to ${roleLabel(pending.role)}? ${ROLE_HELP[pending.role] || ''}${row.role === 'csm' && (row.clients || 0) > 0 ? ` ${row.clients} ${row.clients === 1 ? 'client' : 'clients'} will have no CSM until you assign someone else.` : ''}`;

  const confirm = async () => {
    setBusy(true); setError('');
    try {
      const res = pending.kind === 'remove' ? await apiService.staffRemoveTeamMember(row.id) : await apiService.staffChangeRole(row.id, pending.role);
      if (!res.success) throw new Error(res.message);
      const head = pending.kind === 'remove' ? `${row.name} was removed from the team.` : `${row.name} is now ${roleLabel(pending.role)}.`;
      onDone([head, unassignedNote(res.unassigned)].filter(Boolean).join(' '));
    } catch (err: any) {
      setError(customerMessage(err && err.message, 'Could not make this change. Please try again.'));
      setBusy(false);
    }
  };

  return (
    <Dialog title={pending.kind === 'remove' ? 'Remove from the team' : 'Change role'} onClose={onClose}>
      <p className="text-sm text-[var(--gv-text-primary)]">{text}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN}>Cancel</button>
        <button type="button" onClick={confirm} disabled={busy} className={pending.kind === 'remove' ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50' : BTN_MAIN}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {pending.kind === 'remove' ? 'Remove' : 'Change role'}
        </button>
      </div>
    </Dialog>
  );
};

const WorkloadBar: React.FC<{ row: TeamRow; max: number }> = ({ row, max }) => {
  if (row.role !== 'csm') return <span className="hidden text-sm text-[var(--gv-text-tertiary)] xl:inline">Not applicable</span>;
  const share = workloadShare(row.clients, max);
  return (
    <div>
      <div role="progressbar" aria-label={`${row.name}: clients as a share of the busiest CSM`} aria-valuemin={0} aria-valuemax={Math.max(max, 1)} aria-valuenow={row.clients || 0}
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--gv-border-subtle)]">
        <div className="h-full rounded-full bg-[var(--gv-accent-display)]" style={{ width: `${share}%` }} />
      </div>
      <p className="mt-1 text-xs text-[var(--gv-text-secondary)]">{workloadText(row)}</p>
    </div>
  );
};

/** Team: who has staff access, their role, and how much each CSM is carrying. Owners and Admins only. */
const StaffTeam: React.FC = () => {
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState('');
  const [resetting, setResetting] = useState<string | null>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (note && noteRef.current) noteRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [note]);

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    return apiService.getStaffTeam()
      .then((res) => { if (res && res.success === false) throw new Error(res.message); setTeam(res); })
      .catch((e) => setError(customerMessage(e && e.message, LOAD_ERROR)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const resetAccount = async (row: TeamRow) => {
    if (!window.confirm(resetAccountConfirm({ name: row.name, email: row.email }))) return;
    setResetting(row.id); setNote('');
    try { setNote(resetAccountNotice(row.name, await apiService.staffResetStaffAccount(row.id))); }
    catch (e: any) { setNote(customerMessage(e && e.message, 'We could not reset this account. Please try again.')); }
    setResetting(null);
  };

  const done = (text: string) => { setAdding(false); setPending(null); setNote(text); load(true); };

  if (loading && !team) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#F5A623]" aria-label="Loading the team" /></div>;
  if (error && !team) {
    return (
      <div className="py-12 text-center">
        <p role="alert" className="text-[var(--gv-text-primary)]">{error}</p>
        <button type="button" onClick={() => load()} className={`${BTN} mt-4`}><RefreshCw className="h-4 w-4" /> Try again</button>
      </div>
    );
  }
  if (!team) return null;

  const { rows, grantable, me, maxClients, owners } = team;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--gv-text-secondary)]">{rows.length} {rows.length === 1 ? 'person has' : 'people have'} staff access.</p>
        <button type="button" onClick={() => { setNote(''); setAdding(true); }} className={BTN_MAIN}><UserPlus className="h-4 w-4" /> Add team member</button>
      </div>

      {note && <p ref={noteRef} role="status" aria-live="polite" className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{note}</p>}
      {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] py-12 text-center text-[var(--gv-text-secondary)]">No one has staff access yet. Add the first team member.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
          <div className="hidden grid-cols-[minmax(0,2fr)_90px_110px_minmax(0,2fr)_110px_210px] gap-4 border-b border-[var(--gv-border-subtle)] bg-[var(--gv-bg)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--gv-text-tertiary)] xl:grid">
            <span>Person</span><span>Role</span><span>Status</span><span>CSM workload</span><span>Last active</span><span>Actions</span>
          </div>
          <ul>
            {rows.map((r) => {
              const roles = changeableRoles({ meId: me, grantable, target: r });
              const removal = removalCheck({ meId: me, grantable, target: r, owners });
              const blocked = removal.ok ? '' : removal.reason || '';
              return (
                <li key={r.id} className="grid gap-3 border-b border-[var(--gv-border-subtle)] px-4 py-4 last:border-b-0 xl:grid-cols-[minmax(0,2fr)_90px_110px_minmax(0,2fr)_110px_210px] xl:items-center xl:gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--gv-text-primary)]">{r.name}{r.id === me && <span className="ml-2 text-xs font-normal text-[var(--gv-text-tertiary)]">You</span>}</p>
                    <p className="truncate text-xs text-[var(--gv-text-secondary)]">{r.email}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 xl:contents">
                    <span><span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_STYLE[r.role] || ''}`}>{roleLabel(r.role)}</span></span>
                    <span><span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.status === 'active' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700'}`}>{statusLabel(r.status)}</span></span>
                  </div>
                  <WorkloadBar row={r} max={maxClients} />
                  <p className="text-sm text-[var(--gv-text-secondary)]"><span className="xl:hidden">Last active: </span>{whenLabel(r.lastActiveAt)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {roles.length > 0 && (
                      <select aria-label={`Change role for ${r.name}`} value="" onChange={(e) => { if (e.target.value) { setNote(''); setPending({ kind: 'role', row: r, role: e.target.value }); } }} className="rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] px-2 py-1.5 text-sm text-[var(--gv-text-primary)]">
                        <option value="">Change role</option>
                        {roles.map((role) => <option key={role} value={role}>Make {roleLabel(role)}</option>)}
                      </select>
                    )}
                    {canResetAccount(team.can) && (
                      <button type="button" disabled={resetting === r.id} onClick={() => resetAccount(r)} className="rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] px-3 py-1.5 text-sm font-semibold text-[var(--gv-text-primary)] disabled:opacity-50">{resetting === r.id ? 'Resetting…' : 'Reset account'}</button>
                    )}
                    {removal.ok
                      ? <button type="button" onClick={() => { setNote(''); setPending({ kind: 'remove', row: r }); }} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-800">Remove</button>
                      : r.id !== me && <span className="text-xs text-[var(--gv-text-tertiary)]">{blocked}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {adding && <AddDialog grantable={grantable} onClose={() => setAdding(false)} onDone={done} />}
      {pending && <ConfirmDialog pending={pending} onClose={() => setPending(null)} onDone={done} />}
    </div>
  );
};

export default StaffTeam;
