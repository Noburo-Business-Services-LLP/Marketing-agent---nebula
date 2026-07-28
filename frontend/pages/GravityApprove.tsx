import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, RotateCcw, ChevronLeft, ChevronRight, Edit3, Loader2, Sparkles, Instagram, Facebook, Linkedin, Youtube } from 'lucide-react';
import { draftsAPI, apiService } from '../services/api';
import { Draft } from '../types';

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

  const loadDrafts = async () => {
    setLoading(true);
    try {
      const res = await draftsAPI.getDrafts();
      const filtered = (Array.isArray(res?.drafts) ? res.drafts : []).filter(
        (d: any) => ['pending', 'draft', 'ready'].includes(String(d?.status || 'draft').toLowerCase())
      );
      setDrafts(filtered);
      setIndex(0);
    } catch (e: any) {
      setError(e?.message || 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDrafts(); }, []);

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
      // Promote draft's underlying campaign to scheduled/publishing.
      const campaignId = current?.campaignId || current?._id;
      if (current?.campaignId) {
        await apiService.publishCampaign(current.campaignId, platforms);
      }
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
    // For now just move to next — a proper "regenerate" would call the
    // regenerate endpoint. Left as a TODO to hook up cleanly.
    goNext();
  };

  // -------- render --------

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
      <div className="max-w-[720px] mx-auto text-center py-24">
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
    );
  }

  return (
    <div className="max-w-[1180px] mx-auto pb-16">
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
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-white/[0.04] to-white/[0.01] flex items-center justify-center">
                <div className="text-white/40 text-center px-6">
                  <div className="text-[11px] uppercase tracking-widest text-white/25 mb-2">no preview</div>
                  <div className="text-[13px]">{current?.title || 'Untitled draft'}</div>
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
