const mongoose = require('mongoose');

const aiContentPerformanceSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
    campaignMemoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'AICampaignHistory', default: null },
    videoMemoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'AIVideoMemory', default: null },

    platform: { type: String, default: 'instagram', index: true },
    postId: { type: String, default: '', index: true },
    contentType: { type: String, default: 'post' },
    caption: { type: String, default: '' },
    hashtags: { type: [String], default: [] },
    cta: { type: String, default: '' },
    tone: { type: String, default: '' },
    language: { type: String, default: 'English' },
    inventoryReferences: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
        name: { type: String, default: '' },
        category: { type: String, default: '' },
        tags: { type: [String], default: [] }
      }
    ],
    assets: {
      images: { type: [String], default: [] },
      videos: { type: [String], default: [] },
      thumbnails: { type: [String], default: [] }
    },
    metrics: {
      likes: { type: Number, default: 0 },
      views: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      saves: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      impressions: { type: Number, default: 0 },
      reach: { type: Number, default: 0 },
      ctr: { type: Number, default: 0 },
      engagement: { type: Number, default: 0 },
      engagementRate: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      spend: { type: Number, default: 0 }
    },
    learning: {
      score: { type: Number, default: 0, index: true },
      tier: {
        type: String,
        enum: ['unknown', 'low', 'average', 'high', 'winner'],
        default: 'unknown',
        index: true
      },
      winningHashtags: { type: [String], default: [] },
      winningTone: { type: String, default: '' },
      winningCTA: { type: String, default: '' },
      winningSceneStyles: { type: [String], default: [] },
      notes: { type: [String], default: [] },
      learnedAt: { type: Date, default: null }
    },
    rawAnalytics: { type: mongoose.Schema.Types.Mixed, default: {} },
    publishedAt: { type: Date, default: null },
    measuredAt: { type: Date, default: Date.now }
  },
  { collection: 'ai_content_performance', timestamps: true }
);

aiContentPerformanceSchema.index({ organizationId: 1, userId: 1, measuredAt: -1 });
aiContentPerformanceSchema.index({ organizationId: 1, platform: 1, 'learning.score': -1 });
aiContentPerformanceSchema.index({ organizationId: 1, hashtags: 1 });
aiContentPerformanceSchema.index({ organizationId: 1, 'inventoryReferences.category': 1 });
aiContentPerformanceSchema.index({ organizationId: 1, postId: 1, platform: 1 });

module.exports = mongoose.model('AIContentPerformance', aiContentPerformanceSchema);
