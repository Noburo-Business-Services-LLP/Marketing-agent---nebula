import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiService } from '../services/api';
import type { CompetitorInsightsResponse } from '../types';
import { cardState, highlightsFor, statusText, trendLabel } from '../utils/competitorInsights';

const CARD = 'mb-6 rounded-2xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] p-4 sm:p-6';
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)]';
const BTN = `inline-flex items-center justify-center rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 min-h-[44px] text-[13px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] ${FOCUS}`;
const LINK = `inline-flex items-center rounded-md min-h-[44px] text-[13px] font-semibold text-[var(--gv-text-primary)] underline underline-offset-2 hover:text-[var(--gv-accent)] ${FOCUS}`;
const LOAD_ERROR = 'We could not load what your competitors did. Please try again.';
const TEXT2 = 'text-[var(--gv-text-secondary)]';

interface Props {
  /** Show the link to the Competitors page. Turned off on that page itself. */
  showLink?: boolean;
}

/** What your competitors did this week, from their public posts. Renders nothing for accounts without the add-on:
 *  the Competitors page already has its own prompt for that. */
const CompetitorInsights: React.FC<Props> = ({ showLink = true }) => {
  const [res, setRes] = useState<CompetitorInsightsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await apiService.getCompetitorInsights();
      if (!alive.current) return;
      setRes(r);
    } catch {
      if (alive.current) { setRes(null); setFailed(true); }
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  if (!loaded) {
    return (
      <section aria-labelledby="competitor-insights-title" className={CARD} aria-busy="true">
        <h2 id="competitor-insights-title" className="text-[18px] font-semibold text-[var(--gv-text-primary)]">What your competitors did</h2>
        <p role="status" className={`mt-1 text-[14px] ${TEXT2}`}>Loading…</p>
      </section>
    );
  }

  const state = failed ? 'error' : cardState(res);
  if (state === 'locked') return null;

  const highlights = highlightsFor(res);
  const competitors = (res && res.competitors) || [];
  const link = showLink ? <Link to="/competitors" className={LINK}>Open Competitors to fix handles</Link> : null;

  return (
    <section aria-labelledby="competitor-insights-title" className={CARD}>
      <h2 id="competitor-insights-title" className="text-[18px] font-semibold text-[var(--gv-text-primary)]">What your competitors did</h2>

      {state === 'error' && (
        <div className="mt-2">
          <p role="alert" className="text-[14px] text-[var(--gv-text-primary)]">{LOAD_ERROR}</p>
          <button type="button" className={`${BTN} mt-3`} onClick={load}>Try again</button>
        </div>
      )}

      {state === 'none' && (
        <p className={`mt-1 text-[14px] leading-relaxed ${TEXT2}`}>
          Once you have competitors with an Instagram handle, we look at their public posts each week and tell you what changed.
        </p>
      )}

      {state === 'started' && (
        <p className={`mt-1 text-[14px] leading-relaxed ${TEXT2}`}>
          We have started looking at your competitors' public posts. What changed shows from next week.
        </p>
      )}

      {state === 'ready' && (
        <>
          <p className={`mt-1 text-[14px] ${TEXT2}`}>From their public posts this week.</p>
          <ul className="mt-3 space-y-2">
            {highlights.map((text, i) => (
              <li key={i} className="break-words text-[14px] leading-relaxed text-[var(--gv-text-primary)]">{text}</li>
            ))}
          </ul>
        </>
      )}

      {(state === 'ready' || state === 'started') && competitors.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--gv-border-subtle)] rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)]" aria-label="Competitors we look at">
          {competitors.map((c) => {
            const trend = trendLabel(c.trend);
            return (
              <li key={c.id} className="px-3 py-2">
                <div className="break-words text-[14px] font-medium leading-snug text-[var(--gv-text-primary)]">
                  {c.name}{c.handle ? <span className="font-normal text-[var(--gv-text-tertiary)]"> @{c.handle}</span> : null}
                </div>
                <div className={`text-[12.5px] ${TEXT2}`}>{statusText(c)}</div>
                {trend && <div className="text-[12.5px] text-[var(--gv-text-tertiary)]">{trend}</div>}
              </li>
            );
          })}
        </ul>
      )}

      {state !== 'error' && link && <div className="mt-2">{link}</div>}
    </section>
  );
};

export default CompetitorInsights;
