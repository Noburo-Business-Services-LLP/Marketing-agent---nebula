import React, { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { apiService } from '../services/api';
import { gstinProblem, normaliseGstin, stateFromGstin } from '../utils/gstin';

type Details = { gstin: string; legalName: string; address: string; pin: string; stateCode: string };
const EMPTY: Details = { gstin: '', legalName: '', address: '', pin: '', stateCode: '' };

const field = 'w-full rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] px-3 py-2.5 text-[14px] text-[var(--gv-text-primary)] outline-none focus:border-[var(--gv-accent)]';

/**
 * The optional details for a tax invoice. A GSTIN with the business name makes the invoice a business invoice; with no
 * GSTIN only the state matters (it decides which GST applies). Saved details apply to payments made after they are saved.
 */
const BillingDetailsForm: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [d, setD] = useState<Details>(EMPTY);
  const [states, setStates] = useState<Array<{ abbr: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    apiService.getBillingDetails().then((r) => { if (r?.success) { setD({ ...EMPTY, ...r.details }); setStates(r.states || []); } }).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const problem = gstinProblem(d.gstin);
  const hasGstin = normaliseGstin(d.gstin).length > 0;
  const set = (k: keyof Details, v: string) => { setD((p) => ({ ...p, [k]: v })); setSaved(''); setError(''); setErrors((e) => ({ ...e, [k]: '' })); };

  const save = async () => {
    if (problem) { setErrors({ gstin: problem }); return; }
    if (hasGstin && d.legalName.trim().length < 2) { setErrors({ legalName: 'Enter the business name exactly as it is registered for GST.' }); return; }
    setSaving(true); setError(''); setSaved('');
    try {
      const r = await apiService.saveBillingDetails({ ...d, gstin: normaliseGstin(d.gstin) });
      if (r?.success) setSaved(r.message || 'Saved.');
      else { setErrors(r?.errors || {}); setError(r?.message || 'We could not save these details. Please try again.'); }
    } catch (e: any) {
      setErrors(e?.data?.errors || {}); setError(e?.data?.message || e?.message || 'We could not save these details. Please try again.');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-6" role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin text-[var(--gv-accent)]" /></div>;

  return (
    <div className={compact ? '' : 'space-y-1'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="gravity-label mb-1 block">GSTIN · optional</span>
          <input value={d.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={18} autoComplete="off" placeholder="For example 33ABCDE1234F1Z5" className={field} aria-invalid={!!(errors.gstin || problem)} />
          {(errors.gstin || problem) && <span className="mt-1 block text-[12.5px] text-red-600" role="alert">{errors.gstin || problem}</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="gravity-label mb-1 block">Business name on the invoice{hasGstin ? '' : ' · optional'}</span>
          <input value={d.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={120} placeholder="As registered for GST" className={field} aria-invalid={!!errors.legalName} />
          {errors.legalName && <span className="mt-1 block text-[12.5px] text-red-600" role="alert">{errors.legalName}</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="gravity-label mb-1 block">Address · optional</span>
          <input value={d.address} onChange={(e) => set('address', e.target.value)} maxLength={240} className={field} />
        </label>
        <label className="block">
          <span className="gravity-label mb-1 block">PIN code · optional</span>
          <input value={d.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className={field} aria-invalid={!!errors.pin} />
          {errors.pin && <span className="mt-1 block text-[12.5px] text-red-600" role="alert">{errors.pin}</span>}
        </label>
        <label className="block">
          <span className="gravity-label mb-1 block">State</span>
          <select value={hasGstin && !problem && normaliseGstin(d.gstin).length === 15 ? stateFromGstin(d.gstin) : d.stateCode} onChange={(e) => set('stateCode', e.target.value)} disabled={hasGstin && !problem && normaliseGstin(d.gstin).length === 15} className={field}>
            <option value="">Not sure</option>
            {states.map((s) => <option key={s.abbr} value={s.abbr}>{s.name}</option>)}
          </select>
          {hasGstin && !problem && normaliseGstin(d.gstin).length === 15 && <span className="mt-1 block text-[12px] text-[var(--gv-text-tertiary)]">Taken from your GSTIN.</span>}
        </label>
      </div>
      <p className="mt-3 text-[12px] text-[var(--gv-text-tertiary)]">These appear on invoices for payments you make after saving. An invoice that is already made cannot be changed, so add them before you pay.</p>
      {error && <p className="mt-2 text-[13px] text-red-600" role="alert">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--gv-accent-ink)] disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save invoice details
        </button>
        {saved && <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-700" role="status"><Check className="h-4 w-4" /> {saved}</span>}
      </div>
    </div>
  );
};

export default BillingDetailsForm;
