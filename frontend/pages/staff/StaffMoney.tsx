import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import { niceMax } from '../../utils/staffHome';
import { FAILURE_KIND, PAYMENT_STATUS, formatInr, formatInrShort, formatUsd, gaugeShape, pageLabel, revenueSummary, shapeRevenueSeries, whenIst } from '../../utils/staffMoney';
import type { MoneySeries } from '../../utils/staffMoney';
import { ayrshareResetConfirm, ayrshareResetNotice, couponLine, validateCouponForm } from '../../utils/staffTools';
import type { CouponRow } from '../../utils/staffTools';

const LOAD_ERROR = 'We could not load the Money numbers. Please try again.';

type Window = { exGstPaise: number; gstPaise: number; unsplitPaise: number; totalPaise: number; count: number };
type PaymentRow = { id: string; at: string | null; clientId: string; clientName: string; what: string; totalPaise: number; exGstPaise: number | null; gstPaise: number | null; status: string };

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="mb-8">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gv-text-secondary)]">{title}</h2>
      {hint && <p className="text-xs text-[var(--gv-text-tertiary)]">{hint}</p>}
    </div>
    {children}
  </section>
);

const Tile: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode }> = ({ label, value, sub }) => (
  <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">
    <p className="text-xs font-semibold text-[var(--gv-text-tertiary)]">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--gv-text-primary)]">{value}</p>
    {sub && <div className="mt-1 text-xs text-[var(--gv-text-tertiary)]">{sub}</div>}
  </div>
);

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="mt-2 text-xs text-[var(--gv-text-tertiary)]">{children}</p>;

const Unavailable: React.FC<{ reason?: string }> = ({ reason }) => (
  <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="status"><AlertTriangle className="mr-1.5 inline h-4 w-4" aria-hidden="true" />Not available: {reason || 'this number could not be worked out.'}</p>
);

function revenueTile(label: string, w: Window | undefined) {
  const x = w || { exGstPaise: 0, gstPaise: 0, unsplitPaise: 0, totalPaise: 0, count: 0 };
  return (
    <Tile label={label} value={formatInr(x.exGstPaise)} sub={(
      <>
        <p>before GST · GST {formatInr(x.gstPaise)}</p>
        {x.unsplitPaise > 0 && <p>plus {formatInr(x.unsplitPaise)} in older payments with no GST split</p>}
        <p>Collected in total {formatInr(x.totalPaise)}</p>
        <p>{x.count} {x.count === 1 ? 'payment' : 'payments'}</p>
      </>
    )} />
  );
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    set();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Money collected per day: before-GST and GST stacked, so the total height is what was collected. */
const RevenueChart: React.FC<{ series: MoneySeries }> = ({ series }) => {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const days = series.days;
  const height = 200;
  const pad = { l: 46, r: 8, t: 10, b: 24 };
  const top = niceMax(Math.ceil(series.max / 100)) * 100; // scale in whole rupees so ticks are tidy
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = days.length ? iw / days.length : iw;
  const x = (i: number) => pad.l + slot * i + slot / 2;
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const barW = Math.max(3, Math.min(16, slot * 0.6));
  const ticks = [0, top / 2, top];
  const every = width < 420 ? 10 : 5;
  const focus = hover === null ? null : days[hover];
  const GAP = 2;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--gv-text-secondary)]">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--gv-accent-display)' }} aria-hidden="true" /> Before GST</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--gv-text-secondary)' }} aria-hidden="true" /> GST</span>
        {series.hasUnsplit && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-[var(--gv-text-secondary)]" style={{ background: 'var(--gv-panel)' }} aria-hidden="true" /> Not split</span>}
      </div>
      <div ref={ref} className="w-full">
        <svg width={width} height={height} role="img" aria-label={revenueSummary(series)} className="block max-w-full" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--gv-border-subtle)" strokeWidth="1" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--gv-text-tertiary)">{formatInrShort(t)}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const segs = [
              { v: d.exGst, fill: 'var(--gv-accent-display)', stroke: 'none' },
              { v: d.gst, fill: 'var(--gv-text-secondary)', stroke: 'none' },
              { v: d.unsplit, fill: 'var(--gv-panel)', stroke: 'var(--gv-text-secondary)' }
            ];
            let base = 0;
            return (
              <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.55}>
                {segs.map((s, k) => {
                  if (s.v <= 0) return null;
                  const yTop = y(base + s.v); const yBottom = y(base); const stacked = base > 0; base += s.v;
                  const h = Math.max(1, yBottom - yTop - (stacked ? GAP : 0));
                  return <rect key={k} x={x(i) - barW / 2} y={yTop} width={barW} height={h} rx="1.5" fill={s.fill} stroke={s.stroke} />;
                })}
              </g>
            );
          })}
          {days.map((d, i) => (i % every === 0 || i === days.length - 1) && (
            <text key={d.day} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--gv-text-tertiary)">{d.label}</text>
          ))}
          {days.map((d, i) => <rect key={`h${d.day}`} x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
        </svg>
      </div>
      <p className="mt-1 min-h-[1.25rem] text-xs text-[var(--gv-text-secondary)]" aria-live="polite">
        {focus ? `${focus.label}: ${formatInr(focus.total)} collected (before GST ${formatInr(focus.exGst)}, GST ${formatInr(focus.gst)}${focus.unsplit ? `, not split ${formatInr(focus.unsplit)}` : ''})` : 'Hover or tap a day for its amount.'}
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-semibold text-[var(--gv-accent-text)]">Show the numbers as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-[var(--gv-border-subtle)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--gv-bg)] text-[var(--gv-text-tertiary)]"><tr><th scope="col" className="px-3 py-1.5">Day</th><th scope="col" className="px-3 py-1.5">Before GST</th><th scope="col" className="px-3 py-1.5">GST</th>{series.hasUnsplit && <th scope="col" className="px-3 py-1.5">Not split</th>}<th scope="col" className="px-3 py-1.5">Collected</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.day} className="border-t border-[var(--gv-border-subtle)]"><td className="px-3 py-1">{d.label}</td><td className="px-3 py-1 tabular-nums">{formatInr(d.exGst)}</td><td className="px-3 py-1 tabular-nums">{formatInr(d.gst)}</td>{series.hasUnsplit && <td className="px-3 py-1 tabular-nums">{formatInr(d.unsplit)}</td>}<td className="px-3 py-1 tabular-nums">{formatInr(d.total)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
};

const CountBars: React.FC<{ rows: Array<{ id: string; label: string; count: number }>; unit: string }> = ({ rows, unit }) => {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id}>
          <div className="flex justify-between text-sm text-[var(--gv-text-primary)]"><span>{r.label}</span><span className="tabular-nums">{r.count.toLocaleString('en-IN')} {unit}</span></div>
          <div className="mt-1 h-2 rounded-full bg-[var(--gv-bg)]"><div className="h-2 rounded-full" style={{ width: `${max ? Math.max(r.count ? 3 : 0, Math.round((r.count / max) * 100)) : 0}%`, background: 'var(--gv-accent-display)' }} /></div>
        </li>
      ))}
    </ul>
  );
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${status === 'paid' ? 'border-emerald-300 text-emerald-800' : status === 'failed' ? 'border-red-400 text-red-800' : 'border-amber-400 text-amber-900'}`}>{PAYMENT_STATUS[status] || status}</span>
);


const FIELD = 'w-full rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] px-3 py-2 text-sm text-[var(--gv-text-primary)]';
const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-secondary)] disabled:opacity-50';

/** Reset Ayrshare IDs (Owner): after switching to a different Ayrshare account, forget every stored profile ID. */
const AyrshareReset: React.FC<{ profiles?: number; onDone: () => void }> = ({ profiles, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const run = async () => {
    if (!window.confirm(ayrshareResetConfirm(profiles))) return;
    setBusy(true); setNotice('');
    try {
      const res = await apiService.staffResetAyrshareIds();
      setNotice(ayrshareResetNotice(res));
      if (res && res.success) onDone();
    } catch (e) { setNotice(customerMessage(e, 'We could not reset the profile IDs. Please try again.')); }
    setBusy(false);
  };
  return (
    <div className="mt-4 border-t border-[var(--gv-border-subtle)] pt-4">
      <button type="button" onClick={run} disabled={busy} className={BTN}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Reset Ayrshare IDs</button>
      <p className="mt-2 text-xs text-[var(--gv-text-tertiary)]">Use only after switching to a different Ayrshare account. Clears every client's stored profile ID; posts, drafts and Quarks stay.</p>
      {notice && <p role="status" aria-live="polite" className="mt-2 text-sm font-semibold text-[var(--gv-text-primary)]">{notice}</p>}
    </div>
  );
};

/** Coupons (Owner): customers still enter these at checkout; here the Owner creates, switches off and deletes them. */
const Coupons: React.FC = () => {
  const [rows, setRows] = useState<CouponRow[] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ code: '', discountedAmount: '5000', maxUses: '1', note: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback(() => apiService.getStaffCoupons()
    .then((res) => { if (res && res.success === false) throw new Error(res.message); setRows(res.coupons || []); setError(''); })
    .catch((e) => setError(customerMessage(e, 'We could not load the coupons. Please try again.'))), []);
  useEffect(() => { load(); }, [load]);

  const act = async (work: () => Promise<any>, ok: string) => {
    setBusy(true); setNotice('');
    try { const res = await work(); if (res && res.success === false) throw new Error(res.message); setNotice(ok); await load(); return true; }
    catch (e) { setNotice(customerMessage(e, 'That did not work. Please try again.')); return false; }
    finally { setBusy(false); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = validateCouponForm(form);
    if (checked.ok === false) { setNotice(checked.message); return; }
    const done = await act(() => apiService.staffCreateCoupon(checked.payload), `Coupon ${checked.payload.code} was created.`);
    if (done) setForm({ code: '', discountedAmount: '5000', maxUses: '1', note: '' });
  };

  return (
    <div>
      <form onSubmit={create} className="grid grid-cols-1 gap-3 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4 min-[560px]:grid-cols-2 lg:grid-cols-5" noValidate>
        <label className="text-sm font-semibold text-[var(--gv-text-primary)]">Code<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} autoComplete="off" className={`${FIELD} mt-1 font-normal`} /></label>
        <label className="text-sm font-semibold text-[var(--gv-text-primary)]">Discounted price (INR)<input value={form.discountedAmount} onChange={(e) => setForm({ ...form, discountedAmount: e.target.value })} inputMode="numeric" className={`${FIELD} mt-1 font-normal`} /></label>
        <label className="text-sm font-semibold text-[var(--gv-text-primary)]">Times it can be used<input value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} inputMode="numeric" className={`${FIELD} mt-1 font-normal`} /></label>
        <label className="text-sm font-semibold text-[var(--gv-text-primary)] lg:col-span-1">Note<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={`${FIELD} mt-1 font-normal`} /></label>
        <div className="flex items-end"><button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#F5A623] px-4 py-2 text-sm font-bold text-black disabled:opacity-50">Create coupon</button></div>
      </form>
      {notice && <p role="status" aria-live="polite" className="mt-3 text-sm font-semibold text-[var(--gv-text-primary)]">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error} <button type="button" onClick={() => load()} className="font-semibold underline">Try again</button></p>}
      {rows && (rows.length === 0 ? <p className="mt-3 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-5 text-sm text-[var(--gv-text-secondary)]">No coupons yet.</p> : (
        <ul className="mt-3 divide-y divide-[var(--gv-border-subtle)] overflow-hidden rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
          {rows.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0"><p className="font-mono text-sm font-semibold text-[var(--gv-text-primary)]">{c.code}</p><p className="text-xs text-[var(--gv-text-secondary)]">{couponLine(c)}</p></div>
              <div className="flex gap-2">
                {c.isActive && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Switch off coupon ${c.code}? Clients can no longer use it.`)) act(() => apiService.staffDeactivateCoupon(c.code), `Coupon ${c.code} is switched off.`); }} className={BTN}>Switch off</button>}
                <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete coupon ${c.code}? This cannot be undone.`)) act(() => apiService.staffDeleteCoupon(c.code), `Coupon ${c.code} was deleted.`); }} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
};

/** Staff Money (Owner only): what was collected, who pays for what, what is coming and what failed. */
const StaffMoney: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payments, setPayments] = useState<any>(null);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState('');

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    return apiService.getStaffMoney()
      .then((res) => { if (res && res.success === false) throw new Error(res.message); setData(res); setPayments(res.payments); })
      .catch((e) => setError(customerMessage(e, LOAD_ERROR)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const goTo = async (page: number) => {
    setPaging(true); setPageError('');
    try {
      const res = await apiService.getStaffPayments(page);
      if (res && res.success === false) throw new Error(res.message);
      setPayments(res);
    } catch (e) { setPageError(customerMessage(e, 'We could not load that page of payments. Please try again.')); }
    setPaging(false);
  };

  if (loading && !data) return <div className="flex justify-center py-20" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-[#F5A623]" /></div>;
  if (error && !data) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-6 text-center" role="alert">
        <p className="text-[var(--gv-text-primary)]">{error}</p>
        <button onClick={() => load()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#F5A623] px-4 py-2 text-sm font-bold text-black"><RefreshCw className="h-4 w-4" /> Try again</button>
      </div>
    );
  }
  if (!data) return null;

  const r = data.revenue || {};
  const series = shapeRevenueSeries(r.series30);
  const mix = data.planMix || { tiers: [], addons: [], customers: 0 };
  const q = data.quarks || {};
  const ay = data.ayrshare || {};
  const ren = data.renewals || { items: [], windowDays: 14, totalPaise: 0 };
  const fail = data.failures || { payments: { items: [] }, renewals: { items: [] }, windowDays: 30 };
  const pay = payments || data.payments || { rows: [], total: 0, page: 1, pages: 1 };
  const gauge = ay.available ? gaugeShape(ay.profiles, ay.included, ay.maxProfiles) : null;
  const noMoneyYet = (r.allTime?.count ?? 0) === 0;

  return (
    <div>
      {error && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error}</p>}
      <div className="mb-6 flex justify-end">
        <button onClick={() => load(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-secondary)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      <Section title="Money collected" hint="Rupees, India time">
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
          {revenueTile('This month', r.thisMonth)}
          {revenueTile('Last month', r.lastMonth)}
          {revenueTile('Last 30 days', r.last30Days)}
          {revenueTile('All time', r.allTime)}
        </div>
        {r.note && <Note>{r.note}</Note>}
        {r.otherCurrencyPayments > 0 && <Note>{r.otherCurrencyPayments} paid {r.otherCurrencyPayments === 1 ? 'payment is' : 'payments are'} in another currency and not included above.</Note>}
        <div className="mt-4 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--gv-text-primary)]">Last 30 days</h3>
          {series.hasData ? <RevenueChart series={series} /> : <p className="text-sm text-[var(--gv-text-secondary)]">{noMoneyYet ? 'No payments yet.' : 'No payments in the last 30 days.'}</p>}
        </div>
      </Section>

      <Section title="Plans" hint={`${(mix.customers ?? 0).toLocaleString('en-IN')} client accounts`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--gv-text-primary)]">Clients on each plan</h3>
            <CountBars rows={mix.tiers || []} unit="clients" />
          </div>
          <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--gv-text-primary)]">Active add-ons</h3>
            <CountBars rows={mix.addons || []} unit="clients" />
          </div>
        </div>
        {mix.monthlyRecurring && (
          <div className="mt-3 max-w-sm"><Tile label="Monthly recurring, estimate" value={formatInr(mix.monthlyRecurring.exGstPaise)} sub={mix.monthlyRecurring.note} /></div>
        )}
      </Section>

      <Section title="Quarks this month">
        {q.available === false ? <Unavailable reason={q.reason} /> : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Quarks sold" value={(q.sold ?? 0).toLocaleString('en-IN')} sub="on paid plans and packs" />
              <Tile label="Quarks spent" value={(q.spent ?? 0).toLocaleString('en-IN')} sub={<>about {formatUsd(q.spentValueUsdCents)} at the set Quark value{q.refunded ? `; ${q.refunded.toLocaleString('en-IN')} refunded already taken off` : ''}</>} />
              <Tile label="Added by staff" value={(q.grantedByStaff ?? 0).toLocaleString('en-IN')} sub="not sold" />
            </div>
            {q.possiblyIncompleteClients > 0 && <p className="mt-2 text-xs text-amber-900">{q.possiblyIncompleteClients} {q.possiblyIncompleteClients === 1 ? 'client has' : 'clients have'} a long Quark history, so their spending may be undercounted.</p>}
            {q.note && <Note>{q.note}</Note>}
          </>
        )}
      </Section>

      <Section title="Social profiles" hint="Estimate, counted by us">
        {!ay.available ? <Unavailable reason={ay.reason} /> : gauge && (
          <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">
            <p className="text-base font-semibold text-[var(--gv-text-primary)]"><span className="tabular-nums">{ay.profiles}</span> of <span className="tabular-nums">{ay.included}</span> included profiles used{ay.extra > 0 ? `, ${ay.extra} extra` : ''}</p>
            <div className="relative mt-3 h-3 rounded-full bg-[var(--gv-bg)]" role="img" aria-label={`${ay.profiles} profiles. ${ay.included} are included. The most the plan allows is ${ay.maxProfiles}.`}>
              <div className="h-3 rounded-full" style={{ width: `${gauge.used}%`, background: gauge.over ? 'var(--gv-text-secondary)' : 'var(--gv-accent-display)' }} />
              <div className="absolute top-[-4px] h-5 w-0.5 bg-[var(--gv-text-primary)]" style={{ left: `${gauge.included}%` }} aria-hidden="true" />
            </div>
            <div className="mt-1 flex justify-between text-xs text-[var(--gv-text-tertiary)]"><span>0</span><span>{ay.included} included</span><span>{ay.maxProfiles} most</span></div>
            <p className="mt-3 text-sm text-[var(--gv-text-secondary)]">
              {ay.extra > 0 ? `Extra profiles: ${ay.extra} at ${formatUsd(ay.perExtraProfileUsdCents)} each, about ${formatUsd(ay.extraUsdCents)} a month on top of the plan.` : `No extra cost: the next profile past ${ay.included} costs ${formatUsd(ay.perExtraProfileUsdCents)} a month.`}
            </p>
            {ay.note && <Note>{ay.note}</Note>}
            <AyrshareReset profiles={ay.profiles} onDone={() => load(true)} />
          </div>
        )}
        {!ay.available && <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4"><AyrshareReset onDone={() => load(true)} /></div>}
      </Section>

      <Section title="Coupons" hint="Owner only">
        <Coupons />
      </Section>

      <Section title="Payments" hint={pageLabel(pay.page, pay.pages, pay.total)}>
        {pay.total === 0 ? (
          <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-5 text-sm text-[var(--gv-text-secondary)]">No payments have been recorded yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">Recent payments, newest first</caption>
                <thead className="bg-[var(--gv-bg)] text-xs text-[var(--gv-text-tertiary)]"><tr><th scope="col" className="px-3 py-2">Date</th><th scope="col" className="px-3 py-2">Client</th><th scope="col" className="px-3 py-2">For</th><th scope="col" className="px-3 py-2 text-right">Before GST</th><th scope="col" className="px-3 py-2 text-right">GST</th><th scope="col" className="px-3 py-2 text-right">Total</th><th scope="col" className="px-3 py-2">Status</th></tr></thead>
                <tbody>
                  {(pay.rows as PaymentRow[]).map((p) => (
                    <tr key={p.id} className="border-t border-[var(--gv-border-subtle)]">
                      <td className="whitespace-nowrap px-3 py-2">{whenIst(p.at)}</td>
                      <td className="px-3 py-2"><a href={`#/staff/clients/${p.clientId}`} className="font-semibold text-[var(--gv-text-primary)] underline-offset-2 hover:underline">{p.clientName}</a></td>
                      <td className="px-3 py-2">{p.what}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.exGstPaise === null ? 'Not stored' : formatInr(p.exGstPaise, { alwaysPaise: true })}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.gstPaise === null ? 'Not stored' : formatInr(p.gstPaise, { alwaysPaise: true })}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatInr(p.totalPaise, { alwaysPaise: true })}</td>
                      <td className="px-3 py-2"><StatusPill status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <button disabled={paging || pay.page <= 1} onClick={() => goTo(pay.page - 1)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-secondary)] disabled:opacity-50"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Newer</button>
              <span className="text-xs text-[var(--gv-text-tertiary)]" aria-live="polite">{paging ? 'Loading…' : `Page ${pay.page} of ${pay.pages}`}</span>
              <button disabled={paging || pay.page >= pay.pages} onClick={() => goTo(pay.page + 1)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-secondary)] disabled:opacity-50">Older <ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            {pageError && <p className="mt-2 text-sm text-red-800" role="alert">{pageError}</p>}
          </>
        )}
      </Section>

      <Section title="Renewals in the next days" hint={`Next ${ren.windowDays} days · ${formatInr(ren.totalPaise)} expected`}>
        {ren.items.length === 0 ? <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-5 text-sm text-[var(--gv-text-secondary)]">No plan renewals are due in the next {ren.windowDays} days.</p> : (
          <ul className="divide-y divide-[var(--gv-border-subtle)] overflow-hidden rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
            {ren.items.map((i: any) => (
              <li key={`${i.clientId}-${i.at}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4">
                <div className="min-w-0"><a href={`#/staff/clients/${i.clientId}`} className="font-semibold text-[var(--gv-text-primary)] underline-offset-2 hover:underline">{i.clientName}</a><p className="text-sm text-[var(--gv-text-secondary)]">{i.what}, renews {whenIst(i.at)}</p></div>
                <p className="text-sm font-semibold tabular-nums text-[var(--gv-text-primary)]">{formatInr(i.totalPaise)}<span className="ml-1 text-xs font-normal text-[var(--gv-text-tertiary)]">with GST</span></p>
              </li>
            ))}
          </ul>
        )}
        {ren.note && <Note>{ren.note}</Note>}
      </Section>

      <Section title="Failures" hint={`Last ${fail.windowDays} days`}>
        {fail.payments.items.length + fail.renewals.items.length === 0 ? <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-5 text-sm text-[var(--gv-text-secondary)]">No failed payments or stopped plans in the last {fail.windowDays} days.</p> : (
          <div className="space-y-4">
            {[{ title: 'Failed payments', items: fail.payments.items as any[], kind: 'failed' }, { title: 'Failed renewals and cancelled plans', items: fail.renewals.items as any[], kind: 'renewal' }].map((g) => (
              <div key={g.title}>
                <h3 className="mb-2 text-sm font-semibold text-[var(--gv-text-primary)]">{g.title} ({g.items.length})</h3>
                {g.items.length === 0 ? <p className="text-sm text-[var(--gv-text-tertiary)]">None.</p> : (
                  <ul className="divide-y divide-[var(--gv-border-subtle)] overflow-hidden rounded-xl border border-red-200 bg-[var(--gv-panel)]">
                    {g.items.map((i, n) => (
                      <li key={`${i.clientId}-${n}`} className="p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <a href={`#/staff/clients/${i.clientId}`} className="font-semibold text-[var(--gv-text-primary)] underline-offset-2 hover:underline">{i.clientName}</a>
                          <span className="text-xs text-[var(--gv-text-tertiary)]">{g.kind === 'renewal' ? `${FAILURE_KIND[i.kind] || 'Stopped'} · paid until ${whenIst(i.at)}` : whenIst(i.at, true)}</span>
                        </div>
                        <p className="mt-1 text-sm text-[var(--gv-text-secondary)]">{i.what}{g.kind === 'failed' ? `, ${formatInr(i.totalPaise)}` : ''}. {i.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        {fail.note && <Note>{fail.note}</Note>}
      </Section>
    </div>
  );
};

export default StaffMoney;
