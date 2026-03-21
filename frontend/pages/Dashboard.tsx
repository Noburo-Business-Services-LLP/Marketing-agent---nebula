import React, { useEffect, useState, useRef, useMemo } from 'react';
import { apiService, brandAssetsAPI } from '../services/api';
import { DashboardData, Campaign, CompetitorPost } from '../types';
import { TrendingUp, ArrowUpRight, ChevronRight, ChevronLeft, Calendar as CalendarIcon, Calendar, CalendarSync, Info, Activity, Clock, MoreHorizontal, Plus, X, ExternalLink, Edit3, Share2, MessageSquare, FileText, Loader2, Bell, BellRing, Check, AlertCircle, Trash2, Eye, Users, BarChart3, Swords, Sparkles, Download, Copy, Send, Save, Lightbulb, Flame, Target, Zap, Music, Image as ImageIcon, RefreshCw, PenTool, Wand2, Upload, Filter, Unlink } from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import PlatformPreview from '../components/PlatformPreview';
import LogoSelector from '../components/LogoSelector';

// Section info descriptions
const sectionInfo: Record<string, { title: string; description: string }> = {
  activeCampaigns: {
    title: 'Active Campaigns',
    description: 'This shows the total number of marketing campaigns that are currently running or have been posted. Active campaigns are those that are live and generating engagement, impressions, or conversions for your brand.'
  },
  budgetSpent: {
    title: 'Budget Spent',
    description: 'This tracks your total marketing spend across all active and completed campaigns. The graph shows your daily spending pattern over the past week, helping you understand your budget allocation and pacing.'
  },
  socialProfiles: {
    title: 'Social Profiles',
    description: 'View your connected social media accounts at a glance. Track followers, engagement rates, and growth across all your platforms. Connect more accounts to unlock full analytics and one-click posting.'
  },
  brandScore: {
    title: 'Brand Score',
    description: 'Your Brand Score (0-100) measures your overall marketing health based on engagement rates, content consistency, audience growth, and campaign performance across all connected platforms.'
  },
  competitorRadar: {
    title: 'Competitor Radar',
    description: 'This section monitors your competitors\' social media activity in real-time. It shows their recent posts, engagement metrics, and AI-powered sentiment analysis to help you stay ahead of market trends.'
  },
  strategicAdvisor: {
    title: 'Strategic Advisor',
    description: 'Your AI-powered content strategist that suggests viral content topics based on trending events, competitor activity, holidays, festivals, and moment marketing opportunities. Get personalized post ideas that align with your brand and maximize engagement.'
  },
  calendar: {
    title: 'Campaign Calendar',
    description: 'A visual timeline of all your scheduled, active, and completed campaigns. Use this calendar to plan your content strategy, avoid scheduling conflicts, and ensure consistent posting.'
  }
};

// Section Info Button Component
const SectionButtons: React.FC<{
  sectionType: string;
  sectionData: any;
  variant?: 'light' | 'dark';
}> = ({ sectionType, sectionData, variant = 'light' }) => {
  const [showSynopsis, setShowSynopsis] = useState(false);
  const [isHoveringInfo, setIsHoveringInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  const info = sectionInfo[sectionType];
  const isDark = variant === 'dark';

  return (
    <div className="flex items-center gap-1">
      {/* Info Button - Click to open modal for Brand Score, hover for others */}
      <div 
        className="relative"
        ref={infoRef}
        onMouseEnter={() => sectionType !== 'brandScore' && setIsHoveringInfo(true)}
        onMouseLeave={() => sectionType !== 'brandScore' && setIsHoveringInfo(false)}
      >
        <button
          onClick={() => sectionType === 'brandScore' && setIsHoveringInfo(!isHoveringInfo)}
          className={`group relative w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 text-xs font-bold shadow-sm ${
            isDark 
              ? 'bg-gradient-to-br from-white/20 to-white/10 hover:from-white/30 hover:to-white/20 text-white border border-white/20 hover:border-white/40 hover:scale-110' 
              : 'bg-gradient-to-br from-blue-50 to-indigo-100 hover:from-blue-100 hover:to-indigo-200 text-[#ffcc29] border border-indigo-200/50 hover:border-indigo-300 hover:scale-110 hover:shadow-md'
          }`}
        >
          <span className="relative z-10">i</span>
          <div className={`absolute inset-0 rounded-full transition-opacity duration-300 ${isDark ? 'bg-white/10' : 'bg-[#ffcc29]/10'} opacity-0 group-hover:opacity-100`}></div>
        </button>
        
        {/* Info Tooltip - Static modal with X button for Brand Score */}
        {isHoveringInfo && (
          <>
            {/* Backdrop for Brand Score modal */}
            {sectionType === 'brandScore' && (
              <div 
                className="fixed inset-0 z-[9998] bg-black/20" 
                onClick={() => setIsHoveringInfo(false)}
              />
            )}
            <div 
              className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-200" 
              style={{
                width: sectionType === 'brandScore' ? '420px' : '280px',
                maxHeight: sectionType === 'brandScore' ? '80vh' : 'auto',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                overflowY: sectionType === 'brandScore' ? 'auto' : 'visible'
              }}
            >
              <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-4">
                {/* Header with X button */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-[#ffcc29]/20 rounded-lg">
                      <Info className="w-3.5 h-3.5 text-[#ffcc29]" />
                    </div>
                    <h4 className="text-sm font-semibold text-[#0a0f1a]">{info?.title}</h4>
                  </div>
                  {sectionType === 'brandScore' && (
                    <button 
                      onClick={() => setIsHoveringInfo(false)}
                      className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-slate-400" />
                    </button>
                  )}
                </div>
                
                {sectionType === 'brandScore' ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Your <strong>Brand Score</strong> (0-100) measures your brand's overall marketing health, calculated in real-time from your connected platforms.
                    </p>
                    
                    {/* Weightage Breakdown */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">📊 Weightage Breakdown</p>
                      
                      {/* Engagement 30% */}
                      <div className="p-2.5 bg-[#ffcc29]/5 rounded-lg border-l-3 border-[#ffcc29]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-8 h-8 bg-[#ffcc29]/20 rounded flex items-center justify-center text-[#ffcc29] font-bold text-xs">30%</span>
                          <span className="font-semibold text-sm text-slate-800">Engagement Rate</span>
                        </div>
                        <ul className="text-xs text-slate-500 space-y-0.5 ml-10">
                          <li>• Likes, comments, shares per post</li>
                          <li>• Saves & bookmarks rate</li>
                          <li>• Industry benchmark comparison</li>
                        </ul>
                      </div>
                      
                      {/* Consistency 25% */}
                      <div className="p-2.5 bg-blue-50/50 rounded-lg border-l-3 border-blue-500">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center text-blue-600 font-bold text-xs">25%</span>
                          <span className="font-semibold text-sm text-slate-800">Content Consistency</span>
                        </div>
                        <ul className="text-xs text-slate-500 space-y-0.5 ml-10">
                          <li>• Posting frequency & schedule</li>
                          <li>• Platform coverage</li>
                          <li>• Optimal timing adherence</li>
                        </ul>
                      </div>
                      
                      {/* Growth 25% */}
                      <div className="p-2.5 bg-emerald-50/50 rounded-lg border-l-3 border-emerald-500">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-8 h-8 bg-emerald-100 rounded flex items-center justify-center text-emerald-600 font-bold text-xs">25%</span>
                          <span className="font-semibold text-sm text-slate-800">Audience Growth</span>
                        </div>
                        <ul className="text-xs text-slate-500 space-y-0.5 ml-10">
                          <li>• Follower growth rate (WoW/MoM)</li>
                          <li>• Reach & impressions</li>
                          <li>• Profile visit trends</li>
                        </ul>
                      </div>
                      
                      {/* Performance 20% */}
                      <div className="p-2.5 bg-amber-50/50 rounded-lg border-l-3 border-amber-500">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-8 h-8 bg-amber-100 rounded flex items-center justify-center text-amber-600 font-bold text-xs">20%</span>
                          <span className="font-semibold text-sm text-slate-800">Campaign Performance</span>
                        </div>
                        <ul className="text-xs text-slate-500 space-y-0.5 ml-10">
                          <li>• Click-through rate (CTR)</li>
                          <li>• Conversion rate & ROI</li>
                          <li>• Goal achievement</li>
                        </ul>
                      </div>
                    </div>
                    
                    {/* Score Ranges */}
                    <div className="p-2.5 bg-slate-50 rounded-lg">
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">🎯 Score Ranges</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        <div className="flex items-center gap-1.5 p-1.5 bg-white rounded text-xs">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                          <span><b>80-100</b> Great</span>
                        </div>
                        <div className="flex items-center gap-1.5 p-1.5 bg-white rounded text-xs">
                          <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                          <span><b>60-79</b> Good</span>
                        </div>
                        <div className="flex items-center gap-1.5 p-1.5 bg-white rounded text-xs">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                          <span><b>40-59</b> Fair</span>
                        </div>
                        <div className="flex items-center gap-1.5 p-1.5 bg-white rounded text-xs">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                          <span><b>0-39</b> Low</span>
                        </div>
                      </div>
                    </div>
                    
                    <p className="text-[10px] text-slate-400 text-center pt-1">
                      📡 Updated in real-time from connected platforms
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {info?.description}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      
    </div>
  );
};

const Dashboard: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBrandScoreInfo, setShowBrandScoreInfo] = useState(false);
  const [competitorIndex, setCompetitorIndex] = useState(0);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; value: number } | null>(null);
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set());
  const [loadingMoreActions, setLoadingMoreActions] = useState(false);
  
  // Social Followers Bar Chart State
  const [followerData, setFollowerData] = useState<Array<{
    platform: string;
    name: string;
    followers: number;
    color: string;
    bgColor: string;
    logo: string;
  }>>([]);
  const [followerLoading, setFollowerLoading] = useState(true);
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);
  
  // Logo Selector State
  const [showLogoSelector, setShowLogoSelector] = useState(false);
  const [pendingRivalCompetitor, setPendingRivalCompetitor] = useState<any>(null);
  const [selectedLogoUrl, setSelectedLogoUrl] = useState<string | null>(null);

  // Aspect Ratio Selector State
  const [showAspectRatioModal, setShowAspectRatioModal] = useState(false);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>('1:1');
  const [pendingLogoUrl, setPendingLogoUrl] = useState<string | null>(null);

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
  const [postingDirectly, setPostingDirectly] = useState(false);
  
  // Image editing states
  const [imageMode, setImageMode] = useState<'ai' | 'upload'>('ai');
  const [customImagePrompt, setCustomImagePrompt] = useState('');
  const [regeneratingImage, setRegeneratingImage] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [rivalImagePrompt, setRivalImagePrompt] = useState('');
  const [rivalScheduleDate, setRivalScheduleDate] = useState('');
  const [rivalScheduleTime, setRivalScheduleTime] = useState('');
  const [rivalSelectedPlatform, setRivalSelectedPlatform] = useState<string[]>(['instagram']);
  const [rivalPostingNow, setRivalPostingNow] = useState(false);
  const [rivalScheduling, setRivalScheduling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Cache flags — prevent re-fetching on tab switch
  const hasFetchedDashboard = useRef(false);
  const hasFetchedStrategic = useRef(false);
  const hasFetchedFollowers = useRef(false);

  // Strategic Advisor State
  const [strategicSuggestions, setStrategicSuggestions] = useState<any[]>([]);
  const [trendingNow, setTrendingNow] = useState<string[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [competitorInsight, setCompetitorInsight] = useState<string>('');
  const [strategicLoading, setStrategicLoading] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [showPostCreator, setShowPostCreator] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<any>(null);
  const [generatingPost, setGeneratingPost] = useState(false);
  const [generatedPost, setGeneratedPost] = useState<any>(null);
  const [showStrategicLogoModal, setShowStrategicLogoModal] = useState(false);
  const [showStrategicAspectModal, setShowStrategicAspectModal] = useState(false);
  const [strategicSelectedLogo, setStrategicSelectedLogo] = useState<string | null>(null);
  const [strategicAspectRatio, setStrategicAspectRatio] = useState<string>('1:1');
  const [pendingStrategicSuggestion, setPendingStrategicSuggestion] = useState<any>(null);
  const [postCaption, setPostCaption] = useState('');
  const [postHashtags, setPostHashtags] = useState<string[]>([]);
  const [postImageUrl, setPostImageUrl] = useState('');
  const [postImagePrompt, setPostImagePrompt] = useState('');
  const [refiningImage, setRefiningImage] = useState(false);
  const [imageRefinementPrompt, setImageRefinementPrompt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [audioVolume, setAudioVolume] = useState(0.7);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Sample audio URLs for trending sounds (royalty-free samples)
  const sampleAudioUrls: Record<string, string> = {
    'Epic Cinematic Trailer Music': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'Vroom Vroom (Sound effect)': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    'Upbeat Corporate': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    'Energetic Pop': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    'Motivational Beats': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    'default': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
  };
  
  // Handle audio playback
  const handlePlayAudio = (audioName: string) => {
    const audioUrl = sampleAudioUrls[audioName] || sampleAudioUrls['default'];
    
    if (playingAudio === audioName) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingAudio(null);
    } else {
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      // Play new audio
      const audio = new Audio(audioUrl);
      audio.volume = audioVolume;
      audio.play().catch(err => console.error('Audio play error:', err));
      audio.onended = () => setPlayingAudio(null);
      audioRef.current = audio;
      setPlayingAudio(audioName);
    }
  };
  
  // Cleanup audio on component unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);
  
  // Sample budget data points for the graph - use real data if available
  const budgetData = (data?.overview as any)?.dailySpend?.map((d: any) => d.spend) || [0, 0, 0, 0, 0, 0, 0];
  const days = (data?.overview as any)?.dailySpend?.map((d: any) => d.day) || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hasRealData = data?.dataSource === 'real';
  const hasCampaigns = (data?.overview?.totalCampaigns || 0) > 0;
  const hasSpend = (data?.overview?.totalSpent || 0) > 0;
  
  // Fetch dashboard data
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (refresh = false) => {
    const startTime = Date.now();
    if (refresh) {
      setRefreshing(true);
      hasFetchedDashboard.current = false;
      hasFetchedStrategic.current = false;
      hasFetchedFollowers.current = false;
    }

    try {
      const dashboardData = await apiService.getDashboardOverview(refresh);
      setData(dashboardData);
      hasFetchedDashboard.current = true;
      console.log(`Dashboard ${refresh ? 'refreshed' : 'loaded'} in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error("Failed to load dashboard", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    // Also refresh strategic suggestions and follower data
    if (refresh) {
      fetchStrategicSuggestions(true);
      fetchFollowerData(true);
    }
  };
  
  // Fetch Strategic Advisor suggestions (lazy load after dashboard is ready)
  const fetchStrategicSuggestions = async (force = false) => {
    if (hasFetchedStrategic.current && !force) return;
    console.log('[Strategic] Fetching suggestions...');
    setStrategicLoading(true);
    try {
      const result = await apiService.getStrategicSuggestions(force);
      console.log('[Strategic] API result:', result);
      if (result.success) {
        console.log('[Strategic] Setting suggestions:', result.suggestions?.length, 'items');
        setStrategicSuggestions(result.suggestions || []);
        setTrendingNow(result.trendingNow || []);
        setUpcomingEvents(result.upcomingEvents || []);
        setCompetitorInsight(result.competitorInsight || '');
        hasFetchedStrategic.current = true;
      } else {
        console.error('[Strategic] API returned success: false');
      }
    } catch (error) {
      console.error('Failed to fetch strategic suggestions:', error);
    } finally {
      setStrategicLoading(false);
    }
  };
  
  // Handle creating a post from suggestion (called after logo + aspect ratio selection)
  const handleCreatePost = async (suggestion: any, logoUrl?: string | null, aspectRatio?: string) => {
    // Upfront credit check
    try {
      const creditData = await apiService.getCredits();
      const balance = creditData?.credits?.balance ?? 0;
      if (balance < 7) {
        alert(`Insufficient credits. You need 7 credits to create a post but you only have ${balance}. Please wait for your next credit cycle or upgrade your plan.`);
        return;
      }
    } catch (e) {
      console.error('Credit check failed:', e);
    }
    setSelectedSuggestion(suggestion);
    setShowPostCreator(true);
    setGeneratingPost(true);
    setGeneratedPost(null);

    try {
      const result = await apiService.generatePostFromSuggestion(suggestion, logoUrl, aspectRatio);
      if (result.success && result.post) {
        setGeneratedPost(result.post);
        setPostCaption(result.post.caption || '');
        setPostHashtags(result.post.hashtags || []);
        setPostImageUrl(result.post.generatedImageUrl || '');
        setPostImagePrompt(result.post.imagePrompt || '');
        const suggestedPlatforms = suggestion.platforms || ['instagram'];
        const connectedNames = followerData.map(f => f.platform.toLowerCase());
        const validPlatforms = suggestedPlatforms.filter((p: string) =>
          connectedNames.includes(p) || (p === 'twitter' && connectedNames.includes('x')) || (p === 'x' && connectedNames.includes('twitter'))
        );
        setSelectedPlatform(validPlatforms.length > 0 ? validPlatforms : connectedNames.length > 0 ? [connectedNames[0]] : []);
      }
    } catch (error) {
      console.error('Failed to generate post:', error);
    } finally {
      setGeneratingPost(false);
    }
  };
  
  // Handle refining image
  const handleRefineImage = async () => {
    if (!imageRefinementPrompt.trim() || !postImagePrompt) return;
    // Upfront credit check
    try {
      const creditData = await apiService.getCredits();
      const balance = creditData?.credits?.balance ?? 0;
      if (balance < 3) {
        alert(`Insufficient credits. You need 3 credits to refine an image but you only have ${balance}. Please wait for your next credit cycle or upgrade your plan.`);
        return;
      }
    } catch (e) {
      console.error('Credit check failed:', e);
    }
    setRefiningImage(true);
    try {
      const result = await apiService.refineImage(postImagePrompt, imageRefinementPrompt, undefined, postImageUrl);
      if (result.success && result.imageUrl) {
        setPostImageUrl(result.imageUrl);
        setImageRefinementPrompt('');
      }
    } catch (error) {
      console.error('Failed to refine image:', error);
    } finally {
      setRefiningImage(false);
    }
  };
  
  // Map strategic advisor categories to valid campaign objectives
  const mapCategoryToObjective = (category?: string): string => {
    const mapping: Record<string, string> = {
      'trending': 'awareness',
      'event': 'awareness',
      'competitor': 'engagement',
      'insight': 'engagement',
      'audience': 'engagement',
      'moment': 'awareness',
      'story': 'engagement',
      'promo': 'sales'
    };
    if (!category) return 'engagement';
    // Handle pipe-separated categories like "event|audience" — take the first one
    const primary = category.split('|')[0].trim().toLowerCase();
    return mapping[primary] || 'engagement';
  };

  // Handle scheduling/posting the content
  const handleSchedulePost = async () => {
    setScheduling(true);
    try {
      // Build the scheduled datetime in ISO format for Ayrshare
      let scheduledFor: string | undefined;
      if (scheduleDate) {
        const time = scheduleTime || '10:00';
        const [hours, minutes] = time.split(':');
        const dt = new Date(scheduleDate);
        dt.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        scheduledFor = dt.toISOString();
      }

      const result = await apiService.createCampaign({
        name: selectedSuggestion?.title || 'Strategic Post',
        objective: mapCategoryToObjective(selectedSuggestion?.category),
        platforms: selectedPlatform,
        status: scheduleDate ? 'scheduled' : 'draft',
        creative: {
          type: 'image',
          textContent: postCaption,
          imageUrls: postImageUrl ? [postImageUrl] : [],
          captions: postCaption,
          hashtags: postHashtags
        },
        scheduling: scheduleDate ? {
          startDate: scheduleDate,
          postTime: scheduleTime || '10:00'
        } : undefined
      });

      // Actually publish to social media via Ayrshare
      if (result.campaign?._id) {
        try {
          await apiService.publishCampaign(
            result.campaign._id,
            selectedPlatform,
            scheduledFor
          );
        } catch (publishErr) {
          console.error('Ayrshare publish failed:', publishErr);
          // Campaign is saved — warn user about publish failure
          alert('Post saved but failed to publish to social media. You can retry from the Campaigns page.');
          setShowPostCreator(false);
          setSelectedSuggestion(null);
          setGeneratedPost(null);
          return;
        }
      }
      
      alert(scheduleDate ? 'Post scheduled successfully!' : 'Post saved as draft!');
      setShowPostCreator(false);
      setSelectedSuggestion(null);
      setGeneratedPost(null);
    } catch (error) {
      console.error('Failed to schedule post:', error);
      alert('Failed to save post. Please try again.');
    } finally {
      setScheduling(false);
    }
  };
  
  // Fetch Social Followers for bar chart
  const fetchFollowerData = async (force = false) => {
    if (hasFetchedFollowers.current && !force) return;
    setFollowerLoading(true);
    try {
      const result = await apiService.getSocialFollowers();
      if (result.success && result.platforms) {
        setFollowerData(result.platforms);
        hasFetchedFollowers.current = true;
      }
    } catch (error) {
      console.error('Failed to fetch follower data:', error);
    } finally {
      setFollowerLoading(false);
    }
  };
  
  useEffect(() => {
    if (!hasFetchedDashboard.current) fetchData();
    if (!hasFetchedStrategic.current) fetchStrategicSuggestions();
    if (!hasFetchedFollowers.current) fetchFollowerData();
  }, []);

  const handlePrevCompetitor = () => {
    if (data?.competitorActivity) {
      setCompetitorIndex((prev) => (prev === 0 ? data.competitorActivity.length - 1 : prev - 1));
    }
  };

  const handleNextCompetitor = () => {
    if (data?.competitorActivity) {
      setCompetitorIndex((prev) => (prev === data.competitorActivity.length - 1 ? 0 : prev + 1));
    }
  };

  // Handle creating a rival post — show logo selector first
  const handleCreateRivalPost = async (competitor: any) => {
    // Upfront credit check
    try {
      const creditData = await apiService.getCredits();
      const balance = creditData?.credits?.balance ?? 0;
      if (balance < 7) {
        alert(`Insufficient credits. You need 7 credits to create a rival post but you only have ${balance}. Please wait for your next credit cycle or upgrade your plan.`);
        return;
      }
    } catch (e) {
      console.error('Credit check failed:', e);
    }
    // Show logo selector before generating
    setPendingRivalCompetitor(competitor);
    setShowLogoSelector(true);
  };

  // Actually generate rival post after logo + aspect ratio selection
  const executeRivalPostGeneration = async (competitor: any, logoUrl: string | null, aspectRatio: string) => {
    setSelectedLogoUrl(logoUrl);
    setRivalPostLoading(true);
    setShowRivalPostModal(true);
    setRivalPost(null);
    // Reset image editing states
    setImageMode('ai');
    setCustomImagePrompt('');
    setUploadedImageUrl(null);
    const rivalPlatform = competitor.platform || 'instagram';
    const connectedNames = followerData.map(f => f.platform.toLowerCase());
    const isRivalPlatformConnected = connectedNames.includes(rivalPlatform) || (rivalPlatform === 'twitter' && connectedNames.includes('x')) || (rivalPlatform === 'x' && connectedNames.includes('twitter'));
    setRivalSelectedPlatform(isRivalPlatformConnected ? [rivalPlatform] : connectedNames.length > 0 ? [connectedNames[0]] : []);
    setRivalScheduleDate('');
    setRivalScheduleTime('');

    try {
      const result = await apiService.generateRivalPost({
        competitorName: competitor.competitorName,
        competitorContent: competitor.content,
        platform: competitor.platform,
        sentiment: competitor.sentiment,
        likes: competitor.likes,
        comments: competitor.comments,
        brandLogo: logoUrl,
        aspectRatio
      });
      
      setRivalPost({
        caption: result.caption,
        hashtags: result.hashtags,
        imageUrl: result.imageUrl,
        platform: competitor.platform,
        competitorName: competitor.competitorName,
        originalContent: competitor.content
      });
      setRivalImagePrompt(result.imagePrompt || '');
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
        platforms: rivalSelectedPlatform,
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

  // Rival Post — Post Now
  const handleRivalPostNow = async () => {
    if (!rivalPost) return;
    setRivalPostingNow(true);
    try {
      const imageUrl = imageMode === 'upload' && uploadedImageUrl ? uploadedImageUrl : rivalPost.imageUrl;
      const result = await apiService.createCampaign({
        name: `Rival to ${rivalPost.competitorName}`,
        objective: 'engagement',
        platforms: rivalSelectedPlatform,
        status: 'posted',
        creative: {
          type: 'image',
          textContent: editedCaption,
          imageUrls: imageUrl ? [imageUrl] : [],
          captions: editedCaption,
          hashtags: editedHashtags.split(/[\s#]+/).filter(t => t.trim())
        }
      });
      if (result.campaign?._id) {
        try {
          await apiService.publishCampaign(result.campaign._id, rivalSelectedPlatform);
        } catch (publishErr) {
          console.error('Ayrshare publish failed:', publishErr);
          alert('Post saved but failed to publish to social media. You can retry from the Campaigns page.');
          setShowRivalPostModal(false);
          setRivalPost(null);
          return;
        }
      }
      alert('Post published successfully!');
      setShowRivalPostModal(false);
      setRivalPost(null);
    } catch (error) {
      console.error('Failed to post:', error);
      alert('Failed to post. Please try again.');
    } finally {
      setRivalPostingNow(false);
    }
  };

  // Rival Post — Schedule
  const handleRivalSchedule = async () => {
    if (!rivalPost || !rivalScheduleDate) return;
    setRivalScheduling(true);
    try {
      const time = rivalScheduleTime || '10:00';
      const [hours, minutes] = time.split(':');
      const dt = new Date(rivalScheduleDate);
      dt.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      const scheduledFor = dt.toISOString();
      const imageUrl = imageMode === 'upload' && uploadedImageUrl ? uploadedImageUrl : rivalPost.imageUrl;

      const result = await apiService.createCampaign({
        name: `Rival to ${rivalPost.competitorName}`,
        objective: 'engagement',
        platforms: rivalSelectedPlatform,
        status: 'scheduled',
        creative: {
          type: 'image',
          textContent: editedCaption,
          imageUrls: imageUrl ? [imageUrl] : [],
          captions: editedCaption,
          hashtags: editedHashtags.split(/[\s#]+/).filter(t => t.trim())
        },
        scheduling: {
          startDate: rivalScheduleDate,
          postTime: time
        }
      });
      if (result.campaign?._id) {
        try {
          await apiService.publishCampaign(result.campaign._id, rivalSelectedPlatform, scheduledFor);
        } catch (publishErr) {
          console.error('Ayrshare schedule failed:', publishErr);
          alert('Post saved but failed to schedule on social media. You can retry from the Campaigns page.');
          setShowRivalPostModal(false);
          setRivalPost(null);
          return;
        }
      }
      alert('Post scheduled successfully!');
      setShowRivalPostModal(false);
      setRivalPost(null);
    } catch (error) {
      console.error('Failed to schedule:', error);
      alert('Failed to schedule. Please try again.');
    } finally {
      setRivalScheduling(false);
    }
  };

  // Strategic Advisor — Post Now
  const handleStrategicPostNow = async () => {
    setScheduling(true);
    try {
      const result = await apiService.createCampaign({
        name: selectedSuggestion?.title || 'Strategic Post',
        objective: mapCategoryToObjective(selectedSuggestion?.category),
        platforms: selectedPlatform,
        status: 'posted',
        creative: {
          type: 'image',
          textContent: postCaption,
          imageUrls: postImageUrl ? [postImageUrl] : [],
          captions: postCaption,
          hashtags: postHashtags
        }
      });
      if (result.campaign?._id) {
        try {
          await apiService.publishCampaign(result.campaign._id, selectedPlatform);
        } catch (publishErr) {
          console.error('Ayrshare publish failed:', publishErr);
          alert('Post saved but failed to publish to social media. You can retry from the Campaigns page.');
          setShowPostCreator(false);
          setSelectedSuggestion(null);
          setGeneratedPost(null);
          return;
        }
      }
      alert('Post published successfully!');
      setShowPostCreator(false);
      setSelectedSuggestion(null);
      setGeneratedPost(null);
    } catch (error) {
      console.error('Failed to post:', error);
      alert('Failed to post. Please try again.');
    } finally {
      setScheduling(false);
    }
  };

  // Download image
  const handleDownloadImage = async () => {
    const imageUrl = imageMode === 'upload' && uploadedImageUrl ? uploadedImageUrl : rivalPost?.imageUrl;
    if (!imageUrl) return;
    
    try {
      // For data URLs (uploaded images), create a direct download
      if (imageUrl.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = `rival-post-${rivalPost?.platform || 'post'}-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
      
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rival-post-${rivalPost?.platform || 'post'}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      // Fallback for CORS issues
      window.open(imageUrl, '_blank');
    }
  };

  // Regenerate image with custom prompt
  const handleRegenerateImage = async () => {
    if (!customImagePrompt.trim() || !rivalPost) return;
    
    setRegeneratingImage(true);
    try {
      const result = await apiService.regenerateImage({
        prompt: customImagePrompt,
        industry: data?.businessContext?.industry || 'general',
        platform: rivalPost.platform,
        originalImagePrompt: rivalImagePrompt || undefined,
        caption: editedCaption || rivalPost.caption || undefined,
        currentImageUrl: getCurrentImageUrl()
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

  // Handle file upload
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size should be less than 5MB');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setUploadedImageUrl(dataUrl);
      setImageMode('upload');
    };
    reader.readAsDataURL(file);
  };

  // Get current display image
  const getCurrentImageUrl = () => {
    if (imageMode === 'upload' && uploadedImageUrl) {
      return uploadedImageUrl;
    }
    return rivalPost?.imageUrl || '';
  };

  const getActionButton = (actionType: string, title: string) => {
    // Use hash navigation for HashRouter
    const navigate = (path: string) => {
      window.location.hash = path;
    };
    
    const actionMap: Record<string, { label: string; icon: React.ReactNode; onClick: () => void }> = {
      'create_campaign': { 
        label: 'Create Campaign', 
        icon: <Plus className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create') 
      },
      'create_post': { 
        label: 'Create Post', 
        icon: <Edit3 className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create&type=post') 
      },
      'create_story': { 
        label: 'Create Story', 
        icon: <Share2 className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create&type=story') 
      },
      'analyze_competitors': { 
        label: 'View Competitors', 
        icon: <Eye className="w-3 h-3" />, 
        onClick: () => navigate('/competitors') 
      },
      'find_influencers': { 
        label: 'Find Influencers', 
        icon: <Users className="w-3 h-3" />, 
        onClick: () => navigate('/influencers') 
      },
      'engage_audience': { 
        label: 'Engage', 
        icon: <MessageSquare className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns') 
      },
      'connect_social': { 
        label: 'Connect', 
        icon: <ExternalLink className="w-3 h-3" />, 
        onClick: () => navigate('/connect-socials') 
      },
      'view_analytics': { 
        label: 'View Analytics', 
        icon: <BarChart3 className="w-3 h-3" />, 
        onClick: () => navigate('/dashboard') 
      },
      'schedule_content': { 
        label: 'Schedule', 
        icon: <Calendar className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create&schedule=true') 
      },
      // Legacy type mappings for backwards compatibility
      'campaign': { 
        label: 'Create Campaign', 
        icon: <Plus className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create') 
      },
      'social': { 
        label: 'Create Post', 
        icon: <Edit3 className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create') 
      },
      'content': { 
        label: 'Create Content', 
        icon: <Edit3 className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create') 
      },
      'post': { 
        label: 'Create Post', 
        icon: <Edit3 className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create') 
      },
      'story': { 
        label: 'Post Story', 
        icon: <Share2 className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns?action=create&type=story') 
      },
      'review': { 
        label: 'View', 
        icon: <Eye className="w-3 h-3" />, 
        onClick: () => navigate('/competitors') 
      },
      'engage': { 
        label: 'Engage', 
        icon: <MessageSquare className="w-3 h-3" />, 
        onClick: () => navigate('/campaigns') 
      },
      'generate_content': { 
        label: 'Generate Content', 
        icon: <Edit3 className="w-3 h-3" />, 
        onClick: () => navigate('/content-studio') 
      },
      'view_trends': { 
        label: 'View Trends', 
        icon: <BarChart3 className="w-3 h-3" />, 
        onClick: () => navigate('/trends') 
      },
      'discover_trends': { 
        label: 'Discover Trends', 
        icon: <BarChart3 className="w-3 h-3" />, 
        onClick: () => navigate('/trends') 
      },
    };
    
    // First try exact match with actionType
    if (actionMap[actionType]) {
      return actionMap[actionType];
    }
    
    // Fallback: Determine action type from title keywords
    const titleLower = title.toLowerCase();
    if (titleLower.includes('campaign') || titleLower.includes('create campaign') || titleLower.includes('launch')) {
      return actionMap['create_campaign'];
    }
    if (titleLower.includes('story') || titleLower.includes('stories')) {
      return actionMap['create_story'];
    }
    if (titleLower.includes('competitor') || titleLower.includes('analyze') || titleLower.includes('rival')) {
      return actionMap['analyze_competitors'];
    }
    if (titleLower.includes('influencer') || titleLower.includes('partner')) {
      return actionMap['find_influencers'];
    }
    if (titleLower.includes('engage') || titleLower.includes('comment') || titleLower.includes('respond') || titleLower.includes('reply')) {
      return actionMap['engage_audience'];
    }
    if (titleLower.includes('connect') || titleLower.includes('link') || titleLower.includes('social account')) {
      return actionMap['connect_social'];
    }
    if (titleLower.includes('analytics') || titleLower.includes('performance') || titleLower.includes('metrics')) {
      return actionMap['view_analytics'];
    }
    if (titleLower.includes('schedule') || titleLower.includes('plan')) {
      return actionMap['schedule_content'];
    }
    if (titleLower.includes('trend') || titleLower.includes('discover') || titleLower.includes('explore')) {
      return actionMap['discover_trends'];
    }
    if (titleLower.includes('generate') || titleLower.includes('ai content') || titleLower.includes('studio')) {
      return actionMap['generate_content'];
    }
    if (titleLower.includes('post') || titleLower.includes('content') || titleLower.includes('share')) {
      return actionMap['create_post'];
    }
    
    // Default to create campaign
    return actionMap['create_campaign'];
  };

  // Skeleton Loading Component
  const DashboardSkeleton = () => (
    <div className="max-w-7xl mx-auto space-y-8 p-1 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex justify-between items-center">
        <div>
          <div className={`h-7 w-64 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
          <div className={`h-4 w-80 mt-2 rounded ${isDarkMode ? 'bg-slate-700/60' : 'bg-slate-200/80'}`}></div>
        </div>
        <div className={`h-10 w-28 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
      </div>

      {/* Social Followers Skeleton */}
      <div className={`${isDarkMode ? 'bg-[#0B0F1A]' : 'bg-white'} rounded-2xl border ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'} p-6`}>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            <div className={`h-4 w-32 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
          </div>
          <div className={`h-9 w-32 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
        </div>
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
              <div className="flex-1">
                <div className={`h-3 w-24 rounded mb-2 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                <div className={`h-8 rounded-xl ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`} style={{ width: `${80 - i * 15}%` }}></div>
              </div>
            </div>
          ))}
        </div>
        <div className={`mt-8 pt-5 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'} grid grid-cols-2 gap-4`}>
          <div className={`text-center p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
            <div className={`h-8 w-28 mx-auto rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            <div className={`h-3 w-24 mx-auto mt-2 rounded ${isDarkMode ? 'bg-slate-700/60' : 'bg-slate-200/80'}`}></div>
          </div>
          <div className={`text-center p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
            <div className={`h-8 w-8 mx-auto rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            <div className={`h-3 w-32 mx-auto mt-2 rounded ${isDarkMode ? 'bg-slate-700/60' : 'bg-slate-200/80'}`}></div>
          </div>
        </div>
      </div>

      {/* Competitor Radar & Strategic Advisor Skeletons */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Competitor Radar Skeleton */}
        <div className={`${isDarkMode ? 'bg-[#0B0F1A]' : 'bg-white'} rounded-2xl border ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'} p-6 min-h-[420px]`}>
          <div className="flex justify-between items-center mb-4">
            <div className={`h-4 w-32 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            <div className="flex gap-2">
              <div className={`h-7 w-20 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
              <div className={`h-7 w-7 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            </div>
          </div>
          <div className={`flex items-center gap-2 mb-4 pb-3 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className={`h-8 w-24 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            ))}
          </div>
          <div className="space-y-4">
            <div className={`h-5 w-40 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            <div className={`h-32 w-full rounded-xl ${isDarkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}></div>
            <div className="flex gap-4">
              <div className={`h-10 w-16 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
              <div className={`h-10 w-16 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
              <div className={`h-10 w-16 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            </div>
          </div>
        </div>

        {/* Strategic Advisor Skeleton */}
        <div className={`${isDarkMode ? 'bg-[#0B0F1A]' : 'bg-white'} rounded-2xl border ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'} p-6 min-h-[420px]`}>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <div className={`h-4 w-32 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            </div>
            <div className={`h-8 w-24 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
          </div>
          <div className="space-y-3 mt-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                  <div className="flex-1">
                    <div className={`h-4 w-3/4 rounded mb-2 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                    <div className={`h-3 w-1/2 rounded ${isDarkMode ? 'bg-slate-700/60' : 'bg-slate-200/80'}`}></div>
                  </div>
                  <div className={`h-8 w-20 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Campaign Calendar Skeleton */}
      <div className={`${isDarkMode ? 'bg-[#0B0F1A]' : 'bg-white'} rounded-2xl border ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'} p-6`}>
        <div className="flex justify-between items-center mb-6">
          <div className={`h-5 w-36 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
          <div className="flex gap-2">
            <div className={`h-8 w-8 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            <div className={`h-8 w-28 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            <div className={`h-8 w-8 rounded-lg ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className={`h-4 w-8 mx-auto rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
          ))}
          {[...Array(35)].map((_, i) => (
            <div key={i} className={`h-20 rounded-lg ${isDarkMode ? 'bg-slate-800/30' : 'bg-slate-50'} ${i % 7 === 0 || i % 7 === 6 ? 'opacity-50' : ''}`}>
              <div className={`h-4 w-4 m-2 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (loading) {
    return <DashboardSkeleton />;
  }

  const currentCompetitor = data?.competitorActivity?.[competitorIndex];
  const prevCompetitor = data?.competitorActivity?.[(competitorIndex === 0 ? (data.competitorActivity.length - 1) : competitorIndex - 1)];
  const nextCompetitor = data?.competitorActivity?.[(competitorIndex === (data?.competitorActivity?.length || 1) - 1 ? 0 : competitorIndex + 1)];

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-1">
      {/* Header - Personalized */}
      <div className="flex justify-between items-center">
        <div>
            <h1 className={`text-2xl font-semibold tracking-tight ${theme.text}`}>
              {data?.businessContext?.name ? `${data.businessContext.name} Dashboard` : 'Dashboard'}
            </h1>
            <p className={`text-sm mt-0.5 ${theme.textSecondary}`}>
              {data?.businessContext?.industry
                ? `Marketing performance for your ${data.businessContext.industry} business.`
                : 'Overview of your marketing performance.'
              }
            </p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
            isDarkMode
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/50'
              : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200'
          } ${refreshing ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Social Followers Bar Chart */}
      <div className={`${theme.bgCard} rounded-2xl border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-[#ededed] hover:border-slate-200'} p-6 transition-all duration-200`}>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <Users className={`w-5 h-5 ${isDarkMode ? 'text-[#ffcc29]' : 'text-[#ffcc29]'}`} />
            <span className={`font-semibold text-sm uppercase tracking-wider ${theme.text}`}>Social Followers</span>
          </div>
          <button 
            onClick={() => { window.location.hash = '/connect-socials'; }}
            className="px-4 py-2 bg-[#ffcc29] hover:bg-[#e6b825] text-black text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Connect Account
          </button>
        </div>
        
        {followerLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className={`w-8 h-8 animate-spin ${theme.textMuted}`} />
          </div>
        ) : followerData.length === 0 ? (
          <div className="text-center py-12">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'} flex items-center justify-center`}>
              <Users className={`w-8 h-8 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
            </div>
            <h3 className={`text-lg font-semibold ${theme.text} mb-2`}>No Connected Accounts</h3>
            <p className={`text-sm ${theme.textMuted} max-w-md mx-auto mb-4`}>
              Connect your social media accounts to see your follower statistics.
            </p>
            <button 
              onClick={() => { window.location.hash = '/connect-socials'; }}
              className="px-6 py-2.5 bg-[#ffcc29] hover:bg-[#e6b825] text-black text-sm font-semibold rounded-lg transition-colors"
            >
              Connect Your Accounts
            </button>
          </div>
        ) : (
          <div className="relative">
            {/* Professional Horizontal Bar Chart */}
            <div className="space-y-4">
              {(() => {
                const maxFollowers = Math.max(...followerData.map(p => p.followers), 100);
                const totalFollowers = followerData.reduce((sum, p) => sum + p.followers, 0);
                
                return followerData.map((platform, idx) => {
                  const percentage = maxFollowers > 0 ? (platform.followers / maxFollowers) * 100 : 15;
                  const displayPercentage = Math.max(percentage, 15); // Minimum 15% width for visibility
                  const isHovered = hoveredBar === platform.platform;
                  
                  return (
                    <div 
                      key={platform.platform}
                      className={`group cursor-pointer transition-all duration-200 ${isHovered ? 'scale-[1.02]' : ''}`}
                      onMouseEnter={() => setHoveredBar(platform.platform)}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      {/* Platform Row */}
                      <div className="flex items-center gap-4">
                        {/* Platform Icon */}
                        <div 
                          className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0 transition-transform ${isHovered ? 'scale-110' : ''}`}
                          style={{ 
                            background: platform.bgColor.includes('linear') 
                              ? platform.bgColor 
                              : platform.bgColor
                          }}
                        >
                          <img 
                            src={platform.logo} 
                            alt={platform.name}
                            className="w-7 h-7 object-contain"
                            style={{ 
                              filter: ['instagram', 'twitter', 'tiktok'].includes(platform.platform) 
                                ? 'brightness(0) invert(1)' 
                                : 'none' 
                            }}
                          />
                        </div>
                        
                        {/* Bar Container */}
                        <div className="flex-1">
                          {/* Platform Name & Follower Count */}
                          <div className="flex justify-between items-center mb-2">
                            <span className={`text-sm font-semibold ${theme.text}`}>{platform.name}</span>
                            <span className={`text-sm font-bold ${isHovered ? 'text-[#ffcc29]' : theme.text}`}>
                              {platform.followers > 0 
                                ? platform.followers >= 1000 
                                  ? `${(platform.followers / 1000).toFixed(1)}K`
                                  : platform.followers.toLocaleString()
                                : 'Connected'}
                            </span>
                          </div>
                          
                          {/* Progress Bar */}
                          <div className={`h-8 rounded-xl overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                            <div 
                              className="h-full rounded-xl relative overflow-hidden transition-all duration-500"
                              style={{ 
                                width: `${displayPercentage}%`,
                                background: platform.bgColor.includes('linear') 
                                  ? platform.bgColor 
                                  : `linear-gradient(90deg, ${platform.color}dd 0%, ${platform.color} 100%)`
                              }}
                            >
                              {/* Shine effect */}
                              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"></div>
                              
                              {/* Animated shine on hover */}
                              {isHovered && (
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse"></div>
                              )}
                              
                              {/* Follower text inside bar */}
                              {platform.followers > 0 && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white text-xs font-bold drop-shadow-lg">
                                  {platform.followers.toLocaleString()} followers
                                </span>
                              )}
                              {platform.followers === 0 && (
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/80 text-xs font-medium">
                                  ✓ Connected
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            
            {/* Stats Summary Row */}
            <div className={`mt-8 pt-5 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'} grid grid-cols-2 gap-4`}>
              <div className={`text-center p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                <p className={`text-3xl font-bold ${theme.text}`}>
                  {followerData.reduce((sum, p) => sum + p.followers, 0).toLocaleString()}
                </p>
                <p className={`text-xs font-medium ${theme.textMuted} mt-1`}>Total Followers</p>
              </div>
              <div className={`text-center p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                <p className={`text-3xl font-bold ${theme.text}`}>{followerData.length}</p>
                <p className={`text-xs font-medium ${theme.textMuted} mt-1`}>Connected Platforms</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Competitor Radar - Enhanced with Stats Bar and Better Layout */}
        <div className={`${theme.bgCard} rounded-2xl border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-[#ededed] hover:border-slate-200'} p-6 transition-all duration-200 min-h-[420px] flex flex-col`}>
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <h2 className={`text-sm font-semibold ${theme.text}`}>Competitor Radar</h2>
                    <SectionButtons 
                      sectionType="competitorRadar" 
                      sectionData={{ competitors: data?.competitorActivity, current: currentCompetitor }} 
                    />
                </div>
                <div className="flex items-center gap-2">
                <button 
                  onClick={async () => {
                    try {
                      // Use the new real competitor posts API
                      const result = await apiService.refreshRealCompetitorPosts();
                      if (result.success && result.posts?.length > 0) {
                        alert(`✅ Fetched ${result.posts.length} REAL posts from social media!`);
                        // Reload dashboard data to show real posts
                        const refreshed = await apiService.getDashboardOverview();
                        setData(refreshed);
                      } else {
                        alert(`⚠️ ${result.message || 'Could not fetch real posts. Check competitor social handles.'}`);
                      }
                    } catch (e: any) {
                      console.error('Real-time scrape error:', e);
                      alert('❌ Real-time scraping not available. Please check your Apify API key.');
                    }
                  }}
                  className={`text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${isDarkMode ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                  title="Fetch REAL posts from competitor social media accounts"
                >
                  🔄 Live
                </button>
                <button 
                  onClick={() => window.location.hash = '#/competitors'}
                  className="text-[#ffcc29] text-xs font-semibold hover:underline px-3 py-1.5 bg-[#ffcc29]/10 rounded-lg hover:bg-[#ffcc29]/20 transition-colors"
                >
                  View All
                </button>
                </div>
            </div>
            
            {(!data?.competitorActivity || data.competitorActivity.length === 0) ? (
              <div className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-[#f5f5f5] border-[#ededed]'} border rounded-xl p-8 text-center`}>
                <div className={`w-12 h-12 ${isDarkMode ? 'bg-[#070A12]' : 'bg-[#ededed]'} rounded-full flex items-center justify-center mx-auto mb-3`}>
                  <Activity className={`w-6 h-6 ${theme.textMuted}`} />
                </div>
                <p className={`text-sm font-medium mb-1 ${theme.textSecondary}`}>No competitor data yet</p>
                <p className={`text-xs mb-4 ${theme.textMuted}`}>Add competitors to track their activity</p>
                <button 
                  onClick={() => window.location.hash = '#/competitors'}
                  className="px-4 py-2 bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] text-xs font-semibold rounded-lg transition-colors"
                >
                  + Add Competitors
                </button>
              </div>
            ) : (
            <>
            <div className="relative flex items-stretch gap-4 flex-1">
                {/* Left Navigation with Preview */}
                <div className="flex flex-col items-center justify-center shrink-0 w-20">
                  <button 
                    onClick={handlePrevCompetitor}
                    className={`p-2.5 ${isDarkMode ? 'bg-[#161b22] border-[#ffcc29]/30 hover:border-[#ffcc29]/60' : 'bg-white border-slate-200 hover:border-[#ffcc29]'} border rounded-full shadow-sm ${theme.textSecondary} hover:text-[#ffcc29] transition-all mb-2`}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  {prevCompetitor && (
                    <div 
                      onClick={handlePrevCompetitor}
                      className={`text-center cursor-pointer hover:opacity-80 transition-opacity px-1`}
                    >
                      <p className={`text-[10px] font-medium ${theme.textSecondary} truncate max-w-[80px]`}>{prevCompetitor.competitorName}</p>
                      <p className={`text-[9px] ${theme.textMuted} line-clamp-2 leading-tight mt-0.5`}>
                        "{prevCompetitor.content?.substring(0, 40)}..."
                      </p>
                    </div>
                  )}
                </div>
                
                {/* Main Competitor Card */}
                <div className="flex-1 min-w-0 flex">
                    {currentCompetitor && (
                        <div 
                          className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-[#f5f5f5] border-[#ededed]'} border rounded-xl p-5 relative min-h-[280px] flex flex-col w-full ${currentCompetitor.postUrl ? 'cursor-pointer hover:border-[#ffcc29]/30 hover:shadow-md transition-all' : ''}`}
                          onClick={() => currentCompetitor.postUrl && window.open(currentCompetitor.postUrl, '_blank')}
                        >
                            {currentCompetitor.postUrl && (
                              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                                <span className="text-[9px] text-[#ffcc29] font-medium">View Post</span>
                                <ExternalLink className="w-3.5 h-3.5 text-[#ffcc29]" />
                              </div>
                            )}
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`w-11 h-11 rounded-full ${isDarkMode ? 'bg-[#070A12]' : 'bg-white'} shadow-sm flex items-center justify-center text-sm font-bold ${theme.text} border ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'}`}>
                                    {currentCompetitor.competitorLogo || currentCompetitor.competitorName?.charAt(0) || 'C'}
                                </div>
                                <div>
                                    <p className={`text-sm font-semibold ${theme.text}`}>{currentCompetitor.competitorName}</p>
                                    <p className={`text-xs ${theme.textMuted} flex items-center gap-1`}>
                                        <span className={`w-2 h-2 rounded-full ${
                                          currentCompetitor.platform === 'instagram' ? 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600' :
                                          currentCompetitor.platform === 'twitter' ? 'bg-[#1DA1F2]' :
                                          currentCompetitor.platform === 'linkedin' ? 'bg-[#0A66C2]' :
                                          currentCompetitor.platform === 'facebook' ? 'bg-[#1877F2]' :
                                          currentCompetitor.platform === 'youtube' ? 'bg-[#FF0000]' :
                                          'bg-slate-400'
                                        }`}></span>
                                        {currentCompetitor.platform} • {currentCompetitor.postedAt}
                                    </p>
                                </div>
                            </div>
                            <p className={`text-sm ${theme.textSecondary} mb-4 leading-relaxed ${isDarkMode ? 'bg-[#070A12]' : 'bg-white'} p-4 rounded-lg border ${isDarkMode ? 'border-[#ffcc29]/10' : 'border-[#ededed]'} italic min-h-[120px] flex-1`}>
                                "{currentCompetitor.content}"
                            </p>
                            <div className="flex justify-between items-center mt-auto">
                                <div className={`flex gap-4 text-xs font-medium ${theme.textSecondary}`}>
                                    <span>❤️ {(currentCompetitor.likes || 0).toLocaleString()}</span>
                                    <span>💬 {currentCompetitor.comments || 0}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleCreateRivalPost(currentCompetitor); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black text-xs font-semibold rounded-full hover:shadow-lg hover:scale-105 transition-all"
                                  >
                                    <Swords className="w-3.5 h-3.5" />
                                    Create Rival Post
                                    <span className="flex items-center gap-0.5 text-[10px] bg-black/10 px-1 py-0.5 rounded-full"><Zap className="w-2.5 h-2.5" />7</span>
                                  </button>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                                      currentCompetitor.sentiment === 'positive' ? 'bg-emerald-100 text-emerald-700' : 
                                      currentCompetitor.sentiment === 'negative' ? 'bg-red-100 text-red-700' :
                                      'bg-slate-200 text-slate-600'
                                  }`}>
                                      {currentCompetitor.sentiment}
                                  </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Right Navigation with Preview */}
                <div className="flex flex-col items-center justify-center shrink-0 w-20">
                  <button 
                    onClick={handleNextCompetitor}
                    className={`p-2.5 ${isDarkMode ? 'bg-[#161b22] border-[#ffcc29]/30 hover:border-[#ffcc29]/60' : 'bg-white border-slate-200 hover:border-[#ffcc29]'} border rounded-full shadow-sm ${theme.textSecondary} hover:text-[#ffcc29] transition-all mb-2`}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  {nextCompetitor && (
                    <div 
                      onClick={handleNextCompetitor}
                      className={`text-center cursor-pointer hover:opacity-80 transition-opacity px-1`}
                    >
                      <p className={`text-[10px] font-medium ${theme.textSecondary} truncate max-w-[80px]`}>{nextCompetitor.competitorName}</p>
                      <p className={`text-[9px] ${theme.textMuted} line-clamp-2 leading-tight mt-0.5`}>
                        "{nextCompetitor.content?.substring(0, 40)}..."
                      </p>
                    </div>
                  )}
                </div>
            </div>
            
            {/* Pagination dots */}
            {data?.competitorActivity && data.competitorActivity.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-4">
                {data.competitorActivity.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCompetitorIndex(idx)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      idx === competitorIndex ? 'bg-[#ffcc29] w-4' : isDarkMode ? 'bg-[#ededed]/30 hover:bg-[#ededed]/50' : 'bg-slate-300 hover:bg-slate-400'
                    }`}
                  />
                ))}
              </div>
            )}
            </>
            )}
        </div>

        {/* Strategic Advisor - AI Content Suggestions */}
        <div className={`${theme.bgCard} rounded-2xl border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-[#ededed] hover:border-slate-200'} p-6 transition-all duration-200 min-h-[420px] flex flex-col`}>
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-[#ffcc29]" />
                    <h2 className={`text-sm font-semibold ${theme.text}`}>Strategic Advisor</h2>
                    <SectionButtons 
                      sectionType="strategicAdvisor" 
                      sectionData={{ suggestions: strategicSuggestions }} 
                    />
                </div>
                <span className="text-[10px] bg-gradient-to-r from-[#ffcc29]/20 to-orange-500/20 text-[#ffcc29] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wide">Content Strategist</span>
            </div>
            
            {/* Business context indicator */}
            {data?.businessContext?.name && (
              <div className={`mb-4 px-3 py-2 ${isDarkMode ? 'bg-[#ffcc29]/10 border-slate-700/50' : 'bg-[#ffcc29]/10 border-slate-700/50'} border rounded-lg`}>
                <p className="text-[10px] text-[#ffcc29] uppercase tracking-wider mb-0.5">Content Strategy for</p>
                <p className={`text-xs ${theme.text} font-medium`}>
                  {data.businessContext.name} • {data.businessContext.industry}
                </p>
              </div>
            )}
            
            {/* Trending Now & Upcoming Events */}
            {(trendingNow.length > 0 || upcomingEvents.length > 0) && (
              <div className={`mb-4 p-3 rounded-xl ${isDarkMode ? 'bg-[#0d1117]' : 'bg-[#f5f5f5]'}`}>
                {trendingNow.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Flame className="w-4 h-4 text-orange-500" />
                    <span className={`text-xs ${theme.textMuted}`}>Trending:</span>
                    {trendingNow.slice(0, 3).map((topic, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-500">{topic}</span>
                    ))}
                  </div>
                )}
                {upcomingEvents.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <CalendarIcon className="w-4 h-4 text-pink-500" />
                    <span className={`text-xs ${theme.textMuted}`}>Upcoming:</span>
                    {upcomingEvents.slice(0, 2).map((event, i) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-400">
                        {event.name} ({event.date})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2.5 flex-1 min-h-0 max-h-[600px] overflow-y-auto pr-1">
                {/* Loading state */}
                {strategicLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" />
                    <span className={`ml-2 text-sm ${theme.textMuted}`}>Analyzing trends & generating content ideas...</span>
                  </div>
                )}
                
                {/* Show suggestions if available */}
                {!strategicLoading && strategicSuggestions.length > 0 && 
                  strategicSuggestions
                    .filter(sug => !dismissedSuggestions.has(sug.id))
                    .map((suggestion, idx) => {
                      const categoryIcons: Record<string, React.ReactNode> = {
                        'trending': <Flame className="w-4 h-4 text-orange-500" />,
                        'event': <CalendarIcon className="w-4 h-4 text-pink-500" />,
                        'competitor': <Swords className="w-4 h-4 text-red-500" />,
                        'insight': <Lightbulb className="w-4 h-4 text-yellow-500" />,
                        'audience': <Users className="w-4 h-4 text-blue-500" />,
                        'moment': <Zap className="w-4 h-4 text-purple-500" />,
                        'story': <MessageSquare className="w-4 h-4 text-green-500" />,
                        'promo': <Target className="w-4 h-4 text-indigo-500" />
                      };
                      
                      const urgencyColors: Record<string, string> = {
                        'immediate': 'bg-red-500/20 text-red-400 border-red-500/30',
                        'this_week': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                        'this_month': 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                      };
                      
                      return (
                        <div key={suggestion.id} className={`p-3 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 hover:border-slate-600' : 'bg-[#f5f5f5] border-[#ededed] hover:border-slate-300'} border rounded-xl transition-all`}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                    {categoryIcons[suggestion.category] || <Sparkles className="w-4 h-4 text-[#ffcc29]" />}
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${isDarkMode ? 'bg-[#161b22]' : 'bg-white'} ${theme.textMuted}`}>
                                      {suggestion.category}
                                    </span>
                                    {suggestion.urgency && (
                                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${urgencyColors[suggestion.urgency] || urgencyColors['this_month']}`}>
                                        {suggestion.urgency.replace('_', ' ')}
                                      </span>
                                    )}
                                    {suggestion.viralPotential === 'high' && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-[#ffcc29]/20 to-orange-500/20 text-[#ffcc29]">
                                        🔥 Viral
                                      </span>
                                    )}
                                </div>
                                <button
                                  onClick={() => setDismissedSuggestions(prev => new Set([...prev, suggestion.id]))}
                                  className={`p-1 ${isDarkMode ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500'} rounded transition-colors`}
                                  title="Dismiss"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            
                            <h3 className={`text-sm font-semibold ${theme.text} mb-1`}>{suggestion.title}</h3>
                            <p className={`text-xs ${theme.textMuted} mb-3 line-clamp-2`}>{suggestion.description}</p>
                            
                            {/* Platforms & Content Type */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {(suggestion.platforms || ['instagram']).slice(0, 3).map((p: string) => (
                                  <span key={p} className={`text-[10px] px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-[#161b22]' : 'bg-white'} ${theme.textMuted} capitalize`}>
                                    {p}
                                  </span>
                                ))}
                                {suggestion.contentType && (
                                  <span className={`text-[10px] flex items-center gap-1 ${theme.textMuted}`}>
                                    <ImageIcon className="w-3 h-3" /> {suggestion.contentType}
                                  </span>
                                )}
                              </div>
                              
                              <button
                                onClick={() => {
                                  setPendingStrategicSuggestion(suggestion);
                                  setShowStrategicLogoModal(true);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] text-xs font-semibold rounded-lg transition-colors"
                              >
                                <PenTool className="w-3.5 h-3.5" />
                                Create Post
                                <span className="flex items-center gap-0.5 text-[10px] bg-black/10 px-1 py-0.5 rounded"><Zap className="w-2.5 h-2.5" />7</span>
                              </button>
                            </div>
                        </div>
                      );
                  })
                }
                
                {/* Show message when all suggestions are dismissed */}
                {!strategicLoading && strategicSuggestions.length > 0 && 
                  strategicSuggestions.filter(s => !dismissedSuggestions.has(s.id)).length === 0 && (
                  <div className="text-center py-6">
                    <p className={`text-sm mb-2 ${theme.textMuted}`}>All suggestions dismissed</p>
                    <button 
                      onClick={() => setDismissedSuggestions(new Set())}
                      className="text-[#ffcc29] text-xs hover:text-[#e6b825] underline"
                    >
                      Restore all
                    </button>
                  </div>
                )}
                
                {/* No suggestions available */}
                {!strategicLoading && strategicSuggestions.length === 0 && (
                  <div className="text-center py-8">
                    <div className={`w-12 h-12 ${isDarkMode ? 'bg-[#ffcc29]/20' : 'bg-[#ffcc29]/10'} rounded-full flex items-center justify-center mx-auto mb-3`}>
                      <Lightbulb className="w-6 h-6 text-[#ffcc29]" />
                    </div>
                    <p className={`text-sm font-medium mb-1 ${theme.textSecondary}`}>No content ideas yet</p>
                    <p className={`text-xs mb-4 ${theme.textMuted}`}>Generate content suggestions based on trends & events</p>
                  </div>
                )}
                
                <button
                  onClick={async () => {
                    setDismissedSuggestions(new Set());
                    await fetchStrategicSuggestions(true);
                  }}
                  disabled={strategicLoading}
                  className={`w-full mt-2 py-3 border border-dashed ${isDarkMode ? 'border-[#ffcc29]/30 hover:border-[#ffcc29]/50' : 'border-slate-300 hover:border-[#ffcc29]'} rounded-xl ${theme.textSecondary} text-sm hover:text-[#ffcc29] hover:bg-[#ffcc29]/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50`}
                >
                    {strategicLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" /> Generate Content Ideas</>
                    )}
                </button>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5">
         {/* Interactive Calendar */}
         <CalendarWidget campaigns={data?.recentCampaigns || []} dashboardData={data} onCampaignCreated={fetchData} followerData={followerData} />
      </div>

      {/* Post Creator Modal */}
      {/* Strategic Advisor Logo Selector Modal */}
      <LogoSelector
        isOpen={showStrategicLogoModal}
        onClose={() => { setShowStrategicLogoModal(false); setPendingStrategicSuggestion(null); }}
        onConfirm={(logoUrl) => {
          setShowStrategicLogoModal(false);
          setStrategicSelectedLogo(logoUrl);
          setStrategicAspectRatio('1:1');
          setShowStrategicAspectModal(true);
        }}
      />

      {/* Strategic Advisor Aspect Ratio Modal */}
      {showStrategicAspectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => { setShowStrategicAspectModal(false); setPendingStrategicSuggestion(null); }}>
          <div className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white'} border rounded-2xl shadow-2xl w-full max-w-md p-6`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#ffcc29]/20 flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-[#ffcc29]" />
                </div>
                <div>
                  <h3 className={`text-lg font-bold ${theme.text}`}>Select Aspect Ratio</h3>
                  <p className={`text-sm ${theme.textMuted}`}>Choose the image dimensions</p>
                </div>
              </div>
              <button onClick={() => { setShowStrategicAspectModal(false); setPendingStrategicSuggestion(null); }} className={`${theme.textMuted} hover:text-slate-600`}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { value: '1:1', label: '1:1', desc: 'Square' },
                { value: '4:5', label: '4:5', desc: 'Portrait' },
                { value: '9:16', label: '9:16', desc: 'Story/Reel' },
                { value: '16:9', label: '16:9', desc: 'Landscape' },
                { value: '3:4', label: '3:4', desc: 'Portrait' },
                { value: '4:3', label: '4:3', desc: 'Landscape' },
              ].map(ratio => (
                <button
                  key={ratio.value}
                  onClick={() => setStrategicAspectRatio(ratio.value)}
                  className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                    strategicAspectRatio === ratio.value
                      ? 'border-[#ffcc29] bg-[#ffcc29]/10'
                      : `${isDarkMode ? 'border-slate-700 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'}`
                  }`}
                >
                  <span className={`text-sm font-bold ${theme.text}`}>{ratio.label}</span>
                  <span className={`text-xs ${theme.textMuted}`}>{ratio.desc}</span>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowStrategicAspectModal(false); setPendingStrategicSuggestion(null); }}
                className={`flex-1 py-2.5 rounded-xl border ${isDarkMode ? 'border-slate-700 text-slate-400 hover:bg-[#161b22]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} font-medium`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowStrategicAspectModal(false);
                  if (pendingStrategicSuggestion) {
                    handleCreatePost(pendingStrategicSuggestion, strategicSelectedLogo, strategicAspectRatio);
                    setPendingStrategicSuggestion(null);
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#ffcc29] text-[#070A12] font-semibold hover:bg-[#e6b825]"
              >
                Generate Post
              </button>
            </div>
          </div>
        </div>
      )}

      {showPostCreator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => !generatingPost && !scheduling && setShowPostCreator(false)}>
          <div 
            className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'} border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-slate-700/50 bg-gradient-to-r from-[#0d1117] to-[#161b22]' : 'border-slate-100 bg-gradient-to-r from-white to-slate-50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#ffcc29] to-orange-500 flex items-center justify-center">
                    <PenTool className="w-5 h-5 text-black" />
                  </div>
                  <div>
                    <h3 className={`text-lg font-bold ${theme.text}`}>Create Post</h3>
                    <p className={`text-xs ${theme.textMuted}`}>
                      {selectedSuggestion?.title || 'Generated content'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (generatingPost) {
                      if (window.confirm('7 credits have been consumed for this generation. Are you sure you want to close?')) {
                        setShowPostCreator(false);
                      }
                    } else {
                      setShowPostCreator(false);
                    }
                  }}
                  className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-slate-100'} transition-colors`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
              {generatingPost ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-[#ffcc29] to-orange-500 flex items-center justify-center mb-4 animate-pulse">
                    <Sparkles className="w-8 h-8 text-black animate-spin" />
                  </div>
                  <p className={`text-lg font-semibold ${theme.text} mb-2`}>Creating Your Post</p>
                  <p className={`text-sm ${theme.textMuted}`}>Generating caption, hashtags, and image...</p>
                </div>
              ) : generatedPost ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Image Section */}
                  <div>
                    <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Image</label>
                    {postImageUrl ? (
                      <div className="relative rounded-xl overflow-hidden mb-3">
                        <img src={postImageUrl} alt="Post" className="w-full object-contain max-h-[500px]" />
                        {/* Download button */}
                        <a
                          href={postImageUrl}
                          download="strategic-post.png"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 rounded-lg text-white transition-colors"
                          title="Download image"
                          onClick={(e) => {
                            e.stopPropagation();
                            fetch(postImageUrl)
                              .then(res => res.blob())
                              .then(blob => {
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'strategic-post.png';
                                a.click();
                                URL.revokeObjectURL(url);
                              })
                              .catch(() => window.open(postImageUrl, '_blank'));
                            e.preventDefault();
                          }}
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    ) : (
                      <div className={`h-64 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-[#161b22]' : 'bg-slate-100'}`}>
                        <ImageIcon className={`w-12 h-12 ${theme.textMuted}`} />
                      </div>
                    )}
                    
                    {/* Image Refinement */}
                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#161b22]' : 'bg-slate-50'}`}>
                      <label className={`block text-xs mb-2 ${theme.textMuted}`}>Refine image</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={imageRefinementPrompt}
                          onChange={(e) => setImageRefinementPrompt(e.target.value)}
                          placeholder="e.g. make it more vibrant, add text overlay..."
                          className={`flex-1 px-3 py-2 text-sm rounded-lg border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200'}`}
                        />
                        <button
                          onClick={handleRefineImage}
                          disabled={refiningImage || !imageRefinementPrompt.trim()}
                          className="px-3 py-2 bg-[#ffcc29] hover:bg-[#e6b825] text-black text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1"
                        >
                          {refiningImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Refine
                        </button>
                      </div>
                    </div>
                    
                  </div>
                  
                  {/* Caption & Details */}
                  <div className="space-y-4">
                    {/* Platform Selection */}
                    <div>
                      <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Platform</label>
                      <div className="flex gap-2 flex-wrap">
                        {['instagram', 'facebook', 'twitter', 'linkedin'].map(p => {
                          const isConnected = followerData.some(f => f.platform.toLowerCase() === p || (p === 'twitter' && f.platform.toLowerCase() === 'x') || (p === 'x' && f.platform.toLowerCase() === 'twitter'));
                          const isSelected = selectedPlatform.includes(p);
                          return (
                            <button
                              key={p}
                              onClick={() => isConnected && setSelectedPlatform(prev =>
                                prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                              )}
                              disabled={!isConnected}
                              className={`px-3 py-1.5 text-xs rounded-lg capitalize flex items-center gap-1 ${
                                isSelected
                                  ? 'bg-[#ffcc29] text-black font-semibold'
                                  : isConnected
                                    ? isDarkMode ? 'bg-[#161b22] text-white hover:bg-[#1f2937]' : 'bg-slate-100 hover:bg-slate-200'
                                    : 'opacity-50 cursor-not-allowed bg-slate-200 text-slate-400'
                              }`}
                            >
                              {p}
                              {!isConnected && <span className="text-[10px]">(N/A)</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* Caption */}
                    <div>
                      <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Caption</label>
                      <textarea
                        value={postCaption}
                        onChange={(e) => setPostCaption(e.target.value)}
                        rows={6}
                        className={`w-full px-3 py-2 text-sm rounded-lg border resize-none ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200'}`}
                      />
                    </div>
                    
                    {/* Hashtags */}
                    <div>
                      <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Hashtags</label>
                      <div className="flex flex-wrap gap-1.5">
                        {postHashtags.map((tag, i) => (
                          <span key={i} className={`text-xs px-2 py-1 rounded-full ${isDarkMode ? 'bg-[#161b22] text-[#ffcc29]' : 'bg-[#ffcc29]/10 text-[#ffcc29]'}`}>
                            #{tag.replace('#', '')}
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    {/* Schedule */}
                    <div>
                      <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Schedule (optional)</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                          className={`px-3 py-2 text-sm rounded-lg border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200'}`}
                        />
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className={`px-3 py-2 text-sm rounded-lg border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200'}`}
                        />
                      </div>
                      {generatedPost.bestPostTimes && selectedPlatform.length > 0 && generatedPost.bestPostTimes[selectedPlatform[0]] && (
                        <p className={`text-xs mt-1 ${theme.textMuted}`}>
                          💡 Best time for {selectedPlatform[0]}: {generatedPost.bestPostTimes[selectedPlatform[0]]}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-16">
                  <p className={theme.textMuted}>Failed to generate post. Please try again.</p>
                </div>
              )}
            </div>

            {/* Footer */}
            {!generatingPost && generatedPost && (
              <div className={`px-6 py-4 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-slate-100'} flex justify-end gap-3`}>
                <button
                  onClick={() => setShowPostCreator(false)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${isDarkMode ? 'bg-[#161b22] text-white hover:bg-[#21262d]' : 'bg-slate-100 hover:bg-slate-200'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowPreview(true)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 ${isDarkMode ? 'bg-[#161b22] text-white hover:bg-[#21262d] border border-slate-700/50' : 'bg-white hover:bg-slate-50 border border-slate-200'}`}
                >
                  <Eye className="w-4 h-4" /> Preview
                </button>
                <button
                  onClick={() => { setScheduleDate(''); handleSchedulePost(); }}
                  disabled={scheduling}
                  className={`px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 ${isDarkMode ? 'bg-[#161b22] text-white hover:bg-[#21262d] border border-slate-700/50' : 'bg-white hover:bg-slate-50 border border-slate-200'} disabled:opacity-50`}
                >
                  {scheduling && !scheduleDate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save as Draft
                </button>
                {scheduleDate && (
                  <button
                    onClick={handleSchedulePost}
                    disabled={scheduling}
                    className="px-4 py-2 bg-[#ffcc29]/80 hover:bg-[#ffcc29] text-black text-sm font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50"
                  >
                    {scheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                    Schedule
                  </button>
                )}
                <button
                  onClick={handleStrategicPostNow}
                  disabled={scheduling}
                  className="px-6 py-2 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black text-sm font-semibold rounded-lg flex items-center gap-2 hover:shadow-lg hover:scale-105 transition-all disabled:opacity-50"
                >
                  {scheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Post Now
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Logo Selector Modal */}
      <LogoSelector
        isOpen={showLogoSelector}
        onClose={() => { setShowLogoSelector(false); setPendingRivalCompetitor(null); }}
        onConfirm={(logoUrl) => {
          setShowLogoSelector(false);
          setPendingLogoUrl(logoUrl);
          setSelectedAspectRatio('1:1');
          setShowAspectRatioModal(true);
        }}
      />

      {/* Aspect Ratio Selector Modal */}
      {showAspectRatioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => { setShowAspectRatioModal(false); setPendingRivalCompetitor(null); setPendingLogoUrl(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#ffcc29]/20 flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-[#ffcc29]" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#0a0f1a]">Select Aspect Ratio</h3>
                  <p className="text-sm text-slate-500">Choose the image dimensions</p>
                </div>
              </div>
              <button onClick={() => { setShowAspectRatioModal(false); setPendingRivalCompetitor(null); setPendingLogoUrl(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { value: '1:1', label: '1:1', desc: 'Square' },
                { value: '4:5', label: '4:5', desc: 'Portrait' },
                { value: '9:16', label: '9:16', desc: 'Story/Reel' },
                { value: '16:9', label: '16:9', desc: 'Landscape' },
                { value: '3:4', label: '3:4', desc: 'Portrait' },
                { value: '4:3', label: '4:3', desc: 'Landscape' },
              ].map(ratio => (
                <button
                  key={ratio.value}
                  onClick={() => setSelectedAspectRatio(ratio.value)}
                  className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                    selectedAspectRatio === ratio.value
                      ? 'border-[#ffcc29] bg-[#ffcc29]/10'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="text-sm font-bold text-[#0a0f1a]">{ratio.label}</span>
                  <span className="text-xs text-slate-500">{ratio.desc}</span>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowAspectRatioModal(false); setPendingRivalCompetitor(null); setPendingLogoUrl(null); }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowAspectRatioModal(false);
                  if (pendingRivalCompetitor) {
                    executeRivalPostGeneration(pendingRivalCompetitor, pendingLogoUrl, selectedAspectRatio);
                    setPendingRivalCompetitor(null);
                    setPendingLogoUrl(null);
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#ffcc29] text-[#070A12] font-semibold hover:bg-[#e6b825]"
              >
                Generate Image
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rival Post Modal */}
      {showRivalPostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => {
            if (rivalPostLoading || rivalPost) {
              const shouldClose = window.confirm('⚡ 7 credits have already been consumed. Do you want to close?');
              if (!shouldClose) return;
            }
            setShowRivalPostModal(false);
            setRivalPost(null);
            setRivalPostLoading(false);
          }}>
          <div 
            className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'} border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden`}
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
                  onClick={() => {
                    if (rivalPostLoading || rivalPost) {
                      const shouldClose = window.confirm('⚡ 7 credits have already been consumed. Do you want to close?');
                      if (!shouldClose) return;
                    }
                    setShowRivalPostModal(false);
                    setRivalPost(null);
                    setRivalPostLoading(false);
                  }}
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
                    Gravity is analyzing the competitor's content and creating a unique, engaging post that will help you stand out...
                  </p>
                  <div className="flex items-center gap-2 mt-4">
                    <div className="w-2 h-2 rounded-full bg-[#ffcc29] animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-[#ffcc29] animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-[#ffcc29] animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              ) : rivalPost ? (
                <div className="space-y-4">
                  {/* Original Competitor Post — collapsible */}
                  <details className={`rounded-xl ${isDarkMode ? 'bg-[#161b22] border-slate-700/50' : 'bg-slate-50 border-slate-200'} border`}>
                    <summary className={`px-4 py-3 cursor-pointer text-xs font-semibold uppercase tracking-wide ${theme.textSecondary} flex items-center gap-1.5 select-none`}>
                      <Eye className="w-3.5 h-3.5" /> Original Competitor Post
                    </summary>
                    <div className={`px-4 pb-3`}>
                      <p className={`text-sm ${theme.textSecondary} italic`}>"{rivalPost.originalContent}"</p>
                    </div>
                  </details>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Column — Image */}
                  <div>
                    <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Image</label>
                    <div className="relative rounded-xl overflow-hidden mb-3">
                      <img
                        src={getCurrentImageUrl()}
                        alt="Post image"
                        className="w-full object-contain max-h-[500px]"
                      />
                      <a
                        href={getCurrentImageUrl()}
                        download="rival-post.png"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 rounded-lg text-white transition-colors"
                        title="Download image"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetch(getCurrentImageUrl())
                            .then(res => res.blob())
                            .then(blob => {
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = 'rival-post.png';
                              a.click();
                              URL.revokeObjectURL(url);
                            })
                            .catch(() => window.open(getCurrentImageUrl(), '_blank'));
                          e.preventDefault();
                        }}
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      {imageMode === 'upload' && uploadedImageUrl && (
                        <div className="absolute top-2 left-2 px-2 py-1 bg-[#ffcc29] text-black text-xs font-medium rounded-lg">
                          Custom Image
                        </div>
                      )}
                    </div>

                    {/* Refine Image */}
                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#161b22]' : 'bg-slate-50'}`}>
                      <label className={`block text-xs mb-2 ${theme.textMuted}`}>Refine image</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customImagePrompt}
                          onChange={(e) => setCustomImagePrompt(e.target.value)}
                          placeholder="e.g. make it more vibrant, add text overlay..."
                          className={`flex-1 px-3 py-2 text-sm rounded-lg border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200'}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !regeneratingImage) handleRegenerateImage();
                          }}
                        />
                        <button
                          onClick={handleRegenerateImage}
                          disabled={regeneratingImage || !customImagePrompt.trim()}
                          className="px-3 py-2 bg-[#ffcc29] hover:bg-[#e6b825] text-black text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1"
                        >
                          {regeneratingImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Refine
                        </button>
                      </div>
                    </div>

                    {/* Upload option */}
                    <div className="mt-3">
                      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${isDarkMode ? 'bg-[#161b22] text-white hover:bg-[#21262d] border border-slate-700/50' : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'} transition-all`}
                      >
                        <Upload className="w-3 h-3" />
                        {uploadedImageUrl ? 'Change Upload' : 'Upload Your Own'}
                      </button>
                    </div>
                  </div>

                  {/* Right Column — Platform, Caption, Hashtags, Schedule */}
                  <div className="space-y-4">
                    {/* Platform */}
                    <div>
                      <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Platform</label>
                      <div className="flex gap-2 flex-wrap">
                        {['instagram', 'facebook', 'twitter', 'linkedin'].map(p => {
                          const isConnected = followerData.some(f => f.platform.toLowerCase() === p || (p === 'twitter' && f.platform.toLowerCase() === 'x') || (p === 'x' && f.platform.toLowerCase() === 'twitter'));
                          const isSelected = rivalSelectedPlatform.includes(p);
                          return (
                            <button
                              key={p}
                              onClick={() => isConnected && setRivalSelectedPlatform(prev =>
                                prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                              )}
                              disabled={!isConnected}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1 ${
                                isSelected
                                  ? 'bg-[#ffcc29] text-black'
                                  : isConnected
                                    ? isDarkMode ? 'bg-[#161b22] text-white border border-slate-700/50' : 'bg-white text-slate-700 border border-slate-200'
                                    : 'opacity-50 cursor-not-allowed bg-slate-200 text-slate-400'
                              }`}
                            >
                              {p.charAt(0).toUpperCase() + p.slice(1)}
                              {!isConnected && <span className="text-[10px]">(N/A)</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Caption */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className={`block text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Caption</label>
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
                        className={`w-full p-3 rounded-lg text-sm ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} border focus:ring-2 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] transition-all resize-none`}
                        rows={5}
                      />
                    </div>

                    {/* Hashtags */}
                    <div>
                      <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Hashtags</label>
                      <input
                        type="text"
                        value={editedHashtags}
                        onChange={(e) => setEditedHashtags(e.target.value)}
                        className={`w-full p-3 rounded-lg text-sm ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} border focus:ring-2 focus:ring-[#ffcc29]/50 focus:border-[#ffcc29] transition-all`}
                        placeholder="#trending #viral #marketing"
                      />
                      <p className={`text-xs ${theme.textMuted} mt-1`}>
                        {editedHashtags.split(/[\s#]+/).filter(t => t.trim()).length} hashtags
                      </p>
                    </div>

                    {/* Schedule (Optional) */}
                    <div>
                      <label className={`block text-xs font-semibold uppercase tracking-wide mb-2 ${theme.textSecondary}`}>Schedule (Optional)</label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={rivalScheduleDate}
                          onChange={(e) => setRivalScheduleDate(e.target.value)}
                          className={`flex-1 p-2.5 rounded-lg text-sm ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} border`}
                        />
                        <input
                          type="time"
                          value={rivalScheduleTime}
                          onChange={(e) => setRivalScheduleTime(e.target.value)}
                          className={`w-32 p-2.5 rounded-lg text-sm ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'} border`}
                        />
                      </div>
                      <p className={`text-xs ${theme.textMuted} mt-1`}>
                        <Lightbulb className="w-3 h-3 inline mr-1 text-[#ffcc29]" />
                        Best time for {rivalSelectedPlatform[0] || 'instagram'}: {rivalSelectedPlatform.includes('linkedin') ? '9:30 AM IST' : rivalSelectedPlatform.includes('instagram') ? '11:00 AM IST' : '10:00 AM IST'}
                      </p>
                    </div>
                  </div>
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
                      onClick={() => setShowPreview(true)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 hover:border-[#ffcc29]' : 'bg-white border-slate-200 hover:border-[#ffcc29]'} border ${theme.text} text-sm font-medium transition-all`}
                    >
                      <Eye className="w-4 h-4" /> Preview
                    </button>
                    <button
                      onClick={handleSaveAsDraft}
                      disabled={savingDraft}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-[#ffcc29]/30 hover:border-[#ffcc29]' : 'bg-white border-slate-200 hover:border-[#ffcc29]'} border ${theme.text} text-sm font-medium transition-all disabled:opacity-50`}
                    >
                      {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save as Draft
                    </button>
                    {rivalScheduleDate && (
                      <button
                        onClick={handleRivalSchedule}
                        disabled={rivalScheduling}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#ffcc29]/80 hover:bg-[#ffcc29] text-black text-sm font-semibold transition-all disabled:opacity-50"
                      >
                        {rivalScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                        Schedule
                      </button>
                    )}
                    <button
                      onClick={handleRivalPostNow}
                      disabled={rivalPostingNow}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black text-sm font-semibold hover:shadow-lg hover:scale-105 transition-all disabled:opacity-50"
                    >
                      {rivalPostingNow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Post Now
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Platform Preview Modal */}
      {showPreview && (
        <PlatformPreview
          platform={rivalPost?.platform || selectedPlatform[0] || 'instagram'}
          imageUrl={rivalPost?.imageUrl || postImageUrl || null}
          caption={rivalPost ? editedCaption : postCaption}
          hashtags={rivalPost ? editedHashtags.split(' ').filter(Boolean) : postHashtags}
          brandName={data?.businessContext?.name || 'Your Brand'}
          onClose={() => setShowPreview(false)}
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
};

const CalendarWidget: React.FC<{ campaigns: Campaign[]; dashboardData?: DashboardData | null; onCampaignCreated?: () => void; followerData?: Array<{ platform: string; name: string; followers: number; color: string; bgColor: string; logo: string }> }> = ({ campaigns, dashboardData, onCampaignCreated, followerData = [] }) => {
    const { isDarkMode } = useTheme();
    const theme = getThemeClasses(isDarkMode);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedEvent, setSelectedEvent] = useState<Campaign | null>(null);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<{ date: Date; hour: number; minute: number } | null>(null);
    const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
    const [pendingReminders, setPendingReminders] = useState<any[]>([]);
    const [showReminderToast, setShowReminderToast] = useState(false);
    const [loading, setLoading] = useState(false);
    const [viewType, setViewType] = useState<'day' | 'week' | 'month'>('week');
    const [allCampaigns, setAllCampaigns] = useState<Campaign[]>(campaigns);
    const [isEditMode, setIsEditMode] = useState(false);
    const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    
    // Reminder modal state
    const [selectedReminder, setSelectedReminder] = useState<any | null>(null);
    const [showDeleteReminderConfirm, setShowDeleteReminderConfirm] = useState(false);
    const [deleteReminderLoading, setDeleteReminderLoading] = useState(false);
    
    // Holiday/Event Post Generation state
    const [selectedHoliday, setSelectedHoliday] = useState<any | null>(null);
    const [eventPostLoading, setEventPostLoading] = useState(false);
    const [eventGeneratedPost, setEventGeneratedPost] = useState<any | null>(null);
    const [eventPostCaption, setEventPostCaption] = useState('');
    const [eventPostHashtags, setEventPostHashtags] = useState<string[]>([]);
    const [eventPostImageUrl, setEventPostImageUrl] = useState('');
    const [eventPostImagePrompt, setEventPostImagePrompt] = useState('');
    const [eventImageRefinementPrompt, setEventImageRefinementPrompt] = useState('');
    const [eventRefiningImage, setEventRefiningImage] = useState(false);
    const [eventScheduleDate, setEventScheduleDate] = useState('');
    const [eventScheduleTime, setEventScheduleTime] = useState('');
    const [eventSelectedPlatform, setEventSelectedPlatform] = useState<string[]>(['instagram']);
    const [eventScheduling, setEventScheduling] = useState(false);
    const [showEventPostCreator, setShowEventPostCreator] = useState(false);
    const [showEventLogoModal, setShowEventLogoModal] = useState(false);
    const [showEventAspectModal, setShowEventAspectModal] = useState(false);
    const [eventSelectedLogo, setEventSelectedLogo] = useState<string | null>(null);
    const [eventAspectRatio, setEventAspectRatio] = useState<string>('1:1');

    // Update allCampaigns when props change
    useEffect(() => {
      setAllCampaigns(campaigns);
    }, [campaigns]);
    
    // Schedule form state — streamlined for quick posting
    const [scheduleForm, setScheduleForm] = useState({
      title: '',
      type: 'reminder' as 'reminder' | 'campaign',
      description: '',
      reminderOffset: 30,
      platform: 'instagram',
      hashtags: '',
    });
    
    // Image upload & AI generation state
    const [scheduleImage, setScheduleImage] = useState<string | null>(null);
    const [scheduleImageFile, setScheduleImageFile] = useState<File | null>(null);
    const [aiGenerating, setAiGenerating] = useState(false);
    const scheduleFileInputRef = useRef<HTMLInputElement>(null);
    const scheduleDragRef = useRef<HTMLDivElement>(null);
    
    // Poster generation state
    const [generatedPoster, setGeneratedPoster] = useState<string | null>(null);
    const [posterGenerating, setPosterGenerating] = useState(false);
    const [posterContent, setPosterContent] = useState('');
    const [posterEditMode, setPosterEditMode] = useState(false);
    const [posterEditInstructions, setPosterEditInstructions] = useState('');
    const [imageMode, setImageMode] = useState<'upload' | 'ai' | 'reference'>('upload'); // upload = use as-is, ai = generate from scratch, reference = generate from reference
    const [calendarSelectedLogo, setCalendarSelectedLogo] = useState<string | null>(null);
    const [calendarAspectRatio, setCalendarAspectRatio] = useState<string>('1:1');
    const [calendarLogos, setCalendarLogos] = useState<Array<{ _id: string; name: string; url: string; isPrimary: boolean }>>([]);
    const [calendarLogosLoaded, setCalendarLogosLoaded] = useState(false);

    // Calendar step-by-step modal flow state
    const [showCalendarLogoModal, setShowCalendarLogoModal] = useState(false);
    const [showCalendarAspectModal, setShowCalendarAspectModal] = useState(false);
    const [calendarAIReady, setCalendarAIReady] = useState(false);
    const [calendarRefReady, setCalendarRefReady] = useState(false);

    // Platform preview state
    const [showCalendarPreview, setShowCalendarPreview] = useState(false);
    const [calendarPreviewData, setCalendarPreviewData] = useState<{ platform: string; imageUrl: string | null; caption: string; hashtags: string[] }>({ platform: 'instagram', imageUrl: null, caption: '', hashtags: [] });

    // Platform filter state
    const [platformFilter, setPlatformFilter] = useState<string | null>(null);
    const [showPlatformFilter, setShowPlatformFilter] = useState(false);
    const platformFilterRef = useRef<HTMLDivElement>(null);

    // Close platform filter dropdown on outside click
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (platformFilterRef.current && !platformFilterRef.current.contains(e.target as Node)) {
          setShowPlatformFilter(false);
        }
      };
      if (showPlatformFilter) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [showPlatformFilter]);

    // Fetch brand logos for calendar poster generation
    useEffect(() => {
      const fetchCalendarLogos = async () => {
        try {
          const res = await brandAssetsAPI.getLogos();
          if (res.success && res.logos?.length > 0) {
            setCalendarLogos(res.logos);
            const primary = res.logos.find((l: any) => l.isPrimary);
            if (primary) setCalendarSelectedLogo(primary.url);
          }
        } catch (err) {
          console.error('Failed to fetch logos for calendar:', err);
        } finally {
          setCalendarLogosLoaded(true);
        }
      };
      fetchCalendarLogos();
    }, []);

    // Google Calendar sync state
    const [googleCalendarSynced, setGoogleCalendarSynced] = useState(false);
    const [googleCalSyncLoading, setGoogleCalSyncLoading] = useState(false);

    // Check Google Calendar sync status on mount
    useEffect(() => {
      const checkGoogleCalSync = async () => {
        try {
          const res = await apiService.getGoogleCalendarStatus();
          setGoogleCalendarSynced(res.connected || false);
        } catch {
          // silently fail
        }
      };
      checkGoogleCalSync();
    }, []);

    const handleGoogleCalendarSync = async () => {
      if (googleCalendarSynced) {
        // Disconnect
        setGoogleCalSyncLoading(true);
        try {
          await apiService.disconnectGoogleCalendar();
          setGoogleCalendarSynced(false);
        } catch (e) {
          console.error('Failed to disconnect Google Calendar:', e);
          alert('Failed to disconnect Google Calendar.');
        } finally {
          setGoogleCalSyncLoading(false);
        }
        return;
      }
      // Initiate OAuth
      setGoogleCalSyncLoading(true);
      try {
        const res = await apiService.initiateGoogleCalendarAuth();
        if (res.authUrl) {
          // Open Google OAuth in a popup
          const popup = window.open(res.authUrl, 'googleCalAuth', 'width=500,height=600,menubar=no,toolbar=no');
          // Listen for the popup to close (callback redirects back)
          const checkClosed = setInterval(() => {
            if (popup?.closed) {
              clearInterval(checkClosed);
              // Re-check sync status
              apiService.getGoogleCalendarStatus().then(r => {
                setGoogleCalendarSynced(r.connected || false);
                setGoogleCalSyncLoading(false);
              }).catch(() => setGoogleCalSyncLoading(false));
            }
          }, 500);
        }
      } catch (e) {
        console.error('Failed to initiate Google Calendar auth:', e);
        alert('Failed to connect Google Calendar.');
        setGoogleCalSyncLoading(false);
      }
    };

    // Drag-and-drop rescheduling state
    const [draggedEvent, setDraggedEvent] = useState<any | null>(null);
    const [dragOverCell, setDragOverCell] = useState<string | null>(null); // "YYYY-MM-DD-HH" key

    // Get the start of the week (Monday)
    const getWeekStart = (date: Date) => {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
        return new Date(d.setDate(diff));
    };

    const weekStart = getWeekStart(currentDate);
    
    // Generate week days (Mon-Sun)
    const weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        return d;
    });

    // Time slots from 12 AM to 12 PM
    const timeSlots = Array.from({ length: 13 }, (_, i) => i);
    const scrollBodyRef = useRef<HTMLDivElement>(null);

    // No auto-scroll needed — all 13 slots (12 AM–12 PM) fit without scrolling

    // Indian Holidays, Festivals & Marketing Events (2025-2026)
    // This includes national holidays, major festivals, and important marketing dates
    const getIndianHolidays = (year: number): Array<{
      date: string;
      name: string;
      type: 'national' | 'festival' | 'marketing' | 'international';
      description: string;
      marketingTip?: string;
      emoji: string;
    }> => {
      return [
        // January
        { date: `${year}-01-01`, name: 'New Year\'s Day', type: 'international', description: 'Start of the new year', marketingTip: 'New Year offers, goal-setting content', emoji: '🎉' },
        { date: `${year}-01-13`, name: 'Lohri', type: 'festival', description: 'Punjabi harvest festival', marketingTip: 'Winter sales, bonfire themes', emoji: '🔥' },
        { date: `${year}-01-14`, name: 'Makar Sankranti / Pongal', type: 'festival', description: 'Harvest festival across India', marketingTip: 'Kite flying themes, harvest campaigns', emoji: '🪁' },
        { date: `${year}-01-26`, name: 'Republic Day', type: 'national', description: 'India adopted the Constitution', marketingTip: 'Patriotic campaigns, tricolor themes', emoji: '🇮🇳' },
        
        // February
        { date: `${year}-02-02`, name: 'World Wetlands Day', type: 'international', description: 'Environmental awareness', marketingTip: 'Eco-friendly product campaigns', emoji: '🌿' },
        { date: `${year}-02-14`, name: 'Valentine\'s Day', type: 'marketing', description: 'Day of love and romance', marketingTip: 'Couple offers, gift campaigns', emoji: '💕' },
        { date: `${year}-02-19`, name: 'Shivaji Jayanti', type: 'festival', description: 'Birth anniversary of Chhatrapati Shivaji', marketingTip: 'Maharashtra-focused campaigns', emoji: '⚔️' },
        { date: `${year}-02-26`, name: 'Maha Shivaratri', type: 'festival', description: 'Night of Lord Shiva', marketingTip: 'Spiritual themes, night campaigns', emoji: '🕉️' },
        
        // March
        { date: `${year}-03-08`, name: 'International Women\'s Day', type: 'international', description: 'Celebrating women globally', marketingTip: 'Women empowerment campaigns, special offers', emoji: '👩' },
        { date: `${year}-03-14`, name: 'Holi', type: 'festival', description: 'Festival of Colors', marketingTip: 'Colorful campaigns, festive offers', emoji: '🎨' },
        { date: `${year}-03-22`, name: 'World Water Day', type: 'international', description: 'Water conservation awareness', marketingTip: 'Sustainability campaigns', emoji: '💧' },
        { date: `${year}-03-30`, name: 'Gudi Padwa / Ugadi', type: 'festival', description: 'Hindu New Year (Maharashtra/South)', marketingTip: 'New beginnings themes, regional campaigns', emoji: '🏵️' },
        
        // April
        { date: `${year}-04-01`, name: 'April Fools\' Day', type: 'marketing', description: 'Day of pranks and jokes', marketingTip: 'Fun campaigns, playful content', emoji: '🃏' },
        { date: `${year}-04-06`, name: 'Ram Navami', type: 'festival', description: 'Birth of Lord Rama', marketingTip: 'Traditional themes, family values', emoji: '🏹' },
        { date: `${year}-04-10`, name: 'Mahavir Jayanti', type: 'festival', description: 'Birth of Lord Mahavira', marketingTip: 'Peace and non-violence themes', emoji: '☮️' },
        { date: `${year}-04-14`, name: 'Ambedkar Jayanti / Baisakhi', type: 'national', description: 'Dr. B.R. Ambedkar birth anniversary & Sikh New Year', marketingTip: 'Equality themes, Punjabi campaigns', emoji: '📚' },
        { date: `${year}-04-18`, name: 'Good Friday', type: 'festival', description: 'Christian observance', marketingTip: 'Respectful messaging', emoji: '✝️' },
        { date: `${year}-04-20`, name: 'Easter Sunday', type: 'festival', description: 'Christian celebration', marketingTip: 'Easter egg campaigns, spring themes', emoji: '🐣' },
        { date: `${year}-04-22`, name: 'Earth Day', type: 'international', description: 'Environmental protection', marketingTip: 'Green initiatives, eco campaigns', emoji: '🌍' },
        
        // May
        { date: `${year}-05-01`, name: 'May Day / Labour Day', type: 'national', description: 'International Workers\' Day', marketingTip: 'Worker appreciation, corporate campaigns', emoji: '👷' },
        { date: `${year}-05-12`, name: 'Buddha Purnima', type: 'festival', description: 'Buddha\'s birth anniversary', marketingTip: 'Peace and mindfulness themes', emoji: '🧘' },
        { date: `${year}-05-11`, name: 'Mother\'s Day', type: 'marketing', description: 'Celebrating mothers', marketingTip: 'Gift campaigns, family content', emoji: '👩‍👧' },
        
        // June
        { date: `${year}-06-05`, name: 'World Environment Day', type: 'international', description: 'Environmental awareness', marketingTip: 'Sustainability campaigns', emoji: '🌱' },
        { date: `${year}-06-15`, name: 'Father\'s Day', type: 'marketing', description: 'Celebrating fathers', marketingTip: 'Gift campaigns, dad appreciation', emoji: '👨‍👧' },
        { date: `${year}-06-21`, name: 'International Yoga Day', type: 'international', description: 'Global yoga celebration', marketingTip: 'Wellness campaigns, health focus', emoji: '🧘‍♀️' },
        
        // July
        { date: `${year}-07-04`, name: 'Guru Purnima', type: 'festival', description: 'Honoring spiritual teachers', marketingTip: 'Education campaigns, gratitude themes', emoji: '🙏' },
        { date: `${year}-07-17`, name: 'Muharram', type: 'festival', description: 'Islamic New Year', marketingTip: 'Respectful messaging', emoji: '☪️' },
        { date: `${year}-07-29`, name: 'International Tiger Day', type: 'international', description: 'Tiger conservation', marketingTip: 'Wildlife campaigns', emoji: '🐯' },
        
        // August
        { date: `${year}-08-07`, name: 'Friendship Day', type: 'marketing', description: 'Celebrating friendships', marketingTip: 'BFF deals, group offers', emoji: '🤝' },
        { date: `${year}-08-09`, name: 'Raksha Bandhan', type: 'festival', description: 'Brother-sister bond celebration', marketingTip: 'Gift campaigns, family focus', emoji: '🎀' },
        { date: `${year}-08-15`, name: 'Independence Day', type: 'national', description: 'India\'s Independence', marketingTip: 'Patriotic campaigns, freedom sales', emoji: '🇮🇳' },
        { date: `${year}-08-16`, name: 'Janmashtami', type: 'festival', description: 'Birth of Lord Krishna', marketingTip: 'Traditional themes, dahi handi', emoji: '🦚' },
        { date: `${year}-08-27`, name: 'Ganesh Chaturthi', type: 'festival', description: 'Lord Ganesha festival', marketingTip: 'Festive campaigns, modak themes', emoji: '🐘' },
        
        // September
        { date: `${year}-09-05`, name: 'Teachers\' Day', type: 'national', description: 'Honoring teachers', marketingTip: 'Education offers, gratitude content', emoji: '👨‍🏫' },
        { date: `${year}-09-16`, name: 'Milad-un-Nabi', type: 'festival', description: 'Prophet Muhammad\'s birthday', marketingTip: 'Respectful messaging', emoji: '🌙' },
        { date: `${year}-09-29`, name: 'World Heart Day', type: 'international', description: 'Heart health awareness', marketingTip: 'Health campaigns', emoji: '❤️' },
        
        // October
        { date: `${year}-10-02`, name: 'Gandhi Jayanti', type: 'national', description: 'Mahatma Gandhi\'s birthday', marketingTip: 'Peace campaigns, swadeshi themes', emoji: '🕊️' },
        { date: `${year}-10-02`, name: 'Navratri Begins', type: 'festival', description: '9 nights of Durga worship', marketingTip: 'Dandiya themes, festive sales', emoji: '💃' },
        { date: `${year}-10-12`, name: 'Dussehra / Vijaya Dashami', type: 'festival', description: 'Victory of good over evil', marketingTip: 'Victory themes, Ravan dahan', emoji: '🏹' },
        { date: `${year}-10-20`, name: 'Karwa Chauth', type: 'festival', description: 'Married women\'s fast', marketingTip: 'Couple campaigns, gift ideas', emoji: '🌙' },
        { date: `${year}-10-31`, name: 'Halloween', type: 'marketing', description: 'Spooky celebrations', marketingTip: 'Fun campaigns, costume themes', emoji: '🎃' },
        
        // November
        { date: `${year}-11-01`, name: 'Diwali', type: 'festival', description: 'Festival of Lights', marketingTip: 'BIGGEST shopping season, diya themes', emoji: '🪔' },
        { date: `${year}-11-02`, name: 'Govardhan Puja', type: 'festival', description: 'Day after Diwali', marketingTip: 'Continuation of festive offers', emoji: '🪻' },
        { date: `${year}-11-03`, name: 'Bhai Dooj', type: 'festival', description: 'Brother-sister celebration', marketingTip: 'Family gift campaigns', emoji: '👫' },
        { date: `${year}-11-12`, name: 'Chhath Puja', type: 'festival', description: 'Sun worship festival', marketingTip: 'Bihar/UP focused campaigns', emoji: '☀️' },
        { date: `${year}-11-15`, name: 'Guru Nanak Jayanti', type: 'festival', description: 'Sikh founder\'s birthday', marketingTip: 'Langar themes, community', emoji: '🙏' },
        { date: `${year}-11-14`, name: 'Children\'s Day', type: 'national', description: 'Jawaharlal Nehru\'s birthday', marketingTip: 'Kids products, fun campaigns', emoji: '👧' },
        { date: `${year}-11-29`, name: 'Black Friday', type: 'marketing', description: 'Shopping bonanza', marketingTip: 'Massive discounts, flash sales', emoji: '🛒' },
        
        // December
        { date: `${year}-12-02`, name: 'Cyber Monday', type: 'marketing', description: 'Online shopping day', marketingTip: 'E-commerce focused campaigns', emoji: '💻' },
        { date: `${year}-12-25`, name: 'Christmas', type: 'festival', description: 'Christian celebration', marketingTip: 'Gift campaigns, winter sales', emoji: '🎄' },
        { date: `${year}-12-26`, name: 'Boxing Day', type: 'marketing', description: 'Post-Christmas sales', marketingTip: 'Clearance sales', emoji: '📦' },
        { date: `${year}-12-31`, name: 'New Year\'s Eve', type: 'marketing', description: 'Year-end celebrations', marketingTip: 'Party themes, countdown campaigns', emoji: '🥳' },
        
        // Additional Marketing Events
        { date: `${year}-01-15`, name: 'Army Day', type: 'national', description: 'Indian Army celebration', marketingTip: 'Patriotic content, defence themes', emoji: '🎖️' },
        { date: `${year}-02-28`, name: 'National Science Day', type: 'national', description: 'Science awareness', marketingTip: 'Tech/innovation campaigns', emoji: '🔬' },
        { date: `${year}-03-15`, name: 'World Consumer Rights Day', type: 'international', description: 'Consumer awareness', marketingTip: 'Customer appreciation', emoji: '🛡️' },
        { date: `${year}-08-29`, name: 'National Sports Day', type: 'national', description: 'Dhyan Chand\'s birthday', marketingTip: 'Sports campaigns, fitness', emoji: '🏏' },
        { date: `${year}-10-16`, name: 'World Food Day', type: 'international', description: 'Food awareness', marketingTip: 'Food brand campaigns', emoji: '🍽️' },
        { date: `${year}-11-26`, name: 'Constitution Day', type: 'national', description: 'Constitution adoption', marketingTip: 'Law/rights awareness', emoji: '📜' },
      ];
    };

    // Get holidays for the current year and next year
    const currentYear = currentDate.getFullYear();
    const holidays = [...getIndianHolidays(currentYear), ...getIndianHolidays(currentYear + 1)];

    // Get holiday for a specific date
    const getHolidayForDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      return holidays.filter(h => h.date === dateStr);
    };

    // Fetch calendar events and pending reminders
    useEffect(() => {
      const fetchCalendarData = async () => {
        try {
          const year = currentDate.getFullYear();
          const month = currentDate.getMonth() + 1;
          const { events } = await apiService.getCalendarEvents(year, month);
          setCalendarEvents(events || []);
        } catch (e) {
          console.error('Failed to fetch calendar events:', e);
        }
      };
      
      const fetchPendingReminders = async () => {
        try {
          const { reminders, count } = await apiService.getPendingReminders();
          setPendingReminders(reminders || []);
          if (count > 0) {
            setShowReminderToast(true);
          }
        } catch (e) {
          console.error('Failed to fetch pending reminders:', e);
        }
      };
      
      // Fetch all campaigns to display in calendar
      const fetchAllCampaigns = async () => {
        try {
          const response = await apiService.getCampaigns();
          setAllCampaigns(response.campaigns || []);
        } catch (e) {
          console.error('Failed to fetch campaigns:', e);
        }
      };
      
      fetchCalendarData();
      fetchPendingReminders();
      fetchAllCampaigns();
      
      // Check for pending reminders every minute
      const reminderInterval = setInterval(fetchPendingReminders, 60000);
      return () => clearInterval(reminderInterval);
    }, [currentDate]);

    const handlePrevWeek = () => {
        const newDate = new Date(currentDate);
        if (viewType === 'day') {
          newDate.setDate(currentDate.getDate() - 1);
        } else if (viewType === 'week') {
          newDate.setDate(currentDate.getDate() - 7);
        } else {
          newDate.setMonth(currentDate.getMonth() - 1);
        }
        setCurrentDate(newDate);
    };

    const handleNextWeek = () => {
        const newDate = new Date(currentDate);
        if (viewType === 'day') {
          newDate.setDate(currentDate.getDate() + 1);
        } else if (viewType === 'week') {
          newDate.setDate(currentDate.getDate() + 7);
        } else {
          newDate.setMonth(currentDate.getMonth() + 1);
        }
        setCurrentDate(newDate);
    };

    const handleToday = () => setCurrentDate(new Date());
    
    // Refresh campaigns from API
    const refreshCampaigns = async () => {
      try {
        const response = await apiService.getCampaigns();
        setAllCampaigns(response.campaigns || []);
        if (onCampaignCreated) onCampaignCreated();
      } catch (e) {
        console.error('Failed to refresh campaigns:', e);
      }
    };

    const refreshCalendarEvents = async () => {
      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const { events } = await apiService.getCalendarEvents(year, month);
        setCalendarEvents(events || []);
      } catch (e) {
        console.error('Failed to refresh calendar events:', e);
      }
    };

    // --- Drag-and-drop rescheduling handlers ---
    const handleEventDragStart = (e: React.DragEvent, event: any) => {
      if (event.eventType === 'holiday') {
        e.preventDefault();
        return;
      }
      setDraggedEvent(event);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', event._id || event.id || '');
      // Make the drag ghost semi-transparent
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = '0.5';
      }
    };

    const handleEventDragEnd = (e: React.DragEvent) => {
      setDraggedEvent(null);
      setDragOverCell(null);
      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.style.opacity = '1';
      }
    };

    const handleCellDragOver = (e: React.DragEvent, cellKey: string) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverCell(cellKey);
    };

    const handleCellDragLeave = (e: React.DragEvent) => {
      // Only clear if leaving the cell (not entering a child)
      const relatedTarget = e.relatedTarget as HTMLElement;
      if (!e.currentTarget.contains(relatedTarget)) {
        setDragOverCell(null);
      }
    };

    const handleCellDrop = async (e: React.DragEvent, targetDate: Date, targetHour: number) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverCell(null);

      if (!draggedEvent) return;

      const newDateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
      const newTimeStr = `${String(targetHour).padStart(2, '0')}:00`;

      try {
        if (draggedEvent.eventType === 'campaign' || draggedEvent.type === 'campaign') {
          // Update campaign schedule
          await apiService.updateCampaign(draggedEvent._id, {
            scheduling: {
              ...draggedEvent.scheduling,
              startDate: newDateStr,
              postTime: newTimeStr
            }
          });
          // Optimistic update
          setAllCampaigns(prev => prev.map(c => 
            c._id === draggedEvent._id 
              ? { ...c, scheduling: { ...c.scheduling, startDate: newDateStr, postTime: newTimeStr } }
              : c
          ));
        } else if (draggedEvent.eventType === 'reminder' || draggedEvent.type === 'reminder') {
          // Update reminder scheduledFor
          const newScheduledFor = new Date(targetDate);
          newScheduledFor.setHours(targetHour, 0, 0, 0);
          await apiService.updateReminder(draggedEvent._id || draggedEvent.id, {
            scheduledFor: newScheduledFor.toISOString(),
            time: newScheduledFor.toISOString()
          });
          // Optimistic update
          setCalendarEvents(prev => prev.map(ev => 
            (ev._id || ev.id) === (draggedEvent._id || draggedEvent.id)
              ? { ...ev, scheduledFor: newScheduledFor.toISOString(), time: newScheduledFor.toISOString() }
              : ev
          ));
        }
      } catch (err) {
        console.error('Failed to reschedule:', err);
        // Revert on failure
        await refreshCampaigns();
        await refreshCalendarEvents();
        alert('Failed to reschedule. Please try again.');
      }

      setDraggedEvent(null);
    };

    const getCellKey = (date: Date, hour: number) => {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}-${String(hour).padStart(2, '0')}`;
    };
    
    // Handle click on time slot to schedule
    const handleSlotClick = (date: Date, hour: number) => {
      const slotDate = new Date(date);
      slotDate.setHours(hour, 0, 0, 0);
      setSelectedSlot({ date: slotDate, hour, minute: 0 });
      setScheduleForm({
        title: '',
        type: 'campaign',
        description: '',
        reminderOffset: 30,
        platform: 'instagram',
        hashtags: '',
      });
      setScheduleImage(null);
      setScheduleImageFile(null);
      setGeneratedPoster(null);
      setPosterGenerating(false);
      setPosterContent('');
      setPosterEditMode(false);
      setPosterEditInstructions('');
      setImageMode('upload');
      setShowScheduleModal(true);
    };
    
    // Handle image file selection for schedule modal
    const handleScheduleImageSelect = (file: File) => {
      if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert('Image size should be less than 10MB');
        return;
      }
      setScheduleImageFile(file);
      const reader = new FileReader();
      reader.onload = (e) => setScheduleImage(e.target?.result as string);
      reader.readAsDataURL(file);
    };
    
    // Handle drag & drop for schedule image
    const handleScheduleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) handleScheduleImageSelect(file);
    };
    
    // AI Generate caption + hashtags from uploaded image
    const handleAIGenerateCaption = async () => {
      const imageToAnalyze = generatedPoster || scheduleImage;
      if (!imageToAnalyze) {
        alert('Please upload an image first');
        return;
      }
      setAiGenerating(true);
      try {
        const result = await apiService.generateCaptionFromImage(imageToAnalyze, scheduleForm.platform);
        if (result.success && result.caption) {
          // Split caption text from hashtags
          const hashtagRegex = /#\w+/g;
          const hashtags = result.caption.match(hashtagRegex) || [];
          const captionWithoutHashtags = result.caption.replace(hashtagRegex, '').trim();
          
          setScheduleForm(prev => ({
            ...prev,
            description: captionWithoutHashtags,
            hashtags: hashtags.join(' '),
          }));
        } else {
          alert('Failed to generate caption. Please try again.');
        }
      } catch (error) {
        console.error('AI caption generation failed:', error);
        alert('Failed to generate caption. Please try again.');
      } finally {
        setAiGenerating(false);
      }
    };
    
    // Generate poster from reference image using Nano Banana Pro
    const handleGeneratePoster = async () => {
      if (imageMode === 'reference' && !scheduleImage) {
        alert('Please upload a reference image first');
        return;
      }
      if (!posterContent.trim()) {
        alert('Please enter the content/text for your poster');
        return;
      }
      setPosterGenerating(true);
      try {
        const result = await apiService.generatePosterFromReference(
          imageMode === 'reference' ? scheduleImage! : '', // empty string for AI-from-scratch
          posterContent,
          scheduleForm.platform,
          calendarSelectedLogo || undefined,
          calendarAspectRatio
        );
        if (result.success && result.imageBase64) {
          setGeneratedPoster(result.imageBase64);
          setPosterEditMode(false);
          setPosterEditInstructions('');
        } else {
          alert(result.error || 'Failed to generate poster. Please try again.');
        }
      } catch (error) {
        console.error('Poster generation failed:', error);
        alert('Failed to generate poster. Please try again.');
      } finally {
        setPosterGenerating(false);
      }
    };
    
    // Edit/refine poster with instructions (sends current image to AI for actual editing)
    const handleEditPoster = async () => {
      if (!posterEditInstructions.trim() || !generatedPoster) return;
      setPosterGenerating(true);
      try {
        const result = await apiService.editTemplatePoster(
          generatedPoster,
          posterContent,
          posterEditInstructions
        );
        if (result.success && (result.imageBase64 || result.imageUrl)) {
          setGeneratedPoster(result.imageUrl || result.imageBase64 || '');
          setPosterEditInstructions('');
          setPosterEditMode(false);
        } else {
          alert(result.error || 'Failed to edit poster. Please try again.');
        }
      } catch (error) {
        console.error('Poster edit failed:', error);
        alert('Failed to edit poster. Please try again.');
      } finally {
        setPosterGenerating(false);
      }
    };
    
    // Handle creating a reminder/event
    const handleCreateEvent = async () => {
      if (!selectedSlot || !scheduleForm.title.trim()) return;
      
      setLoading(true);
      try {
        const scheduledFor = new Date(selectedSlot.date);
        scheduledFor.setHours(selectedSlot.hour, selectedSlot.minute, 0, 0);
        
        // Format date as YYYY-MM-DD in local timezone (not UTC)
        const year = scheduledFor.getFullYear();
        const month = String(scheduledFor.getMonth() + 1).padStart(2, '0');
        const day = String(scheduledFor.getDate()).padStart(2, '0');
        const localDateStr = `${year}-${month}-${day}`;
        
        if (scheduleForm.type === 'reminder') {
          await apiService.createReminder({
            title: scheduleForm.title,
            description: scheduleForm.description,
            scheduledFor: scheduledFor.toISOString(),
            reminderOffset: scheduleForm.reminderOffset,
            platform: scheduleForm.platform
          });
          
          // Refresh calendar events
          const calYear = currentDate.getFullYear();
          const calMonth = currentDate.getMonth() + 1;
          const { events } = await apiService.getCalendarEvents(calYear, calMonth);
          setCalendarEvents(events || []);
        } else {
          // Create a campaign/post with image support
          const result = await apiService.createCampaign({
            name: scheduleForm.title,
            objective: 'engagement',
            platforms: [scheduleForm.platform],
            status: 'scheduled',
            creative: { 
              type: 'image', 
              textContent: scheduleForm.description, 
              imageUrls: (generatedPoster || scheduleImage) ? [generatedPoster || scheduleImage!] : [],
              hashtags: scheduleForm.hashtags ? scheduleForm.hashtags.split(/[\s,]+/).filter(Boolean).map(h => h.startsWith('#') ? h : `#${h}`) : [],
              captions: scheduleForm.description + (scheduleForm.hashtags ? '\n\n' + scheduleForm.hashtags : '')
            },
            scheduling: {
              startDate: localDateStr,
              postTime: `${String(selectedSlot.hour).padStart(2, '0')}:${String(selectedSlot.minute).padStart(2, '0')}`
            },
          });

          // Actually publish to social media via Ayrshare
          if (result.campaign?._id) {
            try {
              await apiService.publishCampaign(
                result.campaign._id,
                [scheduleForm.platform],
                scheduledFor.toISOString()
              );
            } catch (publishErr) {
              console.error('Ayrshare publish failed:', publishErr);
            }
          }
          
          // Add the new campaign to local state immediately with proper structure
          if (result.campaign) {
            // Ensure the campaign has the scheduling data we just set
            const newCampaign = {
              ...result.campaign,
              scheduling: {
                ...result.campaign.scheduling,
                startDate: localDateStr,
                postTime: `${String(selectedSlot.hour).padStart(2, '0')}:${String(selectedSlot.minute).padStart(2, '0')}`
              }
            };
            setAllCampaigns(prev => [newCampaign, ...prev]);
          }
        }
        
        // Sync to Google Calendar if connected
        if (googleCalendarSynced) {
          try {
            await apiService.createGoogleCalendarEvent({
              title: scheduleForm.title,
              description: scheduleForm.description || scheduleForm.title,
              startTime: scheduledFor.toISOString(),
              platform: scheduleForm.platform
            });
          } catch (gcalErr) {
            console.warn('Google Calendar sync failed (non-blocking):', gcalErr);
          }
        }

        setShowScheduleModal(false);
        setCalendarAIReady(false);
        setCalendarRefReady(false);
        setSelectedSlot(null);
      } catch (e) {
        console.error('Failed to create event:', e);
        alert('Failed to create event. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    // Handle dismissing a reminder
    const handleDismissReminder = async (reminderId: string) => {
      try {
        await apiService.dismissReminder(reminderId);
        setPendingReminders(prev => prev.filter(r => r._id !== reminderId));
        if (pendingReminders.length <= 1) {
          setShowReminderToast(false);
        }
      } catch (e) {
        console.error('Failed to dismiss reminder:', e);
      }
    };
    
    // Handle snoozing a reminder
    const handleSnoozeReminder = async (reminderId: string, minutes: number = 15) => {
      try {
        await apiService.snoozeReminder(reminderId, minutes);
        setPendingReminders(prev => prev.filter(r => r._id !== reminderId));
        if (pendingReminders.length <= 1) {
          setShowReminderToast(false);
        }
      } catch (e) {
        console.error('Failed to snooze reminder:', e);
      }
    };
    
    // Handle opening edit modal for a campaign
    const handleEditCampaign = (campaign: Campaign) => {
      setEditingCampaign(campaign);
      setIsEditMode(true);
      setScheduleForm({
        title: campaign.name || '',
        type: 'campaign',
        description: campaign.creative?.textContent || '',
        reminderOffset: 30,
        platform: campaign.platforms?.[0] || 'instagram',
        hashtags: campaign.creative?.hashtags?.join(' ') || '',
      });
      
      // Restore image if available
      const existingImage = campaign.creative?.imageUrls?.[0] || null;
      setScheduleImage(existingImage);
      setScheduleImageFile(null);
      
      // Set the slot based on campaign schedule
      const startDate = campaign.scheduling?.startDate 
        ? new Date(campaign.scheduling.startDate) 
        : new Date();
      const hour = campaign.scheduling?.postTime 
        ? parseInt(campaign.scheduling.postTime.split(':')[0]) 
        : 9;
      const minute = campaign.scheduling?.postTime 
        ? parseInt(campaign.scheduling.postTime.split(':')[1] || '0') 
        : 0;
      
      setSelectedSlot({ date: startDate, hour, minute });
      setShowScheduleModal(true);
      setSelectedEvent(null);
    };
    
    // Handle updating an existing campaign
    const handleUpdateCampaign = async () => {
      if (!editingCampaign || !selectedSlot || !scheduleForm.title.trim()) return;
      
      setLoading(true);
      try {
        const scheduledFor = new Date(selectedSlot.date);
        scheduledFor.setHours(selectedSlot.hour, selectedSlot.minute, 0, 0);
        
        await apiService.updateCampaign(editingCampaign._id, {
          name: scheduleForm.title,
          platforms: [scheduleForm.platform],
          creative: { 
            ...editingCampaign.creative,
            textContent: scheduleForm.description,
            hashtags: scheduleForm.hashtags ? scheduleForm.hashtags.split(',').map((h: string) => h.trim()) : [],
            ...((generatedPoster || scheduleImage) ? { imageUrls: [generatedPoster || scheduleImage!] } : {})
          },
          scheduling: {
            ...editingCampaign.scheduling,
            startDate: scheduledFor.toISOString().split('T')[0],
            postTime: `${String(selectedSlot.hour).padStart(2, '0')}:${String(selectedSlot.minute).padStart(2, '0')}`
          }
        });
        
        // Refresh campaigns
        await refreshCampaigns();
        
        setShowScheduleModal(false);
        setCalendarAIReady(false);
        setCalendarRefReady(false);
        setSelectedSlot(null);
        setIsEditMode(false);
        setEditingCampaign(null);
      } catch (e) {
        console.error('Failed to update campaign:', e);
        alert('Failed to update campaign. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    
    // Handle deleting a campaign
    const handleDeleteCampaign = async () => {
      if (!selectedEvent) return;
      
      setDeleteLoading(true);
      try {
        await apiService.deleteCampaign(selectedEvent._id);
        
        // Remove from local state
        setAllCampaigns(prev => prev.filter(c => c._id !== selectedEvent._id));
        
        // Also refresh from API
        await refreshCampaigns();
        
        setShowDeleteConfirm(false);
        setSelectedEvent(null);
      } catch (e) {
        console.error('Failed to delete campaign:', e);
        alert('Failed to delete campaign. Please try again.');
      } finally {
        setDeleteLoading(false);
      }
    };
    
    // Handle deleting a reminder
    const handleDeleteReminder = async () => {
      if (!selectedReminder) return;
      
      // Use _id or id (calendar API returns 'id', direct reminder API returns '_id')
      const reminderId = selectedReminder._id || selectedReminder.id;
      
      if (!reminderId) {
        alert('Cannot delete: Reminder ID not found');
        return;
      }
      
      setDeleteReminderLoading(true);
      try {
        await apiService.deleteReminder(reminderId);
        
        // Remove from calendar events (check both _id and id)
        setCalendarEvents(prev => prev.filter(e => (e._id || e.id) !== reminderId));
        
        setShowDeleteReminderConfirm(false);
        setSelectedReminder(null);
      } catch (e) {
        console.error('Failed to delete reminder:', e);
        alert('Failed to delete reminder. Please try again.');
      } finally {
        setDeleteReminderLoading(false);
      }
    };

    // Get all events for a specific day (combining campaigns, reminders, and holidays)
    const getEventsForDay = (date: Date) => {
        // Format the target date in local timezone
        const targetYear = date.getFullYear();
        const targetMonth = String(date.getMonth() + 1).padStart(2, '0');
        const targetDay = String(date.getDate()).padStart(2, '0');
        const dateStr = `${targetYear}-${targetMonth}-${targetDay}`;
        
        // Get holidays for this date
        const dayHolidays = getHolidayForDate(date).map(h => ({
          ...h,
          eventType: 'holiday' as const,
          _id: `holiday-${h.date}-${h.name}`,
          name: h.name,
          scheduling: { startDate: h.date, postTime: '00:00' }
        }));
        
        // Get campaigns from local state (includes newly created ones)
        const dayCampaigns = allCampaigns.filter(c => {
          if (!c.scheduling?.startDate) return false;
          // Handle both string dates and Date objects, normalize to YYYY-MM-DD
          let campaignDate: string;
          if (typeof c.scheduling.startDate === 'string') {
            // If it's already YYYY-MM-DD format, use it directly
            if (c.scheduling.startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
              campaignDate = c.scheduling.startDate;
            } else {
              // Parse as date and extract in local timezone
              const d = new Date(c.scheduling.startDate);
              campaignDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
          } else {
            const d = new Date(c.scheduling.startDate);
            campaignDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          }
          return campaignDate === dateStr;
        });
        
        // Get calendar events from API (reminders)
        const dayEvents = calendarEvents.filter(e => {
          if (!e.scheduledFor) return false;
          const d = new Date(e.scheduledFor);
          const eventDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          return eventDate === dateStr;
        });
        
        // Apply platform filter
        const filteredCampaigns = platformFilter
          ? dayCampaigns.filter(c => c.platforms?.includes(platformFilter))
          : dayCampaigns;
        const filteredReminders = platformFilter
          ? dayEvents.filter(e => e.platform === platformFilter)
          : dayEvents;

        // Return holidays first, then campaigns, then reminders
        return [
          ...dayHolidays,
          ...filteredCampaigns.map(c => ({ ...c, eventType: 'campaign' as const })), 
          ...filteredReminders.map(e => ({ ...e, eventType: 'reminder' as const }))
        ];
    };

    const formatDateRange = () => {
        if (viewType === 'day') {
          return currentDate.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
          });
        }
        
        if (viewType === 'month') {
          return currentDate.toLocaleDateString('en-US', { 
            month: 'long', 
            year: 'numeric' 
          });
        }
        
        // Week view
        const endOfWeek = new Date(weekStart);
        endOfWeek.setDate(weekStart.getDate() + 6);
        
        const startMonth = weekStart.toLocaleDateString('en-US', { month: 'long' });
        const endMonth = endOfWeek.toLocaleDateString('en-US', { month: 'long' });
        const year = weekStart.getFullYear();
        
        if (startMonth === endMonth) {
            return `${startMonth} ${weekStart.getDate()}–${endOfWeek.getDate()}, ${year}`;
        }
        return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${endOfWeek.getDate()}, ${year}`;
    };

    const isToday = (date: Date) => {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    const parseTime = (timeStr: string) => {
        if (!timeStr) return 9;
        const [hours] = timeStr.split(':').map(Number);
        return hours;
    };

    return (
        <div className={`${theme.bgCard} rounded-2xl border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-[#ededed] hover:border-slate-200'} overflow-hidden transition-all duration-200`}>
            {/* Reminder Toast Notification */}
            {showReminderToast && pendingReminders.length > 0 && (
              <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 duration-300">
                <div className={`${theme.bgCard} rounded-xl shadow-2xl border ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'} p-4 max-w-sm`}>
                  <div className="flex items-start gap-3">
                    <div className={`p-2 ${isDarkMode ? 'bg-amber-900/30' : 'bg-amber-100'} rounded-lg`}>
                      <BellRing className={`w-5 h-5 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`} />
                    </div>
                    <div className="flex-1">
                      <h4 className={`font-semibold text-sm ${theme.text}`}>
                        {pendingReminders.length} Reminder{pendingReminders.length > 1 ? 's' : ''}
                      </h4>
                      <p className={`text-xs mt-0.5 ${theme.textSecondary}`}>{pendingReminders[0]?.title}</p>
                      <div className="flex gap-2 mt-3">
                        <button 
                          onClick={() => handleDismissReminder(pendingReminders[0]?._id)}
                          className={`px-3 py-1.5 ${isDarkMode ? 'bg-[#0d1117] hover:bg-[#161b22] text-[#ededed]' : 'bg-[#ededed] hover:bg-slate-200 text-[#0f1526]'} text-xs font-medium rounded-lg transition-colors`}
                        >
                          Dismiss
                        </button>
                        <button 
                          onClick={() => handleSnoozeReminder(pendingReminders[0]?._id, 15)}
                          className="px-3 py-1.5 bg-[#ffcc29] hover:bg-[#e6b825] text-[#0a0f1a] text-xs font-medium rounded-lg transition-colors"
                        >
                          Snooze 15m
                        </button>
                      </div>
                    </div>
                    <button onClick={() => setShowReminderToast(false)} className={`${theme.textMuted} hover:${theme.text}`}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {/* Header */}
            <div className={`flex items-center justify-between p-5 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'}`}>
                <div className="flex items-center gap-4">
                    <button 
                        onClick={handleToday}
                        className={`px-4 py-2 ${theme.bgCard} border ${isDarkMode ? 'border-[#ffcc29]/30 hover:border-[#ffcc29]/50' : 'border-slate-200 hover:border-slate-300'} rounded-lg text-sm font-medium ${theme.textSecondary} hover:${isDarkMode ? 'bg-[#161b22]' : 'bg-[#f5f5f5]'} transition-all flex items-center gap-2`}
                    >
                        <CalendarIcon className="w-4 h-4" />
                        Today
                    </button>
                    <div className="flex items-center gap-1">
                        <button 
                            onClick={handlePrevWeek}
                            className={`p-2 ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-[#ededed]'} rounded-lg transition-colors`}
                        >
                            <ChevronLeft className={`w-4 h-4 ${theme.textSecondary}`} />
                        </button>
                        <button 
                            onClick={handleNextWeek}
                            className={`p-2 ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-[#ededed]'} rounded-lg transition-colors`}
                        >
                            <ChevronRight className={`w-4 h-4 ${theme.textSecondary}`} />
                        </button>
                    </div>
                    <h2 className={`text-base font-semibold ${theme.text}`}>
                        {formatDateRange()}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    {pendingReminders.length > 0 && (
                      <button 
                        onClick={() => setShowReminderToast(true)}
                        className={`relative p-2 ${isDarkMode ? 'hover:bg-amber-900/30' : 'hover:bg-amber-50'} rounded-lg transition-colors`}
                      >
                        <Bell className={`w-5 h-5 ${isDarkMode ? 'text-amber-400' : 'text-amber-500'}`} />
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                          {pendingReminders.length}
                        </span>
                      </button>
                    )}
                    {/* Platform Filter */}
                    <div className="relative" ref={platformFilterRef}>
                      <button
                        onClick={() => setShowPlatformFilter(!showPlatformFilter)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          platformFilter
                            ? 'bg-[#ffcc29] text-[#070A12]'
                            : `${isDarkMode ? 'bg-[#0d1117] text-slate-300 hover:bg-[#161b22]' : 'bg-[#ededed] text-slate-600 hover:bg-slate-200'}`
                        }`}
                      >
                        <Filter className="w-3.5 h-3.5" />
                        {platformFilter ? platformFilter.charAt(0).toUpperCase() + platformFilter.slice(1) : 'Filter'}
                        {platformFilter && (
                          <X
                            className="w-3 h-3 ml-0.5 hover:text-red-500"
                            onClick={(e) => { e.stopPropagation(); setPlatformFilter(null); setShowPlatformFilter(false); }}
                          />
                        )}
                      </button>
                      {showPlatformFilter && (
                        <div className={`absolute right-0 top-full mt-1 z-50 ${isDarkMode ? 'bg-[#161b22] border-slate-700' : 'bg-white border-slate-200'} border rounded-xl shadow-xl py-1 min-w-[160px] animate-in fade-in slide-in-from-top-1 duration-150`}>
                          <button
                            onClick={() => { setPlatformFilter(null); setShowPlatformFilter(false); }}
                            className={`w-full text-left px-4 py-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                              !platformFilter
                                ? `${isDarkMode ? 'bg-[#ffcc29]/20 text-[#ffcc29]' : 'bg-[#ffcc29]/10 text-[#b8941a]'}`
                                : `${isDarkMode ? 'text-slate-300 hover:bg-[#0d1117]' : 'text-slate-600 hover:bg-slate-50'}`
                            }`}
                          >
                            <span className="w-5 h-5 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-[10px]">All</span>
                            All Platforms
                            {!platformFilter && <Check className="w-3.5 h-3.5 ml-auto text-[#ffcc29]" />}
                          </button>
                          {[
                            { id: 'instagram', label: 'Instagram', color: 'from-pink-500 to-purple-600', icon: '📸' },
                            { id: 'facebook', label: 'Facebook', color: 'from-blue-500 to-blue-700', icon: '👤' },
                            { id: 'twitter', label: 'Twitter / X', color: 'from-sky-400 to-sky-600', icon: '𝕏' },
                            { id: 'linkedin', label: 'LinkedIn', color: 'from-blue-600 to-blue-800', icon: '💼' },
                          ].map(p => (
                            <button
                              key={p.id}
                              onClick={() => { setPlatformFilter(p.id); setShowPlatformFilter(false); }}
                              className={`w-full text-left px-4 py-2 text-xs font-medium flex items-center gap-2 transition-colors ${
                                platformFilter === p.id
                                  ? `${isDarkMode ? 'bg-[#ffcc29]/20 text-[#ffcc29]' : 'bg-[#ffcc29]/10 text-[#b8941a]'}`
                                  : `${isDarkMode ? 'text-slate-300 hover:bg-[#0d1117]' : 'text-slate-600 hover:bg-slate-50'}`
                              }`}
                            >
                              <span className={`w-5 h-5 rounded-full bg-gradient-to-br ${p.color} flex items-center justify-center text-white text-[10px]`}>{p.icon}</span>
                              {p.label}
                              {platformFilter === p.id && <Check className="w-3.5 h-3.5 ml-auto text-[#ffcc29]" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* View Type Selector */}
                    <div className={`flex items-center ${isDarkMode ? 'bg-[#0d1117]' : 'bg-[#ededed]'} rounded-lg p-0.5`}>
                      {(['day', 'week', 'month'] as const).map((view) => (
                        <button
                          key={view}
                          onClick={() => setViewType(view)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-all ${
                            viewType === view
                              ? `${theme.bgCard} text-[#ffcc29] shadow-sm`
                              : `${theme.textSecondary} hover:${theme.text}`
                          }`}
                        >
                          {view}
                        </button>
                      ))}
                    </div>
                    {/* Google Calendar Sync Button */}
                    <button
                      onClick={handleGoogleCalendarSync}
                      disabled={googleCalSyncLoading}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        googleCalendarSynced
                          ? `${isDarkMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30' : 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'}`
                          : `${isDarkMode ? 'bg-[#0d1117] text-slate-300 border border-slate-700/50 hover:border-[#ffcc29]/50 hover:text-[#ffcc29]' : 'bg-[#ededed] text-slate-600 border border-slate-200 hover:border-[#ffcc29] hover:text-[#b8941a]'}`
                      }`}
                      title={googleCalendarSynced ? 'Click to disconnect Google Calendar' : 'Sync scheduled posts to Google Calendar'}
                    >
                      {googleCalSyncLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : googleCalendarSynced ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <CalendarSync className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">
                        {googleCalSyncLoading ? 'Syncing...' : googleCalendarSynced ? 'Google Cal' : 'Sync Calendar'}
                      </span>
                    </button>
                    <button
                        onClick={() => {
                          const now = new Date();
                          setSelectedSlot({ date: now, hour: now.getHours() + 1, minute: 0 });
                          setScheduleForm({
                            title: '',
                            type: 'campaign',
                            description: '',
                            reminderOffset: 30,
                            platform: 'instagram',
                            budget: '',
                            targetAudience: '',
                            contentType: 'image',
                            hashtags: '',
                            callToAction: '',
                            objective: 'awareness',
                            priority: 'medium',
                            notes: ''
                          });
                          setShowScheduleModal(true);
                        }}
                        className={`text-xs text-[#070A12] bg-[#ffcc29] hover:bg-[#e6b825] px-4 py-2 rounded-lg font-semibold transition-colors flex items-center gap-1.5 shadow-sm`}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Schedule
                    </button>
                    <SectionButtons 
                      sectionType="calendar" 
                      sectionData={{ campaigns, currentWeek: formatDateRange() }} 
                    />
                </div>
            </div>

            {/* Color Legend */}
            <div className={`flex flex-wrap items-center gap-3 px-5 py-2 border-b ${isDarkMode ? 'border-[#ffcc29]/10 bg-[#0d1117]/50' : 'border-[#ededed] bg-[#f5f5f5]/50'}`}>
              <span className={`text-xs font-medium ${theme.textSecondary}`}>Legend:</span>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-orange-500"></div>
                <span className={`text-xs ${theme.textMuted}`}>National</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-pink-500"></div>
                <span className={`text-xs ${theme.textMuted}`}>Festival</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-green-500"></div>
                <span className={`text-xs ${theme.textMuted}`}>Marketing</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-blue-500"></div>
                <span className={`text-xs ${theme.textMuted}`}>International</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-[#ffcc29]"></div>
                <span className={`text-xs ${theme.textMuted}`}>Campaign</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-purple-500"></div>
                <span className={`text-xs ${theme.textMuted}`}>Reminder</span>
              </div>
            </div>

            {/* Calendar Grid */}
            {viewType === 'month' ? (
              // Month View
              <div className="p-4">
                <div className="grid grid-cols-7 gap-1">
                  {/* Day name headers */}
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className={`h-8 flex items-center justify-center text-xs font-medium ${theme.textSecondary}`}>
                      {day}
                    </div>
                  ))}
                  
                  {/* Calendar days */}
                  {(() => {
                    const year = currentDate.getFullYear();
                    const month = currentDate.getMonth();
                    const firstDay = new Date(year, month, 1);
                    const lastDay = new Date(year, month + 1, 0);
                    const startPadding = firstDay.getDay();
                    const days = [];
                    
                    // Add empty cells for padding
                    for (let i = 0; i < startPadding; i++) {
                      days.push(<div key={`pad-${i}`} className={`h-24 ${isDarkMode ? 'bg-[#0d1117]/50' : 'bg-[#f5f5f5]/50'} rounded-lg`}></div>);
                    }
                    
                    // Add actual days
                    for (let d = 1; d <= lastDay.getDate(); d++) {
                      const date = new Date(year, month, d);
                      const dayEvents = getEventsForDay(date);
                      const today = isToday(date);
                      
                      days.push(
                        <div 
                          key={d} 
                          onClick={() => handleSlotClick(date, 9)}
                          onDragOver={(e) => handleCellDragOver(e, getCellKey(date, 9))}
                          onDragLeave={handleCellDragLeave}
                          onDrop={(e) => handleCellDrop(e, date, 9)}
                          className={`h-24 p-1.5 border ${isDarkMode ? 'border-[#ffcc29]/10' : 'border-[#ededed]'} rounded-lg ${dragOverCell === getCellKey(date, 9) ? (isDarkMode ? 'bg-[#ffcc29]/30 ring-2 ring-[#ffcc29]/50' : 'bg-[#ffcc29]/20 ring-2 ring-[#ffcc29]/40') : (isDarkMode ? 'hover:bg-[#ffcc29]/10' : 'hover:bg-[#ffcc29]/5')} cursor-pointer transition-colors ${
                            today ? `${isDarkMode ? 'bg-[#ffcc29]/20 border-slate-600' : 'bg-[#ffcc29]/10 border-indigo-200'}` : ''
                          }`}
                        >
                          <span className={`text-sm font-medium ${
                            today ? 'text-white bg-[#ffcc29] w-6 h-6 rounded-full flex items-center justify-center' : theme.text
                          }`}>
                            {d}
                          </span>
                          <div className="mt-1 space-y-0.5 overflow-hidden max-h-14">
                            {dayEvents.slice(0, 3).map((event: any, idx) => (
                              <div 
                                key={event._id || idx} 
                                draggable={event.eventType !== 'holiday'}
                                onDragStart={(e) => { e.stopPropagation(); handleEventDragStart(e, event); }}
                                onDragEnd={handleEventDragEnd}
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  if (event.eventType === 'campaign') {
                                    setSelectedEvent(event);
                                  } else if (event.eventType === 'reminder' || event.type === 'reminder') {
                                    setSelectedReminder(event);
                                  } else if (event.eventType === 'holiday') {
                                    setSelectedHoliday(event);
                                  }
                                }}
                                title={event.eventType === 'holiday' ? `${event.description}${event.marketingTip ? `\n💡 ${event.marketingTip}` : ''}` : undefined}
                                className={`text-[10px] px-1.5 py-0.5 rounded truncate font-medium shadow-sm hover:opacity-80 ${event.eventType !== 'holiday' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${draggedEvent && (draggedEvent._id || draggedEvent.id) === (event._id || event.id) ? 'opacity-50 ring-1 ring-[#ffcc29]' : ''} ${
                                  event.eventType === 'holiday' 
                                    ? event.type === 'national' ? 'bg-orange-500 text-white' :
                                      event.type === 'festival' ? 'bg-pink-500 text-white' :
                                      event.type === 'marketing' ? 'bg-green-500 text-white' :
                                      'bg-blue-500 text-white'
                                    : event.eventType === 'reminder' || event.type === 'reminder' 
                                      ? `${isDarkMode ? 'bg-purple-500/80 text-white' : 'bg-purple-500 text-white'}` 
                                      : `${isDarkMode ? 'bg-[#ffcc29]/90 text-[#0a0f1a]' : 'bg-[#ffcc29] text-[#0a0f1a]'}`
                                }`}
                              >
                                {event.eventType === 'holiday' ? `${event.emoji} ${event.name}` : (event.name || event.title)}
                              </div>
                            ))}
                            {dayEvents.length > 3 && (
                              <span className={`text-[10px] pl-1 ${theme.textMuted}`}>+{dayEvents.length - 3} more</span>
                            )}
                          </div>
                        </div>
                      );
                    }
                    
                    return days;
                  })()}
                </div>
              </div>
            ) : viewType === 'day' ? (
              // Day View
              <div className="flex overflow-y-auto" style={{ height: '520px' }}>
                {/* Time Column */}
                <div className={`flex-shrink-0 w-20 border-r ${isDarkMode ? 'border-slate-700/50 bg-[#0d1117]' : 'border-slate-200 bg-[#f5f5f5]'}`}>
                  {timeSlots.map(hour => (
                    <div key={hour} className={`h-10 border-b ${isDarkMode ? 'border-[#ffcc29]/10' : 'border-[#ededed]'} pr-3 flex items-center justify-end`}>
                      <span className={`text-xs ${theme.textMuted}`}>
                        {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                      </span>
                    </div>
                  ))}
                </div>
                
                {/* Single Day Grid */}
                <div className="flex-1 relative">
                  {timeSlots.map(hour => {
                    const dayEvents = getEventsForDay(currentDate).filter((e: any) => {
                      const eventHour = e.scheduling?.postTime 
                        ? parseInt(e.scheduling.postTime.split(':')[0]) 
                        : e.time ? new Date(e.time).getHours() : 9;
                      return eventHour === hour;
                    });
                    
                    return (
                      <div 
                        key={hour}
                        onClick={() => handleSlotClick(currentDate, hour)}
                        onDragOver={(e) => handleCellDragOver(e, getCellKey(currentDate, hour))}
                        onDragLeave={handleCellDragLeave}
                        onDrop={(e) => handleCellDrop(e, currentDate, hour)}
                        className={`h-10 border-b ${isDarkMode ? 'border-[#ffcc29]/10' : 'border-[#ededed]'} ${dragOverCell === getCellKey(currentDate, hour) ? (isDarkMode ? 'bg-[#ffcc29]/30 ring-1 ring-[#ffcc29]/50' : 'bg-[#ffcc29]/20 ring-1 ring-[#ffcc29]/40') : (isDarkMode ? 'hover:bg-[#ffcc29]/10' : 'hover:bg-[#ffcc29]/5')} transition-colors cursor-pointer px-4 flex items-center gap-3`}
                      >
                        {dayEvents.map((event: any, idx) => (
                          <div 
                            key={event._id || idx}
                            draggable={event.eventType !== 'holiday'}
                            onDragStart={(e) => handleEventDragStart(e, event)}
                            onDragEnd={handleEventDragEnd}
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              if (event.eventType === 'campaign') {
                                setSelectedEvent(event);
                              } else if (event.eventType === 'reminder' || event.type === 'reminder') {
                                setSelectedReminder(event);
                              } else if (event.eventType === 'holiday') {
                                setSelectedHoliday(event);
                              }
                            }}
                            title={event.eventType === 'holiday' ? `${event.description}${event.marketingTip ? `\n💡 ${event.marketingTip}` : ''}` : undefined}
                            className={`flex-1 py-2 px-3 rounded-lg shadow-md hover:opacity-90 ${event.eventType !== 'holiday' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${draggedEvent && (draggedEvent._id || draggedEvent.id) === (event._id || event.id) ? 'opacity-50 ring-2 ring-[#ffcc29]' : ''} ${
                              event.eventType === 'holiday' 
                                ? event.type === 'national' ? 'bg-orange-500 text-white' :
                                  event.type === 'festival' ? 'bg-pink-500 text-white' :
                                  event.type === 'marketing' ? 'bg-green-500 text-white' :
                                  'bg-blue-500 text-white'
                                : event.eventType === 'reminder' || event.type === 'reminder' 
                                  ? 'bg-purple-500 text-white' 
                                  : 'bg-[#ffcc29] text-[#0a0f1a]'
                            }`}
                          >
                            <p className="text-sm font-semibold truncate">
                              {event.eventType === 'holiday' ? `${event.emoji} ${event.name}` : (event.name || event.title)}
                            </p>
                            <p className={`text-xs ${
                              event.eventType === 'holiday' ? 'text-white/80' :
                              event.eventType === 'reminder' || event.type === 'reminder' ? 'text-white/80' : 'text-[#0a0f1a]/70'
                            }`}>
                              {event.eventType === 'holiday' 
                                ? (event.type === 'national' ? '🇮🇳 National Holiday' : 
                                   event.type === 'festival' ? '🎉 Festival' : 
                                   event.type === 'marketing' ? '📈 Marketing Day' : '🌍 International')
                                : (event.platforms?.join(', ') || event.platform || '')}
                            </p>
                          </div>
                        ))}
                        {dayEvents.length === 0 && (
                          <span className={`text-sm opacity-0 hover:opacity-100 transition-opacity ${theme.textMuted}`}>+ Add event</span>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* Current Time Indicator */}
                  {isToday(currentDate) && (
                    (() => {
                      const now = new Date();
                      const currentHour = now.getHours();
                      const currentMinute = now.getMinutes();
                      if (currentHour >= 0 && currentHour <= 12) {
                        const topPos = (currentHour * 40) + (currentMinute * 0.67);
                        return (
                          <div 
                            className="absolute left-0 right-0 h-0.5 bg-red-500 z-20 pointer-events-none"
                            style={{ top: `${topPos}px` }}
                          >
                            <div className="absolute -left-1.5 -top-1.5 w-3 h-3 rounded-full bg-red-500"></div>
                          </div>
                        );
                      }
                      return null;
                    })()
                  )}
                </div>
              </div>
            ) : (
              // Week View (default)
              <div className="flex flex-col overflow-hidden" style={{ height: '572px' }}>
                {/* Day Headers - fixed at top */}
                <div className={`flex border-b flex-shrink-0 ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'} ${theme.bgCard}`}>
                    <div className={`flex-shrink-0 w-16 border-r ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}></div>
                    {weekDays.map((day, idx) => {
                        const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
                        const dayNum = day.getDate();
                        const today = isToday(day);

                        return (
                            <div
                                key={idx}
                                className={`flex-1 h-12 flex flex-col items-center justify-center border-r ${isDarkMode ? 'border-[#ffcc29]/10' : 'border-[#ededed]'} last:border-r-0 ${
                                    today ? `${isDarkMode ? 'bg-[#ffcc29]/20' : 'bg-[#ffcc29]/10'}` : ''
                                }`}
                            >
                                <span className={`text-xs font-medium ${today ? 'text-[#ffcc29]' : theme.textSecondary}`}>
                                    {dayName}
                                </span>
                                <span className={`text-xl font-bold mt-0.5 ${
                                    today
                                        ? 'text-white bg-[#ffcc29] w-8 h-8 rounded-full flex items-center justify-center'
                                        : theme.text
                                }`}>
                                    {dayNum}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* Scrollable Body: Time Column + Day Grid */}
                <div className="flex flex-1" ref={scrollBodyRef}>
                  {/* Time Column */}
                  <div className={`flex-shrink-0 w-16 border-r ${isDarkMode ? 'border-slate-700/50 bg-[#0d1117]' : 'border-slate-200 bg-[#f5f5f5]'}`}>
                    {timeSlots.map(hour => (
                        <div key={hour} className={`h-10 border-b ${isDarkMode ? 'border-[#ffcc29]/10' : 'border-[#ededed]'} pr-2 flex items-center justify-end`}>
                            <span className={`text-xs ${theme.textMuted}`}>
                                {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                            </span>
                        </div>
                    ))}
                  </div>

                  {/* Days Grid */}
                  <div className="flex-1">
                    {/* Time Grid */}
                    <div className="flex relative">
                        {weekDays.map((day, dayIdx) => {
                            const dayEvents = getEventsForDay(day);
                            const today = isToday(day);
                            
                            return (
                                <div 
                                    key={dayIdx} 
                                    className={`flex-1 border-r ${isDarkMode ? 'border-[#ffcc29]/10' : 'border-[#ededed]'} last:border-r-0 relative ${
                                        today ? `${isDarkMode ? 'bg-[#ffcc29]/10' : 'bg-[#ffcc29]/5'}` : ''
                                    }`}
                                >
                                    {timeSlots.map(hour => {
                                        const cellKey = getCellKey(day, hour);
                                        const isDropTarget = dragOverCell === cellKey;
                                        return (
                                        <div 
                                            key={hour} 
                                            onClick={() => handleSlotClick(day, hour)}
                                            onDragOver={(e) => handleCellDragOver(e, cellKey)}
                                            onDragLeave={handleCellDragLeave}
                                            onDrop={(e) => handleCellDrop(e, day, hour)}
                                            className={`h-10 border-b ${isDarkMode ? 'border-[#ffcc29]/10' : 'border-[#ededed]'} ${isDropTarget ? (isDarkMode ? 'bg-[#ffcc29]/30 border-[#ffcc29] ring-1 ring-[#ffcc29]/50' : 'bg-[#ffcc29]/20 border-[#ffcc29] ring-1 ring-[#ffcc29]/40') : (isDarkMode ? 'hover:bg-[#ffcc29]/10' : 'hover:bg-[#ffcc29]/5')} transition-colors cursor-pointer group`}
                                        >
                                            <div className="w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                              <Plus className="w-4 h-4 text-[#ffcc29]" />
                                            </div>
                                        </div>
                                        );
                                    })}
                                    
                                    {/* Events */}
                                    {dayEvents.map((event: any, idx) => {
                                        // Holidays show at top of day
                                        if (event.eventType === 'holiday') {
                                          return (
                                            <div
                                              key={event._id || idx}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedHoliday(event);
                                              }}
                                              className={`absolute left-1 right-1 rounded-md px-2 py-1 cursor-pointer hover:opacity-90 transition-opacity shadow-md border-l-4 ${
                                                event.type === 'national' ? 'bg-orange-500 border-orange-600' :
                                                event.type === 'festival' ? 'bg-pink-500 border-pink-600' :
                                                event.type === 'marketing' ? 'bg-green-500 border-green-600' :
                                                'bg-blue-500 border-blue-600'
                                              }`}
                                              style={{ 
                                                top: `${idx * 48}px`,
                                                height: '36px'
                                              }}
                                              title={`${event.description}${event.marketingTip ? `\n💡 ${event.marketingTip}` : ''}`}
                                            >
                                              <div className="flex items-center gap-1">
                                                <span className="text-xs">{event.emoji}</span>
                                                <p className="text-xs font-semibold truncate text-white">{event.name}</p>
                                              </div>
                                              <p className="text-[10px] truncate text-white/80">
                                                {event.type === 'national' ? 'National' : 
                                                 event.type === 'festival' ? 'Festival' : 
                                                 event.type === 'marketing' ? 'Marketing' : 'International'}
                                              </p>
                                            </div>
                                          );
                                        }
                                        
                                        const startHour = event.scheduling?.postTime 
                                          ? parseTime(event.scheduling.postTime)
                                          : event.time 
                                            ? new Date(event.time).getHours()
                                            : 9;
                                        const topOffset = startHour * 40;
                                        
                                        const colors: Record<string, string> = {
                                            'active': 'bg-emerald-500 border-emerald-600',
                                            'posted': 'bg-emerald-500 border-emerald-600',
                                            'scheduled': 'bg-[#ffcc29] border-[#e6b825]',
                                            'draft': 'bg-amber-500 border-amber-600',
                                            'paused': 'bg-slate-400 border-slate-500',
                                            'pending': 'bg-blue-500 border-blue-600',
                                            'reminder': 'bg-purple-500 border-purple-600'
                                        };
                                        
                                        const eventStatus = event.status || 'scheduled';
                                        const eventType = event.type || event.eventType || 'campaign';
                                        const colorClass = eventType === 'reminder' ? colors['reminder'] : (colors[eventStatus] || 'bg-[#ffcc29] border-[#e6b825]');
                                        
                                        return (
                                            <div
                                                key={event._id || event.id || idx}
                                                draggable={event.eventType !== 'holiday'}
                                                onDragStart={(e) => handleEventDragStart(e, event)}
                                                onDragEnd={handleEventDragEnd}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (event.eventType === 'campaign' || event.type === 'campaign') {
                                                    setSelectedEvent(event);
                                                  } else if (event.eventType === 'reminder' || event.type === 'reminder') {
                                                    setSelectedReminder(event);
                                                  }
                                                }}
                                                className={`absolute left-1 right-1 rounded-md px-2 py-1 cursor-grab active:cursor-grabbing hover:opacity-90 transition-opacity shadow-md border-l-4 ${colorClass} ${draggedEvent?._id === event._id ? 'opacity-50 ring-2 ring-[#ffcc29]' : ''}`}
                                                style={{ 
                                                    top: `${topOffset}px`,
                                                    height: '36px'
                                                }}
                                            >
                                                <div className="flex items-center gap-1">
                                                  {eventType === 'reminder' && <Bell className="w-2.5 h-2.5 text-white/80" />}
                                                  <p className={`text-xs font-semibold truncate ${colorClass.includes('#ffcc29') ? 'text-[#0a0f1a]' : 'text-white'}`}>{event.name || event.title}</p>
                                                </div>
                                                <p className={`text-[10px] truncate ${colorClass.includes('#ffcc29') ? 'text-[#0a0f1a]/70' : 'text-white/80'}`}>
                                                  {event.scheduling?.postTime || (event.time ? new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}
                                                  {event.platforms?.[0] ? ` • ${event.platforms[0]}` : event.platform ? ` • ${event.platform}` : ''}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}

                        {/* Current Time Indicator */}
                        {weekDays.some(d => isToday(d)) && (
                            (() => {
                                const now = new Date();
                                const currentHour = now.getHours();
                                const currentMinute = now.getMinutes();
                                if (currentHour >= 0 && currentHour <= 12) {
                                    const topPos = (currentHour * 40) + (currentMinute * 0.67);
                                    const todayIdx = weekDays.findIndex(d => isToday(d));
                                    return (
                                        <div 
                                            className="absolute h-0.5 bg-red-500 z-20 pointer-events-none"
                                            style={{ 
                                                top: `${topPos}px`,
                                                left: `${(todayIdx / 7) * 100}%`,
                                                width: `${100 / 7}%`
                                            }}
                                        >
                                            <div className="absolute -left-1.5 -top-1.5 w-3 h-3 rounded-full bg-red-500"></div>
                                        </div>
                                    );
                                }
                                return null;
                            })()
                        )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Schedule Modal - Quick Post Scheduler */}
            {showScheduleModal && selectedSlot && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => { setShowScheduleModal(false); setCalendarAIReady(false); setCalendarRefReady(false); }}>
                    <div className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'} border rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200`} onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className={`sticky top-0 z-10 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'} border-b px-6 py-4`}>
                            <div className="flex justify-between items-center">
                                <div>
                                    <h3 className={`text-lg font-bold ${theme.text}`}>{isEditMode ? 'Edit Post' : 'Quick Schedule'}</h3>
                                    <p className={`text-sm ${theme.textMuted} mt-0.5`}>
                                      {selectedSlot.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {(() => { const h = selectedSlot.hour; const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h; return `${h12}:${String(selectedSlot.minute).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`; })()}
                                    </p>
                                </div>
                                <button onClick={() => { setShowScheduleModal(false); setIsEditMode(false); setEditingCampaign(null); setCalendarAIReady(false); setCalendarRefReady(false); }} className={`p-2 ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-slate-100'} rounded-lg transition-colors`}>
                                    <X className={`w-5 h-5 ${theme.textMuted}`} />
                                </button>
                            </div>
                        </div>
                        
                        <div className="p-6 space-y-4">
                          {/* Event Type Toggle - hide in edit mode */}
                          {!isEditMode && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => setScheduleForm(prev => ({ ...prev, type: 'campaign' }))}
                              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                                scheduleForm.type === 'campaign' 
                                  ? 'bg-[#ffcc29]/20 text-[#ffcc29] border-2 border-[#ffcc29]' 
                                  : `${isDarkMode ? 'bg-[#161b22] text-slate-400 border-[#ffcc29]/10' : 'bg-slate-100 text-slate-600 border-transparent'} border-2 hover:border-[#ffcc29]/50`
                              }`}
                            >
                              <Send className="w-4 h-4" /> Post
                            </button>
                            <button
                              onClick={() => setScheduleForm(prev => ({ ...prev, type: 'reminder' }))}
                              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                                scheduleForm.type === 'reminder' 
                                  ? 'bg-purple-500/20 text-purple-500 border-2 border-purple-400' 
                                  : `${isDarkMode ? 'bg-[#161b22] text-slate-400 border-[#ffcc29]/10' : 'bg-slate-100 text-slate-600 border-transparent'} border-2 hover:border-purple-300`
                              }`}
                            >
                              <Bell className="w-4 h-4" /> Reminder
                            </button>
                          </div>
                          )}
                          
                          {/* Date & Time - compact */}
                          <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-[#161b22] border-[#ffcc29]/10' : 'bg-slate-50 border-slate-200'} border`}>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className={`text-[10px] font-semibold ${theme.textMuted} uppercase`}>Date</label>
                                <input
                                  type="date"
                                  value={selectedSlot.date.toISOString().split('T')[0]}
                                  onChange={(e) => {
                                    const newDate = new Date(e.target.value);
                                    newDate.setHours(selectedSlot.hour, selectedSlot.minute, 0, 0);
                                    setSelectedSlot({ date: newDate, hour: selectedSlot.hour, minute: selectedSlot.minute });
                                  }}
                                  className={`w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                                />
                              </div>
                              <div>
                                <label className={`text-[10px] font-semibold ${theme.textMuted} uppercase`}>Time</label>
                                <div className="flex gap-1.5 mt-1">
                                  <input type="number" min="1" max="12"
                                    value={(() => { const h = selectedSlot.hour; return h === 0 ? 12 : h > 12 ? h - 12 : h; })()}
                                    onChange={(e) => {
                                      let hour12 = parseInt(e.target.value) || 1;
                                      if (hour12 < 1) hour12 = 1; if (hour12 > 12) hour12 = 12;
                                      const isPM = selectedSlot.hour >= 12;
                                      let hour24 = hour12;
                                      if (isPM && hour12 !== 12) hour24 = hour12 + 12;
                                      if (!isPM && hour12 === 12) hour24 = 0;
                                      const newDate = new Date(selectedSlot.date); newDate.setHours(hour24, selectedSlot.minute, 0, 0);
                                      setSelectedSlot({ date: newDate, hour: hour24, minute: selectedSlot.minute });
                                    }}
                                    className={`w-12 px-1.5 py-2 border rounded-lg text-sm text-center focus:outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                                  />
                                  <span className={`flex items-center text-xs ${theme.text}`}>:</span>
                                  <input type="number" min="0" max="59"
                                    value={String(selectedSlot.minute).padStart(2, '0')}
                                    onChange={(e) => {
                                      let minute = parseInt(e.target.value) || 0;
                                      if (minute < 0) minute = 0; if (minute > 59) minute = 59;
                                      const newDate = new Date(selectedSlot.date); newDate.setHours(selectedSlot.hour, minute, 0, 0);
                                      setSelectedSlot({ date: newDate, hour: selectedSlot.hour, minute });
                                    }}
                                    className={`w-12 px-1.5 py-2 border rounded-lg text-sm text-center focus:outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                                  />
                                  <select value={selectedSlot.hour >= 12 ? 'PM' : 'AM'}
                                    onChange={(e) => {
                                      const newPeriod = e.target.value;
                                      const currentPeriod = selectedSlot.hour >= 12 ? 'PM' : 'AM';
                                      if (newPeriod !== currentPeriod) {
                                        let newHour = selectedSlot.hour;
                                        if (newPeriod === 'PM' && selectedSlot.hour < 12) newHour += 12;
                                        else if (newPeriod === 'AM' && selectedSlot.hour >= 12) newHour -= 12;
                                        const newDate = new Date(selectedSlot.date); newDate.setHours(newHour, selectedSlot.minute, 0, 0);
                                        setSelectedSlot({ date: newDate, hour: newHour, minute: selectedSlot.minute });
                                      }
                                    }}
                                    className={`w-14 px-0.5 py-2 border rounded-lg text-xs text-center focus:outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                                  >
                                    <option value="AM">AM</option>
                                    <option value="PM">PM</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {/* Post Name */}
                          <div>
                            <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>
                              {scheduleForm.type === 'reminder' ? 'Reminder Title' : 'Post Title'} *
                            </label>
                            <input
                              type="text"
                              value={scheduleForm.title}
                              onChange={(e) => setScheduleForm(prev => ({ ...prev, title: e.target.value }))}
                              placeholder={scheduleForm.type === 'reminder' ? 'e.g., Review analytics report' : 'e.g., Weekend Sale Announcement'}
                              className={`w-full mt-1.5 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'}`}
                            />
                          </div>
                          
                          {/* Campaign-only fields */}
                          {scheduleForm.type === 'campaign' && (
                            <>
                              {/* Platform */}
                              <div>
                                <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>Platform</label>
                                <select
                                  value={scheduleForm.platform}
                                  onChange={(e) => setScheduleForm(prev => ({ ...prev, platform: e.target.value }))}
                                  className={`w-full mt-1.5 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                                >
                                  <option value="instagram">📸 Instagram</option>
                                  <option value="facebook">📘 Facebook</option>
                                  <option value="twitter">🐦 Twitter/X</option>
                                  <option value="linkedin">💼 LinkedIn</option>
                                  <option value="youtube">▶️ YouTube</option>
                                </select>
                              </div>
                              
                              {/* Image / Poster — 3 Tabs: Upload, AI Generate, From Reference */}
                              <div>
                                <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>Image / Poster</label>
                                <input
                                  ref={scheduleFileInputRef}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleScheduleImageSelect(f); }}
                                />

                                {/* Tab switcher */}
                                <div className="flex gap-1 mt-1.5 mb-3">
                                  {([
                                    { key: 'upload' as const, label: 'Upload', icon: <Upload className="w-3.5 h-3.5" /> },
                                    { key: 'ai' as const, label: 'Gravity Generate', icon: <Sparkles className="w-3.5 h-3.5" /> },
                                    { key: 'reference' as const, label: 'From Reference', icon: <ImageIcon className="w-3.5 h-3.5" /> },
                                  ]).map(tab => (
                                    <button
                                      key={tab.key}
                                      onClick={() => {
                                        if (tab.key === 'ai') {
                                          if (!calendarAIReady) {
                                            setImageMode('ai');
                                            setShowCalendarLogoModal(true);
                                            return;
                                          }
                                        } else if (tab.key === 'reference') {
                                          if (!calendarRefReady) {
                                            setImageMode('reference');
                                            setShowCalendarLogoModal(true);
                                            return;
                                          }
                                        } else if (tab.key === 'upload') {
                                          setCalendarAIReady(false);
                                          setCalendarRefReady(false);
                                          setGeneratedPoster(null);
                                          setPosterContent('');
                                          setPosterEditInstructions('');
                                        }
                                        setImageMode(tab.key);
                                      }}
                                      className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                                        imageMode === tab.key
                                          ? tab.key === 'upload'
                                            ? 'bg-[#ffcc29]/20 text-[#ffcc29] border border-[#ffcc29]'
                                            : 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 border border-purple-400'
                                          : `${isDarkMode ? 'bg-[#161b22] text-slate-400 border-slate-700/50' : 'bg-slate-100 text-slate-500 border-slate-200'} border hover:border-[#ffcc29]/50`
                                      }`}
                                    >
                                      {tab.icon} {tab.label}
                                    </button>
                                  ))}
                                </div>

                                {/* ===== UPLOAD TAB ===== */}
                                {imageMode === 'upload' && (
                                  <>
                                    {scheduleImage ? (
                                      <div className="relative group">
                                        <img
                                          src={scheduleImage}
                                          alt="Upload preview"
                                          className={`w-full max-h-80 object-contain rounded-xl border ${isDarkMode ? 'border-slate-700/50 bg-[#161b22]' : 'border-slate-200 bg-slate-50'}`}
                                        />
                                        <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                          <button
                                            onClick={() => scheduleFileInputRef.current?.click()}
                                            className="px-3 py-2 bg-white/90 text-slate-800 text-xs font-medium rounded-lg hover:bg-white transition-colors flex items-center gap-1.5"
                                          >
                                            <RefreshCw className="w-3.5 h-3.5" /> Replace
                                          </button>
                                          <button
                                            onClick={() => { setScheduleImage(null); setScheduleImageFile(null); setGeneratedPoster(null); setPosterContent(''); }}
                                            className="px-3 py-2 bg-red-500/90 text-white text-xs font-medium rounded-lg hover:bg-red-500 transition-colors flex items-center gap-1.5"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" /> Remove
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div
                                        ref={scheduleDragRef}
                                        onClick={() => scheduleFileInputRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onDrop={handleScheduleDrop}
                                        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all hover:border-[#ffcc29] ${isDarkMode ? 'border-slate-700 hover:bg-[#161b22]' : 'border-slate-300 hover:bg-slate-50'}`}
                                      >
                                        <Upload className={`w-8 h-8 mx-auto mb-2 ${theme.textMuted}`} />
                                        <p className={`text-sm font-medium ${theme.text}`}>Upload your poster</p>
                                        <p className={`text-xs ${theme.textMuted} mt-1`}>Drag & drop or click to browse · Max 10MB</p>
                                      </div>
                                    )}
                                  </>
                                )}

                                {/* ===== AI GENERATE TAB ===== */}
                                {imageMode === 'ai' && calendarAIReady && (
                                  <div className="space-y-3">
                                    {/* Generated poster preview */}
                                    {generatedPoster && (
                                      <div className="relative group">
                                        <img
                                          src={generatedPoster}
                                          alt="Generated poster"
                                          className={`w-full max-h-80 object-contain rounded-xl border ${isDarkMode ? 'border-slate-700/50 bg-[#161b22]' : 'border-slate-200 bg-slate-50'}`}
                                        />
                                        <span className="absolute top-2 left-2 bg-purple-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">Gravity Generated</span>
                                        <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                          <button
                                            onClick={async () => {
                                              try {
                                                const response = await fetch(generatedPoster);
                                                const blob = await response.blob();
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `poster-${Date.now()}.png`;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                                URL.revokeObjectURL(url);
                                              } catch (err) {
                                                console.error('Download failed:', err);
                                              }
                                            }}
                                            className="px-3 py-2 bg-white/90 text-slate-800 text-xs font-medium rounded-lg hover:bg-white transition-colors flex items-center gap-1.5"
                                          >
                                            <Download className="w-3.5 h-3.5" /> Download
                                          </button>
                                          <button
                                            onClick={() => { setGeneratedPoster(null); setPosterContent(''); setPosterEditInstructions(''); }}
                                            className="px-3 py-2 bg-red-500/90 text-white text-xs font-medium rounded-lg hover:bg-red-500 transition-colors flex items-center gap-1.5"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" /> Remove
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {/* Prompt input */}
                                    <div>
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <Sparkles className={`w-3.5 h-3.5 ${generatedPoster ? 'text-purple-400' : theme.textMuted}`} />
                                        <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>
                                          {generatedPoster ? 'Refine with a prompt' : 'Describe your poster'}
                                        </label>
                                      </div>
                                      <div className="flex gap-2">
                                        <textarea
                                          value={generatedPoster ? posterEditInstructions : posterContent}
                                          onChange={(e) => generatedPoster ? setPosterEditInstructions(e.target.value) : setPosterContent(e.target.value)}
                                          placeholder={generatedPoster
                                            ? 'Tell Gravity what to change... e.g., Make the title bigger, use blue theme'
                                            : 'Describe what poster to create... e.g., Dark-themed marketing poster for a ChatGPT workshop'
                                          }
                                          rows={2}
                                          className={`flex-1 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-purple-400 resize-none ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'}`}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                              e.preventDefault();
                                              if (generatedPoster) {
                                                if (posterEditInstructions.trim()) handleEditPoster();
                                              } else {
                                                if (posterContent.trim()) handleGeneratePoster();
                                              }
                                            }
                                          }}
                                        />
                                        <button
                                          onClick={generatedPoster ? handleEditPoster : handleGeneratePoster}
                                          disabled={posterGenerating || (generatedPoster ? !posterEditInstructions.trim() : !posterContent.trim())}
                                          className={`self-end p-3 rounded-xl transition-all flex items-center justify-center ${
                                            (generatedPoster ? posterEditInstructions.trim() : posterContent.trim())
                                              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-md'
                                              : `${isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-slate-200 text-slate-400'} cursor-not-allowed`
                                          }`}
                                          title={generatedPoster ? 'Refine poster' : 'Generate poster'}
                                        >
                                          {posterGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                        </button>
                                      </div>
                                    </div>

                                    {!generatedPoster && (
                                      <p className={`text-[10px] ${theme.textMuted}`}>
                                        Gravity generates a poster from your description · Press Enter to send
                                        {calendarSelectedLogo && <span className="ml-1">· Logo: selected</span>}
                                        {calendarAspectRatio !== '1:1' && <span className="ml-1">· {calendarAspectRatio}</span>}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {/* ===== FROM REFERENCE TAB ===== */}
                                {imageMode === 'reference' && calendarRefReady && (
                                  <div className="space-y-3">
                                    {/* Reference image upload */}
                                    {scheduleImage ? (
                                      <div className="relative group">
                                        <img
                                          src={generatedPoster || scheduleImage}
                                          alt={generatedPoster ? 'Generated poster' : 'Reference image'}
                                          className={`w-full max-h-80 object-contain rounded-xl border ${isDarkMode ? 'border-slate-700/50 bg-[#161b22]' : 'border-slate-200 bg-slate-50'}`}
                                        />
                                        {generatedPoster && (
                                          <span className="absolute top-2 left-2 bg-purple-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">Gravity Generated</span>
                                        )}
                                        {!generatedPoster && (
                                          <span className={`absolute top-2 left-2 ${isDarkMode ? 'bg-slate-800/90 text-slate-300' : 'bg-white/90 text-slate-600'} text-[10px] font-bold px-2 py-0.5 rounded-md`}>Reference</span>
                                        )}
                                        <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                          {generatedPoster && (
                                            <button
                                              onClick={async () => {
                                                try {
                                                  const response = await fetch(generatedPoster);
                                                  const blob = await response.blob();
                                                  const url = URL.createObjectURL(blob);
                                                  const a = document.createElement('a');
                                                  a.href = url;
                                                  a.download = `poster-${Date.now()}.png`;
                                                  document.body.appendChild(a);
                                                  a.click();
                                                  document.body.removeChild(a);
                                                  URL.revokeObjectURL(url);
                                                } catch (err) {
                                                  console.error('Download failed:', err);
                                                }
                                              }}
                                              className="px-3 py-2 bg-white/90 text-slate-800 text-xs font-medium rounded-lg hover:bg-white transition-colors flex items-center gap-1.5"
                                            >
                                              <Download className="w-3.5 h-3.5" /> Download
                                            </button>
                                          )}
                                          <button
                                            onClick={() => scheduleFileInputRef.current?.click()}
                                            className="px-3 py-2 bg-white/90 text-slate-800 text-xs font-medium rounded-lg hover:bg-white transition-colors flex items-center gap-1.5"
                                          >
                                            <RefreshCw className="w-3.5 h-3.5" /> Replace
                                          </button>
                                          <button
                                            onClick={() => { setScheduleImage(null); setScheduleImageFile(null); setGeneratedPoster(null); setPosterContent(''); setPosterEditInstructions(''); }}
                                            className="px-3 py-2 bg-red-500/90 text-white text-xs font-medium rounded-lg hover:bg-red-500 transition-colors flex items-center gap-1.5"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" /> Remove
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div
                                        ref={scheduleDragRef}
                                        onClick={() => scheduleFileInputRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onDrop={handleScheduleDrop}
                                        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all hover:border-purple-400 ${isDarkMode ? 'border-slate-700 hover:bg-[#161b22]' : 'border-slate-300 hover:bg-slate-50'}`}
                                      >
                                        <ImageIcon className={`w-8 h-8 mx-auto mb-2 ${theme.textMuted}`} />
                                        <p className={`text-sm font-medium ${theme.text}`}>Upload a reference image</p>
                                        <p className={`text-xs ${theme.textMuted} mt-1`}>Gravity will create a new poster inspired by this · Max 10MB</p>
                                      </div>
                                    )}

                                    {/* Prompt input */}
                                    <div>
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <Sparkles className={`w-3.5 h-3.5 ${generatedPoster ? 'text-purple-400' : theme.textMuted}`} />
                                        <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>
                                          {generatedPoster ? 'Refine with a prompt' : 'Describe your poster'}
                                        </label>
                                      </div>
                                      <div className="flex gap-2">
                                        <textarea
                                          value={generatedPoster ? posterEditInstructions : posterContent}
                                          onChange={(e) => generatedPoster ? setPosterEditInstructions(e.target.value) : setPosterContent(e.target.value)}
                                          placeholder={generatedPoster
                                            ? 'Tell Gravity what to change... e.g., Make the title bigger, use blue theme, add my phone number'
                                            : 'Tell Gravity what poster to create from this reference... e.g., Dark-themed marketing poster for a ChatGPT workshop'
                                          }
                                          rows={2}
                                          className={`flex-1 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-purple-400 resize-none ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'}`}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                              e.preventDefault();
                                              if (generatedPoster) {
                                                if (posterEditInstructions.trim()) handleEditPoster();
                                              } else {
                                                if (posterContent.trim() && scheduleImage) handleGeneratePoster();
                                              }
                                            }
                                          }}
                                        />
                                        <button
                                          onClick={generatedPoster ? handleEditPoster : handleGeneratePoster}
                                          disabled={posterGenerating || (generatedPoster ? !posterEditInstructions.trim() : (!posterContent.trim() || !scheduleImage))}
                                          className={`self-end p-3 rounded-xl transition-all flex items-center justify-center ${
                                            (generatedPoster ? posterEditInstructions.trim() : (posterContent.trim() && scheduleImage))
                                              ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-md'
                                              : `${isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-slate-200 text-slate-400'} cursor-not-allowed`
                                          }`}
                                          title={generatedPoster ? 'Refine poster' : 'Generate poster'}
                                        >
                                          {posterGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                                        </button>
                                      </div>
                                    </div>

                                    {!generatedPoster && (
                                      <p className={`text-[10px] ${theme.textMuted}`}>
                                        Gravity creates a new poster inspired by your reference image · Press Enter to send
                                        {calendarSelectedLogo && <span className="ml-1">· Logo: selected</span>}
                                        {calendarAspectRatio !== '1:1' && <span className="ml-1">· {calendarAspectRatio}</span>}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              {/* Caption with AI Generate Button */}
                              <div>
                                <div className="flex items-center justify-between">
                                  <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>Caption</label>
                                  <button 
                                    onClick={handleAIGenerateCaption}
                                    disabled={aiGenerating || (!scheduleImage && !generatedPoster)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                                      (scheduleImage || generatedPoster)
                                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 shadow-sm' 
                                        : `${isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-slate-100 text-slate-400'} cursor-not-allowed`
                                    }`}
                                    title={(!scheduleImage && !generatedPoster) ? 'Upload an image first to generate caption' : 'Generate caption & hashtags from image'}
                                  >
                                    {aiGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                                    {aiGenerating ? 'Generating...' : 'Gravity Generate'}
                                  </button>
                                </div>
                                <textarea
                                  value={scheduleForm.description}
                                  onChange={(e) => setScheduleForm(prev => ({ ...prev, description: e.target.value }))}
                                  placeholder="Write your caption or generate one from your image..."
                                  rows={3}
                                  className={`w-full mt-1.5 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-[#ffcc29] resize-none ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'}`}
                                />
                              </div>
                              
                              {/* Hashtags (AI-filled or manual edit) */}
                              <div>
                                <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>Hashtags</label>
                                <input
                                  type="text"
                                  value={scheduleForm.hashtags}
                                  onChange={(e) => setScheduleForm(prev => ({ ...prev, hashtags: e.target.value }))}
                                  placeholder={aiGenerating ? 'Generating...' : '#marketing #brand #growth'}
                                  className={`w-full mt-1.5 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'}`}
                                />
                                <p className={`text-[10px] mt-1 ${theme.textMuted}`}>Auto-generated or edit manually</p>
                              </div>
                            </>
                          )}
                          
                          {/* Reminder-only fields */}
                          {scheduleForm.type === 'reminder' && (
                            <>
                              <div>
                                <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>Notes</label>
                                <textarea
                                  value={scheduleForm.description}
                                  onChange={(e) => setScheduleForm(prev => ({ ...prev, description: e.target.value }))}
                                  placeholder="Add any notes or details..."
                                  rows={2}
                                  className={`w-full mt-1.5 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-[#ffcc29] resize-none ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-800 placeholder-slate-400'}`}
                                />
                              </div>
                              <div>
                                <label className={`text-xs font-semibold ${theme.textSecondary} uppercase tracking-wide`}>Remind me</label>
                                <select
                                  value={scheduleForm.reminderOffset}
                                  onChange={(e) => setScheduleForm(prev => ({ ...prev, reminderOffset: parseInt(e.target.value) }))}
                                  className={`w-full mt-1.5 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:border-[#ffcc29] ${isDarkMode ? 'bg-[#161b22] border-slate-700/50 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                                >
                                  <option value={5}>5 minutes before</option>
                                  <option value={15}>15 minutes before</option>
                                  <option value={30}>30 minutes before</option>
                                  <option value={60}>1 hour before</option>
                                  <option value={1440}>1 day before</option>
                                </select>
                              </div>
                            </>
                          )}
                        </div>
                        
                        {/* Footer */}
                        <div className={`sticky bottom-0 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'} border-t px-6 py-4`}>
                            <div className="flex gap-3">
                                {scheduleForm.type === 'campaign' && (
                                  <button 
                                    onClick={() => {
                                      setCalendarPreviewData({
                                        platform: scheduleForm.platform,
                                        imageUrl: generatedPoster || scheduleImage || null,
                                        caption: scheduleForm.description,
                                        hashtags: scheduleForm.hashtags ? scheduleForm.hashtags.split(',').map((h: string) => h.trim()) : []
                                      });
                                      setShowCalendarPreview(true);
                                    }}
                                    className={`px-4 py-3 border ${isDarkMode ? 'border-slate-700/50 text-slate-300 hover:border-[#ffcc29] hover:text-[#ffcc29]' : 'border-slate-200 text-slate-600 hover:border-[#ffcc29] hover:text-[#b8941a]'} text-sm font-semibold rounded-xl transition-colors flex items-center gap-2`}
                                  >
                                    <Eye className="w-4 h-4" /> Preview
                                  </button>
                                )}
                                <button 
                                  onClick={isEditMode ? handleUpdateCampaign : handleCreateEvent}
                                  disabled={!scheduleForm.title.trim() || loading}
                                  className="flex-1 py-3 bg-[#ffcc29] hover:bg-[#e6b825] disabled:bg-slate-300 disabled:cursor-not-allowed text-[#070A12] text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                    {isEditMode ? 'Update' : (scheduleForm.type === 'reminder' ? 'Set Reminder' : 'Schedule Post')}
                                </button>
                                <button 
                                  onClick={() => { setShowScheduleModal(false); setIsEditMode(false); setEditingCampaign(null); setCalendarAIReady(false); setCalendarRefReady(false); }} 
                                  className={`px-5 py-3 border ${isDarkMode ? 'border-slate-700/50 text-slate-400 hover:bg-[#161b22]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} text-sm font-semibold rounded-xl transition-colors`}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Calendar Logo Selector Modal (step 1 of AI/Reference flow) */}
            <LogoSelector
              isOpen={showCalendarLogoModal}
              onClose={() => { setShowCalendarLogoModal(false); setImageMode('upload'); }}
              onConfirm={(logoUrl) => {
                setShowCalendarLogoModal(false);
                setCalendarSelectedLogo(logoUrl);
                setCalendarAspectRatio('1:1');
                setShowCalendarAspectModal(true);
              }}
            />

            {/* Calendar Aspect Ratio Selector Modal (step 2 of AI/Reference flow) */}
            {showCalendarAspectModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => { setShowCalendarAspectModal(false); setImageMode('upload'); }}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#ffcc29]/20 flex items-center justify-center">
                        <ImageIcon className="w-5 h-5 text-[#ffcc29]" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-[#0a0f1a]">Select Aspect Ratio</h3>
                        <p className="text-sm text-slate-500">Choose the image dimensions</p>
                      </div>
                    </div>
                    <button onClick={() => { setShowCalendarAspectModal(false); setImageMode('upload'); }} className="text-slate-400 hover:text-slate-600">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    {[
                      { value: '1:1', label: '1:1', desc: 'Square' },
                      { value: '4:5', label: '4:5', desc: 'Portrait' },
                      { value: '9:16', label: '9:16', desc: 'Story/Reel' },
                      { value: '16:9', label: '16:9', desc: 'Landscape' },
                      { value: '3:4', label: '3:4', desc: 'Portrait' },
                      { value: '4:3', label: '4:3', desc: 'Landscape' },
                    ].map(ratio => (
                      <button
                        key={ratio.value}
                        onClick={() => setCalendarAspectRatio(ratio.value)}
                        className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                          calendarAspectRatio === ratio.value
                            ? 'border-[#ffcc29] bg-[#ffcc29]/10'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <span className="text-sm font-bold text-[#0a0f1a]">{ratio.label}</span>
                        <span className="text-xs text-slate-500">{ratio.desc}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowCalendarAspectModal(false); setImageMode('upload'); }}
                      className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setShowCalendarAspectModal(false);
                        if (imageMode === 'ai') {
                          setCalendarAIReady(true);
                        } else if (imageMode === 'reference') {
                          setCalendarRefReady(true);
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-[#ffcc29] text-[#070A12] font-semibold hover:bg-[#e6b825]"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Selected Event Modal */}
            {selectedEvent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setSelectedEvent(null)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                                    selectedEvent.status === 'active' || selectedEvent.status === 'posted' ? 'bg-green-100 text-green-700' :
                                    selectedEvent.status === 'draft' ? 'bg-amber-100 text-amber-700' :
                                    'bg-[#ffcc29]/20 text-[#0a0f1a]'
                                }`}>
                                    {selectedEvent.status}
                                </span>
                                <h3 className="text-lg font-bold text-[#070A12] mt-2">{selectedEvent.name}</h3>
                            </div>
                            <button onClick={() => setSelectedEvent(null)} className="p-1 hover:bg-slate-100 rounded-lg">
                                <Plus className="w-5 h-5 text-slate-400 rotate-45" />
                            </button>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center gap-3 text-slate-600">
                                <CalendarIcon className="w-4 h-4 text-slate-400" />
                                <span>{selectedEvent.scheduling?.startDate ? new Date(selectedEvent.scheduling.startDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'No date set'}</span>
                            </div>
                            <div className="flex items-center gap-3 text-slate-600">
                                <Clock className="w-4 h-4 text-slate-400" />
                                <span>{selectedEvent.scheduling?.postTime || 'No time set'}</span>
                            </div>
                            <div className="flex items-center gap-3 text-slate-600">
                                <Activity className="w-4 h-4 text-slate-400" />
                                <span className="capitalize">{selectedEvent.platforms?.join(', ') || 'No platform'}</span>
                            </div>
                            
                            {/* Real Performance Data */}
                            {selectedEvent.performance && (selectedEvent.performance.impressions > 0 || selectedEvent.performance.clicks > 0) && (
                              <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Performance</p>
                                <div className="grid grid-cols-3 gap-3 text-center">
                                  <div>
                                    <p className="text-lg font-bold text-[#0a0f1a]">{(selectedEvent.performance.impressions || 0).toLocaleString()}</p>
                                    <p className="text-[10px] text-slate-400">Impressions</p>
                                  </div>
                                  <div>
                                    <p className="text-lg font-bold text-[#0a0f1a]">{(selectedEvent.performance.clicks || 0).toLocaleString()}</p>
                                    <p className="text-[10px] text-slate-400">Clicks</p>
                                  </div>
                                  <div>
                                    <p className="text-lg font-bold text-[#0a0f1a]">{selectedEvent.performance.ctr || 0}%</p>
                                    <p className="text-[10px] text-slate-400">CTR</p>
                                  </div>
                                </div>
                              </div>
                            )}
                            
                            {/* Description if available */}
                            {selectedEvent.creative?.textContent && (
                              <div className="mt-3 p-3 bg-slate-50 rounded-lg">
                                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Description</p>
                                <p className="text-sm text-slate-600">{selectedEvent.creative.textContent}</p>
                              </div>
                            )}
                        </div>
                        
                        {/* Delete Confirmation */}
                        {showDeleteConfirm ? (
                          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                            <p className="text-sm text-red-800 font-medium mb-3">Are you sure you want to delete this campaign? This action cannot be undone.</p>
                            <div className="flex gap-2">
                              <button 
                                onClick={handleDeleteCampaign}
                                disabled={deleteLoading}
                                className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                              >
                                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                Yes, Delete
                              </button>
                              <button 
                                onClick={() => setShowDeleteConfirm(false)} 
                                className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-3 mt-6">
                            <button 
                              onClick={() => handleEditCampaign(selectedEvent)}
                              className="flex-1 py-2 bg-[#ffcc29] hover:bg-[#e6b825] text-[#0a0f1a] text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                              <Edit3 className="w-4 h-4" />
                              Edit
                            </button>
                            <button 
                              onClick={() => setShowDeleteConfirm(true)}
                              className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 border border-red-200"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                            <button onClick={() => { setSelectedEvent(null); setShowDeleteConfirm(false); }} className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors">
                              Close
                            </button>
                          </div>
                        )}
                    </div>
                </div>
            )}
            
            {/* Selected Reminder Modal */}
            {selectedReminder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setSelectedReminder(null)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase bg-purple-100 text-purple-700">
                                    Reminder
                                </span>
                                <h3 className="text-lg font-bold text-[#070A12] mt-2">{selectedReminder.title || selectedReminder.name}</h3>
                            </div>
                            <button onClick={() => setSelectedReminder(null)} className="p-1 hover:bg-slate-100 rounded-lg">
                                <Plus className="w-5 h-5 text-slate-400 rotate-45" />
                            </button>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center gap-3 text-slate-600">
                                <CalendarIcon className="w-4 h-4 text-slate-400" />
                                <span>
                                  {selectedReminder.scheduledFor 
                                    ? new Date(selectedReminder.scheduledFor).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) 
                                    : selectedReminder.time 
                                    ? new Date(selectedReminder.time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) 
                                    : 'No date set'}
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-slate-600">
                                <Clock className="w-4 h-4 text-slate-400" />
                                <span>
                                  {selectedReminder.scheduledFor 
                                    ? new Date(selectedReminder.scheduledFor).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                                    : selectedReminder.time 
                                    ? new Date(selectedReminder.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                                    : 'No time set'}
                                </span>
                            </div>
                            {selectedReminder.platform && (
                              <div className="flex items-center gap-3 text-slate-600">
                                  <Activity className="w-4 h-4 text-slate-400" />
                                  <span className="capitalize">{selectedReminder.platform}</span>
                              </div>
                            )}
                            
                            {/* Description if available */}
                            {selectedReminder.description && (
                              <div className="mt-3 p-3 bg-purple-50 rounded-lg">
                                <p className="text-xs font-semibold text-purple-500 uppercase mb-1">Description</p>
                                <p className="text-sm text-slate-600">{selectedReminder.description}</p>
                              </div>
                            )}
                        </div>
                        
                        {/* Delete Confirmation */}
                        {showDeleteReminderConfirm ? (
                          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                            <p className="text-sm text-red-800 font-medium mb-3">Are you sure you want to delete this reminder? This action cannot be undone.</p>
                            <div className="flex gap-2">
                              <button 
                                onClick={handleDeleteReminder}
                                disabled={deleteReminderLoading}
                                className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                              >
                                {deleteReminderLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                Yes, Delete
                              </button>
                              <button 
                                onClick={() => setShowDeleteReminderConfirm(false)} 
                                className="flex-1 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-3 mt-6">
                            <button 
                              onClick={() => setShowDeleteReminderConfirm(true)}
                              className="flex-1 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 border border-red-200"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                            <button onClick={() => { setSelectedReminder(null); setShowDeleteReminderConfirm(false); }} className="flex-1 py-2 border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors">
                              Close
                            </button>
                          </div>
                        )}
                    </div>
                </div>
            )}

            {/* Holiday/Event Modal */}
            {selectedHoliday && !showEventPostCreator && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setSelectedHoliday(null)}>
                    <div className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white'} border rounded-xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200`} onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                                    selectedHoliday.type === 'national' ? 'bg-orange-100 text-orange-700' :
                                    selectedHoliday.type === 'festival' ? 'bg-pink-100 text-pink-700' :
                                    selectedHoliday.type === 'marketing' ? 'bg-green-100 text-green-700' :
                                    'bg-blue-100 text-blue-700'
                                }`}>
                                    {selectedHoliday.type === 'national' ? 'National Holiday' :
                                     selectedHoliday.type === 'festival' ? 'Festival' :
                                     selectedHoliday.type === 'marketing' ? 'Marketing Day' : 'International Day'}
                                </span>
                                <h3 className={`text-lg font-bold ${theme.text} mt-2 flex items-center gap-2`}>
                                    <span className="text-2xl">{selectedHoliday.emoji}</span>
                                    {selectedHoliday.name}
                                </h3>
                            </div>
                            <button onClick={() => setSelectedHoliday(null)} className={`p-1 ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-slate-100'} rounded-lg`}>
                                <Plus className={`w-5 h-5 ${theme.textMuted} rotate-45`} />
                            </button>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div className={`flex items-center gap-3 ${theme.textSecondary}`}>
                                <CalendarIcon className="w-4 h-4" />
                                <span>{selectedHoliday.date ? new Date(selectedHoliday.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Upcoming'}</span>
                            </div>
                            
                            {/* Description */}
                            <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#161b22]' : 'bg-slate-50'}`}>
                                <p className={`text-xs font-semibold uppercase mb-1 ${theme.textMuted}`}>About this day</p>
                                <p className={`text-sm ${theme.text}`}>{selectedHoliday.description || `Celebrate ${selectedHoliday.name} with your audience!`}</p>
                            </div>
                            
                            {/* Marketing Tip */}
                            {selectedHoliday.marketingTip && (
                              <div className={`p-3 rounded-lg bg-[#ffcc29]/10 border border-[#ffcc29]/30`}>
                                <p className="text-xs font-semibold uppercase mb-1 text-[#ffcc29]">💡 Marketing Tip</p>
                                <p className={`text-sm ${theme.text}`}>{selectedHoliday.marketingTip}</p>
                              </div>
                            )}
                        </div>
                        
                        {/* Create Post Button */}
                        <div className="mt-6">
                            <button
                              onClick={() => {
                                setShowEventLogoModal(true);
                              }}
                              className="w-full py-3 bg-[#ffcc29] hover:bg-[#e6b825] text-black font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                              <Sparkles className="w-5 h-5" />
                              Create Post for This Event
                              <span className="flex items-center gap-0.5 text-xs bg-black/10 px-1.5 py-0.5 rounded-full"><Zap className="w-3 h-3" />7</span>
                            </button>
                            <button 
                              onClick={() => setSelectedHoliday(null)} 
                              className={`w-full mt-2 py-2 border ${theme.border} ${theme.textSecondary} text-sm font-semibold rounded-lg ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-slate-50'} transition-colors`}
                            >
                              Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Event Logo Selector Modal */}
            <LogoSelector
              isOpen={showEventLogoModal}
              onClose={() => setShowEventLogoModal(false)}
              onConfirm={(logoUrl) => {
                setShowEventLogoModal(false);
                setEventSelectedLogo(logoUrl);
                setEventAspectRatio('1:1');
                setShowEventAspectModal(true);
              }}
            />

            {/* Event Aspect Ratio Modal */}
            {showEventAspectModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowEventAspectModal(false)}>
                <div className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white'} border rounded-2xl shadow-2xl w-full max-w-md p-6`} onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#ffcc29]/20 flex items-center justify-center">
                        <ImageIcon className="w-5 h-5 text-[#ffcc29]" />
                      </div>
                      <div>
                        <h3 className={`text-lg font-bold ${theme.text}`}>Select Aspect Ratio</h3>
                        <p className={`text-sm ${theme.textMuted}`}>Choose the image dimensions</p>
                      </div>
                    </div>
                    <button onClick={() => setShowEventAspectModal(false)} className={`${theme.textMuted} hover:text-slate-600`}>
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    {[
                      { value: '1:1', label: '1:1', desc: 'Square' },
                      { value: '4:5', label: '4:5', desc: 'Portrait' },
                      { value: '9:16', label: '9:16', desc: 'Story/Reel' },
                      { value: '16:9', label: '16:9', desc: 'Landscape' },
                      { value: '3:4', label: '3:4', desc: 'Portrait' },
                      { value: '4:3', label: '4:3', desc: 'Landscape' },
                    ].map(ratio => (
                      <button
                        key={ratio.value}
                        onClick={() => setEventAspectRatio(ratio.value)}
                        className={`p-3 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                          eventAspectRatio === ratio.value
                            ? 'border-[#ffcc29] bg-[#ffcc29]/10'
                            : `${isDarkMode ? 'border-slate-700 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'}`
                        }`}
                      >
                        <span className={`text-sm font-bold ${theme.text}`}>{ratio.label}</span>
                        <span className={`text-xs ${theme.textMuted}`}>{ratio.desc}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowEventAspectModal(false)}
                      className={`flex-1 py-2.5 rounded-xl border ${isDarkMode ? 'border-slate-700 text-slate-400 hover:bg-[#161b22]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} font-medium`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setShowEventAspectModal(false);
                        if (!selectedHoliday) return;
                        setShowEventPostCreator(true);
                        setEventPostLoading(true);
                        setEventGeneratedPost(null);
                        const connectedNames = followerData.map(f => f.platform.toLowerCase());
                        setEventSelectedPlatform(connectedNames.length > 0 ? [connectedNames[0]] : []);
                        try {
                          const result = await apiService.generateEventPost(selectedHoliday, eventSelectedLogo, eventAspectRatio);
                          if (result.success && result.post) {
                            setEventGeneratedPost(result.post);
                            setEventPostCaption(result.post.caption || '');
                            setEventPostHashtags(result.post.hashtags || []);
                            setEventPostImageUrl(result.post.generatedImageUrl || '');
                            setEventPostImagePrompt(result.post.imagePrompt || '');
                            if (selectedHoliday.date) {
                              setEventScheduleDate(selectedHoliday.date.split('T')[0]);
                            }
                          }
                        } catch (error) {
                          console.error('Failed to generate event post:', error);
                        } finally {
                          setEventPostLoading(false);
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-[#ffcc29] text-[#070A12] font-semibold hover:bg-[#e6b825]"
                    >
                      Generate Post
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Event Post Creator Modal */}
            {showEventPostCreator && selectedHoliday && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => { setShowEventPostCreator(false); setSelectedHoliday(null); }}>
                    <div className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white'} border rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200`} onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className={`sticky top-0 z-10 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'} border-b px-6 py-4 flex justify-between items-center`}>
                            <div className="flex items-center gap-3">
                                <span className="text-3xl">{selectedHoliday.emoji}</span>
                                <div>
                                    <h2 className={`text-xl font-bold ${theme.text}`}>Create Post for {selectedHoliday.name}</h2>
                                    <p className={`text-sm ${theme.textMuted}`}>Generated content ready for your review</p>
                                </div>
                            </div>
                            <button onClick={() => { setShowEventPostCreator(false); setSelectedHoliday(null); }} className={`p-2 ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-slate-100'} rounded-lg`}>
                                <Plus className={`w-5 h-5 ${theme.textMuted} rotate-45`} />
                            </button>
                        </div>
                        
                        {eventPostLoading ? (
                            <div className="flex flex-col items-center justify-center py-16">
                                <Loader2 className="w-12 h-12 text-[#ffcc29] animate-spin mb-4" />
                                <p className={`text-lg font-medium ${theme.text}`}>Generating your post...</p>
                                <p className={`text-sm ${theme.textMuted}`}>Creating caption, image, and suggestions</p>
                            </div>
                        ) : eventGeneratedPost ? (
                            <div className="p-6 space-y-6">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Left Column: Image */}
                                    <div className="space-y-4">
                                        <div>
                                            <label className={`text-sm font-semibold ${theme.text} mb-2 block`}>Generated Image</label>
                                            <div className={`relative rounded-xl overflow-hidden ${isDarkMode ? 'bg-[#161b22]' : 'bg-slate-100'} group`}>
                                                {eventPostImageUrl ? (
                                                    <>
                                                        <img
                                                            src={eventPostImageUrl}
                                                            alt="Generated post"
                                                            className="w-full object-contain max-h-[500px]"
                                                        />
                                                        <div className="absolute inset-0 bg-black/40 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <button
                                                                onClick={async () => {
                                                                    try {
                                                                        const response = await fetch(eventPostImageUrl);
                                                                        const blob = await response.blob();
                                                                        const url = URL.createObjectURL(blob);
                                                                        const a = document.createElement('a');
                                                                        a.href = url;
                                                                        a.download = `event-post-${selectedHoliday?.name?.replace(/\s+/g, '-') || 'post'}-${Date.now()}.png`;
                                                                        document.body.appendChild(a);
                                                                        a.click();
                                                                        document.body.removeChild(a);
                                                                        URL.revokeObjectURL(url);
                                                                    } catch (err) {
                                                                        console.error('Download failed:', err);
                                                                    }
                                                                }}
                                                                className="px-4 py-2 bg-white/90 text-slate-800 text-sm font-medium rounded-lg hover:bg-white transition-colors flex items-center gap-2"
                                                            >
                                                                <Download className="w-4 h-4" /> Download
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="w-full h-64 flex items-center justify-center">
                                                        <ImageIcon className={`w-16 h-16 ${theme.textMuted}`} />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {/* Image Refinement */}
                                        <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-[#161b22]' : 'bg-slate-50'}`}>
                                            <label className={`text-xs font-semibold uppercase ${theme.textMuted} mb-2 block`}>Edit Image</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={eventImageRefinementPrompt}
                                                    onChange={(e) => setEventImageRefinementPrompt(e.target.value)}
                                                    placeholder="E.g., Add more festive colors, include brand logo..."
                                                    className={`flex-1 px-3 py-2 text-sm rounded-lg ${isDarkMode ? 'bg-[#0d1117] text-white border-slate-700/50' : 'bg-white text-slate-900 border-slate-200'} border focus:outline-none focus:ring-2 focus:ring-[#ffcc29]`}
                                                />
                                                <button 
                                                    onClick={async () => {
                                                        if (!eventImageRefinementPrompt.trim() || !eventPostImagePrompt) return;
                                                        setEventRefiningImage(true);
                                                        try {
                                                            const result = await apiService.refineImage(eventPostImagePrompt, eventImageRefinementPrompt, eventGeneratedPost.imageStyle, eventPostImageUrl);
                                                            if (result.success && result.imageUrl) {
                                                                setEventPostImageUrl(result.imageUrl);
                                                                setEventImageRefinementPrompt('');
                                                            }
                                                        } catch (error) {
                                                            console.error('Failed to refine image:', error);
                                                        } finally {
                                                            setEventRefiningImage(false);
                                                        }
                                                    }}
                                                    disabled={eventRefiningImage || !eventImageRefinementPrompt.trim()}
                                                    className="px-4 py-2 bg-[#ffcc29] hover:bg-[#e6b825] disabled:bg-gray-400 text-black text-sm font-semibold rounded-lg transition-colors flex items-center gap-1"
                                                >
                                                    {eventRefiningImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                                                    Refine
                                                </button>
                                            </div>
                                        </div>
                                        
                                    </div>
                                    
                                    {/* Right Column: Caption & Details */}
                                    <div className="space-y-4">
                                        {/* Caption */}
                                        <div>
                                            <label className={`text-sm font-semibold ${theme.text} mb-2 block`}>Caption</label>
                                            <textarea
                                                value={eventPostCaption}
                                                onChange={(e) => setEventPostCaption(e.target.value)}
                                                rows={8}
                                                className={`w-full px-4 py-3 rounded-lg text-sm ${isDarkMode ? 'bg-[#161b22] text-white border-slate-700/50' : 'bg-slate-50 text-slate-900 border-slate-200'} border focus:outline-none focus:ring-2 focus:ring-[#ffcc29] resize-none`}
                                            />
                                        </div>
                                        
                                        {/* Hashtags */}
                                        <div>
                                            <label className={`text-sm font-semibold ${theme.text} mb-2 block`}>Hashtags</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {eventPostHashtags.map((tag, idx) => (
                                                    <span 
                                                        key={idx} 
                                                        className={`text-xs px-2 py-1 rounded-full ${isDarkMode ? 'bg-[#ffcc29]/20 text-[#ffcc29]' : 'bg-[#ffcc29]/10 text-[#b8941f]'} cursor-pointer hover:opacity-70`}
                                                        onClick={() => setEventPostHashtags(prev => prev.filter((_, i) => i !== idx))}
                                                        title="Click to remove"
                                                    >
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        
                                        {/* Platform Selection */}
                                        <div>
                                            <label className={`text-sm font-semibold ${theme.text} mb-2 block`}>Platform</label>
                                            <div className="flex gap-2 flex-wrap">
                                                {['instagram', 'facebook', 'twitter', 'linkedin'].map(platform => {
                                                    const isConnected = followerData.some(f => f.platform.toLowerCase() === platform || (platform === 'twitter' && f.platform.toLowerCase() === 'x') || (platform === 'x' && f.platform.toLowerCase() === 'twitter'));
                                                    const isSelected = eventSelectedPlatform.includes(platform);
                                                    return (
                                                        <button
                                                            key={platform}
                                                            onClick={() => isConnected && setEventSelectedPlatform(prev =>
                                                                prev.includes(platform) ? prev.filter(x => x !== platform) : [...prev, platform]
                                                            )}
                                                            disabled={!isConnected}
                                                            className={`py-2 px-4 rounded-lg text-sm font-medium capitalize transition-all flex items-center gap-1 ${
                                                                isSelected
                                                                    ? 'bg-[#ffcc29] text-black'
                                                                    : isConnected
                                                                        ? `${isDarkMode ? 'bg-[#161b22] text-slate-400 hover:bg-[#1f2937]' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`
                                                                        : 'opacity-50 cursor-not-allowed bg-slate-200 text-slate-400'
                                                            }`}
                                                        >
                                                            {platform}
                                                            {!isConnected && <span className="text-[10px]">(N/A)</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        
                                        {/* Best Posting Time */}
                                        {eventGeneratedPost.bestPostTimes && eventSelectedPlatform.length > 0 && eventGeneratedPost.bestPostTimes[eventSelectedPlatform[0]] && (
                                            <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-green-500/10 border-green-500/20' : 'bg-green-50 border-green-200'} border`}>
                                                <p className={`text-xs font-semibold ${isDarkMode ? 'text-green-400' : 'text-green-700'}`}>
                                                    ⏰ Best time to post on {eventSelectedPlatform[0]}: {eventGeneratedPost.bestPostTimes[eventSelectedPlatform[0]]}
                                                </p>
                                            </div>
                                        )}
                                        
                                        {/* Schedule Date & Time */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className={`text-xs font-semibold uppercase ${theme.textMuted} mb-1 block`}>Schedule Date</label>
                                                <input
                                                    type="date"
                                                    value={eventScheduleDate}
                                                    onChange={(e) => setEventScheduleDate(e.target.value)}
                                                    className={`w-full px-3 py-2 text-sm rounded-lg ${isDarkMode ? 'bg-[#161b22] text-white border-slate-700/50' : 'bg-slate-50 text-slate-900 border-slate-200'} border focus:outline-none focus:ring-2 focus:ring-[#ffcc29]`}
                                                />
                                            </div>
                                            <div>
                                                <label className={`text-xs font-semibold uppercase ${theme.textMuted} mb-1 block`}>Time</label>
                                                <input
                                                    type="time"
                                                    value={eventScheduleTime}
                                                    onChange={(e) => setEventScheduleTime(e.target.value)}
                                                    className={`w-full px-3 py-2 text-sm rounded-lg ${isDarkMode ? 'bg-[#161b22] text-white border-slate-700/50' : 'bg-slate-50 text-slate-900 border-slate-200'} border focus:outline-none focus:ring-2 focus:ring-[#ffcc29]`}
                                                />
                                            </div>
                                        </div>
                                        
                                        {/* Content Notes */}
                                        {eventGeneratedPost.contentNotes && (
                                            <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-200'} border`}>
                                                <p className={`text-xs font-semibold mb-1 ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}>💡 Content Tips</p>
                                                <p className={`text-xs ${theme.textSecondary}`}>{eventGeneratedPost.contentNotes}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Action Buttons */}
                                <div className={`flex gap-3 pt-4 border-t ${theme.border}`}>
                                    <button
                                      onClick={() => {
                                        setCalendarPreviewData({
                                          platform: eventSelectedPlatform[0] || 'instagram',
                                          imageUrl: eventPostImageUrl || null,
                                          caption: eventPostCaption,
                                          hashtags: eventPostHashtags
                                        });
                                        setShowCalendarPreview(true);
                                      }}
                                      className={`px-4 py-3 border ${isDarkMode ? 'border-slate-700/50 text-slate-300 hover:border-[#ffcc29] hover:text-[#ffcc29]' : 'border-slate-200 text-slate-600 hover:border-[#ffcc29] hover:text-[#b8941a]'} text-sm font-semibold rounded-lg transition-colors flex items-center gap-2`}
                                    >
                                      <Eye className="w-4 h-4" /> Preview
                                    </button>
                                    <button 
                                        onClick={async () => {
                                            setEventScheduling(true);
                                            try {
                                                await apiService.createCampaign({
                                                    name: `${selectedHoliday.name} Post`,
                                                    objective: 'engagement',
                                                    platforms: eventSelectedPlatform,
                                                    status: 'draft',
                                                    creative: {
                                                        type: 'image',
                                                        textContent: eventPostCaption,
                                                        imageUrls: eventPostImageUrl ? [eventPostImageUrl] : [],
                                                        captions: eventPostCaption,
                                                        hashtags: eventPostHashtags
                                                    }
                                                });
                                                alert('Post saved as draft!');
                                                setShowEventPostCreator(false);
                                                setSelectedHoliday(null);
                                                if (onCampaignCreated) onCampaignCreated();
                                            } catch (error) {
                                                console.error('Failed to save draft:', error);
                                                alert('Failed to save draft. Please try again.');
                                            } finally {
                                                setEventScheduling(false);
                                            }
                                        }}
                                        disabled={eventScheduling}
                                        className={`flex-1 py-3 ${isDarkMode ? 'bg-[#161b22] hover:bg-[#1f2937] text-white border-slate-700/50' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} border font-semibold rounded-lg transition-colors flex items-center justify-center gap-2`}
                                    >
                                        <FileText className="w-4 h-4" />
                                        Save as Draft
                                    </button>
                                    <button 
                                        onClick={async () => {
                                            if (!eventScheduleDate) {
                                                alert('Please select a schedule date');
                                                return;
                                            }
                                            setEventScheduling(true);
                                            try {
                                                await apiService.createCampaign({
                                                    name: `${selectedHoliday.name} Post`,
                                                    objective: 'engagement',
                                                    platforms: eventSelectedPlatform,
                                                    status: 'scheduled',
                                                    creative: {
                                                        type: 'image',
                                                        textContent: eventPostCaption,
                                                        imageUrls: eventPostImageUrl ? [eventPostImageUrl] : [],
                                                        captions: eventPostCaption,
                                                        hashtags: eventPostHashtags
                                                    },
                                                    scheduling: {
                                                        startDate: eventScheduleDate,
                                                        postTime: eventScheduleTime || '10:00'
                                                    }
                                                });
                                                alert('Post scheduled successfully!');
                                                setShowEventPostCreator(false);
                                                setSelectedHoliday(null);
                                                if (onCampaignCreated) onCampaignCreated();
                                            } catch (error) {
                                                console.error('Failed to schedule post:', error);
                                                alert('Failed to schedule post. Please try again.');
                                            } finally {
                                                setEventScheduling(false);
                                            }
                                        }}
                                        disabled={eventScheduling}
                                        className="flex-1 py-3 bg-[#ffcc29] hover:bg-[#e6b825] text-black font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                                    >
                                        {eventScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarIcon className="w-4 h-4" />}
                                        Schedule Post
                                    </button>
                                    <button
                                        onClick={async () => {
                                            if (!eventPostImageUrl) {
                                                alert('Please wait for image generation to complete');
                                                return;
                                            }
                                            const connectedSelected = eventSelectedPlatform.filter(p =>
                                                followerData.some(f => f.platform.toLowerCase() === p || (p === 'twitter' && f.platform.toLowerCase() === 'x') || (p === 'x' && f.platform.toLowerCase() === 'twitter'))
                                            );
                                            if (connectedSelected.length === 0) {
                                                alert('Please select at least one connected platform');
                                                return;
                                            }
                                            setEventScheduling(true);
                                            try {
                                                const createResult = await apiService.createCampaign({
                                                    name: `${selectedHoliday.name} Post`,
                                                    objective: 'engagement',
                                                    platforms: connectedSelected,
                                                    status: 'draft',
                                                    creative: {
                                                        type: 'image',
                                                        textContent: eventPostCaption,
                                                        imageUrls: eventPostImageUrl ? [eventPostImageUrl] : [],
                                                        captions: eventPostCaption,
                                                        hashtags: eventPostHashtags
                                                    }
                                                });
                                                const campaign = createResult.campaign;
                                                if (campaign?._id) {
                                                    const publishResult = await apiService.publishCampaign(
                                                        campaign._id,
                                                        connectedSelected
                                                    );
                                                    if (publishResult.success) {
                                                        alert('Post published successfully!');
                                                    } else {
                                                        alert(publishResult.message || 'Failed to publish');
                                                    }
                                                }
                                                setShowEventPostCreator(false);
                                                setSelectedHoliday(null);
                                                if (onCampaignCreated) onCampaignCreated();
                                            } catch (error) {
                                                console.error('Failed to post:', error);
                                                alert('Failed to post. Please try again.');
                                            } finally {
                                                setEventScheduling(false);
                                            }
                                        }}
                                        disabled={eventScheduling || !eventPostImageUrl}
                                        className="flex-1 py-3 bg-[#ffcc29] hover:bg-[#e6b825] text-black font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                                    >
                                        {eventScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                        Post Now
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-16">
                                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                                <p className={`text-lg font-medium ${theme.text}`}>Failed to generate post</p>
                                <p className={`text-sm ${theme.textMuted}`}>Please try again</p>
                                <button
                                    onClick={() => { setShowEventPostCreator(false); }}
                                    className="mt-4 px-6 py-2 bg-[#ffcc29] text-black font-semibold rounded-lg"
                                >
                                    Go Back
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Calendar Platform Preview */}
            {showCalendarPreview && (
              <PlatformPreview
                platform={calendarPreviewData.platform}
                imageUrl={calendarPreviewData.imageUrl}
                caption={calendarPreviewData.caption}
                hashtags={calendarPreviewData.hashtags}
                brandName={dashboardData?.businessContext?.name || 'Your Brand'}
                onClose={() => setShowCalendarPreview(false)}
                isDarkMode={isDarkMode}
              />
            )}
        </div>
    );
};

export default Dashboard;