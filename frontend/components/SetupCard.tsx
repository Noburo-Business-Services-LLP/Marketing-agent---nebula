import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../services/api';
import type { SetupResponse } from '../types';
import { cardModel } from '../utils/setup';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)]';
const BTN_MAIN = `inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--gv-accent)] px-4 min-h-[44px] text-[13px] font-semibold text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)] ${FOCUS}`;

/** The setup path: ordered steps with ticks and one highlighted next step. Hidden once everything is done. */
const SetupCard: React.FC = () => {
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiService.getSetup().then((r) => { if (!cancelled) setSetup(r); }).catch(() => { /* no card if it cannot load */ });
    try { if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 639px)').matches) setOpen(false); } catch { /* stays open */ }
    return () => { cancelled = true; };
  }, []);

  const m = cardModel(setup);
  if (!m.show) return null;

  return (
    <section aria-labelledby="setup-card-title" data-tour="setup" className="mb-8 rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 id="setup-card-title" className="text-[18px] font-semibold text-[var(--gv-text-primary)]">{m.title}</h2>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="setup-steps" className={`inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] text-[var(--gv-text-primary)] sm:hidden ${FOCUS}`}>
          {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          <span className="sr-only">{open ? 'Hide the steps' : 'Show the steps'}</span>
        </button>
      </div>
      {m.nextStep && (
        <div className="mt-3 rounded-xl border border-[rgb(var(--gv-accent-rgb)/0.35)] bg-[var(--gv-panel)] p-3 sm:p-4">
          <div className="text-[14px] font-semibold text-[var(--gv-text-primary)]">{m.nextStep.title}</div>
          {m.nextStep.reason && <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--gv-text-secondary)]">{m.nextStep.reason}</p>}
          <p className="mt-0.5 text-[12.5px] text-[var(--gv-text-tertiary)]">About {m.nextStep.minutes} {m.nextStep.minutes === 1 ? 'minute' : 'minutes'}</p>
          <div className="mt-3"><Link to={m.nextStep.to} className={BTN_MAIN}>{m.nextStep.button}</Link></div>
        </div>
      )}
      {m.waiting && <p className="mt-3 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">{m.waiting}</p>}
      <ol id="setup-steps" className={`mt-4 space-y-2 ${open ? '' : 'hidden sm:block'}`}>
        {m.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-3 text-[13.5px]">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${s.done ? 'border-transparent bg-[var(--gv-accent)] text-[var(--gv-accent-ink)]' : 'border-[var(--gv-border-default)]'}`} aria-hidden="true">{s.done && <Check className="h-3 w-3" strokeWidth={3} />}</span>
            <span className={s.done ? 'text-[var(--gv-text-tertiary)]' : 'text-[var(--gv-text-primary)]'}>{s.title}</span>
            <span className="sr-only">{s.done ? 'Done' : 'Not done yet'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
};

export default SetupCard;
