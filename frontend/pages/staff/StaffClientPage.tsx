import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, Check, Minus, AlertTriangle } from 'lucide-react';
import StaffBilling from './StaffBilling';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import PlatformIcon from '../../components/PlatformIcon';
import { ACCESS_LABEL, ATTENTION_LABEL, TIER_LABEL, whenLabel } from './staffLabels';
import { platformLabel } from '../../utils/platforms';
import { hideConfirm, hideNotice } from '../../utils/staffTools';
import { BANNER_TEXT, dayMonth, planBanner } from '../../utils/plan';
import type { PlanView } from '../../types';

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">{title}</h2>
    {children}
  </section>
);

const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-slate-100 last:border-0">
    <span className="text-slate-500">{label}</span><span className="text-slate-900 text-right">{value || '—'}</span>
  </div>
);

const ACTION_LABEL: Record<string, string> = {
  create_client: 'Added the client', mark_paying: 'Marked as a paying customer', mark_not_paying: 'Marked as not paying',
  billing_settings: 'Changed the billing details', billing_end: 'Stopped billing', billing_resume: 'Resumed billing', billing_link_invoice: 'Linked an invoice', billing_mark_paid: 'Recorded a payment', billing_undo_paid: 'Undid a payment',
  billing_void: 'Cancelled a billing period', billing_restore: 'Restored a billing period', billing_edit_dates: 'Changed billing dates',
  billing_zoho_sync: 'Linked invoices from Zoho Books', billing_zoho_invoice: 'Created an invoice in Zoho Books', bulk_add_quarks: 'Added Quarks', bulk_set_plan: 'Changed the plan', bulk_set_features: 'Changed the features',
  add_quarks: 'Added Quarks', disable_client: 'Switched the account off', enable_client: 'Switched the account on',
  assign_csm: 'Changed the CSM', rename_client: 'Changed the name', bulk_assign_csm: 'Changed the CSM', open_client: 'Opened the account', role_change: 'Changed a role',
  hide_client: 'Left the client out of the numbers', show_client: 'Counted the client in the numbers again'
};

/** One client on one page: summary, access, activity, connections, Quarks, money (Owner) and history. */
const StaffClientPage: React.FC<{ id: string }> = ({ id }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [csms, setCsms] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLParagraphElement>(null);
  // The result of an action is shown at the top of the page; bring it into view when the button was far below.
  useEffect(() => { if (note && noteRef.current) noteRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [note]);

  const [plan, setPlan] = useState<PlanView | null>(null);
  const [planNote, setPlanNote] = useState('');
  const loadPlan = () => apiService.getClientPlan(id).then(setPlan).catch(() => setPlan(null));
  useEffect(() => { loadPlan(); }, [id]);
  const refreshPlan = async () => {
    setBusy(true); setPlanNote('');
    try { const r = await apiService.refreshClientPlan(id); setPlanNote(r.success ? (r.message || 'The plan is being updated.') : (r.message || 'That did not work.')); await loadPlan(); }
    catch (e) { setPlanNote(customerMessage(e)); }
    setBusy(false);
  };

  const load = () => apiService.getStaffClient(id).then(setData).catch((e) => setError(customerMessage(e)));
  useEffect(() => { load(); }, [id]);
  useEffect(() => { if (data?.can?.assign_csm) apiService.getStaffCsms().then((r) => setCsms(r.csms || [])).catch(() => undefined); }, [data?.can?.assign_csm]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setNote('');
    try { const res = await fn(); setNote(res.success ? ok : (res.message || 'That did not work.')); if (res.success) await load(); }
    catch (e) { setNote(customerMessage(e)); }
    setBusy(false);
  };

  const open = async (to = '#/dashboard') => {
    setBusy(true); setNote('');
    try {
      const res = await apiService.staffOpenClient(id);
      if (res.success) { window.location.hash = to; window.location.reload(); } else setNote(res.message || 'Could not open the account.');
    } catch (e) { setNote(customerMessage(e)); }
    setBusy(false);
  };

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" /></div>;
  const c = data.client;
  const can = data.can;
  const statusText = c.status === 'disabled' ? 'Switched off' : c.status === 'active' ? 'Active' : 'Inactive';

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/staff/clients')} className="inline-flex items-center gap-1 text-sm text-slate-600"><ArrowLeft className="w-4 h-4" /> All clients</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{c.name}{can.set_plan && (
            <button disabled={busy} onClick={() => { const n = window.prompt('Business name for this client', c.business?.name || c.name); if (n && n.trim() && n.trim() !== c.name) run(() => apiService.staffRenameClient(id, n.trim()), 'Name changed.'); }} className="ml-3 align-middle text-sm font-semibold text-slate-600 underline disabled:opacity-50">Change name</button>
          )}</h2>
          <p className="text-sm text-slate-500">{c.email}{c.mobile ? ` · ${c.mobile}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can.open_client && c.status !== 'disabled' && <button disabled={busy} onClick={() => open()} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black font-bold text-sm disabled:opacity-50">Open account</button>}
          {can.toggle_client && (
            <button disabled={busy} onClick={() => { if (window.confirm(c.status === 'disabled' ? 'Switch this account on again?' : 'Switch this account off? The client will not be able to sign in.')) run(() => apiService.staffToggleClient(id, c.status === 'disabled'), c.status === 'disabled' ? 'Account switched on.' : 'Account switched off.'); }} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 disabled:opacity-50">
              {c.status === 'disabled' ? 'Switch on' : 'Switch off'}
            </button>
          )}
          {can.hide_client && (
            <button disabled={busy} onClick={async () => {
              const hide = !c.hidden;
              if (!window.confirm(hideConfirm(c.name, hide))) return;
              setBusy(true); setNote('');
              try { const res = await apiService.staffSetHidden(id, hide); setNote(hideNotice(res)); if (res.success) await load(); }
              catch (e) { setNote(customerMessage(e)); }
              setBusy(false);
            }} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 disabled:opacity-50">
              {c.hidden ? 'Count in the numbers' : 'Leave out of the numbers'}
            </button>
          )}
        </div>
      </div>
      {note && <p ref={noteRef} role="status" className="text-sm font-semibold text-slate-800">{note}</p>}

      {c.attention.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="w-4 h-4" /> Needs attention</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">{c.attention.map((r: string) => <li key={r}>{ATTENTION_LABEL[r] || r}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Plan">
          {!plan ? <p className="text-sm text-slate-500">The plan could not be loaded.</p> : (() => {
            const st = planBanner(plan);
            const STATUS: Record<string, string> = { building: 'Being made', failed: 'Could not be made', stale: 'Out of date', ready: 'Up to date', profile_incomplete: 'Business profile incomplete', free: 'Free account, no plan', none: 'Not made yet' };
            const p = plan.plan?.result?.plan || {};
            const channels: string[] = (p.channels || []).slice(0, 3).map((ch: any) => String(ch.channel));
            return (
              <>
                <Row label="Status" value={STATUS[st]} />
                <Row label="Made on" value={plan.plan?.completedAt ? dayMonth(plan.plan.completedAt) : ''} />
                {st === 'profile_incomplete' && plan.missing.length > 0 && <Row label="Missing" value={plan.missing.join(', ')} />}
                {st === 'free' && <p className="pt-2 text-sm text-slate-600">{BANNER_TEXT.free}</p>}
                {p.promise?.text && <Row label="Promise" value={p.promise.text} />}
                {channels.length > 0 && <Row label="Top channels" value={channels.join(', ')} />}
                <div className="flex flex-wrap gap-2 pt-3">
                  {plan.eligible && !plan.running && <button disabled={busy} onClick={refreshPlan} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 disabled:opacity-50">Refresh plan</button>}
                  {can.open_client && c.status !== 'disabled' && plan.plan && <button disabled={busy} onClick={() => open('#/plan')} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 disabled:opacity-50">Open the full plan</button>}
                </div>
                {planNote && <p role="status" className="pt-2 text-sm font-semibold text-slate-800">{planNote}</p>}
              </>
            );
          })()}
        </Card>
        <Card title="Summary">
          <Row label="Status" value={statusText} />
          {c.hidden && <Row label="Numbers" value="Left out of the numbers" />}
          <Row label="Business" value={c.business?.name} />
          <Row label="Industry" value={c.business?.industry} />
          <Row label="Website" value={c.business?.website} />
          <Row label="Location" value={c.business?.location} />
          <Row label="Signed up" value={c.signedUpAt ? new Date(c.signedUpAt).toLocaleDateString() : ''} />
          <Row label="Last active" value={whenLabel(c.lastActiveAt)} />
          <Row label="Onboarding" value={c.onboardingCompleted ? 'Finished' : 'Not finished'} />
          <div className="flex items-center justify-between gap-3 pt-2 text-sm">
            <span className="text-slate-500">CSM</span>
            {can.assign_csm ? (
              <select disabled={busy} value={c.csm?.id || ''} onChange={(e) => run(() => apiService.staffAssignCsm(id, e.target.value || null), 'CSM updated.')} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <option value="">None</option>
                {c.csm && !csms.some((m) => m.id === c.csm.id) && <option value={c.csm.id}>{c.csm.name}</option>}
                {csms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : <span className="text-slate-900">{c.csm?.name || '—'}</span>}
          </div>
        </Card>

        <Card title="Plan and access">
          <Row label="Plan" value={`${TIER_LABEL[c.tier] || c.tier}${c.paying ? ' · paying' : c.trial ? ' · on trial' : ''}`} />
          <Row label="Add-ons" value={c.addons.length ? c.addons.join(', ') : 'None'} />
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-sm">
            {ACCESS_LABEL.map((a) => (
              <span key={a.key} className={`inline-flex items-center gap-1.5 ${c.access[a.key] ? 'text-emerald-700' : 'text-slate-400'}`}>
                {c.access[a.key] ? <Check className="w-4 h-4" /> : <Minus className="w-4 h-4" />} {a.label}{c.access[a.key] ? '' : ' (not in the plan)'}
              </span>
            ))}
          </div>
        </Card>

        <Card title="Connected accounts">
          {c.connections.length === 0 ? <p className="text-sm text-slate-500">No social account is connected.</p> : (
            <div className="flex flex-wrap gap-3">{c.connections.map((p: string) => <span key={p} className="inline-flex items-center gap-2 text-sm text-slate-800"><PlatformIcon platform={p} className="w-4 h-4" /> {platformLabel(p)}</span>)}</div>
          )}
        </Card>

        <Card title="Quarks">
          <p className="text-3xl font-semibold tabular-nums text-slate-900">{c.quarks.toLocaleString()}</p>
          {can.add_quarks && (
            <div className="mt-3 flex gap-2">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="Quarks to add" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button disabled={busy || !amount} onClick={() => run(async () => { const r = await apiService.staffAddQuarks(id, Number(amount)); if (r.success) setAmount(''); return r; }, 'Quarks added.')} className="px-3 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold disabled:opacity-50">Add Quarks</button>
            </div>
          )}
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {c.recentQuarks.length === 0 && <li>No Quark activity yet.</li>}
            {c.recentQuarks.map((h: any, i: number) => <li key={i}>{h.description || h.action} ({h.amount > 0 ? '+' : ''}{h.amount ?? '—'}) · {whenLabel(h.at)}</li>)}
          </ul>
        </Card>

        <Card title="Activity, last 30 days">
          {c.featureUse30d.length === 0 && Object.keys(c.drafts30d).length === 0 ? <p className="text-sm text-slate-500">No activity in the last 30 days.</p> : (
            <>
              <ul className="space-y-1 text-sm">{c.featureUse30d.map((f: any) => <li key={f.feature} className="flex justify-between"><span className="text-slate-700">{f.feature.replace(/_/g, ' ')}</span><span className="tabular-nums text-slate-900">{f.count}</span></li>)}</ul>
              {Object.keys(c.drafts30d).length > 0 && <p className="mt-3 text-xs text-slate-500">Posts: {Object.entries(c.drafts30d).map(([s, n]) => `${n} ${s}`).join(', ')}</p>}
            </>
          )}
        </Card>

        {can.manage_billing && c.tier === 'managed' && (
          <div className="md:col-span-2"><Card title="Billing"><StaffBilling id={id} /></Card></div>
        )}
        {c.money && (
          <Card title="Money">
            {c.money.subscriptions.length > 0 && <p className="text-sm mb-2 text-slate-700">Subscriptions: {c.money.subscriptions.map((s: any) => `${s.key || s.kind}${s.active ? '' : ' (not active)'}`).join(', ')}</p>}
            {c.money.payments.length === 0 ? <p className="text-sm text-slate-500">No payments yet.</p> : (
              <ul className="space-y-1 text-sm">{c.money.payments.map((p: any, i: number) => <li key={i} className="flex justify-between"><span className="text-slate-700">{p.item || 'Payment'} · {p.status}</span><span className="tabular-nums text-slate-900">{p.currency || 'INR'} {Number(p.amount || 0).toLocaleString('en-IN')} · {whenLabel(p.at)}</span></li>)}</ul>
            )}
          </Card>
        )}

        <Card title="History">
          {c.history.length === 0 ? <p className="text-sm text-slate-500">No staff actions yet.</p> : (
            <ul className="space-y-1 text-sm">{c.history.map((h: any, i: number) => <li key={i} className="text-slate-700">{ACTION_LABEL[h.action] || h.action}{h.details?.amount ? ` (${h.details.amount})` : ''} · {h.by || 'Staff'} · {whenLabel(h.at)}</li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
};

export default StaffClientPage;
