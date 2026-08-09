import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, RotateCcw, ChevronLeft, ChevronRight, Loader2, Sparkles, Instagram, Facebook, Linkedin, Youtube, AlertCircle, X, Pencil } from 'lucide-react';
import { draftsAPI, apiService } from '../services/api';
import { Draft } from '../types';
import GeneratingFill from '../components/GeneratingFill';
import { DraftPreviewModal } from '../components/DraftPreviewModal';

// Gravity Approve — matches the prototype's Approve screen: single big
// preview on the left, structured metadata + caption on the right,
// gold "Approve & schedule" CTA at the bottom-right.

const PLATFORM_META: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  instagram: { label: 'Instagram', Icon: Instagram },
  facebook:  { label: 'Facebook',  Icon: Facebook },
  linkedin:  { label: 'LinkedIn',  Icon: Linkedin },
  youtube:   { label: 'YouTube',   Icon: Youtube },
};

const formatScheduleDate = (d?: string | null) => {
  if (!d) return 'Not scheduled';
  const date = new Date(d);
  if (isNaN(date.getTime())) return 'Not scheduled';
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dcopy = new Date(date); dcopy.setHours(0,0,0,0);
  let day = dcopy.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (dcopy.getTime() === today.getTime()) day = 'Today';
  else if (dcopy.getTime() === tomorrow.getTime()) day = 'Tomorrow';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
};

const GravityApprove: React.FC = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track drafts we've auto-retried image gen for, so we don't spam.
  const autoRetriedRef = useRef<Set<string>>(new Set());
  const pollTimerRef = useRef<any>(null);

  // ---- Library tabs -------------------------------------------------------
  // Everything past "Needs review" is a read-only browse of your posts by
  // status. Generation runs server-side, so a post that is still rendering
  // when you navigate away shows up here as 'processing' and quietly swaps
  // to the finished image once the worker lands it.
  const TABS = [
    { key: 'review',    label: 'Needs review', status: '' },
    { key: 'all',       label: 'All',          status: 'all' },
    { key: 'draft',     label: 'Drafts',       status: 'draft' },
    { key: 'scheduled', label: 'Scheduled',    status: 'scheduled' },
    { key: 'published', label: 'Posted',       status: 'published' },
    { key: 'archived',  label: 'Archived',     status: 'archived' },
  ] as const;

  const [tab, setTab] = useState<string>('review');
  const [libraryItems, setLibraryItems] = useState<Draft[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const libraryPollRef = useRef<any>(null);

  const activeTab = TABS.find((t) => t.key === tab) || TABS[0];

  const loadLibrary = async (status: string, quiet = false) => {
    if (!quiet) setLibraryLoading(true);
    try {
      const res = await draftsAPI.getDrafts(status === 'all' ? undefined : status);
      const rows = (Array.isArray(res?.drafts) ? res.drafts : []).filter((d: any) => {
        const source = String(d?.sourceType || d?.contentType || 'post').toLowerCase();
        return source !== 'reel' && source !== 'video'; // reels live in AI Reels
      });
      setLibraryItems(rows);
    } catch {
      setLibraryItems([]);
    } finally {
      if (!quiet) setLibraryLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'review') { setLibraryItems([]); return; }
    loadLibrary(activeTab.status);
  }, [tab]);

  // Keep pulling while anything in view is still being generated.
  useEffect(() => {
    const anyProcessing = libraryItems.some((d: any) => String(d?.status || '').toLowerCase() === 'processing');
    if (tab === 'review' || !anyProcessing) {
      if (libraryPollRef.current) { clearInterval(libraryPollRef.current); libraryPollRef.current = null; }
      return;
    }
    if (libraryPollRef.current) return;
    libraryPollRef.current = setInterval(() => loadLibrary(activeTab.status, true), 6000);
    return () => { if (libraryPollRef.current) { clearInterval(libraryPollRef.current); libraryPollRef.current = null; } };
  }, [libraryItems, tab]);

  useEffect(() => () => { if (libraryPollRef.current) clearInterval(libraryPollRef.current); }, []);

  // ---- Detail sheet -------------------------------------------------------
  // Clicking a card opens it for editing, rescheduling, regenerating and
  // publishing. Every action below maps to an endpoint that already exists.
  const [selected, setSelected] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [sheetBusy, setSheetBusy] = useState('');
  const [sheetMsg, setSheetMsg] = useState('');

  const openDetail = (d: any) => {
    setSelected(d);
    setEditTitle(d.title || '');
    setEditCaption(d.caption || '');
    setEditWhen(d.scheduledDate ? new Date(d.scheduledDate).toISOString().slice(0, 16) : '');
    setSheetMsg('');
  };

  const closeDetail = () => { setSelected(null); setSheetMsg(''); };

  // Applies a change, refreshes the grid, and keeps the sheet in sync.
  const runAction = async (key: string, fn: () => Promise<any>, note: string, close = false) => {
    setSheetBusy(key);
    setSheetMsg('');
    try {
      const res = await fn();
      await loadLibrary(activeTab.status, true);
      if (close) { closeDetail(); return; }
      if (res?.draft) setSelected((prev: any) => ({ ...prev, ...res.draft }));
      setSheetMsg(note);
    } catch (e: any) {
      setSheetMsg(e?.message || 'That did not work');
    } finally {
      setSheetBusy('');
    }
  };

  const detailImage = (d: any) => d?.imageUrl || d?.creative?.imageUrls?.[0] || '';

  // Statuses that mean "still awaiting user action" (i.e. show in Approve).
  // Includes 'completed' — completed = image ready, but not yet approved.
  // A draft only leaves the queue when the user approves/rejects/publishes it.
  const APPROVABLE_STATUSES = new Set([
    'pending', 'draft', 'ready', 'processing', 'failed', 'completed'
  ]);

  const loadDrafts = async () => {
    setLoading(true);
    try {
      const res = await draftsAPI.getDrafts();
      const filtered = (Array.isArray(res?.drafts) ? res.drafts : []).filter((d: any) => {
        const status = String(d?.status || 'draft').toLowerCase();
        const source = String(d?.sourceType || d?.contentType || 'post').toLowerCase();
        // Skip reels/videos — they belong in the AI Reels flow, not here.
        if (source === 'reel' || source === 'video') return false;
        // Skip drafts that have already been published/scheduled/rejected.
        if (['published', 'posted', 'scheduled', 'rejected', 'approved'].includes(status)) return false;
        return APPROVABLE_STATUSES.has(status);
      });
      setDrafts(filtered);
      // Preserve index if possible so we don't jump around while polling
      setIndex((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
    } catch (e: any) {
      setError(e?.message || 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDrafts(); }, []);

  // Poll every 6s if any draft is still processing — refresh so the
  // image URL appears as soon as the backend worker saves it.
  useEffect(() => {
    const anyProcessing = drafts.some((d: any) => {
      const s = String(d?.status || '').toLowerCase();
      const hasImage = Boolean(d?.imageUrl || d?.creative?.imageUrls?.[0]);
      return s === 'processing' || (!hasImage && s !== 'failed');
    });
    if (anyProcessing && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => {
        draftsAPI.getDrafts().then((res) => {
          const list = (Array.isArray(res?.drafts) ? res.drafts : []).filter((d: any) => {
            const status = String(d?.status || 'draft').toLowerCase();
            const source = String(d?.sourceType || d?.contentType || 'post').toLowerCase();
            if (source === 'reel' || source === 'video') return false;
            if (['published', 'posted', 'scheduled', 'rejected', 'approved'].includes(status)) return false;
            return APPROVABLE_STATUSES.has(status);
          });
          setDrafts(list);
        }).catch(() => {});
      }, 6000);
    }
    if (!anyProcessing && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    return () => {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [drafts]);

  // Auto-retry image generation for drafts that don't have an image
  // AND aren't currently processing. Fires once per draft.
  useEffect(() => {
    const current: any = drafts[index];
    if (!current?._id) return;
    const hasImage = Boolean(current?.imageUrl || current?.creative?.imageUrls?.[0]);
    const status = String(current?.status || '').toLowerCase();
    const alreadyTried = autoRetriedRef.current.has(String(current._id));
    if (!hasImage && status !== 'processing' && !alreadyTried) {
      autoRetriedRef.current.add(String(current._id));
      draftsAPI.retryImageGeneration(String(current._id)).catch(() => {});
      // Trigger a quick refresh so status flips to processing
      setTimeout(() => loadDrafts(), 800);
    }
  }, [index, drafts]);

  const current: any = drafts[index] || null;
  const total = drafts.length;

  const platforms = useMemo(() => (current?.platforms || []) as string[], [current]);
  const caption = useMemo(() => {
    const raw: string = current?.caption || current?.creative?.textContent || '';
    return raw;
  }, [current]);
  const hashtags: string[] = useMemo(() => {
    if (Array.isArray(current?.hashtags)) return current.hashtags;
    const matches = String(caption).match(/#\w+/g) || [];
    return matches;
  }, [current, caption]);
  const captionBody = useMemo(() => String(caption).replace(/#\w+/g, '').trim(), [caption]);

  const imageUrl = useMemo(() => {
    return current?.imageUrl || current?.creative?.imageUrls?.[0] || '';
  }, [current]);

  const goPrev = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => setIndex((i) => Math.min(total - 1, i + 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  const handleApprove = async () => {
    if (!current?._id) return;
    setBusy(true);
    try {
      // Publish through the draft endpoint. It creates the underlying
      // Campaign itself (upsertCampaignFromDraft), so this also works for
      // single posts, which have no campaignId — the old path silently
      // skipped those and removed them from the list without publishing.
      await draftsAPI.publishDraft(current._id, platforms);
      // Remove from the queue locally.
      const next = drafts.filter((_, i) => i !== index);
      setDrafts(next);
      setIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
    } catch (e: any) {
      setError(e?.message || 'Failed to approve');
    } finally {
      setBusy(false);
    }
  };

  const handleRedo = async () => {
    if (!current?._id) return;
    setBusy(true);
    try {
      await draftsAPI.retryImageGeneration(String(current._id));
      // Refresh so status flips to 'processing' and poll kicks in.
      await loadDrafts();
    } catch (e: any) {
      setError(e?.message || 'Failed to regenerate.');
    } finally {
      setBusy(false);
    }
  };

  // -------- render --------

  const TabBar = () => (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.07] mb-8">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`relative whitespace-nowrap px-3.5 py-2.5 text-[13px] font-semibold transition-colors ${
            tab === t.key ? 'text-[#F5A623]' : 'text-white/50 hover:text-white/80'
          }`}
        >
          {t.label}
          {tab === t.key && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-[#F5A623]" />}
        </button>
      ))}
    </div>
  );

  // Read-only browse of posts at a given status. No approve/reject here —
  // this is for finding things, not actioning them.
  if (tab !== 'review') {
    const statusChip = (s: string) => {
      const v = String(s || 'draft').toLowerCase();
      const map: Record<string, string> = {
        processing: 'bg-[#F5A623]/15 text-[#F5A623]',
        scheduled: 'bg-blue-500/15 text-blue-300',
        published: 'bg-emerald-500/15 text-emerald-400',
        archived: 'bg-white/[0.06] text-white/45',
        failed: 'bg-red-500/15 text-red-400',
      };
      return map[v] || 'bg-white/[0.06] text-white/55';
    };

    return (
      <div className="max-w-[1100px] mx-auto pb-24">
        <TabBar />

        {libraryLoading ? (
          <div className="flex items-center justify-center py-20 text-white/50">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading…
          </div>
        ) : libraryItems.length === 0 ? (
          <div className="text-center py-24">
            <div className="gravity-label mb-3">Nothing here</div>
            <p className="text-[14px] text-white/45">
              No {activeTab.label.toLowerCase()} posts yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {libraryItems.map((d: any) => {
              const img = d.imageUrl || d.creative?.imageUrls?.[0] || '';
              const processing = String(d?.status || '').toLowerCase() === 'processing';
              return (
                <div
                  key={d._id}
                  onClick={() => !processing && openDetail(d)}
                  className={`group relative rounded-xl border overflow-hidden transition-all duration-200 ${
                    processing
                      ? 'cursor-wait border-white/[0.08] bg-white/[0.02]'
                      : 'cursor-pointer border-white/[0.08] bg-white/[0.02] hover:border-[#F5A623]/70 hover:bg-white/[0.05] hover:-translate-y-1 hover:shadow-[0_12px_36px_rgba(0,0,0,0.55),0_0_0_1px_rgba(245,166,35,0.25)]'
                  }`}
                >
                  <div className="relative bg-black aspect-[4/5] overflow-hidden">
                    {/* Hover affordance — makes the target unmistakable */}
                    {!processing && (
                      <div className="absolute inset-0 z-10 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F5A623] text-black text-[11.5px] font-bold">
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </span>
                      </div>
                    )}
                    {img ? (
                      <img src={img} alt={d.title || 'Post'} className="w-full h-full object-contain" />
                    ) : processing ? (
                      <GeneratingFill resolution="" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <AlertCircle className="w-5 h-5 text-white/25" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-[12.5px] font-semibold text-[#F5F4F1] truncate">{d.title || 'Untitled'}</p>
                    {d.caption && <p className="text-[11px] text-white/40 line-clamp-2 mt-1">{d.caption}</p>}
                    <div className="flex items-center justify-between mt-2.5 gap-2">
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${statusChip(d.status)}`}>
                        {processing ? 'Generating' : (d.status || 'draft')}
                      </span>
                      {/* Where this post is headed */}
                      <div className="flex items-center gap-1">
                        {(d.platforms || []).length === 0 ? (
                          <span className="text-[10px] text-white/25">No platform</span>
                        ) : (d.platforms || []).slice(0, 4).map((p: string) => {
                          const meta = PLATFORM_META[String(p).toLowerCase()];
                          return meta
                            ? <meta.Icon key={p} className="w-3.5 h-3.5 text-white/50" />
                            : <span key={p} className="text-[10px] text-white/40">{p}</span>;
                        })}
                      </div>
                    </div>
                    {d.scheduledDate && (
                      <div className="text-[10px] text-white/35 mt-1.5">{formatScheduleDate(d.scheduledDate)}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selected && (
          <DraftPreviewModal
            draft={selected}
            onClose={closeDetail}
            onSuccess={() => { closeDetail(); loadLibrary(activeTab.status, true); }}
          />
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-white/50">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading queue…
      </div>
    );
  }

  if (error && total === 0) {
    return <div className="text-center py-20 text-red-400">{error}</div>;
  }

  if (total === 0) {
    return (
      <div className="max-w-[1100px] mx-auto pb-24">
        <TabBar />
        <div className="max-w-[720px] mx-auto text-center py-16">
        <div className="gravity-label mb-4">Nothing to approve</div>
        <h1 className="font-serif-display text-[42px] leading-[1.05] tracking-[-0.02em] text-[#F5F4F1] mb-4">
          You're all <span className="italic text-[#F5A623]">caught up</span>.
        </h1>
        <p className="text-[14px] text-white/55 max-w-[520px] mx-auto mb-6">
          When Gravity drafts new posts, they'll wait here for your approval.
        </p>
        <button
          onClick={() => navigate('/campaigns')}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208] text-[14px] font-semibold"
        >
          <Sparkles className="w-4 h-4" />
          Draft something new
        </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1180px] mx-auto pb-16">
      <TabBar />
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <span className="gravity-label">Post {index + 1} / {total}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            disabled={index === 0}
            className="w-9 h-9 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goNext}
            disabled={index >= total - 1}
            className="w-9 h-9 rounded-lg border border-white/[0.08] flex items-center justify-center text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10">
        {/* PREVIEW */}
        <div className="relative flex items-center justify-center min-h-[560px]">
          <div className="absolute inset-[-20px] rounded-3xl blur-3xl opacity-70" style={{ background: 'radial-gradient(60% 55% at 50% 50%, rgba(245,166,35,0.16), transparent 70%)' }} />
          <div className="relative w-[380px] aspect-[4/5] rounded-2xl bg-[#151515] border border-white/[0.06] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
            {imageUrl ? (
              <img src={imageUrl} alt={current?.title || 'draft preview'} className="w-full h-full object-cover" />
            ) : String(current?.status || '').toLowerCase() === 'failed' ? (
              <div className="w-full h-full bg-gradient-to-br from-red-950/20 to-white/[0.01] flex flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle className="w-8 h-8 text-red-400/70" />
                <div className="text-[13px] font-semibold text-[#F5F4F1]">Image generation failed</div>
                <div className="text-[11.5px] text-white/50 max-w-[260px] leading-relaxed">
                  {current?.errorMessage || 'Something went wrong. Click Redo to try again.'}
                </div>
                <button
                  onClick={handleRedo}
                  className="mt-2 h-8 px-3 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[12px] font-semibold text-[#F5F4F1]"
                >
                  Retry now
                </button>
              </div>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-white/[0.04] to-white/[0.01] flex flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-2 border-[#F5A623]/25" />
                  <Loader2 className="w-10 h-10 text-[#F5A623] animate-spin absolute inset-0" strokeWidth={1.5} />
                </div>
                <div className="text-[11px] uppercase tracking-widest text-white/45">generating…</div>
                <div className="text-[13.5px] font-semibold text-[#F5F4F1] max-w-[260px]">
                  {current?.title || 'Untitled draft'}
                </div>
                <div className="text-[11px] text-white/40 max-w-[260px]">
                  The image is being drafted. This usually takes 20–40 seconds.
                </div>
              </div>
            )}
          </div>
          {/* Dot pagination */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            {drafts.slice(0, Math.min(total, 8)).map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-[#F5A623]' : 'w-1.5 bg-white/25'}`} />
            ))}
          </div>
        </div>

        {/* META + CAPTION */}
        <div className="flex flex-col">
          <h1 className="font-serif-display text-[36px] leading-[1.1] tracking-[-0.02em] text-[#F5F4F1] mb-6">
            {current?.title || current?.name || 'Untitled draft'}
          </h1>

          <dl className="grid grid-cols-[110px_1fr] gap-y-3 gap-x-4 mb-6">
            <dt className="gravity-label pt-1">Scheduled</dt>
            <dd className="text-[13px] text-[#F5F4F1] flex items-center gap-2">
              {formatScheduleDate(current?.scheduledDate)}
            </dd>

            <dt className="gravity-label pt-1">Platforms</dt>
            <dd className="flex items-center gap-2 flex-wrap">
              {platforms.length ? platforms.map((p) => {
                const meta = PLATFORM_META[p.toLowerCase()];
                if (!meta) return null;
                const { Icon, label } = meta;
                return (
                  <span key={p} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-white/[0.05] border border-white/[0.08] text-[11.5px] text-[#F5F4F1]">
                    <Icon className="w-3 h-3" />
                    {label}
                  </span>
                );
              }) : <span className="text-[12px] text-white/40">No platforms</span>}
            </dd>

            <dt className="gravity-label pt-1">Style</dt>
            <dd className="text-[13px] text-white/70">{current?.tone || current?.creative?.style || '—'}</dd>

            <dt className="gravity-label pt-1">Source</dt>
            <dd className="text-[13px] text-white/70">
              {current?.sourceType || 'Gravity AI'}{current?.aiGenerated !== false ? ' · Draft' : ''}
            </dd>
          </dl>

          <div className="border-t border-white/[0.06] pt-5 mb-8">
            <div className="gravity-label mb-3">Caption</div>
            <p className="text-[14px] text-[#F5F4F1] leading-relaxed whitespace-pre-line mb-3">
              {captionBody || <span className="text-white/40">No caption yet.</span>}
            </p>
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                {hashtags.map((h, i) => (
                  <span key={i} className="text-[13px] text-[#F5A623]">{h}</span>
                ))}
              </div>
            )}
          </div>

          {/* Actions — bottom right */}
          <div className="mt-auto flex items-center justify-end gap-3">
            <button
              onClick={handleRedo}
              disabled={busy}
              className="flex items-center gap-2 h-11 px-5 rounded-lg border border-white/[0.10] hover:border-white/25 hover:bg-white/[0.03] text-[#F5F4F1] text-[13.5px] font-medium disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Redo
            </button>
            <button
              onClick={handleApprove}
              disabled={busy}
              className="flex items-center gap-2 h-11 px-5 rounded-lg bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208] text-[13.5px] font-semibold shadow-[0_8px_28px_rgba(245,166,35,0.28)] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" strokeWidth={3} />}
              Approve & schedule
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-6 text-center text-[12px] text-red-400">{error}</div>
      )}
    </div>
  );
};

export default GravityApprove;
