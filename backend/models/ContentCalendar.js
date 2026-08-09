const mongoose = require('mongoose');

const calendarItemSchema = new mongoose.Schema({
  day: { type: Number, required: true, min: 1, max: 31 },
  format: { type: String, default: 'post', trim: true },
  contentPillar: { type: String, default: '', trim: true },
  headline: { type: String, default: '', trim: true },
  creativeConcept: { type: String, default: '', trim: true },
  productNeeded: { type: String, default: '', trim: true },
  shootType: { type: String, default: '', trim: true },
  cta: { type: String, default: '', trim: true },
  objective: { type: String, default: 'awareness', trim: true },
  status: {
    type: String,
    enum: ['draft', 'approved', 'rejected', 'scheduled', 'published', 'generated', 'generating'],
    default: 'draft'
  },
  generatedDraftId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentDraft', default: null },
  generatedCampaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
  // Set when Approve kicks off a background reel build. Holds the
  // videoGenerationQueue job id, which doubles as the Draft's jobId — the
  // wizard resumes from it via /reels?jobId=<this>.
  reelQueueJobId: { type: String, default: '' },
  reelQueuedAt: { type: Date, default: null },
  scheduledFor: { type: Date, default: null }
}, { _id: true });

const calendarWeekSchema = new mongoose.Schema({
  weekNumber: { type: Number, required: true, min: 1, max: 6 },
  items: [calendarItemSchema]
}, { _id: true });

const contentCalendarSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  businessName: { type: String, default: '', trim: true },
  niche: { type: String, default: '', trim: true },
  businessVertical: { type: String, default: '', trim: true },
  businessType: { type: String, default: '', trim: true },
  language: { type: String, default: 'English', trim: true },
  month: { type: String, required: true, trim: true },
  autoGenerate: { type: Boolean, default: false },
  approved: { type: Boolean, default: false },
  weeks: [calendarWeekSchema],
  generatedAt: { type: Date, default: Date.now },
  lastAutoRunAt: { type: Date, default: null }
}, {
  timestamps: true
});

contentCalendarSchema.index({ userId: 1, month: 1 }, { unique: true });
contentCalendarSchema.index({ autoGenerate: 1, approved: 1 });

module.exports = mongoose.model('ContentCalendar', contentCalendarSchema);
