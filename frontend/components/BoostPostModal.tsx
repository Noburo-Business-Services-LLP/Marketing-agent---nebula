import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import {
  X, Loader2, DollarSign, Calendar, Target, Users, MapPin,
  Zap, ChevronRight, ChevronDown, Check, AlertCircle, Search,
  Megaphone, Eye, MessageCircle, ShoppingCart, Sparkles, Shield,
  CreditCard, Plus, Minus, Link2, Globe, Info
} from 'lucide-react';

interface BoostPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaign: {
    _id: string;
    name: string;
    socialPostId: string;
    platforms?: string[];
  };
}

// Country list with codes
const COUNTRIES = [
  { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' }, { code: 'AU', name: 'Australia' },
  { code: 'IN', name: 'India' }, { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' }, { code: 'BR', name: 'Brazil' },
  { code: 'JP', name: 'Japan' }, { code: 'SG', name: 'Singapore' },
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'MX', name: 'Mexico' }, { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' }, { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' }, { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' }, { code: 'PL', name: 'Poland' },
  { code: 'ZA', name: 'South Africa' }, { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' }, { code: 'EG', name: 'Egypt' },
  { code: 'PH', name: 'Philippines' }, { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' }, { code: 'VN', name: 'Vietnam' },
  { code: 'KR', name: 'South Korea' }, { code: 'TW', name: 'Taiwan' },
  { code: 'MY', name: 'Malaysia' }, { code: 'NZ', name: 'New Zealand' },
  { code: 'AR', name: 'Argentina' }, { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' }, { code: 'TR', name: 'Turkey' },
  { code: 'RU', name: 'Russia' }, { code: 'IL', name: 'Israel' },
  { code: 'PT', name: 'Portugal' }, { code: 'IE', name: 'Ireland' },
  { code: 'CH', name: 'Switzerland' }, { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' }, { code: 'FI', name: 'Finland' },
  { code: 'CZ', name: 'Czech Republic' }, { code: 'RO', name: 'Romania' },
  { code: 'HU', name: 'Hungary' }, { code: 'GR', name: 'Greece' },
  { code: 'PK', name: 'Pakistan' }, { code: 'BD', name: 'Bangladesh' },
  { code: 'LK', name: 'Sri Lanka' },
];

const BoostPostModal: React.FC<BoostPostModalProps> = ({ isOpen, onClose, campaign }) => {
  const { isDarkMode } = useTheme();
  const tc = getThemeClasses(isDarkMode);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Ad Account
  const [adAccounts, setAdAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedAccountData, setSelectedAccountData] = useState<any>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Goal
  const [goal, setGoal] = useState('engagement');

  // Special Ad Categories
  const [hasSpecialCategory, setHasSpecialCategory] = useState(false);
  const [specialAdCategories, setSpecialAdCategories] = useState<string[]>([]);

  // Audience Mode
  const [audienceMode, setAudienceMode] = useState<'suggested' | 'custom'>('suggested');

  // Targeting (custom audience)
  const [countries, setCountries] = useState<string[]>(['US']);
  const [regions, setRegions] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [excludedCountries, setExcludedCountries] = useState<string[]>([]);
  const [regionInput, setRegionInput] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState<string>('all');

  // Interests
  const [interestQuery, setInterestQuery] = useState('');
  const [interests, setInterests] = useState<any[]>([]);
  const [selectedInterests, setSelectedInterests] = useState<any[]>([]);
  const [searchingInterests, setSearchingInterests] = useState(false);

  // Budget
  const [dailyBudget, setDailyBudget] = useState(5);
  const [bidAmount, setBidAmount] = useState(1);

  // Duration
  const [durationType, setDurationType] = useState<'ongoing' | 'set'>('ongoing');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Advanced (collapsible)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [dsaBeneficiary, setDsaBeneficiary] = useState('');
  const [dsaPayor, setDsaPayor] = useState('');

  // Sections expand
  const [showAudienceDetails, setShowAudienceDetails] = useState(false);
  const [showExcludedLocations, setShowExcludedLocations] = useState(false);

  // Load ad accounts on open
  useEffect(() => {
    if (isOpen) {
      loadAdAccounts();
      setError('');
      setSuccess(false);
      setGoal('engagement');
      setHasSpecialCategory(false);
      setSpecialAdCategories([]);
      setAudienceMode('suggested');
      setCountries(['US']);
      setRegions([]);
      setCities([]);
      setExcludedCountries([]);
      setAgeMin(18);
      setAgeMax(65);
      setGender('all');
      setSelectedInterests([]);
      setDailyBudget(5);
      setBidAmount(1);
      setDurationType('ongoing');
      setShowAdvanced(false);
      setPixelId('');
      setUtmSource('');
      setUtmMedium('');
      setUtmCampaign('');
      setDsaBeneficiary('');
      setDsaPayor('');
      // Set default dates
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const weekLater = new Date(tomorrow);
      weekLater.setDate(weekLater.getDate() + 7);
      setStartDate(tomorrow.toISOString().split('T')[0]);
      setEndDate(weekLater.toISOString().split('T')[0]);
    }
  }, [isOpen]);

  const loadAdAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const res = await apiService.getAdAccounts();
      if (res?.success && res.accounts) {
        let raw = res.accounts;
        if (raw.adAccounts) raw = raw.adAccounts;
        if (raw.data) raw = raw.data;
        const accounts = Array.isArray(raw) ? raw : [raw];
        const normalized = accounts.map((a: any, idx: number) => {
          const uid = a.accountId || a.id || a.account_id || a.adAccountId || a.act_id || `acc_${idx}`;
          return {
            ...a,
            id: uid,
            name: a.name || a.account_name || `Ad Account ${uid}`,
            currency: a.currency || 'USD',
            fundingSource: a.fundingSource || null,
            minDailyBudget: a.minDailyBudget || 1,
          };
        });
        setAdAccounts(normalized);
        if (normalized.length === 1) {
          setSelectedAccount(normalized[0].id);
          setSelectedAccountData(normalized[0]);
        }
      }
    } catch (err: any) {
      setError('Failed to load ad accounts. Make sure Facebook Ads is connected.');
    }
    setLoadingAccounts(false);
  };

  const searchInterests = async () => {
    if (!interestQuery.trim()) return;
    setSearchingInterests(true);
    try {
      const res = await apiService.searchAdInterests(interestQuery);
      if (res?.success && res.interests) {
        setInterests(Array.isArray(res.interests) ? res.interests : res.interests.data || []);
      }
    } catch (err) {
      console.error('Interest search error:', err);
    }
    setSearchingInterests(false);
  };

  const handleBoost = async () => {
    if (!selectedAccount) {
      setError('Please select an ad account');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params: any = {
        postId: campaign.socialPostId,
        adAccountId: selectedAccount,
        goal,
        dailyBudget,
        bidAmount,
      };

      // Locations
      const locations: any = { countries };
      if (regions.length > 0) locations.regions = regions;
      if (cities.length > 0) locations.cities = cities;
      params.locations = locations;

      // Excluded locations
      if (excludedCountries.length > 0) {
        params.excludedLocations = { countries: excludedCountries };
      }

      // Targeting (only if custom audience)
      if (audienceMode === 'custom') {
        if (ageMin !== 18) params.minAge = ageMin;
        if (ageMax !== 65) params.maxAge = ageMax;
        if (gender !== 'all') params.gender = gender;
        if (selectedInterests.length > 0) {
          params.interests = selectedInterests.map(i => typeof i.id === 'number' ? i.id : parseInt(i.id) || i.id);
        }
      }

      // Duration
      if (durationType === 'set') {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const hoursDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        if (hoursDiff < 30) {
          setError('End date must be at least 30 hours after start date (Facebook requirement).');
          setLoading(false);
          return;
        }
        params.startDate = start.toISOString();
        params.endDate = end.toISOString();
      }
      // If ongoing, don't send endDate — Ayrshare will set it as ongoing

      // Special ad categories
      if (hasSpecialCategory && specialAdCategories.length > 0) {
        params.specialAdCategories = specialAdCategories;
      }

      // Advanced: Tracking pixel
      if (pixelId) {
        params.tracking = { pixelId };
      }

      // Advanced: UTM tags
      const urlTags: string[] = [];
      if (utmSource) urlTags.push(`utm_source=${utmSource}`);
      if (utmMedium) urlTags.push(`utm_medium=${utmMedium}`);
      if (utmCampaign) urlTags.push(`utm_campaign=${utmCampaign}`);
      if (urlTags.length > 0) params.urlTags = urlTags;

      // Advanced: DSA compliance
      if (dsaBeneficiary) params.dsaBeneficiary = dsaBeneficiary;
      if (dsaPayor) params.dsaPayor = dsaPayor;

      const res = await apiService.boostPost(params);

      if (res?.success) {
        setSuccess(true);
      } else {
        setError(res?.error || 'Failed to boost post');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to boost post');
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  const goals = [
    { value: 'engagement', label: 'Get more engagement', desc: 'Maximize engagement while reaching unique users', icon: <Target className="w-5 h-5" /> },
    { value: 'interactions', label: 'Get more interactions', desc: 'More likes, comments, and shares on your post', icon: <MessageCircle className="w-5 h-5" /> },
    { value: 'awareness_views', label: 'Brand awareness (views)', desc: 'Maximize the number of times your ad is shown', icon: <Eye className="w-5 h-5" /> },
    { value: 'awareness_audience', label: 'Brand awareness (reach)', desc: 'Reach as many unique people as possible', icon: <Users className="w-5 h-5" /> },
  ];

  const specialCategories = [
    { value: 'housing', label: 'Housing', desc: 'Real estate, rentals, mortgages, home insurance' },
    { value: 'financial_product_services', label: 'Financial products & services', desc: 'Credit, loans, financial services' },
    { value: 'employment', label: 'Employment', desc: 'Job listings, internships, career opportunities' },
    { value: 'issues_elections_politics', label: 'Issues, elections or politics', desc: 'Political ads, social issues, elections' },
  ];

  const getCountryName = (code: string) => COUNTRIES.find(c => c.code === code)?.name || code;

  const fundingInfo = selectedAccountData?.fundingSource;
  const accountCurrency = selectedAccountData?.currency || 'USD';

  // Currency helper
  const currencySymbol = accountCurrency === 'INR' ? '₹' : accountCurrency === 'EUR' ? '€' : accountCurrency === 'GBP' ? '£' : '$';
  const minBudget = accountCurrency === 'INR' ? 100 : 1;
  const maxBudget = accountCurrency === 'INR' ? 50000 : 1000;
  const defaultBudget = accountCurrency === 'INR' ? 500 : 5;
  const minBid = accountCurrency === 'INR' ? 50 : 1;

  // Calculate estimated total for set duration
  const daysCount = durationType === 'set' && startDate && endDate
    ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000))
    : 0;

  // Radio component
  const Radio = ({ selected }: { selected: boolean; onClick?: () => void }) => (
    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
      selected ? 'border-[#ffcc29] bg-[#ffcc29]' : isDarkMode ? 'border-slate-600' : 'border-gray-300'
    }`}>
      {selected && <div className="w-2 h-2 rounded-full bg-[#070A12]" />}
    </div>
  );

  // Toggle component
  const Toggle = ({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) => (
    <button
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-[#ffcc29]' : isDarkMode ? 'bg-slate-700' : 'bg-gray-300'}`}
    >
      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );

  // Section divider
  const Divider = () => <div className={`border-t ${isDarkMode ? 'border-slate-700/50' : 'border-gray-200'}`} />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl shadow-2xl ${isDarkMode ? 'bg-[#0f1419]' : 'bg-white'}`}>

        {/* Header */}
        <div className={`flex items-center justify-between p-5 border-b ${isDarkMode ? 'border-slate-700/50' : 'border-gray-200'}`}>
          <div className="flex-1">
            <h2 className={`text-lg font-bold ${tc.text}`}>Boost post</h2>
            <p className={`text-sm ${tc.textSecondary}`}>
              Boost this post into an ad to increase your reach.
            </p>
          </div>
          {/* Ad Account selector */}
          {adAccounts.length > 0 && (
            <div className="flex items-center gap-2 mr-3">
              <span className={`text-xs ${tc.textMuted}`}>Ad Account:</span>
              <select
                value={selectedAccount}
                onChange={e => {
                  setSelectedAccount(e.target.value);
                  const acc = adAccounts.find(a => a.id === e.target.value) || null;
                  setSelectedAccountData(acc);
                  // Update budget defaults for currency
                  const curr = acc?.currency || 'USD';
                  setDailyBudget(curr === 'INR' ? 500 : 5);
                  setBidAmount(curr === 'INR' ? 50 : 1);
                }}
                className={`text-xs px-2 py-1 rounded-lg border ${tc.input} max-w-[180px]`}
              >
                {adAccounts.map((acc: any) => (
                  <option key={acc.id} value={acc.id}>{acc.name} ({acc.id})</option>
                ))}
              </select>
            </div>
          )}
          <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success State */}
        {success ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-400" />
              </div>
              <h3 className={`text-xl font-bold ${tc.text}`}>Post Boosted!</h3>
              <p className={`text-sm mt-2 ${tc.textSecondary}`}>
                Your ad is being reviewed by Meta. It may take up to 24 hours to go live.
              </p>
              <button onClick={onClose} className={`mt-6 px-6 py-2.5 rounded-lg font-medium ${tc.btnPrimary}`}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
              {loadingAccounts ? (
                <div className="flex items-center justify-center gap-2 py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" />
                  <span className={tc.textSecondary}>Loading ad accounts...</span>
                </div>
              ) : adAccounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
                  <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
                  <h3 className={`font-semibold ${tc.text}`}>No Ad Accounts Found</h3>
                  <p className={`text-sm mt-2 ${tc.textSecondary}`}>
                    Make sure your Facebook Business account is connected and has an active ad account with a linked payment method.
                  </p>
                </div>
              ) : (
                <div className="p-5 space-y-6">

                  {/* Error banner */}
                  {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div>
                        <span>{error}</span>
                        {error.toLowerCase().includes('post id') && (
                          <p className="mt-1 text-xs opacity-80">
                            Make sure the post was published on a Facebook Page or Instagram Business account connected to this ad account.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ===== SECTION 1: GOAL ===== */}
                  <div>
                    <h3 className={`text-base font-semibold mb-1 ${tc.text}`}>
                      What do you want people to do when they see your ad?
                    </h3>
                    <div className="space-y-2 mt-3">
                      {goals.map(g => (
                        <button
                          key={g.value}
                          onClick={() => setGoal(g.value)}
                          className={`w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all ${
                            goal === g.value
                              ? 'bg-[#ffcc29]/10 border-2 border-[#ffcc29]'
                              : `border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-gray-200 hover:border-gray-300'}`
                          }`}
                        >
                          <div className={`${goal === g.value ? 'text-[#ffcc29]' : tc.textMuted}`}>
                            {g.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${tc.text}`}>{g.label}</p>
                            <p className={`text-xs ${tc.textMuted}`}>{g.desc}</p>
                          </div>
                          <Radio selected={goal === g.value} onClick={() => setGoal(g.value)} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <Divider />

                  {/* ===== SECTION 2: SPECIAL REQUIREMENTS ===== */}
                  <div>
                    <h3 className={`text-base font-semibold mb-1 ${tc.text}`}>Special requirements</h3>
                    <div className="flex items-start justify-between gap-4 mt-2">
                      <p className={`text-sm ${tc.textSecondary}`}>
                        Review if your ads are about financial products and services, employment, housing, social issues, elections or politics.
                      </p>
                      <Toggle enabled={hasSpecialCategory} onToggle={() => {
                        setHasSpecialCategory(!hasSpecialCategory);
                        if (hasSpecialCategory) setSpecialAdCategories([]);
                      }} />
                    </div>
                    {hasSpecialCategory && (
                      <div className="mt-3 space-y-2">
                        {specialCategories.map(cat => {
                          const isSelected = specialAdCategories.includes(cat.value);
                          return (
                            <button
                              key={cat.value}
                              onClick={() => {
                                if (isSelected) {
                                  setSpecialAdCategories(prev => prev.filter(c => c !== cat.value));
                                } else {
                                  setSpecialAdCategories(prev => [...prev, cat.value]);
                                }
                              }}
                              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                                isSelected
                                  ? 'bg-[#ffcc29]/10 border-2 border-[#ffcc29]'
                                  : `border ${isDarkMode ? 'border-slate-700/50' : 'border-gray-200'}`
                              }`}
                            >
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                                isSelected ? 'bg-[#ffcc29] border-[#ffcc29]' : isDarkMode ? 'border-slate-600' : 'border-gray-300'
                              }`}>
                                {isSelected && <Check className="w-3 h-3 text-[#070A12]" />}
                              </div>
                              <div>
                                <p className={`text-sm font-medium ${tc.text}`}>{cat.label}</p>
                                <p className={`text-xs ${tc.textMuted}`}>{cat.desc}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <Divider />

                  {/* ===== SECTION 3: AUDIENCE ===== */}
                  <div>
                    <h3 className={`text-base font-semibold mb-1 ${tc.text}`}>Who should see your ad?</h3>

                    {/* Suggested Audience */}
                    <button
                      onClick={() => setAudienceMode('suggested')}
                      className={`w-full flex items-start gap-3 p-3.5 mt-3 rounded-xl text-left transition-all ${
                        audienceMode === 'suggested'
                          ? 'bg-[#ffcc29]/10 border-2 border-[#ffcc29]'
                          : `border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-gray-200 hover:border-gray-300'}`
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-semibold ${tc.text}`}>Suggested audience</p>
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#ffcc29] text-[#070A12]">RECOMMENDED</span>
                        </div>
                        <p className={`text-xs mt-1 ${tc.textMuted}`}>
                          Uses Meta's default targeting to reach people most likely to be interested in your content.
                        </p>
                        <div className={`text-xs mt-2 ${tc.textMuted}`}>
                          <span>Ages 18+ &middot; Men and women &middot; {getCountryName(countries[0])}</span>
                        </div>
                      </div>
                      <Radio selected={audienceMode === 'suggested'} onClick={() => setAudienceMode('suggested')} />
                    </button>

                    {/* Create your own */}
                    <button
                      onClick={() => { setAudienceMode('custom'); setShowAudienceDetails(true); }}
                      className={`w-full flex items-start gap-3 p-3.5 mt-2 rounded-xl text-left transition-all ${
                        audienceMode === 'custom'
                          ? 'bg-[#ffcc29]/10 border-2 border-[#ffcc29]'
                          : `border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-gray-200 hover:border-gray-300'}`
                      }`}
                    >
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${tc.text}`}>Create your own</p>
                        <p className={`text-xs mt-1 ${tc.textMuted}`}>
                          Manually enter your targeting options
                        </p>
                      </div>
                      <Radio selected={audienceMode === 'custom'} onClick={() => { setAudienceMode('custom'); setShowAudienceDetails(true); }} />
                    </button>

                    {/* Custom Audience Expanded */}
                    {audienceMode === 'custom' && showAudienceDetails && (
                      <div className={`mt-3 p-4 rounded-xl space-y-4 border ${isDarkMode ? 'border-slate-700/50 bg-[#070A12]/50' : 'border-gray-200 bg-gray-50'}`}>

                        {/* Locations */}
                        <div>
                          <div className="flex items-center justify-between">
                            <label className={`text-sm font-semibold ${tc.text}`}>Locations</label>
                          </div>
                          <div className="mt-2 space-y-2">
                            {/* Multi-country selector */}
                            <div className="flex gap-2">
                              <select
                                className={`flex-1 px-3 py-2 rounded-lg text-sm border ${tc.input}`}
                                onChange={e => {
                                  if (e.target.value && !countries.includes(e.target.value)) {
                                    setCountries(prev => [...prev, e.target.value]);
                                  }
                                  e.target.value = '';
                                }}
                                defaultValue=""
                              >
                                <option value="" disabled>Add country...</option>
                                {COUNTRIES.filter(c => !countries.includes(c.code)).map(c => (
                                  <option key={c.code} value={c.code}>{c.name}</option>
                                ))}
                              </select>
                            </div>
                            {/* Selected countries tags */}
                            <div className="flex flex-wrap gap-1.5">
                              {countries.map(code => (
                                <span key={code} className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                                  isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-gray-200 text-gray-700'
                                }`}>
                                  <MapPin className="w-3 h-3" />
                                  {getCountryName(code)}
                                  <button onClick={() => setCountries(prev => prev.filter(c => c !== code))} className="ml-0.5 hover:text-red-400">
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>

                            {/* Regions */}
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Regions / States (optional)</label>
                              <div className="flex gap-2 mt-1">
                                <input
                                  type="text"
                                  value={regionInput}
                                  onChange={e => setRegionInput(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && regionInput.trim()) {
                                      setRegions(prev => [...prev, regionInput.trim()]);
                                      setRegionInput('');
                                    }
                                  }}
                                  placeholder="e.g. California, Maharashtra"
                                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm border ${tc.input}`}
                                />
                                <button
                                  onClick={() => { if (regionInput.trim()) { setRegions(prev => [...prev, regionInput.trim()]); setRegionInput(''); }}}
                                  className={`p-1.5 rounded-lg ${tc.btnSecondary}`}
                                ><Plus className="w-4 h-4" /></button>
                              </div>
                              {regions.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {regions.map((r, i) => (
                                    <span key={i} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-gray-200 text-gray-600'}`}>
                                      {r}
                                      <button onClick={() => setRegions(prev => prev.filter((_, idx) => idx !== i))}><X className="w-3 h-3" /></button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Cities */}
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Cities (optional)</label>
                              <div className="flex gap-2 mt-1">
                                <input
                                  type="text"
                                  value={cityInput}
                                  onChange={e => setCityInput(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && cityInput.trim()) {
                                      setCities(prev => [...prev, cityInput.trim()]);
                                      setCityInput('');
                                    }
                                  }}
                                  placeholder="e.g. New York, Mumbai"
                                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm border ${tc.input}`}
                                />
                                <button
                                  onClick={() => { if (cityInput.trim()) { setCities(prev => [...prev, cityInput.trim()]); setCityInput(''); }}}
                                  className={`p-1.5 rounded-lg ${tc.btnSecondary}`}
                                ><Plus className="w-4 h-4" /></button>
                              </div>
                              {cities.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {cities.map((c, i) => (
                                    <span key={i} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-gray-200 text-gray-600'}`}>
                                      {c}
                                      <button onClick={() => setCities(prev => prev.filter((_, idx) => idx !== i))}><X className="w-3 h-3" /></button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Excluded locations */}
                          <button
                            onClick={() => setShowExcludedLocations(!showExcludedLocations)}
                            className={`flex items-center gap-1 mt-2 text-xs font-medium ${isDarkMode ? 'text-blue-400' : 'text-blue-600'} hover:underline`}
                          >
                            <Minus className="w-3 h-3" />
                            {showExcludedLocations ? 'Hide' : 'Exclude locations'}
                          </button>
                          {showExcludedLocations && (
                            <div className="mt-2">
                              <select
                                className={`w-full px-3 py-2 rounded-lg text-sm border ${tc.input}`}
                                onChange={e => {
                                  if (e.target.value && !excludedCountries.includes(e.target.value)) {
                                    setExcludedCountries(prev => [...prev, e.target.value]);
                                  }
                                  e.target.value = '';
                                }}
                                defaultValue=""
                              >
                                <option value="" disabled>Exclude country...</option>
                                {COUNTRIES.filter(c => !excludedCountries.includes(c.code)).map(c => (
                                  <option key={c.code} value={c.code}>{c.name}</option>
                                ))}
                              </select>
                              {excludedCountries.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {excludedCountries.map(code => (
                                    <span key={code} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/10 text-red-400">
                                      {getCountryName(code)}
                                      <button onClick={() => setExcludedCountries(prev => prev.filter(c => c !== code))}><X className="w-3 h-3" /></button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Age range */}
                        <div>
                          <label className={`text-sm font-semibold ${tc.text}`}>Age</label>
                          <div className="flex items-center gap-3 mt-1.5">
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Minimum</label>
                              <input
                                type="number" min={13} max={65} value={ageMin}
                                onChange={e => setAgeMin(Number(e.target.value))}
                                className={`w-20 px-3 py-1.5 rounded-lg text-sm border text-center ${tc.input}`}
                              />
                            </div>
                            <span className={`mt-4 ${tc.textMuted}`}>to</span>
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Maximum</label>
                              <input
                                type="number" min={13} max={65} value={ageMax}
                                onChange={e => setAgeMax(Number(e.target.value))}
                                className={`w-20 px-3 py-1.5 rounded-lg text-sm border text-center ${tc.input}`}
                              />
                            </div>
                            <span className={`mt-4 text-xs ${tc.textMuted}`}>years old</span>
                          </div>
                        </div>

                        {/* Gender */}
                        <div>
                          <label className={`text-sm font-semibold ${tc.text}`}>Gender</label>
                          <div className="flex gap-2 mt-1.5">
                            {[{ v: 'all', l: 'All' }, { v: 'male', l: 'Men' }, { v: 'female', l: 'Women' }].map(g => (
                              <button
                                key={g.v}
                                onClick={() => setGender(g.v)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                  gender === g.v
                                    ? 'bg-[#ffcc29] text-[#070A12]'
                                    : isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                              >
                                {g.l}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Interest Targeting */}
                        <div>
                          <label className={`text-sm font-semibold ${tc.text}`}>Detailed targeting (interests)</label>
                          <div className="flex gap-2 mt-1.5">
                            <div className="flex-1 relative">
                              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
                              <input
                                type="text"
                                value={interestQuery}
                                onChange={e => setInterestQuery(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && searchInterests()}
                                placeholder="Search interests (e.g. fitness, travel)"
                                className={`w-full pl-9 pr-3 py-2 rounded-lg text-sm border ${tc.input}`}
                              />
                            </div>
                            <button
                              onClick={searchInterests}
                              disabled={searchingInterests || !interestQuery.trim()}
                              className={`px-3 py-2 rounded-lg text-sm font-medium ${tc.btnPrimary} disabled:opacity-50`}
                            >
                              {searchingInterests ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                            </button>
                          </div>
                          {interests.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {interests.slice(0, 15).map((interest: any) => {
                                const isSelected = selectedInterests.some(i => i.id === interest.id);
                                return (
                                  <button
                                    key={interest.id}
                                    onClick={() => {
                                      if (isSelected) setSelectedInterests(prev => prev.filter(i => i.id !== interest.id));
                                      else setSelectedInterests(prev => [...prev, interest]);
                                    }}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                      isSelected
                                        ? 'bg-[#ffcc29] text-[#070A12]'
                                        : isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    {interest.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {selectedInterests.length > 0 && (
                            <div className="mt-2">
                              <p className={`text-xs ${tc.textMuted} mb-1`}>{selectedInterests.length} interest(s) selected:</p>
                              <div className="flex flex-wrap gap-1">
                                {selectedInterests.map(i => (
                                  <span key={i.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[#ffcc29]/20 text-[#ffcc29]">
                                    {i.name}
                                    <button onClick={() => setSelectedInterests(prev => prev.filter(x => x.id !== i.id))}><X className="w-3 h-3" /></button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <Divider />

                  {/* ===== SECTION 4: BUDGET ===== */}
                  <div>
                    <h3 className={`text-base font-semibold mb-1 ${tc.text}`}>What's your ad budget?</h3>
                    <div className={`mt-3 p-4 rounded-xl border ${isDarkMode ? 'border-slate-700/50 bg-[#070A12]/50' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`text-2xl font-bold ${tc.text}`}>{currencySymbol}{dailyBudget} <span className="text-sm font-normal">daily</span></p>
                        </div>
                      </div>
                      {/* Budget Slider */}
                      <div className="mt-3">
                        <label className={`text-xs font-medium ${tc.textMuted}`}>Daily budget</label>
                        <p className={`text-sm ${tc.textSecondary} mb-2`}>Budget per day: {currencySymbol}{dailyBudget}</p>
                        <input
                          type="range"
                          min={minBudget}
                          max={maxBudget}
                          step={1}
                          value={dailyBudget}
                          onChange={e => setDailyBudget(Number(e.target.value))}
                          className="w-full h-2 rounded-full appearance-none cursor-pointer accent-[#ffcc29]"
                          style={{
                            background: `linear-gradient(to right, #ffcc29 ${((dailyBudget - minBudget) / (maxBudget - minBudget)) * 100}%, ${isDarkMode ? '#1e293b' : '#e5e7eb'} ${((dailyBudget - minBudget) / (maxBudget - minBudget)) * 100}%)`
                          }}
                        />
                        <div className="flex justify-between mt-1">
                          <span className={`text-xs ${tc.textMuted}`}>{currencySymbol}{minBudget}</span>
                          <span className={`text-xs ${tc.textMuted}`}>{currencySymbol}{maxBudget.toLocaleString()}</span>
                        </div>
                      </div>
                      {/* Bid amount */}
                      <div className="mt-3">
                        <label className={`text-xs font-medium ${tc.textMuted}`}>Max bid amount ({currencySymbol})</label>
                        <input
                          type="number" min={minBid} step={0.5} value={bidAmount}
                          onChange={e => setBidAmount(Number(e.target.value))}
                          className={`w-24 px-3 py-1.5 mt-1 rounded-lg text-sm border ${tc.input}`}
                        />
                      </div>
                    </div>
                  </div>

                  <Divider />

                  {/* ===== SECTION 5: DURATION ===== */}
                  <div>
                    <h3 className={`text-base font-semibold mb-3 ${tc.text}`}>Duration</h3>

                    {/* Run until paused */}
                    <button
                      onClick={() => setDurationType('ongoing')}
                      className={`w-full flex items-start gap-3 p-3.5 rounded-xl text-left transition-all ${
                        durationType === 'ongoing'
                          ? 'bg-[#ffcc29]/10 border-2 border-[#ffcc29]'
                          : `border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-gray-200 hover:border-gray-300'}`
                      }`}
                    >
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${tc.text}`}>Run this ad until I pause it</p>
                        <p className={`text-xs mt-0.5 ${tc.textMuted}`}>
                          Let your ad run for as long as you'd like. You can pause any time in ad tools.
                        </p>
                      </div>
                      <Radio selected={durationType === 'ongoing'} onClick={() => setDurationType('ongoing')} />
                    </button>

                    {/* Set duration */}
                    <button
                      onClick={() => setDurationType('set')}
                      className={`w-full flex items-start gap-3 p-3.5 mt-2 rounded-xl text-left transition-all ${
                        durationType === 'set'
                          ? 'bg-[#ffcc29]/10 border-2 border-[#ffcc29]'
                          : `border ${isDarkMode ? 'border-slate-700/50 hover:border-slate-600' : 'border-gray-200 hover:border-gray-300'}`
                      }`}
                    >
                      <div className="flex-1">
                        <p className={`text-sm font-semibold ${tc.text}`}>Set duration</p>
                        <p className={`text-xs mt-0.5 ${tc.textMuted}`}>
                          Choose specific start and end dates (minimum 30 hours)
                        </p>
                      </div>
                      <Radio selected={durationType === 'set'} onClick={() => setDurationType('set')} />
                    </button>

                    {durationType === 'set' && (
                      <div className={`mt-3 p-4 rounded-xl border ${isDarkMode ? 'border-slate-700/50 bg-[#070A12]/50' : 'border-gray-200 bg-gray-50'}`}>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className={`text-xs font-medium ${tc.textMuted}`}>Start date</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                              className={`w-full mt-1 px-3 py-2 rounded-lg text-sm border ${tc.input}`} />
                          </div>
                          <div>
                            <label className={`text-xs font-medium ${tc.textMuted}`}>End date</label>
                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                              min={startDate ? (() => { const d = new Date(startDate); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0]; })() : ''}
                              className={`w-full mt-1 px-3 py-2 rounded-lg text-sm border ${tc.input}`} />
                          </div>
                        </div>
                        {daysCount > 0 && (
                          <p className={`text-sm mt-3 ${tc.textSecondary}`}>
                            {daysCount} days &middot; Estimated total: <span className={`font-bold ${tc.text}`}>{currencySymbol}{(dailyBudget * daysCount).toFixed(2)}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <Divider />

                  {/* ===== SECTION 6: ADVANCED (Collapsible) ===== */}
                  <div>
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className={`flex items-center gap-2 w-full text-left`}
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''} ${tc.textMuted}`} />
                      <h3 className={`text-base font-semibold ${tc.text}`}>Advanced settings</h3>
                    </button>

                    {showAdvanced && (
                      <div className={`mt-3 p-4 rounded-xl space-y-4 border ${isDarkMode ? 'border-slate-700/50 bg-[#070A12]/50' : 'border-gray-200 bg-gray-50'}`}>

                        {/* Facebook Pixel */}
                        <div>
                          <div className="flex items-center gap-2">
                            <Target className={`w-4 h-4 ${tc.textMuted}`} />
                            <label className={`text-sm font-semibold ${tc.text}`}>Facebook Pixel tracking</label>
                          </div>
                          <input
                            type="text" value={pixelId} onChange={e => setPixelId(e.target.value)}
                            placeholder="Enter your Pixel ID (optional)"
                            className={`w-full mt-1.5 px-3 py-2 rounded-lg text-sm border ${tc.input}`}
                          />
                          <p className={`text-xs mt-1 ${tc.textMuted}`}>Track conversions from your boosted post</p>
                        </div>

                        {/* UTM Tags */}
                        <div>
                          <div className="flex items-center gap-2">
                            <Link2 className={`w-4 h-4 ${tc.textMuted}`} />
                            <label className={`text-sm font-semibold ${tc.text}`}>UTM tags</label>
                          </div>
                          <p className={`text-xs mb-2 ${tc.textMuted}`}>Add tracking parameters to your ad URL</p>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Source</label>
                              <input type="text" value={utmSource} onChange={e => setUtmSource(e.target.value)}
                                placeholder="e.g. facebook" className={`w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs border ${tc.input}`} />
                            </div>
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Medium</label>
                              <input type="text" value={utmMedium} onChange={e => setUtmMedium(e.target.value)}
                                placeholder="e.g. paid" className={`w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs border ${tc.input}`} />
                            </div>
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Campaign</label>
                              <input type="text" value={utmCampaign} onChange={e => setUtmCampaign(e.target.value)}
                                placeholder="e.g. boost" className={`w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs border ${tc.input}`} />
                            </div>
                          </div>
                        </div>

                        {/* DSA Compliance (EU) */}
                        <div>
                          <div className="flex items-center gap-2">
                            <Globe className={`w-4 h-4 ${tc.textMuted}`} />
                            <label className={`text-sm font-semibold ${tc.text}`}>DSA compliance (EU)</label>
                          </div>
                          <p className={`text-xs mb-2 ${tc.textMuted}`}>Required for ads shown in the European Union</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Beneficiary</label>
                              <input type="text" value={dsaBeneficiary} onChange={e => setDsaBeneficiary(e.target.value)}
                                placeholder="Ad beneficiary" className={`w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs border ${tc.input}`} />
                            </div>
                            <div>
                              <label className={`text-xs ${tc.textMuted}`}>Payor</label>
                              <input type="text" value={dsaPayor} onChange={e => setDsaPayor(e.target.value)}
                                placeholder="Ad payor" className={`w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs border ${tc.input}`} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <Divider />

                  {/* ===== SECTION 7: PAYMENT METHOD (Read-only from ad account) ===== */}
                  {selectedAccountData && (
                    <div>
                      <h3 className={`text-base font-semibold mb-2 ${tc.text}`}>Payment method</h3>
                      <div className={`flex items-center gap-3 p-3 rounded-xl border ${isDarkMode ? 'border-slate-700/50' : 'border-gray-200'}`}>
                        <CreditCard className={`w-5 h-5 ${tc.textMuted}`} />
                        <div className="flex-1">
                          {fundingInfo ? (
                            <p className={`text-sm ${tc.text}`}>
                              {fundingInfo.type || 'Payment method'} {fundingInfo.id ? `•••• ${fundingInfo.id.slice(-4)}` : ''}
                            </p>
                          ) : (
                            <p className={`text-sm ${tc.text}`}>Payment method linked in Meta Business</p>
                          )}
                          <p className={`text-xs ${tc.textMuted}`}>
                            Meta will charge this payment method directly. Currency: {accountCurrency}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ===== PAYMENT SUMMARY ===== */}
                  <div className={`p-4 rounded-xl border ${isDarkMode ? 'border-slate-700/50 bg-[#070A12]/50' : 'border-gray-200 bg-gray-50'}`}>
                    <h4 className={`text-sm font-semibold mb-2 ${tc.text}`}>Payment summary</h4>
                    <div className="space-y-1.5">
                      <div className="flex justify-between">
                        <span className={`text-sm ${tc.textSecondary}`}>Daily budget</span>
                        <span className={`text-sm font-medium ${tc.text}`}>{currencySymbol}{dailyBudget.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={`text-sm ${tc.textSecondary}`}>Duration</span>
                        <span className={`text-sm font-medium ${tc.text}`}>
                          {durationType === 'ongoing' ? 'Until paused' : `${daysCount} days`}
                        </span>
                      </div>
                      {durationType === 'set' && daysCount > 0 && (
                        <div className={`flex justify-between pt-1.5 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-gray-200'}`}>
                          <span className={`text-sm font-semibold ${tc.text}`}>Estimated total</span>
                          <span className="text-sm font-bold text-[#ffcc29]">{currencySymbol}{(dailyBudget * daysCount).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    <p className={`text-xs mt-3 ${tc.textMuted}`}>
                      {durationType === 'ongoing'
                        ? "Your ad will run until you pause it. You won't be charged until your ad is approved and starts running."
                        : "You won't be charged until your ad is approved and starts running."
                      }
                    </p>
                  </div>

                </div>
              )}
            </div>

            {/* Sticky Footer with Boost Button */}
            {adAccounts.length > 0 && (
              <div className={`p-4 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-gray-200'}`}>
                <button
                  onClick={handleBoost}
                  disabled={loading || !selectedAccount}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
                    loading || !selectedAccount
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-[#ffcc29] text-[#070A12] hover:bg-[#e6b800] active:scale-[0.98]'
                  }`}
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Megaphone className="w-5 h-5" />
                  )}
                  {loading ? 'Boosting...' : 'Boost post'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default BoostPostModal;
