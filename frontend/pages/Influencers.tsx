import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { Influencer } from '../types';
import { 
  Search, Loader2, Star, RefreshCw, Instagram, Youtube, Twitter, 
  TrendingUp, Users, Sparkles, ExternalLink, ChevronDown, Filter,
  Zap, Target, BarChart3, Award, Check
} from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

const platformIcons: Record<string, React.ReactNode> = {
  instagram: <Instagram className="w-4 h-4 text-pink-500" />,
  youtube: <Youtube className="w-4 h-4 text-red-500" />,
  twitter: <Twitter className="w-4 h-4 text-blue-400" />,
  linkedin: <span className="text-sm font-bold text-blue-600">in</span>,
  facebook: <span className="text-sm font-bold text-blue-700">f</span>,
  x: <Twitter className="w-4 h-4 text-slate-800" />,
  tiktok: <span className="text-sm font-bold text-black">TT</span>,
};

const platformColors: Record<string, string> = {
  instagram: 'from-pink-500 to-purple-500',
  youtube: 'from-red-500 to-red-600',
  twitter: 'from-blue-400 to-blue-500',
  linkedin: 'from-blue-600 to-blue-700',
  facebook: 'from-blue-600 to-blue-800',
  x: 'from-slate-800 to-slate-900',
  tiktok: 'from-black to-pink-500',
};

// Tier badge colors
const tierColors: Record<string, { bg: string; text: string; border: string }> = {
  mega: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  macro: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  micro: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  nano: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  'mid-tier': { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200' },
};

const tierColorsDark: Record<string, { bg: string; text: string; border: string }> = {
  mega: { bg: 'bg-purple-900/30', text: 'text-purple-400', border: 'border-purple-500/30' },
  macro: { bg: 'bg-blue-900/30', text: 'text-blue-400', border: 'border-blue-500/30' },
  micro: { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-500/30' },
  nano: { bg: 'bg-orange-900/30', text: 'text-orange-400', border: 'border-orange-500/30' },
  'mid-tier': { bg: 'bg-cyan-900/30', text: 'text-cyan-400', border: 'border-cyan-500/30' },
};

type SortOption = 'relevance' | 'followers' | 'engagement' | 'recent' | 'trending';

const Influencers: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNiche, setSelectedNiche] = useState<string>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [recalculatingId, setRecalculatingId] = useState<string | null>(null);
  const [discoveryMessage, setDiscoveryMessage] = useState<string>('');
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  const loadInfluencers = async () => {
    setLoading(true);
    try {
      const res = await apiService.getInfluencers();
      if (res.influencers && res.influencers.length > 0) {
        setInfluencers(res.influencers);
      } else {
        // No influencers found - automatically trigger discovery
        await discoverNewInfluencers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const discoverNewInfluencers = async (forceRefresh = false) => {
    setDiscovering(true);
    setDiscoveryMessage('🔍 Finding influencers across Instagram, YouTube, Facebook & more...');
    try {
      const res = await apiService.discoverInfluencers({
        platforms: ['instagram', 'youtube', 'facebook', 'twitter', 'linkedin'],
        limit: 15,
        forceRefresh
      });
      
      if (res.success && res.influencers) {
        setInfluencers(res.influencers);
        const breakdown = res.breakdown || {};
        setDiscoveryMessage(
          `✅ Found ${res.discovered || res.influencers.length} influencers! ` +
          `(${breakdown.mega || 0} Mega, ${breakdown.macro || 0} Macro, ${breakdown.micro || 0} Micro)`
        );
        
        // Clear message after 5 seconds
        setTimeout(() => setDiscoveryMessage(''), 5000);
      } else {
        setDiscoveryMessage(res.message || '⚠️ No influencers found. Please complete your onboarding first.');
        setTimeout(() => setDiscoveryMessage(''), 5000);
      }
    } catch (e: any) {
      console.error(e);
      setDiscoveryMessage('❌ Discovery failed. Please try again.');
      setTimeout(() => setDiscoveryMessage(''), 3000);
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    loadInfluencers();
  }, []);

  const handleRecalculate = async (id: string) => {
    setRecalculatingId(id);
    try {
      const res = await apiService.recalculateInfluencerScore(id);
      if (res.influencer) {
        setInfluencers(prev => prev.map(inf => 
          inf._id === id ? res.influencer : inf
        ));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRecalculatingId(null);
    }
  };

  // Get all unique niches for filter
  const allNiches: string[] = Array.from(new Set(influencers.flatMap(inf => inf.niche || [])));
  const allPlatforms: string[] = Array.from(new Set(influencers.map(inf => inf.platform).filter(Boolean))) as string[];
  const allTiers: string[] = ['mega', 'macro', 'micro', 'nano'];

  // Filter influencers
  const filteredInfluencers = influencers.filter(inf => {
    const matchesSearch = 
      inf.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inf.handle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inf.niche?.some(n => n.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesNiche = selectedNiche === 'all' || inf.niche?.includes(selectedNiche);
    const matchesPlatform = selectedPlatform === 'all' || inf.platform === selectedPlatform;
    const matchesTier = selectedTier === 'all' || inf.type === selectedTier || inf.tier === selectedTier;
    
    return matchesSearch && matchesNiche && matchesPlatform && matchesTier;
  });

  // Sort influencers
  const sortedInfluencers = [...filteredInfluencers].sort((a, b) => {
    switch (sortBy) {
      case 'relevance':
        return (b.aiMatchScore?.score || 0) - (a.aiMatchScore?.score || 0);
      case 'followers':
        return (b.followerCount || 0) - (a.followerCount || 0);
      case 'engagement':
        return (b.engagementRate || 0) - (a.engagementRate || 0);
      case 'recent':
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      case 'trending':
        // Trending = high engagement + recent activity
        const trendA = (a.engagementRate || 0) * 10 + (a.avgLikes || 0) / 1000;
        const trendB = (b.engagementRate || 0) * 10 + (b.avgLikes || 0) / 1000;
        return trendB - trendA;
      default:
        return 0;
    }
  });

  const sortOptions: { value: SortOption; label: string; icon: React.ReactNode }[] = [
    { value: 'relevance', label: 'Highest Relevance', icon: <Target className="w-4 h-4" /> },
    { value: 'followers', label: 'Most Followers', icon: <Users className="w-4 h-4" /> },
    { value: 'engagement', label: 'Best Engagement', icon: <BarChart3 className="w-4 h-4" /> },
    { value: 'trending', label: 'Trending', icon: <TrendingUp className="w-4 h-4" /> },
    { value: 'recent', label: 'Recently Added', icon: <Sparkles className="w-4 h-4" /> },
  ];

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-orange-500';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-orange-400';
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(num > 100000 ? 0 : 1) + 'K';
    return num.toString();
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col justify-center items-center py-20">
        <Loader2 className="w-10 h-10 text-[#ffcc29] animate-spin mb-4" />
        <p className={theme.textSecondary}>Loading influencers...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className={`text-2xl font-bold ${theme.text}`}>Influencer Discovery</h1>
          <p className={theme.textSecondary}>AI-vetted partnerships for maximum impact.</p>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text"
              placeholder="Search influencers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`pl-9 pr-4 py-2 border rounded-lg text-sm outline-none focus:border-[#ffcc29] w-52 ${
                isDarkMode 
                  ? 'bg-[#0f1419] border-slate-700/50 text-white placeholder-slate-500' 
                  : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
              }`}
            />
          </div>

          {/* Platform Filter */}
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className={`px-3 py-2 border rounded-lg text-sm outline-none focus:border-[#ffcc29] ${
              isDarkMode 
                ? 'bg-[#0f1419] border-slate-700/50 text-white' 
                : 'bg-white border-slate-300 text-slate-900'
            }`}
          >
            <option value="all">All Platforms</option>
            {allPlatforms.map(platform => (
              <option key={platform} value={platform}>{platform.charAt(0).toUpperCase() + platform.slice(1)}</option>
            ))}
          </select>

          {/* Tier Filter */}
          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
            className={`px-3 py-2 border rounded-lg text-sm outline-none focus:border-[#ffcc29] ${
              isDarkMode 
                ? 'bg-[#0f1419] border-slate-700/50 text-white' 
                : 'bg-white border-slate-300 text-slate-900'
            }`}
          >
            <option value="all">All Tiers</option>
            <option value="mega">🔥 Mega (1M+)</option>
            <option value="macro">⭐ Macro (100K-1M)</option>
            <option value="micro">💎 Micro (10K-100K)</option>
            <option value="nano">🌱 Nano (&lt;10K)</option>
          </select>

          {/* Niche Filter */}
          <select
            value={selectedNiche}
            onChange={(e) => setSelectedNiche(e.target.value)}
            className={`px-3 py-2 border rounded-lg text-sm outline-none focus:border-[#ffcc29] ${
              isDarkMode 
                ? 'bg-[#0f1419] border-slate-700/50 text-white' 
                : 'bg-white border-slate-300 text-slate-900'
            }`}
          >
            <option value="all">All Niches</option>
            {allNiches.map(niche => (
              <option key={niche} value={niche}>{niche}</option>
            ))}
          </select>

          {/* Sort Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setShowSortDropdown(!showSortDropdown)}
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm ${
                isDarkMode 
                  ? 'border-slate-700/50 hover:bg-[#ffcc29]/10 text-white' 
                  : 'border-slate-300 hover:bg-slate-50 text-slate-900'
              }`}
            >
              {sortOptions.find(o => o.value === sortBy)?.icon}
              <span className="hidden sm:inline">{sortOptions.find(o => o.value === sortBy)?.label}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            
            {showSortDropdown && (
              <div className={`absolute right-0 mt-2 w-48 rounded-lg shadow-lg border z-50 ${
                isDarkMode ? 'bg-[#0f1419] border-slate-700/50' : 'bg-white border-slate-200'
              }`}>
                {sortOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => { setSortBy(option.value); setShowSortDropdown(false); }}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                      sortBy === option.value 
                        ? 'bg-[#ffcc29]/20 text-[#ffcc29]' 
                        : isDarkMode ? 'text-white hover:bg-[#ffcc29]/10' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {option.icon}
                    {option.label}
                    {sortBy === option.value && <Check className="w-4 h-4 ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Discover Button */}
          <button 
            onClick={() => discoverNewInfluencers(true)}
            disabled={discovering}
            className={`flex items-center gap-2 px-4 py-2 bg-[#ffcc29] text-black rounded-lg text-sm font-medium hover:bg-[#ffcc29]/80 disabled:opacity-50 transition-colors`}
          >
            {discovering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {discovering ? 'Discovering...' : 'Discover New'}
          </button>
        </div>
      </div>

      {/* Discovery Message */}
      {discoveryMessage && (
        <div className={`mb-6 p-4 rounded-lg border ${
          isDarkMode 
            ? 'bg-[#ffcc29]/10 border-[#ffcc29]/30 text-[#ffcc29]' 
            : 'bg-yellow-50 border-yellow-200 text-yellow-800'
        }`}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <span className="font-medium">{discoveryMessage}</span>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      {sortedInfluencers.length > 0 && (
        <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 mb-6`}>
          <div className={`p-4 rounded-lg border ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-[#ffcc29]" />
              <span className={`text-xs uppercase font-bold ${theme.textSecondary}`}>Total Found</span>
            </div>
            <p className={`text-2xl font-bold ${theme.text}`}>{sortedInfluencers.length}</p>
          </div>
          <div className={`p-4 rounded-lg border ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-4 h-4 text-green-500" />
              <span className={`text-xs uppercase font-bold ${theme.textSecondary}`}>High Match (80+)</span>
            </div>
            <p className={`text-2xl font-bold ${theme.text}`}>
              {sortedInfluencers.filter(i => (i.aiMatchScore?.score || 0) >= 80).length}
            </p>
          </div>
          <div className={`p-4 rounded-lg border ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className={`text-xs uppercase font-bold ${theme.textSecondary}`}>Avg Engagement</span>
            </div>
            <p className={`text-2xl font-bold ${theme.text}`}>
              {(sortedInfluencers.reduce((acc, i) => acc + (i.engagementRate || 0), 0) / sortedInfluencers.length).toFixed(1)}%
            </p>
          </div>
          <div className={`p-4 rounded-lg border ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-purple-500" />
              <span className={`text-xs uppercase font-bold ${theme.textSecondary}`}>Total Reach</span>
            </div>
            <p className={`text-2xl font-bold ${theme.text}`}>
              {formatNumber(sortedInfluencers.reduce((acc, i) => acc + (i.reach || 0), 0))}
            </p>
          </div>
        </div>
      )}

      {/* Influencer Grid */}
      {sortedInfluencers.length === 0 ? (
        <div className={`text-center py-16 rounded-xl border ${theme.bgCard} ${
          isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
        }`}>
          <Users className={`w-16 h-16 mx-auto mb-4 ${theme.textSecondary}`} />
          <h3 className={`text-xl font-bold mb-2 ${theme.text}`}>No Influencers Found</h3>
          <p className={`${theme.textSecondary} mb-6 max-w-md mx-auto`}>
            Click "Discover New" to find relevant influencers for your brand using AI-powered social media analysis.
          </p>
          <button 
            onClick={() => discoverNewInfluencers(true)}
            disabled={discovering}
            className="px-6 py-3 bg-[#ffcc29] text-black rounded-lg font-medium hover:bg-[#ffcc29]/80 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {discovering ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
            {discovering ? 'Discovering Influencers...' : 'Discover Influencers'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedInfluencers.map((inf, index) => {
            // Build profile URL based on platform
            const getProfileUrl = () => {
              if (inf.profileUrl) return inf.profileUrl;
              const handle = inf.handle?.replace('@', '') || inf.name?.toLowerCase().replace(/\s+/g, '');
              switch (inf.platform) {
                case 'instagram': return `https://instagram.com/${handle}`;
                case 'twitter': return `https://twitter.com/${handle}`;
                case 'youtube': return `https://youtube.com/@${handle}`;
                case 'linkedin': return `https://linkedin.com/in/${handle}`;
                case 'facebook': return `https://facebook.com/${handle}`;
                default: return '#';
              }
            };
            const profileUrl = getProfileUrl();
            
            return (
            <a 
              key={inf._id}
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`rounded-xl shadow-sm border overflow-hidden flex flex-col transition-all hover:scale-[1.02] hover:shadow-lg cursor-pointer ${theme.bgCard} ${
                isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'
              }`}
              onClick={(e) => {
                // Don't navigate if clicking on buttons
                if ((e.target as HTMLElement).closest('button')) {
                  e.preventDefault();
                }
              }}
            >
              {/* Header with Gradient */}
              <div className={`h-20 bg-gradient-to-r ${platformColors[inf.platform] || 'from-[#ffcc29] to-[#ffcc29]/80'} relative`}>
                {/* Rank Badge */}
                {index < 3 && sortBy === 'relevance' && (
                  <div className="absolute top-2 left-2 bg-white/90 rounded-full px-2 py-1 flex items-center gap-1">
                    <Award className={`w-3 h-3 ${index === 0 ? 'text-yellow-500' : index === 1 ? 'text-slate-400' : 'text-amber-600'}`} />
                    <span className="text-xs font-bold text-slate-800">#{index + 1}</span>
                  </div>
                )}
                
                {/* Platform Icon */}
                <div className="absolute top-2 right-2 bg-white/20 backdrop-blur-sm rounded-full p-2">
                  {platformIcons[inf.platform] || inf.platform}
                </div>

                {/* Verified Badge */}
                {inf.isVerified && (
                  <div className="absolute bottom-2 right-2 bg-blue-500 rounded-full p-1">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>
              
              <div className="px-5 pb-5 flex-1 flex flex-col">
                {/* Profile Image */}
                <div className="relative mb-2">
                  <img 
                    src={inf.profileImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(inf.name)}&background=ffcc29&color=000`} 
                    alt={inf.name}
                    className={`w-14 h-14 rounded-full border-4 absolute -top-7 left-0 object-cover shadow-md ${
                      isDarkMode ? 'border-[#0f1419]' : 'border-white'
                    }`}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(inf.name)}&background=ffcc29&color=000`;
                    }}
                  />
                </div>
                
                {/* Info */}
                <div className="mt-8 mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={`font-bold text-base ${theme.text} truncate`}>{inf.name}</h3>
                    {(() => {
                      const tier = inf.tier || inf.type || 'micro';
                      const colors = isDarkMode ? tierColorsDark[tier] || tierColorsDark.micro : tierColors[tier] || tierColors.micro;
                      const emoji = tier === 'mega' ? '🔥' : tier === 'macro' ? '⭐' : tier === 'micro' ? '💎' : '🌱';
                      return (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wide border ${colors.bg} ${colors.text} ${colors.border}`}>
                          {emoji} {tier}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-[#ffcc29] font-medium text-sm mb-1">{inf.handle}</p>
                  <p className={`text-xs capitalize line-clamp-1 ${theme.textSecondary}`}>
                    {(inf.niche || []).slice(0, 3).join(' • ')}
                  </p>
                </div>

                {/* Stats Grid */}
                <div className={`grid grid-cols-3 gap-1 border-t border-b py-3 mb-3 text-center ${
                  isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
                }`}>
                  <div>
                    <p className="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Followers</p>
                    <p className={`text-sm font-bold ${theme.text}`}>{formatNumber(inf.followerCount || 0)}</p>
                  </div>
                  <div className={`border-l border-r ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
                    <p className="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Reach</p>
                    <p className={`text-sm font-bold ${theme.text}`}>{formatNumber(inf.reach || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Engage.</p>
                    <p className={`text-sm font-bold ${theme.text}`}>{inf.engagementRate?.toFixed(1) || 0}%</p>
                  </div>
                </div>

                {/* Gravity AI Score */}
                <div className="mt-auto">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className={`text-xs font-bold flex items-center gap-1 ${theme.text}`}>
                      <Sparkles className="w-3 h-3 text-[#ffcc29]" />
                      Gravity AI Score
                    </span>
                    <span className={`text-sm font-bold ${getScoreColor(inf.aiMatchScore?.score || 0)}`}>
                      {inf.aiMatchScore?.score || 0}/100
                    </span>
                  </div>
                  <div className={`w-full h-1.5 rounded-full mb-2 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}>
                    <div 
                      className={`h-1.5 rounded-full transition-all ${getScoreBgColor(inf.aiMatchScore?.score || 0)}`} 
                      style={{ width: `${inf.aiMatchScore?.score || 0}%` }} 
                    />
                  </div>
                  <p className={`text-[10px] italic mb-3 leading-relaxed line-clamp-2 min-h-[28px] ${theme.textSecondary}`}>
                    "{inf.aiMatchScore?.reason || 'Calculating relevance...'}"
                  </p>

                  {/* Score Factors (if available) */}
                  {inf.aiMatchScore?.factors && inf.aiMatchScore.factors.length > 0 && (
                    <div className={`mb-3 p-2 rounded-lg text-[10px] ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                      <div className="grid grid-cols-2 gap-1">
                        {inf.aiMatchScore.factors.slice(0, 4).map((factor: any, idx: number) => (
                          <div key={idx} className="flex justify-between">
                            <span className={theme.textSecondary}>{factor.name?.split(' ')[0]}</span>
                            <span className={`font-medium ${factor.score >= factor.max * 0.8 ? 'text-green-500' : theme.text}`}>
                              {factor.score}/{factor.max}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <button 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRecalculate(inf._id);
                      }}
                      disabled={recalculatingId === inf._id}
                      className={`flex-1 py-2 border text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 disabled:opacity-50 ${
                        isDarkMode 
                          ? 'bg-[#0f1419] border-[#ffcc29]/30 text-[#ffcc29] hover:bg-[#ffcc29]/10' 
                          : 'bg-white border-slate-200 text-[#ffcc29] hover:bg-[#ffcc29]/10'
                      }`}
                    >
                      {recalculatingId === inf._id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Star className="w-3 h-3" />
                      )}
                      Re-Score
                    </button>
                  </div>
                </div>
              </div>
            </a>
          );
          })}
        </div>
      )}

      {/* Click outside to close dropdown */}
      {showSortDropdown && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setShowSortDropdown(false)}
        />
      )}
    </div>
  );
};

export default Influencers;
