import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import { useConfirm } from '../../context/ConfirmContext';
import { formatInr, previewLine, STATUS_LABEL, today } from '../../utils/staffBilling';

type Row = {
  period: string; label: string; status: string; exPaise: number; gstPaise: number; totalPaise: number; gstInclusive?: boolean;
  invoiceNumber: string; invoiceUrl: string; paidOn: string | null; paidModeLabel: string; paidReference: string; note: string;
};
type Data = {
  settings: { monthlyAmountInr: number | null; gstInclusive: boolean; gstPercent: number; serviceStart: string };
  paidModes: Array<{ value: string; label: string }>;
  rows: Row[];
  totals: { billedPaise: number; paidPaise: number; outstandingPaise: number; notInvoicedPaise: number };
};

const CHIP: Record<string, string> = {
  not_invoiced: 'bg-slate-100 text-slate-700', invoiced: 'bg-sky-100 text-sky-800', overdue: 'bg-red-100 text-red-800',
  paid: 'bg-emerald-100 text-emerald-800', void: 'bg-slate-200 text-slate-500'
};
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const lab = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1';

/** The monthly ledger of one managed client: the fixed amount and GST mode, each month's invoice, and how it was paid. */
const StaffBilling: React.FC<{ id: string }> = ({ id }) => {
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [inclusive, setInclusive] = useState(false);
  const [rate, setRate] = useState('18');
  const [start, setStart] = useState('');
  const [open, setOpen] = useState<{ kind: 'invoice' | 'paid'; row: Row } | null>(null);
  const [form, setForm] = useState({ invoiceNumber: '', invoiceUrl: '', issuedOn: '', amountInr: '', paidOn: today(), mode: 'bank', reference: '' });

  const load = useCallback(() => {
    apiService.staffBilling(id).then((d: Data) => {
      setData(d);
      setAmount(d.settings.monthlyAmountInr ? String(d.settings.monthlyAmountInr) : '');
      setInclusive(Boolean(d.settings.gstInclusive));
      setRate(String(d.settings.gstPercent));
      setStart(d.settings.serviceStart || '');
    }).catch((e) => setError(customerMessage(e)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setNote('');
    try { const res = await fn(); setNote(res.success ? ok : (res.message || 'That did not work.')); if (res.success) { setOpen(null); load(); } }
    catch (e) { setNote(customerMessage(e)); }
    setBusy(false);
  };

  const saveSettings = () => run(() => apiService.staffBillingSettings(id, { monthlyAmountInr: Number(amount), gstInclusive: inclusive, gstPercent: Number(rate), serviceStart: start }), 'Billing details saved.');
  const submit = () => {
    if (!open) return;
    const base = { invoiceNumber: form.invoiceNumber.trim(), invoiceUrl: form.invoiceUrl.trim() || undefined, issuedOn: form.issuedOn || undefined, amountInr: form.amountInr.trim() ? Number(form.amountInr) : undefined };
    if (open.kind === 'invoice') return run(() => apiService.staffBillingInvoice(id, open.row.period, base), 'Invoice linked.');
    return run(() => apiService.staffBillingPaid(id, open.row.period, { ...base, invoiceNumber: base.invoiceNumber || undefined, paidOn: form.paidOn, mode: form.mode, reference: form.reference }), 'Marked as paid.');
  };
  const openForm = (kind: 'invoice' | 'paid', row: Row) => {
    setForm({ invoiceNumber: row.invoiceNumber || '', invoiceUrl: row.invoiceUrl || '', issuedOn: '', amountInr: '', paidOn: today(), mode: 'bank', reference: '' });
    setOpen({ kind, row });
  };
  const undo = async (row: Row) => { if (await confirm(`Undo the payment for ${row.label}? The month goes back to invoiced.`, { title: 'Undo payment', confirmLabel: 'Undo' })) run(() => apiService.staffBillingUnpay(id, row.period), 'Payment undone.'); };
  const cancelMonth = async (row: Row, voided: boolean) => {
    if (voided && !(await confirm(`Cancel ${row.label}? It will not be billed and will not count in the totals.`, { title: 'Cancel this month', confirmLabel: 'Cancel month', danger: true }))) return;
    run(() => apiService.staffBillingVoid(id, row.period, voided), voided ? 'Month cancelled.' : 'Month restored.');
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-[#F5A623]" /></div>;
  const preview = previewLine(Number(amount), Number(rate), inclusive);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        {[['Paid', data.totals.paidPaise], ['Outstanding', data.totals.outstandingPaise], ['Not invoiced yet', data.totals.notInvoicedPaise], ['Billed so far', data.totals.billedPaise]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{k}</div><div className="font-semibold text-slate-900 tabular-nums">{formatInr(Number(v))}</div></div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Monthly amount</h3>
        <div className="grid sm:grid-cols-4 gap-3">
          <div><label className={lab} htmlFor="bl-amount">Amount each month (₹)</label><input id="bl-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} className={field} placeholder="25000" /></div>
          <div>
            <span className={lab}>GST</span>
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm" role="radiogroup" aria-label="GST">
              <button type="button" role="radio" aria-checked={!inclusive} onClick={() => setInclusive(false)} className={`px-3 py-2 ${!inclusive ? 'bg-[#F5A623] font-semibold text-black' : 'bg-white text-slate-700'}`}>Add on top</button>
              <button type="button" role="radio" aria-checked={inclusive} onClick={() => setInclusive(true)} className={`px-3 py-2 border-l border-slate-300 ${inclusive ? 'bg-[#F5A623] font-semibold text-black' : 'bg-white text-slate-700'}`}>Already included</button>
            </div>
          </div>
          <div><label className={lab} htmlFor="bl-rate">GST rate</label><select id="bl-rate" value={rate} onChange={(e) => setRate(e.target.value)} className={field}>{[18, 12, 5, 28, 0].map((r) => <option key={r} value={r}>{r}%</option>)}</select></div>
          <div><label className={lab} htmlFor="bl-start">Service began</label><input id="bl-start" type="month" value={start} onChange={(e) => setStart(e.target.value)} className={field} /></div>
        </div>
        {preview && <p className="text-sm text-slate-700">{preview}</p>}
        <button disabled={busy || !amount || !start} onClick={saveSettings} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold disabled:opacity-50">Save</button>
      </div>

      {note && <p className="text-sm text-slate-800">{note}</p>}

      {data.rows.length === 0 ? <p className="text-sm text-slate-500">Set the monthly amount and the month service began, and the months will appear here.</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Month</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">GST</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Paid</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.period} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium text-slate-900">{r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(r.exPaise)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(r.gstPaise)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatInr(r.totalPaise)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td className="px-3 py-2">{r.invoiceNumber ? (r.invoiceUrl ? <a href={r.invoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#B45309] underline">{r.invoiceNumber}<ExternalLink className="w-3 h-3" /></a> : r.invoiceNumber) : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 text-slate-700">{r.status === 'paid' ? <>{r.paidOn ? new Date(r.paidOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}<div className="text-xs text-slate-500">{r.paidModeLabel}{r.paidReference ? ` · ${r.paidReference}` : ''}</div></> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right space-x-3">
                    {r.status !== 'paid' && r.status !== 'void' && <button disabled={busy} onClick={() => openForm('invoice', r)} className="text-slate-700 underline">{r.invoiceNumber ? 'Change invoice' : 'Link invoice'}</button>}
                    {r.status !== 'paid' && r.status !== 'void' && <button disabled={busy} onClick={() => openForm('paid', r)} className="font-semibold text-emerald-700 underline">Mark paid</button>}
                    {r.status === 'paid' && <button disabled={busy} onClick={() => undo(r)} className="text-slate-700 underline">Undo</button>}
                    {r.status === 'void' && <button disabled={busy} onClick={() => cancelMonth(r, false)} className="text-slate-700 underline">Restore</button>}
                    {(r.status === 'not_invoiced' || r.status === 'invoiced' || r.status === 'overdue') && <button disabled={busy} onClick={() => cancelMonth(r, true)} className="text-slate-500 underline">Cancel month</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={open.kind === 'paid' ? 'Mark as paid' : 'Link invoice'}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900">{open.kind === 'paid' ? `Mark ${open.row.label} as paid` : `Link the invoice for ${open.row.label}`}</h3>
            <div><label className={lab} htmlFor="f-inv">Invoice number from Zoho Books{open.kind === 'paid' ? ' (optional)' : ''}</label><input id="f-inv" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className={field} placeholder="INV-000016" /></div>
            <div><label className={lab} htmlFor="f-url">Invoice link (optional)</label><input id="f-url" value={form.invoiceUrl} onChange={(e) => setForm({ ...form, invoiceUrl: e.target.value })} className={field} placeholder="https://..." /></div>
            {open.kind === 'invoice' && <div><label className={lab} htmlFor="f-date">Invoice date (optional)</label><input id="f-date" type="date" value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} className={field} /></div>}
            <div><label className={lab} htmlFor="f-amt">Amount for this month only (optional, in the client's GST mode)</label><input id="f-amt" inputMode="decimal" value={form.amountInr} onChange={(e) => setForm({ ...form, amountInr: e.target.value.replace(/[^0-9.]/g, '') })} className={field} placeholder={`Leave empty for ${formatInr(open.row.totalPaise)}`} /></div>
            {open.kind === 'paid' && (<>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lab} htmlFor="f-paid">Paid on</label><input id="f-paid" type="date" value={form.paidOn} max={today()} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} className={field} /></div>
                <div><label className={lab} htmlFor="f-mode">How</label><select id="f-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className={field}>{data.paidModes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
              </div>
              <div><label className={lab} htmlFor="f-ref">Reference, such as the bank UTR or cheque number (optional)</label><input id="f-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={field} /></div>
            </>)}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(null)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Cancel</button>
              <button disabled={busy || (open.kind === 'invoice' && !form.invoiceNumber.trim())} onClick={submit} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{open.kind === 'paid' ? 'Mark paid' : 'Save invoice'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffBilling;
