const mongoose = require('mongoose');

/**
 * CachedCampaign Schema
 * Stores AI-generated campaign suggestions to avoid regeneration
 * Campaigns are cached per user and expire after 24 hours
 */
const cachedCampaignSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Campaign data
  campaignId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  tagline: String,
  objective: {
    type: String,
    enum: ['awareness', 'engagement', 'traffic', 'sales', 'conversion', 'trust', 'authority'],
    default: 'awareness'
  },
  platform: {
    type: String,
    default: 'instagram'
  },
  platforms: [String],
  description: String,
  caption: {
    type: String,
    required: true
  },
  hashtags: [String],
  imageUrl: String,
  imageSearchQuery: String,
  
  // Timing and reach
  bestPostTime: String,
  estimatedReach: String,
  duration: String,
  
  // Budget
  estimatedBudget: {
    min: Number,
    max: Number,
    currency: { type: String, default: 'USD' }
  },
  
  // Additional content ideas
  contentIdeas: [String],
  
  // Business context (for cache invalidation on profile changes)
  businessProfileHash: {
    type: String,
    index: true
  },
  
  // Cache metadata
  generatedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    index: true
  },
  
  // Track if user interacted with this campaign
  status: {
    type: String,
    enum: ['suggested', 'viewed', 'saved', 'edited', 'posted', 'dismissed'],
    default: 'suggested'
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
cachedCampaignSchema.index({ userId: 1, businessProfileHash: 1, expiresAt: 1 });

// TTL index - MongoDB automatically deletes expired documents
// Note: expiresAt already has an index from the schema definition, TTL will use that

// Static method to get cached campaigns for a user
cachedCampaignSchema.statics.getCachedForUser = async function(userId, businessProfileHash, count = 6) {
  const now = new Date();
  
  const campaigns = await this.find({
    userId,
    businessProfileHash,
    expiresAt: { $gt: now },
    status: { $in: ['suggested', 'viewed'] } // Don't return dismissed ones
  })
  .sort({ generatedAt: -1 })
  .limit(count);
  
  return campaigns;
};

// Static method to save new campaigns
cachedCampaignSchema.statics.saveCampaigns = async function(userId, businessProfileHash, campaigns) {
  // First, mark old suggestions as dismissed (don't delete to keep history)
  await this.updateMany(
    { userId, status: 'suggested' },
    { $set: { status: 'dismissed' } }
  );
  
  // Save new campaigns
  const validObjectives = ['awareness', 'engagement', 'traffic', 'sales', 'conversion', 'trust', 'authority'];
  
  const docs = campaigns.map(camp => {
    // Sanitize objective - AI sometimes returns "awareness|engagement|sales" instead of single value
    let objective = (camp.objective || 'awareness').toLowerCase().trim();
    if (objective.includes('|')) {
      objective = objective.split('|')[0].trim(); // Take first one
    }
    if (!validObjectives.includes(objective)) {
      objective = 'awareness'; // Default fallback
    }
    
    return {
      userId,
      businessProfileHash,
      campaignId: camp.id || camp.campaignId,
      name: camp.name || camp.title,
      tagline: camp.tagline,
      objective,
      platform: camp.platforms?.[0] || camp.platform || 'instagram',
      platforms: camp.platforms || [camp.platform || 'instagram'],
      description: camp.description,
      caption: camp.caption,
      hashtags: camp.hashtags || [],
      imageUrl: camp.imageUrl,
      imageSearchQuery: camp.imageSearchQuery,
      bestPostTime: camp.bestPostTime,
      estimatedReach: camp.expectedReach || camp.estimatedReach,
      duration: camp.duration,
      estimatedBudget: camp.estimatedBudget,
      contentIdeas: camp.contentIdeas || [],
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };
  });
  
  return this.insertMany(docs);
};

// Static method to invalidate cache for a user
cachedCampaignSchema.statics.invalidateCache = async function(userId) {
  return this.deleteMany({ userId, status: 'suggested' });
};

// Helper to create a hash of business profile for cache invalidation
cachedCampaignSchema.statics.createProfileHash = function(businessProfile) {
  if (!businessProfile) return 'default';
  
  const key = [
    businessProfile.name,
    businessProfile.industry,
    businessProfile.niche,
    businessProfile.targetAudience,
    businessProfile.brandVoice,
    (businessProfile.marketingGoals || []).sort().join(',')
  ].join('|');
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
};

module.exports = mongoose.model('CachedCampaign', cachedCampaignSchema);
