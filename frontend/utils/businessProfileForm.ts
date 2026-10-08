/** Choices and small rules for the business profile form in Settings. */
import type { ReachArea } from '../types';

// Copies of the onboarding lists (a test keeps them identical), so this file has no runtime imports.
const INDUSTRY_VALUES = [
  'Technology / SaaS', 'E-commerce / Retail', 'Food & Beverage', 'Restaurants / Cafes / Bars',
  'Salon & Spa', 'Gym & Fitness', 'Grocery & Supermarket', 'Electronics & Mobile',
  'Fashion & Apparel', 'Beauty & Wellness', 'Healthcare', 'Education', 'Finance / Fintech',
  'Real Estate', 'Travel & Hospitality', 'Media & Entertainment', 'Professional Services',
  'Manufacturing', 'Automotive', 'Jewellery', 'Home & Furniture', 'Non-profit', 'Other',
];
const VOICE_VALUES = ['Professional', 'Friendly', 'Witty', 'Empathetic', 'Bold', 'Educational'];
const GOAL_VALUES = ['Brand Awareness', 'Lead Generation', 'Direct Sales', 'Community Engagement', 'Website Traffic'];

/** Industries from the onboarding list, plus a few that sell to other businesses. */
const EXTRA_INDUSTRIES = ['Agency / Marketing', 'IT Services', 'Construction & Interiors', 'Logistics & Transport', 'Legal & Accounting', 'Events & Weddings', 'Agriculture', 'Wholesale & Distribution'];
export const INDUSTRY_CHOICES: string[] = [...INDUSTRY_VALUES.filter((v) => v !== 'Other'), ...EXTRA_INDUSTRIES, 'Other'];

/** The list with the saved value always present, so an older or custom value never shows as blank. */
export function industryChoicesFor(current?: string): string[] {
  const c = String(current || '').trim();
  if (!c || INDUSTRY_CHOICES.includes(c)) return INDUSTRY_CHOICES;
  // Onboarding saved 'Technology / SaaS' while Settings once saved 'Technology/SaaS'; treat them as the same.
  const same = INDUSTRY_CHOICES.find((x) => x.replace(/\s*\/\s*/g, '/') === c.replace(/\s*\/\s*/g, '/'));
  return same ? INDUSTRY_CHOICES : [c, ...INDUSTRY_CHOICES];
}
export function industryValueFor(current?: string): string {
  const c = String(current || '').trim();
  if (!c) return '';
  return INDUSTRY_CHOICES.find((x) => x.replace(/\s*\/\s*/g, '/') === c.replace(/\s*\/\s*/g, '/')) || c;
}

export const REACH_CHOICES: Array<{ value: ReachArea; label: string }> = [
  { value: 'neighbourhood', label: 'My neighbourhood' },
  { value: 'city', label: 'My city' },
  { value: 'state', label: 'My state' },
  { value: 'india', label: 'All of India' },
  { value: 'international', label: 'Other countries' },
];
/** An old saved single answer, shown as the matching area so it is not lost. */
export function reachFromOld(old?: string): ReachArea[] {
  switch (old) {
    case 'hyperlocal': return ['neighbourhood'];
    case 'local_city': return ['city'];
    case 'regional': return ['state'];
    case 'state': return ['state'];
    case 'national': return ['india'];
    case 'international': return ['international'];
    default: return [];
  }
}
export function reachAreasOf(profile: { reachAreas?: ReachArea[]; geographicReach?: string } | undefined | null): ReachArea[] {
  const list = profile && Array.isArray(profile.reachAreas) ? profile.reachAreas : [];
  return list.length ? list : reachFromOld(profile?.geographicReach);
}

export const COMPANY_SIZES = [
  { value: 'solo', label: 'One-person businesses' }, { value: 'small', label: 'Small companies' },
  { value: 'medium', label: 'Mid-size companies' }, { value: 'large', label: 'Large companies' },
] as const;
export const SALES_CYCLES = [
  { value: 'days', label: 'A few days' }, { value: 'weeks', label: 'A few weeks' }, { value: 'months', label: 'Several months' },
] as const;

export const VOICE_CHOICES: string[] = [...VOICE_VALUES];
export const GOAL_CHOICES: string[] = [...GOAL_VALUES];

export const sellsToBusinesses = (type?: string) => type === 'B2B' || type === 'Both';
/** Audience gender is optional and never asked of a business that only sells to businesses. */
export const showGenderChoice = (type?: string) => type !== 'B2B';

export function toggleIn<T>(list: T[] | undefined, value: T): T[] {
  const cur = Array.isArray(list) ? list : [];
  return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
}
/** Brand voice is saved as text or a list; chips work on a list. */
export function voiceList(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
}
