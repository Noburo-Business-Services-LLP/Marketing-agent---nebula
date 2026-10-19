// Pure helpers for the Inbox overview tiles and the Automatic replies explainer. No network, no React.
// Every status is computed from data the page already has: the inbox summary, the reply settings,
// the connected accounts and whether the Inbox add-on is part of the plan. See docs/superpowers/impact-maps/inbox.md.

export type InboxPart = 'messages' | 'reviews' | 'auto-reply';

/**
 * Has the owner's live test (docs/superpowers/ops/inbox-live-test.md) shown replies and automatic replies working with real
 * Instagram and Facebook accounts? Until it has, the screens use "set up and ready to test" wording and never say that
 * replies go out. Flip to true only after Tests 2, 3 and 5 of that sheet pass.
 */
export const INBOX_LIVE_PROVEN = false;
export type ChipStatus = 'connected' | 'needs_setup' | 'addon' | 'on' | 'off';

export const CHIP_LABELS: Record<ChipStatus, string> = {
  connected: 'Connected',
  needs_setup: 'Needs setup',
  addon: 'Add-on',
  on: 'On',
  off: 'Off',
};

export const chipLabel = (s: ChipStatus | null | undefined): string => (s ? CHIP_LABELS[s] : '');

export interface ReplySettingsLike {
  enabled?: boolean;
  automationMode?: string;
  platforms?: Partial<Record<string, boolean>>;
  channels?: Partial<Record<string, boolean>>;
  channelOverrides?: Array<{ platform?: string; channelType?: string; enabled?: boolean }>;
  responseRules?: Array<{ enabled?: boolean; action?: string }>;
}

export interface OverviewInput {
  /** false when the server answered that the Inbox add-on is missing. */
  entitled: boolean;
  /** Instagram and Facebook accounts the Inbox can use. */
  connectedCount: number;
  inboxStatus?: string | null;
  pending?: number | null;
  unread?: number | null;
  /** true or false from the connected accounts, null when they could not be read. */
  googleConnected: boolean | null;
  settings?: ReplySettingsLike | null;
  /** From the inbox summary: 'on', 'off' (never switched on) or 'failed'. Absent on an older server. */
  liveUpdates?: string | null;
  /** When the last comment or message arrived (the summary's lastSyncAt). */
  lastAt?: string | null;
  now?: number;
}

export interface OverviewTile {
  id: InboxPart;
  title: string;
  subtitle: string;
  status: ChipStatus | null;
  line: string;
}

/** A count for a line: whole, never negative, 99+ above 99. */
export function countText(n?: number | null): string {
  const v = Number.isFinite(n as number) && (n as number) > 0 ? Math.floor(n as number) : 0;
  return v > 99 ? '99+' : String(v);
}

const positive = (n?: number | null): boolean => Number.isFinite(n as number) && (n as number) >= 1;

const GOOGLE_KEYS = ['gmb', 'google', 'google business', 'googlebusiness', 'google_business', 'google business profile'];

/** Whether the connected accounts include a Google Business Profile. */
export function isGoogleConnected(platforms?: ReadonlyArray<string> | null): boolean {
  return (Array.isArray(platforms) ? platforms : []).some((p) => GOOGLE_KEYS.includes(String(p || '').trim().toLowerCase()));
}

const INBOX_KEYS = ['instagram', 'facebook'];

/**
 * Whether a reply can go out without the owner pressing Send, the way the server decides it:
 * automatic replies must be switched on for at least one Instagram or Facebook kind of message, and then either the mode is
 * Fully automatic or one of the owner's own rules says "Reply automatically".
 */
export function repliesGoOutOnTheirOwn(s?: ReplySettingsLike | null): boolean {
  if (!s || !s.enabled) return false;
  const overrides = Array.isArray(s.channelOverrides) ? s.channelOverrides : [];
  const anyOverride = overrides.some((o) => o && o.enabled && INBOX_KEYS.includes(String(o.platform || '')));
  const anyPlatform = INBOX_KEYS.some((k) => Boolean(s.platforms && s.platforms[k]));
  const anyChannel = Object.values(s.channels || {}).some(Boolean);
  if (!anyOverride && !(anyPlatform && anyChannel)) return false;
  if (s.automationMode === 'fully_automatic') return true;
  return autoRule(s);
}

const autoRule = (s: ReplySettingsLike): boolean =>
  (Array.isArray(s.responseRules) ? s.responseRules : []).some((r) => r && r.enabled !== false && r.action === 'auto_reply');

export const ADDON_LINE = 'Part of the Inbox add-on';

/** "Last message 5 min ago" from the time the latest comment or message arrived, or '' when none has. */
export function lastMessageLine(at?: string | null, now: number = Date.now()): string {
  if (!at) return '';
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return '';
  const minutes = Math.max(0, Math.floor((now - t) / 60000));
  if (minutes < 1) return 'Last message just now';
  if (minutes < 60) return `Last message ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last message ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `Last message ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function messagesTile(i: OverviewInput): OverviewTile {
  const base = { id: 'messages' as const, title: 'Messages and comments', subtitle: 'Instagram and Facebook' };
  if (!i.entitled) return { ...base, status: 'addon', line: ADDON_LINE };
  if (i.connectedCount < 1) return { ...base, status: 'needs_setup', line: 'Connect Instagram or Facebook' };
  const last = lastMessageLine(i.lastAt, i.now);
  const withLast = last ? { ...base, subtitle: last } : base;
  if (i.liveUpdates === 'failed') return { ...withLast, status: 'needs_setup', line: 'Live updates could not start' };
  if (i.liveUpdates === 'off') return { ...withLast, status: 'needs_setup', line: 'Switch on live updates' };
  if (i.inboxStatus === 'needs_setup') return { ...withLast, status: 'needs_setup', line: 'Connect again to start receiving' };
  return { ...withLast, status: 'connected', line: messagesCountLine(i.pending, i.unread) };
}

/** The one counts line on the Messages and comments tile. */
export function messagesCountLine(pending?: number | null, unread?: number | null): string {
  if (positive(pending)) return `Waiting for your approval ${countText(pending)}`;
  if (positive(unread)) return `Waiting for a reply ${countText(unread)}`;
  return 'Nothing waiting right now';
}

export function reviewsTile(i: OverviewInput): OverviewTile {
  const base = { id: 'reviews' as const, title: 'Google reviews', subtitle: 'A drafted reply for each' };
  if (!i.entitled) return { ...base, status: 'addon', line: ADDON_LINE };
  if (i.googleConnected === true) return { ...base, status: 'connected', line: 'Replies ready to copy into Google' };
  if (i.googleConnected === false) return { ...base, status: 'needs_setup', line: 'Connect your Google profile' };
  return { ...base, status: null, line: 'Open to see your reviews' };
}

export function autoTile(i: OverviewInput): OverviewTile {
  const base = { id: 'auto-reply' as const, title: 'Automatic replies', subtitle: 'You choose how careful' };
  if (!i.entitled) return { ...base, status: 'addon', line: ADDON_LINE };
  if (i.connectedCount < 1) return { ...base, status: 'needs_setup', line: 'Connect Instagram or Facebook first' };
  return { ...base, ...autoStatus(i.settings) };
}

export function autoStatus(s?: ReplySettingsLike | null, proven: boolean = INBOX_LIVE_PROVEN): { status: ChipStatus; line: string } {
  if (repliesGoOutOnTheirOwn(s)) {
    const full = Boolean(s && s.automationMode === 'fully_automatic');
    if (!proven) return { status: 'on', line: full ? 'Set to send on its own' : 'Your rules can send some replies' };
    return full ? { status: 'on', line: 'Replies go out on their own' } : { status: 'on', line: 'Your rules send some replies' };
  }
  if (s && s.enabled && s.automationMode === 'approval_required') return { status: 'off', line: 'Each reply waits for your approval' };
  return { status: 'off', line: 'Suggested replies only' };
}

export function overviewTiles(i: OverviewInput): OverviewTile[] {
  return [messagesTile(i), reviewsTile(i), autoTile(i)];
}

/** What a screen reader hears for a tile: title, status and the counts line. */
export function tileAccessibleName(t: OverviewTile): string {
  return [t.title, chipLabel(t.status), t.line].filter(Boolean).join('. ');
}

export const partFromParam = (p?: string | null): InboxPart => (p === 'reviews' || p === 'auto-reply' ? p : 'messages');

// ---------------- the Automatic replies explainer ----------------

const EXPLAINER_PROVEN = {
  eyebrow: 'Automatic replies',
  badge: '',
  title: 'Reply to every comment and message in your own voice',
  lines: [
    'Nebulaa reads each new comment and direct message on Instagram and Facebook and writes a reply in your tone.',
    'By default every reply waits for you: read it, change it if you like, then send it. Replies go out on their own only when you switch that on, and you can switch it off any time.',
  ],
  safety: 'Unhappy or important messages wait for you, spam is skipped, and each person gets at most a few automatic replies a day. You can change these checks below.',
} as const;

// Until the owner's live test passes, nothing here says that replies have gone out: it says what is set up.
const EXPLAINER_READY = {
  eyebrow: 'Automatic replies',
  badge: 'Set up and ready to test',
  title: 'Answer comments and messages in your own voice',
  lines: [
    'Nebulaa is set up to read new comments and direct messages from Instagram and Facebook and draft a reply in your tone for each one.',
    'By default every reply waits for you: read it, change it if you like, then send it. Replies go out on their own only when you switch that on, and you can switch it off any time.',
  ],
  safety: 'Unhappy or important messages are set to wait for you, spam is skipped, and each person gets at most a few automatic replies a day. You can change these checks below.',
} as const;

export const EXPLAINER = INBOX_LIVE_PROVEN ? EXPLAINER_PROVEN : EXPLAINER_READY;
export const EXPLAINER_VERSIONS = { proven: EXPLAINER_PROVEN, ready: EXPLAINER_READY } as const;

export const EXPLAINER_STEPS = [
  { id: 'connect', title: 'Connect', text: 'Link your Instagram or Facebook account.' },
  { id: 'careful', title: 'Choose how careful', text: 'Only suggest, ask you first, or send on its own.' },
  { id: 'run', title: 'Review or let it run', text: 'Approve drafts in your inbox, or let replies go out. Switch off any time.' },
] as const;

/** The one button on the explainer, or null when the settings below are the next step. */
export function explainerAction(i: { entitled: boolean; connectedCount: number; clientPass?: boolean }): { label: string; to: string } | null {
  // Inside a client's account (agency) or with a staff pass nobody can buy for the client here, so no button.
  if (!i.entitled) return i.clientPass ? null : { label: 'See plans', to: '/trial-expired' };
  if (i.connectedCount < 1) return { label: 'Connect an account', to: '/connect-socials' };
  return null;
}

/** The add-on note inside a client's account or a staff pass, where buying is not possible. */
export const ADDON_NOTE_CLIENT = 'The Inbox is not part of this account\'s plan. The account owner can add it from their plans page.';

export const ADDON_NOTE: Record<InboxPart, string> = {
  messages: 'Read every Instagram and Facebook comment and message in one list, with a drafted reply for each.',
  reviews: 'See your Google reviews with a drafted reply for each one, ready to copy into Google.',
  'auto-reply': 'Replies drafted in your tone, sent only when you say so.',
};
