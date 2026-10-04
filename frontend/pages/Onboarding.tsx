import { ShowcasePanel, ShowcaseBanner } from '../components/onboarding/ShowcasePanel';
import StepGuide from '../components/onboarding/StepGuide';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { apiService } from '../services/api';
import { useOnboardingLang } from '../components/onboarding/useOnboardingLang';
import { fillTemplate, splitTemplate, getChoices } from '../components/onboarding/onboardingStrings';
import { INDIC_FONT_STACK } from '../components/onboarding/indicFonts';
import { User, BusinessProfile, SocialConnection } from '../types';
import { ChevronRight, Check, Users, Megaphone, Sparkles, Loader2, Building, AlertCircle, Share2, Instagram, Facebook, Linkedin, Youtube, Pin, MessageCircle, SkipForward, Sun, Moon, Globe, CheckCircle, XCircle, ExternalLink, ArrowLeft } from 'lucide-react';
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
    // Sign-up always uses the light, warm look of the Nebulaa website.
    const { toggleTheme } = useTheme();
    const theme = 'light' as 'light' | 'dark';
    const location = useLocation();
    // One language for the whole page. Only the words on screen change; the values saved stay in English.
    const { lang, t } = useOnboardingLang();
    const choices = useMemo(() => getChoices(lang), [lang]);
    const bold = (template: string, vars: Record<string, string | number>) =>
        splitTemplate(template, vars).map((p, n) => p.filled ? <strong key={n}>{p.text}</strong> : <React.Fragment key={n}>{p.text}</React.Fragment>);
    
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
        problemSolved: '',
        niche: '',
        businessType: 'Both',
        businessLocation: '',
        targetAudience: '',
        brandVoice: [] as string[],
        marketingGoals: [],
        description: '',
        competitors: [],
        yearsInBusiness: undefined,
        brandMaturity: '',
        // Moved from CSM Brand DNA — customer fills these during onboarding now
        heroProduct: '',
        targetCustomerProfile: '',
        targetGender: 'both_equally',
        geographicReach: 'local_city',
        customerType: 'mix_new_repeat',
        pricePositioning: '',
        keyDifferentiator: '',
        brandStory: '',
        contentLanguage: 'english',
        contentRestrictions: '',
        firstMonthContentAngles: '',
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
    // Free accounts cannot connect social accounts (it comes with the Publish and schedule add-on),
    // so the connect step shows a note for them and never calls the connect API.
    const [planTier, setPlanTier] = useState<string>('');
    useEffect(() => {
        apiService.getBillingData().then((b: any) => setPlanTier(b?.plan?.tier || '')).catch(() => {});
    }, []);
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
                    message: account
                        ? fillTemplate(t.connectedToastAccount, { platform: displayName, account: decodeURIComponent(account) })
                        : fillTemplate(t.connectedToast, { platform: displayName })
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
            let errorMessage = t.oauthFailed;
            switch (errorParam) {
                case 'access_denied':
                    errorMessage = t.oauthDenied;
                    break;
                case 'no_channel':
                    errorMessage = t.oauthNoChannel;
                    break;
                case 'token_exchange_failed':
                    errorMessage = t.oauthTokenFailed;
                    break;
                case 'invalid_state':
                    errorMessage = t.oauthSessionExpired;
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
                    setNotification({ type: 'success', message: 'GST format valid. Live verification is unavailable, so it will be checked again later.' });
                } else {
                    setNotification({ type: 'success', message: `GST verified. Registered: ${result.tradeName || result.legalName}` });
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
                setNotification({ type: 'success', message: t.websiteAnalyzedToast });
            } else if (result.validUrl === false) {
                setWebsiteStatus('invalid');
                setWebsiteError(result.error || t.websiteInvalid);
            } else {
                setWebsiteStatus('valid');
                setWebsiteError(result.error || t.websiteCouldNotAnalyze);
            }
        } catch (err) {
            setWebsiteStatus('valid');
            setWebsiteError(t.websiteNoServer);
        } finally {
            setAnalyzingWebsite(false);
        }
    }, [formData, t]);

    const toggleGoal = (goal: string) => {
        const current = formData.marketingGoals;
        if (current.includes(goal)) {
            handleChange('marketingGoals', current.filter(g => g !== goal));
        } else {
            handleChange('marketingGoals', [...current, goal]);
        }
    };

    // Only what we truly need to start. Everything else has a sensible default or is optional.
    const validateStep = (currentStep: number) => {
        if (currentStep === 1) {
            if (!formData.name || !formData.name.trim()) return t.errName;
            if (!mobileNumber || mobileNumber.replace(/\D/g, '').length < 10) return t.errMobile;
            if (!formData.industry) return t.errIndustry;
            if (!formData.businessLocation || !formData.businessLocation.trim()) return t.errCity;
        }
        if (currentStep === 2) {
            if (!formData.heroProduct || !formData.heroProduct.trim()) return t.errHero;
            if (!formData.targetCustomerProfile || !formData.targetCustomerProfile.trim()) return t.errWhoBuys;
        }
        if (currentStep === 3) {
            if (formData.marketingGoals.length === 0) return t.errGoal;
            if (!formData.contentLanguage) return t.errPostLanguage;
            // Competitors are optional: they are found automatically.
        }
        // Step 4 (social accounts) is optional.
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
                    message: response.message || fillTemplate(t.connectStartFailed, { platform }) 
                });
                setLoadingPlatform(null);
                setConnectingPlatform(null);
            }
        } catch (error: any) {
            console.error('OAuth connect error:', error);
            setNotification({ 
                type: 'error', 
                message: error.message || fillTemplate(t.connectFailedPlatform, { platform }) 
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
                setNotification({ type: 'success', message: fillTemplate(t.disconnectedToast, { platform }) });
            }
        } catch (error) {
            setNotification({ type: 'error', message: fillTemplate(t.disconnectFailed, { platform }) });
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
            setError(t.errVerify);
            setSubmitting(false);
        }
    };

    const finishOnboarding = async (connectedSocials?: {platform: string; username?: string}[]) => {
        try {
            // We ask fewer questions now, so fill the fields the rest of the app reads from the answers we have.
            const profile = {
                ...formData,
                // Tone is optional in sign-up now; fall back to the same default the backend uses.
                brandVoice: Array.isArray(formData.brandVoice) && formData.brandVoice.length ? formData.brandVoice : (formData.brandVoice || ['Professional']),
                niche: formData.niche || formData.heroProduct || '',
                targetAudience: formData.targetAudience || formData.targetCustomerProfile || '',
                description: formData.description || [formData.heroProduct, formData.targetCustomerProfile && `for ${formData.targetCustomerProfile}`].filter(Boolean).join(' '),
            };
            const response = await apiService.completeOnboarding(profile, connectedSocials, mobileNumber);
            if (response.success && response.user) {
                sessionStorage.removeItem(ONBOARDING_STATE_KEY);
                onComplete(response.user);
            }
        } catch (error) {
            console.error("Onboarding failed", error);
            setError(t.errSave);
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
        { num: 1, title: t.stepNames[0], icon: Building },
        { num: 2, title: t.stepNames[1], icon: Users },
        { num: 3, title: t.stepNames[2], icon: Megaphone },
        { num: 4, title: t.stepNames[3], icon: Share2 }
    ];
    // A wrong message from the other language must not stay on screen after a switch.
    useEffect(() => { setError(null); }, [lang]);
    const latin = lang === 'en';
    const indicStyle: React.CSSProperties = latin ? {} : { fontFamily: INDIC_FONT_STACK };

    const handleBackToLanding = () => {
        // Clear auth so App routes us to the public landing page
        try { localStorage.removeItem('authToken'); } catch {}
        try { sessionStorage.removeItem('onboardingState'); } catch {}
        window.location.assign('/#/');
        // Hash routes don't reload on hash change — force a full reload so App re-checks auth
        window.location.reload();
    };

    return (
        <div lang={lang} className="min-h-screen flex" style={{ ...indicStyle, background: 'linear-gradient(180deg, #FBF5EA 0%, #FFEBD6 100%)' }}>
            <ShowcasePanel />
            <div className="flex-1 min-w-0 flex items-start lg:items-center justify-center p-4 sm:p-6 lg:p-10">
            {/* Back to landing */}
            <button
                onClick={handleBackToLanding}
                className={`fixed top-4 left-4 lg:left-[calc(38%+1rem)] xl:left-[calc(40%+1rem)] z-50 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all backdrop-blur ${
                    theme === 'dark'
                        ? 'bg-[#ededed]/5 hover:bg-[#ededed]/10 text-[#ededed]/70 hover:text-[#ededed] border border-[#ededed]/10'
                        : 'bg-white/80 hover:bg-white text-gray-700 border border-gray-200 shadow-sm'
                }`}
            >
                <ArrowLeft className="w-4 h-4" />
                {t.back}
            </button>

            {/* Duplicate Account Modal */}
            {duplicateCheck.show && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className={`max-w-md w-full mx-4 rounded-2xl p-8 shadow-2xl ${
                        theme === 'dark' ? 'bg-[#0d1117] border border-[#F5A623]/20' : 'bg-white border border-gray-200'
                    }`}>
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                                <AlertCircle className="w-8 h-8 text-amber-500" />
                            </div>
                            <h3 className={`text-xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {t.dupTitle}
                            </h3>
                            <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-600'}`}>
                                {duplicateCheck.existingEmail
                                    ? bold(t.dupBody, { fields: duplicateCheck.matchedFields.join(', '), email: duplicateCheck.existingEmail })
                                    : bold(t.dupBodyNoEmail, { fields: duplicateCheck.matchedFields.join(', ') })}
                            </p>
                            <p className={`text-sm mt-2 ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-600'}`}>
                                {t.dupQuestion}
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
                                {t.cancel}
                            </button>
                            <button
                                onClick={handleSwitchAccount}
                                className="flex-1 py-3 rounded-xl font-semibold text-sm bg-[#F5A623] hover:bg-[#ffb833] text-[#070A12] transition-colors"
                            >
                                {t.dupSwitch}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="w-full max-w-xl pt-14 lg:pt-0">
                <ShowcaseBanner />

                <div className="flex items-center gap-3 mb-5">
                    <img src="/assets/logo-nebulaa.png" alt="Nebulaa" className="h-[42px] w-auto" />
                </div>
                <h1 className="mb-1" style={latin
                    ? { fontFamily: "'Archivo', 'Arial Narrow', Arial, sans-serif", fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.05, color: '#14203A', fontSize: 'clamp(28px, 4vw, 38px)' }
                    : { fontFamily: INDIC_FONT_STACK, fontWeight: 800, lineHeight: 1.35, color: '#14203A', fontSize: 'clamp(24px, 3.4vw, 32px)' }}>
                    {t.title}
                </h1>
                <p className="text-[14.5px] text-[#33405C] mb-5">{t.subtitle}</p>

                {/* Progress */}
                <div className="flex items-center gap-2 mb-5" aria-label={fillTemplate(t.progressLabel, { step, total: steps.length })}>
                    {steps.map((s) => {
                        const done = step > s.num;
                        const current = step === s.num;
                        return (
                            <div key={s.num} className="flex-1">
                                <div className={`h-1.5 rounded-full transition-all ${done || current ? 'bg-[#F5A623]' : 'bg-[#E5D8BF]'}`} />
                                <div className={`mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold ${current ? 'text-[#14203A]' : done ? 'text-[#6D6250]' : 'text-[#8F836E]'}`}>
                                    {done ? <Check className="w-3.5 h-3.5 text-[#1FA855]" /> : <span>{s.num}</span>}
                                    <span className="hidden sm:inline">{s.title}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <StepGuide step={step} />

                <div className="rounded-2xl w-full overflow-hidden flex flex-col bg-[#FFFDF8] border border-[#E5D8BF] shadow-[0_14px_34px_rgba(20,32,58,0.08)]">
                {/* Form Area */}
                <div className="p-6 sm:p-8 flex flex-col text-[#14203A]">
                    <div className="flex-1">
                        {error && (
                            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-4 flex items-center gap-2 animate-in fade-in border border-red-200">
                                <AlertCircle className="w-4 h-4" /> {error}
                            </div>
                        )}

                        {step === 1 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>{t.step1Heading}</h3>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.businessName} <span className="text-red-500">*</span></label>
                                    <input 
                                        type="text" 
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] ${
                                            theme === 'dark' 
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder={t.businessNamePlaceholder}
                                        value={formData.name}
                                        onChange={e => handleChange('name', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.mobile} <span className="text-red-500">*</span></label>
                                    <input
                                        type="tel"
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40'
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder={t.mobilePlaceholder}
                                        value={mobileNumber}
                                        onChange={e => setMobileNumber(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.website} <span className="text-xs font-normal text-gray-400">{t.optional}</span></label>
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <input 
                                                type="text" 
                                                className={`w-full p-3 pr-10 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] ${
                                                    theme === 'dark' 
                                                        ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                                } ${websiteStatus === 'invalid' ? 'border-red-500' : websiteStatus === 'analyzed' ? 'border-emerald-500' : ''}`}
                                                placeholder={t.websitePlaceholder}
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
                                                {analyzingWebsite && <Loader2 className="w-5 h-5 animate-spin text-[#F5A623]" />}
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
                                                    : 'bg-[#F5A623] text-[#070A12] hover:bg-[#ffb833]'
                                            }`}
                                        >
                                            {analyzingWebsite ? (
                                                <><Loader2 className="w-4 h-4 animate-spin" /></>
                                            ) : (
                                                <><Globe className="w-4 h-4" /> {t.analyze}</>
                                            )}
                                        </button>
                                    </div>
                                    {/* Status message */}
                                    {websiteStatus === 'analyzed' && (
                                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                                            <CheckCircle className="w-3 h-3" /> {t.websiteAnalyzedInline}
                                        </p>
                                    )}
                                    {websiteError && websiteStatus !== 'analyzed' && (
                                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" /> {websiteError}
                                        </p>
                                    )}
                                    {websiteStatus === 'idle' && formData.website && (
                                        <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                            {t.websiteHint}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.industry} <span className="text-red-500">*</span></label>
                                    <select
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed]'
                                                : 'bg-white border-gray-300 text-gray-900'
                                        }`}
                                        value={formData.industry || ''}
                                        onChange={e => handleChange('industry', e.target.value)}
                                    >
                                        <option value="">{t.chooseOne}</option>
                                        {choices.industries.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                        {t.industryHint}
                                    </p>
                                </div>
                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.city} <span className="text-red-500">*</span></label>
                                    <input 
                                        type="text" 
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] ${
                                            theme === 'dark' 
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder={t.cityPlaceholder}
                                        value={formData.businessLocation}
                                        onChange={e => handleChange('businessLocation', e.target.value)}
                                    />
                                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                        {t.cityHint}
                                    </p>
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>{t.step2Heading}</h3>

                                <div>
                                    <label className={`block text-sm font-bold mb-2 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.voiceLabel} <span className="text-xs font-normal opacity-60">{t.pickAny}</span></label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {choices.voices.map(({ value: voice, label: voiceLabel }) => {
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
                                                    className={`p-3 rounded-lg border text-sm font-medium break-words transition-all ${
                                                        isSelected
                                                        ? 'border-[#F5A623] bg-[#F5A623]/10 text-[#F5A623]'
                                                        : theme === 'dark'
                                                            ? 'border-[#ededed]/20 hover:border-[#F5A623]/50 text-[#ededed]/70'
                                                            : 'border-gray-200 hover:border-[#F5A623]/50 text-gray-600'
                                                    }`}
                                                >
                                                    {isSelected && <span className="mr-1">✓</span>}{voiceLabel}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>
                                        {t.heroProduct} <span className="text-red-500">*</span>
                                        <span className={`text-xs font-normal ml-2 ${theme === 'dark' ? 'text-[#ededed]/40' : 'text-gray-400'}`}>({(formData.heroProduct || '').length}/100)</span>
                                    </label>
                                    <input
                                        type="text"
                                        maxLength={100}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40'
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder={t.heroProductPlaceholder}
                                        value={formData.heroProduct || ''}
                                        onChange={e => handleChange('heroProduct', e.target.value as any)}
                                    />
                                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                        {t.heroProductHint}
                                    </p>
                                </div>

                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.whoBuys} <span className="text-red-500">*</span></label>
                                    <textarea
                                        rows={3}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] resize-none ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40'
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder={t.whoBuysPlaceholder}
                                        value={formData.targetCustomerProfile || ''}
                                        onChange={e => handleChange('targetCustomerProfile', e.target.value as any)}
                                    />
                                </div>

                                <div>
                                    <label className={`block text-sm font-bold mb-2 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.whoBuysMore} <span className="text-xs font-normal text-gray-400">{t.optional}</span></label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {choices.genders.map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleChange('targetGender', option.value as any)}
                                                className={`p-3 rounded-lg border text-center text-sm transition-all ${
                                                    formData.targetGender === option.value
                                                        ? 'border-[#F5A623] bg-[#F5A623]/10 text-[#F5A623]'
                                                        : theme === 'dark'
                                                            ? 'border-[#ededed]/20 hover:border-[#F5A623]/50 text-[#ededed]/70'
                                                            : 'border-gray-200 hover:border-[#F5A623]/50 text-gray-600'
                                                }`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>


                            </div>
                        )}

                        {step === 3 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>{t.step3Heading}</h3>
                                <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-500'}`}>{t.pickOneOrMore} <span className="text-red-500">*</span></p>
                                
                                <div className="space-y-3">
                                    {choices.goals.map(({ value: goal, label: goalLabel }) => (
                                        <div 
                                            key={goal}
                                            onClick={() => toggleGoal(goal)}
                                            className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                                                formData.marketingGoals.includes(goal)
                                                ? 'border-[#F5A623] bg-[#F5A623]/10 shadow-sm'
                                                : theme === 'dark' 
                                                    ? 'border-[#ededed]/20 hover:border-[#F5A623]/50'
                                                    : 'border-gray-200 hover:border-gray-300'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                                                     formData.marketingGoals.includes(goal) ? 'bg-[#F5A623] border-[#F5A623]' : theme === 'dark' ? 'border-[#ededed]/30' : 'border-gray-300'
                                                }`}>
                                                    {formData.marketingGoals.includes(goal) && <Check className="w-3 h-3 text-[#070A12]" />}
                                                </div>
                                                <span className={`font-medium ${formData.marketingGoals.includes(goal) ? 'text-[#F5A623]' : theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{goalLabel}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Competitors Section */}
                                <div className="mt-6 pt-6 border-t border-slate-700/50">
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>
                                        {t.competitors} <span className={`text-xs font-normal ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-400'}`}>{t.optional}</span>
                                    </label>
                                    <p className={`text-xs mb-3 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                        {t.competitorsHint}
                                    </p>
                                    <div className={`mb-3 p-3 rounded-lg flex items-start gap-2 ${theme === 'dark' ? 'bg-[#F5A623]/10 border border-slate-700/50' : 'bg-yellow-50 border border-yellow-200'}`}>
                                        <span className="text-[#F5A623] text-lg">✨</span>
                                        <p className={`text-xs ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
                                            <strong>{t.discoveryTitle}</strong> {fillTemplate(t.discoveryBody, { location: formData.businessLocation || t.discoveryLocationFallback })}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            className={`flex-1 p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] ${
                                                theme === 'dark' 
                                                    ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40' 
                                                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                            }`}
                                            placeholder={t.competitorsPlaceholder}
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
                                            className="px-4 py-2 bg-[#F5A623] text-[#070A12] rounded-lg font-bold hover:bg-[#ffb833] transition-colors"
                                        >
                                            {t.add}
                                        </button>
                                    </div>
                                    
                                    {/* Competitor Tags */}
                                    {formData.competitors && formData.competitors.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {formData.competitors.map((comp, idx) => (
                                                <span 
                                                    key={idx}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#F5A623]/20 text-[#F5A623] rounded-full text-sm font-medium"
                                                >
                                                    {comp}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleChange('competitors', formData.competitors?.filter((_, i) => i !== idx))}
                                                        className="w-4 h-4 rounded-full bg-[#F5A623]/30 hover:bg-[#F5A623]/50 flex items-center justify-center text-[#070A12]"
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>


                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>
                                        {t.differentiator} <span className="text-xs font-normal text-gray-400">{t.optional}</span>
                                        <span className={`text-xs font-normal ml-2 ${theme === 'dark' ? 'text-[#ededed]/40' : 'text-gray-400'}`}>({(formData.keyDifferentiator || '').length}/150)</span>
                                    </label>
                                    <input
                                        type="text"
                                        maxLength={150}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40'
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder={t.differentiatorPlaceholder}
                                        value={formData.keyDifferentiator || ''}
                                        onChange={e => handleChange('keyDifferentiator', e.target.value as any)}
                                    />
                                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                        {t.differentiatorHint}
                                    </p>
                                </div>


                                <div>
                                    <label className={`block text-sm font-bold mb-2 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.postLanguage} <span className="text-red-500">*</span></label>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {choices.contentLanguages.map(option => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleChange('contentLanguage', option.value as any)}
                                                className={`p-3 rounded-lg border text-center text-sm font-medium transition-all ${
                                                    formData.contentLanguage === option.value
                                                        ? 'border-[#F5A623] bg-[#F5A623]/10 text-[#F5A623]'
                                                        : theme === 'dark'
                                                            ? 'border-[#ededed]/20 hover:border-[#F5A623]/50 text-[#ededed]/70'
                                                            : 'border-gray-200 hover:border-[#F5A623]/50 text-gray-600'
                                                }`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>
                                        {t.restrictions} <span className={`text-xs font-normal ${theme === 'dark' ? 'text-[#ededed]/40' : 'text-gray-400'}`}>{t.optional}</span>
                                    </label>
                                    <textarea
                                        rows={3}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] resize-none ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40'
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder={t.restrictionsPlaceholder}
                                        value={formData.contentRestrictions || ''}
                                        onChange={e => handleChange('contentRestrictions', e.target.value as any)}
                                    />
                                </div>

                                <div>
                                    <label className={`block text-sm font-bold mb-1 ${theme === 'dark' ? 'text-[#ededed]/80' : 'text-gray-700'}`}>{t.upcoming} <span className="text-xs font-normal text-gray-400">{t.optional}</span></label>
                                    <textarea
                                        rows={3}
                                        className={`w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-[#F5A623] resize-none ${
                                            theme === 'dark'
                                                ? 'bg-[#070A12] border-[#F5A623]/30 text-[#ededed] placeholder-[#ededed]/40'
                                                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                                        }`}
                                        placeholder={t.upcomingPlaceholder}
                                        value={formData.firstMonthContentAngles || ''}
                                        onChange={e => handleChange('firstMonthContentAngles', e.target.value as any)}
                                    />
                                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-500'}`}>
                                        {t.upcomingHint}
                                    </p>
                                </div>
                            </div>
                        )}

                        {step === 4 && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>{t.step4Heading}</h3>
                                {planTier === 'free' ? (
                                    <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-500'}`}>
                                        {t.freeConnectNote}
                                    </p>
                                ) : (
                                <>
                                <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/60' : 'text-gray-500'}`}>
                                    {t.connectIntro}{' '}
                                    <span className="text-[#F5A623] font-medium">{t.connectOptional}</span>
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
                                                    ? 'border-[#ededed]/20 hover:border-[#F5A623]/50'
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
                                                    {t.disconnect}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => initiateConnection(social.platform)}
                                                    disabled={loadingPlatform === social.platform}
                                                    className="px-4 py-1.5 text-sm font-medium bg-[#F5A623] text-[#070A12] rounded-lg hover:bg-[#ffb833] transition-colors flex items-center gap-2 disabled:opacity-70"
                                                >
                                                    {loadingPlatform === social.platform ? (
                                                        <>
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                            {t.connecting}
                                                        </>
                                                    ) : (
                                                        t.connect
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {socialConnections.some(s => s.connected) && (
                                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2 text-green-500 text-sm">
                                        <Check className="w-4 h-4" />
                                        {fillTemplate(t.connectedCount, { n: socialConnections.filter(s => s.connected).length })}
                                    </div>
                                )}
                                </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className={`pt-6 mt-4 border-t flex flex-wrap gap-3 justify-between items-center ${theme === 'dark' ? 'border-slate-700/50' : 'border-gray-200'}`}>
                        {step === 4 ? (
                            <>
                                <button 
                                    onClick={handleSkipSocials}
                                    disabled={submitting}
                                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50 ${
                                        theme === 'dark' ? 'text-[#ededed]/60 hover:text-[#ededed]' : 'text-gray-500 hover:text-gray-700'
                                    }`}
                                >
                                    <SkipForward className="w-4 h-4" /> {t.skipForNow}
                                </button>
                                <button 
                                    onClick={handleSubmit}
                                    disabled={submitting}
                                    className="bg-[#F5A623] hover:bg-[#ffb833] text-[#070A12] px-5 sm:px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-[#F5A623]/20 disabled:opacity-70"
                                >
                                    {submitting ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin" /> {t.finalizing}
                                        </>
                                    ) : (
                                        <>
                                            {t.finishSetup} <ChevronRight className="w-5 h-5" />
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
                                    className="bg-[#F5A623] hover:bg-[#ffb833] text-[#070A12] px-5 sm:px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-[#F5A623]/20 disabled:opacity-70"
                                >
                                    {t.continue} <ChevronRight className="w-5 h-5" />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
            </div>
            </div>
        </div>
    );
};

export default Onboarding;