import React, { useState, useEffect, useRef } from 'react';
import LegalLinks from './LegalLinks';
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
  FileText,
  ClipboardList,
  Inbox,
  Shield,
  Images,
  Binoculars
} from 'lucide-react';
import { User } from '../types';
import NotificationBell from './NotificationBell';
import AppSwitcher from './AppSwitcher';
import ClientSwitcher from './ClientSwitcher';
import AccountMenu from './AccountMenu';
import GuidedTour from './GuidedTour';
import HelpMenu, { TOUR_REPLAY_EVENT } from './HelpMenu';
import { TOUR_STEPS, shouldAutoStart } from '../utils/tour';
import { needsTermsPrompt } from '../utils/accountDeletion';
import { groupHasPath, showsCompetitorsEntry } from '../utils/navMenu';
import { apiService } from '../services/api';
import { staffMenuEntry, returnHashAfterActing } from '../utils/staffHome';
import { balanceChip } from '../utils/plans';
import { actingBannerText, actingClientName, isAgencyUser, isInsideClient, isLapsedAgency, returnButtonLabel, showClientSwitcher, showsPostsNotQuarks } from '../utils/agency';

interface TrialData {
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
  /** A new account with no plan and nothing left: show a slim prompt above the page. */
  needsPlan?: boolean;
  /** Called when the guided tour is finished or skipped, so the local user does not start it again. */
  onTourSaved?: (tour: { completedAt?: string; skippedAt?: string }) => void;
}

const STARTING_CREDITS = 100;

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout, needsPlan = false, onTourSaved }) => {
  // The app shell scrolls inside its own main area. Stop the page behind it from scrolling as well, which is
  // what made the left menu travel up with the content on some screens.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const before = { h: html.style.overflow, b: body.style.overflow };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => { html.style.overflow = before.h; body.style.overflow = before.b; };
  }, []);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [trialInfo, setTrialInfo] = useState<TrialData | null>(null);
  const [showCreditPanel, setShowCreditPanel] = useState(false);
  const creditPanelRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // The guided tour: starts once, on the home screen, for a customer's own account. A ref keeps it from reopening this session.
  const [tourOpen, setTourOpen] = useState(false);
  const tourDone = useRef(false);
  const tourIsReplay = useRef(false);
  const hasCsmPass = Boolean(localStorage.getItem('csmReturnToken'));
  const tourEligible = shouldAutoStart({ user: user ? { ...user, tour: null } : null, path: '/dashboard', hasCsmPass });
  useEffect(() => {
    if (tourOpen || tourDone.current || !user) return undefined;
    if (!shouldAutoStart({ user, path: location.pathname, hasCsmPass }) || needsTermsPrompt(user, hasCsmPass)) return undefined;
    const t = setTimeout(() => { if (!tourDone.current) { tourIsReplay.current = false; setTourOpen(true); } }, 800);
    return () => clearTimeout(t);
  }, [user, location.pathname, hasCsmPass, tourOpen]);
  // A replay asked for from any page waits here until the home screen is showing and its cards have had time to draw.
  const [replayPending, setReplayPending] = useState(false);
  const replayDelay = useRef(0);
  useEffect(() => {
    const onReplay = () => {
      if (!tourEligible || tourOpen) return;
      replayDelay.current = location.pathname === '/dashboard' ? 0 : 800;
      setReplayPending(true);
      if (location.pathname !== '/dashboard') navigate('/dashboard');
    };
    window.addEventListener(TOUR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, onReplay);
  }, [tourEligible, tourOpen, location.pathname, navigate]);
  useEffect(() => {
    if (!replayPending || tourOpen || location.pathname !== '/dashboard') return undefined;
    const t = setTimeout(() => { tourIsReplay.current = true; setReplayPending(false); setTourOpen(true); }, replayDelay.current);
    return () => clearTimeout(t);
  }, [replayPending, tourOpen, location.pathname]);
  const handleTourClose = (reason: 'finished' | 'skipped' | 'closed') => {
    tourDone.current = true;
    setTourOpen(false);
    setSidebarOpen(false);
    if (tourIsReplay.current || reason === 'closed') return; // a replay never changes the saved date; leaving by back or a link saves nothing
    const at = new Date().toISOString();
    if (reason === 'finished') { apiService.saveTour('complete'); onTourSaved?.({ completedAt: at }); }
    else { apiService.saveTour('skip'); onTourSaved?.({ skippedAt: at }); }
  };

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
          creditsBalance: data.credits?.balance ?? 0,
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
  const staffEntry = staffMenuEntry(user, Boolean(localStorage.getItem('csmReturnToken')));
  // My plan is for customers and agency owners (who get a plan like any account), and for a CSM while inside a client; staff accounts keep their own menu.
  const showsMyPlan = isInsideClient(user) || Boolean(localStorage.getItem('csmReturnToken')) || (!!user && !user.staffRole && !user.isCsm && !isLapsedAgency(user));
  const primaryNav = [
    ...(staffEntry?.primary ? [{ path: staffEntry.path, label: staffEntry.label, icon: Shield }] : []),
    ...(user?.isCsm && !localStorage.getItem('csmReturnToken') ? [{ path: '/clients', label: 'My clients', icon: Users }] : []),
    ...(isAgencyUser(user) || isLapsedAgency(user) ? [{ path: '/agency/clients', label: 'Clients', icon: Users }] : []),
    { path: '/dashboard',        label: 'Dashboard',         icon: LayoutDashboard },
    ...(showsMyPlan ? [{ path: '/plan', label: 'My plan', icon: ClipboardList }] : []),
    { path: '/campaigns',        label: 'Create content',    icon: Sparkles },
    { path: '/reels',            label: 'Videos',            icon: PlayCircle },
    { path: '/drafts',           label: 'Review and approve', icon: PenTool, badge: 'drafts' as const },
    { path: '/library',          label: 'Library',           icon: Images },
    { path: '/content-calendar', label: 'Calendar',          icon: CalendarDays },
    { path: '/inbox',            label: 'Inbox',             icon: Inbox },
    { path: '/analytics',        label: 'Performance',       icon: BarChart3 },
    ...(showsCompetitorsEntry(user, Boolean(localStorage.getItem('csmReturnToken'))) ? [{ path: '/competitors', label: 'Competitors', icon: Binoculars }] : []),
  ];
  // Tools used now and then, and set-once configuration, are folded into one group so the menu stays short.
  // Ad Campaigns and Influencer Portal remain hidden from navigation; their routes are intact.
  const secondaryNav = [
    ...(staffEntry && !staffEntry.primary ? [{ path: staffEntry.path, label: staffEntry.label, icon: Shield }] : []),
    { path: '/blueprint',        label: 'Growth Blueprint',  icon: FileText },
    { path: '/brand-assets',      label: 'Brand assets',      icon: Palette },
    { path: '/connect-socials',   label: 'Connected accounts', icon: Link2 },
    { path: '/ai-memory',         label: 'Brand memory',      icon: Brain },
  ];
  const groupOnItsPage = groupHasPath(location.pathname, secondaryNav.map((n) => n.path).filter((p) => !p.startsWith('/staff')));
  const [moreOpen, setMoreOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('nebulaa_sidebar_more') === '1'; } catch { return false; }
  });
  const toggleMore = () => setMoreOpen((o) => {
    try { localStorage.setItem('nebulaa_sidebar_more', o ? '0' : '1'); } catch { /* private mode */ }
    return !o;
  });
  const showMore = moreOpen || groupOnItsPage;

  const resolveTopBarMeta = (pathname: string) => {
    if (pathname.startsWith('/campaigns')) return { title: 'Create content', crumb: 'New campaign' };
    if (pathname.startsWith('/plan')) return { title: 'My plan', crumb: '' };
    if (pathname.startsWith('/trial-expired')) return { title: 'Plans', crumb: '' };
    if (pathname.startsWith('/content-calendar')) return { title: 'Calendar', crumb: '' };
    if (pathname.startsWith('/reels')) return { title: 'Videos', crumb: '' };
    if (pathname.startsWith('/influencer-portal')) return { title: 'Influencer Portal', crumb: '' };
    if (pathname.startsWith('/ad-campaigns')) return { title: 'Ad Campaigns', crumb: '' };
    if (pathname.startsWith('/staff')) return { title: 'Staff area', crumb: '' };
    if (pathname.startsWith('/clients')) return { title: 'My clients', crumb: '' };
    if (pathname.startsWith('/agency/clients')) return { title: 'Clients', crumb: '' };
    if (pathname.startsWith('/inbox')) return { title: 'Inbox', crumb: '' };
    if (pathname.startsWith('/connect-socials')) return { title: 'Connected accounts', crumb: '' };
    if (pathname.startsWith('/brand-assets')) return { title: 'Brand assets', crumb: '' };
    if (pathname.startsWith('/inventory')) return { title: 'Brand assets', crumb: 'Products and services' };
    if (pathname.startsWith('/analytics')) return { title: 'Performance', crumb: '' };
    if (pathname.startsWith('/competitors')) return { title: 'Competitors', crumb: '' };
    if (pathname.startsWith('/ai-memory') || pathname.startsWith('/ai-history') || pathname.startsWith('/ai-performance')) return { title: 'Brand memory', crumb: '' };
    if (pathname.startsWith('/library')) return { title: 'Library', crumb: '' };
    if (pathname.startsWith('/drafts')) return { title: 'Review and approve', crumb: '' };
    if (pathname.startsWith('/idea-inbox')) return { title: 'Content ideas', crumb: '' };
    if (pathname.startsWith('/upload')) return { title: 'Upload and schedule', crumb: '' };
    if (pathname.startsWith('/settings')) return { title: 'Settings', crumb: '' };
    if (pathname.startsWith('/blueprint')) return { title: 'Growth Blueprint', crumb: '' };
    return { title: 'Dashboard', crumb: '' };
  };

  const topBarMeta = resolveTopBarMeta(location.pathname);
  // With two switchers in the bar, a computer-sized screen has no room for the page title; the page has its own heading.
  // Agencies and their clients see the shared pool on the plans page, so the balance chip is not shown to them.
  const hideQuarks = showsPostsNotQuarks(user);
  const clientSwitcherShown = showClientSwitcher(user, Boolean(localStorage.getItem('csmReturnToken')));
  const isActive = (path: string) =>
    path === '/staff/home' ? location.pathname.startsWith('/staff') :
    location.pathname === path || (path !== '/dashboard' && location.pathname.startsWith(path));

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  const businessName = user?.businessProfile?.name || (user?.email ? user.email.split('@')[0] : 'Your Brand');
  const businessInitial = businessName.trim().charAt(0).toUpperCase() || 'B';
  const businessHandle = user?.email || 'Add your email in Settings';

  const NAV_TOUR: Record<string, string> = { '/campaigns': 'nav-create', '/drafts': 'nav-review', '/content-calendar': 'nav-calendar', '/plan': 'nav-plan' };
  const NavLink: React.FC<{
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: 'drafts';
  }> = ({ path, label, icon: Icon }) => {
    const active = isActive(path);
    return (
      <Link
        to={path}
        data-tour={NAV_TOUR[path]}
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
        {/* The drafts badge used to show a hard-coded "5" for everyone. No real
            count is loaded here, so nothing is shown until one is. */}
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

      <div className="relative z-[1] flex h-[100dvh] overflow-hidden font-sans text-[var(--gv-text-primary)]">
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
              <div className="relative flex items-center justify-center">
                <img src="/assets/brand/logo-nebulaa.png" alt="Nebulaa" width={784} height={360} className="h-16 w-auto" />
                <button
                  className="absolute right-0 top-0 md:hidden text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)]"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* On a phone the workspace switch lives here; on a computer it sits in the top bar. */}
            <div className="px-4 mb-3 md:hidden">
              <AppSwitcher onNavigate={() => setSidebarOpen(false)} />
              <div className="mt-2"><ClientSwitcher user={user} onNavigate={() => setSidebarOpen(false)} /></div>
            </div>

            {/* Nav — scroll region */}
            <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar px-3 pb-4">
              <nav className="space-y-0.5">
                {primaryNav.map((item) => (
                  <NavLink key={item.path} {...item} />
                ))}
              </nav>
              <div className="my-3 mx-1 border-t border-[var(--gv-border-subtle)]" />
              <button
                type="button"
                onClick={toggleMore}
                aria-expanded={showMore}
                className="w-full flex items-center justify-between pl-4 pr-3 h-9 rounded-lg text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-1)]"
              >
                <span className="gravity-label">Setup and tools</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMore ? 'rotate-180' : ''}`} />
              </button>
              {showMore && (
                <nav className="space-y-0.5 mt-1">
                  {secondaryNav.map((item) => (
                    <NavLink key={item.path} {...item} />
                  ))}
                </nav>
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--gv-border-subtle)] px-4 py-3">
              <LegalLinks className="text-[11.5px] text-[var(--gv-text-tertiary)]" linkClassName="hover:text-[var(--gv-text-primary)] hover:underline underline-offset-2" />
            </div>
          </div>
        </aside>

        {/* ================= MAIN COLUMN ================= */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {needsPlan && !location.pathname.startsWith('/blueprint') && !location.pathname.startsWith('/trial-expired') && (
            <div className="shrink-0 border-b border-[var(--gv-border-subtle)] bg-[var(--gv-accent-fill)] px-4 md:px-8 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-[13px] text-[var(--gv-text-primary)]">You are looking around. Choose a plan to start making posts and videos. Your Growth Blueprint is free.</p>
              <div className="flex gap-2">
                <button onClick={() => navigate('/blueprint')} className="rounded-lg border border-[var(--gv-border-default)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--gv-text-primary)]">Make my free Blueprint</button>
                <button onClick={() => navigate('/trial-expired')} className="rounded-lg bg-[var(--gv-accent)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--gv-accent-ink)]">See plans</button>
              </div>
            </div>
          )}
          {localStorage.getItem('csmReturnToken') && (
            // A CSM working inside a client's account: always visible above the header, never scrolls away, one click back.
            <div className="shrink-0 border-b border-[#F5A623]/50 bg-[#FDF1DC] px-4 md:px-8 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <p className="text-[13px] text-[var(--gv-text-primary)]">
                {isInsideClient(user)
                  ? actingBannerText(actingClientName(user, localStorage.getItem('csmActingClient')))
                  : <>You are working in <strong>{localStorage.getItem('csmActingClient') || 'a client'}</strong>'s account. Payments, plans and passwords stay with the client.</>}
              </p>
              <button
                onClick={() => { const back = returnHashAfterActing(localStorage.getItem('csmReturnTo')); if (apiService.returnToCsmAccount()) { window.location.hash = back; window.location.reload(); } }}
                className="px-3 py-1 rounded-lg bg-[#F5A623] text-[#070A12] text-[13px] font-bold"
              >
                {returnButtonLabel(localStorage.getItem('csmReturnTo'))}
              </button>
            </div>
          )}

          {/* Mobile top bar */}
          <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-[var(--gv-border-subtle)] bg-[var(--gv-panel)] backdrop-blur">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-[var(--gv-text-secondary)] hover:text-[var(--gv-accent-text)]"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <img src="/assets/brand/logo-nebulaa.png" alt="Nebulaa" width={784} height={360} className="h-8 w-auto" />
            <div className="flex items-center gap-1">
              {trialInfo && !hideQuarks && (
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${
                    balanceChip(trialInfo.creditsBalance, trialInfo.costs).low
                      ? 'bg-red-500/10 text-red-400'
                      : 'bg-[var(--gv-surface-2)] text-[var(--gv-text-secondary)]'
                  }`}
                  aria-label={balanceChip(trialInfo.creditsBalance, trialInfo.costs).full || 'Posts and videos left'}
                >
                  <Zap className="w-3 h-3" />
                  <span className="tabular-nums whitespace-nowrap">{balanceChip(trialInfo.creditsBalance, trialInfo.costs).compact || 'Left'}</span>
                </div>
              )}
              <HelpMenu canReplay={tourEligible} canSetup={tourEligible} />
              <NotificationBell />
              <AccountMenu name={businessName} email={businessHandle} onLogout={handleLogout} compact />
            </div>
          </header>

          {/* Desktop top bar */}
          <header className="hidden md:flex items-center h-16 px-8 border-b border-[var(--gv-border-subtle)] bg-transparent">
            <div className="w-[170px] mr-5 shrink-0"><AppSwitcher /></div>
            <div className="w-[170px] mr-5 shrink-0 empty:hidden"><ClientSwitcher user={user} /></div>
            <div className={`${clientSwitcherShown ? 'hidden xl:flex' : 'flex'} items-baseline gap-3 min-w-0 flex-1`}>
              <h1 className="text-[15px] font-semibold text-[var(--gv-text-primary)] tracking-[-0.01em] truncate">{topBarMeta.title}</h1>
              {topBarMeta.crumb && (
                <>
                  <span className="text-[var(--gv-text-muted)] text-[13px]">/</span>
                  <span className="text-[13px] text-[var(--gv-text-tertiary)]">{topBarMeta.crumb}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <button
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] hover:bg-[var(--gv-surface-2)] transition-colors"
                aria-label="Search"
              >
                <Search className="w-4 h-4" />
              </button>
              <HelpMenu canReplay={tourEligible} canSetup={tourEligible} />
              <div className="w-9 h-9 flex items-center justify-center">
                <NotificationBell />
              </div>

              {/* Balance pill, in posts and videos */}
              {trialInfo && !hideQuarks && (() => {
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
                const chip = balanceChip(trialInfo.creditsBalance, trialInfo.costs);
                const isLow = chip.low;
                const isMed = !isLow && trialInfo.creditsBalance <= 75;
                const dotColor = isLow ? '#ef4444' : isMed ? 'var(--gv-accent)' : '#4ADE80';
                return (
                  <div className="relative" ref={creditPanelRef}>
                    <button
                      onClick={() => setShowCreditPanel(!showCreditPanel)}
                      className="flex items-center gap-2.5 pl-2.5 pr-3 h-9 rounded-lg border border-[var(--gv-border-default)] bg-[var(--gv-surface-1)] hover:bg-[var(--gv-surface-2)] transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
                      <span className="text-[13px] font-semibold text-[var(--gv-text-primary)] whitespace-nowrap">{chip.full || 'Posts and videos left'}</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-[var(--gv-text-muted)] transition-transform ${showCreditPanel ? 'rotate-180' : ''}`} />
                    </button>
                    {showCreditPanel && (
                      <div
                        className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl shadow-2xl border border-[var(--gv-border-default)] bg-[var(--gv-panel)] z-50 overflow-hidden"
                        style={{ animation: 'fadeSlideDown 0.2s ease-out' }}
                      >
                        <div className="px-5 pt-5 pb-4 bg-[var(--gv-surface-1)]">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-[13px] font-semibold text-[var(--gv-text-primary)]">What you have left</h3>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex items-baseline gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
                              <span className="text-[18px] font-serif-display font-semibold text-[var(--gv-text-primary)] leading-snug">{chip.full || 'Posts and videos'}</span>
                            </div>
                          </div>
                        </div>
                        <div className="px-5 py-3 border-t border-[var(--gv-border-subtle)]">
                          <button
                            onClick={() => { setShowCreditPanel(false); navigate('/settings'); }}
                            className="w-full flex items-center justify-between text-[11.5px] text-[var(--gv-text-tertiary)] hover:text-[var(--gv-text-primary)] transition-colors"
                          >
                            <span>Posts and videos share what you have left.</span>
                            <span className="text-[var(--gv-accent-text)]">Settings →</span>
                          </button>
                        </div>
                        {isInsideClient(user) ? (
                          <div className="px-5 py-3 border-t border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)]">
                            <p className="text-[11px] text-[var(--gv-text-tertiary)]">Plans and top-ups are handled in your agency account.</p>
                          </div>
                        ) : (
                          <div className="px-5 py-3 border-t border-[var(--gv-border-subtle)] bg-[var(--gv-surface-1)]">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5 text-[var(--gv-text-muted)]" />
                                <span className="text-[11px] text-[var(--gv-text-tertiary)]">Need more posts and videos?</span>
                              </div>
                              <button
                                onClick={() => navigate('/trial-expired')}
                                className="text-[11px] font-semibold text-[var(--gv-accent-text)] hover:text-[var(--gv-accent-hover)] transition-colors"
                              >
                                See plans
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              <AccountMenu name={businessName} email={businessHandle} onLogout={handleLogout} />
            </div>
          </header>

          <main className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-8">
            {children}
          </main>
        </div>
      </div>
      <GuidedTour open={tourOpen} steps={TOUR_STEPS} onClose={handleTourClose} onNeedsMenu={setSidebarOpen} />
    </>
  );
};

export default Layout;
