import { priceWithWorth } from '../utils/plans';
import PlatformIcon from '../components/PlatformIcon';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Layers, Calendar as CalendarIcon, Zap, Image as ImageIcon, Instagram, Facebook, ChevronRight, Loader2, Check, Clock, Save, AlertCircle, RotateCcw, Pencil, Trash2, Code2, Copy, X, SlidersHorizontal, Package } from 'lucide-react';
import { draftsAPI, brandAssetsAPI, apiService } from '../services/api';
import { useQuarkCosts } from '../hooks/useQuarkCosts';
import { useConfirm } from '../context/ConfirmContext';
import { CONTENT_LANGUAGES, OFFERED_LANGUAGE_VALUES } from '../constants/languages';
import { takePrefill, nearestLanguage } from '../utils/prefill';
import type { LogoGridPosition } from '../constants/logoPositions';
import { DEFAULT_LOGO_POSITION, logoPositionFor } from '../utils/logoChoice';
import { OptionGroup, TileRadioRow, ShapeArt, LogoPostArt, LogoPositionTile, LanguageTile, PlatformTiles, LOOK_ART, tileClass } from '../components/CreateOptions';
import PostDesignPanel from '../components/PostDesignPanel';
import CoverTile, { type CoverPalette } from '../components/CoverTile';
import { SinglePostArt, CampaignArt, CarouselArt, LinkedInArt, VideoArt, PhotoshootArt } from '../components/art';
import { createPhoto } from '../utils/samplePhotos';
import { CREATE_TILES, VIDEO_ENTRY, PHOTOSHOOT_ENTRY, actionCostKey, createTileCost, videoEntryCost, photoshootEntryCost } from '../utils/createTiles';
import IdeaBoxTools, { ReadUpload } from '../components/IdeaBoxTools';
import { appendText, mergeDetails } from '../utils/ideaFiles';
import { DEFAULT_DESIGN, PostDesign, designRequestFields } from '../utils/postDesign';
import { Draft } from '../types';
import GeneratingFill from '../components/GeneratingFill';
import CreateGenerations from '../components/CreateGenerations';
import CalendarIdeaPicker from '../components/CalendarIdeaPicker';
import PromptStudio from '../components/PromptStudio';
import AssetPicker, { PickedAsset } from '../components/AssetPicker';
import { GravityEmphasis } from '../components/gravity';

const ASPECTS = [
  { key: '4:5',  label: '4:5',  hint: 'Portrait', use: 'Best for the Instagram feed', w: 4, h: 5 },
  { key: '1:1',  label: '1:1',  hint: 'Square', use: 'Works everywhere', w: 1, h: 1 },
  { key: '9:16', label: '9:16', hint: 'Full screen', use: 'Stories and reels', w: 9, h: 16 },
  { key: '16:9', label: '16:9', hint: 'Wide', use: 'YouTube and Facebook', w: 16, h: 9 },
];

// How full the design is; the key is what the request sends as density.
const LOOKS = [
  { key: 'clean', label: 'Clean', hint: 'Calm and simple' },
  { key: 'balanced', label: 'Balanced', hint: 'A clear message with support' },
  { key: 'rich', label: 'Rich', hint: 'Festive and full' },
] as const;

// Direct fetch to the streaming endpoint — apiService doesn't expose SSE.
const API_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? '/api'
  : 'http://localhost:5000/api';
const getToken = () =>
  (typeof window !== 'undefined' && (localStorage.getItem('token') || localStorage.getItem('authToken'))) || '';

// Gravity Create — matches the prototype's Create screen exactly.
// Two modes: Campaign (multi-post plan) and Single post.
// Wires the primary CTA to apiService.createCampaign, then routes to
// /drafts (Approve) so the user sees what got produced.

type CreateMode = 'campaign' | 'single' | 'carousel' | 'linkedin';
// Created once, so the tiles do not rebuild their pictures on every keystroke in the form.
const ART_FOR_MODE: Record<CreateMode, React.ReactNode> = {
  single: <SinglePostArt />, campaign: <CampaignArt />, carousel: <CarouselArt />, linkedin: <LinkedInArt />,
};
const VIDEO_ART = <VideoArt />;
// Each type has its own colour grade on its cover (warm gold, coral, teal, LinkedIn blue, deep violet for video).
const PALETTE_FOR_MODE: Record<CreateMode, CoverPalette> = { single: 'gold', campaign: 'coral', carousel: 'teal', linkedin: 'blue' };
// The small optional shortcuts beside the heading (calendar idea, prompts, products).
const SHORTCUT = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] font-medium border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)] hover:border-[rgb(var(--gv-accent-rgb)/0.40)] transition-colors';

const DURATIONS = ['1 week', '2 weeks', '3 weeks', '4 weeks'];
const CADENCES = ['2 posts / week', '3 posts / week', '5 posts / week', 'Daily'];
const TONES = ['Warm, unhurried', 'Confident, bold', 'Playful, kinetic', 'Luxurious, poetic', 'Professional, calm'];
const VISUAL_STYLES = ['4:5 portrait', '1:1 square', '9:16 vertical', '16:9 landscape'];
// Same list Settings/Onboarding offer, so a language picked here means the
// same thing everywhere else in the product. Popover works off the labels;
// the matching stored value ('hindi', 'tamil_english_mix', ...) is looked
// up at submit time.
const LANGUAGES = CONTENT_LANGUAGES.filter((l) => OFFERED_LANGUAGE_VALUES.includes(l.value)).map((l) => l.label);
const languageValueFromLabel = (label: string) =>
  CONTENT_LANGUAGES.find((l) => l.label === label)?.value || 'english';
const platformIcon = (key: string): React.ComponentType<{ className?: string }> =>
  ({ className }) => <PlatformIcon platform={key} className={className} />;
const PLATFORMS: Array<{ key: string; label: string; Icon: React.ComponentType<{ className?: string }>; soon?: boolean }> = [
  { key: 'instagram', label: 'Instagram', Icon: platformIcon('instagram') },
  { key: 'facebook',  label: 'Facebook',  Icon: platformIcon('facebook') },
  { key: 'x',         label: 'X',         Icon: platformIcon('x') },
  { key: 'linkedin',  label: 'LinkedIn',  Icon: platformIcon('linkedin') },
  { key: 'gmb',       label: 'Google Business', Icon: platformIcon('gmb') },
];

const MetaBox: React.FC<{
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}> = ({ label, value, Icon, onClick }) => (
  <button
    onClick={onClick}
    type="button"
    className="group relative flex items-center gap-3 h-[52px] px-3 rounded-lg border border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] hover:border-[var(--gv-border-default)] transition-colors text-left w-full"
  >
    <span className="w-7 h-7 rounded-md bg-[var(--gv-accent-fill)] flex items-center justify-center flex-shrink-0">
      <Icon className="w-3.5 h-3.5 text-[var(--gv-accent)]" />
    </span>
    <div className="flex-1 min-w-0">
      <div className="gravity-label mb-0.5">{label}</div>
      <div className="text-[13px] font-semibold text-[var(--gv-text-primary)] truncate">{value}</div>
    </div>
    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--gv-text-muted)] group-hover:text-[var(--gv-accent-text)]">
      Edit
    </span>
  </button>
);

const OptionPopover: React.FC<{
  open: boolean;
  options: string[];
  onPick: (v: string) => void;
  onClose: () => void;
  className?: string;
}> = ({ open, options, onPick, onClose, className = 'right-0' }) => {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute top-full left-0 ${className} mt-2 rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] shadow-2xl z-50 overflow-hidden`}>
        {options.map((o) => (
          <button
            key={o}
            onClick={() => { onPick(o); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-[13px] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] transition-colors"
          >
            {o}
          </button>
        ))}
      </div>
    </>
  );
};


// Native title= tooltips take 1-2s to appear and use OS styling, so these
// labels were effectively invisible. This shows on hover immediately.
const IconAction: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled = false, danger = false, children }) => (
  <div className="relative group/tip">
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`p-1.5 rounded-md text-[var(--gv-text-muted)] hover:bg-[var(--gv-surface-2)] disabled:opacity-30 transition-colors ${
        danger ? 'hover:text-red-400' : 'hover:text-[var(--gv-accent-text)]'
      }`}
    >
      {children}
    </button>
    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-[var(--gv-panel)] border border-[var(--gv-border-default)] text-[11px] text-[var(--gv-text-primary)] whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity z-30 shadow-xl">
      {label}
    </span>
  </div>
);


/**
 * A placeholder for an image that has not arrived yet.
 *
 * The backend streams posts one at a time, so exactly one is being made and
 * the rest are waiting. Previously every pending card looked identical, which
 * is why a run felt stalled: you could not tell which was actually moving.
 */
const PendingSlot: React.FC<{ position: number; active: boolean; etaSeconds: number | null; elapsed: number }>
  = ({ position, active, etaSeconds, elapsed }) => {
  const remaining = etaSeconds != null ? Math.max(0, etaSeconds - elapsed) : null;
  const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);
  return (
    <div className={`rounded-2xl border overflow-hidden flex flex-col ${
      active ? 'border-[rgb(var(--gv-accent-rgb)/0.30)] bg-[var(--gv-accent-fill)]' : 'border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)]'
    }`}>
      <div className="aspect-[4/5] flex flex-col items-center justify-center gap-3 px-6 text-center">
        {active ? (
          <>
            <Loader2 className="w-6 h-6 animate-spin text-[var(--gv-accent)]" />
            <div className="gravity-label text-[var(--gv-accent-text)]">Generating</div>
            <div className="text-[12px] text-[var(--gv-text-tertiary)] tabular-nums">
              {remaining != null
                ? `about ${fmt(remaining)} left`
                : `${fmt(elapsed)} elapsed`}
            </div>
          </>
        ) : (
          <>
            <Clock className="w-5 h-5 text-[var(--gv-text-muted)]" />
            <div className="gravity-label text-[var(--gv-text-muted)]">Queued</div>
            <div className="text-[12px] text-[var(--gv-text-muted)]">Post {position}</div>
          </>
        )}
      </div>
    </div>
  );
};

const GravityCreate: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<CreateMode>('single');
  const [name, setName] = useState('');
  // How full the design should be: calm, balanced or rich. Sent with every request.
  const [density, setDensity] = useState<'clean' | 'balanced' | 'rich'>('balanced');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('2 weeks');
  const [cadence, setCadence] = useState('3 posts / week');
  const [tone, setTone] = useState('Warm, unhurried');
  const [visualStyle, setVisualStyle] = useState('4:5 portrait');
  const [language, setLanguage] = useState('English');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram']);
  // True while the fields still hold what the plan filled in; the first edit clears the note.
  const [fromPlan, setFromPlan] = useState(false);
  // The plan's item this carousel is for; reported once when the carousel is saved so the week card shows it as made.
  const weekMark = useRef<{ itemId: string; weekId?: string } | null>(null);
  const reportMade = (ref: unknown) => {
    const m = weekMark.current;
    if (!m || !ref) return;
    weekMark.current = null;
    apiService.markWeekItemMade(m.itemId, String(ref), m.weekId).catch(() => undefined);
  };
  useEffect(() => {
    const p = takePrefill('carousel');
    if (!p) return;
    if (p.weekItemId) weekMark.current = { itemId: p.weekItemId, weekId: p.weekId };
    const topic = String(p.topic || '').trim();
    // A mode on its own (a Home tile) only picks the type; the plan's hand-over is always a carousel.
    const wanted: CreateMode | null = p.mode && (['single', 'campaign', 'carousel', 'linkedin'] as const).includes(p.mode) ? p.mode : null;
    // A Photoshoot photo ("Use in Create") is picked as the product picture of the post; only a stored https link is taken.
    const photo = p.photo && /^https:\/\//i.test(String(p.photo.imageUrl || '')) ? p.photo : null;
    if (photo) setPickedProducts([{ id: '', name: String(photo.name || 'Photoshoot photo').slice(0, 100), imageUrl: photo.imageUrl } as PickedAsset]);
    if (!topic && !p.platform && !p.language) { if (wanted) setMode(wanted); return; }
    setMode(wanted || 'carousel');
    if (topic) { setName(topic.slice(0, 80)); setDescription(topic); }
    const plat = String(p.platform || '').trim().toLowerCase();
    if (PLATFORMS.some((x) => x.key === plat && !x.soon)) setSelectedPlatforms([plat]);
    if (p.language) {
      const id = nearestLanguage(p.language, OFFERED_LANGUAGE_VALUES, '');
      const label = CONTENT_LANGUAGES.find((l) => l.value === id)?.label;
      if (label) setLanguage(label);
    }
    setFromPlan(p.source !== 'home');
  }, []);
  const [openPopover, setOpenPopover] = useState<null | 'duration' | 'cadence' | 'tone' | 'style' | 'language'>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [postsGenerated, setPostsGenerated] = useState<number>(0);
  // Bumped when a run is handed over to the list of generations below the form, so it reloads at once.
  const [galleryKey, setGalleryKey] = useState(0);
  // Once the server has the work and is making it, the form is free again: another one can be started,
  // and the finished or still-running ones are shown in the list below, not tied to this run.
  const handoff = () => {
    setSubmitting(false);
    setProgressMsg('');
    setPostsGenerated(0);
    setResults([]);
    setActioned({});
    setGalleryKey((k) => k + 1);
  };
  // Timing for the queue display: when the run began, and how long each post
  // took, so the one in flight can show a real estimate rather than a guess.
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [postDurations, setPostDurations] = useState<number[]>([]);
  const [tick, setTick] = useState(0);

  // Drives the elapsed counter while a run is in progress.
  useEffect(() => {
    if (!submitting) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [submitting]);

  // Results stay on this page instead of bouncing to /drafts. The image is
  // produced by a background worker, so we poll the draft(s) until the
  // artwork lands, then offer keep / publish / schedule inline.
  const [results, setResults] = useState<Draft[]>([]);
  const [actioned, setActioned] = useState<Record<string, 'draft' | 'approved' | 'scheduled'>>({});
  const [actionBusy, setActionBusy] = useState<string>('');
  const [scheduleFor, setScheduleFor] = useState<string>('');
  const [schedulingId, setSchedulingId] = useState<string>('');
  const pollRef = useRef<any>(null);
  const runStartRef = useRef<number | null>(null);

  // Brand logo choice, pulled from Brand Assets. Applied AFTER the image is
  // generated — handing a logo to an image model gets it redrawn and smeared.
  const [logos, setLogos] = useState<Array<{ id: string; url: string; name: string; defaultPosition: LogoGridPosition }>>([]);
  const [logoPosition, setLogoPosition] = useState<LogoGridPosition>(DEFAULT_LOGO_POSITION);
  const [selectedLogo, setSelectedLogo] = useState<string>('');
  // The look of the post: style, exact text, a picture to copy, saved header and footer.
  const [design, setDesign] = useState<PostDesign>(DEFAULT_DESIGN);
  const [captionBusy, setCaptionBusy] = useState<string>('');
  const [editingCaption, setEditingCaption] = useState<string>('');
  const [captionDraft, setCaptionDraft] = useState<string>('');

  // Browsing planned ideas is deliberately unrelated to autoGenerate: that
  // flag controls unattended background generation, not whether a person may
  // look at ideas they already planned.
  const [ideaPickerOpen, setIdeaPickerOpen] = useState(false);
  const [promptStudioOpen, setPromptStudioOpen] = useState(false);
  // Products or services this creative should feature. Multiple, because a
  // bundle or a range is one post, not several.
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [pickedProducts, setPickedProducts] = useState<PickedAsset[]>([]);
  // Carousel length. Below three there is no story to tell; above ten the
  // platforms stop showing every slide anyway.
  const [slideCount, setSlideCount] = useState(5);
  const [pickedIdea, setPickedIdea] = useState<string>('');

  const [ideaContext, setIdeaContext] = useState<{ contentPillar: string; objective: string; format: string }>({
    contentPillar: '', objective: '', format: ''
  });

  // What was read from a dropped file goes into the idea and the optional fields. Only empty boxes are filled, so
  // nothing the person typed is replaced, and they can change everything.
  const applyReadFiles = (uploads: ReadUpload[]) => {
    for (const u of uploads) {
      if (u.brief) setDescription((d) => appendText(d, u.brief));
      if (!name.trim() && (u.details?.headline || u.name)) setName((n) => n.trim() || String(u.details?.headline || '').slice(0, 80));
      setDesign((d) => ({ ...d, details: mergeDetails(d.details as any, u.details as any) as any }));
    }
  };

  const applyCalendarItem = (item: any) => {
    setName(item.headline || '');
    setDescription(item.creativeConcept || item.headline || '');
    setPickedIdea(item.headline || '');
    // Carried into the content-writing prompt so it knows which pillar and
    // objective this idea came from, rather than guessing from the brief alone.
    setIdeaContext({
      contentPillar: item.contentPillar || '',
      objective: item.objective || '',
      format: item.format || ''
    });
  };

  useEffect(() => {
    (async () => {
      try {
        const res: any = await brandAssetsAPI.getLogos();
        const list = (res?.assets || res?.logos || res?.data || [])
          .map((a: any) => ({
            id: String(a._id || a.id || a.url),
            url: a.url || a.imageUrl || '',
            name: a.name || 'Logo',
            defaultPosition: logoPositionFor(a.defaultPosition)
          }))
          .filter((a: any) => a.url);
        setLogos(list);
        const primary = (res?.assets || res?.logos || []).find((a: any) => a.isPrimary);
        if (primary?.url) {
          setSelectedLogo(primary.url);
          setLogoPosition(logoPositionFor(primary.defaultPosition));
        }
      } catch { /* no logos configured — picker just stays empty */ }
    })();
  }, []);

  const setAspect = (key: string) => {
    const match = VISUAL_STYLES.find((v) => v.startsWith(key));
    if (match) setVisualStyle(match);
  };

  const stillRendering = results.some((d) => String(d?.status || '').toLowerCase() === 'processing');

  // Poll while any result is still rendering. Cleared as soon as everything
  // has an image (or failed), so we are not hammering the API forever.
  useEffect(() => {
    if (!results.length || !stillRendering) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const refreshed = await Promise.all(
          results.map(async (d) => {
            if (String(d?.status || '').toLowerCase() !== 'processing') return d;
            try {
              const res = await draftsAPI.getDraft(d._id);
              let next: any = res?.draft || d;
              // Artwork just landed — stamp the chosen logo on now that
              // there is something to stamp it onto.
              const img = next?.imageUrl || next?.creative?.imageUrls?.[0];
              if (selectedLogo && img && !next.logoApplied) {
                try {
                  const applied = await draftsAPI.applyLogo(next._id, selectedLogo, { position: logoPosition });
                  if (applied?.draft) next = applied.draft;
                } catch { /* keep the unbranded image rather than losing it */ }
              }
              return next;
            } catch { return d; }
          })
        );
        setResults(refreshed);
      } catch { /* transient — next tick retries */ }
    }, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [results, stillRendering]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const draftImage = (d: any): string =>
    d?.imageUrl || d?.creative?.imageUrls?.[0] || d?.images?.[0] || '';

  // Keep as draft — the record already exists as a draft the moment it is
  // generated, so this only needs to acknowledge and clear it from view.
  const keepAsDraft = (d: Draft) => {
    setActioned((prev) => ({ ...prev, [d._id]: 'draft' }));
  };

  const approveNow = async (d: Draft) => {
    setActionBusy(d._id);
    setError(null);
    try {
      await draftsAPI.publishDraft(d._id, selectedPlatforms);
      setActioned((prev) => ({ ...prev, [d._id]: 'approved' }));
    } catch (e: any) {
      setError(e?.message || 'This post could not be published.');
    } finally {
      setActionBusy('');
    }
  };

  // Writes a caption for the poster that was actually produced, rather than
  // echoing the user's prompt back at them.
  const generateCaption = async (d: any) => {
    const img = draftImage(d);
    if (!img) return;
    setCaptionBusy(d._id);
    setError(null);
    try {
      const res: any = await apiService.generateCaptionFromImage(img, selectedPlatforms[0] || 'instagram');
      const next = res?.caption || res?.data?.caption || '';
      if (!next) throw new Error('No caption was returned. Please try again.');
      await draftsAPI.updateDraft(d._id, { caption: next });
      setResults((prev) => prev.map((x: any) => x._id === d._id ? { ...x, caption: next } : x));
    } catch (e: any) {
      setError(e?.message || 'A caption could not be written.');
    } finally {
      setCaptionBusy('');
    }
  };

  const saveCaption = async (d: Draft) => {
    setCaptionBusy(d._id);
    try {
      await draftsAPI.updateDraft(d._id, { caption: captionDraft });
      setResults((prev) => prev.map((x: any) => x._id === d._id ? { ...x, caption: captionDraft } : x));
      setEditingCaption('');
    } catch (e: any) {
      setError(e?.message || 'The caption could not be saved.');
    } finally {
      setCaptionBusy('');
    }
  };

  // Prompt inspector: shows the exact text that produced this image, so a weak
  // result can be diagnosed and re-run without leaving the card.
  const [promptOpenFor, setPromptOpenFor] = useState<string>('');
  const [promptDraft, setPromptDraft] = useState<string>('');
  const [promptCopied, setPromptCopied] = useState(false);

  const openPrompt = (d: Draft) => {
    setPromptOpenFor(d._id);
    setPromptDraft(d.imagePromptResolved || d.imagePrompt || '');
    setPromptCopied(false);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptDraft);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };

  const resetPrompt = (d: Draft) => {
    setPromptDraft(d.imagePromptResolved || d.imagePrompt || '');
  };

  // Regenerate re-runs the full generation pipeline, so it costs the same
  // Quarks as the original — campaign-type drafts are billed through the
  // legacy Campaigns flow already (matches backend/routes/drafts.js).
  const regenerateCostFor = (d: Draft) => (d.contentType === 'campaign' ? 0 : (quarkCosts.image_generated || 0));
  const confirmRegenerate = (d: Draft) => {
    const cost = regenerateCostFor(d);
    const hasImage = !!((d as any)?.imageUrl || (d as any)?.creative?.imageUrls?.[0]);
    const msg = cost > 0
      ? `This costs ${priceWithWorth(cost, quarkCosts)} and ${hasImage ? 'replaces the current image.' : 'adds an image to this post.'}`
      : hasImage ? 'This replaces the current image.' : 'This adds an image to this post.';
    const title = hasImage ? 'Regenerate this image?' : 'Add an image?';
    const confirmLabel = hasImage ? 'Regenerate' : 'Add';
    return confirmDialog(msg, { title, confirmLabel });
  };

  const regenerateWithPrompt = async (d: Draft) => {
    if (!(await confirmRegenerate(d))) return;
    setActionBusy(d._id);
    setError(null);
    try {
      // Send the edited text as a raw override — the image model uses it
      // verbatim, skipping the content-writing and Creative Director passes
      // that would otherwise reinterpret it into something else.
      await draftsAPI.retryImageGeneration(d._id, promptDraft);
      setResults((prev) => prev.map((x: any) =>
        x._id === d._id ? { ...x, status: 'processing', imageUrl: '', imagePromptResolved: promptDraft } : x));
      setPromptOpenFor('');
    } catch (e: any) {
      setError(e?.message || 'The image could not be regenerated.');
    } finally {
      setActionBusy('');
    }
  };

  const regenerateImage = async (d: Draft) => {
    if (!(await confirmRegenerate(d))) return;
    setActionBusy(d._id);
    setError(null);
    try {
      await draftsAPI.retryImageGeneration(d._id);
      setResults((prev) => prev.map((x: any) => x._id === d._id ? { ...x, status: 'processing', imageUrl: '' } : x));
    } catch (e: any) {
      setError(e?.message || 'The image could not be regenerated.');
    } finally {
      setActionBusy('');
    }
  };

  // Targeted fix — keep the existing image, change only what the instruction
  // describes. Separate from Regenerate, which redraws the whole thing.
  const [editImageFor, setEditImageFor] = useState<string>('');
  const [editImageInstruction, setEditImageInstruction] = useState<string>('');
  const [editImageBusy, setEditImageBusy] = useState<string>('');

  const openEditImage = (d: Draft) => {
    setEditImageFor(d._id);
    setEditImageInstruction('');
  };

  const applyImageEdit = async (d: Draft) => {
    if (!editImageInstruction.trim()) return;
    setEditImageBusy(d._id);
    setError(null);
    try {
      const res = await draftsAPI.editImage(d._id, editImageInstruction.trim());
      setResults((prev) => prev.map((x: any) => x._id === d._id ? { ...x, imageUrl: res.draft.imageUrl, imagePromptResolved: res.draft.imagePromptResolved } : x));
      setEditImageFor('');
      setEditImageInstruction('');
    } catch (e: any) {
      setError(e?.message || 'That edit could not be applied.');
    } finally {
      setEditImageBusy('');
    }
  };

  const discard = async (d: Draft) => {
    setActionBusy(d._id);
    try {
      await draftsAPI.deleteDraft(d._id);
    } catch { /* already gone — drop it from view regardless */ }
    setResults((prev) => prev.filter((x: any) => x._id !== d._id));
    setActionBusy('');
  };

  // "Send all to approval" — publishes every card that hasn't been actioned.
  const sendAllToApproval = async () => {
    const pending = results.filter((d: any) => !actioned[d._id] && draftImage(d));
    if (!pending.length) return;
    setActionBusy('all');
    setError(null);
    const done: Record<string, 'approved'> = {};
    for (const d of pending) {
      try {
        await draftsAPI.publishDraft(d._id, selectedPlatforms);
        done[d._id] = 'approved';
      } catch { /* keep going; the rest can still go out */ }
    }
    setActioned((prev) => ({ ...prev, ...done }));
    const failed = pending.length - Object.keys(done).length;
    if (failed > 0) setError(`${failed} of ${pending.length} posts could not be published.`);
    setActionBusy('');
  };

  const scheduleNow = async (d: Draft) => {
    if (!scheduleFor) { setError('Choose a date and time first.'); return; }
    setActionBusy(d._id);
    setError(null);
    try {
      // The backend creates the Campaign behind this draft, which is what the
      // publishing scheduler actually picks up.
      await draftsAPI.scheduleDraft(d._id, new Date(scheduleFor).toISOString());
      setActioned((prev) => ({ ...prev, [d._id]: 'scheduled' }));
      setSchedulingId('');
      setScheduleFor('');
    } catch (e: any) {
      setError(e?.message || 'This post could not be scheduled.');
    } finally {
      setActionBusy('');
    }
  };

  const togglePlatform = (key: string) =>
    setSelectedPlatforms((prev) => prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]);

  // Post count estimate (matches prototype text "~6 posts · 2 per week")
  const quarkCosts = useQuarkCosts();
  const confirmDialog = useConfirm();
  // Campaign charges per post, carousel charges per slide — both scale with
  // how much is actually generated, matching how the backend deducts each.
  // Single post is the one true flat rate: it always makes exactly one image.
  const currentActionCost = quarkCosts[actionCostKey(mode)] || 0;

  const estimate = useMemo(() => {
    const weeks = parseInt(duration, 10) || 1;
    const perWeek = parseInt(cadence, 10) || 1;
    return { total: weeks * perWeek, perWeek };
  }, [duration, cadence]);

  const currentActionTotal =
    mode === 'campaign' ? currentActionCost * estimate.total
    : mode === 'carousel' ? currentActionCost * slideCount
    : currentActionCost;

  // Map friendly duration/aspect labels to backend enum values used by
  // /generate-campaign-stream.
  const backendDuration = useMemo(() => {
    const map: Record<string, string> = {
      '1 week': '1week',
      '2 weeks': '2weeks',
      '3 weeks': '3weeks',
      '4 weeks': '4weeks',
    };
    return map[duration] || '1week';
  }, [duration]);

  const backendAspect = useMemo(() => {
    if (visualStyle.startsWith('1:1')) return '1:1';
    if (visualStyle.startsWith('9:16')) return '9:16';
    if (visualStyle.startsWith('16:9')) return '16:9';
    return '4:5';
  }, [visualStyle]);

  // Single-post mode — use draftsAPI.generateImageBg which:
  //   1. Creates a Draft record with status='processing'
  //   2. Enqueues the background worker to generate the image via
  //      Nano Banana + save the Cloudinary URL back to the draft.
  // The result is then polled and shown on THIS page — keeping, approving
  // and scheduling all happen here rather than over in /drafts.
  const handleDraftSinglePost = async () => {
    setProgressMsg('Starting image generation…');
    const res: any = await draftsAPI.generateImageBg({
      type: 'post',
      title: name.trim() || 'Untitled post',
      density,
      caption: description.trim() || name.trim() || '',
      hashtags: [],
      platforms: selectedPlatforms,
      prompt: description.trim() || name.trim() || 'A cinematic marketing poster',
      aspectRatio: backendAspect,
      linkedProduct: primaryProduct,
      productReferenceImages: productImageUrls,
      contentPillar: ideaContext.contentPillar,
      contentType: ideaContext.format || 'post',
      objective: ideaContext.objective,
      language: languageValueFromLabel(language),
      // Generation composites the logo itself now — this used to be
      // handled entirely by the poll loop below, which meant the backend's
      // own automatic primary-logo composite AND this one both ran,
      // producing a visibly doubled logo once both started targeting the
      // same corner. Sending the actual choice here (including '' for "No
      // logo") lets generation do it once, correctly, in one pass.
      logoUrl: selectedLogo,
      logoPosition: selectedLogo ? logoPosition : undefined,
      ...designRequestFields(design),
    });
    // The picture is made in the background; the list below shows it and keeps the form free.
    handoff();
    return true;
  };

  // LinkedIn mode — long-form text post. No image call at generation time;
  // the caption/hashtags come back immediately and an image, if wanted, is
  // generated afterwards via the "Add image" button on the result card.
  const handleDraftLinkedInPost = async () => {
    setProgressMsg('Writing your LinkedIn post…');
    const res = await draftsAPI.generateLinkedInPost({
      idea: description.trim() || name.trim(),
      contentPillar: ideaContext.contentPillar,
      objective: ideaContext.objective,
      tone,
      language: languageValueFromLabel(language)
    });
    if (!res.success) {
      throw new Error(res.message || 'The LinkedIn post could not be generated.');
    }
    // The post is already generated and already charged for by this point —
    // if saving it fails, the text must not just vanish. Surface it in the
    // error so the user can copy it before retrying.
    try {
      const saved = await draftsAPI.saveDraft({
        title: name.trim() || 'Untitled LinkedIn post',
        caption: res.caption,
        hashtags: res.hashtags,
        platforms: ['linkedin'],
        sourceType: 'post',
        contentType: 'post',
        imageUrl: '',
        imagePrompt: res.imageDescription || ''
      });
      setResults([saved.draft]);
      setPostsGenerated(1);
    } catch (saveErr: any) {
      throw new Error(
        `The post was generated but could not be saved. Copy it before you try again: ${res.caption}`
      );
    }
  };

  // Carousel mode — one post told across several slides.
  //
  // The backend plans the whole arc first, then renders slides one at a time
  // over SSE, so the shared look is decided once and every slide inherits it.
  // Slides appear as they land rather than all at the end.
  const handleDraftCarousel = async () => {
    const token = getToken();
    if (!token) throw new Error('Please log in again.');

    let detached = false;
    runStartRef.current = Date.now();
    setRunStartedAt(Date.now());
    setPostDurations([]);
    setProgressMsg('Planning the carousel…');
    try {

    const response = await fetch(`${API_BASE}/carousels/generate-stream`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: name.trim(),
          density,
        brief: description.trim() || name.trim(),
        slideCount,
        platforms: selectedPlatforms,
        tone: (tone.split(',')[0] || 'professional').toLowerCase(),
        language: languageValueFromLabel(language),
        aspectRatio: backendAspect,
        linkedProduct: primaryProduct,
        productReferenceImages: productImageUrls,
        logoPosition: selectedLogo ? logoPosition : undefined,
        contentPillar: ideaContext.contentPillar,
        contentType: 'carousel',
        objective: ideaContext.objective,
        ...designRequestFields(design),
      }),
    });
    if (!response.ok) throw new Error(`The server returned an error (${response.status}).`);
    if (!response.body) throw new Error('The server did not send a response.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let complete = false;
    let landed = 0;
    // Set from an 'error' SSE event and thrown after the loop. Throwing it
    // immediately, inline, landed inside the same try that parses each SSE
    // line — whose catch exists only to skip a malformed line — so the
    // backend's actual reason ("Could not plan the carousel...") was
    // silently discarded and replaced by the generic fallback below.
    let serverError = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'status' || currentEvent === 'generating') {
              if (!detached) setProgressMsg(data.message || 'Generating the images…');
            } else if (currentEvent === 'plan') {
              // The carousel is saved and is being drawn; carry on in the list below.
              detached = true;
              reportMade(data.draftId || data.carouselDraftId || data.campaignId);
              handoff();
            } else if (currentEvent === 'slide') {
              landed += 1;
              reportMade(data.draftId);
              if (detached) continue;
              setPostDurations((prev) => {
                const startedAt = runStartRef.current ?? Date.now();
                const priorTotal = prev.reduce((a, b) => a + b, 0);
                const thisOne = Math.max(1, Math.round((Date.now() - startedAt) / 1000) - priorTotal);
                return [...prev, thisOne];
              });
              setPostsGenerated(landed);
              // Each slide is shown as its own card so progress is visible,
              // but they are all one draft — hence the synthetic id, and the
              // per-card actions being hidden for them.
              setResults((prev: any[]) => [...prev, {
                _id: `${data.draftId}::${data.order}`,
                carouselDraftId: data.draftId,
                isCarouselSlide: true,
                slideLabel: `Slide ${data.order}${data.role ? ' · ' + data.role : ''}`,
                title: data.headline || `Slide ${data.order}`,
                caption: data.headline || '',
                imageUrl: data.imageUrl || '',
                status: data.imageUrl ? 'draft' : 'failed',
                aspectRatio: backendAspect,
                platforms: selectedPlatforms,
              }]);
            } else if (currentEvent === 'complete') {
              complete = true;
            } else if (currentEvent === 'error') {
              serverError = data?.message || 'Generation failed. Please try again.';
            }
          } catch (parseErr) {
            // Ignore malformed lines
          }
        }
      }
    }

    if (detached) return true;
    if (serverError) throw new Error(serverError);
    if (!complete && landed === 0) throw new Error('Generation finished without creating any slides.');
    setProgressMsg('');
    } catch (e) {
      // After the hand-over the server carries on by itself; a dropped connection is not an error then.
      if (detached) return true;
      throw e;
    }
    return false;
  };

  // Campaign mode — real AI generation via the streaming endpoint used
  // by the legacy Campaigns page. Streams posts as they're generated,
  // updates progress, then lands in Approve when done.
  const handleDraftCampaign = async () => {
    const token = getToken();
    if (!token) throw new Error('Please log in again.');

    const body = {
      campaignName: name.trim(),
      density,
      campaignDescription: description.trim() || name.trim(),
      objective: ideaContext.objective || 'awareness',
      platforms: selectedPlatforms,
      tone: (tone.split(',')[0] || 'professional').toLowerCase(),
      language: languageValueFromLabel(language),
      aspectRatio: backendAspect,
      logoPosition: selectedLogo ? logoPosition : undefined,
      ...designRequestFields(design),
      // No keyMessages. The brief already travels as campaignDescription
      // above; sending it here as well presented it to the model as a
      // MANDATORY CONTENT STRUCTURE — a template to reproduce exactly, under
      // rules forbidding any change or added commentary. The model obeyed,
      // and captions came back as the brief typed verbatim. This field is for
      // real content templates, which Create does not collect.
      duration: backendDuration,
      // Without this the backend fell back to three hardcoded days and then
      // multiplied by the platform count, so the cadence picker did nothing
      // and every run produced (and charged for) far more posts than shown.
      postsPerWeek: estimate.perWeek,
      startDate: new Date().toISOString().split('T')[0],
      preferredDays: [],
      targetAge: '18-35',
      targetGender: 'all',
      targetLocation: '',
      targetInterests: '',
      productLogo: null,
      // The first selection anchors the copy (name, price, description); the
      // rest ride along as extra reference images so every chosen item
      // actually appears in the creative.
      linkedProduct: primaryProduct,
      productReferenceImages: productImageUrls,
    };

    let detached = false;
    runStartRef.current = Date.now();
    setRunStartedAt(Date.now());
    setPostDurations([]);
    setProgressMsg('Starting campaign generation…');
    try {
    const response = await fetch(`${API_BASE}/campaigns/generate-campaign-stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`The server returned an error (${response.status}).`);
    if (!response.body) throw new Error('The server did not send a response.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    let complete = false;
    let postCount = 0;
    // Same reasoning as the carousel loop: captured here and thrown after
    // the loop, not inline, so it survives the surrounding catch instead of
    // being treated as a malformed line and discarded.
    let serverError = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'status' || currentEvent === 'generating') {
              if (!detached) setProgressMsg(data.message || 'Generating the posts…');
            } else if (currentEvent === 'post') {
              postCount += 1;
              // The first post is saved: from here the list below follows the rest.
              if (!detached) { detached = true; handoff(); }
              continue;
              // How long this one took, for estimating the next.
              setPostDurations((prev) => {
                const startedAt = runStartRef.current ?? Date.now();
                const priorTotal = prev.reduce((a, b) => a + b, 0);
                const thisOne = Math.max(1, Math.round((Date.now() - startedAt) / 1000) - priorTotal);
                return [...prev, thisOne];
              });
              setPostsGenerated(postCount);
              setProgressMsg(`${postCount} post${postCount > 1 ? 's' : ''} created so far…`);
              // Render each post the moment it lands. The payload already
              // carries the finished image; this used to be counted and
              // thrown away, so nothing appeared until the whole run ended.
              // The getDrafts() refresh below then swaps these for the saved
              // records (real status, scheduling, etc).
              if (data?.draftId) {
                setResults((prev: any[]) => (
                  prev.some((p) => p?._id === data.draftId)
                    ? prev
                    : [...prev, {
                      _id: data.draftId,
                      title: data.contentTheme || `Post ${postCount}`,
                      caption: data.caption || '',
                      imageUrl: data.imageUrl || '',
                      // No image means Nano Banana failed for this slot —
                      // surface it as failed so the card offers Regenerate.
                      status: data.imageUrl ? 'draft' : 'failed',
                      aspectRatio: backendAspect,
                      platforms: data.platform ? [data.platform] : selectedPlatforms,
                    }]
                ));
              }
            } else if (currentEvent === 'complete') {
              complete = true;
            } else if (currentEvent === 'error') {
              serverError = data?.message || 'Generation failed. Please try again.';
            }
          } catch (parseErr) {
            // Ignore malformed lines
          }
        }
      }
    }
    if (detached) return true;
    if (serverError) throw new Error(serverError);
    if (!complete && postCount === 0) {
      throw new Error('Generation finished without creating any posts.');
    }

    // Same as single-post mode: show what was produced here rather than
    // sending the user off to /drafts. Pull the freshly-created drafts so
    // each one can be kept, approved or scheduled inline.
    setProgressMsg('Loading your new posts…');
    try {
      const res = await draftsAPI.getDrafts();
      const fresh = (res?.drafts || [])
        .filter((d: any) => !['published', 'posted', 'scheduled', 'rejected'].includes(String(d?.status || '').toLowerCase()))
        .slice(0, postCount || 12);
      setResults(fresh);
      setActioned({});
    } catch {
      // If the fetch fails the posts still exist — fall back to Approve.
      navigate('/drafts');
      return false;
    }
    setProgressMsg('');
    } catch (e) {
      if (detached) return true;
      throw e;
    }
    return false;
  };

  const handleDraft = async () => {
    if (!name.trim()) { setError('Enter a name first.'); return; }
    // LinkedIn mode hides the platform picker entirely — platform is
    // implicit — so this check would otherwise leave the user stuck with no
    // way to fix it on this tab if selectedPlatforms happened to be empty.
    if (mode !== 'linkedin' && selectedPlatforms.length === 0) { setError('Choose at least one platform.'); return; }
    setError(null);
    setSubmitting(true);
    setPostsGenerated(0);
    setProgressMsg('');
    // Posts now stream in as they finish, so clear the previous run's cards
    // or the new ones would append underneath them.
    setResults([]);
    setActioned({});
    let handedOver = false;
    try {
      if (mode === 'carousel') {
        handedOver = Boolean(await handleDraftCarousel());
      } else if (mode === 'single') {
        handedOver = Boolean(await handleDraftSinglePost());
      } else if (mode === 'linkedin') {
        await handleDraftLinkedInPost();
      } else {
        handedOver = Boolean(await handleDraftCampaign());
      }
    } catch (e: any) {
      setError(e?.message || 'The content could not be created. Please try again.');
    } finally {
      // A handed-over run already freed the form; do not touch a newer run's state.
      if (!handedOver) setSubmitting(false);
    }
  };

  // Handle Cmd/Ctrl+Enter to launch (matches prototype's "⌘↵ to launch")
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !submitting) handleDraft();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, name, description, duration, cadence, tone, visualStyle, selectedPlatforms]);

  // While a request is in flight there is no draft record yet, so show
  // placeholder cards in the grid straight away. They animate in place and
  // are swapped for the real drafts the moment those come back.
  // Shapes the selection into what each backend expects: one linked product
  // for the copy, and every image for the visual references.
  const primaryProduct = pickedProducts.length
    ? {
      _id: pickedProducts[0].id || undefined,
      name: pickedProducts[0].name,
      description: pickedProducts[0].description || '',
      imageUrl: pickedProducts[0].imageUrl
    }
    : null;
  const productImageUrls = pickedProducts.map((p) => p.imageUrl).filter(Boolean);

  // How many cards this run will produce, whichever mode is active.
  const expectedCount = mode === 'campaign' ? estimate.total : mode === 'carousel' ? slideCount : mode === 'linkedin' ? 1 : 1;

  const pendingCards = submitting && results.length === 0
    ? Array.from({ length: Math.min(expectedCount, 4) })
    : [];

  // Posts now stream in one at a time, so once the first card lands the grid
  // takes over from the placeholder screen. Keep the remaining slots animating
  // inside that grid — otherwise the generating animation would vanish the
  // moment the first image arrived, with more still on the way.
  const remainingCards = submitting && results.length > 0
    ? Array.from({
      length: Math.max(0, expectedCount - results.length)
    })
    : [];

  // Estimate from this run's own completed posts rather than a fixed guess,
  // so it reflects how the model is actually performing right now.
  const avgPostSeconds = postDurations.length
    ? Math.round(postDurations.reduce((a, b) => a + b, 0) / postDurations.length)
    : null;
  // `tick` is read so the counter re-renders every second.
  const elapsedOnCurrent = (() => {
    void tick;
    if (!runStartedAt) return 0;
    const spentOnFinished = postDurations.reduce((a, b) => a + b, 0);
    return Math.max(0, Math.round((Date.now() - runStartedAt) / 1000) - spentOnFinished);
  })();

  return (
    <div className="max-w-[960px] mx-auto pb-24">
      {/* What to make: six cover tiles in two rows of three (three rows of two on a phone), all the same height, Video
          first and Photoshoot second, each a small poster with a sample photo (the drawn art until the photo has loaded,
          or if its file is missing). The four modes only set the mode; Video and Photoshoot are made on their own pages,
          so their tiles open those pages. The tile text is the only description of each kind. */}
      <div className="mt-1 mb-8">
        <div className="nb-cover-grid" role="group" aria-label="What do you want to create?">
          <CoverTile
            title={VIDEO_ENTRY.title}
            subtitle={VIDEO_ENTRY.subtitle}
            price={videoEntryCost(quarkCosts) || undefined}
            palette="ink"
            art={VIDEO_ART}
            image={createPhoto('video')}
            overlay="play"
            to={VIDEO_ENTRY.to}
          />
          <CoverTile
            title={PHOTOSHOOT_ENTRY.title}
            subtitle={PHOTOSHOOT_ENTRY.subtitle}
            price={photoshootEntryCost(quarkCosts) || undefined}
            palette="plum"
            art={<PhotoshootArt />}
            image={createPhoto('photoshoot')}
            to={PHOTOSHOOT_ENTRY.to}
          />
          {CREATE_TILES.map((t) => (
            <CoverTile
              key={t.key}
              title={t.title}
              subtitle={t.subtitle}
              price={createTileCost(t.key, quarkCosts) || undefined}
              palette={PALETTE_FOR_MODE[t.key]}
              art={ART_FOR_MODE[t.key]}
              image={createPhoto(t.key)}
              overlay={t.key === 'carousel' ? 'slides' : undefined}
              selected={mode === t.key}
              onClick={() => setMode(t.key)}
            />
          ))}
        </div>
      </div>

      {/* The brief: a small heading with the optional shortcuts beside it, then the idea box. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-2.5">
        {/* A section heading: the page title is the shared page header above the tab bar (App.tsx). */}
        <h2 className="font-serif-display text-[22px] leading-tight tracking-[-0.01em] text-[var(--gv-text-primary)]">
          Describe your <GravityEmphasis>{mode === 'campaign' ? 'campaign' : mode === 'carousel' ? 'carousel' : 'post'}</GravityEmphasis>
        </h2>
        {/* Ideas already planned in the calendar, the prompts and products: small shortcuts, the brief is the point of this screen. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setIdeaPickerOpen(true)} className={SHORTCUT}>
            <CalendarIcon className="w-3.5 h-3.5 text-[var(--gv-accent)]" aria-hidden="true" />
            Choose an idea from your calendar
          </button>
          <button type="button" onClick={() => setPromptStudioOpen(true)} className={SHORTCUT}>
            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--gv-accent)]" aria-hidden="true" />
            Edit the prompts
          </button>
          <button type="button" onClick={() => setAssetPickerOpen(true)} className={SHORTCUT}>
            <Package className="w-3.5 h-3.5 text-[var(--gv-accent)]" aria-hidden="true" />
            {pickedProducts.length === 0
              ? 'Feature a product or service'
              : `${pickedProducts.length} product${pickedProducts.length > 1 ? 's' : ''} selected`}
          </button>
        </div>
      </div>
      {pickedIdea && (
        <p className="mb-2 text-[12px] text-[var(--gv-text-tertiary)]">
          Loaded: <span className="text-[var(--gv-accent-text)]">{pickedIdea}</span>
        </p>
      )}

      <CalendarIdeaPicker
        open={ideaPickerOpen}
        onClose={() => setIdeaPickerOpen(false)}
        onPick={applyCalendarItem}
        type={mode === 'single' ? 'post' : undefined}
      />

      <AssetPicker
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        source="products"
        selected={pickedProducts}
        onChange={setPickedProducts}
      />

      <PromptStudio
        open={promptStudioOpen}
        onClose={() => setPromptStudioOpen(false)}
        focus={mode === 'campaign' ? 'campaign.content' : mode === 'carousel' ? 'carousel.content' : mode === 'linkedin' ? 'linkedin.content' : 'single.content'}
      />

      {/* The idea box: styled like the other text boxes on Create and Videos (soft border, same radius); it turns gold while you type. */}
      <div className="rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] px-4 pt-3.5 pb-3 transition-[border-color,box-shadow] focus-within:border-[var(--gv-accent)] focus-within:shadow-[0_0_0_3px_rgb(var(--gv-accent-rgb)/0.10)]">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="gravity-label text-[var(--gv-accent-text)]">{mode === 'campaign' ? 'Campaign' : mode === 'linkedin' ? 'LinkedIn post' : 'Post'}</span>
            <input
              value={name}
              aria-label="Name"
              onChange={(e) => { setName(e.target.value); setFromPlan(false); }}
              placeholder={mode === 'campaign' ? 'Monsoon menu launch' : mode === 'linkedin' ? '500 customers milestone' : 'Sunday pour-over ritual'}
              className="gravity-bare flex-1 bg-transparent border-none outline-none text-[15px] font-semibold text-[var(--gv-text-primary)] placeholder:text-[var(--gv-text-muted)]"
            />
          </div>
          <textarea
            value={description}
            aria-label="Describe your idea"
            onChange={(e) => { setDescription(e.target.value); setFromPlan(false); }}
            placeholder={mode === 'campaign'
              ? 'For example: Launch our monsoon menu over two weeks. Introduce the dishes first, then reveal the menu, then invite customers to the Saturday launch event.'
              : mode === 'linkedin'
                ? 'For example: We have reached 500 customers. Here is what it took to get there.'
                : 'For example: A quiet Sunday morning with filter coffee. Invite people to spend the morning with us.'}
            rows={mode === 'linkedin' ? 6 : 3}
            className="gravity-bare w-full bg-transparent border-none outline-none text-[14px] text-[var(--gv-text-secondary)] leading-relaxed resize-none placeholder:text-[var(--gv-text-muted)]"
          />
          <IdeaBoxTools
            languageLabel={language}
            onText={(t) => setDescription((d) => appendText(d, t))}
            onRead={(ups) => applyReadFiles(ups)}
            onReuse={(u) => applyReadFiles([u])}
          />
          {fromPlan && <p className="mt-2 text-[12px] text-[var(--gv-text-tertiary)]">Filled in from your plan. Change anything you like.</p>}
      </div>

      {/* The options, in small labelled groups on a few even rows. No big panels. */}
      <div className="mt-4 space-y-4">
        {/* How many slides. A carousel's length changes the shape of the story,
            so it is picked before the brief is sent, not afterwards. */}
        {mode === 'carousel' && (
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Number of slides">
            <span className="gravity-label text-[var(--gv-text-muted)] mr-2">Slides</span>
            {[3, 4, 5, 6, 7, 8, 10].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={slideCount === n}
                onClick={() => setSlideCount(n)}
                className={`h-8 w-8 rounded-full text-[12.5px] font-semibold transition-colors ${
                  slideCount === n
                    ? 'bg-[var(--gv-accent)] text-[#1A1208]'
                    : 'text-[var(--gv-text-tertiary)] border border-[var(--gv-border-default)] bg-[var(--gv-panel)] hover:text-[var(--gv-text-primary)]'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        {/* Campaign settings: campaign mode only. */}
        {mode === 'campaign' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="relative">
              <MetaBox label="Duration" value={duration} Icon={CalendarIcon} onClick={() => setOpenPopover(openPopover === 'duration' ? null : 'duration')} />
              <OptionPopover open={openPopover === 'duration'} options={DURATIONS} onPick={setDuration} onClose={() => setOpenPopover(null)} />
            </div>
            <div className="relative">
              <MetaBox label="Cadence" value={cadence} Icon={Layers} onClick={() => setOpenPopover(openPopover === 'cadence' ? null : 'cadence')} />
              <OptionPopover open={openPopover === 'cadence'} options={CADENCES} onPick={setCadence} onClose={() => setOpenPopover(null)} />
            </div>
            <div className="relative">
              <MetaBox label="Tone" value={tone} Icon={Sparkles} onClick={() => setOpenPopover(openPopover === 'tone' ? null : 'tone')} />
              <OptionPopover open={openPopover === 'tone'} options={TONES} onPick={setTone} onClose={() => setOpenPopover(null)} />
            </div>
            <div className="relative">
              <MetaBox label="Visual style" value={visualStyle} Icon={ImageIcon} onClick={() => setOpenPopover(openPopover === 'style' ? null : 'style')} />
              <OptionPopover open={openPopover === 'style'} options={VISUAL_STYLES} onPick={setVisualStyle} onClose={() => setOpenPopover(null)} />
            </div>
          </div>
        )}

        {/* Language, platforms, shape, logo and look: small picture tiles of one height, in one row that wraps
            (onto a few lines on a phone). Platforms, shape and logo are not in LinkedIn mode, which has no image step. */}
        <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
          {/* Every mode: a single post or a carousel is just as often made in a regional language. */}
          <OptionGroup label="Language">
            <div className="relative">
              <LanguageTile value={language} open={openPopover === 'language'} onToggle={() => setOpenPopover(openPopover === 'language' ? null : 'language')} />
              <OptionPopover open={openPopover === 'language'} options={LANGUAGES} onPick={setLanguage} onClose={() => setOpenPopover(null)} className="min-w-[220px]" />
            </div>
          </OptionGroup>

          {mode !== 'linkedin' && (
            <OptionGroup
              label="Platforms"
              hint={mode === 'campaign' ? (
                <>
                  <span className="tabular-nums font-semibold text-[var(--gv-text-primary)]">~{estimate.total} posts</span>
                  <span className="mx-1.5">·</span>{estimate.perWeek} per week
                </>
              ) : undefined}
            >
              <PlatformTiles items={PLATFORMS.map(({ key, label, soon }) => ({ key, label, soon }))} selected={selectedPlatforms} onToggle={togglePlatform} />
            </OptionGroup>
          )}

          {mode !== 'linkedin' && (
            <OptionGroup label="Aspect ratio" hint={ASPECTS.find((a) => visualStyle.startsWith(a.key))?.use}>
              <TileRadioRow
                label="Shape of the picture"
                width="w-[56px]"
                value={ASPECTS.find((a) => visualStyle.startsWith(a.key))?.key || '4:5'}
                onChange={setAspect}
                choices={ASPECTS.map((a) => ({
                  value: a.key,
                  name: a.label,
                  description: `${a.hint}, ${a.use.toLowerCase()}`,
                  art: <ShapeArt w={a.w} h={a.h} on={visualStyle.startsWith(a.key)} />,
                }))}
              />
            </OptionGroup>
          )}

          {mode !== 'linkedin' && (
            <OptionGroup
              label="Logo"
              note={logos.length === 0 ? <>· none in Brand assets</> : undefined}
              hint={selectedLogo ? 'Added after the picture is made' : undefined}
            >
              <TileRadioRow
                label="Logo on the picture"
                width="w-[64px]"
                value={selectedLogo}
                onChange={(url) => {
                  setSelectedLogo(url);
                  const l = logos.find((x) => x.url === url);
                  if (l) setLogoPosition(l.defaultPosition);
                }}
                choices={[
                  { value: '', name: 'No logo', art: <LogoPostArt /> },
                  ...logos.map((l) => ({
                    value: l.url,
                    name: logos.length > 1 ? l.name : 'Your logo',
                    description: l.name,
                    art: <LogoPostArt position={selectedLogo === l.url ? logoPosition : l.defaultPosition} logoUrl={l.url} />,
                  })),
                ]}
                after={
                  <>
                    {/* Only once a logo is going on the picture. Starts on that logo's Brand assets position. */}
                    {selectedLogo && <LogoPositionTile value={logoPosition} logoUrl={selectedLogo} onChange={setLogoPosition} />}
                    {logos.length === 0 && (
                      <button type="button" onClick={() => navigate('/brand-assets')} className={`${tileClass(false, 'w-[76px]')} !justify-center text-[11.5px] font-semibold text-[var(--gv-accent-text)]`}>
                        Add a logo
                      </button>
                    )}
                  </>
                }
              />
            </OptionGroup>
          )}

          {mode !== 'linkedin' && (
            <OptionGroup label="Look" hint={LOOKS.find((l) => l.key === density)?.hint}>
              <TileRadioRow
                label="How full the design is"
                width="w-[72px]"
                value={density}
                onChange={(v) => setDensity(v as typeof density)}
                choices={LOOKS.map((l) => ({ value: l.key, name: l.label, description: l.hint, art: LOOK_ART[l.key] }))}
              />
            </OptionGroup>
          )}
        </div>
      </div>

      {/* The look of the post: style with sample pictures, the exact text, a reference picture, header and footer.
          Its own full-width section, not squeezed into the options row above. */}
      {mode !== 'linkedin' && (
        <div className="mt-5">
          <PostDesignPanel
            design={design}
            onChange={setDesign}
            mode={mode === 'campaign' ? 'campaign' : mode === 'carousel' ? 'carousel' : 'single'}
            idea={[name, description].filter(Boolean).join('. ')}
            language={language}
            aspect={backendAspect}
            logoUrl={selectedLogo || undefined}
            logoPosition={logoPosition}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center text-[13px] text-red-400 mb-4 mt-4">{error}</div>
      )}

      {/* Primary CTA */}
      <div className="flex flex-col items-center gap-3 mt-5">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={handleDraft}
            disabled={submitting}
            className="flex items-center gap-2 h-11 px-7 rounded-xl bg-[var(--gv-accent)] hover:bg-[var(--gv-accent-hover)] text-[#1A1208] text-[14px] font-semibold shadow-[0_6px_20px_rgba(245,166,35,0.25)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" strokeWidth={2.5} />
                {mode === 'campaign' ? 'Create campaign' : mode === 'carousel' ? 'Create carousel' : 'Create post'}
                {currentActionCost > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-md bg-black/15 text-[11.5px] font-semibold tabular-nums">
                    {currentActionTotal}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
        {submitting && progressMsg && (
          <div className="text-[12.5px] text-[var(--gv-text-tertiary)] mt-1 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--gv-accent)] animate-pulse" />
            {progressMsg}
            {postsGenerated > 0 && (
              <span className="text-[var(--gv-text-muted)]">· {postsGenerated} draft{postsGenerated !== 1 ? 's' : ''} so far</span>
            )}
          </div>
        )}
      </div>

      {/* In-flight placeholders — the card appears immediately with the
          animation in it, then becomes the real draft when it lands. */}
      {pendingCards.length > 0 && (
        <div className="max-w-5xl mx-auto mt-10">
          <div className="text-center mb-6">
            <div className="gravity-label text-[var(--gv-accent-text)] mb-3">
              {mode === 'campaign' ? 'Building your campaign' : mode === 'carousel' ? 'Building your carousel' : 'Creating your post'}
            </div>
            <h2 className="text-[26px] leading-[1.15] font-semibold text-[var(--gv-text-primary)] tracking-[-0.015em]">
              Your content is being <em className="italic font-normal text-[var(--gv-accent-display)]">created</em>.
            </h2>
            {progressMsg && <p className="text-[13.5px] text-[var(--gv-text-tertiary)] mt-3">{progressMsg}</p>}
          </div>
          <div className={`grid gap-4 ${pendingCards.length === 1 ? 'grid-cols-1 max-w-md mx-auto' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
            {pendingCards.map((_, i) => (
              <div key={i} className="rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] overflow-hidden">
                <div className="relative bg-black" style={{ aspectRatio: backendAspect.replace(':', ' / ') }}>
                  <GeneratingFill prompt={description.trim() || name.trim()} resolution={backendAspect} />
                </div>
                <div className="p-3.5">
                  <div className="h-3 w-2/3 rounded bg-[var(--gv-surface-2)] animate-pulse" />
                  <div className="h-2.5 w-1/3 rounded bg-[var(--gv-surface-2)] animate-pulse mt-2.5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results — everything happens here now. No hop to /drafts. */}
      {results.length > 0 && (
        <div className="max-w-5xl mx-auto mt-10">
          <div className="relative text-center mb-6">
            <button
              onClick={() => { setResults([]); setActioned({}); setSchedulingId(''); }}
              className="absolute right-0 top-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--gv-border-default)] px-3 py-2 text-[12px] text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:border-[var(--gv-border-default)] transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Start over
            </button>

            {/* These are a series of posts in one campaign, not variations of
                the same idea — there is nothing to pick between. */}
            <div className="gravity-label text-[var(--gv-accent-text)] mb-3">
              {submitting
                ? `${results.length} of ${expectedCount} created`
                : mode === 'campaign'
                  ? `${results.length} post${results.length !== 1 ? 's' : ''} in your campaign`
                  : mode === 'carousel'
                    ? `${results.length} slide${results.length !== 1 ? 's' : ''}, in swipe order`
                    : 'Your post'}
            </div>
            <h2 className="text-[26px] leading-[1.15] font-semibold text-[var(--gv-text-primary)] tracking-[-0.015em]">
              {submitting ? (
                <>Your content is being <em className="italic font-normal text-[var(--gv-accent-display)]">created</em>.</>
              ) : mode === 'campaign' ? (
                <>Your campaign is <em className="italic font-normal text-[var(--gv-accent-display)]">ready</em>.</>
              ) : mode === 'carousel' ? (
                <>Your carousel is <em className="italic font-normal text-[var(--gv-accent-display)]">ready</em>.</>
              ) : (
                <>Your post is <em className="italic font-normal text-[var(--gv-accent-display)]">ready</em>.</>
              )}
            </h2>
            {stillRendering && (
              <p className="text-[13.5px] text-[var(--gv-text-tertiary)] mt-3">
                Some images are still being generated. This page updates automatically.
              </p>
            )}
          </div>

          <div className={`grid gap-4 ${results.length === 1 ? 'grid-cols-1 max-w-md' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
            {results.map((d: any) => {
              const img = draftImage(d);
              const processing = String(d?.status || '').toLowerCase() === 'processing';
              const failed = String(d?.status || '').toLowerCase() === 'failed';
              const done = actioned[d._id];
              const busy = actionBusy === d._id;

              return (
                <div key={d._id} className="rounded-xl border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] overflow-hidden">
                  <div className="relative bg-black/40" style={{ aspectRatio: backendAspect.replace(':', ' / ') }}>
                    {img ? (
                      <img src={img} alt={d.title || 'Draft'} className="w-full h-full object-contain" />
                    ) : failed ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <AlertCircle className="w-6 h-6 text-red-400" />
                        <span className="text-[11px] text-red-300">Image generation failed</span>
                      </div>
                    ) : (d.platforms || []).includes('linkedin') && !processing ? (
                      // LinkedIn posts generate text-only — no image was
                      // requested, so there is nothing "generating." Offer
                      // to add one instead of showing a fill that implies
                      // work already in flight.
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
                        <ImageIcon className="w-6 h-6 text-[var(--gv-text-muted)]" />
                        <span className="text-[11.5px] text-[var(--gv-text-muted)]">No image yet</span>
                        <button
                          onClick={() => regenerateImage(d)}
                          disabled={busy}
                          className="h-8 px-3.5 rounded-full bg-[var(--gv-surface-3)] text-[12px] font-semibold text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-50 transition-colors"
                        >
                          Add image
                        </button>
                      </div>
                    ) : (
                      <GeneratingFill prompt={d.imagePrompt || d.title || ''} resolution={backendAspect} />
                    )}
                  </div>

                  <div className="p-3.5">
                    {editingCaption === d._id ? (
                      <div className="space-y-2">
                        <textarea
                          value={captionDraft}
                          onChange={(e) => setCaptionDraft(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg bg-[var(--gv-surface-3)] border border-[var(--gv-border-default)] px-2.5 py-2 text-[12.5px] text-[var(--gv-text-primary)] resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveCaption(d)}
                            disabled={captionBusy === d._id}
                            className="flex-1 rounded-lg bg-[var(--gv-accent)] text-black text-[11.5px] font-semibold py-1.5 disabled:opacity-50"
                          >
                            {captionBusy === d._id ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingCaption('')}
                            className="px-3 rounded-lg border border-[var(--gv-border-default)] text-[11.5px] text-[var(--gv-text-tertiary)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-[12.5px] leading-snug whitespace-pre-line text-[rgb(var(--gv-ink-rgb)/0.90)]">
                          {d.caption || <span className="text-[var(--gv-text-muted)] italic">No caption yet</span>}
                        </p>
                        <div className="flex items-center justify-between mt-2.5">
                          <div className="gravity-label text-[var(--gv-text-muted)]">
                            {backendAspect} · {d.slideLabel || (mode === 'campaign' ? 'Campaign' : 'Editorial')}
                          </div>
                          <div className="flex items-center gap-1">
                            {/* Every one of these addresses a single draft. A
                                carousel slide is one image inside a shared
                                draft, so none of them apply to it. */}
                            {!d.isCarouselSlide && (
                              <>
                                <IconAction label="Write a caption" onClick={() => generateCaption(d)} disabled={captionBusy === d._id || !img}>
                                  {captionBusy === d._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                </IconAction>
                                <IconAction label="Edit caption" onClick={() => { setEditingCaption(d._id); setCaptionDraft(d.caption || ''); }}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </IconAction>
                                <IconAction label="View the prompt" onClick={() => openPrompt(d)}>
                                  <Code2 className="w-3.5 h-3.5" />
                                </IconAction>
                                <IconAction label="Regenerate" onClick={() => regenerateImage(d)} disabled={busy || processing}>
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </IconAction>
                                <IconAction label="Edit image" onClick={() => openEditImage(d)} disabled={busy || processing || !img}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </IconAction>
                                <IconAction label="Delete this post" onClick={() => discard(d)} disabled={busy} danger>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </IconAction>
                              </>
                            )}
                          </div>
                        </div>

                        {/* The exact prompt that produced this image. Editing it
                            and regenerating is the fastest way to find out why a
                            result was weak. */}
                        {promptOpenFor === d._id && (
                          <div className="mt-3 rounded-xl border border-[rgb(var(--gv-accent-rgb)/0.20)] bg-[var(--gv-accent-fill)] p-4">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <div className="gravity-label text-[var(--gv-accent-text)]">Prompt sent to the image model</div>
                              <button
                                onClick={() => setPromptOpenFor('')}
                                className="p-1 rounded-md text-[var(--gv-text-muted)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]"
                                title="Close"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {!(d.imagePromptResolved || d.imagePrompt) ? (
                              <p className="text-[12px] text-[var(--gv-text-tertiary)]">
                                No prompt was recorded for this image. Images generated from now on will show theirs here.
                              </p>
                            ) : (
                              <>
                                <textarea
                                  value={promptDraft}
                                  onChange={(e) => setPromptDraft(e.target.value)}
                                  rows={10}
                                  className="gravity-bare w-full bg-[var(--gv-surface-2)] border border-[var(--gv-border-default)] rounded-lg p-3 text-[12px] leading-relaxed text-[var(--gv-text-secondary)] font-mono resize-y"
                                />
                                <div className="flex flex-wrap items-center gap-2 mt-3">
                                  <button
                                    onClick={copyPrompt}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-[var(--gv-border-default)] text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                    {promptCopied ? 'Copied' : 'Copy'}
                                  </button>
                                  <button
                                    onClick={() => regenerateWithPrompt(d)}
                                    disabled={busy || processing || !promptDraft.trim()}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--gv-accent)] text-[#1A1208] hover:bg-[var(--gv-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    Regenerate with this
                                  </button>
                                  <button
                                    onClick={() => resetPrompt(d)}
                                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]"
                                  >
                                    Reset
                                  </button>
                                  <span className="text-[11px] text-[var(--gv-text-muted)] ml-auto">Regenerating costs Quarks.</span>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Small targeted fix — keeps the current image,
                            changes only what the instruction describes.
                            Separate from "See the prompt" above, which
                            redraws the whole image from a full prompt. */}
                        {editImageFor === d._id && (
                          <div className="mt-3 rounded-xl border border-[rgb(var(--gv-accent-rgb)/0.20)] bg-[var(--gv-accent-fill)] p-4">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <div className="gravity-label text-[var(--gv-accent-text)]">Describe the change</div>
                              <button
                                onClick={() => setEditImageFor('')}
                                className="p-1 rounded-md text-[var(--gv-text-muted)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)]"
                                title="Close"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <textarea
                              value={editImageInstruction}
                              onChange={(e) => setEditImageInstruction(e.target.value)}
                              placeholder="For example: fix the spelling in the headline, make the sky darker, or remove the coffee cup."
                              rows={2}
                              className="gravity-bare w-full bg-[var(--gv-surface-2)] border border-[var(--gv-border-default)] rounded-lg p-3 text-[12px] leading-relaxed text-[var(--gv-text-secondary)] resize-y"
                            />
                            <div className="flex items-center justify-between mt-3">
                              <span className="text-[11px] text-[var(--gv-text-muted)]">The rest of the image stays the same.</span>
                              <button
                                onClick={() => applyImageEdit(d)}
                                disabled={editImageBusy === d._id || !editImageInstruction.trim()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--gv-accent)] text-[#1A1208] hover:bg-[var(--gv-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {editImageBusy === d._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                                Apply edit
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {done ? (
                      <div className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        {done === 'approved' ? 'Published' : done === 'scheduled' ? 'Scheduled' : 'Saved to drafts'}
                      </div>
                    ) : schedulingId === d._id ? (
                      <div className="mt-3 space-y-2">
                        <input
                          type="datetime-local"
                          value={scheduleFor}
                          onChange={(e) => setScheduleFor(e.target.value)}
                          className="w-full rounded-lg bg-[var(--gv-surface-3)] border border-[var(--gv-border-default)] px-2.5 py-1.5 text-[12px] text-[var(--gv-text-primary)]"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => scheduleNow(d)}
                            disabled={busy || !scheduleFor}
                            className="flex-1 rounded-lg bg-[var(--gv-accent)] text-black text-[11.5px] font-semibold py-1.5 disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Confirm'}
                          </button>
                          <button
                            onClick={() => { setSchedulingId(''); setScheduleFor(''); }}
                            className="px-3 rounded-lg border border-[var(--gv-border-default)] text-[11.5px] text-[var(--gv-text-tertiary)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => keepAsDraft(d)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--gv-border-default)] text-[11.5px] text-[var(--gv-text-secondary)] hover:bg-[var(--gv-surface-2)] disabled:opacity-50"
                        >
                          <Save className="w-3 h-3" /> Save as draft
                        </button>
                        <button
                          onClick={() => approveNow(d)}
                          disabled={busy || processing || (!img && mode !== 'linkedin')}
                          title={processing ? 'Wait until the image is ready' : 'Publish now'}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11.5px] font-semibold disabled:opacity-40"
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
                        </button>
                        <button
                          onClick={() => { setSchedulingId(d._id); setScheduleFor(''); }}
                          disabled={busy || processing || (!img && mode !== 'linkedin')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)] text-[11.5px] font-semibold disabled:opacity-40"
                        >
                          <Clock className="w-3 h-3" /> Schedule
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Slots still to come. Posts stream back one at a time, so only
                the first of these is actually being made — the rest are
                waiting. Showing them all as identical spinners was why a run
                looked stalled. */}
            {remainingCards.map((_, i) => (
              <PendingSlot
                key={`pending-${i}`}
                position={results.length + i + 1}
                active={i === 0}
                etaSeconds={avgPostSeconds}
                elapsed={elapsedOnCurrent}
              />
            ))}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-center gap-3 mt-10">
            <button
              onClick={handleDraft}
              disabled={submitting || stillRendering}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-[var(--gv-border-strong)] text-[13px] font-semibold text-[var(--gv-text-secondary)] hover:text-[var(--gv-text-primary)] hover:border-[var(--gv-border-strong)] transition-colors disabled:opacity-40"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Generate {results.length || 4} more
            </button>
            <button
              onClick={sendAllToApproval}
              disabled={actionBusy === 'all' || stillRendering || results.every((d: any) => actioned[d._id])}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[var(--gv-accent)] hover:bg-[var(--gv-accent-hover)] text-[#1A1208] text-[13px] font-semibold shadow-[0_10px_40px_rgba(245,166,35,0.25)] transition-colors disabled:opacity-40"
            >
              {actionBusy === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" strokeWidth={2.5} />}
              Send all to approval
            </button>
          </div>
        </div>
      )}

      {/* Everything made in this category — still-running work included — so the form above stays free. */}
      <CreateGenerations category={mode} refreshKey={galleryKey} />

    </div>
  );
};

export default GravityCreate;
