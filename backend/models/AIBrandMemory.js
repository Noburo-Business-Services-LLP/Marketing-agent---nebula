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
    // Layer 2 of the memory system: a small, curated, human-readable set of
    // notes distilled from real published-post performance (AIContentPerformance)
    // by the weekly distillation job. This — never the raw performance log —
    // is what gets read into generation prompts and shown on the AI Memory
    // page. See docs/superpowers/specs/2026-09-08-ai-memory-unification-design.md.
    learnedNotes: [
      {
        text: { type: String, required: true, trim: true },
        category: {
          type: String,
          enum: ['copy', 'hashtags', 'cta', 'visual', 'timing', 'format'],
          default: 'copy'
        },
        sourceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AIContentPerformance' }],
        confidence: { type: Number, default: 0.5, min: 0, max: 1 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
      }
    ],
    learnedNotesUpdatedAt: { type: Date, default: null },
    rawProfile: { type: mongoose.Schema.Types.Mixed, default: {} },
    reusableMetadata: { type: reusableMetadataSchema, default: () => ({ source: 'brand_memory' }) }
  },
  { collection: 'ai_brand_memory', timestamps: true }
);

aiBrandMemorySchema.index({ organizationId: 1, userId: 1 }, { unique: true });
aiBrandMemorySchema.index({ organizationId: 1, 'inventoryPatterns.category': 1 });
aiBrandMemorySchema.index({ updatedAt: -1 });

module.exports = mongoose.model('AIBrandMemory', aiBrandMemorySchema);
