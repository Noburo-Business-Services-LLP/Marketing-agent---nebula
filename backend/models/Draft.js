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
    enum: ['draft', 'scheduled', 'published', 'archived'],
    default: 'draft',
    index: true
  },
  sourceType: {
    type: String,
    enum: ['campaign', 'post', 'reel', 'calendar'],
    required: true
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
