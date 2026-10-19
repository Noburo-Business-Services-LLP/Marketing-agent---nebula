/**
 * The calendar shows Campaigns (what the scheduler sends); the post sheet and its actions work on the post (Draft)
 * behind each one. A post keeps its campaign in `campaignId` (an id, or { _id, campaignName } when the list
 * populates it). This finds the post for a calendar entry. Pure: no network.
 */
export function campaignIdOf(d: any): string {
  const c = d && d.campaignId;
  if (!c) return '';
  if (typeof c === 'string') return c;
  return String(c._id || c.id || '');
}

export function draftByCampaign(drafts: any[]): Map<string, any> {
  const out = new Map<string, any>();
  for (const d of Array.isArray(drafts) ? drafts : []) {
    const id = campaignIdOf(d);
    if (id && !out.has(id)) out.set(id, d);
  }
  return out;
}
