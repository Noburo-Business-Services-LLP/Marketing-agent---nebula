import React, { useState, useEffect } from 'react';
import { Save, AlertCircle, Check, Loader2, Eye, EyeOff, Zap, RefreshCw, CreditCard, Download, ExternalLink } from 'lucide-react';
import { User, BillingData, BusinessProfile } from '../types';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

interface SettingsProps {
  user: User | null;
  onUserUpdate: (user: User) => void;
}

const Settings: React.FC<SettingsProps> = ({ user, onUserUpdate }) => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [activeTab, setActiveTab] = useState('Profile');
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
  const [loadingBilling, setLoadingBilling] = useState(false);

  // Business Profile Form State (full onboarding questionnaire)
  const emptyBiz: BusinessProfile = {
    name: '', website: '', gstNumber: '', industry: '', problemSolved: '',
    niche: '', businessType: '', businessLocation: '', targetAudience: '',
    brandVoice: '', marketingGoals: [], description: '',
    yearsInBusiness: undefined, brandMaturity: '',
    targetCustomerProfile: '', targetGender: '', geographicReach: '',
    customerType: '', pricePositioning: '', keyDifferentiator: '',
    brandStory: '', heroProduct: '', contentLanguage: '',
    contentRestrictions: '', firstMonthContentAngles: ''
  };
  const [bizData, setBizData] = useState<BusinessProfile>(emptyBiz);
  const [bizStatus, setBizStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [bizError, setBizError] = useState('');

  // Fetch billing data when Billing tab is active
  useEffect(() => {
    if (activeTab === 'Billing' && !billingData) {
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
        companyName: user.companyName || user.businessProfile?.companyName || '',
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
        businessProfile: { ...user?.businessProfile, ...bizData }
      });
      if (response.success && response.user) {
        onUserUpdate(response.user);
        setBizStatus('saved');
        setTimeout(() => setBizStatus('idle'), 2000);
      }
    } catch (error: any) {
      setBizStatus('error');
      setBizError(error.message || 'Failed to save business profile');
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
              companyName: formData.companyName,
              businessProfile: {
                  ...user?.businessProfile,
                  companyName: formData.companyName,
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
          setSaveError(error.message || 'Failed to save changes');
      }
  };

  const handlePasswordSave = async () => {
      if (!validatePassword()) return;
      
      setPasswordStatus('saving');
      setPasswordStatusMessage('');
      
      try {
          await apiService.changePassword(passwordData.currentPassword, passwordData.newPassword);
          setPasswordStatus('saved');
          setPasswordStatusMessage('Password changed successfully!');
          setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
          setTimeout(() => {
              setPasswordStatus('idle');
              setPasswordStatusMessage('');
          }, 3000);
      } catch (error: any) {
          setPasswordStatus('error');
          setPasswordStatusMessage(error.message || 'Failed to change password');
      }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className={`text-2xl font-bold ${theme.text}`}>Settings</h1>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar Tabs */}
          <div className="w-full md:w-64 flex-shrink-0">
             <div className={`rounded-xl shadow-sm border p-2 space-y-1 ${theme.bgCard} ${
               isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
             }`}>
                {['Profile', 'Business Profile', 'Notifications', 'Security', 'Billing'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === tab 
                            ? 'bg-[#ffcc29]/20 text-[#ffcc29]' 
                            : `${theme.textSecondary} ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}`
                        }`}
                    >
                        {tab}
                    </button>
                ))}
             </div>
          </div>

          {/* Content */}
          <div className="flex-1">
              <div className={`rounded-xl shadow-sm border p-8 ${theme.bgCard} ${
                isDarkMode ? 'border-slate-700/50' : 'border-slate-200'
              }`}>
                  {activeTab === 'Profile' && (
                      <div className="animate-in fade-in duration-300">
                          <h2 className={`text-lg font-bold mb-6 ${theme.text}`}>Profile Settings</h2>
                          
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
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
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
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
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
                                            ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30' 
                                            : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
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
                                            ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30' 
                                            : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
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
                                          ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30' 
                                          : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
                                    }`}
                                  />
                                  {errors.email && <p className="text-red-500 text-xs mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {errors.email}</p>}
                              </div>
                          </div>

                          <div className={`border-t pt-8 mb-8 ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
                              <h3 className={`text-lg font-bold mb-6 ${theme.text}`}>Preferences</h3>
                              <div className={`flex items-center justify-between p-4 rounded-lg border ${
                                isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                              }`}>
                                  <div>
                                      <p className={`font-bold ${theme.text}`}>Email Notifications</p>
                                      <p className={`text-sm ${theme.textSecondary}`}>Receive weekly digests and campaign alerts.</p>
                                  </div>
                                  <button 
                                    onClick={() => setEmailNotifications(!emailNotifications)}
                                    className={`w-12 h-6 rounded-full transition-colors relative ${emailNotifications ? 'bg-[#ffcc29]' : isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`}
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
                                : 'bg-[#ffcc29] text-black hover:bg-[#ffcc29]/80'
                            }`}
                          >
                              {saveStatus === 'saving' ? (
                                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                              ) : saveStatus === 'saved' ? (
                                  <><Check className="w-4 h-4" /> Saved Successfully</>
                              ) : saveStatus === 'error' ? (
                                  <><AlertCircle className="w-4 h-4" /> Save Failed</>
                              ) : (
                                  <><Save className="w-4 h-4" /> Save Changes</>
                              )}
                          </button>
                      </div>
                  )}

                  {activeTab === 'Business Profile' && (() => {
                    const inputCls = `w-full p-3 border rounded-lg outline-none focus:ring-2 transition-all ${
                      isDarkMode
                        ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30'
                        : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
                    }`;
                    const labelCls = `block text-xs font-bold ${theme.textSecondary} uppercase tracking-wide mb-2`;
                    const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
                      <div>
                        <label className={labelCls}>{label}</label>
                        {children}
                      </div>
                    );
                    const industryOptions = ['Technology/SaaS', 'E-commerce/Retail', 'Food & Beverage', 'Fashion & Apparel', 'Beauty & Wellness', 'Healthcare', 'Education', 'Finance/Fintech', 'Real Estate', 'Travel & Hospitality', 'Media & Entertainment', 'Professional Services', 'Manufacturing', 'Automotive', 'Jewellery', 'Home & Furniture', 'Non-profit', 'Other'];
                    return (
                      <div className="animate-in fade-in duration-300">
                        <h2 className={`text-lg font-bold mb-2 ${theme.text}`}>Business Profile</h2>
                        <p className={`text-sm mb-6 ${theme.textSecondary}`}>All answers from your onboarding questionnaire. Edit any field and click Save.</p>

                        <div className="space-y-5 mb-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <Field label="Business Name">
                              <input className={inputCls} value={bizData.name || ''} onChange={e => handleBizChange('name', e.target.value)} />
                            </Field>
                            <Field label="Website">
                              <input className={inputCls} value={bizData.website || ''} onChange={e => handleBizChange('website', e.target.value)} placeholder="https://..." />
                            </Field>
                            <Field label="GST Number">
                              <input className={inputCls} value={bizData.gstNumber || ''} onChange={e => handleBizChange('gstNumber', e.target.value)} />
                            </Field>
                            <Field label="Business Vertical (Industry)">
                              <select className={inputCls} value={bizData.industry || ''} onChange={e => handleBizChange('industry', e.target.value)}>
                                <option value="">Select...</option>
                                {industryOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            </Field>
                            <Field label="Business Type">
                              <select className={inputCls} value={bizData.businessType || ''} onChange={e => handleBizChange('businessType', e.target.value)}>
                                <option value="">Select...</option>
                                <option value="B2B">B2B</option>
                                <option value="B2C">B2C</option>
                                <option value="Both">Both</option>
                              </select>
                            </Field>
                            <Field label="Business Location">
                              <input className={inputCls} value={bizData.businessLocation || ''} onChange={e => handleBizChange('businessLocation', e.target.value)} placeholder="City, State / Country" />
                            </Field>
                            <Field label="Years in Business">
                              <input type="number" min={0} className={inputCls} value={bizData.yearsInBusiness ?? ''} onChange={e => handleBizChange('yearsInBusiness', e.target.value === '' ? undefined : Number(e.target.value))} />
                            </Field>
                            <Field label="Brand Maturity">
                              <select className={inputCls} value={bizData.brandMaturity || ''} onChange={e => handleBizChange('brandMaturity', e.target.value)}>
                                <option value="">Select...</option>
                                <option value="established">Established</option>
                                <option value="growing">Growing</option>
                              </select>
                            </Field>
                          </div>

                          <Field label="Niche">
                            <input className={inputCls} value={bizData.niche || ''} onChange={e => handleBizChange('niche', e.target.value)} />
                          </Field>

                          <Field label="Problem You Solve">
                            <textarea className={`${inputCls} min-h-[80px]`} value={bizData.problemSolved || ''} onChange={e => handleBizChange('problemSolved', e.target.value)} />
                          </Field>

                          <Field label="Description">
                            <textarea className={`${inputCls} min-h-[80px]`} value={bizData.description || ''} onChange={e => handleBizChange('description', e.target.value)} />
                          </Field>

                          <Field label="Target Audience">
                            <textarea className={`${inputCls} min-h-[80px]`} value={bizData.targetAudience || ''} onChange={e => handleBizChange('targetAudience', e.target.value)} />
                          </Field>

                          <Field label="Target Customer Profile">
                            <textarea className={`${inputCls} min-h-[80px]`} value={bizData.targetCustomerProfile || ''} onChange={e => handleBizChange('targetCustomerProfile', e.target.value)} />
                          </Field>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <Field label="Target Gender">
                              <select className={inputCls} value={bizData.targetGender || ''} onChange={e => handleBizChange('targetGender', e.target.value)}>
                                <option value="">Select...</option>
                                <option value="mostly_men">Mostly Men</option>
                                <option value="mostly_women">Mostly Women</option>
                                <option value="both_equally">Both Equally</option>
                                <option value="families">Families</option>
                              </select>
                            </Field>
                            <Field label="Geographic Reach">
                              <select className={inputCls} value={bizData.geographicReach || ''} onChange={e => handleBizChange('geographicReach', e.target.value)}>
                                <option value="">Select...</option>
                                <option value="hyperlocal">Hyperlocal</option>
                                <option value="local_city">Local City</option>
                                <option value="regional">Regional</option>
                              </select>
                            </Field>
                            <Field label="Customer Type">
                              <select className={inputCls} value={bizData.customerType || ''} onChange={e => handleBizChange('customerType', e.target.value)}>
                                <option value="">Select...</option>
                                <option value="mostly_new">Mostly New</option>
                                <option value="mix_new_repeat">Mix of New & Repeat</option>
                                <option value="mostly_loyal">Mostly Loyal</option>
                              </select>
                            </Field>
                            <Field label="Price Positioning">
                              <select className={inputCls} value={bizData.pricePositioning || ''} onChange={e => handleBizChange('pricePositioning', e.target.value)}>
                                <option value="">Select...</option>
                                <option value="budget">Budget</option>
                                <option value="affordable">Affordable</option>
                                <option value="mid_range">Mid Range</option>
                                <option value="premium">Premium</option>
                                <option value="luxury">Luxury</option>
                              </select>
                            </Field>
                            <Field label="Content Language">
                              <select className={inputCls} value={bizData.contentLanguage || ''} onChange={e => handleBizChange('contentLanguage', e.target.value)}>
                                <option value="">Select...</option>
                                <option value="english">English</option>
                                <option value="tamil">Tamil</option>
                                <option value="tamil_english_mix">Tamil + English Mix</option>
                              </select>
                            </Field>
                            <Field label="Brand Voice">
                              <input className={inputCls} value={Array.isArray(bizData.brandVoice) ? bizData.brandVoice.join(', ') : (bizData.brandVoice || '')} onChange={e => handleBizChange('brandVoice', e.target.value)} placeholder="e.g. Professional, Witty" />
                            </Field>
                          </div>

                          <Field label="Marketing Goals (comma separated)">
                            <input className={inputCls} value={(bizData.marketingGoals || []).join(', ')} onChange={e => handleBizChange('marketingGoals', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} placeholder="Brand Awareness, Sales, Leads" />
                          </Field>

                          <Field label="Hero Product / Service">
                            <textarea className={`${inputCls} min-h-[70px]`} value={bizData.heroProduct || ''} onChange={e => handleBizChange('heroProduct', e.target.value)} />
                          </Field>

                          <Field label="Key Differentiator">
                            <textarea className={`${inputCls} min-h-[70px]`} value={bizData.keyDifferentiator || ''} onChange={e => handleBizChange('keyDifferentiator', e.target.value)} />
                          </Field>

                          <Field label="Brand Story">
                            <textarea className={`${inputCls} min-h-[100px]`} value={bizData.brandStory || ''} onChange={e => handleBizChange('brandStory', e.target.value)} />
                          </Field>

                          <Field label="Content Restrictions">
                            <textarea className={`${inputCls} min-h-[70px]`} value={bizData.contentRestrictions || ''} onChange={e => handleBizChange('contentRestrictions', e.target.value)} placeholder="Anything we should avoid?" />
                          </Field>

                          <Field label="First Month Content Angles">
                            <textarea className={`${inputCls} min-h-[80px]`} value={bizData.firstMonthContentAngles || ''} onChange={e => handleBizChange('firstMonthContentAngles', e.target.value)} />
                          </Field>
                        </div>

                        {bizError && (
                          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                            <AlertCircle className="w-4 h-4" /> {bizError}
                          </div>
                        )}

                        <button
                          onClick={handleBizSave}
                          disabled={bizStatus === 'saving'}
                          className={`px-8 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all shadow-sm ${
                            bizStatus === 'saved' ? 'bg-green-600 text-white'
                            : bizStatus === 'error' ? 'bg-red-600 text-white'
                            : 'bg-[#ffcc29] text-black hover:bg-[#ffcc29]/80'
                          }`}
                        >
                          {bizStatus === 'saving' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>)
                          : bizStatus === 'saved' ? (<><Check className="w-4 h-4" /> Saved</>)
                          : bizStatus === 'error' ? (<><AlertCircle className="w-4 h-4" /> Failed</>)
                          : (<><Save className="w-4 h-4" /> Save Business Profile</>)}
                        </button>
                      </div>
                    );
                  })()}

                  {activeTab === 'Security' && (
                      <div className="animate-in fade-in duration-300">
                          <h2 className={`text-lg font-bold mb-6 ${theme.text}`}>Change Password</h2>
                          
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
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
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
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
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
                                              ? 'bg-[#0d1117] border-slate-700/50 text-white focus:ring-[#ffcc29]/30' 
                                              : 'bg-white border-slate-300 text-slate-900 focus:ring-[#ffcc29]'
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
                            className="px-8 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all shadow-sm bg-[#ffcc29] text-black hover:bg-[#ffcc29]/80 disabled:opacity-50"
                          >
                              {passwordStatus === 'saving' ? (
                                  <><Loader2 className="w-4 h-4 animate-spin" /> Changing Password...</>
                              ) : (
                                  <><Save className="w-4 h-4" /> Change Password</>
                              )}
                          </button>
                      </div>
                  )}

                  {activeTab === 'Notifications' && (
                      <div className={`text-center py-12 rounded-lg border border-dashed ${
                        isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}>
                          <p>Advanced notification settings coming soon.</p>
                      </div>
                  )}

                  {activeTab === 'Billing' && (
                      <div className="animate-in fade-in duration-300">
                          <h2 className={`text-lg font-bold mb-6 ${theme.text}`}>Billing & Invoices</h2>

                          {loadingBilling ? (
                            <div className="flex items-center justify-center py-16">
                              <Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" />
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
                                        {billingData.subscription.plan.charAt(0).toUpperCase() + billingData.subscription.plan.slice(1)}
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
                                  <CreditCard className={`w-8 h-8 ${isDarkMode ? 'text-slate-600' : 'text-slate-300'}`} />
                                </div>
                              </div>

                              {/* Credits */}
                              <div className={`p-5 rounded-lg border ${
                                isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                              }`}>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Credits</p>
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <p className={`text-2xl font-bold ${theme.text}`}>{billingData.credits.balance}</p>
                                    <p className={`text-xs ${theme.textSecondary}`}>Remaining</p>
                                  </div>
                                  <div>
                                    <p className={`text-2xl font-bold ${theme.text}`}>{billingData.credits.totalUsed}</p>
                                    <p className={`text-xs ${theme.textSecondary}`}>Used</p>
                                  </div>
                                </div>
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
                                          <th className={`text-left px-4 py-3 font-medium ${theme.textSecondary}`}>Credits</th>
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
                                                  className="text-[#ffcc29] hover:text-[#ffcc29]/80 flex items-center gap-1 text-xs font-medium"
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
                                    <p>No payments yet.</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className={`text-center py-12 rounded-lg border border-dashed ${
                              isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-400'
                            }`}>
                              <p>Could not load billing data. Try again later.</p>
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