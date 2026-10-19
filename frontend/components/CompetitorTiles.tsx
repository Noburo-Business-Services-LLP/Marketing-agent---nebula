import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Compass, ExternalLink, Film, Gift, Image as ImageIcon, Layers, Sparkles, Star, TrendingUp } from 'lucide-react';
import { apiService } from '../services/api';
import HandleEditor, { SavedHandle } from './HandleEditor';
import { setPrefill } from '../utils/prefill';
import { handleSavedNote } from '../utils/competitorInsights';
import {
  boardNote, boardState, homeCards, isBestPostsResponse, sectionsToShow, tileView, trendHandoff, trendView, workingView,
  type BestPostsResponse, type BoardState, type CompetitorCard, type MakeAction, type PostKind, type TrendSource,
} from '../utils/competitorsHome';
import './CompetitorTiles.css';

// Competitor tiles, "What's working for your competitors" and "Trending for you", from GET /api/competitors/best-posts
// (stored data only: no read of anyone's page happens here, and no model is called). Used on Home (three tiles) and on
// the Competitors page (every tracked competitor, with the handle controls). Each block shows only with real data.

const KIND_ICON: Record<PostKind, React.FC<{ 'aria-hidden'?: boolean | 'true' }>> = { video: Film, image: ImageIcon, carousel: Layers };
const SOURCE_ICON: Record<TrendSource, React.FC<{ 'aria-hidden'?: boolean | 'true' }>> = { competitor: TrendingUp, own: Star, festival: Gift, plan: Compass };

/** Loads the answer once (or when `enabled` turns true). A failed or odd answer counts as a failed load. */
export function useBestPosts(enabled = true) {
  const [res, setRes] = useState<BestPostsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setFailed(false);
    (async () => {
      try {
        const r = await apiService.getCompetitorBestPosts();
        if (!alive) return;
        if (!isBestPostsResponse(r)) throw new Error('unexpected answer');
        setRes(r);
      } catch {
        if (alive) { setRes(null); setFailed(true); }
      }
    })();
    return () => { alive = false; };
  }, [enabled, attempt]);
  const reload = useCallback(() => { setRes(null); setFailed(false); setAttempt((a) => a + 1); }, []);
  return { res, setRes, failed, reload, state: boardState(res, failed) as BoardState };
}

function useMake(language?: string | null) {
  const navigate = useNavigate();
  return (a: MakeAction) => {
    const h = trendHandoff(a, language);
    if (!h) return;
    if (h.target === 'video') setPrefill('video', h.data); else setPrefill('carousel', h.data);
    navigate(h.route);
  };
}

export const CompetitorTile: React.FC<{ card: CompetitorCard; editable?: boolean; savedNote?: string; onSaved?: (s: SavedHandle) => void; onLocked?: () => void }> = ({ card, editable = false, savedNote, onSaved, onLocked }) => {
  const v = tileView(card);
  const BestIcon = v.best ? KIND_ICON[v.best.kind] || ImageIcon : null;
  return (
    <article className="nb-ct-tile" data-status={card.status} aria-label={`${v.name}${v.handleText ? ` ${v.handleText}` : ''}: ${v.chip.text}`}>
      <header className="nb-ct-head">
        <span className="nb-ct-avatar" aria-hidden="true">{v.initial}</span>
        <div className="nb-ct-who">
          <h3 className="nb-ct-name" title={v.name}>{v.name}</h3>
          <div className="nb-ct-meta">
            {v.handleText && (v.profileUrl
              ? <a className="nb-ct-handle" href={v.profileUrl} target="_blank" rel="noopener noreferrer" title={`Open ${v.handleText} in a new tab`}>{v.handleText}</a>
              : <span className="nb-ct-handle">{v.handleText}</span>)}
            <span className="nb-ct-chip" data-tone={v.chip.tone}>{v.chip.text}</span>
          </div>
        </div>
      </header>
      {v.note && <p className="nb-ct-note">{v.note}</p>}
      {(v.followers || v.posts) && (
        <dl className="nb-ct-stats">
          {v.followers && (
            <div>
              <dt>Followers</dt>
              <dd>{v.followers.value}{v.followers.chip && <span className="nb-ct-delta" data-dir={v.followers.chip.dir} aria-label={v.followers.chip.label}>{v.followers.chip.text}</span>}</dd>
            </div>
          )}
          {v.posts && (<div><dt>This week</dt><dd>{v.posts}</dd></div>)}
        </dl>
      )}
      {v.best && BestIcon && (
        <p className="nb-ct-best">
          <BestIcon aria-hidden="true" />
          <span className="nb-ct-best-text">
            <strong>{v.best.text}</strong>{v.best.counts ? `, ${v.best.counts}` : ''}
            {v.best.url && <a className="nb-ct-link" href={v.best.url} target="_blank" rel="noopener noreferrer">Open the post<ExternalLink aria-hidden="true" /></a>}
          </span>
        </p>
      )}
      {v.worked && <p className="nb-ct-worked" data-quiet={v.workedIsQuiet ? 'true' : undefined}><Sparkles aria-hidden="true" /><span>{v.worked}</span></p>}
      {savedNote && <p role="status" className="nb-ct-saved">{savedNote}</p>}
      {editable && v.handleAction && onSaved && (
        <div className="nb-ct-editor">
          <HandleEditor competitorId={card.id} competitorName={card.name} handle={card.handle} action={v.handleAction} onSaved={onSaved} onLocked={onLocked} />
        </div>
      )}
    </article>
  );
};

const TileSkeleton: React.FC<{ count: number }> = ({ count }) => (
  <ul className="nb-ct-grid" aria-hidden="true">{Array.from({ length: count }, (_, i) => <li key={i}><div className="nb-ct-skel" /></li>)}</ul>
);

export const WorkingList: React.FC<{ res: BestPostsResponse; language?: string | null }> = ({ res, language }) => {
  const make = useMake(language);
  const rows = res.working.map(workingView);
  return (
    <section className="nb-ct-card" aria-labelledby="ct-working-title">
      <div className="nb-ct-sechead">
        <h2 id="ct-working-title">What's working for your competitors</h2>
        <span className="nb-ct-sub">Their strongest recent posts</span>
      </div>
      <ul className="nb-ct-rows">
        {rows.map((r) => {
          const Icon = KIND_ICON[r.kind] || ImageIcon;
          return (
            <li key={r.key} className="nb-ct-row" data-tone="competitor">
              <span className="nb-ct-mark" aria-hidden="true"><Icon aria-hidden="true" /></span>
              <div className="nb-ct-row-body">
                <p className="nb-ct-row-title">{r.title}</p>
                <p className="nb-ct-row-reason">
                  {r.reason}
                  {r.url && <a className="nb-ct-link" href={r.url} target="_blank" rel="noopener noreferrer">Open the post<ExternalLink aria-hidden="true" /></a>}
                </p>
              </div>
              <button type="button" className="nb-ct-btn" onClick={() => make(r.action)} aria-label={`${r.action.label}: ${r.title}`}>
                <Sparkles aria-hidden="true" />{r.action.label}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export const TrendingList: React.FC<{ res: BestPostsResponse; language?: string | null }> = ({ res, language }) => {
  const make = useMake(language);
  const rows = res.trending.map(trendView);
  return (
    <section className="nb-ct-card" aria-labelledby="ct-trending-title">
      <div className="nb-ct-sechead">
        <h2 id="ct-trending-title">Trending for you</h2>
        <span className="nb-ct-sub">Each idea says what it is based on</span>
      </div>
      <ul className="nb-ct-rows">
        {rows.map((r) => {
          const Icon = SOURCE_ICON[r.tone];
          return (
            <li key={r.key} className="nb-ct-row" data-tone={r.tone}>
              <span className="nb-ct-mark" aria-hidden="true"><Icon aria-hidden="true" /></span>
              <div className="nb-ct-row-body">
                <span className="nb-ct-label">{r.label}</span>
                <p className="nb-ct-row-title">{r.title}</p>
                <p className="nb-ct-row-reason">{r.reason}</p>
              </div>
              <button type="button" className="nb-ct-btn" onClick={() => make(r.action)} aria-label={`${r.action.label}: ${r.title}`}>
                <Sparkles aria-hidden="true" />{r.action.label}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const Lists: React.FC<{ res: BestPostsResponse | null; state: BoardState; language?: string | null }> = ({ res, state, language }) => {
  const show = sectionsToShow(res, state);
  if (!res || (!show.working && !show.trending)) return null;
  const count = (show.working ? 1 : 0) + (show.trending ? 1 : 0);
  return (
    <div className="nb-ct-lists" data-count={count}>
      {show.working && <WorkingList res={res} language={language} />}
      {show.trending && <TrendingList res={res} language={language} />}
    </div>
  );
};

/** Home: "Your competitors" with up to three compact tiles, then What's working and Trending for you. */
export const HomeCompetitors: React.FC<{ enabled: boolean; language?: string | null; noPlanLinks?: boolean }> = ({ enabled, language, noPlanLinks = false }) => {
  const { res, state, reload } = useBestPosts(enabled);
  const show = sectionsToShow(res, state);
  if (!enabled || !show.competitors) return null;
  const note = boardNote(state, { clientWorkspace: noPlanLinks });
  const cards = state === 'ready' ? homeCards(res) : [];
  const total = res?.competitors?.length || 0;
  return (
    <>
      <section className="nb-ct-card" aria-labelledby="ct-home-title" aria-busy={state === 'loading' ? 'true' : undefined}>
        <div className="nb-ct-sechead">
          <h2 id="ct-home-title">Your competitors</h2>
          {state === 'ready' && <Link to="/competitors" className="nb-ct-link">{total > cards.length ? `See all ${total}` : 'Open Competitors'}<ArrowRight aria-hidden="true" /></Link>}
        </div>
        {state === 'loading' && <TileSkeleton count={3} />}
        {note && (
          <p className="nb-ct-quiet" role={state === 'error' ? 'status' : undefined}>
            <span>{note.text}</span>
            {note.link && <Link to={note.link.to} className="nb-ct-link">{note.link.text}<ArrowRight aria-hidden="true" /></Link>}
            {state === 'error' && <button type="button" className="nb-ct-btn" onClick={reload}>Try again</button>}
          </p>
        )}
        {cards.length > 0 && (
          <ul className="nb-ct-grid" data-home="true" aria-label="Competitors">
            {cards.map((c) => <li key={c.id}><CompetitorTile card={c} /></li>)}
          </ul>
        )}
      </section>
      <Lists res={res} state={state} language={language} />
    </>
  );
};

/** The Competitors page: every tracked competitor as a tile (with Confirm or Edit handle), then the two lists. When the
 *  account has no add-on the page shows its own note, so only Trending for you appears here. */
export const CompetitorBoard: React.FC<{ language?: string | null; onLocked?: () => void }> = ({ language, onLocked }) => {
  const { res, setRes, state, reload } = useBestPosts(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const told = useRef(false);
  useEffect(() => { if (state === 'locked' && onLocked && !told.current) { told.current = true; onLocked(); } }, [state, onLocked]);
  const onSaved = useCallback((saved: SavedHandle) => {
    setRes((r) => (r ? { ...r, competitors: r.competitors.map((c) => (c.id === saved.id ? { ...c, handle: saved.handle, status: 'waiting' as const, profileUrl: null } : c)) } : r));
    setNotes((n) => ({ ...n, [saved.id]: handleSavedNote(saved) }));
  }, [setRes]);
  if (state === 'staff') return null;
  const note = state === 'locked' ? null : boardNote(state, {});
  const cards = res && state !== 'locked' && state !== 'error' ? res.competitors : [];
  return (
    <div className="mb-6 flex flex-col gap-4">
      {state !== 'locked' && (
        <section className="nb-ct-card" aria-labelledby="ct-board-title" aria-busy={state === 'loading' ? 'true' : undefined}>
          <div className="nb-ct-sechead">
            <h2 id="ct-board-title">Your competitors</h2>
            <span className="nb-ct-sub">From their public posts, checked once a week</span>
          </div>
          {state === 'loading' && <TileSkeleton count={3} />}
          {note && state !== 'none' && (
            <p className="nb-ct-quiet" role={state === 'error' ? 'status' : undefined}>
              <span>{note.text}</span>
              {state === 'error' && <button type="button" className="nb-ct-btn" onClick={reload}>Try again</button>}
            </p>
          )}
          {state === 'none' && <p className="nb-ct-quiet"><span>Add the competitors you want to follow below. We look at their public posts each week.</span></p>}
          {cards.length > 0 && (
            <ul className="nb-ct-grid" aria-label="Competitors">
              {cards.map((c) => <li key={c.id}><CompetitorTile card={c} editable savedNote={notes[c.id]} onSaved={onSaved} onLocked={onLocked} /></li>)}
            </ul>
          )}
        </section>
      )}
      <Lists res={res} state={state} language={language} />
    </div>
  );
};
