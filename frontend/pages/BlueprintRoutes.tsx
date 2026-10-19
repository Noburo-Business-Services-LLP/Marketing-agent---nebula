import React, { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Layout from '../components/Layout';
import BlueprintStart from './BlueprintStart';
import BlueprintView from './BlueprintView';
import { apiService } from '../services/api';
import { BLUEPRINT_COPY } from '../constants/blueprintCopy';
import type { User } from '../types';
import OldAddress from '../components/OldAddress';
import { StatusTileCard, StatusTileGrid } from '../components/brand/StatusTiles';
import { BrandChecklistArt } from '../components/art/brand/Checklist';
import { BrandBulbArt } from '../components/art/brand/Bulb';
import { BrandGlobeArt } from '../components/art/brand/Globe';
import { BrandMonthArt } from '../components/art/brand/Month';
import { useQuarkCosts } from '../hooks/useQuarkCosts';
import { blueprintSummary } from '../utils/blueprintTab';

const L = BLUEPRINT_COPY.view;

const STATUS_FILL: Record<string, string> = {
  completed: 'var(--gv-mint)', processing: 'var(--gv-sky)', queued: 'var(--gv-sky)',
  awaiting_approval: 'var(--gv-lav)', stopped: 'var(--gv-peach)', failed: 'var(--gv-peach)',
};

/** Status shown as words, never colour alone. */
const TagStatus: React.FC<{ status: string }> = ({ status }) => (
  <span
    className="shrink-0 inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold leading-5"
    style={{ background: STATUS_FILL[status] || 'var(--gv-panel-2)', color: 'var(--gv-text-primary)', border: '1px solid var(--gv-border-subtle)' }}
  >
    {(L.statusLabels as Record<string, string>)[status] || status}
  </span>
);

type BlueprintRow = { id: string; businessName: string; status: string; createdAt: string };

const BlueprintRows: React.FC<{ items: BlueprintRow[] | null }> = ({ items }) => (
  <>
    {items && items.length === 0 && <p className="text-[14px] text-[var(--gv-text-secondary)]">{L.listEmpty}</p>}
    <ul className="space-y-2">
      {(items || []).map((b) => (
        <li key={b.id}>
          <div className="flex items-center justify-between gap-3 rounded-2xl p-4" style={{ background: 'var(--gv-panel)', border: '1px solid var(--gv-border-subtle)' }}>
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--gv-text-primary)]">{b.businessName || 'Blueprint'}</span>
            <TagStatus status={b.status} />
            <Link to={`/blueprint/${b.id}`} className="shrink-0 text-[13px] font-semibold text-[var(--gv-accent-text)] underline underline-offset-2">{L.listOpen}</Link>
          </div>
        </li>
      ))}
    </ul>
  </>
);

const useBlueprints = () => {
  const [items, setItems] = useState<BlueprintRow[] | null>(null);
  useEffect(() => {
    let live = true;
    apiService.blueprintList().then((r) => { if (live) setItems(r?.blueprints || []); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  return items;
};

/** Before onboarding there is no Plan page yet, so the list stays at its own address on the bare page. */
const BlueprintList: React.FC = () => {
  const items = useBlueprints();
  return (
    <div className="max-w-[720px] w-full mx-auto px-4 sm:px-6 pb-8 space-y-5">
      <PageHeader eyebrow="Brand Growth Blueprint" title={L.listTitle} />
      <BlueprintRows items={items} />
      <Link to="/blueprint/new" className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)]">{L.listNew}</Link>
    </div>
  );
};

/**
 * The Blueprint tab of Plan (its header and tab bar come from the Plan page): what a Blueprint is in one line,
 * four status tiles (ready, waiting for you, the price of a Blueprint and of the designed PDF, from the cost map),
 * the list and "Create a Blueprint".
 */
export const BlueprintTab: React.FC<{ user?: User | null }> = ({ user }) => {
  const items = useBlueprints();
  const costs = useQuarkCosts();
  const sum = blueprintSummary(items, { tier: user?.plan?.tier, blueprintQuarks: costs.blueprint, pdfQuarks: costs.blueprint_pdf });
  return (
    <div className="space-y-5" data-testid="plan-blueprint">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] leading-relaxed text-[var(--gv-text-secondary)] max-w-[720px]">{sum.intro}</p>
        <Link to="/blueprint/new" className="shrink-0 inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)]">{L.listNew}</Link>
      </div>
      <StatusTileGrid label="Your Blueprints at a glance" wide={4}>
        <StatusTileCard dataKey="ready" title="Your Blueprints" status={sum.ready.status} state={sum.ready.state} line={sum.ready.line} tone="teal" art={<BrandChecklistArt />} to={sum.ready.to} index={0} />
        <StatusTileCard dataKey="waiting" title="Waiting for you" status={sum.waiting.status} state={sum.waiting.state} line={sum.waiting.line} tone="gold" art={<BrandBulbArt />} to={sum.waiting.to} index={1} />
        <StatusTileCard dataKey="price" title="A Blueprint" status={sum.price.status} state="added" line={sum.price.line} tone="lilac" art={<BrandGlobeArt />} to="/blueprint/new" index={2} />
        <StatusTileCard dataKey="pdf" title="Designed PDF" status={sum.pdf.status} state="added" line={sum.pdf.line} tone="pink" art={<BrandMonthArt />} to={sum.ready.to} index={3} />
      </StatusTileGrid>
      <BlueprintRows items={items} />
    </div>
  );
};

/**
 * The Blueprint pages sit outside the onboarding gate and the Quark paywall on purpose: a visitor
 * who has just verified their email lands on the form, and a finished Blueprint stays readable
 * at zero Quarks. Inside the app shell once onboarding is done; on a bare light page before that.
 */
const BlueprintRoutes: React.FC<{ user: User; onLogout: () => void }> = ({ user, onLogout }) => {
  const routes = (
    <Routes>
      {/* Inside the app the list is the Blueprint tab of Plan; before onboarding it stays here. */}
      <Route index element={user.onboardingCompleted ? <OldAddress from="/blueprint" /> : <BlueprintList />} />
      <Route path="new" element={<BlueprintStart user={user} />} />
      <Route path=":id" element={<BlueprintView user={user} />} />
      <Route path="*" element={<Navigate to="/blueprint" replace />} />
    </Routes>
  );
  if (user.onboardingCompleted) return <Layout user={user} onLogout={onLogout}>{routes}</Layout>;
  return (
    <div className="min-h-screen" style={{ background: 'var(--gv-bg)' }}>
      <header className="max-w-[720px] mx-auto px-4 sm:px-6 pt-6 flex items-center justify-between gap-4">
        <img src="/assets/logo-nebulaa.png" alt="Nebulaa" className="h-[38px] w-auto" />
        <Link to="/dashboard" className="text-[13px] font-semibold text-[var(--gv-accent-text)] underline underline-offset-2">{BLUEPRINT_COPY.routes.toDashboard}</Link>
      </header>
      {routes}
    </div>
  );
};

export default BlueprintRoutes;
