import { AuthResponse, BusinessProfile, Campaign, DashboardData, SocialConnection, User } from '../types';

// Use relative URL in production (when served from same origin), localhost in development
declare const __PROD__: boolean;
const API_BASE_URL = typeof window !== 'undefined' && window.location.hostname !== 'localhost' 
  ? '/api' 
  : 'http://localhost:5000/api';

// Helper to get auth token
const getToken = (): string | null => localStorage.getItem('authToken');

// Helper to set auth token
const setToken = (token: string): void => localStorage.setItem('authToken', token);

// Helper to remove auth token
const removeToken = (): void => localStorage.removeItem('authToken');

// Helper to get stored website analysis context (from onboarding)
export const getWebsiteAnalysisContext = (): {
  companyName?: string;
  industry?: string;
  niche?: string;
  businessType?: string;
  businessLocation?: string;
  description?: string;
  targetAudience?: string;
  brandVoice?: string;
  keyProducts?: string[];
  competitorHints?: string[];
  analyzedAt?: string;
  websiteUrl?: string;
} | null => {
  try {
    const stored = sessionStorage.getItem('nebulaa_website_analysis');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to get website analysis context:', e);
  }
  return null;
};

// Helper to get business context string for AI prompts
export const getBusinessContextForAI = (): string => {
  const context = getWebsiteAnalysisContext();
  if (!context) return '';
  
  return `
Business Context:
- Company: ${context.companyName || 'Unknown'}
- Industry: ${context.industry || 'Unknown'}
- Niche: ${context.niche || 'General'}
- Business Type: ${context.businessType || 'B2B/B2C'}
- Location: ${context.businessLocation || 'Global'}
- Description: ${context.description || 'No description'}
- Target Audience: ${context.targetAudience || 'General audience'}
- Brand Voice: ${context.brandVoice || 'Professional'}
- Key Products/Services: ${context.keyProducts?.join(', ') || 'Various'}
`.trim();
};

// Generic API call function with real backend integration
async function apiCall<T>(
  endpoint: string, 
  options: RequestInit = {},
  requiresAuth: boolean = false
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add auth token if required
  if (requiresAuth) {
    const token = getToken();
    console.log('[API] Auth required for', endpoint, 'Token:', token ? token.substring(0, 20) + '...' : 'NO TOKEN');
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    console.log('[API] Calling:', `${API_BASE_URL}${endpoint}`);
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();
    console.log('[API] Response from', endpoint, ':', response.status, data?.success);

    // Handle trial/credit expiry responses
    if (response.status === 403 && (data.trialExpired || data.creditsExhausted)) {
      // Dispatch custom event so App.tsx can catch it
      window.dispatchEvent(new CustomEvent('trial-expired', { 
        detail: { 
          reason: data.trialExpired ? 'time' : 'credits',
          message: data.message,
          creditsRemaining: data.creditsRemaining
        } 
      }));
      throw new Error(data.message || 'Trial expired or credits exhausted');
    }

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Something went wrong');
    }

    // Dispatch credit update if response contains credit balance info
    if (data.creditsRemaining !== undefined) {
      window.dispatchEvent(new CustomEvent('credits-updated', { 
        detail: { creditsRemaining: data.creditsRemaining } 
      }));
    }

    return data as T;
  } catch (error: any) {
    console.error('[API] Error for', endpoint, ':', error.message);
    // Handle network errors
    if (error.message === 'Failed to fetch') {
      throw new Error('Unable to connect to server. Please check your connection.');
    }
    throw error;
  }
}

// ============================================
// MOCK DATA FOR NON-AUTH FEATURES
// ============================================

// Helpers to get dates relative to today for the demo
const today = new Date();
const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(today.getDate() + n);
  return d.toISOString().split('T')[0];
};

// Initial Mock Campaigns
let campaigns: Campaign[] = [
  {
    _id: 'c1',
    name: 'Winter Collection Launch',
    objective: 'awareness',
    platforms: ['instagram'],
    status: 'posted',
    creative: { type: 'image', textContent: 'Embrace the chill. ❄️ #WinterFashion', imageUrls: ['https://images.unsplash.com/photo-1483985988355-763728e1935b?q=80&w=2070&auto=format&fit=crop'], captions: 'Embrace the chill.' },
    scheduling: { startDate: daysFromNow(-2), postTime: '10:00' },
    performance: { impressions: 12500, clicks: 450, ctr: 3.6, engagement: 4500, spend: 500 },
    createdAt: daysFromNow(-10)
  },
  {
    _id: 'c2',
    name: 'Spring Teaser Video',
    objective: 'awareness',
    platforms: ['instagram'],
    status: 'draft',
    creative: { type: 'video', textContent: 'Coming soon...', imageUrls: [], captions: '' },
    scheduling: { startDate: daysFromNow(2), postTime: '09:00' },
    createdAt: daysFromNow(-1)
  },
  {
    _id: 'c3',
    name: 'Flash Sale: 24h',
    objective: 'sales',
    platforms: ['facebook'],
    status: 'scheduled',
    creative: { type: 'image', textContent: '24h Only!', imageUrls: [], captions: '' },
    scheduling: { startDate: daysFromNow(5), postTime: '12:00' },
    createdAt: daysFromNow(-3)
  },
  {
    _id: 'c4',
    name: 'Influencer Collab',
    objective: 'engagement',
    platforms: ['instagram', 'youtube'],
    status: 'active',
    creative: { type: 'image', textContent: 'Check out this review!', imageUrls: [], captions: '' },
    scheduling: { startDate: daysFromNow(0), postTime: '15:00' },
    createdAt: daysFromNow(-5)
  }
];

// Initial Social Connections
let socialConnections: SocialConnection[] = [
  { platform: 'Instagram', connected: false, status: 'disconnected' },
  { platform: 'Facebook', connected: false, status: 'disconnected' },
  { platform: 'X', connected: false, status: 'disconnected' },
  { platform: 'LinkedIn', connected: false, status: 'disconnected' },
  { platform: 'YouTube', connected: false, status: 'disconnected' },
  { platform: 'Pinterest', connected: false, status: 'disconnected' },
  { platform: 'Reddit', connected: false, status: 'disconnected' }
];

// Helper for Mock AI Generation
const generateContextAwareCaption = (topic: string, business?: BusinessProfile) => {
  const industry = business?.industry || 'General';
  const voice = business?.brandVoice || 'Professional';
  const audience = business?.targetAudience || 'Everyone';

  return `[AI Generated for ${industry} | Voice: ${voice}]\n\nHere is a caption targeting ${audience} about "${topic}":\n\n"Experience the difference. ${topic} brings you closer to what matters. 🚀 #NebulaaAI #${industry.replace(/\s/g, '')}"`;
};

// ============================================
// API SERVICE EXPORTS
// ============================================

export const apiService = {
  // ============================================
  // REAL AUTHENTICATION ENDPOINTS
  // ============================================
  
  register: async (data: { email: string; password: string; firstName: string; companyName?: string }): Promise<AuthResponse & { requiresVerification?: boolean }> => {
    const response = await apiCall<{ success: boolean; message: string; token: string; user: User; requiresVerification?: boolean }>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify(data) }
    );
    
    // SECURITY: Do NOT save token until OTP is verified
    if (response.token && !response.requiresVerification) {
      setToken(response.token);
    }
    
    return {
      success: response.success,
      token: response.token,
      user: response.user,
      requiresVerification: response.requiresVerification
    };
  },

  login: async (data: { email: string; password: string }): Promise<AuthResponse & { requiresVerification?: boolean }> => {
    const response = await apiCall<{ success: boolean; message: string; token: string; user: User; requiresVerification?: boolean }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify(data) }
    );
    
    // SECURITY: Do NOT save token until OTP is verified
    if (response.token && !response.requiresVerification) {
      setToken(response.token);
    }
    
    return {
      success: response.success,
      token: response.token,
      user: response.user,
      requiresVerification: response.requiresVerification
    };
  },

  // OTP Verification
  sendOTP: async (email: string): Promise<{ success: boolean; message: string; retryAfter?: number }> => {
    return apiCall('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  },

  verifyOTP: async (email: string, otp: string): Promise<AuthResponse & { requiresVerification?: boolean }> => {
    const response = await apiCall<{ success: boolean; message: string; token: string; user: User }>(
      '/auth/verify-otp',
      { method: 'POST', body: JSON.stringify({ email, otp }) }
    );
    
    if (response.token) {
      setToken(response.token);
    }
    
    return {
      success: response.success,
      token: response.token,
      user: response.user
    };
  },

  // Forgot Password
  forgotPassword: async (email: string): Promise<{ success: boolean; message: string }> => {
    return apiCall('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  },

  verifyResetOTP: async (email: string, otp: string): Promise<{ success: boolean; message: string }> => {
    return apiCall('/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp })
    });
  },

  resetPassword: async (email: string, otp: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    return apiCall('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, otp, newPassword })
    });
  },

  getCurrentUser: async (): Promise<{ user: User | null }> => {
    try {
      const token = getToken();
      if (!token) {
        return { user: null };
      }
      
      const response = await apiCall<{ success: boolean; user: User }>(
        '/auth/me',
        { method: 'GET' },
        true
      );
      
      return { user: response.user };
    } catch (error) {
      removeToken();
      return { user: null };
    }
  },

  // Credits & Trial
  getCredits: async (): Promise<{ success: boolean; credits?: { balance: number; totalUsed: number; history?: any[] }; trial?: { startDate: string; expiresAt: string; daysLeft: number; isExpired: boolean }; costs?: Record<string, number> }> => {
    try {
      return await apiCall('/credits', { method: 'GET' }, true);
    } catch (error) {
      return { success: false };
    }
  },

  // Payment / Razorpay
  createPaymentOrder: async (amount: number): Promise<any> => {
    return apiCall('/payment/create-order', { method: 'POST', body: JSON.stringify({ amount }) }, true);
  },

  verifyPayment: async (data: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }): Promise<any> => {
    return apiCall('/payment/verify', { method: 'POST', body: JSON.stringify(data) }, true);
  },

  getPaymentStatus: async (): Promise<any> => {
    return apiCall('/payment/status', { method: 'GET' }, true);
  },

  getBillingData: async (): Promise<any> => {
    return apiCall('/payment/billing', { method: 'GET' }, true);
  },

  getBusinessContext: async (): Promise<{ success: boolean; businessLocation?: string; company?: any; geography?: any }> => {
    try {
      const response = await apiCall<{ success: boolean; context: any }>(
        '/auth/business-context',
        { method: 'GET' },
        true
      );
      
      return {
        success: true,
        businessLocation: response.context?.geography?.businessLocation || '',
        company: response.context?.company,
        geography: response.context?.geography
      };
    } catch (error) {
      console.log('Error fetching business context:', error);
      return { success: false };
    }
  },

  logout: (): void => {
    removeToken();
    // Clear user-specific caches so next user doesn't see stale data
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('nebula_suggested_campaigns')) {
        localStorage.removeItem(key);
      }
    });
    localStorage.removeItem('nebula_focus_platforms');
    // Clear session storage too
    sessionStorage.removeItem('nebulaa_website_analysis');
  },

  verifyGST: async (gstNumber: string): Promise<any> => {
    return apiCall('/auth/verify-gst', { method: 'POST', body: JSON.stringify({ gstNumber }) }, true);
  },

  checkDuplicate: async (businessName: string, website: string, gstNumber: string): Promise<any> => {
    return apiCall('/auth/check-duplicate', { method: 'POST', body: JSON.stringify({ businessName, website, gstNumber }) }, true);
  },

  completeOnboarding: async (data: BusinessProfile, connectedSocials?: {platform: string; username?: string}[]): Promise<{ success: boolean; user: User }> => {
    const response = await apiCall<{ success: boolean; user: User }>(
      '/auth/complete-onboarding',
      { method: 'PUT', body: JSON.stringify({ businessProfile: data, connectedSocials }) },
      true
    );
    return response;
  },

  updateProfile: async (data: Partial<User>): Promise<{ success: boolean; user: User }> => {
    const response = await apiCall<{ success: boolean; user: User }>(
      '/auth/update-profile',
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<{ success: boolean; token?: string }> => {
    const response = await apiCall<{ success: boolean; token: string }>(
      '/auth/change-password',
      { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) },
      true
    );
    
    if (response.token) {
      setToken(response.token);
    }
    
    return response;
  },

  // ============================================
  // REAL DASHBOARD ENDPOINTS (AI-POWERED)
  // ============================================

  getDashboardOverview: async (refresh = false): Promise<DashboardData> => {
    try {
      const response = await apiCall<{ success: boolean; data: any }>(
        `/dashboard/overview${refresh ? '?refresh=true' : ''}`,
        { method: 'GET' },
        true
      );
      
      if (response.success && response.data) {
        return {
          overview: response.data.overview || {
            totalCampaigns: 0,
            activeCampaigns: 0,
            activeCampaignsChange: 0,
            totalSpent: 0,
            brandScore: 50,
            brandScoreChange: 0,
            engagementRate: 0
          },
          trends: response.data.trends || [],
          recentCampaigns: response.data.recentCampaigns || campaigns,
          suggestedActions: response.data.suggestedActions || [],
          competitorActivity: response.data.competitorActivity || [],
          // Extended AI data
          campaignIdeas: response.data.campaignIdeas,
          brandScoreFactors: response.data.brandScoreFactors,
          personalizedTips: response.data.personalizedTips,
          businessContext: response.data.businessContext,
          generatedAt: response.data.generatedAt
        } as DashboardData;
      }
      
      throw new Error('Invalid response');
    } catch (error) {
      console.log('Using fallback dashboard data:', error);
      // Fallback to mock data if API fails or user not logged in
      const activeCount = campaigns.filter(c => c.status === 'active' || c.status === 'posted').length;
      
      return {
        overview: {
          totalCampaigns: campaigns.length,
          activeCampaigns: activeCount,
          activeCampaignsChange: 12,
          totalSpent: campaigns.reduce((acc, curr) => acc + (curr.performance?.spend || 0), 0),
          brandScore: 75,
          brandScoreChange: 4.2,
          engagementRate: 3.8
        },
        trends: [
          { id: '1', title: 'AI in Marketing', description: 'Leveraging AI for personalized content.', category: 'Tech' },
          { id: '2', title: 'Sustainability', description: 'Green marketing is on the rise.', category: 'Social' },
          { id: '3', title: 'Short-form Video', description: 'Instagram Reels and YouTube Shorts dominance continues.', category: 'Media' }
        ],
        recentCampaigns: campaigns,
        suggestedActions: [
          { id: '1', title: 'Post a story update', type: 'campaign' },
          { id: '2', title: 'Review competitor ads', type: 'social' }
        ],
        competitorActivity: [
          { id: 'p1', competitorName: 'Rival Co.', content: 'New product alert!', sentiment: 'neutral', postedAt: '2h ago', likes: 50, comments: 2, platform: 'instagram' }
        ]
      } as DashboardData;
    }
  },

  getCompetitorAnalysis: async (competitors?: string[]): Promise<any> => {
    try {
      const queryString = competitors ? `?competitors=${competitors.join(',')}` : '';
      const response = await apiCall<{ success: boolean; data: any }>(
        `/dashboard/competitors${queryString}`,
        { method: 'GET' },
        true
      );
      return response.data;
    } catch (error) {
      console.log('Competitor analysis error:', error);
      return { competitors: [], marketGaps: [], recommendations: [] };
    }
  },

  getCampaignSuggestions: async (count: number = 3, forceRefresh: boolean = false, platforms?: string[], excludeTitles?: string[], contentAngle?: string): Promise<any> => {
    try {
      let url = `/dashboard/campaign-suggestions?count=${count}${forceRefresh ? '&refresh=true' : ''}`;
      if (platforms && platforms.length > 0) {
        url += `&platforms=${encodeURIComponent(platforms.join(','))}`;
      }
      if (excludeTitles && excludeTitles.length > 0) {
        url += `&excludeTitles=${encodeURIComponent(excludeTitles.join('|||'))}`;
      }
      if (contentAngle) {
        url += `&contentAngle=${encodeURIComponent(contentAngle)}`;
      }
      const response = await apiCall<{ success: boolean; data: any; cached?: boolean }>(
        url,
        { method: 'GET' },
        true
      );
      return { ...response.data, cached: response.cached };
    } catch (error: any) {
      // Propagate credit errors instead of swallowing them
      if (error?.message?.includes('Insufficient credits') || error?.message?.includes('credits') || error?.status === 403) {
        console.log('Insufficient credits for campaign suggestions:', error);
        return { campaigns: [], insufficientCredits: true, creditsRemaining: error?.creditsRemaining || 0, required: error?.required || 0 };
      }
      console.log('Campaign suggestions error:', error);
      return { campaigns: [] };
    }
  },

  // Stream campaign suggestions for progressive loading
  streamCampaignSuggestions: (
    count: number = 6,
    forceRefresh: boolean = false,
    onCampaign: (campaign: any, index: number, total: number, cached: boolean) => void,
    onComplete: (total: number) => void,
    onError: (error: string) => void,
    platforms?: string[]
  ): (() => void) => {
    const token = localStorage.getItem('token');
    // Use relative URL in production, localhost in development
    const baseUrl = (window as any).__API_BASE_URL__ || (window.location.hostname !== 'localhost' ? '/api' : 'http://localhost:5000/api');
    let url = `${baseUrl}/dashboard/campaign-suggestions-stream?count=${count}${forceRefresh ? '&refresh=true' : ''}`;
    if (platforms && platforms.length > 0) {
      url += `&platforms=${encodeURIComponent(platforms.join(','))}`;
    }
    
    const eventSource = new EventSource(url + `&token=${token}`);
    
    // Fallback: If EventSource doesn't support headers, use fetch with SSE parsing
    // Actually EventSource doesn't support custom headers, so we need fetch
    eventSource.close();
    
    const controller = new AbortController();
    
    fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream'
      },
      signal: controller.signal
    })
    .then(response => {
      if (!response.ok) throw new Error('Stream request failed');
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) throw new Error('No response body');
      
      function pump(): Promise<void> {
        return reader!.read().then(({ done, value }) => {
          if (done) return;
          
          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === 'campaign') {
                  onCampaign(data.campaign, data.index, data.total, data.cached || false);
                } else if (data.type === 'complete') {
                  onComplete(data.total);
                } else if (data.type === 'credits_update') {
                  // Real-time credit balance update from server
                  window.dispatchEvent(new CustomEvent('credits-updated', { 
                    detail: { creditsRemaining: data.creditsRemaining } 
                  }));
                } else if (data.type === 'error') {
                  if (data.trialExpired || data.creditsExhausted) {
                    window.dispatchEvent(new CustomEvent('trial-expired', { 
                      detail: { reason: data.trialExpired ? 'time' : 'credits', message: data.message } 
                    }));
                  }
                  onError(data.message);
                }
              } catch (e) {
                console.log('SSE parse error:', e);
              }
            }
          }
          
          return pump();
        });
      }
      
      return pump();
    })
    .catch(error => {
      if (error.name !== 'AbortError') {
        onError(error.message);
      }
    });
    
    // Return cleanup function
    return () => controller.abort();
  },

  // Clear campaign cache
  clearCampaignCache: async (): Promise<{ success: boolean }> => {
    try {
      const response = await apiCall<{ success: boolean }>(
        '/dashboard/campaign-cache',
        { method: 'DELETE' },
        true
      );
      return response;
    } catch (error) {
      console.log('Clear cache error:', error);
      return { success: false };
    }
  },

  refreshDashboard: async (): Promise<any> => {
    try {
      const response = await apiCall<{ success: boolean; data: any }>(
        '/dashboard/refresh',
        { method: 'POST' },
        true
      );
      return response.data;
    } catch (error) {
      console.log('Dashboard refresh error:', error);
      return null;
    }
  },

  getSynopsis: async (sectionType: string, sectionData: any): Promise<{ synopsis: string; insights: string[]; trend: 'up' | 'down' | 'stable' }> => {
    try {
      const response = await apiCall<{ success: boolean; synopsis: string; insights?: string[]; trend?: 'up' | 'down' | 'stable' }>(
        '/dashboard/synopsis',
        { method: 'POST', body: JSON.stringify({ section: sectionType, data: sectionData }) },
        true
      );
      return {
        synopsis: response.synopsis || 'No synopsis available.',
        insights: response.insights || [],
        trend: response.trend || 'stable'
      };
    } catch (error) {
      console.log('Synopsis error:', error);
      return { 
        synopsis: 'Unable to generate synopsis at this time. Please try again.', 
        insights: [], 
        trend: 'stable' 
      };
    }
  },

  // Generate Rival Post
  generateRivalPost: async (data: {
    competitorName: string;
    competitorContent: string;
    platform: string;
    sentiment?: string;
    likes?: number;
    comments?: number;
  }): Promise<{ caption: string; hashtags: string[]; imageUrl: string; imagePrompt?: string }> => {
    try {
      const response = await apiCall<{ 
        success: boolean; 
        caption: string; 
        hashtags: string[]; 
        imageUrl: string;
        imagePrompt?: string 
      }>(
        '/dashboard/generate-rival-post',
        { method: 'POST', body: JSON.stringify(data) },
        true
      );
      return {
        caption: response.caption,
        hashtags: response.hashtags,
        imageUrl: response.imageUrl,
        imagePrompt: response.imagePrompt
      };
    } catch (error) {
      console.error('Rival post generation error:', error);
      throw error;
    }
  },

  // ============================================
  // AI CAPTION GENERATION
  // ============================================

  generateCaption: async (topic: string): Promise<{ caption: string }> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    const caption = generateContextAwareCaption(topic);
    return { caption };
  },

  // ============================================
  // SOCIAL CONNECTIONS - HYBRID (Real YouTube, Mock others)
  // ============================================

  getSocials: async (): Promise<{ connections: SocialConnection[] }> => {
    try {
      // Try to get real social connections from backend
      const response = await apiCall<{ success: boolean; connections: SocialConnection[] }>(
        '/social/status',
        { method: 'GET' },
        true
      );
      return { connections: response.connections };
    } catch (error) {
      // Fallback to mock data if not logged in or API fails
      console.log('Using mock social connections');
      return { connections: socialConnections };
    }
  },

  // Get YouTube OAuth URL
  getYouTubeAuthUrl: async (): Promise<{ success: boolean; authUrl: string }> => {
    const response = await apiCall<{ success: boolean; authUrl: string }>(
      '/social/youtube/auth',
      { method: 'GET' },
      true
    );
    return response;
  },

  // Universal OAuth - Get auth URL for any platform
  getPlatformAuthUrl: async (platform: string): Promise<{ 
    success: boolean; 
    configured: boolean; 
    authUrl?: string; 
    message?: string;
    method?: 'direct_oauth' | 'ayrshare_jwt' | 'ayrshare';
    setupInstructions?: { url: string; steps: string[] };
  }> => {
    try {
      const response = await apiCall<{ 
        success: boolean; 
        configured: boolean; 
        authUrl?: string; 
        message?: string;
        method?: 'direct_oauth' | 'ayrshare_jwt' | 'ayrshare';
        setupInstructions?: { url: string; steps: string[] };
      }>(
        `/social/${platform.toLowerCase()}/auth`,
        { method: 'GET' },
        true
      );
      return response;
    } catch (error: any) {
      console.error(`Failed to get ${platform} auth URL:`, error);
      return { 
        success: false, 
        configured: false, 
        message: error.message || `Failed to initiate ${platform} connection` 
      };
    }
  },

  // Disconnect any platform
  disconnectPlatform: async (platform: string): Promise<{ success: boolean }> => {
    try {
      const response = await apiCall<{ success: boolean }>(
        `/social/${platform.toLowerCase()}/disconnect`,
        { method: 'POST' },
        true
      );
      return response;
    } catch (error) {
      console.error(`Failed to disconnect ${platform}:`, error);
      return { success: false };
    }
  },

  // Disconnect YouTube (legacy, kept for compatibility)
  disconnectYouTube: async (): Promise<{ success: boolean }> => {
    const response = await apiCall<{ success: boolean }>(
      '/social/youtube/disconnect',
      { method: 'POST' },
      true
    );
    return response;
  },

  // Get Ayrshare connected profiles
  getAyrshareProfile: async (): Promise<{ success: boolean; profiles: any[] }> => {
    try {
      const response = await apiCall<{ success: boolean; profiles: any[] }>(
        '/social/ayrshare/profile',
        { method: 'GET' },
        true
      );
      return response;
    } catch (error) {
      console.error('Failed to get Ayrshare profile:', error);
      return { success: false, profiles: [] };
    }
  },

  // Get Ayrshare OAuth connect URL for a platform (deprecated - use getPlatformAuthUrl instead)
  getAyrshareConnectUrl: async (platform: string): Promise<{ success: boolean; connectUrl: string }> => {
    const response = await apiCall<{ success: boolean; connectUrl: string }>(
      `/social/ayrshare/connect-url/${platform}`,
      { method: 'GET' },
      true
    );
    return response;
  },

  toggleSocial: async (platform: string, connected: boolean, username?: string): Promise<{ success: boolean }> => {
    // For disconnecting, use real API
    if (!connected) {
      return await apiService.disconnectPlatform(platform);
    }
    
    // For other platforms, use mock
    await new Promise(resolve => setTimeout(resolve, 300));
    
    socialConnections = socialConnections.map(s =>
      s.platform === platform
        ? {
            ...s,
            connected,
            username: connected ? username : undefined,
            status: connected ? 'active' : 'disconnected'
          }
        : s
    );
    
    return { success: true };
  },

  getCompetitors: async (): Promise<any> => {
    try {
      // First try to get real data from backend
      const response = await apiCall<{ success: boolean; posts: any[]; competitors: any[] }>(
        '/competitors/posts',
        { method: 'GET' },
        true
      );
      return { posts: response.posts || [], competitors: response.competitors || [] };
    } catch (error) {
      console.log('Using fallback competitor data');
      // Return empty - will trigger seed on page
      return { posts: [], competitors: [] };
    }
  },

  addCompetitor: async (data: any): Promise<any> => {
    const response = await apiCall<{ success: boolean; competitor: any }>(
      '/competitors',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  ignoreCompetitor: async (competitorId: string): Promise<any> => {
    const response = await apiCall<{ success: boolean; message: string; competitor: any }>(
      `/competitors/${competitorId}/ignore`,
      { method: 'PUT' },
      true
    );
    return response;
  },

  unignoreCompetitor: async (competitorId: string): Promise<any> => {
    const response = await apiCall<{ success: boolean; message: string; competitor: any }>(
      `/competitors/${competitorId}/unignore`,
      { method: 'PUT' },
      true
    );
    return response;
  },

  getIgnoredCompetitors: async (): Promise<any> => {
    const response = await apiCall<{ success: boolean; competitors: any[] }>(
      '/competitors/ignored',
      { method: 'GET' },
      true
    );
    return response;
  },

  addCompetitorPost: async (competitorId: string, post: any): Promise<any> => {
    const response = await apiCall<{ success: boolean; competitor: any }>(
      `/competitors/${competitorId}/posts`,
      { method: 'POST', body: JSON.stringify(post) },
      true
    );
    return response;
  },

  seedCompetitorSamples: async (): Promise<any> => {
    const response = await apiCall<{ success: boolean; message: string }>(
      '/competitors/seed-sample',
      { method: 'POST' },
      true
    );
    return response;
  },

  autoDiscoverCompetitors: async (data: { location?: string; forceRefresh?: boolean }): Promise<any> => {
    const response = await apiCall<{ success: boolean; competitors: any[]; posts: any[]; message: string }>(
      '/competitors/auto-discover',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  addManualCompetitor: async (name: string): Promise<any> => {
    const response = await apiCall<{ success: boolean; competitor: any; message: string }>(
      '/competitors/add-manual',
      { method: 'POST', body: JSON.stringify({ name }) },
      true
    );
    return response;
  },

  getInfluencers: async (sortBy?: string): Promise<any> => {
    try {
      const queryString = sortBy ? `?sortBy=${sortBy}` : '';
      const response = await apiCall<{ success: boolean; influencers: any[] }>(
        `/influencers${queryString}`,
        { method: 'GET' },
        true
      );
      return { influencers: response.influencers || [] };
    } catch (error) {
      console.log('Using fallback influencer data');
      return { influencers: [] };
    }
  },

  // Discover real influencers from social media using Apify + Gemini AI
  discoverInfluencers: async (options?: { platforms?: string[]; limit?: number; forceRefresh?: boolean }): Promise<{
    success: boolean;
    influencers: any[];
    discovered?: number;
    searchKeywords?: string[];
    aiGenerated?: boolean;
    message?: string;
  }> => {
    try {
      const response = await apiCall<{
        success: boolean;
        influencers: any[];
        discovered?: number;
        searchKeywords?: string[];
        aiGenerated?: boolean;
        message?: string;
      }>(
        '/influencers/discover',
        { method: 'POST', body: JSON.stringify(options || {}) },
        true
      );
      return response;
    } catch (error: any) {
      console.error('Influencer discovery failed:', error);
      return { 
        success: false, 
        influencers: [], 
        message: error.message || 'Discovery failed' 
      };
    }
  },

  addInfluencer: async (data: any): Promise<any> => {
    const response = await apiCall<{ success: boolean; influencer: any }>(
      '/influencers',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  recalculateInfluencerScore: async (id: string): Promise<any> => {
    const response = await apiCall<{ success: boolean; influencer: any }>(
      `/influencers/${id}/recalculate`,
      { method: 'POST' },
      true
    );
    return response;
  },

  seedInfluencerSamples: async (): Promise<any> => {
    const response = await apiCall<{ success: boolean; message: string }>(
      '/influencers/seed-sample',
      { method: 'POST' },
      true
    );
    return response;
  },

  // ============================================
  // CAMPAIGNS - REAL BACKEND
  // ============================================

  getCampaigns: async (status?: string): Promise<{ campaigns: Campaign[]; counts?: any }> => {
    try {
      const queryString = status && status !== 'all' ? `?status=${status}` : '';
      const response = await apiCall<{ success: boolean; campaigns: Campaign[]; counts: any }>(
        `/campaigns${queryString}`,
        { method: 'GET' },
        true
      );
      return { campaigns: response.campaigns || [], counts: response.counts };
    } catch (error) {
      console.log('Using fallback campaign data:', error);
      return { campaigns };
    }
  },

  getCampaign: async (id: string): Promise<{ campaign: Campaign }> => {
    const response = await apiCall<{ success: boolean; campaign: Campaign }>(
      `/campaigns/${id}`,
      { method: 'GET' },
      true
    );
    return { campaign: response.campaign };
  },

  createCampaign: async (data: Partial<Campaign>): Promise<{ campaign: Campaign }> => {
    const response = await apiCall<{ success: boolean; campaign: Campaign }>(
      '/campaigns',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return { campaign: response.campaign };
  },

  updateCampaign: async (id: string, data: Partial<Campaign>): Promise<{ campaign: Campaign }> => {
    const response = await apiCall<{ success: boolean; campaign: Campaign }>(
      `/campaigns/${id}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
    return { campaign: response.campaign };
  },

  deleteCampaign: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiCall<{ success: boolean }>(
      `/campaigns/${id}`,
      { method: 'DELETE' },
      true
    );
    return response;
  },

  postCampaign: async (id: string): Promise<{ campaign: Campaign }> => {
    const response = await apiCall<{ success: boolean; campaign: Campaign }>(
      `/campaigns/${id}/post`,
      { method: 'POST' },
      true
    );
    return { campaign: response.campaign };
  },

  archiveCampaign: async (id: string): Promise<{ campaign: Campaign }> => {
    const response = await apiCall<{ success: boolean; campaign: Campaign }>(
      `/campaigns/${id}/archive`,
      { method: 'POST' },
      true
    );
    return { campaign: response.campaign };
  },

  scheduleCampaign: async (id: string, startDate: string, postTime: string): Promise<{ campaign: Campaign }> => {
    const response = await apiCall<{ success: boolean; campaign: Campaign }>(
      `/campaigns/${id}/schedule`,
      { method: 'POST', body: JSON.stringify({ startDate, postTime }) },
      true
    );
    return { campaign: response.campaign };
  },

  // ============================================
  // TEMPLATE POSTER GENERATION (Nano Banana Pro)
  // ============================================

  /**
   * Generate a poster from a template image and content
   */
  generateTemplatePoster: async (
    templateImage: string, 
    content: string, 
    options?: { 
      platform?: string; 
      style?: string; 
      useAI?: boolean;
      logoOverlay?: {
        enabled: boolean;
        logoUrl: string;
        position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
        size?: 'small' | 'medium' | 'large';
        opacity?: number;
        padding?: number;
      };
    }
  ): Promise<{ 
    success: boolean; 
    imageBase64?: string; 
    imageUrl?: string; 
    model?: string; 
    logoApplied?: boolean;
    message?: string;
    error?: string;
  }> => {
    const response = await apiCall<any>(
      '/campaigns/template-poster',
      { 
        method: 'POST', 
        body: JSON.stringify({ 
          templateImage, 
          content, 
          platform: options?.platform || 'instagram',
          style: options?.style,
          useAI: options?.useAI || false,
          logoOverlay: options?.logoOverlay
        }) 
      },
      true
    );
    return response;
  },

  /**
   * Generate caption from image using AI (vision)
   */
  generateCaptionFromImage: async (
    imageBase64: string,
    platform?: string
  ): Promise<{
    success: boolean;
    caption?: string;
    hashtags?: string[];
    message?: string;
    error?: string;
  }> => {
    const response = await apiCall<any>(
      '/campaigns/generate-caption',
      {
        method: 'POST',
        body: JSON.stringify({
          image: imageBase64,
          platform: platform || 'instagram'
        })
      },
      true
    );
    return response;
  },

  /**
   * Process image to fit aspect ratio with padding (no cropping)
   */
  processImageAspectRatio: async (
    imageBase64: string,
    aspectRatio: string
  ): Promise<{
    success: boolean;
    imageBase64?: string;
    imageUrl?: string;
    message?: string;
    error?: string;
  }> => {
    const response = await apiCall<any>(
      '/campaigns/process-aspect-ratio',
      {
        method: 'POST',
        body: JSON.stringify({
          image: imageBase64,
          aspectRatio
        })
      },
      true
    );
    return response;
  },

  /**
   * Edit/refine a generated poster based on user feedback
   */
  editTemplatePoster: async (
    currentImage: string,
    originalContent: string,
    editInstructions: string,
    templateImage?: string,
    useAI?: boolean
  ): Promise<{ 
    success: boolean; 
    imageBase64?: string; 
    imageUrl?: string; 
    model?: string; 
    message?: string;
    error?: string;
  }> => {
    const response = await apiCall<any>(
      '/campaigns/template-poster/edit',
      { 
        method: 'POST', 
        body: JSON.stringify({ 
          currentImage, 
          originalContent, 
          editInstructions,
          templateImage,
          useAI: useAI || false
        }) 
      },
      true
    );
    return response;
  },

  /**
   * Generate multiple posters from templates in batch
   */
  generateTemplatePosterBatch: async (
    posters: Array<{ templateImage: string; content: string; style?: string }>,
    platform?: string
  ): Promise<{
    success: boolean;
    results: Array<{
      index: number;
      success: boolean;
      imageBase64?: string;
      imageUrl?: string;
      error?: string;
    }>;
    summary: {
      total: number;
      successful: number;
      failed: number;
    };
  }> => {
    const response = await apiCall<any>(
      '/campaigns/template-poster/batch',
      { 
        method: 'POST', 
        body: JSON.stringify({ posters, platform }) 
      },
      true
    );
    return response;
  },

  /**
   * Generate a poster using a REFERENCE image for style inspiration
   * The AI creates a NEW poster that LOOKS LIKE the reference but uses your content
   */
  generatePosterFromReference: async (
    referenceImage: string,
    content: string,
    platform?: string
  ): Promise<{ 
    success: boolean; 
    imageBase64?: string; 
    imageUrl?: string; 
    model?: string; 
    message?: string;
    error?: string;
  }> => {
    const response = await apiCall<any>(
      '/campaigns/template-poster/from-reference',
      { 
        method: 'POST', 
        body: JSON.stringify({ 
          referenceImage, 
          content, 
          platform: platform || 'instagram'
        }) 
      },
      true
    );
    return response;
  },

  getCampaignAnalytics: async (startDate?: string, endDate?: string): Promise<any> => {
    try {
      let queryString = '';
      if (startDate || endDate) {
        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        queryString = `?${params.toString()}`;
      }
      
      const response = await apiCall<{ success: boolean; analytics: any }>(
        `/campaigns/analytics/overview${queryString}`,
        { method: 'GET' },
        true
      );
      return response.analytics;
    } catch (error) {
      console.log('Analytics error:', error);
      return {
        totals: { impressions: 0, clicks: 0, engagement: 0, reach: 0, spend: 0 },
        averages: { ctr: 0, engagementRate: 0 },
        campaignCount: 0,
        dailyData: []
      };
    }
  },

  // ============================================
  // REMINDERS - REAL BACKEND
  // ============================================

  getReminders: async (startDate?: string, endDate?: string): Promise<{ reminders: any[] }> => {
    try {
      let queryString = '';
      if (startDate || endDate) {
        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        queryString = `?${params.toString()}`;
      }
      
      const response = await apiCall<{ success: boolean; reminders: any[] }>(
        `/reminders${queryString}`,
        { method: 'GET' },
        true
      );
      return { reminders: response.reminders || [] };
    } catch (error) {
      console.log('Reminders error:', error);
      return { reminders: [] };
    }
  },

  getPendingReminders: async (): Promise<{ reminders: any[]; count: number }> => {
    try {
      const response = await apiCall<{ success: boolean; reminders: any[]; count: number }>(
        '/reminders/pending',
        { method: 'GET' },
        true
      );
      return { reminders: response.reminders || [], count: response.count || 0 };
    } catch (error) {
      console.log('Pending reminders error:', error);
      return { reminders: [], count: 0 };
    }
  },

  getCalendarEvents: async (year: number, month: number): Promise<{ events: any[] }> => {
    try {
      const response = await apiCall<{ success: boolean; events: any[] }>(
        `/reminders/calendar/${year}/${month}`,
        { method: 'GET' },
        true
      );
      return { events: response.events || [] };
    } catch (error) {
      console.log('Calendar events error:', error);
      return { events: [] };
    }
  },

  createReminder: async (data: {
    title: string;
    description?: string;
    scheduledFor: string;
    reminderOffset?: number;
    type?: string;
    campaignId?: string;
    platform?: string;
    color?: string;
  }): Promise<{ reminder: any }> => {
    const response = await apiCall<{ success: boolean; reminder: any }>(
      '/reminders',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return { reminder: response.reminder };
  },

  createCampaignReminder: async (campaignId: string, reminderOffset?: number): Promise<{ reminder: any }> => {
    const response = await apiCall<{ success: boolean; reminder: any }>(
      `/reminders/from-campaign/${campaignId}`,
      { method: 'POST', body: JSON.stringify({ reminderOffset: reminderOffset || 30 }) },
      true
    );
    return { reminder: response.reminder };
  },

  dismissReminder: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiCall<{ success: boolean }>(
      `/reminders/${id}/dismiss`,
      { method: 'POST' },
      true
    );
    return response;
  },

  snoozeReminder: async (id: string, minutes?: number): Promise<{ reminder: any }> => {
    const response = await apiCall<{ success: boolean; reminder: any }>(
      `/reminders/${id}/snooze`,
      { method: 'POST', body: JSON.stringify({ minutes: minutes || 15 }) },
      true
    );
    return { reminder: response.reminder };
  },

  updateReminder: async (id: string, data: Record<string, any>): Promise<{ reminder: any }> => {
    const response = await apiCall<{ success: boolean; reminder: any }>(
      `/reminders/${id}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
    return { reminder: response.reminder };
  },

  deleteReminder: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiCall<{ success: boolean }>(
      `/reminders/${id}`,
      { method: 'DELETE' },
      true
    );
    return response;
  },

  // ============================================
  // STRATEGIC ADVISOR API
  // ============================================
  
  getStrategicSuggestions: async (refresh = false): Promise<{
    success: boolean;
    suggestions: any[];
    trendingNow: string[];
    upcomingEvents: any[];
    competitorInsight: string;
    businessContext: any;
  }> => {
    try {
      const response = await apiCall<any>(
        `/dashboard/strategic-advisor${refresh ? '?refresh=true' : ''}`,
        { method: 'GET' },
        true
      );
      return {
        success: true,
        suggestions: response.suggestions || [],
        trendingNow: response.trendingNow || [],
        upcomingEvents: response.upcomingEvents || [],
        competitorInsight: response.competitorInsight || '',
        businessContext: response.businessContext || {}
      };
    } catch (error) {
      console.error('Strategic suggestions error:', error);
      return {
        success: false,
        suggestions: [],
        trendingNow: [],
        upcomingEvents: [],
        competitorInsight: '',
        businessContext: {}
      };
    }
  },

  generatePostFromSuggestion: async (suggestion: any): Promise<{
    success: boolean;
    post: {
      caption: string;
      hashtags: string[];
      imagePrompt: string;
      imageStyle: string;
      generatedImageUrl?: string;
      trendingAudio: any[];
      bestPostTimes: Record<string, string>;
      engagementHooks: string[];
      altCaptions: string[];
      storyIdeas: string[];
      contentNotes: string;
      suggestion: any;
    };
  }> => {
    try {
      const response = await apiCall<any>(
        '/dashboard/strategic-advisor/generate-post',
        { 
          method: 'POST', 
          body: JSON.stringify({ suggestion }) 
        },
        true
      );
      return {
        success: true,
        post: response.post
      };
    } catch (error) {
      console.error('Generate post error:', error);
      return {
        success: false,
        post: {
          caption: '',
          hashtags: [],
          imagePrompt: '',
          imageStyle: 'professional',
          trendingAudio: [],
          bestPostTimes: {},
          engagementHooks: [],
          altCaptions: [],
          storyIdeas: [],
          contentNotes: '',
          suggestion
        }
      };
    }
  },

  refineImage: async (originalPrompt: string, refinementPrompt: string, style?: string, currentImageUrl?: string): Promise<{
    success: boolean;
    imageUrl?: string;
    error?: string;
  }> => {
    try {
      const response = await apiCall<any>(
        '/dashboard/strategic-advisor/refine-image',
        { 
          method: 'POST', 
          body: JSON.stringify({ originalPrompt, refinementPrompt, style, currentImageUrl }) 
        },
        true
      );
      return response;
    } catch (error: any) {
      console.error('Refine image error:', error);
      return {
        success: false,
        error: error.message || 'Failed to refine image'
      };
    }
  },

  generateEventPost: async (event: any): Promise<{
    success: boolean;
    post: {
      caption: string;
      hashtags: string[];
      imagePrompt: string;
      imageStyle: string;
      generatedImageUrl?: string;
      trendingAudio: any[];
      bestPostTimes: Record<string, string>;
      engagementHooks: string[];
      altCaptions: string[];
      storyIdeas: string[];
      contentNotes: string;
      event: any;
    };
  }> => {
    try {
      const response = await apiCall<any>(
        '/dashboard/generate-event-post',
        { 
          method: 'POST', 
          body: JSON.stringify({ event }) 
        },
        true
      );
      return {
        success: true,
        post: response.post
      };
    } catch (error) {
      console.error('Generate event post error:', error);
      return {
        success: false,
        post: {
          caption: '',
          hashtags: [],
          imagePrompt: '',
          imageStyle: 'festive',
          trendingAudio: [],
          bestPostTimes: {},
          engagementHooks: [],
          altCaptions: [],
          storyIdeas: [],
          contentNotes: '',
          event
        }
      };
    }
  },

  // ============================================
  // NOTIFICATIONS - CAMPAIGN REMINDERS
  // ============================================

  getNotifications: async (options?: { unreadOnly?: boolean; limit?: number }): Promise<{ notifications: any[]; unreadCount: number }> => {
    try {
      const params = new URLSearchParams();
      if (options?.unreadOnly) params.append('unreadOnly', 'true');
      if (options?.limit) params.append('limit', options.limit.toString());
      
      const response = await apiCall<{ success: boolean; notifications: any[]; unreadCount: number }>(
        `/notifications${params.toString() ? '?' + params.toString() : ''}`,
        { method: 'GET' },
        true
      );
      return { notifications: response.notifications || [], unreadCount: response.unreadCount || 0 };
    } catch (error) {
      console.log('Notifications error:', error);
      return { notifications: [], unreadCount: 0 };
    }
  },

  getUnreadNotificationCount: async (): Promise<number> => {
    try {
      const response = await apiCall<{ success: boolean; count: number }>(
        '/notifications/unread-count',
        { method: 'GET' },
        true
      );
      return response.count || 0;
    } catch (error) {
      return 0;
    }
  },

  markNotificationRead: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiCall<{ success: boolean }>(
      `/notifications/${id}/read`,
      { method: 'PUT' },
      true
    );
    return response;
  },

  markAllNotificationsRead: async (): Promise<{ success: boolean }> => {
    const response = await apiCall<{ success: boolean }>(
      '/notifications/read-all',
      { method: 'PUT' },
      true
    );
    return response;
  },

  deleteNotification: async (id: string): Promise<{ success: boolean }> => {
    const response = await apiCall<{ success: boolean }>(
      `/notifications/${id}`,
      { method: 'DELETE' },
      true
    );
    return response;
  },

  clearAllNotifications: async (): Promise<{ success: boolean }> => {
    const response = await apiCall<{ success: boolean }>(
      '/notifications',
      { method: 'DELETE' },
      true
    );
    return response;
  },

  checkNotificationsNow: async (): Promise<{ success: boolean; campaigns: any[]; notifications: any[]; message: string }> => {
    const response = await apiCall<{ success: boolean; campaigns: any[]; notifications: any[]; message: string }>(
      '/notifications/check-now',
      { method: 'POST' },
      true
    );
    return response;
  },

  // ============================================
  // NEW REAL-DATA ENDPOINTS
  // ============================================

  // Brand Profile APIs
  createBrandProfile: async (data: { website: string; name?: string; description?: string }): Promise<any> => {
    const response = await apiCall<any>(
      '/brand',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  getBrandProfile: async (id: string): Promise<any> => {
    const response = await apiCall<any>(`/brand/${id}`, { method: 'GET' }, true);
    return response;
  },

  analyzeBrand: async (id: string): Promise<any> => {
    const response = await apiCall<any>(
      `/brand/${id}/analyze`,
      { method: 'POST' },
      true
    );
    return response;
  },

  // Trends APIs
  getTrends: async (industry?: string): Promise<any> => {
    const queryParams = industry ? `?industry=${encodeURIComponent(industry)}` : '';
    const response = await apiCall<any>(`/trends${queryParams}`, { method: 'GET' }, true);
    return response;
  },

  discoverTrends: async (sources: string[], keywords?: string[]): Promise<any> => {
    const response = await apiCall<any>(
      '/trends/discover',
      { method: 'POST', body: JSON.stringify({ sources, keywords }) },
      true
    );
    return response;
  },

  clusterTrends: async (trendIds: string[]): Promise<any> => {
    const response = await apiCall<any>(
      '/trends/cluster',
      { method: 'POST', body: JSON.stringify({ trendIds }) },
      true
    );
    return response;
  },

  generateContentPlan: async (trendId: string, platforms: string[]): Promise<any> => {
    const response = await apiCall<any>(
      '/trends/content-plan',
      { method: 'POST', body: JSON.stringify({ trendId, platforms }) },
      true
    );
    return response;
  },

  // Content Studio APIs
  generateContent: async (params: {
    type: string;
    platform: string;
    topic: string;
    tone?: string;
    keywords?: string[];
  }): Promise<any> => {
    const response = await apiCall<any>(
      '/content/generate',
      { method: 'POST', body: JSON.stringify(params) },
      true
    );
    return response;
  },

  modifyContent: async (draftId: string, modifications: { tone?: string; length?: string; style?: string }): Promise<any> => {
    const response = await apiCall<any>(
      '/content/modify',
      { method: 'POST', body: JSON.stringify({ draftId, modifications }) },
      true
    );
    return response;
  },

  checkContentCompliance: async (draftId: string): Promise<any> => {
    const response = await apiCall<any>(
      `/content/${draftId}/compliance-check`,
      { method: 'POST' },
      true
    );
    return response;
  },

  // Campaign Builder APIs
  buildCampaign: async (params: {
    name: string;
    objective: string;
    platforms: string[];
    budget?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<any> => {
    const response = await apiCall<any>(
      '/campaign-builder',
      { method: 'POST', body: JSON.stringify(params) },
      true
    );
    return response;
  },

  getCampaignPlans: async (): Promise<any> => {
    const response = await apiCall<any>('/campaign-builder', { method: 'GET' }, true);
    return response;
  },

  getCampaignPlan: async (id: string): Promise<any> => {
    const response = await apiCall<any>(`/campaign-builder/${id}`, { method: 'GET' }, true);
    return response;
  },

  exportCampaignPlan: async (id: string, format: 'pdf' | 'json' | 'csv' | 'notion'): Promise<any> => {
    const response = await apiCall<any>(
      `/campaign-builder/${id}/export`,
      { method: 'POST', body: JSON.stringify({ format }) },
      true
    );
    return response;
  },

  // Analytics APIs
  importAnalyticsCsv: async (platform: string, data: any[]): Promise<any> => {
    const response = await apiCall<any>(
      '/analytics/import/csv',
      { method: 'POST', body: JSON.stringify({ platform, data }) },
      true
    );
    return response;
  },

  importAnalyticsManual: async (platform: string, metrics: any): Promise<any> => {
    const response = await apiCall<any>(
      '/analytics/import/manual',
      { method: 'POST', body: JSON.stringify({ platform, metrics }) },
      true
    );
    return response;
  },

  getAnalyticsInsights: async (snapshotId: string): Promise<any> => {
    const response = await apiCall<any>(`/analytics/${snapshotId}/insights`, { method: 'GET' }, true);
    return response;
  },

  // ============================================
  // AYRSHARE ANALYTICS (Post + Account + Daily)
  // ============================================

  // Get analytics for a specific Ayrshare post
  getPostAnalytics: async (postId: string, platforms?: string[]): Promise<any> => {
    // Use campaign's actual platforms; fallback includes linkedin
    const response = await apiCall<any>(
      '/analytics/post-analytics',
      { method: 'POST', body: JSON.stringify({ postId, platforms: platforms && platforms.length > 0 ? platforms : undefined }) },
      true
    );
    return response;
  },

  // Get account-level social analytics (followers, demographics)
  getAccountAnalytics: async (platforms?: string[], quarters?: number): Promise<any> => {
    const body: any = {};
    if (platforms && platforms.length > 0) body.platforms = platforms;
    if (quarters) body.quarters = quarters;
    const response = await apiCall<any>(
      '/analytics/social-analytics',
      { method: 'POST', body: JSON.stringify(body) },
      true
    );
    return response;
  },

  // Get daily time-series analytics
  getDailyAnalytics: async (platforms?: string[]): Promise<any> => {
    const body: any = {};
    if (platforms && platforms.length > 0) body.platforms = platforms;
    const response = await apiCall<any>(
      '/analytics/daily-analytics',
      { method: 'POST', body: JSON.stringify(body) },
      true
    );
    return response;
  },

  // Get historical analytics snapshots for trend charts
  getAnalyticsHistory: async (days: number = 30): Promise<any> => {
    return await apiCall<any>(
      `/analytics/history?days=${days}`,
      { method: 'GET' },
      true
    );
  },

  // Manually trigger a snapshot for the current user
  takeSnapshotNow: async (): Promise<any> => {
    return await apiCall<any>(
      '/analytics/snapshot-now',
      { method: 'POST' },
      true
    );
  },

  // ============================================
  // AYRSHARE ADS / BOOST
  // ============================================

  // Get Facebook/Instagram ad accounts
  getAdAccounts: async (): Promise<any> => {
    const response = await apiCall<any>('/ads/accounts', { method: 'GET' }, true);
    return response;
  },

  // Boost a post (Instagram-style flow with all Ayrshare params)
  boostPost: async (params: {
    postId: string;
    adAccountId: string;
    goal?: string;
    dailyBudget: number;
    bidAmount?: number;
    startDate?: string;
    endDate?: string;
    locations?: { countries?: string[]; regions?: string[]; cities?: string[] };
    excludedLocations?: { countries?: string[]; regions?: string[]; cities?: string[] };
    minAge?: number;
    maxAge?: number;
    gender?: string;
    interests?: (string | number)[];
    specialAdCategories?: string[];
    tracking?: { pixelId: string };
    urlTags?: string[];
    dsaBeneficiary?: string;
    dsaPayor?: string;
  }): Promise<any> => {
    const response = await apiCall<any>(
      '/ads/boost',
      { method: 'POST', body: JSON.stringify(params) },
      true
    );
    return response;
  },

  // Get all boosted ads
  getBoostedAds: async (status?: string, limit?: number): Promise<any> => {
    let url = '/ads/boosted';
    const params: string[] = [];
    if (status) params.push(`status=${status}`);
    if (limit) params.push(`limit=${limit}`);
    if (params.length) url += '?' + params.join('&');
    const response = await apiCall<any>(url, { method: 'GET' }, true);
    return response;
  },

  // Update an ad (pause/resume/change budget)
  updateAd: async (adId: string, params: { status?: string; dailyBudget?: number; endDate?: string }): Promise<any> => {
    const response = await apiCall<any>(
      `/ads/${adId}`,
      { method: 'PUT', body: JSON.stringify(params) },
      true
    );
    return response;
  },

  // Get ad spend history
  getAdHistory: async (startDate?: string, endDate?: string): Promise<any> => {
    let url = '/ads/history';
    const params: string[] = [];
    if (startDate) params.push(`startDate=${startDate}`);
    if (endDate) params.push(`endDate=${endDate}`);
    if (params.length) url += '?' + params.join('&');
    const response = await apiCall<any>(url, { method: 'GET' }, true);
    return response;
  },

  // Search interests for ad targeting
  searchAdInterests: async (query: string): Promise<any> => {
    const response = await apiCall<any>(`/ads/interests?query=${encodeURIComponent(query)}`, { method: 'GET' }, true);
    return response;
  },

  // ============================================
  // REAL-TIME DATA APIs (Ayrshare, Apify)
  // ============================================

  // Get real-time competitor data using Apify scraping
  getRealCompetitorData: async (competitorId: string, platform: string = 'instagram'): Promise<any> => {
    const response = await apiCall<any>(
      `/competitors/real/${competitorId}?platform=${platform}`,
      { method: 'GET' },
      true
    );
    return response;
  },

  // Scrape competitors by type (local, national, global, etc.)
  scrapeCompetitorsByType: async (competitorType: string): Promise<any> => {
    const response = await apiCall<any>(
      '/competitors/scrape-by-type',
      { method: 'POST', body: JSON.stringify({ competitorType }) },
      true
    );
    return response;
  },

  // Scrape all active competitors
  scrapeAllCompetitors: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/competitors/scrape-all',
      { method: 'POST' },
      true
    );
    return response;
  },

  // Refresh competitor posts with REAL data from social media (Apify)
  refreshRealCompetitorPosts: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/dashboard/refresh-competitor-posts',
      { method: 'POST' },
      true
    );
    return response;
  },

  // Post to social media via Ayrshare
  postToSocial: async (platforms: string[], content: string, options?: { mediaUrls?: string[]; scheduledDate?: string }): Promise<any> => {
    const response = await apiCall<any>(
      '/social/post',
      { method: 'POST', body: JSON.stringify({ platforms, content, ...options }) },
      true
    );
    return response;
  },

  // Publish a campaign to social media with selected platforms (immediate or scheduled)
  publishCampaign: async (campaignId: string, platforms?: string[], scheduledFor?: string): Promise<any> => {
    const response = await apiCall<any>(
      `/campaigns/${campaignId}/publish`,
      { method: 'POST', body: JSON.stringify({ platforms, scheduledFor }) },
      true
    );
    return response;
  },

  // Get real analytics for a campaign
  getCampaignRealAnalytics: async (campaignId: string): Promise<any> => {
    const response = await apiCall<any>(
      `/campaigns/${campaignId}/analytics`,
      { method: 'GET' },
      true
    );
    return response;
  },

  // Get social media analytics from Ayrshare
  getSocialAnalytics: async (platform: string): Promise<any> => {
    const response = await apiCall<any>(
      `/social/analytics/${platform}`,
      { method: 'GET' },
      true
    );
    return response;
  },

  // Check API integration status
  checkApiStatus: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/social/api-status',
      { method: 'GET' },
      true
    );
    return response;
  },

  // Get dashboard with real-time data
  getDashboardRealTime: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/dashboard/real-competitors',
      { method: 'GET' },
      true
    );
    return response;
  },

  // Get social followers for dashboard bar chart
  getSocialFollowers: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/dashboard/social-followers',
      { method: 'GET' },
      true
    );
    return response;
  },

  // Quick analyze website for onboarding
  analyzeWebsite: async (websiteUrl: string): Promise<any> => {
    const response = await apiCall<any>(
      '/brand/quick-analyze',
      { method: 'POST', body: JSON.stringify({ websiteUrl }) },
      true
    );
    return response;
  },

  // ============================================
  // A/B TESTING
  // ============================================

  getABTests: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/abtest',
      { method: 'GET' },
      true
    );
    return response;
  },

  createABTest: async (data: any): Promise<any> => {
    const response = await apiCall<any>(
      '/abtest/create',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  analyzeABTest: async (testId: string): Promise<any> => {
    const response = await apiCall<any>(
      `/abtest/${testId}/analyze`,
      { method: 'POST' },
      true
    );
    return response;
  },

  selectABTestWinner: async (testId: string, variationId: string): Promise<any> => {
    const response = await apiCall<any>(
      `/abtest/${testId}/select-winner`,
      { method: 'POST', body: JSON.stringify({ variationId }) },
      true
    );
    return response;
  },

  // ============================================
  // GOAL TRACKING
  // ============================================

  getGoals: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/goals',
      { method: 'GET' },
      true
    );
    return response;
  },

  createGoal: async (data: any): Promise<any> => {
    const response = await apiCall<any>(
      '/goals/create',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  updateGoalProgress: async (goalId: string, newValue: number): Promise<any> => {
    const response = await apiCall<any>(
      `/goals/${goalId}/progress`,
      { method: 'PUT', body: JSON.stringify({ currentValue: newValue }) },
      true
    );
    return response;
  },

  // ============================================
  // ONBOARDING TOUR
  // ============================================

  getTourProgress: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/onboarding-tour/tour-config',
      { method: 'GET' },
      true
    );
    return response;
  },

  updateTourProgress: async (data: { currentStep: number; completedSteps: string[] }): Promise<any> => {
    const response = await apiCall<any>(
      '/onboarding-tour/tour-progress',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  completeTour: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/onboarding-tour/tour-progress',
      { method: 'POST', body: JSON.stringify({ isCompleted: true }) },
      true
    );
    return response;
  },

  // ============================================
  // IMAGE REGENERATION
  // ============================================

  regenerateImage: async (data: { prompt?: string; style?: string; campaignId?: string; industry?: string; platform?: string; originalImagePrompt?: string; caption?: string; currentImageUrl?: string }): Promise<any> => {
    const response = await apiCall<any>(
      '/content/regenerate-image',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  // ============================================
  // REACHOUTS CRM
  // ============================================

  // Onboarding Context
  getReachoutContext: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/context',
      { method: 'GET' },
      true
    );
    return response;
  },

  updateReachoutContext: async (data: any): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/context',
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  checkReachoutReadiness: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/readiness',
      { method: 'GET' },
      true
    );
    return response;
  },

  // Leads
  getLeads: async (params?: { status?: string; source?: string; search?: string; page?: number; limit?: number }): Promise<any> => {
    // Filter out undefined values to avoid sending "undefined" strings
    const cleanParams: Record<string, string> = {};
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          cleanParams[key] = String(value);
        }
      });
    }
    const queryString = Object.keys(cleanParams).length > 0 
      ? '?' + new URLSearchParams(cleanParams).toString() 
      : '';
    console.log('[getLeads] Query string:', queryString);
    const response = await apiCall<any>(
      `/reachouts/leads${queryString}`,
      { method: 'GET' },
      true
    );
    return response;
  },

  getLeadStats: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/leads/stats',
      { method: 'GET' },
      true
    );
    return response;
  },

  getLead: async (id: string): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/leads/${id}`,
      { method: 'GET' },
      true
    );
    return response;
  },

  createLead: async (data: any): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/leads',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  updateLead: async (id: string, data: any): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/leads/${id}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  deleteLead: async (id: string): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/leads/${id}`,
      { method: 'DELETE' },
      true
    );
    return response;
  },

  addLeadActivity: async (id: string, activity: any): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/leads/${id}/activity`,
      { method: 'POST', body: JSON.stringify(activity) },
      true
    );
    return response;
  },

  importLeads: async (leads: any[]): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/leads/import',
      { method: 'POST', body: JSON.stringify({ leads }) },
      true
    );
    return response;
  },

  // AI Generation
  generateEmail: async (data: { leadId: string; type?: string; options?: any }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/generate/email',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  generateCallScript: async (data: { leadId: string; options?: any }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/generate/call-script',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  generateLinkedIn: async (data: { leadId: string; type?: string; options?: any }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/generate/linkedin',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  generateObjectionHandling: async (data?: { leadId?: string; options?: any }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/generate/objections',
      { method: 'POST', body: JSON.stringify(data || {}) },
      true
    );
    return response;
  },

  generateContentVariations: async (data: { leadId: string; contentType?: string; variations?: number; options?: any }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/generate/variations',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  regenerateWithFeedback: async (data: { leadId: string; contentType: string; previousContent: any; feedback: string }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/generate/regenerate',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  // File Upload
  uploadLeadsFile: async (file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${API_BASE_URL}/reachouts/leads/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to upload file');
    }
    return data;
  },

  previewLeadsFile: async (file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const token = localStorage.getItem('authToken');
    const response = await fetch(`${API_BASE_URL}/reachouts/leads/upload/preview`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to preview file');
    }
    return data;
  },

  getIntegrations: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/integrations',
      { method: 'GET' },
      true
    );
    return response;
  },

  // Sequences
  getSequences: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/sequences',
      { method: 'GET' },
      true
    );
    return response;
  },

  createSequence: async (data: any): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/sequences',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  updateSequence: async (id: string, data: any): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/sequences/${id}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  deleteSequence: async (id: string): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/sequences/${id}`,
      { method: 'DELETE' },
      true
    );
    return response;
  },

  enrollInSequence: async (sequenceId: string, leadIds: string[]): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/sequences/${sequenceId}/enroll`,
      { method: 'POST', body: JSON.stringify({ leadIds }) },
      true
    );
    return response;
  },

  // Email Campaigns
  generateEmailSequence: async (data: { 
    leadIds: string[]; 
    campaignType?: string; 
    numFollowUps?: number;
    customInstructions?: string;
  }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/campaigns/generate-sequence',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  createEmailCampaign: async (data: any): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/campaigns',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  getEmailCampaigns: async (): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/campaigns',
      { method: 'GET' },
      true
    );
    return response;
  },

  getEmailCampaign: async (id: string): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/campaigns/${id}`,
      { method: 'GET' },
      true
    );
    return response;
  },

  updateEmailCampaign: async (id: string, data: any): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/campaigns/${id}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
    return response;
  },

  sendEmailCampaign: async (id: string, stage?: string): Promise<any> => {
    const response = await apiCall<any>(
      `/reachouts/campaigns/${id}/send`,
      { method: 'POST', body: JSON.stringify({ stage: stage || 'initial' }) },
      true
    );
    return response;
  },

  // Email Configuration
  configureEmail: async (config: {
    provider: 'sendgrid' | 'gmail' | 'outlook' | 'smtp';
    email?: string;
    apiKey?: string;
    appPassword?: string;
    password?: string;
    host?: string;
    port?: number;
  }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/email/configure',
      { method: 'POST', body: JSON.stringify(config) },
      true
    );
    return response;
  },

  sendTestEmail: async (to: string): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/email/test',
      { method: 'POST', body: JSON.stringify({ to }) },
      true
    );
    return response;
  },

  sendDirectEmails: async (data: {
    recipients: Array<{ email: string; firstName?: string; lastName?: string; company?: { name?: string }; role?: string }>;
    subject: string;
    body: string;
    senderEmail: string;
    senderName?: string;
  }): Promise<any> => {
    const response = await apiCall<any>(
      '/reachouts/email/send-direct',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
    return response;
  },
};

// ================================
// Brand Assets API
// ================================
export const brandAssetsAPI = {
  // Get all brand assets
  getAll: async (type?: 'logo' | 'template'): Promise<any> => {
    const query = type ? `?type=${type}` : '';
    return await apiCall<any>(`/brand-assets${query}`, {}, true);
  },

  // Get only logos
  getLogos: async (): Promise<any> => {
    return await apiCall<any>('/brand-assets/logos', {}, true);
  },

  // Get only templates
  getTemplates: async (): Promise<any> => {
    return await apiCall<any>('/brand-assets/templates', {}, true);
  },

  // Get primary logo
  getPrimaryLogo: async (): Promise<any> => {
    return await apiCall<any>('/brand-assets/primary-logo', {}, true);
  },

  // Upload a new asset (logo or template)
  upload: async (data: {
    imageData: string;
    type: 'logo' | 'template';
    name: string;
    isPrimary?: boolean;
    defaultPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    defaultSize?: 'small' | 'medium' | 'large';
  }): Promise<any> => {
    return await apiCall<any>(
      '/brand-assets/upload',
      { method: 'POST', body: JSON.stringify(data) },
      true
    );
  },

  // Update an asset
  update: async (id: string, data: {
    name?: string;
    isPrimary?: boolean;
    defaultPosition?: string;
    defaultSize?: string;
  }): Promise<any> => {
    return await apiCall<any>(
      `/brand-assets/${id}`,
      { method: 'PUT', body: JSON.stringify(data) },
      true
    );
  },

  // Set a logo as primary
  setPrimary: async (id: string): Promise<any> => {
    return await apiCall<any>(
      `/brand-assets/${id}/set-primary`,
      { method: 'PUT' },
      true
    );
  },

  // Delete an asset
  delete: async (id: string): Promise<any> => {
    return await apiCall<any>(
      `/brand-assets/${id}`,
      { method: 'DELETE' },
      true
    );
  },
};

// ============================================
// ICP & CHANNEL STRATEGY API
// ============================================
export const icpStrategyService = {
  // Fetch ICP from DB (auto-generates if not exists)
  fetch: async (): Promise<any> => {
    try {
      return await apiCall<any>('/campaigns/icp-strategy', { method: 'GET' }, true);
    } catch (error) {
      console.error('ICP fetch error:', error);
      return { success: false, icp: null, channelStrategy: [], businessName: '' };
    }
  },

  // Force regenerate via AI
  regenerate: async (): Promise<any> => {
    try {
      return await apiCall<any>('/campaigns/icp-strategy?regenerate=true', { method: 'GET' }, true);
    } catch (error) {
      console.error('ICP regenerate error:', error);
      return { success: false, icp: null, channelStrategy: [], businessName: '' };
    }
  },

  // Save user edits to DB
  save: async (icp: any, channelStrategy?: any): Promise<any> => {
    try {
      return await apiCall<any>(
        '/campaigns/icp-strategy',
        { method: 'PUT', body: JSON.stringify({ icp, channelStrategy }) },
        true
      );
    } catch (error) {
      console.error('ICP save error:', error);
      return { success: false };
    }
  }
};

// ============================================
// PAYMENT / RAZORPAY
// ============================================

export const paymentService = {
  createOrder: async (): Promise<any> => {
    return apiCall<any>('/payment/create-order', { method: 'POST' }, true);
  },

  verify: async (data: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }): Promise<any> => {
    return apiCall<any>('/payment/verify', { method: 'POST', body: JSON.stringify(data) }, true);
  },

  status: async (): Promise<any> => {
    return apiCall<any>('/payment/status', { method: 'GET' }, true);
  },

  billing: async (): Promise<any> => {
    return apiCall<any>('/payment/billing', { method: 'GET' }, true);
  }
};
