import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Film,
  Plus,
  Image as ImageIcon,
  Package,
  Captions,
  Music2,
  Sparkles,
  RefreshCcw,
  Mic,
  ArrowLeft,
  Trash2,
  XCircle,
  ToggleRight,
  ToggleLeft,
  Eye,
  X,
  Search,
  ChevronDown,
  Star,
  Play,
  Pause
} from 'lucide-react';
import { useSmartCalendarAutoFill } from '../hooks/useSmartCalendarAutoFill';
import { getThemeClasses, useTheme } from '../context/ThemeContext';
import { contentCalendarAPI, inventoryAPI, videoGenerationAPI, draftsAPI } from '../services/api';
import { Product, Draft } from '../types';
import { useLocation, useSearchParams } from 'react-router-dom';
import { updateBackgroundReel } from '../utils/backgroundReel';

type AudioMode = 'off' | 'auto' | 'upload';
type VideoStatusFilter = 'all' | 'draft' | 'created' | 'scheduled' | 'posted';

// Video styles rendered as a picker grid in Step 2. `slug` maps to
// public/assets/video-styles/<slug>.svg — drop a .jpg/.png in with the
// same slug and swap the extension here to use real photography instead.
const VIDEO_STYLES: { value: string; slug: string; blurb: string }[] = [
  { value: 'Cinematic Commercial', slug: 'cinematic-commercial', blurb: 'Filmic grade, shallow depth, dramatic light' },
  { value: 'Storytelling', slug: 'storytelling', blurb: 'Narrative arc with characters and emotional beats' },
  { value: 'Product Advertisement', slug: 'product-advertisement', blurb: 'Clean studio focus on the product itself' },
  { value: 'Daily Life Vlog', slug: 'daily-life-vlog', blurb: 'Handheld, casual, first-person energy' },
  { value: 'Documentary', slug: 'documentary', blurb: 'Observational, grounded, real-world texture' },
  { value: 'Educational', slug: 'educational', blurb: 'Clear explainer pacing with visual aids' },
  { value: 'Motivational', slug: 'motivational', blurb: 'Rising energy, aspirational imagery' },
  { value: 'Corporate Presentation', slug: 'corporate-presentation', blurb: 'Polished, professional, data-forward' },
  { value: 'Testimonial', slug: 'testimonial', blurb: 'Customer to camera, trust-building' },
  { value: 'Product Showcase', slug: 'product-showcase', blurb: 'Hero product on a lit stage' },
  { value: 'News Update', slug: 'news-update', blurb: 'Broadcast framing with lower-third titling' },
  { value: 'Social Media Reel', slug: 'social-media-reel', blurb: 'Fast cuts, vertical-first, punchy hooks' },
  { value: 'Luxury Advertisement', slug: 'luxury-advertisement', blurb: 'Restrained, premium, gold and black' }
];

// Clips, audio and merge are produced by the Nebulaa team off-platform for
// now, so those four steps are hidden and Scene Images hands off by email
// instead. Set this to false to restore the self-serve pipeline — the step
// 7-9 panels further down are left intact for exactly that.
const MANUAL_VIDEO_HANDOFF = true;

const HANDOFF_STEP = 6;        // replaces "Video Clips"
const PIPELINE_STEPS = [7, 8, 9]; // Audio Config, Audio Mix, Video Merge
const FINAL_OUTPUT_STEP = 13;

// Internal step numbers stay stable so every `step === N` below keeps
// working; only what the stepper shows (and what Next skips to) changes.
const ALL_WIZARD_STEPS: { label: string; step: number }[] = [
  { label: 'Input', step: 1 },
  { label: 'Character & Video Style Configuration', step: 2 },
  { label: 'Environment', step: 3 },
  { label: 'Script + Scenes', step: 4 },
  { label: 'Scene Images', step: 5 },
  { label: 'Video Clips', step: HANDOFF_STEP },
  { label: 'Audio Config', step: 7 },
  { label: 'Audio Mix', step: 8 },
  { label: 'Video Merge', step: 9 },
  { label: 'Thumbnail + Content', step: 10 },
  { label: 'Platform Select', step: 11 },
  { label: 'Scheduling', step: 12 },
  { label: 'Final Output', step: FINAL_OUTPUT_STEP }
];

const WIZARD_STEPS = MANUAL_VIDEO_HANDOFF
  ? ALL_WIZARD_STEPS
    .filter((entry) => !PIPELINE_STEPS.includes(entry.step))
    .map((entry) => (entry.step === HANDOFF_STEP ? { ...entry, label: 'Send to Our Team' } : entry))
  : ALL_WIZARD_STEPS;

// Where the handoff step continues to once the request is sent.
const STEP_AFTER_HANDOFF = MANUAL_VIDEO_HANDOFF ? 10 : 7;

// Walking back with `step - 1` would land on a hidden pipeline step (a blank
// panel), so step back through the visible list instead.
function previousVisibleStep(current: number): number {
  const visible = WIZARD_STEPS.map((entry) => entry.step);
  const index = visible.indexOf(current);
  if (index > 0) return visible[index - 1];
  const below = visible.filter((entry) => entry < current);
  return below.length ? below[below.length - 1] : 1;
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

const ReelGenerator: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const panelClass = `${theme.bgCard} border ${isDarkMode ? 'border-slate-800' : 'border-slate-200'} rounded-2xl`;
  const inputClass = `w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition ${isDarkMode
    ? 'bg-slate-900 border-slate-700 text-white focus:border-[#ffcc29]'
    : 'bg-white border-slate-300 text-slate-900 focus:border-[#ffcc29]'
    }`;

  const [step, setStep] = useState(1);
  const {
    isAutoFillEnabled,
    availableItems,
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    isLoading: isCalendarLoading,
    getMappedData
  } = useSmartCalendarAutoFill('reel');

  // Clear the hook's auto-selected FIFO pick on mount so the user
  // starts with NO tile approved. They browse the Smart Calendar
  // tiles in Step 1 and explicitly click "Approve & Use This" on the
  // one they want — that click sets selectedItemId, which fires the
  // effect below and populates the input fields.
  useEffect(() => {
    setSelectedItemId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAutoFillEnabled && selectedItem) {
      const data = getMappedData(selectedItem);
      setDescription(data.story || data.caption);
      setPromptText(data.videoPrompt);
      setCaption(data.caption);
      setHashtagsText(data.hashtags);
    }
  }, [isAutoFillEnabled, selectedItem]);

  const [busy, setBusy] = useState(false);
  const [regeneratingSceneIds, setRegeneratingSceneIds] = useState<Set<string>>(new Set());
  const markSceneRegenerating = (sceneId: string, isOn: boolean) => {
    setRegeneratingSceneIds((prev) => {
      const next = new Set(prev);
      if (isOn) next.add(sceneId); else next.delete(sceneId);
      return next;
    });
  };
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState('');
  const [draft, setDraft] = useState<any>(null);
  const [videoDrafts, setVideoDrafts] = useState<any[]>([]);
  const [reelDraftsList, setReelDraftsList] = useState<Draft[]>([]);
  const [statusFilter, setStatusFilter] = useState<VideoStatusFilter>('all');
  const [showWizard, setShowWizard] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState('');
  const [previewDraft, setPreviewDraft] = useState<any>(null);

  // ---- Video Concept generation (Step 1 add-on) ----
  // Holds the 3 concepts returned by the Creative Director prompt,
  // which one the user accepted (required before Next is enabled),
  // and the recommendation blurb.
  type VideoConcept = {
    id: string; type: string; title: string; coreEmotion: string;
    bigIdea: string; storySummary: string; whyItWorks: string;
    visualStyle: string; musicStyle: string; endingMessage: string;
  };
  const [concepts, setConcepts] = useState<VideoConcept[]>([]);
  const [conceptsRecommended, setConceptsRecommended] = useState<string>('');
  const [conceptsReason, setConceptsReason] = useState<string>('');
  const [acceptedConceptId, setAcceptedConceptId] = useState<string>('');
  const [acceptedConcept, setAcceptedConcept] = useState<VideoConcept | null>(null);
  const [generatingConcepts, setGeneratingConcepts] = useState(false);
  const [conceptError, setConceptError] = useState<string>('');

  // ---- Character Bible generation (Step 2 add-on) ----
  // Auto-fires when the user enters Step 2 with an accepted concept.
  // Returns 1-3 characters the user can accept or regenerate.
  type CharacterBible = {
    id: string; name: string; age: string; gender: string;
    role: string; appearance: string; clothing: string;
    hairStyle: string; hairColor: string; personality: string;
    referencePrompt: string;
    portraitUrl?: string;         // rendered image URL
    portraitLoading?: boolean;    // portrait render in progress
    portraitError?: string;       // last portrait render error
    overridePrompt?: string;      // user's per-card tweak prompt
  };
  const [generatedCharacters, setGeneratedCharacters] = useState<CharacterBible[]>([]);
  const [generatingCharacters2, setGeneratingCharacters2] = useState(false);
  const [acceptedCharacterId, setAcceptedCharacterId] = useState<string>('');
  const [characterGenError, setCharacterGenError] = useState<string>('');

  // Master Cast Reference — single image containing ALL characters
  // in one frame with numbered labels (01, 02, ...). This is what the
  // downstream pipeline uses as the identity anchor for every scene.
  const [castReferencePrompt, setCastReferencePrompt] = useState<string>('');
  const [castImageUrl, setCastImageUrl] = useState<string>('');
  const [castImageLoading, setCastImageLoading] = useState(false);
  const [castImageError, setCastImageError] = useState<string>('');
  const [castTweakPrompt, setCastTweakPrompt] = useState<string>('');

  // Persistence block moved below `const [description, setDescription]`
  // declaration to avoid a temporal-dead-zone crash — it needs to read
  // `description` and other state vars that are declared further down.
  const STORAGE_KEY = 'gravity-reel-workspace';
  const workspaceHydratedRef = useRef(false);

  // Render a portrait for one character. Called on generation and on
  // per-card regenerate. overridePrompt takes precedence over the
  // originally-generated referencePrompt so users can steer the result.
  const renderCharacterPortrait = async (charId: string, useOverride = false) => {
    setGeneratedCharacters((prev) => prev.map((c) => c.id === charId ? { ...c, portraitLoading: true, portraitError: '' } : c));
    const ch = generatedCharactersRef.current.find((c) => c.id === charId);
    if (!ch) return;
    try {
      const res = await videoGenerationAPI.generateCharacterPortrait({
        referencePrompt: ch.referencePrompt,
        overridePrompt: useOverride ? (ch.overridePrompt || '').trim() || undefined : undefined,
        characterName: ch.name,
        aspectRatio: '1:1',
      });
      if (!res?.success || !res?.imageUrl) throw new Error(res?.message || 'No portrait URL');
      setGeneratedCharacters((prev) => prev.map((c) => c.id === charId ? { ...c, portraitUrl: res.imageUrl, portraitLoading: false } : c));
    } catch (e: any) {
      setGeneratedCharacters((prev) => prev.map((c) => c.id === charId ? { ...c, portraitError: e?.message || 'Failed to render', portraitLoading: false } : c));
    }
  };
  // Ref mirror so async render calls always see latest generated list
  const generatedCharactersRef = useRef<CharacterBible[]>([]);
  useEffect(() => { generatedCharactersRef.current = generatedCharacters; }, [generatedCharacters]);

  // Render the Master Cast Reference — a single wide image showing all
  // characters together with numbered labels, so the pipeline has ONE
  // consistent identity anchor for every scene.
  const renderCastReferenceImage = async (_promptOverride?: string, charactersOverride?: any[]) => {
    // Cast image is now built DETERMINISTICALLY on the backend from the
    // characters array — no LLM-generated prompt in the loop. This
    // guarantees exact character count + no invented tagline / brand
    // text baked into the image.
    const chars = charactersOverride || generatedCharacters;
    if (!Array.isArray(chars) || chars.length === 0) {
      setCastImageError('No characters available yet.');
      return;
    }
    const tweak = castTweakPrompt.trim();
    setCastImageLoading(true);
    setCastImageError('');
    setCastImageUrl('');
    try {
      const res = await videoGenerationAPI.generateCharacterPortrait({
        castMode: true,
        characters: chars,
        extraDirection: tweak || undefined,
        aspectRatio: '16:9', // wide horizontal for a cast line-up
      } as any);
      if (!res?.success || !res?.imageUrl) throw new Error(res?.message || 'No cast image URL returned');
      setCastImageUrl(res.imageUrl);
    } catch (e: any) {
      setCastImageError(e?.message || 'Failed to render cast image');
    } finally {
      setCastImageLoading(false);
    }
  };

  // Reusable character generation function — called on Step 2 entry and
  // on user-clicked "Regenerate".
  const runCharacterGeneration = async () => {
    setCharacterGenError('');
    setGeneratingCharacters2(true);
    setAcceptedCharacterId('');
    try {
      const res = await videoGenerationAPI.generateCharacters({
        description: description.trim(),
        conceptTitle: acceptedConcept?.title || '',
        conceptStory: acceptedConcept?.storySummary || '',
        conceptEmotion: acceptedConcept?.coreEmotion || '',
        conceptVisualStyle: acceptedConcept?.visualStyle || '',
      });
      if (!res?.success || !Array.isArray(res.characters) || res.characters.length === 0) {
        throw new Error(res?.message || 'No characters returned. Try again.');
      }
      const list = res.characters as CharacterBible[];
      setGeneratedCharacters(list);
      const castPrompt = (res as any).castReferencePrompt || '';
      setCastReferencePrompt(castPrompt);
      // Immediately render the single Master Cast reference image
      // showing everyone with numbered labels. Pass the fresh list
      // directly — state hasn't propagated yet at this call point.
      renderCastReferenceImage(undefined, list);
    } catch (e: any) {
      setCharacterGenError(e?.message || 'Failed to generate characters.');
    } finally {
      setGeneratingCharacters2(false);
    }
  };

  // Auto-fire character generation when the user enters Step 2 with an
  // accepted concept (Path B — required flow). Skipping the concept step
  // means no characters — the Character Designer needs approved story
  // context to design specific, on-brief characters.
  useEffect(() => {
    if (
      step === 2 &&
      acceptedConcept &&
      generatedCharacters.length === 0 &&
      !generatingCharacters2 &&
      !characterGenError
    ) {
      runCharacterGeneration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, acceptedConcept]);

  // Pull the finished video URL from any of the fields the pipeline may
  // use — reel drafts write it into imageUrl/creative.videoUrl, video
  // drafts into finalVideoUrl / merge.finalOutputUrl / merge.finalVideoUrl.
  const getVideoUrl = (item: any): string => {
    return (
      item?.finalVideoUrl ||
      item?.merge?.finalOutputUrl ||
      item?.merge?.finalVideoUrl ||
      item?.creative?.videoUrl ||
      item?.creative?.finalVideoUrl ||
      (typeof item?.imageUrl === 'string' && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(item.imageUrl) ? item.imageUrl : '') ||
      (typeof item?.imageUrl === 'string' && /\/video\/upload\//i.test(item.imageUrl) ? item.imageUrl : '') ||
      ''
    );
  };
  const [successMessage, setSuccessMessage] = useState('');

  // Persistent Queue background worker progress states
  const [activeQueueJobId, setActiveQueueJobId] = useState<string>('');
  const [activeJobStatus, setActiveJobStatus] = useState<string>('');
  const [activeJobProgress, setActiveJobProgress] = useState<number>(0);
  const [activeJobStep, setActiveJobStep] = useState<string>('');
  const [activeJobLogs, setActiveJobLogs] = useState<string[]>([]);

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [description, setDescription] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(60);
  // Aspect ratio chosen on Step 1 — propagated into every image + clip
  // gen call so images and Kling clips render in the correct format.
  type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  // Scene previews are framed to the chosen aspect and use object-contain,
  // so the whole generated frame is always visible — never centre-cropped.
  const previewAspectCss = ({ '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1', '4:5': '4 / 5' } as const)[aspectRatio];
  // Video language chosen on Step 1. Drives (a) script generation
  // (voiceover written directly in this language, not translated) and
  // (b) TTS voice pick for audio synthesis. Step 6 audio config picks
  // this up automatically as its default language.
  type VideoLang = 'en' | 'hi' | 'ta' | 'te' | 'kn' | 'ml';
  const [languageCode, setLanguageCode] = useState<VideoLang>('en');
  // Environment lock (Step 3 of the wizard). enabled=false means the
  // wizard skips env constraints; enabled=true stores 1-5 reference
  // images + optional short notes. Backends thread these into every
  // LLM prompt and every Nano Banana / Kling call.
  type EnvironmentRef = { url?: string; dataUrl?: string; source: 'upload' | 'brand-asset'; alt?: string };
  const [environmentEnabled, setEnvironmentEnabled] = useState<boolean>(false);
  const [environmentRefs, setEnvironmentRefs] = useState<EnvironmentRef[]>([]);
  const [environmentNotes, setEnvironmentNotes] = useState<string>('');
  const [brandAssetImages, setBrandAssetImages] = useState<Array<{ url: string; alt: string; isLogo: boolean }>>([]);
  const [brandAssetsLoading, setBrandAssetsLoading] = useState<boolean>(false);
  // Voice state (declared here — above the persist useEffect below —
  // so the effect's deps array doesn't hit a temporal-dead-zone on
  // initial render. The audio-config UI on Step 6 reads/writes these.)
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('female');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  type ElevenLabsVoice = {
    voiceId: string;
    name: string;
    gender: string;
    accent: string;
    description: string;
    age: string;
    useCase: string;
    previewUrl: string;
    category: string;
    isFavourite: boolean;
    isNative?: boolean;
  };
  const [voiceCatalog, setVoiceCatalog] = useState<ElevenLabsVoice[]>([]);
  const [voiceCatalogLoading, setVoiceCatalogLoading] = useState(false);
  const [voiceCatalogError, setVoiceCatalogError] = useState('');
  // Native-voice metadata from the backend — used to show a
  // "no native voices for Tamil — enable multilingual fallback?" prompt.
  const [voiceCatalogNativeCount, setVoiceCatalogNativeCount] = useState<number>(0);
  const [voiceCatalogCanFallback, setVoiceCatalogCanFallback] = useState<boolean>(false);
  const [voiceIncludeMultilingual, setVoiceIncludeMultilingual] = useState<boolean>(false);
  const [voicePreviewId, setVoicePreviewId] = useState<string>('');
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  // ---- v2 Script & Scenes state (moved above hydrate/persist useEffects
  // to avoid a temporal-dead-zone crash — those effects reference these
  // vars in their deps arrays which JS evaluates during render, before
  // any state declaration further down the function body). ----
  const [promptText, setPromptText] = useState('');
  const [scenes, setScenes] = useState<any[]>([]);
  type StoryArc = {
    hook: string; beginning: string; emotionalProgression: string;
    climax: string; brandReveal: string; ending: string;
  };
  const emptyStory: StoryArc = { hook: '', beginning: '', emotionalProgression: '', climax: '', brandReveal: '', ending: '' };
  const [story, setStory] = useState<StoryArc>(emptyStory);
  const [showStory, setShowStory] = useState(true);
  const [showVoiceover, setShowVoiceover] = useState(true);
  const [showSceneBreakdown, setShowSceneBreakdown] = useState(true);
  const [voiceoverCopied, setVoiceoverCopied] = useState(false);
  // Sequential generation state — tracks which scenes are still being
  // enriched so the UI can show a per-scene spinner + "Generating scene
  // N of M" progress indicator.
  const [pendingSceneIndex, setPendingSceneIndex] = useState<number | null>(null);
  const [totalScenesForRun, setTotalScenesForRun] = useState<number>(0);

  // Hydrate persisted workspace once on mount (concepts, characters,
  // cast image). Placed here so all referenced state vars are defined.
  useEffect(() => {
    if (workspaceHydratedRef.current) return;
    workspaceHydratedRef.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.description) setDescription(saved.description);
      if (Array.isArray(saved.concepts) && saved.concepts.length) setConcepts(saved.concepts);
      if (saved.conceptsRecommended) setConceptsRecommended(saved.conceptsRecommended);
      if (saved.conceptsReason) setConceptsReason(saved.conceptsReason);
      if (saved.acceptedConceptId) setAcceptedConceptId(saved.acceptedConceptId);
      if (saved.acceptedConcept) setAcceptedConcept(saved.acceptedConcept);
      if (Array.isArray(saved.generatedCharacters) && saved.generatedCharacters.length) {
        setGeneratedCharacters(saved.generatedCharacters);
      }
      if (saved.castReferencePrompt) setCastReferencePrompt(saved.castReferencePrompt);
      if (saved.castImageUrl) setCastImageUrl(saved.castImageUrl);
      if (saved.castTweakPrompt) setCastTweakPrompt(saved.castTweakPrompt);
      if (saved.acceptedCharacterId) setAcceptedCharacterId(saved.acceptedCharacterId);
      // v2 Script + Scenes: story arc + full voiceover
      if (saved.story && typeof saved.story === 'object') {
        setStory({
          hook: String(saved.story.hook || ''),
          beginning: String(saved.story.beginning || ''),
          emotionalProgression: String(saved.story.emotionalProgression || ''),
          climax: String(saved.story.climax || ''),
          brandReveal: String(saved.story.brandReveal || ''),
          ending: String(saved.story.ending || ''),
        });
      }
      if (Array.isArray(saved.scenes) && saved.scenes.length) setScenes(saved.scenes);
      if (saved.promptText) setPromptText(saved.promptText);
      if (saved.aspectRatio && ['9:16','16:9','1:1','4:5'].includes(saved.aspectRatio)) {
        setAspectRatio(saved.aspectRatio as AspectRatio);
      }
      if (saved.languageCode && ['en','hi','ta','te','kn','ml'].includes(saved.languageCode)) {
        setLanguageCode(saved.languageCode as VideoLang);
      }
      if (typeof saved.environmentEnabled === 'boolean') setEnvironmentEnabled(saved.environmentEnabled);
      if (Array.isArray(saved.environmentRefs)) setEnvironmentRefs(saved.environmentRefs);
      if (typeof saved.environmentNotes === 'string') setEnvironmentNotes(saved.environmentNotes);
      if (saved.voiceGender && ['male','female'].includes(saved.voiceGender)) {
        setVoiceGender(saved.voiceGender as 'male' | 'female');
      }
      if (typeof saved.selectedVoiceId === 'string') {
        setSelectedVoiceId(saved.selectedVoiceId);
      }
    } catch (_) { /* corrupt entry — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on every meaningful change. Batched by React so no thrashing.
  useEffect(() => {
    if (!workspaceHydratedRef.current) return;
    try {
      const payload = {
        savedAt: Date.now(),
        description,
        concepts,
        conceptsRecommended,
        conceptsReason,
        acceptedConceptId,
        acceptedConcept,
        generatedCharacters,
        castReferencePrompt,
        castImageUrl,
        castTweakPrompt,
        acceptedCharacterId,
        story,
        scenes,
        promptText,
        aspectRatio,
        languageCode,
        voiceGender,
        selectedVoiceId,
        environmentEnabled,
        environmentRefs,
        environmentNotes,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) { /* quota / private mode — silently drop */ }
  }, [
    description,
    concepts,
    conceptsRecommended,
    conceptsReason,
    acceptedConceptId,
    acceptedConcept,
    generatedCharacters,
    castReferencePrompt,
    castImageUrl,
    castTweakPrompt,
    acceptedCharacterId,
    story,
    scenes,
    promptText,
    aspectRatio,
    languageCode,
    voiceGender,
    selectedVoiceId,
    environmentEnabled,
    environmentRefs,
    environmentNotes,
  ]);

  // Whenever the Step 1 language changes, mirror it into the audio
  // config so Step 6 pre-fills to the right language. User can still
  // override via the Audio Config dropdown if they want a different
  // voiceover language than the script.
  useEffect(() => {
    setAudioLanguageCode(languageCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageCode]);

  const [sceneCount, setSceneCount] = useState<number | ''>('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [inputImageData, setInputImageData] = useState('');
  const [inputImageName, setInputImageName] = useState('');

  const [characterEnabled, setCharacterEnabled] = useState(false);
  const [characterSource, setCharacterSource] = useState<'upload' | 'generate'>('generate');
  const [generatingCharacter, setGeneratingCharacter] = useState(false);
  const [characterApproved, setCharacterApproved] = useState(false);
  const [characterImage, setCharacterImage] = useState('');
  const [originalCharacterImage, setOriginalCharacterImage] = useState('');
  const [characterName, setCharacterName] = useState('');
  const [characterAge, setCharacterAge] = useState('');
  const [characterGender, setCharacterGender] = useState('');
  const [characterRole, setCharacterRole] = useState('');
  const [characterPersonality, setCharacterPersonality] = useState('');
  const [characterAppearance, setCharacterAppearance] = useState('');
  const [characterRace, setCharacterRace] = useState('');
  const [characterBeard, setCharacterBeard] = useState('');
  const [characterArtStyle, setCharacterArtStyle] = useState('Realistic / Photography');
  const [characterHairStyle, setCharacterHairStyle] = useState('');
  const [videoStyle, setVideoStyle] = useState('Cinematic Commercial');
  const [preserveIdentity, setPreserveIdentity] = useState(true);
  const [useLogo, setUseLogo] = useState(true);
  const [characterUsage, setCharacterUsage] = useState('Main Character in all scenes');
  const [characterConsistencyStrength, setCharacterConsistencyStrength] = useState('Strict');
  const [previewImageModal, setPreviewImageModal] = useState<string | null>(null);

  const [audioEnabled, setAudioEnabled] = useState(true);
  const [audioMode, setAudioMode] = useState<AudioMode>('auto');
  const [audioTone, setAudioTone] = useState('professional');
  const [audioLanguageCode, setAudioLanguageCode] = useState('en');
  // TEMP (testing): allow selecting server music library by duration bucket.
  const [musicSource, setMusicSource] = useState<'tone' | 'library' | 'elevenlabs_ai'>('library');
  // Optional user-supplied AI music prompt. Empty → backend auto-derives
  // from the voice script + scene emotions.
  const [musicPrompt, setMusicPrompt] = useState<string>('');
  // Track favourite audio URLs so star icons render the right state.
  const [favouriteAudioUrls, setFavouriteAudioUrls] = useState<Set<string>>(new Set());
  const [musicTrack, setMusicTrack] = useState('');
  const [voiceVolume, setVoiceVolume] = useState(1);
  const [musicVolume, setMusicVolume] = useState(0.24);
  const [manualVoiceData, setManualVoiceData] = useState('');
  const [manualVoiceName, setManualVoiceName] = useState('');
  const [generatedTracks, setGeneratedTracks] = useState<any>(null);
  const [finalAudioUrl, setFinalAudioUrl] = useState('');

  const [finalVideoUrl, setFinalVideoUrl] = useState('');
  const [finalOutputUrl, setFinalOutputUrl] = useState('');

  // Manual handoff: set once the storyboard has been mailed to the team.
  const [handoffResult, setHandoffResult] = useState<{ sentTo: string; imageCount: number; attachedCount: number } | null>(null);

  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const pollAbortControllerRef = useRef<AbortController | null>(null);

  const selectedProduct = useMemo(
    () => products.find((p) => p._id === selectedProductId) || null,
    [products, selectedProductId]
  );

  // Removed automatic fetching of today's calendar suggestion on page load to prevent unwanted form pre-filling.

  const hasCompleteScenes = scenes.length > 0 && scenes.every((scene) => !!(
    String(scene.title || '').trim()
    && String(scene.imagePrompt || '').trim()
    && String(scene.videoPrompt || '').trim()
  ));
  const hasSceneImages = scenes.length > 0 && scenes.every((scene) => scene.imageUrl);
  const hasSceneClips = scenes.length > 0 && scenes.every((scene) => scene.clipUrl);
  const filteredVideoDrafts = useMemo(
    () => videoDrafts.filter((item) => statusFilter === 'all' || item.status === statusFilter),
    [videoDrafts, statusFilter]
  );

  useEffect(() => {
    const loadProducts = async () => {
      setLoadingProducts(true);
      try {
        const response = await inventoryAPI.getProducts();
        if (response?.success && Array.isArray(response?.data)) {
          setProducts(response.data);
        }
      } catch (_) {
        // Non-blocking
      } finally {
        setLoadingProducts(false);
      }
    };
    loadProducts();
  }, []);

  const loadVideoDrafts = async () => {
    try {
      const response = await videoGenerationAPI.getDrafts();
      if (response?.success && Array.isArray(response?.drafts)) {
        setVideoDrafts(response.drafts);
      }
    } catch (_) {
      // Non-blocking library refresh.
    }
    try {
      const response = await draftsAPI.getDrafts('draft', 'reel');
      if (response?.drafts) {
        setReelDraftsList(response.drafts);
      }
    } catch (_) { }
  };

  useEffect(() => {
    loadVideoDrafts();
  }, []);

  useEffect(() => {
    try {
      if (jobId) {
        localStorage.setItem('nebula_ai_video_wizard_jobId', jobId);
      } else {
        localStorage.removeItem('nebula_ai_video_wizard_jobId');
      }
    } catch (_) { }
  }, [jobId]);

  useEffect(() => {
    try {
      localStorage.setItem('nebula_ai_video_wizard_step', String(step));
    } catch (_) { }
  }, [step]);

  useEffect(() => {
    // Resume last open draft after refresh.
    try {
      const savedJobId = localStorage.getItem('nebula_ai_video_wizard_jobId') || '';
      if (!savedJobId) return;
      setShowWizard(true);
      setJobId(savedJobId);
      refreshDraft(savedJobId, { syncStep: true });
    } catch (_) {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deriveRawStepFromDraft = (d: any) => {
    // With the new Environment step at position 3, everything downstream
    // shifts +1. Max step is now 13 (Final Output).
    const explicit = Number.parseInt(String(d?.currentStep || ''), 10);
    if (Number.isFinite(explicit) && explicit >= 1) return Math.min(13, Math.max(1, explicit));
    if (d?.final?.finalOutputUrl || d?.finalOutputUrl) return 13;
    if (d?.schedule?.scheduledAt || d?.schedule?.postedAt) return 12;
    if (Array.isArray(d?.platform?.selectedPlatforms) && d.platform.selectedPlatforms.length) return 11;
    if (d?.content?.thumbnailUrl || d?.content?.caption) return 10;
    if (d?.merge?.finalOutputUrl || d?.merge?.finalVideoUrl) return 9;
    if (d?.mix?.finalAudioUrl) return 8;
    if (d?.audio?.tracks || d?.audio?.config) return 7;
    if (d?.clips?.sceneData?.length) return 6;
    if (d?.images?.sceneData?.length) return 5;
    if (d?.scenes?.sceneData?.length) return 4;
    if (d?.environment && (d.environment.enabled !== undefined || d.environment.referenceImages?.length)) return 3;
    if (d?.characterEnabled !== undefined || d?.videoStyle) return 2;
    return 1;
  };

  // Drafts created before the manual handoff can point at a clips/audio/merge
  // step that is no longer rendered. Snap those onto the handoff step so the
  // wizard never restores into a blank panel.
  const deriveStepFromDraft = (d: any) => {
    const raw = deriveRawStepFromDraft(d);
    return MANUAL_VIDEO_HANDOFF && PIPELINE_STEPS.includes(raw) ? HANDOFF_STEP : raw;
  };

  const resetActiveJobState = () => {
    setBusy(false);
    setActiveQueueJobId('');
    setActiveJobStatus('');
    setActiveJobProgress(0);
    setActiveJobStep('');
    setActiveJobLogs([]);
    setError('');
  };

  const handleCancelJob = async () => {
    if (pollAbortControllerRef.current) {
      pollAbortControllerRef.current.abort();
      pollAbortControllerRef.current = null;
    }

    if (!activeQueueJobId) {
      resetActiveJobState();
      return;
    }

    const jobIdToCancel = activeQueueJobId;
    setActiveJobStatus('cancelling');
    try {
      await videoGenerationAPI.cancelJob(jobIdToCancel);
    } catch (e: any) {
      console.error("Failed to cancel job on backend:", e.message);
    } finally {
      setTimeout(() => {
        resetActiveJobState();
      }, 1500);
    }
  };

  const pollJob = async (queueJobId: string, successCallback: (result: any) => void) => {
    setBusy(true);
    setError('');
    setActiveQueueJobId(queueJobId);
    setActiveJobStatus('queued');
    setActiveJobProgress(0);
    setActiveJobStep('queued');
    setActiveJobLogs(['[SYSTEM] Connected to background persistent queue.']);

    if (pollAbortControllerRef.current) {
      pollAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    pollAbortControllerRef.current = abortController;
    const signal = abortController.signal;

    const startedAt = Date.now();
    const timeoutMs = 20 * 60 * 1000;
    let pollDelayMs = 2000;
    let lastUpdatedAt = '';
    let unchangedTicks = 0;

    try {
      while (!signal.aborted) {
        if (Date.now() - startedAt > timeoutMs) {
          setActiveJobStatus('failed');
          throw new Error('Background task took too long. Please try again.');
        }

        let job: any;
        try {
          job = await videoGenerationAPI.getJobStatus(queueJobId);
          pollDelayMs = 2000;
        } catch (err: any) {
          const status = Number(err?.status || 0);
          if (status === 429) {
            pollDelayMs = Math.min(15000, Math.round(pollDelayMs * 1.8));
            await new Promise((r) => setTimeout(r, pollDelayMs));
            continue;
          }
          setActiveJobStatus('failed');
          throw err;
        }

        if (signal.aborted) break;

        const status = String(job?.status || '').toLowerCase();
        const progress = Number(job?.progress) || 0;
        const currentStep = String(job?.currentStep || '');
        const logs = Array.isArray(job?.logs) ? job.logs : [];
        const updatedAt = String(job?.updatedAt || '');

        setActiveJobStatus(status);
        setActiveJobProgress(progress);
        setActiveJobStep(currentStep);
        setActiveJobLogs(logs);

        if (updatedAt && updatedAt === lastUpdatedAt) {
          unchangedTicks += 1;
        } else {
          unchangedTicks = 0;
          lastUpdatedAt = updatedAt;
        }

        if (status === 'completed') {
          const result = job?.result;
          if (!result?.success) throw new Error(result?.message || 'Execution failed');
          await successCallback(result);
          resetActiveJobState();
          break;
        }

        if (status === 'cancelled') {
          setError('Job cancelled by user.');
          setTimeout(() => resetActiveJobState(), 2000);
          break;
        }

        if (status === 'failed') {
          setActiveJobStatus('failed');
          throw new Error(job?.error?.message || 'Execution failed');
        }

        if (unchangedTicks >= 5) {
          pollDelayMs = Math.min(15000, Math.round(pollDelayMs * 1.5));
        }

        await new Promise((r) => setTimeout(r, pollDelayMs));
      }
    } finally {
      if (pollAbortControllerRef.current === abortController) {
        pollAbortControllerRef.current = null;
      }
    }
  };

  const refreshDraft = async (id = jobId, options: { syncStep?: boolean } = {}) => {
    if (!id) return;
    const response = await videoGenerationAPI.getDraft(id);
    if (!response?.success) return;
    const nextDraft = response.draft;
    setDraft(nextDraft);
    setDescription(String(nextDraft?.input?.description || ''));
    if (Number.isFinite(Number(nextDraft?.input?.durationSeconds))) {
      setDurationSeconds(Number(nextDraft.input.durationSeconds));
    }
    if (Number.isFinite(Number(nextDraft?.input?.sceneCount))) {
      setSceneCount(Number(nextDraft.input.sceneCount));
    }
    // Restore the v3 Script + Scenes state (story arc + full voiceover).
    // We prefer scenesMetadata.voiceScript (rich v3 output) over the
    // older prompt.promptText — otherwise a hard refresh silently
    // overwrites the fresh voiceover with a stale strategy prompt.
    const restoredVoice = String(nextDraft?.scenesMetadata?.voiceScript || nextDraft?.prompt?.promptText || '').trim();
    if (restoredVoice) setPromptText(restoredVoice);
    const restoredStory = nextDraft?.scenesMetadata?.story || null;
    if (restoredStory && typeof restoredStory === 'object') {
      setStory({
        hook: String(restoredStory.hook || ''),
        beginning: String(restoredStory.beginning || ''),
        emotionalProgression: String(restoredStory.emotionalProgression || ''),
        climax: String(restoredStory.climax || ''),
        brandReveal: String(restoredStory.brandReveal || ''),
        ending: String(restoredStory.ending || ''),
      });
    }
    // Character bible + master cast image (persisted to draft during
    // /generateStoryAndSkeleton). Restore so Step 2 can re-render and
    // subsequent scene / image gen calls know who the cast is.
    if (Array.isArray(nextDraft?.characterBible) && nextDraft.characterBible.length) {
      setGeneratedCharacters(nextDraft.characterBible);
    }
    if (nextDraft?.castImageUrl) setCastImageUrl(nextDraft.castImageUrl);
    // Hydrate env lock config from draft so refresh preserves it.
    const draftEnv = nextDraft?.environment || nextDraft?.input?.environment || null;
    if (draftEnv && typeof draftEnv === 'object') {
      setEnvironmentEnabled(!!draftEnv.enabled);
      if (Array.isArray(draftEnv.referenceImages)) {
        setEnvironmentRefs(draftEnv.referenceImages.map((r: any) => ({
          url: r.url || '',
          dataUrl: r.dataUrl || '',
          source: r.source === 'brand-asset' ? 'brand-asset' : 'upload',
          alt: r.alt || ''
        })));
      }
      if (typeof draftEnv.notes === 'string') setEnvironmentNotes(draftEnv.notes);
    }
    setCharacterEnabled(!!nextDraft?.characterEnabled);
    setCharacterImage(nextDraft?.characterImage || '');
    setOriginalCharacterImage(nextDraft?.originalCharacterImage || '');
    setCharacterName(nextDraft?.characterName || '');
setCharacterAge(nextDraft?.characterAge || '');
    setCharacterGender(nextDraft?.characterGender || '');
    setCharacterRole(nextDraft?.characterRole || '');
    setCharacterPersonality(nextDraft?.characterPersonality || '');
    setCharacterAppearance(nextDraft?.characterAppearance || '');
    setCharacterHairStyle(nextDraft?.characterHairStyle || '');
    setCharacterRace(nextDraft?.characterRace || '');
    setCharacterBeard(nextDraft?.characterBeard || '');
    setCharacterArtStyle(nextDraft?.characterArtStyle || 'Realistic / Photography');
    if (nextDraft?.videoStyle) setVideoStyle(nextDraft.videoStyle);
    if (nextDraft?.preserveIdentity !== undefined) setPreserveIdentity(!!nextDraft.preserveIdentity);
    if (nextDraft?.characterUsage) setCharacterUsage(nextDraft.characterUsage);
    if (nextDraft?.characterConsistencyStrength) setCharacterConsistencyStrength(nextDraft.characterConsistencyStrength);
    const draftMusicSource = String(nextDraft?.audio?.config?.musicSource || '').toLowerCase();
    if (['tone', 'library', 'elevenlabs_ai'].includes(draftMusicSource)) {
      setMusicSource(draftMusicSource as 'tone' | 'library' | 'elevenlabs_ai');
    }
    if (nextDraft?.audio?.config?.musicPrompt) setMusicPrompt(String(nextDraft.audio.config.musicPrompt));
    setMusicTrack(String(nextDraft?.audio?.config?.musicTrack || ''));
    // Pick the RICHEST scene collection: whichever has clipUrls or
    // imageUrls populated, then merge clipUrls in from clips.sceneData
    // (may lag behind images.sceneData if user regenerated a clip but
    // image-gen was the last thing to write images.sceneData).
    // This guarantees a hard-refresh never wipes rendered clips.
    const clipsArr: any[] = Array.isArray(nextDraft?.clips?.sceneData) ? nextDraft.clips.sceneData : [];
    const imagesArr: any[] = Array.isArray(nextDraft?.images?.sceneData) ? nextDraft.images.sceneData : [];
    const scenesArr: any[] = Array.isArray(nextDraft?.scenes?.sceneData)
      ? nextDraft.scenes.sceneData
      : (Array.isArray(nextDraft?.scenes) ? nextDraft.scenes : []);
    // Prefer the collection with the MOST populated data (clipUrl > imageUrl).
    const score = (arr: any[]) => arr.reduce(
      (s, sc) => s + (sc?.clipUrl ? 2 : 0) + (sc?.imageUrl ? 1 : 0), 0
    );
    const candidates = [clipsArr, imagesArr, scenesArr].filter((a) => a.length);
    const baseArr = candidates.sort((a, b) => score(b) - score(a))[0] || [];
    if (baseArr.length) {
      // Overlay clipUrls / clipCloudUrls from clips.sceneData if base
      // is a different collection — this catches the case where image
      // gen ran last and left images.sceneData without clipUrl.
      const clipsByIndex = new Map<number, any>(clipsArr.map((s, i) => [i, s]));
      const merged = baseArr.map((s, i) => {
        const clipEntry = clipsByIndex.get(i);
        if (!clipEntry) return s;
        return {
          ...s,
          clipUrl: s.clipUrl || clipEntry.clipUrl,
          clipCloudUrl: s.clipCloudUrl || clipEntry.clipCloudUrl,
          falVideoUrl: s.falVideoUrl || clipEntry.falVideoUrl,
        };
      });
      setScenes(merged);
    }
    // Do NOT rehydrate audio.tracks on refresh — preview audio is
    // ephemeral (voice-specific) and rehydrating leads to the "random
    // voice plays on refresh" bug where the last-generated preview
    // was made with a different voice or from an enriched script. The
    // finalAudioUrl (mixed, ready-for-merge) IS worth keeping because
    // that's the finished asset for Step 7.
    if (nextDraft?.mix?.finalAudioUrl) setFinalAudioUrl(nextDraft.mix.finalAudioUrl);
    if (nextDraft?.merge?.finalVideoUrl) setFinalVideoUrl(nextDraft.merge.finalVideoUrl);
    if (nextDraft?.merge?.finalOutputUrl) setFinalOutputUrl(nextDraft.merge.finalOutputUrl);
    // Keeps the handoff step showing "Already Sent" after a refresh.
    if (nextDraft?.handoff?.requestedAt) {
      setHandoffResult({
        sentTo: String(nextDraft.handoff.recipient || ''),
        imageCount: Number(nextDraft.handoff.imageCount || 0),
        attachedCount: 0
      });
    }
    if (nextDraft?.content?.thumbnailUrl) setThumbnailUrl(nextDraft.content.thumbnailUrl);
    if (nextDraft?.content?.caption) setCaption(nextDraft.content.caption);
    if (Array.isArray(nextDraft?.content?.hashtags)) setHashtagsText(nextDraft.content.hashtags.join(' '));
    if (Array.isArray(nextDraft?.platform?.selectedPlatforms)) setSelectedPlatforms(nextDraft.platform.selectedPlatforms);
    if (nextDraft?.schedule?.scheduledAt) {
      const dateObj = new Date(nextDraft.schedule.scheduledAt);
      if (!Number.isNaN(dateObj.getTime())) {
        setScheduleDate(dateObj.toISOString().slice(0, 10));
        setScheduleTime(dateObj.toISOString().slice(11, 16));
      }
    }

    if (options.syncStep) {
      setStep(deriveStepFromDraft(nextDraft));
    }

    // Sync / resume running queue jobs after page refresh or load
    // Sync / resume running queue jobs after page refresh or load
    const draftJobs = (nextDraft && typeof nextDraft === 'object' ? nextDraft.jobs : null) || {};

    const resumeJob = (job: any, jobName: string, successCallback: (result: any) => void) => {
      if (job && ['queued', 'processing'].includes(String(job.status).toLowerCase())) {
        console.log(`Reconnecting to active ${jobName} job: ${job.queueJobId}`);
        pollJob(job.queueJobId, successCallback).catch((e: any) => {
          setError(e?.message || `${jobName} task failed.`);
          setActiveJobStatus('failed');
        });
        return true;
      }
      return false;
    };

    if (resumeJob(draftJobs.scenes, 'scenes', (result) => {
      setScenes(result.sceneData || []);
      setDraft(result.draft || nextDraft);
    })) return;

    if (resumeJob(draftJobs.images, 'images', (result) => {
      setScenes(result.sceneData || []);
      setDraft(result.draft || nextDraft);
    })) return;

    if (resumeJob(draftJobs.clips, 'clips', (result) => {
      setScenes(result.sceneData || []);
      setDraft(result.draft || nextDraft);
    })) return;

    if (resumeJob(draftJobs.audio, 'audio', (result) => {
      setGeneratedTracks(result?.audio?.tracks || null);
      setDraft(result?.draft || nextDraft);
    })) return;

    if (resumeJob(draftJobs.mix, 'mix', (result) => {
      setFinalAudioUrl(result.finalAudioUrl || '');
      setDraft(result.draft || nextDraft);
    })) return;

    if (resumeJob(draftJobs.merge, 'merge', async (result) => {
      setFinalVideoUrl(result?.merge?.finalVideoUrl || result?.draft?.merge?.finalVideoUrl || '');
      setFinalOutputUrl(result?.merge?.finalOutputUrl || result?.draft?.merge?.finalOutputUrl || '');
      setDraft(result?.draft || nextDraft);
      await loadVideoDrafts();
    })) return;
  };

  useEffect(() => {
    const qJobId = searchParams.get('jobId');
    if (!qJobId) return;

    setJobId(qJobId);
    setShowWizard(true);
    refreshDraft(qJobId, { syncStep: true });

    // If this job is still rendering in the background (Smart Calendar's
    // "Approve & Generate Reel" path), keep pulling the draft so the wizard
    // fills in and advances step-by-step while the user watches. A one-shot
    // refresh would only ever show whatever stage had completed on arrival.
    let cancelled = false;
    let timer: number | undefined;

    const watch = async () => {
      if (cancelled) return;
      let job: any = null;
      try {
        job = await videoGenerationAPI.getJobStatus(qJobId);
      } catch {
        // Transient failure — try again on the next tick.
      }

      if (cancelled) return;

      if (job) {
        const status = String(job.status || '').toLowerCase();
        setActiveQueueJobId(qJobId);
        setActiveJobStatus(status || 'running');
        setActiveJobProgress(Number(job.progress) || 0);
        setActiveJobStep(String(job.currentStep || job.step || ''));

        updateBackgroundReel({
          progress: Number(job.progress) || 0,
          step: String(job.currentStep || job.step || ''),
          status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running'
        });

        // Pull the draft on every tick — that is what repaints the wizard.
        await refreshDraft(qJobId, { syncStep: true });

        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          setBusy(false);
          if (status === 'failed') setError(job.error || 'Reel generation failed.');
          return; // stop watching
        }
      }

      timer = window.setTimeout(watch, 5000);
    };

    watch();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [searchParams]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
      setActiveJobStatus('failed');
    } finally {
      setBusy(false);
    }
  };

  const onInputImage = async (file?: File | null) => {
    if (!file) return;
    const data = await fileToDataUrl(file);
    setInputImageData(data);
    setInputImageName(file.name);
    setSelectedProductId('');
  };

  const onSceneImageReplace = async (sceneId: string, file?: File | null) => {
    if (!jobId || !file) return;
    const data = await fileToDataUrl(file);
    await withBusy(async () => {
      const response = await videoGenerationAPI.generateImages({
        jobId,
        action: 'replace',
        sceneId,
        imageData: data
      });
      if (response?.success) {
        setScenes(response.sceneData || []);
        setDraft(response.draft || draft);
      }
    });
  };

  const onManualVoiceUpload = async (file?: File | null) => {
    if (!file) return;
    const data = await fileToDataUrl(file);
    setManualVoiceData(data);
    setManualVoiceName((file as File).name || 'voice-file');
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) {
          const data = await fileToDataUrl(blob);
          setManualVoiceData(data);
          setManualVoiceName('recorded-voice.webm');
        }
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      setError('Microphone access denied or unavailable.');
    }
  };

  const stopVoiceRecording = () => {
    recorderRef.current?.stop();
    setIsRecording(false);
  };

  // Toggle a generated audio track (voice / music / mix) as a
  // favourite — persisted to businessProfile.brandAssets.favouriteAudioTracks.
  const toggleFavouriteAudio = async (
    url: string,
    kind: 'voice' | 'music' | 'mix',
    meta: { label?: string; prompt?: string; durationSeconds?: number; languageCode?: string; voiceId?: string } = {}
  ) => {
    if (!url) return;
    // Optimistic
    setFavouriteAudioUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
    try {
      await videoGenerationAPI.toggleFavouriteAudio({ url, kind, ...meta });
    } catch (e: any) {
      // Revert on failure
      setFavouriteAudioUrls((prev) => {
        const next = new Set(prev);
        if (next.has(url)) next.delete(url); else next.add(url);
        return next;
      });
      setError(e?.message || 'Failed to save favourite audio');
    }
  };

  // Hydrate the favourite-audio Set once on mount so star icons render
  // correct state when the audio players first render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp: any = await videoGenerationAPI.listFavouriteAudio();
        if (!cancelled && resp?.success && Array.isArray(resp.tracks)) {
          setFavouriteAudioUrls(new Set(resp.tracks.map((t: any) => String(t?.url || '')).filter(Boolean)));
        }
      } catch (_) { /* non-blocking */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const buildAudioPayload = (overrides: Record<string, any> = {}) => ({
    enabled: audioEnabled,
    mode: audioEnabled ? audioMode : 'off',
    languageCode: audioLanguageCode,
    tone: audioTone,
    musicSource,
    musicTrack: musicTrack.trim() || undefined,
    musicPrompt: musicSource === 'elevenlabs_ai' ? (musicPrompt.trim() || undefined) : undefined,
    voiceGender,
    voiceId: selectedVoiceId || undefined,
    voiceVolume,
    musicVolume,
    manualAudioData: audioMode === 'upload' ? manualVoiceData : undefined,
    ...overrides
  });

  // Fetch ElevenLabs voices whenever the user lands on Step 6 audio
  // config OR changes language / gender. Cached in state so switching
  // tabs doesn't re-fire the network call.
  const loadElevenLabsVoices = async (opts: { includeMultilingual?: boolean } = {}) => {
    setVoiceCatalogLoading(true);
    setVoiceCatalogError('');
    try {
      const resp: any = await videoGenerationAPI.listElevenLabsVoices({
        // Must match the language TTS will actually speak (buildAudioPayload
        // sends audioLanguageCode), not the Step 1 script language — otherwise
        // picking Tamil here still lists English voices.
        languageCode: audioLanguageCode || 'en',
        gender: voiceGender || undefined,
        includeMultilingual: !!opts.includeMultilingual
      });
      if (!resp?.success) {
        setVoiceCatalog([]);
        setVoiceCatalogNativeCount(0);
        setVoiceCatalogCanFallback(false);
        setVoiceCatalogError(resp?.message || 'Failed to load ElevenLabs voices');
      } else {
        setVoiceCatalog(Array.isArray(resp.voices) ? resp.voices : []);
        setVoiceCatalogNativeCount(Number(resp.nativeCount) || 0);
        setVoiceCatalogCanFallback(!!resp.canFallback);
      }
    } catch (e: any) {
      setVoiceCatalog([]);
      setVoiceCatalogError(e?.message || 'Failed to load ElevenLabs voices');
    } finally {
      setVoiceCatalogLoading(false);
    }
  };

  const toggleFavouriteVoice = async (voice: ElevenLabsVoice) => {
    // Optimistic toggle so the star reacts instantly
    setVoiceCatalog((prev) => prev.map((v) =>
      v.voiceId === voice.voiceId ? { ...v, isFavourite: !v.isFavourite } : v
    ));
    try {
      await videoGenerationAPI.toggleFavouriteVoice({
        voiceId: voice.voiceId,
        name: voice.name,
        gender: voice.gender,
        language: audioLanguageCode,
        accent: voice.accent,
        previewUrl: voice.previewUrl,
        category: voice.category
      });
    } catch (e: any) {
      // Revert on failure
      setVoiceCatalog((prev) => prev.map((v) =>
        v.voiceId === voice.voiceId ? { ...v, isFavourite: !v.isFavourite } : v
      ));
      setError(e?.message || 'Failed to save favourite voice');
    }
  };

  const previewVoice = (voice: ElevenLabsVoice) => {
    if (voicePreviewAudioRef.current) {
      try { voicePreviewAudioRef.current.pause(); } catch (_) { /* noop */ }
      voicePreviewAudioRef.current = null;
    }
    if (voicePreviewId === voice.voiceId) {
      setVoicePreviewId('');
      return;
    }
    if (!voice.previewUrl) return;
    const audio = new Audio(voice.previewUrl);
    audio.onended = () => setVoicePreviewId('');
    audio.play().catch((err) => {
      console.warn('Voice preview play failed:', err);
      setVoicePreviewId('');
    });
    voicePreviewAudioRef.current = audio;
    setVoicePreviewId(voice.voiceId);
  };

  // Reset the multilingual-fallback opt-in whenever the language
  // changes — user must explicitly opt in for each language.
  // Also invalidate any cached audio preview since the language
  // (and therefore the whole voiceover) is now different.
  useEffect(() => {
    setVoiceIncludeMultilingual(false);
    setSelectedVoiceId('');
    setGeneratedTracks(null);
    setFinalAudioUrl('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioLanguageCode]);

  // When the user picks a different voice, invalidate the last preview.
  // Prevents the "random voice plays on refresh" confusion — the audio
  // player will only show something after the user explicitly renders.
  useEffect(() => {
    setGeneratedTracks(null);
    setFinalAudioUrl('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVoiceId, voiceGender]);

  // Auto-fetch ElevenLabs voices when the user reaches Step 6, or when
  // language / gender / fallback-toggle changes (which invalidates the
  // current catalog). Placed below loadElevenLabsVoices to avoid TDZ.
  useEffect(() => {
    if (step !== 6) return;
    if (!audioEnabled || audioMode !== 'auto') return;
    loadElevenLabsVoices({ includeMultilingual: voiceIncludeMultilingual });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, audioLanguageCode, voiceGender, audioEnabled, audioMode, voiceIncludeMultilingual]);

  const ensureDraftForAudioTest = async (fallbackDescription = '') => {
    if (jobId) return jobId;
    const effectiveDescription = description.trim() || fallbackDescription.trim();
    if (!effectiveDescription) {
      throw new Error('Description is required');
    }

    const response = await videoGenerationAPI.createDraft({
      description: effectiveDescription,
      durationSeconds,
      sceneCount: sceneCount || undefined,
      imageData: inputImageData || undefined,
      productId: selectedProduct?._id || undefined,
      product: selectedProduct || undefined,
      aspectRatio,
      languageCode,
      environment: environmentEnabled ? {
        enabled: true,
        referenceImages: environmentRefs.map((r) => ({
          url: r.url || '',
          dataUrl: r.dataUrl || '',
          source: r.source
        })),
        notes: environmentNotes
      } : { enabled: false, referenceImages: [], notes: '' }
    } as any);
    if (!response?.success || !response?.jobId) {
      throw new Error(response?.message || 'Failed to create draft');
    }
    setJobId(response.jobId);
    setDraft(response.draft || null);
    await loadVideoDrafts();
    return response.jobId;
  };

  const step1Next = async () => withBusy(async () => {
    await ensureDraftForAudioTest();
    setStep(2);
  });

  const step2Next = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    await videoGenerationAPI.updateDraft(jobId, {
      characterEnabled,
      characterImage,
      originalCharacterImage,
      characterName,
      characterAge,
      characterGender,
      characterRole,
      characterPersonality,
      characterAppearance,
      characterHairStyle,
      characterRace,
      characterBeard,
      characterArtStyle,
      videoStyle,
      preserveIdentity,
      characterUsage,
      characterConsistencyStrength,
      currentStep: 3
    });
    // Step 2 → new Step 3 (Environment). The Env step's Save & Next
    // handler advances to Step 4 (Script + Scenes).
    setStep(3);
  });

  // Load brand-asset images the first time the user opens the Env
  // step (idempotent — reuses the same cache after).
  const loadBrandAssetImages = async () => {
    if (brandAssetImages.length > 0) return;
    setBrandAssetsLoading(true);
    try {
      const resp: any = await videoGenerationAPI.listBrandAssetImages();
      if (resp?.success) setBrandAssetImages(Array.isArray(resp.images) ? resp.images : []);
    } catch (e) {
      console.warn('Failed to load brand-asset images:', e);
    } finally {
      setBrandAssetsLoading(false);
    }
  };

  const onEnvironmentUpload = async (file?: File | null) => {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setEnvironmentRefs((prev) => [
      ...prev,
      { dataUrl, source: 'upload' as const, alt: file.name }
    ].slice(0, 5));
  };

  const toggleBrandAssetInEnv = (img: { url: string; alt: string; isLogo: boolean }) => {
    setEnvironmentRefs((prev) => {
      const exists = prev.some((r) => r.url === img.url);
      if (exists) return prev.filter((r) => r.url !== img.url);
      return [...prev, { url: img.url, source: 'brand-asset' as const, alt: img.alt }].slice(0, 5);
    });
  };

  const removeEnvironmentRef = (idx: number) => {
    setEnvironmentRefs((prev) => prev.filter((_, i) => i !== idx));
  };

  const step3EnvNext = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    // Persist to backend so scene / image / clip pipelines can read it.
    await videoGenerationAPI.updateEnvironment({
      jobId,
      environment: {
        enabled: environmentEnabled,
        referenceImages: environmentEnabled ? environmentRefs.map((r) => ({
          url: r.url || '',
          dataUrl: r.dataUrl || '',
          source: r.source
        })) : [],
        notes: environmentEnabled ? environmentNotes : ''
      }
    });
    setStep(4);
  });

  const startAutoGenerate = async () => withBusy(async () => {
    const effectiveDescription = description.trim();
    if (!effectiveDescription) {
      throw new Error('Description is required');
    }

    const payload = {
      description: effectiveDescription,
      durationSeconds,
      sceneCount: sceneCount || undefined,
      imageData: inputImageData || undefined,
      productId: selectedProduct?._id || undefined,
      product: selectedProduct || undefined,
      videoType: 'reel',
      aspectRatio,
      languageCode,
      environment: environmentEnabled ? {
        enabled: true,
        referenceImages: environmentRefs.map((r) => ({
          url: r.url || '',
          dataUrl: r.dataUrl || '',
          source: r.source
        })),
        notes: environmentNotes
      } : { enabled: false, referenceImages: [], notes: '' },
      audio: buildAudioPayload(),
      characterEnabled,
      characterImage,
      originalCharacterImage,
      characterName,
      characterAge,
      characterGender,
      characterRole,
      characterPersonality,
      characterAppearance,
      characterHairStyle,
      characterRace,
      characterBeard,
      characterArtStyle,
      videoStyle,
      preserveIdentity,
      characterUsage,
      characterConsistencyStrength
    };

    const response = await videoGenerationAPI.createVideo(payload);
    if (!response?.success) {
      throw new Error(response?.message || 'Failed to start auto generation');
    }

    setSuccessMessage('Saved to Drafts. Video is generating in background.');
    resetWizard(true);
    setStatusFilter('draft');
  });

  const handleGenerateCharacterPreview = async () => {
    if (characterSource === 'generate' && !characterName && !characterRole && !characterAppearance) {
      setError('Please provide some character details to generate a preview.');
      return;
    }
    if (characterSource === 'upload' && !originalCharacterImage) {
      setError('Please upload a character image first.');
      return;
    }
    setGeneratingCharacter(true);
    setError('');
    setCharacterApproved(false);
    try {
      const response = await videoGenerationAPI.generateCharacterPreview({
        name: characterName,
        age: characterAge,
        gender: characterGender,
        hairStyle: characterHairStyle,
        beard: characterBeard,
        race: characterRace,
        role: characterRole,
        personality: characterPersonality,
        artStyle: characterArtStyle,
        videoStyle: videoStyle,
        appearance: characterAppearance,
        characterImageBase64: originalCharacterImage
      });
      if (response?.success && response?.imageUrl) {
        setCharacterImage(response.imageUrl);
      } else {
        throw new Error(response?.error || 'Failed to generate preview');
      }
    } catch (err: any) {
      setError(err.message || 'Error generating character preview');
    } finally {
      setGeneratingCharacter(false);
    }
  };

  // v3 SEQUENTIAL generation — instead of asking OpenAI for all 10 richly
  // detailed scenes in one massive JSON (which truncates and drops fields),
  // we split into two phases:
  //   Phase 1: /generateStoryAndSkeleton — returns story + voiceover +
  //            skeleton scenes (title + duration + purpose). ~5-10s.
  //   Phase 2: /generateSingleScene called sequentially per scene. Each
  //            scene enrichment is its own ~2000-token request so nothing
  //            gets truncated. Scene N appears in the UI the moment it's
  //            ready while scene N+1 is generating in the background.
  const generatePromptAndScenes = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing. Complete step 1 first.');

    // 1) Generate the structured strategy prompt (writes draft.prompt).
    const promptResp = await videoGenerationAPI.generatePrompt({
      jobId,
      saveOnly: false as any,
    });
    const structured = (promptResp as any)?.prompt?.promptText || promptResp?.draft?.prompt?.promptText || '';

    // 2) Phase 1 — get story + voiceover + skeleton scenes.
    // Pass the accepted characters + master cast image URL so every
    // scene routes through those specific people and image gen keeps
    // faces identical to the approved cast.
    const skelResp: any = await videoGenerationAPI.generateStoryAndSkeleton({
      jobId,
      promptText: structured || (description || '').trim(),
      characters: generatedCharacters,
      castImageUrl: castImageUrl || characterImage || '',
    });
    if (!skelResp?.success) {
      throw new Error(skelResp?.message || 'Story + skeleton generation failed');
    }

    // Show story + voiceover + skeleton scenes immediately so the user
    // sees something the moment Phase 1 returns (~5-10s).
    const respStory = skelResp?.story || skelResp?.draft?.scenesMetadata?.story || null;
    if (respStory) {
      setStory({
        hook: String(respStory.hook || ''),
        beginning: String(respStory.beginning || ''),
        emotionalProgression: String(respStory.emotionalProgression || ''),
        climax: String(respStory.climax || ''),
        brandReveal: String(respStory.brandReveal || ''),
        ending: String(respStory.ending || ''),
      });
    }
    const respVoice = skelResp?.voiceScript || skelResp?.draft?.scenesMetadata?.voiceScript || '';
    if (respVoice) setPromptText(respVoice);
    const skeletonScenes: any[] = Array.isArray(skelResp?.sceneData) ? skelResp.sceneData : [];
    setScenes(skeletonScenes);
    setDraft(skelResp?.draft || draft);
    setTotalScenesForRun(skeletonScenes.length);

    // 3) Phase 2 — enrich each scene sequentially. Update UI as each
    // completes so users see progress in real time.
    for (let i = 0; i < skeletonScenes.length; i++) {
      setPendingSceneIndex(i);
      try {
        const sceneResp: any = await videoGenerationAPI.generateSingleScene({
          jobId,
          sceneIndex: i,
          characters: generatedCharacters,
          castImageUrl: castImageUrl || characterImage || '',
        });
        if (sceneResp?.success && sceneResp?.scene) {
          setScenes((prev) => prev.map((s, idx) => idx === i ? sceneResp.scene : s));
        }
      } catch (err) {
        // One scene failing shouldn't abort the whole run.
        console.warn('Scene', i + 1, 'enrichment failed:', err);
      }
    }
    setPendingSceneIndex(null);
    setTotalScenesForRun(0);
  });

  const saveStep2EditsAndNext = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    await videoGenerationAPI.generatePrompt({
      jobId,
      promptText,
      saveOnly: true
    });
    const sceneResponse = await videoGenerationAPI.generateScenes({
      jobId,
      sceneData: scenes,
      saveOnly: true
    });
    setScenes(sceneResponse?.sceneData || scenes);
    setDraft(sceneResponse?.draft || draft);
    setStep(5);
  });

  // v3 SEQUENTIAL scene image generation. Loops through every scene and
  // fires /generateSingleSceneImage one at a time so each image appears
  // in the UI the moment Nano Banana returns it — no big-batch wait, and
  // the user can see progress live. The cast image from Step 2 is passed
  // as an identity anchor so every face matches the approved characters.
  const generateSceneImages = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('No scenes yet — generate Script + Scenes first.');
    }
    const anchor = castImageUrl || characterImage || '';
    console.log('🎭 Sequential image gen · scenes:', scenes.length, '· cast anchor:', anchor ? '✓' : '(none)');
    setTotalScenesForRun(scenes.length);
    for (let i = 0; i < scenes.length; i++) {
      setPendingSceneIndex(i);
      try {
        const resp: any = await videoGenerationAPI.generateSingleSceneImage({
          jobId,
          sceneIndex: i,
          castImageUrl: anchor,
          aspectRatio
        } as any);
        if (resp?.success && resp?.scene) {
          setScenes((prev) => prev.map((s, idx) => idx === i ? { ...s, ...resp.scene } : s));
          if (resp.draft) setDraft(resp.draft);
        }
      } catch (err) {
        console.warn('Scene image', i + 1, 'failed:', err);
      }
    }
    setPendingSceneIndex(null);
    setTotalScenesForRun(0);
  });

  // Toggle the brand-logo overlay on a single scene image.
  // mode: 'watermark' (subtle corner) | 'prominent' (larger, wall-sign
  // style — used for brand-reveal / end scene) | 'off' (restore clean).
  const applyLogoToScene = async (sceneIdx: number, mode: 'watermark' | 'prominent' | 'off') => {
    if (!jobId) { setError('Draft missing'); return; }
    const scene = scenes[sceneIdx];
    if (!scene) return;
    const sid = String(scene.sceneId || sceneIdx);
    markSceneRegenerating(sid, true);
    try {
      const resp: any = await videoGenerationAPI.applySceneLogo({ jobId, sceneIndex: sceneIdx, mode });
      if (!resp?.success) throw new Error(resp?.message || 'Failed to apply logo');
      if (resp?.scene) {
        setScenes((prev) => prev.map((s, i) => i === sceneIdx ? { ...s, ...resp.scene } : s));
      }
      if (resp?.draft) setDraft(resp.draft);
    } catch (e: any) {
      setError(e?.message || 'Failed to apply logo');
    } finally {
      markSceneRegenerating(sid, false);
    }
  };

  // Apply the logo to EVERY scene in one click. Uses 'prominent' for
  // the last scene (brand reveal) and 'watermark' for the rest.
  const applyLogoToAllScenes = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    if (!Array.isArray(scenes) || scenes.length === 0) return;
    for (let i = 0; i < scenes.length; i++) {
      const isLast = i === scenes.length - 1;
      try {
        await applyLogoToScene(i, isLast ? 'prominent' : 'watermark');
      } catch (e) {
        console.warn('Logo apply failed for scene', i + 1, e);
      }
    }
  });

  const removeLogoFromAllScenes = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    for (let i = 0; i < scenes.length; i++) {
      try { await applyLogoToScene(i, 'off'); } catch (_) { /* noop */ }
    }
  });

  const regenerateSceneImage = async (scene: any) => {
    if (!jobId) { setError('Draft missing'); return; }
    const sid = String(scene.sceneId || '');
    // Find the scene's index in the current scenes array (source of
    // truth for the single-scene endpoint).
    const sceneIdx = scenes.findIndex((s) => String(s.sceneId || '') === sid);
    if (sceneIdx < 0) {
      setError('Scene not found for regeneration');
      return;
    }
    markSceneRegenerating(sid, true);
    setError('');
    try {
      // Use the SAME single-scene endpoint that "Generate All" uses so
      // env references, logo, and aspect ratio flow through consistently.
      // The old /generateImages batch endpoint bypassed env/logo which
      // caused regenerated scenes to drift into generic backdrops.
      const anchor = castImageUrl || characterImage || '';
      const resp: any = await videoGenerationAPI.generateSingleSceneImage({
        jobId,
        sceneIndex: sceneIdx,
        castImageUrl: anchor,
        aspectRatio
      } as any);
      if (!resp?.success) throw new Error(resp?.message || 'Image regeneration failed');
      if (resp?.scene) {
        setScenes((prev) => prev.map((s, i) => i === sceneIdx ? { ...s, ...resp.scene } : s));
      }
      if (resp.draft) setDraft(resp.draft);
    } catch (e: any) {
      setError(e?.message || 'Image regeneration failed');
    } finally {
      markSceneRegenerating(sid, false);
    }
  };

  const regenerateScene = async (scene: any) => {
    if (!jobId) { setError('Draft missing'); return; }
    const sid = String(scene.sceneId || '');
    markSceneRegenerating(sid, true);
    setError('');
    try {
      const response = await videoGenerationAPI.generateScenes({
        jobId,
        sceneData: scenes,
        regenerateSceneId: scene.sceneId,
        promptText
      });
      if (!response?.success) throw new Error(response?.message || 'Scene regeneration failed');
      setScenes(response.sceneData || []);
      setDraft(response.draft || draft);
    } catch (e: any) {
      setError(e?.message || 'Scene regeneration failed');
    } finally {
      markSceneRegenerating(sid, false);
    }
  };

  // SEQUENTIAL per-scene clip generation. Loops through every scene
  // firing /generateSingleVideoClip one at a time so each clip lands
  // in the UI the moment Kling returns it. Skips scenes that already
  // have a clipUrl (allowing partial-retry after mid-run API exhaust).
  const generateClips = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    if (!Array.isArray(scenes) || scenes.length === 0) {
      throw new Error('No scenes to render — generate scenes + images first.');
    }
    setTotalScenesForRun(scenes.length);
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      if (s.clipUrl) continue; // already rendered — skip so partial runs resume free
      if (!s.imageUrl) {
        console.warn(`Scene ${i + 1} skipped: no imageUrl`);
        continue;
      }
      setPendingSceneIndex(i);
      try {
        const resp: any = await videoGenerationAPI.generateSingleVideoClip({
          jobId,
          sceneIndex: i,
          aspectRatio
        });
        if (resp?.success && resp?.scene) {
          setScenes((prev) => prev.map((sc, idx) => idx === i ? { ...sc, ...resp.scene } : sc));
          if (resp.draft) setDraft(resp.draft);
        }
      } catch (err: any) {
        console.warn('Scene clip', i + 1, 'failed:', err?.message || err);
        setError(`Scene ${i + 1} clip failed: ${err?.message || err}`);
      }
    }
    setPendingSceneIndex(null);
    setTotalScenesForRun(0);
  });

  // Regenerate a single scene's clip. If `tweak` is provided, it's
  // appended to the Kling prompt as a hard override (user gets to
  // steer motion / performance for that specific shot).
  const regenerateSceneClip = async (sceneIdx: number, tweak: string = '') => {
    if (!jobId) { setError('Draft missing'); return; }
    const scene = scenes[sceneIdx];
    if (!scene) return;
    const sid = String(scene.sceneId || sceneIdx);
    markSceneRegenerating(sid, true);
    setError('');
    try {
      const resp: any = await videoGenerationAPI.generateSingleVideoClip({
        jobId,
        sceneIndex: sceneIdx,
        regenTweak: tweak,
        aspectRatio
      });
      if (!resp?.success) throw new Error(resp?.message || 'Clip regeneration failed');
      if (resp.scene) {
        setScenes((prev) => prev.map((sc, idx) => idx === sceneIdx ? { ...sc, ...resp.scene } : sc));
      }
      if (resp.draft) setDraft(resp.draft);
    } catch (e: any) {
      setError(e?.message || 'Clip regeneration failed');
    } finally {
      markSceneRegenerating(sid, false);
    }
  };

  const generateAudioPreview = async () => withBusy(async () => {
    const audioJobId = await ensureDraftForAudioTest(description);
    const response = await videoGenerationAPI.generateAudio({
      jobId: audioJobId,
      audio: buildAudioPayload(),
      async: true
    });

    const queueJobId = response?.queueJobId;
    if (queueJobId) {
      await pollJob(queueJobId, async (result) => {
        setGeneratedTracks(result?.audio?.tracks || null);
        setFinalAudioUrl('');
        setDraft(result?.draft || draft);
      });
      return;
    }

    if (!response?.success) throw new Error(response?.message || 'Audio generation failed');
    setGeneratedTracks(response?.audio?.tracks || null);
    setFinalAudioUrl('');
    setDraft(response?.draft || draft);
  });

  const generateAudioTracks = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.generateAudio({
      jobId,
      audio: buildAudioPayload(),
      async: true
    });

    const queueJobId = response?.queueJobId;
    if (queueJobId) {
      await pollJob(queueJobId, async (result) => {
        setGeneratedTracks(result?.audio?.tracks || null);
        setDraft(result?.draft || draft);
        setStep(8);
      });
      return;
    }

    if (!response?.success) throw new Error(response?.message || 'Audio generation failed');
    setGeneratedTracks(response?.audio?.tracks || null);
    setDraft(response?.draft || draft);
    setStep(8);
  });

  // Mails the whole storyboard — identity, steps 1-5 and the rendered scene
  // images — to the Nebulaa team, who cut the video off-platform.
  const sendToTeam = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.requestManualVideo({ jobId });
    if (!response?.success) throw new Error(response?.message || 'Could not send your request');
    setHandoffResult({
      sentTo: String(response.sentTo || ''),
      imageCount: Number(response.imageCount || 0),
      attachedCount: Number(response.attachedCount || 0)
    });
    setDraft(response.draft || draft);
  });

  const mixAudio = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.mixAudio({
      jobId,
      tracks: generatedTracks || draft?.audio?.tracks || {},
      durationSeconds,
      async: true
    });

    const queueJobId = response?.queueJobId;
    if (queueJobId) {
      await pollJob(queueJobId, async (result) => {
        setFinalAudioUrl(result.finalAudioUrl || '');
        setDraft(result.draft || draft);
      });
      return;
    }

    if (!response?.success) throw new Error(response?.message || 'Audio mix failed');
    setFinalAudioUrl(response.finalAudioUrl || '');
    setDraft(response.draft || draft);
  });

  const mergeVideo = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.mergeVideo({
      jobId,
      finalAudioUrl: finalAudioUrl || undefined,
      async: true
    });

    const queueJobId = response?.queueJobId;
    if (queueJobId) {
      await pollJob(queueJobId, async (result) => {
        setFinalVideoUrl(result?.merge?.finalVideoUrl || result?.draft?.merge?.finalVideoUrl || '');
        setFinalOutputUrl(result?.merge?.finalOutputUrl || result?.draft?.merge?.finalOutputUrl || '');
        setDraft(result?.draft || draft);
        await loadVideoDrafts();
      });
      return;
    }

    if (!response?.success) throw new Error(response?.message || 'Video merge failed');
    setFinalVideoUrl(response?.merge?.finalVideoUrl || '');
    setFinalOutputUrl(response?.merge?.finalOutputUrl || '');
    setDraft(response?.draft || draft);
    await loadVideoDrafts();
  });

  const generateContent = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.generateContent({
      jobId,
      selectedPlatforms
    });
    if (!response?.success) throw new Error(response?.message || 'Content generation failed');
    const content = response?.content || {};
    setThumbnailUrl(content.thumbnailUrl || '');
    setCaption(content.caption || '');
    setHashtagsText(Array.isArray(content.hashtags) ? content.hashtags.join(' ') : '');
    setDraft(response?.draft || draft);
  });

  const schedulePost = async (publishNow = false) => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    if (!selectedPlatforms.length) throw new Error('Select at least one platform');

    let scheduledAt: string | undefined = undefined;
    if (!publishNow) {
      if (!scheduleDate || !scheduleTime) throw new Error('Select date and time');
      scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
    }

    const response = await videoGenerationAPI.schedulePost({
      jobId,
      selectedPlatforms,
      scheduledAt,
      publishNow
    });
    if (!response?.success) throw new Error(response?.message || 'Scheduling failed');
    setDraft(response?.draft || draft);
    await refreshDraft(jobId);
    await loadVideoDrafts();
    setSuccessMessage(response?.message || (publishNow ? 'Post queued for immediate publish.' : 'Post scheduled successfully.'));
    setStatusFilter(publishNow ? 'posted' : 'scheduled');
    // Keep wizard open and land on Final Output so user can see the rendered video
    setStep(13);
  });

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) => (
      prev.includes(platform)
        ? prev.filter((item) => item !== platform)
        : [...prev, platform]
    ));
  };

  const resetWizard = (startNew = true) => {
    if (startNew) {
      setShowWizard(true);
      setJobId('');
      setDraft(null);
      setDescription('');
      setSelectedProductId('');
      setInputImageData('');
      setInputImageName('');
      setPromptText('');
      setScenes([]);
      setGeneratedTracks(null);
      setFinalAudioUrl('');
      setFinalVideoUrl('');
      setFinalOutputUrl('');
      setHandoffResult(null);
      setThumbnailUrl('');
      setCaption('');
      setHashtagsText('');
      setSelectedPlatforms([]);
      setScheduleDate('');
      setScheduleTime('');
      setSuccessMessage('');
    }
    setStep(1);
    resetActiveJobState();
  };

  const openVideoDraft = async (id: string) => {
    setShowWizard(true);
    setJobId(id);
    await refreshDraft(id, { syncStep: true });
  };

  const deleteVideoDraft = async (id: string, title = 'this AI video') => {
    if (!id || deletingDraftId) return;
    const ok = window.confirm(`Delete "${title}"? This will remove the draft and generated video files.`);
    if (!ok) return;

    setDeletingDraftId(id);
    setError('');
    try {
      const response = await videoGenerationAPI.deleteDraft(id);
      if (!response?.success) {
        throw new Error(response?.message || 'Failed to delete AI video');
      }
      setVideoDrafts((prev) => prev.filter((item) => item.jobId !== id));
      if (jobId === id) {
        resetWizard();
        setShowWizard(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to delete AI video');
    } finally {
      setDeletingDraftId('');
    }
  };

  const deleteGlobalDraft = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!id || deletingDraftId) return;
    const ok = window.confirm(`Delete this draft? This will permanently remove the draft.`);
    if (!ok) return;

    setDeletingDraftId(id);
    setError('');
    try {
      const response = await draftsAPI.deleteDraft(id);
      if (!response?.success) {
        throw new Error('Failed to delete draft');
      }
      setReelDraftsList((prev) => prev.filter((item) => item._id !== id));
      if (jobId === id) {
        resetWizard();
        setShowWizard(false);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to delete draft');
    } finally {
      setDeletingDraftId('');
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'posted') return 'Posted';
    if (status === 'scheduled') return 'Scheduled';
    if (status === 'created') return 'Created';
    return 'Draft';
  };

  const statusPillClass = (status: string) => {
    if (status === 'posted') return 'bg-green-500/15 text-green-300 border-green-500/30';
    if (status === 'scheduled') return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    if (status === 'created') return 'bg-[#ffcc29]/15 text-[#ffcc29] border-[#ffcc29]/30';
    return isDarkMode ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-300';
  };

  const primaryButtonClass = (disabled: boolean) => `px-6 py-3 rounded-xl font-bold transition-colors ${disabled
    ? (isDarkMode
      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
      : 'bg-slate-200 text-slate-400 cursor-not-allowed')
    : 'bg-[#ffcc29] text-black hover:bg-[#f0bd18]'
    }`;

  const canStep1Next = !busy && !!description.trim();
  const canStep2Next = !busy && hasCompleteScenes;
  const canStep3Next = !busy && hasSceneImages;
  const canStep4Next = !busy && hasSceneClips;
  const canStep5Next = !busy && (!audioEnabled || audioMode !== 'upload' || !!manualVoiceData);
  const canAudioPreview = !busy && (!audioEnabled || audioMode !== 'upload' || !!manualVoiceData);
  const canStep6Next = !busy && (!audioEnabled || !!finalAudioUrl);
  const canStep7Next = !busy && !!(finalOutputUrl || finalVideoUrl);
  const canStep8Next = !busy && !!caption.trim();
  const canStep9Next = !busy && selectedPlatforms.length > 0;
  const canSchedule = !busy && !!scheduleDate && !!scheduleTime;
  // The Step 3 voiceScript is the SOURCE OF TRUTH — that's what the
  // user wrote / approved. The audio pipeline no longer rewrites it
  // (see runGenerateAudio backend). Display order:
  //   1. draft.scenesMetadata.voiceScript  (Step 3 output, canonical)
  //   2. local promptText state             (in-progress edit)
  //   3. draft.audio.config.voiceScript     (last-used, backwards compat)
  const activeAudioScript = String(
    draft?.scenesMetadata?.voiceScript ||
    promptText ||
    draft?.audio?.config?.voiceScript ||
    ''
  ).trim();

  return (
    <div className={`p-6 min-h-screen ${isDarkMode ? 'bg-[#070A12]' : 'bg-slate-50'}`}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className={`text-2xl font-bold ${theme.text}`}>AI Video Manager</h1>
          <p className={theme.textSecondary}>Create, schedule, and track your AI videos in one place.</p>
        </div>

        {successMessage && (
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${isDarkMode
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
            {successMessage}
          </div>
        )}

        <div className={`border-b overflow-x-auto ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
          <div className="flex space-x-6 min-w-max">
            {[
              { id: 'create', label: 'Create', icon: Plus },
              { id: 'all', label: 'All AI Videos', icon: null },
              { id: 'draft', label: 'Drafts', icon: null },
              { id: 'created', label: 'Created', icon: null },
              { id: 'scheduled', label: 'Scheduled', icon: null },
              { id: 'posted', label: 'Posted', icon: null }
            ].map((tab) => {
              const active = tab.id === 'create' ? showWizard : (!showWizard && statusFilter === tab.id);
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (tab.id === 'create') {
                      resetWizard();
                    } else {
                      setShowWizard(false);
                      setStatusFilter(tab.id as VideoStatusFilter);
                      setSuccessMessage('');
                    }
                  }}
                  className={`pb-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${active
                    ? 'border-[#ffcc29] text-[#ffcc29]'
                    : `border-transparent ${theme.text} hover:text-[#ffcc29] hover:border-[#ffcc29]/30`
                    }`}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {!showWizard && (
          <div className="space-y-4">
            {statusFilter === 'draft' ? (
              reelDraftsList.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                  {reelDraftsList.map((item) => (
                    <div
                      key={item._id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        const vurl = getVideoUrl(item);
                        if (vurl) setPreviewDraft({ ...item, __videoUrl: vurl });
                        else openVideoDraft(item.generationProgress?.jobId || item._id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const vurl = getVideoUrl(item);
                          if (vurl) setPreviewDraft({ ...item, __videoUrl: vurl });
                          else openVideoDraft(item.generationProgress?.jobId || item._id);
                        }
                      }}
                      className={`text-left rounded-2xl border overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 hover:border-[#ffcc29]/50' : 'bg-white border-slate-200 hover:border-[#ffcc29]/60'}`}
                    >
                      <div className="relative">
                        {(() => {
                          // Reel/video drafts sometimes store the finished MP4 in
                          // imageUrl or creative.videoUrl. Detect a video URL and
                          // render a <video> preview instead of a broken <img>.
                          const url = item.imageUrl || item.creative?.videoUrl || '';
                          const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || /\/video\/upload\//i.test(url);
                          if (isVideo) {
                            return (
                              <video
                                src={url}
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                                onMouseLeave={(e) => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                                className="w-full h-44 object-cover bg-slate-900"
                              />
                            );
                          }
                          if (url) return <img src={url} alt={item.title} className="w-full h-44 object-cover" />;
                          return (
                            <div className={`w-full h-44 flex items-center justify-center ${isDarkMode ? 'bg-slate-900' : 'bg-slate-100'}`}>
                              <Film className="w-8 h-8 text-slate-500" />
                            </div>
                          );
                        })()}
                        <button
                          onClick={(e) => deleteGlobalDraft(item._id, e)}
                          disabled={deletingDraftId === item._id}
                          title="Delete draft"
                          aria-label="Delete draft"
                          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/65 text-white flex items-center justify-center transition hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {deletingDraftId === item._id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      <div className="p-4 space-y-3">
                        <p className={`text-base font-semibold leading-snug ${theme.text} line-clamp-2`}>
                          {item.title}
                        </p>
                        <p className={`text-xs ${theme.textSecondary} line-clamp-2`}>
                          {item.caption || 'No caption'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20">
                  <p className={`font-semibold ${theme.text}`}>No drafts found.</p>
                </div>
              )
            ) : filteredVideoDrafts.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {filteredVideoDrafts.map((item) => (
                  <div
                    key={item.jobId}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      const vurl = getVideoUrl(item);
                      if (vurl) setPreviewDraft({ ...item, __videoUrl: vurl });
                      else openVideoDraft(item.jobId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const vurl = getVideoUrl(item);
                        if (vurl) setPreviewDraft({ ...item, __videoUrl: vurl });
                        else openVideoDraft(item.jobId);
                      }
                    }}
                    className={`text-left rounded-2xl border overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 hover:border-[#ffcc29]/50' : 'bg-white border-slate-200 hover:border-[#ffcc29]/60'
                      }`}
                  >
                    <div className="relative">
                      {(() => {
                        const videoUrl = item.finalVideoUrl || item.merge?.finalOutputUrl || item.merge?.finalVideoUrl || '';
                        if (item.thumbnailUrl) return <img src={item.thumbnailUrl} alt={item.title} className="w-full h-44 object-cover" />;
                        if (videoUrl) {
                          return (
                            <video
                              src={videoUrl}
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                              onMouseLeave={(e) => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                              className="w-full h-44 object-cover bg-slate-900"
                            />
                          );
                        }
                        return (
                          <div className={`w-full h-44 flex items-center justify-center ${isDarkMode ? 'bg-slate-900' : 'bg-slate-100'}`}>
                            <Film className="w-8 h-8 text-slate-500" />
                          </div>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteVideoDraft(item.jobId, item.title);
                        }}
                        disabled={deletingDraftId === item.jobId}
                        title="Delete AI video"
                        aria-label="Delete AI video"
                        className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/65 text-white flex items-center justify-center transition hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {deletingDraftId === item.jobId ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-base font-semibold leading-snug ${theme.text}`}
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {item.title}
                        </p>
                        <span className={`shrink-0 px-2.5 py-1 rounded-full border text-[11px] font-bold ${statusPillClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </div>
                      <div className={`flex flex-wrap gap-2 text-xs ${theme.textSecondary}`}>
                        {item.durationSeconds && <span>{item.durationSeconds}s</span>}
                        {item.sceneCount && <span>{item.sceneCount} scenes</span>}
                        {item.platforms?.length > 0 && <span>{item.platforms.join(', ')}</span>}
                      </div>
                      {item.scheduledAt && (
                        <p className={`text-xs ${theme.textSecondary}`}>Scheduled for {new Date(item.scheduledAt).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`${panelClass} p-8 text-center`}>
                <Film className="w-8 h-8 mx-auto text-[#ffcc29] mb-3" />
                <p className={`font-semibold ${theme.text}`}>No AI videos in this tab yet.</p>
                <p className={`text-sm mt-1 ${theme.textSecondary}`}>Create a new AI video to see it here.</p>
              </div>
            )}
          </div>
        )}

        {showWizard && (
          <>
            <div className={`${panelClass} p-4`}>
              <div className="grid grid-cols-2 md:grid-cols-6 lg:grid-cols-11 gap-2">
                {WIZARD_STEPS.map(({ label, step: stepNo }, idx) => {
                  // Display position is sequential (1..n) so hiding the
                  // pipeline steps doesn't leave gaps like "6, 10, 11".
                  const displayNo = idx + 1;
                  const active = stepNo === step;
                  const done = stepNo < step;
                  // Final Output is also reachable any time the final video has been rendered
                  const finalReady = stepNo === FINAL_OUTPUT_STEP && !!(finalOutputUrl || finalVideoUrl);
                  const clickable = done || finalReady;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => clickable && setStep(stepNo)}
                      disabled={!clickable && !active}
                      className={`text-xs px-2 py-2 rounded-lg border transition ${active
                        ? 'bg-[#ffcc29] text-black border-[#ffcc29] font-bold'
                        : done
                          ? (isDarkMode
                            ? 'bg-slate-800 border-slate-700 text-slate-100'
                            : 'bg-slate-100 border-slate-300 text-slate-800')
                          : (isDarkMode
                            ? 'bg-slate-900 border-slate-800 text-slate-500'
                            : 'bg-slate-50 border-slate-200 text-slate-400')
                        }`}
                    >
                      {displayNo}. {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {step > 1 && step < 11 && (
              <button
                type="button"
                onClick={() => setStep((current) => previousVisibleStep(current))}
                disabled={busy}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-colors ${busy
                  ? (isDarkMode ? 'border-slate-800 text-slate-600 cursor-not-allowed' : 'border-slate-200 text-slate-400 cursor-not-allowed')
                  : (isDarkMode ? 'border-slate-600 text-slate-200 hover:border-[#ffcc29] hover:text-[#ffcc29]' : 'border-slate-300 text-slate-700 hover:border-[#ffcc29] hover:text-[#b88f00]')
                  }`}
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {activeQueueJobId && (
              <div className={`mt-6 p-6 rounded-2xl border shadow-xl flex flex-col gap-4 ${isDarkMode ? 'bg-[#0f141c]/90 border-slate-700/80' : 'bg-white/95 border-slate-200'
                }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-[#ffcc29] animate-spin" />
                    <div>
                      <h3 className={`font-bold ${theme.text}`}>Background Worker Processing...</h3>
                      <p className={`text-xs ${theme.textSecondary}`}>
                        Job: <span className="font-mono text-[#ffcc29]">{activeQueueJobId}</span> | Status: <span className="capitalize">{activeJobStatus}</span>
                      </p>
                    </div>
                  </div>
                  <span className="text-xl font-black text-[#ffcc29]">{activeJobProgress}%</span>
                </div>

                {/* Progress Bar */}
                <div className={`w-full h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                  <div
                    className="h-full bg-gradient-to-r from-[#ffcc29] to-[#f0bd18] transition-all duration-500 ease-out"
                    style={{ width: `${activeJobProgress}%` }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'
                    }`}>
                    Step: {activeJobStep || 'Initializing'}
                  </span>
                  <div>
                    {activeJobStatus === 'failed' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => resetWizard(false)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-blue-500/20 text-blue-300 border border-blue-500/40 hover:bg-blue-500/30"
                        >
                          <RefreshCcw className="w-3.5 h-3.5" />
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelJob}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleCancelJob}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Cancel Generation
                      </button>
                    )}
                  </div>
                </div>

                {/* Terminal Logs Viewer */}
                <div className="flex flex-col">
                  <div className={`flex items-center justify-between px-4 py-2 text-xs font-mono border-b ${isDarkMode ? 'bg-[#0b0f17] border-slate-800 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-600'
                    } rounded-t-xl`}>
                    <span>CONSOLE OUTPUT</span>
                    <span>Streaming Live</span>
                  </div>
                  <div className={`p-4 font-mono text-xs overflow-y-auto max-h-48 flex flex-col gap-1 rounded-b-xl border border-t-0 ${isDarkMode ? 'bg-[#070b12] border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`} style={{ scrollBehavior: 'smooth' }}>
                    {activeJobLogs.length > 0 ? (
                      activeJobLogs.map((logLine, index) => (
                        <div key={index} className={logLine.includes('FAILED') ? 'text-red-400' : logLine.includes('completed') ? 'text-emerald-400' : ''}>
                          {logLine}
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-500 italic">Waiting for console stream...</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h2 className={`font-bold text-lg ${theme.text}`}>Step 1: Input</h2>
                  <div className="flex flex-col items-end gap-2">
                    {isCalendarLoading && <span className="inline-flex items-center gap-1.5 text-[11px] text-white/60"><Loader2 className="w-3 h-3 animate-spin" /> Loading Smart Calendar…</span>}
                  </div>
                </div>

                {/* Smart Calendar suggestions — always visible on Step 1 so
                    the user knows why tiles are/aren't showing. Four states:
                    loading, disabled (autoGenerate off), enabled-but-empty,
                    or tiles available. */}
                {!isCalendarLoading && !isAutoFillEnabled && (
                  <div className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 flex items-start justify-between gap-3`}>
                    <div className="flex-1">
                      <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.textMuted}`}>Smart Calendar · off</p>
                      <p className={`text-[13px] mt-1 ${theme.text}`}>
                        Turn on Smart Calendar to see AI-generated reel briefs as tiles here.
                      </p>
                      <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>
                        Or just describe your video manually below.
                      </p>
                    </div>
                    <a
                      href="#/content-calendar"
                      className="px-3 py-1.5 text-[11px] rounded-md border border-[#F5A623]/60 text-[#F5A623] hover:bg-[#F5A623]/10 font-semibold whitespace-nowrap"
                    >
                      Open Calendar →
                    </a>
                  </div>
                )}
                {isAutoFillEnabled && availableItems.length > 0 && (
                  <div className="rounded-xl border border-[#F5A623]/30 bg-[#F5A623]/[0.04] p-4 space-y-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#F5A623]">
                          Smart Calendar · {availableItems.length} pending reel{availableItems.length > 1 ? 's' : ''} this week
                        </p>
                        <p className={`text-[12px] mt-1 ${theme.textSecondary}`}>
                          Approve one to load its brief as your input. Or scroll down and write manually.
                        </p>
                      </div>
                      {selectedItemId && (
                        <button
                          onClick={() => { setSelectedItemId(''); setDescription(''); setPromptText(''); }}
                          className="text-[11px] text-white/50 hover:text-white/85"
                        >
                          Clear selection
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {availableItems.map((item) => {
                        const isSelected = selectedItemId === item._id;
                        return (
                          <div
                            key={item._id}
                            className={`relative rounded-lg border p-3 transition-all ${
                              isSelected
                                ? 'border-[#F5A623] bg-[#F5A623]/10 ring-1 ring-[#F5A623]/40'
                                : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-[#F5A623]/20 text-[#F5A623]">
                                {item.format || 'Reel'}
                              </span>
                              {item.contentPillar && (
                                <span className={`text-[10px] uppercase tracking-wide ${theme.textMuted}`}>
                                  {item.contentPillar}
                                </span>
                              )}
                            </div>
                            <h4 className={`font-semibold text-sm mt-2 line-clamp-2 ${theme.text}`}>
                              {item.headline || 'Untitled scene'}
                            </h4>
                            {item.creativeConcept && (
                              <p className={`text-[12px] mt-1.5 line-clamp-3 ${theme.textSecondary}`}>
                                {item.creativeConcept}
                              </p>
                            )}
                            <div className={`flex flex-wrap gap-2 mt-2.5 text-[10px] ${theme.textMuted}`}>
                              {item.objective && <span>🎯 {item.objective}</span>}
                              {item.cta && <span>📢 {item.cta}</span>}
                              {item.productNeeded && <span>📦 {item.productNeeded}</span>}
                            </div>
                            <button
                              onClick={() => setSelectedItemId(item._id)}
                              disabled={isSelected}
                              className={`mt-3 w-full px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                                isSelected
                                  ? 'bg-[#F5A623] text-black cursor-default'
                                  : 'border border-[#F5A623]/60 text-[#F5A623] hover:bg-[#F5A623]/10'
                              }`}
                            >
                              {isSelected ? '✓ Approved — loaded as input' : 'Approve & Use This'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {isAutoFillEnabled && availableItems.length === 0 && !isCalendarLoading && (
                  <div className={`rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[12px] ${theme.textSecondary}`}>
                    No pending reels in the Smart Calendar for this week. Write your video description below to create manually.
                  </div>
                )}

                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={`${inputClass} min-h-[120px]`}
                  placeholder={selectedItemId ? 'Loaded from Smart Calendar — you can edit before continuing…' : 'Or describe your own video here…'}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Duration</label>
                    <select value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} className={`${inputClass} mt-2`}>
                      {[15, 30, 45, 60, 90, 120].map((item) => <option key={item} value={item}>{item} sec</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Aspect Ratio</label>
                    <select
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                      className={`${inputClass} mt-2`}
                    >
                      <option value="9:16">9:16 · Reels / Shorts (vertical)</option>
                      <option value="16:9">16:9 · YouTube (widescreen)</option>
                      <option value="1:1">1:1 · Instagram Square</option>
                      <option value="4:5">4:5 · Instagram Feed (portrait)</option>
                    </select>
                    <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>Images & clips render in this ratio.</p>
                  </div>
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Video Language</label>
                    <select
                      value={languageCode}
                      onChange={(e) => setLanguageCode(e.target.value as VideoLang)}
                      className={`${inputClass} mt-2`}
                    >
                      <option value="en">English</option>
                      <option value="hi">Hindi (हिन्दी)</option>
                      <option value="ta">Tamil (தமிழ்)</option>
                      <option value="te">Telugu (తెలుగు)</option>
                      <option value="kn">Kannada (ಕನ್ನಡ)</option>
                      <option value="ml">Malayalam (മലയാളം)</option>
                    </select>
                    <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>Script + voiceover in this language.</p>
                  </div>
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Voice Gender</label>
                    <select
                      value={voiceGender}
                      onChange={(e) => {
                        setVoiceGender(e.target.value as 'male' | 'female');
                        // Reset the selected voice so the user re-picks
                        // from the new gender's catalog on Step 6.
                        setSelectedVoiceId('');
                      }}
                      className={`${inputClass} mt-2`}
                    >
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                    <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>Filters the voice list on Audio Config.</p>
                  </div>
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Scene Count (Optional)</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={sceneCount}
                      onChange={(e) => setSceneCount(e.target.value ? Number(e.target.value) : '')}
                      className={`${inputClass} mt-2`}
                    />
                  </div>
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Upload Product Image (Optional)</label>
                    <input type="file" accept="image/*" className="mt-2 text-sm" onChange={(e) => onInputImage(e.target.files?.[0])} />
                    {inputImageName && <p className={`text-xs mt-1 ${theme.textSecondary}`}>{inputImageName}</p>}
                  </div>
                </div>
                <div>
                  <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>OR Select Product</label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => {
                      setSelectedProductId(e.target.value);
                      if (e.target.value) {
                        setInputImageData('');
                        setInputImageName('');
                      }
                    }}
                    className={`${inputClass} mt-2`}
                  >
                    <option value="">{loadingProducts ? 'Loading products...' : 'No product selected'}</option>
                    {products.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}
                  </select>
                </div>

                <div className="flex flex-wrap gap-3">
                  {/* Generate Concept — creates 3 creative-director options
                      the user must approve one before proceeding. */}
                  <button
                    onClick={async () => {
                      if (!description.trim()) {
                        setConceptError('Describe the video first.');
                        return;
                      }
                      setConceptError('');
                      setGeneratingConcepts(true);
                      setAcceptedConceptId('');
                      setConcepts([]);
                      try {
                        const res = await videoGenerationAPI.generateConcepts({
                          description: description.trim(),
                          durationSeconds: Number(durationSeconds) || 30,
                        });
                        if (!res?.success || !Array.isArray(res.concepts) || res.concepts.length === 0) {
                          throw new Error(res?.message || 'No concepts returned. Try again.');
                        }
                        setConcepts(res.concepts as VideoConcept[]);
                        setConceptsRecommended(res.recommended || '');
                        setConceptsReason(res.recommendationReason || '');
                      } catch (e: any) {
                        setConceptError(e?.message || 'Failed to generate concepts.');
                      } finally {
                        setGeneratingConcepts(false);
                      }
                    }}
                    disabled={generatingConcepts || !description.trim()}
                    className={`px-6 py-3 rounded-xl font-bold transition-colors ${
                      generatingConcepts || !description.trim()
                        ? 'bg-[#F5A623]/40 text-[#1A1208]/50 cursor-not-allowed'
                        : 'bg-[#F5A623] text-[#1A1208] hover:bg-[#ffb833]'
                    }`}
                  >
                    {generatingConcepts ? (
                      <><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Generating concepts…</>
                    ) : concepts.length > 0 ? '↻ Regenerate concepts' : '✨ Generate Concept'}
                  </button>
                  <button
                    onClick={step1Next}
                    disabled={!canStep1Next || (concepts.length > 0 && !acceptedConceptId)}
                    className={primaryButtonClass(!canStep1Next || (concepts.length > 0 && !acceptedConceptId))}
                    title={concepts.length > 0 && !acceptedConceptId ? 'Accept a concept first' : undefined}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Next'}
                  </button>
                  <button
                    onClick={startAutoGenerate}
                    disabled={!canStep1Next || (concepts.length > 0 && !acceptedConceptId)}
                    className={`px-6 py-3 rounded-xl font-bold transition-colors ${
                      !canStep1Next || (concepts.length > 0 && !acceptedConceptId)
                        ? 'bg-blue-900/50 text-blue-500/50 cursor-not-allowed'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                    title={concepts.length > 0 && !acceptedConceptId ? 'Accept a concept first' : undefined}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Auto-Generate Full Video'}
                  </button>
                </div>

                {conceptError && (
                  <div className="mt-3 text-sm text-red-400">{conceptError}</div>
                )}

                {/* Concept cards — shown after Generate Concept runs.
                    User must click Accept on one before Next/Auto-Generate
                    become clickable. Regenerate re-runs the endpoint. */}
                {concepts.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-white/[0.08] space-y-4">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F5A623]">
                          Creative Director · 3 concepts
                        </div>
                        <div className={`text-sm mt-1 ${theme.textSecondary}`}>
                          Pick one to build the video around. Recommendation highlighted in gold.
                        </div>
                      </div>
                      {acceptedConceptId && (
                        <div className="text-[11px] text-[#4ADE80] font-semibold">
                          ✓ Accepted — you can proceed
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {concepts.map((c) => {
                        const isRecommended = c.id === conceptsRecommended;
                        const isAccepted = c.id === acceptedConceptId;
                        return (
                          <div
                            key={c.id}
                            className={`rounded-2xl border p-5 transition-all ${
                              isAccepted
                                ? 'border-[#4ADE80]/60 bg-[#4ADE80]/[0.04]'
                                : isRecommended
                                  ? 'border-[#F5A623]/50 bg-[#F5A623]/[0.03]'
                                  : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]'
                            }`}
                          >
                            <div className="flex items-baseline justify-between mb-2">
                              <span className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                isRecommended ? 'text-[#F5A623]' : 'text-white/45'
                              }`}>
                                {c.type}
                              </span>
                              {isRecommended && (
                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#F5A623]">
                                  ★ Pick
                                </span>
                              )}
                            </div>
                            <h3 className="text-[17px] font-semibold text-[#F5F4F1] leading-snug mb-3">{c.title}</h3>

                            <dl className="space-y-3 text-[12.5px]">
                              <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 mb-1">Core Emotion</dt>
                                <dd className="text-[#F5F4F1]">{c.coreEmotion}</dd>
                              </div>
                              <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 mb-1">Big Idea</dt>
                                <dd className="text-white/75 leading-relaxed">{c.bigIdea}</dd>
                              </div>
                              <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 mb-1">Story</dt>
                                <dd className="text-white/75 leading-relaxed">{c.storySummary}</dd>
                              </div>
                              <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 mb-1">Why it works</dt>
                                <dd className="text-white/60 leading-relaxed">{c.whyItWorks}</dd>
                              </div>
                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <div>
                                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 mb-1">Visual</dt>
                                  <dd className="text-white/70 leading-snug">{c.visualStyle}</dd>
                                </div>
                                <div>
                                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 mb-1">Music</dt>
                                  <dd className="text-white/70 leading-snug">{c.musicStyle}</dd>
                                </div>
                              </div>
                              <div className="pt-2 border-t border-white/[0.06]">
                                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 mb-1">Ending</dt>
                                <dd className="text-[#F5F4F1] italic">"{c.endingMessage}"</dd>
                              </div>
                            </dl>

                            <button
                              onClick={() => {
                                setAcceptedConceptId(c.id);
                                setAcceptedConcept(c);
                                // Fold the concept into the description so the
                                // downstream pipeline (storyboard, images, video)
                                // has all the direction it needs.
                                const merged = [
                                  description.trim(),
                                  '',
                                  '--- APPROVED CREATIVE CONCEPT ---',
                                  'Title: ' + c.title,
                                  'Core emotion: ' + c.coreEmotion,
                                  'Big idea: ' + c.bigIdea,
                                  'Story: ' + c.storySummary,
                                  'Visual style: ' + c.visualStyle,
                                  'Music style: ' + c.musicStyle,
                                  'Ending: ' + c.endingMessage,
                                ].join('\n');
                                setDescription(merged);
                                // Reset any previously generated characters
                                // so Step 2 refires generation for this new concept.
                                setGeneratedCharacters([]);
                                setAcceptedCharacterId('');
                              }}
                              className={`mt-4 w-full h-10 rounded-lg font-semibold text-[13px] transition-colors ${
                                isAccepted
                                  ? 'bg-[#4ADE80] text-[#0A2A0F]'
                                  : 'bg-white/[0.08] hover:bg-[#F5A623] text-[#F5F4F1] hover:text-[#1A1208]'
                              }`}
                            >
                              {isAccepted ? '✓ Accepted' : 'Accept this concept'}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {conceptsReason && (
                      <div className="mt-4 p-4 rounded-xl border border-[#F5A623]/20 bg-[#F5A623]/[0.03]">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F5A623] mb-1">
                          Why we recommend it
                        </div>
                        <div className="text-[13px] text-white/75 leading-relaxed">{conceptsReason}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
            <div className={`p-6 space-y-6 ${panelClass}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-xl font-bold ${theme.text}`}>Character & Video Style Configuration</h2>
                {acceptedConcept && (
                  <div className="text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F5A623]">
                      Concept
                    </div>
                    <div className={`text-sm ${theme.text}`}>{acceptedConcept.title}</div>
                  </div>
                )}
              </div>

              {/* Auto-generated Character Bible — Character Prompt.docx.
                  Fires on Step 2 entry when an accepted concept exists. */}
              {!acceptedConcept ? (
                <div className="mb-6 p-6 rounded-2xl border border-[#F5A623]/25 bg-[#F5A623]/[0.03] text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F5A623] mb-2">
                    Concept required
                  </div>
                  <div className={`text-sm ${theme.text} mb-1`}>
                    Head back to Step 1 and accept a creative concept first.
                  </div>
                  <div className={`text-xs ${theme.textSecondary} mb-4`}>
                    The Character Designer builds characters specifically for the story you approve.
                  </div>
                  <button
                    onClick={() => setStep(1)}
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208] text-[13px] font-semibold"
                  >
                    ← Back to Step 1
                  </button>
                </div>
              ) : (
                <div className="mb-6 p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F5A623]">
                        Character Bible · from your accepted concept
                      </div>
                      <div className={`text-xs mt-1 ${theme.textSecondary}`}>
                        Pick a character to build the video around. You can regenerate for a fresh cast.
                      </div>
                    </div>
                    <button
                      onClick={runCharacterGeneration}
                      disabled={generatingCharacters2}
                      className={`px-4 py-2 rounded-lg font-semibold text-xs transition-colors ${
                        generatingCharacters2 ? 'bg-[#F5A623]/40 text-[#1A1208]/50 cursor-not-allowed' : 'bg-white/[0.08] hover:bg-[#F5A623] text-[#F5F4F1] hover:text-[#1A1208]'
                      }`}
                    >
                      {generatingCharacters2 ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Generating…</>
                      ) : (generatedCharacters.length > 0 ? '↻ Regenerate' : '✨ Generate')}
                    </button>
                  </div>

                  {characterGenError && <div className="text-sm text-red-400 mb-3">{characterGenError}</div>}

                  {generatingCharacters2 && generatedCharacters.length === 0 && (
                    <div className="flex items-center gap-2 py-6 justify-center text-white/50 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Designing characters that match your concept…
                    </div>
                  )}

                  {generatedCharacters.length > 0 && (
                    <div className="mt-4 space-y-4">
                      {/* MASTER CAST REFERENCE — single wide image with all
                          characters + numbered labels. This is what the video
                          pipeline uses as the identity anchor for every scene. */}
                      <div className="relative rounded-xl border border-white/[0.10] bg-[#0A0A0A] overflow-hidden">
                        <div className="relative aspect-[16/9] w-full bg-[#0A0A0A]">
                          {castImageUrl ? (
                            <img src={castImageUrl} alt="Master cast reference" className="w-full h-full object-contain" />
                          ) : castImageLoading ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/60">
                              <Loader2 className="w-8 h-8 animate-spin text-[#F5A623]" />
                              <span className="text-[12px]">Rendering the master cast reference…</span>
                              <span className="text-[10.5px] text-white/40">Everyone in one frame with numbered labels · ~20-30s</span>
                            </div>
                          ) : castImageError ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-4">
                              <span className="text-[11px] text-red-400">{castImageError}</span>
                              <button
                                onClick={() => renderCastReferenceImage()}
                                className="mt-1 h-8 px-3 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-[12px] font-semibold text-[#F5F4F1]"
                              >Retry</button>
                            </div>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/40 text-[12px]">Cast image will appear here</div>
                          )}
                          {acceptedCharacterId && (
                            <div className="absolute top-3 right-3 h-6 px-2 rounded-full bg-[#4ADE80] text-[#0A2A0F] text-[10px] font-bold uppercase tracking-wider flex items-center">
                              ✓ Cast approved
                            </div>
                          )}
                        </div>

                        {/* Numbered chip legend under the image */}
                        <div className="border-t border-white/[0.06] px-4 py-3 flex flex-wrap gap-2 bg-white/[0.02]">
                          {generatedCharacters.map((ch) => {
                            const isPrimary = ch.id === acceptedCharacterId;
                            return (
                              <button
                                key={ch.id}
                                onClick={() => {
                                  // Click a chip to set that character as the
                                  // PRIMARY identity anchor for the video.
                                  setAcceptedCharacterId(ch.id);
                                  setCharacterEnabled(true);
                                  setPreserveIdentity(true);
                                  setCharacterName(ch.name);
                                  if (typeof setCharacterAge === 'function') setCharacterAge(ch.age);
                                  if (typeof setCharacterGender === 'function') setCharacterGender(ch.gender);
                                  if (typeof setCharacterRole === 'function') setCharacterRole(ch.role);
                                  if (typeof setCharacterAppearance === 'function') setCharacterAppearance(ch.appearance);
                                  if (typeof setCharacterHairStyle === 'function') setCharacterHairStyle(ch.hairStyle);
                                  if (typeof setCharacterPersonality === 'function') setCharacterPersonality(ch.personality);
                                  if (typeof setCharacterSource === 'function') setCharacterSource('generate');
                                  // Cast image (with everyone) becomes the
                                  // reference sent to the pipeline. Even if
                                  // only one primary is selected, the full
                                  // cast is preserved for cross-scene identity.
                                  if (castImageUrl && typeof setCharacterImage === 'function') {
                                    setCharacterImage(castImageUrl);
                                  }
                                }}
                                title={ch.name + ' · ' + ch.role}
                                className={`inline-flex items-center gap-2 h-8 pl-1.5 pr-3 rounded-full border text-[11.5px] font-medium transition-colors ${
                                  isPrimary
                                    ? 'border-[#4ADE80] bg-[#4ADE80]/[0.1] text-[#4ADE80]'
                                    : 'border-white/[0.10] bg-white/[0.03] text-white/80 hover:border-[#F5A623]/50 hover:text-[#F5F4F1]'
                                }`}
                              >
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                  isPrimary ? 'bg-[#4ADE80] text-[#0A2A0F]' : 'bg-white/[0.10] text-white/70'
                                }`}>
                                  {ch.id}
                                </span>
                                <span className="text-white/85">{ch.name}</span>
                                <span className="text-white/40">·</span>
                                <span className="text-white/50">{ch.role}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Regenerate cast image with optional tweak */}
                      <div className="flex flex-col md:flex-row gap-2">
                        <input
                          type="text"
                          value={castTweakPrompt}
                          onChange={(e) => setCastTweakPrompt(e.target.value)}
                          placeholder="Tweak the cast image: e.g. 'warmer lighting', 'traditional attire', 'add glasses to father'"
                          className="flex-1 h-10 px-3 rounded-md bg-white/[0.04] border border-white/[0.08] text-[12.5px] text-[#F5F4F1] placeholder:text-white/30 focus:outline-none focus:border-[#F5A623]/60"
                        />
                        <button
                          onClick={() => renderCastReferenceImage()}
                          disabled={castImageLoading || !castReferencePrompt}
                          className={`h-10 px-4 rounded-md font-semibold text-[12.5px] transition-colors ${
                            castImageLoading || !castReferencePrompt
                              ? 'bg-white/[0.04] text-white/35 cursor-not-allowed'
                              : 'bg-white/[0.08] hover:bg-[#F5A623] text-[#F5F4F1] hover:text-[#1A1208]'
                          }`}
                        >
                          {castImageLoading ? 'Rendering…' : (castTweakPrompt.trim() ? '↻ Regenerate with tweak' : '↻ Regenerate cast image')}
                        </button>
                      </div>

                      {/* Compact character bible list (text) */}
                      <details className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
                        <summary className="cursor-pointer px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50 hover:text-white/80">
                          Character bible — full details
                        </summary>
                        <div className="px-4 pb-4 space-y-3">
                          {generatedCharacters.map((ch) => (
                            <div key={ch.id} className="border-t border-white/[0.06] pt-3 first:border-t-0 first:pt-0">
                              <div className="flex items-baseline justify-between mb-1">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-[10px] font-bold text-[#F5A623] tabular-nums">{ch.id}</span>
                                  <span className="text-[13.5px] font-semibold text-[#F5F4F1]">{ch.name}</span>
                                  <span className="text-[11px] text-white/45">· {ch.role}</span>
                                </div>
                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">{ch.age} · {ch.gender}</span>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px]">
                                <div><span className="text-white/40">Appearance:</span> <span className="text-white/75">{ch.appearance}</span></div>
                                <div><span className="text-white/40">Clothing:</span> <span className="text-white/75">{ch.clothing}</span></div>
                                <div><span className="text-white/40">Hair:</span> <span className="text-white/75">{ch.hairStyle}, {ch.hairColor}</span></div>
                                <div><span className="text-white/40">Personality:</span> <span className="text-white/75">{ch.personality}</span></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className={theme.text}>Preserve Character Identity</span>
                  <button
                    onClick={() => setPreserveIdentity(!preserveIdentity)}
                    className={`flex-shrink-0 transition-colors ${preserveIdentity ? 'text-[#ffcc29]' : theme.textMuted}`}
                    disabled={!characterEnabled}
                  >
                    {preserveIdentity ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                  </button>
                </div>
                <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className={theme.text}>Include Brand Logo</span>
                  <button
                    onClick={() => setUseLogo(!useLogo)}
                    className={`flex-shrink-0 transition-colors ${useLogo ? 'text-[#ffcc29]' : theme.textMuted}`}
                  >
                    {useLogo ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                  </button>
                </div>
              </div>

              {characterEnabled && (
                <div className="space-y-4 mt-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Character Name</label>
                    <input type="text" className={inputClass} value={characterName} onChange={(e) => setCharacterName(e.target.value)} placeholder="e.g. Sarah" />
                  </div>

                  <div className="mt-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
                    <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Character Source</label>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={characterSource === 'generate'} onChange={() => setCharacterSource('generate')} />
                        <span className={theme.text}>Generate AI Character</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={characterSource === 'upload'} onChange={() => setCharacterSource('upload')} />
                        <span className={theme.text}>Upload Image</span>
                      </label>
                    </div>

                    {characterSource === 'upload' ? (
                      <div>
                        <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Upload Character Image</label>
                        <input 
                          type="file" 
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const base64 = await fileToDataUrl(file);
                              if (base64) {
                                setCharacterImage(base64);
                                setOriginalCharacterImage(base64);
                                setCharacterApproved(true);
                              }
                            }
                          }}
                          className={inputClass}
                        />
                        {characterImage && (
                          <div className="mt-2 relative inline-block">
                            <img src={characterImage} alt="Character Reference" className="h-24 w-24 object-cover rounded-lg" />
                            <button onClick={() => { setCharacterImage(''); setCharacterApproved(false); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"><XCircle className="w-4 h-4" /></button>
                          </div>
                        )}

                        {originalCharacterImage && (
                          <div className="mt-4 p-4 border rounded-xl border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/20 text-center space-y-3">
                            <h3 className={`font-bold ${theme.text}`}>Master Character Sheet</h3>
                            <p className={`text-sm ${theme.textMuted}`}>Generate a 360° character sheet to improve consistency across all scenes.</p>
                            
                            {characterImage !== originalCharacterImage && characterImage && (
                              <div className="relative group cursor-pointer" onClick={() => setPreviewImageModal(characterImage)}>
                                <img src={characterImage} alt="Master Sheet" className="h-48 w-full object-contain rounded-xl mx-auto shadow-md transition-transform group-hover:scale-[1.02]" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                                  <span className="text-white font-medium bg-black/50 px-3 py-1 rounded-lg flex items-center"><Search className="w-4 h-4 mr-2" /> Click to Preview</span>
                                </div>
                              </div>
                            )}

                            {!characterApproved || characterImage === originalCharacterImage ? (
                              <div className="flex justify-center gap-3 mt-2">
                                <button onClick={handleGenerateCharacterPreview} disabled={generatingCharacter} className="px-4 py-2 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-600 transition disabled:opacity-50">
                                  {generatingCharacter ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : <Sparkles className="w-4 h-4 inline mr-2" />}
                                  Generate Master Sheet
                                </button>
                                {characterImage !== originalCharacterImage && characterImage && (
                                    <button onClick={() => setCharacterApproved(true)} className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition">
                                      Approve
                                    </button>
                                )}
                              </div>
                            ) : (
                              <div className="text-emerald-500 font-bold text-sm">✓ Character Sheet Approved</div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Age</label>
                            <input type="text" className={inputClass} value={characterAge} onChange={(e) => setCharacterAge(e.target.value)} placeholder="e.g. 28" />
                          </div>
                          <div>
                            <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Gender</label>
                            <select className={inputClass} value={characterGender} onChange={(e) => setCharacterGender(e.target.value)}>
                              <option value="">Select Gender</option>
                              <option value="Male">Male</option>
                              <option value="Female">Female</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Ethnicity / Race</label>
                            <select className={inputClass} value={characterRace} onChange={(e) => setCharacterRace(e.target.value)}>
                              <option value="">Select Ethnicity (Optional)</option>
                              <option value="Indian">Indian</option>
                              <option value="South Indian">South Indian</option>
                              <option value="Asian">Asian</option>
                              <option value="American">American</option>
                              <option value="European">European</option>
                              <option value="Arab">Arab</option>
                              <option value="Japanese">Japanese</option>
                              <option value="Mexican">Mexican</option>
                              <option value="African">African</option>
                              <option value="Latino">Latino</option>
                              <option value="Mixed">Mixed</option>
                            </select>
                          </div>
                          {characterGender !== 'Female' && (
                            <div>
                              <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Facial Hair / Beard</label>
                              <select className={inputClass} value={characterBeard} onChange={(e) => setCharacterBeard(e.target.value)}>
                                <option value="">Clean Shaven (No Beard)</option>
                                <option value="Stubble">Stubble</option>
                                <option value="Short Beard">Short Beard</option>
                                <option value="Full Beard">Full Beard</option>
                                <option value="Goatee">Goatee</option>
                                <option value="Mustache Only">Mustache Only</option>
                              </select>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Role</label>
                            <input type="text" className={inputClass} value={characterRole} onChange={(e) => setCharacterRole(e.target.value)} placeholder="e.g. Startup Founder" />
                          </div>
                          <div>
                            <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Personality</label>
                            <select className={inputClass} value={characterPersonality} onChange={(e) => setCharacterPersonality(e.target.value)}>
                              <option value="">Select Personality</option>
                              <option value="Professional">Professional</option>
                              <option value="Casual">Casual</option>
                              <option value="Energetic">Energetic</option>
                              <option value="Calm">Calm</option>
                              <option value="Confident">Confident</option>
                              <option value="Friendly">Friendly</option>
                              <option value="Serious">Serious</option>
                              <option value="Funny">Funny</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Appearance / Clothing</label>
                          <input type="text" className={inputClass} value={characterAppearance} onChange={(e) => setCharacterAppearance(e.target.value)} placeholder="e.g. Modern business woman, Premium formal outfit" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Hair Style & Color</label>
                            <input type="text" className={inputClass} value={characterHairStyle} onChange={(e) => setCharacterHairStyle(e.target.value)} placeholder="e.g. Long straight black hair" />
                          </div>
                          <div>
                            <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Format / Art Style</label>
                            <select className={inputClass} value={characterArtStyle} onChange={(e) => setCharacterArtStyle(e.target.value)}>
                              <option value="Realistic / Photography">Real Person / Realistic</option>
                              <option value="Anime / Manga">Anime</option>
                              <option value="3D Animation / Cartoon">3D Animation / Cartoon Character</option>
                              <option value="Vector Illustration">Vector Illustration</option>
                            </select>
                          </div>
                        </div>
                        <button
                          onClick={handleGenerateCharacterPreview}
                          disabled={generatingCharacter}
                          className="px-4 py-2 bg-indigo-500 text-white font-semibold rounded-xl hover:bg-indigo-600 transition disabled:opacity-50"
                        >
                          {generatingCharacter ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : <Sparkles className="w-4 h-4 inline mr-2" />}
                          Generate Character Preview
                        </button>
                        
                        {characterImage && (
                          <div className="p-4 border rounded-xl border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/20 text-center space-y-3">
                            <h3 className={`font-bold ${theme.text}`}>Generated Character</h3>
                            
                            <div className="relative group cursor-pointer" onClick={() => setPreviewImageModal(characterImage)}>
                              <img src={characterImage} alt="Generated Character Preview" className="h-48 w-full object-contain rounded-xl mx-auto shadow-md transition-transform group-hover:scale-[1.02]" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                                <span className="text-white font-medium bg-black/50 px-3 py-1 rounded-lg flex items-center"><Search className="w-4 h-4 mr-2" /> Click to Preview</span>
                              </div>
                            </div>
                            
                            {!characterApproved ? (
                              <div className="flex justify-center gap-3 mt-2">
                                <button onClick={handleGenerateCharacterPreview} disabled={generatingCharacter} className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                                  Regenerate
                                </button>
                                <button onClick={() => setCharacterApproved(true)} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition">
                                  Approve Character
                                </button>
                              </div>
                            ) : (
                              <div className="text-emerald-500 font-bold text-sm">✓ Character Approved</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Character Usage</label>
                      <select className={inputClass} value={characterUsage} onChange={(e) => setCharacterUsage(e.target.value)}>
                        <option value="Main Character in all scenes">Main Character in all scenes</option>
                        <option value="Character only in selected scenes">Character only in selected scenes</option>
                        <option value="Background character only">Background character only</option>
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Character Consistency Strength</label>
                      <select className={inputClass} value={characterConsistencyStrength} onChange={(e) => setCharacterConsistencyStrength(e.target.value)}>
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                        <option value="Strict">Strict</option>
                      </select>
                    </div>
                  </div>
                  
                </div>
              )}

              <div className="mt-6">
                <div className="flex items-baseline justify-between mb-2">
                  <label className={`block text-sm font-medium ${theme.textMuted}`}>Video Style</label>
                  <span className={`text-[11px] ${theme.textSecondary}`}>{videoStyle}</span>
                </div>
                <div
                  role="radiogroup"
                  aria-label="Video Style"
                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                >
                  {VIDEO_STYLES.map((s) => {
                    const isSelected = videoStyle === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        title={s.blurb}
                        onClick={() => {
                          setVideoStyle(s.value);
                          if (s.value === 'Storytelling' && characterConsistencyStrength !== 'Strict') {
                            setCharacterConsistencyStrength('Strict');
                          }
                        }}
                        className={`group relative text-left rounded-xl overflow-hidden border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] ${
                          isSelected
                            ? 'border-[#F5A623] shadow-lg shadow-[#F5A623]/20'
                            : 'border-transparent hover:border-slate-500'
                        }`}
                      >
                        <div className="relative">
                          <img
                            src={`/assets/video-styles/${s.slug}.svg`}
                            alt=""
                            loading="lazy"
                            className={`w-full aspect-video object-cover transition-transform duration-300 ${
                              isSelected ? 'scale-[1.03]' : 'group-hover:scale-[1.03]'
                            }`}
                          />
                          {isSelected && (
                            <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#F5A623] text-black text-[11px] font-bold flex items-center justify-center shadow">
                              ✓
                            </span>
                          )}
                        </div>
                        <div className={`px-2.5 py-2 ${isSelected ? 'bg-[#F5A623]/10' : 'bg-black/25'}`}>
                          <div className={`text-[12px] font-semibold leading-tight ${isSelected ? 'text-[#F5A623]' : theme.text}`}>
                            {s.value}
                          </div>
                          <div className={`text-[10px] leading-snug mt-0.5 line-clamp-2 ${theme.textSecondary}`}>
                            {s.blurb}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={step2Next}
                  disabled={busy || (characterEnabled && !characterApproved && characterSource === 'generate')}
                  className="px-6 py-2.5 bg-[#ffcc29] text-black font-semibold rounded-xl hover:bg-[#e6b825] transition disabled:opacity-50"
                >
                  {characterEnabled && !characterApproved && characterSource === 'generate' ? 'Approve Character to Continue' : 'Save & Next (Environment)'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className={`${panelClass} p-6 space-y-5`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className={`font-bold text-lg ${theme.text}`}>Step 3: Environment</h2>
                  <p className={`text-[12px] mt-1 ${theme.textSecondary}`}>
                    Lock every scene to your actual space (shop, showroom, workshop, storefront). Every image + clip will render inside this exact environment.
                  </p>
                </div>
                {/* ON/OFF toggle */}
                <div className="flex items-center gap-2">
                  <span className={`text-xs uppercase tracking-wide ${environmentEnabled ? theme.textMuted : theme.text}`}>OFF</span>
                  <button
                    onClick={() => {
                      setEnvironmentEnabled((v) => !v);
                      if (!environmentEnabled) loadBrandAssetImages();
                    }}
                    className={`relative w-12 h-6 rounded-full transition-colors ${environmentEnabled ? 'bg-[#F5A623]' : 'bg-slate-600'}`}
                    aria-label="Toggle environment lock"
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${environmentEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                  <span className={`text-xs uppercase tracking-wide ${environmentEnabled ? theme.text : theme.textMuted}`}>ON</span>
                </div>
              </div>

              {!environmentEnabled && (
                <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-slate-100'}`}>
                  <p className={`text-sm ${theme.textSecondary}`}>
                    Environment lock is <b>OFF</b>. Scenes will be generated with LLM-invented locations. Turn ON to upload reference photos of your actual space so every scene renders there.
                  </p>
                </div>
              )}

              {environmentEnabled && (
                <div className="space-y-5">
                  {/* Uploader */}
                  <div className={`rounded-xl border border-dashed p-5 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-300 bg-slate-50'}`}>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>
                      Upload environment reference (1–5 images)
                    </label>
                    <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>
                      Wide shot of the space + a detail or two. Same lighting / angle-of-day as you want the video to feel like.
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      className="mt-3 text-sm"
                      disabled={environmentRefs.length >= 5}
                      onChange={(e) => onEnvironmentUpload(e.target.files?.[0])}
                    />
                    {environmentRefs.length >= 5 && (
                      <p className="text-[11px] mt-2 text-amber-400">Max 5 references. Remove one to add another.</p>
                    )}
                  </div>

                  {/* Brand assets picker */}
                  <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-slate-100'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>
                        Or pick from Brand Assets
                      </label>
                      <button
                        onClick={loadBrandAssetImages}
                        disabled={brandAssetsLoading}
                        className="px-2 py-1 text-[11px] rounded border border-slate-500 text-slate-300 disabled:opacity-50"
                      >
                        {brandAssetsLoading ? 'Loading…' : 'Refresh'}
                      </button>
                    </div>
                    {brandAssetImages.length === 0 && !brandAssetsLoading && (
                      <p className={`text-[11px] mt-2 ${theme.textSecondary}`}>
                        No brand-asset images found. Add some in the Brand Assets section, or upload above.
                      </p>
                    )}
                    {brandAssetImages.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mt-3">
                        {brandAssetImages.map((img) => {
                          const isSelected = environmentRefs.some((r) => r.url === img.url);
                          return (
                            <button
                              key={img.url}
                              onClick={() => toggleBrandAssetInEnv(img)}
                              className={`relative rounded-lg overflow-hidden border-2 transition-colors ${isSelected ? 'border-[#F5A623]' : 'border-transparent hover:border-slate-500'}`}
                              title={img.alt}
                            >
                              <img src={img.url} alt={img.alt} className="w-full h-20 object-cover" />
                              {img.isLogo && (
                                <span className="absolute top-1 left-1 text-[9px] font-bold uppercase bg-black/70 text-white px-1 rounded">Logo</span>
                              )}
                              {isSelected && (
                                <span className="absolute top-1 right-1 text-[10px] font-bold bg-[#F5A623] text-black px-1 rounded">✓</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Selected reference thumbnails */}
                  {environmentRefs.length > 0 && (
                    <div>
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>
                        Selected references ({environmentRefs.length})
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mt-2">
                        {environmentRefs.map((ref, idx) => (
                          <div key={idx} className="relative rounded-lg overflow-hidden border border-slate-700">
                            <img
                              src={ref.dataUrl || ref.url}
                              alt={ref.alt || 'env ref'}
                              className="w-full h-24 object-cover"
                            />
                            <button
                              onClick={() => removeEnvironmentRef(idx)}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs flex items-center justify-center hover:bg-red-500"
                              title="Remove"
                            >
                              ×
                            </button>
                            <span className={`absolute bottom-0 left-0 right-0 text-[9px] uppercase tracking-wide text-white bg-black/60 px-1 py-0.5 truncate ${ref.source === 'brand-asset' ? 'text-blue-300' : ''}`}>
                              {ref.source === 'brand-asset' ? 'brand' : 'upload'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>
                      Notes about the space (optional)
                    </label>
                    <textarea
                      value={environmentNotes}
                      onChange={(e) => setEnvironmentNotes(e.target.value.slice(0, 500))}
                      placeholder="e.g. 'warm wood tones, north-facing window light, traditional Chettinad furniture, brass fittings' — helps the model disambiguate what to preserve"
                      className={`${inputClass} mt-2 min-h-[80px]`}
                    />
                    <p className={`text-[10px] mt-1 text-right ${theme.textSecondary}`}>{environmentNotes.length}/500</p>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                <button onClick={() => setStep(2)} className="text-[12.5px] text-white/55 hover:text-white/85">
                  ← Back to Character & Video Style
                </button>
                <button
                  onClick={step3EnvNext}
                  disabled={busy || (environmentEnabled && environmentRefs.length === 0)}
                  className={primaryButtonClass(busy || (environmentEnabled && environmentRefs.length === 0))}
                  title={environmentEnabled && environmentRefs.length === 0 ? 'Add at least one reference image, or toggle OFF to skip' : undefined}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Save & Next (Script + Scenes)'}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (() => {
              // Precomputed helpers for the v2 Script + Scenes UI.
              const voiceoverText = String(promptText || '').trim();
              const voiceoverWordCount = voiceoverText ? voiceoverText.split(/\s+/).filter(Boolean).length : 0;
              const targetWords = Math.round((durationSeconds || 30) * 2);
              const wcColor =
                voiceoverWordCount === 0 ? 'text-white/40'
                : voiceoverWordCount <= targetWords * 1.1 ? 'text-[#4ADE80]'
                : voiceoverWordCount <= targetWords * 1.25 ? 'text-[#F5A623]'
                : 'text-red-400';
              // Creative Rules — quick heuristics that turn each rule
              // green when likely satisfied. Not perfect but visually useful.
              const totalCharsInPurposes = (scenes || []).reduce((s: number, sc: any) => s + String(sc?.purpose || '').length, 0);
              const rules = [
                { text: 'First 5 seconds create curiosity or emotional pull', ok: Boolean(String(story?.hook || '').trim().length > 30) },
                { text: 'Every scene moves the story forward', ok: totalCharsInPurposes > 40 * Math.max(1, (scenes || []).length) },
                { text: 'Every scene has ONE dominant emotion', ok: (scenes || []).every((s: any) => String(s?.emotion || '').trim().length > 0) },
                { text: 'The product is never the hero', ok: Boolean(String(story?.brandReveal || '').trim().length > 20) },
                { text: 'Brand appears naturally near the end', ok: Boolean(String(story?.brandReveal || '').trim().length > 20) },
                { text: 'Ending feels memorable', ok: Boolean(String(story?.ending || '').trim().length > 20) },
                { text: 'Audience feels something BEFORE seeing the logo', ok: Boolean(String(story?.emotionalProgression || '').trim().length > 20) },
                { text: "Tone matches this brand's tier — not a generic luxury film", ok: (scenes || []).length > 0 },
              ];
              const rulesPassed = rules.filter((r) => r.ok).length;

              // Compact list of accepted cast for characterRequired chips
              const castLookup = new Map(generatedCharacters.map((c) => [c.id, c]));

              return (
              <div className={`${panelClass} p-6 space-y-6`}>
                {/* HEADER */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className={`font-bold text-lg ${theme.text}`}>Step 3: Script + Scenes</h2>
                    <p className={`text-xs mt-0.5 ${theme.textSecondary}`}>
                      Story arc · Voiceover · Scene-by-scene breakdown — production-ready and editable.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={generatePromptAndScenes} disabled={busy} className="px-4 py-2 rounded-xl bg-[#F5A623] text-[#1A1208] font-semibold hover:bg-[#ffb833] disabled:opacity-60">
                      {busy ? <><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />Generating…</> : (scenes.length > 0 ? '↻ Regenerate all' : '✨ Generate Script + Scenes')}
                    </button>
                    <button onClick={() => refreshDraft()} className="px-3 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:bg-white/[0.04]">
                      <RefreshCcw className="w-4 h-4 inline mr-1" /> Refresh
                    </button>
                  </div>
                </div>

                {/* Empty state — nudge user to generate */}
                {scenes.length === 0 && !busy && (
                  <div className="rounded-2xl border border-[#F5A623]/25 bg-[#F5A623]/[0.03] p-8 text-center">
                    <div className="gravity-label text-[#F5A623] mb-2">Ready when you are</div>
                    <p className={`text-sm ${theme.text}`}>Click <b>Generate Script + Scenes</b> to build the story arc, full voiceover, and scene-by-scene breakdown from your approved concept.</p>
                  </div>
                )}

                {/* ==================== SECTION 1: STORY ==================== */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                  <button
                    onClick={() => setShowStory(!showStory)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02]"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#F5A623]">Part 1</span>
                      <h3 className={`text-[15px] font-semibold ${theme.text}`}>Story Arc · 6 beats</h3>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-white/50 transition-transform ${showStory ? 'rotate-180' : ''}`} />
                  </button>
                  {showStory && (
                    <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(
                        [
                          { key: 'hook', label: 'Hook', hint: 'The first 3–5 seconds that earn attention' },
                          { key: 'beginning', label: 'Beginning', hint: 'How we enter the world' },
                          { key: 'emotionalProgression', label: 'Emotional Progression', hint: 'How feeling builds through the middle' },
                          { key: 'climax', label: 'Climax', hint: 'The peak emotional moment' },
                          { key: 'brandReveal', label: 'Brand Reveal', hint: 'How the brand appears naturally' },
                          { key: 'ending', label: 'Ending', hint: 'The line viewers remember' },
                        ] as Array<{ key: keyof StoryArc; label: string; hint: string }>
                      ).map((beat) => (
                        <div key={beat.key} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                          <div className="flex items-baseline justify-between mb-1">
                            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#F5A623]">{beat.label}</label>
                            <span className="text-[10px] text-white/35">{beat.hint}</span>
                          </div>
                          <textarea
                            value={story[beat.key] || ''}
                            onChange={(e) => setStory((prev) => ({ ...prev, [beat.key]: e.target.value }))}
                            className={`${inputClass} mt-1 min-h-[80px] text-[13px] leading-relaxed`}
                            placeholder={`Write the ${beat.label.toLowerCase()} in 2-4 sentences…`}
                            disabled={busy}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ==================== SECTION 2: VOICEOVER ==================== */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                  <button
                    onClick={() => setShowVoiceover(!showVoiceover)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02]"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#F5A623]">Part 2</span>
                      <h3 className={`text-[15px] font-semibold ${theme.text}`}>Voiceover Script</h3>
                      <span className={`text-[11px] font-semibold tabular-nums ${wcColor}`}>
                        {voiceoverWordCount} / {targetWords} words
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          try {
                            navigator.clipboard.writeText(voiceoverText);
                            setVoiceoverCopied(true);
                            setTimeout(() => setVoiceoverCopied(false), 1500);
                          } catch (_) {}
                        }}
                        disabled={!voiceoverText}
                        className="text-[11px] font-semibold px-3 py-1.5 rounded-md border border-white/[0.10] hover:border-[#F5A623]/40 hover:text-[#F5A623] text-white/70 disabled:opacity-30"
                      >
                        {voiceoverCopied ? '✓ Copied' : 'Copy for ElevenLabs'}
                      </button>
                      <ChevronDown className={`w-4 h-4 text-white/50 transition-transform ${showVoiceover ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {showVoiceover && (
                    <div className="px-5 pb-5">
                      {voiceoverWordCount === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/[0.10] bg-white/[0.02] p-6 text-center">
                          <div className="gravity-label text-white/45 mb-2">No voiceover generated</div>
                          <p className={`text-[12.5px] ${theme.text}`}>
                            No voiceover script was returned for this run.
                          </p>
                          <p className={`text-[11.5px] ${theme.textSecondary} mt-1`}>
                            Click <b>Regenerate all</b> at the top to try again, or type your own narration below.
                          </p>
                          <textarea
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            className={`${inputClass} mt-4 min-h-[110px] text-[13px] leading-relaxed text-left`}
                            placeholder="Or write your own narration here — one line per sentence, natural pauses."
                            disabled={busy}
                          />
                        </div>
                      ) : (
                        <>
                          <textarea
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            className={`${inputClass} min-h-[180px] leading-relaxed text-[13.5px]`}
                            placeholder="The full narration, one line per sentence — will be spoken by ElevenLabs / your chosen TTS voice."
                            disabled={busy}
                          />
                          <div className={`mt-2 text-[11px] ${theme.textMuted}`}>
                            Target ~{targetWords} words for {durationSeconds}s at natural speaking pace (~2 words/sec). Use line breaks between sentences for natural pauses.
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* ==================== SECTION 3: SCENE BREAKDOWN ==================== */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                  <button
                    onClick={() => setShowSceneBreakdown(!showSceneBreakdown)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02]"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#F5A623]">Part 3</span>
                      <h3 className={`text-[15px] font-semibold ${theme.text}`}>Scene Breakdown · {(scenes || []).length} scenes</h3>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-white/50 transition-transform ${showSceneBreakdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showSceneBreakdown && (
                    <div className="px-5 pb-5 space-y-4">
                      {/* Progress banner while sequential enrichment is running */}
                      {pendingSceneIndex !== null && totalScenesForRun > 0 && (
                        <div className="rounded-xl border border-[#F5A623]/30 bg-[#F5A623]/[0.06] p-3 flex items-center gap-3">
                          <Loader2 className="w-4 h-4 animate-spin text-[#F5A623]" />
                          <div className="flex-1">
                            <div className="text-[12.5px] font-semibold text-[#F5F4F1]">
                              Generating scene {pendingSceneIndex + 1} of {totalScenesForRun}
                            </div>
                            <div className="mt-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                              <div
                                className="h-full bg-[#F5A623] transition-all"
                                style={{ width: `${((pendingSceneIndex) / totalScenesForRun) * 100}%` }}
                              />
                            </div>
                          </div>
                          <div className="text-[11px] text-white/50 tabular-nums">
                            {pendingSceneIndex} / {totalScenesForRun}
                          </div>
                        </div>
                      )}

                      {(scenes || []).map((scene: any, idx: number) => {
                        const isRegen = regeneratingSceneIds.has(String(scene.sceneId || ''));
                        // A scene is "pending" if the sequential run has
                        // reached it (idx === pendingSceneIndex) OR is
                        // still ahead of it in the queue with no rich
                        // fields filled yet (skeleton state).
                        const isPending = pendingSceneIndex !== null && idx === pendingSceneIndex;
                        const isSkeleton = !isPending && !isRegen &&
                          !String(scene.visualDescription || '').trim() &&
                          !String(scene.emotion || '').trim() &&
                          pendingSceneIndex !== null && idx > pendingSceneIndex;
                        const update = (patch: any) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, ...patch } : item));
                        return (
                          <div key={scene.sceneId || idx} className="relative rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3 overflow-hidden">
                            {/* Header row */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-baseline gap-2">
                                <span className="text-[10px] font-bold text-[#F5A623] tabular-nums">Scene {String(scene.sceneNumber || idx + 1).padStart(2, '0')}</span>
                                <input value={scene.title || ''} onChange={(e) => update({ title: e.target.value })}
                                  className="bg-transparent border-none outline-none text-[15px] font-semibold text-[#F5F4F1] placeholder:text-white/25 flex-1"
                                  placeholder="Scene title" disabled={isRegen} />
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 text-[11px] text-white/50">
                                  <span>Duration</span>
                                  <input type="number" min={1} value={scene.durationSeconds || 1} onChange={(e) => update({ durationSeconds: Number(e.target.value) || 1 })}
                                    className="w-14 h-7 rounded border border-white/10 bg-white/[0.03] text-center text-[12px] text-white/90" disabled={isRegen} />
                                  <span className="text-white/40">s</span>
                                </div>
                                <button
                                  onClick={() => regenerateScene(scene)}
                                  disabled={isRegen}
                                  className="px-3 py-1.5 text-[11px] rounded-lg border border-[#F5A623]/40 text-[#F5A623] hover:bg-[#F5A623]/10 disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {isRegen ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                                  {isRegen ? 'Regenerating' : 'Regenerate'}
                                </button>
                              </div>
                            </div>

                            {/* Grid row: Emotion + Camera Angle + Camera Movement */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Dominant Emotion</label>
                                <input value={scene.emotion || ''} onChange={(e) => update({ emotion: e.target.value })}
                                  className={`${inputClass} mt-1 h-9 text-[12.5px]`} placeholder="e.g. quiet nostalgia" disabled={isRegen} />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Camera Angle</label>
                                <input value={scene.cameraAngle || ''} onChange={(e) => update({ cameraAngle: e.target.value })}
                                  className={`${inputClass} mt-1 h-9 text-[12.5px]`} placeholder="e.g. eye-level close-up" disabled={isRegen} />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Camera Movement</label>
                                <input value={scene.cameraMovement || ''} onChange={(e) => update({ cameraMovement: e.target.value })}
                                  className={`${inputClass} mt-1 h-9 text-[12.5px]`} placeholder="e.g. slow dolly in" disabled={isRegen} />
                              </div>
                            </div>

                            {/* Purpose */}
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Purpose of this scene</label>
                              <textarea value={scene.purpose || ''} onChange={(e) => update({ purpose: e.target.value })}
                                className={`${inputClass} mt-1 min-h-[60px] text-[12.5px] leading-relaxed`}
                                placeholder="Why this scene exists in the arc" disabled={isRegen} />
                            </div>

                            {/* Location + Characters */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Location</label>
                                <textarea value={scene.location || ''} onChange={(e) => update({ location: e.target.value })}
                                  className={`${inputClass} mt-1 min-h-[50px] text-[12.5px] leading-relaxed`}
                                  placeholder="Specific location / set" disabled={isRegen} />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Characters Required</label>
                                <div className="mt-1 flex flex-wrap gap-1.5 min-h-[36px] p-2 rounded-md border border-white/[0.06] bg-white/[0.02]">
                                  {(scene.charactersRequired || []).map((cid: string, i: number) => {
                                    const c = castLookup.get(cid);
                                    return (
                                      <span key={i} className="inline-flex items-center gap-1.5 h-6 pl-1.5 pr-2 rounded-full bg-white/[0.06] border border-white/[0.10] text-[11px]">
                                        <span className="w-4 h-4 rounded-full bg-[#F5A623] text-[#1A1208] text-[9px] font-bold flex items-center justify-center">{cid}</span>
                                        <span className="text-white/85">{c ? c.name : cid}</span>
                                      </span>
                                    );
                                  })}
                                  {(!scene.charactersRequired || scene.charactersRequired.length === 0) && (
                                    <span className="text-[11px] text-white/35">no characters in this scene</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Visual Description */}
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Visual Description</label>
                              <textarea value={scene.visualDescription || ''} onChange={(e) => update({ visualDescription: e.target.value })}
                                className={`${inputClass} mt-1 min-h-[85px] text-[12.5px] leading-relaxed`}
                                placeholder="What the camera SEES: subjects, environment, lighting, mood, palette" disabled={isRegen} />
                            </div>

                            {/* Script Line */}
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#F5A623]">Script Line (the spoken narration)</label>
                              <textarea
                                value={scene.scriptLine || scene.voiceLine || ''}
                                onChange={(e) => { const v = e.target.value; update({ scriptLine: v, voiceLine: v }); }}
                                className={`${inputClass} mt-1 min-h-[70px] text-[13px] leading-relaxed`}
                                placeholder="The exact line spoken in this scene"
                                disabled={isRegen}
                              />
                            </div>

                            {/* On-screen text + Transition */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">On-screen text (optional)</label>
                                <input value={scene.onScreenText || ''} onChange={(e) => update({ onScreenText: e.target.value })}
                                  className={`${inputClass} mt-1 h-9 text-[12.5px]`} placeholder="Short caption overlay" disabled={isRegen} />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Transition to next</label>
                                <input value={scene.transitionToNext || ''} onChange={(e) => update({ transitionToNext: e.target.value })}
                                  className={`${inputClass} mt-1 h-9 text-[12.5px]`} placeholder="e.g. hard cut on the sound of…" disabled={isRegen} />
                              </div>
                            </div>

                            {/* Advanced — auto-generated production prompts */}
                            <details className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
                              <summary className={`cursor-pointer px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider ${theme.textMuted} hover:text-[#F5A623]`}>
                                Advanced · production prompts (auto-generated, downstream)
                              </summary>
                              <div className="p-3 space-y-3">
                                <div>
                                  <label className="text-[10px] font-bold uppercase tracking-wide text-white/50">Image Prompt (Nano Banana)</label>
                                  <textarea value={scene.imagePrompt || ''} onChange={(e) => update({ imagePrompt: e.target.value })}
                                    className={`${inputClass} mt-1 min-h-[70px] text-[12px]`} disabled={isRegen} />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold uppercase tracking-wide text-white/50">Video Prompt (Fal.ai Kling)</label>
                                  <textarea value={scene.videoPrompt || ''} onChange={(e) => update({ videoPrompt: e.target.value })}
                                    className={`${inputClass} mt-1 min-h-[70px] text-[12px]`} disabled={isRegen} />
                                </div>
                              </div>
                            </details>

                            {(isRegen || isPending) && (
                              <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#F5A623]/15 to-transparent skeleton-shimmer" />
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-[2px]">
                                  <Sparkles className="w-7 h-7 text-[#F5A623] animate-pulse" />
                                  <p className="text-sm font-semibold text-[#F5A623] tracking-wide">
                                    {isRegen ? 'Regenerating scene...' : `Writing scene ${idx + 1}...`}
                                  </p>
                                </div>
                              </div>
                            )}
                            {isSkeleton && (
                              <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none flex items-center justify-center bg-black/30">
                                <div className="flex items-center gap-2 text-white/40 text-[12px]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-white/25" />
                                  waiting in queue…
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ==================== CREATIVE RULES CHECKLIST ==================== */}
                {scenes.length > 0 && (
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                    <div className="flex items-baseline justify-between mb-3">
                      <div className="flex items-baseline gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#F5A623]">QA</span>
                        <h3 className={`text-[14px] font-semibold ${theme.text}`}>Creative Rules Checklist</h3>
                      </div>
                      <span className={`text-[11px] font-semibold tabular-nums ${rulesPassed === rules.length ? 'text-[#4ADE80]' : 'text-[#F5A623]'}`}>
                        {rulesPassed} / {rules.length} passing
                      </span>
                    </div>
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                      {rules.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12.5px]">
                          <span className={`mt-[3px] w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold ${r.ok ? 'bg-[#4ADE80] text-[#0A2A0F]' : 'bg-white/[0.06] text-white/40'}`}>
                            {r.ok ? '✓' : '?'}
                          </span>
                          <span className={r.ok ? 'text-white/85' : 'text-white/50'}>{r.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* SAVE & NEXT */}
                <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                  <button onClick={() => setStep(2)} className="text-[12.5px] text-white/55 hover:text-white/85">
                    ← Back to Character & Style
                  </button>
                  <button onClick={saveStep2EditsAndNext} disabled={!canStep2Next} className={primaryButtonClass(!canStep2Next)}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Save & Next (Scene Images)'}
                  </button>
                </div>
              </div>
            );
            })()}

            {step === 5 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className={`font-bold text-lg ${theme.text}`}>Step 5: Scene Images</h2>
                  <span className={`text-[11px] px-2 py-1 rounded-full border ${theme.textMuted} border-white/10`}>
                    Aspect: {aspectRatio} · Sequential render
                  </span>
                </div>

                {/* Sequential progress banner while gen loop is running */}
                {pendingSceneIndex !== null && totalScenesForRun > 0 && (
                  <div className={`rounded-xl border border-[#ffcc29]/40 bg-[#ffcc29]/5 px-4 py-3 flex items-center gap-3`}>
                    <Loader2 className="w-4 h-4 animate-spin text-[#ffcc29]" />
                    <div className="flex-1">
                      <p className={`text-sm font-semibold ${theme.text}`}>
                        Rendering scene {pendingSceneIndex + 1} of {totalScenesForRun}…
                      </p>
                      <p className={`text-xs ${theme.textSecondary}`}>
                        Nano Banana · consistent characters + locked environment
                      </p>
                    </div>
                    <span className="text-xs text-[#ffcc29] font-semibold tabular-nums">
                      {pendingSceneIndex + 1} / {totalScenesForRun}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={generateSceneImages} disabled={busy} className="px-4 py-2 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : (scenes.some((s) => s.imageUrl) ? 'Regenerate All Scene Images' : 'Generate All Scene Images')}
                  </button>
                  {scenes.some((s) => s.imageUrl) && (
                    <>
                      <button
                        onClick={applyLogoToAllScenes}
                        disabled={busy || scenes.every((s) => s.logoApplied)}
                        className="px-4 py-2 rounded-xl bg-[#F5A623] text-black font-semibold disabled:opacity-50"
                        title="Composite your brand logo (from Brand Assets) onto every scene image"
                      >
                        Apply Logo to All
                      </button>
                      {scenes.some((s) => s.logoApplied) && (
                        <button
                          onClick={removeLogoFromAllScenes}
                          disabled={busy}
                          className="px-4 py-2 rounded-xl border border-slate-500 text-slate-300 font-semibold disabled:opacity-50"
                        >
                          Remove Logo from All
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {scenes.map((scene, idx) => {
                    const isRegen = regeneratingSceneIds.has(String(scene.sceneId || ''));
                    // Actively-rendering (this scene is what the loop is on)
                    const isRendering = pendingSceneIndex === idx;
                    // Queued (loop has started but hasn't reached this scene yet)
                    const isQueued = pendingSceneIndex !== null && idx > pendingSceneIndex;
                    const showSpinnerOverlay = isRegen || isRendering;
                    return (
                      <div key={scene.sceneId || idx} className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`font-semibold ${theme.text}`}>{scene.title || `Scene ${idx + 1}`}</p>
                          {isRendering && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#ffcc29]/15 border border-[#ffcc29]/40 text-[#ffcc29]">
                              <Loader2 className="w-3 h-3 animate-spin" /> Rendering
                            </span>
                          )}
                          {isQueued && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-white/50">
                              Queued
                            </span>
                          )}
                        </div>
                        <textarea value={scene.imagePrompt || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, imagePrompt: e.target.value } : item))} className={`${inputClass} mt-2 min-h-[70px]`} disabled={isRegen || isRendering} />
                        <div
                          className="relative mt-3 group cursor-pointer rounded-lg overflow-hidden bg-black/50 mx-auto w-full"
                          style={{ aspectRatio: previewAspectCss, maxHeight: 440 }}
                          onClick={() => { if (scene.imageUrl && !showSpinnerOverlay) setPreviewImageUrl(scene.imageUrl); }}
                        >
                          {scene.imageUrl ? (
                            <>
                              <img src={scene.imageUrl} alt={scene.title} className={`w-full h-full object-contain rounded-lg border border-slate-700 transition-all duration-300 ${showSpinnerOverlay ? 'opacity-30 blur-sm' : ''}`} />
                              {!showSpinnerOverlay && (
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg">
                                  <Eye className="w-8 h-8 text-white" />
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="w-full h-full rounded-lg border border-dashed border-slate-600 flex items-center justify-center bg-black/10">
                              {isRendering ? (
                                <div className="flex flex-col items-center gap-2">
                                  <Loader2 className="w-8 h-8 text-[#ffcc29] animate-spin" />
                                  <p className="text-xs font-semibold text-[#ffcc29] tracking-wide">Generating…</p>
                                </div>
                              ) : isQueued ? (
                                <div className="flex flex-col items-center gap-1 opacity-60">
                                  <ImageIcon className="w-6 h-6 text-slate-500" />
                                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Queued</p>
                                </div>
                              ) : (
                                <ImageIcon className="w-7 h-7 text-slate-500" />
                              )}
                            </div>
                          )}
                          {showSpinnerOverlay && scene.imageUrl && (
                            <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#ffcc29]/15 to-transparent skeleton-shimmer" />
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30 backdrop-blur-[2px]">
                                <Sparkles className="w-6 h-6 text-[#ffcc29] animate-pulse" />
                                <p className="text-xs font-semibold text-[#ffcc29] tracking-wide">
                                  {isRendering ? 'Generating…' : 'Regenerating…'}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <button
                            onClick={() => regenerateSceneImage(scene)}
                            disabled={isRegen || isRendering}
                            className="px-3 py-2 text-xs rounded-lg border border-[#ffcc29] text-[#ffcc29] hover:bg-[#ffcc29]/10 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isRegen ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                            {isRegen ? 'Regenerating' : 'Regenerate'}
                          </button>
                          <label className={`px-3 py-2 text-xs rounded-lg border border-slate-500 text-slate-300 ${(isRegen || isRendering) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                            Replace
                            <input type="file" accept="image/*" className="hidden" disabled={isRegen || isRendering} onChange={(e) => onSceneImageReplace(scene.sceneId, e.target.files?.[0])} />
                          </label>
                          {/* Use Logo toggle — pixel-exact composite of user's
                              actual brand logo. Smart default per scene:
                              last scene = prominent (wall-sign style),
                              other scenes = watermark (top-right corner). */}
                          {scene.imageUrl && (
                            <button
                              onClick={() => {
                                if (scene.logoApplied) {
                                  applyLogoToScene(idx, 'off');
                                } else {
                                  const isLast = idx === scenes.length - 1;
                                  applyLogoToScene(idx, isLast ? 'prominent' : 'watermark');
                                }
                              }}
                              disabled={isRegen || isRendering}
                              className={`px-3 py-2 text-xs rounded-lg font-semibold flex items-center gap-1.5 disabled:opacity-50 ${
                                scene.logoApplied
                                  ? 'bg-[#F5A623] text-black'
                                  : 'border border-[#F5A623]/50 text-[#F5A623] hover:bg-[#F5A623]/10'
                              }`}
                              title={scene.logoApplied ? `Logo applied (${scene.logoMode || 'watermark'}). Click to remove.` : 'Composite your actual brand logo onto this image'}
                            >
                              {scene.logoApplied ? '✓ Logo On' : 'Use Logo'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setStep(6)} disabled={!canStep3Next} className={primaryButtonClass(!canStep3Next)}>Next</button>
              </div>
            )}

            {step === HANDOFF_STEP && MANUAL_VIDEO_HANDOFF && (() => {
              const rendered = scenes.filter((s) => s.imageUrl);
              const sent = Boolean(handoffResult);
              return (
                <div className={`${panelClass} p-6 space-y-5`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className={`font-bold text-lg ${theme.text}`}>Step 6: Send to Our Team</h2>
                    <span className={`text-[11px] px-2 py-1 rounded-full border ${theme.textMuted} border-white/10`}>
                      {rendered.length} of {scenes.length} scenes rendered
                    </span>
                  </div>

                  <p className={`text-sm leading-relaxed ${theme.textSecondary}`}>
                    Your storyboard is ready. Send it to our team and we'll produce the
                    finished video for you — clips, voiceover, music and the final cut.
                    We'll reply to your registered email once it's done.
                  </p>

                  <div className={`rounded-xl border ${isDarkMode ? 'border-white/10 bg-white/[0.02]' : 'border-slate-200 bg-slate-50'} p-4`}>
                    <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>What we'll receive</p>
                    <ul className={`mt-2 space-y-1 text-[13px] ${theme.textSecondary}`}>
                      <li>· Your email address and username</li>
                      <li>· The brief, duration, aspect ratio and language</li>
                      <li>· Character and video style settings</li>
                      <li>· Environment references and notes</li>
                      <li>· The full script and every scene's direction</li>
                      <li>· All {rendered.length} generated scene image{rendered.length === 1 ? '' : 's'}</li>
                    </ul>
                  </div>

                  {rendered.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                      {rendered.map((scene, idx) => (
                        <div key={scene.sceneId || idx} className="relative rounded-lg overflow-hidden border border-white/10">
                          <img src={scene.imageUrl} alt={`Scene ${idx + 1}`} className="w-full h-20 object-cover" />
                          <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">
                            {idx + 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {sent ? (
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
                      <p className="text-sm font-semibold text-emerald-400">Request sent</p>
                      <p className={`text-[13px] mt-1 ${theme.textSecondary}`}>
                        We received your storyboard and {handoffResult?.imageCount} scene image
                        {handoffResult?.imageCount === 1 ? '' : 's'}. Our team will get in touch
                        on your registered email.
                      </p>
                    </div>
                  ) : rendered.length === 0 && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
                      <p className={`text-[13px] ${theme.text}`}>
                        Generate your scene images first — go back to Step 5.
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                    <button
                      onClick={sendToTeam}
                      disabled={busy || !rendered.length || sent}
                      className="px-5 py-3 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold disabled:opacity-50"
                    >
                      {busy
                        ? <Loader2 className="w-4 h-4 animate-spin inline" />
                        : sent ? 'Already Sent' : 'Send to Our Team'}
                    </button>
                    <button
                      onClick={() => setStep(STEP_AFTER_HANDOFF)}
                      disabled={!sent}
                      className={primaryButtonClass(!sent)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              );
            })()}

            {step === 6 && !MANUAL_VIDEO_HANDOFF && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className={`font-bold text-lg ${theme.text}`}>Step 4: Video Clip Generation</h2>
                  <span className={`text-[11px] px-2 py-1 rounded-full border ${theme.textMuted} border-white/10`}>
                    Aspect: {aspectRatio} · Sequential render
                  </span>
                </div>

                {/* Sequential progress banner */}
                {pendingSceneIndex !== null && totalScenesForRun > 0 && (
                  <div className={`rounded-xl border border-[#ffcc29]/40 bg-[#ffcc29]/5 px-4 py-3 flex items-center gap-3`}>
                    <Loader2 className="w-4 h-4 animate-spin text-[#ffcc29]" />
                    <div>
                      <p className={`text-sm font-semibold ${theme.text}`}>
                        Rendering scene {pendingSceneIndex + 1} of {totalScenesForRun}
                      </p>
                      <p className={`text-xs ${theme.textSecondary}`}>
                        Kling v2.5 Turbo Pro · characters performing to scene direction
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button onClick={generateClips} disabled={busy} className="px-4 py-2 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : (scenes.some((s) => s.clipUrl) ? 'Resume / Continue' : 'Generate All Clips')}
                  </button>
                  {scenes.some((s) => s.clipUrl) && (
                    <button
                      onClick={async () => {
                        // wipe clipUrls locally so generateClips re-renders every scene
                        setScenes((prev) => prev.map((s) => ({ ...s, clipUrl: '', clipCloudUrl: null, falVideoUrl: '' })));
                        setTimeout(() => generateClips(), 0);
                      }}
                      disabled={busy}
                      className="px-4 py-2 rounded-xl border border-slate-500 text-slate-300 font-semibold"
                    >
                      Regenerate ALL
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {scenes.map((scene, idx) => {
                    const sid = String(scene.sceneId || idx);
                    const isRegen = regeneratingSceneIds.has(sid);
                    const isPending = pendingSceneIndex === idx;
                    return (
                      <div key={sid} className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-4 space-y-3`}>
                        <div className="flex justify-between items-center gap-3">
                          <div>
                            <p className={`font-semibold ${theme.text}`}>{scene.title || `Scene ${idx + 1}`}</p>
                            {scene.scriptLine && <p className={`text-xs mt-1 italic ${theme.textSecondary}`}>"{scene.scriptLine}"</p>}
                          </div>
                          {/* Kling renders 5s or 10s only. A free-text length
                              leaves a gap the renderer fills by freezing the
                              last frame, so the choice is constrained. */}
                          <select
                            value={Number(scene.durationSeconds) === 10 ? 10 : 5}
                            onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, durationSeconds: Number(e.target.value) } : item))}
                            title="Kling renders 5s or 10s clips only"
                            className={`${inputClass} w-24`}
                          >
                            <option value={5}>5s</option>
                            <option value={10}>10s</option>
                          </select>
                        </div>

                        {isPending || isRegen ? (
                          <div className="w-full aspect-video rounded-lg border border-[#ffcc29]/40 bg-black/40 flex flex-col items-center justify-center gap-2">
                            <Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" />
                            <p className="text-xs text-[#ffcc29] font-semibold">
                              {isRegen ? 'Regenerating this scene…' : 'Rendering…'}
                            </p>
                          </div>
                        ) : scene.clipUrl ? (
                          <video controls src={scene.clipUrl} className="w-full rounded-lg max-h-[320px] bg-black" />
                        ) : (
                          <p className={`text-xs ${theme.textSecondary}`}>Clip not generated yet.</p>
                        )}

                        {/* Per-clip regenerate controls — one-click + prompt tweak */}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => regenerateSceneClip(idx, '')}
                            disabled={busy || isRegen || isPending || !scene.imageUrl}
                            className="px-3 py-2 text-xs rounded-lg border border-[#ffcc29] text-[#ffcc29] hover:bg-[#ffcc29]/10 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isRegen ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                            {isRegen ? 'Regenerating' : 'Regenerate'}
                          </button>
                          <input
                            type="text"
                            placeholder="Tweak (e.g. 'slower dolly-in, character smiles')"
                            value={scene.videoRegenTweakDraft || ''}
                            onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, videoRegenTweakDraft: e.target.value } : item))}
                            disabled={busy || isRegen || isPending}
                            className={`${inputClass} flex-1 min-w-[180px] text-xs`}
                          />
                          <button
                            onClick={() => regenerateSceneClip(idx, scene.videoRegenTweakDraft || '')}
                            disabled={busy || isRegen || isPending || !scene.imageUrl || !String(scene.videoRegenTweakDraft || '').trim()}
                            className="px-3 py-2 text-xs rounded-lg bg-[#F5A623] text-[#1A1208] font-semibold disabled:opacity-50"
                          >
                            Regenerate with tweak
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button onClick={() => setStep(7)} disabled={!canStep4Next} className={primaryButtonClass(!canStep4Next)}>Next</button>
              </div>
            )}

            {step === 7 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 5: Audio Configuration</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Audio</label>
                    <button type="button" onClick={() => setAudioEnabled((v) => !v)} className={`${inputClass} mt-2 text-left`}>
                      {audioEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Voice Mode</label>
                    <select value={audioMode} onChange={(e) => setAudioMode(e.target.value as AudioMode)} className={`${inputClass} mt-2`} disabled={!audioEnabled}>
                      <option value="auto">TTS</option>
                      <option value="upload">Upload Voice</option>
                      <option value="off">No Voice</option>
                    </select>
                  </div>
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Music</label>
                    <select value={audioTone} onChange={(e) => setAudioTone(e.target.value)} className={`${inputClass} mt-2`} disabled={!audioEnabled}>
                      <option value="professional">Professional</option>
                      <option value="normal">Normal</option>
                      <option value="fun">Fun</option>
                      <option value="luxury">Luxury</option>
                      <option value="simple">Simple</option>
                    </select>
                  </div>
                </div>

                {audioEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Language</label>
                      <select value={audioLanguageCode} onChange={(e) => setAudioLanguageCode(e.target.value)} className={`${inputClass} mt-2`}>
                        <option value="en">English</option>
                        <option value="hi">Hindi</option>
                        <option value="ta">Tamil</option>
                        <option value="te">Telugu</option>
                        <option value="kn">Kannada</option>
                        <option value="ml">Malayalam</option>
                      </select>
                    </div>
                    <div>
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Music Source</label>
                      <select
                        value={musicSource}
                        onChange={(e) => setMusicSource(e.target.value as 'tone' | 'library' | 'elevenlabs_ai')}
                        className={`${inputClass} mt-2`}
                      >
                        <option value="elevenlabs_ai">✨ AI-Composed (ElevenLabs)</option>
                        <option value="library">Library (by duration)</option>
                        <option value="tone">Tone Pack (default)</option>
                      </select>
                      <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>
                        {musicSource === 'elevenlabs_ai'
                          ? 'AI music matched to script mood + scene emotions.'
                          : `Uses backend music/${durationSeconds}s when Library.`}
                      </p>
                    </div>
                    <div>
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Voice</label>
                      <select value={voiceGender} onChange={(e) => setVoiceGender(e.target.value as 'male' | 'female')} className={`${inputClass} mt-2`}>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                      </select>
                    </div>
                    <div>
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Voice Volume</label>
                      <input type="range" min={0} max={2} step={0.1} value={voiceVolume} onChange={(e) => setVoiceVolume(Number(e.target.value))} className="mt-3 w-full" />
                    </div>
                    <div>
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Music Volume</label>
                      <input type="range" min={0} max={2} step={0.1} value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} className="mt-3 w-full" />
                    </div>
                  </div>
                )}

                {/* ElevenLabs voice picker. Fetches all voices in the
                    selected language + gender; each has a star to save
                    to brand assets and a preview play button. */}
                {audioEnabled && audioMode === 'auto' && (
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-4 space-y-3`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>
                          ElevenLabs Voices · {audioLanguageCode.toUpperCase()} · {voiceGender}
                          {voiceCatalogNativeCount > 0 && (
                            <span className="ml-2 text-[10px] text-emerald-400 normal-case tracking-normal">
                              {voiceCatalogNativeCount} native
                            </span>
                          )}
                        </p>
                        <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>
                          {audioLanguageCode === 'en'
                            ? 'Star a voice to save it to brand assets. Click a card to select it as your narrator.'
                            : `Only voices native to ${audioLanguageCode.toUpperCase()} are shown. Star to save, click to select.`}
                        </p>
                      </div>
                      <button
                        onClick={() => loadElevenLabsVoices({ includeMultilingual: voiceIncludeMultilingual })}
                        disabled={voiceCatalogLoading}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[#F5A623] text-[#F5A623] font-semibold disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {voiceCatalogLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                        {voiceCatalog.length > 0 ? 'Refresh' : 'Load Voices'}
                      </button>
                    </div>

                    {voiceCatalogError && (
                      <div className="text-xs text-red-400 bg-red-500/5 border border-red-500/30 rounded p-2">{voiceCatalogError}</div>
                    )}

                    {/* No native voices for this language — offer opt-in
                        to multilingual voices (English speakers with
                        multilingual capability). Only shown for non-EN. */}
                    {!voiceCatalogLoading && voiceCatalog.length === 0 && voiceCatalogCanFallback && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <p className={`text-xs font-semibold ${theme.text}`}>
                          No native {audioLanguageCode.toUpperCase()} voices found on your ElevenLabs account.
                        </p>
                        <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>
                          You can enable multilingual fallback — voices that aren't native but can speak
                          {' '}{audioLanguageCode.toUpperCase()} via ElevenLabs multilingual v2 (accent may not sound authentic).
                        </p>
                        <button
                          onClick={() => setVoiceIncludeMultilingual(true)}
                          className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-amber-500 text-black font-semibold"
                        >
                          Enable multilingual fallback
                        </button>
                      </div>
                    )}

                    {voiceCatalog.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto pr-1">
                        {voiceCatalog.map((v) => {
                          const isSelected = selectedVoiceId === v.voiceId;
                          const isPlaying = voicePreviewId === v.voiceId;
                          const isNative = v.isNative !== false; // treat undefined as native for back-compat
                          return (
                            <div
                              key={v.voiceId}
                              onClick={() => setSelectedVoiceId(v.voiceId)}
                              className={`relative rounded-lg border p-3 cursor-pointer transition-colors ${
                                isSelected
                                  ? 'border-[#F5A623] bg-[#F5A623]/10'
                                  : `${isDarkMode ? 'border-slate-700 hover:border-slate-500' : 'border-slate-300 hover:border-slate-400'}`
                              }`}
                            >
                              {!isNative && (
                                <div className="absolute top-2 right-2 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                  non-native
                                </div>
                              )}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className={`text-sm font-semibold truncate ${theme.text}`}>{v.name}</p>
                                  <p className={`text-[10px] uppercase tracking-wide ${theme.textSecondary} truncate`}>
                                    {[v.gender, v.accent, v.age].filter(Boolean).join(' · ') || v.category}
                                  </p>
                                  {v.description && (
                                    <p className={`text-[11px] mt-1 line-clamp-2 ${theme.textSecondary}`}>{v.description}</p>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleFavouriteVoice(v); }}
                                    title={v.isFavourite ? 'Remove from favourites' : 'Save to favourite voices'}
                                    className="p-1 rounded hover:bg-white/10"
                                  >
                                    <Star
                                      className={`w-4 h-4 ${v.isFavourite ? 'fill-[#F5A623] text-[#F5A623]' : theme.textMuted}`}
                                    />
                                  </button>
                                  {v.previewUrl && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); previewVoice(v); }}
                                      title={isPlaying ? 'Stop preview' : 'Play preview'}
                                      className="p-1 rounded hover:bg-white/10"
                                    >
                                      {isPlaying ? <Pause className="w-4 h-4 text-[#F5A623]" /> : <Play className={`w-4 h-4 ${theme.textMuted}`} />}
                                    </button>
                                  )}
                                </div>
                              </div>
                              {isSelected && (
                                <div className="mt-2 text-[10px] font-semibold text-[#F5A623] uppercase tracking-wide">
                                  ✓ Selected for this video
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {voiceCatalog.length === 0 && !voiceCatalogLoading && !voiceCatalogError && !voiceCatalogCanFallback && (
                      <p className={`text-xs ${theme.textSecondary}`}>
                        Click "Load Voices" to fetch ElevenLabs voices for {audioLanguageCode.toUpperCase()} · {voiceGender}.
                      </p>
                    )}
                  </div>
                )}

                {audioEnabled && musicSource === 'elevenlabs_ai' && (
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Music Prompt (Optional)</label>
                    <textarea
                      value={musicPrompt}
                      onChange={(e) => setMusicPrompt(e.target.value.slice(0, 500))}
                      placeholder="Leave empty to auto-derive from voice script + scene emotions. Or type your own — e.g. 'warm sentimental Indian classical instrumental, gentle strings, tabla rhythm, no vocals'"
                      className={`${inputClass} mt-2 min-h-[70px] w-full`}
                    />
                    <p className={`text-[10px] mt-1 text-right ${theme.textSecondary}`}>{musicPrompt.length}/500 · ElevenLabs eleven_music</p>
                  </div>
                )}

                {audioEnabled && musicSource === 'library' && (
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Music Track (Optional)</label>
                    <input
                      value={musicTrack}
                      onChange={(e) => setMusicTrack(e.target.value)}
                      placeholder="e.g. sonican-tropical-30-seconds-514742.mp3"
                      className={`${inputClass} mt-2 w-full`}
                    />
                    <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>
                      Leave empty to auto-pick a track for this video duration.
                    </p>
                  </div>
                )}

                {audioEnabled && audioMode === 'upload' && (
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3 space-y-3`}>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Upload Voice / Record Voice</label>
                    <input type="file" accept="audio/*" onChange={(e) => onManualVoiceUpload(e.target.files?.[0])} className="text-sm" />
                    <div className="flex gap-2">
                      {!isRecording ? (
                        <button onClick={startVoiceRecording} className="px-3 py-2 rounded-lg border border-slate-500 text-slate-200 text-sm">
                          <Mic className="w-4 h-4 inline mr-1" /> Start Recording
                        </button>
                      ) : (
                        <button onClick={stopVoiceRecording} className="px-3 py-2 rounded-lg border border-red-500 text-red-300 text-sm">
                          Stop Recording
                        </button>
                      )}
                    </div>
                    {manualVoiceName && <p className={`text-xs ${theme.textSecondary}`}>{manualVoiceName}</p>}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button onClick={generateAudioPreview} disabled={!canAudioPreview} className="px-4 py-2 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold disabled:opacity-60">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Generate Audio Preview'}
                  </button>
                  <button onClick={mixAudio} disabled={busy || !generatedTracks} className="px-4 py-2 rounded-xl border border-slate-500 text-slate-300 font-semibold disabled:opacity-60">
                    Mix Preview
                  </button>
                  <button onClick={generateAudioTracks} disabled={!canStep5Next} className={primaryButtonClass(!canStep5Next)}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Next'}
                  </button>
                </div>

                {(generatedTracks?.voiceUrl || generatedTracks?.backgroundUrl || generatedTracks?.manualUrl || finalAudioUrl) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeAudioScript && (
                      <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3 md:col-span-2`}>
                        <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Voice Script</p>
                        <p className={`text-sm mt-2 leading-relaxed whitespace-pre-wrap ${theme.text}`}>{activeAudioScript}</p>
                      </div>
                    )}
                    {generatedTracks?.voiceUrl && (
                      <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Voice Preview</p>
                          <button
                            onClick={() => toggleFavouriteAudio(generatedTracks.voiceUrl, 'voice', { languageCode, voiceId: selectedVoiceId, label: 'Voice preview' })}
                            title={favouriteAudioUrls.has(generatedTracks.voiceUrl) ? 'Remove from favourites' : 'Save to favourite audio'}
                            className="p-1 rounded hover:bg-white/10"
                          >
                            <Star className={`w-4 h-4 ${favouriteAudioUrls.has(generatedTracks.voiceUrl) ? 'fill-[#F5A623] text-[#F5A623]' : theme.textMuted}`} />
                          </button>
                        </div>
                        <audio controls src={generatedTracks.voiceUrl} className="w-full mt-2" />
                      </div>
                    )}
                    {generatedTracks?.backgroundUrl && (
                      <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Music Preview</p>
                          <button
                            onClick={() => toggleFavouriteAudio(generatedTracks.backgroundUrl, 'music', { prompt: musicPrompt, durationSeconds, label: musicSource === 'elevenlabs_ai' ? 'AI music' : 'Library music' })}
                            title={favouriteAudioUrls.has(generatedTracks.backgroundUrl) ? 'Remove from favourites' : 'Save to favourite audio'}
                            className="p-1 rounded hover:bg-white/10"
                          >
                            <Star className={`w-4 h-4 ${favouriteAudioUrls.has(generatedTracks.backgroundUrl) ? 'fill-[#F5A623] text-[#F5A623]' : theme.textMuted}`} />
                          </button>
                        </div>
                        <audio controls src={generatedTracks.backgroundUrl} className="w-full mt-2" />
                      </div>
                    )}
                    {generatedTracks?.manualUrl && (
                      <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Manual Voice Preview</p>
                          <button
                            onClick={() => toggleFavouriteAudio(generatedTracks.manualUrl, 'voice', { label: 'Manual voice' })}
                            className="p-1 rounded hover:bg-white/10"
                          >
                            <Star className={`w-4 h-4 ${favouriteAudioUrls.has(generatedTracks.manualUrl) ? 'fill-[#F5A623] text-[#F5A623]' : theme.textMuted}`} />
                          </button>
                        </div>
                        <audio controls src={generatedTracks.manualUrl} className="w-full mt-2" />
                      </div>
                    )}
                    {finalAudioUrl && (
                      <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Mixed Preview</p>
                          <button
                            onClick={() => toggleFavouriteAudio(finalAudioUrl, 'mix', { languageCode, voiceId: selectedVoiceId, label: 'Full mix' })}
                            className="p-1 rounded hover:bg-white/10"
                          >
                            <Star className={`w-4 h-4 ${favouriteAudioUrls.has(finalAudioUrl) ? 'fill-[#F5A623] text-[#F5A623]' : theme.textMuted}`} />
                          </button>
                        </div>
                        <audio controls src={finalAudioUrl} className="w-full mt-2" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 8 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 6: Audio Mixing Preview</h2>
                {activeAudioScript && (
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                    <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Voice Script</p>
                    <p className={`text-sm mt-2 leading-relaxed whitespace-pre-wrap ${theme.text}`}>{activeAudioScript}</p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {generatedTracks?.voiceUrl && (
                    <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Voice Preview</p>
                      <audio controls src={generatedTracks.voiceUrl} className="w-full mt-2" />
                    </div>
                  )}
                  {generatedTracks?.backgroundUrl && (
                    <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Music Preview</p>
                      <audio controls src={generatedTracks.backgroundUrl} className="w-full mt-2" />
                    </div>
                  )}
                  {generatedTracks?.manualUrl && (
                    <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Manual Voice Preview</p>
                      <audio controls src={generatedTracks.manualUrl} className="w-full mt-2" />
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <button onClick={mixAudio} disabled={busy} className="px-5 py-3 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold disabled:opacity-60">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Mix Audio'}
                  </button>
                  <button onClick={() => setStep(9)} disabled={!canStep6Next} className={primaryButtonClass(!canStep6Next)}>Next</button>
                </div>
                {finalAudioUrl && (
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                    <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>final_audio.mp3</p>
                    <audio controls src={finalAudioUrl} className="w-full mt-2" />
                  </div>
                )}
              </div>
            )}

            {step === 9 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 7: Video + Audio Merge</h2>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <button onClick={mergeVideo} disabled={busy} className="px-5 py-3 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold disabled:opacity-60">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Merge Video + Audio'}
                  </button>
                  <button onClick={() => setStep(10)} disabled={!canStep7Next} className={primaryButtonClass(!canStep7Next)}>Next</button>
                </div>
                {(finalOutputUrl || finalVideoUrl) && (
                  <div>
                    <video controls src={finalOutputUrl || finalVideoUrl} className="w-full rounded-lg max-h-[520px]" />
                    <p className={`text-xs mt-2 ${theme.textSecondary}`}>{finalOutputUrl ? 'final_output.mp4' : 'final_video.mp4'}</p>
                  </div>
                )}
              </div>
            )}

            {step === 10 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 8: Thumbnail + Content Generation</h2>
                <button onClick={generateContent} disabled={busy} className="px-4 py-2 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Generate Thumbnail + Caption + Hashtags'}
                </button>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                    <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Thumbnail</p>
                    {thumbnailUrl ? (
                      <img src={thumbnailUrl} alt="thumbnail" className="w-full rounded-lg mt-3 max-h-[320px] object-cover" />
                    ) : (
                      <div className="h-[220px] rounded-lg mt-3 border border-dashed border-slate-600 flex items-center justify-center">
                        <ImageIcon className="w-7 h-7 text-slate-500" />
                      </div>
                    )}
                  </div>
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3 space-y-3`}>
                    <div>
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Caption</label>
                      <textarea value={caption} onChange={(e) => setCaption(e.target.value)} className={`${inputClass} mt-2 min-h-[110px]`} />
                    </div>
                    <div>
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Hashtags</label>
                      <textarea value={hashtagsText} onChange={(e) => setHashtagsText(e.target.value)} className={`${inputClass} mt-2 min-h-[90px]`} />
                    </div>
                  </div>
                </div>
                <button onClick={() => setStep(11)} disabled={!canStep8Next} className={primaryButtonClass(!canStep8Next)}>Next</button>
              </div>
            )}

            {step === 11 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 9: Platform Selection</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {['instagram', 'facebook', 'linkedin', 'youtube'].map((platform) => {
                    const active = selectedPlatforms.includes(platform);
                    return (
                      <button
                        key={platform}
                        onClick={() => togglePlatform(platform)}
                        className={`px-4 py-3 rounded-xl border text-sm font-semibold ${active
                          ? 'bg-[#ffcc29] text-black border-[#ffcc29]'
                          : isDarkMode
                            ? 'bg-slate-900 border-slate-700 text-slate-200'
                            : 'bg-white border-slate-300 text-slate-700'
                          }`}
                      >
                        {platform.charAt(0).toUpperCase() + platform.slice(1)}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setStep(12)} disabled={!canStep9Next} className={primaryButtonClass(!canStep9Next)}>Next</button>
              </div>
            )}

            {step === 12 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 10: Scheduling</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Date</label>
                    <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className={`${inputClass} mt-2`} />
                  </div>
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Time</label>
                    <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className={`${inputClass} mt-2`} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => schedulePost(false)} disabled={!canSchedule} className={primaryButtonClass(!canSchedule)}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Post / Schedule'}
                  </button>
                  <button onClick={() => schedulePost(true)} disabled={busy} className="px-6 py-3 rounded-xl border border-slate-500 text-slate-200 font-semibold">
                    Publish Now
                  </button>
                </div>
              </div>
            )}

            {step === 13 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Final Step: Output</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                    <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Final Video</p>
                    {(finalOutputUrl || finalVideoUrl) ? (
                      <video controls src={finalOutputUrl || finalVideoUrl} className="w-full rounded-lg mt-3 max-h-[520px]" />
                    ) : (
                      <p className={`text-sm mt-3 ${theme.textSecondary}`}>No final video available.</p>
                    )}
                  </div>
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3 space-y-3`}>
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Thumbnail</p>
                      {thumbnailUrl ? <img src={thumbnailUrl} alt="thumbnail" className="w-full rounded-lg mt-2 max-h-[240px] object-cover" /> : <p className={`text-sm mt-2 ${theme.textSecondary}`}>No thumbnail</p>}
                    </div>
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Caption</p>
                      <p className={`text-sm mt-1 ${theme.text}`}>{caption || 'No caption'}</p>
                    </div>
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Hashtags</p>
                      <p className={`text-sm mt-1 ${theme.text}`}>{hashtagsText || 'No hashtags'}</p>
                    </div>
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Platforms</p>
                      <p className={`text-sm mt-1 ${theme.text}`}>{selectedPlatforms.join(', ') || 'None'}</p>
                    </div>
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Status</p>
                      <p className={`text-sm mt-1 ${theme.text}`}>
                        {statusLabel(draft?.schedule?.status?.includes('published') ? 'posted' : (draft?.schedule?.status || (finalOutputUrl || finalVideoUrl ? 'created' : 'draft')))}
                      </p>
                    </div>
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Scheduled</p>
                      <p className={`text-sm mt-1 ${theme.text}`}>
                        {draft?.schedule?.scheduledAt ? new Date(draft.schedule.scheduledAt).toLocaleString() : 'Not scheduled'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => schedulePost(true)} disabled={busy} className="px-6 py-3 rounded-xl bg-[#ffcc29] text-black font-bold">
                    Publish
                  </button>
                  <button
                    onClick={() => resetWizard()}
                    className="px-6 py-3 rounded-xl border border-slate-500 text-slate-200 font-semibold"
                  >
                    Start New Wizard
                  </button>
                </div>
              </div>
            )}

            <div className={`${panelClass} p-3`}>
              <p className={`text-xs ${theme.textMuted} flex items-center gap-2`}>
                <Music2 className="w-4 h-4" />
                APIs: createDraft, generatePrompt, generateScenes, generateImages, generateClips, generateAudio, mixAudio, mergeVideo, generateContent, schedulePost.
              </p>
              {jobId && <p className={`text-xs mt-1 ${theme.textSecondary}`}>Current jobId: {jobId}</p>}
            </div>
          </>
        )}
      </div>

      {/* Full Screen Image Preview Modal */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setPreviewImageUrl(null)}>
          <button 
            className="absolute top-6 right-6 text-white hover:text-gray-300 transition"
            onClick={(e) => { e.stopPropagation(); setPreviewImageUrl(null); }}
          >
            <X className="w-8 h-8" />
          </button>
          <img 
            src={previewImageUrl} 
            alt="Preview" 
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      
      {/* Full Screen Image Preview Modal */}
      {previewImageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setPreviewImageModal(null)}>
          <button className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition">
            <XCircle className="w-6 h-6" />
          </button>
          <img src={previewImageModal} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* Finished-Video Preview Modal — plays the MP4 with full controls
          (audio + video), shows caption, download link, and close. Opens
          when clicking a card whose draft has a finished video URL. */}
      {previewDraft && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewDraft(null)}
        >
          <div
            className="relative w-full max-w-[1080px] max-h-[92vh] bg-[#0A0A0A] rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col md:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewDraft(null)}
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/70 hover:bg-red-600 text-white flex items-center justify-center"
              title="Close"
            >
              <XCircle className="w-5 h-5" />
            </button>

            {/* Video — vertical / 9:16 shown in a max-height frame */}
            <div className="flex-1 bg-black flex items-center justify-center min-h-[320px] md:min-h-[560px] md:max-w-[62%]">
              <video
                src={previewDraft.__videoUrl}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-[88vh] w-auto h-auto object-contain bg-black"
              />
            </div>

            {/* Meta panel */}
            <div className="w-full md:w-[38%] p-6 flex flex-col gap-4 overflow-y-auto">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40 mb-1">
                  Final output
                </div>
                <h2 className="text-[22px] font-semibold text-[#F5F4F1] leading-tight">
                  {previewDraft.title || 'Untitled'}
                </h2>
              </div>

              {previewDraft.caption && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40 mb-2">
                    Caption
                  </div>
                  <p className="text-[13.5px] text-white/80 leading-relaxed whitespace-pre-line">
                    {previewDraft.caption}
                  </p>
                </div>
              )}

              {Array.isArray(previewDraft.hashtags) && previewDraft.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  {previewDraft.hashtags.map((h: string, i: number) => (
                    <span key={i} className="text-[12.5px] text-[#F5A623]">
                      {h.startsWith('#') ? h : '#' + h}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-auto pt-4 border-t border-white/[0.06] flex flex-col gap-2">
                <a
                  href={previewDraft.__videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-lg bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208] text-[13.5px] font-semibold flex items-center justify-center gap-2"
                >
                  Open in new tab
                </a>
                <a
                  href={previewDraft.__videoUrl}
                  download={(previewDraft.title || 'gravity-video') + '.mp4'}
                  className="w-full h-11 rounded-lg border border-white/[0.10] hover:border-white/25 hover:bg-white/[0.04] text-[#F5F4F1] text-[13.5px] font-medium flex items-center justify-center gap-2"
                >
                  Download MP4
                </a>
                {(previewDraft.generationProgress?.jobId || previewDraft.jobId) && (
                  <button
                    onClick={() => {
                      const jid = previewDraft.generationProgress?.jobId || previewDraft.jobId;
                      setPreviewDraft(null);
                      openVideoDraft(jid);
                    }}
                    className="w-full h-11 rounded-lg text-white/55 hover:text-[#F5F4F1] text-[12.5px] font-medium"
                  >
                    Open full wizard →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReelGenerator;
