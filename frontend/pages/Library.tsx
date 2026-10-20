import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookmarkMinus, Download, Eye, Film, Image as ImageIcon, Loader2, Pencil, Play, RotateCcw, Trash2, Wand2, X } from 'lucide-react';
import { GravityButton } from '../components/gravity';
import GenerationTimer from '../components/GenerationTimer';
import HeroShare from '../components/HeroShare';
import HeroEdit from '../components/HeroEdit';
import { DraftPreviewModal } from '../components/DraftPreviewModal';
import { orderForViewing } from '../utils/postOrder';
import PlatformIcon from '../components/PlatformIcon';
import { draftsAPI, videoGenerationAPI, heroVideoAPI, photoshootAPI, studioVideosAPI, DraftCounts } from '../services/api';
import PostActions, { PostNotice, PostNoticeValue } from '../components/PostActions';
import ItemActions, { ItemAction } from '../components/ItemActions';
import { usePostAccess } from '../hooks/usePostAccess';
import { downloadImage } from '../utils/download';
import { setPrefill } from '../utils/prefill';
import { MEDIA_LABELS, PHOTO_HINTS, STUDIO_HINTS, libraryVideoActionKeys, photoActionKeys, photoDeleteConfirm, studioDeleteConfirm } from '../utils/itemActions';
import { useQuarkCosts } from '../hooks/useQuarkCosts';
import { binDaysLeft, BIN_DAYS, REASONS } from '../utils/postActions';
import { platformLabel } from '../utils/platforms';
import {
  LibraryItem, LibraryFilters, LibraryView, DEFAULT_FILTERS, STATUS_WORD, LIBRARY_VIEWS,
  fromPostDraft, fromVideoDraft, fromHeroJob, fromPhotoshootPhoto, fromStudioVideo, applyFilters, inView, defaultView, statusWordOf,
  SOURCE_WORD,
} from '../utils/library';
import '../components/library/library.css';
import PageHeader from '../components/PageHeader';
import GravityApprove from './GravityApprove';
import type { User } from '../types';
import { openSafe } from '../utils/safeHref';

const KINDS: Array<{ key: LibraryFilters['kind']; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'image', label: 'Images' }, { key: 'video', label: 'Videos' },
];

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--gv-bg,transparent)]';
const seg = (on: boolean) =>
  `shrink-0 whitespace-nowrap h-6 px-2.5 rounded-full text-[12px] font-medium transition-colors ${focusRing} ${on ? 'bg-[var(--gv-accent-fill)] text-[var(--gv-text-primary)] font-semibold shadow-[inset_0_0_0_1px_var(--gv-accent)]' : 'text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'}`;
const select = 'h-9 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 text-[13px] text-[var(--gv-text-primary)]';

const POSTS_STEP = 30;

const fmtDate = (t: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Everything you have made, images and videos together, in views: Needs approval, Approved, Scheduled, Posted, All, Archived, Bin. */
const Library: React.FC<{ user?: User | null }> = ({ user }) => {
  const navigate = useNavigate();
  const quarkCosts = useQuarkCosts();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [binItems, setBinItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [binLoading, setBinLoading] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [counts, setCounts] = useState<DraftCounts | null>(null);
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [notice, setNotice] = useState<PostNoticeValue | null>(null);
  const view: LibraryView = defaultView(params.get('view'), countsLoaded ? counts?.needsApproval : 0);
  // Review one by one (the old Review and approve page) is drawn here for the Needs approval view: &mode=one.
  const oneByOne = view === 'approve' && params.get('mode') === 'one';
  const setView = (v: LibraryView) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    next.delete('mode');
    setParams(next, { replace: true });
    setNotice(null);
  };
  // Opening the one-by-one review adds a history entry, so the browser back button returns to the grid.
  const setOneByOne = (on: boolean) => {
    const next = new URLSearchParams(params);
    next.set('view', 'approve');
    if (on) next.set('mode', 'one'); else next.delete('mode');
    setParams(next, { replace: !on });
  };

  const loadCounts = useCallback(async () => {
    try { const r = await draftsAPI.getDraftCounts(); setCounts(r?.counts || null); } catch { setCounts(null); } finally { setCountsLoaded(true); }
  }, []);

  const loadBin = useCallback(async (quiet = false) => {
    if (!quiet) setBinLoading(true);
    try {
      const r = await draftsAPI.getBin();
      setBinItems((r?.drafts || []).map((d: any) => fromPostDraft(d)).filter((x: LibraryItem | null): x is LibraryItem => Boolean(x && x.status === 'binned')));
    } catch { setBinItems([]); } finally { setBinLoading(false); }
  }, []);

  // Posts come in pages (newest first): the Library reads the newest POSTS_STEP and "Load more" reads the next ones.
  // A refresh reads as many as are already shown, so nothing disappears while you look.
  const postTarget = useRef(POSTS_STEP);
  const [morePosts, setMorePosts] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [posts, videos, heroes, shoots, studio] = await Promise.allSettled([
      draftsAPI.getDraftsUpTo(postTarget.current),
      videoGenerationAPI.getDrafts(),
      heroVideoAPI.list(),
      photoshootAPI.library(),
      studioVideosAPI.list(),
    ]);
    const bad: string[] = [];
    const all: LibraryItem[] = [];
    if (posts.status === 'fulfilled') {
      setMorePosts(Boolean(posts.value?.nextCursor));
      (posts.value?.drafts || []).forEach((d: any) => {
        const c = fromPostDraft(d); if (c && c.status !== 'binned') all.push(c);
      });
    } else bad.push('posts and images');
    if (videos.status === 'fulfilled') (videos.value?.drafts || []).forEach((d: any) => { const c = fromVideoDraft(d); if (c) all.push(c); });
    else bad.push('videos');
    if (heroes.status === 'fulfilled') ((heroes.value as any)?.jobs || []).forEach((j: any) => { const c = fromHeroJob(j); if (c) all.push(c); });
    else if (!bad.includes('videos')) bad.push('videos');
    if (studio.status === 'fulfilled') ((studio.value as any)?.videos || []).forEach((v: any) => { const c = fromStudioVideo(v); if (c) all.push(c); });
    else if (!bad.includes('videos')) bad.push('videos');
    if (shoots.status === 'fulfilled') ((shoots.value as any)?.photos || []).forEach((p: any) => { const c = fromPhotoshootPhoto(p); if (c) all.push(c); });
    else bad.push('photoshoots');
    setItems(all); setProblems(bad); setLoading(false);
  }, []);

  const loadMore = async () => {
    postTarget.current += POSTS_STEP;
    setLoadingMore(true);
    try { await load(true); } finally { setLoadingMore(false); }
  };

  useEffect(() => { load(); loadCounts(); }, [load, loadCounts]);
  // A post action anywhere on the page (also inside Review one by one) refreshes the list and the counts.
  useEffect(() => {
    const onChange = () => { load(true); loadCounts(); };
    window.addEventListener('nebulaa-posts-changed', onChange);
    return () => window.removeEventListener('nebulaa-posts-changed', onChange);
  }, [load, loadCounts]);
  useEffect(() => { if (view === 'bin') loadBin(); }, [view, loadBin]);
  // A message belongs to the view it was shown in.
  useEffect(() => { setNotice(null); }, [view]);
  // Keep checking while anything is still being made.
  const anyCreating = items.some((i) => i.status === 'creating');
  useEffect(() => {
    if (!anyCreating) return;
    const id = setInterval(() => load(true), 8000);
    return () => clearInterval(id);
  }, [anyCreating, load]);

  // After any action: the list, the Bin (when open) and the counts.
  const refresh = useCallback(() => { load(true); loadCounts(); if (view === 'bin') loadBin(true); }, [load, loadCounts, loadBin, view]);

  const source = view === 'bin' ? binItems : items;
  const shown = useMemo(() => applyFilters(source.filter((i) => inView(i, view)), filters), [source, view, filters]);
  // Counts per view: from the server (posts); views it does not count use what is loaded.
  const countFor = (key?: keyof DraftCounts): number | null => (key && counts && Number.isFinite(counts[key]) ? counts[key] : null);
  // Post cards keep one size and flow in a grid as more are made, newest first (applyFilters sorts by date); the grid
  // never widens a card to fill a row (owner, 2026-10-19: the full-width rule is for the page, not for post cards).
  const platforms = useMemo(() => Array.from(new Set(items.flatMap((i) => i.platforms))).sort(), [items]);
  const set = (patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const goEdit = (i: LibraryItem) => {
    setOpen(null);
    if (i.source === 'hero') setOpen(i);
    else if (i.source === 'video-draft') navigate(`/reels?jobId=${encodeURIComponent(i.id)}`);
    else if (i.source === 'reel' && i.jobId) navigate(`/reels?jobId=${encodeURIComponent(i.jobId)}`);
    else if (i.source === 'photoshoot') navigate('/photoshoot');
    else if (i.source === 'studio') navigate(`/reels?open=${encodeURIComponent(i.id)}`);
    // A post opens its own sheet, where it can be edited.
    else setOpen(i);
  };

  const [removeError, setRemoveError] = useState('');
  const access = usePostAccess();
  // A video from the Videos page is made again there: its plan opens again and the price shows before anything is made.
  const makeVideoAgain = (i: LibraryItem) => navigate(`/reels?again=${encodeURIComponent(i.id)}`);
  const studioQuarks = (i: LibraryItem) => Math.round((quarkCosts.studio_video || 0) * (i.clips || 1));
  const tellError = (text: string) => { setRemoveError(text); setNotice({ text, tone: 'error' }); };
  const afterDelete = (text: string) => { setOpen(null); setRemoveError(''); setNotice({ text, tone: 'ok' }); refresh(); };
  // Videos from the older tools and from the Videos page are deleted for good on the server (no Bin there); the
  // question is asked by ItemActions before this runs.
  const deleteVideo = async (i: LibraryItem) => {
    try {
      const r: any = i.source === 'hero' ? await heroVideoAPI.remove(i.id) : i.source === 'video-draft' ? await videoGenerationAPI.deleteDraft(i.id) : await studioVideosAPI.remove(i.id);
      if (r && r.success === false) throw new Error(r.message || 'We could not delete this.');
      afterDelete('Deleted.');
    } catch (e: any) { tellError(e?.message || 'We could not delete this. Please try again.'); }
  };
  const photoIndexOf = (i: LibraryItem) => (Number.isInteger(i.photoIndex) ? (i.photoIndex as number) : 0);
  const removePhotoFromLibrary = async (i: LibraryItem) => {
    try {
      const r: any = await photoshootAPI.setInLibrary(i.jobId || '', photoIndexOf(i), false);
      if (r && r.success === false) throw new Error(r.message || 'We could not change that just now.');
      setOpen(null); setNotice({ text: 'Taken out of your Library. It stays in its photoshoot.', tone: 'ok' }); refresh();
    } catch (e: any) { tellError(e?.message || 'We could not change that just now. Please try again.'); }
  };
  const deletePhoto = async (i: LibraryItem) => {
    try {
      const r: any = await photoshootAPI.deletePhoto(i.jobId || '', photoIndexOf(i));
      if (r && r.success === false) throw new Error(r.message || 'We could not delete that photo.');
      afterDelete('Photo deleted.');
    } catch (e: any) { tellError(e?.message || 'We could not delete that photo. Please try again.'); }
  };
  const photoToCreate = (i: LibraryItem) => {
    setPrefill('carousel', { mode: 'single', topic: '', source: 'home', photo: { name: i.title || 'Photoshoot photo', imageUrl: i.mediaUrl } });
    navigate('/campaigns');
  };

  /** The shared item buttons (components/ItemActions.tsx) for a tile or panel that is not a post: videos and photos. */
  const itemActionsFor = (i: LibraryItem): ItemAction[] => {
    if (i.source === 'photoshoot') {
      return photoActionKeys({ hasPhoto: Boolean(i.mediaUrl), inLibrary: true, canRedo: false, canDelete: Boolean(i.jobId) }).map((k): ItemAction => {
        if (k === 'useInCreate') return { key: k, label: MEDIA_LABELS.useInCreate, hint: 'Make a post with this photo.', icon: Wand2, onRun: () => photoToCreate(i) };
        if (k === 'download') return { key: k, label: MEDIA_LABELS.download, hint: 'Save the photo to your device.', icon: Download, primary: true, onRun: () => downloadImage(i.mediaUrl, i.title || 'photo') };
        if (k === 'deletePhoto') return { key: k, label: MEDIA_LABELS.deletePhoto, hint: PHOTO_HINTS.deletePhoto, icon: Trash2, danger: true, confirm: photoDeleteConfirm(), onRun: () => deletePhoto(i) };
        return { key: 'remove', label: MEDIA_LABELS.remove, hint: PHOTO_HINTS.remove, icon: BookmarkMinus, onRun: () => removePhotoFromLibrary(i) };
      });
    }
    return libraryVideoActionKeys(i).map((k): ItemAction => {
      if (k === 'download') return { key: k, label: MEDIA_LABELS.download, hint: STUDIO_HINTS.download, icon: Download, primary: true, onRun: () => { openSafe(i.mediaUrl); } };
      if (k === 'edit' || k === 'open') return { key: k, label: k === 'edit' ? MEDIA_LABELS.edit : MEDIA_LABELS.open, hint: k === 'edit' ? 'Change the clips, words or music.' : 'Open it where it was made.', icon: k === 'edit' ? Pencil : Eye, onRun: () => goEdit(i) };
      if (k === 'makeAgain') { const q = studioQuarks(i); return { key: k, label: MEDIA_LABELS.makeAgain, hint: STUDIO_HINTS.makeAgain(q), icon: RotateCcw, quarks: q || undefined, primary: i.status === 'failed', onRun: () => makeVideoAgain(i) }; }
      return {
        key: 'delete', label: MEDIA_LABELS.delete, hint: STUDIO_HINTS.delete, icon: Trash2, danger: true,
        confirm: i.source === 'video-draft' ? { title: `Delete "${i.title}"?`, message: 'This removes it and its files. This cannot be undone.', confirmLabel: 'Delete', danger: true } : studioDeleteConfirm(i.title),
        onRun: () => deleteVideo(i),
      };
    });
  };

  // Make again redraws a post's picture: the same price as Review and approve shows (0 for campaign posts).
  const makeAgainQuarks = (d: any) => (d?.contentType === 'campaign' ? 0 : (quarkCosts.image_generated || 0));
  // Posts and images get the shared post actions and the post sheet. Reels from the plan are post drafts too: same
  // actions on the tile and in the panel, but their panel plays the video. Other videos and photos use ItemActions.
  const isPost = (i: LibraryItem) => i.source === 'post' && Boolean(i.raw);
  const isReel = (i: LibraryItem) => i.source === 'reel' && Boolean(i.raw);
  const listLoading = view === 'bin' ? binLoading : loading;
  const needs = countFor('needsApproval');

  const emptyText: Record<LibraryView, string> = {
    approve: 'Nothing is waiting for your approval. Posts Nebulaa prepares for you appear here.',
    approved: 'No approved posts are waiting. Approve a post and it waits here to be scheduled or posted.',
    scheduled: 'Nothing is scheduled.',
    posted: 'Nothing has been posted yet.',
    all: 'You have not made anything yet.',
    archived: 'Nothing is archived.',
    bin: 'The Bin is empty.',
  };

  return (
    <div className="w-full pb-8 space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Everything you have"
        emphasis="made"
        description="Images, videos and photoshoots in one place. Approve what Nebulaa prepared, then schedule, post or download it."
      />

      <div className="space-y-3">
        <div className="nb-lib-views" role="tablist" aria-label="Views" data-testid="library-views">
          {LIBRARY_VIEWS.map((v) => {
            const n = countFor(v.count);
            const on = view === v.key;
            return (
              <button key={v.key} type="button" role="tab" aria-selected={on} onClick={() => setView(v.key)} className="nb-lib-view" data-on={on ? 'true' : undefined} data-view={v.key}>
                <span>{v.label}</span>
                {n !== null && n > 0 && <span className="nb-lib-count" data-attention={v.key === 'approve' ? 'true' : undefined} aria-label={`${n} ${n === 1 ? 'item' : 'items'}`}>{n > 99 ? '99+' : n}</span>}
              </button>
            );
          })}
        </div>
        {!oneByOne && <div className="flex flex-wrap items-center gap-2" data-testid="library-filter-row">
          <div className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-[var(--gv-border-default)] bg-[var(--gv-panel)] p-0.5" role="group" aria-label="Type">
            {KINDS.map((k) => <button key={k.key} type="button" aria-pressed={filters.kind === k.key} onClick={() => set({ kind: k.key })} className={seg(filters.kind === k.key)}>{k.label}</button>)}
          </div>
          {/* The platform filter only when posts are for two or more platforms; with one it would filter nothing. */}
          {(platforms.length > 1 || filters.platform) && (
            <select aria-label="Platform" value={filters.platform} onChange={(e) => set({ platform: e.target.value })} className={select}>
              <option value="">All platforms</option>
              {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
            </select>
          )}
        </div>}
      </div>

      {oneByOne && <GravityApprove user={user} embedded onBack={() => setOneByOne(false)} />}

      {!oneByOne && view === 'approve' && needs !== null && needs > 0 && (
        <div className="nb-lib-band" data-tone="approve">
          <p><strong>{needs} {needs === 1 ? 'post waits' : 'posts wait'} for your approval.</strong> Approving never posts by itself: a post with a planned date is scheduled for it, the others wait as Approved.</p>
          <button type="button" className="nb-pa-btn" onClick={() => setOneByOne(true)}>Review one by one</button>
        </div>
      )}
      {view === 'bin' && (
        <div className="nb-lib-band" data-tone="bin">
          <p>Items stay in the Bin for {BIN_DAYS} days, then they are removed for good with their pictures. Restore one to keep it.</p>
        </div>
      )}

      <PostNotice notice={notice} onClose={() => setNotice(null)} />
      {problems.length > 0 && <p role="status" className="text-[13px] text-[var(--gv-text-secondary)]">We could not load your {problems.join(' and ')} just now. The rest are shown below.</p>}

      {oneByOne ? null : listLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--gv-accent)]" aria-label="Loading your library" /></div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] py-14 px-4 text-center space-y-3">
          <p className="text-[14.5px] text-[var(--gv-text-primary)]">{source.some((i) => inView(i, view)) ? 'Nothing matches these filters.' : morePosts && view !== 'bin' ? 'None of your newest posts are in this view. Load more posts to look further back.' : emptyText[view]}</p>
          {source.some((i) => inView(i, view)) ? <GravityButton variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</GravityButton>
            : view === 'all' && !items.length ? <GravityButton onClick={() => navigate('/campaigns')}>Create content</GravityButton>
              : view !== 'all' ? <GravityButton variant="ghost" onClick={() => setView('all')}>Show everything</GravityButton> : null}
        </div>
      ) : (
        <ul className="nb-lib-grid" data-testid="library-grid">
          {shown.map((i) => {
            const items = isPost(i) || isReel(i) ? [] : itemActionsFor(i);
            const post = isPost(i) || isReel(i);
            const word = statusWordOf(i);
            const daysLeft = i.status === 'binned' ? binDaysLeft(i.raw?.binnedAt) : 0;
            return (
              <li key={`${i.source}-${i.id}`} className="nb-lib-cell">
                <article className="nb-lib-tile">
                  <button type="button" onClick={() => (i.status === 'creating' ? undefined : setOpen(i))} disabled={i.status === 'creating'} className="nb-lib-open" aria-label={`Open ${i.title}`}>
                    <span className="nb-lib-pic">
                      {i.thumbnailUrl ? <img src={i.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                        : i.kind === 'video' ? <Film className="w-8 h-8" aria-hidden="true" /> : <ImageIcon className="w-8 h-8" aria-hidden="true" />}
                      {i.kind === 'video' && i.mediaUrl && i.status !== 'creating' && <span className="nb-lib-play" aria-hidden="true"><Play className="w-3.5 h-3.5" /></span>}
                      {i.status === 'creating' && <span className="nb-lib-timer"><GenerationTimer startedAt={i.createdAt || undefined} minSeconds={i.slideTotal ? 20 * i.slideTotal : (i.kind === 'video' ? 300 : 20)} maxSeconds={i.slideTotal ? 60 * i.slideTotal : (i.kind === 'video' ? 600 : 60)} /></span>}
                    </span>
                    <span className="nb-lib-body">
                      <span className="nb-lib-title">{i.title}</span>
                      <span className="nb-lib-meta">
                        <span>{i.status === 'binned' ? (daysLeft > 0 ? `Removed in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}` : 'Removed soon') : fmtDate(i.createdAt)}{i.slideTotal ? ` · ${i.slides && i.slides.length < i.slideTotal && i.status === 'creating' ? `${i.slides.length} of ${i.slideTotal}` : i.slideTotal} slides` : ''}</span>
                        <span className="nb-lib-platforms">{i.platforms.slice(0, 4).map((p) => <PlatformIcon key={p} platform={p} className="w-3.5 h-3.5" />)}</span>
                      </span>
                    </span>
                  </button>
                  <span className="nb-lib-chips" aria-hidden="true">
                    <span className="nb-lib-chip">{SOURCE_WORD[i.source]}</span>
                    <span className="nb-lib-chip" data-status={i.needsApproval && word === 'Needs approval' ? 'approval' : i.status}>{word}</span>
                  </span>
                  <span className="sr-only">{SOURCE_WORD[i.source]}, {word}</span>
                  {post ? (
                    <div className="nb-lib-foot">
                      <PostActions
                        draft={i.raw}
                        variant="compact"
                        label={i.title}
                        makeAgainQuarks={makeAgainQuarks(i.raw)}
                        onEdit={() => (isReel(i) ? goEdit(i) : setOpen(i))}
                        archiveVia={i.raw?.contentCalendarId && i.raw?.calendarDay ? 'reject' : 'archive'}
                        onMessage={(text, tone, to) => setNotice(text ? { text, tone, to } : null)}
                        onChanged={() => refresh()}
                      />
                    </div>
                  ) : items.length > 0 ? (
                    <div className="nb-lib-foot">
                      <ItemActions items={items} variant="compact" name={i.title} />
                    </div>
                  ) : <div className="nb-lib-foot" aria-hidden="true"><span className="nb-lib-foot-wait">{i.status === 'creating' ? 'Being made' : ''}</span></div>}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {/* Older posts load on request: the list reads the newest posts first so the page opens fast. */}
      {!oneByOne && view !== 'bin' && !listLoading && morePosts && (
        <div className="flex flex-col items-center gap-2 pt-2" data-testid="library-load-more">
          <p className="text-[13px] text-[var(--gv-text-secondary)]">Showing your newest posts. Older ones load when you ask.</p>
          <GravityButton variant="ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading</> : 'Load more posts'}
          </GravityButton>
        </div>
      )}

      {open && isPost(open) && (
        (() => {
          // Story order: a campaign's posts together in their planned order, other posts as listed.
          const eligible = shown.filter((x) => isPost(x) && x.status !== 'creating');
          const byId = new Map(eligible.map((x) => [String(x.raw._id), x]));
          const posts = orderForViewing(eligible.map((x) => x.raw)).map((o) => byId.get(String(o.draft._id))!).filter(Boolean);
          const at = posts.findIndex((x) => x.id === open.id);
          return (
            <DraftPreviewModal
              key={open.id}
              draft={open.raw}
              onClose={() => setOpen(null)}
              onSuccess={() => { setOpen(null); refresh(); }}
              onChanged={() => refresh()}
              onPrev={at > 0 ? () => setOpen(posts[at - 1]) : undefined}
              onNext={at >= 0 && at < posts.length - 1 ? () => setOpen(posts[at + 1]) : undefined}
              position={at >= 0 ? `${at + 1} / ${posts.length}` : undefined}
            />
          );
        })()
      )}

      {open && !isPost(open) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={open.title} onClick={() => setOpen(null)}>
          <div className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--gv-panel)] border border-[var(--gv-border-subtle)] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--gv-text-tertiary)]">{open.kind === 'video' ? 'Video' : 'Image'} · {STATUS_WORD[open.status]}</p>
                <h2 className="text-[18px] font-semibold text-[var(--gv-text-primary)]">{open.title}</h2>
              </div>
              <button type="button" onClick={() => { setOpen(null); setRemoveError(''); }} aria-label="Close" className="p-1.5 rounded-md text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)]"><X className="w-5 h-5" /></button>
            </div>
            {open.mediaUrl ? (open.kind === 'video'
              ? <video src={open.mediaUrl} controls playsInline className="w-full max-h-[55vh] rounded-xl bg-black" />
              : <img src={open.mediaUrl} alt={open.title} className="w-full max-h-[55vh] object-contain rounded-xl bg-[var(--gv-border-subtle)]" />)
              : <p className="text-[13px] text-[var(--gv-text-secondary)]">This one has no finished file yet.</p>}
            {open.caption && <p className="text-[13.5px] text-[var(--gv-text-secondary)] whitespace-pre-wrap">{open.caption}</p>}
            {isReel(open) ? (
              <PostActions
                draft={open.raw}
                variant="row"
                label={open.title}
                onEdit={() => goEdit(open)}
                archiveVia={open.raw?.contentCalendarId && open.raw?.calendarDay ? 'reject' : 'archive'}
                onChanged={(c) => { if (c.moved) setOpen(null); refresh(); }}
              />
            ) : (
              <ItemActions items={itemActionsFor(open)} variant="row" name={open.title} />
            )}
            {removeError && <p role="alert" className="text-[13px] text-[var(--gv-text-primary)]">{removeError}</p>}
            {open.source === 'hero' && open.mediaUrl && <HeroEdit key={`edit-${open.id}`} jobId={open.id} current={open.finish} onUpdated={(url) => { setOpen((o) => (o ? { ...o, mediaUrl: url } : o)); load(true); }} />}
            {open.source === 'hero' && open.mediaUrl && (access.publish === 'upgrade' || access.publish === 'addon'
              ? <p className="text-[13px] text-[var(--gv-text-secondary)] pt-2 border-t border-[var(--gv-border-subtle)]">{access.publish === 'upgrade' ? REASONS.paidPlan : REASONS.addon} to post or schedule this video. You can still download it.</p>
              : <HeroShare key={open.id} jobId={open.id} onPosted={() => load(true)} />)}
          </div>
        </div>
      )}
    </div>
  );
};

export default Library;
