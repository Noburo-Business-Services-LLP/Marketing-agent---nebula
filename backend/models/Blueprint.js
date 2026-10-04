'use strict';
const mongoose = require('mongoose');
const { STATUS, MODES } = require('../config/blueprint');

// Brand Growth Blueprint job. A separate collection, like hero jobs.
const blueprintSchema = new mongoose.Schema(
  {
    blueprintId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    emailKey: { type: String, required: true },
    tierAtStart: { type: String, enum: ['free', 'starter', 'professional', 'managed'], required: true },
    mode: { type: String, enum: MODES, default: 'auto' },
    status: { type: String, enum: STATUS, default: 'queued', index: true },
    step: { type: String, default: 'queued' },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    checkpoint: { type: Number, default: null },
    heartbeatAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    completedAt: { type: Date },
    input: { type: mongoose.Schema.Types.Mixed },
    businessKeys: { type: [String], default: [] },
    freeSlot: { type: Boolean, default: false },
    ipHash: { type: String },
    sheet: { type: mongoose.Schema.Types.Mixed },
    sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
    directions: { type: mongoose.Schema.Types.Mixed },
    approvals: { type: [mongoose.Schema.Types.Mixed], default: [] },
    result: { type: mongoose.Schema.Types.Mixed },
    qaFlags: { type: [mongoose.Schema.Types.Mixed], default: [] },
    stop: { reason: { type: String }, message: { type: String } },
    error: { message: { type: String } },
    charge: {
      state: { type: String, enum: ['none', 'pending', 'charged', 'refunded'], default: 'none' },
      quarks: { type: Number }
    }
  },
  { timestamps: true }
);

blueprintSchema.index({ userId: 1, createdAt: -1 });
blueprintSchema.index({ ipHash: 1, createdAt: -1 });
blueprintSchema.index({ emailKey: 1 }, { unique: true, partialFilterExpression: { freeSlot: true }, name: 'one_free_per_email' });
blueprintSchema.index({ businessKeys: 1 }, { unique: true, partialFilterExpression: { freeSlot: true }, name: 'one_free_per_business' });

module.exports = mongoose.models.Blueprint || mongoose.model('Blueprint', blueprintSchema, 'blueprints');
