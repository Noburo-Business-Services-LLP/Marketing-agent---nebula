import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Clapperboard, Users, BookOpen, Wand2, Check,
  Edit3, Loader2, RefreshCw, Image as ImageIcon, Video,
  MapPin, Heart, Camera, Shirt, Mic2, ChevronDown, ChevronUp,
  AlertCircle, Film, User, Sparkles, ArrowRight, ArrowLeft, Package, Trash2, Plus, Music2, Eye, X
} from 'lucide-react';
import { videoGenerationAPI, aiDirectorAPI, inventoryAPI, draftsAPI, contentCalendarAPI } from '../services/api';
import { pollDirectorJob, findActiveQueueJob } from '../utils/directorJobPolling';
import { CharacterManager } from '../components/CharacterManager';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import { Product, Draft } from '../types';
import { useSearchParams } from 'react-router-dom';

type VideoStatusFilter = 'all' | 'draft' | 'created' | 'scheduled' | 'posted';
type AudioMode = 'off' | 'auto' | 'upload';
type PromptImproveType = 'image' | 'video';

const VIDEO_STYLES = [
  'Cinematic Commercial', 'Luxury Brand Film', 'Documentary Style',
  'Energetic Ads', 'Wedding & Lifestyle', 'Corporate Explainer',
];

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

const WIZARD_STEPS = [
  { id: 1, label: 'Business & Brief', icon: Film },
  { id: 2, label: 'Characters', icon: Users },
  { id: 3, label: 'AI Director Story', icon: BookOpen },
  { id: 4, label: 'Prompts & Scenes', icon: Wand2 },
  { id: 5, label: 'Scene Images', icon: ImageIcon },
  { id: 6, label: 'Video Clips', icon: Video },
  { id: 7, label: 'Audio Config & Mix', icon: Mic2 },
  { id: 8, label: 'Video Merge', icon: Film },
  { id: 9, label: 'Thumbnail & Content', icon: Sparkles },
  { id: 10, label: 'Publish & Schedule', icon: Check },
];

const MIN_WIZARD_STEP = WIZARD_STEPS[0].id;
const MAX_WIZARD_STEP = WIZARD_STEPS[WIZARD_STEPS.length - 1].id;

function normalizeWizardStep(value: unknown, fallback = MIN_WIZARD_STEP) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(MAX_WIZARD_STEP, Math.max(MIN_WIZARD_STEP, Math.trunc(numericValue)));
}

// Split a stored ISO timestamp back into the local date (yyyy-mm-dd) and time (HH:mm)
// strings expected by the <input type="date"> / <input type="time"> controls.
function splitScheduledAt(scheduledAt: unknown): { date: string; time: string } {
  const raw = String(scheduledAt || '').trim();
  if (!raw) return { date: '', time: '' };
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  };
}

function compactDirectorScene(scene: any) {
  return {
    sceneId: scene?.sceneId,
    sceneNumber: scene?.sceneNumber,
    title: scene?.title,
    description: scene?.description,
    environment: scene?.environment,
    characterAction: scene?.characterAction,
    sceneMood: scene?.sceneMood,
    lighting: scene?.lighting,
    weather: scene?.weather,
    timeOfDay: scene?.timeOfDay,
    foregroundObjects: scene?.foregroundObjects,
    backgroundObjects: scene?.backgroundObjects,
    cameraDirection: scene?.cameraDirection,
    cameraMovement: scene?.cameraMovement,
    characterExpression: scene?.characterExpression,
    characterPose: scene?.characterPose,
    visualStyle: scene?.visualStyle,
    colorPalette: scene?.colorPalette,
    shotComposition: scene?.shotComposition,
    transition: scene?.transition,
    audio: scene?.audio,
    action: scene?.action,
    voiceLine: scene?.voiceLine,
    durationSeconds: scene?.durationSeconds,
    imagePrompt: scene?.imagePrompt,
    videoPrompt: scene?.videoPrompt,
    imageUrl: scene?.imageUrl,
    generatedImageUrl: scene?.generatedImageUrl,
    clipUrl: scene?.clipUrl,
    videoUrl: scene?.videoUrl,
    generatedVideoUrl: scene?.generatedVideoUrl
  };
}

function compactDirectorDraft(draft: any) {
  if (!draft) return null;
  return {
    jobId: draft.jobId,
    businessName: draft.businessName,
    industry: draft.industry,
    targetAudience: draft.targetAudience,
    brandTone: draft.brandTone,
    commercialObjective: draft.commercialObjective,
    brandSummary: draft.brandSummary,
    description: draft.description,
    videoStyle: draft.videoStyle,
    durationSeconds: draft.durationSeconds,
    useLogo: draft.useLogo,
    useCharacters: draft.useCharacters,
    storyDirection: draft.storyDirection,
    selectedProductId: draft.selectedProductId,
    productId: draft.productId,
    productionBible: draft.productionBible,
    voiceScript: draft.voiceScript,
    scenes: Array.isArray(draft.scenes) ? draft.scenes.map(compactDirectorScene) : [],
    characters: Array.isArray(draft.characters) ? draft.characters : [],
    finalAudioUrl: draft.finalAudioUrl,
    finalVideoUrl: draft.finalVideoUrl,
    finalOutputUrl: draft.finalOutputUrl,
    thumbnailUrl: draft.thumbnailUrl,
    caption: draft.caption,
    hashtagsText: draft.hashtagsText,
    audio: draft.audio,
    mix: draft.mix,
    selectedPlatforms: draft.selectedPlatforms,
    scheduleDate: draft.scheduleDate,
    scheduleTime: draft.scheduleTime,
    currentStep: draft.currentStep
  };
}

function safeSetLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Could not save ${key} in browser storage`, error);
    return false;
  }
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function statusPillClass(status?: string) {
  switch (status) {
    case 'created':
    case 'ready':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'scheduled':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'posted':
    case 'published':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
    default:
      return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
  }
}

function statusLabel(status?: string) {
  switch (status) {
    case 'created':
    case 'ready':
      return 'Created';
    case 'scheduled':
      return 'Scheduled';
    case 'posted':
    case 'published':
      return 'Posted';
    default:
      return 'Draft';
  }
}

function sceneNumberOf(scene: any, index: number) {
  return Number(scene?.sceneNumber || scene?.index || index + 1) || index + 1;
}

function sceneStoryText(scene: any) {
  let text = String(
    scene?.action ||
    scene?.story ||
    scene?.description ||
    scene?.narration ||
    scene?.voiceLine ||
    scene?.imagePrompt ||
    ''
  ).trim();

  // Strip legacy fallback placeholder strings if present in stored draft data
  text = text.replace(/Commercial brand showcase\s*-\s*Commercial Scene Beat\s*\d+/gi, '').trim();
  text = text.replace(/Commercial Scene Beat\s*\d+/gi, '').trim();
  return text;
}

function normalizeDirectorScene(scene: any, index: number) {
  const sceneNumber = sceneNumberOf(scene, index);
  return {
    ...scene,
    sceneId: String(scene?.sceneId || scene?.id || `SC_${String(sceneNumber).padStart(3, '0')}`),
    sceneNumber,
    title: String(scene?.title || `Scene ${sceneNumber}`),
    action: sceneStoryText(scene),
    durationSeconds: Number(scene?.durationSeconds || scene?.duration || 5) || 5,
    generatedImageUrl: scene?.generatedImageUrl || scene?.imageUrl || '',
    imageUrl: scene?.imageUrl || scene?.generatedImageUrl || '',
    clipUrl: scene?.clipUrl || scene?.generatedVideoUrl || scene?.videoUrl || scene?.video_url || '',
    videoUrl: scene?.videoUrl || scene?.generatedVideoUrl || scene?.clipUrl || scene?.video_url || '',
    generatedVideoUrl: scene?.generatedVideoUrl || scene?.videoUrl || scene?.video_url || scene?.clipUrl || ''
  };
}

function resolveDirectorScenes(source: any, fallback: any = {}) {
  const normalizeLayer = (val: any) => {
    if (Array.isArray(val)) return val;
    if (val && typeof val === 'object') {
      const keys = Object.keys(val).filter(k => /^\d+$/.test(k));
      if (keys.length > 0) {
        return keys.sort((a, b) => Number(a) - Number(b)).map(k => val[k]);
      }
    }
    return null;
  };

  const layers = [
    normalizeLayer(fallback?.draft?.clips?.sceneData),
    normalizeLayer(fallback?.draft?.images?.sceneData),
    normalizeLayer(source?.clips?.sceneData),
    normalizeLayer(source?.images?.sceneData),
    normalizeLayer(fallback?.draft?.scenes),
    normalizeLayer(fallback?.scenes),
    normalizeLayer(source?.scenes?.sceneData),
    normalizeLayer(source?.scenes)
  ].filter(Boolean) as any[][];

  if (!layers.length) return [];

  // URL fields that should never be overwritten with empty/falsy values
  const urlFields = ['clipUrl', 'videoUrl', 'generatedVideoUrl', 'video_url', 'imageUrl', 'generatedImageUrl'];

  const merged = new Map<string, any>();
  layers.forEach((layer: any[]) => {
    layer.forEach((scene, index) => {
      const normalized = normalizeDirectorScene(scene, index);
      const key = normalized.sceneId || String(normalized.sceneNumber || index + 1);
      const current = merged.get(key) || {};

      // Strip empty URL fields from normalized so they don't overwrite valid existing values
      const safeNormalized = { ...normalized };
      urlFields.forEach((field) => {
        if (!safeNormalized[field] && current[field]) {
          delete safeNormalized[field];
        }
      });

      merged.set(key, normalizeDirectorScene({ ...current, ...safeNormalized }, index));
    });
  });

  return Array.from(merged.values()).sort((a, b) => sceneNumberOf(a, 0) - sceneNumberOf(b, 0));
}

function directorSceneClipUrl(scene: any) {
  return String(scene?.clipUrl || scene?.generatedVideoUrl || scene?.videoUrl || scene?.video_url || scene?.falVideoUrl || '').trim();
}

function resolvePrimaryCharacterId(draft: any, characters: any[] = []) {
  const list = characters.length ? characters : (Array.isArray(draft?.characters) ? draft.characters : []);
  const withSheet = list.find((c) => c?.image || c?.imageUrl);
  const lead = withSheet || list[0];
  return (
    draft?.identityMemoryId
    || draft?.characterId
    || lead?.identityMemoryId
    || lead?.characterId
    || lead?.id
    || undefined
  );
}

function collectDirectorClipUrls(...sources: any[]) {
  const urls: string[] = [];
  sources.forEach((source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach((item) => {
        if (typeof item === 'string') urls.push(item);
        else urls.push(directorSceneClipUrl(item));
      });
      return;
    }
    if (Array.isArray(source?.clipUrls)) urls.push(...source.clipUrls);
    if (Array.isArray(source?.clips?.clipUrls)) urls.push(...source.clips.clipUrls);
    if (Array.isArray(source?.clips?.sceneData)) urls.push(...source.clips.sceneData.map(directorSceneClipUrl));
    if (Array.isArray(source?.scenes)) urls.push(...source.scenes.map(directorSceneClipUrl));
    if (Array.isArray(source?.scenes?.sceneData)) urls.push(...source.scenes.sceneData.map(directorSceneClipUrl));
    if (Array.isArray(source?.images?.sceneData)) urls.push(...source.images.sceneData.map(directorSceneClipUrl));
  });
  return [...new Set(urls.map((url) => String(url || '').trim()).filter(Boolean))];
}

export default function DirectorStudio() {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [searchParams, setSearchParams] = useSearchParams();

  const panelClass = `${theme.bgCard} border ${isDarkMode ? 'border-slate-800' : 'border-slate-200'} rounded-2xl shadow-xl`;
  const inputClass = `w-full rounded-xl border px-4 py-3 text-sm outline-none transition ${isDarkMode ? 'bg-slate-900 border-slate-700 text-white focus:border-[#ffcc29]' : 'bg-white border-slate-300 text-slate-900 focus:border-[#ffcc29]'
    }`;

  // Tabs & Draft management
  const [showWizard, setShowWizard] = useState(false);
  const [statusFilter, setStatusFilter] = useState<VideoStatusFilter>('all');
  const [videoDrafts, setVideoDrafts] = useState<any[]>([]);
  const [reelDraftsList, setReelDraftsList] = useState<Draft[]>([]);
  const [deletingDraftId, setDeletingDraftId] = useState('');

  // Auto-save timer ref
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storyAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productionAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const LS_KEY = 'director_studio_draft_v1';

  // Active Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const [hydratingDraft, setHydratingDraft] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const [jobId, setJobId] = useState('');
  const [scenes, setScenes] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [generatingAllImages, setGeneratingAllImages] = useState(false);
  const [generatingAllVideos, setGeneratingAllVideos] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [uiState, setUiState] = useState<Record<string, any>>({});

  // Step 1 Form state
  const [useCharacters, setUseCharacters] = useState(true);
  const [useLogo, setUseLogo] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [brandSummary, setBrandSummary] = useState('');
  const [brandTone, setBrandTone] = useState('');
  const [commercialObjective, setCommercialObjective] = useState('');
  const [videoStyle, setVideoStyle] = useState('Cinematic Commercial');
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [storyDirection, setStoryDirection] = useState('');

  // Optional media & product selection
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');

  // Audio / Merge / Scheduling states
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [audioMode, setAudioMode] = useState<AudioMode>('auto');
  const [audioPriority, setAudioPriority] = useState<'voice' | 'balanced' | 'music'>('balanced');
  const [audioTone, setAudioTone] = useState('professional');
  const [audioLanguageCode, setAudioLanguageCode] = useState('en');
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('female');
  const [voiceVolume, setVoiceVolume] = useState(1);
  const [musicVolume, setMusicVolume] = useState(0.24);
  const [generatedTracks, setGeneratedTracks] = useState<any>(null);
  const [finalAudioUrl, setFinalAudioUrl] = useState('');
  const [finalVideoUrl, setFinalVideoUrl] = useState('');
  const [finalOutputUrl, setFinalOutputUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{
    type: 'image' | 'video';
    scene: any;
    instruction: string;
  } | null>(null);


  const [customAudioData, setCustomAudioData] = useState<string>('');
  const [customAudioName, setCustomAudioName] = useState<string>('');
  
  const handleCustomAudioChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setBusy(true);
      setBusyMsg('Reading uploaded voice track file...');
      const base64Data = await fileToDataUrl(file);
      setCustomAudioData(base64Data);
      setCustomAudioName(file.name);
      isAudioDirtyRef.current = true;
    } catch (err: any) {
      alert(err.message || 'Failed to read audio file');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const saveVersionRef = useRef(0);
  const isAudioDirtyRef = useRef(false);

  // Per-scene editing & generation states
  const [promptLoadingSceneId, setPromptLoadingSceneId] = useState<string | null>(null);
  const [improvingPrompt, setImprovingPrompt] = useState(false);
  const [promptImproveSceneId, setPromptImproveSceneId] = useState('');
  const [promptImproveType, setPromptImproveType] = useState<PromptImproveType>('image');
  const [promptImproveRequest, setPromptImproveRequest] = useState('');
  const [imgLoadingSceneId, setImgLoadingSceneId] = useState<string | null>(null);
  const [vidLoadingSceneId, setVidLoadingSceneId] = useState<string | null>(null);

  const applyDraftState = useCallback((d: any, fallback: any = {}) => {
    if (!d) return;
    const aCfg = d.audioConfig || d.audio?.config || d.audio || fallback.audioConfig || fallback.audio?.config || {};
    console.log("[Audio State Update]", {
      source: "applyDraftState",
      audioPriority: aCfg.audioPriority || fallback.audioPriority || 'balanced',
      languageCode: aCfg.languageCode || d.audioLanguageCode || fallback.audioLanguageCode || 'en',
      voiceGender: aCfg.voiceGender || d.voiceGender || fallback.voiceGender || 'female',
      mode: aCfg.mode || fallback.audioMode || 'auto'
    });
    setDraft(d);
    setJobId(d.jobId || fallback.jobId || '');
    setScenes(resolveDirectorScenes(d, fallback));
    setCharacters(Array.isArray(d.characters) ? d.characters : []);
    setBusinessName((prev: string) => d.businessName !== undefined && d.businessName !== '' ? d.businessName : (prev || fallback.businessName || ''));
    setIndustry((prev: string) => d.industry !== undefined && d.industry !== '' ? d.industry : (prev || fallback.industry || ''));
    setTargetAudience((prev: string) => d.targetAudience !== undefined && d.targetAudience !== '' ? d.targetAudience : (prev || fallback.targetAudience || ''));
    setBrandTone((prev: string) => d.brandTone !== undefined && d.brandTone !== '' ? d.brandTone : (prev || fallback.brandTone || ''));
    setCommercialObjective((prev: string) => d.commercialObjective !== undefined && d.commercialObjective !== '' ? d.commercialObjective : (prev || fallback.commercialObjective || ''));
    setBrandSummary((prev: string) => d.brandSummary !== undefined && d.brandSummary !== '' ? d.brandSummary : (d.description !== undefined && d.description !== '' ? d.description : (prev || fallback.brandSummary || '')));
    setVideoStyle(d.videoStyle || fallback.videoStyle || 'Cinematic Commercial');
    setDurationSeconds(d.durationSeconds || fallback.durationSeconds || 30);
    setUseLogo(d.useLogo !== undefined ? d.useLogo : (fallback.useLogo || false));
    setUseCharacters(fallback.useCharacters !== undefined ? fallback.useCharacters : (d.useCharacters !== undefined ? d.useCharacters : true));
    setStoryDirection(d.storyDirection || fallback.storyDirection || '');
    setSelectedProductId(d.selectedProductId || d.productId || fallback.selectedProductId || '');
    setImageDataUrl(d.imageDataUrl || fallback.imageDataUrl || '');
    setFinalAudioUrl(d.finalAudioUrl || fallback.finalAudioUrl || '');
    const rawVideoUrl = d.finalVideoUrl || fallback.finalVideoUrl || '';
    const rawOutputUrl = d.finalOutputUrl || fallback.finalOutputUrl || '';
    setFinalVideoUrl(rawVideoUrl ? `${rawVideoUrl.split('?')[0]}?t=${Date.now()}` : '');
    setFinalOutputUrl(rawOutputUrl ? `${rawOutputUrl.split('?')[0]}?t=${Date.now()}` : '');
    setThumbnailUrl(d.thumbnailUrl || d.content?.thumbnailUrl || d.thumbnails?.url || fallback.thumbnailUrl || '');
    setCaption(d.caption || d.content?.caption || fallback.caption || '');
    const dTags = d.hashtagsText || (Array.isArray(d.content?.hashtags) ? d.content.hashtags.join(' ') : '') || fallback.hashtagsText || '';
    setHashtagsText(dTags);
    const audioConfig = d.audioConfig || d.audio?.config || d.audio || fallback.audioConfig || fallback.audio?.config || {};
    const audioTracks = d.audio?.tracks || fallback.audio?.tracks || null;
    const mixedUrl = d.mix?.finalAudioUrl || fallback.mix?.finalAudioUrl || d.finalAudioUrl || fallback.finalAudioUrl || '';
    setAudioEnabled(audioConfig.enabled !== false);
    setAudioMode((audioConfig.mode || fallback.audioMode || 'auto') as AudioMode);
    setAudioPriority((audioConfig.audioPriority || fallback.audioPriority || 'balanced') as 'voice' | 'balanced' | 'music');
    setAudioTone(audioConfig.tone || fallback.audioTone || 'professional');
    setAudioLanguageCode(audioConfig.languageCode || d.audioLanguageCode || fallback.audioLanguageCode || 'en');
    setVoiceGender((audioConfig.voiceGender || d.voiceGender || fallback.voiceGender || 'female') as 'male' | 'female');
    setVoiceVolume(Number.isFinite(Number(audioConfig.voiceVolume)) ? Number(audioConfig.voiceVolume) : (fallback.voiceVolume || 1));
    setMusicVolume(Number.isFinite(Number(audioConfig.musicVolume)) ? Number(audioConfig.musicVolume) : (fallback.musicVolume || 0.24));
    setGeneratedTracks(audioTracks);
    setFinalAudioUrl(mixedUrl);
    const platforms = (Array.isArray(d.platform?.selectedPlatforms) && d.platform.selectedPlatforms.length)
      ? d.platform.selectedPlatforms
      : (Array.isArray(d.selectedPlatforms) ? d.selectedPlatforms : (fallback.selectedPlatforms || []));
    setSelectedPlatforms((prev) => prev.length > 0 ? prev : platforms);
    const sched = splitScheduledAt(d.schedule?.scheduledAt);
    setScheduleDate((prev) => prev !== '' ? prev : (sched.date || d.scheduleDate || fallback.scheduleDate || ''));
    setScheduleTime((prev) => prev !== '' ? prev : (sched.time || d.scheduleTime || fallback.scheduleTime || ''));
    setCompletedSteps(d.completedSteps || fallback.completedSteps || []);
    setUiState(d.uiState || fallback.uiState || {});
    setDraftVersion(Number(d.version) || 0);
    setShowWizard(true);
  }, []);

  const saveDraftToBackend = useCallback(async (payload: Record<string, any>) => {
    if (!jobId) return;
    const currentSaveVersion = ++saveVersionRef.current;
    try {
      const res = await videoGenerationAPI.updateDraft(jobId, { ...payload, version: draftVersion });
      if (currentSaveVersion !== saveVersionRef.current) {
        // Ignore stale response from earlier out-of-order save
        return;
      }
      if (res?.draft?.version !== undefined) {
        setDraftVersion(Number(res.draft.version) || 0);
      } else if (res?.version !== undefined) {
        setDraftVersion(Number(res.version) || 0);
      }
      // Reset dirty flag after save completes
      isAudioDirtyRef.current = false;
    } catch (e: any) {
      if (e?.status === 409) {
        const refreshed = await videoGenerationAPI.getDraft(jobId);
        if (refreshed?.draft && !isAudioDirtyRef.current) applyDraftState(refreshed.draft);
      } else {
        console.warn('Director Studio autosave failed:', e?.message);
      }
    }
  }, [jobId, draftVersion, applyDraftState]);

  const handleQueueJobComplete = useCallback(async (result: any) => {
    if (result?.draft) {
      applyDraftState(result.draft);
    } else if (jobId) {
      const refreshed = await videoGenerationAPI.getDraft(jobId);
      if (refreshed?.draft) applyDraftState(refreshed.draft);
    }
    if (Array.isArray(result?.sceneData)) setScenes(result.sceneData);
    if (result?.audio?.tracks) setGeneratedTracks(result.audio.tracks);
  }, [jobId, applyDraftState]);

  const resumeActiveQueueJobs = useCallback(async (draftData: any, queueJobs: any[] = []) => {
    const active = findActiveQueueJob(draftData, queueJobs);
    if (!active?.jobId) return;

    const queueJobId = String(active.jobId);
    const step = String(active.currentStep || active.jobType || '').toLowerCase();

    if (pollAbortRef.current) pollAbortRef.current.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;

    setBusy(true);
    setBusyMsg('Resuming background job...');
    if (step.includes('image')) setGeneratingAllImages(true);
    if (step.includes('clip') || step.includes('video') || step.includes('scene')) setGeneratingAllVideos(true);

    try {
      const result = await pollDirectorJob(queueJobId, {
        signal: controller.signal,
        onProgress: (job) => {
          setBusyMsg(job?.currentStep ? `Processing: ${job.currentStep}` : 'Processing...');
          if (jobId) {
            videoGenerationAPI.getDraft(jobId).then((res) => {
              if (res?.draft) applyDraftState(res.draft);
            }).catch(() => {});
          }
        }
      });
      await handleQueueJobComplete(result);
    } catch (e: any) {
      if (e?.message !== 'Polling aborted' && e?.message !== 'Job cancelled.') {
        console.warn('Resume job failed:', e?.message);
        if (jobId) {
          const refreshed = await videoGenerationAPI.getDraft(jobId);
          if (refreshed?.draft) applyDraftState(refreshed.draft);
        }
      }
    } finally {
      setGeneratingAllImages(false);
      setGeneratingAllVideos(false);
      setBusy(false);
      setBusyMsg('');
      setImgLoadingSceneId(null);
      setVidLoadingSceneId(null);
    }
  }, [jobId, applyDraftState, handleQueueJobComplete]);

  const fetchDrafts = async () => {
    try {
      const response = await videoGenerationAPI.getDrafts();
      if (response?.success && Array.isArray(response?.drafts)) {
        // Deduplicate drafts by jobId
        const uniqueDraftsMap = new Map();
        response.drafts.forEach((d: any) => {
          if (d?.jobId) uniqueDraftsMap.set(d.jobId, d);
        });
        setVideoDrafts(Array.from(uniqueDraftsMap.values()));
      }
    } catch (_) { }
    try {
      const response = await draftsAPI.getDrafts('draft', 'reel');
      if (response?.drafts) {
        setReelDraftsList(response.drafts);
      }
    } catch (_) { }
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  // ── SessionStorage wizard state tracking
  useEffect(() => {
    if (showWizard) {
      sessionStorage.setItem('director_studio_wizard_active', 'true');
    } else {
      sessionStorage.removeItem('director_studio_wizard_active');
    }
  }, [showWizard]);

  // ── AUTO-RESUME: if user had an active draft open when they refreshed/navigated away, re-open it
  useEffect(() => {
    const qJobId = searchParams.get('jobId');
    const wasWizardActive = sessionStorage.getItem('director_studio_wizard_active') === 'true';
    const shouldShowWizard = Boolean(qJobId || wasWizardActive);

    const savedRaw = localStorage.getItem('director_studio_draft_v1');

    if (qJobId) {
      console.log("Loading specific draft from URL query parameter:", qJobId);
      openVideoDraft(qJobId);
      setSearchParams({}, { replace: true });
      return;
    }

    if (!savedRaw) {
      (async () => {
        try {
          const response = await videoGenerationAPI.getDrafts();
          if (response?.success && Array.isArray(response?.drafts)) {
            const uniqueDraftsMap = new Map();
            response.drafts.forEach((d: any) => {
              if (d?.jobId) uniqueDraftsMap.set(d.jobId, d);
            });
            const draftsList = Array.from(uniqueDraftsMap.values());
            setVideoDrafts(draftsList);
            const unfinished = draftsList
              .filter((d: any) => ['draft', 'processing', 'queued'].includes(String(d?.status || '').toLowerCase()))
              .sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
            if (unfinished.length > 0) {
              if (shouldShowWizard) {
                console.log("Auto-opening latest unfinished draft from backend:", unfinished[0].jobId);
                openVideoDraft(unfinished[0].jobId);
              } else {
                console.log("Populating latest unfinished draft in background:", unfinished[0].jobId);
                const res = await videoGenerationAPI.getDraft(unfinished[0].jobId);
                if (res?.success && res?.draft) {
                  applyDraftState(res.draft);
                  setShowWizard(false); // force false
                }
              }
            }
          }
        } catch (_) { }
      })();
      return;
    }
    try {
      const saved = JSON.parse(savedRaw);
      if (!saved?.jobId) return;

      if (shouldShowWizard) {
        setHydratingDraft(true);

        const restoreFromSnapshot = (snapshot: any) => {
          if (!snapshot) return;
          setDraft(snapshot.draft || null);
          setJobId(snapshot.jobId || '');
          setScenes(resolveDirectorScenes(snapshot.draft || snapshot, snapshot));
          setCharacters(Array.isArray(snapshot.characters) ? snapshot.characters : (snapshot.draft?.characters || []));
          setBusinessName(snapshot.businessName || snapshot.draft?.businessName || '');
          setIndustry(snapshot.industry || snapshot.draft?.industry || '');
          setTargetAudience(snapshot.targetAudience || snapshot.draft?.targetAudience || '');
          setBrandTone(snapshot.brandTone || snapshot.draft?.brandTone || '');
          setCommercialObjective(snapshot.commercialObjective || snapshot.draft?.commercialObjective || '');
          setBrandSummary(snapshot.brandSummary || snapshot.draft?.brandSummary || snapshot.draft?.description || '');
          setVideoStyle(snapshot.videoStyle || snapshot.draft?.videoStyle || 'Cinematic Commercial');
          setDurationSeconds(snapshot.durationSeconds || snapshot.draft?.durationSeconds || 30);
          setUseLogo(snapshot.useLogo !== undefined ? snapshot.useLogo : (snapshot.draft?.useLogo !== undefined ? snapshot.draft.useLogo : false));
          setUseCharacters(snapshot.useCharacters !== undefined ? snapshot.useCharacters : true);
          setStoryDirection(snapshot.storyDirection || snapshot.draft?.storyDirection || '');
          setSelectedProductId(snapshot.selectedProductId || snapshot.draft?.selectedProductId || '');
          setImageDataUrl(snapshot.imageDataUrl || snapshot.draft?.imageDataUrl || '');
          const audioConfig = snapshot.draft?.audio?.config || snapshot.audio?.config || {};
          const audioTracks = snapshot.draft?.audio?.tracks || snapshot.audio?.tracks || null;
          const mixedUrl = snapshot.draft?.mix?.finalAudioUrl || snapshot.mix?.finalAudioUrl || snapshot.finalAudioUrl || snapshot.draft?.finalAudioUrl || '';
          setAudioEnabled(audioConfig.enabled !== false);
          setAudioMode((audioConfig.mode || snapshot.audioMode || 'auto') as AudioMode);
          setAudioPriority((audioConfig.audioPriority || snapshot.audioPriority || 'balanced') as 'voice' | 'balanced' | 'music');
          setAudioTone(audioConfig.tone || snapshot.audioTone || 'professional');
          setAudioLanguageCode(audioConfig.languageCode || snapshot.audioLanguageCode || 'en');
          setVoiceGender((audioConfig.voiceGender || snapshot.voiceGender || 'female') as 'male' | 'female');
          setVoiceVolume(Number.isFinite(Number(audioConfig.voiceVolume)) ? Number(audioConfig.voiceVolume) : (snapshot.voiceVolume || 1));
          setMusicVolume(Number.isFinite(Number(audioConfig.musicVolume)) ? Number(audioConfig.musicVolume) : (snapshot.musicVolume || 0.24));
          setGeneratedTracks(audioTracks);
          setFinalAudioUrl(mixedUrl);
          setFinalVideoUrl(snapshot.finalVideoUrl || snapshot.draft?.finalVideoUrl || '');
          setFinalOutputUrl(snapshot.finalOutputUrl || snapshot.draft?.finalOutputUrl || '');
          setThumbnailUrl(snapshot.thumbnailUrl || snapshot.draft?.thumbnailUrl || snapshot.draft?.content?.thumbnailUrl || snapshot.draft?.thumbnails?.url || '');
          setCaption(snapshot.caption || snapshot.draft?.caption || snapshot.draft?.content?.caption || '');
          const snapTags = snapshot.hashtagsText || snapshot.draft?.hashtagsText || (Array.isArray(snapshot.draft?.content?.hashtags) ? snapshot.draft.content.hashtags.join(' ') : '') || '';
          setHashtagsText(snapTags);
          setSelectedPlatforms(Array.isArray(snapshot.selectedPlatforms) ? snapshot.selectedPlatforms : (snapshot.draft?.selectedPlatforms || []));
          setScheduleDate(snapshot.scheduleDate || snapshot.draft?.scheduleDate || '');
          setScheduleTime(snapshot.scheduleTime || snapshot.draft?.scheduleTime || '');
          setCompletedSteps(snapshot.completedSteps || snapshot.draft?.completedSteps || []);
          setUiState(snapshot.uiState || snapshot.draft?.uiState || {});
          setCurrentStep(normalizeWizardStep(snapshot.currentStep));
          setShowWizard(true);
        };

        restoreFromSnapshot(saved);

        (async () => {
          try {
            const res = await videoGenerationAPI.getDraft(saved.jobId);
            if (res?.success && res?.draft) {
              const d = res.draft;
              applyDraftState(d, saved);
              const savedStep = localStorage.getItem(`director_studio_step_${d.jobId}`);
              if (savedStep) setCurrentStep(normalizeWizardStep(savedStep));
              else if (saved.currentStep) setCurrentStep(normalizeWizardStep(saved.currentStep));
              else if (d.currentStep) setCurrentStep(normalizeWizardStep(d.currentStep));
              await resumeActiveQueueJobs(d, res.queueJobs || []);
            }
          } catch (_) { /* silent */ }
          finally {
            setHydratingDraft(false);
          }
        })();
      } else {
        (async () => {
          try {
            const res = await videoGenerationAPI.getDraft(saved.jobId);
            if (res?.success && res?.draft) {
              applyDraftState(res.draft, saved);
              setShowWizard(false); // force false
            }
          } catch (_) {}
        })();
      }
    } catch (_) { /* corrupt data — ignore */ }
  }, [searchParams]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await inventoryAPI.getProducts();
        if (res?.success && Array.isArray(res?.data)) {
          setProducts(res.data);
        }
      } catch (_) { }
    };
    fetchProducts();
  }, []);

  useEffect(() => {
    const aCfg = draft?.audioConfig || draft?.audio?.config || draft?.audio;
    console.log("[Audio State Update]", {
      source: "useEffect([draft])",
      isAudioDirty: isAudioDirtyRef.current,
      audioPriority: aCfg?.audioPriority,
      languageCode: aCfg?.languageCode || draft?.audioLanguageCode,
      voiceGender: aCfg?.voiceGender || draft?.voiceGender,
      mode: aCfg?.mode
    });
    if (draft?.scenes || draft?.images?.sceneData || draft?.clips?.sceneData) setScenes(resolveDirectorScenes(draft));
    if (draft?.characters) setCharacters(draft.characters);
    if (draft?.audio?.tracks) setGeneratedTracks(draft.audio.tracks);
    if (draft?.completedSteps) setCompletedSteps(draft.completedSteps);
    if (draft?.uiState) setUiState(draft.uiState);
    if (!isAudioDirtyRef.current) {
      if (aCfg && typeof aCfg === 'object') {
        setAudioEnabled(aCfg.enabled !== false);
        setAudioMode((aCfg.mode || 'auto') as AudioMode);
        setAudioPriority((aCfg.audioPriority || 'balanced') as 'voice' | 'balanced' | 'music');
        setAudioTone(aCfg.tone || 'professional');
        if (aCfg.languageCode || draft?.audioLanguageCode) {
          setAudioLanguageCode(aCfg.languageCode || draft?.audioLanguageCode || 'en');
        }
        if (aCfg.voiceGender || draft?.voiceGender) {
          setVoiceGender((aCfg.voiceGender || draft?.voiceGender || 'female') as 'male' | 'female');
        }
        if (Number.isFinite(Number(aCfg.voiceVolume))) setVoiceVolume(Number(aCfg.voiceVolume));
        if (Number.isFinite(Number(aCfg.musicVolume))) setMusicVolume(Number(aCfg.musicVolume));
      }
    }
    if (draft?.mix?.finalAudioUrl || draft?.finalAudioUrl) setFinalAudioUrl(draft?.mix?.finalAudioUrl || draft.finalAudioUrl);
    if (draft?.finalVideoUrl) setFinalVideoUrl(draft.finalVideoUrl);
    if (draft?.finalOutputUrl) setFinalOutputUrl(draft.finalOutputUrl);
    if (draft?.thumbnailUrl || draft?.content?.thumbnailUrl || draft?.thumbnails?.url) {
      setThumbnailUrl(draft.thumbnailUrl || draft.content?.thumbnailUrl || draft.thumbnails?.url);
    }
  }, [draft]);

  useEffect(() => {
    if (!scenes.length) {
      setPromptImproveSceneId('');
      return;
    }
    if (!scenes.some((scene) => String(scene.sceneId) === String(promptImproveSceneId))) {
      setPromptImproveSceneId(String(scenes[0].sceneId));
    }
  }, [scenes, promptImproveSceneId]);

  useEffect(() => {
    if (jobId && currentStep) {
      safeSetLocalStorage(`director_studio_step_${jobId}`, String(currentStep));
    }
  }, [jobId, currentStep]);

  // ── SAVE the full draft state to localStorage so it can be restored with all scene/story/image/video details
  useEffect(() => {
    if (!jobId || hydratingDraft) return;
    const snapshot = {
      jobId,
      draft: compactDirectorDraft(draft),
      scenes: scenes.map(compactDirectorScene),
      characters,
      businessName, industry, targetAudience, brandSummary, brandTone,
      commercialObjective, videoStyle, durationSeconds, useCharacters, useLogo,
      storyDirection,
      selectedProductId,
      imageDataUrl: imageDataUrl && !imageDataUrl.startsWith('data:') ? imageDataUrl : '',
      finalAudioUrl, finalVideoUrl, finalOutputUrl,
      audio: {
        config: {
          enabled: audioEnabled,
          mode: audioEnabled ? audioMode : 'off',
          audioPriority,
          tone: audioTone,
          languageCode: audioLanguageCode,
          voiceGender,
          voiceVolume,
          musicVolume
        },
        tracks: generatedTracks
      },
      mix: finalAudioUrl ? { finalAudioUrl } : null,
      thumbnailUrl, caption, hashtagsText, selectedPlatforms, scheduleDate, scheduleTime,
      currentStep,
      completedSteps,
      uiState
    };
    const saved = safeSetLocalStorage(LS_KEY, JSON.stringify(snapshot));
    if (!saved) {
      safeSetLocalStorage(LS_KEY, JSON.stringify({ jobId, currentStep }));
    }
  }, [jobId, draft, scenes, characters, businessName, industry, targetAudience,
      brandSummary, brandTone, commercialObjective, videoStyle, durationSeconds,
      useCharacters, useLogo, storyDirection, selectedProductId, imageDataUrl, finalAudioUrl,
      finalVideoUrl, finalOutputUrl, thumbnailUrl, caption, hashtagsText,
      audioEnabled, audioMode, audioPriority, audioTone, audioLanguageCode, voiceGender,
      voiceVolume, musicVolume, generatedTracks, selectedPlatforms, scheduleDate, scheduleTime,
      currentStep, completedSteps, uiState, hydratingDraft]);

  // ── DEBOUNCED AUTO-SAVE to backend whenever Step 1 fields change and jobId exists
  const scheduleBackendAutoSave = useCallback(() => {
    if (!jobId) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      await saveDraftToBackend({
        businessName, industry, targetAudience, brandSummary, brandTone,
        commercialObjective, videoStyle, durationSeconds, useCharacters, useLogo,
        selectedProductId,
        imageDataUrl: imageDataUrl && !imageDataUrl.startsWith('data:') ? imageDataUrl : undefined,
        storyDirection, currentStep, completedSteps, uiState,
        description: brandSummary || `Commercial for ${businessName || 'Brand'}`
      });
    }, 500);
  }, [jobId, businessName, industry, targetAudience, brandSummary, brandTone,
      commercialObjective, videoStyle, durationSeconds, useCharacters, useLogo,
      selectedProductId, imageDataUrl, storyDirection, currentStep, completedSteps, uiState, saveDraftToBackend]);

  useEffect(() => {
    if (jobId && showWizard && !hydratingDraft) scheduleBackendAutoSave();
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [businessName, industry, targetAudience, brandSummary, brandTone,
      commercialObjective, videoStyle, durationSeconds, useCharacters, useLogo,
      selectedProductId, imageDataUrl, storyDirection, currentStep, completedSteps, uiState, jobId, showWizard, hydratingDraft]);

  const getBestContinueStep = () => {
    if (selectedPlatforms.length > 0 || scheduleDate || scheduleTime) return 10;
    if (thumbnailUrl || caption || hashtagsText) return 10;
    if (finalOutputUrl || finalVideoUrl) return 9;
    if (finalAudioUrl) return 8;
    if (scenes.some((scene) => scene.generatedVideoUrl)) return 7;
    if (scenes.some((scene) => scene.imageUrl || scene.generatedImageUrl)) return 6;
    if (scenes.some((scene) => scene.imagePrompt || scene.videoPrompt)) return 5;
    if (scenes.length > 0 || draft?.productionBible || draft?.voiceScript) return 3;
    if (characters.length > 0) return 2;
    return 1;
  };

  const getUnlockedStep = () => Math.max(currentStep, getBestContinueStep());

  const goToWizardStep = (targetStep: number) => {
    if (targetStep <= getUnlockedStep()) {
      setCurrentStep(targetStep);
    }
  };

  useEffect(() => {
    if (!jobId || !showWizard || hydratingDraft) return;
    if (storyAutoSaveTimer.current) clearTimeout(storyAutoSaveTimer.current);
    storyAutoSaveTimer.current = setTimeout(async () => {
      await saveDraftToBackend({
        scenes: scenes.map(compactDirectorScene),
        characters,
        productionBible: draft?.productionBible || {},
        voiceScript: draft?.voiceScript || '',
        storyDirection,
        currentStep,
        completedSteps,
        uiState
      });
    }, 500);
    return () => { if (storyAutoSaveTimer.current) clearTimeout(storyAutoSaveTimer.current); };
  }, [jobId, showWizard, hydratingDraft, scenes, characters, draft?.productionBible, draft?.voiceScript, storyDirection, currentStep, completedSteps, uiState, saveDraftToBackend]);

  useEffect(() => {
    if (!jobId || !showWizard || hydratingDraft) return;
    if (productionAutoSaveTimer.current) clearTimeout(productionAutoSaveTimer.current);
    productionAutoSaveTimer.current = setTimeout(async () => {
      await saveDraftToBackend({
        caption,
        hashtags: hashtagsText.split(/\s+/).filter(Boolean),
        thumbnailUrl,
        selectedPlatforms,
        scheduleDate,
        scheduleTime,
        audioConfig: {
          enabled: audioEnabled,
          mode: audioEnabled ? audioMode : 'off',
          audioPriority,
          tone: audioTone,
          languageCode: audioLanguageCode,
          voiceGender,
          voiceVolume,
          musicVolume
        },
        audio: {
          config: {
            enabled: audioEnabled,
            mode: audioEnabled ? audioMode : 'off',
            audioPriority,
            tone: audioTone,
            languageCode: audioLanguageCode,
            voiceGender,
            voiceVolume,
            musicVolume
          },
          tracks: generatedTracks
        },
        currentStep,
        completedSteps,
        uiState
      });
    }, 500);
    return () => { if (productionAutoSaveTimer.current) clearTimeout(productionAutoSaveTimer.current); };
  }, [jobId, showWizard, hydratingDraft, caption, hashtagsText, thumbnailUrl, selectedPlatforms,
      scheduleDate, scheduleTime, audioEnabled, audioMode, audioPriority, audioTone, audioLanguageCode,
      voiceGender, voiceVolume, musicVolume, generatedTracks, currentStep, completedSteps, uiState, saveDraftToBackend]);

  const filteredVideoDrafts = useMemo(
    () => videoDrafts.filter((item) => statusFilter === 'all' || item.status === statusFilter),
    [videoDrafts, statusFilter]
  );

  const resetWizard = () => {
    // Always clear the last persisted resume snapshot so a fresh Create action starts a brand new draft.
    localStorage.removeItem(LS_KEY);
    if (jobId) {
      localStorage.removeItem(`director_studio_step_${jobId}`);
    }

    // Full clean reset for a brand-new reel session.
    setJobId('');
    setDraft(null);
    setScenes([]);
    setCharacters([]);
    setGeneratingAllImages(false);
    setGeneratingAllVideos(false);

    setUseCharacters(true);
    setUseLogo(false);
    setBusinessName('');
    setIndustry('');
    setTargetAudience('');
    setBrandSummary('');
    setBrandTone('');
    setCommercialObjective('');
    setVideoStyle('Cinematic Commercial');
    setDurationSeconds(30);

    setProducts([]);
    setSelectedProductId('');
    setImageDataUrl('');

    setAudioEnabled(true);
    setAudioMode('auto');
    setAudioPriority('balanced');
    setAudioTone('professional');
    setAudioLanguageCode('en');
    setVoiceGender('female');
    setVoiceVolume(1);
    setMusicVolume(0.24);
    setGeneratedTracks(null);
    setFinalAudioUrl('');
    setFinalVideoUrl('');
    setFinalOutputUrl('');
    setThumbnailUrl('');
    setCaption('');
    setHashtagsText('');
    setSelectedPlatforms([]);
    setScheduleDate('');
    setScheduleTime('');
    setPreviewImageUrl(null);

    setCurrentStep(1);
    setShowWizard(true);
  };

  const openVideoDraft = async (targetJobId: string) => {
    try {
      setBusy(true);
      setHydratingDraft(true);
      setBusyMsg('Loading draft...');
      const res = await videoGenerationAPI.getDraft(targetJobId);
      if (res?.success && res?.draft) {
        const d = res.draft;
        applyDraftState(d);
        // Resume from: localStorage > DB saved step > scenes heuristic
        const savedStep = localStorage.getItem(`director_studio_step_${d.jobId}`);
        if (savedStep) {
          setCurrentStep(normalizeWizardStep(savedStep));
        } else if (d.currentStep && d.currentStep > 1) {
          setCurrentStep(normalizeWizardStep(d.currentStep));
        } else {
          setCurrentStep(d.scenes && d.scenes.length > 0 ? 3 : 1);
        }
        await resumeActiveQueueJobs(d, res.queueJobs || []);
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to load draft');
    } finally {
      setHydratingDraft(false);
      setBusy(false);
      setBusyMsg('');
    }
  };

  const deleteVideoDraft = async (targetJobId: string, title?: string) => {
    if (!window.confirm(`Delete "${title || 'draft'}"?`)) return;
    try {
      setDeletingDraftId(targetJobId);
      await videoGenerationAPI.deleteDraft(targetJobId);
      setVideoDrafts(prev => prev.filter(d => d.jobId !== targetJobId));
    } catch (_) {
      alert('Failed to delete draft');
    } finally {
      setDeletingDraftId('');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setImageDataUrl(dataUrl);
    } catch (_) {
      alert('Failed to process image');
    }
  };

  const handleStep1Submit = async () => {
    const continueStep = jobId ? getBestContinueStep() : 1;
    const shouldContinueExistingDraft = Boolean(jobId && continueStep > 2);

    if (shouldContinueExistingDraft) {
      setCurrentStep(continueStep);
    }

    setBusy(true);
    setBusyMsg(shouldContinueExistingDraft ? 'Saving brief changes...' : 'Saving brief & initializing commercial draft...');
    try {
      let activeJobId = jobId;

      if (!activeJobId) {
        const draftRes = await videoGenerationAPI.createDraft({
          businessName,
          industry,
          targetAudience,
          brandTone,
          commercialObjective,
          brandSummary,
          description: brandSummary || `Commercial for ${businessName || 'Brand'}`,
          videoStyle,
          durationSeconds,
          imageData: imageDataUrl,
          productId: selectedProductId,
          useLogo,
          useCharacters,
          storyDirection,
          currentStep: 1,
          completedSteps,
          uiState
        } as any);
        activeJobId = draftRes.draft.jobId;
        setDraft(draftRes.draft);
        setJobId(activeJobId);
      } else {
        const updatedFields = {
          businessName,
          industry,
          targetAudience,
          brandTone,
          commercialObjective,
          description: brandSummary || `Commercial for ${businessName || 'Brand'}`,
          videoStyle,
          durationSeconds,
          imageData: imageDataUrl,
          productId: selectedProductId,
          useLogo
        };
        const draftRes = await videoGenerationAPI.updateDraft(activeJobId, updatedFields);
        if (draftRes?.draft) {
          setDraft(draftRes.draft);
        }
      }

      if (shouldContinueExistingDraft) {
        fetchDrafts();
        return;
      }

      const bestContinueStep = getBestContinueStep();
      if (bestContinueStep > 2) {
        setCurrentStep(bestContinueStep);
        fetchDrafts();
        return;
      }

      // Step 1 -> Step 2 Character Manager or Step 3 Direct Story
      if (useCharacters) {
        setCurrentStep(2);
      } else {
        if (scenes.length > 0) {
          if (window.confirm("You already have an existing story and screenplay generated. Do you want to regenerate it from scratch? (Regenerating will replace all your scenes, prompts, and images. Cancel to keep your existing story and proceed.)")) {
            await handleGenerateStoryWithJobId(activeJobId);
          } else {
            setCurrentStep(3);
          }
        } else {
          await handleGenerateStoryWithJobId(activeJobId);
        }
      }

      fetchDrafts();
    } catch (e: any) {
      alert(e?.message || 'Failed to initialize draft');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const handleGenerateStoryWithJobId = async (targetJobId: string) => {
    setBusy(true);
    setBusyMsg('Gemini AI Director is writing story arc, casting approved characters & generating screenplay...');
    try {
      const res = await aiDirectorAPI.generateStory({
        jobId: targetJobId,
        businessName,
        industry,
        brandSummary,
        targetAudience,
        brandTone,
        commercialObjective,
        duration: durationSeconds,
        videoStyle,
        storyDirection
      });
      if (res?.draft) {
        setDraft(res.draft);
        if (res.draft.scenes) setScenes(res.draft.scenes);
        if (res.draft.characters) setCharacters(storyResDraftCharacters(res.draft));
      }
      setCurrentStep(3);
    } catch (e: any) {
      alert(e?.message || 'Failed to generate story with AI Director');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const storyResDraftCharacters = (d: any) => {
    return d.characters && d.characters.length > 0 ? d.characters : (characters || []);
  };

  const handleGenerateStory = async () => {
    if (!jobId) return;
    await handleGenerateStoryWithJobId(jobId);
  };

  const handleTryStoryDirection = async () => {
    if (!jobId || !storyDirection.trim()) return;
    if (scenes.length > 0 && !window.confirm('Try this story direction? This will regenerate the story and replace the current screenplay scenes.')) {
      return;
    }
    await handleGenerateStoryWithJobId(jobId);
  };

  const handleContinueExistingWorkflow = async () => {
    if (!jobId) return;
    setBusy(true);
    setBusyMsg('Loading existing project data...');
    try {
      const nextCompletedSteps = Array.from(new Set([...completedSteps, 1, 2]));
      await videoGenerationAPI.updateDraft(jobId, {
        currentStep: 3,
        completedSteps: nextCompletedSteps
      });
      setCompletedSteps(nextCompletedSteps);
      setCurrentStep(3);
      fetchDrafts();
    } catch (e: any) {
      alert(e?.message || 'Failed to update draft step');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const handleUpdateScene = (sceneId: string, updates: any) => {
    setScenes(prev => prev.map((s) => String(s.sceneId) === String(sceneId) ? normalizeDirectorScene({ ...s, ...updates }, Number(s.sceneNumber || s.index || 1) - 1) : s));
  };

  const handleUpdateProductionBible = (field: string, value: string) => {
    setDraft((current: any) => ({
      ...(current || {}),
      productionBible: {
        ...(current?.productionBible || {}),
        [field]: value
      }
    }));
  };

  const handleUpdateVoiceScript = (value: string) => {
    setDraft((current: any) => ({
      ...(current || {}),
      voiceScript: value
    }));
  };

  const mergeSceneRegenerationResult = (sceneId: string, nextScene: any) => {
    const timestamp = Date.now();
    setScenes(prev => prev.map((currentScene) => {
      if (String(currentScene.sceneId) !== String(sceneId)) return currentScene;

      let rawImgUrl = nextScene?.imageUrl || nextScene?.generatedImageUrl || currentScene.imageUrl || currentScene.generatedImageUrl || '';
      if (rawImgUrl && typeof rawImgUrl === 'string' && !rawImgUrl.startsWith('data:')) {
        const cleanUrl = rawImgUrl.split('?')[0];
        rawImgUrl = `${cleanUrl}?t=${timestamp}`;
      }

      const mergedScene = {
        ...currentScene,
        ...nextScene,
        imagePrompt: currentScene.imagePrompt || nextScene?.imagePrompt || '',
        videoPrompt: currentScene.videoPrompt || nextScene?.videoPrompt || '',
        imageUrl: rawImgUrl,
        generatedImageUrl: rawImgUrl,
        generatedVideoUrl: nextScene?.generatedVideoUrl || currentScene.generatedVideoUrl || ''
      };
      return normalizeDirectorScene(mergedScene, Number(currentScene.sceneNumber || currentScene.index || 1) - 1);
    }));
  };

  const handleGenerateScenePrompts = async (scene: any) => {
    setPromptLoadingSceneId(scene.sceneId);
    try {
      const res = await aiDirectorAPI.buildPromptsForScene({
        jobId,
        sceneId: scene.sceneId,
        scene,
        characters,
        productionBible: draft?.productionBible || {}
      });
      handleUpdateScene(scene.sceneId, {
        imagePrompt: res.imagePrompt,
        videoPrompt: res.videoPrompt
      });
    } catch (e: any) {
      alert(e?.message || 'Prompt generation failed');
    } finally {
      setPromptLoadingSceneId(null);
    }
  };

  const handleGenerateAllPrompts = async () => {
    if (!jobId || !scenes || scenes.length === 0) return;
    setBusy(true);
    setBusyMsg('Generating image & video prompts for all scenes...');
    try {
      for (const s of scenes) {
        const res = await aiDirectorAPI.buildPromptsForScene({
          jobId,
          sceneId: s.sceneId,
          scene: s,
          characters,
          productionBible: draft?.productionBible || {}
        });
        console.log(`[Frontend Draft Sync] Scene ${s.sceneId} | imagePromptLength=${res?.imagePrompt?.length || 0}, videoPromptLength=${res?.videoPrompt?.length || 0}`);
        if (res?.draft) {
          setDraft(res.draft);
        }
        if (res?.imagePrompt || res?.videoPrompt) {
          handleUpdateScene(s.sceneId, {
            imagePrompt: res.imagePrompt || '',
            videoPrompt: res.videoPrompt || ''
          });
        }
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to generate prompts');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const handleImprovePrompt = async () => {
    const selectedScene = scenes.find((scene) => String(scene.sceneId) === String(promptImproveSceneId));
    if (!selectedScene || !jobId || !promptImproveRequest.trim()) return;

    const field = promptImproveType === 'image' ? 'imagePrompt' : 'videoPrompt';
    const existingPrompt = String(selectedScene[field] || '').trim();
    if (!existingPrompt) {
      alert(`Scene ${selectedScene.sceneNumber || ''} does not have a ${promptImproveType} prompt yet.`);
      return;
    }

    setImprovingPrompt(true);
    try {
      const res = await aiDirectorAPI.improvePrompt({
        jobId,
        sceneId: selectedScene.sceneId,
        scene: selectedScene,
        promptType: promptImproveType,
        existingPrompt,
        userRequest: promptImproveRequest
      });

      if (res?.prompt) {
        handleUpdateScene(selectedScene.sceneId, { [field]: res.prompt });
        setPromptImproveRequest('');
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to improve prompt');
    } finally {
      setImprovingPrompt(false);
    }
  };

  const buildEditPrompt = (basePrompt: string, instruction: string) => {
    const cleanBasePrompt = String(basePrompt || '').trim();
    const cleanInstruction = String(instruction || '').trim();
    if (!cleanInstruction) return cleanBasePrompt;
    return [
      cleanBasePrompt,
      'Targeted edit request:',
      cleanInstruction,
      'Preserve everything else from the current scene unless the edit request explicitly changes it.'
    ].filter(Boolean).join('\n\n');
  };

  const applyImageGenerationResult = (resObj: any, sceneId?: string) => {
    const data = resObj?.result || resObj;
    const sceneData = data?.sceneData || resObj?.sceneData || data?.scenes || data?.draft?.scenes;
    const draftData = data?.draft || resObj?.draft;

    if (sceneData) {
      if (sceneId) {
        const updatedScene = sceneData.find((item: any) => String(item.sceneId || item.id) === String(sceneId));
        if (updatedScene) mergeSceneRegenerationResult(sceneId, updatedScene);
        else setScenes(sceneData);
      } else {
        setScenes(sceneData);
      }
    }
    if (draftData) applyDraftState(draftData);

    if (sceneId && (data?.imageUrl || data?.generatedImageUrl)) {
      mergeSceneRegenerationResult(sceneId, {
        imageUrl: data.imageUrl || data.generatedImageUrl,
        generatedImageUrl: data.generatedImageUrl || data.imageUrl
      });
    }
  };

  const pollAndRefreshDraft = async (queueJobId: string, busyLabel: string, onScene?: boolean) => {
    const result = await pollDirectorJob(queueJobId, {
      onProgress: (job) => {
        setBusyMsg(job?.metadata?.publicStep || job?.currentStep || busyLabel);
        if (jobId) {
          videoGenerationAPI.getDraft(jobId).then((res) => {
            if (res?.draft) applyDraftState(res.draft);
          }).catch(() => {});
        }
      }
    });
    if (onScene && result?.videoUrl && result?.sceneId) {
      handleUpdateScene(result.sceneId, {
        clipUrl: result.videoUrl,
        videoUrl: result.videoUrl,
        generatedVideoUrl: result.videoUrl
      });
    }
    return result;
  };

  const handleGenerateSceneImage = async (scene: any, instruction = '') => {
    setImgLoadingSceneId(scene.sceneId);
    const basePrompt = String(scene.imagePrompt || '').trim();
    const finalPrompt = buildEditPrompt(basePrompt, instruction);
    try {
      const res = await videoGenerationAPI.generateImages({
        jobId,
        async: true,
        action: 'regenerate',
        sceneId: scene.sceneId,
        characterId: resolvePrimaryCharacterId(draft, characters),
        prompt: finalPrompt,
        imagePrompt: finalPrompt,
        imageUrl: scene.imageUrl || scene.generatedImageUrl,
        style: videoStyle
      } as any);
      if (res?.queueJobId) {
        const result = await pollAndRefreshDraft(res.queueJobId, 'Generating scene image...');
        applyImageGenerationResult(result, scene.sceneId);
      } else {
        applyImageGenerationResult(res, scene.sceneId);
      }
      handleUpdateScene(scene.sceneId, { imagePrompt: basePrompt });
    } catch (e: any) {
      alert(e?.message || 'Image generation failed');
    } finally {
      setImgLoadingSceneId(null);
      setBusy(false);
      setBusyMsg('');
    }
  };

  const handleGenerateAllImages = async () => {
    if (!jobId || scenes.length === 0) return;
    setGeneratingAllImages(true);
    setBusy(true);
    try {
      setBusyMsg(`AI Artist is generating images for ${scenes.length} scene(s)...`);
      const res = await videoGenerationAPI.generateImages({
        jobId,
        async: true,
        action: 'generateAll',
        sceneData: scenes,
        characterId: resolvePrimaryCharacterId(draft, characters),
        style: videoStyle
      } as any);

      if (res?.queueJobId) {
        const result = await pollAndRefreshDraft(res.queueJobId, 'Generating scene images...');
        applyImageGenerationResult(result);
      } else {
        applyImageGenerationResult(res);
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to generate all images');
    } finally {
      setGeneratingAllImages(false);
      setImgLoadingSceneId(null);
      setBusy(false);
      setBusyMsg('');
    }
  };

  const handleGenerateSceneVideo = async (scene: any, instruction = '') => {
    setVidLoadingSceneId(scene.sceneId);
    const basePrompt = String(scene.videoPrompt || '').trim();
    const finalPrompt = buildEditPrompt(basePrompt, instruction);
    try {
      const res: any = await videoGenerationAPI.createVideo({
        jobId,
        async: true,
        sceneId: scene.sceneId,
        prompt: finalPrompt,
        imageUrl: scene.imageUrl || scene.generatedImageUrl,
        duration: scene.durationSeconds || 5
      } as any);

      let videoUrl = res?.videoUrl;
      if (res?.queueJobId) {
        setBusy(true);
        setBusyMsg(`Animating scene ${scene.sceneNumber || ''}...`);
        const result = await pollAndRefreshDraft(res.queueJobId, 'Generating video clip...', true);
        videoUrl = result?.videoUrl || videoUrl;
        if (result?.draft) applyDraftState(result.draft);
      }

      if (videoUrl) {
        const updatedScene = {
          clipUrl: videoUrl,
          videoUrl,
          generatedVideoUrl: videoUrl,
          videoPrompt: basePrompt
        };
        handleUpdateScene(scene.sceneId, updatedScene);
        if (res?.draft) {
          applyDraftState(res.draft);
        } else {
          setScenes((prevScenes) => {
            const nextScenes = prevScenes.map((s) =>
              String(s.sceneId) === String(scene.sceneId)
                ? normalizeDirectorScene({ ...s, ...updatedScene }, Number(s.sceneNumber || s.index || 1) - 1)
                : s
            );
            const clipUrls = nextScenes.map((s) => directorSceneClipUrl(s)).filter(Boolean);
            saveDraftToBackend({
              scenes: nextScenes.map(compactDirectorScene),
              clips: {
                sceneData: nextScenes.map(compactDirectorScene),
                clipUrls
              }
            });
            return nextScenes;
          });
        }
      }
    } catch (e: any) {
      alert(e?.message || 'Video generation failed');
    } finally {
      setVidLoadingSceneId(null);
      setBusy(false);
      setBusyMsg('');
    }
  };

  const openSceneEditModal = (type: 'image' | 'video', scene: any) => {
    setEditModal({ type, scene, instruction: '' });
  };

  const submitSceneEdit = async () => {
    if (!editModal?.scene || !editModal.instruction.trim()) return;
    const targetScene = scenes.find((scene) => String(scene.sceneId) === String(editModal.scene.sceneId)) || editModal.scene;
    if (editModal.type === 'image') {
      await handleGenerateSceneImage(targetScene, editModal.instruction);
    } else {
      await handleGenerateSceneVideo(targetScene, editModal.instruction);
    }
    setEditModal(null);
  };

  const handleGenerateAllVideos = async () => {
    if (!jobId || scenes.length === 0) return;
    setGeneratingAllVideos(true);
    setBusy(true);
    let latestScenes = [...scenes];
    try {
      for (let i = 0; i < latestScenes.length; i++) {
        const scene = latestScenes[i];
        const sceneImg = scene.imageUrl || scene.generatedImageUrl;
        if (!sceneImg) {
          continue;
        }
        setBusyMsg(`AI Director is animating Video Clip for Scene ${i + 1}/${latestScenes.length}: ${scene.title}...`);
        setVidLoadingSceneId(scene.sceneId);
        
        const res: any = await videoGenerationAPI.createVideo({
          jobId,
          async: true,
          sceneId: scene.sceneId,
          prompt: scene.videoPrompt,
          imageUrl: sceneImg,
          duration: scene.durationSeconds || 5
        } as any);
        
        let videoUrl = res?.videoUrl;
        if (res?.queueJobId) {
          const result = await pollAndRefreshDraft(res.queueJobId, `Animating scene ${i + 1}/${latestScenes.length}...`, true);
          videoUrl = result?.videoUrl || videoUrl;
          if (result?.draft) applyDraftState(result.draft);
        }

        if (videoUrl) {
          const updatedFields = { clipUrl: videoUrl, videoUrl, generatedVideoUrl: videoUrl };
          latestScenes = latestScenes.map((s) =>
            String(s.sceneId) === String(scene.sceneId)
              ? normalizeDirectorScene({ ...s, ...updatedFields }, Number(s.sceneNumber || s.index || 1) - 1)
              : s
          );
          handleUpdateScene(scene.sceneId, updatedFields);
          if (res?.draft) {
            applyDraftState(res.draft);
          }
        }
      }
      if (jobId) {
        const clipUrls = latestScenes.map((s) => directorSceneClipUrl(s)).filter(Boolean);
        await saveDraftToBackend({
          scenes: latestScenes.map(compactDirectorScene),
          clips: {
            sceneData: latestScenes.map(compactDirectorScene),
            clipUrls
          }
        });
        const refreshed = await videoGenerationAPI.getDraft(jobId);
        if (refreshed?.draft) applyDraftState(refreshed.draft);
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to generate all video clips');
    } finally {
      setGeneratingAllVideos(false);
      setVidLoadingSceneId(null);
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Audio generation & mixing
  const activeVoiceScript = String(
    draft?.voiceScript ||
    draft?.scenesMetadata?.voiceScript ||
    draft?.scenes?.voiceScript ||
    scenes.map((scene) => scene?.voiceLine || scene?.action || '').filter(Boolean).join(' ')
  ).trim();

  const buildAudioPayload = () => ({
    enabled: audioEnabled,
    mode: audioEnabled ? audioMode : 'off',
    audioPriority,
    tone: audioTone,
    brandTone: brandTone || audioTone || 'Professional',
    languageCode: audioLanguageCode,
    voiceGender,
    voiceVolume,
    musicVolume,
    voiceScript: activeVoiceScript,
    manualAudioData: audioMode === 'upload' ? customAudioData : ''
  });

  const handleGenerateAudio = async () => {
    if (!jobId) return;
    if (audioMode === 'auto' && !activeVoiceScript) {
      alert('Please generate or enter the AI voice script before creating Text-to-Speech audio.');
      setCurrentStep(3);
      return;
    }
    const audioPayload = buildAudioPayload();
    console.log("=================================");
    console.log("[Generate Audio Request]", {
      languageCode: audioPayload.languageCode,
      voiceGender: audioPayload.voiceGender,
      audioTone: audioPayload.tone,
      audioPriority: audioPayload.audioPriority,
      voiceScriptLength: audioPayload.voiceScript ? audioPayload.voiceScript.length : 0
    });
    console.log("=================================");

    setBusy(true);
    setBusyMsg('Generating voice script & audio tracks...');
    try {
      const res = await videoGenerationAPI.generateAudio({
        jobId,
        async: false,
        audio: audioPayload
      });

      console.log("=================================");
      console.log("[Generate Audio Response]", res);
      console.log("=================================");

      const tracks = res?.audio?.tracks || res?.tracks || res?.draft?.audio?.tracks || null;
      if (tracks) {
        console.log("=================================");
        console.log("[Generate Audio Tracks Verification]");
        console.log("res.audio.tracks.voice:", res?.audio?.tracks?.voice);
        console.log("res.tracks.voice:", res?.tracks?.voice);
        console.log("res.voice:", (res as any)?.voice);
        console.log("Voice Track URL:", tracks?.voice?.url || tracks?.voiceUrl);
        console.log("Background Music URL:", tracks?.background?.url || tracks?.backgroundUrl);
        console.log("=================================");
        setGeneratedTracks(tracks);
      } else {
        console.warn("[Generate Audio Warning] No tracks returned in response!");
      }

      if (res?.audio) {
        // Prevent useEffect([draft]) from resetting user selections
        isAudioDirtyRef.current = true;
        if (res.audio.config?.languageCode) setAudioLanguageCode(res.audio.config.languageCode);
        if (res.audio.config?.voiceGender) setVoiceGender(res.audio.config.voiceGender as 'male' | 'female');

        setDraft((current: any) => ({
          ...(current || {}),
          audio: res.audio,
          audioConfig: {
            ...(current?.audioConfig || {}),
            ...(res.audio.config || {})
          },
          audioLanguageCode: res.audio.config?.languageCode || current?.audioLanguageCode,
          voiceGender: res.audio.config?.voiceGender || current?.voiceGender,
          mix: null
        }));
      } else if (res?.draft?.audio) {
        isAudioDirtyRef.current = true;
        if (res.draft.audio.config?.languageCode) setAudioLanguageCode(res.draft.audio.config.languageCode);
        if (res.draft.audio.config?.voiceGender) setVoiceGender(res.draft.audio.config.voiceGender as 'male' | 'female');
        applyDraftState(res.draft);
      }
      setFinalAudioUrl('');
    } catch (e: any) {
      alert(e?.message || 'Audio generation failed');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

    const handleMixAudio = async () => {
    if (!jobId) return;
    setBusy(true);
    setBusyMsg('Mixing voice & background music with audio ducking...');
    try {
      const res = await videoGenerationAPI.mixAudio({
        jobId,
        tracks: generatedTracks || undefined,
        voiceVolume,
        musicVolume,
        priorityMode: audioPriority,
        audio: {
          ...buildAudioPayload(),
          audioPriority
        }
      });
      let nextAudioUrl = '';
      if (res?.finalAudioUrl) {
        nextAudioUrl = `${res.finalAudioUrl.split('?')[0]}?t=${Date.now()}`;
        console.log("=================================");
        console.log("[Audio Playback Verification]");
        console.log("Previous Audio URL:", finalAudioUrl || "none");
        console.log("New Audio URL:", nextAudioUrl);
        console.log("=================================");
        setFinalAudioUrl(nextAudioUrl);
      }
      if (res?.draft) {
        setDraft((current: any) => ({
          ...(current || {}),
          mix: res.draft.mix || current?.mix,
          finalAudioUrl: res.finalAudioUrl || current?.finalAudioUrl
        }));
      }

      // If we are on Step 10, run video merge automatically so the preview changes instantly!
      if (currentStep === 10) {
        setBusyMsg('Re-applying new audio mix to final video preview...');
        let clipUrls = collectDirectorClipUrls(scenes, res?.draft || draft);
        if (!clipUrls.length) {
          const latest = await videoGenerationAPI.getDraft(jobId);
          if (latest?.draft) {
            applyDraftState(latest.draft);
            clipUrls = collectDirectorClipUrls(latest.draft);
          }
        }
        if (clipUrls.length) {
          const mergeRes = await videoGenerationAPI.mergeVideo({
            jobId,
            async: false,
            clipUrls,
            finalAudioUrl: res?.finalAudioUrl || undefined
          });
          if (mergeRes?.finalOutputUrl) {
            setFinalOutputUrl(`${mergeRes.finalOutputUrl.split('?')[0]}?t=${Date.now()}`);
          }
          if (mergeRes?.finalVideoUrl) {
            setFinalVideoUrl(`${mergeRes.finalVideoUrl.split('?')[0]}?t=${Date.now()}`);
          }
          if (mergeRes?.draft) applyDraftState(mergeRes.draft);
        }
        alert("✅ Audio adjustments remixed and video preview updated successfully!");
      }
    } catch (e: any) {
      alert(e?.message || 'Audio mix failed');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Video merge
  const handleMergeVideo = async () => {
    if (!jobId) return;
    setBusy(true);
    setBusyMsg('Merging video clips with audio tracks...');
    try {
      // Collect clip URLs from current React state first
      let clipUrls = collectDirectorClipUrls(scenes, draft);

      // If no clips in local state, fetch fresh draft from backend
      if (!clipUrls.length) {
        setBusyMsg('Fetching latest clip data from server...');
        const latest = await videoGenerationAPI.getDraft(jobId);
        if (latest?.draft) {
          applyDraftState(latest.draft);
          clipUrls = collectDirectorClipUrls(latest.draft);
        }
      }

      if (!clipUrls.length) {
        alert('No video clips found. Please generate video clips for your scenes first (Step 6), then try merging again.');
        setBusy(false);
        setBusyMsg('');
        return;
      }

      setBusyMsg(`Merging ${clipUrls.length} video clip(s) with audio tracks...`);
      const res = await videoGenerationAPI.mergeVideo({
        jobId,
        async: true,
        clipUrls,
        finalAudioUrl: finalAudioUrl || undefined
      });
      if (res?.queueJobId) {
        const result = await pollAndRefreshDraft(res.queueJobId, 'Merging video...');
        if (result?.draft) applyDraftState(result.draft);
        if (result?.merge?.finalOutputUrl) setFinalOutputUrl(`${result.merge.finalOutputUrl.split('?')[0]}?t=${Date.now()}`);
        if (result?.merge?.finalVideoUrl) setFinalVideoUrl(`${result.merge.finalVideoUrl.split('?')[0]}?t=${Date.now()}`);
      } else {
        if (res?.finalOutputUrl) setFinalOutputUrl(`${res.finalOutputUrl.split('?')[0]}?t=${Date.now()}`);
        if (res?.finalVideoUrl) setFinalVideoUrl(`${res.finalVideoUrl.split('?')[0]}?t=${Date.now()}`);
        if (res?.draft) applyDraftState(res.draft);
      }
    } catch (e: any) {
      alert(e?.message || 'Video merge failed');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Thumbnail, caption & hashtag generation
  const handleGenerateContent = async () => {
    if (!jobId) return;
    setBusy(true);
    setBusyMsg('Generating thumbnail, caption, and hashtags...');
    try {
      const res = await videoGenerationAPI.generateContent({ jobId, async: true });
      let contentResult = res;
      if (res?.queueJobId) {
        contentResult = await pollAndRefreshDraft(res.queueJobId, 'Generating thumbnail & caption...');
      }
      const newThumb = contentResult?.thumbnailUrl || contentResult?.content?.thumbnailUrl || contentResult?.draft?.thumbnailUrl || '';
      if (newThumb) setThumbnailUrl(newThumb);
      const newCaption = contentResult?.caption ?? contentResult?.content?.caption ?? '';
      if (newCaption) setCaption(newCaption);
      const rawTags = contentResult?.hashtags ?? contentResult?.content?.hashtags ?? '';
      const newTags = Array.isArray(rawTags) ? rawTags.join(' ') : String(rawTags || '');
      if (newTags) setHashtagsText(newTags);
      if (contentResult?.draft) applyDraftState(contentResult.draft);
    } catch (e: any) {
      alert(e?.message || 'Content generation failed');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Publish / Schedule
  const handleSchedulePost = async (publishNow = false) => {
    if (!jobId) return;
    if (!selectedPlatforms.length) {
      alert('Select at least one platform');
      return;
    }
    // Combine the date + time inputs into a single ISO timestamp the backend expects.
    const scheduledAt = (!publishNow && scheduleDate && scheduleTime)
      ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
      : undefined;
    setBusy(true);
    setBusyMsg(publishNow ? 'Publishing video...' : 'Scheduling post...');
    try {
      await videoGenerationAPI.schedulePost({
        jobId,
        selectedPlatforms,
        scheduledAt,
        publishNow
      });
      alert(publishNow ? 'Video published successfully!' : 'Video scheduled successfully!');
      fetchDrafts();
      setStatusFilter(publishNow ? 'posted' : 'scheduled');
      setShowWizard(false);
    } catch (e: any) {
      alert(e?.message || 'Scheduling failed');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev => prev.includes(p) ? prev.filter(item => item !== p) : [...prev, p]);
  };

  return (
    <div className={`min-h-screen ${theme.bg} ${theme.text} transition-colors duration-300`}>
      {busy && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-5">
          <Clapperboard className="w-16 h-16 text-[#ffcc29] animate-pulse" />
          <div className="text-center">
            <h3 className="text-xl font-bold text-white">AI Director at Work</h3>
            <p className="text-slate-400 text-sm mt-1">{busyMsg}</p>
          </div>
          <Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" />
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#ffcc29]/10 border border-[#ffcc29]/30 flex items-center justify-center shadow-lg">
              <Clapperboard className="w-6 h-6 text-[#ffcc29]" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-[#ffcc29] via-amber-400 to-orange-500 bg-clip-text text-transparent">
                AI Director Studio
              </h1>
              <p className={`text-sm ${theme.textMuted}`}>Story first, characters aligned, full production &amp; scheduling suite.</p>
            </div>
          </div>
          {!showWizard && (
            <button
              onClick={resetWizard}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-[#ffcc29] to-amber-500 text-black font-bold text-sm hover:opacity-90 transition-all flex items-center gap-2 shadow-lg"
            >
              <Plus className="w-4 h-4" /> Create New AI Commercial
            </button>
          )}
        </div>

        {/* Top Filter Tabs (All, Drafts, Created, Scheduled, Posted) */}
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
                      localStorage.removeItem(LS_KEY);
                      sessionStorage.removeItem('director_studio_wizard_active');
                      setShowWizard(false);
                      setStatusFilter(tab.id as VideoStatusFilter);
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

        {/* ── DRAFT & VIDEO HISTORY GRID (when not in wizard) */}
        {!showWizard && (
          <div className="space-y-4">
            {filteredVideoDrafts.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredVideoDrafts.map((item) => (
                  <div
                    key={item.jobId}
                    onClick={() => openVideoDraft(item.jobId)}
                    className={`rounded-2xl border overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 hover:border-[#ffcc29]/50' : 'bg-white border-slate-200 hover:border-[#ffcc29]/60'
                      }`}
                  >
                    <div className="relative">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt={item.title} className="w-full h-44 object-cover" />
                      ) : (
                        <div className={`w-full h-44 flex items-center justify-center ${isDarkMode ? 'bg-slate-900' : 'bg-slate-100'}`}>
                          <Film className="w-8 h-8 text-slate-500" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteVideoDraft(item.jobId, item.title);
                        }}
                        disabled={deletingDraftId === item.jobId}
                        className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-red-600 transition"
                      >
                        {deletingDraftId === item.jobId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-sm text-white line-clamp-2">{item.title || 'Untitled Draft'}</h3>
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusPillClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </div>
                      <div className="flex gap-2 text-xs text-slate-400">
                        {item.durationSeconds && <span>{item.durationSeconds}s</span>}
                        {item.sceneCount && <span>• {item.sceneCount} scenes</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`${panelClass} p-12 text-center`}>
                <Film className="w-10 h-10 mx-auto text-[#ffcc29] mb-3 opacity-60" />
                <h3 className="font-bold text-lg">No AI Videos in this tab</h3>
                <p className="text-slate-500 text-sm mt-1">Click "Create" or "Create New AI Commercial" to start building.</p>
              </div>
            )}
          </div>
        )}

        {/* ── WIZARD MODE */}
        {showWizard && (
          <div className="space-y-6">
            {/* Stepper Bar */}
            <div className={`${panelClass} p-4 overflow-x-auto`}>
              <div className="flex items-center gap-2 min-w-max">
                {WIZARD_STEPS.map((s) => {
                  const Icon = s.icon;
                  const isDone = currentStep > s.id;
                  const isActive = currentStep === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => (isDone || isActive) && setCurrentStep(s.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition ${isActive
                        ? 'bg-[#ffcc29] text-black border-[#ffcc29]'
                        : isDone
                          ? 'bg-slate-800 text-emerald-400 border-slate-700'
                          : 'bg-slate-900/50 text-slate-500 border-slate-800'
                        }`}
                    >
                      {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                      <span>{s.id}. {s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Back button */}
            {currentStep > 1 && (
              <button
                onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
                className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold hover:border-slate-500 transition flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back to Step {currentStep - 1}
              </button>
            )}

            {/* ── STEP 1: Business Details & Brief */}
            {currentStep === 1 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center gap-2 pb-3 border-b border-slate-700/50">
                  <Film className="w-5 h-5 text-[#ffcc29]" />
                  <h2 className="text-lg font-bold">Step 1: Business &amp; Commercial Brief</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Business Name</label>
                    <input className={inputClass} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Murugan Silks" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Industry</label>
                    <input className={inputClass} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Bridal Fashion, Silk Sarees" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Target Audience</label>
                    <input className={inputClass} value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} placeholder="e.g. Brides aged 22-35, South Indian families" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Brand Tone</label>
                    <input className={inputClass} value={brandTone} onChange={(e) => setBrandTone(e.target.value)} placeholder="e.g. Warm, Regal, Festive" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Brand Summary / Concept</label>
                  <textarea className={`${inputClass} min-h-[90px] resize-none`} value={brandSummary} onChange={(e) => setBrandSummary(e.target.value)} placeholder="Describe your brand essence or campaign idea..." />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Commercial Objective</label>
                    <input className={inputClass} value={commercialObjective} onChange={(e) => setCommercialObjective(e.target.value)} placeholder="e.g. Diwali &amp; Wedding Season Sale" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Video Style</label>
                    <select className={inputClass} value={videoStyle} onChange={(e) => setVideoStyle(e.target.value)}>
                      {VIDEO_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Target Duration</label>
                    <select className={inputClass} value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))}>
                      {DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d} seconds</option>)}
                    </select>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-700/50 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Link Product (Optional)</label>
                    <select className={inputClass} value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
                      <option value="">-- Select Inventory Product --</option>
                      {products.map((p) => <option key={p._id} value={p._id}>{p.name} (₹{p.price})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Reference Image (Optional)</label>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className={inputClass} />
                  </div>
                </div>

                {/* Modern Animated Character Switch */}
                <div className="pt-4 border-t border-slate-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setUseCharacters(prev => !prev)}
                      className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${useCharacters ? 'bg-[#ffcc29]' : 'bg-slate-700'
                        }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-slate-950 shadow-lg ring-0 transition duration-200 ease-in-out ${useCharacters ? 'translate-x-7' : 'translate-x-0'
                          }`}
                      />
                    </button>
                    <div>
                      <span className="text-sm font-bold text-white block">AI Character Cast Manager</span>
                      <span className="text-xs text-slate-400">
                        {useCharacters ? 'ON: Cast family members (Father, Mother, Bride, etc.) in Step 2' : 'OFF: Bypasses character manager and generates commercial story directly'}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs font-extrabold px-3 py-1 rounded-full border ${useCharacters ? 'bg-[#ffcc29]/20 text-[#ffcc29] border-[#ffcc29]/40' : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                    {useCharacters ? 'CHARACTERS ACTIVE' : 'CHARACTERS OFF'}
                  </span>
                </div>

                {/* Modern Animated Logo Switch */}
                <div className="pt-4 border-t border-slate-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setUseLogo(prev => !prev)}
                      className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${useLogo ? 'bg-[#ffcc29]' : 'bg-slate-700'
                        }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-slate-950 shadow-lg ring-0 transition duration-200 ease-in-out ${useLogo ? 'translate-x-7' : 'translate-x-0'
                          }`}
                      />
                    </button>
                    <div>
                      <span className="text-sm font-bold text-white block">Overlay Brand Logo on Video</span>
                      <span className="text-xs text-slate-400">
                        {useLogo ? 'ON: Automatically overlays your business name/logo on the generated scenes' : 'OFF: Keeps the scenes clean without any text/logo overlays'}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs font-extrabold px-3 py-1 rounded-full border ${useLogo ? 'bg-[#ffcc29]/20 text-[#ffcc29] border-[#ffcc29]/40' : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                    {useLogo ? 'LOGO ACTIVE' : 'LOGO OFF'}
                  </span>
                </div>

                <button onClick={handleStep1Submit} disabled={!businessName} className="w-full py-4 rounded-xl font-bold bg-gradient-to-r from-[#ffcc29] to-amber-500 text-black hover:opacity-90 transition-all flex items-center justify-center gap-2 text-base shadow-lg disabled:opacity-40">
                  {getBestContinueStep() > 2 ? `Save Brief & Continue to Step ${getBestContinueStep()} →` : (useCharacters ? 'Proceed to Character Manager →' : 'Generate Commercial Story & Screenplay →')}
                </button>
              </div>
            )}

            {/* ── STEP 2: Character Manager */}
            {currentStep === 2 && draft && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                  <div>
                    <h2 className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5 text-[#ffcc29]" /> Step 2: Character Manager</h2>
                    <p className="text-xs text-slate-400 mt-1">Setup character reference photos and details or proceed to story breakdown.</p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleContinueExistingWorkflow}
                    className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] transition flex items-center gap-2 shadow-md"
                  >
                    Continue Existing Workflow
                  </button>
                </div>

                <CharacterManager
                  jobId={jobId}
                  draft={draft}
                  setDraft={(d: any) => {
                    setDraft(d);
                    if (d?.characters) setCharacters(d.characters);
                    if (d?.scenes && d.scenes.length > 0) setScenes(d.scenes);
                  }}
                  setStep={setCurrentStep}
                  busy={busy}
                  setBusy={setBusy}
                  onApproveAll={handleGenerateStory}
                />
              </div>
            )}

            {/* ── STEP 3: AI Director Story */}
            {currentStep === 3 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                  <div>
                    <h2 className="text-lg font-bold flex items-center gap-2"><BookOpen className="w-5 h-5 text-[#ffcc29]" /> Step 3: AI Director Story &amp; Screenplay</h2>
                    <p className="text-xs text-slate-400 mt-1">Review the AI-generated commercial story, scenes, and voiceover script.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        if (scenes.length > 0 && !window.confirm('Regenerate the story? This will replace the current screenplay scenes.')) {
                          return;
                        }
                        handleGenerateStory();
                      }}
                      disabled={busy}
                      className="px-4 py-2 rounded-xl border border-[#ffcc29]/40 text-[#ffcc29] font-semibold text-xs hover:bg-[#ffcc29]/10 transition flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> {scenes.length > 0 ? 'Regenerate Story' : 'Generate Story'}
                    </button>
                    <button onClick={() => setCurrentStep(4)} className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] transition flex items-center gap-2">
                      Proceed to Prompts &rarr;
                    </button>
                  </div>
                </div>

                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2"><Edit3 className="w-4 h-4 text-[#ffcc29]" /> Director Notes</h3>
                      <p className="text-xs text-slate-400 mt-1">Add your idea, change request, or missing detail, then try a fresh story version.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleTryStoryDirection}
                      disabled={busy || !storyDirection.trim() || !jobId}
                      className="px-4 py-2 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] transition disabled:opacity-40 flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Try Direction
                    </button>
                  </div>
                  <textarea
                    className={`${inputClass} text-xs min-h-[90px] resize-none`}
                    value={storyDirection}
                    onChange={(e) => setStoryDirection(e.target.value)}
                    placeholder="Example: make Priya's grandmother give the blessing, add one scene inside the Murugan Silks showroom, and make the voiceover more emotional in Tamil-English style."
                  />
                </div>

                {draft?.productionBible && (
                  <div className="bg-[#ffcc29]/5 border border-[#ffcc29]/20 rounded-xl p-5 space-y-3">
                    <h3 className="text-sm font-bold text-[#ffcc29] flex items-center gap-2"><Sparkles className="w-4 h-4" /> Production Bible</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="font-semibold text-slate-400 uppercase">Emotional Hook</span>
                        <textarea className={`${inputClass} text-xs mt-1 min-h-[80px] resize-none`} value={draft.productionBible.emotionalHook || ''} onChange={(e) => handleUpdateProductionBible('emotionalHook', e.target.value)} />
                      </div>
                      <div>
                        <span className="font-semibold text-slate-400 uppercase">Creative Direction</span>
                        <textarea className={`${inputClass} text-xs mt-1 min-h-[80px] resize-none`} value={draft.productionBible.creativeDirection || ''} onChange={(e) => handleUpdateProductionBible('creativeDirection', e.target.value)} />
                      </div>
                      <div className="md:col-span-2">
                        <span className="font-semibold text-slate-400 uppercase">Narrative Story Arc</span>
                        <textarea className={`${inputClass} text-xs mt-1 min-h-[90px] resize-none`} value={draft.productionBible.story || ''} onChange={(e) => handleUpdateProductionBible('story', e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}

                {draft?.voiceScript && (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2 mb-1.5"><Mic2 className="w-3.5 h-3.5 text-[#ffcc29]" /> Voiceover Script</h4>
                    <textarea className={`${inputClass} text-xs min-h-[110px] resize-none italic leading-relaxed`} value={draft.voiceScript || ''} onChange={(e) => handleUpdateVoiceScript(e.target.value)} />
                  </div>
                )}

                <div className="space-y-4">
                  <h3 className="text-sm font-bold">Screenplay Scenes ({scenes.length})</h3>
                  {scenes.map((scene) => (
                    <div key={scene.sceneId} className="border border-slate-800 bg-slate-900/40 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-full bg-[#ffcc29]/10 text-[#ffcc29] font-bold text-xs flex items-center justify-center">{scene.sceneNumber}</span>
                          <div>
                            <h4 className="font-bold text-sm text-white">{scene.title}</h4>
                            {scene.businessObjective && (
                              <span className="text-[10px] text-[#ffcc29] font-medium bg-[#ffcc29]/10 px-2 py-0.5 rounded-md mt-0.5 inline-block">
                                {scene.businessObjective}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-slate-500 font-mono">{scene.durationSeconds || 6}s</span>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Action / Story</label>
                        <textarea className={`${inputClass} text-xs mt-1 min-h-[80px] resize-none`} value={scene.action || scene.description || ''} onChange={(e) => handleUpdateScene(scene.sceneId, { action: e.target.value })} />
                      </div>
                      {(scene.voiceLine || scene.audio) && (
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Voiceover Line</label>
                          <p className="text-xs text-slate-300 italic bg-slate-950/50 p-2 rounded-lg border border-slate-800/50 mt-1">"{scene.voiceLine || scene.audio}"</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 4: Prompts & Scenes */}
            {currentStep === 4 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Wand2 className="w-5 h-5 text-[#ffcc29]" /> Step 4: Prompts &amp; Scenes</h2>
                  <div className="flex items-center gap-3">
                    <button onClick={handleGenerateAllPrompts} className="px-4 py-2 rounded-xl border border-[#ffcc29]/40 text-[#ffcc29] text-xs font-semibold hover:bg-[#ffcc29]/10 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Generate All Prompts
                    </button>
                    <button onClick={() => setCurrentStep(5)} className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] flex items-center gap-2">
                      Proceed to Scene Images &rarr;
                    </button>
                  </div>
                </div>

                <div className="border border-slate-800 bg-slate-900/50 rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#ffcc29]" />
                    <h3 className="text-sm font-bold text-white">Prompt Improvement</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-bold text-slate-400 uppercase">Scene</label>
                      <select
                        className={`${inputClass} mt-1.5`}
                        value={promptImproveSceneId}
                        onChange={(e) => {
                          const targetId = e.target.value;
                          setPromptImproveSceneId(targetId);
                          const sel = scenes.find((s) => String(s.sceneId) === String(targetId));
                          if (sel) {
                            console.log(`[Selected Scene] ${sel.sceneId} (${sel.title}): imagePromptLength=${sel.imagePrompt?.length || 0}, videoPromptLength=${sel.videoPrompt?.length || 0}`);
                          }
                        }}
                        disabled={!scenes.length || improvingPrompt}
                      >
                        {scenes.length ? scenes.map((scene, idx) => (
                          <option key={scene.sceneId || idx} value={scene.sceneId}>
                            Scene {scene.sceneNumber || idx + 1}{scene.title ? ` - ${scene.title}` : ''}
                          </option>
                        )) : <option value="">No scenes available</option>}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-slate-400 uppercase">Prompt Type</label>
                      <div className="mt-2 flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm text-slate-200">
                          <input
                            type="radio"
                            name="directorPromptImproveType"
                            checked={promptImproveType === 'image'}
                            onChange={() => setPromptImproveType('image')}
                            disabled={improvingPrompt}
                          />
                          Image Prompt
                        </label>
                        <label className="flex items-center gap-2 text-sm text-slate-200">
                          <input
                            type="radio"
                            name="directorPromptImproveType"
                            checked={promptImproveType === 'video'}
                            onChange={() => setPromptImproveType('video')}
                            disabled={improvingPrompt}
                          />
                          Video Prompt
                        </label>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase">Describe what you want to improve</label>
                    <textarea
                      className={`${inputClass} mt-1.5 min-h-[110px] resize-y`}
                      value={promptImproveRequest}
                      onChange={(e) => setPromptImproveRequest(e.target.value)}
                      placeholder="Make the saree royal blue. Add warm sunset lighting. Keep everything else the same."
                      disabled={improvingPrompt}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleImprovePrompt}
                    disabled={improvingPrompt || !scenes.length || !promptImproveRequest.trim()}
                    className="px-4 py-2.5 rounded-xl bg-[#ffcc29] text-black text-xs font-bold hover:bg-[#e6b825] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {improvingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {improvingPrompt ? 'Improving Prompt' : 'Improve Prompt'}
                  </button>
                </div>

                <div className="space-y-6">
                  {(!scenes || scenes.length === 0) ? (
                    <div className="border border-dashed border-slate-800 rounded-xl p-6 text-center text-sm text-slate-400">
                      No scenes yet. Generate the AI Director story first, then return to this prompt page.
                    </div>
                  ) : (
                    scenes.map((scene) => {
                      console.log(
                        `[Prompt Render] Scene ${scene.sceneId} (${scene.title}): imagePromptLength=${scene.imagePrompt?.length || 0}, videoPromptLength=${scene.videoPrompt?.length || 0}`
                      );
                      return (
                      <div key={scene.sceneId} className="border border-slate-800 bg-slate-900/50 rounded-xl p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm text-white">Scene {scene.sceneNumber}: {scene.title}</h4>
                          <button onClick={() => handleGenerateScenePrompts(scene)} disabled={promptLoadingSceneId === scene.sceneId} className="px-3 py-1.5 rounded-lg bg-[#ffcc29] text-black text-xs font-bold hover:bg-[#e6b825] disabled:opacity-40 flex items-center gap-1.5">
                            {promptLoadingSceneId === scene.sceneId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            {scene.imagePrompt ? 'Regenerate Prompts' : 'Generate Prompts'}
                          </button>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-slate-400 uppercase">Image Prompt (Gemini AI)</label>
                          <textarea className={`${inputClass} text-xs mt-1 min-h-[70px] resize-none font-mono`} value={scene.imagePrompt || ''} onChange={(e) => handleUpdateScene(scene.sceneId, { imagePrompt: e.target.value })} placeholder="Click 'Generate Prompts' or type custom prompt..." />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-slate-400 uppercase">Motion / Video Prompt</label>
                          <textarea className={`${inputClass} text-xs mt-1 min-h-[60px] resize-none font-mono`} value={scene.videoPrompt || ''} onChange={(e) => handleUpdateScene(scene.sceneId, { videoPrompt: e.target.value })} placeholder="Click 'Generate Prompts' or type camera motion..." />
                        </div>
                      </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* ── STEP 5: Scene Images */}
            {currentStep === 5 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                  <h2 className="text-lg font-bold flex items-center gap-2"><ImageIcon className="w-5 h-5 text-[#ffcc29]" /> Step 5: Scene Images</h2>
                  <div className="flex items-center gap-3">
                    <button onClick={handleGenerateAllImages} disabled={generatingAllImages || scenes.length === 0} className="px-4 py-2 rounded-xl border border-[#ffcc29]/40 text-[#ffcc29] text-xs font-semibold hover:bg-[#ffcc29]/10 disabled:opacity-40 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Generate All Images
                    </button>
                    <button onClick={() => setCurrentStep(6)} className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] flex items-center gap-2">
                      Proceed to Video Clips &rarr;
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {scenes.map((scene) => (
                    <div key={scene.sceneId} className="border border-slate-800 bg-slate-900/40 rounded-xl p-4 space-y-3">
                      <h4 className="font-bold text-sm text-white">Scene {scene.sceneNumber}: {scene.title}</h4>
                      {(scene.imageUrl || scene.generatedImageUrl) ? (
                        <img src={scene.imageUrl || scene.generatedImageUrl} alt="Scene" className="w-full max-w-[240px] aspect-[9/16] object-cover rounded-lg border border-slate-700 cursor-pointer mx-auto" onClick={() => setPreviewImageUrl(scene.imageUrl || scene.generatedImageUrl)} />
                      ) : (
                        <div className="max-w-[240px] aspect-[9/16] rounded-lg border border-dashed border-slate-700 flex items-center justify-center mx-auto w-full">
                          <ImageIcon className="w-8 h-8 text-slate-600" />
                        </div>
                      )}
                      {(scene.imageUrl || scene.generatedImageUrl) ? (
                        <button onClick={() => openSceneEditModal('image', scene)} disabled={imgLoadingSceneId !== null || generatingAllImages} className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
                          {imgLoadingSceneId === scene.sceneId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                          Edit Image
                        </button>
                      ) : (
                        <button onClick={() => handleGenerateSceneImage(scene)} disabled={imgLoadingSceneId !== null || generatingAllImages || !scene.imagePrompt} className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
                        {imgLoadingSceneId === scene.sceneId ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                          Generate Image
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 6: Video Clips */}
            {currentStep === 6 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Video className="w-5 h-5 text-[#ffcc29]" /> Step 6: Video Clips</h2>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={async () => {
                        if (!jobId) return;
                        setBusy(true); setBusyMsg('Refreshing video clips from server...');
                        try {
                          const latest = await videoGenerationAPI.getDraft(jobId);
                          if (latest?.draft) applyDraftState(latest.draft);
                        } catch (_) {}
                        finally { setBusy(false); setBusyMsg(''); }
                      }}
                      disabled={busy || !jobId}
                      className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 text-xs font-semibold hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Refresh Videos
                    </button>
                    <button onClick={handleGenerateAllVideos} disabled={generatingAllVideos || scenes.length === 0} className="px-4 py-2 rounded-xl border border-[#ffcc29]/40 text-[#ffcc29] text-xs font-semibold hover:bg-[#ffcc29]/10 disabled:opacity-40 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Generate All Video Clips
                    </button>
                    <button onClick={() => setCurrentStep(7)} className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] flex items-center gap-2">
                      Proceed to Audio Mix &rarr;
                    </button>
                  </div>
                </div>

                <div className="space-y-5">
                  {scenes.map((scene) => (
                    <div key={scene.sceneId} className="border border-slate-800 bg-slate-900/40 rounded-xl p-4 space-y-3">
                      <h4 className="font-bold text-sm text-white">Scene {scene.sceneNumber}: {scene.title}</h4>
                       {scene.generatedVideoUrl ? (
                        <video src={scene.generatedVideoUrl} controls className="w-full max-w-[240px] rounded-lg aspect-[9/16] border border-slate-700 mx-auto" />
                      ) : (
                        <div className="max-w-[240px] aspect-[9/16] rounded-lg border border-dashed border-slate-700 flex items-center justify-center mx-auto w-full">
                          <Video className="w-8 h-8 text-slate-600" />
                        </div>
                      )}
                      {(scene.generatedVideoUrl) ? (
                        <button onClick={() => openSceneEditModal('video', scene)} disabled={vidLoadingSceneId !== null || generatingAllVideos || !scene.videoPrompt} className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
                          {vidLoadingSceneId === scene.sceneId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                          Edit Video Clip
                        </button>
                      ) : (
                        <button onClick={() => handleGenerateSceneVideo(scene)} disabled={vidLoadingSceneId !== null || generatingAllVideos || !scene.videoPrompt} className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold disabled:opacity-40 flex items-center justify-center gap-2">
                        {vidLoadingSceneId === scene.sceneId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                          Generate Video Clip
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 7: Audio Config & Mix */}
            {currentStep === 7 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Mic2 className="w-5 h-5 text-[#ffcc29]" /> Step 7: Audio Configuration &amp; Mixing</h2>
                  {finalAudioUrl && (
                    <button onClick={() => setCurrentStep(8)} className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] flex items-center gap-2">
                      Proceed to Video Merge &rarr;
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-4">
                    <label className="block text-xs font-semibold text-slate-400 uppercase">Voice Mode</label>
                    <select className={inputClass} value={audioMode} onChange={(e) => { isAudioDirtyRef.current = true; setAudioMode(e.target.value as AudioMode); }}>
                      <option value="auto">AI Text-to-Speech</option>
                      <option value="upload">Custom Voice Upload</option>
                      <option value="off">Music Only</option>
                    </select>

                    {audioMode === 'upload' && (
                      <div className="p-4 rounded-xl border border-slate-700 bg-slate-900/50 space-y-2">
                        <label className="block text-xs font-semibold text-slate-400 uppercase">Upload Custom Voice Track</label>
                        <div className="relative group flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-[#ffcc29] rounded-xl p-4 transition bg-slate-950/40">
                          <input
                            type="file"
                            accept="audio/*,.mp3,.wav,.m4a"
                            onChange={handleCustomAudioChange}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                          />
                          <Mic2 className="w-8 h-8 text-slate-500 group-hover:text-[#ffcc29] mb-2 transition" />
                          <span className="text-xs text-slate-300 font-medium">Click or Drag &amp; Drop audio file</span>
                          <span className="text-[10px] text-slate-500 mt-1">Supports MP3, WAV, M4A up to 15MB</span>
                        </div>
                        {customAudioName && (
                          <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800 text-xs">
                            <span className="text-emerald-400 truncate max-w-[200px] flex items-center gap-1.5 font-mono">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              {customAudioName}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomAudioData('');
                                setCustomAudioName('');
                                isAudioDirtyRef.current = true;
                              }}
                              className="text-red-400 hover:text-red-300 font-bold px-1"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {audioMode === 'auto' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">Language</label>
                          <select className={inputClass} value={audioLanguageCode} onChange={(e) => {
                            const val = e.target.value;
                            isAudioDirtyRef.current = true;
                            console.log("[Audio State Update]", {
                              source: "user_change_language",
                              audioPriority,
                              languageCode: val,
                              voiceGender,
                              mode: audioMode
                            });
                            setAudioLanguageCode(val);
                          }}>
                            <option value="en">English</option>
                            <option value="hi">Hindi</option>
                            <option value="ta">Tamil</option>
                            <option value="te">Telugu</option>
                            <option value="kn">Kannada</option>
                            <option value="ml">Malayalam</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">Voice Gender</label>
                          <select className={inputClass} value={voiceGender} onChange={(e) => {
                            const val = e.target.value as 'male' | 'female';
                            isAudioDirtyRef.current = true;
                            console.log("[Audio State Update]", {
                              source: "user_change_voiceGender",
                              audioPriority,
                              languageCode: audioLanguageCode,
                              voiceGender: val,
                              mode: audioMode
                            });
                            setVoiceGender(val);
                          }}>
                            <option value="female">Female</option>
                            <option value="male">Male</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase mb-1.5">Music Mood</label>
                      <select className={inputClass} value={audioTone} onChange={(e) => { isAudioDirtyRef.current = true; setAudioTone(e.target.value); }}>
                        <option value="professional">Professional / Corporate</option>
                        <option value="normal">Normal / Neutral</option>
                        <option value="fun">Fun / Upbeat</option>
                        <option value="luxury">Luxury / Premium</option>
                        <option value="simple">Simple / Minimalist</option>
                      </select>
                    </div>

                    {audioMode === 'auto' && activeVoiceScript && (
                      <div className="p-3 rounded-xl border border-slate-700 bg-slate-900/60">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">AI Voice Script</p>
                        <p className="text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">{activeVoiceScript}</p>
                      </div>
                    )}

                    <button onClick={handleGenerateAudio} disabled={busy || (audioMode === 'auto' && !activeVoiceScript) || (audioMode === 'upload' && !customAudioData)} className="w-full py-3 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-bold text-xs hover:bg-[#ffcc29]/10 disabled:opacity-40">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                      {audioMode === 'upload' ? '1. Process Custom Voice Track' : '1. Generate Audio Tracks'}
                    </button>
                  </div>

                  <div className="space-y-4">
                    <label className="block text-xs font-semibold text-slate-400 uppercase">Audio Priority</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['voice', 'balanced', 'music'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            isAudioDirtyRef.current = true;
                            console.log("[Audio State Update]", {
                              source: "user_click_audioPriority",
                              audioPriority: mode,
                              languageCode: audioLanguageCode,
                              voiceGender,
                              mode: audioMode
                            });
                            setAudioPriority(mode);
                            if (mode === 'voice') { setVoiceVolume(1); setMusicVolume(0.25); }
                            if (mode === 'balanced') { setVoiceVolume(0.9); setMusicVolume(0.45); }
                            if (mode === 'music') { setVoiceVolume(0.75); setMusicVolume(0.7); }
                          }}
                          className={`px-3 py-3 rounded-xl border text-[11px] font-bold uppercase transition ${
                            audioPriority === mode
                              ? 'border-[#ffcc29] bg-[#ffcc29]/10 text-[#ffcc29]'
                              : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600'
                          }`}
                        >
                          {mode === 'voice' ? 'Voice' : mode === 'balanced' ? 'Balanced' : 'Music'}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-3 p-3 rounded-xl border border-slate-700 bg-slate-900/50">
                      <div>
                        <div className="flex justify-between text-xs font-semibold text-slate-400 mb-2">
                          <span>Voice Volume</span>
                          <span>{Math.round(voiceVolume * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={2} step={0.1} value={voiceVolume} onChange={(e) => setVoiceVolume(Number(e.target.value))} className="w-full accent-[#ffcc29]" />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs font-semibold text-slate-400 mb-2">
                          <span>Music Volume</span>
                          <span>{Math.round(musicVolume * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={2} step={0.1} value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} className="w-full accent-[#ffcc29]" />
                      </div>
                    </div>

                    {(() => {
                      const voiceTrackUrl = generatedTracks?.voice?.url || generatedTracks?.voiceUrl || (typeof generatedTracks?.voice === 'string' ? generatedTracks.voice : '');
                      const bgTrackUrl = generatedTracks?.background?.url || generatedTracks?.backgroundUrl || (typeof generatedTracks?.background === 'string' ? generatedTracks.background : '');
                      const manualTrackUrl = generatedTracks?.manual?.url || generatedTracks?.manualUrl || (typeof generatedTracks?.manual === 'string' ? generatedTracks.manual : '');

                      return (voiceTrackUrl || bgTrackUrl || manualTrackUrl) ? (
                        <div className="grid grid-cols-1 gap-3">
                          {manualTrackUrl && (
                            <div className="p-3 bg-slate-900/60 border border-slate-700 rounded-xl space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><Mic2 className="w-3.5 h-3.5" /> Raw Custom Voice Track</span>
                                <span className="text-[10px] text-amber-400/90 font-mono bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                                  Source: Uploaded Audio
                                </span>
                              </div>
                              <audio key={`${manualTrackUrl}-${Math.random()}`} src={`${manualTrackUrl.split('?')[0]}?cb=${Math.random().toString(36).substring(2, 9)}`} controls className="w-full h-8" />
                            </div>
                          )}
                          {voiceTrackUrl && (
                            <div className="p-3 bg-slate-900/60 border border-slate-700 rounded-xl space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><Mic2 className="w-3.5 h-3.5" /> Raw AI Voice Track</span>
                                <span className="text-[10px] text-amber-400/90 font-mono bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                                  Provider: {generatedTracks?.voice?.voiceProvider === 'google-cloud' ? 'Google Cloud Neural2' : generatedTracks?.voice?.voiceProvider || 'Google Cloud Neural2'} ({generatedTracks?.voice?.voiceId || 'en-US-Neural2-J'})
                                </span>
                              </div>
                              <audio key={`${voiceTrackUrl}-${Math.random()}`} src={`${voiceTrackUrl.split('?')[0]}?cb=${Math.random().toString(36).substring(2, 9)}`} controls className="w-full h-8" />
                            </div>
                          )}
                          {bgTrackUrl && (
                            <div className="p-3 bg-slate-900/60 border border-slate-700 rounded-xl space-y-2">
                              <span className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><Music2 className="w-3.5 h-3.5" /> Background Music Track</span>
                              <audio src={`${bgTrackUrl.split('?')[0]}?t=${Date.now()}`} controls className="w-full h-8" />
                            </div>
                          )}
                        </div>
                      ) : null;
                    })()}

                    <button onClick={handleMixAudio} disabled={busy || !generatedTracks} className="w-full py-3 rounded-xl bg-gradient-to-r from-[#ffcc29] to-amber-500 text-black font-bold text-xs hover:opacity-90 disabled:opacity-40 shadow-lg">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                      Mix Audio Tracks &amp; Save Volumes
                    </button>

                    {finalAudioUrl && (
                      <div className="p-3 bg-[#ffcc29]/10 border border-[#ffcc29]/30 rounded-xl space-y-2">
                        <span className="text-xs font-bold text-[#ffcc29]">Mixed Audio Preview</span>
                        <audio src={finalAudioUrl} controls className="w-full h-8" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 8: Video Merge */}
            {currentStep === 8 && (() => {
              const readyClipUrls = collectDirectorClipUrls(scenes, draft);
              return (
                <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                    <h2 className="text-lg font-bold flex items-center gap-2"><Film className="w-5 h-5 text-[#ffcc29]" /> Step 8: Merge Video Clips &amp; Audio</h2>
                    {(finalOutputUrl || finalVideoUrl) && (
                      <button onClick={() => setCurrentStep(9)} className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] flex items-center gap-2">
                        Proceed to Content &amp; Thumbnail &rarr;
                      </button>
                    )}
                  </div>

                  {/* Clip status indicator */}
                  <div className={`flex items-center gap-3 p-4 rounded-xl border ${readyClipUrls.length > 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                    <Video className={`w-5 h-5 ${readyClipUrls.length > 0 ? 'text-emerald-400' : 'text-amber-400'}`} />
                    <div className="flex-1">
                      {readyClipUrls.length > 0 ? (
                        <p className="text-sm text-emerald-300 font-semibold">{readyClipUrls.length} video clip{readyClipUrls.length !== 1 ? 's' : ''} ready to merge</p>
                      ) : (
                        <div>
                          <p className="text-sm text-amber-300 font-semibold">No video clips found</p>
                          <p className="text-xs text-slate-400 mt-0.5">Please complete Step 6 to generate video clips first</p>
                        </div>
                      )}
                    </div>
                    {readyClipUrls.length === 0 && (
                      <button onClick={() => setCurrentStep(6)} className="px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold hover:bg-amber-500/30 transition">
                        Go to Step 6
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button onClick={handleMergeVideo} disabled={readyClipUrls.length === 0} className="px-6 py-3 rounded-xl bg-[#ffcc29] text-black font-bold text-sm hover:bg-[#e6b825] transition flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Film className="w-4 h-4" /> Merge Full Video
                    </button>
                    {finalAudioUrl && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#ffcc29]/30 bg-[#ffcc29]/5">
                        <Mic2 className="w-4 h-4 text-[#ffcc29]" />
                        <span className="text-xs text-[#ffcc29] font-semibold">Audio ready</span>
                      </div>
                    )}
                  </div>

                  {(finalOutputUrl || finalVideoUrl) && (
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-slate-400 uppercase">Rendered Commercial Video</span>
                      <video src={finalOutputUrl || finalVideoUrl} controls className="w-full rounded-xl border border-slate-700 max-h-[480px]" />
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── STEP 9: Thumbnail & Content */}
            {currentStep === 9 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-[#ffcc29]" /> Step 9: Thumbnail &amp; Copy Generation</h2>
                  <button onClick={() => setCurrentStep(10)} className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] flex items-center gap-2">
                    Proceed to Publish &amp; Schedule &rarr;
                  </button>
                </div>

                <button onClick={handleGenerateContent} className="px-5 py-2.5 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-bold text-xs hover:bg-[#ffcc29]/10">
                  Generate Caption &amp; Thumbnail
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Thumbnail</label>
                    {thumbnailUrl ? (
                      <img src={thumbnailUrl} alt="Thumbnail" className="w-full aspect-video object-contain bg-black rounded-xl border border-slate-700" />
                    ) : (
                      <div className="h-52 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-xs">No Thumbnail yet</div>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Caption</label>
                      <textarea className={`${inputClass} min-h-[90px] text-xs resize-none`} value={caption} onChange={(e) => setCaption(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Hashtags</label>
                      <textarea className={`${inputClass} min-h-[70px] text-xs resize-none`} value={hashtagsText} onChange={(e) => setHashtagsText(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 10: Publish & Schedule */}
            {currentStep === 10 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="pb-3 border-b border-slate-700/50">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Check className="w-5 h-5 text-[#ffcc29]" /> Step 10: Platform Selection &amp; Scheduling</h2>
                </div>

                {/* ── Post Preview: final video, thumbnail, caption & hashtags */}
                <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-5">
                  <h3 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#ffcc29]" /> Post Preview
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* AI video preview */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">AI Video</label>
                      {(finalOutputUrl || finalVideoUrl) ? (
                        <video
                          src={finalOutputUrl || finalVideoUrl}
                          controls
                          poster={thumbnailUrl || undefined}
                          className="w-full rounded-xl border border-slate-700 max-h-[420px] bg-black"
                        />
                      ) : (
                        <div className="h-52 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-xs">
                          No video yet
                        </div>
                      )}
                    </div>

                    {/* Thumbnail + caption + hashtags */}
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Thumbnail</label>
                        {thumbnailUrl ? (
                          <img src={thumbnailUrl} alt="Thumbnail" className="w-full aspect-video object-contain bg-black rounded-xl border border-slate-700" />
                        ) : (
                          <div className="h-40 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-xs">
                            No thumbnail yet
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Caption</label>
                        <p className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-900/60 border border-slate-700 rounded-xl p-3 min-h-[52px]">
                          {caption || <span className="text-slate-600">No caption added</span>}
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Hashtags</label>
                        <p className="text-xs text-[#ffcc29] whitespace-pre-wrap bg-slate-900/60 border border-slate-700 rounded-xl p-3 min-h-[40px]">
                          {hashtagsText || <span className="text-slate-600">No hashtags added</span>}
                        </p>
                      </div>
                    </div>
                  </div>

                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase">Select Social Platforms</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {['instagram', 'facebook', 'linkedin', 'youtube'].map((p) => {
                      const active = selectedPlatforms.includes(p);
                      return (
                        <button
                          key={p}
                          onClick={() => togglePlatform(p)}
                          className={`py-3 rounded-xl text-xs font-bold border transition ${active ? 'bg-[#ffcc29] text-black border-[#ffcc29]' : 'bg-slate-900 border-slate-700 text-slate-300'
                            }`}
                        >
                          {p.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Schedule Date</label>
                    <input type="date" className={`${inputClass} dark:[color-scheme:dark] [color-scheme:light]`} value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Schedule Time</label>
                    <input type="time" className={`${inputClass} dark:[color-scheme:dark] [color-scheme:light]`} value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 pt-4">
                  <button onClick={() => handleSchedulePost(false)} disabled={!scheduleDate || !scheduleTime} className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#ffcc29] to-amber-500 text-black font-bold text-sm hover:opacity-90 disabled:opacity-40">
                    Schedule Commercial
                  </button>
                  <button onClick={() => handleSchedulePost(true)} className="px-6 py-3 rounded-xl border border-emerald-500 text-emerald-400 font-bold text-sm hover:bg-emerald-500/10">
                    Publish Now
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scene Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className={`${panelClass} w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-5`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  {editModal.type === 'image' ? <ImageIcon className="w-4 h-4 text-[#ffcc29]" /> : <Video className="w-4 h-4 text-[#ffcc29]" />}
                  Edit {editModal.type === 'image' ? 'Image' : 'Video Clip'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Scene {editModal.scene?.sceneNumber}: {editModal.scene?.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="w-9 h-9 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center justify-center"
                aria-label="Close edit popup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex justify-center">
              {editModal.type === 'image' ? (
                editModal.scene?.imageUrl || editModal.scene?.generatedImageUrl ? (
                  <img
                    src={editModal.scene.imageUrl || editModal.scene.generatedImageUrl}
                    alt="Selected scene"
                    className="w-full max-w-[260px] aspect-[9/16] object-cover rounded-lg border border-slate-700"
                  />
                ) : (
                  <div className="w-full max-w-[260px] aspect-[9/16] rounded-lg border border-dashed border-slate-700 flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-slate-600" />
                  </div>
                )
              ) : editModal.scene?.generatedVideoUrl ? (
                <video
                  src={editModal.scene.generatedVideoUrl}
                  controls
                  className="w-full max-w-[260px] aspect-[9/16] rounded-lg border border-slate-700"
                />
              ) : (
                <div className="w-full max-w-[260px] aspect-[9/16] rounded-lg border border-dashed border-slate-700 flex items-center justify-center">
                  <Video className="w-8 h-8 text-slate-600" />
                </div>
              )}
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase">
                {editModal.type === 'image' ? 'Image Edit Instruction' : 'Video Edit Instruction'}
              </label>
              <textarea
                className={`${inputClass} text-xs mt-1 min-h-[120px] resize-none`}
                value={editModal.instruction}
                onChange={(e) => setEditModal((current) => current ? { ...current, instruction: e.target.value } : current)}
                placeholder={editModal.type === 'image'
                  ? 'Example: keep the same woman and background, make her face look straight at camera, change only the saree color to royal blue'
                  : 'Example: keep the same image, add slow camera push-in, make the woman turn slightly toward camera, keep motion elegant'}
              />
            </div>

            <div className="flex flex-col sm:flex-row justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditModal(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitSceneEdit}
                disabled={!editModal.instruction.trim() || imgLoadingSceneId !== null || vidLoadingSceneId !== null}
                className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black text-xs font-bold hover:bg-[#e6b825] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {(imgLoadingSceneId === editModal.scene?.sceneId || vidLoadingSceneId === editModal.scene?.sceneId) && <Loader2 className="w-4 h-4 animate-spin" />}
                Regenerate This {editModal.type === 'image' ? 'Image' : 'Video'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setPreviewImageUrl(null)}>
          <img src={previewImageUrl} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-xl" />
        </div>
      )}
    </div>
  );
}
