// Pure WCAG 2.x contrast maths. No DOM, no dependencies: used by the Node tests
// (tests/contrast-math.test.mjs) and, through a dynamic import served by the Vite dev
// server, by contrast-audit.js inside the page.

const clamp255 = (n) => Math.max(0, Math.min(255, n));

const parseAlpha = (s) => {
  if (s == null || s === '') return 1;
  const t = String(s).trim();
  const v = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
};

const parseChannel = (s) => {
  const t = String(s).trim();
  const v = t.endsWith('%') ? (parseFloat(t) / 100) * 255 : parseFloat(t);
  return Number.isFinite(v) ? clamp255(v) : NaN;
};

/**
 * Parse a CSS colour string into {r,g,b,a} (r,g,b 0-255, a 0-1).
 * Supports #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() in comma or space syntax,
 * color(srgb r g b / a) and `transparent`. Returns null for anything else
 * (e.g. oklch(), named colours other than transparent), so callers can report it.
 */
export function parseColor(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };

  if (s[0] === '#') {
    let h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }

  let m = s.match(/^rgba?\(\s*([^)]*)\)$/);
  if (m) {
    const body = m[1];
    let parts;
    let alpha;
    if (body.includes(',')) {
      parts = body.split(',').map((p) => p.trim());
      alpha = parts[3];
      parts = parts.slice(0, 3);
    } else {
      const [rgb, a] = body.split('/');
      parts = rgb.trim().split(/\s+/);
      alpha = a;
    }
    if (parts.length !== 3) return null;
    const [r, g, b] = parts.map(parseChannel);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: parseAlpha(alpha) };
  }

  m = s.match(/^color\(\s*srgb\s+([^)]*)\)$/);
  if (m) {
    const [rgb, a] = m[1].split('/');
    const parts = rgb.trim().split(/\s+/).map((p) => {
      const t = p.trim();
      return t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
    });
    if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) return null;
    const [r, g, b] = parts.map((v) => clamp255(v * 255));
    return { r, g, b, a: parseAlpha(a) };
  }
  return null;
}

/** Source-over compositing of fg (with alpha) onto an opaque bg. Returns opaque {r,g,b}. */
export function composite(fg, bg) {
  const a = fg && Number.isFinite(fg.a) ? fg.a : 1;
  const mix = (f, b) => f * a + b * (1 - a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an opaque sRGB colour. */
export function luminance({ r, g, b }) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two opaque colours (1..21), order independent. */
export function ratio(c1, c2) {
  const [hi, lo] = [luminance(c1), luminance(c2)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const weightNumber = (w) => {
  if (w === 'bold' || w === 'bolder') return 700;
  const n = Number(w);
  return Number.isFinite(n) ? n : 400;
};

/** WCAG "large scale" text: >= 18pt (24px) normal, or >= 14pt (18.66px) bold (700+). */
export function isLargeText(fontSizePx, fontWeight) {
  const px = Number(fontSizePx);
  if (!Number.isFinite(px)) return false;
  if (px >= 24) return true;
  return px >= 18.66 && weightNumber(fontWeight) >= 700;
}

/** AA minimum for text of this size/weight: 3 for large text, otherwise 4.5. */
export function requiredRatio(fontSizePx, fontWeight) {
  return isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;
}

// ---- gradients ------------------------------------------------------------------------------

/** Split a CSS value on commas that are not inside parentheses. */
export function splitTopLevel(str) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(str)) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COLOR_HEAD = /^(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]{3,8}\b|[a-zA-Z]+)/;
const SIDE_ANGLE = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };

function parseStops(args) {
  const stops = [];
  for (const a of args) {
    const m = a.match(COLOR_HEAD);
    if (!m) continue;
    const color = parseColor(m[1]);
    if (!color) continue;
    const pos = (a.slice(m[1].length).match(/-?[\d.]+%/g) || []).map((p) => parseFloat(p) / 100);
    if (pos.length === 0) stops.push({ color, pos: null });
    else pos.forEach((p) => stops.push({ color, pos: p }));
  }
  if (!stops.length) return stops;
  if (stops[0].pos == null) stops[0].pos = 0;
  if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = 1;
  // Fill missing positions evenly between known neighbours; keep them non-decreasing.
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].pos != null) { stops[i].pos = Math.max(stops[i].pos, stops[i - 1].pos); continue; }
    let j = i;
    while (stops[j].pos == null) j++;
    const a = stops[i - 1].pos;
    const b = Math.max(stops[j].pos, a);
    for (let k = i; k < j; k++) stops[k].pos = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  return stops;
}

/**
 * Parse a computed background-image into layers (topmost first):
 * { type: 'linear', angle, stops:[{color,pos}] } | { type: 'other', stops } (radial, conic,
 * repeating) | { type: 'url' } (url(), image-set()) | { type: 'unsupported' } (cross-fade(),
 * element(), anything else). `none` gives []. The audit treats url/unsupported as an image of
 * unknown colour (see classifyUncertain).
 */
export function parseBackgroundImage(str) {
  if (!str || str === 'none') return [];
  return splitTopLevel(str).map((layer) => {
    if (/^url\(/i.test(layer) || /^image-set\(/i.test(layer)) return { type: 'url', raw: layer.slice(0, 120) };
    const m = layer.match(/^([a-z-]+)\((.*)\)$/is);
    if (!m) return { type: 'unsupported', raw: layer.slice(0, 120) };
    const args = splitTopLevel(m[2]);
    if (m[1] === 'linear-gradient') {
      let angle = 180;
      const first = args[0] || '';
      const side = first.match(/^to\s+(.+)$/i);
      const deg = first.match(/^(-?[\d.]+)(deg|turn|rad|grad)$/i);
      if (side) { angle = SIDE_ANGLE[side[1].trim().toLowerCase()] ?? 180; args.shift(); }
      else if (deg) {
        const v = parseFloat(deg[1]);
        const unit = deg[2].toLowerCase();
        angle = unit === 'deg' ? v : unit === 'turn' ? v * 360 : unit === 'rad' ? (v * 180) / Math.PI : v * 0.9;
        args.shift();
      }
      return { type: 'linear', angle: ((angle % 360) + 360) % 360, stops: parseStops(args) };
    }
    if (/gradient$/.test(m[1])) {
      const stops = parseStops(args.filter((a) => COLOR_HEAD.test(a) && parseColor((a.match(COLOR_HEAD) || [])[1] || '')));
      return { type: 'other', stops };
    }
    return { type: 'unsupported', raw: layer.slice(0, 120) };
  });
}

/** Colour of a parsed gradient at t (0..1), interpolated with premultiplied alpha. */
export function gradientColorAt(g, t) {
  const s = g.stops;
  if (!s.length) return { r: 0, g: 0, b: 0, a: 0 };
  if (t <= s[0].pos) return { ...s[0].color };
  if (t >= s[s.length - 1].pos) return { ...s[s.length - 1].color };
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].pos) {
      const A = s[i - 1];
      const B = s[i];
      const span = B.pos - A.pos;
      const f = span > 0 ? (t - A.pos) / span : 1;
      const a = A.color.a + (B.color.a - A.color.a) * f;
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      const ch = (k) => (A.color[k] * A.color.a + (B.color[k] * B.color.a - A.color[k] * A.color.a) * f) / a;
      return { r: ch('r'), g: ch('g'), b: ch('b'), a };
    }
  }
  return { ...s[s.length - 1].color };
}

/** Position (0..1, clamped) of point {x,y} along a CSS linear gradient at `angle` over `box`. */
export function gradientT(angle, box, point) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const len = Math.abs(box.width * dx) + Math.abs(box.height * dy);
  if (!len) return 0;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const t = ((point.x - cx) * dx + (point.y - cy) * dy) / len + 0.5;
  const r = Math.round(Math.max(0, Math.min(1, t)) * 1e9) / 1e9;
  return r;
}

// ---- compositing ------------------------------------------------------------------------------
// A "paint" is one element: { colors: [...bottom -> top], opacity }. A colour is {r,g,b,a}, or
// { uncertain: true, kind, alpha? } for an image of unknown colour (url() background, img, video,
// canvas), or { alts: [colour...] } for alternatives (radial/conic gradient stops) that
// expandAlternatives turns into separate paint lists.

/** Premultiplied dst, straight-alpha src: source-over. */
export function over(dst, src) {
  const a = src.a;
  return { r: src.r * a + dst.r * (1 - a), g: src.g * a + dst.g * (1 - a), b: src.b * a + dst.b * (1 - a), a: a + dst.a * (1 - a) };
}

/** Premultiplied group composited with group opacity o over premultiplied dst. */
export function overGroup(dst, grp, o) {
  const a = grp.a * o;
  return { r: grp.r * o + dst.r * (1 - a), g: grp.g * o + dst.g * (1 - a), b: grp.b * o + dst.b * (1 - a), a: a + dst.a * (1 - a) };
}

/**
 * Draw paints (root -> element) over an opaque white canvas, `opacity` < 1 as a group over the
 * real backdrop, then the text colour (if any) inside the innermost paint, then `covers` (things
 * painted above the text) over the result. Uncertain colours are skipped, or drawn as
 * `substitute` (with their alpha). Returns an opaque {r,g,b}.
 */
export function flatten(paints, text, { substitute = null, covers = [] } = {}) {
  const stack = [{ r: 255, g: 255, b: 255, a: 1 }];
  const ops = [];
  for (const P of paints) {
    const o = P.opacity ?? 1;
    if (o < 1) { stack.push({ r: 0, g: 0, b: 0, a: 0 }); ops.push(o); } else ops.push(null);
    for (let c of P.colors || []) {
      if (!c) continue;
      if (c.uncertain) {
        if (!substitute) continue;
        c = { r: substitute.r, g: substitute.g, b: substitute.b, a: (substitute.a ?? 1) * (c.alpha ?? 1) };
      }
      if (c.alts) throw new Error('flatten: expand alternatives first');
      if (c.a > 0) stack[stack.length - 1] = over(stack[stack.length - 1], c);
    }
  }
  if (text && text.a > 0) stack[stack.length - 1] = over(stack[stack.length - 1], text);
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i] === null) continue;
    const grp = stack.pop();
    stack[stack.length - 1] = overGroup(stack[stack.length - 1], grp, ops[i]);
  }
  let out = stack[0];
  for (const c of covers) if (c && !c.uncertain && c.a > 0) out = over(out, c);
  return { r: out.r, g: out.g, b: out.b };
}

const scaleAlpha = (c, o) => {
  if (o === 1) return c;
  if (c.uncertain) return { ...c, alpha: (c.alpha ?? 1) * o };
  if (c.alts) return { alts: c.alts.map((x) => scaleAlpha(x, o)) };
  return { ...c, a: c.a * o };
};

/**
 * Merge the ancestor chain (root -> element: { colors, opacity }) with what elementsFromPoint
 * found below the text. `below` is bottom -> top; an item is { ancestor: chainIndex } or a
 * non-ancestor layer { colors, opacity } (opacity = its own and its ancestors' below the common
 * ancestor). A layer is drawn after the colours of the last ancestor seen below it.
 */
export function assemblePaints(chain, below) {
  const paints = chain.map((n) => ({ colors: [...(n.colors || [])], opacity: n.opacity ?? 1 }));
  let at = 0;
  for (const item of below) {
    if (item.ancestor != null) { at = item.ancestor; continue; }
    for (const c of item.colors || []) paints[at].colors.push(scaleAlpha(c, item.opacity ?? 1));
  }
  return paints;
}

/** Every combination of { alts } choices, as plain paint lists (at most `cap`). */
export function expandAlternatives(paints, cap = 32) {
  let out = [paints.map((p) => ({ ...p, colors: [] }))];
  paints.forEach((p, i) => {
    for (const c of p.colors) {
      const choices = c && c.alts ? c.alts : [c];
      const next = [];
      for (const ps of out) for (const ch of choices) {
        if (next.length >= cap) break;
        const copy = ps.map((q, j) => (j === i ? { ...q, colors: [...q.colors, ch] } : q));
        next.push(copy);
      }
      out = next;
    }
  });
  return out.slice(0, cap);
}

/**
 * Text over an image of unknown colour: `under` = ratio with the image left out (the colour
 * beneath it), `black`/`white` = ratio with the image drawn opaque black / white (the extremes
 * any opaque image can reach). fail-underlying: fails on the colour beneath; fail-any: no opaque
 * image could make it pass; pass: passes whatever the image is; unknown: depends on the image.
 */
export function classifyUncertain({ under, black, white }, required) {
  if (under < required) return 'fail-underlying';
  if (Math.max(black, white) < required) return 'fail-any';
  if (Math.min(black, white) >= required) return 'pass';
  return 'unknown';
}
