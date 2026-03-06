const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Don't include password in queries by default
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters'],
    default: ''
  },
  companyName: {
    type: String,
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters'],
    default: ''
  },
  avatar: {
    type: String,
    default: ''
  },
  onboardingCompleted: {
    type: Boolean,
    default: false
  },
  initialCampaignsGenerated: {
    type: Boolean,
    default: false
  },
  businessProfile: {
    name: { type: String, default: '' },
    website: { type: String, default: '' },
    industry: { type: String, default: '' },
    niche: { type: String, default: '' },
    businessType: { type: String, enum: ['B2B', 'B2C', 'Both', ''], default: '' },
    businessLocation: { type: String, default: '' },
    targetAudience: { type: String, default: '' },
    brandVoice: { type: mongoose.Schema.Types.Mixed, default: ['Professional'] }, // Can be string or array
    marketingGoals: [{ type: String }],
    description: { type: String, default: '' },
    competitors: [{ type: String }],
    // Brand assets extracted from website
    brandAssets: {
      logoUrl: { type: String, default: '' },
      ogImage: { type: String, default: '' },
      favicon: { type: String, default: '' },
      brandColors: [{ type: String }],
      images: [{
        src: { type: String },
        alt: { type: String },
        isLogo: { type: Boolean }
      }]
    }
  },
  connectedSocials: [{
    platform: { type: String },
    accountId: { type: String },
    accountName: { type: String },
    accessToken: { type: String },
    refreshToken: { type: String },
    tokenExpiresAt: { type: Date },
    channelData: {
      title: { type: String },
      description: { type: String },
      thumbnailUrl: { type: String },
      subscriberCount: { type: String },
      videoCount: { type: String },
      viewCount: { type: String }
    },
    connectedAt: { type: Date, default: Date.now }
  }],
  subscription: {
    plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
    status: { type: String, enum: ['active', 'cancelled', 'expired'], default: 'active' },
    expiresAt: { type: Date }
  },
  // Ayrshare integration for social media management
  ayrshare: {
    profileKey: { type: String, default: '' },  // User's Ayrshare Profile Key for API calls
    refId: { type: String, default: '' },        // Ayrshare reference ID
    title: { type: String, default: '' },        // Profile title in Ayrshare
    createdAt: { type: Date }                    // When Ayrshare profile was created
  },
  // ICP & Channel Strategy (AI-generated, stored per user)
  icpStrategy: {
    icp: {
      demographics: { type: String, default: '' },
      psychographics: { type: String, default: '' },
      painPoints: [{ type: String }],
      buyingBehavior: { type: String, default: '' },
      onlinePresence: { type: String, default: '' },
      summary: { type: String, default: '' }
    },
    channelStrategy: [{
      platform: { type: String },
      percentage: { type: Number },
      role: { type: String },
      contentTypes: [{ type: String }],
      postFrequency: { type: String }
    }],
    generatedAt: { type: Date }
  },
  // Credits system (demo trial)
  credits: {
    balance: { type: Number, default: 100 },
    totalUsed: { type: Number, default: 0 },
    history: [{
      action: { type: String },
      cost: { type: Number },
      balanceAfter: { type: Number },
      timestamp: { type: Date, default: Date.now }
    }]
  },
  // Email OTP Verification
  isVerified: {
    type: Boolean,
    default: false
  },
  otp: {
    code: { type: String, select: false },
    expiresAt: { type: Date, select: false },
    attempts: { type: Number, default: 0, select: false },
    lastSentAt: { type: Date, select: false }
  },
  lastLoginAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();
  
  // Hash password with cost of 12
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to check if password is correct
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get public profile (without sensitive data)
userSchema.methods.toPublicJSON = function() {
  return {
    _id: this._id,
    email: this.email,
    firstName: this.firstName,
    lastName: this.lastName,
    companyName: this.companyName,
    avatar: this.avatar,
    isVerified: this.isVerified,
    onboardingCompleted: this.onboardingCompleted,
    businessProfile: this.businessProfile,
    connectedSocials: this.connectedSocials?.map(s => ({
      platform: s.platform,
      accountName: s.accountName,
      connectedAt: s.connectedAt
    })),
    subscription: this.subscription,
    credits: this.credits ? {
      balance: this.credits.balance,
      totalUsed: this.credits.totalUsed
    } : undefined,
    createdAt: this.createdAt
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User;
