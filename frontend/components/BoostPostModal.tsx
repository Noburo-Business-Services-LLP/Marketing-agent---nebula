import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import {
  X, Loader2, DollarSign, Calendar, Target, Users,
  Zap, ChevronRight, Check, AlertCircle, Search, Megaphone
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

type BoostStep = 'account' | 'targeting' | 'budget' | 'review';

const BoostPostModal: React.FC<BoostPostModalProps> = ({ isOpen, onClose, campaign }) => {
  const { isDarkMode } = useTheme();
  const tc = getThemeClasses(isDarkMode);

  const [step, setStep] = useState<BoostStep>('account');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Ad Account
  const [adAccounts, setAdAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Targeting
  const [objective, setObjective] = useState('OUTCOME_AWARENESS');
  const [interestQuery, setInterestQuery] = useState('');
  const [interests, setInterests] = useState<any[]>([]);
  const [selectedInterests, setSelectedInterests] = useState<any[]>([]);
  const [searchingInterests, setSearchingInterests] = useState(false);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [genders, setGenders] = useState<number[]>([]); // 1=male, 2=female

  // Budget & Schedule
  const [dailyBudget, setDailyBudget] = useState(5);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'instagram']);

  // Load ad accounts on open
  useEffect(() => {
    if (isOpen) {
      loadAdAccounts();
      setStep('account');
      setError('');
      setSuccess(false);
      // Set default dates: start = tomorrow, end = 7 days later
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
      console.log('Ad accounts raw response:', JSON.stringify(res));
      if (res?.success && res.accounts) {
        // Ayrshare may return { adAccounts: [...] } or data array or nested object
        let raw = res.accounts;
        if (raw.adAccounts) raw = raw.adAccounts;
        if (raw.data) raw = raw.data;
        const accounts = Array.isArray(raw) ? raw : [raw];
        console.log('Parsed accounts:', JSON.stringify(accounts));
        // Normalize — generate unique ID from all possible fields
        const normalized = accounts.map((a: any, idx: number) => {
          const uid = a.id || a.account_id || a.adAccountId || a.act_id || `acc_${idx}`;
          return {
            ...a,
            id: uid,
            name: a.name || a.account_name || `Ad Account ${uid}`,
          };
        });
        setAdAccounts(normalized);
        if (normalized.length === 1) setSelectedAccount(normalized[0].id);
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
    setLoading(true);
    setError('');
    try {
      const targeting: any = {};
      if (selectedInterests.length > 0) {
        targeting.interests = selectedInterests.map(i => ({ id: i.id, name: i.name }));
      }
      if (ageMin !== 18 || ageMax !== 65) {
        targeting.age_min = ageMin;
        targeting.age_max = ageMax;
      }
      if (genders.length > 0) {
        targeting.genders = genders;
      }

      const res = await apiService.boostPost({
        postId: campaign.socialPostId,
        adAccountId: selectedAccount,
        objective,
        dailyBudget,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        targeting: Object.keys(targeting).length > 0 ? targeting : undefined,
        platforms,
      });

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

  const objectives = [
    { value: 'OUTCOME_AWARENESS', label: 'Brand Awareness', desc: 'Show to people most likely to remember' },
    { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement', desc: 'Get more likes, comments, and shares' },
    { value: 'OUTCOME_TRAFFIC', label: 'Traffic', desc: 'Send people to your website' },
    { value: 'OUTCOME_LEADS', label: 'Leads', desc: 'Collect leads for your business' },
  ];

  const steps: { key: BoostStep; label: string; icon: React.ReactNode }[] = [
    { key: 'account', label: 'Account', icon: <Users className="w-4 h-4" /> },
    { key: 'targeting', label: 'Targeting', icon: <Target className="w-4 h-4" /> },
    { key: 'budget', label: 'Budget', icon: <DollarSign className="w-4 h-4" /> },
    { key: 'review', label: 'Review', icon: <Check className="w-4 h-4" /> },
  ];

  const stepIndex = steps.findIndex(s => s.key === step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl ${isDarkMode ? 'bg-[#0f1419]' : 'bg-white'}`}>
        {/* Header */}
        <div className={`sticky top-0 z-10 flex items-center justify-between p-5 border-b ${isDarkMode ? 'bg-[#0f1419] border-slate-700/50' : 'bg-white border-gray-200'}`}>
          <div>
            <h2 className={`text-lg font-bold ${tc.text}`}>Boost Post</h2>
            <p className={`text-sm ${tc.textSecondary} truncate max-w-[300px]`}>{campaign.name}</p>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        {!success && (
          <div className="flex items-center gap-1 px-5 pt-4">
            {steps.map((s, i) => (
              <React.Fragment key={s.key}>
                <button
                  onClick={() => i <= stepIndex && setStep(s.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    step === s.key
                      ? 'bg-[#ffcc29] text-[#070A12]'
                      : i < stepIndex
                        ? isDarkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-700'
                        : isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {i < stepIndex ? <Check className="w-3 h-3" /> : s.icon}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < steps.length - 1 && <ChevronRight className={`w-3 h-3 ${tc.textMuted}`} />}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-400" />
              </div>
              <h3 className={`text-xl font-bold ${tc.text}`}>Post Boosted!</h3>
              <p className={`text-sm mt-2 ${tc.textSecondary}`}>
                Your ad is being created. It may take a few minutes to go live after Meta review.
              </p>
              <button onClick={onClose} className={`mt-6 px-6 py-2.5 rounded-lg font-medium ${tc.btnPrimary}`}>
                Done
              </button>
            </div>
          ) : (
            <>
              {/* STEP 1: Account Selection */}
              {step === 'account' && (
                <div className="space-y-4">
                  <h3 className={`font-semibold ${tc.text}`}>Select Ad Account</h3>
                  {loadingAccounts ? (
                    <div className="flex items-center gap-2 py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-[#ffcc29]" />
                      <span className={tc.textSecondary}>Loading ad accounts...</span>
                    </div>
                  ) : adAccounts.length > 0 ? (
                    <div className="space-y-2">
                      {adAccounts.map((acc: any, idx: number) => {
                        const accId = acc.id || `acc_${idx}`;
                        return (
                          <button
                            key={accId}
                            onClick={() => setSelectedAccount(accId)}
                            className={`w-full flex items-center justify-between p-4 rounded-xl text-left transition-all ${
                              selectedAccount === accId
                                ? 'bg-[#ffcc29]/10 border-2 border-[#ffcc29]'
                                : tc.card + ' hover:border-[#ffcc29]/50'
                            }`}
                          >
                            <div>
                              <p className={`font-medium ${tc.text}`}>{acc.name}</p>
                              <p className={`text-xs ${tc.textMuted}`}>ID: {accId}</p>
                            </div>
                            {selectedAccount === accId && <Check className="w-5 h-5 text-[#ffcc29]" />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={`text-sm ${tc.textSecondary}`}>No ad accounts found. Make sure Facebook Business is connected.</p>
                  )}
                </div>
              )}

              {/* STEP 2: Targeting */}
              {step === 'targeting' && (
                <div className="space-y-5">
                  <div>
                    <h3 className={`font-semibold mb-3 ${tc.text}`}>Objective</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {objectives.map(obj => (
                        <button
                          key={obj.value}
                          onClick={() => setObjective(obj.value)}
                          className={`p-3 rounded-xl text-left transition-all ${
                            objective === obj.value
                              ? 'bg-[#ffcc29]/10 border-2 border-[#ffcc29]'
                              : tc.card + ' hover:border-[#ffcc29]/50'
                          }`}
                        >
                          <p className={`text-sm font-medium ${tc.text}`}>{obj.label}</p>
                          <p className={`text-xs mt-0.5 ${tc.textMuted}`}>{obj.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interests */}
                  <div>
                    <h3 className={`font-semibold mb-2 ${tc.text}`}>Interest Targeting</h3>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
                        <input
                          type="text"
                          value={interestQuery}
                          onChange={(e) => setInterestQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && searchInterests()}
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
                    {/* Interests results */}
                    {interests.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {interests.slice(0, 15).map((interest: any) => {
                          const isSelected = selectedInterests.some(i => i.id === interest.id);
                          return (
                            <button
                              key={interest.id}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedInterests(prev => prev.filter(i => i.id !== interest.id));
                                } else {
                                  setSelectedInterests(prev => [...prev, interest]);
                                }
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
                      <p className={`text-xs mt-1 ${tc.textMuted}`}>{selectedInterests.length} interest(s) selected</p>
                    )}
                  </div>

                  {/* Age & Gender */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={`text-sm font-medium ${tc.text}`}>Age Range</label>
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="number"
                          min={13}
                          max={65}
                          value={ageMin}
                          onChange={(e) => setAgeMin(Number(e.target.value))}
                          className={`w-16 px-2 py-1.5 rounded-lg text-sm border text-center ${tc.input}`}
                        />
                        <span className={tc.textMuted}>–</span>
                        <input
                          type="number"
                          min={13}
                          max={65}
                          value={ageMax}
                          onChange={(e) => setAgeMax(Number(e.target.value))}
                          className={`w-16 px-2 py-1.5 rounded-lg text-sm border text-center ${tc.input}`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className={`text-sm font-medium ${tc.text}`}>Gender</label>
                      <div className="flex gap-2 mt-1">
                        {[{ v: 1, l: 'Male' }, { v: 2, l: 'Female' }].map(g => (
                          <button
                            key={g.v}
                            onClick={() => setGenders(prev => prev.includes(g.v) ? prev.filter(x => x !== g.v) : [...prev, g.v])}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              genders.includes(g.v)
                                ? 'bg-[#ffcc29] text-[#070A12]'
                                : isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {g.l}
                          </button>
                        ))}
                        <button
                          onClick={() => setGenders([])}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            genders.length === 0
                              ? 'bg-[#ffcc29] text-[#070A12]'
                              : isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          All
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Budget & Schedule */}
              {step === 'budget' && (
                <div className="space-y-5">
                  <div>
                    <label className={`text-sm font-semibold ${tc.text}`}>Daily Budget (USD)</label>
                    <div className="relative mt-1">
                      <DollarSign className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tc.textMuted}`} />
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={dailyBudget}
                        onChange={(e) => setDailyBudget(Number(e.target.value))}
                        className={`w-full pl-8 pr-3 py-2.5 rounded-lg text-sm border ${tc.input}`}
                      />
                    </div>
                    <p className={`text-xs mt-1 ${tc.textMuted}`}>Minimum $1/day. Meta will charge your payment method directly.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={`text-sm font-semibold ${tc.text}`}>Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className={`w-full mt-1 px-3 py-2.5 rounded-lg text-sm border ${tc.input}`}
                      />
                    </div>
                    <div>
                      <label className={`text-sm font-semibold ${tc.text}`}>End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className={`w-full mt-1 px-3 py-2.5 rounded-lg text-sm border ${tc.input}`}
                      />
                    </div>
                  </div>

                  {startDate && endDate && (
                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                      <p className={`text-sm ${tc.textSecondary}`}>
                        Estimated total: <span className={`font-bold ${tc.text}`}>
                          ${(dailyBudget * Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000))).toFixed(2)}
                        </span> over {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)} days
                      </p>
                    </div>
                  )}

                  {/* Platforms */}
                  <div>
                    <label className={`text-sm font-semibold ${tc.text}`}>Platforms</label>
                    <div className="flex gap-2 mt-1">
                      {['facebook', 'instagram'].map(p => (
                        <button
                          key={p}
                          onClick={() => setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                            platforms.includes(p)
                              ? 'bg-[#ffcc29] text-[#070A12]'
                              : isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: Review */}
              {step === 'review' && (
                <div className="space-y-4">
                  <h3 className={`font-semibold ${tc.text}`}>Review & Boost</h3>
                  <div className={`rounded-xl p-4 space-y-3 ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Campaign</span>
                      <span className={`text-sm font-medium ${tc.text} max-w-[200px] truncate`}>{campaign.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Ad Account</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{selectedAccount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Objective</span>
                      <span className={`text-sm font-medium ${tc.text}`}>
                        {objectives.find(o => o.value === objective)?.label}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Daily Budget</span>
                      <span className={`text-sm font-medium ${tc.text}`}>${dailyBudget}/day</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Schedule</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{startDate} → {endDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Platforms</span>
                      <span className={`text-sm font-medium capitalize ${tc.text}`}>{platforms.join(', ')}</span>
                    </div>
                    {selectedInterests.length > 0 && (
                      <div className="flex justify-between">
                        <span className={`text-sm ${tc.textSecondary}`}>Interests</span>
                        <span className={`text-sm font-medium ${tc.text} max-w-[200px] truncate`}>
                          {selectedInterests.map(i => i.name).join(', ')}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className={`text-sm ${tc.textSecondary}`}>Age</span>
                      <span className={`text-sm font-medium ${tc.text}`}>{ageMin} – {ageMax}</span>
                    </div>
                    <div className={`pt-2 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-gray-200'}`}>
                      <div className="flex justify-between">
                        <span className={`text-sm font-semibold ${tc.text}`}>Est. Total</span>
                        <span className="text-sm font-bold text-[#ffcc29]">
                          ${(dailyBudget * Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000))).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation Buttons */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => {
                    const idx = steps.findIndex(s => s.key === step);
                    if (idx > 0) setStep(steps[idx - 1].key);
                  }}
                  disabled={step === 'account'}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tc.btnSecondary} disabled:opacity-30`}
                >
                  Back
                </button>

                {step === 'review' ? (
                  <button
                    onClick={handleBoost}
                    disabled={loading || !selectedAccount}
                    className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium ${tc.btnPrimary} disabled:opacity-50`}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Megaphone className="w-4 h-4" />
                    )}
                    {loading ? 'Boosting...' : 'Boost Now'}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      const idx = steps.findIndex(s => s.key === step);
                      if (idx < steps.length - 1) setStep(steps[idx + 1].key);
                    }}
                    disabled={step === 'account' && !selectedAccount}
                    className={`flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium ${tc.btnPrimary} disabled:opacity-50`}
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BoostPostModal;
