const mongoose = require('mongoose');

const videoJobSchema = new mongoose.Schema(
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
    // The refund claim (services/refundSettle.js): set in the SAME update that cancels or fails the job, so only the call
    // that ended the job refunds. 'refunding' until paid; 'unproven' when a sweep could not match a charge (left for a person).
    refundState: { type: String, enum: ['refunding', 'refunded', 'unproven', null], default: null },
    refundAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { collection: 'video_jobs', timestamps: true }
);

// Indexes for the staff Usage page. Skipped by automatic index builds; created on purpose by scripts/create-staff-indexes.js.
require('../config/staffIndexes').declareStaffIndexes(videoJobSchema, 'VideoJob');

module.exports = mongoose.model('VideoJob', videoJobSchema);
