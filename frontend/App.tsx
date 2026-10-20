import React, { useEffect, useState, useCallback, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import Layout from './components/Layout';
import CampaignReminderPopup from './components/CampaignReminderPopup';
import BackgroundReelIndicator from './components/BackgroundReelIndicator';
const NeedPlanModal = lazyWithRetry(() => import('./components/NeedPlanModal'));
import GravityHome from './pages/GravityHome';
import OldAddress from './components/OldAddress';
import { showsCompetitorsEntry } from './utils/navMenu';
// Developer page for the tile and illustration set; the condition below is false in a production build.
const ArtShowcase = import.meta.env.DEV ? React.lazy(() => import('./pages/ArtShowcase')) : null;
import PageTabs from './components/PageTabs';
import PageHeader from './components/PageHeader';
import { landingPath, returnHashAfterActing } from './utils/staffHome';
import { isAgencyUser, isInsideClient, isLapsedAgency } from './utils/agency';
import { afterOnboardingHash } from './utils/agencyPlan';
const DeletionPending = lazyWithRetry(() => import('./components/DeletionPending'));
const TermsPrompt = lazyWithRetry(() => import('./components/TermsPrompt'));
import { needsTermsPrompt } from './utils/accountDeletion';
import { postAuthTarget, BLUEPRINT_SIGNUP_PATH } from './utils/blueprint';
import { ThemeProvider } from './context/ThemeContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { apiService } from './services/api';
import { User } from './types';
import { Loader2 } from 'lucide-react';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { PAGE_LOADERS, prefetchForHref, prefetchWhenIdle } from './utils/routeChunks';
import RouteFallback from './components/RouteFallback';
import RouteErrorBoundary from './components/RouteErrorBoundary';

// Every page except the shell and the Home page loads when it is opened (utils/routeChunks.ts lists the loaders),
// so the first load carries only what the first screen needs. lazyWithRetry tries a failed file once more.
const AIHistory = lazyWithRetry(PAGE_LOADERS.AIHistory);
const AIPerformance = lazyWithRetry(PAGE_LOADERS.AIPerformance);
const AdCampaigns = lazyWithRetry(PAGE_LOADERS.AdCampaigns);
const AgencyClients = lazyWithRetry(PAGE_LOADERS.AgencyClients);
const Analytics = lazyWithRetry(PAGE_LOADERS.Analytics);
const Auth = lazyWithRetry(PAGE_LOADERS.Auth);
const BlueprintRoutes = lazyWithRetry(PAGE_LOADERS.BlueprintRoutes);
const BrandAssets = lazyWithRetry(PAGE_LOADERS.BrandAssets);
const Campaigns = lazyWithRetry(PAGE_LOADERS.Campaigns);
const Collaborations = lazyWithRetry(PAGE_LOADERS.Collaborations);
const ConnectSocials = lazyWithRetry(PAGE_LOADERS.ConnectSocials);
const ContentCalendar = lazyWithRetry(PAGE_LOADERS.ContentCalendar);
const CreateVideo = lazyWithRetry(PAGE_LOADERS.CreateVideo);
const CsmClients = lazyWithRetry(PAGE_LOADERS.CsmClients);
const Dashboard = lazyWithRetry(PAGE_LOADERS.Dashboard);
const GravityCalendar = lazyWithRetry(PAGE_LOADERS.GravityCalendar);
const GravityCreate = lazyWithRetry(PAGE_LOADERS.GravityCreate);
const Help = lazyWithRetry(PAGE_LOADERS.Help);
const HeroVideo = lazyWithRetry(PAGE_LOADERS.HeroVideo);
const InfluencerAnalytics = lazyWithRetry(PAGE_LOADERS.InfluencerAnalytics);
const InfluencerList = lazyWithRetry(PAGE_LOADERS.InfluencerList);
const InfluencerPortal = lazyWithRetry(PAGE_LOADERS.InfluencerPortal);
const InfluencerProfile = lazyWithRetry(PAGE_LOADERS.InfluencerProfile);
const InsightsHub = lazyWithRetry(PAGE_LOADERS.InsightsHub);
const LandingPage = lazyWithRetry(PAGE_LOADERS.LandingPage);
const Library = lazyWithRetry(PAGE_LOADERS.Library);
const Onboarding = lazyWithRetry(PAGE_LOADERS.Onboarding);
const PlanHub = lazyWithRetry(PAGE_LOADERS.PlanHub);
const PrivacyPolicy = lazyWithRetry(PAGE_LOADERS.PrivacyPolicy);
const ReelGenerator = lazyWithRetry(PAGE_LOADERS.ReelGenerator);
const RefundPolicy = lazyWithRetry(PAGE_LOADERS.RefundPolicy);
const SEOAssistant = lazyWithRetry(PAGE_LOADERS.SEOAssistant);
const Settings = lazyWithRetry(PAGE_LOADERS.Settings);
const SocialInbox = lazyWithRetry(PAGE_LOADERS.SocialInbox);
const StaffLayout = lazyWithRetry(PAGE_LOADERS.StaffLayout);
const SubmissionReview = lazyWithRetry(PAGE_LOADERS.SubmissionReview);
const TermsAndConditions = lazyWithRetry(PAGE_LOADERS.TermsAndConditions);
const TrialExpired = lazyWithRetry(PAGE_LOADERS.TrialExpired);
const UploadAndSchedule = lazyWithRetry(PAGE_LOADERS.UploadAndSchedule);
const Photoshoot = lazyWithRetry(PAGE_LOADERS.Photoshoot);

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

// /reels opens the single Videos flow. A link that carries a job (an older reel being resumed) still opens the step-by-step maker.
/** The page headers of the pages made of tabs: shown above the tab bar, the same header every page uses. */
const PAGE_HEADERS = {
  create: <PageHeader eyebrow="Create content" title="What would you like to" emphasis="make?" description="Choose what to make, describe it in a few words, and Nebulaa prepares it for your review." />,
  upload: <PageHeader eyebrow="Create content" title="Upload your own" emphasis="photo or video" description="Upload a photo or a video. Nebulaa can write the caption, and you can publish the post now or schedule it for later." />,
};

const VideosEntry: React.FC = () => {
  const [params] = useSearchParams();
  return params.get('jobId') ? <ReelGenerator /> : <CreateVideo />;
};

/** The "choose a plan" prompt would sit on top of the plans page itself, so it is left out there. */
const HiddenOnPlansPage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  return pathname.startsWith('/trial-expired') ? null : <>{children}</>;
};

/** A page that is still loading shows a calm placeholder (after 150 ms); a page file that cannot load shows a reload prompt, never a blank screen. */
const PageBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundary resetKey={pathname}>
      <React.Suspense fallback={<RouteFallback />}>{children}</React.Suspense>
    </RouteErrorBoundary>
  );
};

/** Fetches the likely next page files: a few after the app is idle, and the target of a menu link when it is hovered or focused. */
const PagePrefetcher: React.FC = () => {
  useEffect(() => {
    const cancel = prefetchWhenIdle();
    const onHint = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a[href*="#/"]');
      if (a) prefetchForHref(a.getAttribute('href'));
    };
    document.addEventListener('pointerover', onHint, { passive: true });
    document.addEventListener('focusin', onHint);
    return () => {
      cancel();
      document.removeEventListener('pointerover', onHint);
      document.removeEventListener('focusin', onHint);
    };
  }, []);
  return null;
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
          // An account with no Quarks can still look around. The prompt to choose a plan appears when it tries to make something.
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

  // A new account with no plan and no Quarks: it can look around and make its free Blueprint, nothing else.
  const needsPlan = !!user && user.plan?.tier === 'free' && (user.credits?.balance ?? 0) <= 0;
  // The same rules as the menu (components/Layout.tsx): My plan for customers, agency owners and inside a client; Competitors on paid plans.
  const holdsPass = Boolean(localStorage.getItem('csmReturnToken'));
  const showsMyPlan = isInsideClient(user) || holdsPass || (!!user && !user.staffRole && !user.isCsm && !isLapsedAgency(user));
  const showsCompetitors = showsCompetitorsEntry(user, holdsPass);

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
    setTrialExpired({ expired: false, reason: 'time' });
  };

  const handleLogout = useCallback(() => {
    apiService.logout();
    setUser(null);
    setTrialExpired({ expired: false, reason: 'time' });
  }, []);


  const handleOnboardingComplete = (updatedUser: User) => {
      setUser(updatedUser);
      // Someone who said they manage several brands lands on the plans page with the Agency plan first.
      const landing = afterOnboardingHash(updatedUser);
      if (landing) window.location.hash = landing;
  };

  if (loading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--gv-bg)]">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--gv-accent)]" />
        </div>
    );
  }

  // An account waiting to be deleted sees only the restore screen.
  if (user && user.deletion?.status === 'pending') {
    return (
      <ThemeProvider>
        <React.Suspense fallback={null}><DeletionPending user={user} onRestored={setUser} onLogout={handleLogout} /></React.Suspense>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
    <ConfirmProvider>
    {needsTermsPrompt(user, Boolean(localStorage.getItem('csmReturnToken'))) && (
      <React.Suspense fallback={null}>
        <TermsPrompt
          onAccepted={() => setUser((u) => (u ? { ...u, consent: { acceptedAt: new Date().toISOString() } } : u))}
          onLogout={handleLogout}
        />
      </React.Suspense>
    )}
    <Router>
      <RouteChangeWatcher onChange={recheckPaywallOnNavigate} />
      {user && user.onboardingCompleted && <PagePrefetcher />}
      <PageBoundary>
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
        <Route path="/refund-policy" element={<RefundPolicy />} />

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

        {/* Protected Routes wrapped in Layout */}
        <Route
          path="/*"
          element={
            user ? (
              user.onboardingCompleted ? (
                <Layout user={user} onLogout={handleLogout} needsPlan={needsPlan} onTourSaved={(tour) => setUser((u) => (u ? { ...u, tour: { ...(u.tour || {}), ...tour } } : u))}>
                    <PageBoundary>
                    <Routes>
                    <Route path="/dashboard" element={<GravityHome user={user} />} />
                    <Route path="/plan" element={<PlanHub user={user} showsMyPlan={showsMyPlan} />} />
                    {ArtShowcase && <Route path="/art-showcase" element={<ArtShowcase />} />}
                    {/* The plans page sits inside the app shell like every other page. The route name is kept for old links. */}
                    <Route path="/trial-expired" element={<TrialExpired insideClient={isInsideClient(user)} />} />
                    <Route path="/dashboard-classic" element={<Dashboard />} />
                    {/* Old addresses (bookmarks, emails, old tour steps): replace redirects to their new place, query kept.
                        The list and its targets: NAV_REDIRECTS in utils/navMenu.ts, tested in tests/navMenu.test.mjs. */}
                    <Route path="/content-calendar" element={<OldAddress from="/content-calendar" />} />
                    <Route path="/content-calendar-grid" element={<GravityCalendar />} />
                    <Route path="/content-calendar-classic" element={<ContentCalendar />} />
                    <Route path="/idea-inbox" element={<OldAddress from="/idea-inbox" />} />
                    <Route path="/campaigns" element={<PageTabs tabs={[{ key: 'create', label: 'Create with Nebulaa', element: <GravityCreate />, header: PAGE_HEADERS.create }, { key: 'upload', label: 'Upload and schedule', element: <UploadAndSchedule />, header: PAGE_HEADERS.upload }]} />} />
                    <Route path="/campaigns-classic" element={<Campaigns />} />
                    <Route path="/drafts" element={<OldAddress from="/drafts" />} />
                    <Route path="/library" element={<Library user={user} />} />
                    <Route path="/photoshoot" element={<Photoshoot />} />
                    <Route path="/reels" element={<VideosEntry />} />
                    <Route path="/reels/studio" element={<ReelGenerator />} />
                    <Route path="/reels/hero" element={<HeroVideo />} />
                    <Route path="/upload" element={<Navigate to="/campaigns?tab=upload" replace />} />
                    <Route path="/ad-campaigns" element={<AdCampaigns />} />
                    <Route path="/competitors" element={<OldAddress from="/competitors" />} />
                    <Route path="/connect-socials" element={<ConnectSocials />} />
                    <Route path="/inbox" element={<SocialInbox />} />
                    <Route path="/clients" element={<CsmClients />} />
                    <Route path="/agency/clients" element={<AgencyClients user={user} />} />
                    <Route path="/staff" element={<StaffLayout />} />
                    <Route path="/staff/:section" element={<StaffLayout />} />
                    <Route path="/staff/:section/:id" element={<StaffLayout />} />
                    <Route path="/connect-socials/inbox" element={<Navigate to="/inbox" replace />} />
                    <Route path="/brand-assets" element={<BrandAssets />} />
                    {/* Products & Services now lives inside Brand Assets. The old route is
                        kept so existing links and bookmarks still land somewhere sensible. */}
                    <Route path="/inventory" element={<Navigate to="/brand-assets?tab=products" replace />} />
                    <Route path="/analytics" element={<InsightsHub showsCompetitors={showsCompetitors} />} />
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
                    <Route path="/ai-memory" element={<OldAddress from="/ai-memory" />} />
                    <Route path="/ai-history" element={<AIHistory />} />
                    <Route path="/ai-performance" element={<AIPerformance />} />
                    <Route path="/settings" element={<Settings user={user} onUserUpdate={setUser} />} />
                    <Route path="/help" element={<Help user={user} />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                    </PageBoundary>
                    {/* Persists across navigation while a Smart Calendar reel renders. */}
                    <BackgroundReelIndicator />
                    {trialExpired.expired && (
                      <HiddenOnPlansPage><React.Suspense fallback={null}><NeedPlanModal
                        hasPlan={!needsPlan}
                        onSeePlans={() => { clearCreditsPaywall(); window.location.hash = '#/trial-expired'; }}
                        onDismiss={clearCreditsPaywall}
                        insideClient={isInsideClient(user)}
                        agency={isAgencyUser(user)}
                        onBackToAgency={() => { clearCreditsPaywall(); const back = returnHashAfterActing(localStorage.getItem('csmReturnTo')); if (apiService.returnToCsmAccount()) { window.location.hash = back; window.location.reload(); } }}
                      /></React.Suspense></HiddenOnPlansPage>
                    )}
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
      </PageBoundary>
      
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
