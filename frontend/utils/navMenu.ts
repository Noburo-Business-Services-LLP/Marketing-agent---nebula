/**
 * The left menu model (navigation phases 3 to 5, docs/superpowers/impact-maps/simplify-navigation.md):
 * Home, Plan, Create, Library, Inbox, Insights and a folded Setup group. Pure, no DOM, tested in tests/navMenu.test.mjs.
 */

/** Is the current page inside this group of menu items? Used to keep the folded group open on its own pages. */
export function groupHasPath(pathname: string, paths: string[]): boolean {
  return paths.some((p) => pathname === p || (p !== '/dashboard' && pathname.startsWith(`${p}/`)) || pathname.startsWith(`${p}?`));
}

type NavUser = { plan?: { tier?: string | null } | null; staffRole?: string | null; isCsm?: boolean; actingAgency?: unknown } | null | undefined;

/**
 * The Competitors tab of Insights. Shown to every signed-in account (free, paid, managed, staff, CSM, agency) so the
 * feature can always be found; the page itself shows the calm "add-on" note to those without it (decision D22).
 */
export function showsCompetitorsEntry(user: NavUser, _holdsReturnPass: boolean): boolean {
  return !!user;
}

export type NavSection = 'staff' | 'clients' | 'home' | 'plan' | 'create' | 'library' | 'inbox' | 'insights' | 'setup' | 'other';

const starts = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);

/** Which menu entry a page belongs to. Moved pages (Videos, Photoshoot, Blueprint pages, history pages) light up their category. */
export function navSectionOf(pathname: string): NavSection {
  const p = pathname || '/';
  if (starts(p, '/staff')) return 'staff';
  if (starts(p, '/clients') || starts(p, '/agency/clients')) return 'clients';
  if (p === '/' || p === '/dashboard') return 'home';
  if (starts(p, '/plan') || starts(p, '/blueprint') || starts(p, '/content-calendar') || starts(p, '/idea-inbox')) return 'plan';
  if (starts(p, '/campaigns') || starts(p, '/reels') || starts(p, '/photoshoot') || starts(p, '/upload')) return 'create';
  if (starts(p, '/library') || starts(p, '/drafts')) return 'library';
  if (starts(p, '/inbox')) return 'inbox';
  if (starts(p, '/analytics') || starts(p, '/competitors') || starts(p, '/ai-memory') || starts(p, '/ai-history') || starts(p, '/ai-performance')) return 'insights';
  if (starts(p, '/brand-assets') || starts(p, '/inventory') || starts(p, '/connect-socials') || starts(p, '/settings') || starts(p, '/help')) return 'setup';
  return 'other';
}

export interface NavSubItem { key: string; label: string; to: string }
export interface NavOptions { showsMyPlan: boolean; showsCompetitors: boolean }

/** The tabs of the Plan page, in order. My plan only for the accounts that have one. */
export function planTabs(o: Pick<NavOptions, 'showsMyPlan'>): NavSubItem[] {
  return [
    ...(o.showsMyPlan ? [{ key: 'plan', label: 'My plan', to: '/plan' }] : []),
    { key: 'calendar', label: 'Calendar', to: o.showsMyPlan ? '/plan?tab=calendar' : '/plan' },
    { key: 'ideas', label: 'Content ideas', to: '/plan?tab=ideas' },
    { key: 'blueprint', label: 'Blueprint', to: '/plan?tab=blueprint' },
  ];
}

/** The tabs of the Insights page, in order. Competitors only where the entry was shown before. */
export function insightsTabs(o: Pick<NavOptions, 'showsCompetitors'>): NavSubItem[] {
  return [
    { key: 'performance', label: 'Performance', to: '/analytics' },
    ...(o.showsCompetitors ? [{ key: 'competitors', label: 'Competitors', to: '/analytics?tab=competitors' }] : []),
    { key: 'learned', label: 'What Nebulaa learned', to: '/analytics?tab=learned' },
  ];
}

/** The things you make. Their pages keep their own addresses; the Create entry lights up on all of them. */
export const CREATE_ITEMS: NavSubItem[] = [
  { key: 'content', label: 'Create content', to: '/campaigns' },
  { key: 'video', label: 'Create video', to: '/reels' },
  { key: 'photoshoot', label: 'Photoshoot', to: '/photoshoot' },
];

/** The three parts of the Inbox (they already exist as ?tab= parts on the page). */
export const INBOX_ITEMS: NavSubItem[] = [
  { key: 'messages', label: 'Messages and comments', to: '/inbox' },
  { key: 'reviews', label: 'Reviews', to: '/inbox?tab=reviews' },
  { key: 'auto-reply', label: 'Automatic replies', to: '/inbox?tab=auto-reply' },
];

/** The sub-items drawn indented under an open menu entry. */
export function navSubItems(section: NavSection, o: NavOptions): NavSubItem[] {
  if (section === 'plan') return planTabs(o);
  if (section === 'create') return CREATE_ITEMS;
  if (section === 'inbox') return INBOX_ITEMS;
  if (section === 'insights') return insightsTabs(o);
  return [];
}

const tabOf = (search: string) => new URLSearchParams(search || '').get('tab') || '';

/** Which sub-item is the current page, or '' when none is (for example a Blueprint document under Plan). */
export function activeSubKey(pathname: string, search: string, o: NavOptions): string {
  const section = navSectionOf(pathname);
  const tab = tabOf(search);
  if (section === 'plan') {
    if (pathname !== '/plan') return pathname.startsWith('/blueprint') ? 'blueprint' : '';
    const keys = planTabs(o).map((t) => t.key);
    return keys.includes(tab) ? tab : keys[0];
  }
  if (section === 'create') {
    if (starts(pathname, '/reels')) return 'video';
    if (starts(pathname, '/photoshoot')) return 'photoshoot';
    return 'content';
  }
  if (section === 'inbox') return tab === 'reviews' || tab === 'auto-reply' ? tab : 'messages';
  if (section === 'insights') {
    if (pathname !== '/analytics') return 'learned';
    const keys = insightsTabs(o).map((t) => t.key);
    return keys.includes(tab) ? tab : tab === 'competitors' ? 'competitors' : 'performance';
  }
  return '';
}

/**
 * Old addresses and where they now open (replace redirects in App.tsx; kept for good so bookmarks work).
 * The old query string is kept; the target's own parameters win, except where `tabs` maps an old tab to a new one.
 */
export const NAV_REDIRECTS: ReadonlyArray<{ from: string; to: string; tabs?: Record<string, string> }> = Object.freeze([
  { from: '/drafts', to: '/library?view=approve' },
  { from: '/content-calendar', to: '/plan?tab=calendar', tabs: { ideas: 'ideas', calendar: 'calendar' } },
  { from: '/idea-inbox', to: '/plan?tab=ideas' },
  { from: '/blueprint', to: '/plan?tab=blueprint' },
  { from: '/competitors', to: '/analytics?tab=competitors' },
  { from: '/ai-memory', to: '/analytics?tab=learned' },
]);

/** The address an old path opens, with its query string kept. Unknown paths come back unchanged. */
export function redirectTarget(from: string, search = ''): string {
  const rule = NAV_REDIRECTS.find((r) => r.from === from);
  if (!rule) return `${from}${search && !search.startsWith('?') ? '?' : ''}${search}`;
  const [path, q = ''] = rule.to.split('?');
  const old = new URLSearchParams(search || '');
  const target = new URLSearchParams(q);
  const oldTab = old.get('tab');
  old.delete('tab');
  const merged = new URLSearchParams(old);
  target.forEach((v, k) => merged.set(k, v));
  if (oldTab && rule.tabs && rule.tabs[oldTab]) merged.set('tab', rule.tabs[oldTab]);
  const s = merged.toString();
  return s ? `${path}?${s}` : path;
}

/** The title and crumb in the top bar. Moved pages show their category and their own name. */
export function topBarMeta(pathname: string, search = ''): { title: string; crumb: string } {
  const tab = tabOf(search);
  const view = new URLSearchParams(search || '').get('view') || '';
  if (pathname.startsWith('/plan')) {
    const crumb = { calendar: 'Calendar', ideas: 'Content ideas', blueprint: 'Blueprint' }[tab] || '';
    return { title: 'Plan', crumb: crumb || 'My plan' };
  }
  if (pathname.startsWith('/blueprint')) return { title: 'Plan', crumb: 'Blueprint' };
  if (pathname.startsWith('/campaigns')) return { title: 'Create', crumb: tab === 'upload' ? 'Upload and schedule' : 'Create content' };
  if (pathname.startsWith('/reels')) return { title: 'Create', crumb: 'Create video' };
  if (pathname.startsWith('/photoshoot')) return { title: 'Create', crumb: 'Photoshoot' };
  if (pathname.startsWith('/upload')) return { title: 'Create', crumb: 'Upload and schedule' };
  if (pathname.startsWith('/library')) return { title: 'Library', crumb: view === 'approve' ? 'Needs approval' : '' };
  if (pathname.startsWith('/inbox')) return { title: 'Inbox', crumb: tab === 'reviews' ? 'Reviews' : tab === 'auto-reply' ? 'Automatic replies' : '' };
  if (pathname.startsWith('/analytics')) {
    const crumb = { competitors: 'Competitors', learned: 'What Nebulaa learned' }[tab] || 'Performance';
    return { title: 'Insights', crumb };
  }
  if (pathname.startsWith('/ai-history') || pathname.startsWith('/ai-performance')) return { title: 'Insights', crumb: 'What Nebulaa learned' };
  if (pathname.startsWith('/trial-expired')) return { title: 'Plans', crumb: '' };
  if (pathname.startsWith('/influencer-portal')) return { title: 'Influencer Portal', crumb: '' };
  if (pathname.startsWith('/ad-campaigns')) return { title: 'Ad Campaigns', crumb: '' };
  if (pathname.startsWith('/staff')) return { title: 'Staff area', crumb: '' };
  if (pathname.startsWith('/clients')) return { title: 'My clients', crumb: '' };
  if (pathname.startsWith('/agency/clients')) return { title: 'Clients', crumb: '' };
  if (pathname.startsWith('/connect-socials')) return { title: 'Setup', crumb: 'Connected accounts' };
  if (pathname.startsWith('/brand-assets')) return { title: 'Setup', crumb: 'Brand assets' };
  if (pathname.startsWith('/inventory')) return { title: 'Setup', crumb: 'Brand assets' };
  if (pathname.startsWith('/settings')) return { title: 'Setup', crumb: 'Settings' };
  if (pathname.startsWith('/help')) return { title: 'Setup', crumb: 'Help' };
  return { title: 'Home', crumb: '' };
}

/** The number on the Library entry: nothing for 0 or an unknown count, 99+ above 99. */
export function badgeText(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return v > 99 ? '99+' : String(Math.floor(v));
}
