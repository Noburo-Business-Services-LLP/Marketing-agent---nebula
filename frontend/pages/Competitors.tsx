import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { CompetitorPost } from '../types';
import { Loader2, Search, RotateCw, ExternalLink, Heart, MessageCircle, Plus, Instagram, Twitter, Linkedin, Facebook, Youtube, Sparkles, X, EyeOff, Users, MapPin } from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import PageHeader, { PageEmphasis } from '../components/PageHeader';
import UpgradePrompt from '../components/UpgradePrompt';
import CompetitorInsights from '../components/CompetitorInsights';
import { CompetitorBoard } from '../components/CompetitorTiles';
import HandleEditor, { SavedHandle } from '../components/HandleEditor';
import { UpgradeInfo, upgradeInfoOf } from '../utils/plans';
import { LOCKED_NOTE, competitorsUpgradeCopy, handleSavedNote, listHandleAction } from '../utils/competitorInsights';
import { customerMessage } from '../utils/errors';
import { Link } from 'react-router-dom';

const platformIcons: Record<string, React.ReactNode> = {
  instagram: <Instagram className="w-3 h-3" />,
  twitter: <Twitter className="w-3 h-3" />,
  linkedin: <Linkedin className="w-3 h-3" />,
  facebook: <Facebook className="w-3 h-3" />,
  youtube: <Youtube className="w-3 h-3" />,
};

interface Competitor {
  _id: string;
  name: string;
  industry: string;
  location?: string;
  socialHandles?: { instagram?: string; twitter?: string };
  isIgnored?: boolean;
  handleStatus?: 'suggested' | 'verified' | 'confirmed';
  isAutoDiscovered?: boolean;
  competitorType?: 'local' | 'regional' | 'national' | 'global' | 'startup' | 'emerging' | 'direct' | 'indirect' | 'market_leader' | 'unknown';
}

/** `embedded`: the Competitors tab of Insights, whose page header and tab bar sit above it. */
const Competitors: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [posts, setPosts] = useState<CompetitorPost[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [ignoredCompetitors, setIgnoredCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('Last 7 days');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [fetchingType, setFetchingType] = useState<string | null>(null);
  const [showIgnoredModal, setShowIgnoredModal] = useState(false);
  
  // Auto-discover state
  const [discovering, setDiscovering] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState('');
  const [upgrade, setUpgrade] = useState<UpgradeInfo | null>(null);
  // No add-on: a calm note on the page, not a prompt. The prompt below appears only after pressing Add or Find.
  const [insightsLocked, setInsightsLocked] = useState(false);
  const onInsightsLocked = useCallback(() => setInsightsLocked(true), []);
  const [handleNotes, setHandleNotes] = useState<Record<string, string>>({});
  const onHandleSaved = useCallback((saved: SavedHandle) => {
    setCompetitors((prev) => prev.map((c) => (c._id === saved.id
      ? { ...c, socialHandles: { ...(c.socialHandles || {}), instagram: saved.handle }, handleStatus: 'confirmed' as const }
      : c)));
    setHandleNotes((n) => ({ ...n, [saved.id]: handleSavedNote(saved) }));
  }, []);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [location, setLocation] = useState('');
  
  // Manual add competitor state
  const [addCompetitorName, setAddCompetitorName] = useState('');
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  
  // Ignore a competitor
  const handleIgnoreCompetitor = async (competitorId: string | undefined, competitorName: string) => {
    if (!competitorId) return;
    try {
      const res = await apiService.ignoreCompetitor(competitorId);
      if (res.success) {
        // Remove posts from this competitor from the view
        setPosts(prev => prev.filter(p => p.competitorId !== competitorId));
        // Update competitors list
        setCompetitors(prev => prev.filter(c => c._id !== competitorId));
        setDiscoveryMessage(`🚫 ${competitorName} has been ignored`);
        setTimeout(() => setDiscoveryMessage(''), 3000);
      }
    } catch (error) {
      console.error('Failed to ignore competitor:', error);
    }
  };

  // Unignore a competitor
  const handleUnignoreCompetitor = async (competitorId: string) => {
    try {
      const res = await apiService.unignoreCompetitor(competitorId);
      if (res.success) {
        setIgnoredCompetitors(prev => prev.filter(c => c._id !== competitorId));
        // Reload posts to include this competitor again
        loadPosts();
        setDiscoveryMessage(`✅ Competitor is now visible again`);
        setTimeout(() => setDiscoveryMessage(''), 3000);
      }
    } catch (error) {
      console.error('Failed to unignore competitor:', error);
    }
  };

  // Load ignored competitors
  const loadIgnoredCompetitors = async () => {
    try {
      const res = await apiService.getIgnoredCompetitors();
      if (res.success) {
        setIgnoredCompetitors(res.competitors || []);
      }
    } catch (error) {
      console.error('Failed to load ignored competitors:', error);
    }
  };

  // Auto-discover competitors
  const handleAutoDiscover = async () => {
    if (!location.trim()) {
      alert('Please enter a location');
      return;
    }
    
    setShowLocationModal(false);
    setDiscovering(true);
    setDiscoveryMessage(`🔍 Finding competitors in ${location}...`);
    
    try {
      const res = await apiService.autoDiscoverCompetitors({ location, forceRefresh: true });
      
      if (res.success && res.posts && res.posts.length > 0) {
        setPosts(res.posts);
        if (res.competitors) setCompetitors(res.competitors);
        setDiscoveryMessage(`✅ Found ${res.discovered || res.competitors?.length || 0} competitors with ${res.posts.length} posts!`);
      } else if (res.success && res.competitors && res.competitors.length > 0) {
        // Reload posts after discovery
        await loadPosts();
        setDiscoveryMessage(`✅ Discovered ${res.competitors.length} competitors! Fetching their posts...`);
      } else {
        setDiscoveryMessage(res.message || '⚠️ No competitors found in this location. Try a different area.');
      }
      
      setTimeout(() => setDiscoveryMessage(''), 5000);
    } catch (e: any) {
      console.error(e);
      setUpgrade(upgradeInfoOf(e));
      setDiscoveryMessage('❌ Discovery failed. Please try again.');
      setTimeout(() => setDiscoveryMessage(''), 3000);
    } finally {
      setDiscovering(false);
    }
  };

  // Handle manual add competitor
  const handleAddCompetitor = async () => {
    if (!addCompetitorName.trim() || addingCompetitor) return;
    
    setAddingCompetitor(true);
    setDiscoveryMessage(`🔍 Adding ${addCompetitorName.trim()}...`);
    
    try {
      const res = await apiService.addManualCompetitor(addCompetitorName.trim());
      if (res.success) {
        setCompetitors(prev => [...prev, res.competitor]);
        setDiscoveryMessage(res.message || `✅ Added ${addCompetitorName.trim()}!`);
        setAddCompetitorName('');
        // Fetch posts for the new competitor's category with loading animation
        const compType = res.competitor?.competitorType || selectedCategory || 'direct';
        const fetchType = compType === 'all' ? 'direct' : compType;
        setTimeout(() => handleFetchPostsForType(fetchType), 2000);
      } else {
        setDiscoveryMessage(`⚠️ ${res.message || 'Failed to add competitor'}`);
      }
    } catch (e: any) {
      setUpgrade(upgradeInfoOf(e));
      const msg = e?.message || '';
      setDiscoveryMessage(`❌ ${msg.includes('already') ? msg : 'Failed to add competitor. Try again.'}`);
    } finally {
      setAddingCompetitor(false);
      setTimeout(() => setDiscoveryMessage(''), 5000);
    }
  };

  const loadPosts = async () => {
    setLoading(true);
    try {
      const res = await apiService.getCompetitors();
      
      // Load competitors list
      if (res.competitors && res.competitors.length > 0) {
        setCompetitors(res.competitors);
        
        // Check if competitors have posts
        const competitorsWithPosts = res.competitors.filter((c: any) => c.posts && c.posts.length > 0);
        if (competitorsWithPosts.length > 0) {
          // Collect all posts from all competitors
          const allPosts = res.competitors.flatMap((c: any) => 
            (c.posts || []).map((p: any) => ({
              ...p,
              competitorName: c.name,
              competitorId: c._id,
              competitorType: c.competitorType || 'unknown'
            }))
          );
          setPosts(allPosts);
        }
      }
      
      // If posts came from API response directly
      if (res.posts && res.posts.length > 0) {
        setPosts(res.posts);
      }
      
      // If no competitors at all, show message - but DON'T auto-trigger discovery
      // Discovery should only happen during onboarding
      if (!res.competitors || res.competitors.length === 0) {
        try {
          const contextRes = await apiService.getBusinessContext();
          if (contextRes.success && contextRes.businessLocation) {
            setLocation(contextRes.businessLocation);
            setDiscoveryMessage('Competitors are being discovered in the background. Please wait or click "Auto-Discover".');
          } else {
            setDiscoveryMessage('Complete onboarding with your business location to auto-discover competitors.');
          }
        } catch (contextError) {
          console.error('Could not load business context:', contextError);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Load business location on mount
  useEffect(() => {
    const loadBusinessLocation = async () => {
      try {
        const contextRes = await apiService.getBusinessContext();
        if (contextRes.success && contextRes.businessLocation) {
          setLocation(contextRes.businessLocation);
        }
      } catch (error) {
        // Could not load business location
      }
    };
    loadBusinessLocation();
    loadIgnoredCompetitors();
  }, []);

  useEffect(() => {
    loadPosts();
  }, []);

  const filteredPosts = posts.filter(post => {
    const matchesSearch = post.content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      post.competitorName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || (post as any).competitorType === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Count competitors per category for badge numbers
  const categoryCounts: Record<string, number> = { all: competitors.length };
  competitors.forEach(c => {
    const t = c.competitorType || 'unknown';
    categoryCounts[t] = (categoryCounts[t] || 0) + 1;
  });

  // Check if a category has competitors but no posts — auto-fetch
  const postsForCategory = (type: string) => {
    if (type === 'all') return posts;
    return posts.filter((p: any) => p.competitorType === type);
  };

  const competitorsForCategory = (type: string) => {
    if (type === 'all') return competitors;
    return competitors.filter(c => c.competitorType === type);
  };

  const handleFetchPostsForType = async (type: string) => {
    setFetchingType(type);
    try {
      const res = await apiService.scrapeCompetitorsByType(type);
      if (res && res.notice) { setDiscoveryMessage(customerMessage(res.notice, '')); setTimeout(() => setDiscoveryMessage(''), 5000); }
      if (res.success && res.posts && res.posts.length > 0) {
        // Merge new posts into existing posts (avoid duplicates)
        setPosts(prev => {
          const existingIds = new Set(prev.map((p: any) => p.id || p._id));
          const newPosts = res.posts.filter((p: any) => !existingIds.has(p.id || p._id));
          return [...prev, ...newPosts];
        });
      }
    } catch (error) {
      setUpgrade(upgradeInfoOf(error));
      if ((error as any)?.status === 429) { setDiscoveryMessage(customerMessage(error, '')); setTimeout(() => setDiscoveryMessage(''), 5000); }
      console.error('Failed to fetch posts for type:', type, error);
    } finally {
      setFetchingType(null);
    }
  };

  // Auto-fetch posts when switching to a category that has competitors but no posts
  useEffect(() => {
    if (selectedCategory !== 'all' && !fetchingType) {
      const catPosts = postsForCategory(selectedCategory);
      const catCompetitors = competitorsForCategory(selectedCategory);
      if (catCompetitors.length > 0 && catPosts.length === 0) {
        handleFetchPostsForType(selectedCategory);
      }
    }
  }, [selectedCategory]);

  const handleRefresh = async () => {
    await loadPosts();
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Location Modal */}
      {showLocationModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`${theme.bgCard} rounded-2xl p-6 max-w-md w-full shadow-2xl border ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <h3 className={`text-xl font-bold mb-4 ${theme.text}`}>🔍 Find Competitors</h3>
            <p className={`${theme.textSecondary} mb-4 text-sm`}>
              Enter your business location to discover competitors in your area.
            </p>
            <input
              type="text"
              placeholder="e.g., Chennai, India or South India"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={`w-full px-4 py-3 border rounded-lg text-sm outline-none focus:border-[#F5A623] mb-4 ${
                isDarkMode ? 'bg-[#070A12] border-slate-700/50 text-[#ededed] placeholder-[#ededed]/50' : 'border-slate-300 text-[#070A12]'
              }`}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowLocationModal(false)}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border ${
                  isDarkMode ? 'border-slate-700/50 text-[#ededed] hover:bg-[#F5A623]/10' : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleAutoDiscover}
                disabled={!location.trim()}
                className="flex-1 px-4 py-2 bg-[#F5A623] text-black rounded-lg text-sm font-medium hover:bg-[#F5A623]/90 disabled:opacity-50"
              >
                Find Competitors
              </button>
            </div>
          </div>
        </div>
      )}

      {!embedded && (
        <PageHeader
          eyebrow="Competitors"
          title={<>Who else is in the <PageEmphasis>room</PageEmphasis>?</>}
          description="Their public posts, checked once a week: what is working for them and what you can make from it."
        />
      )}

      <CompetitorBoard onLocked={onInsightsLocked} />

      <CompetitorInsights showLink={false} onLocked={onInsightsLocked} showCompetitors={false} />

      {insightsLocked && !upgrade && (
        <p className="mb-6 rounded-xl border border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)] px-4 py-3 text-[14px] leading-relaxed text-[var(--gv-text-secondary)]">
          {LOCKED_NOTE.before}
          <Link to="/trial-expired" className="rounded-md font-semibold text-[var(--gv-text-primary)] underline underline-offset-2 hover:text-[var(--gv-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gv-accent)]">{LOCKED_NOTE.link}</Link>
          {LOCKED_NOTE.after}
        </p>
      )}

      {upgrade && <UpgradePrompt className="mb-6" reason={upgrade.reason} feature={upgrade.feature} {...competitorsUpgradeCopy(upgrade.reason)} />}

      {/* Discovery Message */}
      {discoveryMessage && (
        <div className="mb-6 px-5 py-3.5 rounded-xl border border-[#F5A623]/20 bg-[#F5A623]/[0.05]">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-[#F5A623] flex-shrink-0" />
            <span className="text-[13px] text-[#F5F4F1]">{discoveryMessage}</span>
          </div>
        </div>
      )}

      {/* Category Filter Tabs */}
      {competitors.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { key: 'all', label: 'All', icon: '🌐' },
            { key: 'global', label: 'Global', icon: '🌍' },
            { key: 'national', label: 'National', icon: '🏛️' },
            { key: 'regional', label: 'Regional', icon: '📍' },
            { key: 'local', label: 'Local', icon: '🏘️' },
            { key: 'direct', label: 'Direct', icon: '⚔️' },
            { key: 'indirect', label: 'Indirect', icon: '↔️' },
          ].filter(tab => tab.key === 'all' || (categoryCounts[tab.key] || 0) > 0).map(tab => (
            <button
              key={tab.key}
              onClick={() => setSelectedCategory(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                selectedCategory === tab.key
                  ? 'bg-[#F5A623] text-black border-[#F5A623] shadow-sm'
                  : isDarkMode
                    ? 'bg-[#0f1419] border-slate-700/50 text-slate-300 hover:border-[#F5A623]/40 hover:text-[#F5A623]'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-[#F5A623]/40 hover:text-[#F5A623]'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {(categoryCounts[tab.key] || 0) > 0 && (
                <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  selectedCategory === tab.key
                    ? 'bg-black/20 text-black'
                    : isDarkMode ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'
                }`}>
                  {categoryCounts[tab.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className={`${theme.bgCard} p-6 rounded-xl border ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'} mb-8`}>
          <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
              <h2 className="font-serif-display text-[20px] text-[#F5F4F1]">Competitor Activity Feed</h2>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative w-full sm:w-64">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme.textMuted}`} />
                  <input 
                      type="text" 
                      placeholder="Filter by keyword..." 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className={`w-full pl-9 pr-8 py-2 border rounded-lg text-sm outline-none focus:border-[#F5A623] ${isDarkMode ? 'bg-[#070A12] border-slate-700/50 text-[#ededed] placeholder-[#ededed]/50' : 'border-slate-300 text-[#070A12]'}`}
                  />
                  <RotateCw 
                    className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 cursor-pointer hover:text-[#F5A623] ${theme.textMuted} ${loading ? 'animate-spin' : ''}`}
                    onClick={handleRefresh}
                  />
                </div>
              </div>
          </div>

          {loading || fetchingType ? (
             <div className="flex justify-center py-12">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 text-[#F5A623] animate-spin mx-auto mb-3" />
                  {fetchingType && (
                    <p className={`${theme.textSecondary} text-sm`}>
                      Fetching posts for {fetchingType} competitors... This may take a moment.
                    </p>
                  )}
                </div>
             </div>
          ) : filteredPosts.length === 0 ? (
             <div className="text-center py-12">
                <p className={`${theme.textSecondary} mb-4`}>No posts yet for this category.</p>
                {selectedCategory !== 'all' && competitorsForCategory(selectedCategory).length > 0 && (
                  <button 
                    onClick={() => handleFetchPostsForType(selectedCategory)}
                    className="px-4 py-2 bg-[#F5A623] text-black rounded-lg text-sm font-medium hover:bg-[#ffb833] flex items-center gap-2 mx-auto"
                  >
                    <RotateCw className="w-4 h-4" />
                    Fetch Posts for {selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} Competitors
                  </button>
                )}
             </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredPosts.map(post => (
                    <div key={post.id} className={`${theme.bgCard} border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-[#ededed] hover:shadow-md'} rounded-xl p-5 transition-all`}>
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                                    post.competitorName?.includes('Tech') ? (isDarkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-700') :
                                    post.competitorName?.includes('Market') ? (isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700') :
                                    post.competitorName?.includes('Growth') ? (isDarkMode ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-100 text-purple-700') :
                                    (isDarkMode ? 'bg-[#F5A623]/20 text-[#F5A623]' : 'bg-[#F5A623]/20 text-indigo-700')
                                }`}>
                                    {post.competitorLogo || post.competitorName?.charAt(0) || 'C'}
                                </div>
                                <div>
                                    <h3 className={`text-sm font-bold ${theme.text}`}>{post.competitorName}</h3>
                                    <p className={`text-xs flex items-center gap-1 ${theme.textMuted}`}>
                                      {platformIcons[post.platform] || post.platform} • {post.postedAt}
                                      {(post as any).competitorType && (post as any).competitorType !== 'unknown' && (
                                        <span className={`ml-1 px-1.5 py-0 rounded text-[9px] font-semibold uppercase ${
                                          (post as any).competitorType === 'global' ? (isDarkMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600') :
                                          (post as any).competitorType === 'national' ? (isDarkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600') :
                                          (post as any).competitorType === 'regional' ? (isDarkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-600') :
                                          (post as any).competitorType === 'local' ? (isDarkMode ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-600') :
                                          (isDarkMode ? 'bg-slate-500/20 text-slate-400' : 'bg-slate-100 text-slate-600')
                                        }`}>
                                          {(post as any).competitorType}
                                        </span>
                                      )}
                                    </p>
                                </div>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                                post.sentiment === 'positive' ? (isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-50 text-green-600') :
                                post.sentiment === 'negative' ? (isDarkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600') :
                                (isDarkMode ? 'bg-[#ededed]/10 text-[#ededed]/60' : 'bg-[#ededed] text-slate-600')
                            }`}>
                                {post.sentiment}
                            </span>
                        </div>
                        
                        <p className={`text-sm mb-4 min-h-[60px] ${theme.textSecondary}`}>
                            {post.content}
                        </p>

                        <div className={`flex justify-between items-center pt-4 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-[#f5f5f5]'}`}>
                            <div className="flex gap-4">
                                <span className={`flex items-center gap-1 text-xs font-medium ${theme.textSecondary}`}>
                                    <Heart className="w-3 h-3 text-red-400 fill-red-400" /> {(post.likes || 0).toLocaleString()}
                                </span>
                                <span className={`flex items-center gap-1 text-xs font-medium ${theme.textSecondary}`}>
                                    <MessageCircle className={`w-3 h-3 ${theme.textMuted}`} /> {post.comments || 0}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleIgnoreCompetitor(post.competitorId, post.competitorName)}
                                className={`flex items-center gap-1 text-xs font-medium ${isDarkMode ? 'text-red-400 hover:text-red-300' : 'text-red-500 hover:text-red-600'}`}
                                title={`Ignore ${post.competitorName}`}
                              >
                                <EyeOff className="w-3 h-3" />
                              </button>
                              {post.postUrl ? (
                                <a 
                                  href={post.postUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs font-medium text-[#F5A623] hover:underline"
                                >
                                    View <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className={`flex items-center gap-1 text-xs font-medium ${theme.textMuted}`}>
                                    {post.platform}
                                </span>
                              )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
          )}
      </div>

      {/* Discovered Competitors Section */}
      {(competitors.length > 0 || !loading) && (
        <div className={`${theme.bgCard} p-6 rounded-xl border ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'} mb-8`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-serif-display text-[20px] text-[#F5F4F1] flex items-center gap-2">
              <Users className="w-5 h-5 text-[#F5A623]" />
              Competitors ({competitors.length})
            </h2>
            <div className="flex items-center gap-2">
              {ignoredCompetitors.length > 0 && (
                <button
                  onClick={() => setShowIgnoredModal(true)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg ${isDarkMode ? 'bg-[#ededed]/10 text-[#ededed]/70 hover:bg-[#ededed]/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  View Ignored ({ignoredCompetitors.length})
                </button>
              )}
            </div>
          </div>

          {/* Add Competitor Input */}
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Plus className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme.textMuted}`} />
              <input
                type="text"
                placeholder="Add a competitor by name..."
                value={addCompetitorName}
                onChange={(e) => setAddCompetitorName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCompetitor()}
                disabled={addingCompetitor}
                className={`w-full pl-9 pr-4 py-2 border rounded-lg text-sm outline-none focus:border-[#F5A623] disabled:opacity-50 ${
                  isDarkMode ? 'bg-[#070A12] border-slate-700/50 text-[#ededed] placeholder-[#ededed]/50' : 'border-slate-300 text-[#070A12]'
                }`}
              />
            </div>
            <button
              onClick={handleAddCompetitor}
              disabled={!addCompetitorName.trim() || addingCompetitor}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#F5A623] text-black rounded-lg text-sm font-medium hover:bg-[#ffb833] disabled:opacity-50 transition-all"
            >
              {addingCompetitor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {addingCompetitor ? 'Adding...' : 'Add'}
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            {competitors.map(comp => {
              const handle = comp.socialHandles?.instagram || '';
              const action = listHandleAction({ handle, handleStatus: comp.handleStatus });
              return (
              <div
                key={comp._id}
                className={`flex w-full flex-col gap-1 rounded-lg border px-4 py-3 sm:w-auto sm:min-w-[300px] sm:flex-1 sm:basis-[300px] ${isDarkMode ? 'bg-[#070A12] border-slate-700/50' : 'bg-slate-50 border-slate-200'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${isDarkMode ? 'bg-[#F5A623]/20 text-[#F5A623]' : 'bg-[#F5A623]/20 text-amber-700'}`}>
                    {comp.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-sm font-bold break-words ${theme.text}`}>{comp.name}</h3>
                    <p className={`text-xs flex items-center gap-1 ${theme.textMuted}`}>
                      {handle ? <><Instagram className="w-3 h-3" /> {handle}</> : <span>No Instagram handle yet</span>}
                      {comp.location && <><MapPin className="w-3 h-3 ml-2" /> {comp.location}</>}
                    </p>
                    {handle && comp.handleStatus === 'suggested' && <p className={`text-xs ${theme.textMuted}`}>We found this handle. Confirm it so we can track them.</p>}
                  </div>
                  <button
                    onClick={() => handleIgnoreCompetitor(comp._id, comp.name)}
                    className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-50 text-red-500'}`}
                    title="Ignore this competitor"
                    aria-label={`Ignore ${comp.name}`}
                  >
                    <EyeOff className="w-4 h-4" />
                  </button>
                </div>
                {handleNotes[comp._id] && <p role="status" className={`text-[13px] ${theme.text}`}>{handleNotes[comp._id]}</p>}
                {!insightsLocked && (
                  <HandleEditor competitorId={comp._id} competitorName={comp.name} handle={handle} action={action} onSaved={onHandleSaved} onLocked={onInsightsLocked} />
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ignored Competitors Modal */}
      {showIgnoredModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowIgnoredModal(false)}>
          <div 
            className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'} border rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-100'}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-lg font-bold ${theme.text}`}>Ignored Competitors</h3>
                <button onClick={() => setShowIgnoredModal(false)} className={`p-1 rounded hover:bg-[#ededed]/10`}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className={`text-xs mt-1 ${theme.textMuted}`}>These competitors are hidden from your feed. Click restore to see them again.</p>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              {ignoredCompetitors.length === 0 ? (
                <p className={`text-center py-8 ${theme.textMuted}`}>No ignored competitors</p>
              ) : (
                <div className="space-y-2">
                  {ignoredCompetitors.map(comp => (
                    <div key={comp._id} className={`flex items-center justify-between p-3 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-slate-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isDarkMode ? 'bg-[#ededed]/10 text-[#ededed]' : 'bg-slate-200 text-slate-600'}`}>
                          {comp.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className={`text-sm font-medium ${theme.text}`}>{comp.name}</h4>
                          <p className={`text-xs ${theme.textMuted}`}>{comp.industry}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleUnignoreCompetitor(comp._id)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#F5A623] text-black rounded-lg hover:bg-[#ffb833]"
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Competitors;