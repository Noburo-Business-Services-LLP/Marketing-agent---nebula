import React, { useState, useEffect } from 'react';
import { X, Save, Calendar, Send, Trash2, Loader2, Instagram, Facebook, Linkedin, Twitter, Check, RotateCcw } from 'lucide-react';
import { Draft } from '../types';
import { draftsAPI } from '../services/api';

interface DraftPreviewModalProps {
  draft: Draft;
  onClose: () => void;
  onSuccess: () => void;
}

export const DraftPreviewModal: React.FC<DraftPreviewModalProps> = ({ draft, onClose, onSuccess }) => {
  const [title, setTitle] = useState(draft.title || '');
  const [caption, setCaption] = useState(draft.caption || '');
  const [hashtags, setHashtags] = useState<string[]>(draft.hashtags || []);
  const [newHashtag, setNewHashtag] = useState('');
  const [cta, setCta] = useState(draft.cta || '');
  const [platforms, setPlatforms] = useState<string[]>(draft.platforms || []);
  const [imageUrl, setImageUrl] = useState(draft.imageUrl || '');
  
  // Scheduling state
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  // Operations loading states
  const [isSaving, setIsSaving] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const availablePlatforms = ['instagram', 'facebook', 'linkedin', 'twitter'];

  useEffect(() => {
    if (draft.scheduledDate) {
      const dateObj = new Date(draft.scheduledDate);
      setScheduleDate(dateObj.toISOString().slice(0, 10));
      setScheduleTime(dateObj.toTimeString().slice(0, 5));
    }
  }, [draft]);

  const togglePlatform = (platform: string) => {
    setPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  const handleAddHashtag = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newHashtag.trim().replace(/^#/, '');
    if (tag && !hashtags.includes(tag)) {
      setHashtags([...hashtags, tag]);
      setNewHashtag('');
    }
  };

  const handleRemoveHashtag = (tag: string) => {
    setHashtags(hashtags.filter(t => t !== tag));
  };

  const getUpdatedData = () => {
    return {
      title,
      caption,
      hashtags: hashtags.map(h => h.startsWith('#') ? h : `#${h}`),
      cta,
      platforms,
      imageUrl,
      creative: {
        ...draft.creative,
        type: draft.creative?.type || 'image',
        textContent: caption,
        captions: caption,
        imageUrls: imageUrl ? [imageUrl] : [],
        hashtags: hashtags.map(h => h.startsWith('#') ? h : `#${h}`),
        callToAction: cta
      }
    };
  };

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isRetryingImage, setIsRetryingImage] = useState(false);

  const handleRetryImage = async () => {
    setIsRetryingImage(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await draftsAPI.retryImageGeneration(draft._id);
      setSuccessMsg('Re-queued image generation in background!');
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to retry image generation.');
    } finally {
      setIsRetryingImage(false);
    }
  };

  const handleReject = async () => {
    if (window.confirm('Are you sure you want to reject this draft? It will be archived.')) {
      setIsRejecting(true);
      setErrorMsg('');
      try {
        await draftsAPI.rejectDraft(draft._id);
        setSuccessMsg('Draft rejected successfully!');
        setTimeout(() => {
          onSuccess();
        }, 1000);
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to reject draft.');
      } finally {
        setIsRejecting(false);
      }
    }
  };

  const handleRegenerate = async () => {
    if (window.confirm('Are you sure you want to reject and regenerate a new draft for this slot?')) {
      setIsRegenerating(true);
      setErrorMsg('');
      try {
        await draftsAPI.regenerateDraft(draft._id);
        setSuccessMsg('Regeneration queued in background!');
        setTimeout(() => {
          onSuccess();
        }, 1500);
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to regenerate draft.');
      } finally {
        setIsRegenerating(false);
      }
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await draftsAPI.updateDraft(draft._id, getUpdatedData());
      setSuccessMsg('Draft saved successfully!');
      setTimeout(() => {
        onSuccess();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleDate || !scheduleTime) {
      setErrorMsg('Please select both date and time.');
      return;
    }

    setIsScheduling(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      
      // Update basic fields first to ensure no edits are lost
      await draftsAPI.updateDraft(draft._id, getUpdatedData());
      
      // Call schedule API
      await draftsAPI.scheduleDraft(draft._id, scheduledDateTime);
      
      setSuccessMsg('Draft scheduled successfully!');
      setTimeout(() => {
        onSuccess();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to schedule draft.');
    } finally {
      setIsScheduling(false);
    }
  };

  const handlePublishNow = async () => {
    if (platforms.length === 0) {
      setErrorMsg('Please select at least one platform to publish.');
      return;
    }

    if (window.confirm('Are you sure you want to publish this post immediately to social media?')) {
      setIsPublishing(true);
      setErrorMsg('');
      setSuccessMsg('');
      try {
        // Save current changes first
        await draftsAPI.updateDraft(draft._id, getUpdatedData());
        
        // Call publish API
        const response = await draftsAPI.publishDraft(draft._id, platforms);
        
        if (response.success) {
          setSuccessMsg('Published successfully!');
          setTimeout(() => {
            onSuccess();
          }, 1500);
        } else {
          setErrorMsg('Failed to publish. Campaign was saved as a draft.');
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to publish draft.');
      } finally {
        setIsPublishing(false);
      }
    }
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to archive/delete this draft?')) {
      setIsDeleting(true);
      setErrorMsg('');
      try {
        await draftsAPI.deleteDraft(draft._id);
        onSuccess();
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to delete draft.');
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'instagram': return <Instagram className="w-4 h-4" />;
      case 'facebook': return <Facebook className="w-4 h-4" />;
      case 'linkedin': return <Linkedin className="w-4 h-4" />;
      case 'twitter': return <Twitter className="w-4 h-4" />;
      default: return null;
    }
  };

  const PLATFORM_LABEL: Record<string, string> = {
    instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', twitter: 'X'
  };

  const statusTone = (s: string) => {
    const v = String(s || '').toLowerCase();
    if (v === 'published') return 'bg-emerald-500/12 text-emerald-300 border-emerald-400/25';
    if (v === 'scheduled') return 'bg-sky-500/12 text-sky-300 border-sky-400/25';
    if (v === 'processing') return 'bg-[#F5A623]/12 text-[#F5A623] border-[#F5A623]/30';
    if (v === 'failed') return 'bg-red-500/12 text-red-300 border-red-400/25';
    return 'bg-white/[0.05] text-white/55 border-white/[0.12]';
  };

  const busy = isSaving || isScheduling || isPublishing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-6xl my-6 rounded-[22px] overflow-hidden flex flex-col max-h-[92vh]"
        style={{
          background: 'linear-gradient(180deg, #131316 0%, #0b0b0e 42%)',
          boxShadow: '0 40px 120px rgba(0,0,0,0.75), inset 0 1px 0 0 rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.09)'
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-2">
              <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border ${statusTone(draft.status)}`}>
                {draft.status}
              </span>
              <span className="gravity-label">{String(draft.sourceType || 'post')}</span>
            </div>
            <h2 className="font-serif-display text-[30px] leading-[1.1] tracking-[-0.02em] text-[#F5F4F1] truncate">
              {title || <span className="italic text-[#F5A623]">Untitled</span>}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-9 h-9 rounded-full grid place-items-center bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.08] text-white/55 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.10] to-transparent" />

        {/* Body — artwork leads, controls follow */}
        <div className="flex-1 overflow-y-auto px-7 py-7 grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-8">

          {/* Artwork */}
          <div>
            <div
              className="relative w-full rounded-2xl overflow-hidden bg-black grid place-items-center"
              style={{ aspectRatio: '4 / 5', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {draft.status === 'processing' ? (
                <div className="flex flex-col items-center gap-3 text-center px-6">
                  <Loader2 className="w-8 h-8 text-[#F5A623] animate-spin" />
                  <span className="text-[13px] text-white/55">Generating in the background…</span>
                </div>
              ) : draft.status === 'failed' ? (
                <div className="flex flex-col items-center gap-3 text-center px-6">
                  <span className="text-2xl">⚠️</span>
                  <p className="text-[13.5px] font-semibold text-red-300">Generation failed</p>
                  {draft.errorMessage && (
                    <p className="text-[11.5px] text-white/40 max-w-[240px] line-clamp-2">{draft.errorMessage}</p>
                  )}
                  <button
                    type="button"
                    disabled={isRetryingImage}
                    onClick={handleRetryImage}
                    className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#F5A623] text-black text-[12px] font-semibold hover:bg-[#ffb833] disabled:opacity-50"
                  >
                    {isRetryingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Try again
                  </button>
                </div>
              ) : imageUrl ? (
                <img src={imageUrl} alt={title || 'Draft'} className="w-full h-full object-contain" />
              ) : (
                <p className="text-[13px] text-white/30 px-8 text-center">No artwork yet.</p>
              )}
            </div>

            {imageUrl && draft.status !== 'processing' && (
              <button
                type="button"
                onClick={handleRetryImage}
                disabled={isRetryingImage}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border border-white/[0.10] text-[13px] font-semibold text-white/70 hover:text-white hover:border-white/25 hover:bg-white/[0.03] transition-colors disabled:opacity-40"
              >
                {isRetryingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Regenerate artwork
              </button>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-6">
            <div>
              <label className="gravity-label block mb-2">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give it a name…"
                className="w-full px-0 py-2 bg-transparent border-0 border-b border-white/[0.12] text-[19px] font-semibold text-[#F5F4F1] placeholder:text-white/20 focus:outline-none focus:border-[#F5A623] transition-colors"
              />
            </div>

            <div>
              <label className="gravity-label block mb-2">Caption</label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={5}
                placeholder="What should this say?"
                className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/[0.09] text-[14px] leading-relaxed text-[#F5F4F1] placeholder:text-white/20 focus:outline-none focus:border-[#F5A623]/60 transition-colors resize-none"
              />
            </div>

            <div>
              <label className="gravity-label block mb-2">Hashtags</label>
              <form onSubmit={handleAddHashtag} className="flex gap-2">
                <input
                  type="text"
                  value={newHashtag}
                  onChange={(e) => setNewHashtag(e.target.value)}
                  placeholder="add a tag…"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-black/40 border border-white/[0.09] text-[13px] text-[#F5F4F1] placeholder:text-white/20 focus:outline-none focus:border-[#F5A623]/60 transition-colors"
                />
                <button
                  type="submit"
                  className="px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.09] text-[13px] font-semibold text-white/80 transition-colors"
                >
                  Add
                </button>
              </form>
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {hashtags.map((tag) => (
                    <span
                      key={tag}
                      className="group inline-flex items-center gap-1.5 text-[12px] bg-[#F5A623]/[0.10] text-[#F5A623] border border-[#F5A623]/25 pl-2.5 pr-1.5 py-1 rounded-full"
                    >
                      #{tag.replace(/^#/, '')}
                      <button
                        type="button"
                        onClick={() => handleRemoveHashtag(tag)}
                        className="w-4 h-4 grid place-items-center rounded-full text-[#F5A623]/60 hover:text-black hover:bg-[#F5A623] transition-colors"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="gravity-label block mb-2">Call to action</label>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Shop now, Learn more…"
                className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/[0.09] text-[13.5px] text-[#F5F4F1] placeholder:text-white/20 focus:outline-none focus:border-[#F5A623]/60 transition-colors"
              />
            </div>

            <div>
              <label className="gravity-label block mb-2">Posting to</label>
              <div className="flex flex-wrap gap-2">
                {availablePlatforms.map((platform) => {
                  const active = platforms.includes(platform);
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => togglePlatform(platform)}
                      className={`inline-flex items-center gap-2 h-10 pl-3 pr-3.5 rounded-full border text-[12.5px] font-semibold transition-all ${
                        active
                          ? 'bg-[#F5A623] border-[#F5A623] text-black'
                          : 'bg-white/[0.03] border-white/[0.10] text-white/55 hover:text-white/85 hover:border-white/25'
                      }`}
                    >
                      {getPlatformIcon(platform)}
                      {PLATFORM_LABEL[platform] || platform}
                    </button>
                  );
                })}
              </div>
              {platforms.length === 0 && (
                <p className="text-[11.5px] text-white/30 mt-2">Pick at least one to publish.</p>
              )}
            </div>

            {showScheduler && (
              <div className="rounded-xl border border-[#F5A623]/25 bg-[#F5A623]/[0.05] p-4">
                <label className="gravity-label block mb-2.5 text-[#F5A623]">When should it go out?</label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-black/50 border border-white/[0.10] text-[13px] text-[#F5F4F1] focus:outline-none focus:border-[#F5A623]/60"
                  />
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-black/50 border border-white/[0.10] text-[13px] text-[#F5F4F1] focus:outline-none focus:border-[#F5A623]/60"
                  />
                </div>
              </div>
            )}

            {errorMsg && (
              <p className="text-[12.5px] text-red-300 bg-red-500/[0.08] border border-red-400/20 px-3.5 py-2.5 rounded-xl">{errorMsg}</p>
            )}
            {successMsg && (
              <p className="text-[12.5px] text-emerald-300 bg-emerald-500/[0.08] border border-emerald-400/20 px-3.5 py-2.5 rounded-xl flex items-center gap-2">
                <Check className="w-3.5 h-3.5" /> {successMsg}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.10] to-transparent" />
        <div className="px-7 py-5 flex flex-wrap items-center gap-3 bg-black/30">
          <button
            onClick={handleSave}
            disabled={busy}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.09] text-[13px] font-semibold text-[#F5F4F1] transition-colors disabled:opacity-40"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>

          <button
            onClick={() => (showScheduler ? handleSchedule() : setShowScheduler(true))}
            disabled={busy}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#F5A623]/[0.10] border border-[#F5A623]/30 text-[#F5A623] hover:bg-[#F5A623]/20 text-[13px] font-semibold transition-colors disabled:opacity-40"
          >
            {isScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            {showScheduler ? 'Confirm schedule' : 'Schedule'}
          </button>

          <button
            onClick={handlePublishNow}
            disabled={busy}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#F5A623] hover:bg-[#ffb833] text-black text-[13px] font-bold shadow-[0_8px_28px_rgba(245,166,35,0.28)] transition-colors disabled:opacity-40"
          >
            {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Publish now
          </button>

          <div className="ml-auto flex gap-2">
            {draft.contentCalendarId && draft.calendarDay ? (
              <>
                <button
                  onClick={handleRegenerate}
                  disabled={isRejecting || isRegenerating}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-white/[0.10] text-[13px] font-semibold text-white/60 hover:text-white hover:border-white/25 transition-colors disabled:opacity-40"
                >
                  {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Regenerate
                </button>
                <button
                  onClick={handleReject}
                  disabled={isRejecting || isRegenerating}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-white/[0.10] text-[13px] font-semibold text-white/45 hover:text-red-300 hover:border-red-400/40 transition-colors disabled:opacity-40"
                >
                  {isRejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  Reject
                </button>
              </>
            ) : (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-white/[0.10] text-[13px] font-semibold text-white/45 hover:text-red-300 hover:border-red-400/40 transition-colors disabled:opacity-40"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Archive
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
