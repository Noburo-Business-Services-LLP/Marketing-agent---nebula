const mongoose = require('mongoose');

const videoJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
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
  { collection: 'video_jobs', timestamps: true }
);

module.exports = mongoose.model('VideoJob', videoJobSchema);
