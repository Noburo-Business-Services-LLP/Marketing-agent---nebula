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

const aiVideoMemorySchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null, index: true },
    jobId: { type: String, default: '', index: true },

    action: {
      type: String,
      enum: ['reel_generation', 'video_prompt', 'scene_generation', 'image_generation', 'clip_generation', 'audio_generation', 'video_merge', 'video_content', 'video_schedule'],
      default: 'reel_generation',
      index: true
    },
    prompt: { type: String, default: '' },
    userInput: { type: mongoose.Schema.Types.Mixed, default: {} },
    script: { type: String, default: '' },
    captions: { type: [String], default: [] },
    hashtags: { type: [String], default: [] },
    cta: { type: String, default: '' },
    scenePrompts: { type: [String], default: [] },
    sceneData: { type: [mongoose.Schema.Types.Mixed], default: [] },
    audioSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
    voiceSettings: { type: mongoose.Schema.Types.Mixed, default: {} },
    language: { type: String, default: 'English' },
    duration: { type: Number, default: null },
    generatedVideos: { type: [String], default: [] },
    generatedImages: { type: [String], default: [] },
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
  { collection: 'ai_video_memory', timestamps: true }
);

aiVideoMemorySchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
aiVideoMemorySchema.index({ organizationId: 1, action: 1, createdAt: -1 });
aiVideoMemorySchema.index({ organizationId: 1, jobId: 1 });
aiVideoMemorySchema.index({ organizationId: 1, 'inventoryReferences.category': 1 });

module.exports = mongoose.model('AIVideoMemory', aiVideoMemorySchema);
