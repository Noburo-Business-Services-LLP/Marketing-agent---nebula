import PlatformIcon from './PlatformIcon';
import { choicesFor } from '../utils/platforms';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Save, Loader2, RotateCcw, Pencil, AlertCircle } from 'lucide-react';
import { Draft } from '../types';
import { draftsAPI } from '../services/api';
import { useQuarkCosts } from '../hooks/useQuarkCosts';
import { useConfirm } from '../context/ConfirmContext';
import PostActions, { PostActionsChange, PostNotice, PostNoticeValue } from './PostActions';
import { postStateWord } from '../utils/postActions';
import './draftSheet.css';

interface DraftPreviewModalProps {
  draft: Draft;
  onClose: () => void;
  /** the post changed and the sheet closes (saved, approved, scheduled, posted, archived, moved to the Bin) */
  onSuccess: () => void;
  /** the post changed; the screen behind can refresh its list and counts */
  onChanged?: (change: PostActionsChange) => void;
  /** other pictures in the same list (a campaign's posts, say): the arrows step to them when this one has no slides */
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;
}

/**
 * The post sheet (opened from the Library, Review and approve and the Create gallery): the picture, the words, where
 * it goes, and the shared post actions (components/PostActions.tsx) in the footer: the same buttons, in the same order,
 * as everywhere else. Cream and gold like the rest of the app.
 */
export const DraftPreviewModal: React.FC<DraftPreviewModalProps> = ({ draft, onClose, onSuccess, onChanged, onPrev, onNext, position }) => {
  // Make again redraws the picture, so it costs the same Quarks as the original; campaign posts are billed through
  // the Campaigns flow already (matches backend/routes/drafts.js).
  const quarkCosts = useQuarkCosts();
  const confirm = useConfirm();
  const makeAgainQuarks = draft.contentType === 'campaign' ? 0 : (quarkCosts.image_generated || 0);

  const [title, setTitle] = useState(draft.title || '');
  const [caption, setCaption] = useState(draft.caption || '');
  const [hashtags, setHashtags] = useState<string[]>(draft.hashtags || []);
  const [newHashtag, setNewHashtag] = useState('');
  const [cta, setCta] = useState(draft.cta || '');
  const [theme, setTheme] = useState((draft as any).theme || '');
  const [platforms, setPlatforms] = useState<string[]>(draft.platforms || []);
  const imageUrl = draft.imageUrl || '';
  // A carousel keeps its pictures per slide, not in one image field.
  const slideUrls: string[] = (Array.isArray((draft as any).carouselSlides) ? (draft as any).carouselSlides : [])
    .slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
    .map((x: any) => String((x && x.imageUrl) || '')).filter((u: string) => /^https?:\/\//i.test(u));
  const [slideIdx, setSlideIdx] = useState(0);
  const shownUrl = slideUrls.length ? slideUrls[Math.min(slideIdx, slideUrls.length - 1)] : imageUrl;
  // Arrows: through the slides of a carousel; otherwise to the neighbouring picture in the list, if there is one.
  const hasSlides = slideUrls.length > 1;
  const canPrev = hasSlides ? slideIdx > 0 : Boolean(onPrev);
  const canNext = hasSlides ? slideIdx < slideUrls.length - 1 : Boolean(onNext);
  const goPrev = () => { if (hasSlides) setSlideIdx((i) => Math.max(0, i - 1)); else if (onPrev) onPrev(); };
  const goNext = () => { if (hasSlides) setSlideIdx((i) => Math.min(slideUrls.length - 1, i + 1)); else if (onNext) onNext(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (document.querySelector('.nb-pa-scrim, .nb-pa-menu')) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowLeft' && canPrev) { e.preventDefault(); goPrev(); }
      if (e.key === 'ArrowRight' && canNext) { e.preventDefault(); goNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { closeBtn.current?.focus(); }, []);

  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<PostNoticeValue | null>(null);
  const setErrorMsg = (text: string) => setNotice(text ? { text, tone: 'error' } : null);
  const setSuccessMsg = (text: string) => setNotice(text ? { text, tone: 'ok' } : null);

  const platformChoices = choicesFor('image');
  const status = String(draft.status || '').toLowerCase();
  const editable = !['published', 'archived', 'binned', 'processing'].includes(status);

  const togglePlatform = (platform: string) => {
    setPlatforms(prev => prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]);
  };

  const handleAddHashtag = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newHashtag.trim().replace(/^#/, '');
    if (tag && !hashtags.includes(tag)) {
      setHashtags([...hashtags, tag]);
      setNewHashtag('');
    }
  };

  const handleRemoveHashtag = (tag: string) => setHashtags(hashtags.filter(t => t !== tag));

  const getUpdatedData = () => ({
    title,
    caption,
    hashtags: hashtags.map(h => h.startsWith('#') ? h : `#${h}`),
    cta,
    theme: theme.trim(),
    platforms,
    imageUrl,
    creative: {
      ...draft.creative,
      type: draft.creative?.type || 'image',
      textContent: caption,
      captions: caption,
      imageUrls: slideUrls.length ? slideUrls : (imageUrl ? [imageUrl] : []),
      hashtags: hashtags.map(h => h.startsWith('#') ? h : `#${h}`),
      callToAction: cta
    }
  });

  const [isRegenerating, setIsRegenerating] = useState(false);
  // What the model was actually told to draw. Editable: Make again uses this exact text; empty asks for a new idea.
  const [promptDraft, setPromptDraft] = useState(draft.imagePromptResolved || '');

  // A small targeted fix: keep the picture, change only what the instruction asks for.
  const [editOpen, setEditOpen] = useState(false);
  const [editInstruction, setEditInstruction] = useState('');
  const [isEditingImage, setIsEditingImage] = useState(false);
  const editBox = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (editOpen) editBox.current?.focus(); }, [editOpen]);

  const handleEditImage = async () => {
    if (!editInstruction.trim()) return;
    setIsEditingImage(true);
    setNotice(null);
    try {
      await draftsAPI.editImage(draft._id, editInstruction.trim());
      setSuccessMsg('The change is made.');
      setEditOpen(false);
      setEditInstruction('');
      setTimeout(() => onSuccess(), 1200);
    } catch (err: any) {
      setErrorMsg(err.message || 'We could not make that change. Please try again.');
    } finally {
      setIsEditingImage(false);
    }
  };

  // Calendar posts: a whole new post for the same day (words and picture).
  const handleRegenerate = async () => {
    if (await confirm('This puts the current post away and makes a brand new one for this day.', { title: 'Make a new post for this day?', confirmLabel: 'Make a new post' })) {
      setIsRegenerating(true);
      setErrorMsg('');
      try {
        await draftsAPI.regenerateDraft(draft._id);
        setSuccessMsg('A new post is being made for this day.');
        setTimeout(() => onSuccess(), 1500);
      } catch (err: any) {
        setErrorMsg(err.message || 'We could not start a new post. Please try again.');
      } finally {
        setIsRegenerating(false);
      }
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setNotice(null);
    try {
      await draftsAPI.updateDraft(draft._id, getUpdatedData());
      setSuccessMsg('Changes saved.');
      setTimeout(() => onSuccess(), 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'We could not save your changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Approve, Schedule and Post now save the words first, so nothing typed here is lost.
  const saveFirst = async () => {
    if (editable) await draftsAPI.updateDraft(draft._id, getUpdatedData());
  };

  const changed = (c: PostActionsChange) => {
    onChanged?.(c);
    setSuccessMsg(c.message);
    setTimeout(() => onSuccess(), c.key === 'makeAgain' ? 1500 : 1100);
  };

  const isCalendarPost = Boolean(draft.contentCalendarId && draft.calendarDay);
  const stateWord = postStateWord(draft);

  // Drawn on the page body, so the app's top bar and menu never sit over it.
  return createPortal(
    <div className="nb-sheet-scrim" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="nb-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nb-sheet-title"
      >
        {/* Header */}
        <div className="nb-sheet-head">
          <div className="min-w-0">
            <div className="nb-sheet-chips">
              <span className="nb-sheet-chip" data-state={stateWord}>{stateWord}</span>
              <span className="nb-sheet-kind">{draft.contentType === 'campaign' ? 'Campaign post' : 'Post'}</span>
            </div>
            <h2 id="nb-sheet-title" className="nb-sheet-title">{title || 'Untitled post'}</h2>
          </div>
          <button ref={closeBtn} type="button" onClick={onClose} className="nb-sheet-close" aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body: the picture leads, the words follow */}
        <div className="nb-sheet-body">
          <div>
            <div className="nb-sheet-art">
              {draft.status === 'processing' ? (
                <div className="nb-sheet-art-note">
                  <Loader2 className="w-8 h-8 animate-spin text-[#C06F00]" aria-hidden="true" />
                  <span>Being made. It shows here when it is ready.</span>
                </div>
              ) : draft.status === 'failed' ? (
                <div className="nb-sheet-art-note">
                  <AlertCircle className="w-7 h-7 text-[#9A3412]" aria-hidden="true" />
                  <strong>This picture did not finish</strong>
                  <span>Use Make again below to try once more.</span>
                </div>
              ) : shownUrl ? (
                <img src={shownUrl} alt={title || 'Post picture'} className="w-full h-full object-contain" />
              ) : (
                <div className="nb-sheet-art-note"><span>No picture yet.</span></div>
              )}
              {(canPrev || canNext) && (
                <>
                  <button type="button" onClick={goPrev} disabled={!canPrev} aria-label={hasSlides ? 'Previous slide' : 'Previous post'} className="nb-sheet-arrow" data-side="left">
                    <ChevronLeft className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={goNext} disabled={!canNext} aria-label={hasSlides ? 'Next slide' : 'Next post'} className="nb-sheet-arrow" data-side="right">
                    <ChevronRight className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <span className="nb-sheet-pos">{hasSlides ? `${slideIdx + 1} / ${slideUrls.length}` : (position || '')}</span>
                </>
              )}
            </div>

            {slideUrls.length > 1 && (
              <div className="nb-sheet-slides" aria-label="Carousel slides">
                {slideUrls.map((u, i) => (
                  <button key={u} type="button" onClick={() => setSlideIdx(i)} aria-label={`Slide ${i + 1}`} aria-pressed={i === slideIdx} data-on={i === slideIdx ? 'true' : undefined}>
                    <img src={u} alt="" />
                  </button>
                ))}
              </div>
            )}

            {editOpen && (
              <div className="nb-sheet-edit">
                <label className="nb-sheet-label" htmlFor="nb-sheet-edit-box">Describe the change</label>
                <textarea
                  id="nb-sheet-edit-box"
                  ref={editBox}
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  placeholder="For example: fix the spelling in the headline, make the sky darker, or remove the coffee cup."
                  rows={2}
                  className="nb-sheet-input"
                />
                <div className="nb-sheet-edit-foot">
                  <span>The rest of the picture stays the same.</span>
                  <button type="button" onClick={handleEditImage} disabled={isEditingImage || !editInstruction.trim()} className="nb-pa-btn" data-primary="true">
                    {isEditingImage ? <Loader2 className="nb-pa-ico animate-spin" aria-hidden="true" /> : <Pencil className="nb-pa-ico" aria-hidden="true" />}
                    Make this change
                  </button>
                </div>
              </div>
            )}

            {draft.status !== 'processing' && editable && (
              <div className="mt-3">
                <label className="nb-sheet-label" htmlFor="nb-sheet-prompt">Picture description</label>
                <textarea
                  id="nb-sheet-prompt"
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  placeholder={draft.imagePromptResolved ? '' : 'Leave this empty and Nebulaa picks a new idea, or describe the picture you want.'}
                  rows={4}
                  className="nb-sheet-input nb-sheet-mono"
                />
                <p className="nb-sheet-help">
                  {promptDraft.trim() && promptDraft.trim() !== (draft.imagePromptResolved || '').trim()
                    ? 'You changed it. Make again uses this exact text.'
                    : promptDraft.trim()
                      ? 'Make again uses this text again.'
                      : 'Empty: Make again asks Nebulaa for a new idea.'}
                </p>
              </div>
            )}
          </div>

          {/* The words and where it goes */}
          <div className="nb-sheet-fields">
            <div>
              <label className="nb-sheet-label" htmlFor="nb-sheet-name">Title</label>
              <input id="nb-sheet-name" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give it a name" className="nb-sheet-input" disabled={!editable} />
            </div>

            <div>
              <label className="nb-sheet-label" htmlFor="draft-theme">Theme or festival <span className="nb-sheet-label-note">groups posts together</span></label>
              <input id="draft-theme" type="text" value={theme} maxLength={60} onChange={(e) => setTheme(e.target.value)} placeholder="For example Diwali, Monsoon sale" className="nb-sheet-input" disabled={!editable} />
            </div>

            <div>
              <label className="nb-sheet-label" htmlFor="nb-sheet-caption">Caption</label>
              <textarea id="nb-sheet-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} placeholder="What should this say?" className="nb-sheet-input" disabled={!editable} />
            </div>

            <div>
              <label className="nb-sheet-label" htmlFor="nb-sheet-tag">Hashtags</label>
              {editable && (
                <form onSubmit={handleAddHashtag} className="flex gap-2">
                  <input id="nb-sheet-tag" type="text" value={newHashtag} onChange={(e) => setNewHashtag(e.target.value)} placeholder="Add a tag" className="nb-sheet-input flex-1" />
                  <button type="submit" className="nb-pa-btn">Add</button>
                </form>
              )}
              {hashtags.length > 0 && (
                <div className="nb-sheet-tags">
                  {hashtags.map((tag) => (
                    <span key={tag} className="nb-sheet-tagchip">
                      #{tag.replace(/^#/, '')}
                      {editable && (
                        <button type="button" onClick={() => handleRemoveHashtag(tag)} aria-label={`Remove ${tag.replace(/^#/, '')}`}>
                          <X className="w-2.5 h-2.5" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="nb-sheet-label" htmlFor="nb-sheet-cta">Call to action</label>
              <input id="nb-sheet-cta" type="text" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Shop now, Learn more" className="nb-sheet-input" disabled={!editable} />
            </div>

            <div>
              <span className="nb-sheet-label" id="nb-sheet-where">Posting to</span>
              <div className="nb-sheet-platforms" role="group" aria-labelledby="nb-sheet-where">
                {platformChoices.map(({ key: platform, label }) => {
                  const active = platforms.includes(platform);
                  return (
                    <button key={platform} type="button" onClick={() => togglePlatform(platform)} aria-pressed={active} data-on={active ? 'true' : undefined} disabled={!editable}>
                      <PlatformIcon platform={platform} />
                      {label}
                    </button>
                  );
                })}
              </div>
              {platforms.length === 0 && editable && <p className="nb-sheet-help">Pick at least one to post it.</p>}
            </div>

            <PostNotice notice={notice} onClose={() => setNotice(null)} />
          </div>
        </div>

        {/* Footer: Save, then the shared post actions in their fixed order */}
        <div className="nb-sheet-foot">
          {editable && (
            <button type="button" onClick={handleSave} disabled={isSaving} className="nb-pa-btn">
              {isSaving ? <Loader2 className="nb-pa-ico animate-spin" aria-hidden="true" /> : <Save className="nb-pa-ico" aria-hidden="true" />}
              Save changes
            </button>
          )}
          {isCalendarPost && editable && (
            <button type="button" onClick={handleRegenerate} disabled={isRegenerating} className="nb-pa-btn" title="Make a whole new post (words and picture) for this day">
              {isRegenerating ? <Loader2 className="nb-pa-ico animate-spin" aria-hidden="true" /> : <RotateCcw className="nb-pa-ico" aria-hidden="true" />}
              New post for this day
            </button>
          )}
          <span className="nb-sheet-foot-gap" aria-hidden="true" />
          <PostActions
            draft={draft}
            platforms={platforms}
            label={title || 'this post'}
            makeAgainQuarks={makeAgainQuarks}
            makeAgainPrompt={promptDraft}
            onEdit={editable && shownUrl ? () => setEditOpen((v) => !v) : undefined}
            prepare={saveFirst}
            archiveVia={isCalendarPost ? 'reject' : 'archive'}
            onChanged={changed}
            onMessage={(text, tone, to) => setNotice(text ? { text, tone, to } : null)}
            className="nb-sheet-actions"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};
