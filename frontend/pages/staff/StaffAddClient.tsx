import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import { PLAN_CHOICES } from '../../utils/staffBulk';

type Props = {
  can: Record<string, boolean>;
  csms: Array<{ id: string; name: string }>;
  onClose: () => void;
  onAdded: () => void;
  onOpenExisting: (id: string) => void;
};

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const label = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1';

/** Add a client by hand: no payment needed. Managed by default, so every feature is on. */
const StaffAddClient: React.FC<Props> = ({ can, csms, onClose, onAdded, onOpenExisting }) => {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [csmId, setCsmId] = useState('');
  const [tier, setTier] = useState('managed');
  const [quarks, setQuarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [existingId, setExistingId] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; emailed: boolean } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setExistingId(null); setBusy(true);
    try {
      const res = await apiService.staffCreateClient({
        email, firstName, lastName, companyName, tier,
        csmId: csmId || undefined,
        quarks: can.add_quarks && quarks.trim() !== '' ? Number(quarks) : undefined
      });
      setDone({ name: res.client?.name || firstName, emailed: Boolean(res.emailed) });
      onAdded();
    } catch (err: any) {
      setError(customerMessage(err));
      if (err?.data?.existingId) setExistingId(err.data.existingId);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Add a client">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Add a client</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        {done ? (
          <div className="p-5 space-y-3">
            <p className="text-slate-900 font-semibold">{done.name} has been added.</p>
            <p className="text-sm text-slate-600">
              {done.emailed
                ? 'We emailed them how to sign in and choose a password.'
                : 'The welcome email could not be sent. Ask them to open the sign-in page, choose Forgot password and use this email address.'}
            </p>
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            <p className="text-sm text-slate-600">Creates the account without any payment. On the Managed plan every feature is on and nothing asks them to upgrade.</p>
            <div><label className={label} htmlFor="ac-email">Email</label><input id="ac-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} autoComplete="off" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label} htmlFor="ac-first">First name</label><input id="ac-first" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={field} /></div>
              <div><label className={label} htmlFor="ac-last">Last name</label><input id="ac-last" value={lastName} onChange={(e) => setLastName(e.target.value)} className={field} /></div>
            </div>
            <div><label className={label} htmlFor="ac-company">Business name</label><input id="ac-company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={field} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="ac-plan">Plan</label>
                <select id="ac-plan" value={tier} onChange={(e) => setTier(e.target.value)} className={field}>
                  {PLAN_CHOICES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="ac-csm">CSM</label>
                <select id="ac-csm" value={csmId} onChange={(e) => setCsmId(e.target.value)} className={field}>
                  <option value="">No CSM yet</option>
                  {csms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {can.add_quarks && (
              <div><label className={label} htmlFor="ac-quarks">Starting Quarks (optional)</label><input id="ac-quarks" inputMode="numeric" value={quarks} onChange={(e) => setQuarks(e.target.value.replace(/[^0-9]/g, ''))} className={field} placeholder="Leave empty for the standard amount" /></div>
            )}
            {error && (
              <p className="text-sm text-red-600">
                {error}{' '}
                {existingId && <button type="button" onClick={() => onOpenExisting(existingId)} className="underline font-semibold">Open this client</button>}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Cancel</button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold disabled:opacity-60 inline-flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}Add client
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default StaffAddClient;
