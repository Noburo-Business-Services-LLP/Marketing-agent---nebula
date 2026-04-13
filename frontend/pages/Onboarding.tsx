import React, { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { apiService } from '../services/api';
import { User, BusinessProfile, SocialConnection } from '../types';
import { ChevronRight, Check, Users, Megaphone, Sparkles, Loader2, Building, AlertCircle, Share2, Instagram, Facebook, Linkedin, Youtube, Pin, MessageCircle, SkipForward, Sun, Moon, Globe, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

// X (Twitter) logo SVG component
const XLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

interface OnboardingProps {
    onComplete: (user: User) => void;
}

// Storage key for persisting onboarding state
const ONBOARDING_STATE_KEY = 'nebulaa_onboarding_state';

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
    const { theme, toggleTheme } = useTheme();
    const location = useLocation();
    
    // Load saved state from sessionStorage
    const getSavedState = () => {
        try {
            const saved = sessionStorage.getItem(ONBOARDING_STATE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.error('Failed to load onboarding state:', e);
        }
        return null;
    };
    
    // Get company name from registration if available
    const getRegistrationCompany = () => {
        try {
            const company = sessionStorage.getItem('nebulaa_registration_company');
            if (company) {
                // Clear it after reading so it's only used once
                sessionStorage.removeItem('nebulaa_registration_company');
                return company;
            }
        } catch (e) {
            console.error('Failed to get registration company:', e);
        }
        return '';
    };
    
    const savedState = getSavedState();
    const registrationCompany = getRegistrationCompany();
    
    const [step, setStep] = useState(savedState?.step || 1);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [formData, setFormData] = useState<BusinessProfile>(savedState?.formData || {
        name: registrationCompany || '',
        website: '',
        gstNumber: '',
        industry: '',
        niche: '',
        businessType: '',
        businessLocation: '',
        targetAudience: '',
        brandVoice: [] as string[],
        marketingGoals: [],
        description: '',
        competitors: []
    });
    const [mobileNumber, setMobileNumber] = useState(savedState?.mobileNumber || '');

    // Competitor input state
    const [competitorInput, setCompetitorInput] = useState('');

    // Social connections state
    const [socialConnections, setSocialConnections] = useState<{platform: string; connected: boolean; username?: string}[]>(
        savedState?.socialConnections || [
            { platform: 'Instagram', connected: false },
            { platform: 'Facebook', connected: false },
            { platform: 'X', connected: false },
            { platform: 'LinkedIn', connected: false },
            { platform: 'YouTube', connected: false },
            { platform: 'Pinterest', connected: false },
            { platform: 'Reddit', connected: false },
        ]
    );
    const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
    const [loadingPlatform, setLoadingPlatform] = useState<string | null>(null);

    // Website analysis state
    const [analyzingWebsite, setAnalyzingWebsite] = useState(false);
    const [websiteStatus, setWebsiteStatus] = useState<'idle' | 'valid' | 'invalid' | 'analyzed'>(savedState?.websiteStatus || 'idle');
    const [websiteError, setWebsiteError] = useState<string | null>(null);

    // GST verification state
    const [verifyingGST, setVerifyingGST] = useState(false);
    const [gstStatus, setGstStatus] = useState<'idle' | 'valid' | 'invalid'>(savedState?.gstStatus || 'idle');
    const [gstError, setGstError] = useState<string | null>(null);
    const [gstInfo, setGstInfo] = useState<{ legalName?: string; tradeName?: string } | null>(null);

    // Duplicate detection state
    const [duplicateCheck, setDuplicateCheck] = useState<{
        show: boolean;
        matchedFields: string[];
        existingEmail: string;
    }>({ show: false, matchedFields: [], existingEmail: '' });

    // Save state to sessionStorage whenever it changes
    useEffect(() => {
        const stateToSave = {
            step,
            formData,
            socialConnections,
            websiteStatus
        };
        sessionStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(stateToSave));
    }, [step, formData, socialConnections, websiteStatus]);

    // Check for OAuth callback on mount
    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const errorParam = searchParams.get('error');
        const account = searchParams.get('account');
        
        // Check for successful connections for each platform
        const platforms = ['youtube', 'instagram', 'facebook', 'x', 'linkedin', 'pinterest', 'reddit'];
        for (const platform of platforms) {
            const status = searchParams.get(platform);
            if (status === 'connected') {
                const displayName = platform.charAt(0).toUpperCase() + platform.slice(1);
                setNotification({
                    type: 'success',
                    message: `${displayName}${account ? ` (${decodeURIComponent(account)})` : ''} connected successfully!`
                });
                // Update social connections state
                setSocialConnections(prev => prev.map(s => 
                    s.platform.toLowerCase() === platform 
                        ? { ...s, connected: true, username: account ? decodeURIComponent(account) : undefined } 
                        : s
                ));
                window.history.replaceState({}, '', window.location.pathname);
                // Set step to Connect (step 4) if we're coming back from OAuth
                setStep(4);
                break;
            }
        }
        
        if (errorParam) {
            let errorMessage = 'Failed to connect account.';
            switch (errorParam) {
                case 'access_denied':
                    errorMessage = 'You denied access to your account.';
                    break;
                case 'no_channel':
                    errorMessage = 'No channel found for this account.';
                    break;
                case 'token_exchange_failed':
                    errorMessage = 'Failed to authenticate. Please try again.';
                    break;
                case 'invalid_state':
                    errorMessage = 'Authentication session expired. Please try again.';
                    break;
            }
            setNotification({ type: 'error', message: errorMessage });
            window.history.replaceState({}, '', window.location.pathname);
            setStep(4);
        }
    }, [location.search]);

    // Auto-dismiss notifications
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    const handleChange = (field: keyof BusinessProfile, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setError(null);
        // Reset website status when URL changes
        if (field === 'website') {
            setWebsiteStatus('idle');
            setWebsiteError(null);
        }
        // Reset GST status when number changes
        if (field === 'gstNumber') {
            setGstStatus('idle');
            setGstError(null);
            setGstInfo(null);
        }
    };

    // Verify GST number against government database
    const verifyGSTNumber = useCallback(async () => {
        if (!formData.gstNumber || formData.gstNumber.length !== 15) return;
        setVerifyingGST(true);
        setGstError(null);
        try {
            const result = await apiService.verifyGST(formData.gstNumber);
            if (result.valid) {
                setGstStatus('valid');
                setGstInfo({ legalName: result.legalName, tradeName: result.tradeName });
                if (result.legalName && !formData.name) {
                    setFormData(prev => ({ ...prev, name: result.tradeName || result.legalName }));
                }
                if (result.fallback) {
                    setNotification({ type: 'success', message: 'GST format valid. Live verification unavailable — will retry later.' });
                } else {
                    setNotification({ type: 'success', message: `GST verified! Registered: ${result.tradeName || result.legalName}` });
                }
            } else {
                setGstStatus('invalid');
                setGstError(result.error || 'Invalid GST number');
            }
        } catch {
            setGstStatus('idle');
            setGstError('Could not verify GST. Please check and try again.');
        } finally {
            setVerifyingGST(false);
        }
    }, [formData.gstNumber, formData.name]);

    // Analyze website and auto-fill form
    const analyzeWebsite = useCallback(async () => {
        if (!formData.website || formData.website.length < 4) return;
        
        setAnalyzingWebsite(true);
        setWebsiteError(null);
        
        try {
            const result = await apiService.analyzeWebsite(formData.website);
            
            if (result.success && result.data) {
                
                // Auto-fill form with analyzed data including businessType and businessLocation
                // Handle brandVoice - ensure it's always an array
                const analyzedBrandVoice = result.data.brandVoice;
                let brandVoiceArray: string[] = [];
                if (Array.isArray(analyzedBrandVoice)) {
                    brandVoiceArray = analyzedBrandVoice;
                } else if (typeof analyzedBrandVoice === 'string' && analyzedBrandVoice) {
                    brandVoiceArray = [analyzedBrandVoice];
                } else if (Array.isArray(formData.brandVoice)) {
                    brandVoiceArray = formData.brandVoice;
                } else if (typeof formData.brandVoice === 'string' && formData.brandVoice) {
                    brandVoiceArray = [formData.brandVoice];
                }
                
                const newFormData = {
                    ...formData,
                    name: result.data.companyName || formData.name,
                    industry: result.data.industry || formData.industry,
                    niche: result.data.niche || formData.niche,
                    businessType: result.data.businessType || formData.businessType,
                    businessLocation: result.data.businessLocation || formData.businessLocation,
                    description: result.data.description || formData.description,
                    targetAudience: result.data.targetAudience || formData.targetAudience,
                    brandVoice: brandVoiceArray,
                    marketingGoals: result.data.suggestedGoals?.length > 0 ? result.data.suggestedGoals : formData.marketingGoals
                };
                
                setFormData(newFormData);
                
                // Store the full analysis for use throughout the app
                if (result.data) {
                    sessionStorage.setItem('nebulaa_website_analysis', JSON.stringify({
                        ...result.data,
                        analyzedAt: new Date().toISOString(),
                        websiteUrl: result.url
                    }));
                }
                
                setWebsiteStatus('analyzed');
                setNotification({ type: 'success', message: 'Website analyzed! Fields have been auto-filled.' });
            } else if (result.validUrl === false) {
                setWebsiteStatus('invalid');
                setWebsiteError(result.error || 'Invalid URL');
            } else {
                setWebsiteStatus('valid');
                setWebsiteError(result.error || 'Could not analyze website');
            }
        } catch (err) {
            setWebsiteStatus('valid');
            setWebsiteError('Could not connect to server');
        } finally {
            setAnalyzingWebsite(false);
        }
    }, [formData]);

    const toggleGoal = (goal: string) => {
        const current = formData.marketingGoals;
        if (current.includes(goal)) {
            handleChange('marketingGoals', current.filter(g => g !== goal));
        } else {
            handleChange('marketingGoals', [...current, goal]);
        }
    };

    const validateStep = (currentStep: number) => {
        if (currentStep === 1) {
            if (!formData.name || !formData.niche) return "Company Name and Niche are required.";
            if (!formData.businessType) return "Please select your business type (B2B, B2C, or Both).";
            if (!formData.businessLocation) return "Please enter your business location.";
            if (formData.gstNumber && formData.gstNumber.trim().length > 0) {
                if (formData.gstNumber.trim().length !== 15) return "GST number must be exactly 15 characters.";
                if (gstStatus === 'invalid') return "GST number is invalid. Please enter a valid GST number.";
            }
        }
        if (currentStep === 2) {
            // Brand voice is optional, no required fields
        }
        if (currentStep === 3) {
            if (formData.marketingGoals.length === 0) return "Please select at least one marketing goal.";
            // Competitors are optional - AI will auto-discover them
        }
        // Step 4 (socials) is optional - no validation needed
        return null;
    };

    const handleNext = () => {
        const validationError = validateStep(step);
        if (validationError) {
            setError(validationError);
            return;
        }
        setStep(prev => prev + 1);
    };

    // Social connection helpers - Real OAuth via Ayrshare
    const initiateConnection = async (platform: string) => {
        setLoadingPlatform(platform);
        setConnectingPlatform(platform);
        
        try {
            // Use universal OAuth endpoint for all platforms
            const response = await apiService.getPlatformAuthUrl(platform);
            
            if (response.success && response.authUrl) {
                // Redirect to the auth page (either platform OAuth or Ayrshare dashboard)
                window.location.href = response.authUrl;
            } else {
                // Some error occurred
                setNotification({ 
                    type: 'error', 
                    message: response.message || `Failed to initiate ${platform} connection.` 
                });
                setLoadingPlatform(null);
                setConnectingPlatform(null);
            }
        } catch (error: any) {
            console.error('OAuth connect error:', error);
            setNotification({ 
                type: 'error', 
                message: error.message || `Failed to connect to ${platform}.` 
            });
            setLoadingPlatform(null);
            setConnectingPlatform(null);
        }
    };

    const disconnectPlatform = async (platform: string) => {
        try {
            const response = await apiService.disconnectPlatform(platform);
            if (response.success) {
                setSocialConnections(socialConnections.map(s => 
                    s.platform === platform ? { ...s, connected: false, username: undefined } : s
                ));
                setNotification({ type: 'success', message: `${platform} disconnected successfully.` });
            }
        } catch (error) {
            setNotification({ type: 'error', message: `Failed to disconnect ${platform}.` });
        }
    };

    const getIcon = (platform: string) => {
        switch(platform) {
            case 'Instagram': return <Instagram className="w-5 h-5" />;
            case 'Facebook': return <Facebook className="w-5 h-5" />;
            case 'X': return <XLogo className="w-4 h-4" />;
            case 'LinkedIn': return <Linkedin className="w-5 h-5" />;
            case 'YouTube': return <Youtube className="w-5 h-5" />;
            case 'Pinterest': return <Pin className="w-5 h-5" />;
            case 'Reddit': return <MessageCircle className="w-5 h-5" />;
            default: return <Share2 className="w-5 h-5" />;
        }
    };

    const getBgColor = (platform: string) => {
        switch(platform) {
            case 'Instagram': return 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600';
            case 'Facebook': return 'bg-[#1877F2]';
            case 'X': return 'bg-black';
            case 'LinkedIn': return 'bg-[#0A66C2]';
            case 'YouTube': return 'bg-[#FF0000]';
            case 'Pinterest': return 'bg-[#BD081C]';
            case 'Reddit': return 'bg-[#FF4500]';
            default: return 'bg-gray-500';
        }
    };

    // Run duplicate check before completing onboarding
    const runDuplicateCheck = async (connectedSocials?: {platform: string; username?: string}[]) => {
        setSubmitting(true);
        try {
            const dupResult = await apiService.checkDuplicate(formData.name, formData.website, formData.gstNumber);
            if (dupResult.duplicate) {
                setDuplicateCheck({
                    show: true,
                    matchedFields: dupResult.matchedFields || [],
                    existingEmail: dupResult.existingEmail || ''
                });
                setSubmitting(false);
                return; // Block — don't complete onboarding
            }
            // No duplicate — proceed
            await finishOnboarding(connectedSocials);
        } catch (error) {
            console.error("Duplicate check failed", error);
            setError("Could not verify business details. Please try again.");
            setSubmitting(false);
        }
    };

    const finishOnboarding = async (connectedSocials?: {platform: string; username?: string}[]) => {
        try {
            const response = await apiService.completeOnboarding(formData, connectedSocials, mobileNumber);
            if (response.success && response.user) {
                sessionStorage.removeItem(ONBOARDING_STATE_KEY);
                onComplete(response.user);
            }
        } catch (error) {
            console.error("Onboarding failed", error);
            setError("Failed to save data. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmit = async () => {
        const connectedSocials = socialConnections
            .filter(s => s.connected)
            .map(s => ({ platform: s.platform, username: s.username }));
        await runDuplicateCheck(connectedSocials);
    };

    const handleSkipSocials = async () => {
        await runDuplicateCheck();
    };

    // Handle "Switch account" from duplicate modal
    const handleSwitchAccount = () => {
        localStorage.removeItem('authToken');
        sessionStorage.removeItem(ONBOARDING_STATE_KEY);
        window.location.href = '/#/login';
        window.location.reload();
    };

    const steps = [
        { num: 1, title: "Identity", icon: Building },
        { num: 2, title: "Audience", icon: Users },
        { num: 3, title: "Strategy", icon: Megaphone },
        { num: 4, title: "Connect", icon: Share2 }
    ];

    return (
        <div className={`min-h-screen flex items-center justify-center p-4 ${theme === 'dark' ? 'bg-[#070A12]' : 'bg-gray-100'}`}>
            {/* Duplicate Account Modal */}
            {duplicateCheck.show && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className={`max-w-md w-full mx-4 rounded-2xl p-8 shadow-2xl ${
                        theme === 'dark' ? 'bg-[#0d1117] border border-[#ffcc29]/20' : 'bg-white border border-gray-200'
                    }`}>
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                                <AlertCircle className="w-8 h-8 text-amber-500" />
                            </div>
                            <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                Account Already Exists
                            </h3>
                            <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-600'}`}>
                                A business with the same <strong>{duplicateCheck.matchedFields.join(', ')}</strong> is already registered
                                {duplicateCheck.existingEmail && <> under <strong>{duplicateCheck.existingEmail}</strong></>}.
                            </p>
                            <p className={`text-sm mt-2 ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-600'}`}>
                                Would you like to switch to that account?
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDuplicateCheck({ show: false, matchedFields: [], existingEmail: '' })}
                                className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-colors ${
                                    theme === 'dark'
                                        ? 'bg-white/5 hover:bg-white/10 text-[#ededed]/70 border border-white/10'
                                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                                }`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSwitchAccount}
                                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] transition-colors"
                            >
                                Switch Account
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Theme Toggle Button */}
            <button
                onClick={toggleTheme}
                className={`fixed top-4 right-4 p-3 rounded-full transition-all duration-300 z-50 ${
                    theme === 'dark' 
                        ? 'bg-[#1a1f2e] hover:bg-[#252b3d] text-yellow-400' 
                        : 'bg-white hover:bg-gray-100 text-gray-700 shadow-md'
                }`}
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <div className={`rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col md:flex-row min-h-[500px] ${
                theme === 'dark' ? 'bg-[#0d1117]' : 'bg-white'
            }`}>
                
                {/* Sidebar */}
                <div className="bg-[#ffcc29] p-8 text-white md:w-1/3 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center gap-3 font-bold text-xl mb-8 text-[#070A12]">
                            <img src="/assets/logo.png" alt="Nebulaa Gravity" className="w-10 h-10" />
                            <div className="text-left">
                                <div className="text-xl font-bold leading-tight">Nebulaa</div>
                                <div className="text-lg font-bold leading-tight">Gravity</div>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold mb-2 text-[#070A12]">Let's build your agent.</h2>
                        <p className="text-[#070A12]/70 text-sm">We need to understand your business to generate high-quality content.</p>
                    </div>

                    <div className="space-y-6 mt-8">
                        {steps.map((s) => (
                            <div key={s.num} className="flex items-center gap-3 opacity-90">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                                    step >= s.num ? 'bg-[#070A12] text-[#ffcc29] border-[#070A12]' : 'border-[#070A12]/50 text-[#070A12]/70'
                                }`}>
                                    {step > s.num ? <Check className="w-4 h-4" /> : s.num}
                                </div>
                                <span className={`font-medium ${step === s.num ? 'text-[#070A12]' : 'text-[#070A12]/70'}`}>{s.title}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Form Area */}
                <div className={`p-8 md:w-2/3 flex flex-col ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                    <div className="flex-1">
                        {error && (
                            <div className="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm mb-4 flex items-center gap-2 animate-in fade-in border border-red-500/30">
                                <AlertCircle className="w-4 h-4" /> {error}
                            </div>
                        )}

                        {step === 1 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>Business Essentials</h3>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>Company Name <span className="text-red-500">*</span></label>
                                    <input 
                                        type="text" 
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] ${
                                            theme === 'dark' 
                                                ? 'bg-[#070A12] border-[#ffcc29]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder="e.g. Gravity Corp"
                                        value={formData.name}
                                        onChange={e => handleChange('name', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>Mobile Number <span className="text-red-500">*</span></label>
                                    <input
                                        type="tel"
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#ffcc29]/30 text-[#ededed] placeholder-[#ededed]/40'
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder="e.g. +91 98765 43210"
                                        value={mobileNumber}
                                        onChange={e => setMobileNumber(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>Website</label>
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <input 
                                                type="text" 
                                                className={`w-full p-3 pr-10 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] ${
                                                    theme === 'dark' 
                                                        ? 'bg-[#070A12] border-[#ffcc29]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                                } ${websiteStatus === 'invalid' ? 'border-red-500' : websiteStatus === 'analyzed' ? 'border-emerald-500' : ''}`}
                                                placeholder="e.g. nike.com or https://nike.com"
                                                value={formData.website}
                                                onChange={e => handleChange('website', e.target.value)}
                                                onBlur={() => {
                                                    if (formData.website && formData.website.length > 3 && websiteStatus === 'idle') {
                                                        analyzeWebsite();
                                                    }
                                                }}
                                            />
                                            {/* Status indicator */}
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                {analyzingWebsite && <Loader2 className="w-5 h-5 animate-spin text-[#ffcc29]" />}
                                                {!analyzingWebsite && websiteStatus === 'analyzed' && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                                                {!analyzingWebsite && websiteStatus === 'invalid' && <XCircle className="w-5 h-5 text-red-500" />}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={analyzeWebsite}
                                            disabled={!formData.website || analyzingWebsite}
                                            className={`px-4 py-3 rounded-lg font-semibold text-sm flex items-center gap-2 transition-colors ${
                                                !formData.website || analyzingWebsite
                                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                    : 'bg-[#ffcc29] text-[#070A12] hover:bg-[#e6b825]'
                                            }`}
                                        >
                                            {analyzingWebsite ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /></>
                                            ) : (
                                                <><Globe className="w-4 h-4" /> Analyze</>
                                            )}
                                        </button>
                                    </div>
                                    {/* Status message */}
                                    {websiteStatus === 'analyzed' && (
                                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                                            <CheckCircle className="w-3 h-3" /> Website analyzed! Form auto-filled with detected info.
                                        </p>
                                    )}
                                    {websiteError && websiteStatus !== 'analyzed' && (
                                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" /> {websiteError}
                                        </p>
                                    )}
                                    {websiteStatus === 'idle' && formData.website && (
                                        <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                            Enter your website URL and click Analyze to auto-fill your business details
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>Niche <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#ffcc29]/30 text-[#ededed] placeholder-[#ededed]/40'
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder="e.g. Sustainable Fashion, AI SaaS, Organic Skincare"
                                        value={formData.niche}
                                        onChange={e => handleChange('niche', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-2 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>Business Type <span className="text-red-500">*</span></label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { value: 'B2B', label: 'B2B', desc: 'Business to Business' },
                                            { value: 'B2C', label: 'B2C', desc: 'Business to Consumer' },
                                            { value: 'Both', label: 'Both', desc: 'B2B & B2C' }
                                        ].map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleChange('businessType', option.value)}
                                                className={`p-3 rounded-lg border text-center transition-all ${
                                                    formData.businessType === option.value
                                                    ? 'border-[#ffcc29] bg-[#ffcc29]/10 text-[#ffcc29]'
                                                    : theme === 'dark' 
                                                        ? 'border-[#ededed]/20 hover:border-[#ffcc29]/50 text-[#ededed]/70'
                                                        : 'border-gray-200 hover:border-[#ffcc29]/50 text-gray-600'
                                                }`}
                                            >
                                                <div className="font-bold text-sm">{option.label}</div>
                                                <div className="text-xs opacity-70">{option.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>Business Location <span className="text-red-500">*</span></label>
                                    <input 
                                        type="text" 
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] ${
                                            theme === 'dark' 
                                                ? 'bg-[#070A12] border-[#ffcc29]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder="e.g. Chennai, Tamil Nadu or New York, USA"
                                        value={formData.businessLocation}
                                        onChange={e => handleChange('businessLocation', e.target.value)}
                                    />
                                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                        Enter the city/region where your business primarily operates
                                    </p>
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>GST Number <span className={`text-xs font-normal ${theme === 'dark' ? 'text-[#ededed]/40' : 'text-gray-400'}`}>(optional)</span></label>
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <input 
                                                type="text" 
                                                maxLength={15}
                                                className={`w-full p-3 pr-10 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] uppercase ${
                                                    theme === 'dark' 
                                                        ? 'bg-[#070A12] border-[#ffcc29]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                                } ${gstStatus === 'invalid' ? 'border-red-500' : gstStatus === 'valid' ? 'border-emerald-500' : ''}`}
                                                placeholder="e.g. 22AAAAA0000A1Z5"
                                                value={formData.gstNumber}
                                                onChange={e => handleChange('gstNumber', e.target.value.toUpperCase())}
                                            />
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                {verifyingGST && <Loader2 className="w-5 h-5 animate-spin text-[#ffcc29]" />}
                                                {!verifyingGST && gstStatus === 'valid' && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                                                {!verifyingGST && gstStatus === 'invalid' && <XCircle className="w-5 h-5 text-red-500" />}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={verifyGSTNumber}
                                            disabled={!formData.gstNumber || formData.gstNumber.length !== 15 || verifyingGST}
                                            className={`px-4 py-3 rounded-lg font-semibold text-sm flex items-center gap-2 transition-colors ${
                                                !formData.gstNumber || formData.gstNumber.length !== 15 || verifyingGST
                                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                                    : 'bg-[#ffcc29] text-[#070A12] hover:bg-[#e6b825]'
                                            }`}
                                        >
                                            {verifyingGST ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Verify</>}
                                        </button>
                                    </div>
                                    {gstStatus === 'valid' && gstInfo?.legalName && (
                                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                                            <CheckCircle className="w-3 h-3" /> Registered: {gstInfo.tradeName || gstInfo.legalName}
                                        </p>
                                    )}
                                    {gstError && (
                                        <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" /> {gstError}
                                        </p>
                                    )}
                                    {gstStatus === 'idle' && !gstError && (
                                        <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                            Optional — enter your 15-character GST number for business verification
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>Short Description</label>
                                    <textarea 
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] h-24 resize-none ${
                                            theme === 'dark' 
                                                ? 'bg-[#070A12] border-[#ffcc29]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder="What do you do?"
                                        value={formData.description}
                                        onChange={e => handleChange('description', e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>Brand Voice</h3>
                                <div>
                                    <label className={`block text-sm font-bold mb-2 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>Brand Voice <span className="text-xs font-normal opacity-60">(select multiple)</span></label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {['Professional', 'Friendly', 'Witty', 'Empathetic', 'Bold', 'Educational'].map(voice => {
                                            const isSelected = Array.isArray(formData.brandVoice) 
                                                ? formData.brandVoice.includes(voice)
                                                : formData.brandVoice === voice;
                                            return (
                                                <button
                                                    key={voice}
                                                    onClick={() => {
                                                        const currentVoices = Array.isArray(formData.brandVoice) 
                                                            ? formData.brandVoice 
                                                            : formData.brandVoice ? [formData.brandVoice] : [];
                                                        const newVoices = isSelected
                                                            ? currentVoices.filter(v => v !== voice)
                                                            : [...currentVoices, voice];
                                                        handleChange('brandVoice', newVoices);
                                                    }}
                                                    className={`p-3 rounded-lg border text-sm font-medium transition-all ${
                                                        isSelected 
                                                        ? 'border-[#ffcc29] bg-[#ffcc29]/10 text-[#ffcc29]' 
                                                        : theme === 'dark' 
                                                            ? 'border-[#ededed]/20 hover:border-[#ffcc29]/50 text-[#ededed]/70'
                                                            : 'border-gray-200 hover:border-[#ffcc29]/50 text-gray-600'
                                                    }`}
                                                >
                                                    {isSelected && <span className="mr-1">✓</span>}{voice}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {step === 3 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>Marketing Goals</h3>
                                <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-500'}`}>Select all that apply. This helps us prioritize actions. <span className="text-red-500">*</span></p>
                                
                                <div className="space-y-3">
                                    {[
                                        'Brand Awareness', 
                                        'Lead Generation', 
                                        'Direct Sales', 
                                        'Community Engagement', 
                                        'Website Traffic'
                                    ].map(goal => (
                                        <div 
                                            key={goal}
                                            onClick={() => toggleGoal(goal)}
                                            className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                                                formData.marketingGoals.includes(goal)
                                                ? 'border-[#ffcc29] bg-[#ffcc29]/10 shadow-sm'
                                                : theme === 'dark' 
                                                    ? 'border-[#ededed]/20 hover:border-[#ffcc29]/50'
                                                    : 'border-gray-200 hover:border-gray-300'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                                                     formData.marketingGoals.includes(goal) ? 'bg-[#ffcc29] border-[#ffcc29]' : theme === 'dark' ? 'border-[#ededed]/30' : 'border-gray-300'
                                                }`}>
                                                    {formData.marketingGoals.includes(goal) && <Check className="w-3 h-3 text-[#070A12]" />}
                                                </div>
                                                <span className={`font-medium ${formData.marketingGoals.includes(goal) ? 'text-[#ffcc29]' : theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{goal}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Competitors Section */}
                                <div className="mt-6 pt-6 border-t border-slate-700/50">
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>
                                        Your Competitors <span className={`text-xs font-normal ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-400'}`}>(optional)</span>
                                    </label>
                                    <p className={`text-xs mb-3 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                        Add specific competitors you'd like to track, or skip this — Gravity will automatically discover competitors based on your business and location.
                                    </p>
                                    <div className={`mb-3 p-3 rounded-lg flex items-start gap-2 ${theme === 'dark' ? 'bg-[#ffcc29]/10 border border-slate-700/50' : 'bg-yellow-50 border border-yellow-200'}`}>
                                        <span className="text-[#ffcc29] text-lg">✨</span>
                                        <p className={`text-xs ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
                                            <strong>AI-Powered Discovery:</strong> We'll automatically find and track your top competitors in {formData.businessLocation || 'your location'} based on your industry and target audience.
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            className={`flex-1 p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#ffcc29] ${
                                                theme === 'dark' 
                                                    ? 'bg-[#070A12] border-[#ffcc29]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                            }`}
                                            placeholder="e.g. Nike, Adidas, Puma"
                                            value={competitorInput}
                                            onChange={e => setCompetitorInput(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && competitorInput.trim()) {
                                                    e.preventDefault();
                                                    const current = formData.competitors || [];
                                                    if (!current.includes(competitorInput.trim())) {
                                                        handleChange('competitors', [...current, competitorInput.trim()]);
                                                    }
                                                    setCompetitorInput('');
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (competitorInput.trim()) {
                                                    const current = formData.competitors || [];
                                                    if (!current.includes(competitorInput.trim())) {
                                                        handleChange('competitors', [...current, competitorInput.trim()]);
                                                    }
                                                    setCompetitorInput('');
                                                }
                                            }}
                                            className="px-4 py-2 bg-[#ffcc29] text-[#070A12] rounded-lg font-bold hover:bg-[#e6b825] transition-colors"
                                        >
                                            Add
                                        </button>
                                    </div>
                                    
                                    {/* Competitor Tags */}
                                    {formData.competitors && formData.competitors.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {formData.competitors.map((comp, idx) => (
                                                <span 
                                                    key={idx}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#ffcc29]/20 text-[#ffcc29] rounded-full text-sm font-medium"
                                                >
                                                    {comp}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleChange('competitors', formData.competitors?.filter((_, i) => i !== idx))}
                                                        className="w-4 h-4 rounded-full bg-[#ffcc29]/30 hover:bg-[#ffcc29]/50 flex items-center justify-center text-[#070A12]"
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {step === 4 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>Connect Your Accounts</h3>
                                <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-500'}`}>
                                    Link your social media accounts to enable seamless publishing and analytics. 
                                    <span className="text-[#ffcc29] font-medium"> This step is optional.</span>
                                </p>

                                {/* Notification */}
                                {notification && (
                                    <div className={`p-3 rounded-lg flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-2 ${
                                        notification.type === 'success' 
                                            ? 'bg-green-500/10 border border-green-500/30 text-green-500' 
                                            : 'bg-red-500/10 border border-red-500/30 text-red-500'
                                    }`}>
                                        {notification.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                        {notification.message}
                                    </div>
                                )}
                                
                                <div className="space-y-3 max-h-[280px] overflow-y-auto pr-2">
                                    {socialConnections.map((social) => (
                                        <div 
                                            key={social.platform}
                                            className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
                                                social.connected
                                                ? 'border-green-500/50 bg-green-500/10'
                                                : theme === 'dark' 
                                                    ? 'border-[#ededed]/20 hover:border-[#ffcc29]/50'
                                                    : 'border-gray-200 hover:border-gray-300'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white ${getBgColor(social.platform)}`}>
                                                    {getIcon(social.platform)}
                                                </div>
                                                <div>
                                                    <span className={`font-medium ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>{social.platform}</span>
                                                    {social.connected && social.username && (
                                                        <p className="text-xs text-green-500">{social.username}</p>
                                                    )}
                                                </div>
                                            </div>
                                            {social.connected ? (
                                                <button
                                                    onClick={() => disconnectPlatform(social.platform)}
                                                    className="px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                                >
                                                    Disconnect
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => initiateConnection(social.platform)}
                                                    disabled={loadingPlatform === social.platform}
                                                    className="px-4 py-1.5 text-sm font-medium bg-[#ffcc29] text-[#070A12] rounded-lg hover:bg-[#e6b825] transition-colors flex items-center gap-2 disabled:opacity-70"
                                                >
                                                    {loadingPlatform === social.platform ? (
                                                        <>
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                            Connecting...
                                                        </>
                                                    ) : (
                                                        'Connect'
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {socialConnections.some(s => s.connected) && (
                                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2 text-green-500 text-sm">
                                        <Check className="w-4 h-4" />
                                        {socialConnections.filter(s => s.connected).length} account(s) connected
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className={`pt-6 mt-4 border-t flex justify-between items-center ${theme === 'dark' ? 'border-slate-700/50' : 'border-gray-200'}`}>
                        {step === 4 ? (
                            <>
                                <button 
                                    onClick={handleSkipSocials}
                                    disabled={submitting}
                                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50 ${
                                        theme === 'dark' ? 'text-[#ededed]/60 hover:text-[#ededed]' : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <SkipForward className="w-4 h-4" /> Skip for now
                                </button>
                                <button 
                                    onClick={handleSubmit}
                                    disabled={submitting}
                                    className="bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-[#ffcc29]/20 disabled:opacity-70"
                                >
                                    {submitting ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" /> Finalizing...
                                        </>
                                    ) : (
                                        <>
                                            Finish Setup <ChevronRight className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                            </>
                        ) : (
                            <>
                                <div></div>
                                <button 
                                    onClick={handleNext}
                                    disabled={submitting}
                                    className="bg-[#ffcc29] hover:bg-[#e6b825] text-[#070A12] px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-[#ffcc29]/20 disabled:opacity-70"
                                >
                                    Continue <ChevronRight className="w-5 h-5" />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Onboarding;