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
  Trash2
} from 'lucide-react';
import { getThemeClasses, useTheme } from '../context/ThemeContext';
import { inventoryAPI, videoGenerationAPI } from '../services/api';
import { Product } from '../types';

type AudioMode = 'off' | 'auto' | 'upload';
type VideoStatusFilter = 'all' | 'draft' | 'created' | 'scheduled' | 'posted';

const WIZARD_STEPS = [
  'Input',
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
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const panelClass = `${theme.bgCard} border ${isDarkMode ? 'border-slate-800' : 'border-slate-200'} rounded-2xl`;
  const inputClass = `w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition ${
    isDarkMode
      ? 'bg-slate-900 border-slate-700 text-white focus:border-[#ffcc29]'
      : 'bg-white border-slate-300 text-slate-900 focus:border-[#ffcc29]'
  }`;

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState('');
  const [draft, setDraft] = useState<any>(null);
  const [videoDrafts, setVideoDrafts] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<VideoStatusFilter>('all');
  const [showWizard, setShowWizard] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [description, setDescription] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [sceneCount, setSceneCount] = useState<number | ''>('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [inputImageData, setInputImageData] = useState('');
  const [inputImageName, setInputImageName] = useState('');

  const [promptText, setPromptText] = useState('');
  const [scenes, setScenes] = useState<any[]>([]);

  const [audioEnabled, setAudioEnabled] = useState(true);
  const [audioMode, setAudioMode] = useState<AudioMode>('auto');
  const [audioTone, setAudioTone] = useState('professional');
  const [audioLanguageCode, setAudioLanguageCode] = useState('en');
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

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((p) => p._id === selectedProductId) || null,
    [products, selectedProductId]
  );

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
  };

  useEffect(() => {
    loadVideoDrafts();
  }, []);

  const refreshDraft = async (id = jobId) => {
    if (!id) return;
    const response = await videoGenerationAPI.getDraft(id);
    if (!response?.success) return;
    const nextDraft = response.draft;
    setDraft(nextDraft);
    setPromptText(nextDraft?.prompt?.promptText || '');
    if (Array.isArray(nextDraft?.images?.sceneData) && nextDraft.images.sceneData.length) {
      setScenes(nextDraft.images.sceneData);
    } else if (Array.isArray(nextDraft?.clips?.sceneData) && nextDraft.clips.sceneData.length) {
      setScenes(nextDraft.clips.sceneData);
    } else if (Array.isArray(nextDraft?.scenes?.sceneData) && nextDraft.scenes.sceneData.length) {
      setScenes(nextDraft.scenes.sceneData);
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
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
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
    voiceGender,
    voiceVolume,
    musicVolume,
    manualAudioData: audioMode === 'upload' ? manualVoiceData : undefined,
    ...overrides
  });

  const ensureDraftForAudioTest = async (fallbackDescription = '') => {
    const effectiveDescription = description.trim() || fallbackDescription.trim();
    if (!effectiveDescription) {
      throw new Error('Description is required');
    }
    if (jobId) return jobId;

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

  const generatePromptAndScenes = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing. Complete step 1 first.');
    const promptResponse = await videoGenerationAPI.generatePrompt({
      jobId,
      promptText: promptText || undefined
    });
    const effectivePrompt = promptResponse?.prompt?.promptText || promptText;
    setPromptText(effectivePrompt);

    const sceneResponse = await videoGenerationAPI.generateScenes({
      jobId,
      promptText: effectivePrompt
    });
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
    setStep(3);
  });

  const generateSceneImages = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.generateImages({
      jobId,
      action: 'generateAll',
      sceneData: scenes
    });
    if (!response?.success) throw new Error(response?.message || 'Image generation failed');
    setScenes(response.sceneData || []);
    setDraft(response.draft || draft);
  });

  const regenerateSceneImage = async (scene: any) => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.generateImages({
      jobId,
      action: 'regenerate',
      sceneId: scene.sceneId,
      imagePrompt: scene.imagePrompt
    });
    if (!response?.success) throw new Error(response?.message || 'Image regeneration failed');
    setScenes(response.sceneData || []);
    setDraft(response.draft || draft);
  });

  const generateClips = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.generateClips({
      jobId,
      sceneData: scenes
    });
    if (!response?.success) throw new Error(response?.message || 'Clip generation failed');
    setScenes(response.sceneData || []);
    setDraft(response.draft || draft);
  });

  const generateAudioPreview = async () => withBusy(async () => {
    const audioJobId = await ensureDraftForAudioTest(description);
    const response = await videoGenerationAPI.generateAudio({
      jobId: audioJobId,
      audio: buildAudioPayload()
    });
    if (!response?.success) throw new Error(response?.message || 'Audio generation failed');
    setGeneratedTracks(response?.audio?.tracks || null);
    setFinalAudioUrl('');
    setDraft(response?.draft || draft);
  });

  const generateAudioTracks = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.generateAudio({
      jobId,
      audio: buildAudioPayload()
    });
    if (!response?.success) throw new Error(response?.message || 'Audio generation failed');
    setGeneratedTracks(response?.audio?.tracks || null);
    setDraft(response?.draft || draft);
    setStep(6);
  });

  const mixAudio = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.mixAudio({
      jobId,
      tracks: generatedTracks || draft?.audio?.tracks || {},
      durationSeconds
    });
    if (!response?.success) throw new Error(response?.message || 'Audio mix failed');
    setFinalAudioUrl(response.finalAudioUrl || '');
    setDraft(response.draft || draft);
  });

  const mergeVideo = async () => withBusy(async () => {
    if (!jobId) throw new Error('Draft missing');
    const response = await videoGenerationAPI.mergeVideo({
      jobId,
      finalAudioUrl: finalAudioUrl || undefined
    });
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
    setShowWizard(false);
    setStep(1);
  });

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) => (
      prev.includes(platform)
        ? prev.filter((item) => item !== platform)
        : [...prev, platform]
    ));
  };

  const resetWizard = () => {
    setShowWizard(true);
    setStep(1);
    setJobId('');
    setDraft(null);
    setDescription('');
    setSceneCount('');
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
    setError('');
    setSuccessMessage('');
  };

  const openVideoDraft = async (id: string) => {
    setShowWizard(true);
    setJobId(id);
    await refreshDraft(id);
    setStep(11);
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

  const primaryButtonClass = (disabled: boolean) => `px-6 py-3 rounded-xl font-bold transition-colors ${
    disabled
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
  const activeAudioScript = String(draft?.audio?.config?.voiceScript || '').trim();

  return (
    <div className={`p-6 min-h-screen ${isDarkMode ? 'bg-[#070A12]' : 'bg-slate-50'}`}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className={`text-2xl font-bold ${theme.text}`}>AI Video Manager</h1>
          <p className={theme.textSecondary}>Create, schedule, and track your AI videos in one place.</p>
        </div>

        {successMessage && (
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            isDarkMode
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
                  className={`pb-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                    active
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
          {filteredVideoDrafts.length ? (
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
                  className={`text-left rounded-2xl border overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                    isDarkMode ? 'bg-[#161b22] border-slate-700/50 hover:border-[#ffcc29]/50' : 'bg-white border-slate-200 hover:border-[#ffcc29]/60'
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
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => done && setStep(stepNo)}
                  disabled={!done && !active}
                  className={`text-xs px-2 py-2 rounded-lg border transition ${
                    active
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
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-colors ${
              busy
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

        {step === 1 && (
          <div className={`${panelClass} p-6 space-y-4`}>
            <h2 className={`font-bold text-lg ${theme.text}`}>Step 1: Input</h2>
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
                <label className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>Upload Image (Optional)</label>
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

            <button onClick={step1Next} disabled={!canStep1Next} className={primaryButtonClass(!canStep1Next)}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Next'}
            </button>
          </div>
        )}

        {step === 2 && (
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
              {(scenes || []).map((scene, idx) => (
                <div key={scene.sceneId || idx} className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3 space-y-2`}>
                  <input value={scene.title || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, title: e.target.value } : item))} className={inputClass} />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" min={1} value={scene.durationSeconds || 1} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, durationSeconds: Number(e.target.value) || 1 } : item))} className={inputClass} />
                    <input value={scene.sceneId || `scene_${idx + 1}`} disabled className={inputClass} />
                  </div>
                  <textarea value={scene.imagePrompt || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, imagePrompt: e.target.value } : item))} className={`${inputClass} min-h-[70px]`} placeholder="Image prompt" />
                  <textarea value={scene.videoPrompt || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, videoPrompt: e.target.value } : item))} className={`${inputClass} min-h-[70px]`} placeholder="Video prompt" />
                </div>
              ))}
            </div>

            <button onClick={saveStep2EditsAndNext} disabled={!canStep2Next} className={primaryButtonClass(!canStep2Next)}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Next'}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className={`${panelClass} p-6 space-y-4`}>
            <h2 className={`font-bold text-lg ${theme.text}`}>Step 3: Image Generation (Scene Preview)</h2>
            <button onClick={generateSceneImages} disabled={busy} className="px-4 py-2 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold">
              {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Generate / Refresh All Scene Images'}
            </button>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {scenes.map((scene, idx) => (
                <div key={scene.sceneId || idx} className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                  <p className={`font-semibold ${theme.text}`}>{scene.title || `Scene ${idx + 1}`}</p>
                  <textarea value={scene.imagePrompt || ''} onChange={(e) => setScenes((prev) => prev.map((item, i) => i === idx ? { ...item, imagePrompt: e.target.value } : item))} className={`${inputClass} mt-2 min-h-[70px]`} />
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} alt={scene.title} className="w-full h-52 object-cover rounded-lg mt-3 border border-slate-700" />
                  ) : (
                    <div className="h-52 rounded-lg mt-3 border border-dashed border-slate-600 flex items-center justify-center">
                      <ImageIcon className="w-7 h-7 text-slate-500" />
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => regenerateSceneImage(scene)} className="px-3 py-2 text-xs rounded-lg border border-[#ffcc29] text-[#ffcc29]">Regenerate</button>
                    <label className="px-3 py-2 text-xs rounded-lg border border-slate-500 text-slate-300 cursor-pointer">
                      Replace
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => onSceneImageReplace(scene.sceneId, e.target.files?.[0])} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setStep(4)} disabled={!canStep3Next} className={primaryButtonClass(!canStep3Next)}>Next</button>
          </div>
        )}

        {step === 4 && (
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
            <button onClick={() => setStep(5)} disabled={!canStep4Next} className={primaryButtonClass(!canStep4Next)}>Next</button>
          </div>
        )}

        {step === 5 && (
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

        {step === 6 && (
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
              <button onClick={() => setStep(7)} disabled={!canStep6Next} className={primaryButtonClass(!canStep6Next)}>Next</button>
            </div>
            {finalAudioUrl && (
              <div className={`${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'} border rounded-xl p-3`}>
                <p className={`text-xs font-bold uppercase tracking-wide ${theme.textMuted}`}>final_audio.mp3</p>
                <audio controls src={finalAudioUrl} className="w-full mt-2" />
              </div>
            )}
          </div>
        )}

        {step === 7 && (
          <div className={`${panelClass} p-6 space-y-4`}>
            <h2 className={`font-bold text-lg ${theme.text}`}>Step 7: Video + Audio Merge</h2>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <button onClick={mergeVideo} disabled={busy} className="px-5 py-3 rounded-xl border border-[#ffcc29] text-[#ffcc29] font-semibold disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Merge Video + Audio'}
              </button>
              <button onClick={() => setStep(8)} disabled={!canStep7Next} className={primaryButtonClass(!canStep7Next)}>Next</button>
            </div>
            {(finalOutputUrl || finalVideoUrl) && (
              <div>
                <video controls src={finalOutputUrl || finalVideoUrl} className="w-full rounded-lg max-h-[520px]" />
                <p className={`text-xs mt-2 ${theme.textSecondary}`}>{finalOutputUrl ? 'final_output.mp4' : 'final_video.mp4'}</p>
              </div>
            )}
          </div>
        )}

        {step === 8 && (
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
            <button onClick={() => setStep(9)} disabled={!canStep8Next} className={primaryButtonClass(!canStep8Next)}>Next</button>
          </div>
        )}

        {step === 9 && (
          <div className={`${panelClass} p-6 space-y-4`}>
            <h2 className={`font-bold text-lg ${theme.text}`}>Step 9: Platform Selection</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {['instagram', 'facebook', 'linkedin', 'youtube'].map((platform) => {
                const active = selectedPlatforms.includes(platform);
                return (
                  <button
                    key={platform}
                    onClick={() => togglePlatform(platform)}
                    className={`px-4 py-3 rounded-xl border text-sm font-semibold ${
                      active
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
            <button onClick={() => setStep(10)} disabled={!canStep9Next} className={primaryButtonClass(!canStep9Next)}>Next</button>
          </div>
        )}

        {step === 10 && (
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

        {step === 11 && (
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
                onClick={resetWizard}
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
    </div>
  );
};

export default ReelGenerator;
