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
  Coins,
  ChevronDown,
  Zap,
  Image,
  Pencil,
  MessageCircle,
  CalendarClock
} from 'lucide-react';
import { User } from '../types';
import NotificationBell from './NotificationBell';

interface LayoutProps {
  children: React.ReactNode;
  user: User | null;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [creditBalance, setCreditBalance] = useState(user?.credits?.balance ?? 1500);
  const [creditAllowance, setCreditAllowance] = useState(user?.credits?.monthlyAllowance ?? 1500);
  const [cycleEnd, setCycleEnd] = useState(user?.credits?.cycleEnd || '');
  const [totalUsed, setTotalUsed] = useState(user?.credits?.totalUsed ?? 0);
  const [showCreditPanel, setShowCreditPanel] = useState(false);
  const creditPanelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Check for saved theme preference or default to light
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

  // Fetch credits on mount
  useEffect(() => {
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
          setCreditBalance(data.credits.balance);
          setCreditAllowance(data.credits.monthlyAllowance);
          setCycleEnd(data.credits.cycleEnd);
          setTotalUsed(data.credits.totalUsed);
        }
      } catch (e) {
        console.error('Failed to fetch credits:', e);
      }
    };
    fetchCredits();
  }, []);

  // Listen for real-time credit updates from API responses
  useEffect(() => {
    const handleCreditsUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.creditsRemaining !== undefined) {
        setCreditBalance(detail.creditsRemaining);
      }
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

  // Credit helpers
  const creditPercent = creditAllowance > 0 ? Math.min(100, (creditBalance / creditAllowance) * 100) : 0;
  const creditColor = creditPercent > 50 ? '#22c55e' : creditPercent > 20 ? '#eab308' : '#ef4444';
  const daysLeft = cycleEnd ? Math.max(0, Math.ceil((new Date(cycleEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0;

  // SVG ring
  const ringSize = 36;
  const strokeWidth = 3.5;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - creditPercent / 100);

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
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              creditPercent > 50 ? 'bg-emerald-500/20 text-emerald-400'
              : creditPercent > 20 ? 'bg-yellow-500/20 text-yellow-400'
              : 'bg-red-500/20 text-red-400'
            }`}>
              {Math.round(creditBalance)}
            </span>
            <NotificationBell />
            <button onClick={toggleTheme} className={isDarkMode ? 'text-[#ededed]' : 'text-[#070A12]'}>
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Desktop Header with Notifications + Credits */}
        <header className={`hidden md:flex ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-gray-200'} border-b px-8 py-3 items-center justify-end gap-4`}>
          {/* Credit Meter */}
          <div className="relative" ref={creditPanelRef}>
            <button
              onClick={() => setShowCreditPanel(!showCreditPanel)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all hover:shadow-md ${
                isDarkMode
                  ? 'bg-[#0d1117] border-slate-700/60 hover:border-[#ffcc29]/40'
                  : 'bg-white border-gray-200 hover:border-yellow-400'
              }`}
            >
              {/* SVG Ring */}
              <svg width={ringSize} height={ringSize} className="-rotate-90">
                <circle
                  cx={ringSize / 2} cy={ringSize / 2} r={radius}
                  fill="none" stroke={isDarkMode ? '#1e293b' : '#e5e7eb'}
                  strokeWidth={strokeWidth}
                />
                <circle
                  cx={ringSize / 2} cy={ringSize / 2} r={radius}
                  fill="none" stroke={creditColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  className="transition-all duration-700"
                />
              </svg>
              <div className="flex flex-col items-start -ml-1">
                <span className={`text-xs font-bold leading-tight ${isDarkMode ? 'text-[#ededed]' : 'text-gray-800'}`}>
                  {Math.round(creditBalance)}
                </span>
                <span className={`text-[10px] leading-tight ${isDarkMode ? 'text-[#ededed]/50' : 'text-gray-400'}`}>
                  credits
                </span>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCreditPanel ? 'rotate-180' : ''} ${isDarkMode ? 'text-[#ededed]/40' : 'text-gray-400'}`} />
            </button>

            {/* Credit Panel Dropdown */}
            {showCreditPanel && (
              <div className={`absolute right-0 top-full mt-2 w-72 rounded-xl shadow-2xl border z-50 overflow-hidden ${
                isDarkMode
                  ? 'bg-[#0d1117] border-slate-700/60'
                  : 'bg-white border-gray-200'
              }`}>
                {/* Header */}
                <div className={`px-4 py-3 ${isDarkMode ? 'bg-[#ffcc29]/10' : 'bg-yellow-50'} border-b ${isDarkMode ? 'border-slate-700/40' : 'border-gray-100'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-[#ffcc29]" />
                      <span className={`text-sm font-semibold ${isDarkMode ? 'text-[#ededed]' : 'text-gray-800'}`}>Monthly Credits</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#ffcc29]/20 text-[#ffcc29] font-medium">
                      {daysLeft}d left
                    </span>
                  </div>
                  <div className="mt-2">
                    <div className={`flex items-baseline gap-1`}>
                      <span className="text-2xl font-bold" style={{ color: creditColor }}>{Math.round(creditBalance)}</span>
                      <span className={`text-xs ${isDarkMode ? 'text-[#ededed]/40' : 'text-gray-400'}`}>/ {creditAllowance}</span>
                    </div>
                    {/* Progress bar */}
                    <div className={`w-full h-1.5 rounded-full mt-2 ${isDarkMode ? 'bg-slate-800' : 'bg-gray-200'}`}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${creditPercent}%`, backgroundColor: creditColor }}
                      />
                    </div>
                  </div>
                </div>

                {/* Usage Overview */}
                <div className={`px-4 py-3 border-b ${isDarkMode ? 'border-slate-700/40' : 'border-gray-100'}`}>
                  <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDarkMode ? 'text-[#ededed]/30' : 'text-gray-400'}`}>This Month</p>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${isDarkMode ? 'text-[#ededed]/60' : 'text-gray-500'}`}>Used</span>
                    <span className={`text-xs font-medium ${isDarkMode ? 'text-[#ededed]' : 'text-gray-700'}`}>{totalUsed} credits</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-xs ${isDarkMode ? 'text-[#ededed]/60' : 'text-gray-500'}`}>Daily bonus</span>
                    <span className="text-xs font-medium text-emerald-500">+10/day</span>
                  </div>
                </div>

                {/* Cost Table */}
                <div className={`px-4 py-3`}>
                  <p className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${isDarkMode ? 'text-[#ededed]/30' : 'text-gray-400'}`}>Credit Costs</p>
                  <div className="space-y-1.5">
                    {[
                      { icon: Image, label: 'Image generated', cost: 5 },
                      { icon: Pencil, label: 'Image edit', cost: 3 },
                      { icon: Zap, label: 'Campaign text', cost: 2 },
                      { icon: MessageCircle, label: 'Chat message', cost: 0.5 },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <item.icon className={`w-3 h-3 ${isDarkMode ? 'text-[#ededed]/40' : 'text-gray-400'}`} />
                          <span className={`text-xs ${isDarkMode ? 'text-[#ededed]/60' : 'text-gray-500'}`}>{item.label}</span>
                        </div>
                        <span className={`text-xs font-medium ${isDarkMode ? 'text-[#ededed]' : 'text-gray-700'}`}>{item.cost}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cycle Reset Info */}
                <div className={`px-4 py-2.5 ${isDarkMode ? 'bg-slate-800/50' : 'bg-gray-50'} flex items-center gap-2`}>
                  <CalendarClock className={`w-3.5 h-3.5 ${isDarkMode ? 'text-[#ededed]/30' : 'text-gray-400'}`} />
                  <span className={`text-[11px] ${isDarkMode ? 'text-[#ededed]/40' : 'text-gray-400'}`}>
                    Resets {cycleEnd ? new Date(cycleEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'monthly'}
                  </span>
                </div>
              </div>
            )}
          </div>
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