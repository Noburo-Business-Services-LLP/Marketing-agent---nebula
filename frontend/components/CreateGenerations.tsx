import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { draftsAPI } from '../services/api';
import { fromPostDraft, STATUS_WORD } from '../utils/library';
import GeneratingFill from './GeneratingFill';
import { DraftPreviewModal } from './DraftPreviewModal';
import PlatformIcon from './PlatformIcon';
import { orderForViewing } from '../utils/postOrder';

export type CreateCategory = 'single' | 'carousel' | 'campaign' | 'linkedin';

const TYPE: Record<CreateCategory, string> = { single: 'post', linkedin: 'post', carousel: 'carousel', campaign: 'campaign' };
const TITLE: Record<CreateCategory, string> = { single: 'Your single posts', linkedin: 'Your LinkedIn posts', carousel: 'Your carousels', campaign: 'Your campaigns' };
const SHOWN = 24;

/**
 * Everything made in this category, newest first, below the form. Work that is still being made shows its
 * progress here, so the form stays free to start another, and leaving the page loses nothing.
 */
const CreateGenerations: React.FC<{ category: CreateCategory; refreshKey: number }> = ({ category, refreshKey }) => {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<any | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await draftsAPI.getDrafts(undefined, TYPE[category]);
      let list = (res?.drafts || []) as any[];
      // Single posts and LinkedIn posts share one type; LinkedIn ones have no picture and are for LinkedIn only.
      const isLinkedin = (d: any) => Array.isArray(d.platforms) && d.platforms.length === 1 && String(d.platforms[0]).toLowerCase() === 'linkedin' && !d.imageUrl;
      if (category === 'linkedin') list = list.filter(isLinkedin);
      else if (category === 'single') list = list.filter((d) => !isLinkedin(d));
      list = list.filter((d) => String(d.status || '').toLowerCase() !== 'archived');
      // Campaign posts together and in story order; everything else as it came.
      const ordered = orderForViewing(list).map((o) => ({ ...o.draft, __group: o.group }));
      if (alive.current) { setDrafts(ordered.slice(0, SHOWN)); setFailed(false); }
    } catch {
      if (alive.current) setFailed(true);
    }
    if (alive.current) setLoading(false);
  }, [category]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const anyMaking = drafts.some((d) => String(d.status || '').toLowerCase() === 'processing');
  useEffect(() => {
    if (!anyMaking) return;
    const id = setInterval(() => load(true), 6000);
    return () => clearInterval(id);
  }, [anyMaking, load]);

  if (loading && drafts.length === 0) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--gv-accent)]" /></div>;
  if (drafts.length === 0) return failed ? <p className="text-center text-[13px] text-[var(--gv-text-tertiary)]">Could not load your earlier work. It is safe, and will appear here when this reloads.</p> : null;

  // Square thumbnails keep the gallery even and short; opening a card shows the whole picture.
  return (
    <section className="max-w-5xl mx-auto mt-10" aria-label={TITLE[category]}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[16px] font-semibold text-[var(--gv-text-primary)]">{TITLE[category]}</h2>
        {anyMaking && <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">Some are still being made. This list updates by itself.</span>}
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {drafts.map((d) => {
          const item = fromPostDraft(d);
          if (!item) return null;
          const making = item.status === 'creating';
          return (
            <li key={item.id} className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] overflow-hidden">
              <button type="button" disabled={making} onClick={() => setOpen(d)} className="block w-full text-left disabled:cursor-default" aria-label={`Open ${item.title}`}>
                <div className="relative aspect-square bg-black overflow-hidden">
                  {making
                    ? <GeneratingFill prompt={item.title} resolution={String(d.aspectRatio || '')} startedAt={item.createdAt || undefined} />
                    : item.thumbnailUrl
                      ? <img src={item.thumbnailUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center px-3 text-center text-[12px] text-white/60">{item.status === 'failed' ? <span className="inline-flex items-center gap-1"><AlertCircle className="w-4 h-4" /> Did not finish</span> : 'No picture'}</div>}
                  <span className="absolute top-1.5 left-1.5 rounded-full bg-[var(--gv-panel)] border border-[var(--gv-border-subtle)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--gv-text-primary)]">{STATUS_WORD[item.status]}</span>
                </div>
                <div className="px-2.5 py-2 space-y-0.5">
                  <p className="text-[12.5px] font-semibold text-[var(--gv-text-primary)] truncate">{item.title}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[11px] text-[var(--gv-text-muted)]">{d.__group ? (d.__group.size > 1 ? `${d.__group.name} · ${d.__group.position} of ${d.__group.size}` : d.__group.name) : item.slideTotal ? `${item.slideTotal} slides` : new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    <span className="flex items-center gap-1 text-[var(--gv-text-tertiary)]">{item.platforms.slice(0, 4).map((p) => <PlatformIcon key={p} platform={p} className="w-3.5 h-3.5" />)}</span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {open && (() => {
        const ready = drafts.filter((d) => String(d.status || '').toLowerCase() !== 'processing');
        const at = ready.findIndex((d) => d._id === open._id);
        return (
          <DraftPreviewModal
            key={open._id}
            draft={open}
            onClose={() => setOpen(null)}
            onSuccess={() => { setOpen(null); load(true); }}
            onChanged={() => load(true)}
            onPrev={at > 0 ? () => setOpen(ready[at - 1]) : undefined}
            onNext={at >= 0 && at < ready.length - 1 ? () => setOpen(ready[at + 1]) : undefined}
            position={at >= 0 ? `${at + 1} / ${ready.length}` : undefined}
          />
        );
      })()}
    </section>
  );
};

export default CreateGenerations;
