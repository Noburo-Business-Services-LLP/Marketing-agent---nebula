// Every page that is loaded on demand, in one place. App.tsx wraps each loader in lazyWithRetry;
// the same loaders are used to fetch a page early (when the menu is hovered, or while the browser is idle).
// A loader called twice reuses the same download, so prefetching never costs a second request.
export const PAGE_LOADERS = {
  LandingPage: () => import('../pages/LandingPage'),
  Auth: () => import('../pages/Auth'),
  Onboarding: () => import('../pages/Onboarding'),
  TrialExpired: () => import('../pages/TrialExpired'),
  CreateVideo: () => import('../pages/CreateVideo'),
  Dashboard: () => import('../pages/Dashboard'),
  PlanHub: () => import('../pages/PlanHub'),
  InsightsHub: () => import('../pages/InsightsHub'),
  GravityCreate: () => import('../pages/GravityCreate'),
  Library: () => import('../pages/Library'),
  GravityCalendar: () => import('../pages/GravityCalendar'),
  Campaigns: () => import('../pages/Campaigns'),
  ContentCalendar: () => import('../pages/ContentCalendar'),
  SocialInbox: () => import('../pages/SocialInbox'),
  CsmClients: () => import('../pages/CsmClients'),
  AgencyClients: () => import('../pages/AgencyClients'),
  StaffLayout: () => import('../pages/staff/StaffLayout'),
  UploadAndSchedule: () => import('../pages/UploadAndSchedule'),
  ReelGenerator: () => import('../pages/ReelGenerator'),
  HeroVideo: () => import('../pages/HeroVideo'),
  AdCampaigns: () => import('../pages/AdCampaigns'),
  ConnectSocials: () => import('../pages/ConnectSocials'),
  BrandAssets: () => import('../pages/BrandAssets'),
  Settings: () => import('../pages/Settings'),
  Help: () => import('../pages/Help'),
  Analytics: () => import('../pages/Analytics'),
  SEOAssistant: () => import('../pages/SEOAssistant'),
  AIHistory: () => import('../pages/AIHistory'),
  AIPerformance: () => import('../pages/AIPerformance'),
  InfluencerPortal: () => import('../pages/InfluencerPortal'),
  InfluencerList: () => import('../pages/InfluencerList'),
  Collaborations: () => import('../pages/Collaborations'),
  SubmissionReview: () => import('../pages/SubmissionReview'),
  InfluencerAnalytics: () => import('../pages/InfluencerAnalytics'),
  InfluencerProfile: () => import('../pages/InfluencerProfile'),
  TermsAndConditions: () => import('../pages/TermsAndConditions'),
  PrivacyPolicy: () => import('../pages/PrivacyPolicy'),
  RefundPolicy: () => import('../pages/RefundPolicy'),
  BlueprintRoutes: () => import('../pages/BlueprintRoutes'),
  Photoshoot: () => import('../pages/Photoshoot'),
} as const;

export type PageName = keyof typeof PAGE_LOADERS;

/** Menu address (the part after #) to the page file it opens. Only the pages people open from the menu. */
export const PREFETCH_BY_PATH: Record<string, PageName> = {
  '/library': 'Library',
  '/campaigns': 'GravityCreate',
  '/plan': 'PlanHub',
  '/analytics': 'InsightsHub',
  '/reels': 'CreateVideo',
  '/photoshoot': 'Photoshoot',
  '/brand-assets': 'BrandAssets',
  '/settings': 'Settings',
  '/help': 'Help',
  '/ad-campaigns': 'AdCampaigns',
  '/connect-socials': 'ConnectSocials',
  '/inbox': 'SocialInbox',
  '/trial-expired': 'TrialExpired',
};

/** The pages most people open right after Home; fetched when the browser is idle. */
export const IDLE_PREFETCH: PageName[] = ['Library', 'GravityCreate', 'PlanHub'];

const started = new Set<PageName>();

/** Starts downloading a page file. Safe to call many times; a failure is ignored here (the real open retries and reports it). */
export function prefetchPage(name: PageName): void {
  if (started.has(name)) return;
  started.add(name);
  PAGE_LOADERS[name]().catch(() => { started.delete(name); });
}

/** Reads the route out of a menu link such as "#/library?view=approve". */
export function pathOfHash(href: string | null | undefined): string | null {
  if (!href) return null;
  const i = href.indexOf('#/');
  if (i < 0) return null;
  return href.slice(i + 1).split(/[?#]/)[0] || null;
}

export function prefetchForHref(href: string | null | undefined): void {
  const p = pathOfHash(href);
  const name = p ? PREFETCH_BY_PATH[p] : undefined;
  if (name) prefetchPage(name);
}

/** Fetches the likely next pages when the browser has nothing else to do. Returns a function that cancels it. */
export function prefetchWhenIdle(names: PageName[] = IDLE_PREFETCH): () => void {
  const w = window as any;
  const run = () => names.forEach(prefetchPage);
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(run, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(run, 2500);
  return () => window.clearTimeout(t);
}
