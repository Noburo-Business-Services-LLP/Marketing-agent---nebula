// Nebulaa used to fill in these two colours for clients who had none. They are not the client's own colours.
const PLACEHOLDER_PRIMARY = '#111111';
const PLACEHOLDER_SECONDARY = '#FFCC29';

export function isPlaceholderColorPair(primary?: string | null, secondary?: string | null): boolean {
  return (
    String(primary || '').trim().toUpperCase() === PLACEHOLDER_PRIMARY &&
    String(secondary || '').trim().toUpperCase() === PLACEHOLDER_SECONDARY
  );
}

// ---------------------------------------------------------------------------
// Reading brand colours from an image. Pure: takes RGBA pixel data (what a
// canvas gives back) and returns hex strings, so it is tested without a canvas.
// ---------------------------------------------------------------------------

type Pixels = ArrayLike<number>;

/** #RGB or #RRGGBB (the # is optional) to uppercase #RRGGBB, or null when it is not a colour. */
export function normalizeHexColor(input?: string | null): string | null {
  const raw = String(input ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return '#' + raw.split('').map((c) => c + c).join('').toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return '#' + raw.toUpperCase();
  return null;
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return ('#' + part(r) + part(g) + part(b)).toUpperCase();
}

const OPAQUE_FROM = 128; // below this alpha a pixel is treated as transparent
const NEAR_WHITE_FROM = 235; // every channel at or above this
const NEAR_BLACK_UPTO = 40; // every channel at or below this
const MERGE_DISTANCE = 48; // colours closer than this are one colour
const NOISE_SHARE = 0.02; // a colour under 2% of the visible logo is noise

type Bin = { n: number; r: number; g: number; b: number };

function rank(bins: Map<number, Bin>, minCount: number, max: number): string[] {
  const sorted = [...bins.values()]
    .filter((b) => b.n >= minCount)
    .sort((a, b) => b.n - a.n)
    .map((b) => ({ n: b.n, r: b.r / b.n, g: b.g / b.n, b: b.b / b.n }));
  const kept: { n: number; r: number; g: number; b: number }[] = [];
  for (const c of sorted) {
    const near = kept.find((k) => Math.hypot(k.r - c.r, k.g - c.g, k.b - c.b) < MERGE_DISTANCE);
    if (near) near.n += c.n;
    else kept.push({ ...c });
  }
  return kept
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((c) => toHex(c.r, c.g, c.b));
}

/**
 * The most prominent distinct colours in RGBA pixel data, most prominent first.
 * Skips transparent pixels, near-white and near-black (unless nothing else is
 * left, so a black logo still gives black), ignores rare anti-aliasing colours
 * and merges near-duplicates.
 */
export function extractPaletteFromPixels(data: Pixels, options: { max?: number } = {}): string[] {
  const max = options.max ?? 6;
  const colour = new Map<number, Bin>();
  const dark = new Map<number, Bin>();
  const light = new Map<number, Bin>();
  let coloured = 0;
  let visible = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < OPAQUE_FROM) continue;
    visible++;
    const bucket =
      r >= NEAR_WHITE_FROM && g >= NEAR_WHITE_FROM && b >= NEAR_WHITE_FROM ? light
      : r <= NEAR_BLACK_UPTO && g <= NEAR_BLACK_UPTO && b <= NEAR_BLACK_UPTO ? dark
      : colour;
    if (bucket === colour) coloured++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bucket.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bin.n++; bin.r += r; bin.g += g; bin.b += b;
    bucket.set(key, bin);
  }

  if (visible === 0) return [];
  if (coloured > 0) {
    const found = rank(colour, Math.max(1, Math.ceil(coloured * NOISE_SHARE)), max);
    if (found.length) return found;
  }
  // Nothing but black or white (a monochrome logo): give that back rather than nothing.
  const fallback = dark.size ? dark : light;
  return rank(fallback, 1, 1);
}

/**
 * True when it is safe to put colours taken from a logo into the colour fields:
 * both are empty, or they are the old placeholder pair. Anything the customer
 * chose is never overwritten.
 */
export function canAutoApplyLogoColors(primary?: string | null, secondary?: string | null): boolean {
  const p = String(primary || '').trim();
  const s = String(secondary || '').trim();
  if (!p && !s) return true;
  return isPlaceholderColorPair(p, s);
}
