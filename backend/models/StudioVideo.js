const mongoose = require('mongoose');

/**
 * A video made in the Videos flow (one prompt, one clip from Gemini Omni). A change request ("make it evening") is a
 * new document that points back at the one it changed, so every version stays in the person's history.
 */
const studioVideoSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // 'queued' only with ENABLE_STUDIO_VIDEO_CONSUMER on (E9 stage B1): charged, waiting for a consumer to claim it.
  status: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], default: 'processing', index: true },
  title: { type: String, default: '' },
  idea: { type: String, default: '' },
  concept: { type: String, default: '' },
  spokenLine: { type: String, default: '' },
  style: { type: String, default: 'natural' },
  language: { type: String, default: 'english' },
  voice: { type: String, enum: ['female', 'male'], default: 'female' },
  aspectRatio: { type: String, default: '9:16' },
  clips: { type: Number, default: 1 }, // 10 second clips asked for (1 to 6)
  clipsDone: { type: Number, default: 0 },
  parts: { type: [{ beats: [String], spokenLine: String }], default: [] }, // per-clip plan when clips > 1
  transition: { type: String, enum: ['fade', 'zoom', 'cut'], default: 'fade' }, // how clips are joined (only matters when clips > 1)
  subtitles: { type: Boolean, default: false },
  logo: { type: Boolean, default: false },
  endLine: { type: String, default: '' },
  platforms: { type: [String], default: [] }, // where it will be posted; remembered only
  notice: { type: String, default: '' }, // plain note on a finished video, e.g. it came out shorter than asked
  prompt: { type: String, default: '' }, // what was sent to the model; kept for support, never shown
  references: { type: [{ kind: String, name: String, url: String }], default: [] },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'StudioVideo', default: null },
  change: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
  seconds: { type: Number, default: 10 },
  quarks: { type: Number, default: 0 },
  refunded: { type: Boolean, default: false },
  // Refund claim: set in the same atomic update that closes the video ('refunding' until the Quarks are back, then 'done'),
  // with the amount and wallet recorded so a sweep can finish a refund a crash interrupted. See routes/studioVideos.js.
  refundState: { type: String, enum: ['', 'refunding', 'done'], default: '' },
  refundAmount: { type: Number, default: 0 },
  refundPayer: { type: String, default: '' },
  refundStartedAt: { type: Date, default: null },
  refundTries: { type: Number, default: 0 },
  refundFailed: { type: Boolean, default: false },
  // Whose Quarks paid for this video (the agency for a client workspace), so a refund goes back to the same wallet.
  payer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  error: { type: String, default: '' },
  // Consumer path (services/studioVideoConsumer.js, docs/superpowers/impact-maps/generation-parallelism.md B1): the claim
  // (worker id, lease end, run number), what the run needs (`work`), and each clip stored as soon as it is made so a
  // re-run resumes after the last stored clip instead of making (and paying the provider for) it again.
  workerId: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  releases: { type: Number, default: 0 },
  leaseRequeues: { type: Number, default: 0 },
  queuedAt: { type: Date, default: null },
  clipUrls: { type: [String], default: [] },
  work: { type: mongoose.Schema.Types.Mixed, default: null },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
}, { collection: 'studio_videos', timestamps: true });

studioVideoSchema.index({ user: 1, createdAt: -1 });
studioVideoSchema.index({ refundState: 1, refundStartedAt: 1 });

module.exports = mongoose.models.StudioVideo || mongoose.model('StudioVideo', studioVideoSchema);
