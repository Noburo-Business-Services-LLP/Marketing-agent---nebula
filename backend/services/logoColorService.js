const sharp = require('sharp');

const MAX_SIDE = 64;
const MIN_ALPHA = 200;
const NEAR_WHITE = 235; // every channel at or above this is treated as background
const MIN_DISTANCE = 60; // a second colour must be clearly different from the first
const EMPTY = Object.freeze({ primary: '', secondary: '' });

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Reads the brand colours of a logo image buffer.
 * Rules: downscale to 64 px, drop pixels with alpha under 200 and near-white pixels, group the rest into
 * 4-bits-per-channel buckets, rank by pixel count. Primary is the heaviest bucket's mean colour; secondary is
 * the next heaviest bucket at least 60 RGB units away from the primary, otherwise ''. Never throws.
 */
async function extractLogoColors(buffer) {
  try {
    if (!buffer || !buffer.length) return { ...EMPTY };
    const { data, info } = await sharp(buffer)
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map();
    for (let i = 0; i + 3 < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < MIN_ALPHA) continue;
      if (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n += 1; e.r += r; e.g += g; e.b += b;
      buckets.set(key, e);
    }
    const ranked = [...buckets.values()]
      .sort((x, y) => y.n - x.n)
      .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n]);
    if (!ranked.length) return { ...EMPTY };
    const primary = ranked[0];
    const second = ranked.slice(1).find((c) => distance(primary, c) >= MIN_DISTANCE);
    return {
      primary: toHex(...primary),
      secondary: second ? toHex(...second) : ''
    };
  } catch (error) {
    return { ...EMPTY };
  }
}

async function colorsFromLogoUrl(url, deps = {}) {
  try {
    const fetchLogoBuffer = deps.fetchLogoBuffer || require('./heroVideoFinish').fetchLogoBuffer;
    const buffer = await fetchLogoBuffer(url);
    if (!buffer) return { ...EMPTY };
    return await extractLogoColors(buffer);
  } catch (error) {
    return { ...EMPTY };
  }
}

module.exports = { extractLogoColors, colorsFromLogoUrl };
