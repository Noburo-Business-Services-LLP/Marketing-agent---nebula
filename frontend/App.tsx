import React, { useEffect, useState, useCallback } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ChatBot from './components/ChatBot';
import CampaignReminderPopup from './components/CampaignReminderPopup';
import LandingPage from './pages/LandingPage';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Campaigns from './pages/Campaigns';
import Competitors from './pages/Competitors';
import ConnectSocials from './pages/ConnectSocials';
import BrandAssets from './pages/BrandAssets';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import TermsAndConditions from './pages/TermsAndConditions';
import PrivacyPolicy from './pages/PrivacyPolicy';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import { ThemeProvider } from './context/ThemeContext';
import { apiService } from './services/api';
import { User } from './types';
import { Loader2 } from 'lucide-react';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Check for existing token on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('authToken');
      if (token) {
        try {
          const res = await apiService.getCurrentUser();
          setUser(res.user || null);
        } catch (error) {
          console.error("Auth check failed", error);
          localStorage.removeItem('authToken');
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  const handleLoginSuccess = (userData: User) => {
    setUser(userData);
  };

  const handleLogout = useCallback(() => {
    apiService.logout();
    setUser(null);
  }, []);


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

        {/* Admin routes — completely separate from user auth */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminDashboard />} />

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
                <Layout user={user} onLogout={handleLogout}>
                    <Routes>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/campaigns" element={<Campaigns />} />
                    <Route path="/competitors" element={<Competitors />} />
                    <Route path="/brand-assets" element={<BrandAssets />} />
                    <Route path="/connect-socials" element={<ConnectSocials />} />
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