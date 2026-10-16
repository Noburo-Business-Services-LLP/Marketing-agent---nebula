const mongoose = require('mongoose');

/**
 * A video made in the Videos flow (one prompt, one clip from Gemini Omni). A change request ("make it evening") is a
 * new document that points back at the one it changed, so every version stays in the person's history.
 */
const studioVideoSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing', index: true },
  title: { type: String, default: '' },
  idea: { type: String, default: '' },
  concept: { type: String, default: '' },
  spokenLine: { type: String, default: '' },
  style: { type: String, default: 'natural' },
  language: { type: String, default: 'english' },
  aspectRatio: { type: String, default: '9:16' },
  prompt: { type: String, default: '' }, // what was sent to the model; kept for support, never shown
  references: { type: [{ kind: String, name: String, url: String }], default: [] },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'StudioVideo', default: null },
  change: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
  seconds: { type: Number, default: 10 },
  quarks: { type: Number, default: 0 },
  refunded: { type: Boolean, default: false },
  // Whose Quarks paid for this video (the agency for a client workspace), so a refund goes back to the same wallet.
  payer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  error: { type: String, default: '' },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
}, { collection: 'studio_videos', timestamps: true });

studioVideoSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.StudioVideo || mongoose.model('StudioVideo', studioVideoSchema);
