import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import { WINDOWS, barPercent, featureSummary, funnelSummary, percentText, quarksSummary, shapeFeatures } from '../../utils/staffUsage';
import type { FeatureItem, FunnelStep, QuarkCategory } from '../../utils/staffUsage';

const LOAD_ERROR = 'We could not load the Usage numbers. Please try again.';

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

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">{children}</div>;

const TableFallback: React.FC<{ caption: string; head: string[]; rows: React.ReactNode[][] }> = ({ caption, head, rows }) => (
  <details className="mt-3 text-sm">
    <summary className="cursor-pointer font-semibold text-[var(--gv-accent-text)]">Show the numbers as a table</summary>
    <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--gv-border-subtle)]">
      <table className="w-full min-w-[420px] text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[var(--gv-bg)] text-[var(--gv-text-tertiary)]"><tr>{head.map((h, i) => <th key={h} scope="col" className={`px-3 py-1.5 ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-[var(--gv-border-subtle)]">{r.map((c, k) => (k === 0 ? <th key={k} scope="row" className="px-3 py-1 font-normal">{c}</th> : <td key={k} className="px-3 py-1 text-right tabular-nums">{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  </details>
);

/** One horizontal bar per row, one hue, the value written beside it. */
const BarRow: React.FC<{ label: string; value: string; pct: number; sub?: string; muted?: boolean }> = ({ label, value, pct, sub, muted }) => (
  <li className="py-1.5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm text-[var(--gv-text-primary)]"><span>{label}</span><span className="tabular-nums">{value}</span></div>
    <div className="mt-1 h-3 rounded-full bg-[var(--gv-bg)]" aria-hidden="true"><div className="h-3 rounded-full" style={{ width: `${pct}%`, background: muted ? 'var(--gv-text-tertiary)' : 'var(--gv-accent-display)' }} /></div>
    {sub && <p className="mt-0.5 text-xs text-[var(--gv-text-tertiary)]">{sub}</p>}
  </li>
);

const FunnelChart: React.FC<{ steps: FunnelStep[]; days: number }> = ({ steps, days }) => {
  const top = steps[0]?.count || 0;
  return (
    <div>
      <p className="sr-only">{funnelSummary(steps, days)}</p>
      <ul aria-hidden="false" aria-label="Sign-up funnel">
        {steps.map((s, i) => s.available ? (
          <BarRow key={s.key} label={s.label} pct={barPercent(s.count || 0, top)} value={`${s.count} ${i === 0 ? '' : `· ${percentText(s.fromPrevious)} of the step before · ${percentText(s.fromStart)} of sign-ups`}`.trim()} />
        ) : (
          <li key={s.key} className="py-1.5 text-sm text-[var(--gv-text-secondary)]"><span className="text-[var(--gv-text-primary)]">{s.label}</span>: could not be counted. {s.reason}</li>
        ))}
      </ul>
      <TableFallback caption={`Sign-up funnel, last ${days} days`} head={['Step', 'Clients', 'Reached it at all', 'Of step before', 'Of sign-ups']}
        rows={steps.map((s) => (s.available ? [s.label, s.count, s.reached, percentText(s.fromPrevious), percentText(s.fromStart)] : [s.label, 'Not counted', '—', '—', '—']))} />
    </div>
  );
};

const FeatureChart: React.FC<{ items: FeatureItem[]; customers: number }> = ({ items, customers }) => {
  const { rows, max, hasData } = shapeFeatures(items);
  return (
    <div>
      <p className="sr-only">{featureSummary(items)}</p>
      {!hasData && <p className="mb-2 text-sm text-[var(--gv-text-secondary)]">Nothing was made in the last 30 days.</p>}
      <ul aria-label="Feature use, last 30 days">
        {rows.map((r) => r.available
          ? <BarRow key={r.key} label={r.label} pct={barPercent(r.count || 0, max)} value={`${(r.count || 0).toLocaleString('en-IN')} · ${r.clients} of ${customers} ${customers === 1 ? 'client' : 'clients'}`} />
          : <li key={r.key} className="py-1.5 text-sm text-[var(--gv-text-secondary)]"><span className="text-[var(--gv-text-primary)]">{r.label}</span>: could not be counted. {r.reason}</li>)}
      </ul>
      <TableFallback caption="Feature use, last 30 days" head={['Feature', 'Made', 'Different clients']}
        rows={rows.map((r) => (r.available ? [r.label, r.count, r.clients] : [r.label, 'Not counted', '—']))} />
      <details className="mt-2 text-xs text-[var(--gv-text-tertiary)]">
        <summary className="cursor-pointer font-semibold text-[var(--gv-accent-text)]">What each number counts</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{rows.map((r) => <li key={r.key}><span className="font-semibold">{r.label}:</span> {r.definition}</li>)}</ul>
      </details>
    </div>
  );
};

/** Staff Usage (Owner full, Admin summary): what clients use, where sign-ups drop off, and what Quarks buy. */
const StaffUsage: React.FC = () => {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback((d: number, quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    return apiService.getStaffUsage(d)
      .then((res) => { if (res && res.success === false) throw new Error(res.message); setData(res); })
      .catch((e) => setError(customerMessage(e, LOAD_ERROR)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(days, !!data); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days, load]);

  if (loading && !data) return <div className="flex justify-center py-20" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-[#F5A623]" /></div>;
  if (error && !data) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-6 text-center" role="alert">
        <p className="text-[var(--gv-text-primary)]">{error}</p>
        <button onClick={() => load(days)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#F5A623] px-4 py-2 text-sm font-bold text-black"><RefreshCw className="h-4 w-4" /> Try again</button>
      </div>
    );
  }
  if (!data) return null;

  const fu = data.featureUse || { items: [], customers: 0 };
  const fn = data.funnel || { available: false };
  const q = data.quarks || { available: false };
  const tiers = data.topByTier || { available: false };
  const none = fu.customers === 0;
  const get = (k: string) => (fu.items as FeatureItem[]).find((i) => i.key === k);
  const tile = (k: string, label: string) => { const i = get(k); return <Tile key={k} label={label} value={i && i.available ? (i.count || 0).toLocaleString('en-IN') : '—'} sub={i && i.available ? `${i.clients} ${i.clients === 1 ? 'client' : 'clients'}` : 'could not be counted'} />; };

  return (
    <div>
      {error && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error} <button onClick={() => load(days, true)} className="ml-2 font-semibold underline">Try again</button></p>}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Sign-up funnel window" className="inline-flex overflow-hidden rounded-lg border border-[var(--gv-border-default)]">
          {WINDOWS.map((w) => (
            <button key={w.days} onClick={() => setDays(w.days)} aria-pressed={days === w.days} className={`px-3 py-2 text-sm font-semibold ${days === w.days ? 'bg-[#F5A623] text-black' : 'bg-[var(--gv-panel)] text-[var(--gv-text-secondary)]'}`}>{w.label}</button>
          ))}
        </div>
        <button onClick={() => load(days, true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 py-2 text-sm font-semibold text-[var(--gv-text-secondary)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>
      {data.level === 'summary' && <p className="mb-4 text-xs text-[var(--gv-text-tertiary)]">This is the summary view. Quark spending is shown to the Owner only.</p>}

      {none ? (
        <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-8 text-center text-sm text-[var(--gv-text-secondary)]">There are no client accounts yet, so there is nothing to show.</p>
      ) : (
        <>
          <Section title="What clients made" hint="Last 30 days">
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tile('images', 'Images generated')}
              {tile('postsDrafted', 'Posts drafted')}
              {tile('postsPublished', 'Posts published')}
              {tile('videos', 'Videos')}
            </div>
            <Card><FeatureChart items={fu.items} customers={fu.customers} /></Card>
            {fu.note && <Note>{fu.note}</Note>}
          </Section>

          <Section title="Sign-up funnel" hint={`Clients who signed up in the last ${days} days`}>
            {!fn.available ? <Unavailable reason={fn.reason} /> : fn.signedUp === 0 ? (
              <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-5 text-sm text-[var(--gv-text-secondary)]">No clients signed up in the last {days} days.</p>
            ) : (
              <Card><FunnelChart steps={fn.steps} days={days} /></Card>
            )}
            {fn.available && fn.note && <Note>{fn.note}</Note>}
          </Section>

          <Section title="Quarks spent this month">
            {q.restricted ? <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-5 text-sm text-[var(--gv-text-secondary)]">{q.reason}</p>
              : !q.available ? <Unavailable reason={q.reason} /> : (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Tile label="Quarks spent" value={(q.total || 0).toLocaleString('en-IN')} sub={`about $${((q.totalValueUsdCents || 0) / 100).toFixed(2)} at the set Quark value`} />
                    {(q.categories as QuarkCategory[]).filter((c) => c.quarks > 0).slice(0, 3).map((c) => <Tile key={c.key} label={c.label} value={c.quarks.toLocaleString('en-IN')} sub={percentText(c.percent)} />)}
                  </div>
                  {q.total === 0 ? <p className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-5 text-sm text-[var(--gv-text-secondary)]">No Quarks have been spent this month.</p> : (
                    <Card>
                      <p className="sr-only">{quarksSummary(q)}</p>
                      <ul aria-label="Quarks spent by group">
                        {(q.categories as QuarkCategory[]).map((c) => <BarRow key={c.key} label={c.label} pct={barPercent(c.quarks, Math.max(...(q.categories as QuarkCategory[]).map((x) => x.quarks)))} value={`${c.quarks.toLocaleString('en-IN')} · ${percentText(c.percent)}`} />)}
                      </ul>
                      <TableFallback caption="Quarks spent by group this month" head={['Group', 'Quarks', 'Share']} rows={(q.categories as QuarkCategory[]).map((c) => [c.label, c.quarks, percentText(c.percent)])} />
                    </Card>
                  )}
                  {q.possiblyIncompleteClients > 0 && <p className="mt-2 text-xs text-amber-900">{q.possiblyIncompleteClients} {q.possiblyIncompleteClients === 1 ? 'client has' : 'clients have'} a long Quark history, so their spending may be undercounted.</p>}
                  {q.note && <Note>{q.note}</Note>}
                </>
              )}
          </Section>

          <Section title="Most used feature on each plan" hint="Last 30 days">
            {!tiers.available ? <Unavailable reason={tiers.reason} /> : (
              <div className="overflow-x-auto rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]">
                <table className="w-full min-w-[460px] text-left text-sm">
                  <caption className="sr-only">Most used feature on each plan, last 30 days</caption>
                  <thead className="bg-[var(--gv-bg)] text-xs text-[var(--gv-text-tertiary)]"><tr><th scope="col" className="px-3 py-2">Plan</th><th scope="col" className="px-3 py-2 text-right">Clients</th><th scope="col" className="px-3 py-2">Most used</th><th scope="col" className="px-3 py-2 text-right">Made</th><th scope="col" className="px-3 py-2 text-right">By</th></tr></thead>
                  <tbody>{(tiers.tiers as any[]).map((t) => (
                    <tr key={t.id} className="border-t border-[var(--gv-border-subtle)]">
                      <th scope="row" className="px-3 py-2 font-semibold">{t.label}</th>
                      <td className="px-3 py-2 text-right tabular-nums">{t.clients}</td>
                      <td className="px-3 py-2">{t.top ? t.top.label : 'Nothing used yet'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.top ? t.top.count.toLocaleString('en-IN') : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.top ? `${t.top.clients} ${t.top.clients === 1 ? 'client' : 'clients'}` : '—'}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
            {tiers.available && tiers.note && <Note>{tiers.note}</Note>}
          </Section>
        </>
      )}
    </div>
  );
};

export default StaffUsage;
