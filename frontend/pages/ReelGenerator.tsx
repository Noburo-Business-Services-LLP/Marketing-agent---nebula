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
  X
} from 'lucide-react';
import { useSmartCalendarAutoFill } from '../hooks/useSmartCalendarAutoFill';
import { getThemeClasses, useTheme } from '../context/ThemeContext';
import { contentCalendarAPI, inventoryAPI, videoGenerationAPI, draftsAPI } from '../services/api';
import { Product, Draft } from '../types';
import { useLocation, useSearchParams } from 'react-router-dom';

type AudioMode = 'off' | 'auto' | 'upload';
type VideoStatusFilter = 'all' | 'draft' | 'created' | 'scheduled' | 'posted';

const WIZARD_STEPS = [
  'Input',
  'Character & Video Style Configuration',
  'Prompt + Scenes',
  'Scene Images',
  'Video Clips',
  'Audio Config',
  'Audio Mix',
  'Video Merge',
  'Thumbnail + Content',
  'Platform Select',
  'Scheduling',
  'Final Output'
];

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
  const [sceneCount, setSceneCount] = useState<number | ''>('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [inputImageData, setInputImageData] = useState('');
  const [inputImageName, setInputImageName] = useState('');

  const [characterEnabled, setCharacterEnabled] = useState(false);
  const [characterSource, setCharacterSource] = useState<'upload' | 'generate'>('upload');
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
  const [characterUsage, setCharacterUsage] = useState('Main Character in all scenes');
  const [characterConsistencyStrength, setCharacterConsistencyStrength] = useState('Strict');

  const [promptText, setPromptText] = useState('');
  const [scenes, setScenes] = useState<any[]>([]);

  const [audioEnabled, setAudioEnabled] = useState(true);
  const [audioMode, setAudioMode] = useState<AudioMode>('auto');
  const [audioTone, setAudioTone] = useState('professional');
  const [audioLanguageCode, setAudioLanguageCode] = useState('en');
  // TEMP (testing): allow selecting server music library by duration bucket.
  const [musicSource, setMusicSource] = useState<'tone' | 'library'>('library');
  const [musicTrack, setMusicTrack] = useState('');
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('female');
  const [voiceVolume, setVoiceVolume] = useState(1);
  const [musicVolume, setMusicVolume] = useState(0.24);
  const [manualVoiceData, setManualVoiceData] = useState('');
  const [manualVoiceName, setManualVoiceName] = useState('');
  const [generatedTracks, setGeneratedTracks] = useState<any>(null);
  const [finalAudioUrl, setFinalAudioUrl] = useState('');

  const [finalVideoUrl, setFinalVideoUrl] = useState('');
  const [finalOutputUrl, setFinalOutputUrl] = useState('');

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

  const deriveStepFromDraft = (d: any) => {
    const explicit = Number.parseInt(String(d?.currentStep || ''), 10);
    if (Number.isFinite(explicit) && explicit >= 1) return Math.min(12, Math.max(1, explicit));
    if (d?.final?.finalOutputUrl || d?.finalOutputUrl) return 12;
    if (d?.schedule?.scheduledAt || d?.schedule?.postedAt) return 11;
    if (Array.isArray(d?.platform?.selectedPlatforms) && d.platform.selectedPlatforms.length) return 10;
    if (d?.content?.thumbnailUrl || d?.content?.caption) return 9;
    if (d?.merge?.finalOutputUrl || d?.merge?.finalVideoUrl) return 8;
    if (d?.mix?.finalAudioUrl) return 7;
    if (d?.audio?.tracks || d?.audio?.config) return 6;
    if (d?.clips?.sceneData?.length) return 5;
    if (d?.images?.sceneData?.length) return 4;
    if (d?.scenes?.sceneData?.length) return 3;
    if (d?.characterEnabled !== undefined || d?.videoStyle) return 2;
    return 1;
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
    setPromptText(nextDraft?.prompt?.promptText || '');
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
    if (draftMusicSource === 'tone' || draftMusicSource === 'library') {
      setMusicSource(draftMusicSource);
    }
    setMusicTrack(String(nextDraft?.audio?.config?.musicTrack || ''));
    if (Array.isArray(nextDraft?.images?.sceneData) && nextDraft.images.sceneData.length) {
      setScenes(nextDraft.images.sceneData);
    } else if (Array.isArray(nextDraft?.clips?.sceneData) && nextDraft.clips.sceneData.length) {
      setScenes(nextDraft.clips.sceneData);
    } else if (Array.isArray(nextDraft?.scenes?.sceneData) && nextDraft.scenes.sceneData.length) {
      setScenes(nextDraft.scenes.sceneData);
    } else if (Array.isArray(nextDraft?.scenes) && nextDraft.scenes.length) {
      setScenes(nextDraft.scenes);
    }
    if (nextDraft?.audio?.tracks) setGeneratedTracks(nextDraft.audio.tracks);
    if (nextDraft?.mix?.finalAudioUrl) setFinalAudioUrl(nextDraft.mix.finalAudioUrl);
    if (nextDraft?.merge?.finalVideoUrl) setFinalVideoUrl(nextDraft.merge.finalVideoUrl);
    if (nextDraft?.merge?.finalOutputUrl) setFinalOutputUrl(nextDraft.merge.finalOutputUrl);
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
    if (qJobId) {
      setJobId(qJobId);
      setShowWizard(true);
      refreshDraft(qJobId, { syncStep: true });
    }
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

  const buildAudioPayload = (overrides: Record<string, any> = {}) => ({
    enabled: audioEnabled,
    mode: audioEnabled ? audioMode : 'off',
    languageCode: audioLanguageCode,
    tone: audioTone,
    musicSource,
    musicTrack: musicTrack.trim() || undefined,
    voiceGender,
    voiceVolume,
    musicVolume,
    manualAudioData: audioMode === 'upload' ? manualVoiceData : undefined,
    ...overrides
  });

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
      product: selectedProduct || undefined
    });
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
    setStep(3);
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

  const generatePromptAndScenes = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing. Complete step 1 first.');
    let currentPrompt = promptText;

    if (!currentPrompt) {
      const promptResponse = await videoGenerationAPI.generatePrompt({ jobId });
      if (!promptResponse?.success) {
        throw new Error(promptResponse?.message || 'Prompt generation failed');
      }
      currentPrompt = promptResponse.draft?.prompt?.structuredPrompt || promptResponse.draft?.prompt?.promptText || '';
      setPromptText(currentPrompt);
      setDraft(promptResponse.draft || draft);
    }

    const sceneResponse = await videoGenerationAPI.generateScenes({
      jobId,
      promptText: currentPrompt || undefined,
      async: true
    });

    const queueJobId = sceneResponse?.queueJobId;
    if (queueJobId) {
      await pollJob(queueJobId, async (result) => {
        setScenes(result.sceneData || []);
        if (result.draft?.prompt?.promptText) {
          setPromptText(result.draft.prompt.promptText);
        }
        setDraft(result.draft || draft);
      });
      return;
    }

    if (!sceneResponse?.success) {
      throw new Error(sceneResponse?.message || 'Scene generation failed');
    }
    setScenes(sceneResponse.sceneData || []);
    setDraft(sceneResponse.draft || draft);
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
    setStep(4);
  });

  const generateSceneImages = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    
    console.log('🎭 FRONTEND DEBUG: Image Generation Starting (ALL SCENES)');
    console.log('   Character Image:', characterImage ? '✓ Present' : '❌ MISSING');
    console.log('   Character Image Size:', characterImage?.length);
    console.log('   Character Name:', characterName);
    console.log('   Video ID:', jobId);

    const payload = {
      jobId,
      action: 'generateAll',
      sceneData: scenes,
      async: true,
      characterImageBase64: characterImage,
      characterName,
      videoStyle
    };
    console.log('📤 Sending payload to backend:', payload);

    const response = await videoGenerationAPI.generateImages(payload);
    console.log('📥 Backend response:', response);
    const queueJobId = response?.queueJobId;
    if (queueJobId) {
      await pollJob(queueJobId, async (result) => {
        setScenes(result.sceneData || []);
        setDraft(result.draft || draft);
      });
      return;
    }

    if (!response?.success) throw new Error(response?.message || 'Image generation failed');
    setScenes(response.sceneData || []);
    setDraft(response.draft || draft);
  });

  const regenerateSceneImage = async (scene: any) => {
    if (!jobId) { setError('Draft missing'); return; }
    const sid = String(scene.sceneId || '');
    markSceneRegenerating(sid, true);
    setError('');
    try {
      console.log('🎭 FRONTEND DEBUG: Image Regeneration Starting (SINGLE SCENE)');
      console.log('   Character Image:', characterImage ? '✓ Present' : '❌ MISSING');
      console.log('   Character Image Size:', characterImage?.length);
      console.log('   Character Name:', characterName);
      console.log('   Video ID:', jobId);
      console.log('   Scene Prompt:', scene.imagePrompt);

      const payload = {
        jobId,
        action: 'regenerate',
        sceneId: scene.sceneId,
        imagePrompt: scene.imagePrompt,
        characterImageBase64: characterImage,
        characterName,
        videoStyle
      };
      console.log('📤 Sending payload to backend:', payload);

      const response = await videoGenerationAPI.generateImages(payload);
      console.log('📥 Backend response:', response);

      if (!response?.success) throw new Error(response?.message || 'Image regeneration failed');
      setScenes(response.sceneData || []);
      setDraft(response.draft || draft);
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

  const generateClips = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');

    const response = await videoGenerationAPI.generateClips({
      jobId,
      sceneData: scenes,
      async: true
    });

    const queueJobId = response?.queueJobId;
    if (queueJobId) {
      await pollJob(queueJobId, async (result) => {
        setScenes(result.sceneData || []);
        setDraft(result.draft || draft);
      });
      return;
    }

    // Fallback: synchronous response (local/dev or fast runs)
    if (!response?.success) throw new Error(response?.message || 'Clip generation failed');
    setScenes(response.sceneData || []);
    setDraft(response.draft || draft);
  });

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
        setStep(7);
      });
      return;
    }

    if (!response?.success) throw new Error(response?.message || 'Audio generation failed');
    setGeneratedTracks(response?.audio?.tracks || null);
    setDraft(response?.draft || draft);
    setStep(7);
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
    setStep(12);
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
  const activeAudioScript = String(
    draft?.audio?.config?.localizedVoiceScript ||
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
                      onClick={() => openVideoDraft(item.generationProgress?.jobId || item._id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openVideoDraft(item.generationProgress?.jobId || item._id);
                        }
                      }}
                      className={`text-left rounded-2xl border overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 hover:border-[#ffcc29]/50' : 'bg-white border-slate-200 hover:border-[#ffcc29]/60'}`}
                    >
                      <div className="relative">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.title} className="w-full h-44 object-cover" />
                        ) : (
                          <div className={`w-full h-44 flex items-center justify-center ${isDarkMode ? 'bg-slate-900' : 'bg-slate-100'}`}>
                            <Film className="w-8 h-8 text-slate-500" />
                          </div>
                        )}
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
                    onClick={() => openVideoDraft(item.jobId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openVideoDraft(item.jobId);
                      }
                    }}
                    className={`text-left rounded-2xl border overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 hover:border-[#ffcc29]/50' : 'bg-white border-slate-200 hover:border-[#ffcc29]/60'
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
                {WIZARD_STEPS.map((label, idx) => {
                  const stepNo = idx + 1;
                  const active = stepNo === step;
                  const done = stepNo < step;
                  // Step 11 (Final Output) is also reachable any time the final video has been rendered
                  const finalReady = stepNo === 11 && !!(finalOutputUrl || finalVideoUrl);
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
                      {stepNo}. {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {step > 1 && step < 11 && (
              <button
                type="button"
                onClick={() => setStep((current) => Math.max(1, current - 1))}
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
                  {isAutoFillEnabled && availableItems.length === 0 && !isCalendarLoading && (
                    <span className="text-xs text-red-500">No Smart Calendar content available.</span>
                  )}
                  {isCalendarLoading && <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />}
                </div>
              </div>
              <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={`${inputClass} min-h-[120px]`}
                  placeholder="Describe the video you want to create..."
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Duration</label>
                    <select value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} className={`${inputClass} mt-2`}>
                      {[15, 30, 45, 60, 90, 120].map((item) => <option key={item} value={item}>{item} sec</option>)}
                    </select>
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

                <div className="flex gap-3">
                  <button onClick={step1Next} disabled={!canStep1Next} className={primaryButtonClass(!canStep1Next)}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Next'}
                  </button>
                  <button onClick={startAutoGenerate} disabled={!canStep1Next} className={`px-6 py-3 rounded-xl font-bold transition-colors ${!canStep1Next ? 'bg-blue-900/50 text-blue-500/50 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Auto-Generate Full Video'}
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
            <div className={`p-6 space-y-6 ${panelClass}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-xl font-bold ${theme.text}`}>Character & Video Style Configuration</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className={theme.text}>Use Character in Video</span>
                  <button
                    onClick={() => setCharacterEnabled(!characterEnabled)}
                    className={`flex-shrink-0 transition-colors ${characterEnabled ? 'text-[#ffcc29]' : theme.textMuted}`}
                  >
                    {characterEnabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                  </button>
                </div>
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
                        <input type="radio" checked={characterSource === 'upload'} onChange={() => setCharacterSource('upload')} />
                        <span className={theme.text}>Upload Image</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={characterSource === 'generate'} onChange={() => setCharacterSource('generate')} />
                        <span className={theme.text}>Generate AI Character</span>
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
                                <img src={characterImage} alt="Master Sheet" className="h-48 w-full object-contain rounded-xl mx-auto shadow-md" />
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
                            <img src={characterImage} alt="Generated Character Preview" className="h-48 w-48 object-cover rounded-xl mx-auto shadow-md" />
                            
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
                <label className={`block text-sm font-medium mb-1 ${theme.textMuted}`}>Video Style</label>
                <select className={inputClass} value={videoStyle} onChange={(e) => {
                  const style = e.target.value;
                  setVideoStyle(style);
                  if (style === 'Storytelling' && characterConsistencyStrength !== 'Strict') {
                    setCharacterConsistencyStrength('Strict');
                  }
                }}>
                  <option value="Cinematic Commercial">Cinematic Commercial</option>
                  <option value="Storytelling">Storytelling</option>
                  <option value="Product Advertisement">Product Advertisement</option>
                  <option value="Daily Life Vlog">Daily Life Vlog</option>
                  <option value="Documentary">Documentary</option>
                  <option value="Educational">Educational</option>
                  <option value="Motivational">Motivational</option>
                  <option value="Corporate Presentation">Corporate Presentation</option>
                  <option value="Testimonial">Testimonial</option>
                  <option value="Product Showcase">Product Showcase</option>
                  <option value="News Update">News Update</option>
                  <option value="Social Media Reel">Social Media Reel</option>
                  <option value="Luxury Advertisement">Luxury Advertisement</option>
                </select>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={step2Next}
                  disabled={busy || (characterEnabled && !characterApproved && characterSource === 'generate')}
                  className="px-6 py-2.5 bg-[#ffcc29] text-black font-semibold rounded-xl hover:bg-[#e6b825] transition disabled:opacity-50"
                >
                  {characterEnabled && !characterApproved && characterSource === 'generate' ? 'Approve Character to Continue' : 'Save & Next (Prompt + Scenes)'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 2: Prompt + Scene Generation</h2>
                <div className="flex gap-3">
                  <button onClick={generatePromptAndScenes} disabled={busy} className="px-4 py-2 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Generate Prompt + Scenes'}
                  </button>
                  <button onClick={() => refreshDraft()} className="px-4 py-2 rounded-xl border border-slate-500 text-slate-300">
                    <RefreshCcw className="w-4 h-4 inline mr-1" /> Refresh
                  </button>
                </div>

                <div>
                  <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Generated Prompt (Editable)</label>
                  <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} className={`${inputClass} mt-2 min-h-[100px]`} />
                </div>

                <div className="space-y-3">
                  <p className={`text-sm font-semibold ${theme.text}`}>Scene Breakdown (Editable)</p>
                  {(scenes || []).map((scene, idx) => {
                    const isRegen = regeneratingSceneIds.has(String(scene.sceneId || ''));
                    return (
                      <div key={scene.sceneId || idx} className={`relative ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3 space-y-3 overflow-hidden`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm font-bold ${theme.text}`}>Scene {idx + 1}</p>
                          <button
                            onClick={() => regenerateScene(scene)}
                            disabled={isRegen}
                            className="px-3 py-1.5 text-xs rounded-lg border border-[#ffcc29] text-[#ffcc29] hover:bg-[#ffcc29]/10 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isRegen ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                            {isRegen ? 'Regenerating' : 'Regenerate Scene'}
                          </button>
                        </div>

                        <div>
                          <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Title</label>
                          <input value={scene.title || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, title: e.target.value } : item))} className={`${inputClass} mt-1`} disabled={isRegen} />
                        </div>

                        <div>
                          <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Duration (seconds)</label>
                          <input type="number" min={1} value={scene.durationSeconds || 1} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, durationSeconds: Number(e.target.value) || 1 } : item))} className={`${inputClass} mt-1`} disabled={isRegen} />
                        </div>

                        <div>
                          <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Image Prompt</label>
                          <textarea value={scene.imagePrompt || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, imagePrompt: e.target.value } : item))} className={`${inputClass} mt-1 min-h-[70px]`} placeholder="Describe the visual for the still image" disabled={isRegen} />
                        </div>

                        <div>
                          <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Video Prompt</label>
                          <textarea value={scene.videoPrompt || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, videoPrompt: e.target.value } : item))} className={`${inputClass} mt-1 min-h-[70px]`} placeholder="Describe the motion / animation for the clip" disabled={isRegen} />
                        </div>

                        {isRegen && (
                          <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#ffcc29]/15 to-transparent skeleton-shimmer" />
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 backdrop-blur-[2px]">
                              <Sparkles className="w-7 h-7 text-[#ffcc29] animate-pulse" />
                              <p className="text-sm font-semibold text-[#ffcc29] tracking-wide">Regenerating scene...</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button onClick={saveStep2EditsAndNext} disabled={!canStep2Next} className={primaryButtonClass(!canStep2Next)}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Next'}
                </button>
              </div>
            )}

            {step === 4 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 3: Image Generation (Scene Preview)</h2>
                <button onClick={generateSceneImages} disabled={busy} className="px-4 py-2 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Generate / Refresh All Scene Images'}
                </button>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {scenes.map((scene, idx) => {
                    const isRegen = regeneratingSceneIds.has(String(scene.sceneId || ''));
                    return (
                      <div key={scene.sceneId || idx} className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                        <p className={`font-semibold ${theme.text}`}>{scene.title || `Scene ${idx + 1}`}</p>
                        <textarea value={scene.imagePrompt || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, imagePrompt: e.target.value } : item))} className={`${inputClass} mt-2 min-h-[70px]`} disabled={isRegen} />
                        <div className="relative mt-3 group cursor-pointer" onClick={() => { if (scene.imageUrl) setPreviewImageUrl(scene.imageUrl); }}>
                          {scene.imageUrl ? (
                            <>
                              <img src={scene.imageUrl} alt={scene.title} className={`w-full h-52 object-cover rounded-lg border border-slate-700 transition-all duration-300 ${isRegen ? 'opacity-30 blur-sm' : ''}`} />
                              {!isRegen && (
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg">
                                  <Eye className="w-8 h-8 text-white" />
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="h-52 rounded-lg border border-dashed border-slate-600 flex items-center justify-center">
                              <ImageIcon className="w-7 h-7 text-slate-500" />
                            </div>
                          )}
                          {isRegen && (
                            <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#ffcc29]/15 to-transparent skeleton-shimmer" />
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30 backdrop-blur-[2px]">
                                <Sparkles className="w-6 h-6 text-[#ffcc29] animate-pulse" />
                                <p className="text-xs font-semibold text-[#ffcc29] tracking-wide">Regenerating...</p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => regenerateSceneImage(scene)}
                            disabled={isRegen}
                            className="px-3 py-2 text-xs rounded-lg border border-[#ffcc29] text-[#ffcc29] hover:bg-[#ffcc29]/10 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {isRegen ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCcw className="w-3 h-3" />}
                            {isRegen ? 'Regenerating' : 'Regenerate'}
                          </button>
                          <label className={`px-3 py-2 text-xs rounded-lg border border-slate-500 text-slate-300 ${isRegen ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                            Replace
                            <input type="file" accept="image/*" className="hidden" disabled={isRegen} onChange={(e) => onSceneImageReplace(scene.sceneId, e.target.files?.[0])} />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setStep(5)} disabled={!canStep3Next} className={primaryButtonClass(!canStep3Next)}>Next</button>
              </div>
            )}

            {step === 5 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 4: Video Clip Generation</h2>
                <button onClick={generateClips} disabled={busy} className="px-4 py-2 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Generate / Regenerate Clips'}
                </button>
                <div className="space-y-3">
                  {scenes.map((scene, idx) => (
                    <div key={scene.sceneId || idx} className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                      <div className="flex justify-between items-center gap-3">
                        <p className={`font-semibold ${theme.text}`}>{scene.title || `Scene ${idx + 1}`}</p>
                        <input
                          type="number"
                          min={1}
                          value={scene.durationSeconds || 1}
                          onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, durationSeconds: Number(e.target.value) || 1 } : item))}
                          className={`${inputClass} w-28`}
                        />
                      </div>
                      {scene.clipUrl ? (
                        <video controls src={scene.clipUrl} className="w-full rounded-lg mt-3 max-h-[300px]" />
                      ) : (
                        <p className={`text-xs mt-2 ${theme.textSecondary}`}>Clip not generated yet.</p>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => setStep(6)} disabled={!canStep4Next} className={primaryButtonClass(!canStep4Next)}>Next</button>
              </div>
            )}

            {step === 6 && (
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
                      <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Music Source (Test)</label>
                      <select
                        value={musicSource}
                        onChange={(e) => setMusicSource(e.target.value as 'tone' | 'library')}
                        className={`${inputClass} mt-2`}
                      >
                        <option value="library">Library (by duration)</option>
                        <option value="tone">Tone Pack (default)</option>
                      </select>
                      <p className={`text-[11px] mt-1 ${theme.textSecondary}`}>
                        Uses backend `music/{durationSeconds}s` when Library is selected.
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
                    {finalAudioUrl && (
                      <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                        <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Mixed Preview</p>
                        <audio controls src={finalAudioUrl} className="w-full mt-2" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 7 && (
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
                  <button onClick={() => setStep(8)} disabled={!canStep6Next} className={primaryButtonClass(!canStep6Next)}>Next</button>
                </div>
                {finalAudioUrl && (
                  <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                    <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>final_audio.mp3</p>
                    <audio controls src={finalAudioUrl} className="w-full mt-2" />
                  </div>
                )}
              </div>
            )}

            {step === 8 && (
              <div className={`${panelClass} p-6 space-y-4`}>
                <h2 className={`font-bold text-lg ${theme.text}`}>Step 7: Video + Audio Merge</h2>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <button onClick={mergeVideo} disabled={busy} className="px-5 py-3 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold disabled:opacity-60">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Merge Video + Audio'}
                  </button>
                  <button onClick={() => setStep(9)} disabled={!canStep7Next} className={primaryButtonClass(!canStep7Next)}>Next</button>
                </div>
                {(finalOutputUrl || finalVideoUrl) && (
                  <div>
                    <video controls src={finalOutputUrl || finalVideoUrl} className="w-full rounded-lg max-h-[520px]" />
                    <p className={`text-xs mt-2 ${theme.textSecondary}`}>{finalOutputUrl ? 'final_output.mp4' : 'final_video.mp4'}</p>
                  </div>
                )}
              </div>
            )}

            {step === 9 && (
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
                <button onClick={() => setStep(10)} disabled={!canStep8Next} className={primaryButtonClass(!canStep8Next)}>Next</button>
              </div>
            )}

            {step === 10 && (
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
                <button onClick={() => setStep(11)} disabled={!canStep9Next} className={primaryButtonClass(!canStep9Next)}>Next</button>
              </div>
            )}

            {step === 11 && (
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

            {step === 12 && (
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
    </div>
  );
};

export default ReelGenerator;
