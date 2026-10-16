/** Small rules for the agency screens, kept apart so they can be tested. Nothing here shows Quarks. */

type PlanLike = { plan?: { tier?: string | null } | null; actingAgency?: unknown; agency?: { clientCount?: number } | null } | null | undefined;

/** The server sends actingAgency and actingCsm NEXT to user on /auth/me; the app keeps them on the user so the checks work. */
export function mergeActing<U extends object>(response: { user?: U | null; actingAgency?: unknown; actingCsm?: unknown } | null | undefined): (U & { actingAgency: unknown; actingCsm: unknown }) | null {
  if (!response || !response.user) return null;
  return { ...response.user, actingAgency: response.actingAgency ?? null, actingCsm: response.actingCsm ?? null };
}

/** An account on the Agency plan; a client workspace inside it is not an agency. */
export function isAgencyUser(user: PlanLike): boolean {
  return !!user && user.plan?.tier === 'agency' && !user.actingAgency;
}

/** An owner whose Agency plan ended but who still has client brands: they can still see them, remove them and renew. */
export function isLapsedAgency(user: PlanLike): boolean {
  return !!user && !user.actingAgency && user.plan?.tier !== 'agency' && Number(user.agency?.clientCount || 0) > 0;
}

/** Agency accounts and client workspaces see posts and videos, never Quarks. */
export function showsPostsNotQuarks(user: PlanLike): boolean {
  return isAgencyUser(user) || isInsideClient(user) || isLapsedAgency(user);
}

/** What the shared pool holds, in the words an agency uses. */
export function poolText(posts: number, videos: number): string {
  const p = Math.max(0, Math.floor(Number(posts) || 0));
  const v = Math.max(0, Math.floor(Number(videos) || 0));
  return `${p} ${p === 1 ? 'post' : 'posts'} and ${v} ${v === 1 ? 'video' : 'videos'} left in the shared pool`;
}

/** True while working inside one of an agency's clients (the server says so on the user). */
export function isInsideClient(user: PlanLike): boolean {
  return !!user && !!user.actingAgency;
}

/** The client switcher shows for an agency and, with its own pass held, inside one of its clients. */
export function showClientSwitcher(user: PlanLike, holdsReturnPass: boolean): boolean {
  if (isAgencyUser(user)) return true;
  return isInsideClient(user) && holdsReturnPass;
}

export const clientsLeft = (used: number, limit: number): number => Math.max(0, limit - used);
export const limitLabel = (used: number, limit: number): string => `${used} of ${limit} clients`;
export const actingBannerText = (name: string): string =>
  `You are working in ${name || 'a client'}'s brand. Payments, plans and passwords are handled in your agency account.`;

/** The client's own name: the one the open call returned, else the workspace's own name. Never the agency owner's name. */
export function actingClientName(user: { businessProfile?: { name?: string } | null; companyName?: string; agency?: { workspaceName?: string } | null } | null | undefined, stored?: string | null): string {
  const a = user as { agency?: { workspaceName?: string } | null } | null | undefined;
  return (stored || '').trim() || a?.agency?.workspaceName || user?.businessProfile?.name || user?.companyName || '';
}

/** The return button in the bar at the top while inside a client or a staff-opened account. */
export function returnButtonLabel(returnTo: string | null | undefined): string {
  return returnTo === '#/staff/clients' ? 'Back to staff area' : 'Back to my clients';
}

export type ClientRow = { id: string; name: string; frozen?: boolean; createdAt?: string };

export function pausedReason(limit: number): string {
  if (!limit) return 'Your Agency plan is not active, so every client is paused. Nothing was deleted.';
  return `Your plan now includes ${limit} clients, so this client is paused. Nothing was deleted. Add a client slot or remove a client to use it again.`;
}

export function clientStatus(client: { frozen?: boolean }, limit: number): { paused: boolean; label: 'Active' | 'Paused'; reason: string; canOpen: boolean } {
  const paused = !!client.frozen;
  return { paused, label: paused ? 'Paused' : 'Active', reason: paused ? pausedReason(limit) : '', canOpen: !paused };
}

export type UsageRow = ClientRow & { posts: number; videos: number; lastActive: string | null };

const count = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

/** The client list with this month's posts and videos. Quark figures in the answer are dropped on purpose. */
export function mergeUsage(clients: ClientRow[], usage: { clients?: Array<{ id: string; posts?: unknown; videos?: unknown; lastActive?: string | null }> } | null | undefined): UsageRow[] {
  const byId = new Map<string, { posts?: unknown; videos?: unknown; lastActive?: string | null }>();
  for (const u of usage?.clients || []) if (u && u.id) byId.set(String(u.id), u);
  return (clients || []).map((c) => {
    const u = byId.get(String(c.id));
    return { ...c, posts: count(u?.posts), videos: count(u?.videos), lastActive: u?.lastActive || null };
  });
}

export function usageText(posts: number, videos: number): string {
  if (!posts && !videos) return 'Nothing made this month';
  const p = posts ? `${posts} ${posts === 1 ? 'post' : 'posts'}` : 'no posts';
  const v = videos ? `${videos} ${videos === 1 ? 'video' : 'videos'}` : 'no videos';
  return posts ? `${p}, ${v} this month` : `${p[0].toUpperCase()}${p.slice(1)}, ${v} this month`;
}

export function lastActiveText(iso: string | null | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'No activity yet';
  const days = Math.max(0, Math.floor((now - t) / 86400000));
  if (days === 0) return 'Active today';
  if (days === 1) return 'Active yesterday';
  return `Active ${days} days ago`;
}

const inr = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** The price of one more client. The figure is always passed in from the server; 0 or missing gives no text. */
export function slotPriceText(slotInr: number | null | undefined): string {
  return slotInr && slotInr > 0 ? `${inr(slotInr)} a month plus GST` : '';
}

export function includedText(included: number, slotInr: number | null | undefined): string {
  const base = `Your plan includes ${included} clients.`;
  const price = slotPriceText(slotInr);
  return price ? `${base} Each extra client is ${price}.` : base;
}

type Room = { used: number; limit: number; maxClients: number };

export function addClientCheck(name: string, room: Room): { ok: boolean; problem: string; needsSlot: boolean; atMost: boolean } {
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  if (!clean) return { ok: false, problem: "Please enter the client's business name.", needsSlot: false, atMost: false };
  if (clean.length > 80) return { ok: false, problem: 'Please use a business name of 80 characters or fewer.', needsSlot: false, atMost: false };
  if (room.limit > 0 && room.used >= room.limit) {
    if (room.limit >= room.maxClients) {
      return { ok: false, problem: `You are at the most clients one agency account can have (${room.maxClients}). Contact us for a larger set-up.`, needsSlot: false, atMost: true };
    }
    return { ok: false, problem: 'All of your clients are in use. Add an extra client to add another.', needsSlot: true, atMost: false };
  }
  return { ok: true, problem: '', needsSlot: false, atMost: false };
}

/** What to show when no client is left: a way to buy one more, or a plain note at the most. Null while there is room. */
export function slotOffer(i: Room & { slotInr: number }): { kind: 'buy' | 'max'; text: string } | null {
  if (!(i.limit > 0) || i.used < i.limit) return null;
  if (i.limit >= i.maxClients) return { kind: 'max', text: `You are at the most clients one agency account can have (${i.maxClients}).` };
  const price = slotPriceText(i.slotInr);
  return { kind: 'buy', text: price ? `All of your clients are in use. One more client is ${price}.` : 'All of your clients are in use. You can add one more client.' };
}

export function canConfirmRemoval(password: string, typed: string): boolean {
  return String(password || '').length > 0 && String(typed || '').trim() === 'REMOVE';
}

export function removalExplainer(name: string): { erased: string; kept: string; undo: string } {
  return {
    erased: `Removing ${name || 'this client'} erases its posts, videos, brand details, files, messages and connected social accounts for good.`,
    kept: 'Your usage history is kept, so past usage reports still add up. It will appear as Removed client.',
    undo: 'This cannot be undone. The client slot is freed for another client.',
  };
}

/** Our own server sentences are plain and safe to show; anything long or technical is replaced by the fallback. */
export function agencyErrorMessage(err: unknown, fallback: string): string {
  const raw = err && typeof err === 'object' && 'message' in (err as object) ? (err as { message?: unknown }).message : err;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || text.length > 240) return fallback;
  if (/https?:|ECONN|ETIMEDOUT|stack|undefined|\bat \S+:\d+/i.test(text)) return fallback;
  if (/quark|gemini|openai|anthropic|claude|veo|seedance|higgsfield|ayrshare|cloudinary|razorpay|mongo|\bfal\b/i.test(text)) return fallback;
  return text;
}

/** Wording for an agency account (not inside a client) whose shared pool has run out. */
export function agencyAllowanceEmpty(): { title: string; body: string; action: string } {
  return {
    title: 'The shared pool has run out',
    body: 'There are not enough posts and videos left for this. Top up the shared pool, or wait for your plan to renew, and carry on.',
    action: 'Top up the shared pool',
  };
}

/** Wording for the prompt shown inside a client when the agency's shared allowance has run out. Plans and top-ups are not available inside a client. */
export function clientAllowanceEmpty(): { title: string; body: string; action: string } {
  return {
    title: "Your agency's allowance has run out",
    body: 'There is not enough left for this. Go back to your clients and add more from your agency account, then carry on.',
    action: 'Back to my clients',
  };
}
