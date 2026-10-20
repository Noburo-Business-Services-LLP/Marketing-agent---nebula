const mongoose = require('mongoose');
const { messageSetter } = require('../services/providerAnswer');

const draftSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  caption: {
    type: String,
    default: ''
  },
  hashtags: [{
    type: String
  }],
  cta: {
    type: String,
    default: ''
  },
  imageUrl: {
    type: String,
    default: ''
  },
  // Clean frame kept before a logo is composited on, so the mark can be
  // swapped or removed without re-generating the artwork.
  imageUrlNoLogo: {
    type: String,
    default: ''
  },
  logoApplied: {
    type: Boolean,
    default: false
  },
  imagePrompt: {
    type: String,
    default: ''
  },
  // The exact text sent to the image model, as opposed to imagePrompt above,
  // which is only the seed description the caller supplied. Surfaced in the UI
  // so you can see why an image came out the way it did.
  // The overlay text the content prompt asked for, kept alongside the caption
  // so the image step and the UI agree on what was actually requested.
  imageText: {
    type: String,
    default: ''
  },
  // What the Creative Director decided before any image was rendered — the
  // concept it chose and the visual treatment it picked. Shown in the UI so
  // a weak result can be traced to a decision, not just a picture, and read
  // back on the next generation so the account does not keep landing on the
  // same idea.
  creativeConcept: {
    type: String,
    default: ''
  },
  visualTreatment: {
    type: String,
    default: ''
  },
  imagePromptResolved: {
    type: String,
    default: ''
  },
  platforms: [{
    type: String
  }],
  language: {
    type: String,
    default: 'English'
  },
  // Set only on a language version made from another draft (Stage 1 localisation): the id of the
  // original draft. `language` then holds the base language code, for example 'kannada'.
  languageVariantOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Draft',
    default: null
  },
  tone: {
    type: String,
    default: ''
  },
  objective: {
    type: String,
    default: ''
  },
  scheduledDate: {
    type: Date,
    default: null
  },
  // 'approved' = the customer said yes and it waits to be scheduled or posted. 'binned' = in the Bin: restorable for
  // 14 days (binnedAt, binnedFrom), then removed for good by services/binPurge.js. 'archived' is restorable any time.
  status: {
    type: String,
    enum: ['draft', 'approved', 'scheduled', 'published', 'archived', 'binned', 'processing', 'completed', 'failed'],
    default: 'draft',
    index: true
  },
  // Who made it: 'manual' (the customer, by hand) or 'automation' (weekly plan, calendar auto-generation). Only
  // automation posts must be approved before they can be posted or scheduled. No default on purpose: old rows have
  // none and are read through services/draftStatus.js originOf (calendar-made rows are automation, others manual).
  origin: {
    type: String,
    enum: ['manual', 'automation']
  },
  // The day the plan meant it to go out (automation posts). Approving schedules it for this date when it is ahead.
  plannedDate: { type: Date, default: null },
  approvedAt: { type: Date, default: null },
  // Set when the scheduler (or publish) sends it: when, and to which platforms.
  publishedAt: { type: Date, default: null },
  publishedPlatforms: [{ type: String }],
  binnedAt: { type: Date, default: null },
  binnedFrom: { type: String, default: '' },
  archivedFrom: { type: String, default: '' },
  errorMessage: {
    type: String,
    default: '',
    set: messageSetter
  },
  // A carousel is one post made of several ordered images that tell a single
  // story. Kept as a sub-array rather than separate drafts so the slides stay
  // together through approval and scheduling, and so their order survives.
  carouselSlides: [{
    order: { type: Number, required: true },
    // What this slide does in the narrative: hook, build or payoff.
    role: { type: String, default: '' },
    headline: { type: String, default: '' },
    // What this slide needs to make the audience understand or feel, from
    // the master plan — distinct from headline, which is the on-image text.
    storyPurpose: { type: String, default: '' },
    imagePrompt: { type: String, default: '' },
    // The text actually rendered on this slide's image. headline doubled as
    // this before the master-plan flow existed; now the plan writes both
    // separately, so they are stored separately.
    imageText: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    creativeConcept: { type: String, default: '' },
    visualTreatment: { type: String, default: '' }
  }],
  // The look every slide in a carousel shares. Held on the draft so a later
  // regeneration of one slide can match the others instead of drifting.
  carouselStyleGuide: {
    type: String,
    default: ''
  },
  sourceType: {
    type: String,
    enum: ['campaign', 'post', 'reel', 'calendar', 'carousel'],
    required: true
  },
  contentType: {
    type: String,
    enum: ['campaign', 'post', 'reel', 'carousel'],
    default: 'campaign',
    index: true
  },
  contentCalendarId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ContentCalendar',
    default: null
  },
  calendarWeek: {
    type: Number,
    default: null
  },
  calendarDay: {
    type: Number,
    default: null
  },
  // A short label that ties posts together by subject: a festival, an offer, a launch ("Diwali", "Monsoon sale").
  theme: {
    type: String,
    trim: true,
    maxlength: 60,
    default: ''
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    default: null
  },
  creative: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  generationProgress: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// A picture written as base64 is stored and replaced by its link (D102; never fails the write).
draftSchema.plugin(require('./plugins/inlineImages').inlineImagesPlugin, { paths: ['imageUrl', 'imageUrlNoLogo', 'creative', 'carouselSlides'] });

// Composite Indexes
draftSchema.index({ userId: 1, status: 1 });
draftSchema.index({ userId: 1, createdAt: -1 });
// One version per language per original draft, even if two requests arrive together.
draftSchema.index(
  { userId: 1, languageVariantOf: 1, language: 1 },
  { unique: true, partialFilterExpression: { languageVariantOf: { $type: 'objectId' } } }
);

// Indexes for the staff Usage page. Skipped by automatic index builds; created on purpose by scripts/create-staff-indexes.js.
require('../config/staffIndexes').declareStaffIndexes(draftSchema, 'Draft');

module.exports = mongoose.model('Draft', draftSchema);
