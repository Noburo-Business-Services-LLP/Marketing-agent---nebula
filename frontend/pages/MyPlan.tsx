import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { apiService } from '../services/api';
import type { PlanView } from '../types';
import { BANNER_TEXT, PHASE_TITLES, dayMonth, effortRows, planBanner, refreshLabel, sectionsOf, shouldPoll, stoppedMessage, tagLabel } from '../utils/plan';

const CARD = 'rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] p-4 sm:p-5';
const BTN_MAIN = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 min-h-[40px] text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] disabled:opacity-50';
const BTN = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-4 min-h-[40px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-50';
const LOAD_ERROR = 'We could not load your plan. Please try again.';
const INK = { color: 'var(--gv-text-primary)' } as const;
const QUIET = { color: 'var(--gv-text-secondary)' } as const;

const CHIP_BG: Record<string, string> = { verified: 'var(--gv-mint)', inference: 'var(--gv-sky)', proposed: 'var(--gv-lav)', unverified: 'var(--gv-peach)' };

type Claim = { text?: string | null; tag?: string; label?: string | null };

/** The tag is always spelled out in words, so its meaning never depends on colour. */
const Chip: React.FC<{ tag?: string }> = ({ tag }) => (
  <span
    className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold leading-5 align-middle"
    style={{ background: CHIP_BG[tag || ''] || CHIP_BG.proposed, color: 'var(--gv-text-primary)', border: '1px solid var(--gv-border-subtle)' }}
  >{tagLabel(tag)}</span>
);

const Line: React.FC<{ c?: Claim | null; big?: boolean }> = ({ c, big }) => {
  if (!c || typeof c.text !== 'string' || !c.text.trim()) return null;
  return (
    <p className={`${big ? 'text-[16px]' : 'text-[14px]'} leading-relaxed break-words`} style={INK}>
      {c.label && <span className="font-semibold">{c.label}: </span>}{c.text} <Chip tag={c.tag} />
    </p>
  );
};

const Lines: React.FC<{ items?: Claim[] | null }> = ({ items }) => (
  <div className="space-y-2">{(Array.isArray(items) ? items : []).map((c, i) => <Line key={i} c={c} />)}</div>
);

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-[13px] font-semibold uppercase tracking-wide mb-2" style={QUIET}>{children}</h3>
);

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section className={CARD} aria-labelledby={`plan-h-${id}`}>
    <h2 id={`plan-h-${id}`} className="text-[18px] font-semibold mb-3" style={INK}>{title}</h2>
    <div className="space-y-5">{children}</div>
  </section>
);

const Split: React.FC<{ organic: number; paid: number }> = ({ organic, paid }) => (
  <div>
    <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--gv-surface-2)' }} role="img" aria-label={`${organic}% organic, ${paid}% paid`}>
      <div style={{ width: `${organic}%`, background: 'var(--gv-accent)' }} />
      <div style={{ width: `${paid}%`, background: 'var(--gv-sky)' }} />
    </div>
    <p className="mt-1 text-[12.5px]" style={QUIET}>{organic}% organic, {paid}% paid</p>
  </div>
);

/** The finished plan, section by section. Shared by the page and nothing else. */
const PlanBody: React.FC<{ view: PlanView }> = ({ view }) => {
  const p = view.plan?.result?.plan || {};
  const rows = effortRows(view.plan);
  const roleOf = (name: string) => (p.channels || []).find((c: any) => c.channel === name)?.role;
  const channelNames: string[] = Array.from(new Set<string>([...(p.channels || []).map((c: any) => String(c.channel)), ...rows.map((r) => r.channel)]));
  return (
    <>
      {sectionsOf(view.plan).map((s) => {
        if (s.id === 'today') return (
          <Section key={s.id} id={s.id} title={s.title}>
            <Line c={p.promise} big />
            {p.positioning?.line && <Line c={p.positioning.line} />}
            {p.positioning?.territory?.name && (
              <div><Sub>Where you can stand out</Sub>
                <p className="text-[14px] font-semibold" style={INK}>{p.positioning.territory.name}</p>
                <Line c={p.positioning.territory.rationale} /></div>
            )}
            {(p.positioning?.audience || []).length > 0 && <div><Sub>Who you speak to</Sub><Lines items={p.positioning.audience} /></div>}
            {(p.whereToday || []).length > 0 && <div><Sub>Where you are today</Sub><Lines items={p.whereToday} /></div>}
            {(p.competitors || []).length > 0 && (
              <div><Sub>Others in your space</Sub>
                <div className="space-y-3">{p.competitors.map((c: any, i: number) => (
                  <div key={i}><p className="text-[14px] font-semibold" style={INK}>{c.name}</p><Lines items={c.observations} /></div>
                ))}</div></div>
            )}
          </Section>
        );
        if (s.id === 'customer') {
          const icp = p.icp || {};
          const parts: Array<[string, Claim[]]> = [['Who they are', icp.who], ['What bothers them', icp.pains], ['Where they spend time', icp.where], ['What makes them buy', icp.triggers]];
          return (
            <Section key={s.id} id={s.id} title={s.title}>
              {parts.filter(([, v]) => Array.isArray(v) && v.length > 0).map(([label, v]) => <div key={label}><Sub>{label}</Sub><Lines items={v} /></div>)}
            </Section>
          );
        }
        if (s.id === 'channels') return (
          <Section key={s.id} id={s.id} title={s.title}>
            {channelNames.map((name) => {
              const row = rows.find((r) => r.channel === name);
              return (
                <div key={name} className="rounded-lg border border-[var(--gv-border-subtle)] p-3 sm:p-4 space-y-3">
                  <p className="text-[15px] font-semibold" style={INK}>{name}</p>
                  <Line c={roleOf(name)} />
                  {row && (
                    <>
                      <Split organic={row.organicPct} paid={row.paidPct} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><Sub>Nebulaa does</Sub>
                          <p className="text-[14px]" style={INK}>{row.nebulaaDoes ? `Makes your ${row.nebulaaDoes}.` : 'Nothing here yet.'}</p></div>
                        <div><Sub>You do</Sub>
                          {row.youDo.length ? <ul className="list-disc pl-5 space-y-1 text-[14px]" style={INK}>{row.youDo.map((t, i) => <li key={i} className="break-words">{t}</li>)}</ul>
                            : <p className="text-[14px]" style={QUIET}>Nothing needed.</p>}</div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </Section>
        );
        if (s.id === 'roadmap') return (
          <Section key={s.id} id={s.id} title={s.title}>
            <div className="grid gap-3 md:grid-cols-3">
              {(p.roadmap || []).map((r: any, i: number) => (
                <div key={i} className="rounded-lg border border-[var(--gv-border-subtle)] p-3 sm:p-4 space-y-3 min-w-0">
                  <p className="text-[15px] font-semibold" style={INK}>{PHASE_TITLES[r.phase] || r.phase}</p>
                  <Line c={r.focus} />
                  {(r.actions || []).length > 0 && <div><Sub>Actions</Sub><Lines items={r.actions} /></div>}
                  {(r.measure || []).length > 0 && <div><Sub>How you will know</Sub><Lines items={r.measure} /></div>}
                </div>
              ))}
            </div>
          </Section>
        );
        if (s.id === 'mix') {
          const counts = new Map<string, number>();
          (p.calendar || []).forEach((c: any) => { if (c && c.format) counts.set(String(c.format), (counts.get(String(c.format)) || 0) + 1); });
          return (
            <Section key={s.id} id={s.id} title={s.title}>
              {counts.size > 0 && (
                <div><Sub>What we will make</Sub>
                  <ul className="flex flex-wrap gap-2">{Array.from(counts.entries()).map(([f, n]) => (
                    <li key={f} className="rounded-full border border-[var(--gv-border-subtle)] px-3 py-1 text-[13px]" style={INK}>{n} {f}</li>
                  ))}</ul></div>
              )}
              {(p.pillars || []).length > 0 && (
                <div><Sub>What your posts talk about</Sub>
                  <div className="space-y-3">{p.pillars.map((pl: any, i: number) => (
                    <div key={i}><p className="text-[14px] font-semibold" style={INK}>{pl.name}</p><Line c={pl.why} /></div>
                  ))}</div></div>
              )}
            </Section>
          );
        }
        return (
          <Section key={s.id} id={s.id} title={s.title}>
            <ol className="space-y-2.5 list-decimal pl-5">{(p.firstSteps || []).filter((c: Claim) => c?.text).map((c: Claim, i: number) => (
              <li key={i} className="text-[14px] leading-relaxed break-words" style={INK}>{c.text} <Chip tag={c.tag} /></li>
            ))}</ol>
          </Section>
        );
      })}
    </>
  );
};

const MyPlan: React.FC = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<PlanView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [looked, setLooked] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try { const r = await apiService.getPlan(); setView(r); setLoadError(''); return r; }
    catch { setLoadError(LOAD_ERROR); return null; }
    finally { setLooked((n) => n + 1); }
  }, []);

  useEffect(() => { load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [load]);
  // While the plan is being built, look again every few seconds. A failed look still counts as one, so polling goes on
  // until the plan is ready, it fails for good, or the page is left.
  useEffect(() => {
    if (!shouldPoll(view)) return undefined;
    timer.current = setTimeout(load, 5000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [view, looked, load]);

  const refresh = async () => {
    setBusy(true); setActionError('');
    try { await apiService.refreshPlan(); await load(); }
    catch (e: any) { setActionError(e?.status === 429 || e?.status === 400 || e?.status === 503 ? (e.message || 'We could not refresh your plan. Please try again.') : 'We could not refresh your plan. Please try again.'); await load(); }
    setBusy(false);
  };

  if (!view) {
    return (
      <div className="mx-auto max-w-3xl">
        {loadError
          ? <div className={CARD}><p role="alert" className="text-[14px] text-[var(--gv-coral-text)]">{loadError}</p><button type="button" className={`${BTN} mt-3`} onClick={load}>Try again</button></div>
          : <div className="flex justify-center py-16" role="status" aria-label="Loading your plan"><Loader2 className="w-6 h-6 animate-spin text-[var(--gv-accent)]" aria-hidden /></div>}
      </div>
    );
  }

  const state = planBanner(view);
  const label = refreshLabel(view);
  const canRefresh = label === 'Refresh my plan';
  const made = view.plan?.completedAt ? dayMonth(view.plan.completedAt) : '';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-tight" style={INK}>My plan</h1>
          {made && state !== 'building' && <p className="mt-1 text-[13.5px]" style={QUIET}>Made on {made}</p>}
        </div>
        {view.eligible && view.plan && !view.running && (
          <button type="button" className={BTN} onClick={refresh} disabled={busy || !canRefresh}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RefreshCw className="w-4 h-4" aria-hidden />}{label}
          </button>
        )}
      </header>

      {loadError && <p role="alert" className="text-[13.5px] text-[var(--gv-coral-text)]">{loadError}</p>}
      {actionError && <p role="alert" className="text-[13.5px] text-[var(--gv-coral-text)]">{actionError}</p>}

      {state === 'building' && (
        <div className={`${CARD} flex items-center gap-3`} role="status">
          <Loader2 className="w-5 h-5 shrink-0 animate-spin text-[var(--gv-accent)]" aria-hidden />
          <p className="text-[14px]" style={INK}>{BANNER_TEXT.building}</p>
        </div>
      )}

      {state === 'failed' && (
        <div className={CARD}>
          <p role="alert" className="flex items-start gap-2 text-[14px]" style={INK}><AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[var(--gv-coral-text)]" aria-hidden />{BANNER_TEXT.failed}</p>
          <button type="button" className={`${BTN_MAIN} mt-3`} onClick={refresh} disabled={busy}>{busy ? 'Starting…' : 'Try again'}</button>
        </div>
      )}

      {state === 'can_build' && (
        <div className={CARD}>
          <h2 className="text-[18px] font-semibold" style={INK}>Build my plan</h2>
          <p className="mt-1 text-[14px]" style={QUIET}>{BANNER_TEXT.can_build}</p>
          <button type="button" className={`${BTN_MAIN} mt-4`} onClick={refresh} disabled={busy}>{busy ? 'Starting…' : 'Build my plan'}</button>
        </div>
      )}

      {stoppedMessage(view) && (
        <div className={CARD}>
          <p role="alert" className="flex items-start gap-2 text-[14px]" style={INK}><AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-[var(--gv-coral-text)]" aria-hidden />{stoppedMessage(view)}</p>
          <p className="mt-2 text-[13.5px]" style={QUIET}>Add or fix your details, then come back and build it again.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BTN_MAIN} onClick={() => navigate('/settings?tab=business')}>Go to Business profile</button>
            {!view.plan && <button type="button" className={BTN} onClick={refresh} disabled={busy}>{busy ? 'Starting…' : 'Build again'}</button>}
          </div>
        </div>
      )}

      {state === 'profile_incomplete' && (
        <div className={CARD}>
          <p className="text-[14px]" style={INK}>{BANNER_TEXT.profile_incomplete}</p>
          {view.missing.length > 0 && <ul className="mt-3 list-disc pl-5 space-y-1 text-[14px]" style={INK}>{view.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
          <button type="button" className={`${BTN_MAIN} mt-4`} onClick={() => navigate('/settings?tab=business')}>Go to Business profile</button>
        </div>
      )}

      {state === 'free' && (
        <div className={CARD}>
          <h2 className="text-[18px] font-semibold" style={INK}>Your free Growth Blueprint</h2>
          <p className="mt-1 text-[14px]" style={QUIET}>Your Blueprint is a first look at where your business stands and what to do about it.</p>
          <p className="mt-3 text-[14px]" style={INK}>{BANNER_TEXT.free}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {view.freeBlueprint
              ? <Link to={`/blueprint/${view.freeBlueprint.id}`} className={BTN_MAIN}>Open my Blueprint</Link>
              : <Link to="/blueprint" className={BTN_MAIN}>Make my free Blueprint</Link>}
            <Link to="/trial-expired" className={BTN}>See plans</Link>
          </div>
        </div>
      )}

      {state === 'none' && !view.running && !stoppedMessage(view) && <div className={CARD}><p className="text-[14px]" style={QUIET}>{BANNER_TEXT.none}</p></div>}

      {state === 'stale' && (
        <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`} style={{ background: 'var(--gv-accent-fill)' }}>
          <p className="text-[14px] min-w-0" style={INK}>{BANNER_TEXT.stale}</p>
        </div>
      )}

      {view.plan && <PlanBody view={view} />}
    </div>
  );
};

export default MyPlan;
