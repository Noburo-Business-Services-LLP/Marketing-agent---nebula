const mongoose = require('mongoose');

const videoDraftSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    currentStep: { type: Number, default: 1 },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    prompt: { type: mongoose.Schema.Types.Mixed, default: null },
    scenes: { type: mongoose.Schema.Types.Mixed, default: null },
    images: { type: mongoose.Schema.Types.Mixed, default: null },
    clips: { type: mongoose.Schema.Types.Mixed, default: null },
    subtitles: { type: mongoose.Schema.Types.Mixed, default: null },
    audio: { type: mongoose.Schema.Types.Mixed, default: null },
    thumbnails: { type: mongoose.Schema.Types.Mixed, default: null },
    mix: { type: mongoose.Schema.Types.Mixed, default: null },
    merge: { type: mongoose.Schema.Types.Mixed, default: null },
    mergeProgress: { type: mongoose.Schema.Types.Mixed, default: null },
    content: { type: mongoose.Schema.Types.Mixed, default: null },
    platform: { type: mongoose.Schema.Types.Mixed, default: null },
    schedule: { type: mongoose.Schema.Types.Mixed, default: null },
    jobs: { type: mongoose.Schema.Types.Mixed, default: {} }, // Links background queue Job IDs (e.g. merge/clips)
    finalVideoUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    characterEnabled: { type: Boolean, default: false },
    characterImage: { type: String, default: null },
    originalCharacterImage: { type: String, default: null },
    characterFaceEmbedding: { type: String, default: null },
    characterSheet: {
      frontPortrait: { type: String, default: null },
      sidePortrait: { type: String, default: null },
      smilingPortrait: { type: String, default: null },
      neutralPortrait: { type: String, default: null }
    },
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
    videoStyle: { type: String, default: null },
    preserveIdentity: { type: Boolean, default: true },
    characterUsage: { type: String, default: 'Main Character in all scenes' },
    characterConsistencyStrength: { type: String, default: 'Strict' }
  },
  { collection: 'video_drafts', timestamps: true }
);

module.exports = mongoose.model('VideoDraft', videoDraftSchema);
