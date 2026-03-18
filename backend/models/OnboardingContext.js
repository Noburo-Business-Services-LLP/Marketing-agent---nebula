/**
 * OnboardingContext Model
 * 
 * Stores comprehensive company context collected during onboarding.
 * This data is critical for AI-powered outreach generation.
 * The Reachouts system depends on this being complete before generating any content.
 */

const mongoose = require('mongoose');

const onboardingContextSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  
  // Company Information
  company: {
    name: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true
    },
    website: {
      type: String,
      trim: true,
      default: ''
    },
    industry: {
      type: String,
      required: [true, 'Industry is required'],
      trim: true
    },
    description: {
      type: String,
      required: [true, 'Product/service description is required'],
      trim: true,
      maxlength: 2000
    }
  },
  
  // Target Customer (ICP - Ideal Customer Profile)
  targetCustomer: {
    description: {
      type: String,
      required: [true, 'Target customer description is required'],
      trim: true
    },
    roles: [{
      type: String,
      trim: true
    }],
    companySize: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+', 'any'],
      default: 'any'
    },
    industries: [{
      type: String,
      trim: true
    }]
  },
  
  // Geography
  geography: {
    regions: [{
      type: String,
      trim: true
    }],
    countries: [{
      type: String,
      trim: true
    }],
    businessLocation: {
      type: String,
      trim: true,
      default: ''
    },
    isGlobal: {
      type: Boolean,
      default: false
    }
  },
  
  // Pricing
  pricing: {
    range: {
      type: String,
      trim: true,
      default: ''
    },
    model: {
      type: String,
      enum: ['subscription', 'one-time', 'usage-based', 'freemium', 'enterprise', 'custom', ''],
      default: ''
    },
    currency: {
      type: String,
      default: 'USD'
    }
  },
  
  // Business Goals
  primaryGoal: {
    type: String,
    enum: ['leads', 'demos', 'sales', 'partnerships', 'awareness', 'signups'],
    required: [true, 'Primary goal is required']
  },
  secondaryGoals: [{
    type: String,
    enum: ['leads', 'demos', 'sales', 'partnerships', 'awareness', 'signups']
  }],
  
  // Brand Voice & Messaging (supports multiple tones)
  brandTone: {
    type: mongoose.Schema.Types.Mixed, // Can be string or array of strings
    default: ['professional']
  },
  
  // Value Proposition
  valueProposition: {
    main: {
      type: String,
      trim: true,
      default: ''
    },
    keyBenefits: [{
      type: String,
      trim: true
    }],
    differentiators: [{
      type: String,
      trim: true
    }]
  },
  
  // Competitors (optional)
  competitors: [{
    name: {
      type: String,
      trim: true
    },
    website: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      trim: true
    }
  }],
  
  // Outreach Preferences
  outreachPreferences: {
    preferredChannels: [{
      type: String,
      enum: ['email', 'linkedin', 'phone', 'twitter']
    }],
    emailSignature: {
      type: String,
      trim: true,
      default: ''
    },
    calendarLink: {
      type: String,
      trim: true,
      default: ''
    },
    responseTimeExpectation: {
      type: String,
      enum: ['immediate', 'same-day', '24-hours', '48-hours', 'flexible'],
      default: 'flexible'
    }
  },
  
  // Completion tracking
  completionStatus: {
    isComplete: {
      type: Boolean,
      default: false
    },
    completedAt: {
      type: Date
    },
    missingFields: [{
      type: String
    }]
  }
  
}, {
  timestamps: true
});

// Method to check if context is complete enough for AI generation
onboardingContextSchema.methods.isReadyForOutreach = function() {
  const requiredFields = [
    this.company?.name,
    this.company?.industry,
    this.company?.description,
    this.targetCustomer?.description,
    this.primaryGoal,
    this.brandTone
  ];
  
  const missingFields = [];
  
  if (!this.company?.name) missingFields.push('company.name');
  if (!this.company?.industry) missingFields.push('company.industry');
  if (!this.company?.description) missingFields.push('company.description');
  if (!this.targetCustomer?.description) missingFields.push('targetCustomer.description');
  if (!this.primaryGoal) missingFields.push('primaryGoal');
  if (!this.brandTone) missingFields.push('brandTone');
  
  return {
    isReady: missingFields.length === 0,
    missingFields
  };
};

// Method to update completion status
onboardingContextSchema.methods.updateCompletionStatus = function() {
  const { isReady, missingFields } = this.isReadyForOutreach();
  this.completionStatus.isComplete = isReady;
  this.completionStatus.missingFields = missingFields;
  if (isReady && !this.completionStatus.completedAt) {
    this.completionStatus.completedAt = new Date();
  }
  return isReady;
};

// Pre-save hook to update completion status
onboardingContextSchema.pre('save', function(next) {
  this.updateCompletionStatus();
  next();
});

// Static method to get or create context for a user
onboardingContextSchema.statics.getOrCreate = async function(userId) {
  let context = await this.findOne({ userId });
  if (!context) {
    context = new this({ userId });
    await context.save();
  }
  return context;
};

const OnboardingContext = mongoose.model('OnboardingContext', onboardingContextSchema);

module.exports = OnboardingContext;
