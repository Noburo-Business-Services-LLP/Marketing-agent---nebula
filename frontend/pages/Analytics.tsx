import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import { generateAnalyticsPDF } from '../services/generateAnalyticsPDF';
import {
  BarChart3, TrendingUp, Users, Eye, Heart, MessageSquare,
  Share2, Loader2, RefreshCw, Instagram, Facebook, Twitter, Linkedin,
  ArrowUpRight, ArrowDownRight, ChevronDown, Calendar, DollarSign,
  Pause, Play, ExternalLink, Search, Zap, Target, AlertCircle,
  Megaphone, Download
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
  // dailyAnalytics removed — replaced by Top Post Performance
  const [boostedAds, setBoostedAds] = useState<any[]>([]);
  const [adHistory, setAdHistory] = useState<any>(null);
  const [postAnalytics, setPostAnalytics] = useState<Record<string, any>>({});
  const [postLoading, setPostLoading] = useState<Record<string, boolean>>({});
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [adLoadError, setAdLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  // Load data on mount
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    setError('');
    try {
      const [accountRes, campaignsRes] = await Promise.allSettled([
        apiService.getAccountAnalytics(), // Backend auto-detects connected platforms
        apiService.getCampaigns(),
      ]);

      if (accountRes.status === 'fulfilled' && accountRes.value?.success) {
        setAccountAnalytics(accountRes.value.analytics);
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
      } else if (adsRes.status === 'fulfilled' && adsRes.value && adsRes.value?.success === false) {
        setAdLoadError('Unable to load ad data. Please reconnect your account or try again later.');
      } else if (adsRes.status === 'rejected') {
        setAdLoadError('Unable to load ad data. Please reconnect your account or try again later.');
      }
      if (historyRes.status === 'fulfilled' && historyRes.value?.success) {
        setAdHistory(historyRes.value.history);
      } else if (historyRes.status === 'fulfilled' && historyRes.value && historyRes.value?.success === false) {
        setAdLoadError('Unable to load ad data. Please reconnect your account or try again later.');
      } else if (historyRes.status === 'rejected') {
        setAdLoadError('Unable to load ad data. Please reconnect your account or try again later.');
      }
    } catch (err: any) {
      setAdLoadError('Unable to load ad data. Please reconnect your account or try again later.');
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
        if (c.socialPostId) loadPostAnalytics(c.socialPostId, c.platforms);
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

  const handleDownloadPDF = async () => {
    setGeneratingPDF(true);
    try {
      // Ensure ads data is loaded before generating PDF
      let adsData = boostedAds;
      let historyData = adHistory;
      if (adsData.length === 0 && !historyData) {
        try {
          const [adsRes, historyRes] = await Promise.allSettled([
            apiService.getBoostedAds(),
            apiService.getAdHistory(),
          ]);
          if (adsRes.status === 'fulfilled' && adsRes.value?.success) {
            adsData = Array.isArray(adsRes.value.ads) ? adsRes.value.ads : [];
          }
          if (historyRes.status === 'fulfilled' && historyRes.value?.success) {
            historyData = historyRes.value.history;
          }
        } catch (_) { /* non-critical */ }
      }

      await generateAnalyticsPDF({
        accountAnalytics,
        campaigns,
        postAnalytics,
        boostedAds: adsData,
        adHistory: historyData,
      });
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setGeneratingPDF(false);
    }
  };

  const loadPostAnalytics = async (postId: string, platforms?: string[]) => {
    // Always fetch fresh data — no caching, live analytics
    setPostLoading(prev => ({ ...prev, [postId]: true }));
    try {
      // Use campaign's actual platforms so we don't request analytics for platforms the post wasn't sent to
      const res = await apiService.getPostAnalytics(postId, platforms);
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
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadPDF}
            disabled={generatingPDF || loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[#ffcc29] text-[#070A12] hover:bg-[#e6b825] disabled:opacity-50"
          >
            {generatingPDF
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />}
            {generatingPDF ? 'Generating…' : 'Download PDF'}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tc.btnSecondary}`}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
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
          campaigns={campaigns}
          postAnalytics={postAnalytics}
          loadPostAnalytics={loadPostAnalytics}
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
          error={adLoadError}
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
  campaigns: any[];
  postAnalytics: Record<string, any>;
  loadPostAnalytics: (postId: string, platforms?: string[]) => void;
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ accountAnalytics, campaigns, postAnalytics, loadPostAnalytics, isDarkMode, tc, formatNumber }) => {

  // Auto-fetch post analytics for all published campaigns
  useEffect(() => {
    campaigns.forEach(c => {
      if (c.socialPostId && !postAnalytics[c.socialPostId]) {
        loadPostAnalytics(c.socialPostId, c.platforms);
      }
    });
  }, [campaigns.length]);
  
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
    
    // Helper: extract a numeric value — handles nested objects like LinkedIn's { totalFollowerCount: N }
    const extractNumber = (val: any): number | undefined => {
      if (val === null || val === undefined) return undefined;
      if (typeof val === 'number') return val;
      if (typeof val === 'object') {
        // LinkedIn returns followers as { totalFollowerCount: N, organicFollowerCount: N, ... }
        return val.totalFollowerCount ?? val.total ?? val.count ?? Object.values(val).find((v: any) => typeof v === 'number') as number | undefined;
      }
      const parsed = Number(val);
      return isNaN(parsed) ? undefined : parsed;
    };

    return {
      followers: extractNumber(d.followersCount) ?? extractNumber(d.followers) ?? extractNumber(d.fanCount) ?? extractNumber(d.firstDegreeSize) ?? extractNumber(d.connectionsCount) ?? extractNumber(d.networkSize) ?? undefined,
      following: extractNumber(d.followingCount) ?? extractNumber(d.following) ?? undefined,
      posts: extractNumber(d.postsCount) ?? extractNumber(d.posts) ?? extractNumber(d.mediaCount) ?? undefined,
      engagementRate: extractNumber(d.engagementRate) ?? extractNumber(d.engagement_rate) ?? undefined,
      reach: extractNumber(d.reach) ?? undefined,
      impressions: extractNumber(d.impressions) ?? undefined,
      name: d.name ?? d.username ?? d.localizedFirstName ?? undefined,
      // Facebook-specific
      likes: extractNumber(d.fanCount) ?? extractNumber(d.likes) ?? undefined,
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

      {/* Historical Trends */}
      <HistoricalTrendsChart isDarkMode={isDarkMode} tc={tc} formatNumber={formatNumber} />

      {/* Top Post Performance */}
      {campaigns.length > 0 && (
        <TopPostPerformance
          campaigns={campaigns}
          postAnalytics={postAnalytics}
          isDarkMode={isDarkMode}
          tc={tc}
          formatNumber={formatNumber}
        />
      )}
    </div>
  );
};

// ============================================
// HISTORICAL TRENDS — MULTI-METRIC DASHBOARD
// ============================================

type MetricKey = 'followers' | 'reach' | 'impressions' | 'engagementRate' | 'posts' | 'likes';

const METRIC_CONFIG: Record<MetricKey, { label: string; icon: React.ReactNode; color: string; suffix?: string; totalKey?: string }> = {
  followers: { label: 'Followers', icon: <Users className="w-4 h-4" />, color: '#ffcc29', totalKey: 'followers' },
  reach:     { label: 'Reach', icon: <Eye className="w-4 h-4" />, color: '#8B5CF6', totalKey: 'reach' },
  impressions: { label: 'Impressions', icon: <TrendingUp className="w-4 h-4" />, color: '#10B981', totalKey: 'impressions' },
  engagementRate: { label: 'Engagement %', icon: <Heart className="w-4 h-4" />, color: '#F43F5E', suffix: '%' },
  posts:     { label: 'Posts', icon: <MessageSquare className="w-4 h-4" />, color: '#F59E0B', totalKey: 'posts' },
  likes:     { label: 'Likes', icon: <Heart className="w-4 h-4" />, color: '#EC4899' },
};

const HistoricalTrendsChart: React.FC<{
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ isDarkMode, tc, formatNumber }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [snapshotting, setSnapshotting] = useState(false);
  const [metric, setMetric] = useState<MetricKey>('followers');

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await apiService.getAnalyticsHistory(days);
      if (res?.success) setHistory(res.history || []);
    } catch (e) {}
    setLoading(false);
  };

  const takeSnapshot = async () => {
    setSnapshotting(true);
    try {
      await apiService.takeSnapshotNow();
      await loadHistory();
    } catch (e) {}
    setSnapshotting(false);
  };

  useEffect(() => { loadHistory(); }, [days]);

  const mc = METRIC_CONFIG[metric];

  if (loading) {
    return (
      <div className={`rounded-xl p-6 ${tc.card}`}>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[#ffcc29]" />
          <h3 className={`text-lg font-semibold ${tc.text}`}>Performance Insights</h3>
        </div>
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" />
        </div>
      </div>
    );
  }

  // If no history yet, show a prompt to take first snapshot
  if (history.length === 0) {
    return (
      <div className={`rounded-xl p-6 ${tc.card}`}>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[#ffcc29]" />
          <h3 className={`text-lg font-semibold ${tc.text}`}>Performance Insights</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <BarChart3 className={`w-10 h-10 ${tc.textSecondary}`} />
          <p className={`text-sm ${tc.textSecondary} text-center max-w-md`}>
            Start tracking your growth across followers, reach, engagement and more. Take your first snapshot to unlock performance insights.
          </p>
          <button
            onClick={takeSnapshot}
            disabled={snapshotting}
            className="mt-2 px-4 py-2 bg-[#ffcc29] text-[#070A12] rounded-lg text-sm font-medium hover:bg-[#e6b800] transition-colors flex items-center gap-2"
          >
            {snapshotting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {snapshotting ? 'Collecting...' : 'Take First Snapshot'}
          </button>
        </div>
      </div>
    );
  }

  // Collect all platform keys across all snapshots
  const allPlatforms = [...new Set(history.flatMap(h => Object.keys(h.platforms || {})))];

  // Build chart data with selected metric
  const chartData = history.map(h => {
    const plats = h.platforms || {};
    // For engagement rate, average across platforms instead of sum
    let total = 0;
    if (metric === 'engagementRate') {
      const vals = allPlatforms.map(p => plats[p]?.engagementRate || 0).filter(v => v > 0);
      total = vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0;
    } else if (mc.totalKey && h.totals?.[mc.totalKey] !== undefined) {
      total = h.totals[mc.totalKey];
    } else {
      total = allPlatforms.reduce((sum: number, p: string) => sum + (plats[p]?.[metric] || 0), 0);
    }
    return {
      date: new Date(h.date),
      label: new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      total,
      platforms: plats,
    };
  });

  // Latest snapshot for platform cards
  const latest = history[history.length - 1];
  const previous = history.length >= 2 ? history[history.length - 2] : null;

  // Per-platform latest values for the selected metric
  const platformCards = allPlatforms.map(p => {
    const latestVal = latest?.platforms?.[p]?.[metric] || 0;
    const prevVal = previous?.platforms?.[p]?.[metric] || 0;
    const change = previous ? latestVal - prevVal : 0;
    const changePct = prevVal > 0 ? ((change / prevVal) * 100) : 0;
    return { platform: p, value: latestVal, change, changePct };
  });

  // SVG dimensions
  const W = 700, H = 220, PAD = { top: 20, right: 20, bottom: 35, left: 55 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  // Y scale
  const allValues = chartData.map(d => d.total);
  const rawMax = Math.max(...allValues, 0.01);
  const rawMin = Math.min(...allValues, 0);
  const yMax = rawMax * 1.15;
  const yMin = Math.max(rawMin * 0.85, 0);
  const yRange = yMax - yMin || 1;

  const toX = (i: number) => PAD.left + (i / Math.max(chartData.length - 1, 1)) * cW;
  const toY = (val: number) => PAD.top + cH - ((val - yMin) / yRange) * cH;

  // Build total line
  const totalLine = chartData.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(d.total).toFixed(1)}`).join(' ');
  const areaPath = totalLine + ` L${toX(chartData.length - 1).toFixed(1)},${(PAD.top + cH).toFixed(1)} L${PAD.left},${(PAD.top + cH).toFixed(1)} Z`;

  // Per-platform lines for selected metric
  const platformLinesData = allPlatforms.map(p => {
    const color = platformColors[p] || '#ffcc29';
    const points = chartData.map((d, i) => {
      const val = d.platforms[p]?.[metric] || 0;
      return `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(val).toFixed(1)}`;
    }).join(' ');
    return { platform: p, color, points };
  });

  // Y gridlines
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const val = yMin + (yRange * i) / gridCount;
    return { y: toY(val), label: mc.suffix === '%' ? val.toFixed(1) + '%' : formatNumber(Math.round(val)) };
  });

  // X labels (show max 8)
  const step = Math.max(1, Math.floor(chartData.length / 8));
  const xLabels = chartData.filter((_, i) => i % step === 0 || i === chartData.length - 1);

  // Growth calculations
  const firstVal = chartData[0]?.total || 0;
  const lastVal = chartData[chartData.length - 1]?.total || 0;
  const growthPct = firstVal > 0 ? (((lastVal - firstVal) / firstVal) * 100).toFixed(1) : '0.0';
  const isGrowing = lastVal >= firstVal;

  // Auto-generated insights from data
  const insights: string[] = [];
  if (history.length >= 2) {
    // Best performing platform for this metric
    const best = platformCards.reduce((a, b) => (a.value > b.value ? a : b), platformCards[0]);
    if (best && best.value > 0) {
      insights.push(`${best.platform.charAt(0).toUpperCase() + best.platform.slice(1)} leads with ${mc.suffix === '%' ? best.value.toFixed(1) + '%' : formatNumber(best.value)} ${mc.label.toLowerCase()}`);
    }
    // Biggest grower
    const grower = platformCards.filter(p => p.changePct > 0).sort((a, b) => b.changePct - a.changePct)[0];
    if (grower) {
      insights.push(`${grower.platform.charAt(0).toUpperCase() + grower.platform.slice(1)} grew ${grower.changePct.toFixed(1)}% since last snapshot`);
    }
    // Declining platform
    const decliner = platformCards.filter(p => p.changePct < 0).sort((a, b) => a.changePct - b.changePct)[0];
    if (decliner) {
      insights.push(`${decliner.platform.charAt(0).toUpperCase() + decliner.platform.slice(1)} dropped ${Math.abs(decliner.changePct).toFixed(1)}% — consider refreshing your strategy`);
    }
  } else {
    // Single snapshot — just describe current state
    const best = platformCards.reduce((a, b) => (a.value > b.value ? a : b), platformCards[0]);
    if (best && best.value > 0) {
      insights.push(`${best.platform.charAt(0).toUpperCase() + best.platform.slice(1)} is your strongest for ${mc.label.toLowerCase()} at ${mc.suffix === '%' ? best.value.toFixed(1) + '%' : formatNumber(best.value)}`);
    }
    insights.push('More snapshots will unlock trend comparisons — data auto-collects every 12 hours');
  }

  return (
    <div className={`rounded-xl p-6 ${tc.card}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#ffcc29]" />
          <h3 className={`text-lg font-semibold ${tc.text}`}>Performance Insights</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            isGrowing
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}>
            {isGrowing ? <ArrowUpRight className="w-3 h-3 inline" /> : <ArrowDownRight className="w-3 h-3 inline" />}
            {growthPct}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={takeSnapshot}
            disabled={snapshotting}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
              isDarkMode ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            title="Refresh snapshot"
          >
            {snapshotting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Snapshot
          </button>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                days === d
                  ? 'bg-[#ffcc29] text-[#070A12]'
                  : isDarkMode ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Metric Selector Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {(Object.keys(METRIC_CONFIG) as MetricKey[]).map(key => {
          const cfg = METRIC_CONFIG[key];
          const isActive = metric === key;
          return (
            <button
              key={key}
              onClick={() => setMetric(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? 'text-white shadow-sm'
                  : isDarkMode ? 'bg-slate-800/50 text-slate-400 hover:bg-slate-700' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
              style={isActive ? { backgroundColor: cfg.color } : undefined}
            >
              {cfg.icon}
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* SVG Chart */}
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 400 }}>
          {/* Grid lines */}
          {gridLines.map((g, i) => (
            <g key={i}>
              <line x1={PAD.left} y1={g.y} x2={PAD.left + cW} y2={g.y} stroke={isDarkMode ? '#1e293b' : '#e2e8f0'} strokeWidth="0.5" />
              <text x={PAD.left - 8} y={g.y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={isDarkMode ? '#94a3b8' : '#94a3b8'}>
                {g.label}
              </text>
            </g>
          ))}

          {/* Area fill */}
          <defs>
            <linearGradient id="areaGradTrends" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={mc.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={mc.color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {chartData.length > 1 && <path d={areaPath} fill="url(#areaGradTrends)" />}

          {/* Platform lines */}
          {platformLinesData.map(pl => (
            <path key={pl.platform} d={pl.points} fill="none" stroke={pl.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" strokeDasharray="4 2" />
          ))}

          {/* Total/average line (on top) */}
          <path d={totalLine} fill="none" stroke={mc.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Data points */}
          {chartData.map((d, i) => (
            <circle key={i} cx={toX(i)} cy={toY(d.total)} r="3" fill={mc.color} stroke={isDarkMode ? '#070A12' : '#fff'} strokeWidth="1.5" />
          ))}

          {/* X labels */}
          {xLabels.map((d, i) => {
            const idx = chartData.indexOf(d);
            return (
              <text key={i} x={toX(idx)} y={H - 8} textAnchor="middle" fontSize="10" fill={isDarkMode ? '#94a3b8' : '#94a3b8'}>
                {d.label}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 rounded" style={{ backgroundColor: mc.color }} />
          <span className={`text-xs ${tc.textSecondary}`}>{metric === 'engagementRate' ? 'Avg' : 'Total'} {mc.label}</span>
        </div>
        {allPlatforms.map(p => (
          <div key={p} className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded" style={{ backgroundColor: platformColors[p] || '#ffcc29', opacity: 0.6 }} />
            <span className={`text-xs ${tc.textSecondary} capitalize`}>{p}</span>
          </div>
        ))}
      </div>

      {/* Platform Breakdown Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        {platformCards.map(pc => {
          const color = platformColors[pc.platform] || '#ffcc29';
          const up = pc.change >= 0;
          return (
            <div key={pc.platform} className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1 rounded" style={{ backgroundColor: `${color}20` }}>
                  <PlatformIcon platform={pc.platform} className="w-3.5 h-3.5" />
                </div>
                <span className={`text-xs font-medium capitalize ${tc.text}`}>{pc.platform}</span>
              </div>
              <p className={`text-xl font-bold ${tc.text}`}>
                {mc.suffix === '%' ? pc.value.toFixed(1) + '%' : formatNumber(pc.value)}
              </p>
              {previous && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${up ? 'text-green-500' : 'text-red-400'}`}>
                  {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  <span>
                    {up ? '+' : ''}{mc.suffix === '%' ? pc.change.toFixed(2) + '%' : formatNumber(Math.abs(pc.change))}
                    {pc.changePct !== 0 && ` (${pc.changePct > 0 ? '+' : ''}${pc.changePct.toFixed(1)}%)`}
                  </span>
                </div>
              )}
              {!previous && (
                <p className={`text-xs mt-1 ${tc.textSecondary}`}>First snapshot</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Auto-Generated Insights */}
      {insights.length > 0 && (
        <div className={`mt-4 p-4 rounded-lg ${isDarkMode ? 'bg-[#0d1117] border border-slate-800' : 'bg-yellow-50/50 border border-yellow-200/50'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-[#ffcc29]" />
            <span className={`text-xs font-semibold uppercase tracking-wide ${tc.textSecondary}`}>Quick Insights</span>
          </div>
          <ul className="space-y-1">
            {insights.map((insight, i) => (
              <li key={i} className={`text-sm ${tc.text} flex items-start gap-2`}>
                <span className="text-[#ffcc29] mt-0.5">•</span>
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Top Post Performance — ranked leaderboard of published posts sorted by engagement
const TopPostPerformance: React.FC<{
  campaigns: any[];
  postAnalytics: Record<string, any>;
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ campaigns, postAnalytics, isDarkMode, tc, formatNumber }) => {

  // Calculate engagement score for a campaign's analytics
  const getEngagementScore = (analytics: any): number => {
    if (!analytics || typeof analytics !== 'object') return 0;
    const platformKeys = Object.keys(analytics).filter(k =>
      !['status', 'error', 'code', 'id'].includes(k) && typeof analytics[k] === 'object' && analytics[k] !== null
    );
    let total = 0;
    platformKeys.forEach(pk => {
      const d = analytics[pk]?.analytics || analytics[pk];
      if (!d) return;
      total += (d.likeCount || 0) + (d.commentsCount || d.commentCount || 0)
        + (d.sharesCount || d.shareCount || 0) + (d.savedCount || 0)
        + (d.engagementCount || 0) + (d.clickCount || 0);
    });
    return total;
  };

  // Get primary platform + its key metrics
  const getTopMetrics = (analytics: any) => {
    if (!analytics || typeof analytics !== 'object') return null;
    const platformKeys = Object.keys(analytics).filter(k =>
      !['status', 'error', 'code', 'id'].includes(k) && typeof analytics[k] === 'object' && analytics[k] !== null
    );
    if (platformKeys.length === 0) return null;
    const platform = platformKeys[0];
    const d = analytics[platform]?.analytics || analytics[platform];
    if (!d) return null;
    return {
      platform,
      views: d.viewsCount ?? d.totalVideoViews ?? d.videoViews ?? d.mediaView ?? undefined,
      reach: d.reachCount ?? d.impressionsUnique ?? d.uniqueImpressionsCount ?? undefined,
      impressions: d.impressionCount ?? undefined,
      likes: d.likeCount ?? undefined,
      comments: d.commentsCount ?? d.commentCount ?? undefined,
      shares: d.sharesCount ?? d.shareCount ?? undefined,
      engagement: d.engagementCount ?? d.engagement ?? undefined,
    };
  };

  // Sort campaigns by engagement score
  const ranked = campaigns
    .map(c => ({
      ...c,
      score: getEngagementScore(postAnalytics[c.socialPostId]),
      metrics: getTopMetrics(postAnalytics[c.socialPostId]),
      hasData: !!postAnalytics[c.socialPostId],
    }))
    .sort((a, b) => b.score - a.score);

  const anyLoading = ranked.some(c => !c.hasData);

  return (
    <div className={`rounded-xl p-6 ${tc.card}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[#ffcc29]" />
          <h3 className={`text-lg font-semibold ${tc.text}`}>Top Post Performance</h3>
        </div>
        {anyLoading && <Loader2 className="w-4 h-4 animate-spin text-[#ffcc29]" />}
      </div>

      <div className="space-y-2">
        {ranked.map((campaign, idx) => {
          const m = campaign.metrics;
          const medal = idx === 0 ? '\uD83E\uDD47' : idx === 1 ? '\uD83E\uDD48' : idx === 2 ? '\uD83E\uDD49' : null;
          const color = m ? (platformColors[m.platform] || '#ffcc29') : '#ffcc29';

          return (
            <div
              key={campaign._id}
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                isDarkMode ? 'bg-[#070A12] hover:bg-[#0d1117]' : 'bg-gray-50 hover:bg-gray-100'
              }`}
            >
              {/* Rank */}
              <div className={`w-7 text-center flex-shrink-0 font-bold text-sm ${
                medal ? '' : tc.textMuted
              }`}>
                {medal || `#${idx + 1}`}
              </div>

              {/* Platform icon */}
              {m && (
                <div className="p-1.5 rounded-md flex-shrink-0" style={{ backgroundColor: `${color}15` }}>
                  <PlatformIcon platform={m.platform} className="w-4 h-4" />
                </div>
              )}

              {/* Campaign name */}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium truncate ${tc.text}`}>{campaign.name || 'Untitled'}</p>
                <span className={`text-[10px] ${tc.textMuted}`}>
                  {campaign.publishedAt ? new Date(campaign.publishedAt).toLocaleDateString() : 'Published'}
                </span>
              </div>

              {/* Metric chips */}
              {m ? (
                <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
                  {m.likes !== undefined && (
                    <span className={`flex items-center gap-1 text-xs font-medium ${tc.textMuted}`}>
                      <Heart className="w-3 h-3 text-red-400" /> {formatNumber(m.likes)}
                    </span>
                  )}
                  {m.views !== undefined && (
                    <span className={`flex items-center gap-1 text-xs font-medium ${tc.textMuted}`}>
                      <Eye className="w-3 h-3 text-purple-400" /> {formatNumber(m.views)}
                    </span>
                  )}
                  {m.reach !== undefined && m.views === undefined && (
                    <span className={`flex items-center gap-1 text-xs font-medium ${tc.textMuted}`}>
                      <Users className="w-3 h-3 text-blue-400" /> {formatNumber(m.reach)}
                    </span>
                  )}
                  {m.comments !== undefined && (
                    <span className={`flex items-center gap-1 text-xs font-medium ${tc.textMuted}`}>
                      <MessageSquare className="w-3 h-3 text-yellow-400" /> {formatNumber(m.comments)}
                    </span>
                  )}
                  {m.shares !== undefined && (
                    <span className={`flex items-center gap-1 text-xs font-medium ${tc.textMuted}`}>
                      <Share2 className="w-3 h-3 text-green-400" /> {formatNumber(m.shares)}
                    </span>
                  )}
                </div>
              ) : (
                campaign.hasData === false && (
                  <span className={`text-[11px] ${tc.textMuted}`}>Loading...</span>
                )
              )}

              {/* Engagement score badge */}
              {campaign.score > 0 && (
                <div className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${
                  isDarkMode ? 'bg-[#ffcc29]/10 text-[#ffcc29]' : 'bg-[#ffcc29]/20 text-[#9a7b00]'
                }`}>
                  {formatNumber(campaign.score)}
                </div>
              )}
            </div>
          );
        })}

        {ranked.length === 0 && (
          <p className={`text-sm text-center py-4 ${tc.textSecondary}`}>No published posts yet</p>
        )}
      </div>
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
  loadPostAnalytics: (postId: string, platforms?: string[]) => void;
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ campaigns, postAnalytics, postLoading, loadPostAnalytics, isDarkMode, tc, formatNumber }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});

  // Pre-fetch all campaign analytics on mount
  useEffect(() => {
    campaigns.forEach(c => {
      if (c.socialPostId) loadPostAnalytics(c.socialPostId, c.platforms);
    });
  }, [campaigns.length]);

  const handleToggle = (campaignId: string, postId: string, platforms?: string[]) => {
    setExpandedId(prev => prev === campaignId ? null : campaignId);
    if (!postAnalytics[postId]) loadPostAnalytics(postId, platforms);
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
    add('engagement', 'Engagement', '#F97316', <Zap className="w-3.5 h-3.5" />, 'engagementCount', 'engagement');
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
                        {r.type === 'like' ? '\uD83D\uDC4D' : r.type === 'love' ? '\u2764\uFE0F' : r.type === 'haha' ? '\uD83D\uDE02' : r.type === 'wow' ? '\uD83D\uDE2E' : r.type === 'anger' ? '\uD83D\uDE21' : r.type === 'sorry' ? '\uD83D\uDE22' : r.type === 'praise' ? '\uD83D\uDC4F' : r.type === 'empathy' ? '\uD83D\uDC97' : r.type === 'maybe' ? '\uD83E\uDD14' : r.type === 'interest' ? '\uD83D\uDCA1' : r.type === 'appreciation' ? '\uD83D\uDE4F' : '\u2022'} {r.type === 'praise' ? 'Celebrate' : r.type === 'empathy' ? 'Love' : r.type === 'maybe' ? 'Curious' : r.type === 'interest' ? 'Insightful' : r.type === 'appreciation' ? 'Support' : r.type} {formatNumber(r.count)}
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
              onClick={() => handleToggle(campaign._id, postId, campaign.platforms)}
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
        const adId = ad.adId || ad.id || ad._id || `ad-${i}`;
        const status = ad.status || ad.effective_status || 'UNKNOWN';
        const isActive = status === 'ACTIVE';
        const curr = ad.currency === 'INR' ? '₹' : ad.currency === 'EUR' ? '€' : ad.currency === 'GBP' ? '£' : '$';

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
                  <p className={`text-sm font-semibold ${tc.text}`}>{curr}{ad.dailyBudget}</p>
                </div>
              )}
              {ad.spend !== undefined && (
                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${tc.textMuted}`}>Spent</p>
                  <p className={`text-sm font-semibold ${tc.text}`}>{curr}{typeof ad.spend === 'number' ? ad.spend.toFixed(2) : ad.spend}</p>
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

            {/* Preview Link */}
            {ad.previewLink && (
              <a
                href={ad.previewLink}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 mt-3 text-xs font-medium ${isDarkMode ? 'text-[#ffcc29] hover:text-yellow-300' : 'text-amber-600 hover:text-amber-700'}`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Preview Ad
              </a>
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
  error?: string;
  isDarkMode: boolean;
  tc: any;
  formatNumber: (n: number) => string;
}> = ({ adHistory, error, isDarkMode, tc, formatNumber }) => {

  if (error) {
    return (
      <div className={`rounded-xl p-6 ${tc.card}`}>
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5" />
          <div>
            <p className={`font-medium ${tc.text}`}>
              Unable to load ad data. Please reconnect your account or try again later.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!adHistory) {
    return (
      <div className={`rounded-xl p-8 text-center ${tc.card}`}>
        <DollarSign className={`w-12 h-12 mx-auto mb-3 ${tc.textMuted}`} />
        <p className={`text-sm ${tc.textSecondary}`}>
          No ad history available. Run your first boosted ad to see performance insights.
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

      {entries.length === 0 && (
        <div className={`rounded-xl p-8 text-center ${tc.card}`}>
          <DollarSign className={`w-12 h-12 mx-auto mb-3 ${tc.textMuted}`} />
          <p className={`text-sm ${tc.textSecondary}`}>
            No ad history available. Run your first boosted ad to see performance insights.
          </p>
        </div>
      )}
    </div>
  );
};

export default Analytics;
