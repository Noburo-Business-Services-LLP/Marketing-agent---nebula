import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Film, Image as ImageIcon, Loader2, Play, Search, X } from 'lucide-react';
import { GravityLabel, GravityButton } from '../components/gravity';
import GenerationTimer from '../components/GenerationTimer';
import HeroShare from '../components/HeroShare';
import PlatformIcon from '../components/PlatformIcon';
import { draftsAPI, videoGenerationAPI, heroVideoAPI } from '../services/api';
import { platformLabel } from '../utils/platforms';
import {
  LibraryItem, LibraryFilters, LibraryStatus, DEFAULT_FILTERS, STATUS_WORD,
  fromPostDraft, fromVideoDraft, fromHeroJob, applyFilters,
} from '../utils/library';

const STATUS_CHIPS: Array<{ key: 'all' | LibraryStatus; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'draft', label: 'Drafts' }, { key: 'ready', label: 'Ready' },
  { key: 'scheduled', label: 'Scheduled' }, { key: 'posted', label: 'Posted' }, { key: 'archived', label: 'Archived' },
];
const KINDS: Array<{ key: LibraryFilters['kind']; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'image', label: 'Images' }, { key: 'video', label: 'Videos' },
];
const SOURCES: Array<{ key: LibraryFilters['source']; label: string }> = [
  { key: 'all', label: 'Everything' }, { key: 'hero', label: 'Hero videos' }, { key: 'video-draft', label: 'Step-by-step videos' }, { key: 'post', label: 'Posts and images' },
];

const chip = (on: boolean) =>
  `h-9 px-4 rounded-full text-[13px] font-semibold border transition-colors ${on ? 'bg-[var(--gv-accent-fill)] border-[var(--gv-accent)] text-[var(--gv-text-primary)]' : 'border-[var(--gv-border-default)] text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)]'}`;
const select = 'h-9 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-3 text-[13px] text-[var(--gv-text-primary)]';

const fmtDate = (t: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Everything you have made, images and videos together. */
const Library: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [open, setOpen] = useState<LibraryItem | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [posts, videos, heroes] = await Promise.allSettled([
      draftsAPI.getDrafts(),
      videoGenerationAPI.getDrafts(),
      heroVideoAPI.list(),
    ]);
    const bad: string[] = [];
    const all: LibraryItem[] = [];
    if (posts.status === 'fulfilled') {
      (posts.value?.drafts || []).forEach((d: any) => {
        const source = String(d?.sourceType || d?.contentType || 'post').toLowerCase();
        if (source === 'reel' || source === 'video') return; // reels are the step-by-step videos below
        const c = fromPostDraft(d); if (c) all.push(c);
      });
    } else bad.push('posts and images');
    if (videos.status === 'fulfilled') (videos.value?.drafts || []).forEach((d: any) => { const c = fromVideoDraft(d); if (c) all.push(c); });
    else bad.push('step-by-step videos');
    if (heroes.status === 'fulfilled') ((heroes.value as any)?.jobs || []).forEach((j: any) => { const c = fromHeroJob(j); if (c) all.push(c); });
    else bad.push('Hero videos');
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
  const platforms = useMemo(() => Array.from(new Set(items.flatMap((i) => i.platforms))).sort(), [items]);
  const set = (patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const goEdit = (i: LibraryItem) => {
    setOpen(null);
    if (i.source === 'hero') navigate('/reels/hero');
    else if (i.source === 'video-draft') navigate(`/reels?jobId=${encodeURIComponent(i.id)}`);
    else navigate('/drafts');
  };

  return (
    <div className="max-w-[1100px] w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <GravityLabel gold className="mb-2">Library</GravityLabel>
        <h1 className="text-[26px] sm:text-[32px] font-semibold leading-tight text-[var(--gv-text-primary)]">Everything you have made</h1>
        <p className="mt-2 text-[14.5px] text-[var(--gv-text-secondary)]">Images and videos in one place. Open one to download it, post it, schedule it or keep editing.</p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Type">
          {KINDS.map((k) => <button key={k.key} type="button" aria-pressed={filters.kind === k.key} onClick={() => set({ kind: k.key })} className={chip(filters.kind === k.key)}>{k.label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status">
          {STATUS_CHIPS.map((s) => <button key={s.key} type="button" aria-pressed={filters.status === s.key} onClick={() => set({ status: s.key })} className={chip(filters.status === s.key)}>{s.label}</button>)}
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
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {shown.map((i) => (
            <li key={`${i.source}-${i.id}`} className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] overflow-hidden">
              <button type="button" onClick={() => (i.status === 'creating' ? undefined : setOpen(i))} disabled={i.status === 'creating'} className="block w-full text-left disabled:cursor-default" aria-label={`Open ${i.title}`}>
                <div className="relative aspect-square bg-[var(--gv-border-subtle)] flex items-center justify-center overflow-hidden">
                  {i.thumbnailUrl ? <img src={i.thumbnailUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : i.kind === 'video' ? <Film className="w-8 h-8 text-[var(--gv-text-tertiary)]" /> : <ImageIcon className="w-8 h-8 text-[var(--gv-text-tertiary)]" />}
                  {i.kind === 'video' && i.mediaUrl && <span className="absolute bottom-2 left-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"><Play className="w-3.5 h-3.5" /></span>}
                  <span className="absolute top-2 left-2 rounded-full bg-[var(--gv-panel)] border border-[var(--gv-border-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--gv-text-primary)]">{STATUS_WORD[i.status]}</span>
                  {i.status === 'creating' && <div className="absolute inset-x-2 bottom-2"><GenerationTimer minSeconds={i.kind === 'video' ? 300 : 20} maxSeconds={i.kind === 'video' ? 600 : 60} /></div>}
                </div>
                <div className="px-3 py-2.5 space-y-1">
                  <p className="text-[13px] font-semibold text-[var(--gv-text-primary)] line-clamp-2">{i.title}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11.5px] text-[var(--gv-text-muted)]">{fmtDate(i.createdAt)}</p>
                    <span className="flex items-center gap-1 text-[var(--gv-text-tertiary)]">{i.platforms.slice(0, 4).map((p) => <PlatformIcon key={p} platform={p} className="w-3.5 h-3.5" />)}</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
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
            </div>
            {open.source === 'hero' && open.mediaUrl && <HeroShare key={open.id} jobId={open.id} onPosted={() => load(true)} />}
          </div>
        </div>
      )}
    </div>
  );
};

export default Library;
