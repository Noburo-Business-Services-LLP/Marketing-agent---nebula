import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye, Film, Image as ImageIcon, Loader2, Pencil, Play, Search, Trash2, X } from 'lucide-react';
import { GravityButton } from '../components/gravity';
import { useConfirm } from '../context/ConfirmContext';
import GenerationTimer from '../components/GenerationTimer';
import HeroShare from '../components/HeroShare';
import HeroEdit from '../components/HeroEdit';
import { DraftPreviewModal } from '../components/DraftPreviewModal';
import { orderForViewing } from '../utils/postOrder';
import PlatformIcon from '../components/PlatformIcon';
import { draftsAPI, videoGenerationAPI, heroVideoAPI, photoshootAPI } from '../services/api';
import { platformLabel } from '../utils/platforms';
import {
  LibraryItem, LibraryFilters, LibraryStatus, DEFAULT_FILTERS, STATUS_WORD,
  fromPostDraft, fromVideoDraft, fromHeroJob, fromPhotoshootPhoto, applyFilters,
  SOURCE_WORD, libraryTileActions, libraryColumns,
} from '../utils/library';
import { fillRows } from '../utils/rowSpans';
import '../components/library/library.css';
import PageHeader from '../components/PageHeader';

const STATUS_CHIPS: Array<{ key: 'all' | LibraryStatus; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'draft', label: 'Drafts' }, { key: 'ready', label: 'Ready' },
  { key: 'scheduled', label: 'Scheduled' }, { key: 'posted', label: 'Posted' }, { key: 'archived', label: 'Archived' },
];
const KINDS: Array<{ key: LibraryFilters['kind']; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'image', label: 'Images' }, { key: 'video', label: 'Videos' },
];
const SOURCES: Array<{ key: LibraryFilters['source']; label: string }> = [
  { key: 'all', label: 'Everything' }, { key: 'hero', label: 'Hero videos' }, { key: 'video-draft', label: 'Step-by-step videos' }, { key: 'post', label: 'Posts and images' },
  { key: 'reel', label: 'Reels from your plan' }, { key: 'photoshoot', label: 'Photoshoots' },
];

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--gv-bg,transparent)]';
const chip = (on: boolean) =>
  `shrink-0 whitespace-nowrap h-7 px-3 rounded-full text-[12px] font-medium border transition-colors ${focusRing} ${on ? 'bg-[var(--gv-accent-fill)] border-[var(--gv-accent)] text-[var(--gv-text-primary)] font-semibold' : 'border-transparent text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-border-subtle)]'}`;
const seg = (on: boolean) =>
  `shrink-0 whitespace-nowrap h-6 px-2.5 rounded-full text-[12px] font-medium transition-colors ${focusRing} ${on ? 'bg-[var(--gv-accent-fill)] text-[var(--gv-text-primary)] font-semibold shadow-[inset_0_0_0_1px_var(--gv-accent)]' : 'text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'}`;
const select = 'h-9 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 text-[13px] text-[var(--gv-text-primary)]';

const fmtDate = (t: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Everything you have made, images and videos together. */
const Library: React.FC = () => {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [open, setOpen] = useState<LibraryItem | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [posts, videos, heroes, shoots] = await Promise.allSettled([
      draftsAPI.getDrafts(),
      videoGenerationAPI.getDrafts(),
      heroVideoAPI.list(),
      photoshootAPI.library(),
    ]);
    const bad: string[] = [];
    const all: LibraryItem[] = [];
    if (posts.status === 'fulfilled') {
      (posts.value?.drafts || []).forEach((d: any) => {
        const c = fromPostDraft(d); if (c) all.push(c);
      });
    } else bad.push('posts and images');
    if (videos.status === 'fulfilled') (videos.value?.drafts || []).forEach((d: any) => { const c = fromVideoDraft(d); if (c) all.push(c); });
    else bad.push('step-by-step videos');
    if (heroes.status === 'fulfilled') ((heroes.value as any)?.jobs || []).forEach((j: any) => { const c = fromHeroJob(j); if (c) all.push(c); });
    else bad.push('Hero videos');
    if (shoots.status === 'fulfilled') ((shoots.value as any)?.photos || []).forEach((p: any) => { const c = fromPhotoshootPhoto(p); if (c) all.push(c); });
    else bad.push('photoshoots');
    setItems(all); setProblems(bad); setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Keep checking while anything is still being made.
  const anyCreating = items.some((i) => i.status === 'creating');
  useEffect(() => {
    if (!anyCreating) return;
    const id = setInterval(() => load(true), 8000);
    return () => clearInterval(id);
  }, [anyCreating, load]);

  const shown = useMemo(() => applyFilters(items, filters), [items, filters]);
  // Columns follow the grid's real width; the last tile of a short row is widened so every row is filled.
  const gridRef = useRef<HTMLUListElement | null>(null);
  const [cols, setCols] = useState(2);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setCols(libraryColumns(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, shown.length > 0]);
  const spans = useMemo(() => fillRows(shown.map(() => 1), cols), [shown, cols]);
  const platforms = useMemo(() => Array.from(new Set(items.flatMap((i) => i.platforms))).sort(), [items]);
  const set = (patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const goEdit = (i: LibraryItem) => {
    setOpen(null);
    if (i.source === 'hero') navigate('/reels/hero');
    else if (i.source === 'video-draft') navigate(`/reels?jobId=${encodeURIComponent(i.id)}`);
    else if (i.source === 'reel' && i.jobId) navigate(`/reels?jobId=${encodeURIComponent(i.jobId)}`);
    else if (i.source === 'photoshoot') navigate('/photoshoot');
    else navigate('/drafts');
  };

  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const canRemove = (i: LibraryItem) => i.source === 'hero' || i.source === 'video-draft' || i.source === 'reel';
  const remove = async (i: LibraryItem) => {
    if (removing) return;
    const ok = await confirmDialog(i.source === 'hero' ? 'This removes the video from your library. Quarks already spent are not returned.' : 'This removes it and its files. This cannot be undone.', { title: `Delete "${i.title}"?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    setRemoving(true); setRemoveError('');
    try {
      const r: any = i.source === 'hero' ? await heroVideoAPI.remove(i.id) : i.source === 'video-draft' ? await videoGenerationAPI.deleteDraft(i.id) : await draftsAPI.deleteDraft(i.id);
      if (r && r.success === false) throw new Error(r.message || 'We could not delete this.');
      setOpen(null); load(true);
    } catch (e: any) {
      setRemoveError(e?.message || 'We could not delete this. Please try again.');
    } finally { setRemoving(false); }
  };

  return (
    <div className="max-w-[1100px] w-full mx-auto px-4 sm:px-6 pb-8 space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Everything you have"
        emphasis="made"
        description="Images, videos and photoshoots in one place. Open one to download it, post it, schedule it or keep editing."
      />

      <div className="space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1 py-0.5" data-testid="library-filter-row">
          <div className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-[var(--gv-border-default)] bg-[var(--gv-panel)] p-0.5" role="group" aria-label="Type">
            {KINDS.map((k) => <button key={k.key} type="button" aria-pressed={filters.kind === k.key} onClick={() => set({ kind: k.key })} className={seg(filters.kind === k.key)}>{k.label}</button>)}
          </div>
          <span aria-hidden="true" className="shrink-0 w-px h-5 bg-[var(--gv-border-default)]" />
          <div className="flex items-center gap-1" role="group" aria-label="Status">
            {STATUS_CHIPS.map((s) => <button key={s.key} type="button" aria-pressed={filters.status === s.key} onClick={() => set({ status: s.key })} className={chip(filters.status === s.key)}>{s.label}</button>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search your library</span>
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gv-text-tertiary)]" />
            <input value={filters.query} onChange={(e) => set({ query: e.target.value })} placeholder="Search by title or caption" className={`${select} pl-9 w-[240px]`} />
          </label>
          <select aria-label="Where it came from" value={filters.source} onChange={(e) => set({ source: e.target.value as any })} className={select}>
            {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select aria-label="Platform" value={filters.platform} onChange={(e) => set({ platform: e.target.value })} className={select}>
            <option value="">All platforms</option>
            {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
          </select>
        </div>
      </div>

      {problems.length > 0 && <p role="status" className="text-[13px] text-[var(--gv-text-secondary)]">We could not load your {problems.join(' and ')} just now. The rest are shown below.</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--gv-accent)]" aria-label="Loading your library" /></div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] py-14 text-center space-y-3">
          <p className="text-[14.5px] text-[var(--gv-text-primary)]">{items.length ? 'Nothing matches these filters.' : 'You have not made anything yet.'}</p>
          {items.length ? <GravityButton variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</GravityButton> : <GravityButton onClick={() => navigate('/campaigns')}>Create content</GravityButton>}
        </div>
      ) : (
        <ul ref={gridRef} className="nb-lib-grid" style={{ ['--nb-lib-cols' as any]: cols }} data-testid="library-grid">
          {shown.map((i, n) => {
            const actions = libraryTileActions(i);
            return (
              <li key={`${i.source}-${i.id}`} className="nb-lib-cell" style={spans[n] > 1 ? { gridColumn: `span ${spans[n]}` } : undefined}>
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
                        <span>{fmtDate(i.createdAt)}{i.slideTotal ? ` · ${i.slides && i.slides.length < i.slideTotal && i.status === 'creating' ? `${i.slides.length} of ${i.slideTotal}` : i.slideTotal} slides` : ''}</span>
                        <span className="nb-lib-platforms">{i.platforms.slice(0, 4).map((p) => <PlatformIcon key={p} platform={p} className="w-3.5 h-3.5" />)}</span>
                      </span>
                    </span>
                  </button>
                  <span className="nb-lib-chips" aria-hidden="true">
                    <span className="nb-lib-chip">{SOURCE_WORD[i.source]}</span>
                    <span className="nb-lib-chip" data-status={i.status}>{STATUS_WORD[i.status]}</span>
                  </span>
                  <span className="sr-only">{SOURCE_WORD[i.source]}, {STATUS_WORD[i.status]}</span>
                  {actions.length > 0 && (
                    <div className="nb-lib-actions">
                      {actions.includes('open') && <button type="button" className="nb-lib-action" data-primary="true" onClick={() => setOpen(i)} aria-label={`Open ${i.title}`}><Eye className="w-3.5 h-3.5" aria-hidden="true" /><span className="nb-lib-action-word">Open</span></button>}
                      {actions.includes('edit') && <button type="button" className="nb-lib-action" onClick={() => goEdit(i)} aria-label={`Edit ${i.title}`}><Pencil className="w-3.5 h-3.5" aria-hidden="true" /><span className="nb-lib-action-word">Edit</span></button>}
                      {actions.includes('download') && <a className="nb-lib-action" href={i.mediaUrl} download target="_blank" rel="noreferrer" aria-label={`Download ${i.title}`}><Download className="w-3.5 h-3.5" aria-hidden="true" /><span className="nb-lib-action-word">Download</span></a>}
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {open && open.source === 'post' && open.raw && (
        (() => {
          // Story order: a campaign's posts together in their planned order, other posts as listed.
          const eligible = shown.filter((x) => x.source === 'post' && x.raw && x.status !== 'creating');
          const byId = new Map(eligible.map((x) => [String(x.raw._id), x]));
          const posts = orderForViewing(eligible.map((x) => x.raw)).map((o) => byId.get(String(o.draft._id))!).filter(Boolean);
          const at = posts.findIndex((x) => x.id === open.id);
          return (
            <DraftPreviewModal
              key={open.id}
              draft={open.raw}
              onClose={() => setOpen(null)}
              onSuccess={() => { setOpen(null); load(true); }}
              onPrev={at > 0 ? () => setOpen(posts[at - 1]) : undefined}
              onNext={at >= 0 && at < posts.length - 1 ? () => setOpen(posts[at + 1]) : undefined}
              position={at >= 0 ? `${at + 1} / ${posts.length}` : undefined}
            />
          );
        })()
      )}

      {open && !(open.source === 'post' && open.raw) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={open.title} onClick={() => setOpen(null)}>
          <div className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--gv-panel)] border border-[var(--gv-border-subtle)] p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--gv-text-tertiary)]">{open.kind === 'video' ? 'Video' : 'Image'} · {STATUS_WORD[open.status]}</p>
                <h2 className="text-[18px] font-semibold text-[var(--gv-text-primary)]">{open.title}</h2>
              </div>
              <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="p-1.5 rounded-md text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)]"><X className="w-5 h-5" /></button>
            </div>
            {open.mediaUrl ? (open.kind === 'video'
              ? <video src={open.mediaUrl} controls playsInline className="w-full max-h-[55vh] rounded-xl bg-black" />
              : <img src={open.mediaUrl} alt={open.title} className="w-full max-h-[55vh] object-contain rounded-xl bg-[var(--gv-border-subtle)]" />)
              : <p className="text-[13px] text-[var(--gv-text-secondary)]">This one has no finished file yet.</p>}
            {open.caption && <p className="text-[13.5px] text-[var(--gv-text-secondary)] whitespace-pre-wrap">{open.caption}</p>}
            <div className="flex flex-wrap items-center gap-4">
              {open.mediaUrl && <a href={open.mediaUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--gv-accent-text)] hover:underline"><Download className="w-4 h-4" />Download</a>}
              <GravityButton variant="ghost" onClick={() => goEdit(open)}>{open.status === 'draft' ? 'Edit' : 'Open'}</GravityButton>
              {canRemove(open) && (
                <button type="button" onClick={() => remove(open)} disabled={removing} className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--gv-coral-text)] disabled:opacity-60">
                  {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}Delete
                </button>
              )}
            </div>
            {removeError && <p role="alert" className="text-[13px] text-[var(--gv-text-primary)]">{removeError}</p>}
            {open.source === 'hero' && open.heroSource && (
              <GravityButton variant="ghost" onClick={() => { const o = open; setOpen(null); navigate('/reels/hero', { state: { tweak: { title: o.title, prompt: o.heroSource!.prompt, finish: o.finish, tweak: o.heroSource!.tweak } } }); }}>Make a new version from the prompt</GravityButton>
            )}
            {open.source === 'hero' && open.mediaUrl && <HeroEdit key={`edit-${open.id}`} jobId={open.id} current={open.finish} onUpdated={(url) => { setOpen((o) => (o ? { ...o, mediaUrl: url } : o)); load(true); }} />}
            {open.source === 'hero' && open.mediaUrl && <HeroShare key={open.id} jobId={open.id} onPosted={() => load(true)} />}
          </div>
        </div>
      )}
    </div>
  );
};

export default Library;
