import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Power } from 'lucide-react';
import { apiService } from '../../services/api';
import { customerMessage } from '../../utils/errors';
import { money, spendPercent, spendSummary, spendTone } from '../../utils/aiSpend';

type Provider = { provider: string; label: string; disabled: boolean; lockedByEnv: boolean; note: string };
type Status = { capUsd: number; totalUsd: number; byProvider: Record<string, number>; providers: Provider[] };

const TONE_BAR: Record<string, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', over: 'bg-red-500' };
const WHAT: Record<string, string> = {
  openai_image: 'Posts, campaign posts, carousel slides, edits, AI people and places',
  openai_text: 'Captions, chat and the Blueprint writing',
  google_video: 'The Videos flow',
  fal_video: 'The older step-by-step video maker and Hero video'
};

/** Owner only: what the AI providers have cost today against the daily ceiling, and an on/off switch for each. */
const StaffAiSpend: React.FC = () => {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    apiService.getAiSpend().then((r: any) => { setData(r); setError(''); }).catch((e: any) => setError(customerMessage(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const flip = async (p: Provider) => {
    const turningOff = !p.disabled;
    const ok = window.confirm(turningOff
      ? `Switch off "${p.label}"? Customers who try this will see a busy message and nothing will be charged. You can switch it back on here at any time.`
      : `Switch "${p.label}" back on?`);
    if (!ok) return;
    setBusy(p.provider); setError('');
    try {
      const r: any = await apiService.setAiSwitch(p.provider, turningOff);
      if (r && r.success !== false) setData(r); else setError(customerMessage(r && r.message));
    } catch (e: any) { setError(customerMessage(e)); }
    setBusy('');
  };

  if (!data && !error) return <div className="mb-8 flex justify-center py-6" role="status" aria-label="Loading"><Loader2 className="h-5 w-5 animate-spin text-[#F5A623]" /></div>;
  if (!data) return <p className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error}</p>;

  const pct = spendPercent(data.totalUsd, data.capUsd);
  const tone = spendTone(data.totalUsd, data.capUsd);
  const off = data.providers.filter((p) => p.disabled).length;

  return (
    <section className="mb-8" aria-label="AI spend and switches">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gv-text-secondary)]">AI spend and switches</h2>
        <p className="text-xs text-[var(--gv-text-tertiary)]">{spendSummary(data.totalUsd, data.capUsd, off)}</p>
      </div>
      <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-[var(--gv-text-secondary)]">Estimated spend today</p>
          <p className="text-sm font-semibold tabular-nums text-[var(--gv-text-primary)]">{money(data.totalUsd)}{data.capUsd > 0 ? <span className="font-normal text-[var(--gv-text-tertiary)]"> of {money(data.capUsd)}</span> : null}</p>
        </div>
        {data.capUsd > 0 && (
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[var(--gv-surface-3)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Today's AI spend against the daily ceiling">
            <div className={`h-full ${TONE_BAR[tone]}`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="mt-1.5 text-[11.5px] text-[var(--gv-text-tertiary)]">This is worked out from our own cost table, not read from the providers. Check their dashboards for the exact bill. You get an email at 70% and at the ceiling.</p>

        {error && <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900" role="alert">{error}</p>}

        <ul className="mt-4 divide-y divide-[var(--gv-border-subtle)]">
          {data.providers.map((p) => (
            <li key={p.provider} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--gv-text-primary)]">{p.label} <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.disabled ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>{p.disabled ? 'Off' : 'On'}</span></p>
                <p className="text-xs text-[var(--gv-text-tertiary)]">{WHAT[p.provider]} · today {money(Number(data.byProvider[p.provider]) || 0)}</p>
                {p.lockedByEnv && <p className="text-xs text-amber-800">Switched off in the server settings (AI_KILLED). Remove it there to turn this on.</p>}
              </div>
              <button
                type="button" onClick={() => flip(p)} disabled={busy === p.provider || p.lockedByEnv}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${p.disabled ? 'bg-[#F5A623] text-black' : 'border border-[var(--gv-border-default)] bg-[var(--gv-panel)] text-[var(--gv-text-secondary)]'}`}
              >
                {busy === p.provider ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" aria-hidden="true" />}
                {p.disabled ? 'Switch on' : 'Switch off'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default StaffAiSpend;
