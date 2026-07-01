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
      case 'instagram': return <Instagram className="w-5 h-5" />;
      case 'facebook': return <Facebook className="w-5 h-5" />;
      case 'linkedin': return <Linkedin className="w-5 h-5" />;
      case 'twitter': return <Twitter className="w-5 h-5" />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-[#0d1326] border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col my-8 max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800/80 bg-[#070A12]/80">
          <div>
            <h2 className="text-xl font-bold text-slate-100">Draft Editor & Preview</h2>
            <p className="text-xs text-slate-400 mt-1">Source: {draft.sourceType.toUpperCase()} | Status: {draft.status}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Left Column: Form Editing */}
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Campaign/Post Title</label>
              <input 
                type="text" 
                value={title} 
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 bg-[#070A12]/60 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#ffcc29]/50 transition-colors"
                placeholder="Enter draft title..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Caption</label>
              <textarea 
                value={caption} 
                onChange={(e) => setCaption(e.target.value)}
                rows={5}
                className="w-full px-4 py-3 bg-[#070A12]/60 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#ffcc29]/50 transition-colors resize-none"
                placeholder="Write your caption here..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Hashtags</label>
              <form onSubmit={handleAddHashtag} className="flex gap-2 mb-3">
                <input 
                  type="text" 
                  value={newHashtag} 
                  onChange={(e) => setNewHashtag(e.target.value)}
                  className="flex-1 px-4 py-2 bg-[#070A12]/60 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#ffcc29]/50 transition-colors"
                  placeholder="Add hashtag (without #)..."
                />
                <button 
                  type="submit"
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold rounded-xl transition-colors"
                >
                  Add
                </button>
              </form>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto p-2 bg-[#070A12]/30 border border-slate-800/50 rounded-xl">
                {hashtags.length === 0 ? (
                  <span className="text-xs text-slate-500 italic p-1">No hashtags added yet</span>
                ) : (
                  hashtags.map((tag) => (
                    <span 
                      key={tag}
                      className="inline-flex items-center gap-1 text-xs bg-[#ffcc29]/10 text-[#ffcc29] border border-[#ffcc29]/20 px-2 py-1 rounded-lg"
                    >
                      #{tag.replace(/^#/, '')}
                      <button 
                        type="button" 
                        onClick={() => handleRemoveHashtag(tag)}
                        className="hover:text-red-400 font-bold transition-colors ml-1"
                      >
                        &times;
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Call to Action (CTA)</label>
              <input 
                type="text" 
                value={cta} 
                onChange={(e) => setCta(e.target.value)}
                className="w-full px-4 py-3 bg-[#070A12]/60 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#ffcc29]/50 transition-colors"
                placeholder="e.g. Shop Now, Learn More..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Target Platforms</label>
              <div className="flex gap-3">
                {availablePlatforms.map(platform => {
                  const active = platforms.includes(platform);
                  return (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => togglePlatform(platform)}
                      className={`flex-1 flex flex-col items-center justify-center py-3 rounded-xl border transition-all ${
                        active 
                          ? 'bg-[#ffcc29]/10 border-[#ffcc29] text-[#ffcc29]' 
                          : 'bg-[#070A12]/40 border-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {getPlatformIcon(platform)}
                      <span className="text-[10px] mt-1 capitalize font-medium">{platform}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Visual Preview */}
          <div className="flex flex-col space-y-6">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Image Preview</label>
              <div className="relative aspect-square w-full rounded-2xl bg-[#070A12]/60 border border-slate-800 overflow-hidden flex items-center justify-center">
                {imageUrl ? (
                  <img 
                    src={imageUrl} 
                    alt="Draft Creative" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-slate-500 text-sm flex flex-col items-center p-6 text-center">
                    <span className="text-3xl mb-2">🖼️</span>
                    No creative generated or linked yet. Use generation tools to add media.
                  </div>
                )}
              </div>
              <div className="mt-3">
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="Paste Image URL here..."
                  className="w-full px-3 py-2 text-xs bg-[#070A12]/40 border border-slate-800 rounded-xl text-slate-300 focus:outline-none"
                />
              </div>
            </div>

            {/* Quick Instagram/Social UI Mockup */}
            <div className="border border-slate-800/80 rounded-2xl p-4 bg-[#070A12]/30 flex-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#ffcc29] to-orange-500 flex items-center justify-center font-bold text-xs text-black">
                  N
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">Your Business Profile</h4>
                  <p className="text-[10px] text-slate-500">Sponsored</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 line-clamp-3 mb-2">{caption || 'Write caption to preview...'}</p>
              <p className="text-xs text-[#ffcc29] mb-3">
                {hashtags.map(t => `#${t.replace(/^#/, '')}`).join(' ')}
              </p>
              {cta && (
                <div className="flex justify-between items-center py-2 px-3 bg-slate-800/30 border border-slate-800 rounded-lg text-xs font-semibold text-[#ffcc29]">
                  <span>{cta}</span>
                  <span>➜</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Panel */}
        <div className="p-6 border-t border-slate-800/80 bg-[#070A12]/80 space-y-4">
          {errorMsg && (
            <p className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 p-3 rounded-xl">
              ⚠️ {errorMsg}
            </p>
          )}
          {successMsg && (
            <p className="text-xs text-green-400 bg-green-950/20 border border-green-900/30 p-3 rounded-xl flex items-center gap-2">
              <Check className="w-4 h-4" /> {successMsg}
            </p>
          )}

          {/* Scheduling inputs section */}
          {showScheduler && (
            <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-xl grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Date</label>
                <input 
                  type="date" 
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#070A12] border border-slate-800 rounded-lg text-slate-200 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Time</label>
                <input 
                  type="time" 
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#070A12] border border-slate-800 rounded-lg text-slate-200 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving || isScheduling || isPublishing}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm transition-all disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>

              <button
                onClick={() => {
                  if (showScheduler) {
                    handleSchedule();
                  } else {
                    setShowScheduler(true);
                  }
                }}
                disabled={isSaving || isScheduling || isPublishing}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[#ffcc29]/10 border border-[#ffcc29]/30 text-[#ffcc29] hover:bg-[#ffcc29]/20 font-semibold text-sm transition-all disabled:opacity-50"
              >
                {isScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                {showScheduler ? 'Confirm Schedule' : 'Schedule for Later'}
              </button>

              <button
                onClick={handlePublishNow}
                disabled={isSaving || isScheduling || isPublishing}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#ffcc29] hover:bg-[#ebd038] text-black font-bold text-sm transition-all disabled:opacity-50"
              >
                {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Publish Now
              </button>
            </div>

            {draft.contentCalendarId && draft.calendarDay ? (
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  disabled={isRejecting || isRegenerating}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/30 border border-red-900/40 text-red-400 hover:bg-red-950/50 hover:text-red-300 font-semibold text-sm transition-all"
                >
                  {isRejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  Reject
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={isRejecting || isRegenerating}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-indigo-950/30 border border-indigo-900/40 text-indigo-400 hover:bg-indigo-900/50 hover:text-indigo-300 font-semibold text-sm transition-all"
                >
                  {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Regenerate
                </button>
              </div>
            ) : (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/20 border border-red-900/30 text-red-400 hover:bg-red-950/40 hover:text-red-300 font-semibold text-sm transition-all"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Archive Draft
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
