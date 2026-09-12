const mongoose = require('mongoose');

// A raw idea someone drops in — a thought, an ad they saw, a row from a
// client's spreadsheet — kept separate from Draft. A Draft is a piece of
// content already being generated; an idea is a brief that hasn't become
// one yet, and may never (dismissed, superseded, or just sitting there).
// Turning one into a post reuses the existing single-post generation route
// (POST /api/drafts/generate-image-bg) rather than a second pipeline —
// draftId here just records which Draft came out of which idea.
const contentIdeaSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    text: {
      type: String,
      required: true,
      trim: true
    },
    // An inspiration image — a screenshot of an ad they liked, a poster —
    // passed through as the reference image when the idea is expanded.
    imageUrl: {
      type: String,
      default: ''
    },
    sourceUrl: {
      type: String,
      default: ''
    },
    // When they'd like it posted around, if they said. Advisory only — the
    // scheduler doesn't read this; a CSM uses it when triaging the inbox.
    targetDate: {
      type: Date,
      default: null
    },
    // How this idea entered the system — surfaced in the UI so a bulk-
    // imported row and a one-off typed idea don't look identical.
    source: {
      type: String,
      enum: ['manual', 'bulk_paste', 'bulk_file'],
      default: 'manual'
    },
    status: {
      type: String,
      enum: ['new', 'expanded', 'dismissed'],
      default: 'new',
      index: true
    },
    // Set once "Turn into a post" has created a Draft from this idea.
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Draft',
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ContentIdea', contentIdeaSchema);
