/**
 * Allowed fields for Director Studio draft patches (optimistic-lock safe updates).
 * Prevents clients from overwriting jobs, merge internals, or queue state accidentally.
 */
const DIRECTOR_PATCH_ALLOWLIST = new Set([
  'currentStep',
  'version',
  'businessName',
  'industry',
  'targetAudience',
  'brandSummary',
  'brandTone',
  'commercialObjective',
  'storyDirection',
  'story',
  'storyTitle',
  'description',
  'environment',
  'characterAction',
  'cameraDirection',
  'transition',
  'audio',
  'videoStyle',
  'durationSeconds',
  'useCharacters',
  'useLogo',
  'selectedProductId',
  'imageDataUrl',
  'characterId',
  'identityMemoryId',
  'characters',
  'characterSheet',
  'characterImage',
  'characterEnabled',
  'productionBible',
  'voiceScript',
  'scenes',
  'scenesMetadata',
  'sceneImages',
  'scenePrompts',
  'screenplay',
  'sceneVideos',
  'prompt',
  'input',
  'images',
  'clips',
  'audio',
  'mix',
  'merge',
  'content',
  'platform',
  'schedule',
  'publishSettings',
  'thumbnailUrl',
  'finalVideoUrl',
  'finalOutputUrl',
  'finalAudioUrl',
  'caption',
  'hashtags',
  'hashtagsText',
  'selectedPlatforms',
  'scheduleDate',
  'scheduleTime',
  'audioConfig',
  'captions',
  'language',
  'voice',
  'aiMemoryRefs',
  'directorStudio',
  'preserveIdentity',
  'characterConsistencyStrength',
  'location',
  'characterName',
  'characterAge',
  'characterGender',
  'characterRole',
  'characterAppearance',
  'characterHairStyle',
  'characterHairColor',
  'characterClothing',
  'characterRace',
  'characterBeard',
  'characterArtStyle',
  'characterUsage',
  'jobs',
  'completedSteps',
  'uiState'
]);

const IMMUTABLE_PATCH_KEYS = new Set(['jobId', 'userId', 'createdAt', '_id', '__v']);

function pickAllowedDirectorPatch(body = {}) {
  const patch = {};
  if (!body || typeof body !== 'object') return patch;
  for (const [key, value] of Object.entries(body)) {
    if (IMMUTABLE_PATCH_KEYS.has(key)) continue;
    if (!DIRECTOR_PATCH_ALLOWLIST.has(key)) continue;
    patch[key] = value;
  }
  return patch;
}

function normalizeDirectorAutosavePayload(body = {}) {
  const patch = pickAllowedDirectorPatch(body);
  if (patch.description && !patch.brandSummary) {
    patch.brandSummary = patch.description;
  }
  if (Array.isArray(patch.scenes)) {
    patch.images = {
      ...(typeof body.images === 'object' ? body.images : {}),
      sceneData: patch.scenes,
      updatedAt: new Date().toISOString()
    };
  }
  if (patch.voiceScript !== undefined || patch.productionBible !== undefined) {
    patch.scenesMetadata = {
      ...(typeof body.scenesMetadata === 'object' ? body.scenesMetadata : {}),
      voiceScript: patch.voiceScript ?? body.scenesMetadata?.voiceScript ?? '',
      productionBible: patch.productionBible ?? body.scenesMetadata?.productionBible ?? null
    };
  }
  
  // Canonical audioConfig migration and normalization
  const incomingAudio = patch.audioConfig || patch.audio?.config || (typeof patch.audio === 'object' ? patch.audio : null);
  if (incomingAudio && typeof incomingAudio === 'object') {
    const canonicalAudioConfig = {
      enabled: incomingAudio.enabled !== false,
      mode: incomingAudio.mode || 'auto',
      audioPriority: incomingAudio.audioPriority || 'balanced',
      tone: incomingAudio.tone || 'professional',
      languageCode: incomingAudio.languageCode || patch.audioLanguageCode || body.audioLanguageCode || 'en',
      voiceGender: incomingAudio.voiceGender || patch.voiceGender || body.voiceGender || 'female',
      voiceVolume: Number.isFinite(Number(incomingAudio.voiceVolume)) ? Number(incomingAudio.voiceVolume) : 1,
      musicVolume: Number.isFinite(Number(incomingAudio.musicVolume)) ? Number(incomingAudio.musicVolume) : 0.24,
      provider: 'edge-tts'
    };
    patch.audioConfig = canonicalAudioConfig;
    patch.audioLanguageCode = canonicalAudioConfig.languageCode;
    patch.voiceGender = canonicalAudioConfig.voiceGender;
    patch.audio = {
      ...(typeof patch.audio === 'object' ? patch.audio : {}),
      config: canonicalAudioConfig
    };
  }
  if (patch.caption !== undefined || patch.hashtags !== undefined || patch.thumbnailUrl !== undefined) {
    patch.content = {
      ...(typeof body.content === 'object' ? body.content : {}),
      caption: patch.caption ?? body.content?.caption ?? '',
      hashtags: patch.hashtags ?? body.content?.hashtags ?? [],
      thumbnailUrl: patch.thumbnailUrl ?? body.content?.thumbnailUrl ?? null
    };
    delete patch.caption;
    delete patch.hashtags;
  }
  if (body.audioConfig || body.audio) {
    patch.audio = {
      ...(typeof body.audio === 'object' ? body.audio : {}),
      config: body.audioConfig || body.audio?.config || body.audio
    };
  }
  if (body.scheduleDate || body.scheduleTime || body.selectedPlatforms) {
    patch.platform = {
      selectedPlatforms: body.selectedPlatforms || body.platform?.selectedPlatforms || []
    };
    patch.schedule = {
      ...(typeof body.schedule === 'object' ? body.schedule : {}),
      scheduledAt: body.scheduleDate && body.scheduleTime
        ? new Date(`${body.scheduleDate}T${body.scheduleTime}`).toISOString()
        : (body.schedule?.scheduledAt || null)
    };
  }
  return patch;
}

module.exports = {
  DIRECTOR_PATCH_ALLOWLIST,
  pickAllowedDirectorPatch,
  normalizeDirectorAutosavePayload
};
