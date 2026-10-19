import AccountPrivacy from '../components/AccountPrivacy';
import { equivalentText } from '../utils/plans';
import React, { useState, useEffect } from 'react';
import PageHeader from '../components/PageHeader';
import { useSearchParams, Link } from 'react-router-dom';
import { Save, AlertCircle, Check, Loader2, Eye, EyeOff, Zap, RefreshCw, CreditCard, Download, ExternalLink } from 'lucide-react';
import { User, BillingData, BusinessProfile } from '../types';
import BillingDetailsForm from '../components/BillingDetailsForm';
import { tierLabel } from '../utils/plans';
import { isInsideClient } from '../utils/agency';
import { ACTION_LABELS, QUARK_GROUPS } from '../constants/quarks';
import { useQuarkPricing } from '../hooks/useQuarkCosts';
import { buildStrategyPdf } from '../utils/strategyPdf';
import { apiService, brandAssetsAPI } from '../services/api';
import { CONTENT_LANGUAGES } from '../constants/languages';
import AdditionalLanguagePicker from '../components/AdditionalLanguagePicker';
import BusinessProfileFields from '../components/BusinessProfileFields';
import { cleanSelection } from '../utils/languages';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import {
} from '../components/gravity';

interface SettingsProps {
  user: User | null;
  onUserUpdate: (user: User) => void;
}

// Defined here, not inside the page, so React keeps the same input between keystrokes
// (a component created inside render is rebuilt on every letter and drops the cursor).
const Field = ({ label, labelCls, children }: { label: string; labelCls: string; children: React.ReactNode }) => (
  <div>
    <label className={labelCls}>{label}</label>
    {children}
  </div>
);

const Settings: React.FC<SettingsProps> = ({ user, onUserUpdate }) => {
  // Inside a client workspace, payments, plans, passwords and deletion stay with the agency account.
  const insideClient = isInsideClient(user);
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  // `?tab=business` deep-links straight into the Business Profile tab — used
  // by the sidebar's account chip so clicking it lands somewhere useful
  // instead of always opening on the generic Profile tab.
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'business' ? 'Business Profile' : 'Profile';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [emailNotifications, setEmailNotifications] = useState(true);
  
  // API Status State
  const [apiStatus, setApiStatus] = useState<any>(null);
  const [loadingApiStatus, setLoadingApiStatus] = useState(false);
  
  // Profile Form State
  const [formData, setFormData] = useState({
      companyName: '',
      industry: '',
      email: '',
      firstName: '',
      lastName: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  // Password Form State
  const [passwordData, setPasswordData] = useState({
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
  });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordStatus, setPasswordStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [passwordStatusMessage, setPasswordStatusMessage] = useState('');
  const [showPasswords, setShowPasswords] = useState({
      current: false,
      new: false,
      confirm: false
  });

  // Billing State
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const { costs: quarkCosts, units: quarkUnits } = useQuarkPricing();
  const balanceNote = (n: number) => (equivalentText(n, quarkCosts) ? `, ${equivalentText(n, quarkCosts)}` : '');
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelNote, setCancelNote] = useState('');

  // Business Profile Form State (full onboarding questionnaire)
  const emptyBiz: BusinessProfile = {
    name: '', website: '', gstNumber: '', industry: '', problemSolved: '',
    niche: '', businessType: '', businessLocation: '', targetAudience: '',
    brandVoice: '', marketingGoals: [], description: '',
    yearsInBusiness: undefined, brandMaturity: '',
    targetCustomerProfile: '', targetGender: '', geographicReach: '',
    customerType: '', pricePositioning: '', keyDifferentiator: '',
    brandStory: '', heroProduct: '', contentLanguage: '', additionalLanguages: [],
    contentRestrictions: '', firstMonthContentAngles: '',
    contentCadence: { postsPerDay: 1, reelsPerWeek: 1 }
  };
  const [bizData, setBizData] = useState<BusinessProfile>(emptyBiz);
  const [bizStatus, setBizStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [bizError, setBizError] = useState('');
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [refreshState, setRefreshState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [refreshNote, setRefreshNote] = useState('');
  const handleRefreshBrand = async () => {
    setRefreshState('working');
    try {
      const r = await brandAssetsAPI.refreshBrand();
      const parts: string[] = [];
      if (r.changed?.length) parts.push('Your saved brand details now match what you wrote here.');
      else parts.push('Your saved brand details already matched what you wrote here.');
      if (r.hasWebsite) parts.push(r.siteRead ? 'Your website was read again.' : 'We could not read your website this time.');
      setRefreshNote(parts.join(' '));
      setRefreshState('done');
    } catch {
      setRefreshNote('We could not refresh your brand details. Please try again.');
      setRefreshState('error');
    }
  };

  // Fetch billing data when Billing tab is active
  useEffect(() => {
    if (activeTab === 'Billing' && !insideClient && !billingData) {
      setLoadingBilling(true);
      apiService.getBillingData()
        .then((res: BillingData) => setBillingData(res))
        .catch(() => {})
        .finally(() => setLoadingBilling(false));
    }
  }, [activeTab]);

  // Load user data when component mounts or user changes
  useEffect(() => {
    if (user) {
        setFormData({
          companyName: user.businessProfile?.name || (user as any).companyName || '',
          industry: user.businessProfile?.industry || '',
          email: user.email || '',
          firstName: user.firstName || '',
          lastName: user.lastName || ''
        });
      if (user.businessProfile) {
        setBizData({ ...emptyBiz, ...user.businessProfile });
      }
    }
  }, [user]);

  const handleBizChange = (field: keyof BusinessProfile, value: any) => {
    setBizData(prev => ({ ...prev, [field]: value }));
    setBizStatus('idle');
    setBizError('');
  };

  const handleBizSave = async () => {
    setBizStatus('saving');
    setBizError('');
    try {
      const response = await apiService.updateProfile({
        businessProfile: {
          ...user?.businessProfile,
          ...bizData,
          additionalLanguages: cleanSelection(bizData.additionalLanguages, bizData.contentLanguage)
        }
      });
      if (response.success && response.user) {
        onUserUpdate(response.user);
        setBizStatus('saved');
        setTimeout(() => setBizStatus('idle'), 2000);
      }
    } catch (error: any) {
      setBizStatus('error');
      setBizError(error.message || 'The business profile could not be saved.');
    }
  };

  const handleDownloadStrategyPDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const res = await apiService.getContentStrategy();
      if (!res.success || !res.html) throw new Error(res.error || 'The content strategy could not be generated.');

      // The AI's own styling is removed and the page is checked before it is saved (see utils/strategyPdf.ts).
      const blob = await buildStrategyPdf(res.html);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Nebulaa_Content_Strategy.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err: any) {
      console.error('Strategy PDF failed:', err?.message);
      alert('The strategy PDF could not be created right now. Please try again later.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleChange = (field: string, value: string) => {
      setFormData(prev => ({ ...prev, [field]: value }));
      if (errors[field]) {
          setErrors(prev => ({ ...prev, [field]: '' }));
      }
      setSaveStatus('idle');
      setSaveError('');
  };

  const handlePasswordChange = (field: string, value: string) => {
      setPasswordData(prev => ({ ...prev, [field]: value }));
      if (passwordErrors[field]) {
          setPasswordErrors(prev => ({ ...prev, [field]: '' }));
      }
      setPasswordStatus('idle');
      setPasswordStatusMessage('');
  };

  const validate = () => {
      const newErrors: Record<string, string> = {};
      if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
      if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
      if (!formData.email.includes('@') || !formData.email.includes('.')) newErrors.email = 'Please enter a valid email';
      
      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
  };

  const validatePassword = () => {
      const newErrors: Record<string, string> = {};
      if (!passwordData.currentPassword) newErrors.currentPassword = 'Current password is required';
      if (!passwordData.newPassword) {
          newErrors.newPassword = 'New password is required';
      } else if (passwordData.newPassword.length < 8) {
          newErrors.newPassword = 'Password must be at least 8 characters';
      }
      if (passwordData.newPassword !== passwordData.confirmPassword) {
          newErrors.confirmPassword = 'Passwords do not match';
      }
      
      setPasswordErrors(newErrors);
      return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
      if (!validate()) return;
      
      setSaveStatus('saving');
      setSaveError('');
      
      try {
          const response = await apiService.updateProfile({
              firstName: formData.firstName,
              lastName: formData.lastName,
              email: formData.email,
              businessProfile: {
                  ...user?.businessProfile,
                  name: formData.companyName,
                  industry: formData.industry
              }
          });
          
          if (response.success && response.user) {
              onUserUpdate(response.user);
              setSaveStatus('saved');
              setTimeout(() => setSaveStatus('idle'), 2000);
          }
      } catch (error: any) {
          setSaveStatus('error');
          setSaveError(error.message || 'Your changes could not be saved.');
      }
  };

  const handlePasswordSave = async () => {
      if (!validatePassword()) return;
      
      setPasswordStatus('saving');
      setPasswordStatusMessage('');
      
      try {
          await apiService.changePassword(passwordData.currentPassword, passwordData.newPassword);
          setPasswordStatus('saved');
          setPasswordStatusMessage('Your password was changed successfully.');
          setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
          setTimeout(() => {
              setPasswordStatus('idle');
              setPasswordStatusMessage('');
          }, 3000);
      } catch (error: any) {
          setPasswordStatus('error');
          setPasswordStatusMessage(error.message || 'Your password could not be changed.');
      }
  };

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="Settings"
        title="Manage your"
        emphasis="account"
        description={insideClient ? "Manage this client's profile and business details." : "Manage your profile, business details, notifications, security and billing in one place."}
      />

      {/* Same pill-shaped switcher as Create's Campaign/Single post/Carousel
          toggle — the one tab control style the whole app should share. */}
      {insideClient && (
        <p className="mb-4 text-[13px] text-[var(--gv-text-secondary)]">Payments, plans, passwords and account deletion are handled in your agency account.</p>
      )}
      <div className="mb-8 overflow-x-auto">
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/[0.03] border border-white/[0.06]">
          {['Profile', 'Business Profile', 'Notifications', 'Security', 'Billing'].filter(tab => !insideClient || (tab !== 'Security' && tab !== 'Billing')).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap h-9 px-5 rounded-full text-[13px] font-semibold transition-colors ${
                activeTab === tab ? 'bg-white/[0.10] text-[#F5F4F1]' : 'text-white/55 hover:text-white/80'
              }`}
            >
              {tab === 'Business Profile' ? 'Business profile' : tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
          {/* Content */}
          <div className="flex-1">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
                  {activeTab === 'Profile' && (
                      <div className="animate-in fade-in duration-300">
                          <h2 className="font-serif-display text-[22px] text-[#F5F4F1] mb-6">Profile settings</h2>
                          
                          <div className="space-y-6 mb-8">
                              <div className="grid grid-cols-2 gap-6">
                                  <div>
                                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">First Name</label>
                                      <input 
                                        type="text" 
                                        value={formData.firstName}
                                        onChange={e => handleChange('firstName', e.target.value)}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 transition-all ${
                                          errors.firstName 
                                            ? 'border-red-300 focus:ring-red-200' 
                                            : isDarkMode 
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                                        }`}
                                      />
                                      {errors.firstName && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {errors.firstName}</p>}
                                  </div>
                                  <div>
                                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Last Name</label>
                                      <input 
                                        type="text" 
                                        value={formData.lastName}
                                        onChange={e => handleChange('lastName', e.target.value)}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 transition-all ${
                                          errors.lastName 
                                            ? 'border-red-300 focus:ring-red-200' 
                                            : isDarkMode 
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                                        }`}
                                      />
                                      {errors.lastName && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {errors.lastName}</p>}
                                  </div>
                              </div>

                              <div className="grid grid-cols-2 gap-6">
                                  <div>
                                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Company Name</label>
                                      <input 
                                        type="text" 
                                        value={formData.companyName}
                                        onChange={e => handleChange('companyName', e.target.value)}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 transition-all ${
                                          isDarkMode 
                                            ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30' 
                                            : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                                        }`}
                                      />
                                  </div>
                                  <div>
                                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Industry</label>
                                      <input 
                                        type="text" 
                                        value={formData.industry}
                                        onChange={e => handleChange('industry', e.target.value)}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 transition-all ${
                                          isDarkMode 
                                            ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30' 
                                            : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                                        }`}
                                      />
                                  </div>
                              </div>
                              
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Email Address</label>
                                  <input 
                                    type="email" 
                                    value={formData.email}
                                    onChange={e => handleChange('email', e.target.value)}
                                    className={`w-full p-3 border rounded-lg outline-none focus:ring-2 transition-all ${
                                      errors.email 
                                        ? 'border-red-300 focus:ring-red-200' 
                                        : isDarkMode 
                                          ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30' 
                                          : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                                    }`}
                                  />
                                  {errors.email && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {errors.email}</p>}
                              </div>
                          </div>

                          <div className={`border-t pt-8 mb-8 ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
                              <h3 className="font-serif-display text-[20px] text-[#F5F4F1] mb-6">Preferences</h3>
                              <div className={`flex items-center justify-between p-4 rounded-lg border ${
                                isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                              }`}>
                                  <div>
                                      <p className={`font-bold ${theme.text}`}>Email Notifications</p>
                                      <p className={`text-sm ${theme.textSecondary}`}>Receive weekly digests and campaign alerts.</p>
                                  </div>
                                  <button 
                                    onClick={() => setEmailNotifications(!emailNotifications)}
                                    className={`w-12 h-6 rounded-full transition-colors relative ${emailNotifications ? 'bg-[#F5A623]' : isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`}
                                  >
                                      <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${emailNotifications ? 'left-7' : 'left-1'}`}></div>
                                  </button>
                              </div>
                          </div>

                          {saveError && (
                              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                                  <AlertCircle className="w-4 h-4" />
                                  {saveError}
                              </div>
                          )}

                          <button 
                            onClick={handleSave}
                            disabled={saveStatus === 'saving'}
                            className={`px-8 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all shadow-sm ${
                                saveStatus === 'saved' 
                                ? 'bg-green-600 text-white' 
                                : saveStatus === 'error'
                                ? 'bg-red-600 text-white'
                                : 'bg-[#F5A623] text-black hover:bg-[#F5A623]/80'
                            }`}
                          >
                              {saveStatus === 'saving' ? (
                                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                              ) : saveStatus === 'saved' ? (
                                  <><Check className="w-4 h-4" /> Changes saved</>
                              ) : saveStatus === 'error' ? (
                                  <><AlertCircle className="w-4 h-4" /> Save failed</>
                              ) : (
                                  <><Save className="w-4 h-4" /> Save changes</>
                              )}
                          </button>
                      </div>
                  )}

                  {activeTab === 'Business Profile' && (() => {
                    const inputCls = `w-full p-3 border rounded-lg outline-none focus:ring-2 transition-all ${
                      isDarkMode
                        ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30'
                        : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                    }`;
                    const labelCls = `block text-xs font-bold ${theme.textSecondary} uppercase tracking-wide mb-2`;
                    return (
                      <div className="animate-in fade-in duration-300">
                        <h2 className="font-serif-display text-[22px] text-[#F5F4F1] mb-2">Business profile</h2>
                        <p className={`text-sm mb-6 ${theme.textSecondary}`}>These are the answers Nebulaa uses to write your posts, plans and videos. Change anything that is out of date, then select Save business profile. After saving, use Refresh my brand details below so everything Nebulaa remembers matches.</p>

                        <BusinessProfileFields biz={bizData} onChange={handleBizChange} inputCls={inputCls} labelCls={labelCls} mutedCls={theme.textMuted} />

                        {bizError && (
                          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                            <AlertCircle className="w-4 h-4" /> {bizError}
                          </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-4 items-center">
                          <button
                            onClick={handleBizSave}
                            disabled={bizStatus === 'saving'}
                            className={`px-8 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${
                              bizStatus === 'saved' ? 'bg-green-600 text-white'
                              : bizStatus === 'error' ? 'bg-red-600 text-white'
                              : 'bg-[#F5A623] text-black hover:bg-[#F5A623]/80'
                            }`}
                          >
                            {bizStatus === 'saving' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>)
                            : bizStatus === 'saved' ? (<><Check className="w-4 h-4" /> Saved</>)
                            : bizStatus === 'error' ? (<><AlertCircle className="w-4 h-4" /> Failed</>)
                            : (<><Save className="w-4 h-4" /> Save business profile</>)}
                          </button>
                          
                          <button
                            onClick={handleDownloadStrategyPDF}
                            disabled={isGeneratingPDF}
                            className={`px-6 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 transition-all border ${
                              isDarkMode ? 'border-slate-700 hover:bg-slate-800 text-white' : 'border-slate-300 hover:bg-slate-50 text-black'
                            }`}
                          >
                            {isGeneratingPDF ? (<><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...</>) : (<><Download className="w-4 h-4" /> Content Strategy PDF</>)}
                          </button>
                        </div>

                        <div className={`mt-6 rounded-xl border p-4 ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                          <p className="font-bold text-[15px]">Changed something about your business?</p>
                          <p className="text-[13px] opacity-70 mt-1">Save your business profile first, then refresh. Nebulaa re-reads your website and updates what it remembers about your brand. It is free. Then rebuild your plans from the new details.</p>
                          <div className="flex flex-wrap items-center gap-3 mt-3">
                            <button
                              onClick={handleRefreshBrand}
                              disabled={refreshState === 'working'}
                              className={`px-5 py-2 rounded-lg font-bold flex items-center gap-2 border ${isDarkMode ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}
                            >
                              {refreshState === 'working' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Refreshing...</>) : (<><RefreshCw className="w-4 h-4" /> Refresh my brand details</>)}
                            </button>
                            {refreshState === 'done' && (
                              <>
                                <Link to="/plan?tab=calendar" className="text-[13px] font-semibold underline underline-offset-2">Regenerate your calendar</Link>
                                <Link to="/blueprint/new" className="text-[13px] font-semibold underline underline-offset-2">Run your Growth Blueprint again</Link>
                              </>
                            )}
                          </div>
                          {refreshNote && <p role="status" className="text-[13px] mt-2">{refreshNote}</p>}
                        </div>
                      </div>
                    );
                  })()}

                  {activeTab === 'Security' && !insideClient && (
                      <div className="animate-in fade-in duration-300">
                          <h2 className="font-serif-display text-[22px] text-[#F5F4F1] mb-6">Change password</h2>
                          
                          <div className="space-y-6 mb-8 max-w-md">
                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Current Password</label>
                                  <div className="relative">
                                      <input 
                                        type={showPasswords.current ? "text" : "password"}
                                        value={passwordData.currentPassword}
                                        onChange={e => handlePasswordChange('currentPassword', e.target.value)}
                                        className={`w-full p-3 pr-10 border rounded-lg outline-none focus:ring-2 transition-all ${
                                          passwordErrors.currentPassword 
                                            ? 'border-red-300 focus:ring-red-200' 
                                            : isDarkMode 
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                                        }`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                      >
                                        {showPasswords.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                      </button>
                                  </div>
                                  {passwordErrors.currentPassword && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {passwordErrors.currentPassword}</p>}
                              </div>

                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">New Password</label>
                                  <div className="relative">
                                      <input 
                                        type={showPasswords.new ? "text" : "password"}
                                        value={passwordData.newPassword}
                                        onChange={e => handlePasswordChange('newPassword', e.target.value)}
                                        className={`w-full p-3 pr-10 border rounded-lg outline-none focus:ring-2 transition-all ${
                                          passwordErrors.newPassword 
                                            ? 'border-red-300 focus:ring-red-200' 
                                            : isDarkMode 
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                                        }`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                      >
                                        {showPasswords.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                      </button>
                                  </div>
                                  {passwordErrors.newPassword && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {passwordErrors.newPassword}</p>}
                                  <p className="text-xs text-slate-400 mt-1">Must be at least 8 characters</p>
                              </div>

                              <div>
                                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Confirm New Password</label>
                                  <div className="relative">
                                      <input 
                                        type={showPasswords.confirm ? "text" : "password"}
                                        value={passwordData.confirmPassword}
                                        onChange={e => handlePasswordChange('confirmPassword', e.target.value)}
                                        className={`w-full p-3 pr-10 border rounded-lg outline-none focus:ring-2 transition-all ${
                                          passwordErrors.confirmPassword 
                                            ? 'border-red-300 focus:ring-red-200' 
                                            : isDarkMode 
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#F5A623]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#F5A623]'
                                        }`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                      >
                                        {showPasswords.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                      </button>
                                  </div>
                                  {passwordErrors.confirmPassword && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {passwordErrors.confirmPassword}</p>}
                              </div>
                          </div>

                          {passwordStatusMessage && (
                              <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
                                  passwordStatus === 'saved' 
                                  ? 'bg-green-50 border border-green-200 text-green-600' 
                                  : 'bg-red-50 border border-red-200 text-red-600'
                              }`}>
                                  {passwordStatus === 'saved' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                  {passwordStatusMessage}
                              </div>
                          )}

                          <button 
                            onClick={handlePasswordSave}
                            disabled={passwordStatus === 'saving'}
                            className="px-8 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all shadow-sm bg-[#F5A623] text-black hover:bg-[#F5A623]/80 disabled:opacity-50"
                          >
                              {passwordStatus === 'saving' ? (
                                  <><Loader2 className="w-4 h-4 animate-spin" /> Changing password...</>
                              ) : (
                                  <><Save className="w-4 h-4" /> Change password</>
                              )}
                          </button>
                          <AccountPrivacy onDeletionRequested={(purgeAfter) => onUserUpdate?.({ ...user, deletion: { status: 'pending', purgeAfter } })} />
                      </div>
                  )}

                  {activeTab === 'Notifications' && (
                      <div className={`text-center py-12 rounded-lg border border-dashed ${
                        isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}>
                          <p>Advanced notification settings are not available yet.</p>
                      </div>
                  )}

                  {activeTab === 'Billing' && !insideClient && (
                      <div className="animate-in fade-in duration-300">
                          <h2 className="font-serif-display text-[22px] text-[#F5F4F1] mb-6">Billing and invoices</h2>

                          {loadingBilling ? (
                            <div className="flex items-center justify-center py-16">
                              <Loader2 className="w-6 h-6 animate-spin text-[#F5A623]" />
                              <span className={`ml-3 ${theme.textSecondary}`}>Loading billing info...</span>
                            </div>
                          ) : billingData ? (
                            <div className="space-y-6">
                              {/* Current Plan */}
                              <div className={`p-5 rounded-lg border ${
                                isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                              }`}>
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Current Plan</p>
                                    <div className="flex items-center gap-3">
                                      <span className={`text-xl font-bold ${theme.text}`}>
                                        {tierLabel(billingData.plan?.tier)}
                                      </span>
                                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                        billingData.subscription.status === 'active'
                                          ? 'bg-green-500/20 text-green-400'
                                          : billingData.subscription.status === 'cancelled'
                                          ? 'bg-red-500/20 text-red-400'
                                          : 'bg-slate-500/20 text-slate-400'
                                      }`}>
                                        {billingData.subscription.status}
                                      </span>
                                    </div>
                                    {billingData.subscription.expiresAt && (
                                      <p className={`text-xs mt-1 ${theme.textSecondary}`}>
                                        Expires: {new Date(billingData.subscription.expiresAt).toLocaleDateString()}
                                      </p>
                                    )}
                                  </div>
                                  <a href="#/trial-expired" className="text-sm font-semibold text-[#F5A623] hover:underline">Plans and Quarks</a>
                                  <CreditCard className={`w-8 h-8 ${isDarkMode ? 'text-slate-600' : 'text-slate-300'}`} />
                                </div>

                                {/* Stop the plan: it runs to the end of the month already paid for and is not charged again. */}
                                {(billingData.plan?.tier === 'starter' || billingData.plan?.tier === 'professional') && (
                                  <div className="mt-4 border-t border-[var(--gv-border-subtle)] pt-4">
                                    {billingData.subscription.cancelAtPeriodEnd ? (
                                      <p className={`text-sm ${theme.text}`} role="status">
                                        Your plan will not renew.{' '}
                                        {billingData.subscription.endsAt ? `You can keep using it until ${new Date(billingData.subscription.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'You can keep using it until the end of the month you paid for.'}
                                      </p>
                                    ) : confirmingCancel ? (
                                      <div role="alertdialog" aria-labelledby="cancel-plan-title">
                                        <p id="cancel-plan-title" className={`text-sm font-semibold ${theme.text}`}>Cancel your plan?</p>
                                        <p className={`mt-1 text-sm ${theme.textSecondary}`}>
                                          You will not be charged again. You can keep using your plan{billingData.subscription.endsAt ? ` until ${new Date(billingData.subscription.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` : ' until the end of the month you paid for'}, and the Quarks that came with it until then. Used Quarks are not refunded. You can choose a plan again whenever you like.
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button type="button" disabled={cancelling} onClick={() => setConfirmingCancel(false)} className="rounded-lg border border-[var(--gv-border-default)] px-4 py-2 text-sm font-semibold">Keep my plan</button>
                                          <button
                                            type="button" disabled={cancelling}
                                            onClick={async () => {
                                              setCancelling(true); setCancelNote('');
                                              try {
                                                const r = await apiService.cancelSubscription();
                                                if (r && r.success) {
                                                  setBillingData((b) => (b ? { ...b, subscription: { ...b.subscription, cancelAtPeriodEnd: true, endsAt: r.endsAt || b.subscription.endsAt } } : b));
                                                  setConfirmingCancel(false);
                                                } else setCancelNote((r && r.message) || 'We could not cancel your plan just now. Please try again.');
                                              } catch (e: any) { setCancelNote((e && (e.data?.message || e.message)) || 'We could not cancel your plan just now. Please try again.'); }
                                              setCancelling(false);
                                            }}
                                            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                          >
                                            {cancelling && <Loader2 className="h-4 w-4 animate-spin" />} Yes, cancel my plan
                                          </button>
                                        </div>
                                        {cancelNote && <p className="mt-2 text-sm text-red-600" role="alert">{cancelNote}</p>}
                                      </div>
                                    ) : (
                                      <button type="button" onClick={() => setConfirmingCancel(true)} className={`text-sm font-semibold underline underline-offset-2 ${theme.textSecondary} hover:opacity-80`}>Cancel plan</button>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* GST details for the invoice */}
                              <div className={`p-5 rounded-lg border ${
                                isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                              }`}>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">GST details for your invoice</p>
                                <p className={`text-sm mb-4 ${theme.textSecondary}`}>Add your GSTIN to get a tax invoice in your business name. You can leave this empty and still pay.</p>
                                <BillingDetailsForm />
                              </div>

                              {/* Quarks */}
                              <div className={`p-5 rounded-lg border ${
                                isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                              }`}>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Quarks</p>
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <p className={`text-2xl font-bold ${theme.text}`}>{billingData.credits.balance}</p>
                                    <p className={`text-xs ${theme.textSecondary}`}>Remaining{balanceNote(billingData.credits.balance)}</p>
                                  </div>
                                  <div>
                                    <p className={`text-2xl font-bold ${theme.text}`}>{billingData.credits.totalUsed}</p>
                                    <p className={`text-xs ${theme.textSecondary}`}>Used</p>
                                  </div>
                                </div>
                              </div>

                              {/* What each action costs. Grouped the way the work is
                                  actually thought about — posts, carousels, video, edits —
                                  because a flat list of twelve keys is what made the old
                                  header popover unreadable. */}
                              <div className={`p-5 rounded-lg border ${
                                isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                              }`}>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Quark Costs</p>
                                <p className={`text-xs mb-4 ${theme.textSecondary}`}>
                                  Every price is per unit of work, so bigger jobs cost proportionally more.
                                </p>

                                <div className="space-y-4">
                                  {QUARK_GROUPS.map((group) => {
                                    const rows = group.actions.filter((a) => (quarkCosts[a] || 0) > 0);
                                    if (!rows.length) return null;
                                    return (
                                      <div key={group.title}>
                                        <div className="flex items-baseline justify-between gap-3 mb-1.5">
                                          <p className={`text-[13px] font-semibold ${theme.text}`}>{group.title}</p>
                                          {group.example && (
                                            <p className="text-[11px] text-slate-500 tabular-nums shrink-0">
                                              {group.example(quarkCosts)}
                                            </p>
                                          )}
                                        </div>
                                        <p className="text-[11.5px] text-slate-500 mb-2 leading-snug">{group.blurb}</p>
                                        <div className={`rounded-lg overflow-hidden border ${
                                          isDarkMode ? 'border-white/[0.06]' : 'border-slate-200'
                                        }`}>
                                          {rows.map((action, i) => (
                                            <div
                                              key={action}
                                              className={`flex items-center justify-between gap-3 px-3 py-2 ${
                                                isDarkMode ? 'bg-white/[0.03]' : 'bg-white'
                                              } ${i > 0 ? (isDarkMode ? 'border-t border-white/[0.06]' : 'border-t border-slate-100') : ''}`}
                                            >
                                              <span className={`text-[13px] truncate ${theme.textSecondary}`}>
                                                {ACTION_LABELS[action]?.icon} {ACTION_LABELS[action]?.label || action}
                                              </span>
                                              <span className="flex items-baseline gap-1.5 shrink-0">
                                                <span className={`text-[13px] font-semibold tabular-nums ${theme.text}`}>
                                                  {quarkCosts[action]}
                                                </span>
                                                {/* The unit is the whole point: "19" next to "Carousel"
                                                    reads as the price of a carousel, which it isn't. */}
                                                {quarkUnits[action] && (
                                                  <span className="text-[11px] text-slate-500 w-[62px] text-left">
                                                    {quarkUnits[action]}
                                                  </span>
                                                )}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {(quarkCosts.competitor_scrape === 0) && (
                                  <p className="text-[11.5px] text-slate-500 mt-4 pt-3 border-t border-slate-200/40">
                                    Competitor Intel is free.
                                  </p>
                                )}
                              </div>

                              {/* Payment History */}
                              <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Payment History</p>
                                {billingData.payments.length > 0 ? (
                                  <div className={`rounded-lg border overflow-hidden ${
                                    isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
                                  }`}>
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className={isDarkMode ? 'bg-slate-800/50' : 'bg-slate-50'}>
                                          <th className={`text-left px-4 py-3 font-medium ${theme.textSecondary}`}>Date</th>
                                          <th className={`text-left px-4 py-3 font-medium ${theme.textSecondary}`}>Amount</th>
                                          <th className={`text-left px-4 py-3 font-medium ${theme.textSecondary}`}>Quarks</th>
                                          <th className={`text-left px-4 py-3 font-medium ${theme.textSecondary}`}>Status</th>
                                          <th className={`text-left px-4 py-3 font-medium ${theme.textSecondary}`}>Invoice</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {billingData.payments.map((payment, idx) => (
                                          <tr key={payment.paymentId || idx} className={`border-t ${
                                            isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
                                          }`}>
                                            <td className={`px-4 py-3 ${theme.text}`}>
                                              {new Date(payment.paidAt).toLocaleDateString()}
                                            </td>
                                            <td className={`px-4 py-3 ${theme.text}`}>
                                              {payment.currency === 'INR' ? '\u20B9' : payment.currency} {payment.amount?.toLocaleString()}
                                            </td>
                                            <td className={`px-4 py-3 ${theme.text}`}>
                                              {payment.credits || '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                                payment.status === 'paid'
                                                  ? 'bg-green-500/20 text-green-400'
                                                  : payment.status === 'refunded'
                                                  ? 'bg-amber-500/20 text-amber-400'
                                                  : 'bg-red-500/20 text-red-400'
                                              }`}>
                                                {payment.status}
                                              </span>
                                            </td>
                                            <td className="px-4 py-3">
                                              {payment.invoiceUrl ? (
                                                <a
                                                  href={payment.invoiceUrl}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-[#F5A623] hover:text-[#F5A623]/80 flex items-center gap-1 text-xs font-medium"
                                                >
                                                  <ExternalLink className="w-3 h-3" /> View
                                                </a>
                                              ) : (
                                                <span className={theme.textSecondary}>—</span>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className={`text-center py-8 rounded-lg border border-dashed ${
                                    isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-400'
                                  }`}>
                                    <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-40" />
                                    <p>No payments have been made yet.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className={`text-center py-12 rounded-lg border border-dashed ${
                              isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-400'
                            }`}>
                              <p>Billing data could not be loaded. Please try again later.</p>
                            </div>
                          )}
                      </div>
                  )}
              </div>
          </div>
      </div>
    </div>
  );
};

export default Settings;