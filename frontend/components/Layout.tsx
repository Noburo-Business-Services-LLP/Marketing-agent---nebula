import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Megaphone, 
  Users, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  Link2,
  Sparkles,
  Sun,
  Moon,
  Palette,
  BarChart3,
  Package,
  Clock,
  Zap,
  ChevronDown,
  TrendingUp,
  ImageIcon,
  MessageSquare,
  PenTool,
  Layers
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { User } from '../types';
import NotificationBell from './NotificationBell';
import { apiService } from '../services/api';

interface TrialData {
  daysLeft: number;
  creditsBalance: number;
  totalUsed: number;
  startingCredits: number;
  history: Array<{ action: string; amount: number; description: string; createdAt: string }>;
  costs: Record<string, number>;
}

interface LayoutProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
}

const STARTING_CREDITS = 100; // Demo trial credits

// Credit action labels & icons for display
const ACTION_LABELS: Record<string, { label: string; icon: string }> = {
  image_generated: { label: 'Image Generation', icon: '🖼️' },
  image_edit: { label: 'Image Edit', icon: '✏️' },
  campaign_text: { label: 'Campaign Ideas', icon: '💡' },
  chat_message: { label: 'Chat Message', icon: '💬' },
  competitor_scrape: { label: 'Competitor Intel', icon: '🔍' },
};

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout }) => {
  const { isDarkMode } = useTheme();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [trialInfo, setTrialInfo] = useState<TrialData | null>(null);
  const [showCreditPanel, setShowCreditPanel] = useState(false);
  const creditPanelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Fetch trial/credit info
  const fetchTrialInfo = async () => {
    try {
      const data = await apiService.getCredits();
      if (data.success) {
        setTrialInfo({
          daysLeft: data.trial?.daysLeft ?? 7,
          creditsBalance: data.credits?.balance ?? STARTING_CREDITS,
          totalUsed: data.credits?.totalUsed ?? 0,
          startingCredits: STARTING_CREDITS,
          history: data.credits?.history ?? [],
          costs: data.costs ?? {}
        });
      }
    } catch (e) {
      // Silently fail
    }
  };

  useEffect(() => {
    fetchTrialInfo();
    const interval = setInterval(fetchTrialInfo, 60000);

    // Listen for real-time credit updates
    const handleCreditUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.creditsRemaining !== undefined) {
        setTrialInfo(prev => prev ? { ...prev, creditsBalance: detail.creditsRemaining } : prev);
      }
      // Also re-fetch full data for history update
      setTimeout(fetchTrialInfo, 500);
    };
    window.addEventListener('credits-updated', handleCreditUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('credits-updated', handleCreditUpdate);
    };
  }, []);

  // Close credit panel on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (creditPanelRef.current && !creditPanelRef.current.contains(e.target as Node)) {
        setShowCreditPanel(false);
      }
    };
    if (showCreditPanel) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCreditPanel]);





  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/campaigns', label: 'Campaigns', icon: Megaphone },
    { path: '/competitors', label: 'Competitors', icon: Users },
    { path: '/connect-socials', label: 'Connect Socials', icon: Link2 },
    { path: '/brand-assets', label: 'Brand Assets', icon: Palette },
    { path: '/inventory', label: 'Inventory', icon: Package },
    { path: '/analytics', label: 'Analytics & Ads', icon: BarChart3 },
  ];

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  return (
    <>
    <style>{`
      @keyframes fadeSlideDown {
        from { opacity: 0; transform: translateY(-8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `}</style>
    <div className={`flex h-screen font-sans ${isDarkMode ? 'bg-[#070A12] text-[#ededed]' : 'bg-[#ededed] text-[#070A12]'}`}>
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 z-30 w-64 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-[#ffcc29]'} border-r transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:inset-auto ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
            <div className="p-6">
                <div className={`flex items-center gap-3 mb-2 ${isDarkMode ? 'text-[#ededed]' : 'text-[#070A12]'}`}>
                    <img src="/assets/logo.png" alt="Nebulaa Gravity" className={`w-12 h-12 ${isDarkMode ? 'brightness-0 invert' : ''}`} />
                    <div className="flex flex-col">
                        <span className="font-bold text-xl tracking-tight leading-tight">Nebulaa</span>
                        <span className="font-semibold text-lg tracking-tight leading-tight">Gravity</span>
                    </div>
                </div>
                {/* Show user's business name if available */}
                {user?.businessProfile?.name && (
                  <p className={`text-xs mb-6 pl-[60px] truncate ${isDarkMode ? 'text-[#ededed]/60' : 'text-[#070A12]/70'}`} title={user.businessProfile.name}>
                    for {user.businessProfile.name}
                  </p>
                )}
                {!user?.businessProfile?.name && <div className="mb-6"></div>}

                <nav className="space-y-1">
                    {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                        <Link
                        key={item.path}
                        to={item.path}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium ${
                            isActive 
                            ? isDarkMode 
                              ? 'bg-[#ffcc29]/20 text-[#ffcc29]' 
                              : 'bg-[#070A12] text-white'
                            : isDarkMode
                              ? 'text-[#ededed]/70 hover:bg-[#ffcc29]/10 hover:text-[#ffcc29]'
                              : 'text-[#070A12]/80 hover:bg-[#070A12]/10 hover:text-[#070A12]'
                        }`}
                        onClick={() => setSidebarOpen(false)}
                        >
                        <Icon className={`w-5 h-5 ${isActive ? (isDarkMode ? 'text-[#ffcc29]' : 'text-white') : (isDarkMode ? 'text-[#ededed]/50' : 'text-[#070A12]/60')}`} />
                        <span>{item.label}</span>
                        </Link>
                    );
                    })}
                </nav>
            </div>

            <div className={`mt-auto p-6 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-[#070A12]/20'}`}>
                
                <nav className="space-y-1 mb-4">
                    <Link
                        to="/settings"
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium ${
                            location.pathname === '/settings'
                            ? isDarkMode 
                              ? 'bg-[#ffcc29]/20 text-[#ffcc29]' 
                              : 'bg-[#070A12] text-white'
                            : isDarkMode
                              ? 'text-[#ededed]/70 hover:bg-[#ffcc29]/10 hover:text-[#ffcc29]'
                              : 'text-[#070A12]/80 hover:bg-[#070A12]/10 hover:text-[#070A12]'
                        }`}
                        onClick={() => setSidebarOpen(false)}
                    >
                        <Settings className={`w-5 h-5 ${location.pathname === '/settings' ? (isDarkMode ? 'text-[#ffcc29]' : 'text-white') : (isDarkMode ? 'text-[#ededed]/50' : 'text-[#070A12]/60')}`} />
                        <span>Settings</span>
                    </Link>
                    <button 
                        onClick={handleLogout}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium w-full ${
                          isDarkMode 
                            ? 'text-[#ededed]/70 hover:bg-[#ffcc29]/10 hover:text-[#ffcc29]' 
                            : 'text-[#070A12]/80 hover:bg-[#070A12]/10 hover:text-[#070A12]'
                        }`}
                    >
                        <LogOut className={`w-5 h-5 ${isDarkMode ? 'text-[#ededed]/50' : 'text-[#070A12]/60'}`} />
                        <span>Logout</span>
                    </button>
                </nav>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${isDarkMode ? 'bg-[#070A12]' : 'bg-gray-100'}`}>
        {/* Mobile Header */}
        <header className={`md:hidden ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-[#ffcc29]'} border-b p-4 flex items-center justify-between sticky top-0 z-10`}>
          <button 
            onClick={() => setSidebarOpen(true)}
            className={isDarkMode ? 'text-[#ededed] hover:text-[#ffcc29]' : 'text-[#070A12]'}
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className={`font-bold ${isDarkMode ? 'text-[#ffcc29]' : 'text-[#070A12]'}`}>GRAVITY</span>
          <div className="flex items-center gap-2">
            {/* Mobile credit indicator */}
            {trialInfo && (
              <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${
                trialInfo.creditsBalance <= 25
                  ? 'bg-red-500/10 text-red-400'
                  : isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-gray-100 text-gray-600'
              }`}>
                <Zap className="w-3 h-3" />
                <span className="tabular-nums">{trialInfo.creditsBalance}</span>
              </div>
            )}
            <NotificationBell />
          </div>
        </header>

        {/* Desktop Header with Credits Widget */}
        <header className={`hidden md:flex ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-gray-200'} border-b px-8 py-3 items-center justify-between gap-4`}>
          {/* Enterprise Credits Widget */}
          {trialInfo && (() => {
            const pct = Math.max(0, Math.min(100, (trialInfo.creditsBalance / trialInfo.startingCredits) * 100));
            const isLow = pct <= 25;
            const isMed = pct <= 50 && pct > 25;
            const ringColor = isLow ? '#ef4444' : isMed ? '#f59e0b' : '#22c55e';
            const ringBg = isDarkMode ? '#1e293b' : '#e2e8f0';
            // SVG arc math for circular indicator
            const radius = 18;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (pct / 100) * circumference;

            return (
              <div className="relative" ref={creditPanelRef}>
                {/* Trigger Button */}
                <button
                  onClick={() => setShowCreditPanel(!showCreditPanel)}
                  className={`flex items-center gap-3 px-4 py-2 rounded-xl transition-all duration-200 border ${
                    isLow
                      ? isDarkMode ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10' : 'border-red-200 bg-red-50 hover:bg-red-100'
                      : isDarkMode ? 'border-slate-700 bg-[#0f1419] hover:bg-slate-800/80' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  {/* Circular Credit Ring */}
                  <div className="relative w-10 h-10 flex-shrink-0">
                    <svg className="w-10 h-10 -rotate-90" viewBox="0 0 44 44">
                      <circle cx="22" cy="22" r={radius} fill="none" stroke={ringBg} strokeWidth="3" />
                      <circle
                        cx="22" cy="22" r={radius} fill="none"
                        stroke={ringColor} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={circumference} strokeDashoffset={offset}
                        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Zap className="w-3.5 h-3.5" style={{ color: ringColor }} />
                    </div>
                  </div>

                  {/* Text Info */}
                  <div className="text-left">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm font-semibold tabular-nums ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {trialInfo.creditsBalance}
                      </span>
                      <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>credits</span>
                    </div>
                    <div className={`text-[11px] flex items-center gap-1 ${
                      trialInfo.daysLeft <= 2
                        ? 'text-red-400'
                        : isDarkMode ? 'text-slate-500' : 'text-gray-400'
                    }`}>
                      <Clock className="w-3 h-3" />
                      <span>{trialInfo.daysLeft}d remaining</span>
                    </div>
                  </div>

                  <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showCreditPanel ? 'rotate-180' : ''} ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                </button>

                {/* Dropdown Panel */}
                {showCreditPanel && (
                  <div className={`absolute top-full left-0 mt-2 w-80 rounded-2xl shadow-2xl border z-50 overflow-hidden ${
                    isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-gray-200'
                  }`} style={{ animation: 'fadeSlideDown 0.2s ease-out' }}>
                    {/* Header */}
                    <div className={`px-5 pt-5 pb-4 ${isDarkMode ? 'bg-[#0f1419]' : 'bg-gray-50'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Usage Overview</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          trialInfo.daysLeft <= 2
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-[#ffcc29]/10 text-[#d4a800]'
                        }`}>
                          Free Trial
                        </span>
                      </div>

                      {/* Credit Bar */}
                      <div className="space-y-2">
                        <div className="flex items-end justify-between">
                          <div>
                            <span className={`text-2xl font-bold tabular-nums ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {trialInfo.creditsBalance}
                            </span>
                            <span className={`text-sm ml-1 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                              / {trialInfo.startingCredits}
                            </span>
                          </div>
                          <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                            {trialInfo.totalUsed} used
                          </span>
                        </div>
                        <div className={`h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-gray-200'}`}>
                          <div
                            className="h-full rounded-full transition-all duration-500 ease-out"
                            style={{
                              width: `${pct}%`,
                              background: isLow
                                ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                                : isMed
                                  ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                                  : 'linear-gradient(90deg, #22c55e, #16a34a)'
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Cost Reference */}
                    <div className={`px-5 py-3 border-t ${isDarkMode ? 'border-slate-800' : 'border-gray-100'}`}>
                      <p className={`text-[11px] font-medium uppercase tracking-wider mb-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                        Credit Costs
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(trialInfo.costs || {}).filter(([, v]) => v > 0).map(([action, cost]) => (
                          <div key={action} className={`flex items-center justify-between px-2 py-1 rounded-lg text-xs ${
                            isDarkMode ? 'bg-slate-800/50' : 'bg-gray-50'
                          }`}>
                            <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>
                              {ACTION_LABELS[action]?.icon} {ACTION_LABELS[action]?.label || action}
                            </span>
                            <span className={`font-medium tabular-nums ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                              {cost}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>


                    {/* Trial Timer */}
                    <div className={`px-5 py-3 border-t ${isDarkMode ? 'border-slate-800 bg-[#0f1419]' : 'border-gray-100 bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className={`w-3.5 h-3.5 ${trialInfo.daysLeft <= 2 ? 'text-red-400' : isDarkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                          <span className={`text-xs ${trialInfo.daysLeft <= 2 ? 'text-red-400 font-medium' : isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                            {trialInfo.daysLeft} day{trialInfo.daysLeft !== 1 ? 's' : ''} left in trial
                          </span>
                        </div>
                        <button 
                          onClick={() => navigate('/trial-expired')}
                          className="text-xs font-medium text-[#ffcc29] hover:text-[#e6b800] transition-colors"
                        >
                          Upgrade
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <NotificationBell />
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
    </>
  );
};

export default Layout;