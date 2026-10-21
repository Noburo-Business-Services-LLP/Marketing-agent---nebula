'use strict';
/**
 * Composed post pictures for the demo brand (D125): the 24 real photos (photoPrompts.js) laid out the way a good Indian D2C
 * brand or agency posts them: a real photo, a short headline, brand colours, the small logo and @zaya.naturals.
 * node-canvas only (sharp is never loaded in the seed's process, see images.js), with the open-licence fonts in
 * backend/assets/fonts registered before the first canvas (no system fonts, so the pictures look the same on every computer).
 * Deterministic: the same design and the same photos always give the same bytes. No network, no model, no randomness.
 *
 * Rules every family keeps (checked as it draws; `render` returns the checks in `qa`):
 *  - key text never in the top 19% (the Library's status badges) nor the bottom 9% (play button, timer); only the
 *    footer (handle and logo) and decoration live there;
 *  - every text line fits its box (the size shrinks until it does, or the design is rejected), so nothing is clipped;
 *  - every text has a contrast of at least 4.5 against the worst 5% of the pixels behind it (a soft panel is added if not).
 */
const { lib, roundRect, crescent } = require('./images');

const W = 864;
const H = 1080;
const SAFE_TOP = Math.round(H * 0.19);
const SAFE_BOTTOM = Math.round(H * 0.91);
const MAX_BYTES = 195 * 1024;
const HANDLE = '@zaya.naturals';

// Brand colours (constants.js PALETTE) plus the deeper and festive tones the posts use.
const C = Object.freeze({
  plum: '#3B1F3A', plumDeep: '#2A1529', rose: '#C98B7B', cream: '#FBF3EA', ivory: '#FFF9F1', sand: '#EFE2D3', linen: '#F4EBDD',
  sage: '#8AA17D', sageLight: '#DCE4D3', forest: '#21392B', forestMid: '#2E4A37', saffron: '#E8A33A', marigold: '#F2B33D',
  gold: '#C9A04A', goldLight: '#E8C97A', maroon: '#5A1626', maroonDeep: '#3A0E18', terracotta: '#A84F33', terraDeep: '#7E3622',
  blush: '#F3DCD3', ink: '#2B1D0E', night: '#1B2440', white: '#FFFFFF'
});

/** Palette moods: background, main ink, accent ink (also readable), soft tone, deep tone. */
const MOODS = Object.freeze({
  ivory: { bg: C.cream, ink: C.plum, accent: C.terracotta, soft: C.sand, deep: C.plum, light: true },
  blush: { bg: C.blush, ink: C.plum, accent: C.terraDeep, soft: '#E9C8BC', deep: C.plum, light: true },
  sage: { bg: C.sageLight, ink: C.forest, accent: C.terraDeep, soft: '#C9D5BD', deep: C.forest, light: true },
  saffron: { bg: C.saffron, ink: C.plumDeep, accent: C.maroonDeep, soft: '#F5C978', deep: C.maroon, light: true },
  forest: { bg: C.forest, ink: C.cream, accent: C.goldLight, soft: C.forestMid, deep: '#14251B', light: false },
  plum: { bg: C.plum, ink: C.cream, accent: C.goldLight, soft: '#55304F', deep: C.plumDeep, light: false },
  festive: { bg: C.maroon, ink: C.cream, accent: C.goldLight, soft: '#7A2236', deep: C.maroonDeep, light: false },
  terracotta: { bg: C.terracotta, ink: C.cream, accent: '#FFF0DB', soft: '#C06A4C', deep: C.terraDeep, light: false },
  night: { bg: C.night, ink: C.cream, accent: C.goldLight, soft: '#2B3760', deep: '#10172B', light: false }
});

const FONT = Object.freeze({
  serif: '"Playfair Display"',
  sans: '"Inter"',
  bold: '"Poppins"',
  tamil: '"Noto Sans Tamil"',
  hindi: '"Noto Sans Devanagari"',
  malayalam: '"Noto Sans Malayalam"'
});

// ---------------------------------------------------------------- colour and contrast
function hexRgb(hex) {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(hex));
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const chan = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };

/** The contrast of a text colour against the worst 5% of the pixels in a box (the brightest for light text, the darkest for dark). */
function worstContrast(ctx, box, color) {
  const cw = ctx.canvas.width; const chh = ctx.canvas.height;
  const x = Math.max(0, Math.floor(box.x)); const y = Math.max(0, Math.floor(box.y));
  const w = Math.max(1, Math.min(cw - x, Math.ceil(box.w))); const h = Math.max(1, Math.min(chh - y, Math.ceil(box.h)));
  const data = ctx.getImageData(x, y, w, h).data;
  const ls = [];
  const step = Math.max(1, Math.floor((w * h) / 6000)) * 4;
  for (let i = 0; i < data.length; i += step) ls.push(lum(data[i], data[i + 1], data[i + 2]));
  ls.sort((a, b) => a - b);
  const t = lum(...hexRgb(color));
  const light = t > 0.4;
  const pick = light ? ls[Math.min(ls.length - 1, Math.floor(ls.length * 0.95))] : ls[Math.floor(ls.length * 0.05)];
  return ratio(t, pick);
}

// ---------------------------------------------------------------- text
const fontOf = (family, size) => `${size}px ${family}`;

function wrapWords(ctx, text, width) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean); let line = '';
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(t).width > width) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}

/** Balanced lines: the narrowest width that still gives the same number of lines (no lonely last word). */
function balanced(ctx, text, width) {
  const first = wrapWords(ctx, text, width);
  if (first.length < 2 || String(text).includes('\n')) return first;
  let lo = width * 0.5; let hi = width; let best = first;
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2; const t = wrapWords(ctx, text, mid);
    if (t.length === first.length) { best = t; hi = mid; } else lo = mid;
  }
  return best;
}

/**
 * Fits a text into a box: the largest size from `max` down to `min` whose lines all fit `width`, are at most `lines` and
 * stay within `height` (when given). Throws when even `min` does not fit: the design must be changed, never clipped.
 */
function fit(ctx, text, { family = FONT.serif, max, min = 16, width, lines = 3, height = 0, lh = 1.12, upper = false }) {
  const t = upper ? String(text).toUpperCase() : String(text);
  for (let s = max; s >= min; s -= 1) {
    ctx.font = fontOf(family, s);
    const ls = balanced(ctx, t, width);
    const h = s * lh * (ls.length - 1) + s;
    if (ls.length <= lines && ls.every((l) => ctx.measureText(l).width <= width) && (!height || h <= height)) {
      return { text: t, family, size: s, lines: ls, lh: s * lh, height: h, width: Math.max(...ls.map((l) => ctx.measureText(l).width)) };
    }
  }
  throw new Error(`text does not fit (${width}px, ${lines} lines): "${text}"`);
}

/** Letter-spaced single line (node-canvas has no letterSpacing). Returns its width. */
function spacedWidth(ctx, text, spacing) {
  let w = 0; for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w - spacing;
}
function drawSpaced(ctx, text, x, y, spacing, align = 'left') {
  const w = spacedWidth(ctx, text, spacing);
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const keep = ctx.textAlign; ctx.textAlign = 'left';
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
  ctx.textAlign = keep;
  return w;
}

/**
 * The drawing context of one picture: the canvas, the mood, and the checks (every text box, its contrast and zone).
 */
function makeCtx(canvas, mood, band = { top: SAFE_TOP, bottom: SAFE_BOTTOM }) {
  const ctx = canvas.getContext('2d');
  ctx.quality = 'best'; ctx.patternQuality = 'best'; ctx.antialias = 'subpixel'; ctx.imageSmoothingEnabled = true;
  const qa = { texts: [], fixes: 0, problems: [] };

  /** Adds a soft panel behind a text box until the text reaches 4.5:1 (rarely needed: the families are built for contrast). */
  function ensure(box, color, backing) {
    let c = worstContrast(ctx, box, color);
    let alpha = 0.5;
    while (c < 4.5 && alpha <= 1.0001) {
      // a soft pill behind the text, like a sticker (rare: the families are built for contrast)
      const px = 16; const py = 9;
      ctx.save(); ctx.fillStyle = rgba(backing, Math.min(1, alpha));
      roundRect(ctx, box.x - px, box.y - py, box.w + px * 2, box.h + py * 2, Math.min(22, (box.h + py * 2) / 2)); ctx.fill(); ctx.restore();
      qa.fixes += 1; alpha += 0.15;
      c = worstContrast(ctx, box, color);
    }
    return c;
  }

  /**
   * Draws a fitted block (from `fit`) with its top at `y`. align left|center|right at `x`. `zone` 'key' (default) must sit
   * in the safe band; 'footer' and 'deco' may not. Returns the bottom y.
   */
  function block(b, x, y, color, { align = 'left', zone = 'key', backing = null, spacing = 0 } = {}) {
    ctx.font = fontOf(b.family, b.size);
    const top = y; const bottom = y + b.height + b.size * 0.22;
    const left = align === 'center' ? x - b.width / 2 : align === 'right' ? x - b.width : x;
    const box = { x: left, y: top, w: spacing ? Math.max(...b.lines.map((l) => spacedWidth(ctx, l, spacing))) : b.width, h: bottom - top };
    const back = backing || (lum(...hexRgb(color)) > 0.4 ? C.plumDeep : C.cream);
    const before = qa.fixes;
    const contrast = ensure(box, color, back);
    if (qa.fixes > before) (qa.fixed = qa.fixed || []).push(b.text);
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    b.lines.forEach((l, i) => {
      const by = y + b.size * 0.8 + i * b.lh;
      if (spacing) drawSpaced(ctx, l, x, by, spacing, align); else ctx.fillText(l, x, by);
    });
    const rec = { text: b.text, size: b.size, zone, contrast: Math.round(contrast * 100) / 100, box };
    qa.texts.push(rec);
    if (box.x < 20 || box.x + box.w > canvas.width - 20) qa.problems.push(`outside the sides: ${b.text}`);
    if (zone === 'key' && (box.y < band.top || box.y + box.h > band.bottom)) qa.problems.push(`key text in a badge or bottom zone: ${b.text}`);
    if (contrast < 4.5) qa.problems.push(`contrast ${contrast.toFixed(2)} for: ${b.text}`);
    return bottom;
  }

  /** A one-line fitted label (kicker): small caps, spaced. */
  function label(text, x, y, color, { size = 19, family = FONT.sans, align = 'left', spacing = 3, zone = 'key', maxW = W - 120 } = {}) {
    let s = size; ctx.font = fontOf(family, s);
    while (spacedWidth(ctx, text.toUpperCase(), spacing) > maxW && s > 11) { s -= 1; ctx.font = fontOf(family, s); }
    const b = { text: text.toUpperCase(), family, size: s, lines: [text.toUpperCase()], lh: s, height: s, width: spacedWidth(ctx, text.toUpperCase(), spacing) };
    return block(b, x, y, color, { align, zone, spacing });
  }

  return { ctx, qa, mood, block, label, ensure, w: canvas.width, h: canvas.height, fit: (text, o) => fit(ctx, text, o) };
}

// ---------------------------------------------------------------- photos
/**
 * Draws a photo into a rectangle: cropped to fill it, zoomed around a focus point, optionally flipped, blurred, desaturated
 * and tinted, so one photo never looks the same twice. `o`: zoom (>= 1), fx and fy (0..1 focus), flip, blur (0..1),
 * desat (0..1), tint { color, alpha, mode }, clip (a function that builds the clip path).
 */
function drawPhoto(ctx, img, x, y, w, h, o = {}) {
  const { createCanvas } = lib();
  const tw = Math.max(1, Math.round(w)); const th = Math.max(1, Math.round(h));
  const tmp = createCanvas(tw, th); const t = tmp.getContext('2d');
  t.quality = 'best'; t.patternQuality = 'best'; t.imageSmoothingEnabled = true;
  const scale = Math.max(tw / img.width, th / img.height) * (o.zoom || 1);
  const sw = tw / scale; const sh = th / scale;
  const fx = o.fx == null ? 0.5 : o.fx; const fy = o.fy == null ? 0.5 : o.fy;
  const sx = Math.min(img.width - sw, Math.max(0, fx * img.width - sw / 2));
  const sy = Math.min(img.height - sh, Math.max(0, fy * img.height - sh / 2));
  if (o.flip) { t.translate(tw, 0); t.scale(-1, 1); }
  if (o.blur) {
    // a soft blur: down to a small copy and back up in two steps
    const k = Math.max(4, Math.round(6 + o.blur * 14));
    const small = createCanvas(Math.max(1, Math.round(tw / k)), Math.max(1, Math.round(th / k)));
    const s = small.getContext('2d'); s.quality = 'best'; s.drawImage(img, sx, sy, sw, sh, 0, 0, small.width, small.height);
    const mid = createCanvas(Math.max(1, Math.round(tw / 3)), Math.max(1, Math.round(th / 3)));
    const m = mid.getContext('2d'); m.quality = 'best'; m.drawImage(small, 0, 0, mid.width, mid.height);
    t.drawImage(mid, 0, 0, tw, th);
  } else {
    t.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
  }
  t.setTransform(1, 0, 0, 1, 0, 0);
  if (o.desat) { t.globalCompositeOperation = 'saturation'; t.fillStyle = `rgba(128,128,128,${o.desat})`; t.fillRect(0, 0, tw, th); }
  if (o.tint) { t.globalCompositeOperation = o.tint.mode || 'soft-light'; t.fillStyle = rgba(o.tint.color, o.tint.alpha == null ? 0.35 : o.tint.alpha); t.fillRect(0, 0, tw, th); }
  if (o.warm) { t.globalCompositeOperation = 'soft-light'; t.fillStyle = `rgba(255,170,80,${o.warm})`; t.fillRect(0, 0, tw, th); }
  t.globalCompositeOperation = 'source-over';
  ctx.save();
  if (o.clip) { o.clip(ctx); ctx.clip(); }
  ctx.drawImage(tmp, x, y);
  ctx.restore();
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

// ---------------------------------------------------------------- shapes and ornaments
function archPath(ctx, x, y, w, h, pointed = true) {
  const a = w * 0.62; // the height of the arch head
  ctx.beginPath();
  ctx.moveTo(x, y + h); ctx.lineTo(x, y + a);
  if (pointed) {
    ctx.bezierCurveTo(x, y + a * 0.38, x + w * 0.3, y + a * 0.16, x + w / 2, y);
    ctx.bezierCurveTo(x + w * 0.7, y + a * 0.16, x + w, y + a * 0.38, x + w, y + a);
  } else {
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
  }
  ctx.lineTo(x + w, y + h); ctx.closePath();
}

function star(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rr = i % 2 ? r * 0.45 : r; const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx[i ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

function burstPath(ctx, cx, cy, r, points = 22, depth = 0.1) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const rr = i % 2 ? r * (1 - depth) : r; const a = (i * Math.PI) / points;
    ctx[i ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  ctx.closePath();
}

/** A marigold string (toran) across the top edge: decoration only, it may sit under the badges. */
function toran(ctx, y, colors = [C.marigold, '#E9781F', C.marigold, '#F6D04D']) {
  ctx.save();
  ctx.strokeStyle = rgba(C.goldLight, 0.7); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(W / 2, y + 26, W, y); ctx.stroke();
  for (let i = 0; i <= 18; i += 1) {
    const x = (i / 18) * W; const yy = y + 26 * (1 - ((2 * i) / 18 - 1) ** 2) * 0.5;
    const col = colors[i % colors.length];
    for (let k = 0; k < (i % 3 === 1 ? 3 : 1); k += 1) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, yy + 10 + k * 17, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba('#8A3A0B', 0.25); ctx.beginPath(); ctx.arc(x + 2, yy + 12 + k * 17, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/** A clay lamp with its flame. */
function diya(ctx, x, y, s) {
  ctx.save();
  const g = ctx.createRadialGradient(x, y - s * 0.9, 0, x, y - s * 0.9, s * 1.6);
  g.addColorStop(0, 'rgba(255,214,120,0.55)'); g.addColorStop(1, 'rgba(255,214,120,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - s * 0.9, s * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#B5562C'; ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.25); ctx.quadraticCurveTo(x, y + s * 0.75, x + s, y - s * 0.25); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#FFD36B'; ctx.beginPath(); ctx.moveTo(x, y - s * 1.25); ctx.quadraticCurveTo(x + s * 0.34, y - s * 0.55, x, y - s * 0.28); ctx.quadraticCurveTo(x - s * 0.34, y - s * 0.55, x, y - s * 1.25); ctx.fill();
  ctx.restore();
}

/** A ring of dots (rangoli and pookalam feel), decoration only. */
function dotRing(ctx, cx, cy, r, n, size, color) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i += 1) { const a = (i / n) * Math.PI * 2; ctx.beginPath(); ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), size, 0, Math.PI * 2); ctx.fill(); }
}

function goldFrame(ctx, inset, color = C.goldLight) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  ctx.lineWidth = 1; ctx.strokeRect(inset + 8, inset + 8, W - inset * 2 - 16, H - inset * 2 - 16);
  for (const [x, y] of [[inset, inset], [W - inset, inset], [inset, H - inset], [W - inset, H - inset]]) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 9, y); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** The small brand logo: a disc with the crescent and the word mark, the same on every post. */
function logo(S, x, y, { dark = false, align = 'right' } = {}) {
  const { ctx } = S;
  const ink = dark ? C.cream : C.plum;
  ctx.font = fontOf(FONT.sans, 14);
  const word = 'ZAYA NATURALS'; const sp = 2.6;
  const tw = spacedWidth(ctx, word, sp);
  const r = 15; const total = r * 2 + 10 + tw;
  const left = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const cy = y - 5;
  ctx.fillStyle = dark ? C.cream : C.plum; ctx.beginPath(); ctx.arc(left + r, cy, r, 0, Math.PI * 2); ctx.fill();
  crescent(ctx, left + r - 1, cy, r * 0.56, dark ? C.terracotta : C.rose, dark ? C.cream : C.plum);
  const b = { text: word, family: FONT.sans, size: 14, lines: [word], lh: 14, height: 14, width: tw };
  S.block(b, left + r * 2 + 10, y - 13, ink, { zone: 'footer', spacing: sp });
}

function handle(S, x, y, { dark = false, align = 'left' } = {}) {
  const b = { text: HANDLE, family: FONT.sans, size: 16, lines: [HANDLE], lh: 16, height: 16, width: 0 };
  S.ctx.font = fontOf(FONT.sans, 16); b.width = S.ctx.measureText(HANDLE).width;
  S.block(b, x, y - 14, dark ? C.cream : C.plum, { align, zone: 'footer' });
}

/** The footer every post shares: the handle on the left and the logo on the right, at the very bottom. */
function footer(S, { dark = false, y = H - 36, inset = 44 } = {}) {
  handle(S, inset, y, { dark });
  logo(S, S.w - inset, y, { dark });
}

/** A rounded pill with a label in it (kickers like NEW, OFFER, REEL). */
function pill(S, text, x, y, { bg, fg, size = 17, align = 'left', zone = 'key', padX = 18, h = 38 } = {}) {
  const { ctx } = S;
  ctx.font = fontOf(FONT.sans, size);
  const tw = spacedWidth(ctx, text.toUpperCase(), 2);
  const w = tw + padX * 2;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = bg; roundRect(ctx, left, y, w, h, h / 2); ctx.fill();
  const b = { text: text.toUpperCase(), family: FONT.sans, size, lines: [text.toUpperCase()], lh: size, height: size, width: tw };
  S.block(b, left + padX, y + (h - size) / 2 - size * 0.08, fg, { zone, spacing: 2, backing: bg });
  return { x: left, w, h };
}

function swipeCue(S, { dark = false, text = 'Swipe', y = H - 92 } = {}) {
  const { ctx } = S; const ink = dark ? C.cream : C.plum;
  const x = W - 44;
  ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 46, y); ctx.lineTo(x, y); ctx.moveTo(x - 12, y - 11); ctx.lineTo(x, y); ctx.lineTo(x - 12, y + 11); ctx.stroke();
  const b = { text, family: FONT.sans, size: 18, lines: [text], lh: 18, height: 18, width: 0 };
  ctx.font = fontOf(FONT.sans, 18); b.width = ctx.measureText(text).width;
  S.block(b, x - 60, y - 13, ink, { align: 'right', zone: 'footer' });
}

function slideDots(S, n, total, { dark = false, y = H - 92 } = {}) {
  const { ctx } = S;
  for (let i = 0; i < total; i += 1) {
    ctx.fillStyle = i === n - 1 ? (dark ? C.cream : C.plum) : rgba(dark ? C.cream : C.plum, 0.3);
    ctx.beginPath(); ctx.arc(44 + i * 20, y, i === n - 1 ? 6 : 5, 0, Math.PI * 2); ctx.fill();
  }
}

function playGlyph(ctx, cx, cy, r) {
  ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.plum; ctx.beginPath(); ctx.moveTo(cx - r * 0.3, cy - r * 0.42); ctx.lineTo(cx - r * 0.3, cy + r * 0.42); ctx.lineTo(cx + r * 0.46, cy); ctx.closePath(); ctx.fill();
}

// ---------------------------------------------------------------- the families
// Each family draws a full 864 x 1080 picture from a design `d` (postDesigns.js): d.photo (an Image), d.crop, the texts.
const FAMILIES = {};

/** 1. Full-bleed photo, a deep gradient from below, kicker + big serif headline + one line. */
FAMILIES.hero = (S, d) => {
  const { ctx, mood } = S;
  drawPhoto(ctx, d.photo, 0, 0, W, H, d.crop);
  const deep = mood.light ? C.plumDeep : mood.deep;
  ctx.fillStyle = linear(ctx, 0, H * 0.38, 0, H, [[0, rgba(deep, 0)], [0.45, rgba(deep, 0.62)], [1, rgba(deep, 0.94)]]);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = linear(ctx, 0, 0, 0, H * 0.22, [[0, 'rgba(0,0,0,0.18)'], [1, 'rgba(0,0,0,0)']]); ctx.fillRect(0, 0, W, H * 0.22);
  const align = d.align || 'left'; const x = align === 'center' ? W / 2 : 56;
  const head = S.fit(d.head, { max: 84, min: 44, width: W - 112, lines: 3 });
  const sub = d.sub ? S.fit(d.sub, { family: FONT.sans, max: 26, min: 19, width: W - 112, lines: 2, lh: 1.3 }) : null;
  const bottom = H * 0.86;
  const subH = sub ? sub.height + 22 : 0;
  let y = bottom - subH - head.height - 52;
  S.label(d.kicker, x, y, C.goldLight, { align }); y += 44;
  y = S.block(head, x, y, C.cream, { align }) + 6;
  if (sub) S.block(sub, x, y + 10, C.cream, { align });
  footer(S, { dark: true });
};

/** 2. Split panel: the photo on one side, a colour block on the other with a stacked text column. */
FAMILIES.split = (S, d) => {
  const { ctx, mood } = S;
  const pw = Math.round(W * 0.54); const left = d.side !== 'right';
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  drawPhoto(ctx, d.photo, left ? 0 : W - pw, 0, pw, H, d.crop);
  const cx = left ? pw + 36 : 40; const cw = W - pw - 76;
  const ink = mood.ink; const accent = mood.accent;
  const head = S.fit(d.head, { max: 64, min: 34, width: cw, lines: 5, height: H * 0.34 });
  const body = d.body ? S.fit(d.body, { family: FONT.sans, max: 25, min: 18, width: cw, lines: 7, lh: 1.38 }) : null;
  let y = H * 0.27;
  ctx.fillStyle = accent; ctx.fillRect(cx, y, 44, 3); y += 26;
  y = S.label(d.kicker, cx, y, accent, { size: 15, spacing: 2.4, maxW: cw }) + 22;
  y = S.block(head, cx, y, ink) + 22;
  if (body) y = S.block(body, cx, y, ink) + 18;
  if (d.note) S.label(d.note, cx, Math.min(y + 10, H * 0.83), accent, { size: 15, spacing: 2, maxW: cw });
  // the footer sits on the colour block side
  if (left) { logo(S, W - 36, H - 36, { dark: !mood.light }); handle(S, cx, H - 72, { dark: !mood.light }); }
  else { handle(S, 40, H - 36, { dark: !mood.light }); logo(S, W - pw - 24, H - 72, { dark: !mood.light }); }
};

/** 3. Arch (jharokha) window: the photo in a pointed arch on a plain ground, a centred headline under it. */
FAMILIES.arch = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const aw = 520; const ax = (W - aw) / 2; const ay = 64; const ah = 600;
  ctx.save(); ctx.strokeStyle = rgba(mood.accent, 0.8); ctx.lineWidth = 2;
  archPath(ctx, ax - 16, ay - 16, aw + 32, ah + 32); ctx.stroke(); ctx.restore();
  drawPhoto(ctx, d.photo, ax, ay, aw, ah, { ...d.crop, clip: (c) => archPath(c, ax, ay, aw, ah) });
  let y = ay + ah + 46;
  y = S.label(d.kicker, W / 2, y, mood.accent, { align: 'center', size: 16 }) + 18;
  const head = S.fit(d.head, { max: 60, min: 34, width: W - 150, lines: 2 });
  y = S.block(head, W / 2, y, mood.ink, { align: 'center' }) + 12;
  if (d.sub) S.block(S.fit(d.sub, { family: FONT.sans, max: 24, min: 18, width: W - 170, lines: 2, lh: 1.35 }), W / 2, y, mood.ink, { align: 'center' });
  footer(S, { dark: !mood.light });
};

/** 4. Minimal, product-centred: the photo inside a thin frame, a small caption line under it. */
FAMILIES.minimal = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const m = 44; const ph = H * 0.7;
  drawPhoto(ctx, d.photo, m, m, W - m * 2, ph, d.crop);
  ctx.strokeStyle = rgba(mood.ink, 0.18); ctx.lineWidth = 1; ctx.strokeRect(m - 10, m - 10, W - m * 2 + 20, ph + 20);
  let y = m + ph + 40;
  const head = S.fit(d.head, { max: 44, min: 28, width: W - 2 * m - 220, lines: 2 });
  S.block(head, m, y, mood.ink);
  if (d.price) {
    const p = S.fit(d.price, { family: FONT.bold, max: 30, min: 20, width: 200, lines: 1 });
    S.block(p, W - m, y + 4, mood.accent, { align: 'right' });
  }
  y += head.height + 22;
  if (d.sub) S.label(d.sub, m, y, mood.accent, { size: 15, spacing: 2.2 });
  footer(S, { dark: !mood.light });
};

/** 5. Testimonial: a blurred, softened photo with a cream quote card, five stars and the customer's name. */
FAMILIES.testimonial = (S, d) => {
  const { ctx, mood } = S;
  const dark = !mood.light;
  if (d.variant === 'panel') {
    // the photo sharp on top, the quote on the colour panel below with a big quote mark on the seam
    const seam = Math.round(H * 0.42);
    ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
    drawPhoto(ctx, d.photo, 0, 0, W, seam, d.crop);
    ctx.fillStyle = mood.accent; ctx.beginPath(); ctx.arc(110, seam, 54, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mood.bg; ctx.font = fontOf(FONT.serif, 150); ctx.textAlign = 'center'; ctx.fillText('“', 110, seam + 100);
    for (let i = 0; i < 5; i += 1) star(ctx, 196 + i * 36, seam + 8, 14, dark ? C.goldLight : C.saffron);
    let y = seam + 80;
    const quote = S.fit(d.quote, { max: 48, min: 30, width: W - 112, lines: 5, lh: 1.2, height: SAFE_BOTTOM - y - 70 });
    y = S.block(quote, 56, y, mood.ink) + 26;
    ctx.fillStyle = mood.accent; ctx.fillRect(56, y, 40, 3); y += 18;
    S.block(S.fit(d.person, { family: FONT.sans, max: 23, min: 17, width: W / 2, lines: 1 }), 56, y, mood.ink);
    S.label(d.kicker || 'Verified buyer', W - 56, y + 3, mood.accent, { size: 15, align: 'right', spacing: 2, maxW: W / 2 - 80 });
    if (d.slide) slideDots(S, d.slide, d.total, { dark, y: H - 84 });
    if (d.slide && d.slide < d.total) swipeCue(S, { dark, y: H - 84 });
    footer(S, { dark });
    return;
  }
  drawPhoto(ctx, d.photo, 0, 0, W, H, { ...d.crop, blur: 0.6 });
  ctx.fillStyle = rgba(mood.light ? C.cream : mood.deep, mood.light ? 0.3 : 0.45); ctx.fillRect(0, 0, W, H);
  const cw = W - 100; const cx = 50;
  const quote = S.fit(`${d.quote}`, { max: 50, min: 30, width: cw - 96, lines: 6, lh: 1.2 });
  const ch = quote.height + 270; const cy = Math.max(SAFE_TOP + 4, (H - ch) / 2 + 10);
  ctx.save(); ctx.shadowColor = 'rgba(40,20,30,0.28)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
  ctx.fillStyle = C.ivory; roundRect(ctx, cx, cy, cw, ch, 26); ctx.fill(); ctx.restore();
  ctx.fillStyle = rgba(C.rose, 0.5); ctx.font = fontOf(FONT.serif, 220); ctx.textAlign = 'left'; ctx.fillText('“', cx + 26, cy + 170);
  for (let i = 0; i < 5; i += 1) star(ctx, cx + 70 + i * 38, cy + 66, 15, C.saffron);
  let y = cy + 112;
  y = S.block(quote, cx + 48, y, C.plum) + 26;
  ctx.fillStyle = C.rose; ctx.fillRect(cx + 48, y, 40, 3); y += 18;
  S.block(S.fit(d.person, { family: FONT.sans, max: 23, min: 17, width: cw / 2, lines: 1 }), cx + 48, y, C.plum);
  S.label(d.kicker || 'Verified buyer', cx + cw - 48, y + 3, C.terracotta, { size: 15, align: 'right', spacing: 2, maxW: cw / 2 - 60 });
  if (d.slide) slideDots(S, d.slide, d.total, { dark, y: H - 84 });
  if (d.slide && d.slide < d.total) swipeCue(S, { dark, y: H - 84 });
  footer(S, { dark });
};

/** 6. Offer: the photo above, a colour panel below, a scalloped burst with the deal on the seam. */
FAMILIES.offer = (S, d) => {
  const { ctx, mood } = S;
  const ph = Math.round(H * 0.58);
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  drawPhoto(ctx, d.photo, 0, 0, W, ph, d.crop);
  // the burst on the seam, right
  const bx = W - 168; const by = ph - 66; const br = 118;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  const bBg = d.burstBg || C.maroon; const bInk = d.burstInk || C.cream; const bDark = lum(...hexRgb(bBg)) < 0.2;
  ctx.fillStyle = bBg; burstPath(ctx, bx, by, br, 24, 0.08); ctx.fill(); ctx.restore();
  ctx.strokeStyle = rgba(bDark ? C.goldLight : C.plumDeep, 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, br - 20, 0, Math.PI * 2); ctx.stroke();
  const big = S.fit(d.badge, { family: FONT.bold, max: 50, min: 24, width: br * 1.5, lines: 2, lh: 1.0 });
  const small = d.badgeSub ? S.fit(d.badgeSub, { family: FONT.sans, max: 16, min: 12, width: br * 1.3, lines: 1 }) : null;
  const totalH = big.height + (small ? small.height + 10 : 0);
  let yb = by - totalH / 2 - 4;
  yb = S.block(big, bx, yb, bInk, { align: 'center', backing: bBg }) - 4;
  if (small) S.block(small, bx, yb + 6, bDark ? C.goldLight : bInk, { align: 'center', backing: bBg });
  let y = ph + 70;
  y = S.label(d.kicker, 56, y, mood.accent, { size: 19 }) + 20;
  const head = S.fit(d.head, { family: FONT.bold, max: 62, min: 34, width: W - 112, lines: 2, lh: 1.08 });
  y = S.block(head, 56, y, mood.ink) + 16;
  if (d.sub) S.block(S.fit(d.sub, { family: FONT.sans, max: 26, min: 19, width: W - 112, lines: 2, lh: 1.32, height: SAFE_BOTTOM - y }), 56, y, mood.ink);
  footer(S, { dark: !mood.light });
};

/** 7. Myth vs fact: the myth over a dark, muted photo above; the fact on a light panel below; a "vs" coin on the seam. */
FAMILIES.mythFact = (S, d) => {
  const { ctx, mood } = S;
  if (d.variant === 'cards') {
    // two stacked cards: the myth crossed out, the fact ticked; a round photo and the question on top
    ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
    const cw = W - 112;
    const fitCard = (text) => S.fit(text, { max: 44, min: 24, width: cw - 150, lines: 4, lh: 1.18 });
    const cardH = (t) => Math.max(160, t.height + 104);
    const total = 170 + cardH(fitCard(d.myth)) + 24 + cardH(fitCard(d.fact));
    const top = Math.max(SAFE_TOP + 10, Math.round((SAFE_TOP + SAFE_BOTTOM - 70 - total) / 2));
    const r = 74; const px = 56 + r; const py = top + r;
    drawPhoto(ctx, d.photo, px - r, py - r, r * 2, r * 2, { ...d.crop, clip: (c) => { c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); } });
    S.block(S.fit('Myth or fact?', { max: 58, min: 30, width: W - px - r - 90, lines: 1 }), px + r + 28, py - 34, mood.ink);
    let y = top + 170;
    const card = (kind, text, yy, dark) => {
      const t = fitCard(text);
      const ch = cardH(t);
      ctx.fillStyle = dark ? mood.ink : rgba(mood.ink, 0.07); roundRect(ctx, 56, yy, cw, ch, 24); ctx.fill();
      const ix = 56 + 62; const iy = yy + 62;
      ctx.fillStyle = kind === 'Myth' ? C.terracotta : C.sage; ctx.beginPath(); ctx.arc(ix, iy, 30, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.cream; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath();
      if (kind === 'Myth') { ctx.moveTo(ix - 11, iy - 11); ctx.lineTo(ix + 11, iy + 11); ctx.moveTo(ix + 11, iy - 11); ctx.lineTo(ix - 11, iy + 11); }
      else { ctx.moveTo(ix - 13, iy + 1); ctx.lineTo(ix - 3, iy + 11); ctx.lineTo(ix + 14, iy - 10); }
      ctx.stroke();
      const ink = dark ? (mood.light ? C.cream : mood.bg) : mood.ink;
      const ly = S.label(kind, 56 + 118, yy + 34, dark ? (mood.light ? C.goldLight : mood.deep) : mood.accent, { size: 18, spacing: 4, maxW: cw - 150 }) + 12;
      S.block(t, 56 + 118, ly, ink, { backing: dark ? mood.ink : mood.bg });
      return yy + ch;
    };
    y = card('Myth', d.myth, y, false) + 22;
    card('Fact', d.fact, y, true);
    if (d.swipe) swipeCue(S, { dark: !mood.light });
    footer(S, { dark: !mood.light });
    return;
  }
  const seam = Math.round(H * 0.53);
  drawPhoto(ctx, d.photo, 0, 0, W, seam, { ...d.crop, desat: 0.3 });
  ctx.fillStyle = linear(ctx, 0, 0, 0, seam, [[0, rgba(C.plumDeep, 0.1)], [0.3, rgba(C.plumDeep, 0.45)], [1, rgba(C.plumDeep, 0.9)]]); ctx.fillRect(0, 0, W, seam);
  ctx.fillStyle = mood.light ? mood.bg : C.cream; ctx.fillRect(0, seam, W, H - seam);
  const myth = S.fit(d.myth, { max: 54, min: 30, width: W - 112, lines: 3, lh: 1.14 });
  const top = Math.max(SAFE_TOP + 40, seam - myth.height - 104);
  let y = S.label('Myth', 56, top, C.goldLight, { size: 19, spacing: 4 }) + 18;
  const mTop = y;
  y = S.block(myth, 56, y, C.cream);
  // a hand-drawn strike through each line of the myth
  ctx.strokeStyle = rgba(C.rose, 0.95); ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.font = fontOf(myth.family, myth.size);
  myth.lines.forEach((l, i) => {
    const ly = mTop + myth.size * 0.5 + i * myth.lh;
    ctx.beginPath(); ctx.moveTo(52, ly + 3); ctx.lineTo(56 + ctx.measureText(l).width + 6, ly - 3); ctx.stroke();
  });
  ctx.fillStyle = C.terracotta; ctx.beginPath(); ctx.arc(W - 120, seam, 46, 0, Math.PI * 2); ctx.fill();
  S.block(S.fit('vs', { max: 34, min: 20, width: 60, lines: 1 }), W - 120, seam - 24, C.cream, { align: 'center', zone: 'deco', backing: C.terraDeep });
  y = seam + 60;
  y = S.label('Fact', 56, y, C.terraDeep, { size: 19, spacing: 4 }) + 18;
  const fact = S.fit(d.fact, { max: 44, min: 26, width: W - 112, lines: 5, lh: 1.2, height: SAFE_BOTTOM - 70 - y });
  S.block(fact, 56, y, C.plum);
  if (d.swipe) swipeCue(S, { dark: false });
  footer(S, { dark: false });
};

/** 8. A numbered list (steps or reasons): a photo band on top, a light panel with the list. */
FAMILIES.list = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const band = Math.round(H * 0.33);
  drawPhoto(ctx, d.photo, 0, 0, W, band, d.crop);
  ctx.fillStyle = linear(ctx, 0, band - 80, 0, band, [[0, rgba(mood.bg, 0)], [1, rgba(mood.bg, 1)]]); ctx.fillRect(0, band - 80, W, 80);
  let y = band + 10;
  y = S.label(d.kicker, 56, y, mood.accent) + 14;
  const head = S.fit(d.head, { max: 52, min: 32, width: W - 112, lines: 2 });
  y = S.block(head, 56, y, mood.ink) + 26;
  const items = d.items;
  const room = SAFE_BOTTOM - 20 - y; const each = room / items.length;
  const size = Math.min(30, Math.floor(each * 0.42));
  items.forEach((it, i) => {
    const iy = y + i * each;
    ctx.fillStyle = mood.light ? C.plum : C.goldLight; ctx.beginPath(); ctx.arc(80, iy + each * 0.36, 24, 0, Math.PI * 2); ctx.fill();
    S.block(S.fit(String(i + 1), { family: FONT.bold, max: 24, min: 16, width: 30, lines: 1 }), 80, iy + each * 0.36 - 14, mood.light ? C.cream : C.plumDeep, { align: 'center', backing: mood.light ? C.plum : C.goldLight });
    const t = S.fit(it, { family: FONT.sans, max: size, min: 17, width: W - 180, lines: 2, lh: 1.3, height: each * 0.82 });
    S.block(t, 124, iy + each * 0.36 - t.height / 2 - 3, mood.ink);
    if (i < items.length - 1) { ctx.fillStyle = rgba(mood.ink, 0.12); ctx.fillRect(124, iy + each - 4, W - 180, 1); }
  });
  if (d.swipe) swipeCue(S, { dark: !mood.light, y: H - 70 });
  footer(S, { dark: !mood.light });
};

/** 9. Tip or "did you know": a colour ground, a giant soft question mark, the fact large, a round photo sticker. */
FAMILIES.tip = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = rgba(mood.light ? mood.ink : C.cream, 0.07); ctx.font = fontOf(FONT.serif, 760); ctx.textAlign = 'right'; ctx.fillText('?', W + 40, H * 0.86);
  const r = 128; const px = W - 56 - r; const py = H * 0.29;
  ctx.save(); ctx.strokeStyle = mood.accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, py, r + 10, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  drawPhoto(ctx, d.photo, px - r, py - r, r * 2, r * 2, { ...d.crop, clip: (c) => { c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); } });
  let y = H * 0.24;
  y = S.label(d.kicker || 'Did you know?', 56, y, mood.accent, { maxW: W - 2 * r - 140 }) + 20;
  const head = S.fit(d.head, { max: 58, min: 34, width: W - 2 * r - 150, lines: 3 });
  y = Math.max(S.block(head, 56, y, mood.ink) + 30, py + r + 40);
  const body = S.fit(d.body, { max: 40, min: 26, width: W - 112, lines: 5, lh: 1.24, height: SAFE_BOTTOM - y - 70 });
  y = S.block(body, 56, y, mood.ink) + 26;
  if (d.note) pill(S, d.note, 56, Math.min(y, SAFE_BOTTOM - 44), { bg: mood.light ? C.plum : C.cream, fg: mood.light ? C.cream : C.plum, size: 15 });
  footer(S, { dark: !mood.light });
};

/** 10. Type-led statement: one big serif sentence on a colour ground, a small round photo, a thin rule. */
FAMILIES.statement = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const r = 92; const px = 56 + r; const py = H * 0.27 + r;
  drawPhoto(ctx, d.photo, px - r, py - r, r * 2, r * 2, { ...d.crop, clip: (c) => { c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); } });
  S.label(d.kicker, px + r + 28, py - 12, mood.accent, { maxW: W - px - r - 90 });
  let y = py + r + 46;
  const head = S.fit(d.head, { max: 92, min: 48, width: W - 112, lines: 4, lh: 1.05, height: H * 0.36 });
  y = S.block(head, 56, y, mood.ink) + 26;
  ctx.fillStyle = mood.accent; ctx.fillRect(56, y, 60, 3); y += 26;
  if (d.sub) S.block(S.fit(d.sub, { family: FONT.sans, max: 26, min: 19, width: W - 112, lines: 3, lh: 1.36, height: SAFE_BOTTOM - y }), 56, y, mood.ink);
  footer(S, { dark: !mood.light });
};

/** 11. Festive greeting: a deep ground, a gold double frame, a marigold toran, an arch photo, the greeting in two scripts. */
FAMILIES.festive = (S, d) => {
  const { ctx, mood } = S;
  if (d.variant === 'full') {
    // the photo full-bleed, a deep gradient from below, the gold frame and the greeting low in the picture
    drawPhoto(ctx, d.photo, 0, 0, W, H, d.crop);
    ctx.fillStyle = linear(ctx, 0, H * 0.3, 0, H, [[0, rgba(mood.deep, 0)], [0.5, rgba(mood.deep, 0.75)], [1, rgba(mood.deep, 0.97)]]); ctx.fillRect(0, 0, W, H);
    goldFrame(ctx, 26, mood.accent);
    const head = S.fit(d.head, { max: 76, min: 40, width: W - 160, lines: 2, lh: 1.04 });
    const sub = d.sub ? S.fit(d.sub, { family: FONT.sans, max: 24, min: 18, width: W - 200, lines: 2, lh: 1.35 }) : null;
    let y = SAFE_BOTTOM - 30 - head.height - (sub ? sub.height + 18 : 0) - 60;
    if (d.script) {
      const fam = /[\u0B80-\u0BFF]/.test(d.script) ? FONT.tamil : /[\u0D00-\u0D7F]/.test(d.script) ? FONT.malayalam : FONT.hindi;
      y = S.block(S.fit(d.script, { family: fam, max: 36, min: 22, width: W - 200, lines: 1 }), W / 2, y, mood.accent, { align: 'center' }) + 10;
    }
    y = S.block(head, W / 2, y, C.cream, { align: 'center' }) + 16;
    if (sub) S.block(sub, W / 2, y, C.cream, { align: 'center' });
    diya(ctx, 120, SAFE_BOTTOM + 10, 20); diya(ctx, W - 120, SAFE_BOTTOM + 10, 20);
    footer(S, { dark: true, y: H - 50, inset: 60 });
    return;
  }
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  // a quiet pattern of small dots
  ctx.fillStyle = rgba(mood.accent, 0.08);
  for (let yy = 30; yy < H; yy += 44) for (let xx = (yy / 44) % 2 ? 22 : 44; xx < W; xx += 44) { ctx.beginPath(); ctx.arc(xx, yy, 2.4, 0, Math.PI * 2); ctx.fill(); }
  const motif = d.motif || 'toran';
  if (motif === 'toran') toran(ctx, 0);
  if (motif === 'tricolour') { ctx.fillStyle = '#E9862B'; ctx.fillRect(0, 0, W, 16); ctx.fillStyle = C.cream; ctx.fillRect(0, 16, W, 10); ctx.fillStyle = '#2F7D3B'; ctx.fillRect(0, 26, W, 16); }
  goldFrame(ctx, 26, mood.accent);
  const aw = 340; const ah = 430; const ax = (W - aw) / 2; const ay = 132;
  if (motif === 'pookalam' || motif === 'rangoli') {
    const cols = motif === 'pookalam' ? [C.marigold, '#E9781F', C.cream, '#7FB069'] : ['#E84A5F', C.marigold, '#7B4FB5', '#2EA6A0'];
    cols.forEach((col, i) => dotRing(ctx, W / 2, ay + ah * 0.55, aw * 0.62 + i * 18, 40 + i * 8, 5, rgba(col, 0.75)));
  }
  if (motif === 'moon') { ctx.fillStyle = rgba(C.goldLight, 0.9); crescent(ctx, W - 150, 150, 46, C.goldLight, mood.bg); }
  ctx.save(); ctx.strokeStyle = mood.accent; ctx.lineWidth = 3; archPath(ctx, ax - 12, ay - 12, aw + 24, ah + 24); ctx.stroke(); ctx.restore();
  drawPhoto(ctx, d.photo, ax, ay, aw, ah, { ...d.crop, clip: (c) => archPath(c, ax, ay, aw, ah) });
  if (motif === 'diyas' || motif === 'toran') { diya(ctx, ax - 70, ay + ah + 6, 22); diya(ctx, ax + aw + 70, ay + ah + 6, 22); }
  let y = ay + ah + 40;
  if (d.script) {
    const fam = /[஀-௿]/.test(d.script) ? FONT.tamil : /[ഀ-ൿ]/.test(d.script) ? FONT.malayalam : FONT.hindi;
    y = S.block(S.fit(d.script, { family: fam, max: 34, min: 22, width: W - 200, lines: 1 }), W / 2, y, mood.accent, { align: 'center' }) + 8;
  }
  const head = S.fit(d.head, { max: 70, min: 40, width: W - 160, lines: 2, lh: 1.06 });
  y = S.block(head, W / 2, y, mood.ink, { align: 'center' }) + 14;
  if (d.sub) S.block(S.fit(d.sub, { family: FONT.sans, max: 24, min: 18, width: W - 200, lines: 2, lh: 1.35, height: SAFE_BOTTOM - y }), W / 2, y, mood.ink, { align: 'center' });
  footer(S, { dark: true, y: H - 50, inset: 60 });
};

/** 12. Launch or new arrival: a big photo card with a margin, a NEW or NOW LIVE pill, the headline and the price. */
FAMILIES.launch = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const m = 40; const ph = 610;
  ctx.save(); ctx.beginPath(); roundRect(ctx, m, m, W - m * 2, ph, 28); ctx.clip();
  drawPhoto(ctx, d.photo, m, m, W - m * 2, ph, d.crop); ctx.restore();
  pill(S, d.kicker || 'New', m + 28, m + ph - 62, { bg: C.saffron, fg: C.plumDeep });
  let y = m + ph + 40;
  const head = S.fit(d.head, { max: 58, min: 32, width: W - 2 * m - 40, lines: 2, lh: 1.08 });
  y = S.block(head, m + 16, y, mood.ink) + 16;
  if (d.sub) S.block(S.fit(d.sub, { family: FONT.sans, max: 24, min: 18, width: W - 2 * m - 280, lines: 3, lh: 1.32, height: SAFE_BOTTOM - y }), m + 16, y, mood.ink);
  if (d.price) {
    const bw = 230; const bh = 64; const bx = W - m - bw - 6; const by = SAFE_BOTTOM - bh - 4;
    ctx.fillStyle = mood.light ? C.plum : C.cream; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
    S.block(S.fit(d.price, { family: FONT.bold, max: 26, min: 16, width: bw - 40, lines: 1 }), bx + bw / 2, by + 18, mood.light ? C.cream : C.plum, { align: 'center', backing: mood.light ? C.plum : C.cream });
  }
  if (d.swipe) swipeCue(S, { dark: !mood.light, y: H - 72 });
  footer(S, { dark: !mood.light });
};

/** 13. Ingredient spotlight: a big round crop on a colour ground with a gold ring, the ingredient name very large. */
FAMILIES.spotlight = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const r = 230; const cx = W / 2; const cy = 120 + r;
  ctx.save(); ctx.strokeStyle = mood.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r + 18, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  dotRing(ctx, cx, cy, r + 34, 60, 2.2, rgba(mood.accent, 0.6));
  drawPhoto(ctx, d.photo, cx - r, cy - r, r * 2, r * 2, { ...d.crop, clip: (c) => { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); } });
  let y = cy + r + 56;
  y = S.label(d.kicker || 'Ingredient spotlight', cx, y, mood.accent, { align: 'center', size: 16 }) + 16;
  y = S.block(S.fit(d.head, { max: 74, min: 40, width: W - 140, lines: 1 }), cx, y, mood.ink, { align: 'center' }) + 12;
  if (d.body) S.block(S.fit(d.body, { family: FONT.sans, max: 27, min: 19, width: W - 180, lines: 3, lh: 1.34, height: SAFE_BOTTOM - y - 40 }), cx, y, mood.ink, { align: 'center' });
  if (d.slide) slideDots(S, d.slide, d.total, { dark: !mood.light, y: H - 84 });
  if (d.swipe) swipeCue(S, { dark: !mood.light, y: H - 84 });
  footer(S, { dark: !mood.light });
};

/** 14. Carousel cover with an ingredient grid: the photo on top, the product's ingredients as a 2 x 2 grid, a swipe cue. */
FAMILIES.inside = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const ph = 470;
  drawPhoto(ctx, d.photo, 0, 0, W, ph, d.crop);
  let y = ph + 40;
  y = S.label(d.kicker || 'What is inside', 56, y, mood.accent, { size: 19 }) + 16;
  y = S.block(S.fit(d.head, { max: 56, min: 32, width: W - 112, lines: 2 }), 56, y, mood.ink) + 22;
  // the ingredients as an editorial list: a small number, the name large, a thin rule under each pair
  const items = d.items.slice(0, 4); const cw = (W - 112 - 40) / 2; const rowH = 92;
  items.forEach((it, i) => {
    const x = 56 + (i % 2) * (cw + 40); const yy = y + Math.floor(i / 2) * rowH;
    ctx.fillStyle = rgba(mood.ink, 0.22); ctx.fillRect(x, yy, cw, 1);
    S.label(String(i + 1).padStart(2, '0'), x, yy + 16, mood.accent, { size: 15, spacing: 2 });
    const t = S.fit(it, { family: FONT.serif, max: 36, min: 22, width: cw - 54, lines: 1 });
    S.block(t, x + 50, yy + 14 + (40 - t.size) / 2, mood.ink);
  });
  swipeCue(S, { dark: !mood.light, y: H - 84 });
  footer(S, { dark: !mood.light });
};

/** 15. Reel cover, three looks: a soft band across the middle, a big caption at the bottom, or a card. A play mark and the length. */
FAMILIES.reel = (S, d) => {
  const { ctx, mood } = S;
  drawPhoto(ctx, d.photo, 0, 0, W, H, d.crop);
  const v = d.variant || 'band';
  if (v === 'bottom') {
    ctx.fillStyle = linear(ctx, 0, H * 0.25, 0, H, [[0, rgba(C.plumDeep, 0)], [0.4, rgba(C.plumDeep, 0.78)], [1, rgba(C.plumDeep, 0.97)]]); ctx.fillRect(0, 0, W, H);
    const head = S.fit(d.head, { max: 80, min: 40, width: W - 112, lines: 3, lh: 1.04 });
    let y = H * 0.84 - head.height - 40;
    playGlyph(ctx, 56 + 34, y - 70, 34);
    if (d.length) S.label(d.length, 56 + 84, y - 82, C.cream, { size: 18, spacing: 2 });
    y = S.label(d.kicker || 'Reel', 56, y, C.goldLight, { size: 17 }) + 16;
    S.block(head, 56, y, C.cream);
    footer(S, { dark: true });
    return;
  }
  if (v === 'card') {
    ctx.fillStyle = rgba(C.plumDeep, 0.22); ctx.fillRect(0, 0, W, H);
    const head = S.fit(d.head, { max: 56, min: 32, width: W - 220, lines: 3, lh: 1.08 });
    const ch = head.height + 150; const cw = W - 140; const cx = 70; const cy = H * 0.84 - ch;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    ctx.fillStyle = mood.light ? C.ivory : mood.bg; roundRect(ctx, cx, cy, cw, ch, 26); ctx.fill(); ctx.restore();
    playGlyph(ctx, W / 2, cy, 40);
    let y = cy + 60;
    y = S.label(d.kicker || 'Reel', W / 2, y, mood.accent, { align: 'center', size: 16 }) + 16;
    S.block(head, W / 2, y, mood.ink, { align: 'center' });
    if (d.length) pill(S, d.length, W - 70, SAFE_TOP + 10, { bg: rgba(C.plumDeep, 0.8), fg: C.cream, size: 15, align: 'right', h: 36, zone: 'key' });
    footer(S, { dark: true });
    return;
  }
  ctx.fillStyle = rgba(C.plumDeep, 0.18); ctx.fillRect(0, 0, W, H);
  const head = S.fit(d.head, { max: 66, min: 36, width: W - 180, lines: 3, lh: 1.08 });
  const bandH = head.height + 150; const by = H * 0.56 - bandH / 2;
  ctx.fillStyle = rgba(mood.light ? C.cream : mood.deep, 0.95); ctx.fillRect(0, by, W, bandH);
  ctx.fillStyle = mood.light ? mood.accent : C.goldLight; ctx.fillRect(W / 2 - 30, by + 22, 60, 3);
  let y = by + 42;
  y = S.label(d.kicker || 'Reel', W / 2, y, mood.light ? mood.accent : C.goldLight, { align: 'center', size: 16 }) + 14;
  S.block(head, W / 2, y, mood.light ? mood.ink : C.cream, { align: 'center' });
  playGlyph(ctx, W / 2, by - 70, 40);
  if (d.length) pill(S, d.length, W / 2, by + bandH + 24, { bg: rgba(C.plumDeep, 0.75), fg: C.cream, size: 15, align: 'center', h: 36 });
  footer(S, { dark: true });
};

/** 16. Collage: two or three photos as tilted prints on a warm ground, a handwritten-feel caption. */
FAMILIES.collage = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  if (d.variant === 'grid') {
    // a moodboard: one tall photo and two stacked ones with thin gutters, the caption below
    const g = 12; const top = 40; const gh = 640; const lw = Math.round((W - 80 - g) * 0.58); const rw = W - 80 - g - lw;
    const cells = [[40, top, lw, gh], [40 + lw + g, top, rw, (gh - g) / 2], [40 + lw + g, top + (gh + g) / 2, rw, (gh - g) / 2]];
    d.photos.slice(0, 3).forEach((p, i) => {
      const [x, y, w, h] = cells[i];
      ctx.save(); roundRect(ctx, x, y, w, h, 18); ctx.clip(); drawPhoto(ctx, p.photo, x, y, w, h, p.crop); ctx.restore();
    });
    if (d.reel) playGlyph(ctx, 40 + lw / 2, top + gh / 2, 40);
    let y = top + gh + 44;
    if (d.kicker) y = S.label(d.kicker, 56, y, mood.accent, { size: 17 }) + 14;
    S.block(S.fit(d.head, { max: 56, min: 30, width: W - 112, lines: 2, lh: 1.05, height: SAFE_BOTTOM - y }), 56, y, mood.ink);
    footer(S, { dark: !mood.light });
    return;
  }
  const prints = d.photos.slice(0, 3);
  const spots = prints.length === 3 ? [[250, 330, -0.08, 300, 360], [600, 300, 0.07, 300, 360], [430, 560, -0.02, 330, 300]] : [[290, 380, -0.07, 360, 440], [580, 430, 0.06, 360, 440]];
  prints.forEach((p, i) => {
    const [x, y, a, w, h] = spots[i];
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.shadowColor = 'rgba(30,15,10,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
    ctx.fillStyle = C.ivory; ctx.fillRect(-w / 2 - 14, -h / 2 - 14, w + 28, h + 62); ctx.shadowColor = 'transparent';
    drawPhoto(ctx, p.photo, -w / 2, -h / 2, w, h, p.crop);
    ctx.restore();
  });
  // a strip of tape on the first print
  ctx.save(); ctx.translate(250, 140); ctx.rotate(-0.2); ctx.fillStyle = 'rgba(240,226,190,0.8)'; ctx.fillRect(-50, -14, 100, 28); ctx.restore();
  let y = H * 0.78 - 30;
  if (d.kicker) y = S.label(d.kicker, 56, y, mood.accent, { size: 17 }) + 14;
  S.block(S.fit(d.head, { max: 56, min: 30, width: W - 112, lines: 2, lh: 1.05, height: SAFE_BOTTOM - y }), 56, y, mood.ink);
  if (d.reel) playGlyph(ctx, W - 100, 230, 34);
  footer(S, { dark: !mood.light });
};

/** 17. Story-style: a tall rounded photo card on a colour ground with a question sticker and two answers. */
FAMILIES.story = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const cw = 520; const ch = 860; const cx = (W - cw) / 2; const cy = 60;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#000'; roundRect(ctx, cx, cy, cw, ch, 34); ctx.fill(); ctx.restore();
  ctx.save(); roundRect(ctx, cx, cy, cw, ch, 34); ctx.clip(); drawPhoto(ctx, d.photo, cx, cy, cw, ch, d.crop);
  ctx.fillStyle = linear(ctx, 0, cy, 0, cy + 90, [[0, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]); ctx.fillRect(cx, cy, cw, 90); ctx.restore();
  // story progress bars (decoration in the top band)
  for (let i = 0; i < 4; i += 1) { ctx.fillStyle = i < 2 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)'; roundRect(ctx, cx + 20 + i * ((cw - 40) / 4), cy + 18, (cw - 40) / 4 - 8, 4, 2); ctx.fill(); }
  // the sticker
  const sw = 440; const sx = (W - sw) / 2; const q = S.fit(d.head, { family: FONT.bold, max: 34, min: 22, width: sw - 60, lines: 2, lh: 1.12 });
  const sh = q.height + 150; const sy = cy + ch * 0.56 - sh / 2;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 20; ctx.fillStyle = C.ivory; roundRect(ctx, sx, sy, sw, sh, 24); ctx.fill(); ctx.restore();
  let y = sy + 26;
  y = S.block(q, W / 2, y, C.plum, { align: 'center' }) + 22;
  const opts = d.options.slice(0, 2); const ow = (sw - 60 - 14) / 2;
  opts.forEach((o, i) => {
    const ox = sx + 30 + i * (ow + 14);
    ctx.fillStyle = i === 0 ? C.saffron : C.sand; roundRect(ctx, ox, y, ow, 56, 28); ctx.fill();
    S.block(S.fit(o, { family: FONT.sans, max: 20, min: 13, width: ow - 24, lines: 1 }), ox + ow / 2, y + 17, C.plumDeep, { align: 'center', backing: i === 0 ? C.saffron : C.sand });
  });
  if (d.kicker) S.label(d.kicker, W / 2, cy + ch - 70, C.cream, { align: 'center', size: 15, spacing: 2.4 });
  footer(S, { dark: !mood.light });
};

/** 18. Gift guide: a product grid with names and prices on cream, a title band and a swipe cue. */
FAMILIES.guide = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  let y = SAFE_TOP + 4;
  y = S.label(d.kicker, 56, y, mood.accent) + 14;
  y = S.block(S.fit(d.head, { max: 56, min: 32, width: W - 112, lines: 1 }), 56, y, mood.ink) + 24;
  const cells = d.cells.slice(0, 4); const cw = (W - 112 - 20) / 2; const chh = (SAFE_BOTTOM - y - 20) / 2;
  cells.forEach((c, i) => {
    const x = 56 + (i % 2) * (cw + 20); const yy = y + Math.floor(i / 2) * (chh + 20);
    const ph = chh - 70;
    ctx.save(); roundRect(ctx, x, yy, cw, chh, 18); ctx.clip();
    ctx.fillStyle = mood.light ? C.ivory : rgba(C.cream, 0.08); ctx.fillRect(x, yy, cw, chh);
    drawPhoto(ctx, c.photo, x, yy, cw, ph, c.crop); ctx.restore();
    S.block(S.fit(c.name, { family: FONT.sans, max: 19, min: 13, width: cw - 120, lines: 1 }), x + 16, yy + ph + 22, mood.ink);
    S.block(S.fit(c.price, { family: FONT.bold, max: 20, min: 14, width: 100, lines: 1 }), x + cw - 16, yy + ph + 21, mood.accent, { align: 'right' });
  });
  swipeCue(S, { dark: !mood.light, y: H - 76 });
  footer(S, { dark: !mood.light });
};

/** 19. Countdown or deadline: a photo with a big date block and the delivery line. */
FAMILIES.countdown = (S, d) => {
  const { ctx, mood } = S;
  drawPhoto(ctx, d.photo, 0, 0, W, H, d.crop);
  ctx.fillStyle = rgba(C.plumDeep, 0.25); ctx.fillRect(0, 0, W, H);
  const bw = 600; const bh = 420; const bx = 56; const by = H * 0.4;
  ctx.fillStyle = mood.bg; roundRect(ctx, bx, by, bw, bh, 22); ctx.fill();
  let y = by + 40;
  y = S.label(d.kicker, bx + 40, y, mood.accent) + 16;
  y = S.block(S.fit(d.big, { family: FONT.bold, max: 88, min: 44, width: bw - 80, lines: 1 }), bx + 40, y, mood.ink) + 10;
  y = S.block(S.fit(d.line || d.head, { max: 40, min: 26, width: bw - 80, lines: 2, lh: 1.1 }), bx + 40, y, mood.ink) + 16;
  if (d.sub) S.block(S.fit(d.sub, { family: FONT.sans, max: 24, min: 18, width: bw - 80, lines: 2, lh: 1.32, height: by + bh - 26 - y }), bx + 40, y, mood.ink);
  footer(S, { dark: true });
};

/** 20. A carousel slide (2nd, 3rd...): the same frame for every slide of a set, a big number, a line, the photo. */
FAMILIES.slide = (S, d) => {
  const { ctx, mood } = S;
  ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, W, H);
  const m = 44; const ph = 600;
  ctx.save(); roundRect(ctx, m, m, W - m * 2, ph, 24); ctx.clip(); drawPhoto(ctx, d.photo, m, m, W - m * 2, ph, d.crop); ctx.restore();
  // the text block sits in the middle of the space under the photo
  const tw = W - 2 * m - 150;
  const head = S.fit(d.head, { max: 50, min: 28, width: tw, lines: 2, lh: 1.08 });
  const body = d.body ? S.fit(d.body, { family: FONT.sans, max: 30, min: 20, width: tw, lines: 4, lh: 1.34, height: 190 }) : null;
  const blockH = head.height + (body ? body.height + 22 : 0);
  const room = [m + ph + 30, H - 120];
  const y = Math.round(room[0] + Math.max(0, (room[1] - room[0] - blockH) / 2) - 10);
  const num = S.fit(String(d.slide).padStart(2, '0'), { family: FONT.serif, max: 72, min: 40, width: 120, lines: 1 });
  S.block(num, m + 8, y - 8, mood.accent);
  const hy = S.block(head, m + 140, y, mood.ink) + 12;
  if (body) S.block(body, m + 140, hy, mood.ink);
  slideDots(S, d.slide, d.total, { dark: !mood.light, y: H - 84 });
  if (d.slide < d.total) swipeCue(S, { dark: !mood.light, y: H - 84 });
  footer(S, { dark: !mood.light });
};

const FAMILY_NAMES = Object.freeze(Object.keys(FAMILIES));

// ---------------------------------------------------------------- video frames
/**
 * The three scenes of a demo video in the same style as the posts (D125): `hook` (the photo with the title), `steps` (the photo
 * with three numbered lines) and `end` (the logo and the tagline). Tall 720 x 1280 or wide 1280 x 720. The hook is also the
 * video's poster, which the Library shows cropped to 4:5 from the middle, so its text stays in the middle band.
 */
function frame(f, load) {
  const img = load(f.photoSlot);
  const wide = Boolean(f.wide);
  const fw = wide ? 1280 : 720; const fh = wide ? 720 : 1280;
  // the part a 4:5 Library tile shows, less the badge row on top and the play button at the bottom
  const band = wide ? { top: 110, bottom: 650 } : { top: 380, bottom: 1000 };
  const canvas = lib().createCanvas(fw, fh);
  const mood = MOODS[f.mood] || MOODS.plum;
  const S = makeCtx(canvas, mood, band);
  const { ctx } = S;
  const cx = fw / 2;
  if (f.kind === 'end') {
    ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, fw, fh);
    drawPhoto(ctx, img, 0, 0, fw, fh, { ...f.crop, blur: 0.8 });
    ctx.fillStyle = rgba(mood.light ? C.cream : mood.deep, 0.82); ctx.fillRect(0, 0, fw, fh);
    const cy = wide ? 250 : 560; const r = wide ? 56 : 64;
    ctx.fillStyle = mood.light ? C.plum : C.cream; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    crescent(ctx, cx - 3, cy, r * 0.56, mood.light ? C.rose : C.terracotta, mood.light ? C.plum : C.cream);
    let y = cy + r + 36;
    y = S.block(S.fit('Zaya Naturals', { max: wide ? 64 : 62, min: 36, width: fw - 120, lines: 1 }), cx, y, mood.ink, { align: 'center' }) + 14;
    y = S.block(S.fit(f.head, { family: FONT.sans, max: 30, min: 20, width: fw - 160, lines: 2, lh: 1.3 }), cx, y, mood.ink, { align: 'center' }) + 26;
    pill(S, HANDLE, cx, y, { bg: mood.light ? C.plum : C.cream, fg: mood.light ? C.cream : C.plum, size: 20, align: 'center', h: 46, padX: 24 });
    return { buffer: canvas.toBuffer('image/jpeg', { quality: 0.82, progressive: true, chromaSubsampling: true }), qa: S.qa };
  }
  if (f.kind === 'steps') {
    ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, fw, fh);
    if (wide) drawPhoto(ctx, img, 0, 0, 640, fh, f.crop); else drawPhoto(ctx, img, 0, 0, fw, 560, f.crop);
    const x0 = wide ? 700 : 56; const tw = wide ? fw - 760 : fw - 112;
    let y = wide ? 120 : 620;
    y = S.label(f.kicker || 'In three steps', x0, y, mood.accent, { size: 20, maxW: tw }) + 18;
    y = S.block(S.fit(f.head, { max: 56, min: 32, width: tw, lines: 2, lh: 1.08 }), x0, y, mood.ink) + 30;
    (f.lines || []).slice(0, 3).forEach((l, i) => {
      ctx.fillStyle = mood.light ? C.plum : C.goldLight; ctx.beginPath(); ctx.arc(x0 + 24, y + 26, 24, 0, Math.PI * 2); ctx.fill();
      S.block(S.fit(String(i + 1), { family: FONT.bold, max: 24, min: 16, width: 30, lines: 1 }), x0 + 24, y + 12, mood.light ? C.cream : C.plumDeep, { align: 'center', backing: mood.light ? C.plum : C.goldLight, zone: 'deco' });
      const t = S.fit(l, { family: FONT.sans, max: 30, min: 18, width: tw - 70, lines: 2, lh: 1.25 });
      S.block(t, x0 + 66, y + 26 - t.height / 2 - 4, mood.ink, { zone: 'deco' });
      y += wide ? 92 : 104;
    });
    return { buffer: canvas.toBuffer('image/jpeg', { quality: 0.82, progressive: true, chromaSubsampling: true }), qa: S.qa };
  }
  // hook (also the poster), in the look of the reel's own cover: a band, a card, a bottom caption or a collage of prints
  const v = wide ? 'bottom' : (f.variant || 'band');
  const done = () => ({ buffer: canvas.toBuffer('image/jpeg', { quality: 0.82, progressive: true, chromaSubsampling: true }), qa: S.qa });
  const deep = mood.light ? C.plumDeep : mood.deep;
  if (v === 'collage') {
    ctx.fillStyle = mood.bg; ctx.fillRect(0, 0, fw, fh);
    const prints = (f.prints && f.prints.length ? f.prints : [{ photoSlot: f.photoSlot, crop: f.crop }]).slice(0, 2);
    const spots = [[250, 500, -0.07], [470, 585, 0.06]];
    prints.forEach((p, i) => {
      const [x, y, a] = spots[i]; const w = 330; const h = 410;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.shadowColor = 'rgba(30,15,10,0.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
      ctx.fillStyle = C.ivory; ctx.fillRect(-w / 2 - 14, -h / 2 - 14, w + 28, h + 60); ctx.shadowColor = 'transparent';
      drawPhoto(ctx, load(p.photoSlot), -w / 2, -h / 2, w, h, p.crop);
      ctx.restore();
    });
    let y = 890;
    y = S.label(f.kicker || 'Reel', 50, y, mood.accent, { size: 18, maxW: fw - 100 }) + 14;
    S.block(S.fit(f.head, { max: 52, min: 30, width: fw - 100, lines: 2, lh: 1.04, height: band.bottom - y }), 50, y, mood.ink);
    logo(S, cx, 1060, { dark: !mood.light, align: 'center' });
    return done();
  }
  drawPhoto(ctx, img, 0, 0, fw, fh, f.crop);
  if (v === 'card') {
    ctx.fillStyle = rgba(C.plumDeep, 0.2); ctx.fillRect(0, 0, fw, fh);
    const head = S.fit(f.head, { max: 60, min: 34, width: fw - 180, lines: 3, lh: 1.06 });
    const ch = head.height + 140; const cy = 600;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    ctx.fillStyle = mood.light ? C.ivory : mood.bg; roundRect(ctx, 50, cy, fw - 100, ch, 26); ctx.fill(); ctx.restore();
    let y = cy + 44;
    y = S.label(f.kicker || 'Reel', cx, y, mood.accent, { align: 'center', size: 18 }) + 16;
    S.block(head, cx, y, mood.ink, { align: 'center' });
    logo(S, cx, cy + ch + 56, { dark: true, align: 'center' });
    return done();
  }
  if (v === 'band') {
    ctx.fillStyle = rgba(C.plumDeep, 0.12); ctx.fillRect(0, 0, fw, fh);
    const head = S.fit(f.head, { max: 64, min: 36, width: fw - 110, lines: 3, lh: 1.06 });
    const bh = head.height + 130; const by = 590;
    ctx.fillStyle = rgba(mood.light ? C.cream : mood.deep, 0.96); ctx.fillRect(0, by, fw, bh);
    ctx.fillStyle = mood.light ? mood.accent : C.goldLight; ctx.fillRect(cx - 30, by + 22, 60, 3);
    let y = by + 42;
    y = S.label(f.kicker || 'Reel', cx, y, mood.light ? mood.accent : C.goldLight, { align: 'center', size: 18 }) + 14;
    S.block(head, cx, y, mood.light ? mood.ink : C.cream, { align: 'center' });
    logo(S, cx, by + bh + 52, { dark: true, align: 'center' });
    return done();
  }
  // bottom: a deep gradient in the mood's own colour, the title large and left-aligned
  if (wide) {
    ctx.fillStyle = linear(ctx, 0, 0, 0, fh, [[0, rgba(deep, 0.05)], [0.45, rgba(deep, 0.35)], [1, rgba(deep, 0.9)]]); ctx.fillRect(0, 0, fw, fh);
  } else {
    ctx.fillStyle = linear(ctx, 0, fh * 0.3, 0, fh, [[0, rgba(deep, 0)], [0.4, rgba(deep, 0.72)], [0.75, rgba(deep, 0.92)], [1, rgba(deep, 0.96)]]); ctx.fillRect(0, 0, fw, fh);
  }
  const head = S.fit(f.head, { max: wide ? 72 : 76, min: 40, width: wide ? 560 : fw - 100, lines: 3, lh: 1.04 });
  const x0 = wide ? cx : 50; const align = wide ? 'center' : 'left';
  let y = band.bottom - 40 - head.height - 50;
  y = S.label(f.kicker || 'Reel', x0, y, C.goldLight, { align, size: 20 }) + 18;
  S.block(head, x0, y, C.cream, { align });
  logo(S, wide ? cx : 50, band.bottom + (wide ? 50 : 40), { dark: true, align: wide ? 'center' : 'left' });
  return done();
}

/** One video frame from a frame spec { kind, wide, mood, photoSlot, crop, kicker, head, lines }. Returns { buffer, qa }. */
function renderFrame(f, { photo, fallback }) {
  const load = (slot) => { const p = photo(slot); return p ? imageOf(p.key, p.buffer) : imageOf(`fallback:${f.product || 'x'}`, fallback(f)); };
  return frame(f, load);
}

// ---------------------------------------------------------------- render
/** A decoded photo, kept for the process (24 photos at most). */
const imageCache = new Map();
function imageOf(key, buffer) {
  if (imageCache.has(key)) return imageCache.get(key);
  const { Image } = lib();
  const img = new Image(); img.src = buffer;
  imageCache.set(key, img);
  return img;
}

function encode(canvas) {
  for (const q of [0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6, 0.55]) {
    const buf = canvas.toBuffer('image/jpeg', { quality: q, progressive: true, chromaSubsampling: true });
    if (buf.length <= MAX_BYTES) return buf;
  }
  return canvas.toBuffer('image/jpeg', { quality: 0.5, progressive: true, chromaSubsampling: true });
}

/**
 * Renders one design. `photo(slot)` returns { key, buffer } of a photo (or null), `fallback(design)` a JPEG buffer used when
 * the photo is missing (a machine without the real photos). Returns { buffer, qa }.
 */
function render(design, { photo, fallback }) {
  const withImg = (slot) => {
    const p = photo(slot);
    if (p) return imageOf(p.key, p.buffer);
    return imageOf(`fallback:${design.product || 'x'}`, fallback(design));
  };
  const d = { ...design, photo: design.photoSlot ? withImg(design.photoSlot) : null };
  if (design.photos) d.photos = design.photos.map((p) => ({ ...p, photo: withImg(p.photoSlot) }));
  if (design.cells) d.cells = design.cells.map((c) => ({ ...c, photo: withImg(c.photoSlot) }));
  const draw = FAMILIES[design.family];
  if (!draw) throw new Error(`unknown family ${design.family}`);
  const canvas = lib().createCanvas(W, H);
  const S = makeCtx(canvas, MOODS[design.mood] || MOODS.ivory);
  draw(S, d);
  return { buffer: encode(canvas), qa: S.qa };
}

module.exports = { W, H, SAFE_TOP, SAFE_BOTTOM, MAX_BYTES, HANDLE, C, MOODS, FAMILY_NAMES, render, renderFrame, fit, worstContrast, ratio, lum, hexRgb };
