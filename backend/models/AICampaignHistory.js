const mongoose = require('mongoose');

const reusableMetadataSchema = new mongoose.Schema(
  {
    tags: { type: [String], default: [] },
    promptHash: { type: String, default: '', index: true },
    embeddingStatus: {
      type: String,
      enum: ['pending', 'ready', 'skipped', 'failed'],
      default: 'pending'
    },
    embeddingProvider: { type: String, default: null },
    embeddingRef: { type: String, default: null },
    vectorNamespace: { type: String, default: null },
    reuseCount: { type: Number, default: 0 },
    lastReusedAt: { type: Date, default: null }
  },
  { _id: false }
);

const aiCampaignHistorySchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },

    action: {
      type: String,
      enum: ['campaign_generation', 'caption_generation', 'hashtag_generation', 'poster_generation', 'image_generation', 'publish'],
      default: 'campaign_generation',
      index: true
    },
    campaignName: { type: String, default: '' },
    objective: { type: String, default: '' },
    platform: { type: String, default: 'instagram', index: true },
    platforms: { type: [String], default: [] },
    tone: { type: String, default: '' },
    language: { type: String, default: 'English' },
    prompt: { type: String, default: '' },
    userInput: { type: mongoose.Schema.Types.Mixed, default: {} },
    generatedCaptions: { type: [String], default: [] },
    hashtags: { type: [String], default: [] },
    cta: { type: String, default: '' },
    generatedImages: { type: [String], default: [] },
    imagePrompts: { type: [String], default: [] },
    thumbnails: { type: [String], default: [] },
    inventoryReferences: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
        name: { type: String, default: '' },
        category: { type: String, default: '' },
        tags: { type: [String], default: [] }
      }
    ],
    scheduling: { type: mongoose.Schema.Types.Mixed, default: {} },
    aiSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
    sourceResponse: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['generated', 'draft', 'scheduled', 'published', 'failed'],
      default: 'generated',
      index: true
    },
    reusableMetadata: { type: reusableMetadataSchema, default: () => ({}) }
  },
  { collection: 'ai_campaign_history', timestamps: true }
);

aiCampaignHistorySchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
aiCampaignHistorySchema.index({ organizationId: 1, platform: 1, createdAt: -1 });
aiCampaignHistorySchema.index({ organizationId: 1, hashtags: 1 });
aiCampaignHistorySchema.index({ organizationId: 1, tone: 1 });

module.exports = mongoose.model('AICampaignHistory', aiCampaignHistorySchema);
