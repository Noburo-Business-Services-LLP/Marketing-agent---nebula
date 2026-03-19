export interface BusinessProfile {
  name: string;
  website: string;
  gstNumber: string;
  industry: string;
  niche: string;
  businessType: 'B2B' | 'B2C' | 'Both' | '';
  businessLocation: string; // City, State/Region where business operates
  targetAudience: string;
  brandVoice: string | string[]; // e.g., Professional, Witty, Empathetic - can be multiple
  marketingGoals: string[]; // e.g., Brand Awareness, Sales, Leads
  description: string;
  competitors?: string[]; // Competitor names/brands to track
}

export interface User {
  _id: string;
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
  subscription: { plan: string; status: string; expiresAt?: string };
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
  status: 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'archived' | 'posted';
  priority?: 'low' | 'medium' | 'high';
  notes?: string;
  // Convenience top-level properties (aliases for nested values)
  description?: string;
  startDate?: string;
  endDate?: string;
  content?: string;
  creative: {
    type: 'text' | 'image' | 'video' | 'carousel' | 'story' | 'reel';
    textContent: string;
    imageUrls: string[];
    captions?: string;
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
  ayrshareStatus?: string;
  createdAt: string;
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