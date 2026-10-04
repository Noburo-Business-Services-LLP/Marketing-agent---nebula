import React, { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import Layout from '../components/Layout';
import { GravityPanel, GravityLabel } from '../components/gravity';
import BlueprintStart from './BlueprintStart';
import BlueprintView from './BlueprintView';
import { apiService } from '../services/api';
import { BLUEPRINT_COPY } from '../constants/blueprintCopy';
import type { User } from '../types';

const L = BLUEPRINT_COPY.view;

const BlueprintList: React.FC = () => {
  const [items, setItems] = useState<Array<{ id: string; businessName: string; status: string; createdAt: string }> | null>(null);
  useEffect(() => {
    let live = true;
    apiService.blueprintList().then((r) => { if (live) setItems(r?.blueprints || []); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  return (
    <div className="max-w-[720px] w-full mx-auto px-4 sm:px-6 py-8 space-y-5">
      <div>
        <GravityLabel gold className="mb-2">Brand Growth Blueprint</GravityLabel>
        <h1 className="text-[26px] font-semibold text-[var(--gv-text-primary)]">{L.listTitle}</h1>
      </div>
      {items && items.length === 0 && <p className="text-[14px] text-[var(--gv-text-secondary)]">{L.listEmpty}</p>}
      <ul className="space-y-2">
        {(items || []).map((b) => (
          <li key={b.id}>
            <GravityPanel padding="p-4" contentClassName="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[14px] font-semibold text-[var(--gv-text-primary)]">{b.businessName || 'Blueprint'}</span>
              <Link to={`/blueprint/${b.id}`} className="shrink-0 text-[13px] font-semibold text-[var(--gv-accent-text)] underline underline-offset-2">{L.listOpen}</Link>
            </GravityPanel>
          </li>
        ))}
      </ul>
      <Link to="/blueprint/new" className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)]">{L.listNew}</Link>
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
      <Route index element={<BlueprintList />} />
      <Route path="new" element={<BlueprintStart user={user} />} />
      <Route path=":id" element={<BlueprintView />} />
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
