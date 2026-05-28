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
    audio: { type: mongoose.Schema.Types.Mixed, default: null },
    mix: { type: mongoose.Schema.Types.Mixed, default: null },
    merge: { type: mongoose.Schema.Types.Mixed, default: null },
    content: { type: mongoose.Schema.Types.Mixed, default: null },
    platform: { type: mongoose.Schema.Types.Mixed, default: null },
    schedule: { type: mongoose.Schema.Types.Mixed, default: null },
    jobs: { type: mongoose.Schema.Types.Mixed, default: {} }, // Links background queue Job IDs (e.g. merge/clips)
    finalVideoUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null }
  },
  { collection: 'video_drafts', timestamps: true }
);

module.exports = mongoose.model('VideoDraft', videoDraftSchema);
