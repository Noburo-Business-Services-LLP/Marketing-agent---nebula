import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import {
  BarChart3, TrendingUp, Users, Eye, Heart, MessageSquare,
  Share2, Loader2, RefreshCw, Instagram, Facebook, Twitter, Linkedin,
  ArrowUpRight, ArrowDownRight, ChevronDown, Calendar, DollarSign,
  Pause, Play, ExternalLink, Search, Zap, Target, AlertCircle,
  Megaphone
} from 'lucide-react';

// Platform icon map
const PlatformIcon: React.FC<{ platform: string; className?: string }> = ({ platform, className = 'w-5 h-5' }) => {
  switch (platform?.toLowerCase()) {
    case 'instagram': return <Instagram className={className} />;
    case 'facebook': return <Facebook className={className} />;
    case 'twitter': return <Twitter className={className} />;
    case 'linkedin': return <Linkedin className={className} />;
    default: return <BarChart3 className={className} />;
  }
};

const platformColors: Record<string, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  twitter: '#1DA1F2',
  linkedin: '#0A66C2',
};

type TabType = 'overview' | 'posts' | 'ads' | 'history';

const Analytics: React.FC = () => {
  const { isDarkMode } = useTheme();
  const tc = getThemeClasses(isDarkMode);

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(true);
  const [accountAnalytics, setAccountAnalytics] = useState<any>(null);
  const [dailyAnalytics, setDailyAnalytics] = useState<any>(null);
  const [boostedAds, setBoostedAds] = useState<any[]>([]);
  const [adHistory, setAdHistory] = useState<any>(null);
  const [postAnalytics, setPostAnalytics] = useState<Record<string, any>>({});
  const [postLoading, setPostLoading] = useState<Record<string, boolean>>({});
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [adLoadError, setAdLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Load data on mount
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    setError('');
    try {
      const [accountRes, dailyRes, campaignsRes] = await Promise.allSettled([
        apiService.getAccountAnalytics(), // Backend auto-detects connected platforms
        apiService.getDailyAnalytics(),
        apiService.getCampaigns(),
      ]);

      if (accountRes.status === 'fulfilled' && accountRes.value?.success) {
        setAccountAnalytics(accountRes.value.analytics);
      }
      if (dailyRes.status === 'fulfilled' && dailyRes.value?.success) {
        setDailyAnalytics(dailyRes.value.analytics);
      }
      if (campaignsRes.status === 'fulfilled') {
        const cList = campaignsRes.value?.campaigns || campaignsRes.value || [];
        // Only show published campaigns (those with socialPostId)
        setCampaigns(Array.isArray(cList) ? cList.filter((c: any) => c.socialPostId) : []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load analytics');
    }
    setLoading(false);
  };

  const loadAdsData = async () => {
    setAdLoadError('');
    try {
      const [adsRes, historyRes] = await Promise.allSettled([
        apiService.getBoostedAds(),
        apiService.getAdHistory(),
      ]);
      if (adsRes.status === 'fulfilled' && adsRes.value?.success) {
        setBoostedAds(Array.isArray(adsRes.value.ads) ? adsRes.value.ads : []);
      }
      if (historyRes.status === 'fulfilled' && historyRes.value?.success) {
        setAdHistory(historyRes.value.history);
      }
    } catch (err: any) {
      setAdLoadError(err.message || 'Failed to load ads data');
    }
  };

  // Load ads tab data when switching
  useEffect(() => {
    if (activeTab === 'ads' || activeTab === 'history') {
      loadAdsData();
    }
  }, [activeTab]);

  // Pre-fetch post analytics when switching to Posts tab
  useEffect(() => {
    if (activeTab === 'posts') {
      campaigns.forEach(c => {
        if (c.socialPostId) loadPostAnalytics(c.socialPostId);
      });
    }
  }, [activeTab, campaigns.length]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setPostAnalytics({}); // Clear cached post analytics so fresh data is fetched
    await loadAllData();
    if (activeTab === 'ads' || activeTab === 'history') await loadAdsData();
    setRefreshing(false);
  };

  const loadPostAnalytics = async (postId: string) => {
    // Always fetch fresh data — no caching, live analytics
    setPostLoading(prev => ({ ...prev, [postId]: true }));
    try {
      const res = await apiService.getPostAnalytics(postId);
      console.log('Post analytics response for', postId, ':', res);
      if (res?.success) {
        setPostAnalytics(prev => ({ ...prev, [postId]: res.analytics }));
      }
    } catch (err) {
      console.error('Failed to load post analytics:', err);
    } finally {
      setPostLoading(prev => ({ ...prev, [postId]: false }));
    }
  };

  const handlePauseResume = async (adId: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      await apiService.updateAd(adId, { status: newStatus });
      await loadAdsData(); // Refresh
    } catch (err) {
      console.error('Failed to update ad:', err);
    }
  };

  // ===== RENDER HELPERS =====

  const formatNumber = (num: number) => {
    if (!num && num !== 0) return '—';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'posts', label: 'Post Analytics', icon: <Eye className="w-4 h-4" /> },
    { key: 'ads', label: 'Boosted Ads', icon: <Megaphone className="w-4 h-4" /> },
    { key: 'history', label: 'Ad History', icon: <DollarSign className="w-4 h-4" /> },
  ];

  // ===== LOADING STATE =====
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#ffcc29] mx-auto mb-3" />
          <p className={tc.textSecondary}>Loading analytics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${tc.text}`}>Analytics & Ads</h1>
          <p className={`text-sm mt-1 ${tc.textSecondary}`}>Track performance across all your social platforms and manage boosted posts</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tc.btnSecondary}`}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className={`flex gap-1 p-1 rounded-xl ${isDarkMode ? 'bg-[#0d1117]' : 'bg-gray-100'}`}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
              activeTab === tab.key
                ? 'bg-[#ffcc29] text-[#070A12] shadow-sm'
                : isDarkMode
                  ? 'text-slate-400 hover:text-[#ededed] hover:bg-slate-800'
                  : 'text-gray-500 hover:text-[#070A12] hover:bg-gray-200'
            }`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab
          accountAnalytics={accountAnalytics}
          dailyAnalytics={dailyAnalytics}
          isDarkMode={isDarkMode}
          tc={tc}
          formatNumber={formatNumber}
        />
      )}

      {activeTab === 'posts' && (
        <PostAnalyticsTab
          campaigns={campaigns}
          postAnalytics={postAnalytics}
          postLoading={postLoading}
          loadPostAnalytics={loadPostAnalytics}
          isDarkMode={isDarkMode}
          tc={tc}
          formatNumber={formatNumber}
        />
      )}

      {activeTab === 'ads' && (
        <AdsTab
          boostedAds={boostedAds}
          onPauseResume={handlePauseResume}
          error={adLoadError}
          isDarkMode={isDarkMode}
          tc={tc}
          formatNumber={formatNumber}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab
          adHistory={adHistory}
          isDarkMode={isDarkMode}
          tc={tc}
          formatNumber={formatNumber}
        />
      )}
    </div>
  );
};

// ============================================
// OVERVIEW TAB
// ============================================

const OverviewTab: React.FC<{
  accountAnalytics: any;
  dailyAnalytics: any;
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ accountAnalytics, dailyAnalytics, isDarkMode, tc, formatNumber }) => {
  
  // Extract platform data - filter out 'status' key and non-object values
  const platforms = accountAnalytics 
    ? Object.keys(accountAnalytics).filter(k => k !== 'status' && typeof accountAnalytics[k] === 'object') 
    : [];

  // Normalize Ayrshare analytics data - it comes nested under .analytics with varying field names
  const getNormalizedData = (platform: string) => {
    const raw = accountAnalytics[platform];
    if (!raw) return null;
    // Data may be at raw.analytics or directly on raw
    const d = raw.analytics || raw;
    return {
      followers: d.followersCount ?? d.followers ?? d.fanCount ?? undefined,
      following: d.followingCount ?? d.following ?? undefined,
      posts: d.postsCount ?? d.posts ?? d.mediaCount ?? undefined,
      engagementRate: d.engagementRate ?? d.engagement_rate ?? undefined,
      reach: d.reach ?? undefined,
      impressions: d.impressions ?? undefined,
      name: d.name ?? d.username ?? undefined,
      // Facebook-specific
      likes: d.fanCount ?? d.likes ?? undefined,
      // Extra info
      profileUrl: d.link ?? d.profileUrl ?? undefined,
    };
  };

  return (
    <div className="space-y-6">
      {/* Platform Overview Cards */}
      {platforms.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {platforms.map(platform => {
            const rawData = accountAnalytics[platform];
            if (!rawData || rawData.error) return null;
            const data = getNormalizedData(platform);
            if (!data) return null;
            const color = platformColors[platform] || '#ffcc29';
            return (
              <div key={platform} className={`rounded-xl p-5 ${tc.card}`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: `${color}20` }}>
                    <PlatformIcon platform={platform} className="w-5 h-5" />
                  </div>
                  <span className={`font-semibold capitalize ${tc.text}`}>
                    {data.name || platform}
                  </span>
                </div>
                <div className="space-y-3">
                  {data.followers !== undefined && (
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Followers</span>
                      <span className={`font-semibold ${tc.text}`}>{formatNumber(data.followers)}</span>
                    </div>
                  )}
                  {platform === 'facebook' && data.likes !== undefined && (
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Page Likes</span>
                      <span className={`font-semibold ${tc.text}`}>{formatNumber(data.likes)}</span>
                    </div>
                  )}
                  {data.following !== undefined && (
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Following</span>
                      <span className={`font-semibold ${tc.text}`}>{formatNumber(data.following)}</span>
                    </div>
                  )}
                  {data.posts !== undefined && (
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Posts</span>
                      <span className={`font-semibold ${tc.text}`}>{formatNumber(data.posts)}</span>
                    </div>
                  )}
                  {data.engagementRate !== undefined && (
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Engagement</span>
                      <span className="font-semibold text-green-400">{data.engagementRate}%</span>
                    </div>
                  )}
                  {data.reach !== undefined && (
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Reach</span>
                      <span className={`font-semibold ${tc.text}`}>{formatNumber(data.reach)}</span>
                    </div>
                  )}
                  {data.impressions !== undefined && (
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Impressions</span>
                      <span className={`font-semibold ${tc.text}`}>{formatNumber(data.impressions)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={`rounded-xl p-8 text-center ${tc.card}`}>
          <BarChart3 className={`w-12 h-12 mx-auto mb-3 ${tc.textMuted}`} />
          <p className={`font-medium ${tc.text}`}>No analytics data yet</p>
          <p className={`text-sm mt-1 ${tc.textSecondary}`}>Connect your social accounts and publish posts to see analytics here</p>
        </div>
      )}

      {/* Aggregated Metrics */}
      {platforms.length > 0 && (
        <div className={`rounded-xl p-6 ${tc.card}`}>
          <h3 className={`text-lg font-semibold mb-4 ${tc.text}`}>Cross-Platform Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: 'Total Followers',
                value: platforms.reduce((sum, p) => sum + (getNormalizedData(p)?.followers || 0), 0),
                icon: <Users className="w-5 h-5" />,
                color: 'text-blue-400',
              },
              {
                label: 'Total Reach',
                value: platforms.reduce((sum, p) => sum + (getNormalizedData(p)?.reach || 0), 0),
                icon: <Eye className="w-5 h-5" />,
                color: 'text-purple-400',
              },
              {
                label: 'Total Impressions',
                value: platforms.reduce((sum, p) => sum + (getNormalizedData(p)?.impressions || 0), 0),
                icon: <TrendingUp className="w-5 h-5" />,
                color: 'text-green-400',
              },
              {
                label: 'Total Posts',
                value: platforms.reduce((sum, p) => sum + (getNormalizedData(p)?.posts || 0), 0),
                icon: <MessageSquare className="w-5 h-5" />,
                color: 'text-orange-400',
              },
            ].map((metric, i) => (
              <div key={i} className={`p-4 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                <div className={`${metric.color} mb-2`}>{metric.icon}</div>
                <p className={`text-2xl font-bold ${tc.text}`}>{formatNumber(metric.value)}</p>
                <p className={`text-xs mt-1 ${tc.textSecondary}`}>{metric.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Analytics Chart (simple bar representation) */}
      {dailyAnalytics && (
        <div className={`rounded-xl p-6 ${tc.card}`}>
          <h3 className={`text-lg font-semibold mb-4 ${tc.text}`}>Daily Engagement Trends</h3>
          <DailyChart data={dailyAnalytics} isDarkMode={isDarkMode} tc={tc} />
        </div>
      )}
    </div>
  );
};

// Simple daily chart visualization
const DailyChart: React.FC<{ data: any; isDarkMode: boolean; tc: any }> = ({ data, isDarkMode, tc }) => {
  // Try to extract daily data points from the API response
  const platforms = data ? Object.keys(data).filter(k => typeof data[k] === 'object') : [];
  
  if (platforms.length === 0) {
    return <p className={`text-sm ${tc.textSecondary}`}>No daily data available</p>;
  }

  return (
    <div className="space-y-4">
      {platforms.map(platform => {
        const platformData = data[platform];
        if (!platformData || platformData.error) return null;
        
        // Try to find daily array in the response
        const dailyEntries = platformData.daily || platformData.dailyData || platformData.data || [];
        if (!Array.isArray(dailyEntries) || dailyEntries.length === 0) {
          return (
            <div key={platform} className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 mb-2">
                <PlatformIcon platform={platform} className="w-4 h-4" />
                <span className={`text-sm font-medium capitalize ${tc.text}`}>{platform}</span>
              </div>
              <p className={`text-xs ${tc.textSecondary}`}>Daily breakdown data available in account</p>
            </div>
          );
        }

        const maxVal = Math.max(...dailyEntries.map((d: any) => d.impressions || d.reach || d.engagement || 1));

        return (
          <div key={platform} className={`p-4 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
            <div className="flex items-center gap-2 mb-3">
              <PlatformIcon platform={platform} className="w-4 h-4" />
              <span className={`text-sm font-medium capitalize ${tc.text}`}>{platform}</span>
            </div>
            <div className="flex items-end gap-1 h-24">
              {dailyEntries.slice(-14).map((entry: any, i: number) => {
                const val = entry.impressions || entry.reach || entry.engagement || 0;
                const height = maxVal > 0 ? Math.max((val / maxVal) * 100, 4) : 4;
                const color = platformColors[platform] || '#ffcc29';
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t-sm transition-all"
                      style={{ height: `${height}%`, backgroundColor: color, opacity: 0.8, minHeight: '3px' }}
                      title={`${entry.date || ''}: ${val.toLocaleString()}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ============================================
// POST ANALYTICS TAB
// ============================================

const ShimmerRow: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => (
  <div className="animate-pulse space-y-3 py-2">
    <div className="flex items-center gap-3">
      <div className={`w-7 h-7 rounded-md ${isDarkMode ? 'bg-slate-700/50' : 'bg-gray-200'}`} />
      <div className={`h-4 w-20 rounded ${isDarkMode ? 'bg-slate-700/50' : 'bg-gray-200'}`} />
    </div>
    <div className="flex flex-wrap gap-2">
      {[...Array(6)].map((_, i) => (
        <div key={i} className={`h-10 w-28 rounded-full ${isDarkMode ? 'bg-slate-700/30' : 'bg-gray-100'}`} />
      ))}
    </div>
  </div>
);

const PostAnalyticsTab: React.FC<{
  campaigns: any[];
  postAnalytics: Record<string, any>;
  postLoading: Record<string, boolean>;
  loadPostAnalytics: (postId: string) => void;
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ campaigns, postAnalytics, postLoading, loadPostAnalytics, isDarkMode, tc, formatNumber }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});

  // Pre-fetch all campaign analytics on mount
  useEffect(() => {
    campaigns.forEach(c => {
      if (c.socialPostId) loadPostAnalytics(c.socialPostId);
    });
  }, [campaigns.length]);

  const handleToggle = (campaignId: string, postId: string) => {
    setExpandedId(prev => prev === campaignId ? null : campaignId);
    if (!postAnalytics[postId]) loadPostAnalytics(postId);
  };

  // Primary metrics — shown in a compact chip row
  const getPrimaryMetrics = (rawData: any) => {
    const d = rawData?.analytics || rawData;
    if (!d) return [];
    const metrics: { key: string; label: string; value: number; color: string; icon: React.ReactNode }[] = [];
    const add = (key: string, label: string, color: string, icon: React.ReactNode, ...fields: string[]) => {
      for (const f of fields) {
        const v = d[f];
        if (v !== undefined && v !== null && typeof v === 'number') {
          metrics.push({ key, label, value: v, color, icon });
          return;
        }
      }
    };
    add('views', 'Views', '#8B5CF6', <Eye className="w-3.5 h-3.5" />, 'viewsCount', 'totalVideoViews', 'videoViews', 'mediaView');
    add('reach', 'Reach', '#3B82F6', <Users className="w-3.5 h-3.5" />, 'reachCount', 'impressionsUnique', 'postImpressionsUnique', 'uniqueImpressionsCount');
    add('impressions', 'Impressions', '#6366F1', <BarChart3 className="w-3.5 h-3.5" />, 'impressionCount');
    add('likes', 'Likes', '#EF4444', <Heart className="w-3.5 h-3.5" />, 'likeCount');
    add('comments', 'Comments', '#F59E0B', <MessageSquare className="w-3.5 h-3.5" />, 'commentsCount', 'commentCount');
    add('shares', 'Shares', '#10B981', <Share2 className="w-3.5 h-3.5" />, 'sharesCount', 'shareCount', 'repostCount');
    add('saves', 'Saves', '#EC4899', <Target className="w-3.5 h-3.5" />, 'savedCount');
    add('engagement', 'Engagement', '#F97316', <Zap className="w-3.5 h-3.5" />, 'engagementCount');
    add('clicks', 'Clicks', '#14B8A6', <ExternalLink className="w-3.5 h-3.5" />, 'clickCount');
    return metrics;
  };

  // Secondary metrics (everything not already shown in primary row)
  const getSecondaryMetrics = (rawData: any) => {
    const d = rawData?.analytics || rawData;
    if (!d) return { items: [] as { label: string; value: number }[], reactions: [] as { type: string; count: number }[] };
    const primaryFields = new Set([
      'viewsCount','totalVideoViews','videoViews','mediaView','reachCount','impressionsUnique',
      'postImpressionsUnique','uniqueImpressionsCount','impressionCount','likeCount','commentsCount',
      'commentCount','sharesCount','shareCount','repostCount','savedCount','engagementCount','engagement','clickCount'
    ]);
    const skipFields = new Set([
      'caption','created','mediaProductType','mediaType','mediaUrls','username','postUrl','id','post','name',
      'embedUrl','thumbnailUrl','thumbnailWidth','thumbnailHeight','tags','url','musicTitle','musicUrl',
      'commentsState','likedBy','likeBy','reactions','postVideoSocialActions','totalVideoReactionsByTypeTotal',
      'totalVideoStoriesByActionType','totalVideoViewTimeByAgeBucketAndGender','totalVideoViewTimeByDistributionType',
      'totalVideoViewTimeByRegionId','totalVideoViewsByDistributionType','media','entities','publicMetrics',
      'nonPublicMetrics','organicMetrics','poll','urls','audienceCities','audienceCountries','audienceGenders',
      'audienceTypes','impressionSources','videoViewRetention','liveBroadcastDetails','liveBroadcast','madeForKids',
      'privacyStatus','publishedAt','channelTitle','description','title','notEnoughViews','viewer','labels',
      'indexedAt','cid','share','comments','lastUpdated','nextUpdate','altText','boardId','boardOwner',
      'boardSectionId','createdAt','creativeType','dominantColor','hasBeenPromoted','isOwner','isStandard',
      'link','note','parentPinId','pinMetrics','productTags','mediaId','subreddit','author','permalink'
    ]);
    const items: { label: string; value: number }[] = [];
    Object.keys(d).forEach(key => {
      if (primaryFields.has(key) || skipFields.has(key)) return;
      const val = d[key];
      if (val !== undefined && val !== null && typeof val === 'number') {
        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace(/Count$/, '').trim();
        items.push({ label, value: val });
      }
    });
    let reactions: { type: string; count: number }[] = [];
    const rxn = d.reactions;
    if (rxn && typeof rxn === 'object' && !Array.isArray(rxn)) {
      reactions = Object.entries(rxn)
        .filter(([k, v]) => k !== 'total' && typeof v === 'number' && (v as number) > 0)
        .map(([type, count]) => ({ type, count: count as number }));
    }
    return { items, reactions };
  };

  // Render one platform's analytics in compact layout
  const renderPlatform = (platform: string, rawData: any, detailKey: string) => {
    const data = rawData?.analytics || rawData;
    if (!data || typeof data !== 'object') return null;

    const primary = getPrimaryMetrics(rawData);
    const { items: secondary, reactions } = getSecondaryMetrics(rawData);
    const mediaType = data.mediaProductType || data.mediaType;
    const caption = data.caption;
    const postUrl = rawData?.postUrl;
    const isDetailOpen = detailsOpen[detailKey];
    const hasDetails = secondary.length > 0 || reactions.length > 0;
    const color = platformColors[platform] || '#ffcc29';

    return (
      <div key={platform}>
        {/* Platform header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md" style={{ backgroundColor: `${color}15` }}>
              <PlatformIcon platform={platform} className="w-4 h-4" />
            </div>
            <span className={`font-semibold capitalize text-sm ${tc.text}`}>{platform}</span>
            {mediaType && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${isDarkMode ? 'bg-[#ffcc29]/10 text-[#ffcc29]' : 'bg-[#ffcc29]/20 text-[#9a7b00]'}`}>
                {mediaType}
              </span>
            )}
          </div>
          {postUrl && (
            <a href={postUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#ffcc29] hover:underline flex items-center gap-1 font-medium">
              View Post <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {caption && (
          <p className={`text-xs mb-2.5 line-clamp-1 italic ${tc.textMuted}`}>"{caption}"</p>
        )}

        {/* Compact metric chips */}
        {primary.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {primary.map(m => (
              <div
                key={m.key}
                className={`inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full text-sm transition-all ${
                  isDarkMode
                    ? 'bg-[#0d1117] border border-slate-700/40 hover:border-slate-600/60'
                    : 'bg-white border border-gray-200 shadow-sm hover:shadow'
                }`}
              >
                <div className="p-1 rounded-full" style={{ backgroundColor: `${m.color}15` }}>
                  <span style={{ color: m.color }}>{m.icon}</span>
                </div>
                <span className={`font-bold ${tc.text}`}>{formatNumber(m.value)}</span>
                <span className={`text-[10px] uppercase tracking-wider ${tc.textMuted}`}>{m.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className={`text-xs ${tc.textMuted}`}>Metrics not available yet — check back in a few hours</p>
        )}

        {/* Expandable details */}
        {hasDetails && (
          <>
            <button
              onClick={() => setDetailsOpen(prev => ({ ...prev, [detailKey]: !prev[detailKey] }))}
              className={`text-[11px] flex items-center gap-1 mt-2.5 font-medium ${isDarkMode ? 'text-slate-500 hover:text-[#ffcc29]' : 'text-gray-400 hover:text-[#ffcc29]'} transition-colors`}
            >
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isDetailOpen ? 'rotate-180' : ''}`} />
              {isDetailOpen ? 'Less' : `+${secondary.length + reactions.length} more metrics`}
            </button>

            {isDetailOpen && (
              <div className={`mt-2 pt-2 border-t ${isDarkMode ? 'border-slate-700/20' : 'border-gray-100'} space-y-2`}>
                {secondary.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {secondary.map((m, i) => (
                      <span key={i} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] ${isDarkMode ? 'bg-[#0d1117] border border-slate-700/30' : 'bg-gray-50 border border-gray-200'}`}>
                        <span className={tc.textMuted}>{m.label}</span>
                        <span className={`font-bold ${tc.text}`}>{formatNumber(m.value)}</span>
                      </span>
                    ))}
                  </div>
                )}
                {reactions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {reactions.map(r => (
                      <span key={r.type} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${isDarkMode ? 'bg-slate-700/20' : 'bg-gray-100'} ${tc.textSecondary}`}>
                        {r.type === 'like' ? '\uD83D\uDC4D' : r.type === 'love' ? '\u2764\uFE0F' : r.type === 'haha' ? '\uD83D\uDE02' : r.type === 'wow' ? '\uD83D\uDE2E' : r.type === 'anger' ? '\uD83D\uDE21' : r.type === 'sorry' ? '\uD83D\uDE22' : r.type === 'praise' ? '\uD83D\uDC4F' : r.type === 'empathy' ? '\uD83D\uDC97' : '\u2022'} {r.type} {formatNumber(r.count)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // Empty state
  if (campaigns.length === 0) {
    return (
      <div className={`rounded-xl p-8 text-center ${tc.card}`}>
        <Eye className={`w-12 h-12 mx-auto mb-3 ${tc.textMuted}`} />
        <p className={`font-medium ${tc.text}`}>No published posts to analyze</p>
        <p className={`text-sm mt-1 ${tc.textSecondary}`}>
          Publish campaigns through the Campaigns page to see post-level analytics here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className={`text-sm ${tc.textSecondary}`}>
        Click on a published campaign to view its real-time analytics
      </p>

      {campaigns.map(campaign => {
        const postId = campaign.socialPostId;
        const analytics = postAnalytics[postId];
        const isExpanded = expandedId === campaign._id;
        const isLoading = postLoading[postId] || false;

        return (
          <div
            key={campaign._id}
            className={`rounded-xl overflow-hidden transition-all ${tc.card} ${
              isExpanded ? (isDarkMode ? 'ring-1 ring-[#ffcc29]/20' : 'ring-1 ring-[#ffcc29]/30') : ''
            }`}
          >
            {/* Campaign header */}
            <button
              onClick={() => handleToggle(campaign._id, postId)}
              className={`w-full flex items-center justify-between p-3.5 text-left transition-colors ${
                isDarkMode ? 'hover:bg-slate-800/30' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-[#ffcc29]/10">
                  <Megaphone className="w-4 h-4 text-[#ffcc29]" />
                </div>
                <div className="min-w-0">
                  <p className={`font-medium text-sm truncate ${tc.text}`}>{campaign.name || 'Untitled Campaign'}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-3 h-3 opacity-40" />
                    <span className={`text-xs ${tc.textMuted}`}>
                      {campaign.publishedAt ? new Date(campaign.publishedAt).toLocaleDateString() : 'Published'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick stats preview when collapsed */}
              <div className="flex items-center gap-3">
                {analytics && !isExpanded && (() => {
                  const pks = Object.keys(analytics).filter(k =>
                    !['status','error','code','id'].includes(k) && typeof analytics[k] === 'object' && analytics[k] !== null
                  );
                  const fp = pks[0];
                  if (!fp) return null;
                  const d = analytics[fp]?.analytics || analytics[fp];
                  if (!d) return null;
                  return (
                    <div className="hidden sm:flex items-center gap-2.5 mr-1">
                      {d.likeCount !== undefined && (
                        <span className={`flex items-center gap-1 text-xs font-medium ${tc.textMuted}`}>
                          <Heart className="w-3 h-3 text-red-400" /> {formatNumber(d.likeCount)}
                        </span>
                      )}
                      {(d.viewsCount ?? d.reachCount) !== undefined && (
                        <span className={`flex items-center gap-1 text-xs font-medium ${tc.textMuted}`}>
                          <Eye className="w-3 h-3 text-purple-400" /> {formatNumber(d.viewsCount ?? d.reachCount)}
                        </span>
                      )}
                      {(d.commentsCount ?? d.commentCount) !== undefined && (
                        <span className={`flex items-center gap-1 text-xs font-medium ${tc.textMuted}`}>
                          <MessageSquare className="w-3 h-3 text-yellow-400" /> {formatNumber(d.commentsCount ?? d.commentCount)}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {isLoading && isExpanded && <Loader2 className="w-4 h-4 animate-spin text-[#ffcc29]" />}
                <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 ${tc.textMuted} ${isExpanded ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {/* Expanded analytics panel */}
            {isExpanded && (
              <div className={`border-t px-4 pb-4 pt-3 relative ${isDarkMode ? 'border-slate-700/30' : 'border-gray-100'}`}>
                {/* Refreshing overlay — shows over existing data */}
                {isLoading && analytics && (
                  <div className="absolute inset-0 flex items-center justify-center z-10 rounded-b-xl" style={{ backgroundColor: isDarkMode ? 'rgba(7,10,18,0.6)' : 'rgba(255,255,255,0.7)' }}>
                    <Loader2 className="w-5 h-5 animate-spin text-[#ffcc29]" />
                  </div>
                )}
                {isLoading && !analytics ? (
                  <ShimmerRow isDarkMode={isDarkMode} />
                ) : analytics && typeof analytics === 'object' && !analytics.error ? (
                  <div className="space-y-4">
                    {(() => {
                      const platformKeys = Object.keys(analytics).filter(k =>
                        !['status', 'error', 'code', 'id'].includes(k) && typeof analytics[k] === 'object' && analytics[k] !== null
                      );
                      if (platformKeys.length > 0) {
                        return platformKeys.map(platform => (
                          <React.Fragment key={platform}>
                            {renderPlatform(platform, analytics[platform], `${campaign._id}-${platform}`)}
                          </React.Fragment>
                        ));
                      } else {
                        return renderPlatform('post', { analytics }, `${campaign._id}-post`);
                      }
                    })()}
                  </div>
                ) : (
                  <p className={`text-sm ${tc.textSecondary}`}>{analytics?.error || 'No analytics yet — metrics appear a few hours after posting'}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ============================================
// ADS TAB
// ============================================

const AdsTab: React.FC<{
  boostedAds: any[];
  onPauseResume: (adId: string, status: string) => void;
  error: string;
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ boostedAds, onPauseResume, error, isDarkMode, tc, formatNumber }) => {

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  if (!boostedAds || boostedAds.length === 0) {
    return (
      <div className={`rounded-xl p-8 text-center ${tc.card}`}>
        <Megaphone className={`w-12 h-12 mx-auto mb-3 ${tc.textMuted}`} />
        <p className={`font-medium ${tc.text}`}>No boosted ads yet</p>
        <p className={`text-sm mt-1 ${tc.textSecondary}`}>
          Boost a published post from the Campaigns page to see your ads here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className={`text-sm ${tc.textSecondary}`}>
        Manage your Facebook & Instagram boosted posts
      </p>
      {boostedAds.map((ad: any, i: number) => {
        const adId = ad.id || ad.adId || ad._id || `ad-${i}`;
        const status = ad.status || ad.effective_status || 'UNKNOWN';
        const isActive = status === 'ACTIVE';

        return (
          <div key={adId} className={`rounded-xl p-5 ${tc.card}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className={`font-medium ${tc.text}`}>{ad.name || ad.adName || `Ad #${i + 1}`}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    isActive
                      ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                      : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-400' : 'bg-yellow-400'}`} />
                    {status}
                  </span>
                  {ad.objective && (
                    <span className={`text-xs ${tc.textMuted}`}>{ad.objective}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => onPauseResume(adId, status)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? isDarkMode ? 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20' : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                    : isDarkMode ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'bg-green-50 text-green-700 hover:bg-green-100'
                }`}
              >
                {isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isActive ? 'Pause' : 'Resume'}
              </button>
            </div>

            {/* Ad Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {ad.dailyBudget !== undefined && (
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${tc.textMuted}`}>Daily Budget</p>
                  <p className={`text-sm font-semibold ${tc.text}`}>${ad.dailyBudget}</p>
                </div>
              )}
              {ad.spend !== undefined && (
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${tc.textMuted}`}>Spent</p>
                  <p className={`text-sm font-semibold ${tc.text}`}>${ad.spend}</p>
                </div>
              )}
              {ad.impressions !== undefined && (
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${tc.textMuted}`}>Impressions</p>
                  <p className={`text-sm font-semibold ${tc.text}`}>{formatNumber(ad.impressions)}</p>
                </div>
              )}
              {ad.reach !== undefined && (
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${tc.textMuted}`}>Reach</p>
                  <p className={`text-sm font-semibold ${tc.text}`}>{formatNumber(ad.reach)}</p>
                </div>
              )}
              {ad.clicks !== undefined && (
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${tc.textMuted}`}>Clicks</p>
                  <p className={`text-sm font-semibold ${tc.text}`}>{formatNumber(ad.clicks)}</p>
                </div>
              )}
            </div>

            {/* Date Range */}
            {(ad.startDate || ad.endDate) && (
              <div className={`flex items-center gap-2 mt-3 text-xs ${tc.textMuted}`}>
                <Calendar className="w-3.5 h-3.5" />
                {ad.startDate && new Date(ad.startDate).toLocaleDateString()}
                {ad.startDate && ad.endDate && ' → '}
                {ad.endDate && new Date(ad.endDate).toLocaleDateString()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ============================================
// HISTORY TAB
// ============================================

const HistoryTab: React.FC<{
  adHistory: any;
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ adHistory, isDarkMode, tc, formatNumber }) => {

  if (!adHistory) {
    return (
      <div className={`rounded-xl p-8 text-center ${tc.card}`}>
        <DollarSign className={`w-12 h-12 mx-auto mb-3 ${tc.textMuted}`} />
        <p className={`font-medium ${tc.text}`}>No ad spend history</p>
        <p className={`text-sm mt-1 ${tc.textSecondary}`}>
          Once you boost posts, daily spend data will appear here
        </p>
      </div>
    );
  }

  // Try to extract daily spend entries
  const entries = Array.isArray(adHistory) ? adHistory : adHistory.data || adHistory.history || [];
  const totalSpend = entries.reduce((sum: number, e: any) => sum + (e.spend || e.amount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`rounded-xl p-5 ${tc.card}`}>
          <DollarSign className="w-5 h-5 text-green-400 mb-2" />
          <p className={`text-2xl font-bold ${tc.text}`}>${totalSpend.toFixed(2)}</p>
          <p className={`text-xs mt-1 ${tc.textSecondary}`}>Total Ad Spend</p>
        </div>
        <div className={`rounded-xl p-5 ${tc.card}`}>
          <Calendar className="w-5 h-5 text-blue-400 mb-2" />
          <p className={`text-2xl font-bold ${tc.text}`}>{entries.length}</p>
          <p className={`text-xs mt-1 ${tc.textSecondary}`}>Days with Spend</p>
        </div>
        <div className={`rounded-xl p-5 ${tc.card}`}>
          <TrendingUp className="w-5 h-5 text-purple-400 mb-2" />
          <p className={`text-2xl font-bold ${tc.text}`}>
            ${entries.length > 0 ? (totalSpend / entries.length).toFixed(2) : '0.00'}
          </p>
          <p className={`text-xs mt-1 ${tc.textSecondary}`}>Avg. Daily Spend</p>
        </div>
      </div>

      {/* Daily Breakdown */}
      {entries.length > 0 && (
        <div className={`rounded-xl overflow-hidden ${tc.card}`}>
          <div className={`px-5 py-3 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-gray-100'}`}>
            <h3 className={`font-semibold ${tc.text}`}>Daily Breakdown</h3>
          </div>
          <div className="divide-y divide-slate-700/30">
            {entries.slice(0, 30).map((entry: any, i: number) => (
              <div key={i} className={`flex items-center justify-between px-5 py-3 ${isDarkMode ? 'hover:bg-slate-800/30' : 'hover:bg-gray-50'}`}>
                <div>
                  <p className={`text-sm font-medium ${tc.text}`}>
                    {entry.date ? new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : `Day ${i + 1}`}
                  </p>
                  {entry.adName && <p className={`text-xs ${tc.textMuted}`}>{entry.adName}</p>}
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${tc.text}`}>${(entry.spend || entry.amount || 0).toFixed(2)}</p>
                  {entry.impressions !== undefined && (
                    <p className={`text-xs ${tc.textMuted}`}>{formatNumber(entry.impressions)} impr.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {entries.length === 0 && !Array.isArray(adHistory) && (
        <div className={`rounded-xl p-5 ${tc.card}`}>
          <p className={`text-sm ${tc.textSecondary}`}>
            Raw history data received. Check back after your first boosted ad runs for detailed daily breakdowns.
          </p>
          <pre className={`mt-3 text-xs p-3 rounded-lg overflow-auto max-h-48 ${isDarkMode ? 'bg-[#070A12] text-slate-400' : 'bg-gray-50 text-gray-600'}`}>
            {JSON.stringify(adHistory, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default Analytics;
