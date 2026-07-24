import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Clapperboard, Users, BookOpen, Wand2, Check,
  Edit3, Loader2, RefreshCw, Image as ImageIcon, Video,
  MapPin, Heart, Camera, Shirt, Mic2, ChevronDown, ChevronUp,
  AlertCircle, Film, User, Sparkles, ArrowRight, ArrowLeft, Package, Trash2, Plus, Music2, Eye, X
} from 'lucide-react';
import { videoGenerationAPI, aiDirectorAPI, inventoryAPI, draftsAPI, contentCalendarAPI } from '../services/api';
import { CharacterManager } from '../components/CharacterManager';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import { Product, Draft } from '../types';

type VideoStatusFilter = 'all' | 'draft' | 'created' | 'scheduled' | 'posted';
type AudioMode = 'off' | 'auto' | 'upload';

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

export default function DirectorStudio() {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);

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
  const LS_KEY = 'director_studio_draft_v1';

  // Active Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const [draft, setDraft] = useState<any>(null);
  const [jobId, setJobId] = useState('');
  const [scenes, setScenes] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [generatingAllImages, setGeneratingAllImages] = useState(false);
  const [generatingAllVideos, setGeneratingAllVideos] = useState(false);

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

  // Per-scene editing & generation states
  const [promptLoadingSceneId, setPromptLoadingSceneId] = useState<string | null>(null);
  const [imgLoadingSceneId, setImgLoadingSceneId] = useState<string | null>(null);
  const [vidLoadingSceneId, setVidLoadingSceneId] = useState<string | null>(null);

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

  // ── AUTO-RESUME: if user had an active draft open when they refreshed/navigated away, re-open it
  useEffect(() => {
    const savedRaw = localStorage.getItem('director_studio_draft_v1');
    if (!savedRaw) return;
    try {
      const saved = JSON.parse(savedRaw);
      if (!saved?.jobId) return;

      const restoreFromSnapshot = (snapshot: any) => {
        if (!snapshot) return;
        setDraft(snapshot.draft || null);
        setJobId(snapshot.jobId || '');
        setScenes(Array.isArray(snapshot.scenes) ? snapshot.scenes : (snapshot.draft?.scenes || []));
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
        setSelectedProductId(snapshot.selectedProductId || snapshot.draft?.selectedProductId || '');
        setImageDataUrl(snapshot.imageDataUrl || snapshot.draft?.imageDataUrl || '');
        setFinalAudioUrl(snapshot.finalAudioUrl || snapshot.draft?.finalAudioUrl || '');
        setFinalVideoUrl(snapshot.finalVideoUrl || snapshot.draft?.finalVideoUrl || '');
        setFinalOutputUrl(snapshot.finalOutputUrl || snapshot.draft?.finalOutputUrl || '');
        setThumbnailUrl(snapshot.thumbnailUrl || snapshot.draft?.thumbnailUrl || '');
        setCaption(snapshot.caption || snapshot.draft?.caption || '');
        setHashtagsText(snapshot.hashtagsText || snapshot.draft?.hashtagsText || '');
        setSelectedPlatforms(Array.isArray(snapshot.selectedPlatforms) ? snapshot.selectedPlatforms : (snapshot.draft?.selectedPlatforms || []));
        setScheduleDate(snapshot.scheduleDate || snapshot.draft?.scheduleDate || '');
        setScheduleTime(snapshot.scheduleTime || snapshot.draft?.scheduleTime || '');
        setCurrentStep(Number(snapshot.currentStep || 1));
        setShowWizard(true);
      };

      restoreFromSnapshot(saved);

      (async () => {
        try {
          const res = await videoGenerationAPI.getDraft(saved.jobId);
          if (res?.success && res?.draft) {
            const d = res.draft;
            setDraft(d);
            setJobId(d.jobId);
            setScenes(d.scenes || []);
            setCharacters(d.characters || []);
            setBusinessName(d.businessName || saved.businessName || '');
            setIndustry(d.industry || saved.industry || '');
            setTargetAudience(d.targetAudience || saved.targetAudience || '');
            setBrandTone(d.brandTone || saved.brandTone || '');
            setCommercialObjective(d.commercialObjective || saved.commercialObjective || '');
            setBrandSummary(d.brandSummary || d.description || saved.brandSummary || '');
            setVideoStyle(d.videoStyle || saved.videoStyle || 'Cinematic Commercial');
            setDurationSeconds(d.durationSeconds || saved.durationSeconds || 30);
            setUseLogo(d.useLogo !== undefined ? d.useLogo : (saved.useLogo || false));
            setUseCharacters(saved.useCharacters !== undefined ? saved.useCharacters : true);
            setSelectedProductId(saved.selectedProductId || '');
            setShowWizard(true);
            const savedStep = localStorage.getItem(`director_studio_step_${d.jobId}`);
            if (savedStep) setCurrentStep(Number(savedStep));
            else if (saved.currentStep) setCurrentStep(Number(saved.currentStep));
            else if (d.currentStep) setCurrentStep(Number(d.currentStep));
          }
        } catch (_) { /* silent */ }
      })();
    } catch (_) { /* corrupt data — ignore */ }
  }, []);

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
    if (draft?.scenes) setScenes(draft.scenes);
    if (draft?.characters) setCharacters(draft.characters);
    if (draft?.finalAudioUrl) setFinalAudioUrl(draft.finalAudioUrl);
    if (draft?.finalVideoUrl) setFinalVideoUrl(draft.finalVideoUrl);
    if (draft?.finalOutputUrl) setFinalOutputUrl(draft.finalOutputUrl);
    if (draft?.thumbnailUrl) setThumbnailUrl(draft.thumbnailUrl);
  }, [draft]);

  useEffect(() => {
    if (jobId && currentStep) {
      localStorage.setItem(`director_studio_step_${jobId}`, String(currentStep));
    }
  }, [jobId, currentStep]);

  // ── SAVE the full draft state to localStorage so it can be restored with all scene/story/image/video details
  useEffect(() => {
    const snapshot = {
      jobId,
      draft,
      scenes,
      characters,
      businessName, industry, targetAudience, brandSummary, brandTone,
      commercialObjective, videoStyle, durationSeconds, useCharacters, useLogo,
      selectedProductId, imageDataUrl, finalAudioUrl, finalVideoUrl, finalOutputUrl,
      thumbnailUrl, caption, hashtagsText, selectedPlatforms, scheduleDate, scheduleTime,
      currentStep
    };
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
  }, [jobId, draft, scenes, characters, businessName, industry, targetAudience,
      brandSummary, brandTone, commercialObjective, videoStyle, durationSeconds,
      useCharacters, useLogo, selectedProductId, imageDataUrl, finalAudioUrl,
      finalVideoUrl, finalOutputUrl, thumbnailUrl, caption, hashtagsText,
      selectedPlatforms, scheduleDate, scheduleTime, currentStep]);

  // ── DEBOUNCED AUTO-SAVE to backend whenever Step 1 fields change and jobId exists
  const scheduleBackendAutoSave = useCallback(() => {
    if (!jobId) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await videoGenerationAPI.updateDraft(jobId, {
          businessName, industry, targetAudience, brandSummary, brandTone,
          commercialObjective, videoStyle, durationSeconds, useCharacters, useLogo,
          description: brandSummary || `Commercial for ${businessName || 'Brand'}`
        });
      } catch (_) { /* silent */ }
    }, 1500);
  }, [jobId, businessName, industry, targetAudience, brandSummary, brandTone,
      commercialObjective, videoStyle, durationSeconds, useCharacters, useLogo]);

  useEffect(() => {
    if (jobId && showWizard) scheduleBackendAutoSave();
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [businessName, industry, targetAudience, brandSummary, brandTone,
      commercialObjective, videoStyle, durationSeconds, useCharacters, useLogo, jobId, showWizard]);

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
      setBusyMsg('Loading draft...');
      const res = await videoGenerationAPI.getDraft(targetJobId);
      if (res?.success && res?.draft) {
        const d = res.draft;
        setDraft(d);
        setJobId(d.jobId);
        setScenes(d.scenes || []);
        setCharacters(d.characters || []);
        setBusinessName(d.businessName || '');
        setIndustry(d.industry || '');
        setTargetAudience(d.targetAudience || '');
        setBrandTone(d.brandTone || '');
        setCommercialObjective(d.commercialObjective || '');
        setBrandSummary(d.brandSummary || d.description || '');
        setVideoStyle(d.videoStyle || 'Cinematic Commercial');
        setDurationSeconds(d.durationSeconds || 30);
        setUseLogo(d.useLogo !== undefined ? d.useLogo : false);
        setShowWizard(true);
        // Resume from: localStorage > DB saved step > scenes heuristic
        const savedStep = localStorage.getItem(`director_studio_step_${d.jobId}`);
        if (savedStep) {
          setCurrentStep(Number(savedStep));
        } else if (d.currentStep && d.currentStep > 1) {
          setCurrentStep(d.currentStep);
        } else {
          setCurrentStep(d.scenes && d.scenes.length > 0 ? 3 : 1);
        }
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to load draft');
    } finally {
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
    setBusy(true);
    setBusyMsg('Saving brief & initializing commercial draft...');
    try {
      let activeJobId = jobId;

      if (!activeJobId) {
        const draftRes = await videoGenerationAPI.createDraft({
          description: brandSummary || `Commercial for ${businessName || 'Brand'}`,
          videoStyle,
          durationSeconds,
          imageData: imageDataUrl,
          productId: selectedProductId,
          useLogo
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
        videoStyle
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

  const handleUpdateScene = (sceneId: string, updates: any) => {
    setScenes(prev => prev.map((s) => s.sceneId === sceneId ? { ...s, ...updates } : s));
  };

  const mergeSceneRegenerationResult = (sceneId: string, nextScene: any) => {
    setScenes(prev => prev.map((currentScene) => {
      if (currentScene.sceneId !== sceneId) return currentScene;
      const mergedScene = {
        ...currentScene,
        ...nextScene,
        imagePrompt: currentScene.imagePrompt || nextScene?.imagePrompt || '',
        videoPrompt: currentScene.videoPrompt || nextScene?.videoPrompt || '',
        imageUrl: nextScene?.imageUrl || nextScene?.generatedImageUrl || currentScene.imageUrl || currentScene.generatedImageUrl || '',
        generatedImageUrl: nextScene?.generatedImageUrl || nextScene?.imageUrl || currentScene.generatedImageUrl || currentScene.imageUrl || '',
        generatedVideoUrl: nextScene?.generatedVideoUrl || currentScene.generatedVideoUrl || ''
      };
      return mergedScene;
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
    if (!jobId || scenes.length === 0) return;
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
        handleUpdateScene(s.sceneId, {
          imagePrompt: res.imagePrompt,
          videoPrompt: res.videoPrompt
        });
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to generate prompts');
    } finally {
      setBusy(false);
      setBusyMsg('');
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

  const handleGenerateSceneImage = async (scene: any, instruction = '') => {
    setImgLoadingSceneId(scene.sceneId);
    const basePrompt = String(scene.imagePrompt || '').trim();
    const finalPrompt = buildEditPrompt(basePrompt, instruction);
    try {
      const res = await videoGenerationAPI.generateImages({
        jobId,
        action: 'regenerate',
        sceneId: scene.sceneId,
        prompt: finalPrompt,
        imagePrompt: finalPrompt,
        imageUrl: scene.imageUrl || scene.generatedImageUrl,
        style: videoStyle
      } as any);
      if (res?.sceneData) {
        const updatedScene = res.sceneData.find((item: any) => String(item.sceneId) === String(scene.sceneId));
        if (updatedScene) {
          mergeSceneRegenerationResult(scene.sceneId, updatedScene);
        } else {
          setScenes(res.sceneData);
        }
      } else {
        const url = res?.images?.[scene.sceneId]?.imageUrl || res?.imageUrl || res?.draft?.scenes?.find((s: any) => s.sceneId === scene.sceneId)?.imageUrl;
        if (url) handleUpdateScene(scene.sceneId, { generatedImageUrl: url, imageUrl: url });
      }
      handleUpdateScene(scene.sceneId, { imagePrompt: basePrompt });
    } catch (e: any) {
      alert(e?.message || 'Image generation failed');
    } finally {
      setImgLoadingSceneId(null);
    }
  };

  const handleGenerateAllImages = async () => {
    if (!jobId || scenes.length === 0) return;
    setGeneratingAllImages(true);
    setBusy(true);
    try {
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        setBusyMsg(`AI Artist is generating image for Scene ${i + 1}/${scenes.length}: ${scene.title}...`);
        setImgLoadingSceneId(scene.sceneId);
        
        const res = await videoGenerationAPI.generateImages({
          jobId,
          action: 'regenerate',
          sceneId: scene.sceneId,
          prompt: scene.imagePrompt,
          imagePrompt: scene.imagePrompt,
          style: videoStyle
        } as any);
        
        if (res?.sceneData) {
          setScenes(res.sceneData);
        } else {
          const url = res?.images?.[scene.sceneId]?.imageUrl || res?.imageUrl || res?.draft?.scenes?.find((s: any) => s.sceneId === scene.sceneId)?.imageUrl;
          if (url) {
            handleUpdateScene(scene.sceneId, { generatedImageUrl: url, imageUrl: url });
          }
        }
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
        sceneId: scene.sceneId,
        prompt: finalPrompt,
        imageUrl: scene.imageUrl || scene.generatedImageUrl,
        duration: scene.durationSeconds || 5
      } as any);
      if (res?.videoUrl) {
        handleUpdateScene(scene.sceneId, {
          generatedVideoUrl: res.videoUrl,
          videoPrompt: basePrompt
        });
      }
    } catch (e: any) {
      alert(e?.message || 'Video generation failed');
    } finally {
      setVidLoadingSceneId(null);
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
    try {
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneImg = scene.imageUrl || scene.generatedImageUrl;
        if (!sceneImg) {
          // Skip if there's no image yet
          continue;
        }
        setBusyMsg(`AI Director is animating Video Clip for Scene ${i + 1}/${scenes.length}: ${scene.title}...`);
        setVidLoadingSceneId(scene.sceneId);
        
        const res: any = await videoGenerationAPI.createVideo({
          jobId,
          sceneId: scene.sceneId,
          prompt: scene.videoPrompt,
          imageUrl: sceneImg,
          duration: scene.durationSeconds || 5
        } as any);
        
        if (res?.videoUrl) {
          handleUpdateScene(scene.sceneId, { generatedVideoUrl: res.videoUrl });
        }
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
  const handleGenerateAudio = async () => {
    if (!jobId) return;
    setBusy(true);
    setBusyMsg('Generating voice script & audio tracks...');
    try {
      const res = await videoGenerationAPI.generateAudio({
        jobId,
        audioMode,
        audioTone,
        languageCode: audioLanguageCode,
        voiceGender
      });
      if (res?.tracks) setGeneratedTracks(res.tracks);
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
        voiceVolume,
        musicVolume,
        priorityMode: audioPriority
      });
      if (res?.finalAudioUrl) setFinalAudioUrl(res.finalAudioUrl);
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
      const res = await videoGenerationAPI.mergeVideo({ jobId });
      if (res?.finalOutputUrl) setFinalOutputUrl(res.finalOutputUrl);
      if (res?.finalVideoUrl) setFinalVideoUrl(res.finalVideoUrl);
    } catch (e: any) {
      alert(e?.message || 'Video merge failed');
    } finally {
      setBusy(false);
      setBusyMsg('');
    }
  };

  // Thumbnail & content generation
  const handleGenerateContent = async () => {
    if (!jobId) return;
    setBusy(true);
    setBusyMsg('Generating thumbnail, caption, and hashtags...');
    try {
      const res = await videoGenerationAPI.generateContent({ jobId });
      if (res?.thumbnailUrl) setThumbnailUrl(res.thumbnailUrl);
      if (res?.caption) setCaption(res.caption);
      if (res?.hashtags) setHashtagsText(res.hashtags);
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
    setBusy(true);
    setBusyMsg(publishNow ? 'Publishing video...' : 'Scheduling post...');
    try {
      await videoGenerationAPI.schedulePost({
        jobId,
        platforms: selectedPlatforms,
        scheduleDate: publishNow ? undefined : scheduleDate,
        scheduleTime: publishNow ? undefined : scheduleTime,
        publishNow
      });
      alert(publishNow ? 'Video published successfully!' : 'Video scheduled successfully!');
      fetchDrafts();
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
                  {useCharacters ? 'Proceed to Character Manager →' : 'Generate Commercial Story & Screenplay →'}
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
                  <div className="flex items-center gap-2.5">
                    {scenes.length > 0 && (
                      <button
                        onClick={() => setCurrentStep(3)}
                        className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-white font-bold text-xs transition"
                      >
                        Keep Existing Story &amp; Proceed &rarr;
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (scenes.length > 0 && !window.confirm("Are you sure you want to regenerate the story? This will replace your existing scenes, prompts, and generated images.")) {
                          return;
                        }
                        handleGenerateStory();
                      }}
                      className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] transition flex items-center gap-2"
                    >
                      <Check className="w-4 h-4" /> {scenes.length > 0 ? 'Regenerate Story & Screenplay →' : 'Approve Characters &amp; Generate Story &rarr;'}
                    </button>
                  </div>
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
                      onClick={handleGenerateStory}
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

                {draft?.productionBible && (
                  <div className="bg-[#ffcc29]/5 border border-[#ffcc29]/20 rounded-xl p-5 space-y-3">
                    <h3 className="text-sm font-bold text-[#ffcc29] flex items-center gap-2"><Sparkles className="w-4 h-4" /> Production Bible</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      {draft.productionBible.emotionalHook && <div><span className="font-semibold text-slate-400 uppercase">Emotional Hook:</span><p className="mt-0.5 text-slate-200">{draft.productionBible.emotionalHook}</p></div>}
                      {draft.productionBible.creativeDirection && <div><span className="font-semibold text-slate-400 uppercase">Creative Direction:</span><p className="mt-0.5 text-slate-200">{draft.productionBible.creativeDirection}</p></div>}
                      {draft.productionBible.story && <div className="md:col-span-2"><span className="font-semibold text-slate-400 uppercase">Narrative Story Arc:</span><p className="mt-0.5 text-slate-200">{draft.productionBible.story}</p></div>}
                    </div>
                  </div>
                )}

                {draft?.voiceScript && (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2 mb-1.5"><Mic2 className="w-3.5 h-3.5 text-[#ffcc29]" /> Voiceover Script</h4>
                    <p className="text-xs text-slate-300 italic whitespace-pre-line leading-relaxed">{draft.voiceScript}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <h3 className="text-sm font-bold">Screenplay Scenes ({scenes.length})</h3>
                  {scenes.map((scene) => (
                    <div key={scene.sceneId} className="border border-slate-800 bg-slate-900/40 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-full bg-[#ffcc29]/10 text-[#ffcc29] font-bold text-xs flex items-center justify-center">{scene.sceneNumber}</span>
                          <h4 className="font-bold text-sm text-white">{scene.title}</h4>
                        </div>
                        <span className="text-xs text-slate-500">{scene.durationSeconds}s</span>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Action / Story</label>
                        <textarea className={`${inputClass} text-xs mt-1 resize-none`} value={scene.action || ''} onChange={(e) => handleUpdateScene(scene.sceneId, { action: e.target.value })} />
                      </div>
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

                <div className="space-y-6">
                  {scenes.map((scene) => (
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
                  ))}
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
                  <div className="flex items-center gap-3">
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
                    <select className={inputClass} value={audioMode} onChange={(e) => setAudioMode(e.target.value as AudioMode)}>
                      <option value="auto">AI Text-to-Speech</option>
                      <option value="upload">Custom Voice Upload</option>
                      <option value="off">Music Only</option>
                    </select>

                    <label className="block text-xs font-semibold text-slate-400 uppercase">Voice Gender</label>
                    <select className={inputClass} value={voiceGender} onChange={(e) => setVoiceGender(e.target.value as 'male' | 'female')}>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>

                    <button onClick={handleGenerateAudio} className="w-full py-3 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-bold text-xs hover:bg-[#ffcc29]/10">
                      1. Generate Audio Tracks
                    </button>
                  </div>

                  <div className="space-y-4">
                    <label className="block text-xs font-semibold text-slate-400 uppercase">Audio Priority</label>
                    <select className={inputClass} value={audioPriority} onChange={(e) => setAudioPriority(e.target.value as any)}>
                      <option value="voice">Voice Priority</option>
                      <option value="balanced">Balanced Mix</option>
                      <option value="music">Music Priority</option>
                    </select>

                    <button onClick={handleMixAudio} disabled={!generatedTracks} className="w-full py-3 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-bold text-xs hover:bg-[#ffcc29]/10 disabled:opacity-40">
                      2. Mix Audio &amp; Apply Ducking
                    </button>

                    {finalAudioUrl && (
                      <div className="p-3 bg-[#ffcc29]/10 border border-[#ffcc29]/30 rounded-xl space-y-2">
                        <span className="text-xs font-bold text-[#ffcc29]">Final Audio Track</span>
                        <audio src={finalAudioUrl} controls className="w-full h-8" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 8: Video Merge */}
            {currentStep === 8 && (
              <div className={`${panelClass} p-6 sm:p-8 space-y-6`}>
                <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Film className="w-5 h-5 text-[#ffcc29]" /> Step 8: Merge Video Clips &amp; Audio</h2>
                  {(finalOutputUrl || finalVideoUrl) && (
                    <button onClick={() => setCurrentStep(9)} className="px-5 py-2.5 rounded-xl bg-[#ffcc29] text-black font-bold text-xs hover:bg-[#e6b825] flex items-center gap-2">
                      Proceed to Content &amp; Thumbnail &rarr;
                    </button>
                  )}
                </div>

                <button onClick={handleMergeVideo} className="px-6 py-3 rounded-xl bg-[#ffcc29] text-black font-bold text-sm hover:bg-[#e6b825] transition flex items-center gap-2">
                  Merge Full Video
                </button>

                {(finalOutputUrl || finalVideoUrl) && (
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-slate-400 uppercase">Rendered Commercial Video</span>
                    <video src={finalOutputUrl || finalVideoUrl} controls className="w-full rounded-xl border border-slate-700 max-h-[480px]" />
                  </div>
                )}
              </div>
            )}

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
                      <img src={thumbnailUrl} alt="Thumbnail" className="w-full h-52 object-cover rounded-xl border border-slate-700" />
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
                    <input type="date" className={inputClass} value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase">Schedule Time</label>
                    <input type="time" className={inputClass} value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
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
