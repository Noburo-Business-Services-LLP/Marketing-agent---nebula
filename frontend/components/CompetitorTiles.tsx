import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Compass, ExternalLink, Film, Gift, Heart, Image as ImageIcon, Layers, MessageCircle, Newspaper, Sparkles, Star, TrendingUp } from 'lucide-react';
import { apiService } from '../services/api';
import HandleEditor, { SavedHandle } from './HandleEditor';
import { setPrefill } from '../utils/prefill';
import { handleSavedNote } from '../utils/competitorInsights';
import {
  boardNote, boardState, draftSourceTitle, galleryView, gallerySpans, homeCards, isBestPostsResponse, sectionsToShow, thumbSrc, tileView, trendHandoff, trendView, workingView,
  type BestPostsResponse, type BoardState, type CompetitorCard, type MakeAction, type PostKind, type TrendSource,
} from '../utils/competitorsHome';
import { draftsAvailable, isDraftOptions, type DraftKind, type DraftOptions, type DraftSource } from '../utils/homeDrafts';
import { DraftActions, DraftSheet } from './home/DraftSheet';
import CompetitorAvatar from './CompetitorAvatar';
import './CompetitorTiles.css';

// Competitor tiles, "What's working for your competitors" and "Trending for you", from GET /api/competitors/best-posts
// (stored data only: no read of anyone's page happens here, and no model is called). Used on Home (three tiles) and on
// the Competitors page (every tracked competitor, with the handle controls). Each block shows only with real data.

const KIND_ICON: Record<PostKind, React.FC<{ 'aria-hidden'?: boolean | 'true' }>> = { video: Film, image: ImageIcon, carousel: Layers };
const SOURCE_ICON: Record<TrendSource, React.FC<{ 'aria-hidden'?: boolean | 'true' }>> = { competitor: TrendingUp, own: Star, festival: Gift, news: Newspaper, plan: Compass };

/** A post picture: our stored copy, lazily loaded, or (none or a load error) the post type on a soft tint. */
const PostPicture: React.FC<{ src: string | null; kind: PostKind; alt?: string; size?: 'lg' | 'sm' }> = ({ src, kind, alt = '', size = 'lg' }) => {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const Icon = KIND_ICON[kind] || ImageIcon;
  if (src && !broken) {
    return <img className="nb-cp-img" src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" width={360} height={450} onError={() => setBroken(true)} />;
  }
  return <span className="nb-cp-fallback" data-kind={kind} data-size={size} role={alt ? 'img' : undefined} aria-label={alt || undefined}><Icon aria-hidden="true" /></span>;
};

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

/** The Home drafts options (prices, switch, entitlement), read once the board has data. A failure only hides the actions. */
export function useDraftOptions(enabled: boolean) {
  const [opts, setOpts] = useState<DraftOptions | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiService.getHomeDraftOptions().then((o) => { if (alive) setOpts(isDraftOptions(o) ? o : null); }).catch(() => { if (alive) setOpts(null); });
    return () => { alive = false; };
  }, [enabled, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { opts, refresh };
}

type OnDraft = (kind: DraftKind, source: DraftSource) => void;
interface DraftsProps { drafts?: DraftOptions | null; postsOnly?: boolean; onDraft?: OnDraft }

/** The sheet for one draft, and the opener the tiles and rows call. */
function useDraftSheet(drafts: DraftOptions | null, postsOnly: boolean, refresh: () => void) {
  const [open, setOpen] = useState<{ kind: DraftKind; source: DraftSource } | null>(null);
  const onDraft = useCallback<OnDraft>((kind, source) => setOpen({ kind, source }), []);
  const sheet = open && drafts
    ? <DraftSheet kind={open.kind} source={open.source} options={drafts} postsOnly={postsOnly} onClose={() => setOpen(null)} onDone={refresh} />
    : null;
  return { onDraft, sheet };
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

export const CompetitorTile: React.FC<{ card: CompetitorCard; editable?: boolean; savedNote?: string; onSaved?: (s: SavedHandle) => void; onLocked?: () => void } & DraftsProps> = ({ card, editable = false, savedNote, onSaved, onLocked, drafts, postsOnly = false, onDraft }) => {
  const v = tileView(card);
  const ref = card.bestPost?.ref || '';
  const canDraft = Boolean(v.best && onDraft && draftsAvailable(drafts, ref));
  const BestIcon = v.best ? KIND_ICON[v.best.kind] || ImageIcon : null;
  return (
    <article className="nb-ct-tile" data-status={card.status} aria-label={`${v.name}${v.handleText ? ` ${v.handleText}` : ''}: ${v.chip.text}`}>
      <header className="nb-ct-head">
        <CompetitorAvatar name={v.name} handle={card.handle} url={card.avatarUrl} />
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
        <p className="nb-ct-best" data-thumb={thumbSrc(card.bestPost?.thumbUrl) ? 'true' : undefined}>
          {thumbSrc(card.bestPost?.thumbUrl)
            ? <span className="nb-ct-best-thumb"><PostPicture src={thumbSrc(card.bestPost?.thumbUrl)} kind={v.best.kind} size="sm" /></span>
            : <BestIcon aria-hidden="true" />}
          <span className="nb-ct-best-text">
            <strong>{v.best.text}</strong>{v.best.counts ? `, ${v.best.counts}` : ''}
            {v.best.url && <a className="nb-ct-link" href={v.best.url} target="_blank" rel="noopener noreferrer">Open the post<ExternalLink aria-hidden="true" /></a>}
          </span>
        </p>
      )}
      {v.worked && <p className="nb-ct-worked" data-quiet={v.workedIsQuiet ? 'true' : undefined}><Sparkles aria-hidden="true" /><span>{v.worked}</span></p>}
      {canDraft && drafts && v.best && (
        <DraftActions options={drafts} postsOnly={postsOnly} onPick={(k) => onDraft!(k, { ref, title: draftSourceTitle(card.name, card.bestPost?.type), url: v.best!.url, name: card.name, handle: card.handle, avatarUrl: card.avatarUrl ?? null })} />
      )}
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

/** The two draft actions folded into one small menu on a post card. */
const DraftMenu: React.FC<{ drafts: DraftOptions; postsOnly: boolean; onPick: (k: DraftKind) => void }> = ({ drafts, postsOnly, onPick }) => (
  <details className="nb-cp-menu">
    <summary className="nb-ct-btn nb-cp-menu-btn">More drafts<ChevronDown aria-hidden="true" /></summary>
    <div className="nb-cp-menu-pop"><DraftActions compact options={drafts} postsOnly={postsOnly} onPick={onPick} /></div>
  </details>
);

/** "What's working for your competitors": their strongest recent posts as picture cards (our stored copies only). */
export const WorkingList: React.FC<{ res: BestPostsResponse; language?: string | null } & DraftsProps> = ({ res, language, drafts, postsOnly = false, onDraft }) => {
  const make = useMake(language);
  const rows = res.working.map(workingView);
  const avatarOf = new Map(res.competitors.map((c) => [c.id, c.avatarUrl ?? null]));
  return (
    <section className="nb-ct-card nb-cp" aria-labelledby="ct-working-title">
      <div className="nb-ct-sechead">
        <h2 id="ct-working-title">What's working for your competitors</h2>
        <span className="nb-ct-sub">Their strongest recent public posts</span>
      </div>
      <ul className="nb-cp-grid" data-count={rows.length}>
        {rows.map((r, i) => {
          const w = res.working[i];
          const Icon = KIND_ICON[r.kind] || ImageIcon;
          const canDraft = Boolean(onDraft && drafts && draftsAvailable(drafts, r.ref));
          return (
            <li key={r.key}>
              <article className="nb-cp-card" aria-label={`${r.byline}: ${r.reason}`}>
                <div className="nb-cp-media">
                  <PostPicture src={r.thumb} kind={r.kind} />
                  {r.counts && (
                    <span className="nb-cp-counts">
                      <span><Heart aria-hidden="true" />{r.counts.likes}<span className="sr-only"> likes</span></span>
                      {r.counts.comments && <span><MessageCircle aria-hidden="true" />{r.counts.comments}<span className="sr-only"> comments</span></span>}
                    </span>
                  )}
                  <span className="nb-cp-kind" aria-hidden="true"><Icon /></span>
                  <span className="nb-cp-from">
                    <CompetitorAvatar name={r.title} handle={r.handle} url={avatarOf.get(String(w?.competitorId || '')) ?? null} size={26} />
                    <span>{r.byline}</span>
                  </span>
                </div>
                <div className="nb-cp-body">
                  <p className="nb-cp-why"><span className="nb-cp-why-label">Why it worked</span>{r.why}</p>
                  <div className="nb-cp-actions">
                    <button type="button" className="nb-ct-btn nb-cp-make" onClick={() => make(r.action)} aria-label={`${r.action.label}: ${r.byline}`}>
                      <Sparkles aria-hidden="true" />{r.action.label}
                    </button>
                    {canDraft && drafts && (
                      <DraftMenu drafts={drafts} postsOnly={postsOnly} onPick={(k) => onDraft!(k, { ref: r.ref, title: draftSourceTitle(r.title, r.kind), url: r.url, name: w?.name || r.title, handle: w?.handle || '', avatarUrl: avatarOf.get(String(w?.competitorId || '')) ?? null })} />
                    )}
                  </div>
                  {r.url && <a className="nb-ct-link nb-cp-open" href={r.url} target="_blank" rel="noopener noreferrer">Open the post on Instagram<ExternalLink aria-hidden="true" /></a>}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/** The Competitors page: one row per competitor with their best and newest posts (pictures only when stored). */
export const CompetitorGalleries: React.FC<{ cards: CompetitorCard[] }> = ({ cards }) => {
  const rows = cards.map((c) => ({ c, tiles: galleryView(c) })).filter((x) => x.tiles.length > 0);
  if (!rows.length) return null;
  return (
    <section className="nb-ct-card nb-cg" aria-labelledby="ct-gallery-title">
      <div className="nb-ct-sechead">
        <h2 id="ct-gallery-title">Their best posts</h2>
        <span className="nb-ct-sub">Public posts, best of the last 30 days first. Each opens the original on Instagram.</span>
      </div>
      <div className="nb-cg-rows">
        {rows.map(({ c, tiles }) => {
          const g = gallerySpans(tiles.length);
          return (
            <div key={c.id} className="nb-cg-row">
              <div className="nb-cg-who">
                <CompetitorAvatar name={c.name} handle={c.handle} url={c.avatarUrl} size={28} />
                <h3>{c.name}</h3>
                {c.handle && <span>From @{c.handle}</span>}
              </div>
              <ul className="nb-cg-strip" style={{ ['--wide' as any]: g.wide, ['--narrow' as any]: g.narrow }} aria-label={`Posts from ${c.handle ? `@${c.handle}` : c.name}`}>
                {tiles.map((t, i) => {
                  const inner = (
                    <>
                      <PostPicture src={t.thumb} kind={t.kind} alt={t.alt} size="sm" />
                      <span className="nb-cg-chip" data-pick={t.pick}>{t.label}</span>
                      {t.likes && <span className="nb-cg-likes"><Heart aria-hidden="true" />{t.likes}</span>}
                    </>
                  );
                  return (
                    <li key={t.key} style={{ ['--span' as any]: g.spans[i] }}>
                      {t.url
                        ? <a className="nb-cg-tile" href={t.url} target="_blank" rel="noopener noreferrer" title={`Open on Instagram: ${t.alt}`}>{inner}</a>
                        : <span className="nb-cg-tile">{inner}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
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
                {r.idea && <p className="nb-ct-row-idea">{r.idea}</p>}
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

const Lists: React.FC<{ res: BestPostsResponse | null; state: BoardState; language?: string | null } & DraftsProps> = ({ res, state, language, drafts, postsOnly, onDraft }) => {
  const show = sectionsToShow(res, state);
  if (!res || (!show.working && !show.trending)) return null;
  const count = (show.working ? 1 : 0) + (show.trending ? 1 : 0);
  return (
    <div className="nb-ct-lists" data-count={count}>
      {show.working && <WorkingList res={res} language={language} drafts={drafts} postsOnly={postsOnly} onDraft={onDraft} />}
      {show.trending && <TrendingList res={res} language={language} />}
    </div>
  );
};

/** Home: "Your competitors" with up to three compact tiles, then What's working and Trending for you. */
export const HomeCompetitors: React.FC<{ enabled: boolean; language?: string | null; noPlanLinks?: boolean; postsOnly?: boolean }> = ({ enabled, language, noPlanLinks = false, postsOnly = false }) => {
  const { res, state, reload } = useBestPosts(enabled);
  const { opts: drafts, refresh } = useDraftOptions(enabled && state === 'ready');
  const { onDraft, sheet } = useDraftSheet(drafts, postsOnly, refresh);
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
            {cards.map((c) => <li key={c.id}><CompetitorTile card={c} drafts={drafts} postsOnly={postsOnly} onDraft={onDraft} /></li>)}
          </ul>
        )}
      </section>
      <Lists res={res} state={state} language={language} drafts={drafts} postsOnly={postsOnly} onDraft={onDraft} />
      {sheet}
    </>
  );
};

/** The Competitors page: every tracked competitor as a tile (with Confirm or Edit handle), then the two lists. When the
 *  account has no add-on the page shows its own note, so only Trending for you appears here. */
export const CompetitorBoard: React.FC<{ language?: string | null; onLocked?: () => void; postsOnly?: boolean }> = ({ language, onLocked, postsOnly = false }) => {
  const { res, setRes, state, reload } = useBestPosts(true);
  const { opts: drafts, refresh } = useDraftOptions(state === 'ready');
  const { onDraft, sheet } = useDraftSheet(drafts, postsOnly, refresh);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const told = useRef(false);
  useEffect(() => { if (state === 'locked' && onLocked && !told.current) { told.current = true; onLocked(); } }, [state, onLocked]);
  const onSaved = useCallback((saved: SavedHandle) => {
    setRes((r) => (r ? { ...r, competitors: r.competitors.map((c) => (c.id === saved.id ? { ...c, handle: saved.handle, status: 'waiting' as const, profileUrl: null, avatarUrl: saved.handle.toLowerCase() === c.handle.toLowerCase() ? c.avatarUrl : null } : c)) } : r));
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
              {cards.map((c) => <li key={c.id}><CompetitorTile card={c} editable savedNote={notes[c.id]} onSaved={onSaved} onLocked={onLocked} drafts={drafts} postsOnly={postsOnly} onDraft={onDraft} /></li>)}
            </ul>
          )}
        </section>
      )}
      {state === 'ready' && res && <CompetitorGalleries cards={res.competitors} />}
      <Lists res={res} state={state} language={language} drafts={drafts} postsOnly={postsOnly} onDraft={onDraft} />
      {sheet}
    </div>
  );
};
