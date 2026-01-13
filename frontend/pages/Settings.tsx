import React, { useState, useEffect } from 'react';
import { Save, AlertCircle, Check, Loader2, Eye, EyeOff, Zap, RefreshCw } from 'lucide-react';
import { User } from '../types';
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
    }
  }, [user]);

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
                {['Profile', 'Integrations', 'Notifications', 'Security', 'Billing'].map(tab => (
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

                  {activeTab === 'Integrations' && (
                      <div className="animate-in fade-in duration-300">
                          <div className="flex items-center justify-between mb-6">
                              <div className="flex items-center gap-2">
                                  <Zap className="w-5 h-5 text-[#ffcc29]" />
                                  <h2 className={`text-lg font-bold ${theme.text}`}>API Integrations</h2>
                              </div>
                              <button
                                onClick={async () => {
                                  setLoadingApiStatus(true);
                                  try {
                                    const status = await apiService.checkApiStatus();
                                    setApiStatus(status.apis);
                                  } catch (e) {
                                    console.error('Failed to check API status:', e);
                                  }
                                  setLoadingApiStatus(false);
                                }}
                                disabled={loadingApiStatus}
                                className="px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 bg-[#ffcc29] text-black hover:bg-[#e6b825] transition-colors disabled:opacity-50"
                              >
                                {loadingApiStatus ? (
                                  <><Loader2 className="w-4 h-4 animate-spin" /> Checking...</>
                                ) : (
                                  <><RefreshCw className="w-4 h-4" /> Check Status</>
                                )}
                              </button>
                          </div>

                          <p className={`text-sm mb-6 ${theme.textSecondary}`}>
                            These APIs power real-time data fetching for competitor tracking, social media posting, and trend analysis.
                          </p>

                          <div className="space-y-4">
                            {/* Ayrshare */}
                            <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">A</div>
                                  <div>
                                    <p className={`font-semibold ${theme.text}`}>Ayrshare</p>
                                    <p className={`text-xs ${theme.textMuted}`}>Social media posting & scheduling</p>
                                  </div>
                                </div>
                                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                  apiStatus?.ayrshare?.connected 
                                    ? 'bg-emerald-100 text-emerald-700' 
                                    : apiStatus?.ayrshare 
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {apiStatus?.ayrshare?.connected ? '● Connected' : apiStatus?.ayrshare ? '○ Error' : '○ Not Checked'}
                                </div>
                              </div>
                              {apiStatus?.ayrshare?.error && (
                                <p className="text-xs text-red-500 mt-2">{apiStatus.ayrshare.error}</p>
                              )}
                            </div>

                            {/* Apify */}
                            <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-white font-bold text-sm">AP</div>
                                  <div>
                                    <p className={`font-semibold ${theme.text}`}>Apify</p>
                                    <p className={`text-xs ${theme.textMuted}`}>Web scraping for Instagram, Twitter, Facebook</p>
                                  </div>
                                </div>
                                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                  apiStatus?.apify?.connected 
                                    ? 'bg-emerald-100 text-emerald-700' 
                                    : apiStatus?.apify 
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {apiStatus?.apify?.connected ? '● Connected' : apiStatus?.apify ? '○ Error' : '○ Not Checked'}
                                </div>
                              </div>
                              {apiStatus?.apify?.error && (
                                <p className="text-xs text-red-500 mt-2">{apiStatus.apify.error}</p>
                              )}
                            </div>

                            {/* SearchAPI */}
                            <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-sm">S</div>
                                  <div>
                                    <p className={`font-semibold ${theme.text}`}>SearchAPI</p>
                                    <p className={`text-xs ${theme.textMuted}`}>Google trends & search results</p>
                                  </div>
                                </div>
                                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                  apiStatus?.searchapi?.connected 
                                    ? 'bg-emerald-100 text-emerald-700' 
                                    : apiStatus?.searchapi 
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {apiStatus?.searchapi?.connected ? '● Connected' : apiStatus?.searchapi ? '○ Error' : '○ Not Checked'}
                                </div>
                              </div>
                              {apiStatus?.searchapi?.error && (
                                <p className="text-xs text-red-500 mt-2">{apiStatus.searchapi.error}</p>
                              )}
                            </div>

                            {/* Gemini AI */}
                            <div className={`p-4 rounded-xl border ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">G</div>
                                  <div>
                                    <p className={`font-semibold ${theme.text}`}>Google Gemini AI</p>
                                    <p className={`text-xs ${theme.textMuted}`}>Content generation & analysis</p>
                                  </div>
                                </div>
                                <div className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                  ● Active
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className={`mt-6 p-4 rounded-lg ${isDarkMode ? 'bg-[#ffcc29]/10' : 'bg-[#ffcc29]/10'}`}>
                            <p className={`text-sm ${theme.text}`}>
                              <strong>💡 Tip:</strong> Click "Check Status" to verify all API connections are working. If any API shows an error, the system will fall back to AI-generated data.
                            </p>
                          </div>
                      </div>
                  )}

                  {(activeTab === 'Notifications' || activeTab === 'Billing') && (
                      <div className={`text-center py-12 rounded-lg border border-dashed ${
                        isDarkMode ? 'bg-[#0d1117] border-slate-700/50 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}>
                          <p>Advanced settings for {activeTab} coming soon.</p>
                      </div>
                  )}
              </div>
          </div>
      </div>
    </div>
  );
};

export default Settings;