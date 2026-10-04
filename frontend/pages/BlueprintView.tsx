import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { GravityPanel, GravityLabel, GravityButton } from '../components/gravity';
import TagChip from '../components/blueprint/TagChip';
import BlueprintDocument from '../components/blueprint/BlueprintDocument';
import { apiService } from '../services/api';
import {
  BlueprintView as BlueprintViewData, STEP_LABELS, pollDelayMs, progressText, shouldPoll, statusHeading, stepIndex,
} from '../utils/blueprint';
import { BLUEPRINT_COPY } from '../constants/blueprintCopy';
import type { User } from '../types';

const C = BLUEPRINT_COPY.view;

const Stepper: React.FC<{ view: BlueprintViewData }> = ({ view }) => {
  const at = stepIndex(view);
  return (
    <ol aria-label={C.stepsLabel} className="grid grid-cols-4 gap-2">
      {STEP_LABELS.map((label, i) => {
        const done = i < at || view.status === 'completed';
        const current = i === at && view.status !== 'completed';
        return (
          <li key={label} className="space-y-1.5">
            <div className="h-1.5 rounded-full" style={{ background: done || current ? 'var(--gv-accent)' : 'var(--gv-surface-3)' }} />
            <p className={`flex items-center gap-1 text-[12.5px] ${current ? 'font-semibold text-[var(--gv-text-primary)]' : 'text-[var(--gv-text-secondary)]'}`}>
              {done && <Check className="w-3.5 h-3.5 shrink-0" />}
              {label}
            </p>
          </li>
        );
      })}
    </ol>
  );
};

const Discovery: React.FC<{ view: BlueprintViewData; onContinue: () => void; busy: boolean }> = ({ view, onContinue, busy }) => {
  const d = view.discovery;
  if (!d) return null;
  return (
    <div className="space-y-4">
      {d.basis === 'limited' && <p className="text-[13.5px] font-semibold text-[var(--gv-text-primary)]">{C.limitedBasis}</p>}
      {(d.warnings || []).map((w, i) => (
        <p key={i} role="status" className="rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-peach)] px-3 py-2 text-[13.5px] text-[var(--gv-text-primary)]">{w.message}</p>
      ))}
      <GravityPanel padding="p-5" contentClassName="space-y-3">
        <h3 className="text-[15px] font-semibold text-[var(--gv-text-primary)]">{C.confirmedTitle}</h3>
        {d.facts.length === 0 && <p className="text-[13.5px] text-[var(--gv-text-secondary)]">{C.nothingConfirmed}</p>}
        <ul className="space-y-2">
          {d.facts.map((f) => (
            <li key={String(f.id)} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-[14px] text-[var(--gv-text-primary)]">
              <TagChip tag="verified" />
              <span className="min-w-0 flex-1 break-words">{f.text}</span>
            </li>
          ))}
        </ul>
      </GravityPanel>
      {d.unverified.length > 0 && (
        <GravityPanel padding="p-5" contentClassName="space-y-3">
          <h3 className="text-[15px] font-semibold text-[var(--gv-text-primary)]">{C.unconfirmedTitle}</h3>
          <ul className="space-y-2">
            {d.unverified.map((u) => (
              <li key={String(u.id)} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-[14px] text-[var(--gv-text-primary)]">
                <TagChip tag="unverified" />
                <span className="min-w-0 flex-1 break-words">
                  <span className="block font-semibold">{u.text}</span>
                  {u.reason && <span className="block text-[var(--gv-text-secondary)]">{u.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </GravityPanel>
      )}
      {d.missing.length > 0 && (
        <GravityPanel padding="p-5" contentClassName="space-y-2">
          <h3 className="text-[15px] font-semibold text-[var(--gv-text-primary)]">{C.missingTitle}</h3>
          <ul className="list-disc pl-5 text-[14px] text-[var(--gv-text-primary)] space-y-1">
            {d.missing.map((m) => <li key={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</li>)}
          </ul>
        </GravityPanel>
      )}
      <GravityButton onClick={onContinue} disabled={busy}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {busy ? C.continuing : C.continuePlan}
      </GravityButton>
    </div>
  );
};

const Directions: React.FC<{ view: BlueprintViewData; onChoose: (id: number) => void; busy: boolean }> = ({ view, onChoose, busy }) => {
  const list = view.directions || [];
  const [picked, setPicked] = useState<number | null>(list.length ? list[0].id : null);
  return (
    <div className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="mb-2 text-[15px] font-semibold text-[var(--gv-text-primary)]">{C.directionsTitle}</legend>
        {list.map((d) => (
          <label key={d.id} className={`block cursor-pointer rounded-2xl border p-4 ${picked === d.id ? 'border-[var(--gv-accent)] bg-[var(--gv-accent-fill)]' : 'border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]'}`}>
            <span className="flex items-start gap-3">
              <input type="radio" name="bp-direction" checked={picked === d.id} onChange={() => setPicked(d.id)} className="mt-1 accent-[var(--gv-accent)]" />
              <span className="min-w-0 flex-1 space-y-2">
                <span className="block text-[15px] font-semibold text-[var(--gv-text-primary)]">{d.name}</span>
                {d.rationale?.text && (
                  <span className="flex flex-wrap items-start gap-x-2 gap-y-1 text-[14px] text-[var(--gv-text-primary)]">
                    <TagChip tag={d.rationale.tag || 'proposed'} />
                    <span className="min-w-0 flex-1 break-words">{d.rationale.text}</span>
                  </span>
                )}
                {d.risk?.text && (
                  <span className="flex flex-wrap items-start gap-x-2 gap-y-1 text-[13.5px] text-[var(--gv-text-secondary)]">
                    <span className="font-semibold">{C.directionRisk}</span>
                    <TagChip tag={d.risk.tag || 'proposed'} />
                    <span className="min-w-0 flex-1 break-words">{d.risk.text}</span>
                  </span>
                )}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <GravityButton onClick={() => picked !== null && onChoose(picked)} disabled={busy || picked === null}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {busy ? C.continuing : C.useDirection}
      </GravityButton>
    </div>
  );
};

const BlueprintView: React.FC<{ user?: User | null }> = ({ user }) => {
  const { id = '' } = useParams();
  const [view, setView] = useState<BlueprintViewData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useRef(0);

  // One polling loop per run token; a new token (after Continue) or unmount cancels the old one.
  const startPolling = useCallback(() => {
    const token = ++run.current;
    let attempt = 0;
    const tick = async () => {
      if (token !== run.current) return;
      try {
        const v = await apiService.blueprintGet(id);
        if (token !== run.current) return;
        setLoadError(false);
        setView(v);
        if (!shouldPoll(v)) return;
      } catch {
        if (token !== run.current) return;
        setLoadError(true);
        return;
      }
      setTimeout(tick, pollDelayMs(attempt++));
    };
    tick();
  }, [id]);

  useEffect(() => {
    setView(null); setLoadError(false);
    startPolling();
  }, [startPolling]);

  // Leaving the page ends whichever polling loop is current.
  useEffect(() => () => { run.current++; }, []);

  const proceed = async (body?: { directionId?: number }) => {
    setBusy(true); setActionError('');
    try {
      await apiService.blueprintContinue(id, body || {});
      setView((v) => (v ? { ...v, status: 'queued', step: 'queued', checkpoint: null } : v));
      startPolling();
    } catch (err: any) {
      setActionError(typeof err?.message === 'string' && err.message ? err.message : C.continueError);
    } finally {
      setBusy(false);
    }
  };

  if (loadError && !view) {
    return <div className="max-w-[720px] w-full mx-auto px-4 sm:px-6 py-8"><p role="alert" className="text-[14px] text-[var(--gv-text-primary)]">{C.loadError}</p></div>;
  }
  if (!view) {
    return <div className="max-w-[720px] w-full mx-auto px-4 sm:px-6 py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[var(--gv-accent)]" aria-label="Loading" /></div>;
  }

  const ended = view.status === 'stopped' || view.status === 'failed';
  return (
    <div className={`${view.status === 'completed' ? 'max-w-[858px]' : 'max-w-[720px]'} w-full mx-auto px-4 sm:px-6 py-8 space-y-6`}>
      <div className="bp-noprint">
        <GravityLabel gold className="mb-2">{view.businessName || 'Brand Growth Blueprint'}</GravityLabel>
        <h1 className="text-[24px] sm:text-[30px] font-semibold leading-tight text-[var(--gv-text-primary)]">{statusHeading(view)}</h1>
        <p role="status" className="mt-2 text-[14.5px] leading-relaxed text-[var(--gv-text-secondary)]">{progressText(view)}</p>
      </div>

      {!ended && <Stepper view={view} />}
      {loadError && <p role="alert" className="text-[13.5px] text-[var(--gv-coral-text)]">{C.loadError}</p>}
      {actionError && <p role="alert" className="text-[13.5px] text-[var(--gv-coral-text)]">{actionError}</p>}

      {view.status === 'awaiting_approval' && view.checkpoint === 1 && <Directions view={view} busy={busy} onChoose={(directionId) => proceed({ directionId })} />}
      {view.status === 'awaiting_approval' && view.checkpoint !== 1 && <Discovery view={view} busy={busy} onContinue={() => proceed()} />}

      {(view.status === 'queued' || view.status === 'processing') && (
        <Loader2 className="w-5 h-5 animate-spin text-[var(--gv-accent)]" aria-hidden />
      )}

      {ended && (
        <Link to="/blueprint/new" className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[var(--gv-accent)] text-[var(--gv-accent-ink)] hover:bg-[var(--gv-accent-hover)]">{C.changeAnswers}</Link>
      )}
      {view.status === 'completed' && <BlueprintDocument view={view} user={user} />}
    </div>
  );
};

export default BlueprintView;
