const mongoose = require('mongoose');
const caps = require('../config/homeDrafts');

// One row per Home draft REQUEST ("Make a post in response" or "Draft a witty comment" on a competitor's post). It is the
// durable ledger: written BEFORE any charge or model call, and every writing or check call is counted on it BEFORE it is
// made, so a crash can never lead to an unrecorded paid call. It also carries the idempotency key (a double click is one
// request), the single-request-at-a-time lock (`inFlight`, unique per account while true) and the refund flag that makes a
// refund happen once. Text is stored only for a draft that passed every check (to replay the same answer); a refused
// draft keeps rule codes only. Removed after KEEP_DAYS. How it works: docs/superpowers/ops/home-drafts.md
const resultSchema = new mongoose.Schema({ comment: String, caption: String, imageIdea: String }, { _id: false });

const homeDraftSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true, maxlength: 64 },
  kind: { type: String, enum: caps.KINDS, required: true },
  day: { type: String, required: true }, // India day, YYYY-MM-DD
  competitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Competitor' },
  postKey: { type: String, maxlength: 80 },
  tone: { type: String, enum: caps.TONES },
  language: { type: String, maxlength: 40 },
  status: { type: String, enum: ['started', 'charged', 'done', 'blocked', 'failed', 'refused'], default: 'started' },
  // ok | blocked_local | blocked_model | check_unavailable | write_failed | no_balance | frozen | ledger | stale | error
  outcome: { type: String, maxlength: 40 },
  reasons: { type: [String], default: undefined }, // rule codes only, never the text
  inFlight: { type: Boolean },
  attempts: { type: Number, default: 0 }, // writing calls started
  checks: { type: Number, default: 0 },   // check calls started
  quarks: { type: Number, default: 0 },
  payerId: { type: String, maxlength: 40 }, // the wallet that paid (the agency pool for a client workspace)
  // quarks and payerId are written BEFORE the charge (the intent); chargedConfirmed turns true once the charge returned.
  // A stale row with chargedConfirmed false is settled from the Quark ledger spend row (ref = this row's id).
  chargedConfirmed: { type: Boolean },
  refunded: { type: Boolean, default: false },
  refundFailed: { type: Boolean },
  // The sweep's retries of a refund that did not land: tries so far, when the next one is due (also the hold while a
  // retry runs), and true once it gave up and a person was alerted.
  refundAttempts: { type: Number },
  refundRetryAt: { type: Date },
  refundGaveUp: { type: Boolean },
  result: { type: resultSchema, default: undefined },
  startedAt: { type: Date, default: Date.now }, // set once, when the row is created
  leaseAt: { type: Date, default: Date.now },   // refreshed at each step; a row is only reaped when this is old
  finishedAt: Date,
  createdAt: { type: Date, default: Date.now, expires: caps.KEEP_DAYS * 24 * 3600 }
}, { collection: 'home_drafts' });

homeDraftSchema.index({ userId: 1, key: 1 }, { unique: true });
// At most one request running per account: a second insert with inFlight true fails on this index.
homeDraftSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { inFlight: true }, name: 'one_in_flight_per_account' });
homeDraftSchema.index({ day: 1, userId: 1 });
homeDraftSchema.index({ userId: 1, createdAt: -1 });
// The background sweep across all accounts: open requests by lease age, and refunds waiting for another try.
homeDraftSchema.index({ leaseAt: 1 }, { partialFilterExpression: { inFlight: true }, name: 'sweep_in_flight' });
homeDraftSchema.index({ refundRetryAt: 1 }, { partialFilterExpression: { refundFailed: true }, name: 'sweep_refund_retry' });

module.exports = mongoose.models.HomeDraft || mongoose.model('HomeDraft', homeDraftSchema);
