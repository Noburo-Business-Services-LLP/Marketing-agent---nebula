const mongoose = require('mongoose');

const reusableMetadataSchema = new mongoose.Schema(
  {
    tags: { type: [String], default: [] },
    confidence: { type: Number, default: 0 },
    source: { type: String, default: 'system' },
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

const aiBrandMemorySchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    brandName: { type: String, default: '' },
    tone: { type: String, default: 'professional', index: true },
    writingStyle: { type: String, default: '' },
    audienceStyle: { type: String, default: '' },
    ctaStyle: { type: String, default: '' },
    visualStyle: { type: String, default: '' },
    colors: {
      primary: { type: String, default: '' },
      secondary: { type: String, default: '' },
      palette: { type: [String], default: [] }
    },
    preferredHashtags: { type: [String], default: [] },
    avoidedTerms: { type: [String], default: [] },
    promptFragments: { type: [String], default: [] },
    successfulPatterns: {
      captions: { type: [String], default: [] },
      ctas: { type: [String], default: [] },
      sceneStyles: { type: [String], default: [] },
      hashtags: { type: [String], default: [] }
    },
    inventoryPatterns: [
      {
        category: { type: String, default: '', index: true },
        tone: { type: String, default: '' },
        hashtags: { type: [String], default: [] },
        ctas: { type: [String], default: [] },
        visualStyle: { type: String, default: '' },
        examples: { type: [String], default: [] }
      }
    ],
    rawProfile: { type: mongoose.Schema.Types.Mixed, default: {} },
    reusableMetadata: { type: reusableMetadataSchema, default: () => ({ source: 'brand_memory' }) }
  },
  { collection: 'ai_brand_memory', timestamps: true }
);

aiBrandMemorySchema.index({ organizationId: 1, userId: 1 }, { unique: true });
aiBrandMemorySchema.index({ organizationId: 1, 'inventoryPatterns.category': 1 });
aiBrandMemorySchema.index({ updatedAt: -1 });

module.exports = mongoose.model('AIBrandMemory', aiBrandMemorySchema);
