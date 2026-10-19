import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { apiService, inventoryAPI } from '../services/api';
import StrategyFunnel, { PlanPreview } from '../components/StrategyFunnel';
import PlanHero from '../components/plan/PlanHero';
import PageHeader from '../components/PageHeader';
import PlanDetails from '../components/plan/PlanDetails';
import { PlanRoadArt } from '../components/art/plan/Road';
import { PlanShopArt } from '../components/art/plan/Shop';
import { BlueprintArt } from '../components/art/Blueprint';
import type { PlanView, User } from '../types';
import { BANNER_TEXT, dayMonth, planBanner, refreshLabel, shouldPoll, stoppedMessage } from '../utils/plan';
import { levelsOf } from '../utils/strategyLevels';
import { heroStats, titleCard } from '../utils/planVisuals';
import '../components/plan/plan.css';

/** The one line under the page title. */
export const PLAN_LINE = 'The plan Nebulaa made from your business details: what to post, for whom, and how it is going.';

const BTN_MAIN = 'nb-plan-btn is-main';
const BTN = 'nb-plan-btn';
const LOAD_ERROR = 'We could not load your plan. Please try again.';

/** One state card (building, failed, no plan yet and so on): a small drawing beside the words, warm tints only. */
const StateCard: React.FC<{ tone: string; art?: React.ReactNode; role?: string; children: React.ReactNode }> = ({ tone, art, role, children }) => (
  <div className="nb-plan-state nb-plan-in" data-tone={tone} role={role} style={{ ['--i' as any]: 1 }}>
    {art && <span className="nb-plan-state-art" aria-hidden="true">{art}</span>}
    <div className="nb-plan-state-body">{children}</div>
  </div>
);

/** `embedded`: drawn as the My plan tab of Plan, whose page header and tab bar sit above it. */
const MyPlan: React.FC<{ user?: User | null; embedded?: boolean }> = ({ user, embedded = false }) => {
  const navigate = useNavigate();
  const [view, setView] = useState<PlanView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [looked, setLooked] = useState(0);
  // The products level of the funnel comes from the owner's own list; null means it could not be loaded.
  const [products, setProducts] = useState<unknown[] | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try { const r = await apiService.getPlan(); setView(r); setLoadError(''); return r; }
    catch { setLoadError(LOAD_ERROR); return null; }
    finally { setLooked((n) => n + 1); }
  }, []);

  useEffect(() => { load(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [load]);
  // Asked for at the same time as the plan, so the funnel does not wait for one call after the other.
  useEffect(() => {
    let live = true;
    inventoryAPI.getProducts()
      .then((r: any) => { if (live) setProducts(Array.isArray(r?.products) ? r.products : Array.isArray(r?.data) ? r.data : []); })
      .catch(() => { if (live) setProducts(null); });
    return () => { live = false; };
  }, []);
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

  const levels = useMemo(() => (view && view.plan && products !== undefined ? levelsOf(view.plan, { products }) : null), [view, products]);

  if (!view) {
    return (
      <div className="nb-plan">
        {!embedded && <PageHeader eyebrow="My plan" title="Your marketing" emphasis="plan" description={PLAN_LINE} />}
        {loadError
          ? <StateCard tone="coral"><p role="alert" className="nb-plan-state-text">{loadError}</p><button type="button" className={BTN} onClick={load}>Try again</button></StateCard>
          : <div className="nb-plan-loading" role="status" aria-label="Loading your plan"><Loader2 className="nb-plan-spin" aria-hidden /></div>}
      </div>
    );
  }

  const state = planBanner(view);
  const label = refreshLabel(view);
  const canRefresh = label === 'Refresh my plan';
  const made = view.plan?.completedAt ? dayMonth(view.plan.completedAt) : '';
  const name = String((user as any)?.businessProfile?.name || '').trim();
  const ready = levels ? { ready: levels.filter((l) => l.status === 'ready').length, total: levels.length } : null;

  return (
    <div className="nb-plan">
      {!embedded && <PageHeader eyebrow="My plan" title="Your marketing" emphasis="plan" description={PLAN_LINE} />}
      <PlanHero
        name={name}
        made={made}
        state={state}
        ready={ready}
        card={view.plan ? titleCard(view.plan) : null}
        stats={view.plan ? heroStats(view.plan) : []}
        action={view.eligible && view.plan && !view.running ? (
          <button type="button" className={BTN} onClick={refresh} disabled={busy || !canRefresh}>
            {busy ? <Loader2 className="nb-plan-spin" aria-hidden /> : <RefreshCw aria-hidden />}{label}
          </button>
        ) : null}
      />

      {loadError && <p role="alert" className="nb-plan-alert">{loadError}</p>}
      {actionError && <p role="alert" className="nb-plan-alert">{actionError}</p>}

      {state === 'building' && (
        <StateCard tone="gold" role="status" art={<PlanRoadArt />}>
          <p className="nb-plan-state-title">Building your plan</p>
          <p className="nb-plan-state-text">{BANNER_TEXT.building}</p>
          <span className="nb-plan-dots" aria-hidden="true"><i /><i /><i /></span>
        </StateCard>
      )}

      {state === 'failed' && (
        <StateCard tone="coral" art={<PlanRoadArt />}>
          <p role="alert" className="nb-plan-state-text is-strong"><AlertCircle aria-hidden className="nb-plan-i" />{BANNER_TEXT.failed}</p>
          <div className="nb-plan-state-actions"><button type="button" className={BTN_MAIN} onClick={refresh} disabled={busy}>{busy ? 'Starting…' : 'Try again'}</button></div>
        </StateCard>
      )}

      {state === 'can_build' && (
        <StateCard tone="gold" art={<PlanRoadArt />}>
          <h2 className="nb-plan-state-title">Build my plan</h2>
          <p className="nb-plan-state-text">{BANNER_TEXT.can_build}</p>
          <div className="nb-plan-state-actions"><button type="button" className={BTN_MAIN} onClick={refresh} disabled={busy}>{busy ? 'Starting…' : 'Build my plan'}</button></div>
        </StateCard>
      )}

      {stoppedMessage(view) && (
        <StateCard tone="coral" art={<PlanShopArt />}>
          <p role="alert" className="nb-plan-state-text is-strong"><AlertCircle aria-hidden className="nb-plan-i" />{stoppedMessage(view)}</p>
          <p className="nb-plan-state-text">Add or fix your details, then come back and build it again.</p>
          <div className="nb-plan-state-actions">
            <button type="button" className={BTN_MAIN} onClick={() => navigate('/settings?tab=business')}>Go to Business profile</button>
            {!view.plan && <button type="button" className={BTN} onClick={refresh} disabled={busy}>{busy ? 'Starting…' : 'Build again'}</button>}
          </div>
        </StateCard>
      )}

      {state === 'profile_incomplete' && (
        <StateCard tone="gold" art={<PlanShopArt />}>
          <p className="nb-plan-state-text is-strong">{BANNER_TEXT.profile_incomplete}</p>
          {view.missing.length > 0 && <ul className="nb-plan-chips">{view.missing.map((m) => <li key={m} data-tone="coral">{m}</li>)}</ul>}
          <div className="nb-plan-state-actions"><button type="button" className={BTN_MAIN} onClick={() => navigate('/settings?tab=business')}>Go to Business profile</button></div>
        </StateCard>
      )}

      {state === 'free' && (
        <StateCard tone="gold" art={<span className="nb-plan-state-big"><BlueprintArt /></span>}>
          <h2 className="nb-plan-state-title">Your free Growth Blueprint</h2>
          <p className="nb-plan-state-text">Your Blueprint is a first look at where your business stands and what to do about it.</p>
          <p className="nb-plan-state-text">{BANNER_TEXT.free}</p>
          <div className="nb-plan-state-actions">
            {view.freeBlueprint
              ? <Link to={`/blueprint/${view.freeBlueprint.id}`} className={BTN_MAIN}>Open my Blueprint</Link>
              : <Link to="/blueprint/new" className={BTN_MAIN}>Make my free Blueprint</Link>}
            <Link to="/trial-expired" className={BTN}>See plans</Link>
          </div>
        </StateCard>
      )}

      {state === 'none' && !view.running && !stoppedMessage(view) && (
        <StateCard tone="sage" art={<PlanRoadArt />}><p className="nb-plan-state-text">{BANNER_TEXT.none}</p></StateCard>
      )}

      {state === 'stale' && (
        <StateCard tone="gold"><p className="nb-plan-state-text is-strong">{BANNER_TEXT.stale}</p></StateCard>
      )}

      {!view.plan && (state === 'building' || state === 'failed' || state === 'can_build' || state === 'none' || state === 'stopped') && (
        <PlanPreview title={state === 'building' ? 'What your plan will cover' : 'What a plan covers'} />
      )}

      {view.plan && (
        <>
          {levels
            ? <StrategyFunnel levels={levels} plan={view.plan} />
            : (
              <div className="nb-plan-grid is-skeleton" role="status" aria-label="Loading your strategy">
                {Array.from({ length: 6 }, (_, i) => <span key={i} className="nb-plan-skel" />)}
              </div>
            )}
          <PlanDetails view={view} showCompetitors={state === 'ready'} showListening={state === 'ready'} />
        </>
      )}
    </div>
  );
};

export default MyPlan;
