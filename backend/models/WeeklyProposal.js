'use strict';
const mongoose = require('mongoose');

// One proposal per account per week (Monday start). Items only move forward:
// proposed -> approved -> made, or -> skipped; a post that could not be made is 'failed' and can be retried.
const itemSchema = new mongoose.Schema({
  id: { type: String, required: true },
  kind: { type: String, enum: ['post', 'carousel', 'video'], required: true },
  topic: { type: String, default: '' },
  channel: { type: String, default: null },
  pillar: { type: String, default: null },
  source: { type: String, enum: ['calendar', 'plan'], default: 'plan' },
  calendarItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  status: { type: String, enum: ['proposed', 'approved', 'making', 'made', 'skipped', 'failed'], default: 'proposed' },
  ref: { type: String, default: null },
  error: { type: String, default: null },
  madeAt: { type: Date, default: null },
  approvedAt: { type: Date, default: null },
  makingAt: { type: Date, default: null },
  // True while the post's charge stands, so a post picked up again after a crash is never charged twice.
  charged: { type: Boolean, default: false }
}, { _id: false });

const weeklyProposalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekStart: { type: String, required: true },
  status: { type: String, enum: ['proposed', 'approved', 'skipped', 'expired'], default: 'proposed' },
  items: { type: [itemSchema], default: [] },
  scaledDown: { type: Boolean, default: false },
  removed: { videos: { type: Number, default: 0 }, carousels: { type: Number, default: 0 }, posts: { type: Number, default: 0 } },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'weekly_proposals' });

// The week is proposed once: a second create for the same week fails with a duplicate key and the caller re-reads.
weeklyProposalSchema.index({ userId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.models.WeeklyProposal || mongoose.model('WeeklyProposal', weeklyProposalSchema);
