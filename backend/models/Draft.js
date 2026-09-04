const mongoose = require('mongoose');

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
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'published', 'archived', 'processing', 'completed', 'failed'],
    default: 'draft',
    index: true
  },
  errorMessage: {
    type: String,
    default: ''
  },
  // A carousel is one post made of several ordered images that tell a single
  // story. Kept as a sub-array rather than separate drafts so the slides stay
  // together through approval and scheduling, and so their order survives.
  carouselSlides: [{
    order: { type: Number, required: true },
    // What this slide does in the narrative: hook, build or payoff.
    role: { type: String, default: '' },
    headline: { type: String, default: '' },
    imagePrompt: { type: String, default: '' },
    imageUrl: { type: String, default: '' }
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

// Composite Indexes
draftSchema.index({ userId: 1, status: 1 });
draftSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Draft', draftSchema);
