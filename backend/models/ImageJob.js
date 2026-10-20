const mongoose = require('mongoose');

/**
 * A campaign image job (services/imageJobQueue.js): stored by the web task that accepted the request, claimed by the
 * runner of the worker task (or of the single task), so a job survives a deploy and its status can be read from any
 * task. Rows are removed by the TTL index (expireAt) 6 hours after they finish, 24 hours after they were made.
 */
const ImageJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true },
  status: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], default: 'queued' },
  progress: { type: Number, default: 0 },
  currentStep: { type: String, default: 'queued' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  logs: { type: [String], default: [] },
  attempts: { type: Number, default: 0 },
  leaseOwner: { type: String, default: '' },
  leaseUntil: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expireAt: { type: Date, required: true }
}, { collection: 'image_jobs', timestamps: true, minimize: false });

ImageJobSchema.index({ status: 1, createdAt: 1 }, { name: 'status_createdAt' });
ImageJobSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expireAt' });

module.exports = mongoose.models.ImageJob || mongoose.model('ImageJob', ImageJobSchema);
