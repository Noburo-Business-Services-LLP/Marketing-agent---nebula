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
  sourceType: {
    type: String,
    enum: ['campaign', 'post', 'reel', 'calendar'],
    required: true
  },
  contentType: {
    type: String,
    enum: ['campaign', 'post', 'reel'],
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
