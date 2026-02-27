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
  ChevronDown,
  Zap,
  Clock
} from 'lucide-react';
import { User } from '../types';
import NotificationBell from './NotificationBell';

const ACTION_LABELS: Record<string, {label: string; icon: string}> = {
  // Cost table keys (from /api/credits costs)
  image_generated: { label: 'Image Generation', icon: '🎨' },
  image_edit: { label: 'Image Edit', icon: '✏️' },
  campaign_text: { label: 'Campaign Text', icon: '💡' },
  chat_message: { label: 'Chat Message', icon: '💬' },
  competitor_scrape: { label: 'Competitor Scan', icon: '🔍' },
  // Dashboard routes
  campaign_suggestions: { label: 'Campaign Ideas', icon: '💡' },
  campaign_stream: { label: 'Campaign Ideas', icon: '💡' },
  generate_rival_post: { label: 'Rival Post', icon: '⚔️' },
  strategic_advisor_post: { label: 'Strategy Post', icon: '🎯' },
  refine_image: { label: 'Image Refine', icon: '✏️' },
  generate_event_post: { label: 'Event Post', icon: '🎉' },
  // Campaign routes
  campaign_posts: { label: 'Campaign Posts', icon: '📝' },
  regenerate_image: { label: 'Regenerate Image', icon: '🔄' },
  generate_caption: { label: 'Caption', icon: '✍️' },
  template_poster: { label: 'Poster', icon: '🎨' },
  poster_edit: { label: 'Poster Edit', icon: '✏️' },
  poster_from_reference: { label: 'Reference Poster', icon: '🖼️' },
  batch_poster: { label: 'Batch Posters', icon: '📦' },
  // Credit system
  daily_login_bonus: { label: 'Login Bonus', icon: '🎁' },
  monthly_reset: { label: 'Monthly Reset', icon: '🔄' },
};

/** Get label for an action, stripping trailing _N count suffix */
const getActionLabel = (action: string) => {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // Handle dynamic suffixes like campaign_suggestions_6, batch_poster_3
  const base = action.replace(/_\d+$/, '');
  return ACTION_LABELS[base] || { label: action.replace(/_/g, ' '), icon: '⚡' };
};

interface CreditData {
  daysLeft: number;
  creditsBalance: number;
  totalUsed: number;
  monthlyAllowance: number;
  cycleEnd: string;
  history: Array<{action: string; cost: number; balanceAfter: number; timestamp: string}>;
  costs: Record<string, number>;
}

interface LayoutProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [creditData, setCreditData] = useState<CreditData | null>(null);
  const [showCreditPanel, setShowCreditPanel] = useState(false);
  const creditPanelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  };

  // Fetch full credit data (balance, costs, history)
  const fetchCredits = async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) return;
      const API_BASE = window.location.hostname !== 'localhost' ? '/api' : 'http://localhost:5000/api';
      const resp = await fetch(`${API_BASE}/credits`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await resp.json();
      if (data.success) {
        setCreditData({
          creditsBalance: data.credits.balance,
          monthlyAllowance: data.credits.monthlyAllowance,
          totalUsed: data.credits.totalUsed,
          daysLeft: data.credits.daysLeft,
          cycleEnd: data.credits.cycleEnd,
          history: data.history || [],
          costs: data.costs || {},
        });
      }
    } catch (e) {
      console.error('Failed to fetch credits:', e);
    }
  };

  useEffect(() => { fetchCredits(); }, []);

  // Listen for real-time credit updates — refetch to get updated history
  useEffect(() => {
    const handleCreditsUpdate = () => {
      setTimeout(fetchCredits, 500);
    };
    window.addEventListener('credits-updated', handleCreditsUpdate);
    return () => window.removeEventListener('credits-updated', handleCreditsUpdate);
  }, []);

  // Close credit panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (creditPanelRef.current && !creditPanelRef.current.contains(e.target as Node)) {
        setShowCreditPanel(false);
      }
    };
    if (showCreditPanel) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCreditPanel]);

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/campaigns', label: 'Campaigns', icon: Megaphone },
    { path: '/competitors', label: 'Competitors', icon: Users },
    { path: '/connect-socials', label: 'Connect Socials', icon: Link2 },
    { path: '/analytics', label: 'Analytics & Ads', icon: BarChart3 },
  ];

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  return (
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
                    <img src="/assets/logo.png" alt="Nebulaa Gravity" className="w-12 h-12" />
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
                {/* Theme Toggle */}
                <button
                  onClick={toggleTheme}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium w-full mb-2 ${
                    isDarkMode 
                      ? 'text-[#ededed]/70 hover:bg-[#ffcc29]/10 hover:text-[#ffcc29]' 
                      : 'text-[#070A12]/80 hover:bg-[#070A12]/10 hover:text-[#070A12]'
                  }`}
                >
                  {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                  <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
                </button>
                
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
            {creditData && (
              <div className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                (creditData.creditsBalance / creditData.monthlyAllowance * 100) > 50 ? 'bg-emerald-500/20 text-emerald-400'
                : (creditData.creditsBalance / creditData.monthlyAllowance * 100) > 20 ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-red-500/20 text-red-400'
              }`}>
                <Zap className="w-3 h-3" />
                <span className="tabular-nums">{Math.round(creditData.creditsBalance)}</span>
              </div>
            )}
            <NotificationBell />
            <button onClick={toggleTheme} className={isDarkMode ? 'text-[#ededed]' : 'text-[#070A12]'}>
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Desktop Header with Credits Widget */}
        <header className={`hidden md:flex ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-gray-200'} border-b px-8 py-3 items-center justify-between gap-4`}>
          {/* Enterprise Credits Widget */}
          {creditData && (() => {
            const pct = Math.max(0, Math.min(100, (creditData.creditsBalance / creditData.monthlyAllowance) * 100));
            const isLow = pct <= 25;
            const isMed = pct <= 50 && pct > 25;
            const ringColor = isLow ? '#ef4444' : isMed ? '#f59e0b' : '#22c55e';
            const ringBg = isDarkMode ? '#1e293b' : '#e2e8f0';
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
                        {Math.round(creditData.creditsBalance)}
                      </span>
                      <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>credits</span>
                    </div>
                    <div className={`text-[11px] flex items-center gap-1 ${
                      creditData.daysLeft <= 2
                        ? 'text-red-400'
                        : isDarkMode ? 'text-slate-500' : 'text-gray-400'
                    }`}>
                      <Clock className="w-3 h-3" />
                      <span>{creditData.daysLeft}d remaining</span>
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
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#ffcc29]/10 text-[#d4a800]">
                          Monthly
                        </span>
                      </div>

                      {/* Credit Bar */}
                      <div className="space-y-2">
                        <div className="flex items-end justify-between">
                          <div>
                            <span className={`text-2xl font-bold tabular-nums ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {Math.round(creditData.creditsBalance)}
                            </span>
                            <span className={`text-sm ml-1 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                              / {creditData.monthlyAllowance}
                            </span>
                          </div>
                          <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                            {creditData.totalUsed} used
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
                        {Object.entries(creditData.costs || {}).filter(([, v]) => v > 0).map(([action, cost]) => {
                          const lbl = getActionLabel(action);
                          return (
                          <div key={action} className={`flex items-center justify-between px-2 py-1 rounded-lg text-xs ${
                            isDarkMode ? 'bg-slate-800/50' : 'bg-gray-50'
                          }`}>
                            <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>
                              {lbl.icon} {lbl.label}
                            </span>
                            <span className={`font-medium tabular-nums ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                              {cost}
                            </span>
                          </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Recent Activity */}
                    {creditData.history.length > 0 && (
                      <div className={`px-5 py-3 border-t ${isDarkMode ? 'border-slate-800' : 'border-gray-100'}`}>
                        <p className={`text-[11px] font-medium uppercase tracking-wider mb-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                          Recent Activity
                        </p>
                        <div className="space-y-1.5 max-h-32 overflow-y-auto">
                          {creditData.history.slice(0, 5).map((entry: any, i: number) => {
                            const lbl = getActionLabel(entry.action);
                            const isBonus = entry.cost < 0;
                            return (
                              <div key={i} className={`flex items-center justify-between text-xs py-1 ${
                                isDarkMode ? 'text-slate-400' : 'text-gray-500'
                              }`}>
                                <span className="truncate mr-2">
                                  {lbl.icon}{' '}{lbl.label}
                                </span>
                                <span className={`font-medium tabular-nums flex-shrink-0 ${
                                  isBonus ? (isDarkMode ? 'text-green-400' : 'text-green-500') : (isDarkMode ? 'text-red-400' : 'text-red-500')
                                }`}>
                                  {isBonus ? '+' : '-'}{Math.abs(entry.cost)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Cycle Reset Footer */}
                    <div className={`px-5 py-3 border-t ${isDarkMode ? 'border-slate-800 bg-[#0f1419]' : 'border-gray-100 bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className={`w-3.5 h-3.5 ${creditData.daysLeft <= 2 ? 'text-red-400' : isDarkMode ? 'text-slate-500' : 'text-gray-400'}`} />
                          <span className={`text-xs ${creditData.daysLeft <= 2 ? 'text-red-400 font-medium' : isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                            Resets {creditData.cycleEnd ? new Date(creditData.cycleEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'monthly'}
                          </span>
                        </div>
                        <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                          +10/day bonus
                        </span>
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
  );
};

export default Layout;