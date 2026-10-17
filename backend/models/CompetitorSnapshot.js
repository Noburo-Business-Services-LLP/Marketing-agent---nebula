const mongoose = require('mongoose');

// One weekly reading of a competitor's public Instagram profile. A failed reading is stored too (ok:false) so the
// customer can be told to fix the handle, but it never replaces a good one.
const snapshotSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  competitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Competitor', required: true },
  weekStart: { type: String, required: true },
  takenAt: { type: Date, default: Date.now },
  handle: String,
  ok: { type: Boolean, default: true },
  error: { type: String, maxlength: 200 },
  followers: Number,
  postsInWindow: Number,
  // true when the week's count may be cut short because the read returns only the newest posts
  postsInWindowMayBeTruncated: { type: Boolean, default: false },
  posts30: Number,
  avgLikes: Number,
  avgComments: Number,
  formats: { image: Number, video: Number, carousel: Number },
  // `type` is a key inside topPost, so the subdocument is declared explicitly (a bare nested `type` key is read by
  // Mongoose as the type of the whole path and breaks every save).
  topPost: { type: new mongoose.Schema({ url: String, likes: Number, comments: Number, type: String, caption: String }, { _id: false }), default: null },
  topPostAt: Date,
  hashtags: [String]
}, { collection: 'competitor_snapshots' });

snapshotSchema.index({ competitorId: 1, weekStart: 1 }, { unique: true });
snapshotSchema.index({ userId: 1 });
snapshotSchema.index({ takenAt: 1 });

module.exports = mongoose.models.CompetitorSnapshot || mongoose.model('CompetitorSnapshot', snapshotSchema);
