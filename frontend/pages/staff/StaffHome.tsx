import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import { attentionText, whenLabel } from './staffLabels';
import { formatChange, healthSummary, niceMax, orderAttention, seriesSummary, shapeSeries, sinceLabel, STATUS_TEXT } from '../../utils/staffHome';
import type { ShapedSeries } from '../../utils/staffHome';

type HealthCard = { key: string; label: string; status: 'green' | 'amber' | 'red'; note: string; lastHour: number; lastDay: number; latest: Array<{ at: string; detail: string }> };
type AttentionRow = { id: string; name: string; email: string; quarks: number; reasons: string[]; csm: { id: string; name: string } | null; lastActiveAt: string | null };
type Stat = { now: number; before: number; change: number | null };

const STATUS_STYLE: Record<string, { ring: string; text: string; Icon: React.ComponentType<{ className?: string }> }> = {
  green: { ring: 'border-emerald-300', text: 'text-emerald-800', Icon: CheckCircle2 },
  amber: { ring: 'border-amber-400', text: 'text-amber-900', Icon: AlertTriangle },
  red: { ring: 'border-red-400', text: 'text-red-800', Icon: XCircle }
};

const LOAD_ERROR = 'We could not load the Home numbers. Please try again.';

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="mb-8">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gv-text-secondary)]">{title}</h2>
      {hint && <p className="text-xs text-[var(--gv-text-tertiary)]">{hint}</p>}
    </div>
    {children}
  </section>
);

const ChangeLine: React.FC<{ stat: Stat }> = ({ stat }) => {
  const c = formatChange(stat.change, stat.before);
  const Icon = c.dir === 'up' ? ArrowUpRight : c.dir === 'down' ? ArrowDownRight : Minus;
  return <p className="mt-1 flex items-center gap-1 text-xs text-[var(--gv-text-tertiary)]"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {c.text}</p>;
};

const Tile: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode }> = ({ label, value, sub }) => (
  <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">
    <p className="text-xs font-semibold text-[var(--gv-text-tertiary)]">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--gv-text-primary)]">{value}</p>
    {sub}
  </div>
);

/** Width of an element, so the chart text stays a readable size at 375px. */
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

/** Sign-ups as bars, clients active as a line, one shared scale. Different shapes as well as different colours. */
const GrowthChart: React.FC<{ series: ShapedSeries }> = ({ series }) => {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const days = series.days;
  const height = 200;
  const pad = { l: 30, r: 8, t: 10, b: 24 };
  const top = niceMax(Math.max(series.maxSignups, series.maxActive));
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = days.length ? iw / days.length : iw;
  const x = (i: number) => pad.l + slot * i + slot / 2;
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const barW = Math.max(2, Math.min(14, slot * 0.6));
  const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.active).toFixed(1)}`).join(' ');
  const ticks = top % 2 === 0 ? [0, top / 2, top] : [0, top];
  const every = width < 420 ? 10 : 5;
  const focus = hover === null ? null : days[hover];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--gv-text-secondary)]">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: 'var(--gv-accent-display)' }} aria-hidden="true" /> New sign-ups each day</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: 'var(--gv-text-secondary)' }} aria-hidden="true" /> Clients active each day</span>
      </div>
      <div ref={ref} className="w-full">
        <svg width={width} height={height} role="img" aria-label={seriesSummary(series)} className="block max-w-full" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--gv-border-subtle)" strokeWidth="1" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--gv-text-tertiary)">{t}</text>
            </g>
          ))}
          {days.map((d, i) => (
            <rect key={d.day} x={x(i) - barW / 2} y={y(d.signups)} width={barW} height={Math.max(0, pad.t + ih - y(d.signups))} rx="1.5" fill="var(--gv-accent-display)" opacity={hover === null || hover === i ? 1 : 0.55} />
          ))}
          <path d={line} fill="none" stroke="var(--gv-text-secondary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {days.map((d, i) => (i % every === 0 || i === days.length - 1) && (
            <text key={d.day} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--gv-text-tertiary)">{d.label}</text>
          ))}
          {focus && hover !== null && <circle cx={x(hover)} cy={y(focus.active)} r="4" fill="var(--gv-text-secondary)" stroke="var(--gv-panel)" strokeWidth="2" />}
          {days.map((d, i) => <rect key={`h${d.day}`} x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
        </svg>
      </div>
      <p className="mt-1 min-h-[1.25rem] text-xs text-[var(--gv-text-secondary)]" aria-live="polite">
        {focus ? `${focus.label}: ${focus.signups} ${focus.signups === 1 ? 'sign-up' : 'sign-ups'}, ${focus.active} ${focus.active === 1 ? 'client' : 'clients'} active` : 'Hover or tap a day for its numbers.'}
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-semibold text-[var(--gv-accent-text)]">Show the numbers as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-[var(--gv-border-subtle)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--gv-bg)] text-[var(--gv-text-tertiary)]"><tr><th scope="col" className="px-3 py-1.5">Day</th><th scope="col" className="px-3 py-1.5">Sign-ups</th><th scope="col" className="px-3 py-1.5">Clients active</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.day} className="border-t border-[var(--gv-border-subtle)]"><td className="px-3 py-1">{d.label}</td><td className="px-3 py-1 tabular-nums">{d.signups}</td><td className="px-3 py-1 tabular-nums">{d.active}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
};

/** Staff Home: is anything broken, which clients need a look, is the business growing. */
const StaffHome: React.FC<{ role: 'owner' | 'admin' | 'csm'; can?: Record<string, boolean> }> = ({ role, can = {} }) => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [quarkFor, setQuarkFor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    return apiService.getStaffHome()
      .then((res) => { if (res && res.success === false) throw new Error(res.message); setData(res); })
      .catch((e) => setError(customerMessage(e && e.message, LOAD_ERROR)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openAccount = async (id: string) => {
    setBusy(id); setNote(null);
    try {
      const res = await apiService.staffOpenClient(id);
      if (res.success) { window.location.hash = '#/dashboard'; window.location.reload(); return; }
      setNote({ id, text: customerMessage(res.message, 'Could not open the account.') });
    } catch (e: any) { setNote({ id, text: customerMessage(e && e.message, 'Could not open the account.') }); }
    setBusy(null);
  };

  const addQuarks = async (id: string) => {
    setBusy(id); setNote(null);
    try {
      const res = await apiService.staffAddQuarks(id, Number(amount));
      if (res.success) { setNote({ id, text: `Quarks added. The balance is now ${Number(res.balance).toLocaleString()}.` }); setQuarkFor(null); setAmount(''); await load(true); }
      else setNote({ id, text: customerMessage(res.message, 'Could not add the Quarks.') });
    } catch (e: any) { setNote({ id, text: customerMessage(e && e.message, 'Could not add the Quarks.') }); }
    setBusy(null);
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

  const cards: HealthCard[] = data.health?.cards || [];
  const summary = healthSummary(cards);
  const items: AttentionRow[] = orderAttention<any>(data.attention?.items);
  const total: number = data.attention?.total ?? items.length;
  const g = data.growth || {};
  const series = shapeSeries(g.series);
  const sel = cards.find((c) => c.key === openCard) || null;
  const t2p = g.trialToPaid || {};

  return (
    <div>
      {error && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error}</p>}
      <div className="mb-6 flex justify-end">
        <button onClick={() => load(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-secondary)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      <Section title="Health" hint={summary.text}>
        {cards.length === 0 ? <p className="text-sm text-[var(--gv-text-tertiary)]">No health data yet.</p> : (
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => {
              const st = STATUS_STYLE[c.status] || STATUS_STYLE.green;
              const clickable = c.latest.length > 0;
              const body = (
                <>
                  <span className={`flex items-center gap-2 text-sm font-semibold ${st.text}`}><st.Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> {STATUS_TEXT[c.status]}</span>
                  <span className="mt-1 block text-base font-semibold text-[var(--gv-text-primary)]">{c.label}</span>
                  <span className="mt-1 block text-sm text-[var(--gv-text-secondary)]">{c.note}</span>
                  <span className="mt-2 block text-xs text-[var(--gv-text-tertiary)]">{c.lastHour} in the last hour, {c.lastDay} in the last day{clickable ? ' · See the latest errors' : ''}</span>
                </>
              );
              const cls = `block w-full rounded-xl border-2 bg-[var(--gv-panel)] p-4 text-left ${st.ring}`;
              return clickable
                ? <button key={c.key} type="button" aria-expanded={openCard === c.key} aria-controls="health-errors" onClick={() => setOpenCard(openCard === c.key ? null : c.key)} className={`${cls} hover:bg-[var(--gv-bg)]`}>{body}</button>
                : <div key={c.key} className={cls}>{body}</div>;
            })}
          </div>
        )}
        {sel && (
          <div id="health-errors" className="mt-3 rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] p-4">
            <p className="text-sm font-semibold text-[var(--gv-text-primary)]">Latest errors: {sel.label}</p>
            <ul className="mt-2 space-y-2">
              {sel.latest.map((l, i) => (
                <li key={i} className="text-sm text-[var(--gv-text-secondary)]">
                  <span className="text-xs text-[var(--gv-text-tertiary)]">{new Date(l.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="block break-words">{l.detail || 'No detail was recorded.'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {role === 'csm' && <p className="mt-2 text-xs text-[var(--gv-text-tertiary)]">Error details are shown to Owners and Admins.</p>}
        <p className="mt-2 text-xs text-[var(--gv-text-tertiary)]">{sinceLabel(data.health?.since)}</p>
      </Section>

      <Section title="Clients that need attention" hint={total > items.length ? `Showing ${items.length} of ${total}, most urgent first` : total ? `${total} ${total === 1 ? 'client' : 'clients'}, most urgent first` : undefined}>
        {items.length === 0 ? (
          <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-5 text-sm text-[var(--gv-text-secondary)]">No clients need attention right now.</p>
        ) : (
          <ul className="divide-y divide-[var(--gv-border-subtle)] overflow-hidden rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
            {items.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <button onClick={() => navigate(`/staff/clients/${r.id}`)} className="max-w-full truncate text-left text-base font-semibold text-[var(--gv-text-primary)] underline-offset-2 hover:underline">{r.name}</button>
                    <p className="text-xs text-[var(--gv-text-tertiary)] break-all">{r.email}</p>
                    <p className="mt-1 text-sm text-[var(--gv-text-secondary)]">{attentionText(r.reasons)}.</p>
                    <p className="mt-1 text-xs text-[var(--gv-text-tertiary)]"><span className="tabular-nums">{r.quarks.toLocaleString()}</span> Quarks · CSM: {r.csm?.name || 'None'} · Last active: {whenLabel(r.lastActiveAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {can.open_client && <button disabled={busy === r.id} onClick={() => openAccount(r.id)} className="rounded-lg bg-[#F5A623] px-3 py-2 text-sm font-bold text-black disabled:opacity-50">Open account</button>}
                    {can.add_quarks && <button disabled={busy === r.id} aria-expanded={quarkFor === r.id} onClick={() => { setQuarkFor(quarkFor === r.id ? null : r.id); setAmount(''); setNote(null); }} className="rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-secondary)] disabled:opacity-50">Add Quarks</button>}
                  </div>
                </div>
                {quarkFor === r.id && (
                  <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (amount) addQuarks(r.id); }}>
                    <label htmlFor={`q-${r.id}`} className="text-sm text-[var(--gv-text-secondary)]">Quarks to add to {r.name}</label>
                    <input id={`q-${r.id}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="w-32 rounded-lg border border-[var(--gv-border-default)] bg-white px-3 py-2 text-sm text-[var(--gv-text-primary)]" />
                    <button type="submit" disabled={busy === r.id || !amount} className="rounded-lg bg-[#F5A623] px-3 py-2 text-sm font-bold text-black disabled:opacity-50">Add</button>
                  </form>
                )}
                {note?.id === r.id && <p className="mt-2 text-sm text-[var(--gv-text-secondary)]" role="status">{note.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Growth" hint={role === 'csm' ? 'Your clients only' : undefined}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tile label="Sign-ups today" value={g.signups?.today?.now ?? 0} sub={g.signups && <ChangeLine stat={g.signups.today} />} />
          <Tile label="Sign-ups, last 7 days" value={g.signups?.week?.now ?? 0} sub={g.signups && <ChangeLine stat={g.signups.week} />} />
          <Tile label="Sign-ups, last 30 days" value={g.signups?.month?.now ?? 0} sub={g.signups && <ChangeLine stat={g.signups.month} />} />
          <Tile label="Active this week" value={g.activeThisWeek ?? 0} sub={<p className="mt-1 text-xs text-[var(--gv-text-tertiary)]">of {(g.totalClients ?? 0).toLocaleString()} clients</p>} />
          <Tile label="Trials that became paid" value={t2p.percent === null || t2p.percent === undefined ? 'None yet' : `${t2p.percent}%`} sub={<p className="mt-1 text-xs text-[var(--gv-text-tertiary)]">{t2p.paid ?? 0} of {t2p.signedUp ?? 0} who signed up in the last 30 days</p>} />
        </div>
        <div className="mt-4 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--gv-text-primary)]">Last 30 days</h3>
          {series.hasData ? <GrowthChart series={series} /> : <p className="text-sm text-[var(--gv-text-secondary)]">No sign-ups or activity in the last 30 days yet.</p>}
        </div>
      </Section>
    </div>
  );
};

export default StaffHome;
