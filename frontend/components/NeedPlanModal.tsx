import React from 'react';
import { X, Sparkles } from 'lucide-react';
import { agencyAllowanceEmpty, clientAllowanceEmpty } from '../utils/agency';

/**
 * Shown when something that makes content is attempted without a plan or Quarks. It sits over the page, so the person
 * keeps their place. A new account is invited to choose a plan; an account that has used its Quarks is invited to top up.
 */
const NeedPlanModal: React.FC<{
  hasPlan: boolean;
  onSeePlans: () => void;
  onDismiss: () => void;
  /** Working inside an agency's client: plans and top-ups live in the agency account, so the prompt points back to it. */
  insideClient?: boolean;
  onBackToAgency?: () => void;
  /** An agency account itself: the shared pool is described in posts and videos, never Quarks. */
  agency?: boolean;
}> = ({ hasPlan, onSeePlans, onDismiss, insideClient, onBackToAgency, agency }) => {
  const client = insideClient ? clientAllowanceEmpty() : null;
  const pool = !insideClient && agency && hasPlan ? agencyAllowanceEmpty() : null;
  return (
  <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="need-plan-title">
    <div
      className="w-full max-w-md rounded-2xl border border-[var(--gv-border-default)] p-6 shadow-2xl"
      style={{ background: typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? '#15171c' : '#fffdf8' }}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--gv-accent-fill)] text-[var(--gv-accent)]"><Sparkles className="h-5 w-5" /></span>
        <button type="button" onClick={onDismiss} aria-label="Close" className="rounded-md p-1.5 text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)]"><X className="h-4 w-4" /></button>
      </div>
      <h2 id="need-plan-title" className="mt-4 font-serif-display text-[24px] leading-tight text-[var(--gv-text-primary)]">
        {client ? client.title : pool ? pool.title : hasPlan ? 'You have used your Quarks' : 'Choose a plan to start creating'}
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">
        {client ? client.body : pool ? pool.body : hasPlan
          ? 'There are not enough Quarks left for this. Add more, or wait for your plan to renew, and carry on.'
          : 'You do not have a plan or any Quarks yet, so posts and videos cannot be made. Pick a plan, or add Quarks, and this will work. Your free Growth Blueprint is always open.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onDismiss} className="rounded-lg border border-[var(--gv-border-default)] px-4 py-2.5 text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]">Not now</button>
        <button type="button" onClick={client ? onBackToAgency : onSeePlans} className="rounded-lg bg-[var(--gv-accent)] px-5 py-2.5 text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)]">
          {client ? client.action : pool ? pool.action : hasPlan ? 'Add Quarks' : 'See plans'}
        </button>
      </div>
    </div>
  </div>
  );
};

export default NeedPlanModal;
