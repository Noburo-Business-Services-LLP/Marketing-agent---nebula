/**
 * The 6 spots a logo can sit in on a generated image.
 *
 * Shared by Brand Assets (sets a logo's default) and Create (overrides it
 * for one generation), so picking a spot means the same thing in both
 * places and matches the positions the backend (BrandAsset.defaultPosition,
 * logoOverlay.js) actually understands.
 */
export type LogoGridPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export const LOGO_GRID: LogoGridPosition[] = [
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right'
];

export const LOGO_GRID_LABELS: Record<LogoGridPosition, string> = {
  'top-left': 'Top left',
  'top-center': 'Top center',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom center',
  'bottom-right': 'Bottom right'
};
