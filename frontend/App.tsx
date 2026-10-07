import React, { useEffect, useState, useCallback, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import Layout from './components/Layout';
import ChatBot from './components/ChatBot';
import CampaignReminderPopup from './components/CampaignReminderPopup';
import BackgroundReelIndicator from './components/BackgroundReelIndicator';
import UploadAndSchedule from './pages/UploadAndSchedule';
import LandingPage from './pages/LandingPage';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import TrialExpired from './pages/TrialExpired';
import Dashboard from './pages/Dashboard';
import GravityHome from './pages/GravityHome';
import GravityCreate from './pages/GravityCreate';
import GravityApprove from './pages/GravityApprove';
import GravityCalendar from './pages/GravityCalendar';
import GravityInsights from './pages/GravityInsights';
import Campaigns from './pages/Campaigns';
import ContentCalendar from './pages/ContentCalendar';
import CalendarHome from './pages/CalendarHome';
import IdeaInbox from './pages/IdeaInbox';
import SocialInbox from './pages/SocialInbox';
import CsmClients from './pages/CsmClients';
import StaffLayout from './pages/staff/StaffLayout';
import { landingPath } from './utils/staffHome';
import ReelGenerator from './pages/ReelGenerator';
import HeroVideo from './pages/HeroVideo';
import AdCampaigns from './pages/AdCampaigns';
import Competitors from './pages/Competitors';
import ConnectSocials from './pages/ConnectSocials';
import BrandAssets from './pages/BrandAssets';
import Inventory from './pages/Inventory';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import SEOAssistant from './pages/SEOAssistant';
import AIMemory from './pages/AIMemory';
import AIHistory from './pages/AIHistory';
import AIPerformance from './pages/AIPerformance';
import InfluencerPortal from './pages/InfluencerPortal';
import InfluencerList from './pages/InfluencerList';
import Collaborations from './pages/Collaborations';
import SubmissionReview from './pages/SubmissionReview';
import InfluencerAnalytics from './pages/InfluencerAnalytics';
import InfluencerProfile from './pages/InfluencerProfile';
import TermsAndConditions from './pages/TermsAndConditions';
import PrivacyPolicy from './pages/PrivacyPolicy';
import BlueprintRoutes from './pages/BlueprintRoutes';
import { postAuthTarget, BLUEPRINT_SIGNUP_PATH } from './utils/blueprint';
import { ThemeProvider } from './context/ThemeContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { apiService } from './services/api';
import { User } from './types';
import { Loader2 } from 'lucide-react';

// Calls onChange after every route change (not on first render). Must sit inside the Router.
const RouteChangeWatcher: React.FC<{ onChange: () => void }> = ({ onChange }) => {
  const { pathname } = useLocation();
  const cb = useRef(onChange);
  cb.current = onChange;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    cb.current();
  }, [pathname]);
  return null;
};

// A signed-in visitor who opens the sign-up link from the ad goes to the Blueprint form, not the dashboard.
const LoginRedirect: React.FC = () => {
  const [params] = useSearchParams();
  return <Navigate to={postAuthTarget(params.toString())} replace />;
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [trialExpired, setTrialExpired] = useState<{ expired: boolean; reason: 'time' | 'credits' }>({ expired: false, reason: 'time' });

  // Check for existing token on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('authToken');
      if (token) {
        try {
          const res = await apiService.getCurrentUser();
          setUser(res.user || null);
          
          // Credits check only (no time-based expiry)
          if (res.user && (res.user.credits?.balance ?? 100) <= 0) {
            setTrialExpired({ expired: true, reason: 'credits' });
          }
        } catch (error) {
          console.error("Auth check failed", error);
          localStorage.removeItem('authToken');
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  // The paywall replaces EVERY route, so for credits it must only stand while the balance is
  // really empty (the same rule checkAuth applies on load). A 403 `creditsExhausted` also comes
  // back when one action costs more than the balance (a Hero clip, a long reel); that is a
  // per-action refusal the page reports itself. Treating it as "account empty" used to lock the
  // whole app on the plans page until a reload, because nothing ever cleared this state.
  const balanceIsEmpty = useCallback(async (): Promise<boolean> => {
    const res = await apiService.getCredits();
    const balance = res?.success ? res.credits?.balance : undefined;
    // Unknown balance (network error): keep the old behaviour and show the paywall.
    return !(typeof balance === 'number' && balance > 0);
  }, []);

  const clearCreditsPaywall = useCallback(() => {
    setTrialExpired((t) => (t.expired && t.reason === 'credits' ? { expired: false, reason: 'time' } : t));
  }, []);

  const trialExpiredRef = useRef(trialExpired);
  trialExpiredRef.current = trialExpired;

  // On navigation, a credits paywall is re-checked and lifted when the balance is no longer empty.
  const recheckPaywallOnNavigate = useCallback(() => {
    const t = trialExpiredRef.current;
    if (!t.expired || t.reason !== 'credits') return;
    balanceIsEmpty().then((empty) => { if (!empty) clearCreditsPaywall(); });
  }, [balanceIsEmpty, clearCreditsPaywall]);

  // Listen for trial-expired events from API interceptor
  useEffect(() => {
    const handleTrialExpired = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const reason: 'time' | 'credits' = detail?.reason === 'credits' ? 'credits' : 'time';
      if (reason !== 'credits') {
        setTrialExpired({ expired: true, reason });
        return;
      }
      if (typeof detail?.creditsRemaining === 'number' && detail.creditsRemaining > 0) return;
      balanceIsEmpty().then((empty) => { if (empty) setTrialExpired({ expired: true, reason: 'credits' }); });
    };
    // A top-up or any response that reports a positive balance lifts a credits paywall.
    const handleCreditsUpdated = (e: Event) => {
      const left = (e as CustomEvent).detail?.creditsRemaining;
      if (typeof left === 'number' && left > 0) clearCreditsPaywall();
    };
    window.addEventListener('trial-expired', handleTrialExpired);
    window.addEventListener('credits-updated', handleCreditsUpdated);
    return () => {
      window.removeEventListener('trial-expired', handleTrialExpired);
      window.removeEventListener('credits-updated', handleCreditsUpdated);
    };
  }, [balanceIsEmpty, clearCreditsPaywall]);

  const handleLoginSuccess = (userData: User) => {
    setUser(userData);
    // Credits check only (no time-based expiry)
    if ((userData.credits?.balance ?? 100) <= 0) {
      setTrialExpired({ expired: true, reason: 'credits' });
    } else {
      setTrialExpired({ expired: false, reason: 'time' });
    }
  };

  const handleLogout = useCallback(() => {
    apiService.logout();
    setUser(null);
    setTrialExpired({ expired: false, reason: 'time' });
  }, []);


  const handleOnboardingComplete = (updatedUser: User) => {
      setUser(updatedUser);
  };

  if (loading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--gv-bg)]">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--gv-accent)]" />
        </div>
    );
  }

  return (
    <ThemeProvider>
    <ConfirmProvider>
    <Router>
      <RouteChangeWatcher onChange={recheckPaywallOnNavigate} />
      <Routes>
        {/* Landing Page - shown when not logged in */}
        <Route 
          path="/" 
          element={!user ? <LandingPage /> : <Navigate to={landingPath(user, Boolean(localStorage.getItem('csmReturnToken')))} replace />} 
        />
        
        <Route 
          path="/login" 
          element={!user ? <Auth onLoginSuccess={handleLoginSuccess} /> : <LoginRedirect />} 
        />
        
        {/* Public legal pages */}
        <Route path="/terms" element={<TermsAndConditions />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />

        {/* Brand Growth Blueprint: outside the onboarding gate and the Quark paywall on purpose. */}
        <Route
          path="/blueprint/*"
          element={user ? <BlueprintRoutes user={user} onLogout={handleLogout} /> : <Navigate to={BLUEPRINT_SIGNUP_PATH} replace />}
        />

        {/* The old shared-login admin pages are gone. Staff sign in like everyone else and use the Staff area. */}
        <Route path="/admin/login" element={<Navigate to="/login" replace />} />
        <Route path="/admin" element={<Navigate to="/login" replace />} />

        {/* Development only: look at the sign-up steps without an account. Not part of a production build. */}
        {(import.meta as any).env?.DEV && <Route path="/__onboarding-preview" element={<Onboarding onComplete={() => {}} />} />}

        {/* Onboarding Route - Protected but outside main Layout if needed, or redirect check */}
        <Route 
            path="/onboarding"
            element={
                user ? (
                    !user.onboardingCompleted ? (
                        <Onboarding onComplete={handleOnboardingComplete} />
                    ) : (
                        <Navigate to="/dashboard" replace />
                    )
                ) : (
                    <Navigate to="/login" replace />
                )
            }
        />

        {/* Upgrade / Payment page — accessible even if trial isn't expired */}
        <Route
          path="/trial-expired"
          element={
            user ? (
              <TrialExpired
                reason={'time'}
                daysUsed={7 - (user.trial?.expiresAt ? Math.max(0, Math.ceil((new Date(user.trial.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0)}
                creditsUsed={user.credits?.totalUsed ?? 0}
                onLogout={handleLogout}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        {/* Protected Routes wrapped in Layout */}
        <Route
          path="/*"
          element={
            user ? (
              trialExpired.expired ? (
                <TrialExpired 
                  reason={trialExpired.reason} 
                  daysUsed={7 - (user.trial?.expiresAt ? Math.max(0, Math.ceil((new Date(user.trial.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0)}
                  creditsUsed={user.credits?.totalUsed ?? 0}
                  onLogout={handleLogout} 
                />
              ) : user.onboardingCompleted ? (
                <Layout user={user} onLogout={handleLogout}>
                    <Routes>
                    <Route path="/dashboard" element={<GravityHome />} />
                    <Route path="/dashboard-classic" element={<Dashboard />} />
                    {/* Two tabs on one page: Plan (AI month strategy, the PDF-able
                        view) and Schedule (real month grid, thumbnails on the day
                        they're actually scheduled). content-calendar-grid/-classic
                        kept as direct links to the individual views. */}
                    <Route path="/content-calendar" element={<CalendarHome />} />
                    <Route path="/content-calendar-grid" element={<GravityCalendar />} />
                    <Route path="/content-calendar-classic" element={<ContentCalendar />} />
                    <Route path="/idea-inbox" element={<IdeaInbox />} />
                    <Route path="/campaigns" element={<GravityCreate />} />
                    <Route path="/campaigns-classic" element={<Campaigns />} />
                    <Route path="/drafts" element={<GravityApprove user={user} />} />
                    <Route path="/reels" element={<ReelGenerator />} />
                    <Route path="/reels/hero" element={<HeroVideo />} />
                    <Route path="/upload" element={<UploadAndSchedule />} />
                    <Route path="/ad-campaigns" element={<AdCampaigns />} />
                    <Route path="/competitors" element={<Competitors />} />
                    <Route path="/connect-socials" element={<ConnectSocials />} />
                    <Route path="/inbox" element={<SocialInbox />} />
                    <Route path="/clients" element={<CsmClients />} />
                    <Route path="/staff" element={<StaffLayout />} />
                    <Route path="/staff/:section" element={<StaffLayout />} />
                    <Route path="/staff/:section/:id" element={<StaffLayout />} />
                    <Route path="/connect-socials/inbox" element={<Navigate to="/inbox" replace />} />
                    <Route path="/brand-assets" element={<BrandAssets />} />
                    {/* Products & Services now lives inside Brand Assets. The old route is
                        kept so existing links and bookmarks still land somewhere sensible. */}
                    <Route path="/inventory" element={<Navigate to="/brand-assets?tab=products" replace />} />
                    <Route path="/analytics" element={<GravityInsights />} />
                    <Route path="/analytics-classic" element={<Analytics />} />
                    <Route path="/seo" element={<SEOAssistant />} />
                    <Route path="/seo/keywords" element={<SEOAssistant />} />
                    <Route path="/seo/metadata" element={<SEOAssistant />} />
                    <Route path="/seo/hashtags" element={<SEOAssistant />} />
                    <Route path="/seo/competitor" element={<SEOAssistant />} />
                    <Route path="/influencer-portal" element={<InfluencerPortal />} />
                    <Route path="/influencer-portal/list" element={<InfluencerList />} />
                    <Route path="/influencer-portal/collaborations" element={<Collaborations />} />
                    <Route path="/influencer-portal/submissions" element={<SubmissionReview />} />
                    <Route path="/influencer-portal/analytics" element={<InfluencerAnalytics />} />
                    <Route path="/influencer-portal/profile" element={<InfluencerProfile />} />
                    <Route path="/ai-memory" element={<AIMemory />} />
                    <Route path="/ai-history" element={<AIHistory />} />
                    <Route path="/ai-performance" element={<AIPerformance />} />
                    <Route path="/settings" element={<Settings user={user} onUserUpdate={setUser} />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                    {/* Persists across navigation while a Smart Calendar reel renders. */}
                    <BackgroundReelIndicator />
                </Layout>
              ) : (
                  <Navigate to="/onboarding" replace />
              )
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
      
      {/* Floating ChatBot - appears on all pages */}
      {/* <ChatBot /> */}
      
      {/* Campaign Reminder Pop-ups - only for logged in users */}
      {user && user.onboardingCompleted && <CampaignReminderPopup />}
    </Router>
    </ConfirmProvider>
    </ThemeProvider>
  );
};

export default App;
