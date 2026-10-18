/** Is the current page inside this group of menu items? Used to keep the folded group open on its own pages. */
export function groupHasPath(pathname: string, paths: string[]): boolean {
  return paths.some((p) => pathname === p || (p !== '/dashboard' && pathname.startsWith(`${p}/`)) || pathname.startsWith(`${p}?`));
}

type NavUser = { plan?: { tier?: string | null } | null; staffRole?: string | null; isCsm?: boolean; actingAgency?: unknown } | null | undefined;

/**
 * The Competitors menu entry. Shown to every account on a paid plan (a managed account has no tier here)
 * so the add-on can be found; the page itself shows the calm "add-on" note to those without it.
 * Hidden for free accounts and for staff-only navigation; shown inside a client the owner or a CSM has opened.
 */
export function showsCompetitorsEntry(user: NavUser, holdsReturnPass: boolean): boolean {
  if (!user) return false;
  if (user.plan?.tier === 'free') return false;
  const inside = !!user.actingAgency || holdsReturnPass;
  if (inside) return true;
  return !user.staffRole && !user.isCsm;
}
