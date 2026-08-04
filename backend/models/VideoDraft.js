const mongoose = require('mongoose');

const videoDraftSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    version: { type: Number, default: 0 },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    currentStep: { type: Number, default: 1 },

    // Director Studio — Business Brief
    businessName: { type: String, default: '' },
    industry: { type: String, default: '' },
    targetAudience: { type: String, default: '' },
    brandSummary: { type: String, default: '' },
    brandTone: { type: String, default: '' },
    commercialObjective: { type: String, default: '' },
    storyDirection: { type: String, default: '' },
    storyTitle: { type: String, default: '' },
    story: { type: mongoose.Schema.Types.Mixed, default: null },
    description: { type: String, default: '' },
    videoStyle: { type: String, default: null },
    durationSeconds: { type: Number, default: null },
    useCharacters: { type: Boolean, default: true },
    useLogo: { type: Boolean, default: false },
    selectedProductId: { type: String, default: null },
    imageDataUrl: { type: String, default: null },

    // Character identity
    characterId: { type: String, default: null, index: true },
    identityMemoryId: { type: String, default: null },
    characters: { type: mongoose.Schema.Types.Mixed, default: [] },
    characterSheet: { type: mongoose.Schema.Types.Mixed, default: null },

    // Story & scenes
    productionBible: { type: mongoose.Schema.Types.Mixed, default: null },
    voiceScript: { type: String, default: '' },
    scenes: { type: mongoose.Schema.Types.Mixed, default: null },
    scenesMetadata: { type: mongoose.Schema.Types.Mixed, default: null },
    sceneImages: { type: mongoose.Schema.Types.Mixed, default: {} },
    scenePrompts: { type: mongoose.Schema.Types.Mixed, default: {} },
    screenplay: { type: mongoose.Schema.Types.Mixed, default: [] },

    // Pipeline state
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    prompt: { type: mongoose.Schema.Types.Mixed, default: null },
    images: { type: mongoose.Schema.Types.Mixed, default: null },
    clips: { type: mongoose.Schema.Types.Mixed, default: null },
    sceneVideos: { type: mongoose.Schema.Types.Mixed, default: {} },
    imageJobs: { type: mongoose.Schema.Types.Mixed, default: {} },
    audioConfig: { type: mongoose.Schema.Types.Mixed, default: null },
    audioLanguageCode: { type: String, default: 'en' },
    voiceGender: { type: String, default: 'female' },
    subtitles: { type: mongoose.Schema.Types.Mixed, default: null },
    audio: { type: mongoose.Schema.Types.Mixed, default: null },
    thumbnails: { type: mongoose.Schema.Types.Mixed, default: null },
    mix: { type: mongoose.Schema.Types.Mixed, default: null },
    merge: { type: mongoose.Schema.Types.Mixed, default: null },
    mergeProgress: { type: mongoose.Schema.Types.Mixed, default: null },
    content: { type: mongoose.Schema.Types.Mixed, default: null },
    captions: { type: mongoose.Schema.Types.Mixed, default: null },
    platform: { type: mongoose.Schema.Types.Mixed, default: null },
    schedule: { type: mongoose.Schema.Types.Mixed, default: null },
    publishSettings: { type: mongoose.Schema.Types.Mixed, default: null },
    language: { type: String, default: '' },
    voice: { type: mongoose.Schema.Types.Mixed, default: null },
    aiMemoryRefs: { type: mongoose.Schema.Types.Mixed, default: [] },

    generatedVideos: { type: mongoose.Schema.Types.Mixed, default: [] },
    generatedAudio: { type: mongoose.Schema.Types.Mixed, default: null },
    finalVideoUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },

    // Legacy character fields (Reel Generator compatibility)
    wardrobes: { type: mongoose.Schema.Types.Mixed, default: [] },
    locations: { type: mongoose.Schema.Types.Mixed, default: [] },
    characterEnabled: { type: Boolean, default: false },
    characterImage: { type: String, default: null },
    originalCharacterImage: { type: String, default: null },
    characterFaceEmbedding: { type: String, default: null },
    characterName: { type: String, default: null },
    characterAge: { type: String, default: null },
    characterGender: { type: String, default: null },
    characterRole: { type: String, default: null },
    characterPersonality: { type: String, default: null },
    characterAppearance: { type: String, default: null },
    characterHairStyle: { type: String, default: null },
    characterHairColor: { type: String, default: null },
    characterClothing: { type: String, default: null },
    characterRace: { type: String, default: null },
    characterBeard: { type: String, default: null },
    characterArtStyle: { type: String, default: null },
    preserveIdentity: { type: Boolean, default: true },
    characterUsage: { type: String, default: 'Main Character in all scenes' },
    characterConsistencyStrength: { type: String, default: 'Strict' },
    location: { type: String, default: '' },

    // Catch-all for forward compatibility — nothing stripped by Mongoose
    directorStudio: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  {
    collection: 'video_drafts',
    timestamps: true,
    strict: false
  }
);

module.exports = mongoose.model('VideoDraft', videoDraftSchema);
