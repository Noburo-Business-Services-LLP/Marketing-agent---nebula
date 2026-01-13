import React, { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { CompetitorPost } from '../types';
import { Loader2, Search, RotateCw, ExternalLink, Heart, MessageCircle, Plus, Instagram, Twitter, Linkedin, Facebook, Youtube, Swords, Sparkles, X, Eye, Download, Copy, Save, MessageSquare, FileText, EyeOff, Users, MapPin } from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

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
  const [showIgnoredModal, setShowIgnoredModal] = useState(false);
  
  // Auto-discover state
  const [discovering, setDiscovering] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState('');
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [location, setLocation] = useState('');
  
  // Rival Post State
  const [showRivalPostModal, setShowRivalPostModal] = useState(false);
  const [rivalPostLoading, setRivalPostLoading] = useState(false);
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

  // Handle creating a rival post
  const handleCreateRivalPost = async (post: CompetitorPost) => {
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
        comments: post.comments
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
    } catch (error) {
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
          imageUrls: [rivalPost.imageUrl],
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
      }
      
      if (res.posts && res.posts.length > 0) {
        setPosts(res.posts);
      } else {
        // Try to auto-discover competitors using saved business location
        try {
          const contextRes = await apiService.getBusinessContext();
          if (contextRes.success && contextRes.businessLocation) {
            setLocation(contextRes.businessLocation);
            setDiscovering(true);
            setDiscoveryMessage(`🔍 AI is discovering competitors in ${contextRes.businessLocation}...`);
            
            const discoverRes = await apiService.autoDiscoverCompetitors({ 
              location: contextRes.businessLocation, 
              forceRefresh: false // Don't force refresh if we have recent data
            });
            
            if (discoverRes.success && discoverRes.posts && discoverRes.posts.length > 0) {
              setPosts(discoverRes.posts);
              if (discoverRes.competitors) setCompetitors(discoverRes.competitors);
              setDiscoveryMessage(`✅ Found ${discoverRes.discovered || discoverRes.competitors?.length || 0} competitors with ${discoverRes.posts.length} posts!`);
            } else if (discoverRes.success && discoverRes.competitors && discoverRes.competitors.length > 0) {
              setCompetitors(discoverRes.competitors);
              setDiscoveryMessage(`✅ Found ${discoverRes.competitors.length} competitors. Fetching their posts...`);
            } else {
              setDiscoveryMessage('No competitors found yet. Click "Discover Competitors" to search.');
            }
            
            setDiscovering(false);
            setTimeout(() => setDiscoveryMessage(''), 5000);
          } else {
            setDiscoveryMessage('Complete onboarding with your business location to auto-discover competitors.');
          }
        } catch (discoverError) {
          console.error('Auto-discover failed:', discoverError);
          setDiscoveryMessage('Could not auto-discover. Click "Discover Competitors" to try manually.');
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

  const filteredPosts = posts.filter(post =>
    post.content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    post.competitorName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
        <div className="flex gap-2">
          {/* Auto-Discover Button */}
          <button
            onClick={() => setShowLocationModal(true)}
            disabled={discovering}
            className="flex items-center gap-2 px-4 py-1.5 bg-[#ffcc29] text-black rounded text-sm font-medium hover:bg-[#ffcc29]/90 disabled:opacity-50"
          >
            {discovering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {discovering ? 'Discovering...' : 'Auto-Discover'}
          </button>
          
          {['Last 7 days', 'Last 1 month', 'Last 3 months'].map(f => (
            <button 
              key={f} 
              onClick={() => setSelectedFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded border ${f === selectedFilter 
                ? 'bg-[#ffcc29]/10 border-[#ffcc29]/30 text-[#ffcc29]' 
                : `${theme.bgCard} ${isDarkMode ? 'border-slate-700/50 text-[#ededed]/70 hover:bg-[#ffcc29]/10' : 'border-slate-200 text-slate-600 hover:bg-[#f5f5f5]'}`}`}
            >
              {f}
            </button>
          ))}
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

          {loading ? (
             <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 text-[#ffcc29] animate-spin" />
             </div>
          ) : filteredPosts.length === 0 ? (
             <div className="text-center py-12">
                <p className={`${theme.textSecondary} mb-4`}>No competitor posts found.</p>
                <button 
                  onClick={handleRefresh}
                  className="px-4 py-2 bg-[#ffcc29] text-white rounded-lg text-sm font-medium hover:bg-[#e6b825]"
                >
                  Load Sample Data
                </button>
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
      {competitors.length > 0 && (
        <div className={`${theme.bgCard} p-6 rounded-xl border ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'} mb-8`}>
          <div className="flex justify-between items-center mb-4">
            <h2 className={`text-lg font-bold ${theme.text} flex items-center gap-2`}>
              <Users className="w-5 h-5 text-[#ffcc29]" />
              Discovered Competitors ({competitors.length})
            </h2>
            {ignoredCompetitors.length > 0 && (
              <button
                onClick={() => setShowIgnoredModal(true)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg ${isDarkMode ? 'bg-[#ededed]/10 text-[#ededed]/70 hover:bg-[#ededed]/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                View Ignored ({ignoredCompetitors.length})
              </button>
            )}
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

      {/* Rival Post Modal */}
      {showRivalPostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !rivalPostLoading && setShowRivalPostModal(false)}>
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
                  onClick={() => setShowRivalPostModal(false)}
                  disabled={rivalPostLoading}
                  className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-slate-100'} transition-colors disabled:opacity-50`}
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

                  {/* Generated Image */}
                  <div className="relative">
                    <p className={`text-xs font-medium ${theme.textMuted} mb-2 flex items-center gap-1.5`}>
                      <Sparkles className="w-3.5 h-3.5 text-[#ffcc29]" /> AI Generated Image
                    </p>
                    <div className="relative rounded-xl overflow-hidden border border-slate-700/50">
                      <img 
                        src={rivalPost.imageUrl} 
                        alt="Generated rival post" 
                        className="w-full h-64 object-cover"
                      />
                      <button
                        onClick={handleDownloadImage}
                        className="absolute bottom-3 right-3 p-2 bg-black/60 hover:bg-black/80 rounded-lg text-white transition-colors"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
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
                    onClick={() => setShowRivalPostModal(false)}
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