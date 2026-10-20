const mongoose = require('mongoose');

// One row per Photoshoot press: a pack ("Create photos") or one photo made again ("Make this one again"). It is the
// durable ledger of the job: written BEFORE the charge, each photo's call is counted on it (attempts) BEFORE the call is
// made, so a crash can never lead to an unrecorded paid call; it carries the idempotency key (a double click is one
// job), the one-job-at-a-time lock (`inFlight`, unique per account while true), the runner's lease (only the holder may
// start a call; a lost runner's job is taken over after the lease runs out) and the refund flag that makes the refund
// happen once. The prompt is kept for support and never sent to the page. How it works: docs/superpowers/ops/photoshoot.md
const photoSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  productIndex: { type: Number, default: 0 },
  scene: { type: String, maxlength: 40 },
  sceneLabel: { type: String, maxlength: 60 },
  inPlace: { type: Boolean, default: false },
  prompt: { type: String, maxlength: 4000 },
  status: { type: String, enum: ['pending', 'calling', 'done', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 }, // calls started for this photo (counted before each call)
  reason: { type: String, maxlength: 40 }, // why it failed, a code only
  url: { type: String, maxlength: 600 },
  inLibrary: { type: Boolean, default: true },
  deleted: { type: Boolean }, // the customer deleted this photo: its link is removed and it is never listed again
  startedAt: Date,
  finishedAt: Date
}, { _id: false });

const productSnap = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: { type: String, maxlength: 100 },
  imageUrl: { type: String }, // the product's own photo (a link, or the data URL the product record holds)
  extraUrl: { type: String }  // a second photo of the same product, when it has one
}, { _id: false });

const photoshootJobSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true, maxlength: 64 },
  kind: { type: String, enum: ['pack', 'redo'], default: 'pack' },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'PhotoshootJob' },
  parentIndex: { type: Number },
  pack: { type: String, required: true, maxlength: 40 },
  day: { type: String, required: true }, // India day, YYYY-MM-DD
  aspectRatio: { type: String, maxlength: 8 },
  background: { type: String, maxlength: 20 },
  count: { type: Number }, // photos per product
  products: { type: [productSnap], default: [] },
  place: { type: new mongoose.Schema({ assetId: mongoose.Schema.Types.ObjectId, name: String, url: String }, { _id: false }), default: undefined },
  photos: { type: [photoSchema], default: [] },
  status: { type: String, enum: ['queued', 'running', 'done', 'partial', 'failed', 'refused'], default: 'queued' },
  // ok | partial | none | no_balance | frozen | ledger | switched_off | stale | error
  outcome: { type: String, maxlength: 40 },
  inFlight: { type: Boolean },
  photoCount: { type: Number, default: 0 },
  quarksPerPhoto: { type: Number, default: 0 },
  quarks: { type: Number, default: 0 },
  payerId: { type: String, maxlength: 40 }, // the wallet that paid (the agency pool for a client workspace)
  refunded: { type: Boolean, default: false },
  refundedQuarks: { type: Number, default: 0 },
  refundFailed: { type: Boolean },
  // The resume loop's retries of a refund that did not land: tries so far, when the next one is due (also the hold
  // while a retry runs), and true once it gave up and a person was alerted.
  refundAttempts: { type: Number },
  refundRetryAt: { type: Date },
  refundGaveUp: { type: Boolean },
  leaseOwner: { type: String, maxlength: 80 },
  leaseUntil: { type: Date },
  chargedAt: Date,
  finishedAt: Date,
  createdAt: { type: Date, default: Date.now }
}, { collection: 'photoshoot_jobs' });

photoshootJobSchema.index({ user: 1, key: 1 }, { unique: true });
// At most one photoshoot running per account: a second row with inFlight true fails on this index.
photoshootJobSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { inFlight: true }, name: 'one_in_flight_per_account' });
photoshootJobSchema.index({ user: 1, createdAt: -1 });
photoshootJobSchema.index({ user: 1, day: 1 });
photoshootJobSchema.index({ status: 1, leaseUntil: 1 });
photoshootJobSchema.index({ parent: 1 });
// Refunds waiting for another try (the resume loop).
photoshootJobSchema.index({ refundRetryAt: 1 }, { partialFilterExpression: { refundFailed: true }, name: 'refund_retry' });

module.exports = mongoose.models.PhotoshootJob || mongoose.model('PhotoshootJob', photoshootJobSchema);
