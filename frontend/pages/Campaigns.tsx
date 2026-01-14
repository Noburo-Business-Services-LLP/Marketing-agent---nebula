import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiService } from '../services/api';
import { Campaign } from '../types';
import { Plus, Sparkles, Filter, Loader2, Calendar, BarChart3, Image as ImageIcon, Video, X, ChevronRight, Check, Eye, MousePointer, Archive, Send, Edit3, DollarSign, RefreshCw, Wand2, Instagram, Facebook, Twitter, Linkedin, Youtube, Clock, Heart, MessageCircle, Share2, Zap, Download, FileText, ImageDown, ChevronDown } from 'lucide-react';
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

  useEffect(() => {
    if (activeTab === 'suggestions') {
      generateSuggestions();
    } else {
      loadCampaigns();
    }
  }, [activeTab]);

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
        'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
        'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&h=600&fit=crop'
      ]
    };
    
    const images = industryImages[industry] || industryImages['default'];
    
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
  
  // Handle regenerate - forces new generation
  const handleRegenerate = () => {
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

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {campaigns.map((campaign) => (
          <CampaignCard key={campaign._id} campaign={campaign} isDarkMode={isDarkMode} theme={theme} />
        ))}
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
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 bg-[#ffcc29] hover:bg-[#ffcc29]/80 text-black px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
        >
          <Plus className="w-5 h-5" />
          New Campaign
        </button>
      </div>

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

const CampaignCard: React.FC<{ campaign: Campaign; isDarkMode: boolean; theme: ReturnType<typeof getThemeClasses> }> = ({ campaign, isDarkMode, theme }) => (
    <div className={`rounded-xl shadow-sm border overflow-hidden hover:shadow-md transition-shadow flex flex-col h-full ${theme.bgCard} ${
      isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
    }`}>
        <div className={`p-5 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <div className="flex justify-between items-start mb-2">
                <h3 className={`font-bold text-sm ${theme.text}`}>{campaign.name}</h3>
                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                    campaign.status === 'active' ? 'bg-green-500/20 text-green-500' :
                    campaign.status === 'posted' ? 'bg-blue-500/20 text-blue-500' :
                    campaign.status === 'draft' ? 'bg-amber-500/20 text-amber-500' :
                    isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600'
                }`}>
                    {campaign.status}
                </span>
            </div>
            <div className={`flex flex-col gap-1 text-xs ${theme.textSecondary}`}>
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
        <div className={`p-3 border-t flex justify-end gap-2 ${
          isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
        }`}>
            {campaign.status === 'draft' && (
                <button className="text-xs font-bold text-[#ffcc29] px-3 py-1.5 hover:bg-[#ffcc29]/10 rounded border border-transparent hover:border-[#ffcc29]/30 flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> Edit
                </button>
            )}
             {campaign.status === 'draft' && (
                <button className="text-xs font-bold text-black bg-[#ffcc29] px-3 py-1.5 rounded hover:bg-[#ffcc29]/80 flex items-center gap-1">
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
    const [targetGender, setTargetGender] = useState('all');
    const [targetLocation, setTargetLocation] = useState('');
    const [targetInterests, setTargetInterests] = useState('');
    const [audienceDescription, setAudienceDescription] = useState('');
    
    // Step 3: Content Preferences
    const [platforms, setPlatforms] = useState<string[]>(['instagram']);
    const [contentTone, setContentTone] = useState<'professional' | 'casual' | 'humorous' | 'inspirational' | 'educational'>('professional');
    const [contentType, setContentType] = useState<'image' | 'video' | 'carousel' | 'story'>('image');
    const [keyMessages, setKeyMessages] = useState('');
    const [callToAction, setCallToAction] = useState('');
    
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
              callToAction
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

    // Save all accepted posts as scheduled campaigns
    const handleSaveAndSchedule = async () => {
      setSavingPosts(true);
      
      const postsToSave = generatedPosts.filter(p => p.status !== 'rejected');
      
      try {
        for (const post of postsToSave) {
          await apiService.createCampaign({
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
            budget: { allocated: parseFloat(budget) / postsToSave.length || 0, spent: 0 },
            targeting: {
              ageRange: parseAgeRange(targetAge),
              gender: targetGender,
              locations: targetLocation ? [targetLocation] : [],
              interests: targetInterests.split(',').map(i => i.trim())
            }
          });
        }
        
        // Create the parent campaign
        const { campaign } = await apiService.createCampaign({
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
          budget: { allocated: parseFloat(budget) || 0, spent: 0 }
        });
        
        onSuccess(campaign);
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
                                      onChange={e => setTargetGender(e.target.value)}
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
                                      { id: 'linkedin', label: 'LinkedIn', icon: <Linkedin className="w-4 h-4" /> },
                                      { id: 'youtube', label: 'YouTube', icon: <Youtube className="w-4 h-4" /> }
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
                                  <div className="grid grid-cols-4 gap-2">
                                    {['09:00', '12:00', '15:00', '18:00', '10:00', '14:00', '17:00', '20:00'].map(time => (
                                      <button
                                        key={time}
                                        onClick={() => setPreferredTimes(prev => 
                                          prev.includes(time) ? prev.filter(t => t !== time) : [...prev, time]
                                        )}
                                        className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                                          preferredTimes.includes(time)
                                            ? 'bg-[#ffcc29]/20 border-[#ffcc29] text-[#ffcc29]'
                                            : isDarkMode
                                              ? 'border-slate-700 text-slate-400 hover:border-[#ffcc29]/50'
                                              : 'border-slate-200 text-slate-600 hover:border-[#ffcc29]/50'
                                        }`}
                                      >
                                        {time}
                                      </button>
                                    ))}
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