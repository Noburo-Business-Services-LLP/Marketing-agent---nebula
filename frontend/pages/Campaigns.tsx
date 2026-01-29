import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiService } from '../services/api';
import { Campaign } from '../types';
import { Plus, Sparkles, Filter, Loader2, Calendar, BarChart3, Image as ImageIcon, Video, X, ChevronRight, Check, Eye, MousePointer, Archive, Send, Edit3, DollarSign, RefreshCw, Wand2, Instagram, Facebook, Twitter, Linkedin, Youtube, Clock, Heart, MessageCircle, Share2, Zap, Download, FileText, ImageDown, ChevronDown, Trash2 } from 'lucide-react';
import { 
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

// ComboBox component - allows selecting from dropdown OR entering custom value
interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  isDarkMode?: boolean;
}

const ComboBox: React.FC<ComboBoxProps> = ({ value, onChange, options, placeholder, className, isDarkMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Sync inputValue with value prop
  useEffect(() => {
    setInputValue(value);
  }, [value]);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
  };
  
  const handleSelect = (optionValue: string) => {
    setInputValue(optionValue);
    onChange(optionValue);
    setIsOpen(false);
  };
  
  const displayLabel = options.find(o => o.value === value)?.label || value;
  
  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={inputValue === value && options.find(o => o.value === value) ? displayLabel : inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className={className}
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-opacity-10 hover:bg-gray-500 transition-colors ${
            isDarkMode ? 'text-slate-400' : 'text-slate-500'
          }`}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      
      {isOpen && (
        <div className={`absolute z-50 w-full mt-1 rounded-lg shadow-lg border max-h-48 overflow-y-auto ${
          isDarkMode 
            ? 'bg-[#161b22] border-slate-700/50' 
            : 'bg-white border-slate-200'
        }`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                value === option.value
                  ? 'bg-[#ffcc29]/20 text-[#ffcc29]'
                  : isDarkMode
                    ? 'text-slate-300 hover:bg-slate-700'
                    : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {option.label}
            </button>
          ))}
          {inputValue && !options.find(o => o.value === inputValue || o.label.toLowerCase() === inputValue.toLowerCase()) && (
            <div className={`px-3 py-2 text-xs border-t ${
              isDarkMode ? 'text-slate-500 border-slate-700' : 'text-slate-400 border-slate-200'
            }`}>
              ✨ Using custom value: "{inputValue}"
            </div>
          )}
        </div>
      )}
    </div>
  );
};

type TabView = 'suggestions' | 'all' | 'draft' | 'posted' | 'archived';

interface SuggestedCampaign {
    id: string;
    title: string;
    caption: string;
    imageUrl: string;
    platform: string;
    objective: string;
    hashtags: string[];
    bestTime: string;
    estimatedReach: string;
}

const Campaigns: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabView>('suggestions');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [suggestedCampaigns, setSuggestedCampaigns] = useState<SuggestedCampaign[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [editingCampaign, setEditingCampaign] = useState<SuggestedCampaign | null>(null);
  const [regenerationCount, setRegenerationCount] = useState(0);
  const [streamingProgress, setStreamingProgress] = useState<{ current: number; total: number } | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [downloadingImage, setDownloadingImage] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [selectedCampaignLoading, setSelectedCampaignLoading] = useState(false);
  
  // Post Modal State
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [postingCampaign, setPostingCampaign] = useState<Campaign | null>(null);
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Schedule Mode State
  const [isScheduleMode, setIsScheduleMode] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  
  // Bulk Selection State
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // Campaign Type Selector State
  const [showCampaignTypeSelector, setShowCampaignTypeSelector] = useState(false);
  const [isTemplatePosterModalOpen, setIsTemplatePosterModalOpen] = useState(false);

  // Toggle campaign selection
  const toggleCampaignSelection = (campaignId: string) => {
    setSelectedCampaignIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(campaignId)) {
        newSet.delete(campaignId);
      } else {
        newSet.add(campaignId);
      }
      return newSet;
    });
  };

  // Select all campaigns
  const selectAllCampaigns = () => {
    if (selectedCampaignIds.size === campaigns.length) {
      setSelectedCampaignIds(new Set());
    } else {
      setSelectedCampaignIds(new Set(campaigns.map(c => c._id)));
    }
  };

  // Bulk delete selected campaigns
  const deleteSelectedCampaigns = async () => {
    if (selectedCampaignIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedCampaignIds.size} campaign(s)? This action cannot be undone.`)) return;
    
    setIsDeleting(true);
    try {
      await Promise.all(Array.from(selectedCampaignIds).map(id => apiService.deleteCampaign(id)));
      setCampaigns(prev => prev.filter(c => !selectedCampaignIds.has(c._id)));
      setSelectedCampaignIds(new Set());
    } catch (error) {
      console.error('Failed to delete campaigns:', error);
      alert('Failed to delete some campaigns. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Load connected platforms
  useEffect(() => {
    const loadConnectedPlatforms = async () => {
      try {
        const res = await apiService.getSocials();
        const connected = (res.connections || [])
          .filter((c: any) => c.connected)
          .map((c: any) => c.platform.toLowerCase());
        setConnectedPlatforms(connected);
      } catch (e) {
        console.error('Failed to load socials:', e);
      }
    };
    loadConnectedPlatforms();
  }, []);

  // Open post modal for a campaign
  const openPostModal = (campaign: Campaign) => {
    setPostingCampaign(campaign);
    // Pre-select connected platforms that match the campaign's platform
    const campaignPlatforms = campaign.platforms?.map(p => p.toLowerCase()) || [];
    const preSelected = connectedPlatforms.filter(p => campaignPlatforms.includes(p));
    setSelectedPlatforms(preSelected.length > 0 ? preSelected : connectedPlatforms.slice(0, 1));
    setPublishResult(null);
    // Reset schedule mode
    setIsScheduleMode(false);
    setScheduleDate('');
    setScheduleTime('');
    setPostModalOpen(true);
  };

  // Handle platform selection toggle
  const togglePlatformSelection = (platform: string) => {
    if (!connectedPlatforms.includes(platform.toLowerCase())) return; // Can't select unconnected
    setSelectedPlatforms(prev => 
      prev.includes(platform.toLowerCase())
        ? prev.filter(p => p !== platform.toLowerCase())
        : [...prev, platform.toLowerCase()]
    );
  };

  // Handle publish (immediate or scheduled)
  const handlePublish = async () => {
    if (!postingCampaign || selectedPlatforms.length === 0) return;
    
    // Validate schedule date/time if scheduling
    if (isScheduleMode) {
      if (!scheduleDate || !scheduleTime) {
        setPublishResult({ success: false, message: 'Please select a date and time for scheduling' });
        return;
      }
      const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`);
      if (scheduledDateTime <= new Date()) {
        setPublishResult({ success: false, message: 'Scheduled time must be in the future' });
        return;
      }
    }
    
    setIsPublishing(true);
    setPublishResult(null);
    
    try {
      // Build schedule date ISO string if scheduling
      const scheduledFor = isScheduleMode 
        ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
        : undefined;
      
      const result = await apiService.publishCampaign(postingCampaign._id, selectedPlatforms, scheduledFor);
      
      if (result.success) {
        const successMessage = isScheduleMode 
          ? `Scheduled for ${new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString()} on ${selectedPlatforms.join(', ')}!`
          : `Posted successfully to ${selectedPlatforms.join(', ')}!`;
        setPublishResult({ success: true, message: successMessage });
        // Update campaign status in local state
        setCampaigns(prev => prev.map(c => 
          c._id === postingCampaign._id ? { ...c, status: isScheduleMode ? 'scheduled' : 'posted' } : c
        ));
        // Close modal after success
        setTimeout(() => {
          setPostModalOpen(false);
          setPostingCampaign(null);
        }, 2000);
      } else {
        setPublishResult({ success: false, message: result.message || 'Failed to post. Please try again.' });
      }
    } catch (error: any) {
      setPublishResult({ success: false, message: error.message || 'Failed to post. Please try again.' });
    } finally {
      setIsPublishing(false);
    }
  };

  // Handle selected campaign from URL query param (from notification click)
  useEffect(() => {
    const selectedId = searchParams.get('selected');
    if (selectedId && !selectedCampaign) {
      setSelectedCampaignLoading(true);
      // Try to find in existing campaigns first
      const found = campaigns.find(c => c._id === selectedId);
      if (found) {
        setSelectedCampaign(found);
        setSelectedCampaignLoading(false);
      } else {
        // Fetch from API if not in local state
        apiService.getCampaign(selectedId)
          .then(response => {
            setSelectedCampaign(response.campaign);
          })
          .catch(err => {
            console.error('Failed to load campaign:', err);
          })
          .finally(() => {
            setSelectedCampaignLoading(false);
          });
      }
    }
  }, [searchParams, campaigns]);

  const closeSelectedCampaign = () => {
    setSelectedCampaign(null);
    setSearchParams(prev => {
      prev.delete('selected');
      return prev;
    });
  };

  // Use ref to track if we loaded from cache (avoids race condition)
  const loadedFromCacheRef = useRef(false);
  const initialLoadDoneRef = useRef(false);

  // Load cached campaigns from localStorage on mount - BEFORE any other effects
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    
    const cachedCampaigns = localStorage.getItem('nebula_suggested_campaigns');
    if (cachedCampaigns) {
      try {
        const parsed = JSON.parse(cachedCampaigns);
        if (parsed.campaigns && parsed.campaigns.length > 0) {
          // Check if cache is less than 2 hours old
          const cacheAge = Date.now() - (parsed.timestamp || 0);
          if (cacheAge < 2 * 60 * 60 * 1000) { // 2 hours
            console.log('✅ Loading campaigns from cache (age:', Math.round(cacheAge / 60000), 'minutes)');
            setSuggestedCampaigns(parsed.campaigns);
            setLoadingSuggestions(false);
            setIsCached(true);
            loadedFromCacheRef.current = true;
            return;
          } else {
            console.log('⏰ Cache expired, will regenerate');
          }
        }
      } catch (e) {
        console.log('Could not parse cached campaigns');
      }
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'suggestions') {
      // Skip if we already loaded from cache
      if (loadedFromCacheRef.current) {
        console.log('✅ Using cached campaigns, skipping generation');
        loadedFromCacheRef.current = false; // Reset for next tab switch
        setLoadingSuggestions(false);
        return;
      }
      // Only generate if no campaigns exist in state
      if (suggestedCampaigns.length === 0) {
        generateSuggestions();
      } else {
        console.log('✅ Campaigns already in state, skipping generation');
        setLoadingSuggestions(false);
      }
    } else {
      loadCampaigns();
    }
  }, [activeTab]);

  // Save campaigns to localStorage whenever they change (without base64 images to avoid quota issues)
  useEffect(() => {
    if (suggestedCampaigns.length > 0) {
      try {
        // Strip base64 images to avoid localStorage quota exceeded
        const campaignsForCache = suggestedCampaigns.map(campaign => ({
          ...campaign,
          // Replace base64 images with placeholder - they'll be regenerated on next load
          imageUrl: campaign.imageUrl?.startsWith('data:') 
            ? 'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop' 
            : campaign.imageUrl
        }));
        localStorage.setItem('nebula_suggested_campaigns', JSON.stringify({
          campaigns: campaignsForCache,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.warn('Failed to cache campaigns to localStorage:', e);
        // Clear cache if quota exceeded
        localStorage.removeItem('nebula_suggested_campaigns');
      }
    }
  }, [suggestedCampaigns]);

  // Generate personalized fallback suggestions based on business profile
  const generatePersonalizedFallback = (profile: any, seed: number = 0): SuggestedCampaign[] => {
    const {
      name = 'Your Brand',
      industry = 'Business',
      niche = '',
      businessType = 'B2C',
      targetAudience = 'customers',
      brandVoice = 'Professional',
      marketingGoals = ['Awareness']
    } = profile || {};
    
    const industryImages: Record<string, string[]> = {
      'Startup': [
        'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1531545514256-b1400bc00f31?w=800&h=600&fit=crop'
      ],
      'Education': [
        'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop'
      ],
      'Edtech': [
        'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop'
      ],
      'Ecommerce': [
        'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&h=600&fit=crop'
      ],
      'SaaS': [
        'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=800&h=600&fit=crop'
      ],
      'Service': [
        'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop'
      ],
      'Technology': [
        'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1488229297570-58520851e868?w=800&h=600&fit=crop'
      ],
      'default': [
        'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop'
      ]
    };
    
    // Check if this is a startup/accelerator/incubator business based on niche
    const nicheLC = (niche || '').toLowerCase();
    const isStartupAccelerator = nicheLC.includes('startup') || nicheLC.includes('accelerator') || nicheLC.includes('incubator') || nicheLC.includes('entrepreneurship') || nicheLC.includes('bootcamp');
    
    // Use startup images if it's a startup accelerator
    const images = isStartupAccelerator 
      ? industryImages['Startup'] 
      : (industryImages[industry] || industryImages['default']);
    
    const voiceTones: Record<string, { emoji: string; style: string }> = {
      'Professional': { emoji: '📈', style: 'formal and trustworthy' },
      'Witty': { emoji: '😎', style: 'fun and clever' },
      'Empathetic': { emoji: '💫', style: 'warm and caring' },
      'Bold': { emoji: '🔥', style: 'confident and direct' },
      'Educational': { emoji: '💡', style: 'informative and helpful' }
    };
    
    const voice = voiceTones[brandVoice] || voiceTones['Professional'];
    const isB2B = businessType === 'B2B';
    
    // Create a large pool of campaign templates
    const allCampaigns: SuggestedCampaign[] = [
      {
        id: 'fb-1',
        title: `${name} Brand Story`,
        caption: `${voice.emoji} What makes ${name} different?\n\nWe're not just another ${industry.toLowerCase()} company. We're here to ${niche ? `help with ${niche}` : 'make a real difference for ' + targetAudience}.\n\n💬 Tell us what brought you here!`,
        imageUrl: images[0],
        platform: 'Instagram',
        objective: 'Awareness',
        hashtags: [`#${name.replace(/\s+/g, '')}`, `#${industry}`, '#BrandStory', '#AboutUs'],
        bestTime: '10:00 AM',
        estimatedReach: '10K - 20K'
      },
      {
        id: 'fb-2',
        title: `Value for ${targetAudience}`,
        caption: isB2B 
          ? `🎯 3 ways ${name} helps businesses grow:\n\n1️⃣ Streamlined operations\n2️⃣ Data-driven insights\n3️⃣ Expert support\n\n📊 See real results – link in bio!`
          : `✨ Why ${targetAudience || 'our customers'} love ${name}:\n\n💜 Quality you can trust\n💜 Service that cares\n💜 Results that show\n\n👇 Share your experience!`,
        imageUrl: images[1],
        platform: isB2B ? 'LinkedIn' : 'Instagram',
        objective: marketingGoals.includes('Sales') ? 'Sales' : 'Engagement',
        hashtags: isB2B ? ['#B2B', '#BusinessGrowth', '#Success', '#Enterprise'] : ['#CustomerLove', '#Reviews', '#Community', '#Testimonial'],
        bestTime: isB2B ? '9:00 AM' : '7:00 PM',
        estimatedReach: isB2B ? '5K - 12K' : '12K - 25K'
      },
      {
        id: 'fb-3',
        title: `Behind the Scenes at ${name}`,
        caption: `🎬 Ever wonder what happens behind the scenes?\n\nHere's a sneak peek into how we ${niche || 'create value for you'}!\n\n${voice.emoji} Our team works hard to bring you the best in ${industry.toLowerCase()}.\n\n💬 Drop a comment if you want to see more!`,
        imageUrl: images[2] || images[0],
        platform: 'YouTube',
        objective: 'Engagement',
        hashtags: ['#BehindTheScenes', '#BTS', `#${industry}Life`, '#TeamWork'],
        bestTime: '12:00 PM',
        estimatedReach: '15K - 30K'
      },
      {
        id: 'fb-4',
        title: `${industry} Tips & Insights`,
        caption: `💡 PRO TIP: 3 things every ${targetAudience || 'person'} should know about ${industry.toLowerCase()}:\n\n1️⃣ Quality matters more than price\n2️⃣ Research before you commit\n3️⃣ Trust proven expertise (like ${name}!)\n\n📌 Save this for later!`,
        imageUrl: industryImages['default'][2],
        platform: isB2B ? 'LinkedIn' : 'Twitter',
        objective: 'Authority',
        hashtags: [`#${industry}Tips`, '#ProTip', '#ExpertAdvice', '#KnowledgeIsPower'],
        bestTime: '8:00 AM',
        estimatedReach: '8K - 15K'
      },
      {
        id: 'fb-5',
        title: `Limited Time Offer`,
        caption: `🔥 SPECIAL OFFER for our amazing ${targetAudience || 'followers'}!\n\n${voice.emoji} For a limited time, get exclusive access to our best ${industry.toLowerCase()} solutions.\n\n⏰ Don't wait – this won't last long!\n\n👆 Link in bio`,
        imageUrl: 'https://images.unsplash.com/photo-1607082350899-7e105aa886ae?w=800&h=600&fit=crop',
        platform: 'Instagram',
        objective: 'Sales',
        hashtags: ['#LimitedOffer', '#SpecialDeal', '#DontMissOut', `#${name.replace(/\s+/g, '')}`],
        bestTime: '6:00 PM',
        estimatedReach: '20K - 35K'
      },
      {
        id: 'fb-6',
        title: `Community Question`,
        caption: `🤔 We want to hear from YOU!\n\nWhat's your biggest challenge when it comes to ${niche || industry.toLowerCase()}?\n\nA) Finding the right solution\nB) Budget constraints\nC) Time management\nD) Something else (tell us!)\n\n👇 Vote below!`,
        imageUrl: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&h=600&fit=crop',
        platform: 'Twitter',
        objective: 'Engagement',
        hashtags: ['#Poll', '#Community', '#WeWantToKnow', `#${industry}`],
        bestTime: '3:00 PM',
        estimatedReach: '10K - 18K'
      },
      {
        id: 'fb-7',
        title: `Meet the Team`,
        caption: `👋 Meet the faces behind ${name}!\n\nOur passionate team is dedicated to delivering the best ${industry.toLowerCase()} experience for ${targetAudience}.\n\n🌟 Every success starts with great people.\n\n💬 Who would you like to know more about?`,
        imageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
        platform: 'LinkedIn',
        objective: 'Trust',
        hashtags: ['#MeetTheTeam', '#TeamSpotlight', `#${name.replace(/\s+/g, '')}Team`, '#WeAreFamily'],
        bestTime: '11:00 AM',
        estimatedReach: '12K - 22K'
      },
      {
        id: 'fb-8',
        title: `${name} Milestone`,
        caption: `🎉 Big news! ${name} has just hit an amazing milestone!\n\n${voice.emoji} Thank you to everyone who made this possible – our incredible ${targetAudience} and our dedicated team.\n\nHere's to even bigger things ahead! 🚀\n\n#Grateful`,
        imageUrl: 'https://images.unsplash.com/photo-1533750349088-cd871a92f312?w=800&h=600&fit=crop',
        platform: 'Instagram',
        objective: 'Engagement',
        hashtags: ['#Milestone', '#Celebration', `#${name.replace(/\s+/g, '')}`, '#ThankYou'],
        bestTime: '2:00 PM',
        estimatedReach: '18K - 30K'
      },
      {
        id: 'fb-9',
        title: `How It Works`,
        caption: `🔍 Ever wondered how ${name} works?\n\nStep 1️⃣: ${isB2B ? 'Contact us' : 'Browse our offerings'}\nStep 2️⃣: ${isB2B ? 'Get a custom solution' : 'Choose what fits you'}\nStep 3️⃣: ${isB2B ? 'See measurable results' : 'Enjoy the experience!'}\n\n👆 Ready to start? Link in bio!`,
        imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
        platform: isB2B ? 'LinkedIn' : 'Instagram',
        objective: 'Traffic',
        hashtags: ['#HowItWorks', '#Tutorial', `#${industry}`, '#GetStarted'],
        bestTime: '10:00 AM',
        estimatedReach: '14K - 25K'
      },
      {
        id: 'fb-10',
        title: `Weekend Special`,
        caption: `☀️ Weekend vibes + Special deals = Perfect combo!\n\nTreat yourself this weekend with exclusive offers from ${name}.\n\n🏷️ Use code WEEKEND${new Date().getDate()} for a special surprise!\n\n⏰ Valid through Sunday!`,
        imageUrl: 'https://images.unsplash.com/photo-1557821552-17105176677c?w=800&h=600&fit=crop',
        platform: 'Instagram',
        objective: 'Sales',
        hashtags: ['#WeekendDeal', '#WeekendVibes', '#TreatYourself', `#${name.replace(/\s+/g, '')}`],
        bestTime: '5:00 PM',
        estimatedReach: '25K - 40K'
      },
      {
        id: 'fb-11',
        title: `Customer Spotlight`,
        caption: `🌟 CUSTOMER SPOTLIGHT 🌟\n\n"${name} has completely transformed how I approach ${niche || industry.toLowerCase()}!" - Happy Customer\n\n📸 Want to be featured? Share your story with us!\n\n#CustomerSuccess`,
        imageUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&h=600&fit=crop',
        platform: 'Facebook',
        objective: 'Trust',
        hashtags: ['#CustomerSpotlight', '#Testimonial', '#RealStories', `#${name.replace(/\s+/g, '')}Love`],
        bestTime: '1:00 PM',
        estimatedReach: '9K - 16K'
      },
      {
        id: 'fb-12',
        title: `Did You Know?`,
        caption: `🧠 Did you know?\n\n${industry === 'Technology' ? 'The average person checks their phone 96 times a day!' : industry === 'Ecommerce' ? '70% of shopping carts are abandoned before checkout!' : `Most ${targetAudience} make decisions in under 7 seconds!`}\n\nThat's why ${name} focuses on ${niche || 'making things simple for you'}.\n\n💬 Drop a 🤯 if this surprised you!`,
        imageUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&h=600&fit=crop',
        platform: 'Twitter',
        objective: 'Engagement',
        hashtags: ['#DidYouKnow', '#FunFact', `#${industry}Facts`, '#LearnSomethingNew'],
        bestTime: '4:00 PM',
        estimatedReach: '11K - 19K'
      }
    ];
    
    // Shuffle based on seed for variety on regenerate
    const shuffled = [...allCampaigns].sort(() => {
      const rand = Math.sin(seed * 9999) * 10000;
      return rand - Math.floor(rand);
    });
    
    // Add unique ids based on seed to force re-render
    return shuffled.slice(0, 6).map((camp, idx) => ({
      ...camp,
      id: `${camp.id}-${seed}-${idx}`
    }));
  };

  // Progressive streaming generation - campaigns appear one by one
  const generateSuggestionsStreaming = useCallback(async (forceRefresh: boolean = false) => {
    setLoadingSuggestions(true);
    setSuggestedCampaigns([]);
    setStreamingProgress({ current: 0, total: 6 });
    setIsCached(false);
    
    try {
      // Use streaming endpoint for progressive loading
      const cleanup = apiService.streamCampaignSuggestions(
        6, // count
        forceRefresh, // force refresh
        // On each campaign received
        (campaign, index, total, cached) => {
          const transformed: SuggestedCampaign = {
            id: campaign.id || `ai-${index}-${regenerationCount}`,
            title: campaign.name || campaign.title || 'Campaign Idea',
            caption: campaign.caption || campaign.description || 'AI-generated campaign content',
            imageUrl: campaign.imageUrl || getImageForObjective(campaign.objective || 'awareness'),
            platform: capitalizeFirst(campaign.platforms?.[0] || campaign.platform || 'Instagram'),
            objective: capitalizeFirst(campaign.objective || 'Awareness'),
            hashtags: campaign.hashtags || ['#Marketing', '#Growth'],
            bestTime: campaign.bestPostTime || '10:00 AM',
            estimatedReach: campaign.estimatedReach || campaign.expectedReach || '10K - 25K'
          };
          
          setSuggestedCampaigns(prev => [...prev, transformed]);
          setStreamingProgress({ current: index + 1, total });
          setIsCached(cached);
        },
        // On complete
        (total) => {
          setLoadingSuggestions(false);
          setStreamingProgress(null);
        },
        // On error - fallback to regular API
        async (error) => {
          console.log('Streaming failed, falling back to regular API:', error);
          await generateSuggestionsFallback(forceRefresh);
        }
      );
      
      // Store cleanup for component unmount
      return cleanup;
    } catch (error) {
      console.log('Streaming setup failed:', error);
      await generateSuggestionsFallback(forceRefresh);
    }
  }, [regenerationCount]);
  
  // Fallback non-streaming generation
  const generateSuggestionsFallback = async (forceRefresh: boolean = false) => {
    setLoadingSuggestions(true);
    
    let userProfile: any = null;
    try {
      const { user } = await apiService.getCurrentUser();
      userProfile = user?.businessProfile;
    } catch (err) {
      console.log('Could not fetch user profile for personalization');
    }
    
    try {
      const response = await apiService.getCampaignSuggestions(6, forceRefresh);
      setIsCached(response.cached || false);
      
      if (response.campaigns && response.campaigns.length > 0) {
        const aiSuggestions: SuggestedCampaign[] = response.campaigns.map((camp: any, index: number) => ({
          id: camp.id || `ai-${index}-${regenerationCount}`,
          title: camp.name || camp.title || 'Campaign Idea',
          caption: camp.caption || camp.description || camp.contentIdeas?.join('\n\n') || 'AI-generated campaign content',
          imageUrl: camp.imageUrl || getImageForObjective(camp.objective || 'awareness'),
          platform: capitalizeFirst(camp.platforms?.[0] || 'Instagram'),
          objective: capitalizeFirst(camp.objective || 'Awareness'),
          hashtags: camp.hashtags || camp.keyMessages?.map((m: string) => `#${m.replace(/\s+/g, '')}`) || ['#Marketing', '#Growth'],
          bestTime: camp.bestPostTime || '10:00 AM',
          estimatedReach: camp.expectedReach || camp.expectedResults || '10K - 25K'
        }));
        setSuggestedCampaigns(aiSuggestions);
        setLoadingSuggestions(false);
        return;
      }
    } catch (error) {
      console.log('AI suggestions not available, using personalized fallback:', error);
    }
    
    const suggestions = generatePersonalizedFallback(userProfile, regenerationCount);
    await new Promise(r => setTimeout(r, 500));
    setSuggestedCampaigns(suggestions);
    setLoadingSuggestions(false);
  };
  
  // Main generate suggestions - uses streaming
  const generateSuggestions = () => {
    generateSuggestionsStreaming(false);
  };
  
  // Handle regenerate - forces new generation and clears cache
  const handleRegenerate = () => {
    // Clear localStorage cache to force fresh generation
    localStorage.removeItem('nebula_suggested_campaigns');
    setRegenerationCount(prev => prev + 1);
    generateSuggestionsStreaming(true);
  };

  // Download image
  const handleDownloadImage = async (suggestion: SuggestedCampaign) => {
    setDownloadingImage(suggestion.id);
    try {
      const response = await fetch(suggestion.imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${suggestion.title.replace(/\s+/g, '-').toLowerCase()}-image.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download image:', error);
      // Fallback: open image in new tab
      window.open(suggestion.imageUrl, '_blank');
    }
    setDownloadingImage(null);
  };

  // Download text content (caption + hashtags)
  const handleDownloadText = (suggestion: SuggestedCampaign) => {
    const content = `Campaign: ${suggestion.title}
Platform: ${suggestion.platform}
Objective: ${suggestion.objective}
Best Time to Post: ${suggestion.bestTime}
Estimated Reach: ${suggestion.estimatedReach}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CAPTION:
${suggestion.caption}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HASHTAGS:
${suggestion.hashtags.join(' ')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generated by Nebulaa Gravity Marketing Agent
`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${suggestion.title.replace(/\s+/g, '-').toLowerCase()}-content.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // Helper function to get image based on objective
  const getImageForObjective = (objective: string): string => {
    const images: Record<string, string> = {
      awareness: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=600&fit=crop',
      engagement: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
      traffic: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
      sales: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&h=600&fit=crop',
      conversion: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop'
    };
    return images[objective.toLowerCase()] || images.awareness;
  };

  // Helper to capitalize first letter
  const capitalizeFirst = (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const queryStatus = activeTab === 'all' ? undefined : activeTab;
      const response = await apiService.getCampaigns(queryStatus);
      setCampaigns(response.campaigns || []);
    } catch (error) {
      console.error("Failed to fetch campaigns", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCampaignCreated = (newCampaign: Campaign) => {
    setCampaigns([newCampaign, ...campaigns]);
    setIsModalOpen(false);
    setActiveTab('draft');
  };

  const handleUseSuggestion = async (suggestion: SuggestedCampaign) => {
    try {
      const { campaign } = await apiService.createCampaign({
        name: suggestion.title,
        objective: suggestion.objective.toLowerCase() as any,
        platforms: [suggestion.platform.toLowerCase()],
        status: 'draft',
        creative: { 
          type: 'image', 
          textContent: suggestion.caption, 
          imageUrls: [suggestion.imageUrl],
          captions: suggestion.hashtags.join(' ')
        },
        scheduling: { 
          startDate: new Date().toISOString().split('T')[0], 
          postTime: suggestion.bestTime 
        }
      });
      setCampaigns([campaign, ...campaigns]);
      setActiveTab('draft');
    } catch (e) {
      console.error(e);
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch(platform.toLowerCase()) {
      case 'instagram': return <Instagram className="w-4 h-4" />;
      case 'facebook': return <Facebook className="w-4 h-4" />;
      case 'twitter': return <Twitter className="w-4 h-4" />;
      case 'linkedin': return <Linkedin className="w-4 h-4" />;
      case 'youtube': return <Youtube className="w-4 h-4" />;
      default: return <Share2 className="w-4 h-4" />;
    }
  };

  const getPlatformColor = (platform: string) => {
    switch(platform.toLowerCase()) {
      case 'instagram': return 'bg-gradient-to-tr from-yellow-400 via-red-500 to-#ffcc29';
      case 'facebook': return 'bg-[#1877F2]';
      case 'twitter': return 'bg-[#1DA1F2]';
      case 'linkedin': return 'bg-[#0A66C2]';
      case 'youtube': return 'bg-[#FF0000]';
      default: return 'bg-#f5f5f50';
    }
  };

  const renderContent = () => {
    if (activeTab === 'suggestions') {
      return (
        <div className="space-y-6 animate-in fade-in duration-500">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-[#ffcc29] to-[#ffcc29]/80 rounded-xl text-black">
                <Wand2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className={`text-lg font-bold ${theme.text}`}>AI-Generated Campaign Ideas</h2>
                <p className={`text-sm ${theme.textSecondary}`}>Tailored suggestions based on your industry and goals</p>
              </div>
            </div>
            <button 
              onClick={handleRegenerate}
              disabled={loadingSuggestions}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                isDarkMode 
                  ? 'bg-[#0f1419] hover:bg-[#ffcc29]/10 text-white' 
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${loadingSuggestions ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
          </div>

          {loadingSuggestions && suggestedCampaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative">
                <Sparkles className="w-12 h-12 text-[#ffcc29] animate-pulse" />
                <div className="absolute inset-0 w-12 h-12 border-4 border-[#ffcc29]/30 border-t-[#ffcc29] rounded-full animate-spin"></div>
              </div>
              <p className={`mt-4 font-medium ${theme.text}`}>Generating personalized campaigns...</p>
              <p className={`text-sm ${theme.textSecondary}`}>Our AI is crafting the perfect content for you</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {suggestedCampaigns.map((suggestion, idx) => (
                <div 
                  key={suggestion.id} 
                  className={`rounded-xl shadow-sm border overflow-hidden group hover:shadow-lg transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 ${theme.bgCard} ${
                    isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-slate-200 hover:border-[#ffcc29]/30'
                  }`}
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  {/* Image */}
                  <div className="relative h-48 overflow-hidden">
                    <img 
                      src={suggestion.imageUrl} 
                      alt={suggestion.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    {/* Overlay with actions on hover */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-4 gap-2">
                      <button 
                        onClick={() => setEditingCampaign(suggestion)}
                        className="px-3 py-2 bg-white text-slate-800 rounded-lg font-semibold text-sm flex items-center gap-1.5 hover:bg-slate-100 transition-colors shadow-lg"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button 
                        onClick={() => handleUseSuggestion(suggestion)}
                        className="px-3 py-2 bg-[#ffcc29] text-black rounded-lg font-semibold text-sm flex items-center gap-1.5 hover:bg-[#e6b825] transition-colors shadow-lg"
                      >
                        <Send className="w-3.5 h-3.5" /> Use
                      </button>
                    </div>
                    {/* Platform badge */}
                    <div className={`absolute top-3 left-3 ${getPlatformColor(suggestion.platform)} text-white px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5`}>
                      {getPlatformIcon(suggestion.platform)}
                      {suggestion.platform}
                    </div>
                    {/* Objective badge */}
                    <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs font-bold text-slate-800">
                      {suggestion.objective}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <h3 className={`font-bold mb-2 ${theme.text}`}>{suggestion.title}</h3>
                    <p className={`text-sm line-clamp-3 mb-3 whitespace-pre-line ${theme.textSecondary}`}>{suggestion.caption}</p>
                    
                    {/* Hashtags */}
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {suggestion.hashtags.slice(0, 3).map((tag, i) => (
                        <span key={i} className="text-xs bg-[#ffcc29]/20 text-[#ffcc29] px-2 py-0.5 rounded-full">
                          {tag}
                        </span>
                      ))}
                      {suggestion.hashtags.length > 3 && (
                        <span className={`text-xs ${theme.textSecondary}`}>+{suggestion.hashtags.length - 3}</span>
                      )}
                    </div>

                    {/* Stats */}
                    <div className={`flex items-center justify-between text-xs pt-3 border-t ${theme.textSecondary} ${
                      isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
                    }`}>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Best at {suggestion.bestTime}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        <span>{suggestion.estimatedReach}</span>
                      </div>
                    </div>

                    {/* Download Buttons */}
                    <div className={`flex items-center gap-2 mt-3 pt-3 border-t ${
                      isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
                    }`}>
                      <button
                        onClick={() => handleDownloadImage(suggestion)}
                        disabled={downloadingImage === suggestion.id}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          isDarkMode 
                            ? 'bg-slate-800 hover:bg-slate-700 text-white' 
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        } ${downloadingImage === suggestion.id ? 'opacity-50 cursor-wait' : ''}`}
                      >
                        {downloadingImage === suggestion.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ImageDown className="w-3.5 h-3.5" />
                        )}
                        Image
                      </button>
                      <button
                        onClick={() => handleDownloadText(suggestion)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                          isDarkMode 
                            ? 'bg-slate-800 hover:bg-slate-700 text-white' 
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Text
                      </button>
                      <button
                        onClick={() => {
                          handleDownloadImage(suggestion);
                          handleDownloadText(suggestion);
                        }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[#ffcc29] text-black hover:bg-[#e6b825] transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        All
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Placeholder cards while streaming */}
              {loadingSuggestions && suggestedCampaigns.length > 0 && (
                Array.from({ length: Math.max(0, 6 - suggestedCampaigns.length) }).map((_, i) => (
                  <div 
                    key={`placeholder-${i}`}
                    className={`rounded-xl border overflow-hidden animate-pulse ${theme.bgCard} ${
                      isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
                    }`}
                  >
                    <div className="h-48 bg-slate-300 dark:bg-slate-700" />
                    <div className="p-4 space-y-3">
                      <div className="h-4 bg-slate-300 dark:bg-slate-700 rounded w-3/4" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-full" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-5/6" />
                      <div className="flex gap-2">
                        <div className="h-5 w-16 bg-slate-200 dark:bg-slate-800 rounded-full" />
                        <div className="h-5 w-16 bg-slate-200 dark:bg-slate-800 rounded-full" />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex justify-center py-20">
          <Loader2 className="w-10 h-10 text-[#ffcc29] animate-spin" />
        </div>
      );
    }

    if (campaigns.length === 0) {
      return (
        <div className={`text-center py-20 rounded-xl border border-dashed ${theme.bgCard} ${
          isDarkMode ? 'border-slate-700/50' : 'border-slate-300'
        }`}>
          <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
            isDarkMode ? 'bg-slate-800' : 'bg-slate-100'
          }`}>
            <Filter className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className={`text-lg font-bold ${theme.text}`}>No campaigns found</h3>
          <p className={`${theme.textSecondary} mb-6`}>There are no campaigns in this view.</p>
          <button onClick={() => setActiveTab('suggestions')} className="text-[#ffcc29] font-bold hover:underline">
            View AI Suggestions
          </button>
        </div>
      );
    }

    const handleDeleteCampaign = async (campaignId: string) => {
      if (!confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) return;
      try {
        await apiService.deleteCampaign(campaignId);
        setCampaigns(prev => prev.filter(c => c._id !== campaignId));
        setSelectedCampaignIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(campaignId);
          return newSet;
        });
      } catch (error) {
        console.error('Failed to delete campaign:', error);
        alert('Failed to delete campaign. Please try again.');
      }
    };

    return (
      <div>
        {/* Bulk Action Bar */}
        <div className={`mb-4 p-3 rounded-lg flex items-center justify-between ${
          isDarkMode ? 'bg-[#161b22] border border-slate-700/50' : 'bg-slate-50 border border-slate-200'
        }`}>
          <div className="flex items-center gap-3">
            <button
              onClick={selectAllCampaigns}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedCampaignIds.size === campaigns.length && campaigns.length > 0
                  ? 'bg-[#ffcc29] text-black'
                  : isDarkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                selectedCampaignIds.size === campaigns.length && campaigns.length > 0
                  ? 'bg-black border-black'
                  : selectedCampaignIds.size > 0
                    ? 'bg-[#ffcc29] border-[#ffcc29]'
                    : isDarkMode ? 'border-slate-500' : 'border-slate-400'
              }`}>
                {(selectedCampaignIds.size === campaigns.length && campaigns.length > 0) && <Check className="w-3 h-3 text-[#ffcc29]" />}
                {(selectedCampaignIds.size > 0 && selectedCampaignIds.size < campaigns.length) && <div className="w-2 h-0.5 bg-black" />}
              </div>
              {selectedCampaignIds.size === campaigns.length && campaigns.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
            
            {selectedCampaignIds.size > 0 && (
              <span className={`text-sm ${theme.textSecondary}`}>
                {selectedCampaignIds.size} of {campaigns.length} selected
              </span>
            )}
          </div>
          
          {selectedCampaignIds.size > 0 && (
            <button
              onClick={deleteSelectedCampaigns}
              disabled={isDeleting}
              className="flex items-center gap-2 px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete Selected ({selectedCampaignIds.size})
            </button>
          )}
        </div>
        
        {/* Campaigns Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => (
            <CampaignCard 
              key={campaign._id} 
              campaign={campaign} 
              isDarkMode={isDarkMode} 
              theme={theme} 
              onPost={openPostModal} 
              onDelete={handleDeleteCampaign}
              isSelected={selectedCampaignIds.has(campaign._id)}
              onToggleSelect={toggleCampaignSelection}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className={`text-2xl font-bold ${theme.text}`}>Campaign Manager</h1>
          <p className={theme.textSecondary}>Plan, execute, and analyze your marketing efforts.</p>
        </div>
        
        {/* New Campaign Button with Type Selector */}
        <div className="relative">
          <button 
            onClick={() => setShowCampaignTypeSelector(!showCampaignTypeSelector)}
            className="flex items-center justify-center gap-2 bg-[#ffcc29] hover:bg-[#ffcc29]/80 text-black px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5" />
            New Campaign
            <ChevronDown className={`w-4 h-4 transition-transform ${showCampaignTypeSelector ? 'rotate-180' : ''}`} />
          </button>
          
          {/* Campaign Type Dropdown */}
          {showCampaignTypeSelector && (
            <div 
              className={`absolute right-0 top-full mt-2 w-72 rounded-xl shadow-xl border overflow-hidden z-50 ${
                isDarkMode ? 'bg-[#161b22] border-slate-700' : 'bg-white border-slate-200'
              }`}
            >
              {/* AI Campaign Option */}
              <button
                onClick={() => {
                  setShowCampaignTypeSelector(false);
                  setIsModalOpen(true);
                }}
                className={`w-full p-4 text-left transition-colors flex items-start gap-3 ${
                  isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-50'
                }`}
              >
                <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg shrink-0">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className={`font-semibold ${theme.text}`}>AI Campaign</h4>
                  <p className={`text-xs ${theme.textSecondary} mt-0.5`}>
                    AI generates complete campaign with images and captions
                  </p>
                </div>
              </button>
              
              <div className={`border-t ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`} />
              
              {/* Template Poster Option */}
              <button
                onClick={() => {
                  setShowCampaignTypeSelector(false);
                  setIsTemplatePosterModalOpen(true);
                }}
                className={`w-full p-4 text-left transition-colors flex items-start gap-3 ${
                  isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-50'
                }`}
              >
                <div className="p-2 bg-gradient-to-br from-[#ffcc29] to-[#ffa500] rounded-lg shrink-0">
                  <ImageIcon className="w-5 h-5 text-black" />
                </div>
                <div>
                  <h4 className={`font-semibold ${theme.text}`}>Template Poster</h4>
                  <p className={`text-xs ${theme.textSecondary} mt-0.5`}>
                    Upload your template & content, AI creates the poster
                  </p>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Click outside to close dropdown */}
      {showCampaignTypeSelector && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setShowCampaignTypeSelector(false)}
        />
      )}

      {/* Tabs */}
      <div className={`border-b mb-8 overflow-x-auto ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
        <div className="flex space-x-6 min-w-max">
          {[
            { id: 'suggestions', label: 'AI Suggestions', icon: Sparkles },
            { id: 'all', label: 'All Campaigns', icon: null },
            { id: 'draft', label: 'Drafts', icon: null },
            { id: 'posted', label: 'Posted', icon: null },
            { id: 'archived', label: 'Archived', icon: null }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabView)}
              className={`pb-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === tab.id 
                  ? 'border-[#ffcc29] text-[#ffcc29]' 
                  : `border-transparent ${theme.textSecondary} hover:text-[#ffcc29] hover:border-[#ffcc29]/30`
              }`}
            >
              {tab.icon && <tab.icon className="w-4 h-4" />}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {renderContent()}

      {isModalOpen && (
        <CreateCampaignModal 
          onClose={() => setIsModalOpen(false)} 
          onSuccess={handleCampaignCreated}
          isDarkMode={isDarkMode}
          theme={theme}
        />
      )}

      {isTemplatePosterModalOpen && (
        <TemplatePosterModal
          onClose={() => setIsTemplatePosterModalOpen(false)}
          onSuccess={handleCampaignCreated}
          isDarkMode={isDarkMode}
          theme={theme}
          connectedPlatforms={connectedPlatforms}
        />
      )}

      {editingCampaign && (
        <EditSuggestionModal
          suggestion={editingCampaign}
          onClose={() => setEditingCampaign(null)}
          onSave={(updated) => {
            handleUseSuggestion(updated);
            setEditingCampaign(null);
          }}
          isDarkMode={isDarkMode}
          theme={theme}
        />
      )}

      {/* Campaign Detail Modal (from notification click) */}
      {(selectedCampaign || selectedCampaignLoading) && (
        <CampaignDetailModal
          campaign={selectedCampaign}
          isLoading={selectedCampaignLoading}
          onClose={closeSelectedCampaign}
          isDarkMode={isDarkMode}
          theme={theme}
        />
      )}

      {/* Post to Social Modal */}
      {postModalOpen && postingCampaign && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md rounded-2xl shadow-2xl ${isDarkMode ? 'bg-[#161b22]' : 'bg-white'}`}>
            {/* Header */}
            <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
              <h3 className={`font-bold text-lg ${theme.text}`}>Post to Social Media</h3>
              <button onClick={() => setPostModalOpen(false)} className={`p-1 rounded-lg hover:bg-slate-500/20 ${theme.textSecondary}`}>
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Content Preview */}
            <div className={`p-4 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
              <div className="flex gap-3">
                {postingCampaign.creative?.imageUrls?.[0] && (
                  <img 
                    src={postingCampaign.creative.imageUrls[0]} 
                    alt="" 
                    className="w-16 h-16 rounded-lg object-cover"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <h4 className={`font-semibold truncate ${theme.text}`}>{postingCampaign.name}</h4>
                  <p className={`text-sm line-clamp-2 ${theme.textSecondary}`}>
                    {postingCampaign.creative?.textContent?.substring(0, 100)}...
                  </p>
                </div>
              </div>
            </div>
            
            {/* Platform Selection */}
            <div className="p-4">
              <p className={`text-sm font-medium mb-3 ${theme.text}`}>Select platforms to post:</p>
              <div className="space-y-2">
                {['Instagram', 'Facebook', 'X', 'LinkedIn'].map(platform => {
                  const isConnected = connectedPlatforms.includes(platform.toLowerCase());
                  const isSelected = selectedPlatforms.includes(platform.toLowerCase());
                  
                  return (
                    <button
                      key={platform}
                      onClick={() => togglePlatformSelection(platform)}
                      disabled={!isConnected}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                        !isConnected
                          ? isDarkMode ? 'bg-slate-800/50 border-slate-700/30 opacity-50 cursor-not-allowed' : 'bg-slate-100 border-slate-200 opacity-50 cursor-not-allowed'
                          : isSelected
                            ? 'bg-[#ffcc29]/20 border-[#ffcc29] text-[#ffcc29]'
                            : isDarkMode ? 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {platform === 'Instagram' && <Instagram className="w-5 h-5" />}
                        {platform === 'Facebook' && <Facebook className="w-5 h-5" />}
                        {platform === 'X' && <Twitter className="w-5 h-5" />}
                        {platform === 'LinkedIn' && <Linkedin className="w-5 h-5" />}
                        <span className={`font-medium ${isConnected ? theme.text : theme.textSecondary}`}>{platform}</span>
                      </div>
                      {isConnected ? (
                        isSelected ? (
                          <Check className="w-5 h-5 text-[#ffcc29]" />
                        ) : (
                          <div className={`w-5 h-5 rounded border-2 ${isDarkMode ? 'border-slate-600' : 'border-slate-300'}`} />
                        )
                      ) : (
                        <span className={`text-xs ${theme.textSecondary}`}>Not connected</span>
                      )}
                    </button>
                  );
                })}
              </div>
              
              {connectedPlatforms.length === 0 && (
                <p className={`text-sm text-center mt-4 ${theme.textSecondary}`}>
                  No platforms connected. <a href="/#/connect-socials" className="text-[#ffcc29] hover:underline">Connect now</a>
                </p>
              )}
            </div>
            
            {/* Schedule Toggle */}
            <div className={`px-4 pb-4`}>
              <button
                onClick={() => setIsScheduleMode(!isScheduleMode)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                  isScheduleMode
                    ? 'bg-[#ffcc29]/20 border-[#ffcc29]'
                    : isDarkMode ? 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600' : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Clock className={`w-5 h-5 ${isScheduleMode ? 'text-[#ffcc29]' : theme.textSecondary}`} />
                  <span className={`font-medium ${isScheduleMode ? 'text-[#ffcc29]' : theme.text}`}>Schedule for later</span>
                </div>
                {isScheduleMode ? (
                  <Check className="w-5 h-5 text-[#ffcc29]" />
                ) : (
                  <div className={`w-5 h-5 rounded border-2 ${isDarkMode ? 'border-slate-600' : 'border-slate-300'}`} />
                )}
              </button>
              
              {/* Date/Time Picker */}
              {isScheduleMode && (
                <div className={`mt-3 p-3 rounded-lg border ${isDarkMode ? 'bg-slate-800/50 border-slate-700/50' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`text-xs font-medium ${theme.textSecondary}`}>Date</label>
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${
                          isDarkMode 
                            ? 'bg-slate-900 border-slate-700 text-white' 
                            : 'bg-white border-slate-300 text-slate-900'
                        }`}
                      />
                    </div>
                    <div>
                      <label className={`text-xs font-medium ${theme.textSecondary}`}>Time</label>
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className={`w-full mt-1 px-3 py-2 rounded-lg border text-sm ${
                          isDarkMode 
                            ? 'bg-slate-900 border-slate-700 text-white' 
                            : 'bg-white border-slate-300 text-slate-900'
                        }`}
                      />
                    </div>
                  </div>
                  {scheduleDate && scheduleTime && (
                    <p className={`mt-2 text-xs ${theme.textSecondary}`}>
                      Scheduled for: <span className="font-medium text-[#ffcc29]">
                        {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString()}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
            
            {/* Result Message */}
            {publishResult && (
              <div className={`mx-4 mb-4 p-3 rounded-lg text-sm font-medium ${
                publishResult.success 
                  ? 'bg-green-500/20 text-green-400' 
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {publishResult.message}
              </div>
            )}
            
            {/* Actions */}
            <div className={`p-4 border-t flex gap-3 ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
              <button
                onClick={() => setPostModalOpen(false)}
                className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
                  isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={selectedPlatforms.length === 0 || isPublishing || (isScheduleMode && (!scheduleDate || !scheduleTime))}
                className="flex-1 py-2.5 rounded-lg font-bold bg-[#ffcc29] text-black hover:bg-[#ffcc29]/80 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isScheduleMode ? 'Scheduling...' : 'Posting...'}
                  </>
                ) : isScheduleMode ? (
                  <>
                    <Clock className="w-4 h-4" />
                    Schedule Post
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Post Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Campaign Detail Modal - shown when clicking notification
const CampaignDetailModal: React.FC<{
  campaign: Campaign | null;
  isLoading: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  theme: ReturnType<typeof getThemeClasses>;
}> = ({ campaign, isLoading, onClose, isDarkMode, theme }) => {
  const getPlatformIcon = (platform: string) => {
    const icons: Record<string, React.ReactNode> = {
      instagram: <Instagram className="w-5 h-5 text-pink-500" />,
      facebook: <Facebook className="w-5 h-5 text-blue-600" />,
      twitter: <Twitter className="w-5 h-5 text-sky-500" />,
      linkedin: <Linkedin className="w-5 h-5 text-blue-700" />,
      youtube: <Youtube className="w-5 h-5 text-red-500" />,
    };
    return icons[platform.toLowerCase()] || null;
  };

  const getStatusBadge = (status: string) => {
    const statusStyles: Record<string, string> = {
      draft: 'bg-slate-500/20 text-slate-400',
      scheduled: 'bg-[#ffcc29]/20 text-[#ffcc29]',
      active: 'bg-blue-500/20 text-blue-400',
      posted: 'bg-green-500/20 text-green-400',
      archived: 'bg-slate-500/20 text-slate-500',
      paused: 'bg-orange-500/20 text-orange-400',
    };
    return statusStyles[status] || statusStyles.draft;
  };

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return 'Not set';
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div 
        className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl ${
          isDarkMode ? 'bg-[#0d1117] border border-slate-700/50' : 'bg-white border border-slate-200'
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b ${
          isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#ffcc29]/20 rounded-lg">
              <Calendar className="w-6 h-6 text-[#ffcc29]" />
            </div>
            <div>
              <h2 className={`text-xl font-bold ${theme.text}`}>Campaign Details</h2>
              <p className={`text-sm ${theme.textSecondary}`}>View your scheduled campaign</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'
            }`}
          >
            <X className={`w-5 h-5 ${theme.textSecondary}`} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-[#ffcc29] animate-spin mb-4" />
              <p className={theme.textSecondary}>Loading campaign details...</p>
            </div>
          ) : campaign ? (
            <div className="space-y-6">
              {/* Campaign Name & Status */}
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className={`text-2xl font-bold ${theme.text}`}>{campaign.name}</h3>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${getStatusBadge(campaign.status)}`}>
                    {campaign.status}
                  </span>
                </div>
                {campaign.description && (
                  <p className={theme.textSecondary}>{campaign.description}</p>
                )}
              </div>

              {/* Platforms */}
              <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                <h4 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${theme.textSecondary}`}>
                  Platforms
                </h4>
                <div className="flex flex-wrap gap-3">
                  {campaign.platforms && campaign.platforms.length > 0 ? (
                    campaign.platforms.map((platform) => (
                      <div
                        key={platform}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                          isDarkMode ? 'bg-slate-700' : 'bg-white border border-slate-200'
                        }`}
                      >
                        {getPlatformIcon(platform)}
                        <span className={`text-sm font-medium capitalize ${theme.text}`}>{platform}</span>
                      </div>
                    ))
                  ) : (
                    <p className={theme.textSecondary}>No platforms selected</p>
                  )}
                </div>
              </div>

              {/* Schedule Info */}
              <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                <h4 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${theme.textSecondary}`}>
                  Schedule
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className={`text-xs ${theme.textSecondary} mb-1`}>Start Date</p>
                    <p className={`font-medium ${theme.text}`}>
                      <Clock className="w-4 h-4 inline mr-2 text-[#ffcc29]" />
                      {formatDate(campaign.startDate)}
                    </p>
                  </div>
                  <div>
                    <p className={`text-xs ${theme.textSecondary} mb-1`}>End Date</p>
                    <p className={`font-medium ${theme.text}`}>
                      <Clock className="w-4 h-4 inline mr-2 text-[#ffcc29]" />
                      {formatDate(campaign.endDate)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Content */}
              {campaign.content && (
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                  <h4 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${theme.textSecondary}`}>
                    Content
                  </h4>
                  <p className={`${theme.text} whitespace-pre-wrap`}>{campaign.content}</p>
                </div>
              )}

              {/* Performance (if posted) */}
              {campaign.status === 'posted' && campaign.performance && (
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                  <h4 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${theme.textSecondary}`}>
                    Performance
                  </h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className={`text-2xl font-bold ${theme.text}`}>
                        {campaign.performance.impressions?.toLocaleString() || 0}
                      </p>
                      <p className={`text-xs ${theme.textSecondary}`}>Impressions</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-2xl font-bold ${theme.text}`}>
                        {campaign.performance.clicks?.toLocaleString() || 0}
                      </p>
                      <p className={`text-xs ${theme.textSecondary}`}>Clicks</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-2xl font-bold ${theme.text}`}>
                        ${campaign.performance.spend?.toLocaleString() || 0}
                      </p>
                      <p className={`text-xs ${theme.textSecondary}`}>Spend</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <X className="w-12 h-12 text-red-400 mb-4" />
              <p className={`font-medium ${theme.text}`}>Campaign not found</p>
              <p className={theme.textSecondary}>The campaign may have been deleted.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end p-6 border-t ${
          isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
        }`}>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[#ffcc29] text-black font-medium rounded-lg hover:bg-[#ffcc29]/80 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// --- SUB-COMPONENTS ---

const CampaignCard: React.FC<{ 
  campaign: Campaign; 
  isDarkMode: boolean; 
  theme: ReturnType<typeof getThemeClasses>; 
  onPost?: (campaign: Campaign) => void; 
  onDelete?: (campaignId: string) => void;
  isSelected?: boolean;
  onToggleSelect?: (campaignId: string) => void;
}> = ({ campaign, isDarkMode, theme, onPost, onDelete, isSelected = false, onToggleSelect }) => (
    <div className={`rounded-xl shadow-sm border overflow-hidden hover:shadow-md transition-shadow flex flex-col h-full ${theme.bgCard} ${
      isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
    } ${isSelected ? 'ring-2 ring-[#ffcc29]' : ''}`}>
        <div className={`p-5 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    {/* Selection Checkbox */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleSelect?.(campaign._id); }}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected 
                          ? 'bg-[#ffcc29] border-[#ffcc29]' 
                          : isDarkMode ? 'border-slate-500 hover:border-[#ffcc29]' : 'border-slate-300 hover:border-[#ffcc29]'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-black" />}
                    </button>
                    <h3 className={`font-bold text-sm ${theme.text}`}>{campaign.name}</h3>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                    campaign.status === 'active' ? 'bg-green-500/20 text-green-500' :
                    campaign.status === 'posted' ? 'bg-blue-500/20 text-blue-500' :
                    campaign.status === 'draft' ? 'bg-amber-500/20 text-amber-500' :
                    isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'
                }`}>
                    {campaign.status}
                </span>
            </div>
            <div className={`flex flex-col gap-1 text-xs ${theme.textSecondary} ml-7`}>
                <p>Platform: <span className={`font-medium capitalize ${theme.text}`}>{campaign.platforms[0]}</span></p>
                <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>{campaign.scheduling.startDate} at {campaign.scheduling.postTime}</span>
                </div>
            </div>
        </div>

        {/* Content Preview */}
        <div className="p-5 flex-1">
            <div className={`rounded-lg p-3 mb-4 border h-24 overflow-hidden relative group ${
              isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
            }`}>
                 {campaign.creative.imageUrls?.[0] ? (
                    <div className="flex gap-4 h-full">
                        <img 
                            src={campaign.creative.imageUrls[0]} 
                            alt="Campaign Creative" 
                            className="w-16 h-16 object-cover rounded-md flex-shrink-0"
                        />
                        <p className={`text-xs line-clamp-3 italic ${theme.textSecondary}`}>"{campaign.creative.textContent}"</p>
                    </div>
                ) : (
                    <p className={`text-xs italic ${theme.textSecondary}`}>"{campaign.creative.textContent}"</p>
                )}
            </div>

            {/* Metrics */}
            {campaign.performance && (
                <div className="grid grid-cols-2 gap-4 pt-2">
                    <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">IMPRESSIONS</p>
                        <p className={`text-sm font-bold ${theme.text}`}>{campaign.performance.impressions.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">ENGAGEMENT</p>
                        <p className={`text-sm font-bold ${theme.text}`}>{campaign.performance.engagement.toLocaleString()}</p>
                    </div>
                </div>
            )}
            {!campaign.performance && (
                <div className={`text-center py-2 text-xs text-slate-400 rounded border border-dashed ${
                  isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                }`}>
                    No analytics yet
                </div>
            )}
        </div>

        {/* Action Footer */}
        <div className={`p-3 border-t flex justify-between items-center ${
          isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
        }`}>
            {/* Delete Button - always visible */}
            <button 
              onClick={() => onDelete?.(campaign._id)}
              className={`text-xs font-bold px-2 py-1.5 rounded flex items-center gap-1 transition-colors ${
                isDarkMode ? 'text-red-400 hover:bg-red-500/20' : 'text-red-500 hover:bg-red-50'
              }`}
              title="Delete campaign"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
            
            <div className="flex gap-2">
              {campaign.status === 'draft' && (
                  <button className="text-xs font-bold text-[#ffcc29] px-3 py-1.5 hover:bg-[#ffcc29]/10 rounded border border-transparent hover:border-[#ffcc29]/30 flex items-center gap-1">
                      <Edit3 className="w-3 h-3" /> Edit
                  </button>
              )}
               {campaign.status === 'draft' && (
                  <button 
                    onClick={() => onPost?.(campaign)}
                    className="text-xs font-bold text-black bg-[#ffcc29] px-3 py-1.5 rounded hover:bg-[#ffcc29]/80 flex items-center gap-1"
                  >
                      <Send className="w-3 h-3" /> Post
                  </button>
              )}
              {campaign.status === 'posted' && (
                  <button className={`text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 ${
                    isDarkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-200'
                  }`}>
                      <Archive className="w-3 h-3" /> Archive
                  </button>
              )}
            </div>
        </div>
    </div>
);

// --- COMPREHENSIVE CAMPAIGN CREATION MODAL ---
interface GeneratedPost {
  id: string;
  platform: string;
  caption: string;
  hashtags: string[];
  imageUrl: string;
  suggestedDate: string;
  suggestedTime: string;
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
}

const CreateCampaignModal: React.FC<{ onClose: () => void; onSuccess: (c: Campaign) => void; isDarkMode: boolean; theme: ReturnType<typeof getThemeClasses> }> = ({ onClose, onSuccess, isDarkMode, theme }) => {
    const [step, setStep] = useState(1);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([]);
    const [editingPostId, setEditingPostId] = useState<string | null>(null);
    const [savingPosts, setSavingPosts] = useState(false);
    
    // Step 1: Campaign Details
    const [campaignName, setCampaignName] = useState('');
    const [campaignDescription, setCampaignDescription] = useState('');
    const [objective, setObjective] = useState<'awareness' | 'engagement' | 'traffic' | 'sales' | 'leads'>('awareness');
    
    // Step 2: Target Audience
    const [targetAge, setTargetAge] = useState('18-35');
    const [targetGender, setTargetGender] = useState<'all' | 'male' | 'female'>('all');
    const [targetLocation, setTargetLocation] = useState('');
    const [targetInterests, setTargetInterests] = useState('');
    const [audienceDescription, setAudienceDescription] = useState('');
    
    // Step 3: Content Preferences
    const [platforms, setPlatforms] = useState<string[]>(['instagram']);
    const [contentTone, setContentTone] = useState<'professional' | 'casual' | 'humorous' | 'inspirational' | 'educational'>('professional');
    const [contentType, setContentType] = useState<'image' | 'video' | 'carousel' | 'story'>('image');
    const [keyMessages, setKeyMessages] = useState('');
    const [callToAction, setCallToAction] = useState('');
    const [productLogo, setProductLogo] = useState<string | null>(null);
    const [productLogoName, setProductLogoName] = useState<string>('');
    
    // Step 4: Scheduling Preferences
    const [campaignDuration, setCampaignDuration] = useState<'1week' | '2weeks' | '1month' | '3months'>('2weeks');
    const [postsPerWeek, setPostsPerWeek] = useState(3);
    const [preferredDays, setPreferredDays] = useState<string[]>(['monday', 'wednesday', 'friday']);
    const [preferredTimes, setPreferredTimes] = useState<string[]>(['10:00', '18:00']);
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    
    // Step 5: Budget & Goals
    const [budget, setBudget] = useState('');
    const [expectedReach, setExpectedReach] = useState('');
    const [kpis, setKpis] = useState<string[]>(['impressions', 'engagement']);

    const inputClasses = `w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] transition-all ${
      isDarkMode 
        ? 'bg-[#0d1117] border-slate-700/50 text-white placeholder-slate-500' 
        : 'bg-white border-slate-200 text-slate-900'
    }`;
    
    const labelClasses = `block text-xs font-bold uppercase tracking-wide mb-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;

    const togglePlatform = (platform: string) => {
      setPlatforms(prev => prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]);
    };

    const toggleDay = (day: string) => {
      setPreferredDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
    };

    const toggleKpi = (kpi: string) => {
      setKpis(prev => prev.includes(kpi) ? prev.filter(k => k !== kpi) : [...prev, kpi]);
    };

    // Generate AI posts based on campaign details
    const handleGeneratePosts = async () => {
      setIsGenerating(true);
      setGeneratedPosts([]);
      
      // Use relative URL in production, localhost in development
      const apiBaseUrl = window.location.hostname !== 'localhost' ? '/api' : 'http://localhost:5000/api';
      
      try {
        const response = await fetch(`${apiBaseUrl}/campaigns/generate-campaign-posts`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
          },
          body: JSON.stringify({
            campaignName,
            campaignDescription,
            objective,
            targetAudience: {
              age: targetAge,
              gender: targetGender,
              location: targetLocation,
              interests: targetInterests,
              description: audienceDescription
            },
            content: {
              platforms,
              tone: contentTone,
              type: contentType,
              keyMessages,
              callToAction,
              productLogo // Pass the product logo to backend for image generation
            },
            scheduling: {
              duration: campaignDuration,
              postsPerWeek,
              preferredDays,
              preferredTimes,
              startDate
            },
            budget,
            kpis
          })
        });
        
        const data = await response.json();
        
        if (data.success && data.posts) {
          setGeneratedPosts(data.posts.map((post: any, idx: number) => ({
            ...post,
            id: post.id || `post-${idx}`,
            status: 'pending'
          })));
          setStep(6); // Go to review step
        } else {
          throw new Error(data.message || 'Failed to generate posts');
        }
      } catch (error) {
        console.error('Error generating posts:', error);
        alert('Failed to generate posts. Please try again.');
      } finally {
        setIsGenerating(false);
      }
    };

    // Update a generated post
    const handleUpdatePost = (postId: string, updates: Partial<GeneratedPost>) => {
      setGeneratedPosts(prev => prev.map(post => 
        post.id === postId ? { ...post, ...updates, status: updates.status || 'edited' } : post
      ));
      setEditingPostId(null);
    };

    // Helper to parse age range string to object
    const parseAgeRange = (ageStr: string): { min: number; max: number } => {
      if (!ageStr || ageStr === 'all') return { min: 18, max: 65 };
      const match = ageStr.match(/(\d+)-(\d+)/);
      if (match) {
        return { min: parseInt(match[1], 10), max: parseInt(match[2], 10) };
      }
      return { min: 18, max: 65 };
    };

    // Save all accepted posts as scheduled campaigns and actually schedule them on Ayrshare
    const handleSaveAndSchedule = async () => {
      setSavingPosts(true);
      
      const postsToSave = generatedPosts.filter(p => p.status !== 'rejected');
      
      if (postsToSave.length === 0) {
        alert('Please accept at least one post to schedule.');
        setSavingPosts(false);
        return;
      }
      
      try {
        const scheduledCampaigns = [];
        let hasErrors = false;
        
        for (const post of postsToSave) {
          // Create the campaign first
          const { campaign } = await apiService.createCampaign({
            name: `${campaignName} - ${post.platform}`,
            objective: objective as any,
            platforms: [post.platform.toLowerCase()],
            status: 'scheduled',
            creative: {
              type: contentType,
              textContent: post.caption,
              imageUrls: [post.imageUrl],
              captions: post.hashtags.join(' ')
            },
            scheduling: {
              startDate: post.suggestedDate,
              postTime: post.suggestedTime
            },
            budget: { type: 'lifetime' as const, amount: parseFloat(budget) / postsToSave.length || 0, currency: 'USD' },
            targeting: {
              ageRange: parseAgeRange(targetAge),
              gender: targetGender,
              locations: targetLocation ? [targetLocation] : [],
              interests: targetInterests.split(',').map(i => i.trim())
            }
          });
          
          // Now actually schedule on Ayrshare using the publish endpoint
          // Build the scheduled date/time in ISO format
          const scheduledDateTime = new Date(`${post.suggestedDate}T${post.suggestedTime}:00`);
          const scheduledFor = scheduledDateTime.toISOString();
          
          try {
            const publishResult = await apiService.publishCampaign(
              campaign._id, 
              [post.platform.toLowerCase()], 
              scheduledFor
            );
            
            if (publishResult.success) {
              scheduledCampaigns.push(campaign);
              console.log(`✅ Scheduled ${post.platform} post for ${scheduledFor}`);
            } else {
              console.error(`❌ Failed to schedule ${post.platform} post:`, publishResult.message);
              hasErrors = true;
            }
          } catch (publishError) {
            console.error(`❌ Error scheduling ${post.platform} post:`, publishError);
            hasErrors = true;
          }
        }
        
        if (scheduledCampaigns.length > 0) {
          // Create a parent campaign to track all scheduled posts
          const { campaign: parentCampaign } = await apiService.createCampaign({
            name: campaignName,
            objective: objective as any,
            platforms,
            status: 'active',
            creative: {
              type: contentType,
              textContent: campaignDescription,
              imageUrls: postsToSave.map(p => p.imageUrl),
              captions: keyMessages
            },
            scheduling: {
              startDate,
              postTime: preferredTimes[0] || '10:00'
            },
            budget: { type: 'lifetime' as const, amount: parseFloat(budget) || 0, currency: 'USD' }
          });
          
          if (hasErrors) {
            alert(`${scheduledCampaigns.length} of ${postsToSave.length} posts scheduled successfully. Some posts failed - please check your connected accounts.`);
          }
          
          onSuccess(parentCampaign);
        } else {
          alert('Failed to schedule posts. Please make sure you have connected your social accounts.');
        }
      } catch (error) {
        console.error('Error saving campaign:', error);
        alert('Failed to save campaign. Please try again.');
      } finally {
        setSavingPosts(false);
      }
    };

    const stepTitles = [
      'Campaign Details',
      'Target Audience',
      'Content Preferences',
      'Scheduling',
      'Budget & Goals',
      'Review Generated Posts'
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className={`rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex overflow-hidden ${theme.bgCard}`}>
                {/* Sidebar */}
                <div className={`w-72 border-r p-6 flex flex-col shrink-0 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-3 mb-8">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#ffcc29] to-[#ffa500] flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-black" />
                      </div>
                      <div>
                        <h2 className={`text-lg font-bold ${theme.text}`}>Create Campaign</h2>
                        <p className={`text-xs ${theme.textMuted}`}>AI-Powered</p>
                      </div>
                    </div>
                    
                    <div className="space-y-3 flex-1">
                      {stepTitles.slice(0, 5).map((title, idx) => (
                        <div 
                          key={idx}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                            step === idx + 1 
                              ? 'bg-[#ffcc29]/20 border border-[#ffcc29]/30' 
                              : step > idx + 1 
                                ? isDarkMode ? 'bg-green-900/20' : 'bg-green-50'
                                : ''
                          }`}
                          onClick={() => step > idx + 1 && setStep(idx + 1)}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            step === idx + 1 
                              ? 'bg-[#ffcc29] text-black' 
                              : step > idx + 1 
                                ? 'bg-green-500 text-white' 
                                : isDarkMode ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-500'
                          }`}>
                            {step > idx + 1 ? <Check className="w-4 h-4" /> : idx + 1}
                          </div>
                          <span className={`text-sm ${step === idx + 1 ? 'text-[#ffcc29] font-bold' : theme.textSecondary}`}>
                            {title}
                          </span>
                        </div>
                      ))}
                    </div>
                    
                    {step === 6 && (
                      <div className="mt-4 p-4 rounded-xl bg-gradient-to-br from-[#ffcc29]/20 to-[#ffa500]/10 border border-[#ffcc29]/30">
                        <p className={`text-sm font-medium ${theme.text}`}>📊 Generated Posts</p>
                        <p className={`text-xs ${theme.textMuted} mt-1`}>
                          {generatedPosts.filter(p => p.status !== 'rejected').length} posts ready to schedule
                        </p>
                      </div>
                    )}
                </div>
                
                {/* Main Content */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-8">
                        {/* Step 1: Campaign Details */}
                        {step === 1 && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div>
                                  <h3 className={`text-xl font-bold ${theme.text}`}>Campaign Details</h3>
                                  <p className={`text-sm ${theme.textSecondary} mt-1`}>Tell us about your campaign</p>
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Campaign Name *</label>
                                  <input 
                                    className={inputClasses} 
                                    placeholder="e.g., Summer Sale 2025, Product Launch..." 
                                    value={campaignName} 
                                    onChange={e => setCampaignName(e.target.value)} 
                                  />
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Campaign Description *</label>
                                  <textarea 
                                    className={`${inputClasses} resize-none`} 
                                    rows={3}
                                    placeholder="Describe what this campaign is about, its goals, and key messages..."
                                    value={campaignDescription} 
                                    onChange={e => setCampaignDescription(e.target.value)} 
                                  />
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Campaign Objective *</label>
                                  <div className="grid grid-cols-5 gap-2">
                                    {[
                                      { id: 'awareness', label: 'Awareness', icon: '👁️', desc: 'Increase brand visibility' },
                                      { id: 'engagement', label: 'Engagement', icon: '💬', desc: 'Boost interactions' },
                                      { id: 'traffic', label: 'Traffic', icon: '🔗', desc: 'Drive website visits' },
                                      { id: 'sales', label: 'Sales', icon: '💰', desc: 'Generate purchases' },
                                      { id: 'leads', label: 'Leads', icon: '📧', desc: 'Collect contacts' }
                                    ].map(obj => (
                                      <button 
                                        key={obj.id}
                                        onClick={() => setObjective(obj.id as any)} 
                                        className={`p-4 border rounded-xl transition-all text-center ${
                                          objective === obj.id 
                                            ? 'bg-[#ffcc29]/20 border-[#ffcc29] text-[#ffcc29]' 
                                            : isDarkMode 
                                              ? 'border-slate-700 text-slate-400 hover:border-[#ffcc29]/50' 
                                              : 'border-slate-200 text-slate-600 hover:border-[#ffcc29]/50'
                                        }`}
                                      >
                                        <span className="text-2xl block mb-1">{obj.icon}</span>
                                        <span className="text-sm font-medium block">{obj.label}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: Target Audience */}
                        {step === 2 && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div>
                                  <h3 className={`text-xl font-bold ${theme.text}`}>Target Audience</h3>
                                  <p className={`text-sm ${theme.textSecondary} mt-1`}>Define who you want to reach</p>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={labelClasses}>Age Range</label>
                                    <ComboBox
                                      value={targetAge}
                                      onChange={setTargetAge}
                                      className={inputClasses}
                                      isDarkMode={isDarkMode}
                                      placeholder="e.g., 25-40 or select from list"
                                      options={[
                                        { value: '13-17', label: '13-17 (Teens)' },
                                        { value: '18-24', label: '18-24 (Young Adults)' },
                                        { value: '18-35', label: '18-35 (Millennials)' },
                                        { value: '25-44', label: '25-44 (Adults)' },
                                        { value: '35-54', label: '35-54 (Middle Age)' },
                                        { value: '45-65', label: '45-65 (Mature)' },
                                        { value: '65+', label: '65+ (Seniors)' },
                                        { value: 'all', label: 'All Ages' }
                                      ]}
                                    />
                                  </div>
                                  
                                  <div>
                                    <label className={labelClasses}>Gender</label>
                                    <select 
                                      className={inputClasses} 
                                      value={targetGender} 
                                      onChange={e => setTargetGender(e.target.value as 'all' | 'male' | 'female')}
                                    >
                                      <option value="all">All Genders</option>
                                      <option value="male">Male</option>
                                      <option value="female">Female</option>
                                    </select>
                                  </div>
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Target Location</label>
                                  <input 
                                    className={inputClasses} 
                                    placeholder="e.g., United States, California, New York City..."
                                    value={targetLocation} 
                                    onChange={e => setTargetLocation(e.target.value)} 
                                  />
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Interests & Behaviors</label>
                                  <input 
                                    className={inputClasses} 
                                    placeholder="e.g., fitness, technology, fashion, travel (comma separated)"
                                    value={targetInterests} 
                                    onChange={e => setTargetInterests(e.target.value)} 
                                  />
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Describe Your Ideal Customer</label>
                                  <textarea 
                                    className={`${inputClasses} resize-none`} 
                                    rows={3}
                                    placeholder="e.g., Health-conscious millennials who value quality over price, active on social media, interested in sustainable products..."
                                    value={audienceDescription} 
                                    onChange={e => setAudienceDescription(e.target.value)} 
                                  />
                                </div>
                            </div>
                        )}

                        {/* Step 3: Content Preferences */}
                        {step === 3 && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div>
                                  <h3 className={`text-xl font-bold ${theme.text}`}>Content Preferences</h3>
                                  <p className={`text-sm ${theme.textSecondary} mt-1`}>How should your content look and feel?</p>
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Platforms *</label>
                                  <div className="flex flex-wrap gap-2">
                                    {[
                                      { id: 'instagram', label: 'Instagram', icon: <Instagram className="w-4 h-4" /> },
                                      { id: 'facebook', label: 'Facebook', icon: <Facebook className="w-4 h-4" /> },
                                      { id: 'twitter', label: 'Twitter/X', icon: <Twitter className="w-4 h-4" /> },
                                      { id: 'linkedin', label: 'LinkedIn', icon: <Linkedin className="w-4 h-4" /> }
                                    ].map(p => (
                                      <button
                                        key={p.id}
                                        onClick={() => togglePlatform(p.id)}
                                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-all ${
                                          platforms.includes(p.id)
                                            ? 'bg-[#ffcc29]/20 border-[#ffcc29] text-[#ffcc29]'
                                            : isDarkMode
                                              ? 'border-slate-700 text-slate-400 hover:border-[#ffcc29]/50'
                                              : 'border-slate-200 text-slate-600 hover:border-[#ffcc29]/50'
                                        }`}
                                      >
                                        {p.icon}
                                        <span className="text-sm font-medium">{p.label}</span>
                                        {platforms.includes(p.id) && <Check className="w-4 h-4" />}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={labelClasses}>Content Tone</label>
                                    <ComboBox
                                      value={contentTone}
                                      onChange={(v) => setContentTone(v as any)}
                                      className={inputClasses}
                                      isDarkMode={isDarkMode}
                                      placeholder="Select or type your own tone"
                                      options={[
                                        { value: 'professional', label: 'Professional & Formal' },
                                        { value: 'casual', label: 'Casual & Friendly' },
                                        { value: 'humorous', label: 'Witty & Humorous' },
                                        { value: 'inspirational', label: 'Inspirational & Motivational' },
                                        { value: 'educational', label: 'Educational & Informative' },
                                        { value: 'bold', label: 'Bold & Confident' },
                                        { value: 'empathetic', label: 'Empathetic & Caring' },
                                        { value: 'luxurious', label: 'Premium & Luxurious' }
                                      ]}
                                    />
                                  </div>
                                  
                                  <div>
                                    <label className={labelClasses}>Content Type</label>
                                    <ComboBox
                                      value={contentType}
                                      onChange={(v) => setContentType(v as any)}
                                      className={inputClasses}
                                      isDarkMode={isDarkMode}
                                      placeholder="Select or type your own"
                                      options={[
                                        { value: 'image', label: 'Static Images' },
                                        { value: 'video', label: 'Videos' },
                                        { value: 'carousel', label: 'Carousels' },
                                        { value: 'story', label: 'Stories/Reels' },
                                        { value: 'infographic', label: 'Infographics' },
                                        { value: 'quote', label: 'Quote Cards' },
                                        { value: 'testimonial', label: 'Testimonials' }
                                      ]}
                                    />
                                  </div>
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Key Messages to Convey</label>
                                  <textarea 
                                    className={`${inputClasses} resize-none`} 
                                    rows={3}
                                    placeholder="What are the main points you want to communicate? e.g., Quality, value for money, innovation..."
                                    value={keyMessages} 
                                    onChange={e => setKeyMessages(e.target.value)} 
                                  />
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Call to Action</label>
                                  <ComboBox
                                    value={callToAction}
                                    onChange={setCallToAction}
                                    className={inputClasses}
                                    isDarkMode={isDarkMode}
                                    placeholder="Select or type your own CTA"
                                    options={[
                                      { value: 'Shop Now', label: 'Shop Now' },
                                      { value: 'Learn More', label: 'Learn More' },
                                      { value: 'Sign Up', label: 'Sign Up' },
                                      { value: 'Get Started', label: 'Get Started' },
                                      { value: 'Book Now', label: 'Book Now' },
                                      { value: 'Download', label: 'Download' },
                                      { value: 'Contact Us', label: 'Contact Us' },
                                      { value: 'Follow Us', label: 'Follow Us' },
                                      { value: 'Try Free', label: 'Try Free' },
                                      { value: 'Get Quote', label: 'Get Quote' }
                                    ]}
                                  />
                                </div>
                                
                                {/* Product Logo Upload */}
                                <div>
                                  <label className={labelClasses}>Product/Brand Logo (Optional)</label>
                                  <p className={`text-xs mb-2 ${theme.textSecondary}`}>
                                    Upload your product or brand logo - AI will incorporate it into campaign images
                                  </p>
                                  <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                                    isDarkMode 
                                      ? 'border-slate-700 hover:border-[#ffcc29]/50' 
                                      : 'border-slate-300 hover:border-[#ffcc29]/50'
                                  }`}>
                                    {productLogo ? (
                                      <div className="flex items-center justify-center gap-4">
                                        <img 
                                          src={productLogo} 
                                          alt="Product Logo" 
                                          className="w-20 h-20 object-contain rounded-lg border border-slate-300"
                                        />
                                        <div className="text-left">
                                          <p className={`text-sm font-medium ${theme.text}`}>{productLogoName}</p>
                                          <button
                                            onClick={() => { setProductLogo(null); setProductLogoName(''); }}
                                            className="text-xs text-red-500 hover:text-red-400 mt-1 flex items-center gap-1"
                                          >
                                            <X className="w-3 h-3" /> Remove
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <label className="cursor-pointer">
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                              setProductLogoName(file.name);
                                              const reader = new FileReader();
                                              reader.onloadend = () => {
                                                setProductLogo(reader.result as string);
                                              };
                                              reader.readAsDataURL(file);
                                            }
                                          }}
                                        />
                                        <div className="flex flex-col items-center gap-2">
                                          <div className="w-12 h-12 rounded-full bg-[#ffcc29]/10 flex items-center justify-center">
                                            <ImageIcon className="w-6 h-6 text-[#ffcc29]" />
                                          </div>
                                          <p className={`text-sm ${theme.text}`}>Click to upload logo</p>
                                          <p className={`text-xs ${theme.textMuted}`}>PNG, JPG, SVG up to 5MB</p>
                                        </div>
                                      </label>
                                    )}
                                  </div>
                                </div>
                            </div>
                        )}

                        {/* Step 4: Scheduling */}
                        {step === 4 && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div>
                                  <h3 className={`text-xl font-bold ${theme.text}`}>Scheduling Preferences</h3>
                                  <p className={`text-sm ${theme.textSecondary} mt-1`}>When should your posts go live?</p>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={labelClasses}>Campaign Duration</label>
                                    <ComboBox
                                      value={campaignDuration}
                                      onChange={(v) => setCampaignDuration(v as any)}
                                      className={inputClasses}
                                      isDarkMode={isDarkMode}
                                      placeholder="Select or enter custom duration"
                                      options={[
                                        { value: '1week', label: '1 Week' },
                                        { value: '2weeks', label: '2 Weeks' },
                                        { value: '1month', label: '1 Month' },
                                        { value: '3months', label: '3 Months' },
                                        { value: '6months', label: '6 Months' },
                                        { value: '1year', label: '1 Year' }
                                      ]}
                                    />
                                  </div>
                                  
                                  <div>
                                    <label className={labelClasses}>Start Date</label>
                                    <input 
                                      type="date" 
                                      className={inputClasses} 
                                      value={startDate} 
                                      onChange={e => setStartDate(e.target.value)} 
                                    />
                                  </div>
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Posts Per Week: {postsPerWeek}</label>
                                  <input 
                                    type="range" 
                                    min="1" 
                                    max="7" 
                                    value={postsPerWeek}
                                    onChange={e => setPostsPerWeek(parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#ffcc29]"
                                  />
                                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                                    <span>1 post</span>
                                    <span>7 posts</span>
                                  </div>
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Preferred Days</label>
                                  <div className="flex flex-wrap gap-2">
                                    {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                                      <button
                                        key={day}
                                        onClick={() => toggleDay(day)}
                                        className={`px-4 py-2 rounded-lg border text-sm capitalize transition-all ${
                                          preferredDays.includes(day)
                                            ? 'bg-[#ffcc29]/20 border-[#ffcc29] text-[#ffcc29]'
                                            : isDarkMode
                                              ? 'border-slate-700 text-slate-400 hover:border-[#ffcc29]/50'
                                              : 'border-slate-200 text-slate-600 hover:border-[#ffcc29]/50'
                                        }`}
                                      >
                                        {day.slice(0, 3)}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Preferred Posting Times</label>
                                  <p className={`text-xs mb-2 ${theme.textSecondary}`}>Add custom times when you want posts to go live</p>
                                  <div className="flex flex-wrap gap-2 mb-3">
                                    {preferredTimes.map((time, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ffcc29]/20 border border-[#ffcc29] text-[#ffcc29]"
                                      >
                                        <Clock className="w-3 h-3" />
                                        <span className="text-sm font-medium">{time}</span>
                                        <button
                                          onClick={() => setPreferredTimes(prev => prev.filter((_, i) => i !== idx))}
                                          className="ml-1 hover:text-red-400"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex gap-2">
                                    <input
                                      type="time"
                                      id="customTimeInput"
                                      className={`${inputClasses} flex-1`}
                                      onChange={(e) => {
                                        if (e.target.value && !preferredTimes.includes(e.target.value)) {
                                          setPreferredTimes(prev => [...prev, e.target.value]);
                                          e.target.value = '';
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const input = document.getElementById('customTimeInput') as HTMLInputElement;
                                        if (input?.value && !preferredTimes.includes(input.value)) {
                                          setPreferredTimes(prev => [...prev, input.value]);
                                          input.value = '';
                                        }
                                      }}
                                      className="px-4 py-2 bg-[#ffcc29] text-black rounded-lg font-medium hover:bg-[#e6b825] transition-colors"
                                    >
                                      Add Time
                                    </button>
                                  </div>
                                </div>
                            </div>
                        )}

                        {/* Step 5: Budget & Goals */}
                        {step === 5 && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div>
                                  <h3 className={`text-xl font-bold ${theme.text}`}>Budget & Goals</h3>
                                  <p className={`text-sm ${theme.textSecondary} mt-1`}>Set your investment and success metrics</p>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className={labelClasses}>Budget (Optional)</label>
                                    <div className="relative">
                                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                      <input 
                                        type="number"
                                        className={`${inputClasses} pl-10`} 
                                        placeholder="Enter amount"
                                        value={budget} 
                                        onChange={e => setBudget(e.target.value)} 
                                      />
                                    </div>
                                  </div>
                                  
                                  <div>
                                    <label className={labelClasses}>Expected Reach</label>
                                    <select 
                                      className={inputClasses} 
                                      value={expectedReach} 
                                      onChange={e => setExpectedReach(e.target.value)}
                                    >
                                      <option value="">Select expected reach</option>
                                      <option value="1k-5k">1K - 5K</option>
                                      <option value="5k-10k">5K - 10K</option>
                                      <option value="10k-50k">10K - 50K</option>
                                      <option value="50k-100k">50K - 100K</option>
                                      <option value="100k+">100K+</option>
                                    </select>
                                  </div>
                                </div>
                                
                                <div>
                                  <label className={labelClasses}>Key Performance Indicators (KPIs)</label>
                                  <div className="grid grid-cols-3 gap-2">
                                    {[
                                      { id: 'impressions', label: 'Impressions', icon: '👁️' },
                                      { id: 'engagement', label: 'Engagement', icon: '💬' },
                                      { id: 'clicks', label: 'Clicks', icon: '🔗' },
                                      { id: 'conversions', label: 'Conversions', icon: '✅' },
                                      { id: 'followers', label: 'New Followers', icon: '👥' },
                                      { id: 'shares', label: 'Shares', icon: '📤' }
                                    ].map(kpi => (
                                      <button
                                        key={kpi.id}
                                        onClick={() => toggleKpi(kpi.id)}
                                        className={`flex items-center gap-2 p-3 rounded-lg border text-sm transition-all ${
                                          kpis.includes(kpi.id)
                                            ? 'bg-[#ffcc29]/20 border-[#ffcc29] text-[#ffcc29]'
                                            : isDarkMode
                                              ? 'border-slate-700 text-slate-400 hover:border-[#ffcc29]/50'
                                              : 'border-slate-200 text-slate-600 hover:border-[#ffcc29]/50'
                                        }`}
                                      >
                                        <span>{kpi.icon}</span>
                                        <span>{kpi.label}</span>
                                        {kpis.includes(kpi.id) && <Check className="w-4 h-4 ml-auto" />}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                
                                {/* Summary Card */}
                                <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#161b22] border-slate-700/50' : 'bg-slate-50 border-slate-200'}`}>
                                  <h4 className={`font-bold ${theme.text} mb-3`}>📋 Campaign Summary</h4>
                                  <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div><span className={theme.textMuted}>Name:</span> <span className={theme.text}>{campaignName || '—'}</span></div>
                                    <div><span className={theme.textMuted}>Objective:</span> <span className={theme.text}>{objective}</span></div>
                                    <div><span className={theme.textMuted}>Platforms:</span> <span className={theme.text}>{platforms.join(', ') || '—'}</span></div>
                                    <div><span className={theme.textMuted}>Duration:</span> <span className={theme.text}>{campaignDuration}</span></div>
                                    <div><span className={theme.textMuted}>Posts/Week:</span> <span className={theme.text}>{postsPerWeek}</span></div>
                                    <div><span className={theme.textMuted}>Target:</span> <span className={theme.text}>{targetAge}, {targetGender}</span></div>
                                  </div>
                                </div>
                            </div>
                        )}

                        {/* Step 6: Review Generated Posts */}
                        {step === 6 && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h3 className={`text-xl font-bold ${theme.text}`}>Review Generated Posts</h3>
                                    <p className={`text-sm ${theme.textSecondary} mt-1`}>
                                      AI has created {generatedPosts.length} posts for your campaign. Review and customize them.
                                    </p>
                                  </div>
                                  <button
                                    onClick={handleGeneratePosts}
                                    disabled={isGenerating}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-200 hover:bg-slate-300'} ${theme.text}`}
                                  >
                                    <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                                    Regenerate All
                                  </button>
                                </div>
                                
                                <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                                  {generatedPosts.map((post, idx) => (
                                    <div 
                                      key={post.id}
                                      className={`p-4 rounded-xl border transition-all ${
                                        post.status === 'rejected' 
                                          ? 'opacity-50 bg-red-500/5 border-red-500/20' 
                                          : post.status === 'accepted' || post.status === 'edited'
                                            ? isDarkMode ? 'bg-green-900/10 border-green-500/30' : 'bg-green-50 border-green-200'
                                            : isDarkMode ? 'bg-[#161b22] border-slate-700/50' : 'bg-white border-slate-200'
                                      }`}
                                    >
                                      <div className="flex gap-4">
                                        {/* Image Preview */}
                                        <div className="w-32 h-32 rounded-lg overflow-hidden shrink-0">
                                          <img src={post.imageUrl} alt="" className="w-full h-full object-cover" />
                                        </div>
                                        
                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 mb-2">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                              post.platform === 'instagram' ? 'bg-pink-100 text-pink-700' :
                                              post.platform === 'facebook' ? 'bg-blue-100 text-blue-700' :
                                              post.platform === 'twitter' ? 'bg-sky-100 text-sky-700' :
                                              post.platform === 'linkedin' ? 'bg-blue-100 text-blue-800' :
                                              'bg-slate-100 text-slate-700'
                                            }`}>
                                              {post.platform}
                                            </span>
                                            <span className={`text-xs ${theme.textMuted}`}>
                                              📅 {post.suggestedDate} at {post.suggestedTime}
                                            </span>
                                            {post.status !== 'pending' && (
                                              <span className={`text-xs px-2 py-0.5 rounded ${
                                                post.status === 'rejected' ? 'bg-red-100 text-red-700' :
                                                'bg-green-100 text-green-700'
                                              }`}>
                                                {post.status}
                                              </span>
                                            )}
                                          </div>
                                          
                                          {editingPostId === post.id ? (
                                            <div className="space-y-2">
                                              <textarea
                                                className={`${inputClasses} text-sm resize-none`}
                                                rows={3}
                                                value={post.caption}
                                                onChange={e => handleUpdatePost(post.id, { caption: e.target.value })}
                                              />
                                              <input
                                                className={`${inputClasses} text-sm`}
                                                value={post.hashtags.join(' ')}
                                                onChange={e => handleUpdatePost(post.id, { hashtags: e.target.value.split(' ') })}
                                                placeholder="Hashtags..."
                                              />
                                              <div className="grid grid-cols-2 gap-2">
                                                <input
                                                  type="date"
                                                  className={`${inputClasses} text-sm`}
                                                  value={post.suggestedDate}
                                                  onChange={e => handleUpdatePost(post.id, { suggestedDate: e.target.value })}
                                                />
                                                <input
                                                  type="time"
                                                  className={`${inputClasses} text-sm`}
                                                  value={post.suggestedTime}
                                                  onChange={e => handleUpdatePost(post.id, { suggestedTime: e.target.value })}
                                                />
                                              </div>
                                              <button
                                                onClick={() => setEditingPostId(null)}
                                                className="text-xs text-[#ffcc29] font-medium"
                                              >
                                                Done Editing
                                              </button>
                                            </div>
                                          ) : (
                                            <>
                                              <p className={`text-sm ${theme.textSecondary} line-clamp-2 mb-1`}>{post.caption}</p>
                                              <p className="text-xs text-[#ffcc29]">{post.hashtags.slice(0, 5).join(' ')}</p>
                                            </>
                                          )}
                                        </div>
                                        
                                        {/* Actions */}
                                        <div className="flex flex-col gap-2 shrink-0">
                                          {post.status !== 'rejected' && editingPostId !== post.id && (
                                            <>
                                              <button
                                                onClick={() => handleUpdatePost(post.id, { status: 'accepted' })}
                                                className="p-2 rounded-lg bg-green-500/20 text-green-500 hover:bg-green-500/30 transition-colors"
                                                title="Accept"
                                              >
                                                <Check className="w-4 h-4" />
                                              </button>
                                              <button
                                                onClick={() => setEditingPostId(post.id)}
                                                className={`p-2 rounded-lg ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-100 hover:bg-slate-200'} transition-colors`}
                                                title="Edit"
                                              >
                                                <Edit3 className="w-4 h-4" />
                                              </button>
                                            </>
                                          )}
                                          <button
                                            onClick={() => handleUpdatePost(post.id, { status: post.status === 'rejected' ? 'pending' : 'rejected' })}
                                            className={`p-2 rounded-lg ${post.status === 'rejected' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'} hover:opacity-80 transition-colors`}
                                            title={post.status === 'rejected' ? 'Restore' : 'Reject'}
                                          >
                                            <X className="w-4 h-4" />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {/* Footer */}
                    <div className={`flex justify-between items-center p-6 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
                        <button 
                          onClick={step === 1 ? onClose : () => setStep(s => s - 1)} 
                          className={`px-4 py-2 rounded-lg font-medium ${theme.textSecondary} hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors`}
                        >
                          {step === 1 ? 'Cancel' : 'Back'}
                        </button>
                        
                        {step < 5 && (
                          <button 
                            onClick={() => setStep(s => s + 1)} 
                            disabled={step === 1 && !campaignName}
                            className="px-6 py-2.5 bg-[#ffcc29] text-black rounded-lg font-semibold hover:bg-[#e6b825] transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            Next
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        )}
                        
                        {step === 5 && (
                          <button 
                            onClick={handleGeneratePosts}
                            disabled={isGenerating || !campaignName || platforms.length === 0}
                            className="px-6 py-2.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                          >
                            {isGenerating ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating Posts...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4" />
                                Generate AI Posts
                              </>
                            )}
                          </button>
                        )}
                        
                        {step === 6 && (
                          <button 
                            onClick={handleSaveAndSchedule}
                            disabled={savingPosts || generatedPosts.filter(p => p.status !== 'rejected').length === 0}
                            className="px-6 py-2.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                          >
                            {savingPosts ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Calendar className="w-4 h-4" />
                                Save & Schedule ({generatedPosts.filter(p => p.status !== 'rejected').length} posts)
                              </>
                            )}
                          </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- TEMPLATE POSTER CREATOR MODAL (Nano Banana Pro) ---
interface TemplatePosterModalProps {
    onClose: () => void;
    onSuccess: (campaign: Campaign) => void;
    isDarkMode: boolean;
    theme: ReturnType<typeof getThemeClasses>;
    connectedPlatforms: string[];
}

interface PosterItem {
  id: string;
  templateImage: string;
  content: string;
  generatedImage: string | null;
  imageUrl: string | null;
  status: 'pending' | 'generating' | 'generated' | 'editing' | 'error';
  error?: string;
  editHistory: Array<{ instruction: string; image: string }>;
}

const TemplatePosterModal: React.FC<TemplatePosterModalProps> = ({ onClose, onSuccess, isDarkMode, theme, connectedPlatforms }) => {
    const [step, setStep] = useState<'upload' | 'preview' | 'schedule'>('upload');
    const [posters, setPosters] = useState<PosterItem[]>([]);
    const [currentPosterIndex, setCurrentPosterIndex] = useState(0);
    const [isGenerating, setIsGenerating] = useState(false);
    const [editInstruction, setEditInstruction] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [fullPreviewImage, setFullPreviewImage] = useState<string | null>(null);
    const [useAIGeneration, setUseAIGeneration] = useState(false); // Canvas by default, AI optional
    
    // Schedule state
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(connectedPlatforms.slice(0, 1));
    const [isScheduleMode, setIsScheduleMode] = useState(false);
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishResult, setPublishResult] = useState<{ success: boolean; message: string } | null>(null);

    const inputClasses = `w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] transition-all ${
      isDarkMode 
        ? 'bg-[#0d1117] border-slate-700/50 text-white placeholder-slate-500' 
        : 'bg-white border-slate-200 text-slate-900'
    }`;

    // Handle file upload
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const newPosters: PosterItem[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        
        await new Promise<void>((resolve) => {
          reader.onload = () => {
            newPosters.push({
              id: `poster-${Date.now()}-${i}`,
              templateImage: reader.result as string,
              content: '',
              generatedImage: null,
              imageUrl: null,
              status: 'pending',
              editHistory: []
            });
            resolve();
          };
          reader.readAsDataURL(file);
        });
      }

      setPosters(prev => [...prev, ...newPosters]);
    };

    // Update poster content
    const updatePosterContent = (id: string, content: string) => {
      setPosters(prev => prev.map(p => p.id === id ? { ...p, content } : p));
    };

    // Remove poster
    const removePoster = (id: string) => {
      setPosters(prev => prev.filter(p => p.id !== id));
      if (currentPosterIndex >= posters.length - 1) {
        setCurrentPosterIndex(Math.max(0, currentPosterIndex - 1));
      }
    };

    // Generate posters
    const handleGeneratePosters = async () => {
      const pendingPosters = posters.filter(p => p.content.trim().length > 0);
      if (pendingPosters.length === 0) {
        alert('Please add content to at least one template');
        return;
      }

      setIsGenerating(true);
      setStep('preview');

      for (let i = 0; i < posters.length; i++) {
        const poster = posters[i];
        if (!poster.content.trim()) continue;

        setPosters(prev => prev.map((p, idx) => 
          idx === i ? { ...p, status: 'generating' } : p
        ));
        setCurrentPosterIndex(i);

        try {
          const result = await apiService.generateTemplatePoster(
            poster.templateImage,
            poster.content,
            { 
              platform: selectedPlatforms[0] || 'instagram',
              useAI: useAIGeneration 
            }
          );

          if (result.success) {
            setPosters(prev => prev.map((p, idx) => 
              idx === i ? { 
                ...p, 
                status: 'generated',
                generatedImage: result.imageBase64 || null,
                imageUrl: result.imageUrl || null
              } : p
            ));
          } else {
            setPosters(prev => prev.map((p, idx) => 
              idx === i ? { ...p, status: 'error', error: result.error || result.message } : p
            ));
          }
        } catch (error: any) {
          setPosters(prev => prev.map((p, idx) => 
            idx === i ? { ...p, status: 'error', error: error.message } : p
          ));
        }
      }

      setIsGenerating(false);
    };

    // Edit current poster
    const handleEditPoster = async () => {
      if (!editInstruction.trim()) return;
      
      const currentPoster = posters[currentPosterIndex];
      if (!currentPoster.generatedImage) return;

      setIsEditing(true);
      setPosters(prev => prev.map((p, idx) => 
        idx === currentPosterIndex ? { ...p, status: 'editing' } : p
      ));

      try {
        const result = await apiService.editTemplatePoster(
          currentPoster.generatedImage,
          currentPoster.content,
          editInstruction,
          currentPoster.templateImage
        );

        if (result.success) {
          setPosters(prev => prev.map((p, idx) => 
            idx === currentPosterIndex ? { 
              ...p, 
              status: 'generated',
              generatedImage: result.imageBase64 || p.generatedImage,
              imageUrl: result.imageUrl || null,
              editHistory: [...p.editHistory, { instruction: editInstruction, image: p.generatedImage! }]
            } : p
          ));
          setEditInstruction('');
        } else {
          alert(result.error || 'Failed to edit poster');
          setPosters(prev => prev.map((p, idx) => 
            idx === currentPosterIndex ? { ...p, status: 'generated' } : p
          ));
        }
      } catch (error: any) {
        alert(error.message || 'Failed to edit poster');
        setPosters(prev => prev.map((p, idx) => 
          idx === currentPosterIndex ? { ...p, status: 'generated' } : p
        ));
      }

      setIsEditing(false);
    };

    // Regenerate current poster
    const handleRegenerate = async () => {
      const currentPoster = posters[currentPosterIndex];
      if (!currentPoster.content.trim()) return;

      setPosters(prev => prev.map((p, idx) => 
        idx === currentPosterIndex ? { ...p, status: 'generating' } : p
      ));

      try {
        const result = await apiService.generateTemplatePoster(
          currentPoster.templateImage,
          currentPoster.content,
          { platform: selectedPlatforms[0] || 'instagram' }
        );

        if (result.success) {
          setPosters(prev => prev.map((p, idx) => 
            idx === currentPosterIndex ? { 
              ...p, 
              status: 'generated',
              generatedImage: result.imageBase64 || null,
              imageUrl: result.imageUrl || null,
              editHistory: []
            } : p
          ));
        } else {
          alert(result.error || 'Failed to regenerate');
          setPosters(prev => prev.map((p, idx) => 
            idx === currentPosterIndex ? { ...p, status: 'generated' } : p
          ));
        }
      } catch (error: any) {
        alert(error.message);
        setPosters(prev => prev.map((p, idx) => 
          idx === currentPosterIndex ? { ...p, status: 'generated' } : p
        ));
      }
    };

    // Handle publish/schedule
    const handlePublish = async () => {
      const generatedPosters = posters.filter(p => p.status === 'generated' && p.generatedImage);
      if (generatedPosters.length === 0) {
        alert('No posters ready to publish');
        return;
      }

      if (selectedPlatforms.length === 0) {
        alert('Please select at least one platform');
        return;
      }

      if (isScheduleMode && (!scheduleDate || !scheduleTime)) {
        alert('Please select a date and time for scheduling');
        return;
      }

      setIsPublishing(true);
      setPublishResult(null);

      try {
        // Create campaigns for each generated poster
        for (const poster of generatedPosters) {
          const { campaign } = await apiService.createCampaign({
            name: `Template Poster - ${new Date().toLocaleDateString()}`,
            objective: 'awareness',
            platforms: selectedPlatforms,
            status: isScheduleMode ? 'scheduled' : 'draft',
            creative: {
              type: 'image',
              textContent: poster.content,
              imageUrls: [poster.imageUrl || poster.generatedImage || ''],
              captions: ''
            },
            scheduling: isScheduleMode ? {
              startDate: scheduleDate,
              postTime: scheduleTime
            } : undefined
          });

          // If not scheduling, publish immediately
          if (!isScheduleMode) {
            const scheduledFor = isScheduleMode 
              ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
              : undefined;
            
            const publishResult = await apiService.publishCampaign(campaign._id, selectedPlatforms, scheduledFor);
            if (!publishResult.success) {
              throw new Error(publishResult.message || 'Failed to publish');
            }
          }

          onSuccess(campaign);
        }

        const message = isScheduleMode 
          ? `Scheduled ${generatedPosters.length} poster(s) for ${new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString()}`
          : `Posted ${generatedPosters.length} poster(s) to ${selectedPlatforms.join(', ')}`;
        
        setPublishResult({ success: true, message });
        
        setTimeout(() => {
          onClose();
        }, 2000);

      } catch (error: any) {
        setPublishResult({ success: false, message: error.message || 'Failed to publish' });
      }

      setIsPublishing(false);
    };

    const currentPoster = posters[currentPosterIndex];

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
        <div 
          className={`rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden ${theme.bgCard}`}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex items-center justify-between p-5 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-[#ffcc29] to-[#ffa500] rounded-lg text-black">
                <ImageIcon className="w-5 h-5" />
              </div>
              <div>
                <h2 className={`text-lg font-bold ${theme.text}`}>Template Poster Creator</h2>
                <p className={`text-xs ${theme.textSecondary}`}>
                  {step === 'upload' && 'Upload templates and add content'}
                  {step === 'preview' && 'Review and refine your posters'}
                  {step === 'schedule' && 'Schedule or post your posters'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}>
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
            {/* STEP 1: Upload Templates */}
            {step === 'upload' && (
              <div className="space-y-6">
                {/* Upload Area */}
                <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  isDarkMode ? 'border-slate-700 hover:border-[#ffcc29]/50' : 'border-slate-300 hover:border-[#ffcc29]'
                }`}>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                    id="template-upload"
                  />
                  <label htmlFor="template-upload" className="cursor-pointer">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 bg-[#ffcc29]/10 rounded-full">
                        <ImageIcon className="w-8 h-8 text-[#ffcc29]" />
                      </div>
                      <div>
                        <p className={`font-medium ${theme.text}`}>Drop template images here</p>
                        <p className={`text-sm ${theme.textSecondary}`}>or click to browse (PNG, JPG)</p>
                      </div>
                    </div>
                  </label>
                </div>

                {/* Generation Mode Toggle */}
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800/50' : 'bg-blue-50'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Sparkles className={`w-5 h-5 ${useAIGeneration ? 'text-purple-500' : 'text-[#ffcc29]'}`} />
                      <div>
                        <span className={`font-medium ${theme.text}`}>
                          {useAIGeneration ? 'AI Generation Mode' : 'Canvas Overlay Mode (Recommended)'}
                        </span>
                        <p className={`text-xs ${theme.textSecondary}`}>
                          {useAIGeneration 
                            ? 'Uses AI to regenerate poster - may alter template design' 
                            : 'Preserves template exactly, overlays your text content'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setUseAIGeneration(!useAIGeneration)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        useAIGeneration ? 'bg-purple-500' : 'bg-[#ffcc29]'
                      }`}
                    >
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                        useAIGeneration ? 'left-7' : 'left-1'
                      }`} />
                    </button>
                  </div>
                  {useAIGeneration && (
                    <div className="mt-3 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                      <p className="text-xs text-yellow-600 dark:text-yellow-400">
                        ⚠️ AI mode may not preserve template exactly. Use Canvas mode for reliable results.
                      </p>
                    </div>
                  )}
                </div>

                {/* Templates Grid */}
                {posters.length > 0 && (
                  <div className="space-y-4">
                    <h3 className={`font-medium ${theme.text}`}>Templates ({posters.length})</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {posters.map((poster, index) => (
                        <div 
                          key={poster.id} 
                          className={`rounded-xl border overflow-hidden ${
                            isDarkMode ? 'border-slate-700 bg-[#0d1117]' : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex gap-3 p-3">
                            {/* Thumbnail */}
                            <div className="w-24 h-24 rounded-lg overflow-hidden shrink-0">
                              <img 
                                src={poster.templateImage} 
                                alt={`Template ${index + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            
                            {/* Content Input */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-2">
                                <span className={`text-xs font-medium ${theme.textSecondary}`}>Template {index + 1}</span>
                                <button 
                                  onClick={() => removePoster(poster.id)}
                                  className="p-1 rounded hover:bg-red-500/20 text-red-500"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                              <textarea
                                value={poster.content}
                                onChange={(e) => updatePosterContent(poster.id, e.target.value)}
                                placeholder="Enter poster content here...&#10;&#10;Example:&#10;Program: Workshop on AI&#10;Date: 31.01.2026&#10;Time: 10:00 AM"
                                rows={4}
                                className={`${inputClasses} text-sm resize-none`}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Preview & Edit */}
            {step === 'preview' && (
              <div className="flex gap-6">
                {/* Poster Preview */}
                <div className="flex-1 min-w-0">
                  {currentPoster && (
                    <div className="space-y-4">
                      {/* Main Preview */}
                      <div 
                        className={`relative rounded-xl overflow-hidden border cursor-pointer ${
                          isDarkMode ? 'border-slate-700' : 'border-slate-200'
                        }`}
                        onClick={() => currentPoster.generatedImage && setFullPreviewImage(currentPoster.generatedImage)}
                      >
                        {currentPoster.status === 'generating' || currentPoster.status === 'editing' ? (
                          <div className="aspect-square flex items-center justify-center bg-slate-900/50">
                            <div className="text-center">
                              <Loader2 className="w-12 h-12 animate-spin text-[#ffcc29] mx-auto mb-3" />
                              <p className="text-white font-medium">
                                {currentPoster.status === 'editing' ? 'Applying changes...' : 'Generating poster...'}
                              </p>
                            </div>
                          </div>
                        ) : currentPoster.generatedImage ? (
                          <>
                            <img 
                              src={currentPoster.generatedImage} 
                              alt="Generated poster"
                              className="w-full"
                            />
                            <div className="absolute top-3 right-3 flex gap-2">
                              <button 
                                onClick={(e) => { e.stopPropagation(); setFullPreviewImage(currentPoster.generatedImage); }}
                                className="p-2 bg-black/50 rounded-lg text-white hover:bg-black/70"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <a
                                href={currentPoster.generatedImage}
                                download={`poster-${currentPosterIndex + 1}.png`}
                                onClick={(e) => e.stopPropagation()}
                                className="p-2 bg-black/50 rounded-lg text-white hover:bg-black/70"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                            </div>
                          </>
                        ) : currentPoster.status === 'error' ? (
                          <div className="aspect-square flex items-center justify-center bg-red-500/10">
                            <div className="text-center p-6">
                              <X className="w-12 h-12 text-red-500 mx-auto mb-3" />
                              <p className="text-red-500 font-medium mb-2">Generation Failed</p>
                              <p className={`text-sm ${theme.textSecondary}`}>{currentPoster.error}</p>
                              <button 
                                onClick={handleRegenerate}
                                className="mt-4 px-4 py-2 bg-[#ffcc29] text-black rounded-lg font-medium text-sm"
                              >
                                Try Again
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="aspect-square flex items-center justify-center">
                            <img 
                              src={currentPoster.templateImage} 
                              alt="Template"
                              className="w-full h-full object-contain opacity-50"
                            />
                          </div>
                        )}
                      </div>

                      {/* Edit Controls */}
                      {currentPoster.status === 'generated' && currentPoster.generatedImage && (
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editInstruction}
                              onChange={(e) => setEditInstruction(e.target.value)}
                              placeholder="Describe changes (e.g., 'Make title bigger', 'Change color to blue')"
                              className={`${inputClasses} flex-1`}
                              onKeyDown={(e) => e.key === 'Enter' && handleEditPoster()}
                            />
                            <button
                              onClick={handleEditPoster}
                              disabled={isEditing || !editInstruction.trim()}
                              className="px-4 py-2 bg-[#ffcc29] text-black rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
                            >
                              {isEditing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                              Apply
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleRegenerate}
                              className={`flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 ${
                                isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                              }`}
                            >
                              <RefreshCw className="w-4 h-4" /> Regenerate
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Thumbnails Sidebar */}
                <div className={`w-48 shrink-0 border-l pl-4 ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                  <h4 className={`text-sm font-medium mb-3 ${theme.text}`}>All Posters ({posters.length})</h4>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {posters.map((poster, index) => (
                      <div
                        key={poster.id}
                        onClick={() => setCurrentPosterIndex(index)}
                        className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                          index === currentPosterIndex 
                            ? 'border-[#ffcc29]' 
                            : isDarkMode ? 'border-slate-700 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <img 
                          src={poster.generatedImage || poster.templateImage} 
                          alt={`Poster ${index + 1}`}
                          className="w-full aspect-square object-cover"
                        />
                        {poster.status === 'generating' && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <Loader2 className="w-6 h-6 animate-spin text-white" />
                          </div>
                        )}
                        {poster.status === 'generated' && (
                          <div className="absolute top-1 right-1 p-1 bg-green-500 rounded-full">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                        {poster.status === 'error' && (
                          <div className="absolute top-1 right-1 p-1 bg-red-500 rounded-full">
                            <X className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Schedule */}
            {step === 'schedule' && (
              <div className="max-w-lg mx-auto space-y-6">
                {/* Platform Selection */}
                <div>
                  <label className={`block text-sm font-medium mb-3 ${theme.text}`}>Select Platforms</label>
                  <div className="flex flex-wrap gap-2">
                    {['instagram', 'facebook', 'linkedin', 'x'].map(platform => {
                      const isConnected = connectedPlatforms.includes(platform);
                      const isSelected = selectedPlatforms.includes(platform);
                      return (
                        <button
                          key={platform}
                          onClick={() => isConnected && setSelectedPlatforms(prev => 
                            prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]
                          )}
                          disabled={!isConnected}
                          className={`px-4 py-2 rounded-lg font-medium capitalize transition-colors flex items-center gap-2 ${
                            isSelected 
                              ? 'bg-[#ffcc29] text-black' 
                              : isConnected
                                ? isDarkMode ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                : 'opacity-50 cursor-not-allowed bg-slate-200 text-slate-400'
                          }`}
                        >
                          {platform === 'instagram' && <Instagram className="w-4 h-4" />}
                          {platform === 'facebook' && <Facebook className="w-4 h-4" />}
                          {platform === 'linkedin' && <Linkedin className="w-4 h-4" />}
                          {platform === 'x' && <Twitter className="w-4 h-4" />}
                          {platform}
                          {!isConnected && <span className="text-xs">(Not connected)</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Schedule Toggle */}
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Calendar className={`w-5 h-5 ${theme.textSecondary}`} />
                      <span className={`font-medium ${theme.text}`}>Schedule for later</span>
                    </div>
                    <button
                      onClick={() => setIsScheduleMode(!isScheduleMode)}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        isScheduleMode ? 'bg-[#ffcc29]' : isDarkMode ? 'bg-slate-600' : 'bg-slate-300'
                      }`}
                    >
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                        isScheduleMode ? 'left-7' : 'left-1'
                      }`} />
                    </button>
                  </div>

                  {isScheduleMode && (
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className={inputClasses}
                      />
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                  )}
                </div>

                {/* Publish Result */}
                {publishResult && (
                  <div className={`p-4 rounded-xl ${
                    publishResult.success ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                  }`}>
                    <div className="flex items-center gap-2">
                      {publishResult.success ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
                      <span className="font-medium">{publishResult.message}</span>
                    </div>
                  </div>
                )}

                {/* Summary */}
                <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                  <h4 className={`font-medium mb-2 ${theme.text}`}>Summary</h4>
                  <ul className={`text-sm space-y-1 ${theme.textSecondary}`}>
                    <li>• {posters.filter(p => p.status === 'generated').length} poster(s) ready</li>
                    <li>• Platforms: {selectedPlatforms.length > 0 ? selectedPlatforms.join(', ') : 'None selected'}</li>
                    <li>• {isScheduleMode ? `Scheduled for ${scheduleDate} ${scheduleTime}` : 'Post immediately'}</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`flex justify-between items-center p-5 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <button 
              onClick={() => {
                if (step === 'upload') onClose();
                else if (step === 'preview') setStep('upload');
                else setStep('preview');
              }}
              className={`px-4 py-2 rounded-lg font-medium ${theme.textSecondary} hover:bg-slate-100 dark:hover:bg-slate-800`}
            >
              {step === 'upload' ? 'Cancel' : 'Back'}
            </button>

            {step === 'upload' && (
              <button 
                onClick={handleGeneratePosters}
                disabled={isGenerating || posters.length === 0 || posters.every(p => !p.content.trim())}
                className="px-6 py-2.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" /> Generate Posters
              </button>
            )}

            {step === 'preview' && (
              <button 
                onClick={() => setStep('schedule')}
                disabled={posters.filter(p => p.status === 'generated').length === 0}
                className="px-6 py-2.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                Continue to Publish <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {step === 'schedule' && (
              <button 
                onClick={handlePublish}
                disabled={isPublishing || selectedPlatforms.length === 0}
                className="px-6 py-2.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                {isPublishing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Publishing...</>
                ) : isScheduleMode ? (
                  <><Calendar className="w-4 h-4" /> Schedule</>
                ) : (
                  <><Send className="w-4 h-4" /> Post Now</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Full Image Preview Modal */}
        {fullPreviewImage && (
          <div 
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/90 p-4"
            onClick={() => setFullPreviewImage(null)}
          >
            <button 
              className="absolute top-4 right-4 p-2 bg-white/10 rounded-lg text-white hover:bg-white/20"
              onClick={() => setFullPreviewImage(null)}
            >
              <X className="w-6 h-6" />
            </button>
            <img 
              src={fullPreviewImage} 
              alt="Full preview"
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    );
};

// --- EDIT SUGGESTION MODAL ---
interface EditSuggestionModalProps {
    suggestion: {
        id: string;
        title: string;
        caption: string;
        imageUrl: string;
        platform: string;
        objective: string;
        hashtags: string[];
        bestTime: string;
        estimatedReach: string;
    };
    onClose: () => void;
    onSave: (updated: any) => void;
    isDarkMode: boolean;
    theme: ReturnType<typeof getThemeClasses>;
}

const EditSuggestionModal: React.FC<EditSuggestionModalProps> = ({ suggestion, onClose, onSave, isDarkMode, theme }) => {
    const [title, setTitle] = useState(suggestion.title);
    const [caption, setCaption] = useState(suggestion.caption);
    const [platform, setPlatform] = useState(suggestion.platform);
    const [bestTime, setBestTime] = useState(suggestion.bestTime);
    const [hashtags, setHashtags] = useState(suggestion.hashtags.join(' '));
    const [isRegenerating, setIsRegenerating] = useState(false);

    const inputClasses = `w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] ${
      isDarkMode 
        ? 'bg-[#0d1117] border-slate-700/50 text-white placeholder-slate-500' 
        : 'bg-white border-slate-200 text-slate-900'
    }`;

    const handleRegenerateCaption = async () => {
        setIsRegenerating(true);
        // Use relative URL in production, localhost in development
        const apiBaseUrl = window.location.hostname !== 'localhost' ? '/api' : 'http://localhost:5000/api';
        try {
            // Call the chat API to regenerate caption
            const response = await fetch(`${apiBaseUrl}/chat/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `Generate a fresh, engaging social media caption for a ${suggestion.objective} campaign about "${title}" for ${platform}. Include emojis and a call to action. Just provide the caption, no explanation.`
                })
            });
            const data = await response.json();
            if (data.success) {
                setCaption(data.response);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleSave = () => {
        onSave({
            ...suggestion,
            title,
            caption,
            platform,
            bestTime,
            hashtags: hashtags.split(' ').filter(h => h.startsWith('#'))
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div 
                className={`rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200 ${theme.bgCard}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`flex items-center justify-between p-6 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#ffcc29]/20 rounded-lg text-[#ffcc29]">
                            <Edit3 className="w-5 h-5" />
                        </div>
                        <h2 className={`text-lg font-bold ${theme.text}`}>Edit Campaign</h2>
                    </div>
                    <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-100'}`}>
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5 overflow-y-auto max-h-[60vh]">
                    {/* Preview Image */}
                    <div className="relative h-48 rounded-xl overflow-hidden">
                        <img 
                            src={suggestion.imageUrl} 
                            alt="Campaign preview" 
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
                    </div>

                    {/* Title */}
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Campaign Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            className={inputClasses}
                        />
                    </div>

                    {/* Platform & Time */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Platform</label>
                            <select
                                value={platform}
                                onChange={e => setPlatform(e.target.value)}
                                className={inputClasses}
                            >
                                <option>Instagram</option>
                                <option>Facebook</option>
                                <option>Twitter</option>
                                <option>LinkedIn</option>
                                <option>YouTube</option>
                                <option>YouTube</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Best Post Time</label>
                            <input
                                type="time"
                                value={bestTime.replace(' AM', '').replace(' PM', '')}
                                onChange={e => setBestTime(e.target.value)}
                                className={inputClasses}
                            />
                        </div>
                    </div>

                    {/* Caption */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide">Caption</label>
                            <button 
                                onClick={handleRegenerateCaption}
                                disabled={isRegenerating}
                                className="text-xs text-[#ffcc29] font-bold flex items-center gap-1 hover:text-[#ffcc29]/80 disabled:opacity-50"
                            >
                                {isRegenerating ? (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
                                ) : (
                                    <><Sparkles className="w-3 h-3" /> Regenerate with AI</>
                                )}
                            </button>
                        </div>
                        <textarea
                            value={caption}
                            onChange={e => setCaption(e.target.value)}
                            rows={5}
                            className={`${inputClasses} resize-none`}
                        />
                    </div>

                    {/* Hashtags */}
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Hashtags</label>
                        <input
                            type="text"
                            value={hashtags}
                            onChange={e => setHashtags(e.target.value)}
                            placeholder="#hashtag1 #hashtag2"
                            className={inputClasses}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className={`flex items-center justify-end gap-3 p-6 border-t ${
                  isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                }`}>
                    <button 
                        onClick={onClose}
                        className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                          isDarkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleSave}
                        className="px-6 py-2 bg-[#ffcc29] text-black font-medium rounded-lg hover:bg-[#ffcc29]/80 transition-colors flex items-center gap-2"
                    >
                        <Send className="w-4 h-4" /> Save & Create Draft
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Campaigns;