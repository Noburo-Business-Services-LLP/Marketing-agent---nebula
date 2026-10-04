// Nebulaa contrast audit: the BODY of an async function, evaluated inside the page.
// Parameters in scope: `route` (string label) and `opts` ({ maxFailures? }).
// Run it with window.__nebulaaAudit(route) (installed by mock-session.js), or wrap it yourself:
// `(async (route, opts) => { ...this file... })('/#/dashboard', {})` on a page served by the
// audit dev server (it imports the maths from /scripts/visual-audit/contrast-math.mjs).
//
// Returns { route, url, viewport, checked, failureCount, failures[], unknown[], gradientText[],
//           disabled[], placeholders[], unparsedColors[], canvasResolvedColors, limits[] }.
// failures (worst first): { selector, text, color, effectiveColor, background, ratio, required,
//           fontSize, fontWeight, kind: text|value|placeholder|svg-text|svg-icon (3:1),
//           failureKind: contrast | image-underlying | image-any, positioned, textClass, bgClass }
//
// How the background is measured (see contrast-math.mjs for the pure parts, all unit tested):
// - The element is scrolled into view and its own text box is sampled at 5 points (centre and
//   4 inset corners). At each point document.elementsFromPoint gives the real paint stack
//   (pointer-events is forced to auto for the duration so decorative layers are seen).
// - Everything below the text is drawn root -> element over a white canvas: ancestors'
//   background colours and gradient layers, and non-ancestor layers (positioned overlays,
//   cards, SVG shapes) in the order they are painted, `opacity` as a group over the real
//   backdrop. Linear gradients are sampled at the point; radial/conic at each stop (worst kept).
// - Non-descendant layers ABOVE the text are drawn over both text and background (covers). If an
//   opaque one hides the text at every point, the element is UNKNOWN ("covered").
// - Images of unknown colour (url()/unsupported background layers, img/video/canvas/picture/
//   iframe/object/embed below the text) are measured three ways: left out (the colour beneath),
//   as opaque black and as opaque white. Failing on the colour beneath -> failure
//   (failureKind image-underlying); failing even at both extremes -> failure (image-any);
//   passing at both extremes -> pass; otherwise UNKNOWN (depends on the image).
// - If no sample point hits the element (clipped by overflow, scrolled away), it is UNKNOWN.
// Text colour = computed `color` (or -webkit-text-fill-color), SVG text = computed `fill` x
// fill-opacity; colours the parser does not know (oklch, lab, color-mix...) are resolved through
// a 1x1 canvas; anything still unresolved goes to `unparsedColors` (gated, never dropped).
// Text painted with background-clip:text, or an SVG fill of url(#gradient), goes to
// `gradientText` (gated). Transparent text is UNKNOWN.
// Skipped: display:none / visibility:hidden / opacity:0, boxes <= 1px (sr-only), aria-hidden
// subtrees, elements with no own text, elements wholly off-screen left/right (closed drawers).
// Disabled controls go to `disabled` (WCAG exempts them), not to failures.
const M = await import('/scripts/visual-audit/contrast-math.mjs');
const MAX = (opts && opts.maxFailures) || 400;

const fmt = (c) => {
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a !== undefined && c.a < 0.999 ? `${base} @${Math.round(c.a * 100)}%` : base;
};

// ---- colours ----------------------------------------------------------------------------------
const cv = document.createElement('canvas');
cv.width = cv.height = 1;
const cx = cv.getContext('2d', { willReadFrequently: true });
let canvasResolved = 0;
function resolveColor(str) {
  const p = M.parseColor(str);
  if (p) return p;
  if (!str || !cx) return null;
  cx.fillStyle = 'rgba(1, 2, 3, 0.5)';
  const before = cx.fillStyle;
  cx.fillStyle = str;
  if (cx.fillStyle === before && !/rgba\(1, 2, 3, 0\.5\)/.test(str)) return null;
  cx.clearRect(0, 0, 1, 1);
  cx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
  canvasResolved++;
  return { r, g, b, a: a / 255 };
}

// ---- small DOM helpers ------------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
const isSvg = (n) => n.namespaceURI === SVG_NS;
const styleCache = new Map();
const cs = (n) => { let s = styleCache.get(n); if (!s) { s = getComputedStyle(n); styleCache.set(n, s); } return s; };
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
const isTextColorClass = (c) => { const b = c.split(':').pop(); return /^(text-|placeholder-|fill-)/.test(b) && !NON_COLOR_TEXT.test(b); };
const isBgClass = (c) => { const b = c.split(':').pop(); return /^(bg-|from-|via-|to-)/.test(b) && !/^bg-(clip|cover|contain|center|no-repeat|fixed|gradient|origin|none|left|right|top|bottom|blend)/.test(b); };
const nearestClass = (el, pred) => {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const hit = classList(n).filter(pred);
    if (hit.length) return hit.join(' ');
  }
  return '';
};
const vw = window.innerWidth;
const vh = window.innerHeight;
function visible(el) {
  if (el.closest('[aria-hidden="true"]')) return false;
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 1 || r.height <= 1) return false;
  if (r.right <= 0 || r.left >= vw) return false;
  const s = cs(el);
  if (s.visibility !== 'visible' || parseFloat(s.fontSize) === 0) return false;
  return true;
}
function ownTextNodes(el) { return [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim()); }
function textBox(el, isField) {
  if (!isField && !isSvg(el)) {
    const nodes = ownTextNodes(el);
    if (nodes.length) {
      const r = document.createRange();
      r.setStart(nodes[0], 0);
      r.setEnd(nodes[nodes.length - 1], nodes[nodes.length - 1].length);
      const b = r.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) return b;
    }
  }
  return el.getBoundingClientRect();
}
function samplePoints(b, isField) {
  if (isField) {
    const y = b.top + b.height / 2;
    return [{ x: b.left + b.width / 2, y }, { x: b.left + b.width * 0.2, y }, { x: b.left + b.width * 0.8, y }];
  }
  const i = Math.min(2, b.width / 4, b.height / 4);
  return [
    { x: b.left + b.width / 2, y: b.top + b.height / 2 },
    { x: b.left + i, y: b.top + i }, { x: b.right - i, y: b.top + i },
    { x: b.left + i, y: b.bottom - i }, { x: b.right - i, y: b.bottom - i },
  ].filter((p) => p.x >= 0 && p.y >= 0 && p.x < vw && p.y < vh);
}

// ---- what one element paints (bottom -> top), at a point --------------------------------------
const MEDIA = /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|OBJECT|EMBED)$/;
const SHAPES = /^(rect|circle|ellipse|path|polygon|polyline)$/;
function paintsOf(n, pt) {
  const s = cs(n);
  if (isSvg(n) && n.tagName.toLowerCase() !== 'svg') {
    if (!SHAPES.test(n.tagName.toLowerCase())) return [];
    if (!s.fill || s.fill === 'none') return [];
    const f = resolveColor(s.fill);
    const fo = parseFloat(s.fillOpacity);
    if (!f) return [{ uncertain: true, kind: 'svg-fill', alpha: Number.isFinite(fo) ? fo : 1 }];
    return [{ ...f, a: f.a * (Number.isFinite(fo) ? fo : 1) }];
  }
  const out = [];
  const bg = resolveColor(s.backgroundColor);
  if (bg && bg.a > 0) out.push(bg);
  const clipText = `${s.backgroundClip} ${s.webkitBackgroundClip || ''}`.includes('text');
  if (!clipText && s.backgroundImage && s.backgroundImage !== 'none') {
    const rect = n.getBoundingClientRect();
    for (const L of [...M.parseBackgroundImage(s.backgroundImage)].reverse()) {
      if (L.type === 'linear') out.push(M.gradientColorAt(L, M.gradientT(L.angle, rect, pt)));
      else if (L.type === 'other') { if (L.stops.length) out.push({ alts: L.stops.map((x) => x.color) }); }
      else out.push({ uncertain: true, kind: 'background-image', alpha: 1, raw: L.raw });
    }
  }
  if (MEDIA.test(n.tagName)) out.push({ uncertain: true, kind: n.tagName.toLowerCase(), alpha: 1 });
  return out;
}
const opacityOf = (n) => { const o = parseFloat(cs(n).opacity); return Number.isFinite(o) ? o : 1; };
// Product of opacities of n and its ancestors that are not ancestors of el.
function privateOpacity(n, el) {
  let o = 1;
  for (let x = n; x && !x.contains(el); x = x.parentElement) o *= opacityOf(x);
  return o;
}

// Evaluate one text element. Returns { status: 'ok', ratio, fg, bg, failureKind, positioned }
// or { status: 'unknown', reason, detail }.
function measure(el, hitTarget, chain, textColor, required, isField) {
  let b = textBox(el, isField);
  let scrolled = false;
  const scrollTo = () => { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); b = textBox(el, isField); scrolled = true; };
  if (b.top < 0 || b.bottom > vh || b.left < 0 || b.right > vw) scrollTo();
  // Text clipped by a scroll container (e.g. the sidebar nav) is in the viewport but not hittable
  // until its container scrolls: try once more after scrollIntoView.
  if (!scrolled && !samplePoints(b, isField).some((pt) => document.elementsFromPoint(pt.x, pt.y).includes(hitTarget))) scrollTo();
  const chainIndex = new Map(chain.map((n, i) => [n, i]));
  let worst = null;
  let covered = 0;
  let hit = 0;
  let positioned = false;
  let unknownDetail = null;
  for (const pt of samplePoints(b, isField)) {
    const stack = document.elementsFromPoint(pt.x, pt.y);
    const idx = stack.indexOf(hitTarget);
    if (idx < 0) continue;
    hit++;
    // Above the text: anything that is not the text element's own content.
    const covers = [];
    let hidden = false;
    for (const n of stack.slice(0, idx)) {
      if (hitTarget.contains(n)) continue;
      const o = privateOpacity(n, hitTarget);
      for (const c of paintsOf(n, pt)) {
        if (c.uncertain) { if ((c.alpha ?? 1) * o > 0) hidden = true; continue; }
        const cc = c.alts ? c.alts[0] : c;
        const a = cc.a * o;
        if (a >= 0.999) hidden = true;
        else if (a > 0) covers.push({ ...cc, a });
      }
    }
    if (hidden) { covered++; continue; }
    // Below the text, bottom -> top.
    const below = [];
    for (const n of stack.slice(idx + 1).reverse()) {
      if (chainIndex.has(n)) { below.push({ ancestor: chainIndex.get(n) }); continue; }
      if (n.contains(hitTarget)) continue;
      const colors = paintsOf(n, pt);
      if (!colors.length) continue;
      positioned = true;
      below.push({ colors, opacity: privateOpacity(n, hitTarget) });
    }
    const chainPaints = chain.map((n) => ({ colors: paintsOf(n, pt), opacity: opacityOf(n) }));
    const paints = M.assemblePaints(chainPaints, below);
    for (const ps of M.expandAlternatives(paints, 32)) {
      const uncertain = ps.some((p) => p.colors.some((c) => c.uncertain));
      const evalWith = (substitute) => {
        const bg = M.flatten(ps, null, { substitute, covers });
        const fg = M.flatten(ps, textColor, { substitute, covers });
        return { ratio: M.ratio(fg, bg), fg, bg };
      };
      const under = evalWith(null);
      let res = { ...under, failureKind: 'contrast', verdict: under.ratio < required ? 'fail' : 'pass' };
      if (uncertain) {
        const black = evalWith({ r: 0, g: 0, b: 0, a: 1 });
        const white = evalWith({ r: 255, g: 255, b: 255, a: 1 });
        const v = M.classifyUncertain({ under: under.ratio, black: black.ratio, white: white.ratio }, required);
        if (v === 'fail-underlying') res = { ...under, failureKind: 'image-underlying', verdict: 'fail' };
        else if (v === 'fail-any') { const w = black.ratio > white.ratio ? black : white; res = { ...w, failureKind: 'image-any', verdict: 'fail' }; }
        else if (v === 'unknown') {
          res = { ...under, verdict: 'unknown' };
          const kinds = ps.flatMap((p) => p.colors.filter((c) => c.uncertain).map((c) => c.kind));
          unknownDetail = unknownDetail || { reason: 'over ' + [...new Set(kinds)].join('+'), black: Math.round(black.ratio * 100) / 100, white: Math.round(white.ratio * 100) / 100 };
        } else res = { ...under, failureKind: 'contrast', verdict: 'pass' };
      }
      const rank = (r) => (r.verdict === 'fail' ? 0 : r.verdict === 'unknown' ? 1 : 2);
      if (!worst || rank(res) < rank(worst) || (rank(res) === rank(worst) && res.ratio < worst.ratio)) worst = res;
    }
  }
  if (!hit) return { status: 'unknown', reason: 'not hit-testable (clipped or off-screen)' };
  if (!worst) return { status: 'unknown', reason: `covered at every sample point (${covered})` };
  if (worst.verdict === 'unknown') return { status: 'unknown', ...unknownDetail, ratioUnder: Math.round(worst.ratio * 100) / 100 };
  return { status: 'ok', ...worst, positioned };
}

const res = {
  route, url: location.href, viewport: { w: window.innerWidth, h: window.innerHeight }, at: new Date().toISOString(),
  checked: 0, failureCount: 0, failures: [], unknown: [], gradientText: [], disabled: [], placeholders: [], unparsedColors: [],
  canvasResolvedColors: 0,
  limits: [
    'Paint stack from document.elementsFromPoint at 5 points of the text box (pointer-events forced on); stacking quirks such as mix-blend-mode, filters, backdrop-filter, box-shadows, masks and clip-path are not modelled.',
    'Pseudo-element backgrounds (::before/::after) are not in the hit-test stack, and pseudo-element `content` text is not checked.',
    'Text of `display: contents` elements is attributed to the element but sampled through its text range; SVG strokes and text-shadow are ignored.',
    'Linear gradients are sampled at each point; radial/conic gradients at each colour stop (worst kept).',
    'Images of unknown colour are tested as absent, black and white (see failureKind/unknown).',
    'Only the current state of the page is audited (no modals, hover or focus states); click-only states are covered by the /__layer-fixtures page.',
    'SVG icons: only stand-alone, single-colour, 10-64px <svg> icons are checked (3:1); multi-colour/gradient logos, illustrations, charts, <img>/CSS/font icons are not. Icons over images of unknown colour go to iconUnknown (not gated).',
  ],
};

const isDisabled = (el) => !!el.closest(':disabled, [aria-disabled="true"]');
const peStyle = document.createElement('style');
peStyle.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
document.head.appendChild(peStyle);
const scrollX0 = window.scrollX;
const scrollY0 = window.scrollY;
try {
  for (const el of document.body.querySelectorAll('*')) {
    const tag = el.tagName.toUpperCase();
    const svg = isSvg(el);
    if (svg) { if (!/^(TEXT|TSPAN|TEXTPATH)$/.test(tag)) continue; }
    else if (el.closest('svg') && !el.closest('foreignObject')) continue;
    else if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OPTION|OPTGROUP|HEAD|META|LINK|IMG|VIDEO|CANVAS)$/.test(tag)) continue;
    const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    let text = '';
    let kind = svg ? 'svg-text' : 'text';
    if (isField) {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (tag === 'INPUT' && /^(hidden|checkbox|radio|range|color|file|image)$/.test(type)) continue;
      if (tag === 'INPUT' && /^(submit|reset|button)$/.test(type)) text = el.value || '';
      else if (tag === 'SELECT') text = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : '';
      else if (el.value) { text = el.value; kind = 'value'; }
      else if (el.placeholder) { text = el.placeholder; kind = 'placeholder'; }
      text = String(text).replace(/\s+/g, ' ').trim();
    } else {
      text = ownTextNodes(el).map((n) => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
    }
    if (!text || !visible(el)) continue;

    const s = cs(el);
    const sel = selectorOf(el);
    const snippet = text.slice(0, 60);
    let colorStr;
    let textColor;
    if (svg) {
      colorStr = s.fill;
      if (!colorStr || colorStr === 'none' || /url\(/.test(colorStr)) { res.gradientText.push({ selector: sel, text: snippet, fill: colorStr }); continue; }
      textColor = resolveColor(colorStr);
      const fo = parseFloat(s.fillOpacity);
      if (textColor && Number.isFinite(fo)) textColor = { ...textColor, a: textColor.a * fo };
    } else {
      colorStr = kind === 'placeholder' ? getComputedStyle(el, '::placeholder').color : s.color;
      const fill = s.webkitTextFillColor;
      if (kind !== 'placeholder' && fill && fill !== s.color) colorStr = fill;
      const clipText = `${s.backgroundClip} ${s.webkitBackgroundClip || ''}`.includes('text');
      textColor = resolveColor(colorStr);
      if (textColor && textColor.a === 0 && clipText) { res.gradientText.push({ selector: sel, text: snippet, backgroundImage: s.backgroundImage.slice(0, 120) }); continue; }
    }
    if (!textColor) { res.unparsedColors.push({ selector: sel, text: snippet, color: colorStr }); continue; }
    res.checked++;
    if (textColor.a === 0) { res.unknown.push({ selector: sel, text: snippet, color: fmt(textColor), reason: 'transparent text' }); continue; }

    const fontSize = parseFloat(s.fontSize);
    const fontWeight = s.fontWeight;
    const required = M.requiredRatio(fontSize, fontWeight);
    const hitTarget = svg ? (el.closest('text') || el) : el;
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
    const m = measure(el, hitTarget, chain, textColor, required, isField);
    const base = { selector: sel, text: snippet, color: fmt(textColor), kind, fontSize, fontWeight, textClass: nearestClass(el, isTextColorClass) };
    if (m.status === 'unknown') { res.unknown.push({ ...base, reason: m.reason, black: m.black, white: m.white, ratioUnder: m.ratioUnder }); continue; }
    const row = {
      ...base, effectiveColor: fmt(m.fg), background: fmt(m.bg), ratio: Math.round(m.ratio * 100) / 100, required,
      failureKind: m.failureKind, positioned: m.positioned, bgClass: nearestClass(el, isBgClass),
    };
    if (isDisabled(el)) { if (m.verdict === 'fail') res.disabled.push(row); continue; }
    if (kind === 'placeholder') res.placeholders.push(row);
    if (m.verdict === 'fail') { res.failureCount++; if (res.failures.length < MAX) res.failures.push(row); }
  }
  // ---- SVG icons: graphics, WCAG 1.4.11 (3:1 against what is behind them) ----------------------
  // Checked: outermost <svg> elements of icon size (10-64px) that stand alone (their parent has no
  // text of its own - an icon next to a text label is supplementary and skipped), painted in ONE
  // colour (stroke and/or fill, currentColor resolved by the browser). aria-hidden is NOT a reason
  // to skip: decorative-looking platform/brand icons still carry meaning. Not checked (limits):
  // multi-colour and gradient-filled logos, larger illustrations and charts, icons drawn as
  // <img>/CSS backgrounds or icon fonts. Icons over an image of unknown colour go to iconUnknown
  // (reported, not gated) instead of unknown.
  for (const svgEl of document.body.querySelectorAll('svg')) {
    if (svgEl.parentElement && svgEl.parentElement.closest('svg')) continue;
    const r = svgEl.getBoundingClientRect();
    if (r.width < 10 || r.height < 10 || r.width > 64 || r.height > 64) continue;
    if (r.right <= 0 || r.left >= vw) continue;
    if (typeof svgEl.checkVisibility === 'function' && !svgEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    if (cs(svgEl).visibility !== 'visible') continue;
    const host = svgEl.parentElement;
    if (host && [...host.childNodes].some((n) => (n.nodeType === 3 && n.nodeValue.trim()) || (n.nodeType === 1 && n !== svgEl && (n.innerText || '').trim()))) continue;
    const shapes = [...svgEl.querySelectorAll('path, circle, rect, ellipse, line, polyline, polygon')];
    let col = null; const seen = new Set(); let skip = false;
    for (const sh of shapes) {
      const st = cs(sh);
      if (st.display === 'none' || st.visibility !== 'visible') continue;
      for (const [prop, op] of [['stroke', 'strokeOpacity'], ['fill', 'fillOpacity']]) {
        const v = st[prop];
        if (!v || v === 'none') continue;
        if (/url\(/.test(v)) { skip = true; continue; }
        const c = resolveColor(v);
        if (!c) { skip = true; continue; }
        const o = parseFloat(st[op]);
        const cc = { ...c, a: c.a * (Number.isFinite(o) ? o : 1) };
        if (cc.a === 0) continue;
        seen.add(fmt(cc)); col = col || cc;
      }
    }
    if (skip || !col || seen.size !== 1) continue;
    res.checked++;
    res.iconsChecked = (res.iconsChecked || 0) + 1;
    const sel = selectorOf(svgEl);
    const label = svgEl.getAttribute('aria-label') || (classList(svgEl).find((c) => /^lucide-/.test(c)) || 'svg icon');
    const chain = [];
    for (let n = svgEl; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
    const m = measure(svgEl, svgEl, chain, col, 3, false);
    const base = { selector: sel, text: '[icon] ' + label, color: fmt(col), kind: 'svg-icon', fontSize: r.height, fontWeight: '', textClass: nearestClass(svgEl, isTextColorClass) };
    if (m.status === 'unknown') { (res.iconUnknown = res.iconUnknown || []).push({ ...base, reason: m.reason, black: m.black, white: m.white, ratioUnder: m.ratioUnder }); continue; }
    const row = { ...base, effectiveColor: fmt(m.fg), background: fmt(m.bg), ratio: Math.round(m.ratio * 100) / 100, required: 3, failureKind: m.failureKind, positioned: m.positioned, bgClass: nearestClass(svgEl, isBgClass) };
    if (isDisabled(svgEl)) { if (m.verdict === 'fail') res.disabled.push(row); continue; }
    if (m.verdict === 'fail') { res.failureCount++; if (res.failures.length < MAX) res.failures.push(row); }
  }
} finally {
  peStyle.remove();
  window.scrollTo(scrollX0, scrollY0);
}
res.canvasResolvedColors = canvasResolved;
res.failures.sort((a, b) => a.ratio - b.ratio);
return res;
