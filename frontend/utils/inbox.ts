// Pure helpers for the Inbox screens. Plain wording for a small-business owner; no network, no React.
// The backend can only receive and reply on Instagram and Facebook, so the screens show only those two.

export const INBOX_PLATFORMS = ['instagram', 'facebook'] as const;
export type InboxPlatform = (typeof INBOX_PLATFORMS)[number];

const LABELS: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', youtube: 'YouTube' };

export const isInboxPlatform = (p?: string | null): p is InboxPlatform =>
  typeof p === 'string' && (INBOX_PLATFORMS as readonly string[]).includes(p.trim().toLowerCase());

export function platformLabel(p?: string | null): string {
  const key = String(p || '').trim().toLowerCase();
  return LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Social');
}

/** How many connected accounts the Inbox can actually use. LinkedIn, X and YouTube are never counted. */
export function inboxConnectedCount(platforms?: ReadonlyArray<string> | null): number {
  const seen = new Set<string>();
  for (const p of Array.isArray(platforms) ? platforms : []) {
    const key = String(p || '').trim().toLowerCase();
    if (isInboxPlatform(key)) seen.add(key);
  }
  return seen.size;
}

// ---------------- what kind of message it is ----------------

const COMMENT_TYPES = ['comment', 'mention', 'reply'];

export type InboxKind = 'comment' | 'message';

/** A conversation is a comment thread when any of its messages is a comment, mention or reply. */
export const conversationKind = (types?: ReadonlyArray<string> | null): InboxKind =>
  Array.isArray(types) && types.some((t) => COMMENT_TYPES.includes(t)) ? 'comment' : 'message';

export const kindLabel = (kind: InboxKind): string => (kind === 'comment' ? 'Comment' : 'Direct message');

export function messageKindLabel(type?: string | null): string {
  switch (type) {
    case 'comment': return 'Comment';
    case 'mention': return 'Mention';
    case 'reply': return 'Reply to a comment';
    case 'message':
    case undefined:
    case null:
    case '': return 'Direct message';
    default: return 'Message';
  }
}

export const replyingToLine = (kind: InboxKind, commentAuthor?: string): string =>
  kind === 'comment'
    ? (commentAuthor ? `Replying to ${commentAuthor}'s comment` : 'Replying to a comment')
    : 'Replying to a direct message';

export const REPLY_BOX_HINT = 'Your reply goes to this person on Instagram or Facebook.';
export const REPLY_PLACEHOLDER = 'Write your reply';

// ---------------- time ----------------

export function timeAgo(value?: string | null, now: number = Date.now()): string {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const minutes = Math.max(1, Math.floor((now - t) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function agoWords(t: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - t) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

// ---------------- updates arrive on their own ----------------

export const ARRIVE_LINE = 'New comments and messages arrive on their own.';

/** "Last message received 5 minutes ago", or an empty string when nothing has arrived yet. */
export function lastReceivedLine(lastSyncAt?: string | null, now: number = Date.now()): string {
  if (!lastSyncAt) return '';
  const t = new Date(lastSyncAt).getTime();
  if (Number.isNaN(t)) return '';
  return `Last message received ${agoWords(t, now)}`;
}

// ---------------- sending a reply ----------------

export type SendState = 'sent' | 'failed' | 'sending';

/** A message counts as sent only when the server says so. Anything unknown is not shown as sent. */
export function sendState(message?: { status?: string | null; direction?: string | null } | null): SendState {
  if (!message) return 'sending';
  if (message.direction && message.direction !== 'outbound') return 'sent';
  if (message.status === 'failed') return 'failed';
  if (message.status === 'sent') return 'sent';
  return 'sending';
}

export const FALLBACK_SEND_ERROR = 'Your reply could not be sent. Please try again.';

/** The reason shown to the owner. The server writes plain text; very long or empty text gets the fallback. */
export function sendFailureReason(text?: unknown): string {
  if (typeof text !== 'string') return FALLBACK_SEND_ERROR;
  const t = text.trim();
  if (!t || t.length > 240) return FALLBACK_SEND_ERROR;
  return t;
}

export const notSentLine = (reason?: unknown): string => `Not sent: ${sendFailureReason(reason)}`;

/** Reads a failed send out of an error thrown by the API (the 502 body carries the stored failed message). */
export function failureFromError(err: any): { reason: string; sentMessage: any | null } {
  const data = err && typeof err === 'object' ? err.data : null;
  const sent = data && typeof data === 'object' && data.sentMessage && typeof data.sentMessage === 'object' ? data.sentMessage : null;
  const reason = sendFailureReason((sent && sent.error_message) || (data && data.message) || (err && err.message));
  return { reason, sentMessage: sent };
}

/** The reply comes back with success true only when it was sent. A message with status failed is never a success. */
export function replySucceeded(result?: { success?: boolean; message?: { status?: string } | null } | null): boolean {
  return Boolean(result && result.success === true && result.message && result.message.status !== 'failed');
}

// ---------------- the approval queue ----------------

export interface PendingItem {
  id: string;
  conversation_id?: string;
  platform?: string;
  message_type?: string;
  draft_text?: string;
  suggested_replies?: string[];
  reason?: string;
  original_message?: string;
  author_name?: string;
  created_at?: string;
  conversation?: { participant_name?: string; participant_username?: string; platform?: string } | null;
}

export const PENDING_TITLE = 'Waiting for your approval';
export const PENDING_EMPTY = 'Nothing is waiting for you.';
export const PENDING_HELP = 'Nebulaa drafted these replies. Read each one, change it if you like, then send it or discard it.';

export function pendingAuthor(item: PendingItem): string {
  const c = item.conversation || {};
  return (item.author_name || c.participant_name || c.participant_username || 'Someone').trim() || 'Someone';
}

export const pendingWhere = (item: PendingItem): string =>
  `${messageKindLabel(item.message_type)} on ${platformLabel(item.platform || item.conversation?.platform)}`;

/** What to send when approving: the edited text only when it differs from the draft. */
export function approveBody(draft: string, edited: string | undefined): { text?: string } {
  const e = typeof edited === 'string' ? edited.trim() : '';
  const d = typeof draft === 'string' ? draft.trim() : '';
  return e && e !== d ? { text: e } : {};
}

export const canApprove = (edited: string | undefined, draft: string | undefined): boolean =>
  Boolean(((typeof edited === 'string' ? edited : draft) || '').trim());

export const pendingBadge = (n?: number | null): string => {
  const v = Number.isFinite(n as number) && (n as number) > 0 ? Math.floor(n as number) : 0;
  return v > 99 ? '99+' : String(v);
};

export const GONE_LINE = 'This one is no longer waiting. It may already be handled.';

// ---------------- turning on automatic replies ----------------

export const autoConfirmTitle = 'Turn on automatic replies?';
export const autoConfirmText = (where: string): string =>
  `Nebulaa will answer everyone on ${where} without asking you. You can switch it off any time.`;

/** Choosing "Fully automatic" from another mode needs the owner's confirmation first. */
export const needsAutoConfirm = (from?: string | null, to?: string | null): boolean =>
  to === 'fully_automatic' && from !== 'fully_automatic';

export const settingsPlatformsText = 'Instagram and Facebook';

// ---------------- Google reviews ----------------

export const REVIEWS_NOTE = 'Reply to reviews on Google. Copy the drafted reply below.';
