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
  Plus,
  Lightbulb,
  Sun,
  Moon
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

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout }) => {
  const { isDarkMode, toggleTheme } = useTheme();
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

  // Nav grouping follows the order the work actually happens in: look at
  // where things stand, make something, review it, schedule it, see how it
  // did. Videos sits beside Create because it is the other thing you make —
  // it was previously under a "More" heading, below Insights, which ranked a
  // headline feature under a junk drawer.
  const primaryNav = [
    { path: '/dashboard',        label: 'Dashboard',         icon: LayoutDashboard },
    { path: '/campaigns',        label: 'Create',            icon: Sparkles },
    { path: '/reels',            label: 'Videos',            icon: PlayCircle },
    { path: '/drafts',           label: 'Approve',           icon: PenTool, badge: 'drafts' as const },
    { path: '/content-calendar', label: 'Calendar',          icon: CalendarDays },
    { path: '/idea-inbox',       label: 'Idea Inbox',        icon: Lightbulb },
    { path: '/upload',           label: 'Upload & Schedule', icon: UploadCloud },
    { path: '/analytics',        label: 'Insights',          icon: BarChart3 },
  ];
  // What is left is genuinely set-once configuration, which is a real
  // grouping rather than "everything else".
  //
  // Ad Campaigns, Influencer Portal and Competitors remain hidden from
  // navigation. Their routes and pages are left intact so nothing breaks and
  // they can be restored by adding entries here.
  const secondaryNav = [
    { path: '/brand-assets',      label: 'Brand Assets',      icon: Palette },
    { path: '/connect-socials',   label: 'Connect Socials',   icon: Link2 },
    { path: '/ai-memory',         label: 'AI Memory',         icon: Brain },
  ];

  const resolveTopBarMeta = (pathname: string) => {
    if (pathname.startsWith('/campaigns')) return { title: 'Create', crumb: 'New campaign' };
    if (pathname.startsWith('/content-calendar')) return { title: 'Calendar', crumb: '' };
    if (pathname.startsWith('/reels')) return { title: 'Videos', crumb: '' };
    if (pathname.startsWith('/influencer-portal')) return { title: 'Influencer Portal', crumb: '' };
    if (pathname.startsWith('/ad-campaigns')) return { title: 'Ad Campaigns', crumb: '' };
    if (pathname.startsWith('/connect-socials')) return { title: 'Connect Socials', crumb: '' };
    if (pathname.startsWith('/brand-assets')) return { title: 'Brand Assets', crumb: '' };
    if (pathname.startsWith('/inventory')) return { title: 'Brand Assets', crumb: 'Products & Services' };
    if (pathname.startsWith('/analytics')) return { title: 'Insights', crumb: '' };
    if (pathname.startsWith('/competitors')) return { title: 'Competitors', crumb: '' };
    if (pathname.startsWith('/ai-memory') || pathname.startsWith('/ai-history') || pathname.startsWith('/ai-performance')) return { title: 'AI Memory', crumb: '' };
    if (pathname.startsWith('/drafts')) return { title: 'Approve', crumb: '' };
    if (pathname.startsWith('/settings')) return { title: 'Settings', crumb: '' };
    return { title: 'Dashboard', crumb: '' };
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
  const businessHandle = user?.email || 'Add your email in Settings';

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
            ? 'bg-[var(--gv-surface-2)] text-[var(--gv-text-primary)]'
            : 'text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-1)]'
        }`}
      >
        {active && (
          <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-[var(--gv-accent)]" />
        )}
        <Icon className={`w-[15px] h-[15px] ${active ? 'text-[var(--gv-accent)]' : 'text-[var(--gv-text-tertiary)] group-hover:text-[var(--gv-text-secondary)]'}`} />
        <span className="text-[13.5px] font-medium tracking-[-0.005em] flex-1">{label}</span>
        {badge === 'drafts' && trialInfo && (
          <span className="ml-auto min-w-[20px] h-[18px] px-1.5 rounded-full bg-[var(--gv-accent)] text-[#1A1208] text-[10px] font-bold flex items-center justify-center">
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

      <div className="relative z-[1] flex h-screen font-sans text-[var(--gv-text-primary)]">
        {/* Mobile overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ================= SIDEBAR ================= */}
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-[240px] bg-[var(--gv-panel)] border-r border-[var(--gv-border-subtle)] transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:inset-auto ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex flex-col h-full min-h-0">
            {/* Brand mark */}
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-center gap-2.5">
                <span className="w-[18px] h-[18px] rounded-full bg-[var(--gv-accent)] shadow-[0_0_18px_rgba(245,166,35,0.5)]" />
                <div className="leading-tight">
                  <div className="text-[13px] font-semibold tracking-[0.14em] text-[var(--gv-text-primary)]">GRAVITY</div>
                  <div className="text-[9px] tracking-[0.22em] text-[var(--gv-text-muted)] mt-[1px]">BY NEBULAA</div>
                </div>
                <button
                  className="ml-auto md:hidden text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)]"
                  onClick={() => setSidebarOpen(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Account chip — opens Settings straight into Business Profile,
                since that's what someone clicking their own account name is
                almost always after. */}
            <div className="px-4 mb-4">
              <button
                onClick={() => { setSidebarOpen(false); navigate('/settings?tab=business'); }}
                title="Business profile settings"
                className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl bg-[var(--gv-surface-1)] border border-[var(--gv-border-subtle)] hover:bg-[var(--gv-surface-2)] transition-colors"
              >
                <span className="w-7 h-7 rounded-md bg-gradient-to-br from-[#3a2410] to-[#1a0f04] border border-[var(--gv-border-default)] text-[11px] font-semibold text-[#F5A623] flex items-center justify-center">
                  {businessInitial}
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[13px] font-semibold text-[var(--gv-text-primary)] truncate leading-tight">{businessName}</div>
                  <div className="text-[10.5px] text-[var(--gv-text-tertiary)] truncate leading-tight mt-[1px]">{businessHandle}</div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--gv-text-muted)]" />
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                className="w-full flex items-center justify-center gap-2 mt-2 h-8 rounded-lg border border-[var(--gv-border-subtle)] text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] transition-colors"
              >
                {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span className="text-[11px] font-medium">{isDarkMode ? 'Light mode' : 'Dark mode'}</span>
              </button>
            </div>

            {/* Nav — scroll region */}
            <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar px-3 pb-4">
              <nav className="space-y-0.5">
                {primaryNav.map((item) => (
                  <NavLink key={item.path} {...item} />
                ))}
              </nav>
              <div className="my-4 mx-1 border-t border-[var(--gv-border-subtle)]" />
              <div className="px-4 mb-2 gravity-label">Setup</div>
              <nav className="space-y-0.5">
                {secondaryNav.map((item) => (
                  <NavLink key={item.path} {...item} />
                ))}
              </nav>
            </div>

            {/* Footer nav */}
            <div className="p-3 border-t border-[var(--gv-border-subtle)]">
              <nav className="space-y-0.5">
                <NavLink path="/settings" label="Settings" icon={Settings} />
                <button
                  onClick={handleLogout}
                  className="group flex items-center gap-3 pl-4 pr-3 h-10 rounded-lg text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-1)] transition-colors w-full"
                >
                  <HelpCircle className="w-[15px] h-[15px] text-[var(--gv-text-tertiary)] group-hover:text-[var(--gv-text-secondary)]" />
                  <span className="text-[13.5px] font-medium tracking-[-0.005em] flex-1 text-left">Help</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="group flex items-center gap-3 pl-4 pr-3 h-10 rounded-lg text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-1)] transition-colors w-full"
                >
                  <LogOut className="w-[15px] h-[15px] text-[var(--gv-text-tertiary)] group-hover:text-[var(--gv-text-secondary)]" />
                  <span className="text-[13.5px] font-medium tracking-[-0.005em] flex-1 text-left">Logout</span>
                </button>
              </nav>
            </div>
          </div>
        </aside>

        {/* ================= MAIN COLUMN ================= */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile top bar */}
          <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] backdrop-blur">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-[var(--gv-text-secondary)] hover:text-[var(--gv-accent-text)]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[var(--gv-accent)]" />
              <span className="text-[13px] font-semibold tracking-[0.14em] text-[var(--gv-text-primary)]">GRAVITY</span>
            </div>
            <div className="flex items-center gap-2">
              {trialInfo && (
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${
                    trialInfo.creditsBalance <= 25
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-[var(--gv-surface-2)] text-[var(--gv-text-secondary)]'
                  }`}
                  title="Quarks"
                >
                  <Zap className="w-3 h-3" />
                  <span className="tabular-nums">{trialInfo.creditsBalance}</span>
                </div>
              )}
              <NotificationBell />
            </div>
          </header>

          {/* Desktop top bar */}
          <header className="hidden md:flex items-center h-16 px-8 border-b border-[var(--gv-border-subtle)] bg-transparent">
            <div className="flex items-baseline gap-3 min-w-0">
              <h1 className="text-[15px] font-semibold text-[var(--gv-text-primary)] tracking-[-0.01em]">{topBarMeta.title}</h1>
              {topBarMeta.crumb && (
                <>
                  <span className="text-[var(--gv-text-muted)] text-[13px]">/</span>
                  <span className="text-[13px] text-[var(--gv-text-tertiary)]">{topBarMeta.crumb}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] transition-colors"
                aria-label="Search"
              >
                <Search className="w-4 h-4" />
              </button>
              <div className="w-9 h-9 flex items-center justify-center">
                <NotificationBell />
              </div>

              {/* Quarks pill */}
              {trialInfo && (() => {
                // An absolute threshold, not percent-of-100: the old bar
                // computed balance / startingCredits, and startingCredits
                // was a hard-coded 100 with no real meaning once an account
                // has been topped up past its original trial allowance —
                // that is how "932 / 100" ends up on screen, still showing
                // a full green bar because the fraction clamps at 100%.
                // Nothing on the backend tracks a real per-period allotment
                // to show honest progress against, so this shows the count
                // plainly instead of a fraction implying a quota that isn't
                // actually being tracked.
                const isLow = trialInfo.creditsBalance <= 25;
                const isMed = trialInfo.creditsBalance > 25 && trialInfo.creditsBalance <= 75;
                const dotColor = isLow ? '#ef4444' : isMed ? '#F5A623' : '#4ADE80';
                return (
                  <div className="relative" ref={creditPanelRef}>
                    <button
                      onClick={() => setShowCreditPanel(!showCreditPanel)}
                      className="flex items-center gap-2.5 pl-2.5 pr-3 h-9 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] hover:bg-[var(--gv-surface-2)] transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
                      <span className="text-[13px] font-semibold text-[var(--gv-text-primary)] tabular-nums">{trialInfo.creditsBalance}</span>
                      <span className="text-[11px] text-[var(--gv-text-tertiary)]">Quarks</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-[var(--gv-text-muted)] transition-transform ${showCreditPanel ? 'rotate-180' : ''}`} />
                    </button>
                    {showCreditPanel && (
                      <div
                        className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl shadow-2xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] z-50 overflow-hidden"
                        style={{ animation: 'fadeSlideDown 0.2s ease-out' }}
                      >
                        <div className="px-5 pt-5 pb-4 bg-[var(--gv-surface-1)]">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-[13px] font-semibold text-[var(--gv-text-primary)]">Usage Overview</h3>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium tracking-wider uppercase whitespace-nowrap ${
                              trialInfo.daysLeft <= 2 ? 'bg-red-500/10 text-red-400' : 'bg-[var(--gv-accent-fill)] text-[var(--gv-accent-text)]'
                            }`}>Free Trial</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex items-baseline gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
                              <span className="text-3xl font-serif-display font-semibold text-[var(--gv-text-primary)] tabular-nums leading-none">{trialInfo.creditsBalance}</span>
                              <span className="text-[13px] text-[var(--gv-text-tertiary)]">Quarks</span>
                            </div>
                            <div className="h-8 w-px bg-[var(--gv-surface-3)]" />
                            <div className="text-[11px] text-[var(--gv-text-muted)] leading-tight">
                              <div className="tabular-nums text-[var(--gv-text-tertiary)] font-medium">{trialInfo.totalUsed}</div>
                              <div>used all-time</div>
                            </div>
                          </div>
                        </div>
                        <div className="px-5 py-3 border-t border-[var(--gv-border-subtle)]">
                          <button
                            onClick={() => { setShowCreditPanel(false); navigate('/settings'); }}
                            className="w-full flex items-center justify-between text-[11.5px] text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] transition-colors"
                          >
                            <span>What does each action cost?</span>
                            <span className="text-[var(--gv-accent-text)]">See in Settings →</span>
                          </button>
                        </div>
                        <div className="px-5 py-3 border-t border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)]">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Clock className={`w-3.5 h-3.5 ${trialInfo.daysLeft <= 2 ? 'text-red-400' : 'text-[var(--gv-text-muted)]'}`} />
                              <span className={`text-[11px] ${trialInfo.daysLeft <= 2 ? 'text-red-400 font-medium' : 'text-[var(--gv-text-tertiary)]'}`}>
                                {trialInfo.daysLeft} day{trialInfo.daysLeft !== 1 ? 's' : ''} left in trial
                              </span>
                            </div>
                            <button
                              onClick={() => navigate('/trial-expired')}
                              className="text-[11px] font-semibold text-[var(--gv-accent-text)] hover:text-[var(--gv-accent-hover)] transition-colors"
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
                className="ml-1 flex items-center gap-2 h-9 pl-3 pr-3 rounded-lg bg-[var(--gv-accent)] hover:bg-[var(--gv-accent-hover)] text-[#1A1208] text-[13px] font-semibold shadow-[0_4px_18px_rgba(245,166,35,0.25)] transition-colors"
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
