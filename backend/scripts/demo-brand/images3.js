'use strict';
/**
 * Stage 3 pictures of the demo brand, drawn on this computer with node-canvas (no network, no model, deterministic):
 * competitor profile pictures and post pictures, Photoshoot photos, and the scenes of the short videos.
 * (sharp is not loaded here: it and node-canvas bundle their own image libraries and warn when loaded together.)
 */
const { PALETTE, BRAND } = require('./constants');
const I = require('./images');

const { canvasOf, jpg, roundRect, leaf, scatterLeaves, fitText, wrap, drawContainer, crescent, DISPLAY, SANS, seeded } = I;

const PHOTO_SIZES = { '1:1': [960, 960], '4:5': [864, 1080], '9:16': [720, 1280], '16:9': [1280, 720] };

/** A generic bottle, jar or tube with no brand text (competitors): shape, colour, a small plain label with initials. */
function drawGenericPack(ctx, kind, color, label, initials, cx, baseY, h) {
  const w = kind === 'jar' ? h * 0.9 : kind === 'tube' ? h * 0.34 : h * 0.4;
  ctx.save();
  ctx.shadowColor = 'rgba(30,20,30,0.25)'; ctx.shadowBlur = h * 0.08; ctx.shadowOffsetY = h * 0.03;
  ctx.fillStyle = color;
  if (kind === 'jar') {
    roundRect(ctx, cx - w / 2, baseY - h * 0.55, w, h * 0.55, w * 0.1); ctx.fill();
    ctx.fillStyle = label; roundRect(ctx, cx - w * 0.52, baseY - h * 0.72, w * 1.04, h * 0.2, w * 0.06); ctx.fill();
  } else if (kind === 'tube') {
    ctx.beginPath(); ctx.moveTo(cx - w * 0.5, baseY - h); ctx.lineTo(cx + w * 0.5, baseY - h);
    ctx.lineTo(cx + w * 0.42, baseY - h * 0.16); ctx.lineTo(cx - w * 0.42, baseY - h * 0.16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = label; roundRect(ctx, cx - w * 0.3, baseY - h * 0.17, w * 0.6, h * 0.17, w * 0.08); ctx.fill();
  } else {
    const bh = h * 0.7;
    roundRect(ctx, cx - w / 2, baseY - bh, w, bh, w * 0.16); ctx.fill();
    ctx.fillStyle = label; roundRect(ctx, cx - w * 0.2, baseY - bh - h * 0.2, w * 0.4, h * 0.2, w * 0.1); ctx.fill();
  }
  ctx.restore();
  const ly = kind === 'jar' ? baseY - h * 0.42 : kind === 'tube' ? baseY - h * 0.7 : baseY - h * 0.5;
  const lw = w * 0.62; const lh = h * 0.2;
  ctx.fillStyle = label; roundRect(ctx, cx - lw / 2, ly, lw, lh, lw * 0.08); ctx.fill();
  ctx.fillStyle = color; ctx.textAlign = 'center'; fitText(ctx, initials, lw * 0.7, Math.round(lh * 0.5), DISPLAY);
  ctx.fillText(initials, cx, ly + lh * 0.65);
}

/** A competitor's profile picture: a coloured tile with their initials. Square JPEG (the page shows it round). */
function competitorAvatarJpg(comp, size = 192) {
  const { c, ctx } = canvasOf(size, size);
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, comp.look.bg); g.addColorStop(1, comp.look.accent);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = comp.look.fg; ctx.textAlign = 'center';
  ctx.font = `${Math.round(size * 0.42)}px ${DISPLAY}`;
  ctx.fillText(comp.initials, size / 2, size * 0.64);
  return jpg(c);
}

/** A competitor's post picture (360 x 450 look, drawn at 540 x 675): their colours, a pack and a short line. */
function competitorPostJpg(comp, post, { width = 540, height = 675 } = {}) {
  const r = seeded(`${comp.slug}-${post.code}`);
  const { c, ctx } = canvasOf(width, height);
  ctx.fillStyle = comp.look.bg; ctx.fillRect(0, 0, width, height);
  scatterLeaves(ctx, width, height, `${comp.slug}-${post.code}`, comp.look.accent, 6);
  ctx.fillStyle = comp.look.soft; ctx.beginPath(); ctx.ellipse(width / 2, height * 0.8, width * 0.32, height * 0.045, 0, 0, Math.PI * 2); ctx.fill();
  drawGenericPack(ctx, post.pack, comp.look.accent, comp.look.fg, comp.initials, width / 2, height * 0.8, height * (0.5 + r() * 0.08));
  ctx.fillStyle = comp.look.fg; ctx.textAlign = 'left'; ctx.font = `${Math.round(width * 0.075)}px ${DISPLAY}`;
  wrap(ctx, post.head, width * 0.84).slice(0, 2).forEach((l, i) => ctx.fillText(l, width * 0.08, height * 0.1 + i * width * 0.09));
  if (post.type === 'video') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(width * 0.88, height * 0.06, width * 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(width * 0.865, height * 0.045); ctx.lineTo(width * 0.865, height * 0.075); ctx.lineTo(width * 0.9, height * 0.06); ctx.closePath(); ctx.fill();
  }
  return jpg(c);
}

/** A soft vertical or diagonal gradient. */
function gradient(ctx, w, h, a, b, diagonal = false) {
  const g = ctx.createLinearGradient(0, 0, diagonal ? w : 0, h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

function glow(ctx, x, y, radius, color, alpha = 0.6) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color.replace('A', String(alpha)));
  g.addColorStop(1, color.replace('A', '0'));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}

function lamp(ctx, x, y, s) {
  ctx.fillStyle = '#B5651D'; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.42, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = '#7A3E10'; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  glow(ctx, x, y - s * 0.7, s * 2.4, 'rgba(255,196,80,A)', 0.55);
  ctx.fillStyle = '#FFD36B'; ctx.beginPath(); ctx.ellipse(x, y - s * 0.55, s * 0.18, s * 0.46, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFF3C4'; ctx.beginPath(); ctx.ellipse(x, y - s * 0.45, s * 0.08, s * 0.24, 0, 0, Math.PI * 2); ctx.fill();
}

function marigold(ctx, x, y, s, key) {
  const r = seeded(key);
  for (let i = 0; i < 12; i += 1) {
    ctx.fillStyle = i % 2 ? '#F2A31B' : '#E98A0C';
    ctx.beginPath(); ctx.arc(x + Math.cos(i / 12 * Math.PI * 2) * s * 0.55, y + Math.sin(i / 12 * Math.PI * 2) * s * 0.55, s * (0.34 + r() * 0.05), 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#C46A00'; ctx.beginPath(); ctx.arc(x, y, s * 0.3, 0, Math.PI * 2); ctx.fill();
}

/**
 * One Photoshoot photo, drawn: the product in the scene the pack asks for. `product` is a constants.js product; `scene`
 * the pack's scene key; `pack` the pack key; `background` a Photoshoot background key (or ''); `place` true for a scene
 * set in the customer's own space.
 */
function photoshootJpg({ product, pack, scene, aspect = '4:5', background = '', place = false }) {
  const [w, h] = PHOTO_SIZES[aspect] || PHOTO_SIZES['4:5'];
  const { c, ctx } = canvasOf(w, h);
  const key = `${product.slug}-${pack}-${scene}`;
  const r = seeded(key);
  const hero = Math.min(h * 0.62, w * 0.95);
  if (pack === 'festival') {
    gradient(ctx, w, h, '#3A1A2E', '#7A2E1F');
    glow(ctx, w * 0.5, h * 0.55, w * 0.75, 'rgba(255,170,60,A)', 0.45);
    for (let i = 0; i < 14; i += 1) { ctx.fillStyle = 'rgba(255,225,150,0.85)'; ctx.beginPath(); ctx.arc(r() * w, r() * h * 0.5, 3 + r() * 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = scene === 'brass' ? '#8E1B3A' : '#5B2415'; ctx.fillRect(0, h * 0.74, w, h * 0.26);
    if (scene === 'flowers' || scene === 'gift') { for (let i = 0; i < 6; i += 1) marigold(ctx, w * (0.1 + 0.16 * i) + r() * 20, h * (0.8 + r() * 0.1), w * 0.07, `${key}-m${i}`); }
    if (scene === 'gift') { ctx.fillStyle = '#C98B7B'; ctx.fillRect(w * 0.1, h * 0.62, w * 0.2, h * 0.14); ctx.fillStyle = '#FBF3EA'; ctx.fillRect(w * 0.19, h * 0.62, w * 0.02, h * 0.14); }
    if (scene === 'brass') { ctx.fillStyle = '#C9A24B'; ctx.beginPath(); ctx.ellipse(w * 0.82, h * 0.78, w * 0.09, h * 0.03, 0, 0, Math.PI); ctx.fill(); }
    const lamps = scene === 'lights' || scene === 'table' || scene === 'glow' ? 4 : 2;
    for (let i = 0; i < lamps; i += 1) lamp(ctx, w * (0.14 + (0.72 / Math.max(1, lamps - 1)) * i), h * (0.84 + (i % 2) * 0.05), w * 0.05);
    if (scene === 'confetti') { for (let i = 0; i < 70; i += 1) { ctx.fillStyle = ['#FFD36B', '#F2A31B', '#FBF3EA'][i % 3]; ctx.fillRect(r() * w, r() * h * 0.75, 4 + r() * 6, 3 + r() * 5); } }
    drawContainer(ctx, product, w / 2, h * 0.78, hero * 0.85);
    return jpg(c);
  }
  if (pack === 'flatlay') {
    const woods = { linen: ['#E9E0CF', '#DCD0BA'], wood: ['#C9A57B', '#B58C5E'], marble: ['#F2F1EF', '#E1DFDC'], pastel: ['#F4DDD6', '#E6C7BE'] };
    const [a, b] = woods[background] || woods.linen;
    gradient(ctx, w, h, a, b, true);
    ctx.strokeStyle = 'rgba(120,100,70,0.12)'; ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 9) { ctx.beginPath(); ctx.moveTo(0, y + r() * 2); ctx.lineTo(w, y + r() * 2); ctx.stroke(); }
    // top-down props: ingredient discs, leaves, petals
    scatterLeaves(ctx, w, h, key, PALETTE.sage, scene === 'natural' ? 16 : 8);
    const dots = scene === 'colour' ? ['#E7A6A1', '#F2C14E', '#8AA17D', '#C98B7B'] : ['#FBF3EA', '#EAD3CB'];
    for (let i = 0; i < (scene === 'kit' ? 5 : 4); i += 1) {
      const ang = (i / 5) * Math.PI * 2 + r(); const rad = w * (0.28 + r() * 0.08);
      ctx.fillStyle = dots[i % dots.length]; ctx.beginPath(); ctx.arc(w / 2 + Math.cos(ang) * rad, h / 2 + Math.sin(ang) * rad, w * (0.05 + r() * 0.03), 0, Math.PI * 2); ctx.fill();
    }
    // the product from above: a round lid / cap with its shadow, and the body lying beside it
    ctx.save(); ctx.shadowColor = 'rgba(40,30,20,0.3)'; ctx.shadowBlur = w * 0.04; ctx.shadowOffsetY = w * 0.015;
    ctx.fillStyle = product.look.body; roundRect(ctx, w * 0.3, h * 0.38, w * 0.4, h * 0.2, w * 0.03); ctx.fill();
    ctx.fillStyle = product.look.label; roundRect(ctx, w * 0.36, h * 0.42, w * 0.28, h * 0.12, w * 0.02); ctx.fill();
    ctx.restore();
    ctx.fillStyle = product.look.label === PALETTE.plum ? PALETTE.cream : PALETTE.plum; ctx.textAlign = 'center'; fitText(ctx, product.name.toUpperCase(), w * 0.26, Math.round(w * 0.022), SANS); ctx.fillText(product.name.toUpperCase().split(' ').slice(0, 2).join(' '), w / 2, h * 0.49);
    crescent(ctx, w / 2, h * 0.445, w * 0.012, PALETTE.roseGold, product.look.label);
    ctx.save(); ctx.shadowColor = 'rgba(40,30,20,0.3)'; ctx.shadowBlur = w * 0.03; ctx.shadowOffsetY = w * 0.012;
    ctx.fillStyle = product.look.body; ctx.beginPath(); ctx.arc(w * 0.74, h * 0.7, w * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PALETTE.roseGold; ctx.beginPath(); ctx.arc(w * 0.74, h * 0.7, w * 0.055, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return jpg(c);
  }
  // product / marketplace / lifestyle / white
  const bgs = { cream: ['#F7EBDD', '#EAD6BF'], grey: ['#E9E9EA', '#CFCFD2'], pastel: ['#F4DCD5', '#E4BFB6'], deep: ['#4A2A48', '#2E1730'] };
  const [top, bottom] = bgs[background] || bgs.cream;
  if (scene === 'setting' || scene === 'shelf' || scene === 'home') {
    gradient(ctx, w, h, '#EFE3D2', '#D9C6AD');
    ctx.fillStyle = 'rgba(200,225,240,0.75)'; roundRect(ctx, w * 0.1, h * 0.08, w * 0.3, h * 0.32, 8); ctx.fill();
    ctx.strokeStyle = '#FBF3EA'; ctx.lineWidth = 8; ctx.strokeRect(w * 0.1, h * 0.08, w * 0.3, h * 0.32);
    ctx.beginPath(); ctx.moveTo(w * 0.25, h * 0.08); ctx.lineTo(w * 0.25, h * 0.4); ctx.moveTo(w * 0.1, h * 0.24); ctx.lineTo(w * 0.4, h * 0.24); ctx.stroke();
    glow(ctx, w * 0.25, h * 0.24, w * 0.55, 'rgba(255,245,215,A)', 0.4);
    ctx.fillStyle = '#B58C5E'; ctx.fillRect(0, h * 0.74, w, h * 0.04); ctx.fillStyle = '#CDAE86'; ctx.fillRect(0, h * 0.78, w, h * 0.22);
    ctx.fillStyle = PALETTE.sage; ctx.beginPath(); ctx.ellipse(w * 0.82, h * 0.7, w * 0.05, h * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    leaf(ctx, w * 0.82, h * 0.74, w * 0.12, -1.9, PALETTE.sage); leaf(ctx, w * 0.82, h * 0.74, w * 0.12, -1.2, '#6F8A63');
    drawContainer(ctx, product, w * 0.5, h * 0.78, hero * 0.8);
    return jpg(c);
  }
  if (scene === 'outdoor' || scene === 'travel' || scene === 'table' || scene === 'surface') {
    gradient(ctx, w, h, scene === 'outdoor' ? '#CFE0C8' : top, scene === 'outdoor' ? '#9DB890' : bottom);
    if (scene === 'outdoor') { for (let i = 0; i < 9; i += 1) leaf(ctx, r() * w, r() * h * 0.5, w * (0.12 + r() * 0.1), r() * 6.28, i % 2 ? '#6F8A63' : '#88A87C'); }
    ctx.fillStyle = scene === 'outdoor' ? '#B58C5E' : '#D2B590'; ctx.fillRect(0, h * 0.72, w, h * 0.28);
    if (scene === 'table' || scene === 'travel') { ctx.fillStyle = '#FBF3EA'; ctx.beginPath(); ctx.ellipse(w * 0.2, h * 0.8, w * 0.07, h * 0.02, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(w * 0.15, h * 0.7, w * 0.1, h * 0.09); }
    drawContainer(ctx, product, w * 0.55, h * 0.78, hero * 0.82);
    return jpg(c);
  }
  gradient(ctx, w, h, top, bottom);
  const dark = background === 'deep' || scene === 'hero';
  if (dark) gradient(ctx, w, h, '#4A2A48', '#241328');
  glow(ctx, scene === 'studio' ? w * 0.28 : w * 0.5, h * 0.3, w * 0.8, 'rgba(255,248,232,A)', dark ? 0.28 : 0.55);
  if (marketplaceOrWhite(pack)) gradient(ctx, w, h, '#FFFFFF', '#F4F4F4');
  ctx.fillStyle = dark ? 'rgba(0,0,0,0.35)' : 'rgba(80,60,40,0.16)'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.8, w * 0.3, h * 0.035, 0, 0, Math.PI * 2); ctx.fill();
  const size = scene === 'detail' || scene === 'closeup' ? hero * 1.35 : scene === 'side' || scene === 'angle' ? hero * 0.92 : hero;
  drawContainer(ctx, product, w / 2, scene === 'detail' || scene === 'closeup' ? h * 0.98 : h * 0.8, size);
  if (scene === 'hero') { ctx.fillStyle = 'rgba(201,139,123,0.22)'; ctx.fillRect(w * 0.7, 0, w * 0.012, h); }
  return jpg(c);
}

const marketplaceOrWhite = (pack) => pack === 'marketplace' || pack === 'white';

/**
 * One scene of a short video, drawn tall (9:16) or wide (16:9) at 1080 x 1920 / 1920 x 1080 so a slow zoom stays sharp.
 * kind: 'hook' (headline with the pack), 'ritual' (two or three lines on ingredient discs), 'end' (logo, line, address).
 */
function videoSceneJpg({ product, kind, headline = '', lines = [], wide = false, variant = 0 }) {
  const [w, h] = wide ? [1920, 1080] : [1080, 1920];
  const { c, ctx } = canvasOf(w, h);
  const key = `${product.slug}-${kind}-${variant}`;
  const unit = wide ? h : w;
  if (kind === 'hook') {
    gradient(ctx, w, h, PALETTE.plum, '#241328');
    scatterLeaves(ctx, w, h, key, PALETTE.sage, 8);
    glow(ctx, w * 0.5, h * (wide ? 0.6 : 0.62), unit * 0.75, 'rgba(201,139,123,A)', 0.4);
    // The Library and Videos tiles show a 4:5 crop of this picture (the middle of it), so the words and the product sit in the middle.
    ctx.fillStyle = PALETTE.cream; ctx.textAlign = wide ? 'center' : 'left'; ctx.font = `${Math.round(unit * (wide ? 0.085 : 0.095))}px ${DISPLAY}`;
    const maxW = wide ? w * 0.4 : w * 0.84;
    const x0 = wide ? w * 0.5 : w * 0.08;
    wrap(ctx, headline, maxW).slice(0, 4).forEach((l, i) => ctx.fillText(l, x0, h * (wide ? 0.3 : 0.3) + i * unit * (wide ? 0.1 : 0.11)));
    ctx.fillStyle = PALETTE.roseGold; ctx.font = `${Math.round(unit * 0.034)}px ${SANS}`;
    ctx.fillText(BRAND.name.toUpperCase(), x0, h * (wide ? 0.14 : 0.235));
    drawContainer(ctx, product, wide ? w * 0.5 : w / 2, h * (wide ? 0.97 : 0.82), h * (wide ? 0.5 : 0.33));
    return jpg(c);
  }
  if (kind === 'ritual') {
    gradient(ctx, w, h, PALETTE.cream, '#EAD3CB');
    scatterLeaves(ctx, w, h, key, PALETTE.sage, 10);
    const cx = wide ? w * 0.28 : w / 2;
    drawContainer(ctx, product, cx, h * (wide ? 0.88 : 0.5), h * (wide ? 0.7 : 0.3));
    ctx.fillStyle = PALETTE.plum; ctx.textAlign = wide ? 'left' : 'center';
    const x0 = wide ? w * 0.52 : w / 2;
    ctx.font = `${Math.round(unit * 0.06)}px ${DISPLAY}`;
    ctx.fillText(headline, x0, h * (wide ? 0.2 : 0.6));
    ctx.font = `${Math.round(unit * 0.04)}px ${SANS}`;
    lines.slice(0, 3).forEach((l, i) => {
      const y = h * (wide ? 0.34 : 0.67) + i * unit * 0.085;
      ctx.fillStyle = PALETTE.roseGold; ctx.beginPath(); ctx.arc(x0 + (wide ? unit * 0.02 : -wrapW(ctx, l) / 2 - unit * 0.035), y - unit * 0.012, unit * 0.012, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PALETTE.plum; ctx.fillText(l, wide ? x0 + unit * 0.055 : x0, y);
    });
    product.ingredients.slice(0, 4).forEach((ing, i) => {
      const x = wide ? w * (0.56 + 0.1 * i) : w * (0.2 + 0.2 * i); const y = h * (wide ? 0.82 : 0.9);
      ctx.fillStyle = 'rgba(59,31,58,0.9)'; ctx.beginPath(); ctx.arc(x, y, unit * 0.055, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PALETTE.cream; ctx.textAlign = 'center'; fitText(ctx, ing.split(' ')[0], unit * 0.09, Math.round(unit * 0.022), SANS); ctx.fillText(ing.split(' ')[0], x, y + unit * 0.008);
    });
    return jpg(c);
  }
  // end card
  gradient(ctx, w, h, PALETTE.plum, '#2A1530');
  const rLogo = unit * (wide ? 0.2 : 0.2);
  const cx = w / 2; const cy = h * (wide ? 0.4 : 0.38);
  ctx.fillStyle = PALETTE.plum; ctx.beginPath(); ctx.arc(cx, cy, rLogo * 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PALETTE.roseGold; ctx.lineWidth = unit * 0.004; ctx.beginPath(); ctx.arc(cx, cy, rLogo * 1.4, 0, Math.PI * 2); ctx.stroke();
  crescent(ctx, cx, cy - rLogo * 0.25, rLogo * 0.55, PALETTE.roseGold, PALETTE.plum);
  ctx.fillStyle = PALETTE.cream; ctx.textAlign = 'center'; ctx.font = `${Math.round(rLogo * 0.7)}px ${DISPLAY}`; ctx.fillText('Zaya', cx, cy + rLogo * 0.75);
  ctx.fillStyle = PALETTE.roseGold; ctx.font = `${Math.round(rLogo * 0.2)}px ${SANS}`; ctx.fillText('N A T U R A L S', cx, cy + rLogo * 1.05);
  ctx.fillStyle = PALETTE.cream; ctx.font = `${Math.round(unit * (wide ? 0.05 : 0.055))}px ${DISPLAY}`;
  wrap(ctx, headline || BRAND.tagline, w * 0.8).slice(0, 3).forEach((l, i) => ctx.fillText(l, cx, h * (wide ? 0.74 : 0.66) + i * unit * 0.07));
  ctx.fillStyle = PALETTE.roseGold; ctx.font = `${Math.round(unit * 0.034)}px ${SANS}`;
  ctx.fillText(BRAND.website.replace('https://', ''), cx, h * (wide ? 0.92 : 0.86));
  return jpg(c);
}

function wrapW(ctx, text) { return ctx.measureText(text).width; }

module.exports = { competitorAvatarJpg, competitorPostJpg, photoshootJpg, videoSceneJpg, PHOTO_SIZES };
