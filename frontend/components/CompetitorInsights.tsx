import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Binoculars, Sparkles, TrendingUp } from 'lucide-react';
import { apiService } from '../services/api';
import type { CompetitorInsightsResponse } from '../types';
import HandleEditor, { SavedHandle } from './HandleEditor';
import CompetitorAvatar from './CompetitorAvatar';
import { formatCount } from '../utils/formatCount';
import {
  cardState, handleAction, handleSavedNote, highlightsFor, lastCheckedLine, linkLabel, statusText, weekBars, weekBarsSummary,
  type CompetitorRow,
} from '../utils/competitorInsights';
import './CompetitorTiles.css';

const LOAD_ERROR = 'We could not load what your competitors did. Please try again.';

interface Props {
  /** Show the link to the Competitors page. Turned off on that page itself. */
  showLink?: boolean;
  /** Called once when the account does not have the add-on, so a page can show its own prompt. */
  onLocked?: () => void;
  /** Show the per-competitor tiles. Off on the Competitors page, where every competitor already has its own tile. */
  showCompetitors?: boolean;
}

/** The chip on a tile, in words, from the row's status (same words as the Competitors page tiles). */
function chipOf(c: CompetitorRow): { text: string; tone: 'good' | 'neutral' | 'warn' } {
  switch (c.status) {
    case 'tracking': return c.isCurrentWeek === false ? { text: lastCheckedLine(c).replace(/^Last checked on/, 'Last checked') || 'Tracking', tone: 'neutral' } : { text: 'Tracking', tone: 'good' };
    case 'no_handle': return { text: 'Needs a handle', tone: 'warn' };
    case 'unconfirmed': return { text: 'Confirm handle', tone: 'warn' };
    case 'failed': return { text: 'Could not read', tone: 'warn' };
    case 'paused': return { text: 'Paused', tone: 'warn' };
    default: return { text: 'First check pending', tone: 'neutral' };
  }
}

const Bars: React.FC<{ c: CompetitorRow; week?: string }> = ({ c, week }) => {
  const bars = weekBars(c.trend, week);
  if (bars.length < 2) return null;
  return (
    <div className="nb-ct-bars" role="img" aria-label={weekBarsSummary(bars)}>
      <span className="nb-ct-bars-label" aria-hidden="true">Posts a week</span>
      <span className="nb-ct-bars-row" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.weekStart} className="nb-ct-bar" data-current={b.current ? 'true' : undefined} title={b.label}>
            <span className="nb-ct-bar-fill" style={{ height: `${b.height}%` }} />
            <span className="nb-ct-bar-n">{b.posts}</span>
          </span>
        ))}
      </span>
    </div>
  );
};

/** What your competitors did this week, from their public posts. Renders nothing for accounts without the add-on;
 *  the Competitors page shows its own prompt for that (see onLocked). */
const CompetitorInsights: React.FC<Props> = ({ showLink = true, onLocked, showCompetitors = true }) => {
  const [res, setRes] = useState<CompetitorInsightsResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const alive = useRef(true);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await apiService.getCompetitorInsights();
      if (!alive.current) return;
      setRes(r);
      if (r && r.locked && onLocked) onLocked();
    } catch {
      if (alive.current) { setRes(null); setFailed(true); }
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, [onLocked]);

  // The handle was saved: the tile waits for the next weekly check, and says so.
  const onSaved = useCallback((saved: SavedHandle) => {
    setRes((r) => (r ? {
      ...r,
      competitors: (r.competitors || []).map((c) => (c.id === saved.id
        ? { ...c, handle: saved.handle, handleStatus: 'confirmed' as const, status: 'waiting' as const }
        : c)),
    } : r));
    setNotes((n) => ({ ...n, [saved.id]: handleSavedNote(saved) }));
  }, []);

  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);

  const head = (
    <div className="nb-ct-sechead nb-ci-head">
      <span className="nb-ci-icon" aria-hidden="true"><Binoculars /></span>
      <h2 id="competitor-insights-title">What your competitors did</h2>
    </div>
  );

  if (!loaded) {
    return (
      <section aria-labelledby="competitor-insights-title" className="nb-ct-card nb-ci" aria-busy="true">
        {head}
        <p role="status" className="nb-ct-quiet"><span>Loading…</span></p>
      </section>
    );
  }

  const state = failed ? 'error' : cardState(res);
  if (state === 'locked') return null;

  const highlights = highlightsFor(res);
  const competitors = (res && res.competitors) || [];

  return (
    <section aria-labelledby="competitor-insights-title" className="nb-ct-card nb-ci">
      {head}

      {state === 'error' && (
        <p className="nb-ct-quiet" role="alert">
          <span>{LOAD_ERROR}</span>
          <button type="button" className="nb-ct-btn" onClick={load}>Try again</button>
        </p>
      )}

      {state === 'none' && (
        <p className="nb-ct-quiet"><span>Once you have competitors with an Instagram handle, we look at their public posts each week and tell you what changed.</span></p>
      )}

      {state === 'started' && (
        <p className="nb-ct-quiet"><span>We have started looking at your competitors' public posts. What changed shows from next week.</span></p>
      )}

      {state === 'ready' && (
        <>
          <p className="nb-ct-sub nb-ci-sub">From their public posts this week.</p>
          <ul className="nb-ci-highlights" data-count={highlights.length}>
            {highlights.map((text, i) => (
              <li key={i} className="nb-ci-highlight" data-tone={i % 3}>
                <span className="nb-ci-hl-icon" aria-hidden="true">{i === 0 ? <TrendingUp /> : <Sparkles />}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {showCompetitors && (state === 'ready' || state === 'started') && competitors.length > 0 && (
        <ul className="nb-ct-grid nb-ci-grid" aria-label="Competitors we look at">
          {competitors.map((c) => {
            const action = handleAction(c);
            const status = statusText(c);
            const chip = chipOf(c);
            const f = c.followers && Number.isFinite(c.followers.value) ? c.followers : null;
            const change = f && typeof f.change === 'number' ? f.change : null;
            return (
              <li key={c.id}>
                <article className="nb-ct-tile" data-status={c.status} aria-label={`${c.name}${c.handle ? ` @${c.handle}` : ''}: ${chip.text}`}>
                  <header className="nb-ct-head">
                    <CompetitorAvatar name={c.name} handle={c.handle} url={c.avatarUrl} />
                    <div className="nb-ct-who">
                      <h3 className="nb-ct-name" title={c.name}>{c.name}</h3>
                      <div className="nb-ct-meta">
                        {c.handle && <span className="nb-ct-handle">@{c.handle}</span>}
                        <span className="nb-ct-chip" data-tone={chip.tone}>{chip.text}</span>
                      </div>
                    </div>
                  </header>
                  {c.status !== 'tracking' && <p className="nb-ct-note">{status}</p>}
                  {f && (
                    <dl className="nb-ct-stats">
                      <div>
                        <dt>Followers</dt>
                        <dd>{formatCount(f.value)}{change !== null && (
                          <span className="nb-ct-delta" data-dir={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'} aria-label={change === 0 ? 'no change since last week' : `${change > 0 ? 'up' : 'down'} ${formatCount(Math.abs(change))} since last week`}>
                            {change === 0 ? 'No change' : `${change > 0 ? '+' : '-'}${formatCount(Math.abs(change))}`}
                          </span>
                        )}</dd>
                      </div>
                    </dl>
                  )}
                  <Bars c={c} week={res?.weekStart} />
                  {notes[c.id] && <p role="status" className="nb-ct-saved">{notes[c.id]}</p>}
                  {action && (
                    <div className="nb-ct-editor nb-ci-foot">
                      <HandleEditor competitorId={c.id} competitorName={c.name} handle={c.handle} action={action} onSaved={onSaved} onLocked={onLocked} />
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {state !== 'error' && showLink && (
        <div className="nb-ci-link">
          <Link to="/competitors" className="nb-ct-btn">{linkLabel(competitors)}<ArrowRight aria-hidden="true" /></Link>
        </div>
      )}
    </section>
  );
};

export default CompetitorInsights;
