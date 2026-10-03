// Nebulaa contrast audit: the BODY of an async function, evaluated inside the page.
// Parameters in scope: `route` (string label) and `opts` ({ maxFailures? }).
// Run it with window.__nebulaaAudit(route) (installed by mock-session.js), or wrap it yourself:
// `(async (route, opts) => { ...this file... })('/#/dashboard', {})` on a page served by the
// audit dev server (it imports the maths from /scripts/visual-audit/contrast-math.mjs).
//
// Returns { route, url, viewport, checked, failureCount, failures[], unknown[], gradientText[],
//           disabled[], placeholders[], unparsedColors[], limits[] }.
// failures (worst first): { selector, text, color, effectiveColor, background, ratio, required,
//           fontSize, fontWeight, kind: text|value|placeholder, bgSource: solid|gradient,
//           textClass, bgClass }
//
// How the background is found:
// - The element's ancestors are drawn root -> element over a white canvas: each background-color
//   (alpha composited), each background-image gradient layer, and `opacity` as a group.
// - Linear gradients are sampled where the text sits (centre and two corners of the text box,
//   worst one kept). Radial/conic gradients use their worst colour stop.
// - Only what is painted above the nearest opaque ancestor matters. If a url() background image,
//   or an <img>/<video>/<canvas>/<picture> that covers most of the text box, is painted inside
//   that ancestor, the background is "unknown" (listed in `unknown`, not failed).
// Text colour = computed `color` (or -webkit-text-fill-color), alpha composited. Text painted
// with background-clip:text goes to `gradientText`.
// Skipped: display:none / visibility:hidden / opacity:0, boxes <= 1px (sr-only), aria-hidden
// subtrees, elements with no own text, elements wholly off-screen to the left/right (closed
// drawers), SVG text. Disabled controls go to `disabled` (WCAG exempts them), not to failures.
// Inputs: the value is checked; an empty field's placeholder is checked with
// getComputedStyle(el, '::placeholder') (Chromium) and failing ones are in `failures` too.
const M = await import('/scripts/visual-audit/contrast-math.mjs');
const MAX = (opts && opts.maxFailures) || 400;

const fmt = (c) => {
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a !== undefined && c.a < 0.999 ? `${base} @${Math.round(c.a * 100)}%` : base;
};

// Premultiplied "over".
const over = (dst, src) => {
  const a = src.a;
  return { r: src.r * a + dst.r * (1 - a), g: src.g * a + dst.g * (1 - a), b: src.b * a + dst.b * (1 - a), a: a + dst.a * (1 - a) };
};
const overGroup = (dst, grp, o) => {
  const a = grp.a * o;
  return { r: grp.r * o + dst.r * (1 - a), g: grp.g * o + dst.g * (1 - a), b: grp.b * o + dst.b * (1 - a), a: a + dst.a * (1 - a) };
};

// paints: [{ colors: [{r,g,b,a}...] (bottom -> top), opacity }] root -> element.
function flatten(paints, text) {
  const stack = [{ r: 255, g: 255, b: 255, a: 1 }];
  const ops = [];
  for (const P of paints) {
    if (P.opacity < 1) { stack.push({ r: 0, g: 0, b: 0, a: 0 }); ops.push(P.opacity); } else ops.push(null);
    for (const c of P.colors) if (c && c.a > 0) stack[stack.length - 1] = over(stack[stack.length - 1], c);
  }
  if (text) stack[stack.length - 1] = over(stack[stack.length - 1], text);
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i] === null) continue;
    const grp = stack.pop();
    stack[stack.length - 1] = overGroup(stack[stack.length - 1], grp, ops[i]);
  }
  return { r: stack[0].r, g: stack[0].g, b: stack[0].b };
}

const classList = (el) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '')).split(/\s+/).filter(Boolean);
const short = (el) => {
  if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
  return el.tagName.toLowerCase() + classList(el).slice(0, 3).map((c) => '.' + CSS.escape(c)).join('');
};
const selectorOf = (el) => {
  const parts = [];
  let n = el;
  for (let i = 0; n && n !== document.body && i < 4; i++, n = n.parentElement) parts.unshift(short(n));
  return parts.join(' > ');
};
const NON_COLOR_TEXT = /^text-(xs|sm|base|lg|[2-9]?xl|left|right|center|justify|start|end|ellipsis|clip|wrap|nowrap|balance|pretty|\[[\d.]+(px|rem|em)\])$/;
const isTextColorClass = (c) => { const b = c.split(':').pop(); return /^(text-|placeholder-)/.test(b) && !NON_COLOR_TEXT.test(b); };
const isBgClass = (c) => { const b = c.split(':').pop(); return /^(bg-|from-|via-|to-)/.test(b) && !/^bg-(clip|cover|contain|center|no-repeat|fixed|gradient|origin|none|left|right|top|bottom|blend)/.test(b); };
const nearestClass = (el, pred, stop) => {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const hit = classList(n).filter(pred);
    if (hit.length) return hit.join(' ');
    if (n === stop) break;
  }
  return '';
};

const vw = window.innerWidth;
function visible(el) {
  if (el.closest('[aria-hidden="true"]')) return false;
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) return false;
  if (r.right <= 0 || r.left >= vw) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility !== 'visible' || parseFloat(cs.fontSize) === 0) return false;
  return true;
}
function ownText(el) {
  let t = '';
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
  return t.replace(/\s+/g, ' ').trim();
}

// Visible media boxes, computed once.
const media = [...document.querySelectorAll('img, video, canvas, picture, iframe')]
  .map((m) => ({ node: m, rect: m.getBoundingClientRect() }))
  .filter((m) => m.rect.width > 4 && m.rect.height > 4 && getComputedStyle(m.node).visibility === 'visible'
    && (typeof m.node.checkVisibility !== 'function' || m.node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })));
const overlapShare = (a, b) => {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return (w * h) / Math.max(1, a.width * a.height);
};

// Background description for el: { paints(point) -> candidates, unknown, hasGradient, base }.
function background(el, textRect) {
  const chain = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
  const nodes = chain.map((n) => {
    const cs = getComputedStyle(n);
    const clipText = `${cs.backgroundClip} ${cs.webkitBackgroundClip || ''}`.includes('text');
    const layers = clipText ? [] : M.parseBackgroundImage(cs.backgroundImage);
    const opacity = parseFloat(cs.opacity);
    return {
      node: n, color: M.parseColor(cs.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 }, layers,
      opacity: Number.isFinite(opacity) ? opacity : 1, rect: layers.length ? n.getBoundingClientRect() : null,
    };
  });
  let base = 0;
  nodes.forEach((N, i) => { if (N.color.a >= 1) base = i; });
  const relevant = nodes.slice(base);
  const urlLayer = relevant.find((N) => N.layers.some((L) => L.type === 'url'));
  if (urlLayer) return { unknown: { reason: 'background-image', on: short(urlLayer.node), image: urlLayer.layers.find((L) => L.type === 'url').raw } };
  const baseNode = nodes[base].node;
  const textBox = textRect;
  const under = media.find((m) => !el.contains(m.node) && baseNode.contains(m.node) && m.node !== el && overlapShare(textBox, m.rect) > 0.5);
  if (under) return { unknown: { reason: 'over ' + under.node.tagName.toLowerCase(), on: short(under.node), image: (under.node.currentSrc || under.node.src || '').slice(0, 80) } };

  const hasGradient = relevant.some((N) => N.layers.length);
  const points = [
    { x: textBox.left + textBox.width / 2, y: textBox.top + textBox.height / 2 },
    { x: textBox.left + 1, y: textBox.top + 1 },
    { x: textBox.right - 1, y: textBox.bottom - 1 },
  ];
  // Every combination of candidate colours for each point (linear gradients give one colour per
  // point, other gradients one per stop), capped.
  const combos = [];
  for (const p of hasGradient ? points : [points[0]]) {
    let partial = [[]];
    nodes.forEach((N, i) => {
      if (i < base) { partial = partial.map((ps) => ps.concat([{ colors: [], opacity: N.opacity }])); return; }
      let variants = [[N.color]];
      for (const L of [...N.layers].reverse()) { // bottom layer first
        const opts = L.type === 'linear' ? [M.gradientColorAt(L, M.gradientT(L.angle, N.rect, p))] : L.stops.map((s) => s.color);
        const next = [];
        for (const v of variants) for (const o of opts) { if (next.length < 16) next.push(v.concat([o])); }
        variants = next;
      }
      const next = [];
      for (const ps of partial) for (const v of variants) { if (next.length < 64) next.push(ps.concat([{ colors: v, opacity: N.opacity }])); }
      partial = next;
    });
    combos.push(...partial);
  }
  return { combos, hasGradient, baseNode };
}

const res = {
  route, url: location.href, viewport: { w: window.innerWidth, h: window.innerHeight }, at: new Date().toISOString(),
  checked: 0, failureCount: 0, failures: [], unknown: [], gradientText: [], disabled: [], placeholders: [], unparsedColors: [],
  limits: [
    'Backgrounds come from ancestors; a positioned sibling is only noticed when it is an img/video/canvas/picture/iframe covering most of the text box (then "unknown").',
    'Pseudo-element backgrounds (::before/::after), box-shadows, backdrop-filter and mix-blend modes are not considered.',
    'Linear gradients are sampled at the text box centre and corners (worst kept); radial/conic gradients use their worst stop.',
    'SVG text (chart labels) and text inside canvas/images are not checked.',
  ],
};

const isDisabled = (el) => !!el.closest(':disabled, [aria-disabled="true"]');
for (const el of document.body.querySelectorAll('*')) {
  const tag = el.tagName.toUpperCase();
  if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|IFRAME|OPTION|OPTGROUP|HEAD|META|LINK|IMG|VIDEO|CANVAS)$/.test(tag)) continue;
  if (el.closest('svg')) continue;
  const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  let text = '';
  let kind = 'text';
  if (isField) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'INPUT' && /^(hidden|checkbox|radio|range|color|file|image)$/.test(type)) continue;
    if (tag === 'INPUT' && /^(submit|reset|button)$/.test(type)) text = el.value || '';
    else if (tag === 'SELECT') text = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : '';
    else if (el.value) { text = el.value; kind = 'value'; }
    else if (el.placeholder) { text = el.placeholder; kind = 'placeholder'; }
    text = String(text).replace(/\s+/g, ' ').trim();
  } else {
    text = ownText(el);
  }
  if (!text || !visible(el)) continue;

  const cs = getComputedStyle(el);
  let colorStr = kind === 'placeholder' ? getComputedStyle(el, '::placeholder').color : cs.color;
  const fill = cs.webkitTextFillColor;
  if (kind !== 'placeholder' && fill && fill !== cs.color) colorStr = fill;
  const textColor = M.parseColor(colorStr);
  const fontSize = parseFloat(cs.fontSize);
  const fontWeight = cs.fontWeight;
  const sel = selectorOf(el);
  const snippet = text.slice(0, 60);
  const clipText = `${cs.backgroundClip} ${cs.webkitBackgroundClip || ''}`.includes('text');
  if (textColor && textColor.a === 0 && clipText) {
    res.gradientText.push({ selector: sel, text: snippet, backgroundImage: cs.backgroundImage.slice(0, 120) });
    continue;
  }
  if (!textColor) { res.unparsedColors.push({ selector: sel, text: snippet, color: colorStr }); continue; }

  const B = background(el, el.getBoundingClientRect());
  res.checked++;
  if (B.unknown) { res.unknown.push({ selector: sel, text: snippet, color: fmt(textColor), ...B.unknown, textClass: nearestClass(el, isTextColorClass) }); continue; }
  let worst = null;
  for (const paints of B.combos) {
    const bg = flatten(paints, null);
    const fg = flatten(paints, textColor);
    const r = M.ratio(fg, bg);
    if (!worst || r < worst.ratio) worst = { ratio: r, bg, fg };
  }
  const required = M.requiredRatio(fontSize, fontWeight);
  const row = {
    selector: sel, text: snippet, color: fmt(textColor), effectiveColor: fmt(worst.fg), background: fmt(worst.bg),
    ratio: Math.round(worst.ratio * 100) / 100, required, fontSize, fontWeight, kind,
    bgSource: B.hasGradient ? 'gradient' : 'solid',
    textClass: nearestClass(el, isTextColorClass), bgClass: nearestClass(el, isBgClass, B.baseNode),
  };
  if (isDisabled(el)) { if (worst.ratio < required) res.disabled.push(row); continue; }
  if (kind === 'placeholder') res.placeholders.push(row);
  if (worst.ratio < required) { res.failureCount++; if (res.failures.length < MAX) res.failures.push(row); }
}
res.failures.sort((a, b) => a.ratio - b.ratio);
return res;
