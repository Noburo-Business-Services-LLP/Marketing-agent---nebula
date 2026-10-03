const mongoose = require('mongoose');

// Hero video (Seedance via fal) jobs. Same shape as VideoJob, but a separate collection:
// the Kling queue worker's startup/stale recovery, GC and drain loops run unfiltered
// queries on every VideoJob document, so hero jobs must never live in `video_jobs`.
const heroVideoJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'queued',
      index: true
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    currentStep: { type: String, default: 'queued' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: {
      message: { type: String, default: null },
      stack: { type: String, default: null }
    },
    logs: { type: [String], default: [] },
    attempts: { type: Number, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { collection: 'hero_video_jobs', timestamps: true }
);

// Monthly quota count and the history list both filter by user and sort/range on createdAt.
heroVideoJobSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.HeroVideoJob || mongoose.model('HeroVideoJob', heroVideoJobSchema);
