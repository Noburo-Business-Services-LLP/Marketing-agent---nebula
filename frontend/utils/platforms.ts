/**
 * The social networks a post can go to. One list, used by every picker, so a platform can never be
 * shown in one place and missing in another.
 *   key       what the server and Ayrshare receive ("twitter" is X)
 *   video     whether a video can be posted there
 *   soon      shown but not selectable yet
 */
export interface PlatformChoice {
  key: string;
  label: string;
  video: boolean;
  soon?: boolean;
  soonNote?: string;
}

export const PLATFORM_CHOICES: PlatformChoice[] = [
  { key: 'instagram', label: 'Instagram', video: true },
  { key: 'facebook', label: 'Facebook', video: true },
  { key: 'linkedin', label: 'LinkedIn', video: true },
  { key: 'twitter', label: 'X', video: true },
  { key: 'youtube', label: 'YouTube', video: true },
  { key: 'gmb', label: 'Google Business', video: false, soon: true, soonNote: 'Coming soon' }
];

export function platformLabel(key: string): string {
  const k = String(key || '').toLowerCase();
  const found = PLATFORM_CHOICES.find((p) => p.key === k || (k === 'x' && p.key === 'twitter'));
  return found ? found.label : k.charAt(0).toUpperCase() + k.slice(1);
}

/** Choices for a picker: videos skip networks that cannot take video; images skip YouTube. */
export function choicesFor(kind: 'image' | 'video'): PlatformChoice[] {
  return PLATFORM_CHOICES.filter((p) => (kind === 'video' ? true : p.key !== 'youtube'));
}
