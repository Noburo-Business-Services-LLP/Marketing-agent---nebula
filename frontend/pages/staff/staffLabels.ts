/** Plain words for the staff screens. One place, so the list and the client page say the same thing. */
export const ATTENTION_LABEL: Record<string, string> = {
  quarks_low: 'Quarks are running low',
  drafts_waiting: 'Drafts have been waiting for review for more than 3 days',
  inactive: 'Has not been active for over a week',
  onboarding_unfinished: 'Has not finished onboarding',
  no_social: 'No social account is connected',
  failed_posts: 'A post failed in the last 7 days'
};

export const FILTER_LABEL: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'disabled', label: 'Switched off' },
  { key: 'trial', label: 'On trial' },
  { key: 'paying', label: 'Paying' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'no_csm', label: 'No CSM' },
  { key: 'hidden', label: 'Hidden' }
];

export const TIER_LABEL: Record<string, string> = { free: 'Free', starter: 'Starter', professional: 'Professional', managed: 'Managed' };

export const ACCESS_LABEL: Array<{ key: string; label: string }> = [
  { key: 'publish', label: 'Publish' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'autoReply', label: 'Auto-reply' },
  { key: 'video', label: 'Video' }
];

export function whenLabel(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export function attentionText(reasons: string[]): string {
  return reasons.map((r) => ATTENTION_LABEL[r] || r).join('. ');
}
