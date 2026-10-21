'use strict';
/**
 * Local picture makers for the demo brand: node-canvas only, with the open-licence fonts in backend/assets/fonts.
 * Deterministic (no randomness: the same input always draws the same picture), no network, small files.
 * (sharp is not loaded in the same process: both bundle their own image libraries and warn when loaded together.)
 */
const path = require('path');
const fs = require('fs');
const { PALETTE, FONTS, BRAND } = require('./constants');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
let canvasLib = null;
function lib() {
  if (canvasLib) return canvasLib;
  canvasLib = require('canvas');
  for (const f of [FONTS.display, FONTS.sans]) {
    const file = path.join(FONT_DIR, f.file);
    if (fs.existsSync(file)) canvasLib.registerFont(file, { family: f.family });
  }
  return canvasLib;
}
const DISPLAY = `"${FONTS.display.family}", serif`;
const SANS = `"${FONTS.sans.family}", sans-serif`;

/** A tiny seeded number source, so "random" leaves fall in the same places every time. */
function seeded(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

function canvasOf(w, h) { const c = lib().createCanvas(w, h); return { c, ctx: c.getContext('2d') }; }
const png = (c) => c.toBuffer('image/png', { compressionLevel: 9 });
const jpg = (c) => c.toBuffer('image/jpeg', { quality: 0.82 });

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function leaf(ctx, x, y, len, angle, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.28, len, 0); ctx.quadraticCurveTo(len * 0.5, len * 0.28, 0, 0);
  ctx.fill(); ctx.restore();
}

function scatterLeaves(ctx, w, h, key, color, count = 9) {
  const r = seeded(key);
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < count; i += 1) {
    const edge = i % 2 === 0;
    const x = edge ? r() * w * 0.25 : w - r() * w * 0.25;
    leaf(ctx, x, r() * h, w * (0.08 + r() * 0.07), r() * Math.PI * 2, color);
  }
  ctx.globalAlpha = 1;
}

/** The crescent mark ("nila" is the moon) used by the logo and the labels. */
function crescent(ctx, cx, cy, r, color, cutColor) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = cutColor; ctx.beginPath(); ctx.arc(cx + r * 0.38, cy - r * 0.18, r * 0.86, 0, Math.PI * 2); ctx.fill();
}

function fitText(ctx, text, maxW, size, family) {
  let s = size;
  do { ctx.font = `${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 10);
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/); const lines = []; let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** The brand logo: a plum disc with a rose-gold crescent, the word mark below. Transparent PNG, square. */
function logoPng(size = 512) {
  const { c, ctx } = canvasOf(size, size);
  const cx = size / 2;
  ctx.fillStyle = PALETTE.plum; ctx.beginPath(); ctx.arc(cx, cx, size * 0.48, 0, Math.PI * 2); ctx.fill();
  crescent(ctx, cx, size * 0.36, size * 0.13, PALETTE.roseGold, PALETTE.plum);
  leaf(ctx, cx - size * 0.02, size * 0.47, size * 0.11, -2.6, PALETTE.sage);
  leaf(ctx, cx + size * 0.02, size * 0.47, size * 0.11, -0.54, PALETTE.sage);
  ctx.fillStyle = PALETTE.cream; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `${Math.round(size * 0.17)}px ${DISPLAY}`;
  ctx.fillText('Zaya', cx, size * 0.7);
  ctx.fillStyle = PALETTE.roseGold; ctx.font = `${Math.round(size * 0.05)}px ${SANS}`;
  const spaced = 'N A T U R A L S';
  ctx.fillText(spaced, cx, size * 0.79);
  return png(c);
}

/** One product container, drawn in the middle of the canvas at the given height. */
function drawContainer(ctx, product, cx, baseY, h) {
  const { shape, body, label } = product.look;
  const w = shape === 'jar' ? h * 0.9 : shape === 'tube' ? h * 0.36 : shape === 'trio' ? h * 0.22 : h * 0.4;
  const drawLabel = (x, y, lw, lh) => {
    ctx.fillStyle = label; roundRect(ctx, x, y, lw, lh, Math.min(lw, lh) * 0.08); ctx.fill();
    crescent(ctx, x + lw / 2, y + lh * 0.24, Math.min(lw, lh) * 0.09, PALETTE.roseGold, label);
    ctx.fillStyle = label === PALETTE.plum ? PALETTE.cream : PALETTE.plum; ctx.textAlign = 'center';
    fitText(ctx, 'Zaya', lw * 0.8, Math.round(lh * 0.16), DISPLAY); ctx.fillText('Zaya', x + lw / 2, y + lh * 0.55);
    const words = product.name.split(' ').filter((w) => w.toLowerCase() !== 'and').slice(0, 2).join(' ');
    fitText(ctx, words.toUpperCase(), lw * 0.86, Math.round(lh * 0.075), SANS); ctx.fillText(words.toUpperCase(), x + lw / 2, y + lh * 0.72);
    fitText(ctx, product.size, lw * 0.6, Math.round(lh * 0.065), SANS); ctx.fillText(product.size, x + lw / 2, y + lh * 0.86);
  };
  ctx.save();
  ctx.shadowColor = 'rgba(59,31,58,0.28)'; ctx.shadowBlur = h * 0.08; ctx.shadowOffsetY = h * 0.03;
  if (shape === 'trio') {
    for (let i = -1; i <= 1; i += 1) {
      const x = cx + i * w * 1.3 - w / 2; const th = h * 0.62;
      ctx.fillStyle = ['#D9A88A', PALETTE.roseGold, '#8E2F4F'][i + 1]; roundRect(ctx, x, baseY - th, w, th * 0.78, w * 0.2); ctx.fill();
      ctx.fillStyle = PALETTE.plum; roundRect(ctx, x, baseY - th * 0.24, w, th * 0.24, w * 0.12); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = PALETTE.plum; ctx.textAlign = 'center'; ctx.font = `${Math.round(h * 0.06)}px ${SANS}`;
    ctx.fillText('BARE  .  ROSE  .  BEET', cx, baseY + h * 0.1);
    return;
  }
  ctx.fillStyle = body;
  if (shape === 'jar') {
    roundRect(ctx, cx - w / 2, baseY - h * 0.55, w, h * 0.55, w * 0.1); ctx.fill();
    ctx.fillStyle = PALETTE.roseGold; roundRect(ctx, cx - w * 0.52, baseY - h * 0.72, w * 1.04, h * 0.2, w * 0.06); ctx.fill();
    ctx.restore(); drawLabel(cx - w * 0.36, baseY - h * 0.47, w * 0.72, h * 0.4);
    return;
  }
  if (shape === 'tube') {
    ctx.beginPath(); ctx.moveTo(cx - w * 0.5, baseY - h); ctx.lineTo(cx + w * 0.5, baseY - h);
    ctx.lineTo(cx + w * 0.42, baseY - h * 0.16); ctx.lineTo(cx - w * 0.42, baseY - h * 0.16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PALETTE.plum; roundRect(ctx, cx - w * 0.3, baseY - h * 0.17, w * 0.6, h * 0.17, w * 0.08); ctx.fill();
    ctx.restore(); drawLabel(cx - w * 0.36, baseY - h * 0.86, w * 0.72, h * 0.5);
    return;
  }
  // dropper, mist and bottle: a tall bottle with a neck and a cap
  const bh = h * 0.68;
  roundRect(ctx, cx - w / 2, baseY - bh, w, bh, w * 0.16); ctx.fill();
  ctx.fillRect(cx - w * 0.17, baseY - bh - h * 0.06, w * 0.34, h * 0.08);
  ctx.fillStyle = shape === 'mist' ? PALETTE.cream : PALETTE.plum;
  if (shape === 'dropper') { roundRect(ctx, cx - w * 0.2, baseY - h, w * 0.4, h * 0.27, w * 0.14); ctx.fill(); }
  else { roundRect(ctx, cx - w * 0.22, baseY - bh - h * 0.2, w * 0.44, h * 0.16, w * 0.06); ctx.fill(); }
  ctx.restore(); drawLabel(cx - w * 0.38, baseY - bh * 0.82, w * 0.76, bh * 0.62);
}

const BACKDROPS = [
  { bg: PALETTE.cream, accent: PALETTE.sage, floor: '#EFE2D3' },
  { bg: '#EAD3CB', accent: PALETTE.plum, floor: '#DDBDB2' },
  { bg: '#DCE4D3', accent: PALETTE.roseGold, floor: '#C9D5BD' },
];

/** A product packshot: the container on a brand-colour backdrop. variant 0, 1 or 2. Square JPEG. */
function packshotJpg(product, variant = 0, size = 800) {
  const b = BACKDROPS[variant % BACKDROPS.length];
  const { c, ctx } = canvasOf(size, size);
  ctx.fillStyle = b.bg; ctx.fillRect(0, 0, size, size);
  scatterLeaves(ctx, size, size, `${product.slug}-${variant}`, b.accent, 7 + variant * 2);
  ctx.fillStyle = b.floor; ctx.beginPath(); ctx.ellipse(size / 2, size * 0.8, size * 0.36, size * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  if (variant === 2) {
    // ingredient circles, flat-lay style
    const r = seeded(product.slug);
    product.ingredients.slice(0, 4).forEach((ing, i) => {
      const x = size * (0.18 + 0.64 * (i % 2)); const y = size * (0.2 + 0.18 * Math.floor(i / 2)) + r() * 10;
      ctx.fillStyle = 'rgba(251,243,234,0.9)'; ctx.beginPath(); ctx.arc(x, y, size * 0.075, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PALETTE.plum; ctx.textAlign = 'center'; fitText(ctx, ing.split(' ')[0], size * 0.13, Math.round(size * 0.026), SANS);
      ctx.fillText(ing.split(' ')[0], x, y + size * 0.009);
    });
  }
  drawContainer(ctx, product, size / 2, size * 0.8, size * 0.56);
  return jpg(c);
}

/** A simple post poster: product, headline and brand line. 4:5 JPEG (1080 x 1350 by default). */
function posterJpg(product, headline, { width = 1080, height = 1350 } = {}) {
  const { c, ctx } = canvasOf(width, height);
  ctx.fillStyle = PALETTE.plum; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = PALETTE.cream; roundRect(ctx, width * 0.06, height * 0.36, width * 0.88, height * 0.58, width * 0.04); ctx.fill();
  scatterLeaves(ctx, width, height * 0.36, `${product.slug}-poster`, PALETTE.sage, 6);
  ctx.fillStyle = PALETTE.cream; ctx.textAlign = 'left'; ctx.font = `${Math.round(width * 0.075)}px ${DISPLAY}`;
  const lines = wrap(ctx, headline, width * 0.84).slice(0, 3);
  lines.forEach((l, i) => ctx.fillText(l, width * 0.08, height * 0.12 + i * width * 0.085));
  drawContainer(ctx, product, width / 2, height * 0.88, height * 0.42);
  ctx.fillStyle = PALETTE.roseGold; ctx.font = `${Math.round(width * 0.03)}px ${SANS}`; ctx.textAlign = 'center';
  ctx.fillText(`${BRAND.name.toUpperCase()}  .  ${product.name}`, width / 2, height * 0.975);
  return jpg(c);
}

/** A simple illustrated person for Brand assets (not a photo). 4:5 JPEG. */
function portraitJpg(character, { width = 640, height = 800 } = {}) {
  const { c, ctx } = canvasOf(width, height);
  ctx.fillStyle = PALETTE.cream; ctx.fillRect(0, 0, width, height);
  scatterLeaves(ctx, width, height, character.slug, PALETTE.sage, 8);
  const cx = width / 2;
  ctx.fillStyle = character.outfit; ctx.beginPath(); ctx.ellipse(cx, height * 0.95, width * 0.36, height * 0.3, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = character.tone; ctx.fillRect(cx - width * 0.06, height * 0.5, width * 0.12, height * 0.12);
  const male = /karthik/i.test(character.slug);
  ctx.fillStyle = '#2A1A1A';
  if (!male) {
    ctx.beginPath(); ctx.ellipse(cx, height * 0.37, width * 0.19, height * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    roundRect(ctx, cx - width * 0.19, height * 0.37, width * 0.38, height * 0.25, width * 0.05); ctx.fill();
  }
  ctx.fillStyle = character.tone; ctx.beginPath(); ctx.ellipse(cx, height * 0.4, width * 0.14, height * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2A1A1A'; ctx.beginPath(); ctx.ellipse(cx, height * 0.3, width * 0.15, height * 0.07, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = PALETTE.plum; ctx.textAlign = 'center'; fitText(ctx, character.name, width * 0.9, Math.round(width * 0.06), DISPLAY);
  ctx.fillText(character.name, cx, height * 0.08);
  return jpg(c);
}

/** A simple illustrated place: the studio or the shelf with the products on it. 16:10 JPEG. */
function placeJpg(place, products = [], { width = 960, height = 600 } = {}) {
  const { c, ctx } = canvasOf(width, height);
  ctx.fillStyle = place.kind === 'studio' ? '#F3E6D8' : PALETTE.cream; ctx.fillRect(0, 0, width, height);
  if (place.kind === 'studio') {
    ctx.fillStyle = '#CFE0EA'; roundRect(ctx, width * 0.62, height * 0.1, width * 0.3, height * 0.45, 12); ctx.fill();
    ctx.strokeStyle = PALETTE.plum; ctx.lineWidth = 6; ctx.strokeRect(width * 0.62, height * 0.1, width * 0.3, height * 0.45);
    ctx.fillStyle = '#B98A62'; ctx.fillRect(width * 0.05, height * 0.66, width * 0.9, height * 0.06);
    ctx.fillRect(width * 0.1, height * 0.72, width * 0.03, height * 0.28); ctx.fillRect(width * 0.87, height * 0.72, width * 0.03, height * 0.28);
    ctx.fillStyle = '#B5823B'; ctx.beginPath(); ctx.ellipse(width * 0.3, height * 0.6, width * 0.1, height * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    scatterLeaves(ctx, width, height * 0.6, place.slug, PALETTE.sage, 6);
  } else {
    for (let row = 0; row < 2; row += 1) {
      const y = height * (0.48 + row * 0.42);
      ctx.fillStyle = '#B98A62'; ctx.fillRect(width * 0.04, y, width * 0.92, height * 0.035);
      products.slice(row * 4, row * 4 + 4).forEach((p, i) => drawContainer(ctx, p, width * (0.16 + i * 0.226), y, height * 0.34));
    }
  }
  ctx.fillStyle = PALETTE.plum; ctx.textAlign = 'left'; ctx.font = `${Math.round(height * 0.06)}px ${DISPLAY}`;
  ctx.fillText(place.name, width * 0.05, height * 0.1);
  return jpg(c);
}

/** Width and height of a PNG or JPEG buffer (no image library needed). */
function imageSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

/** A calendar cover: the month in large type on a brand-colour backdrop with the theme below. 1200 x 800 JPEG. */
function calendarCoverJpg(monthName, theme, variant = 0, { width = 1200, height = 800 } = {}) {
  const schemes = [[PALETTE.plum, PALETTE.cream, PALETTE.roseGold], [PALETTE.cream, PALETTE.plum, PALETTE.sage], [PALETTE.roseGold, PALETTE.cream, PALETTE.plum], [PALETTE.sage, PALETTE.plum, PALETTE.cream], [PALETTE.plum, PALETTE.roseGold, PALETTE.cream]];
  const [bg, fg, accent] = schemes[variant % schemes.length];
  const { c, ctx } = canvasOf(width, height);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  scatterLeaves(ctx, width, height, `cover-${monthName}-${variant}`, accent, 10);
  ctx.fillStyle = fg; ctx.textAlign = 'left';
  fitText(ctx, monthName, width * 0.84, Math.round(width * 0.17), DISPLAY);
  ctx.fillText(monthName, width * 0.08, height * 0.5);
  ctx.fillStyle = accent; ctx.font = `${Math.round(width * 0.03)}px ${SANS}`;
  wrap(ctx, theme, width * 0.8).slice(0, 2).forEach((l, i) => ctx.fillText(l, width * 0.08, height * 0.64 + i * width * 0.04));
  ctx.fillStyle = fg; ctx.font = `${Math.round(width * 0.022)}px ${SANS}`;
  ctx.fillText(BRAND.name.toUpperCase(), width * 0.08, height * 0.92);
  return jpg(c);
}

/** One page of the designed Blueprint: title, purpose and a few short lines on cream. A4 proportions (794 x 1123). */
function deckPageJpg(page, index, { width = 794, height = 1123 } = {}) {
  const { c, ctx } = canvasOf(width, height);
  const cover = page.kind === 'cover';
  ctx.fillStyle = cover ? PALETTE.plum : PALETTE.cream; ctx.fillRect(0, 0, width, height);
  scatterLeaves(ctx, width, height * 0.3, `deck-${index}`, cover ? PALETTE.roseGold : PALETTE.sage, 6);
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.roseGold; ctx.font = `${Math.round(width * 0.02)}px ${SANS}`;
  ctx.fillText(String(page.kicker || '').toUpperCase().slice(0, 64), width * 0.08, height * 0.13);
  ctx.fillStyle = cover ? PALETTE.cream : PALETTE.plum; ctx.font = `${Math.round(width * 0.075)}px ${DISPLAY}`;
  wrap(ctx, page.title || '', width * 0.84).slice(0, 3).forEach((l, i) => ctx.fillText(l, width * 0.08, height * 0.2 + i * width * 0.09));
  ctx.font = `${Math.round(width * 0.03)}px ${SANS}`;
  let y = height * 0.42;
  for (const line of (page.lines || []).slice(0, 7)) {
    ctx.fillStyle = PALETTE.roseGold; ctx.beginPath(); ctx.arc(width * 0.09, y - width * 0.01, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cover ? PALETTE.cream : PALETTE.plum;
    const ls = wrap(ctx, line, width * 0.78).slice(0, 3);
    ls.forEach((l, i) => ctx.fillText(l, width * 0.12, y + i * width * 0.04));
    y += Math.max(1, ls.length) * width * 0.04 + width * 0.03;
  }
  ctx.fillStyle = PALETTE.roseGold; ctx.font = `${Math.round(width * 0.022)}px ${SANS}`;
  ctx.fillText(`${BRAND.name.toUpperCase()}  .  BRAND GROWTH BLUEPRINT`, width * 0.08, height * 0.95);
  return jpg(c);
}

module.exports = {
  logoPng, packshotJpg, posterJpg, portraitJpg, placeJpg, calendarCoverJpg, deckPageJpg, imageSize, seeded,
  // drawing helpers, shared with images3.js (Stage 3 pictures)
  canvasOf, jpg, png, roundRect, leaf, scatterLeaves, fitText, wrap, drawContainer, crescent, DISPLAY, SANS
};
