const mongoose = require('mongoose');

const platformResultSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'skipped'],
      default: 'pending'
    },
    message: { type: String, default: '' },
    externalAdId: { type: String, default: '' },
    errorCode: { type: String, default: '' },
    currency: { type: String, default: '' }
  },
  { _id: false }
);

const adCampaignSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true
    },
    adTitle: {
      type: String,
      required: true,
      trim: true
    },
    adDescription: {
      type: String,
      default: '',
      trim: true
    },
    adCreativeUrl: {
      type: String,
      default: '',
      trim: true
    },
    platformSelection: {
      type: String,
      enum: ['meta', 'google', 'both'],
      required: true
    },
    budget: {
      amount: { type: Number, required: true, min: 0.01 },
      currency: { type: String, required: true, uppercase: true, trim: true }
    },
    schedule: {
      startDate: { type: Date, required: true },
      endDate: { type: Date, required: true }
    },
    status: {
      type: String,
      enum: ['active', 'paused', 'failed', 'partial', 'scheduled'],
      default: 'scheduled'
    },
    platformStatus: {
      meta: { type: platformResultSchema, default: () => ({ status: 'skipped', message: 'Not selected' }) },
      google: { type: platformResultSchema, default: () => ({ status: 'skipped', message: 'Not selected' }) }
    },
    sourcePostIds: {
      facebook: { type: String, default: '' },
      instagram: { type: String, default: '' }
    },
    cta: {
      type: {
        type: String,
        default: 'LEARN_MORE'
      },
      link: { type: String, default: '' },
      sourcePlatform: {
        type: String,
        enum: ['', 'facebook', 'instagram'],
        default: ''
      }
    },
    sourceProfileUrls: {
      facebook: { type: String, default: '' },
      instagram: { type: String, default: '' }
    },
    performance: {
      clicks: { type: Number, default: 0 },
      impressions: { type: Number, default: 0 },
      ctr: { type: Number, default: 0 },
      spend: { type: Number, default: 0 }
    },
    notes: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

adCampaignSchema.index({ userId: 1, createdAt: -1 });
adCampaignSchema.index({ userId: 1, campaignId: 1, createdAt: -1 });
adCampaignSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AdCampaign', adCampaignSchema);
