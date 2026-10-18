// The Create content mode tiles: their copy, and the price line under each one.
// Prices are never typed here: they come from the per-action costs the server reports
// (the same numbers the Create button shows), written with the existing Quark helpers.
import { priceWithWorth } from './plans.ts';
import type { TileAccent } from './tiles.ts';

export type CreateModeKey = 'single' | 'campaign' | 'carousel' | 'linkedin';

export const CREATE_TILES: ReadonlyArray<{ key: CreateModeKey; title: string; subtitle: string; accent: TileAccent }> = [
  { key: 'single', title: 'Single post', subtitle: 'One image post with a caption', accent: 'create' },
  { key: 'campaign', title: 'Campaign', subtitle: 'A series of posts for a goal', accent: 'create' },
  { key: 'carousel', title: 'Carousel', subtitle: 'Swipeable slides', accent: 'create' },
  { key: 'linkedin', title: 'LinkedIn post', subtitle: 'A professional post for LinkedIn', accent: 'create' },
];

/** The server action each mode is charged under (these are the keys of the costs the server reports). */
export function actionCostKey(mode: CreateModeKey): string {
  if (mode === 'campaign') return 'campaign_full';
  if (mode === 'carousel') return 'carousel_generated';
  if (mode === 'linkedin') return 'campaign_text';
  return 'image_generated';
}

/** "11 Quarks (about 1 post's worth)", "12 Quarks for each post" or "" while the price is unknown. */
export function createTileCost(mode: CreateModeKey, costs: Record<string, number> | null | undefined): string {
  const unit = Number(costs?.[actionCostKey(mode)]);
  if (!Number.isFinite(unit) || unit <= 0) return '';
  if (mode === 'campaign') return `${unit.toLocaleString('en-IN')} ${unit === 1 ? 'Quark' : 'Quarks'} for each post`;
  if (mode === 'carousel') return `${unit.toLocaleString('en-IN')} ${unit === 1 ? 'Quark' : 'Quarks'} for each slide`;
  return priceWithWorth(unit, costs);
}
