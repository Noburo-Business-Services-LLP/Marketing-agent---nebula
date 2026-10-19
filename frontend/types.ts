export type BrandMaturity = 'established' | 'growing' | '';
export type TargetGender = 'mostly_men' | 'mostly_women' | 'both_equally' | 'families' | '';
export type GeographicReach = 'hyperlocal' | 'local_city' | 'regional' | 'state' | 'national' | 'international' | '';
export type ReachArea = 'neighbourhood' | 'city' | 'state' | 'india' | 'international';
export type CompanySize = 'solo' | 'small' | 'medium' | 'large' | '';
export type SalesCycle = 'days' | 'weeks' | 'months' | '';
export type CustomerType = 'mostly_new' | 'mix_new_repeat' | 'mostly_loyal' | '';
export type PricePositioning = 'budget' | 'affordable' | 'mid_range' | 'premium' | 'luxury' | '';
// Any of the languages offered in Settings: a base language, or that language mixed with English (for example 'hindi_english_mix').
export type ContentLanguage = string;

export interface BusinessProfile {
  name: string;
  website: string;
  gstNumber: string;
  industry: string; // Business vertical (e.g. Healthcare, E-commerce, Food & Beverage)
  problemSolved?: string; // The pain point / problem this business solves
  niche: string;
  businessType: 'B2B' | 'B2C' | 'Both' | '';
  businessLocation: string; // City, State/Region where business operates
  targetAudience: string;
  brandVoice: string | string[]; // e.g., Professional, Witty, Empathetic - can be multiple
  marketingGoals: string[]; // e.g., Brand Awareness, Sales, Leads
  description: string;
  competitors?: string[]; // Competitor names/brands to track

  // Customer-filled during onboarding
  yearsInBusiness?: number;
  brandMaturity?: BrandMaturity;

  // About the customers and the offer. Filled by the customer in Settings; a CSM can also fill them.
  targetCustomerProfile?: string;
  targetGender?: TargetGender;
  // Old single answer, kept so saved profiles still load; reachAreas is the one to use now.
  geographicReach?: GeographicReach;
  reachAreas?: ReachArea[];
  b2b?: { companySize?: CompanySize; decisionMaker?: string; salesCycle?: SalesCycle };
  customerType?: CustomerType;
  pricePositioning?: PricePositioning;
  keyDifferentiator?: string;
  brandStory?: string;
  heroProduct?: string;
  contentLanguage?: ContentLanguage;
  /** Optional sign-up answer: one business, or several brands run for clients. */
  accountKind?: 'one' | 'several' | '';
  // Extra languages (base codes only, at most three) a post can also be turned into.
  additionalLanguages?: string[];
  contentRestrictions?: string;
  firstMonthContentAngles?: string;
  // How much content the AI monthly planner generates. Forward-only —
  // changing this reshapes next month's plan, never the current one.
  contentCadence?: { postsPerDay?: number; reelsPerWeek?: number };
}

export interface User {
  _id: string;
  isCsm?: boolean;
  staffRole?: 'owner' | 'admin' | 'csm' | null;
  email: string;
  firstName: string;
  lastName: string;
  isVerified?: boolean;
  onboardingCompleted: boolean;
  businessProfile?: BusinessProfile;
  trial?: {
    startDate?: string;
    expiresAt?: string;
    isExpired?: boolean;
    migratedToProd?: boolean;
  };
  subscription?: {
    plan: 'free' | 'pro' | 'enterprise';
    status: 'active' | 'cancelled' | 'expired';
    expiresAt?: string;
  };
  credits?: {
    balance: number;
    totalUsed: number;
  };
  plan?: { tier: 'free' | 'starter' | 'professional' | 'managed' | 'agency' | null };
  /** Set by the server while this is a client workspace opened from an agency account. */
  actingAgency?: { name: string } | null;
  /** How many client brands this account owns (set by the server). */
  agency?: { clientCount?: number; workspaceName?: string } | null;
  /** Set by the server while a customer-success manager is working inside this account. */
  actingCsm?: { name: string } | null;
  consent?: { acceptedAt?: string; termsVersion?: string } | null;
  /** When the guided tour was finished or skipped (set by the server). */
  tour?: { completedAt?: string; skippedAt?: string } | null;
  deletion?: { status: 'pending'; purgeAfter?: string; requestedAt?: string } | null;
  brandScore?: {
    score: number;
    metrics: {
      engagement: number;
      consistency: number;
      authenticity: number;
    };
  };
  preferences?: {
    emailNotifications: boolean;
  };
}

export interface Payment {
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  credits?: number;
  status: 'paid' | 'failed' | 'refunded';
  invoiceUrl?: string | null;
  paidAt: string;
}

export interface BillingData {
  success: boolean;
  subscription: { plan: string; status: string; expiresAt?: string; cancelAtPeriodEnd?: boolean; endsAt?: string | null; nextBillingAt?: string | null };
  plan?: { tier: string; addons: string[] };
  credits: { balance: number; totalUsed: number };
  payments: Payment[];
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: User;
  error?: string;
  message?: string;
  requiresVerification?: boolean;
}

export interface Campaign {
  _id: string;
  name: string;
  objective: 'awareness' | 'traffic' | 'sales' | 'engagement' | 'conversion' | 'conversions' | 'leads';
  platforms: string[];
  tone?: string | null;
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'archived' | 'posted';
  priority?: 'low' | 'medium' | 'high';
  notes?: string;
  selectedProducts?: string[] | Product[];
  // Convenience top-level properties (aliases for nested values)
  description?: string;
  startDate?: string;
  endDate?: string;
  content?: string;
  creative: {
    type: 'text' | 'image' | 'video' | 'carousel' | 'story' | 'reel';
    textContent: string;
    imageUrls: string[];
    videoUrl?: string;
    captions?: string;
    instagramAudio?: {
      url: string;
      publicId?: string | null;
      originalName?: string | null;
    } | null;
    hashtags?: string[];
    callToAction?: string;
    aiGenerated?: boolean;
  };
  scheduling: {
    startDate: string;
    endDate?: string;
    postTime?: string;
  };
  budget?: {
    type?: 'daily' | 'lifetime';
    amount?: number;
    currency?: string;
  };
  targeting?: {
    demographics?: string;
    ageRange?: { min: number; max: number };
    gender?: 'all' | 'male' | 'female';
    locations?: string[];
    interests?: string[];
  };
  audience?: string;
  performance?: {
    impressions: number;
    clicks: number;
    ctr: number;
    engagement: number;
    spend: number;
  };
  publishedAt?: string;
  scheduledFor?: string;
  socialPostId?: string;
  socialPostIds?: Record<string, string> | null;
  facebookPostId?: string | null;
  instagramPostId?: string | null;
  ayrshareStatus?: string;
  lastPublishError?: string | null;
  createdAt: string;
}

export interface Draft {
  _id: string;
  title: string;
  caption: string;
  hashtags: string[];
  cta: string;
  imageUrl: string;
  imagePrompt?: string;
  /** The exact text sent to the image model, as opposed to imagePrompt which
      is only the seed description. Shown in the UI beside the image. */
  imagePromptResolved?: string;
  platforms: string[];
  language: string;
  /** Set on a language version: the id of the draft it was made from. */
  languageVariantOf?: string | null;
  tone?: string;
  objective?: string;
  scheduledDate?: string;
  status: 'draft' | 'approved' | 'scheduled' | 'published' | 'archived' | 'binned' | 'processing' | 'completed' | 'failed';
  /** 'manual' (made by the customer) or 'automation' (Nebulaa made it; needs approval). Old rows have none. */
  origin?: 'manual' | 'automation';
  /** the date the plan meant it for; approving schedules it then */
  plannedDate?: string | null;
  approvedAt?: string | null;
  /** when it went to the Bin (removed for good 14 days later) */
  binnedAt?: string | null;
  errorMessage?: string;
  generationProgress?: {
    jobId?: string;
    progress?: number;
    step?: string;
    [key: string]: any;
  };
  sourceType: 'campaign' | 'post' | 'reel' | 'calendar';
  contentType?: 'campaign' | 'post' | 'reel';
  contentCalendarId?: string;
  calendarWeek?: number;
  calendarDay?: number;
  campaignId?: string;
  creative?: Campaign['creative'];
  createdAt: string;
  updatedAt: string;
}

export interface ContentCalendarItem {
  _id: string;
  day: number;
  format: string;
  contentPillar: string;
  headline: string;
  creativeConcept: string;
  productNeeded: string;
  shootType: string;
  cta: string;
  objective: string;
  status: 'draft' | 'approved' | 'rejected' | 'scheduled' | 'published' | 'generated' | 'generating';
  generatedDraftId?: string | null;
  generatedCampaignId?: string | null;
  /** Set once Approve queues a background reel build; also the Draft jobId. */
  reelQueueJobId?: string | null;
  reelQueuedAt?: string | null;
  scheduledFor?: string | null;
}

export interface ContentCalendarWeek {
  _id: string;
  weekNumber: number;
  items: ContentCalendarItem[];
}

export interface ContentCalendar {
  _id: string;
  userId: string;
  businessName: string;
  niche: string;
  businessVertical: string;
  language: string;
  month: string;
  autoGenerate: boolean;
  /** How many posts auto-generation may make this month, and how many it has. */
  autoGenerateLimit?: number;
  autoGeneratedCount?: number;
  approved: boolean;
  weeks: ContentCalendarWeek[];
  /** The month's editorial through-line and its cover art, made after the plan. */
  themeTitle?: string;
  themeSummary?: string;
  coverImageUrl?: string;
  coverImagePrompt?: string;
  coverStatus?: 'none' | 'pending' | 'ready' | 'failed';
  generatedAt?: string;
  lastAutoRunAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdCampaignPlatformStatus {
  status: 'pending' | 'success' | 'failed' | 'skipped';
  message: string;
  externalAdId?: string;
  errorCode?: string;
  currency?: string;
}

export interface AdCampaign {
  _id: string;
  userId: string;
  campaignId:
    | string
    | {
        _id: string;
        name?: string;
        status?: string;
      };
  adTitle: string;
  adDescription: string;
  adCreativeUrl: string;
  platformSelection: 'meta' | 'google' | 'both';
  budget: {
    amount: number;
    currency: string;
  };
  schedule: {
    startDate: string;
    endDate: string;
  };
  status: 'active' | 'paused' | 'failed' | 'partial' | 'scheduled';
  platformStatus: {
    meta: AdCampaignPlatformStatus;
    google: AdCampaignPlatformStatus;
  };
  sourcePostIds?: {
    facebook?: string;
    instagram?: string;
  };
  cta?: {
    type?: string;
    link?: string;
    sourcePlatform?: 'facebook' | 'instagram' | '';
  };
  sourceProfileUrls?: {
    facebook?: string;
    instagram?: string;
  };
  performance?: {
    clicks: number;
    impressions: number;
    ctr: number;
    spend: number;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface CompetitorPost {
  id: string;
  _id?: string;
  competitorId?: string;
  competitorType?: string;
  competitorName: string;
  competitorLogo?: string;
  content: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  postedAt: string;
  likes: number;
  comments: number;
  platform: string;
  postUrl?: string;
  imageUrl?: string;
  isAIGenerated?: boolean;
}

export interface Competitor {
  _id: string;
  name: string;
  industry: string;
  website: string;
  analysisScore: number;
  strengths: string[];
  weaknesses: string[];
  lastAnalyzed: string;
  posts?: CompetitorPost[];
}

export interface Influencer {
  _id: string;
  name: string;
  platform: 'instagram' | 'linkedin' | 'youtube' | 'twitter' | 'facebook' | 'x' | 'tiktok';
  handle: string;
  followerCount: number;
  reach: number;
  engagementRate: number;
  niche: string[];
  type: 'nano' | 'micro' | 'mid-tier' | 'macro' | 'mega' | 'celebrity' | 'Nano' | 'Micro' | 'Mid-Tier' | 'Macro' | 'Mega';
  tier?: 'nano' | 'micro' | 'macro' | 'mega'; // New tier field
  location?: string; // Influencer's location
  contentType?: string; // Type of content they create
  audienceType?: string; // Their audience demographics
  estimatedCost?: string; // Estimated cost per post
  aiMatchScore: {
    score: number;
    reason: string;
    factors?: {
      name: string;
      score: number;
      max: number;
    }[];
    calculatedAt?: string;
  };
  profileImage?: string;
  profileUrl?: string;
  bio?: string;
  avgLikes?: number;
  avgComments?: number;
  avgViews?: number;
  isVerified?: boolean;
  priceRange?: {
    min: number;
    max: number;
    currency: string;
  };
  status?: 'discovered' | 'contacted' | 'negotiating' | 'confirmed' | 'completed' | 'rejected';
  isFavorite?: boolean;
  scrapedFromSocial?: boolean;
  scrapedAt?: string;
  createdAt?: string;
}

export interface SocialConnection {
  platform: string;
  connected: boolean;
  username?: string;
  profileId?: string;
  lastSync?: string;
  status: 'active' | 'expired' | 'connecting' | 'disconnected';
  profileUrl?: string;
  userImage?: string;
  source?: 'oauth' | 'ayrshare';
  analytics?: {
    followers: number;
    following: number;
    posts: number;
    engagement: number;
  };
  channelData?: {
    subscriberCount?: number;
    videoCount?: number;
    viewCount?: number;
  };
}

export interface Trend {
  id: string;
  title: string;
  description: string;
  category: string;
  relevanceScore?: number;
}

export interface SocialProfile {
  platform: string;
  accountName: string;
  profileImage?: string;
  followers: number;
  posts: number;
  engagementRate: number;
  followersGrowth: number;
  connectedAt?: string;
}

export interface DashboardMetrics {
  totalCampaigns: number;
  activeCampaigns: number;
  totalSpent: number;
  brandScore: number;
  brandScoreChange: number;
  activeCampaignsChange: number;
  engagementRate: number;
  connectedPlatforms?: number;
  socialProfiles?: SocialProfile[];
}

export interface SuggestedAction {
  id: string;
  title: string;
  description?: string;
  type?: 'campaign' | 'social' | 'content';
  actionType?: 'create_campaign' | 'create_post' | 'create_story' | 'analyze_competitors' | 'find_influencers' | 'engage_audience' | 'connect_social' | 'view_analytics' | 'schedule_content';
  priority?: 'high' | 'medium' | 'low';
  estimatedImpact?: string;
}

export interface CampaignIdea {
  id: string;
  name: string;
  tagline?: string;
  objective: string;
  platforms: string[];
  description: string;
  contentIdeas?: string[];
  estimatedBudget?: string | { min: number; max: number; currency: string };
  duration?: string;
  expectedResults?: string;
  targetAudience?: string;
}

export interface BrandScoreFactor {
  score: number;
  reason: string;
}

export interface BrandScoreFactors {
  engagement?: BrandScoreFactor;
  consistency?: BrandScoreFactor;
  audienceGrowth?: BrandScoreFactor;
  contentQuality?: BrandScoreFactor;
}

export interface DashboardData {
  overview: DashboardMetrics;
  trends: Trend[];
  recentCampaigns: Campaign[];
  suggestedActions: SuggestedAction[];
  competitorActivity: CompetitorPost[];
  // AI-generated extended data
  campaignIdeas?: CampaignIdea[];
  brandScoreFactors?: BrandScoreFactors;
  personalizedTips?: string[];
  businessContext?: {
    name?: string;
    industry?: string;
    niche?: string;
    targetAudience?: string;
  };
  generatedAt?: string;
  dataSource?: 'real' | 'mock';
}

export interface Product {
  _id: string;
  name: string;
  /** A business may offer goods, services, or both. */
  type?: 'product' | 'service';
  /** Optional: a service often has no single price. */
  price?: number;
  /** Free text for cases a number cannot express — "From ₹5,000/session". */
  priceNote?: string;
  currency: string;
  /** Primary image. Kept alongside `images` so existing consumers still work. */
  imageUrl?: string;
  /** Additional images — angles, contexts, lifestyle shots. */
  images?: string[];
  /** Concrete selling points, used as copy source material. */
  keyFeatures?: string[];
  description?: string;
  /** Retained for existing records; no longer written or shown. */
  stockStatus?: 'in-stock' | 'out-of-stock' | 'low-stock';
  stockQuantity?: number;
  category: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/** What GET /api/plan returns (the staff version adds the last run). */
export interface PlanView {
  success?: boolean;
  plan: { id: string; completedAt: string; stale: boolean; result: any } | null;
  running: boolean;
  failed: boolean;
  stopped?: { message: string } | null;
  nextRefreshAt: string | null;
  eligible: boolean;
  reason: '' | 'free' | 'profile_incomplete' | 'not_eligible';
  missing: string[];
  freeBlueprint: { id: string } | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
}

export interface PlanRefreshReply { success: boolean; message?: string; nextRefreshAt?: string | null }

// The weekly proposal and the setup path (/api/week, /api/setup)
export type WeekItemKind = 'post' | 'carousel' | 'video';
export type WeekItemStatus = 'proposed' | 'approved' | 'making' | 'made' | 'skipped' | 'failed';
export interface WeekItem { id: string; kind: WeekItemKind; topic: string; channel?: string | null; pillar?: string | null; source?: string | null; status: WeekItemStatus; ref?: string | null; error?: string | null }
export interface WeekCounts { posts: number; carousels: number; videos: number }
export interface WeekProposal {
  weekStart?: string; status: 'proposed' | 'approved' | 'skipped' | 'expired'; items: WeekItem[]; counts?: WeekCounts;
  scaledDown?: boolean; removed?: WeekCounts; empty?: boolean;
}
export type { CompetitorInsightsResponse, CompetitorRow, CompetitorTrendPoint, CompetitorHighlight, CompetitorStatus } from './utils/competitorInsights';
export type { ListeningResponse, ListeningCounts, ListeningQuote, ListeningRecent } from './utils/listening';
export interface WeekResponse { success?: boolean; eligible: boolean; reason?: string; proposal?: WeekProposal | null; topUp?: boolean }
export interface WeekPrefill { itemId: string; target: 'carousel' | 'video'; route: string; prefill: Record<string, unknown> }
export interface WeekWriteResponse { success: boolean; message?: string; proposal?: WeekProposal | null; prefills?: WeekPrefill[] }
export interface SetupStep { id: string; title: string; done: boolean; reason: string; minutes: number }
export interface SetupResponse { success?: boolean; steps: SetupStep[]; next: string | null; allDone: boolean }

// ---- GET /api/home/summary (see docs/superpowers/ops/home-summary.md) ----
export interface HomeNumber {
  value: number | null; previous: number | null; changePct: number | null; change?: number | null;
  available: boolean; reason: string | null; unit?: 'count' | 'percent'; asOf?: string | null; stale?: boolean;
}
export type HomeActionKind = 'setup' | 'billing' | 'plan' | 'week' | 'drafts' | 'inbox' | 'competitors' | 'products';
export interface HomeAction { id: string; kind: HomeActionKind; title: string; detail: string; to: string | null; count?: number; info?: boolean }
export type HomePlanState = 'none' | 'building' | 'ready' | 'failed' | 'stale';
export interface HomeSummary {
  generatedAt: string;
  account: { tier: string; free: boolean; paidTier: boolean; agencyOwner: boolean; clientWorkspace: boolean; managed: boolean; staff: boolean; pass: boolean; frozen: boolean; showsPostsNotQuarks: boolean };
  features: { inbox: boolean; competitors: boolean; publish: boolean };
  numbers: { reach: HomeNumber; engagement: HomeNumber; followers: HomeNumber; postsPublishedThisWeek: HomeNumber; draftsWaiting: HomeNumber; unrepliedMessages: HomeNumber };
  nextActions: HomeAction[];
  week: { start: string; end: string; proposal: string; topUp: boolean; posts: { planned: number | null; made: number | null; published: number | null; scheduled: number | null }; counts: WeekCounts | null };
  plan: { state: HomePlanState; opened: boolean; eligible: boolean; stopped: boolean; completedAt: string | null; unknown?: boolean };
  setup: { next: string | null; allDone: boolean; done: number; total: number };
  balance: { available: boolean; quarks: number | null; posts: number | null; videos: number | null; showQuarks: boolean; text: string; paused: boolean };
  connected: { count: number; platforms: string[] };
  competitors: { held: boolean; tracked: number; needHandle: number };
  products: { count: number; withPhotos: number };
  today: Array<{ id: string; at: string | null; title: string; subtitle: string; image: string | null; status: string; platform: string | null }>;
  recent: Array<{ image: string; platform: string | null; when: string | null }>;
  degraded: string[];
}
export interface HomeSummaryResponse extends HomeSummary { success: boolean; cached?: boolean }
