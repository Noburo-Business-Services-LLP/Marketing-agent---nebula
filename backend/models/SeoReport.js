const mongoose = require('mongoose');

const seoReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reportType: {
    type: String,
    enum: ['keyword_research', 'metadata', 'hashtags', 'competitor_analysis', 'dashboard'],
    required: true,
    index: true
  },
  query: {
    type: String,
    required: true,
    trim: true
  },
  inputs: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  scores: {
    seo: { type: Number, default: 0 },
    content: { type: Number, default: 0 },
    hashtag: { type: Number, default: 0 },
    competitor: { type: Number, default: 0 }
  },
  output: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  recommendations: [String],
  provider: {
    type: String,
    default: 'gemini'
  }
}, {
  timestamps: true
});

seoReportSchema.index({ userId: 1, reportType: 1, createdAt: -1 });

module.exports = mongoose.model('SeoReport', seoReportSchema);
