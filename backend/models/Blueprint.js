'use strict';
const mongoose = require('mongoose');
const { STATUS, MODES } = require('../config/blueprint');
const { TIERS } = require('../config/entitlements');

// Brand Growth Blueprint job. A separate collection, like hero jobs.
const blueprintSchema = new mongoose.Schema(
  {
    blueprintId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    emailKey: { type: String, required: true },
    tierAtStart: { type: String, enum: TIERS, required: true },
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
    // 'plan' marks a run the system starts for an account's plan; customers' own Blueprints stay 'blueprint'.
    kind: { type: String, enum: ['blueprint', 'plan'], default: 'blueprint', index: true },
    ipHash: { type: String },
    sheet: { type: mongoose.Schema.Types.Mixed },
    sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
    directions: { type: mongoose.Schema.Types.Mixed },
    approvals: { type: [mongoose.Schema.Types.Mixed], default: [] },
    result: { type: mongoose.Schema.Types.Mixed },
    qaFlags: { type: [mongoose.Schema.Types.Mixed], default: [] },
    stop: { reason: { type: String }, message: { type: String } },
    error: { message: { type: String } },
    // The designed (image) edition (services/blueprint/designedService.js): status, pages, its own charge. It was written
    // by that service but never declared here, and Mongoose drops undeclared paths in strict mode.
    designed: { type: mongoose.Schema.Types.Mixed },
    charge: {
      // 'refunding' is the claim a refund is paid under (a crash there is finished by the sweep); 'unproven' is a refund
      // the sweep could not match to a charge, left for a person.
      state: { type: String, enum: ['none', 'pending', 'charged', 'refunding', 'refunded', 'unproven'], default: 'none' },
      quarks: { type: Number },
      // Written in the SAME update that claims the refund: who is paid back, how much, since when, and which state it was claimed from.
      refundAt: { type: Date },
      refundQuarks: { type: Number },
      refundPayer: { type: String },
      refundFrom: { type: String },
      // Set only when an agency client's Blueprint was paid from the agency pool, so a refund goes to the same wallet.
      payerId: { type: String }
    }
  },
  { timestamps: true }
);

blueprintSchema.index({ userId: 1, createdAt: -1 });
blueprintSchema.index({ ipHash: 1, createdAt: -1 });
blueprintSchema.index({ emailKey: 1 }, { unique: true, partialFilterExpression: { freeSlot: true }, name: 'one_free_per_email' });
blueprintSchema.index({ businessKeys: 1 }, { unique: true, partialFilterExpression: { freeSlot: true }, name: 'one_free_per_business' });

// Indexes for the staff Usage page. Skipped by automatic index builds; created on purpose by scripts/create-staff-indexes.js.
require('../config/staffIndexes').declareStaffIndexes(blueprintSchema, 'Blueprint');

module.exports = mongoose.models.Blueprint || mongoose.model('Blueprint', blueprintSchema, 'blueprints');
