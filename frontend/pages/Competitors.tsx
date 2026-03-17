import React, { useEffect, useState, useRef } from 'react';
import { apiService } from '../services/api';
import { CompetitorPost } from '../types';
import { Loader2, Search, RotateCw, ExternalLink, Heart, MessageCircle, Plus, Instagram, Twitter, Linkedin, Facebook, Youtube, Swords, Sparkles, X, Eye, Download, Copy, Save, MessageSquare, FileText, EyeOff, Users, MapPin, Edit3, Zap } from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import LogoSelector from '../components/LogoSelector';

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
  isAutoDiscovered?: boolean;
  competitorType?: 'local' | 'regional' | 'national' | 'global' | 'startup' | 'emerging' | 'direct' | 'indirect' | 'market_leader' | 'unknown';
}

const Competitors: React.FC = () => {
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
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [location, setLocation] = useState('');
  
  // Manual add competitor state
  const [addCompetitorName, setAddCompetitorName] = useState('');
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  
  // Rival Post State
  const [showRivalPostModal, setShowRivalPostModal] = useState(false);
  const [rivalPostLoading, setRivalPostLoading] = useState(false);
  const [showLogoSelector, setShowLogoSelector] = useState(false);
  const [pendingRivalPost, setPendingRivalPost] = useState<CompetitorPost | null>(null);
  const [rivalPost, setRivalPost] = useState<{
    caption: string;
    hashtags: string[];
    imageUrl: string;
    platform: string;
    competitorName: string;
    originalContent: string;
  } | null>(null);
  const [editedCaption, setEditedCaption] = useState('');
  const [editedHashtags, setEditedHashtags] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [imageMode, setImageMode] = useState<'ai' | 'upload'>('ai');
  const [customImagePrompt, setCustomImagePrompt] = useState('');
  const [regeneratingImage, setRegeneratingImage] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [rivalImagePrompt, setRivalImagePrompt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ignore a competitor
  const handleIgnoreCompetitor = async (competitorId: string, competitorName: string) => {
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
      const msg = e?.message || '';
      setDiscoveryMessage(`❌ ${msg.includes('already') ? msg : 'Failed to add competitor. Try again.'}`);
    } finally {
      setAddingCompetitor(false);
      setTimeout(() => setDiscoveryMessage(''), 5000);
    }
  };

  // Close rival post modal with credit warning
  const handleCloseRivalModal = () => {
    if (rivalPostLoading || rivalPost) {
      const shouldClose = window.confirm('⚡ 7 credits have already been consumed. Do you want to close?');
      if (!shouldClose) return;
    }
    setShowRivalPostModal(false);
    setRivalPost(null);
    setRivalPostLoading(false);
  };

  // Handle creating a rival post — show logo selector first
  const handleCreateRivalPost = (post: CompetitorPost) => {
    setPendingRivalPost(post);
    setShowLogoSelector(true);
  };

  // Actually generate rival post after logo selection
  const executeRivalPostGeneration = async (post: CompetitorPost, logoUrl: string | null) => {
    setRivalPostLoading(true);
    setShowRivalPostModal(true);
    setRivalPost(null);

    try {
      const result = await apiService.generateRivalPost({
        competitorName: post.competitorName,
        competitorContent: post.content,
        platform: post.platform,
        sentiment: post.sentiment,
        likes: post.likes,
        comments: post.comments,
        brandLogo: logoUrl
      });
      
      setRivalPost({
        caption: result.caption,
        hashtags: result.hashtags,
        imageUrl: result.imageUrl,
        platform: post.platform,
        competitorName: post.competitorName,
        originalContent: post.content
      });
      setEditedCaption(result.caption);
      setEditedHashtags(result.hashtags.join(' '));
      setRivalImagePrompt(result.imagePrompt || '');
      setImageMode('ai');
      setCustomImagePrompt('');
      setUploadedImageUrl(null);
    } catch (error: any) {
      console.error('Failed to generate rival post:', error);
      alert('Failed to generate rival post. Please try again.');
      setShowRivalPostModal(false);
    } finally {
      setRivalPostLoading(false);
    }
  };

  // Save rival post as draft
  const handleSaveAsDraft = async () => {
    if (!rivalPost) return;
    setSavingDraft(true);
    
    try {
      await apiService.createCampaign({
        name: `Rival to ${rivalPost.competitorName}`,
        objective: 'engagement',
        platforms: [rivalPost.platform],
        status: 'draft',
        creative: {
          type: 'image',
          textContent: editedCaption,
          imageUrls: [imageMode === 'upload' && uploadedImageUrl ? uploadedImageUrl : rivalPost.imageUrl],
          captions: editedCaption,
          hashtags: editedHashtags.split(/[\s#]+/).filter(t => t.trim())
        },
        scheduling: {
          startDate: new Date().toISOString().split('T')[0],
          postTime: '10:00'
        }
      });
      
      alert('Saved as draft! Check your Campaigns page.');
      setShowRivalPostModal(false);
      setRivalPost(null);
    } catch (error) {
      console.error('Failed to save draft:', error);
      alert('Failed to save draft. Please try again.');
    } finally {
      setSavingDraft(false);
    }
  };

  // Copy caption to clipboard
  const handleCopyCaption = () => {
    const fullCaption = `${editedCaption}\n\n${editedHashtags}`;
    navigator.clipboard.writeText(fullCaption);
    alert('Caption and hashtags copied to clipboard!');
  };

  // Regenerate image with custom prompt
  const handleRegenerateImage = async () => {
    if (!customImagePrompt.trim() || !rivalPost) return;
    
    setRegeneratingImage(true);
    try {
      const result = await apiService.regenerateImage({
        prompt: customImagePrompt,
        industry: 'general',
        platform: rivalPost.platform,
        originalImagePrompt: rivalImagePrompt || undefined,
        caption: editedCaption || rivalPost.caption || undefined
      });
      if (result.imageUrl) {
        setRivalPost({
          ...rivalPost,
          imageUrl: result.imageUrl
        });
        setUploadedImageUrl(null);
        setImageMode('ai');
        setCustomImagePrompt('');
      }
    } catch (error) {
      console.error('Failed to regenerate image:', error);
      alert('Failed to regenerate image. Please try again.');
    } finally {
      setRegeneratingImage(false);
    }
  };

  // Handle file upload for custom image
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedImageUrl(e.target?.result as string);
      setImageMode('upload');
    };
    reader.readAsDataURL(file);
  };

  // Get current image URL based on mode
  const getCurrentImageUrl = () => {
    if (imageMode === 'upload' && uploadedImageUrl) return uploadedImageUrl;
    return rivalPost?.imageUrl || '';
  };

  // Download image
  const handleDownloadImage = async () => {
    if (!rivalPost?.imageUrl) return;
    
    try {
      const response = await fetch(rivalPost.imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rival-post-${rivalPost.platform}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      window.open(rivalPost.imageUrl, '_blank');
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
        console.log('Could not load business location');
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
      if (res.success && res.posts && res.posts.length > 0) {
        // Merge new posts into existing posts (avoid duplicates)
        setPosts(prev => {
          const existingIds = new Set(prev.map((p: any) => p.id || p._id));
          const newPosts = res.posts.filter((p: any) => !existingIds.has(p.id || p._id));
          return [...prev, ...newPosts];
        });
      }
    } catch (error) {
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
              className={`w-full px-4 py-3 border rounded-lg text-sm outline-none focus:border-[#ffcc29] mb-4 ${
                isDarkMode ? 'bg-[#070A12] border-slate-700/50 text-[#ededed] placeholder-[#ededed]/50' : 'border-slate-300 text-[#070A12]'
              }`}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowLocationModal(false)}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium border ${
                  isDarkMode ? 'border-slate-700/50 text-[#ededed] hover:bg-[#ffcc29]/10' : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleAutoDiscover}
                disabled={!location.trim()}
                className="flex-1 px-4 py-2 bg-[#ffcc29] text-black rounded-lg text-sm font-medium hover:bg-[#ffcc29]/90 disabled:opacity-50"
              >
                Find Competitors
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${theme.text}`}>Competitor Analysis</h1>
          <p className={theme.textSecondary}>Track market rivals with real-time AI search.</p>
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
                  ? 'bg-[#ffcc29] text-black border-[#ffcc29] shadow-sm'
                  : isDarkMode
                    ? 'bg-[#0f1419] border-slate-700/50 text-slate-300 hover:border-[#ffcc29]/40 hover:text-[#ffcc29]'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-[#ffcc29]/40 hover:text-[#ffcc29]'
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
          <div className="flex justify-between items-center mb-6">
              <h2 className={`text-lg font-bold ${theme.text}`}>Competitor Activity Feed</h2>
              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${theme.textMuted}`} />
                  <input 
                      type="text" 
                      placeholder="Filter by keyword..." 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className={`w-full pl-9 pr-8 py-2 border rounded-lg text-sm outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#070A12] border-slate-700/50 text-[#ededed] placeholder-[#ededed]/50' : 'border-slate-300 text-[#070A12]'}`}
                  />
                  <RotateCw 
                    className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 cursor-pointer hover:text-[#ffcc29] ${theme.textMuted} ${loading ? 'animate-spin' : ''}`}
                    onClick={handleRefresh}
                  />
                </div>
              </div>
          </div>

          {loading || fetchingType ? (
             <div className="flex justify-center py-12">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 text-[#ffcc29] animate-spin mx-auto mb-3" />
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
                    className="px-4 py-2 bg-[#ffcc29] text-black rounded-lg text-sm font-medium hover:bg-[#e6b825] flex items-center gap-2 mx-auto"
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
                                    (isDarkMode ? 'bg-[#ffcc29]/20 text-[#ffcc29]' : 'bg-[#ffcc29]/20 text-indigo-700')
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

                        {/* Create Rival Post Button */}
                        <button
                          onClick={() => handleCreateRivalPost(post)}
                          className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black text-sm font-semibold rounded-lg hover:shadow-lg hover:scale-[1.02] transition-all"
                        >
                          <Swords className="w-4 h-4" />
                          Create Rival Post
                          <span className="flex items-center gap-0.5 text-xs opacity-80"><Zap className="w-3 h-3" />7</span>
                        </button>

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
                                  className="flex items-center gap-1 text-xs font-medium text-[#ffcc29] hover:underline"
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
            <h2 className={`text-lg font-bold ${theme.text} flex items-center gap-2`}>
              <Users className="w-5 h-5 text-[#ffcc29]" />
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
                className={`w-full pl-9 pr-4 py-2 border rounded-lg text-sm outline-none focus:border-[#ffcc29] disabled:opacity-50 ${
                  isDarkMode ? 'bg-[#070A12] border-slate-700/50 text-[#ededed] placeholder-[#ededed]/50' : 'border-slate-300 text-[#070A12]'
                }`}
              />
            </div>
            <button
              onClick={handleAddCompetitor}
              disabled={!addCompetitorName.trim() || addingCompetitor}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#ffcc29] text-black rounded-lg text-sm font-medium hover:bg-[#e6b825] disabled:opacity-50 transition-all"
            >
              {addingCompetitor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {addingCompetitor ? 'Adding...' : 'Add'}
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            {competitors.map(comp => (
              <div 
                key={comp._id} 
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${isDarkMode ? 'bg-[#070A12] border-slate-700/50' : 'bg-slate-50 border-slate-200'}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${isDarkMode ? 'bg-[#ffcc29]/20 text-[#ffcc29]' : 'bg-[#ffcc29]/20 text-amber-700'}`}>
                  {comp.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={`text-sm font-bold truncate ${theme.text}`}>{comp.name}</h3>
                  <p className={`text-xs flex items-center gap-1 ${theme.textMuted}`}>
                    {comp.socialHandles?.instagram && <><Instagram className="w-3 h-3" /> {comp.socialHandles.instagram}</>}
                    {comp.location && <><MapPin className="w-3 h-3 ml-2" /> {comp.location}</>}
                  </p>
                </div>
                <button
                  onClick={() => handleIgnoreCompetitor(comp._id, comp.name)}
                  className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-50 text-red-500'}`}
                  title="Ignore this competitor"
                >
                  <EyeOff className="w-4 h-4" />
                </button>
              </div>
            ))}
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
                        className="px-3 py-1.5 text-xs font-medium bg-[#ffcc29] text-black rounded-lg hover:bg-[#e6b825]"
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

      {/* Logo Selector Modal */}
      <LogoSelector
        isOpen={showLogoSelector}
        onClose={() => { setShowLogoSelector(false); setPendingRivalPost(null); }}
        onConfirm={(logoUrl) => {
          setShowLogoSelector(false);
          if (pendingRivalPost) {
            executeRivalPostGeneration(pendingRivalPost, logoUrl);
            setPendingRivalPost(null);
          }
        }}
      />

      {/* Rival Post Modal */}
      {showRivalPostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={handleCloseRivalModal}>
          <div 
            className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'} border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-r from-[#0d1117] to-[#161b22]' : 'border-slate-100 bg-gradient-to-r from-white to-slate-50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#ffcc29] to-[#ffa500] flex items-center justify-center">
                    <Swords className="w-5 h-5 text-black" />
                  </div>
                  <div>
                    <h3 className={`text-lg font-bold ${theme.text}`}>Create Rival Post</h3>
                    <p className={`text-xs ${theme.textMuted}`}>
                      {rivalPost ? `Countering ${rivalPost.competitorName}'s ${rivalPost.platform} post` : 'Generating your viral counter-post...'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleCloseRivalModal}
                  className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-slate-100'} transition-colors`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
              {rivalPostLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-[#ffcc29] to-[#ffa500] flex items-center justify-center mb-4 animate-pulse">
                    <Sparkles className="w-8 h-8 text-black animate-spin" />
                  </div>
                  <p className={`text-lg font-semibold ${theme.text} mb-2`}>Crafting Your Viral Post</p>
                  <p className={`text-sm ${theme.textMuted} text-center max-w-sm`}>
                    Our AI is analyzing the competitor's content and creating a unique, engaging post that will help you stand out...
                  </p>
                  <div className="flex items-center gap-2 mt-4">
                    <div className="w-2 h-2 rounded-full bg-[#ffcc29] animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-[#ffcc29] animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-[#ffcc29] animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              ) : rivalPost ? (
                <div className="space-y-6">
                  {/* Original Post Reference */}
                  <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-[#ffcc29]/10' : 'bg-slate-50 border-slate-200'} border`}>
                    <p className={`text-xs font-medium ${theme.textMuted} mb-2 flex items-center gap-1.5`}>
                      <Eye className="w-3.5 h-3.5" /> Original Competitor Post
                    </p>
                    <p className={`text-sm ${theme.textSecondary} italic`}>"{rivalPost.originalContent}"</p>
                  </div>

                  {/* Image Section with Editing Options */}
                  <div className="space-y-4">
                    {/* Image Mode Toggle */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setImageMode('ai')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          imageMode === 'ai' 
                            ? 'bg-[#ffcc29] text-black' 
                            : `${isDarkMode ? 'bg-[#161b22] text-white hover:bg-[#21262d]' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`
                        }`}
                      >
                        <Sparkles className="w-3 h-3" /> AI Image
                      </button>
                      <button
                        onClick={() => setImageMode('upload')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          imageMode === 'upload' 
                            ? 'bg-[#ffcc29] text-black' 
                            : `${isDarkMode ? 'bg-[#161b22] text-white hover:bg-[#21262d]' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`
                        }`}
                      >
                        <Download className="w-3 h-3 rotate-180" /> Upload Image
                      </button>
                    </div>

                    {/* Image Display */}
                    <div className="relative rounded-xl overflow-hidden border border-slate-700/50">
                      <img 
                        src={getCurrentImageUrl()} 
                        alt="Post image" 
                        className="w-full h-64 object-cover"
                      />
                      <button
                        onClick={handleDownloadImage}
                        className="absolute bottom-3 right-3 p-2 bg-black/60 hover:bg-black/80 rounded-lg text-white transition-colors"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {imageMode === 'upload' && uploadedImageUrl && (
                        <div className="absolute top-3 left-3 px-2 py-1 bg-[#ffcc29] text-black text-xs font-medium rounded-lg">
                          Custom Image
                        </div>
                      )}
                    </div>

                    {/* AI Image Regeneration */}
                    {imageMode === 'ai' && (
                      <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-[#ffcc29]/10' : 'bg-slate-50 border-slate-200'} border`}>
                        <p className={`text-xs font-medium ${theme.textMuted} mb-2 flex items-center gap-1.5`}>
                          <Edit3 className="w-3.5 h-3.5" /> Refine Image
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customImagePrompt}
                            onChange={(e) => setCustomImagePrompt(e.target.value)}
                            placeholder="e.g. make it more vibrant, add warm tones, more professional..."
                            className={`flex-1 px-3 py-2 rounded-lg text-sm ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white placeholder-gray-500' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'} border focus:ring-2 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] transition-all`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !regeneratingImage) {
                                handleRegenerateImage();
                              }
                            }}
                          />
                          <button
                            onClick={handleRegenerateImage}
                            disabled={regeneratingImage || !customImagePrompt.trim()}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black text-sm font-medium hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {regeneratingImage ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                            {regeneratingImage ? 'Generating...' : 'Generate'}
                          </button>
                        </div>
                        <p className={`text-xs ${theme.textMuted} mt-2`}>
                          Refines the current image — e.g., "more vibrant", "darker background", "add tech elements"
                        </p>
                      </div>
                    )}

                    {/* File Upload */}
                    {imageMode === 'upload' && (
                      <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-[#ffcc29]/10' : 'bg-slate-50 border-slate-200'} border`}>
                        <p className={`text-xs font-medium ${theme.textMuted} mb-2 flex items-center gap-1.5`}>
                          <Download className="w-3.5 h-3.5 rotate-180" /> Upload Your Own Image
                        </p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="hidden"
                        />
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed ${
                            isDarkMode 
                              ? 'border-[#ffcc29]/30 hover:border-[#ffcc29] bg-[#0d1117]' 
                              : 'border-slate-300 hover:border-[#ffcc29] bg-white'
                          } transition-all`}
                        >
                          <Plus className="w-5 h-5 text-[#ffcc29]" />
                          <span className={`text-sm ${theme.text}`}>
                            {uploadedImageUrl ? 'Change Image' : 'Select Image'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Caption */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className={`text-xs font-medium ${theme.textMuted} flex items-center gap-1.5`}>
                        <MessageSquare className="w-3.5 h-3.5" /> Caption
                      </p>
                      <button
                        onClick={handleCopyCaption}
                        className={`flex items-center gap-1 text-xs ${theme.textMuted} hover:text-[#ffcc29] transition-colors`}
                      >
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                    <textarea
                      value={editedCaption}
                      onChange={(e) => setEditedCaption(e.target.value)}
                      className={`w-full p-4 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} border focus:ring-2 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] transition-all resize-none`}
                      rows={4}
                    />
                  </div>

                  {/* Hashtags */}
                  <div>
                    <p className={`text-xs font-medium ${theme.textMuted} mb-2 flex items-center gap-1.5`}>
                      <FileText className="w-3.5 h-3.5" /> Hashtags
                    </p>
                    <input
                      type="text"
                      value={editedHashtags}
                      onChange={(e) => setEditedHashtags(e.target.value)}
                      className={`w-full p-3 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} border focus:ring-2 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] transition-all`}
                      placeholder="#trending #viral #marketing"
                    />
                    <p className={`text-xs ${theme.textMuted} mt-1`}>
                      {editedHashtags.split(/[\s#]+/).filter(t => t.trim()).length} hashtags
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Footer Actions */}
            {rivalPost && !rivalPostLoading && (
              <div className={`px-6 py-4 border-t ${isDarkMode ? 'border-slate-700/50 bg-[#0d1117]' : 'border-slate-100 bg-white'}`}>
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={handleCloseRivalModal}
                    className={`px-4 py-2.5 rounded-xl ${isDarkMode ? 'bg-[#161b22] hover:bg-[#21262d]' : 'bg-slate-100 hover:bg-slate-200'} ${theme.text} text-sm font-medium transition-colors`}
                  >
                    Cancel
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveAsDraft}
                      disabled={savingDraft}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-[#ffcc29]/30 hover:border-[#ffcc29]' : 'bg-white border-slate-200 hover:border-[#ffcc29]'} border ${theme.text} text-sm font-medium transition-all disabled:opacity-50`}
                    >
                      {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save as Draft
                    </button>
                    <button
                      onClick={handleCopyCaption}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black text-sm font-semibold hover:shadow-lg hover:scale-105 transition-all"
                    >
                      <Copy className="w-4 h-4" />
                      Copy & Post
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Competitors;