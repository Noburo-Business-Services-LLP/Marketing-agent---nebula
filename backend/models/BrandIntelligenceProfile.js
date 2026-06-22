const mongoose = require('mongoose');

const pastPostSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ['uploaded', 'campaign_history'],
      default: 'uploaded'
    },
    platform: {
      type: String,
      default: 'instagram'
    },
    caption: {
      type: String,
      default: ''
    },
    imageUrl: {
      type: String,
      default: ''
    },
    cloudinaryPublicId: {
      type: String,
      default: ''
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null
    },
    postedAt: {
      type: Date,
      default: null
    }
  },
  { _id: true }
);

const brandIntelligenceProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },

    brandName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120
    },
    brandDescription: {
      type: String,
      default: '',
      trim: true,
      maxlength: 4000
    },

    assets: {
      primaryLogoUrl: { type: String, default: '' },
      primaryColor: { type: String, default: '' },
      secondaryColor: { type: String, default: '' },
      fontType: { type: String, default: '' }
    },

    detectedProfile: {
      tone: { type: String, default: 'professional' },
      writingStyle: { type: String, default: 'formal' },
      ctaStyle: { type: String, default: 'balanced' },
      visualStyle: { type: String, default: 'clean-minimal' }
    },

    customProfile: {
      tone: { type: String, default: '' },
      writingStyle: { type: String, default: '' },
      ctaStyle: { type: String, default: '' },
      visualStyle: { type: String, default: '' }
    },

    confidence: {
      tone: { type: Number, default: 0.2 },
      writingStyle: { type: Number, default: 0.2 },
      ctaStyle: { type: Number, default: 0.2 },
      visualStyle: { type: Number, default: 0.2 },
      overall: { type: Number, default: 0.2 }
    },

    patterns: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    pastPosts: {
      type: [pastPostSchema],
      default: []
    },

    enforcementMode: {
      type: String,
      enum: ['strict', 'adaptive', 'off'],
      default: 'strict'
    },

    hasBrandAssets: {
      type: Boolean,
      default: false
    },
    hasPastPosts: {
      type: Boolean,
      default: false
    },
    isUserCustomized: {
      type: Boolean,
      default: false
    },

    lastAnalyzedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

brandIntelligenceProfileSchema.index({ userId: 1 }, { unique: true });
brandIntelligenceProfileSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('BrandIntelligenceProfile', brandIntelligenceProfileSchema);
