const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { BASE_LANGUAGES, MAX_ADDITIONAL_LANGUAGES } = require('../services/languageSupport');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  // The mailbox with "+tag" and Gmail dots removed, so one person cannot open many accounts from one address.
  emailKey: { type: String, index: true, sparse: true, select: false },
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
  mobileNumber: {
    type: String,
    default: ''
  },
  isHidden: {
    type: Boolean,
    default: false
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
    gstNumber: { type: String, default: '' },
    industry: { type: String, default: '' }, // Business vertical
    problemSolved: { type: String, default: '' }, // What problem the business solves
    niche: { type: String, default: '' },
    businessType: { type: String, enum: ['B2B', 'B2C', 'Both', ''], default: '' },
    businessLocation: { type: String, default: '' },
    targetAudience: { type: String, default: '' },
    brandVoice: { type: mongoose.Schema.Types.Mixed, default: ['Professional'] }, // Can be string or array
    marketingGoals: [{ type: String }],
    description: { type: String, default: '' },
    competitors: [{ type: String }],

    // Customer-filled during onboarding
    yearsInBusiness: { type: Number, min: 0, default: null },
    brandMaturity: { type: String, enum: ['established', 'growing', ''], default: '' },

    // About the customers and the offer. Filled by the customer in Settings; a CSM can also fill them.
    targetCustomerProfile: { type: String, default: '' },
    targetGender: { type: String, enum: ['mostly_men', 'mostly_women', 'both_equally', 'families', ''], default: '' },
    // Old single answer, kept so saved profiles still load. 'reachAreas' below is the one to use now.
    geographicReach: { type: String, enum: ['hyperlocal', 'local_city', 'regional', 'state', 'national', 'international', ''], default: '' },
    // Where the customers are: any mix of these.
    reachAreas: { type: [{ type: String, enum: ['neighbourhood', 'city', 'state', 'india', 'international'] }], default: [] },
    // For businesses that sell to other businesses (businessType B2B or Both).
    b2b: {
      companySize: { type: String, enum: ['solo', 'small', 'medium', 'large', ''], default: '' },
      decisionMaker: { type: String, default: '' },
      salesCycle: { type: String, enum: ['days', 'weeks', 'months', ''], default: '' }
    },
    customerType: { type: String, enum: ['mostly_new', 'mix_new_repeat', 'mostly_loyal', ''], default: '' },
    pricePositioning: { type: String, enum: ['budget', 'affordable', 'mid_range', 'premium', 'luxury', ''], default: '' },
    keyDifferentiator: { type: String, default: '' },
    brandStory: { type: String, default: '' },
    heroProduct: { type: String, default: '' },
    // Regional languages, each usable on its own or blended with English.
    // Previously Tamil was the only option, so anyone else had no way to say
    // what language their content should be in.
    contentLanguage: {
      type: String,
      enum: [
        '', 'english',
        'tamil', 'telugu', 'hindi', 'kannada', 'malayalam', 'marathi',
        'bengali', 'gujarati', 'punjabi', 'odia', 'urdu',
        'tamil_english_mix', 'telugu_english_mix', 'hindi_english_mix',
        'kannada_english_mix', 'malayalam_english_mix', 'marathi_english_mix',
        'bengali_english_mix', 'gujarati_english_mix', 'punjabi_english_mix',
        'odia_english_mix', 'urdu_english_mix'
      ],
      default: ''
    },
    // Extra languages each post can be turned into, as separate drafts.
    // Base codes only (no English mix), at most three, never the primary's base.
    additionalLanguages: {
      type: [{ type: String, enum: BASE_LANGUAGES }],
      default: [],
      validate: {
        validator: (list) => !Array.isArray(list) || list.length <= MAX_ADDITIONAL_LANGUAGES,
        message: 'At most three extra languages can be added.'
      }
    },
    contentRestrictions: { type: String, default: '' },
    firstMonthContentAngles: { type: String, default: '' },

    // How much content the AI monthly planner should generate. Forward-only:
    // changing this reshapes next month's plan, never the current one — a
    // CSM may already be mid-review on this month's posts, and rewriting a
    // plan out from under them is worse than waiting a cycle.
    contentCadence: {
      postsPerDay: { type: Number, min: 1, max: 5, default: 1 },
      reelsPerWeek: { type: Number, min: 0, max: 7, default: 1 }
    },

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
      }],
      // ElevenLabs voices the user has starred as favourites. Persisted
      // so future videos can pre-select the user's preferred narrator
      // without re-picking from the full ElevenLabs catalog every time.
      favouriteVoices: [{
        voiceId: { type: String, required: true },
        name: { type: String, default: '' },
        gender: { type: String, default: '' },
        language: { type: String, default: '' },
        accent: { type: String, default: '' },
        previewUrl: { type: String, default: '' },
        category: { type: String, default: '' },
        addedAt: { type: Date, default: Date.now }
      }],
      // Audio tracks (voice recordings + AI-composed music) the user
      // has starred as favourites. Persisted so future videos can
      // reuse them without re-generating from scratch.
      favouriteAudioTracks: [{
        url: { type: String, required: true },
        kind: { type: String, enum: ['voice', 'music', 'mix'], default: 'music' },
        label: { type: String, default: '' },
        prompt: { type: String, default: '' },
        durationSeconds: { type: Number, default: 0 },
        languageCode: { type: String, default: '' },
        voiceId: { type: String, default: '' },
        addedAt: { type: Date, default: Date.now }
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
  // Agreement to the Terms and the Privacy Policy given at sign-up: when, and to which version of each.
  consent: {
    termsVersion: { type: String, default: '' },
    privacyVersion: { type: String, default: '' },
    acceptedAt: { type: Date },
    source: { type: String, default: '' }
  },
  // Privacy: a pending request to delete the account (it is erased after the waiting period unless restored),
  // and when data was last exported (one export a day).
  deletion: {
    status: { type: String, enum: ['', 'pending'], default: '' },
    requestedAt: { type: Date },
    purgeAfter: { type: Date }
  },
  privacy: {
    lastExportAt: { type: Date }
  },
  // The plan the system makes from the business profile: when a run last started, when the customer last refreshed it
  // (once a week), and how the first one is going.
  planState: {
    lastStartedAt: { type: Date },
    startingAt: { type: Date },
    lastRefreshAt: { type: Date },
    firstPlanFailedAt: { type: Date },
    attempts: { type: Number, default: 0 }
  },
  // Setup progress that cannot be read off the account itself: when the plan was first opened, and the first approved week.
  setup: {
    planOpenedAt: { type: Date },
    firstWeekApprovedAt: { type: Date }
  },
  // Guided tour progress: finished or skipped once (never overwritten), the last step seen, and how often it was replayed.
  tour: {
    completedAt: { type: Date },
    skippedAt: { type: Date },
    step: { type: String },
    replays: { type: Number }
  },
  // Optional invoice details the customer adds: a GSTIN for a tax invoice in the business name, and the state
  // the supply is made to (Zoho's two letter code). Read when an invoice is made; never required to pay.
  billingDetails: {
    gstin: { type: String, default: '' },
    legalName: { type: String, default: '' },
    address: { type: String, default: '' },
    pin: { type: String, default: '' },
    stateCode: { type: String, default: '' },
    updatedAt: { type: Date }
  },
  subscription: {
    plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
    status: { type: String, enum: ['active', 'cancelled', 'expired', 'halted'], default: 'active' },
    expiresAt: { type: Date },
    razorpaySubscriptionId: { type: String, default: '' },
    razorpayPlanId: { type: String, default: '' },
    currentPeriodEnd: { type: Date },
    nextBillingAt: { type: Date },
    // The customer asked to stop: the plan runs to the end of the paid month and is not charged again.
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelRequestedAt: { type: Date },
    // The billing date the renewal reminder email was already sent for, so each month's reminder goes once.
    reminderForBillingAt: { type: Date }
  },
  // Google Calendar integration
  googleCalendar: {
    accessToken: { type: String, default: '' },
    refreshToken: { type: String, default: '' },
    tokenExpiresAt: { type: Date },
    calendarId: { type: String, default: 'primary' },
    connected: { type: Boolean, default: false },
    connectedAt: { type: Date }
  },
  // Ayrshare integration for social media management
  ayrshare: {
    profileKey: { type: String, default: '' },  // User's Ayrshare Profile Key for API calls
    refId: { type: String, default: '' },        // Ayrshare reference ID
    title: { type: String, default: '' },        // Profile title in Ayrshare
    createdAt: { type: Date },                   // When Ayrshare profile was created
    // Cache last-known connected accounts so transient Ayrshare errors don't "flip" the UI to disconnected
    activeSocialAccounts: { type: [String], default: [] },
    displayNames: { type: mongoose.Schema.Types.Mixed, default: [] },
    lastCheckedAt: { type: Date, default: null },
    lastError: { type: String, default: '' }
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
    // New accounts start at 0: there is no free grant. Quarks arrive with a plan or a top-up.
    balance: { type: Number, default: 0 },
    totalUsed: { type: Number, default: 0 },
    // Buckets inside the balance (see services/quarkBuckets.js). `balance` stays the one total the app reads.
    planBalance: { type: Number, default: 0 },
    planExpiresAt: { type: Date },
    topupBalance: { type: Number, default: 0 },
    topupExpiresAt: { type: Date },
    topupHeld: { type: Number, default: 0 },
    history: [{
      action: { type: String },
      amount: { type: Number },
      cost: { type: Number },
      description: { type: String },
      balanceAfter: { type: Number },
      createdAt: { type: Date, default: Date.now },
      timestamp: { type: Date, default: Date.now }
    }]
  },
  // Payment history
  payments: [{
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    amount: { type: Number },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['paid', 'failed', 'refunded'], default: 'paid' },
    credits: { type: Number },
    invoiceUrl: { type: String, default: '' },
    item: { type: String },
    exGstAmount: { type: Number },
    // A payment we received but could not apply (status 'failed' with needsRefund): staff see it on the Money page.
    needsRefund: { type: Boolean },
    reason: { type: String },            // short code: at_limit, no_agency_plan, slot_conflict, amount_mismatch
    subscriptionId: { type: String },
    paidAt: { type: Date, default: Date.now }
  }],
  // Managed service billing (set by Owner or Admin): what the client pays each month (with or without GST included), and when service began.
  managedBilling: {
    monthlyAmountInr: { type: Number },  // what the client pays each month
    gstInclusive: { type: Boolean },     // true: the amount already contains GST; false: GST is added on top
    gstPercent: { type: Number },
    serviceStart: { type: String }, // 'YYYY-MM' (the month of billingStart)
    billingStart: { type: String }, // 'YYYY-MM-DD': the first billing date; its day of the month is the invoice day
    termsDays: { type: Number },    // days the client has to pay after the invoice date
    cycleMonths: { type: Number, min: 1, max: 36 },     // how often they are billed, in months (1, 3, 6, 12 or your own)
    planName: { type: String, maxlength: 80 },          // the plan, for example SCALE (a product in Zoho Books)
    zohoItemId: { type: String },                       // that product's id in Zoho Books
    autoInvoice: { type: Boolean }, // make each billing period's invoice automatically on the invoice day
    autoFrom: { type: String },     // 'YYYY-MM': automatic invoices start from this month, never earlier
    endedMonth: { type: String },   // 'YYYY-MM': the last month they are billed; they have stopped after it
    endReason: { type: String, maxlength: 200 }
  },
  // Plan (optional: accounts without plan.tier are treated as managed)
  plan: {
    tier: { type: String },
    addons: [{ type: String }],
    // Set by Nebulaa staff for a managed client who pays by invoice or bank transfer (no online payment is recorded for them).
    paidManually: { type: Boolean },
    paidNote: { type: String, maxlength: 200 },
    subscriptionId: { type: String },
    welcomeEmailSentAt: { type: Date },
    // Razorpay subscriptions this account started (the plan, and each add-on).
    // The billing webhook trusts this record, never the request, to decide what a charge is for.
    subscriptions: [{
      _id: false,
      subscriptionId: { type: String },
      kind: { type: String },
      key: { type: String },
      razorpayPlanId: { type: String },
      couponCode: { type: String },
      expectedPaise: { type: Number },   // agency plan and client slot: the price (paise, GST included) when it was bought
      active: { type: Boolean, default: false },
      ended: { type: Boolean },          // a client slot that was cancelled or completed: a late charge must not reactivate it
      cancelAtPeriodEnd: { type: Boolean }, // a client slot the customer cancelled: it stays until the paid month ends
      cancelRequestedAt: { type: Date },
      cancelEndsAt: { type: Date },      // when that paid month ends, if known
      createdAt: { type: Date, default: Date.now }
    }]
  },
  // Agency plan: an agency account owns hidden client workspaces (User records) that spend its Quarks.
  agency: {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // set on a client workspace
    workspaceName: { type: String, default: '' },
    clientCount: { type: Number, default: 0 },  // on the agency: workspaces it has
    extraSlots: { type: Number, default: 0 },   // on the agency: paid extra client slots
    slotsEnding: { type: Number, default: 0 },  // on the agency: extra slots set to end with the paid month (kept equal to the flagged subscriptions; read in the atomic add-client check)
    frozen: { type: Boolean, default: false },  // on a workspace: over the limit after a downgrade
    removing: { type: Boolean },                // on a workspace: a removal has claimed it (so only one request removes it)
    removingAt: { type: Date }
  },
  // Trial tracking
  trial: {
    startDate: { type: Date },
    expiresAt: { type: Date },
    isExpired: { type: Boolean, default: false },
    migratedToProd: { type: Boolean, default: false }
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
  // When the weekly competitor tracker last read this account (oldest first = fair rotation across accounts).
  competitorsReadAt: { type: Date },
  // Customer success manager: may open the accounts of clients assigned to them.
  // Nebulaa team role: 'owner' | 'admin' | 'csm' (null for customers). See services/staff/permissions.js.
  staffRole: { type: String, enum: ['owner', 'admin', 'csm', null], default: null, index: true },
  isCsm: { type: Boolean, default: false },
  // The CSM responsible for this client account (managed service).
  assignedCsm: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  isActive: {
    type: Boolean,
    default: true
  },
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// The plan scheduler walks accounts oldest-start first.
userSchema.index({ 'planState.lastStartedAt': 1 });

// Fix credits if they are stored as a number (e.g. from manual DB edits or old bugs)
userSchema.pre('init', function (doc) {
  if (doc && typeof doc.credits === 'number') {
    doc.credits = {
      balance: doc.credits,
      totalUsed: doc.totalUsed || 0,
      history: []
    };
  }
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();

  // Hash password with cost of 12
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to check if password is correct
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get public profile (without sensitive data)
userSchema.methods.toPublicJSON = function () {
  return {
    _id: this._id,
    email: this.email,
    firstName: this.firstName,
    lastName: this.lastName,
    companyName: this.companyName,
    avatar: this.avatar,
    mobileNumber: this.mobileNumber,
    isVerified: this.isVerified,
    onboardingCompleted: this.onboardingCompleted,
    isCsm: Boolean(this.isCsm),
    staffRole: this.staffRole || null,
    businessProfile: this.businessProfile,
    connectedSocials: this.connectedSocials?.map(s => ({
      platform: s.platform,
      accountName: s.accountName,
      connectedAt: s.connectedAt
    })),
    subscription: this.subscription,
    deletion: this.deletion && this.deletion.status === 'pending' ? { status: 'pending', purgeAfter: this.deletion.purgeAfter } : null,
    consent: this.consent && this.consent.acceptedAt ? { acceptedAt: this.consent.acceptedAt, termsVersion: this.consent.termsVersion } : null,
    // The plan tier (starter, professional, free) or null for a managed account. Used to show the plan prompt.
    plan: { tier: (this.plan && this.plan.tier) || null },
    // How many client brands this account owns; lets an agency whose plan ended still reach its clients to see or remove them.
    agency: {
      clientCount: Number((this.agency && this.agency.clientCount) || 0), workspaceName: (this.agency && this.agency.workspaceName) || '',
      // Paid extra client places, and how many of them end with the paid month (so the app can show the state).
      extraSlots: Number((this.agency && this.agency.extraSlots) || 0), slotsEnding: require('../services/agency').slotsEndingOf(this)
    },
    // Setup progress the app reads from /me: when the plan was first opened and the first week approved.
    setup: { planOpenedAt: this.setup && this.setup.planOpenedAt, firstWeekApprovedAt: this.setup && this.setup.firstWeekApprovedAt },
    // Tour progress the app reads from /me; the step and replay count stay on the server.
    tour: { completedAt: this.tour && this.tour.completedAt, skippedAt: this.tour && this.tour.skippedAt },
    credits: this.credits ? {
      balance: this.credits.balance,
      totalUsed: this.credits.totalUsed
    } : undefined,
    trial: this.trial || undefined,
    payments: this.payments?.map(p => ({
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      credits: p.credits,
      paidAt: p.paidAt
    })),
    createdAt: this.createdAt
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User;
