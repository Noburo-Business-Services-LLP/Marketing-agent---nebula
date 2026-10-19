// Pure helpers for the Tile components: accent colours, spoken labels, badge text and the lazy-loading
// attributes every small photo tile must carry. No React here, so node --test can import it.

export const TILE_ACCENTS = ['create', 'review', 'inbox', 'performance', 'plan', 'brand', 'competitors', 'video', 'photoshoot'] as const;
export type TileAccent = typeof TILE_ACCENTS[number];

// `choice` is the small quiet tile for picking between options (Create content): small framed picture, no stripe, no arrow.
export const TILE_VARIANTS = ['hero', 'standard', 'compact', 'idea', 'choice'] as const;
export type TileVariant = typeof TILE_VARIANTS[number];

/** One colour per area: `bar` is the accent stripe and arrow, `tint` is the art background. Kept in step with the `.nb-tile[data-accent]` rules in index.html (a test checks it). */
export const ACCENT_COLORS: Record<TileAccent, { bar: string; tint: string }> = {
  create: { bar: '#F5A623', tint: '#FFF0C7' },
  review: { bar: '#3E8B5A', tint: '#DDF2E6' },
  inbox: { bar: '#3B82C4', tint: '#DCEBFA' },
  performance: { bar: '#7B5CC4', tint: '#ECE6FB' },
  plan: { bar: '#1F9D9A', tint: '#D6F1EF' },
  brand: { bar: '#D8527A', tint: '#FBDCE5' },
  competitors: { bar: '#EE6330', tint: '#FFE3D0' },
  video: { bar: '#5B6BDC', tint: '#E1E5FB' },
  photoshoot: { bar: '#A63EBB', tint: '#F4E1F8' },
};

export function accentOf(value: unknown): TileAccent {
  return (TILE_ACCENTS as readonly string[]).includes(value as string) ? (value as TileAccent) : 'create';
}

export function variantOf(value: unknown): TileVariant {
  return (TILE_VARIANTS as readonly string[]).includes(value as string) ? (value as TileVariant) : 'standard';
}

/** The badge as shown: text is trimmed, a count of 0 is hidden, and a large count reads 99+. */
export function badgeText(badge: string | number | null | undefined): string {
  if (typeof badge === 'number') {
    if (!Number.isFinite(badge) || badge <= 0) return '';
    return badge > 99 ? '99+' : String(Math.floor(badge));
  }
  return typeof badge === 'string' ? badge.trim() : '';
}

/** The text a screen reader says for a tile, with the state added when it is locked or unavailable. */
export function tileLabel(p: { title: string; subtitle?: string; footer?: string; badge?: string | number; locked?: boolean; disabled?: boolean }): string {
  const parts = [p.title, p.subtitle, p.footer, badgeText(p.badge)].map((s) => (s || '').trim()).filter(Boolean);
  if (p.locked) parts.push('Locked');
  else if (p.disabled) parts.push('Not available');
  return parts.join('. ');
}

export interface RasterArt { src: string; width: number; height: number; alt: string }

export function isRasterArt(value: unknown): value is RasterArt {
  const v = value as RasterArt | null;
  return !!v && typeof v === 'object' && typeof v.src === 'string' && typeof v.width === 'number' && typeof v.height === 'number' && typeof v.alt === 'string';
}

/** Attributes for a small photo tile: lazy, decoded off the main thread, with a fixed size so nothing jumps. Only the app's own files are allowed. */
export function rasterAttrs(a: RasterArt) {
  if (!/^\/(?!\/)/.test(a.src)) throw new Error('Tile pictures must be the app\'s own files (a path starting with /).');
  if (!(a.width > 0) || !(a.height > 0)) throw new Error('Tile pictures need a size (width and height).');
  return { src: a.src, width: a.width, height: a.height, alt: a.alt, loading: 'lazy' as const, decoding: 'async' as const };
}

/** What element a tile becomes: a link when it has a destination, a button when it has a handler, otherwise a disabled button. */
export function tileTag(p: { to?: unknown; onClick?: unknown; disabled?: boolean }): 'link' | 'button' | 'disabled' {
  if (p.disabled) return 'disabled';
  if (p.to) return 'link';
  if (p.onClick) return 'button';
  return 'disabled';
}
