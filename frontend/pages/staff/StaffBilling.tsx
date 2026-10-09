import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import { useConfirm } from '../../context/ConfirmContext';
import { formatInr, previewLine, STATUS_LABEL, today } from '../../utils/staffBilling';

type Payment = { amountPaise: number; paidDate: string; modeLabel: string; reference: string };
type Row = {
  period: string; label: string; months: number; cycleLabel: string; planName: string; status: string; late?: boolean;
  exPaise: number; gstPaise: number; totalPaise: number; paidPaise: number; balancePaise: number; balanceDueOn?: string; payments: Payment[];
  invoiceDate?: string; dueDate?: string; paidDate?: string; invoiceNumber: string; invoiceUrl: string; zohoInvoiceId?: string;
  paidOn: string | null; paidModeLabel: string; paidReference: string; note: string;
};
type Data = {
  zohoOrgId?: string;
  nextInvoiceDate?: string;
  settings: { monthlyAmountInr: number | null; gstInclusive: boolean; gstPercent: number; billingStart: string; termsDays: number; autoInvoice: boolean; cycleMonths: number; planName: string; zohoItemId: string };
  paidModes: Array<{ value: string; label: string }>;
  rows: Row[];
  totals: { billedPaise: number; paidPaise: number; outstandingPaise: number; notInvoicedPaise: number };
};
type Item = { itemId: string; name: string; description: string; ratePaise: number };

const CHIP: Record<string, string> = {
  not_invoiced: 'bg-slate-100 text-slate-700', invoiced: 'bg-sky-100 text-sky-800', overdue: 'bg-red-100 text-red-800',
  partial: 'bg-amber-100 text-amber-800', paid: 'bg-emerald-100 text-emerald-800', void: 'bg-slate-200 text-slate-500'
};
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const lab = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1';
const COMMON = ['1', '3', '6', '12'];
const CYCLE_NAME: Record<string, string> = { '1': 'Monthly', '3': 'Quarterly', '6': 'Half-yearly', '12': 'Yearly' };

const fmtDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const monthsFrom = (choice: string, other: string) => (choice === 'other' ? Number(other) : Number(choice));

/** The billing of one managed client: the plan, price and frequency, each billing period's invoice, and every payment received. */
const StaffBilling: React.FC<{ id: string }> = ({ id }) => {
  const confirm = useConfirm();
  const [data, setData] = useState<Data | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // settings
  const [amount, setAmount] = useState('');
  const [inclusive, setInclusive] = useState(false);
  const [rate, setRate] = useState('18');
  const [start, setStart] = useState('');
  const [terms, setTerms] = useState('15');
  const [auto, setAuto] = useState(false);
  const [plan, setPlan] = useState('');
  const [itemId, setItemId] = useState('');
  const [cycle, setCycle] = useState('1');
  const [cycleOther, setCycleOther] = useState('');
  // dialogs
  const [dates, setDates] = useState<{ row: Row; invoiceDate: string; dueDate: string; paidDate: string } | null>(null);
  const [open, setOpen] = useState<{ kind: 'invoice' | 'paid'; row: Row } | null>(null);
  const [createInZoho, setCreateInZoho] = useState(true);
  const [find, setFind] = useState('');
  const [found, setFound] = useState<Array<{ invoiceNumber: string; customerName: string; date: string; status: string; totalPaise: number }>>([]);
  const [sync, setSync] = useState<null | { proposals: Array<{ period: string; label: string; invoiceNumber: string; zohoStatus: string; action: string; reason: string; totalPaise: number; paidPaise?: number }>; willLink: number; found: number }>(null);
  const [form, setForm] = useState({ invoiceNumber: '', invoiceUrl: '', issuedOn: '', amountInr: '', paymentAmountInr: '', paidOn: today(), mode: 'bank', reference: '', balanceDueOn: '', monthsChoice: '1', monthsOther: '' });

  const load = useCallback(() => {
    apiService.staffBilling(id).then((d: Data) => {
      setData(d);
      const s = d.settings;
      setAmount(s.monthlyAmountInr ? String(s.monthlyAmountInr) : '');
      setInclusive(Boolean(s.gstInclusive)); setRate(String(s.gstPercent)); setStart(s.billingStart || '');
      setTerms(String(s.termsDays ?? 15)); setAuto(Boolean(s.autoInvoice)); setPlan(s.planName || ''); setItemId(s.zohoItemId || '');
      const m = String(s.cycleMonths || 1);
      if (COMMON.includes(m)) { setCycle(m); setCycleOther(''); } else { setCycle('other'); setCycleOther(m); }
    }).catch((e) => setError(customerMessage(e)));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiService.staffZohoItems().then((r: any) => setItems(r.items || [])).catch(() => undefined); }, []);

  const run = async (fn: () => Promise<any>, ok: string | ((res: any) => string)) => {
    setBusy(true); setNote('');
    try { const res = await fn(); setNote(res.success ? (typeof ok === 'function' ? ok(res) : ok) : (res.message || 'That did not work.')); if (res.success) { setOpen(null); setSync(null); setDates(null); load(); } }
    catch (e) { setNote(customerMessage(e)); }
    setBusy(false);
  };

  const cycleMonths = monthsFrom(cycle, cycleOther);
  const saveSettings = () => run(() => apiService.staffBillingSettings(id, { monthlyAmountInr: Number(amount), gstInclusive: inclusive, gstPercent: Number(rate), billingStart: start, termsDays: Number(terms), autoInvoice: auto, cycleMonths, planName: plan, zohoItemId: itemId }), 'Billing details saved.');
  const pickPlan = (text: string) => { setPlan(text); const hit = items.find((i) => i.name.toLowerCase() === text.trim().toLowerCase()); setItemId(hit ? hit.itemId : ''); };
  const saveDates = () => dates && run(() => apiService.staffBillingDates(id, dates.row.period, { invoiceDate: dates.invoiceDate || undefined, dueDate: dates.dueDate || undefined, paidDate: dates.paidDate || undefined }), (r) => (r.note ? `Dates changed. ${r.note}` : 'Dates changed.'));

  const submit = () => {
    if (!open) return;
    const base = { invoiceNumber: form.invoiceNumber.trim(), invoiceUrl: form.invoiceUrl.trim() || undefined, issuedOn: form.issuedOn || undefined, amountInr: form.amountInr.trim() ? Number(form.amountInr) : undefined, months: !open.row.invoiceNumber ? monthsFrom(form.monthsChoice, form.monthsOther) || undefined : undefined };
    if (open.kind === 'invoice') return run(() => apiService.staffBillingInvoice(id, open.row.period, base), 'Invoice linked.');
    return run(() => apiService.staffBillingPaid(id, open.row.period, {
      ...base, invoiceNumber: base.invoiceNumber || undefined, paidOn: form.paidOn, mode: form.mode, reference: form.reference,
      paymentAmountInr: form.paymentAmountInr.trim() ? Number(form.paymentAmountInr) : undefined, balanceDueOn: form.balanceDueOn || undefined,
      createInZoho: !open.row.invoiceNumber && !base.invoiceNumber ? createInZoho : undefined
    }), (res) => (res.zoho?.warning ? res.zoho.warning : res.partial ? `Payment recorded. Balance left: ${formatInr(res.balancePaise)}.${res.zoho?.created ? ` Invoice ${res.zoho.invoiceNumber} was created in Zoho Books.` : ''}` : res.zoho?.created ? `Paid in full. Invoice ${res.zoho.invoiceNumber} was created in Zoho Books and the payment recorded there.` : 'Paid in full.'));
  };
  const openForm = (kind: 'invoice' | 'paid', row: Row) => {
    const m = String(row.months || 1);
    setForm({ invoiceNumber: row.invoiceNumber || '', invoiceUrl: row.invoiceUrl || '', issuedOn: '', amountInr: '', paymentAmountInr: '', paidOn: today(), mode: 'bank', reference: '', balanceDueOn: row.balanceDueOn || '', monthsChoice: COMMON.includes(m) ? m : 'other', monthsOther: COMMON.includes(m) ? '' : m });
    setCreateInZoho(true); setFind(''); setFound([]);
    setOpen({ kind, row });
  };
  const search = async (q: string) => {
    setFind(q);
    if (q.trim().length < 2) { setFound([]); return; }
    try { const r = await apiService.staffZohoSearch(q.trim()); setFound(r.invoices || []); } catch { setFound([]); }
  };
  const previewSync = async () => {
    setBusy(true); setNote('');
    try { const r = await apiService.staffBillingSync(id, false); if (r.success) setSync({ proposals: r.proposals, willLink: r.willLink, found: r.found }); else setNote(r.message || 'Could not read Zoho Books.'); }
    catch (e) { setNote(customerMessage(e)); }
    setBusy(false);
  };
  const applySync = () => run(() => apiService.staffBillingSync(id, true), (r) => `${r.linked} ${r.linked === 1 ? 'period' : 'periods'} linked from Zoho Books.`);
  const createZoho = (row: Row) => run(() => apiService.staffBillingZohoInvoice(id, row.period), (r) => `Invoice ${r.invoiceNumber} created in Zoho Books for ${row.label}.`);
  const undo = async (row: Row) => { if (await confirm(`Undo the latest payment for ${row.label}?`, { title: 'Undo payment', confirmLabel: 'Undo' })) run(() => apiService.staffBillingUnpay(id, row.period), 'Payment undone.'); };
  const cancelMonth = async (row: Row, voided: boolean) => {
    if (voided && !(await confirm(`Cancel ${row.label}? It will not be billed and will not count in the totals.`, { title: 'Cancel this period', confirmLabel: 'Cancel period', danger: true }))) return;
    run(() => apiService.staffBillingVoid(id, row.period, voided), voided ? 'Period cancelled.' : 'Period restored.');
  };

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-[#F5A623]" /></div>;
  const preview = previewLine(Number(amount), Number(rate), inclusive);
  const startDay = start ? new Date(`${start}T00:00:00`).getDate() : 0;
  const ordinal = [1, 21, 31].includes(startDay) ? 'st' : [2, 22].includes(startDay) ? 'nd' : [3, 23].includes(startDay) ? 'rd' : 'th';
  const cycleBad = cycle === 'other' && !(Number.isInteger(cycleMonths) && cycleMonths >= 1 && cycleMonths <= 36);
  const payRow = open?.kind === 'paid' ? open.row : null;
  const amountNow = form.paymentAmountInr.trim() ? Number(form.paymentAmountInr) : null;
  const partialNow = payRow && amountNow !== null && Math.round(amountNow * 100) < payRow.balancePaise;

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-4 gap-3">
        {[['Received', data.totals.paidPaise], ['Still to receive', data.totals.outstandingPaise], ['Not invoiced yet', data.totals.notInvoicedPaise], ['Billed so far', data.totals.billedPaise]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{k}</div><div className="font-semibold text-slate-900 tabular-nums">{formatInr(Number(v))}</div></div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Plan and price</h3>
        <div className="grid sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className={lab} htmlFor="bl-plan">Plan (type any name, or pick from Zoho)</label>
            <input id="bl-plan" list="bl-plans" value={plan} onChange={(e) => pickPlan(e.target.value)} className={field} placeholder="For example SCALE, or a custom plan" maxLength={80} />
            <datalist id="bl-plans">{items.map((i) => <option key={i.itemId} value={i.name}>{i.ratePaise ? formatInr(i.ratePaise) : ''}</option>)}</datalist>
          </div>
          <div>
            <label className={lab} htmlFor="bl-cycle">Billed</label>
            <select id="bl-cycle" value={cycle} onChange={(e) => setCycle(e.target.value)} className={field}>
              {COMMON.map((m) => <option key={m} value={m}>{CYCLE_NAME[m]}</option>)}
              <option value="other">Every … months</option>
            </select>
          </div>
          {cycle === 'other' && <div><label className={lab} htmlFor="bl-other">Number of months</label><input id="bl-other" inputMode="numeric" value={cycleOther} onChange={(e) => setCycleOther(e.target.value.replace(/[^0-9]/g, ''))} className={field} placeholder="1 to 36" /></div>}
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <div><label className={lab} htmlFor="bl-amount">Amount each time they pay (₹)</label><input id="bl-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} className={field} placeholder="25000" /></div>
          <div>
            <span className={lab}>GST</span>
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm" role="radiogroup" aria-label="GST">
              <button type="button" role="radio" aria-checked={!inclusive} onClick={() => setInclusive(false)} className={`px-3 py-2 ${!inclusive ? 'bg-[#F5A623] font-semibold text-black' : 'bg-white text-slate-700'}`}>Add on top</button>
              <button type="button" role="radio" aria-checked={inclusive} onClick={() => setInclusive(true)} className={`px-3 py-2 border-l border-slate-300 ${inclusive ? 'bg-[#F5A623] font-semibold text-black' : 'bg-white text-slate-700'}`}>Already included</button>
            </div>
          </div>
          <div><label className={lab} htmlFor="bl-rate">GST rate</label><select id="bl-rate" value={rate} onChange={(e) => setRate(e.target.value)} className={field}>{[18, 12, 5, 28, 0].map((r) => <option key={r} value={r}>{r}%</option>)}</select></div>
          <div><label className={lab} htmlFor="bl-start">Billing starts on</label><input id="bl-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} /></div>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <div><label className={lab} htmlFor="bl-terms">Pay within (days)</label><input id="bl-terms" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value.replace(/[^0-9]/g, ''))} className={field} /></div>
        </div>
        {preview && <p className="text-sm text-slate-700">{preview.replace('a month', cycle === '1' ? 'a month' : `every ${cycleMonths || '…'} months`)}</p>}
        <p className="text-xs text-slate-500">Discounted or special price? Enter what they actually pay. For one period only, type a different amount when you link the invoice or record the payment. {startDay ? `The invoice date is the ${startDay}${ordinal} (the last day in a shorter month).` : ''}</p>
        <label className="flex items-start gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-0.5" />
          <span>Create each invoice in Zoho Books automatically on the invoice date<span className="block text-xs text-slate-500">Starts from the next invoice date and never goes back to earlier periods.{data.nextInvoiceDate && auto ? ` Next invoice: ${fmtDate(data.nextInvoiceDate)}.` : ''}</span></span>
        </label>
        <button disabled={busy || !amount || !start || !terms || cycleBad} onClick={saveSettings} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold disabled:opacity-50">Save</button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy} onClick={previewSync} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 inline-flex items-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Sync from Zoho Books</button>
        <span className="text-xs text-slate-500">Finds this client's invoices in Zoho Books (by email or business name) and fills in the periods, with what has been paid. You see what will change first.</span>
      </div>
      {note && <p className="text-sm text-slate-800">{note}</p>}

      {data.rows.length === 0 ? <p className="text-sm text-slate-500">Set the amount and the date billing starts, and the billing periods will appear here.</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Period</th><th className="px-3 py-2">Invoice date</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">GST</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Payments</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <React.Fragment key={r.period}>
                <tr className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium text-slate-900">{r.label}<div className="text-xs font-normal text-slate-500">{r.cycleLabel}{r.planName ? ` · ${r.planName}` : ''}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700">{r.invoiceDate ? fmtDate(r.invoiceDate) : '—'}{r.dueDate && r.status !== 'paid' && r.status !== 'void' ? <div className="text-xs text-slate-500">due {fmtDate(r.dueDate)}</div> : null}{!r.invoiceNumber && r.status === 'not_invoiced' && r.invoiceDate ? <div className="text-xs text-slate-400">planned</div> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(r.exPaise)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInr(r.gstPaise)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatInr(r.totalPaise)}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP[r.status]}`}>{STATUS_LABEL[r.status]}</span>{r.late && <div className="text-xs font-semibold text-red-700 mt-1">balance late</div>}</td>
                  <td className="px-3 py-2">{r.invoiceNumber ? (r.invoiceUrl || (r.zohoInvoiceId && data.zohoOrgId) ? <a href={r.invoiceUrl || `https://books.zoho.in/app/${data.zohoOrgId}#/invoices/${r.zohoInvoiceId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#B45309] underline">{r.invoiceNumber}<ExternalLink className="w-3 h-3" /></a> : r.invoiceNumber) : <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {r.payments.length === 0 ? <span className="text-slate-400">—</span> : (
                      <div className="space-y-0.5 text-xs">
                        {r.payments.map((p, i) => <div key={i}>{formatInr(p.amountPaise)} · {p.paidDate ? fmtDate(p.paidDate) : ''}<span className="text-slate-500"> · {p.modeLabel}{p.reference ? ` · ${p.reference}` : ''}</span></div>)}
                        {r.status === 'partial' && <div className="font-semibold text-amber-800">Balance {formatInr(r.balancePaise)}{r.balanceDueOn ? ` · expected ${fmtDate(r.balanceDueOn)}` : ''}</div>}
                      </div>
                    )}
                  </td>
                </tr>
                <tr><td colSpan={8} className="px-3 pb-3"><div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {r.invoiceNumber && r.status !== 'void' && <button disabled={busy} onClick={() => setDates({ row: r, invoiceDate: r.invoiceDate || '', dueDate: r.dueDate || '', paidDate: r.paidDate || '' })} className="text-slate-700 underline">Edit dates</button>}
                    {!r.invoiceNumber && r.status !== 'void' && <button disabled={busy} onClick={() => createZoho(r)} className="text-slate-700 underline">Create invoice in Zoho</button>}
                    {r.status !== 'paid' && r.status !== 'void' && <button disabled={busy} onClick={() => openForm('invoice', r)} className="text-slate-700 underline">{r.invoiceNumber ? 'Change invoice' : 'Link invoice'}</button>}
                    {r.status !== 'paid' && r.status !== 'void' && <button disabled={busy} onClick={() => openForm('paid', r)} className="font-semibold text-emerald-700 underline">Record payment</button>}
                    {(r.status === 'paid' || r.status === 'partial') && <button disabled={busy} onClick={() => undo(r)} className="text-slate-700 underline">Undo last payment</button>}
                    {r.status === 'void' && <button disabled={busy} onClick={() => cancelMonth(r, false)} className="text-slate-700 underline">Restore</button>}
                    {(r.status === 'not_invoiced' || r.status === 'invoiced' || r.status === 'overdue') && <button disabled={busy} onClick={() => cancelMonth(r, true)} className="text-slate-500 underline">Cancel period</button>}
                </div></td></tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Edit dates">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-lg font-semibold text-slate-900">Dates for {dates.row.label}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lab} htmlFor="d-inv">Invoice date</label><input id="d-inv" type="date" value={dates.invoiceDate} onChange={(e) => setDates({ ...dates, invoiceDate: e.target.value })} className={field} /></div>
              <div><label className={lab} htmlFor="d-due">Due date</label><input id="d-due" type="date" value={dates.dueDate} onChange={(e) => setDates({ ...dates, dueDate: e.target.value })} className={field} /></div>
            </div>
            {(dates.row.status === 'paid' || dates.row.status === 'partial') && <div><label className={lab} htmlFor="d-paid">Date of the latest payment</label><input id="d-paid" type="date" max={today()} value={dates.paidDate} onChange={(e) => setDates({ ...dates, paidDate: e.target.value })} className={field} /></div>}
            {dates.row.zohoInvoiceId && <p className="text-xs text-slate-500">This invoice is in Zoho Books. Changing the dates here does not change them in Zoho Books; update them there too if they need to match.</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDates(null)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Cancel</button>
              <button disabled={busy} onClick={saveDates} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold disabled:opacity-50">Save dates</button>
            </div>
          </div>
        </div>
      )}

      {sync && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Sync from Zoho Books">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900">From Zoho Books</h3>
            {sync.found === 0 ? <p className="text-sm text-slate-700">No invoice was found for this client's email or business name. Use "Find it in Zoho Books" when you link an invoice, or check the email on the Zoho customer.</p> : (
              <ul className="divide-y divide-slate-100 text-sm rounded-lg border border-slate-200">
                {sync.proposals.map((p) => (
                  <li key={p.invoiceNumber} className="px-3 py-2 flex justify-between gap-3">
                    <span><span className="font-semibold">{p.invoiceNumber}</span> · {p.label} · {formatInr(p.totalPaise)}</span>
                    <span className={p.action === 'skip' ? 'text-slate-500 text-right' : 'text-emerald-700 font-semibold text-right'}>{p.action === 'link_paid' ? 'Will be marked paid' : p.action === 'link_partial' ? `Will be linked as part paid (${formatInr(p.paidPaise || 0)} received)` : p.action === 'link_invoiced' ? 'Will be linked as invoiced' : p.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setSync(null)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Close</button>
              {sync.willLink > 0 && <button disabled={busy} onClick={applySync} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold disabled:opacity-50">Link {sync.willLink} {sync.willLink === 1 ? 'period' : 'periods'}</button>}
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={open.kind === 'paid' ? 'Record payment' : 'Link invoice'}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-slate-900">{open.kind === 'paid' ? `Record a payment for ${open.row.label}` : `Link the invoice for ${open.row.label}`}</h3>
            {open.kind === 'paid' && open.row.paidPaise > 0 && <p className="text-sm text-slate-700">Already received {formatInr(open.row.paidPaise)} of {formatInr(open.row.totalPaise)}. Balance {formatInr(open.row.balancePaise)}.</p>}
            <div><label className={lab} htmlFor="f-inv">Invoice number from Zoho Books{open.kind === 'paid' ? ' (optional)' : ''}</label><input id="f-inv" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className={field} placeholder="INV-000016" /></div>
            {open.kind === 'invoice' && (
              <div>
                <label className={lab} htmlFor="f-find">Find it in Zoho Books</label>
                <input id="f-find" value={find} onChange={(e) => search(e.target.value)} className={field} placeholder="Type a customer name or invoice number" />
                {found.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 text-sm">
                    {found.map((f) => (
                      <li key={f.invoiceNumber}><button type="button" onClick={() => { setForm({ ...form, invoiceNumber: f.invoiceNumber, issuedOn: f.date }); setFind(''); setFound([]); }} className="w-full text-left px-3 py-2 hover:bg-slate-50"><span className="font-semibold">{f.invoiceNumber}</span> · {f.customerName} · {f.date} · {formatInr(f.totalPaise)} · {f.status}</button></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div><label className={lab} htmlFor="f-url">Invoice link (optional)</label><input id="f-url" value={form.invoiceUrl} onChange={(e) => setForm({ ...form, invoiceUrl: e.target.value })} className={field} placeholder="https://..." /></div>
            {open.kind === 'invoice' && <div><label className={lab} htmlFor="f-date">Invoice date (optional)</label><input id="f-date" type="date" value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} className={field} /></div>}
            <div><label className={lab} htmlFor="f-amt">Invoice amount for this period only (optional, in the client's GST mode)</label><input id="f-amt" inputMode="decimal" value={form.amountInr} onChange={(e) => setForm({ ...form, amountInr: e.target.value.replace(/[^0-9.]/g, '') })} className={field} placeholder={`Leave empty for ${formatInr(open.row.totalPaise)}`} /></div>
            {!open.row.invoiceNumber && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lab} htmlFor="f-cyc">This invoice covers</label><select id="f-cyc" value={form.monthsChoice} onChange={(e) => setForm({ ...form, monthsChoice: e.target.value })} className={field}>{COMMON.map((m) => <option key={m} value={m}>{CYCLE_NAME[m]} ({m} {m === '1' ? 'month' : 'months'})</option>)}<option value="other">Other number of months</option></select></div>
                {form.monthsChoice === 'other' && <div><label className={lab} htmlFor="f-cyo">Months</label><input id="f-cyo" inputMode="numeric" value={form.monthsOther} onChange={(e) => setForm({ ...form, monthsOther: e.target.value.replace(/[^0-9]/g, '') })} className={field} placeholder="1 to 36" /></div>}
              </div>
            )}
            {payRow && (<>
              <div><label className={lab} htmlFor="f-got">Amount received now (₹)</label><input id="f-got" inputMode="decimal" value={form.paymentAmountInr} onChange={(e) => setForm({ ...form, paymentAmountInr: e.target.value.replace(/[^0-9.]/g, '') })} className={field} placeholder={`Leave empty for the whole balance, ${formatInr(payRow.balancePaise)}`} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lab} htmlFor="f-paid">Paid on</label><input id="f-paid" type="date" value={form.paidOn} max={today()} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} className={field} /></div>
                <div><label className={lab} htmlFor="f-mode">How</label><select id="f-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className={field}>{data.paidModes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
              </div>
              <div><label className={lab} htmlFor="f-ref">Reference, such as the bank UTR or cheque number (optional)</label><input id="f-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={field} /></div>
              {partialNow && <div><label className={lab} htmlFor="f-bal">When is the balance expected? (optional)</label><input id="f-bal" type="date" value={form.balanceDueOn} onChange={(e) => setForm({ ...form, balanceDueOn: e.target.value })} className={field} /><p className="mt-1 text-xs text-slate-500">The rest stays as the balance. Record each later payment the same way.</p></div>}
              {!payRow.invoiceNumber && !form.invoiceNumber.trim() && (
                <label className="flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={createInZoho} onChange={(e) => setCreateInZoho(e.target.checked)} className="mt-0.5" /><span>Create the invoice in Zoho Books and record this payment there<span className="block text-xs text-slate-500">The invoice is for the full amount; only what you received now is recorded as paid. Turn it off if you will raise the invoice yourself.</span></span></label>
              )}
            </>)}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(null)} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700">Cancel</button>
              <button disabled={busy || (open.kind === 'invoice' && !form.invoiceNumber.trim())} onClick={submit} className="px-4 py-2 rounded-lg bg-[#F5A623] text-black text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">{busy && <Loader2 className="w-4 h-4 animate-spin" />}{open.kind === 'paid' ? 'Record payment' : 'Save invoice'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffBilling;
