/**
 * Category chips for the video style tiles (owner, 2026-10-18: "video styles shown as visual tiles everywhere videos are
 * chosen", with chips to narrow the 22 styles). The grouping is defined here once; the styles themselves come from the
 * server (backend/services/studioVideo.js STYLE_LIST). A test checks every server style is in exactly one group.
 * Pure functions only.
 */
export type StyleGroup = 'ads' | 'stories' | 'social' | 'explainers';
export type StyleFilter = 'all' | StyleGroup;

export const STYLE_GROUPS: Array<{ key: StyleGroup; label: string; line: string }> = [
  { key: 'ads', label: 'Ads', line: 'Sell a product or an offer' },
  { key: 'stories', label: 'Stories', line: 'People, makers and the story behind you' },
  { key: 'social', label: 'Social', line: 'Casual phone-style clips for reels' },
  { key: 'explainers', label: 'Explainers', line: 'Teach, answer or announce something' },
];

const MEMBERS: Record<StyleGroup, string[]> = {
  ads: ['cinematic-commercial', 'product-advertisement', 'product-showcase', 'luxury-advertisement', 'fashion-lookbook', 'festive-campaign', 'before-and-after'],
  stories: ['storytelling', 'testimonial', 'founder-story', 'documentary', 'behind-the-scenes', 'motivational'],
  social: ['daily-life-vlog', 'social-media-reel', 'unboxing', 'get-ready-with-me', 'comedy-skit'],
  explainers: ['educational', 'corporate-presentation', 'news-update', 'myth-busting'],
};

/** Every grouped style key, in group order (used by the tests). */
export const GROUPED_KEYS: string[] = STYLE_GROUPS.flatMap((g) => MEMBERS[g.key]);

const GROUP_OF: Record<string, StyleGroup> = Object.fromEntries(
  STYLE_GROUPS.flatMap((g) => MEMBERS[g.key].map((k) => [k, g.key] as [string, StyleGroup])),
);

/** The group of a style key, or null for a key this list does not know (it is shown under All only). */
export function groupOf(key: string): StyleGroup | null {
  return GROUP_OF[String(key || '').trim().toLowerCase()] || null;
}

export function groupLabel(key: string): string {
  const g = groupOf(key);
  return g ? STYLE_GROUPS.find((x) => x.key === g)!.label : '';
}

/** The styles a chip shows, in the order given. */
export function filterStyles<T extends { key: string }>(styles: T[], filter: StyleFilter): T[] {
  if (filter === 'all') return styles.slice();
  return styles.filter((s) => groupOf(s.key) === filter);
}

/** The chips to show: All, then each group that has at least one style, with counts. */
export function styleChips<T extends { key: string }>(styles: T[]): Array<{ key: StyleFilter; label: string; count: number }> {
  const chips: Array<{ key: StyleFilter; label: string; count: number }> = [{ key: 'all', label: 'All', count: styles.length }];
  STYLE_GROUPS.forEach((g) => {
    const count = styles.filter((s) => groupOf(s.key) === g.key).length;
    if (count) chips.push({ key: g.key, label: g.label, count });
  });
  return chips;
}

/** A remembered filter that no longer has styles falls back to All. */
export function safeFilter<T extends { key: string }>(styles: T[], filter: string): StyleFilter {
  const f = String(filter || '') as StyleFilter;
  return styleChips(styles).some((c) => c.key === f) ? f : 'all';
}
