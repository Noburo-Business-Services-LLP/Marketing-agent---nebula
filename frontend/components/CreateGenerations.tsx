import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { draftsAPI } from '../services/api';
import { fromPostDraft, STATUS_WORD } from '../utils/library';
import GeneratingFill from './GeneratingFill';
import { DraftPreviewModal } from './DraftPreviewModal';
import PlatformIcon from './PlatformIcon';

export type CreateCategory = 'single' | 'carousel' | 'campaign' | 'linkedin';

const TYPE: Record<CreateCategory, string> = { single: 'post', linkedin: 'post', carousel: 'carousel', campaign: 'campaign' };
const TITLE: Record<CreateCategory, string> = { single: 'Your single posts', linkedin: 'Your LinkedIn posts', carousel: 'Your carousels', campaign: 'Your campaigns' };
const SHOWN = 12;

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
      if (alive.current) { setDrafts(list.slice(0, SHOWN)); setFailed(false); }
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

  return (
    <section className="max-w-5xl mx-auto mt-16" aria-label={TITLE[category]}>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-[20px] font-semibold text-[var(--gv-text-primary)]">{TITLE[category]}</h2>
        {anyMaking && <span className="text-[12.5px] text-[var(--gv-text-tertiary)]">Some are still being made. This list updates by itself.</span>}
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {drafts.map((d) => {
          const item = fromPostDraft(d);
          if (!item) return null;
          const making = item.status === 'creating';
          const ratio = String(d.aspectRatio || '4:5').replace(':', ' / ');
          return (
            <li key={item.id} className="rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] overflow-hidden">
              <button type="button" disabled={making} onClick={() => setOpen(d)} className="block w-full text-left disabled:cursor-default" aria-label={`Open ${item.title}`}>
                <div className="relative bg-black overflow-hidden" style={{ aspectRatio: ratio }}>
                  {making
                    ? <GeneratingFill prompt={item.title} resolution={String(d.aspectRatio || '')} startedAt={item.createdAt || undefined} />
                    : item.thumbnailUrl
                      ? <img src={item.thumbnailUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center px-3 text-center text-[12px] text-white/60">{item.status === 'failed' ? <span className="inline-flex items-center gap-1"><AlertCircle className="w-4 h-4" /> Did not finish</span> : 'No picture'}</div>}
                  <span className="absolute top-2 left-2 rounded-full bg-[var(--gv-panel)] border border-[var(--gv-border-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--gv-text-primary)]">{STATUS_WORD[item.status]}</span>
                </div>
                <div className="px-3 py-2.5 space-y-1">
                  <p className="text-[13px] font-semibold text-[var(--gv-text-primary)] line-clamp-2">{item.title}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11.5px] text-[var(--gv-text-muted)]">{item.slideTotal ? `${item.slideTotal} slides` : new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    <span className="flex items-center gap-1 text-[var(--gv-text-tertiary)]">{item.platforms.slice(0, 4).map((p) => <PlatformIcon key={p} platform={p} className="w-3.5 h-3.5" />)}</span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {open && <DraftPreviewModal draft={open} onClose={() => setOpen(null)} onSuccess={() => { setOpen(null); load(true); }} />}
    </section>
  );
};

export default CreateGenerations;
