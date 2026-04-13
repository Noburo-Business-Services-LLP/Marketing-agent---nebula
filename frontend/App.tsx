import React, { useEffect, useState, useCallback, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ChatBot from './components/ChatBot';
import CampaignReminderPopup from './components/CampaignReminderPopup';
import LandingPage from './pages/LandingPage';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import TrialExpired from './pages/TrialExpired';
import Dashboard from './pages/Dashboard';
import Campaigns from './pages/Campaigns';
import AdCampaigns from './pages/AdCampaigns';
import Competitors from './pages/Competitors';
import ConnectSocials from './pages/ConnectSocials';
import BrandAssets from './pages/BrandAssets';
import Inventory from './pages/Inventory';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import TermsAndConditions from './pages/TermsAndConditions';
import PrivacyPolicy from './pages/PrivacyPolicy';
import { ThemeProvider } from './context/ThemeContext';
import { apiService } from './services/api';
import { User } from './types';
import { Loader2 } from 'lucide-react';

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
          
          // Check trial status
          if (res.user) {
            if (res.user.trial?.migratedToProd) {
              setTrialExpired({ expired: true, reason: 'migrated' as any });
            } else {
              const trialEnd = res.user.trial?.expiresAt ? new Date(res.user.trial.expiresAt) : null;
              const now = new Date();
              if (res.user.trial?.isExpired || (trialEnd && now > trialEnd)) {
                setTrialExpired({ expired: true, reason: 'time' });
              } else if ((res.user.credits?.balance ?? 100) <= 0) {
                setTrialExpired({ expired: true, reason: 'credits' });
              }
            }
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

  // Listen for trial-expired events from API interceptor
  useEffect(() => {
    const handleTrialExpired = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setTrialExpired({ expired: true, reason: detail?.reason || 'time' });
    };
    window.addEventListener('trial-expired', handleTrialExpired);
    return () => window.removeEventListener('trial-expired', handleTrialExpired);
  }, []);

  const handleLoginSuccess = (userData: User) => {
    setUser(userData);
    // Check trial on login
    if (userData.trial?.migratedToProd) {
      setTrialExpired({ expired: true, reason: 'migrated' as any });
    } else {
      const trialEnd = userData.trial?.expiresAt ? new Date(userData.trial.expiresAt) : null;
      const now = new Date();
      if (userData.trial?.isExpired || (trialEnd && now > trialEnd)) {
        setTrialExpired({ expired: true, reason: 'time' });
      } else if ((userData.credits?.balance ?? 100) <= 0) {
        setTrialExpired({ expired: true, reason: 'credits' });
      } else {
        setTrialExpired({ expired: false, reason: 'time' });
      }
    }
  };

  const handleLogout = useCallback(() => {
    apiService.logout();
    setUser(null);
    setTrialExpired({ expired: false, reason: 'time' });
  }, []);

  // Auto-logout after 30 minutes of inactivity
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResetRef = useRef(0);
  const logoutRef = useRef(handleLogout);
  logoutRef.current = handleLogout;

  const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  const THROTTLE_MS = 2000;

  // Stable resetIdleTimer that never changes reference
  const resetIdleTimer = useCallback(() => {
    const now = Date.now();
    if (now - lastResetRef.current < THROTTLE_MS) return;
    lastResetRef.current = now;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      logoutRef.current();
    }, IDLE_TIMEOUT);
  }, []);

  useEffect(() => {
    if (!user) return;

    const events = ['mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'scroll', 'touchstart', 'touchmove', 'mousemove', 'focus', 'wheel', 'resize', 'input', 'change'];
    events.forEach(e => window.addEventListener(e, resetIdleTimer, { passive: true }));

    const handleVisibility = () => { if (!document.hidden) resetIdleTimer(); };
    document.addEventListener('visibilitychange', handleVisibility);

    resetIdleTimer(); // start timer on mount

    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdleTimer));
      document.removeEventListener('visibilitychange', handleVisibility);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [!!user, resetIdleTimer]);

  const handleOnboardingComplete = (updatedUser: User) => {
      setUser(updatedUser);
  };

  if (loading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[#070A12]">
            <Loader2 className="w-8 h-8 animate-spin text-[#ffcc29]" />
        </div>
    );
  }

  return (
    <ThemeProvider>
    <Router>
      <Routes>
        {/* Landing Page - shown when not logged in */}
        <Route 
          path="/" 
          element={!user ? <LandingPage /> : <Navigate to="/dashboard" replace />} 
        />
        
        <Route 
          path="/login" 
          element={!user ? <Auth onLoginSuccess={handleLoginSuccess} /> : <Navigate to="/dashboard" replace />} 
        />
        
        {/* Public legal pages */}
        <Route path="/terms" element={<TermsAndConditions />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />

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
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/campaigns" element={<Campaigns />} />
                    <Route path="/ad-campaigns" element={<AdCampaigns />} />
                    <Route path="/competitors" element={<Competitors />} />
                    <Route path="/connect-socials" element={<ConnectSocials />} />
                    <Route path="/brand-assets" element={<BrandAssets />} />
                    <Route path="/inventory" element={<Inventory />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/settings" element={<Settings user={user} onUserUpdate={setUser} />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
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
      <ChatBot />
      
      {/* Campaign Reminder Pop-ups - only for logged in users */}
      {user && user.onboardingCompleted && <CampaignReminderPopup />}
    </Router>
    </ThemeProvider>
  );
};

export default App;
