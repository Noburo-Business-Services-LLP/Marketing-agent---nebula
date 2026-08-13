import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Megaphone,
  UploadCloud,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Link2,
  Sparkles,
  Palette,
  BarChart3,
  Package,
  Clock,
  Zap,
  ChevronDown,
  ImageIcon,
  PenTool,
  Layers,
  PlayCircle,
  Brain,
  CalendarDays,
  Search,
  HelpCircle,
  Plus
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

const STARTING_CREDITS = 100;

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

  // Apply the Gravity redesign shell class to <body> so the ambient
  // radial gold glow + warm off-white text apply globally.
  useEffect(() => {
    document.body.classList.add('gravity-shell');
    return () => { document.body.classList.remove('gravity-shell'); };
  }, []);

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
    } catch (e) { /* silent */ }
  };

  useEffect(() => {
    fetchTrialInfo();
    const interval = setInterval(fetchTrialInfo, 60000);
    const handleCreditUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.creditsRemaining !== undefined) {
        setTrialInfo(prev => prev ? { ...prev, creditsBalance: detail.creditsRemaining } : prev);
      }
      setTimeout(fetchTrialInfo, 500);
    };
    window.addEventListener('credits-updated', handleCreditUpdate);
    return () => {
      clearInterval(interval);
      window.removeEventListener('credits-updated', handleCreditUpdate);
    };
  }, []);

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

  // Nav grouping — the primary group mirrors the Gravity prototype's 5
  // top-level items; secondary group holds the extra Nebulaa features so
  // no functionality is lost.
  const primaryNav = [
    { path: '/dashboard',        label: 'Home',     icon: LayoutDashboard },
    { path: '/campaigns',        label: 'Create',   icon: Sparkles },
    { path: '/drafts',           label: 'Approve',  icon: PenTool, badge: 'drafts' as const },
    { path: '/content-calendar', label: 'Calendar', icon: CalendarDays },
    // Insights is hidden from navigation. Like the entries below, its route
    // and page are left intact so nothing breaks and it can be restored by
    // putting this line back:
    //   { path: '/analytics', label: 'Insights', icon: BarChart3 },
  ];
  // Ad Campaigns, Influencer Portal, Inventory and Competitors are hidden
  // from navigation. Their routes and pages are left intact so nothing
  // breaks and they can be restored by putting these entries back.
  const secondaryNav = [
    { path: '/reels',             label: 'AI Reels',          icon: PlayCircle },
    { path: '/upload',            label: 'Upload & Schedule', icon: UploadCloud },
    { path: '/connect-socials',   label: 'Connect Socials',   icon: Link2 },
    { path: '/brand-assets',      label: 'Brand Assets',      icon: Palette },
    { path: '/ai-memory',         label: 'AI Memory',         icon: Brain },
  ];

  const resolveTopBarMeta = (pathname: string) => {
    if (pathname.startsWith('/campaigns')) return { title: 'Create', crumb: 'New campaign' };
    if (pathname.startsWith('/content-calendar')) return { title: 'Calendar', crumb: '' };
    if (pathname.startsWith('/reels')) return { title: 'AI Reels', crumb: '' };
    if (pathname.startsWith('/influencer-portal')) return { title: 'Influencer Portal', crumb: '' };
    if (pathname.startsWith('/ad-campaigns')) return { title: 'Ad Campaigns', crumb: '' };
    if (pathname.startsWith('/connect-socials')) return { title: 'Connect Socials', crumb: '' };
    if (pathname.startsWith('/brand-assets')) return { title: 'Brand Assets', crumb: '' };
    if (pathname.startsWith('/inventory')) return { title: 'Inventory', crumb: '' };
    if (pathname.startsWith('/analytics')) return { title: 'Insights', crumb: '' };
    if (pathname.startsWith('/competitors')) return { title: 'Competitors', crumb: '' };
    if (pathname.startsWith('/ai-memory') || pathname.startsWith('/ai-history') || pathname.startsWith('/ai-performance')) return { title: 'AI Memory', crumb: '' };
    if (pathname.startsWith('/drafts')) return { title: 'Approve', crumb: '' };
    if (pathname.startsWith('/settings')) return { title: 'Settings', crumb: '' };
    return { title: 'Home', crumb: '' };
  };

  const topBarMeta = resolveTopBarMeta(location.pathname);
  const isActive = (path: string) =>
    location.pathname === path || (path !== '/dashboard' && location.pathname.startsWith(path));

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  const businessName = user?.businessProfile?.name || (user?.email ? user.email.split('@')[0] : 'Your Brand');
  const businessInitial = businessName.trim().charAt(0).toUpperCase() || 'B';
  const businessHandle = user?.email
    ? `@${user.email.split('@')[0]}`
    : (user?.businessProfile?.name ? `@${user.businessProfile.name.toLowerCase().replace(/\s+/g, '')}` : '@brand');

  const NavLink: React.FC<{
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: 'drafts';
  }> = ({ path, label, icon: Icon, badge }) => {
    const active = isActive(path);
    return (
      <Link
        to={path}
        onClick={() => setSidebarOpen(false)}
        className={`group relative flex items-center gap-3 pl-4 pr-3 h-10 rounded-lg transition-colors ${
          active
            ? 'bg-white/[0.06] text-[#F5F4F1]'
            : 'text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.03]'
        }`}
      >
        {active && (
          <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-[#F5A623]" />
        )}
        <Icon className={`w-[15px] h-[15px] ${active ? 'text-[#F5A623]' : 'text-white/45 group-hover:text-white/70'}`} />
        <span className="text-[13.5px] font-medium tracking-[-0.005em] flex-1">{label}</span>
        {badge === 'drafts' && trialInfo && (
          <span className="ml-auto min-w-[20px] h-[18px] px-1.5 rounded-full bg-[#F5A623] text-[#1A1208] text-[10px] font-bold flex items-center justify-center">
            5
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      <style>{`
        @keyframes fadeSlideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <div className="relative z-[1] flex h-screen font-sans text-[#F5F4F1]">
        {/* Mobile overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ================= SIDEBAR ================= */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-[240px] bg-[#111111] border-r border-white/[0.06] transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:inset-auto ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex flex-col h-full min-h-0">
            {/* Brand mark */}
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-center gap-2.5">
                <span className="w-[18px] h-[18px] rounded-full bg-[#F5A623] shadow-[0_0_18px_rgba(245,166,35,0.5)]" />
                <div className="leading-tight">
                  <div className="text-[13px] font-semibold tracking-[0.14em] text-[#F5F4F1]">GRAVITY</div>
                  <div className="text-[9px] tracking-[0.22em] text-white/40 mt-[1px]">BY NEBULAA</div>
                </div>
                <button
                  className="ml-auto md:hidden text-white/50 hover:text-white"
                  onClick={() => setSidebarOpen(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Account chip */}
            <div className="px-4 mb-4">
              <button className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors">
                <span className="w-7 h-7 rounded-md bg-gradient-to-br from-[#3a2410] to-[#1a0f04] border border-white/[0.08] text-[11px] font-semibold text-[#F5A623] flex items-center justify-center">
                  {businessInitial}
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[13px] font-semibold text-[#F5F4F1] truncate leading-tight">{businessName}</div>
                  <div className="text-[10.5px] text-white/45 truncate leading-tight mt-[1px]">{businessHandle}</div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-white/40" />
              </button>
            </div>

            {/* Nav — scroll region */}
            <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar px-3 pb-4">
              <nav className="space-y-0.5">
                {primaryNav.map((item) => (
                  <NavLink key={item.path} {...item} />
                ))}
              </nav>
              <div className="my-4 mx-1 border-t border-white/[0.06]" />
              <div className="px-4 mb-2 gravity-label">More</div>
              <nav className="space-y-0.5">
                {secondaryNav.map((item) => (
                  <NavLink key={item.path} {...item} />
                ))}
              </nav>
            </div>

            {/* Footer nav */}
            <div className="p-3 border-t border-white/[0.06]">
              <nav className="space-y-0.5">
                <NavLink path="/settings" label="Settings" icon={Settings} />
                <button
                  onClick={handleLogout}
                  className="group flex items-center gap-3 pl-4 pr-3 h-10 rounded-lg text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.03] transition-colors w-full"
                >
                  <HelpCircle className="w-[15px] h-[15px] text-white/45 group-hover:text-white/70" />
                  <span className="text-[13.5px] font-medium tracking-[-0.005em] flex-1 text-left">Help</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="group flex items-center gap-3 pl-4 pr-3 h-10 rounded-lg text-white/60 hover:text-[#F5F4F1] hover:bg-white/[0.03] transition-colors w-full"
                >
                  <LogOut className="w-[15px] h-[15px] text-white/45 group-hover:text-white/70" />
                  <span className="text-[13.5px] font-medium tracking-[-0.005em] flex-1 text-left">Logout</span>
                </button>
              </nav>
            </div>
          </div>
        </aside>

        {/* ================= MAIN COLUMN ================= */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile top bar */}
          <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-white/[0.06] bg-[#0A0A0A]/80 backdrop-blur">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-white/80 hover:text-[#F5A623]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#F5A623]" />
              <span className="text-[13px] font-semibold tracking-[0.14em] text-[#F5F4F1]">GRAVITY</span>
            </div>
            <div className="flex items-center gap-2">
              {trialInfo && (
                <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${
                  trialInfo.creditsBalance <= 25
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-white/[0.06] text-white/80'
                }`}>
                  <Zap className="w-3 h-3" />
                  <span className="tabular-nums">{trialInfo.creditsBalance}</span>
                </div>
              )}
              <NotificationBell />
            </div>
          </header>

          {/* Desktop top bar */}
          <header className="hidden md:flex items-center h-16 px-8 border-b border-white/[0.04] bg-transparent">
            <div className="flex items-baseline gap-3 min-w-0">
              <h1 className="text-[15px] font-semibold text-[#F5F4F1] tracking-[-0.01em]">{topBarMeta.title}</h1>
              {topBarMeta.crumb && (
                <>
                  <span className="text-white/25 text-[13px]">/</span>
                  <span className="text-[13px] text-white/50">{topBarMeta.crumb}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                className="w-9 h-9 rounded-lg flex items-center justify-center text-white/55 hover:text-[#F5F4F1] hover:bg-white/[0.04] transition-colors"
                aria-label="Search"
              >
                <Search className="w-4 h-4" />
              </button>
              <div className="w-9 h-9 flex items-center justify-center">
                <NotificationBell />
              </div>

              {/* Credits pill */}
              {trialInfo && (() => {
                const pct = Math.max(0, Math.min(100, (trialInfo.creditsBalance / trialInfo.startingCredits) * 100));
                const isLow = pct <= 25;
                const isMed = pct <= 50 && pct > 25;
                const dotColor = isLow ? '#ef4444' : isMed ? '#F5A623' : '#4ADE80';
                return (
                  <div className="relative" ref={creditPanelRef}>
                    <button
                      onClick={() => setShowCreditPanel(!showCreditPanel)}
                      className="flex items-center gap-2.5 pl-2.5 pr-3 h-9 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
                      <span className="text-[13px] font-semibold text-[#F5F4F1] tabular-nums">{trialInfo.creditsBalance}</span>
                      <span className="text-[11px] text-white/45">credits</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-white/40 transition-transform ${showCreditPanel ? 'rotate-180' : ''}`} />
                    </button>
                    {showCreditPanel && (
                      <div
                        className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl shadow-2xl border border-white/[0.08] bg-[#151515] z-50 overflow-hidden"
                        style={{ animation: 'fadeSlideDown 0.2s ease-out' }}
                      >
                        <div className="px-5 pt-5 pb-4 bg-white/[0.02]">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-[13px] font-semibold text-[#F5F4F1]">Usage Overview</h3>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium tracking-wider uppercase ${
                              trialInfo.daysLeft <= 2 ? 'bg-red-500/10 text-red-400' : 'bg-[#F5A623]/10 text-[#F5A623]'
                            }`}>Free Trial</span>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-end justify-between">
                              <div>
                                <span className="text-2xl font-serif-display font-semibold text-[#F5F4F1] tabular-nums">{trialInfo.creditsBalance}</span>
                                <span className="text-sm ml-1 text-white/40">/ {trialInfo.startingCredits}</span>
                              </div>
                              <span className="text-[11px] text-white/40">{trialInfo.totalUsed} used</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden bg-white/[0.06]">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${pct}%`,
                                  background: isLow
                                    ? 'linear-gradient(90deg,#ef4444,#dc2626)'
                                    : isMed
                                      ? 'linear-gradient(90deg,#F5A623,#d97706)'
                                      : 'linear-gradient(90deg,#4ADE80,#16a34a)'
                                }}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="px-5 py-3 border-t border-white/[0.06]">
                          <p className="gravity-label mb-2">Credit Costs</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {Object.entries(trialInfo.costs || {}).filter(([, v]) => v > 0).map(([action, cost]) => (
                              <div key={action} className="flex items-center justify-between px-2 py-1 rounded-lg text-[11px] bg-white/[0.03]">
                                <span className="text-white/50">
                                  {ACTION_LABELS[action]?.icon} {ACTION_LABELS[action]?.label || action}
                                </span>
                                <span className="font-medium tabular-nums text-[#F5F4F1]">{cost}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.02]">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Clock className={`w-3.5 h-3.5 ${trialInfo.daysLeft <= 2 ? 'text-red-400' : 'text-white/40'}`} />
                              <span className={`text-[11px] ${trialInfo.daysLeft <= 2 ? 'text-red-400 font-medium' : 'text-white/50'}`}>
                                {trialInfo.daysLeft} day{trialInfo.daysLeft !== 1 ? 's' : ''} left in trial
                              </span>
                            </div>
                            <button
                              onClick={() => navigate('/trial-expired')}
                              className="text-[11px] font-semibold text-[#F5A623] hover:text-[#ffb833] transition-colors"
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

              {/* Primary CTA — Create post */}
              <Link
                to="/campaigns"
                className="ml-1 flex items-center gap-2 h-9 pl-3 pr-3 rounded-lg bg-[#F5A623] hover:bg-[#ffb833] text-[#1A1208] text-[13px] font-semibold shadow-[0_4px_18px_rgba(245,166,35,0.25)] transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Create post</span>
                <kbd className="ml-1 hidden lg:inline-flex items-center gap-1 h-5 px-1.5 rounded bg-[#1A1208]/20 text-[10px] font-semibold text-[#1A1208]/70">
                  ⌘N
                </kbd>
              </Link>
            </div>
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
