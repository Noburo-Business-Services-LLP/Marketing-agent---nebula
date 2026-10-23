'use strict';
/**
 * Local picture makers for the demo agency's clients: node-canvas only, deterministic, no network. Each client has a colour set and a
 * simple drawing of its trade (a cup, a tooth, a hanger, a dumbbell, a building, a jar); four layouts keep a feed from looking repeated.
 * Reuses the drawing helpers of the Zaya demo (scripts/demo-brand/images.js).
 */
const images = require('../demo-brand/images');

const { canvasOf, jpg, png, roundRect, fitText, wrap, DISPLAY, SANS, seeded } = images;

function circle(ctx, x, y, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function sparkle(ctx, x, y, r, fill) {
  ctx.fillStyle = fill; ctx.beginPath();
  for (let i = 0; i < 8; i += 1) { const a = (Math.PI / 4) * i; const rad = i % 2 === 0 ? r : r * 0.28; ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
  ctx.closePath(); ctx.fill();
}

/** One drawing per trade, centred at (cx, cy) inside a square of side s. */
const MOTIFS = {
  cafe(ctx, cx, cy, s, p) {
    ctx.strokeStyle = p.accent; ctx.lineWidth = s * 0.03; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i += 1) { ctx.beginPath(); ctx.moveTo(cx + i * s * 0.12, cy - s * 0.2); ctx.bezierCurveTo(cx + i * s * 0.12 - s * 0.06, cy - s * 0.3, cx + i * s * 0.12 + s * 0.06, cy - s * 0.38, cx + i * s * 0.12, cy - s * 0.48); ctx.stroke(); }
    ctx.fillStyle = p.ink; roundRect(ctx, cx - s * 0.3, cy - s * 0.15, s * 0.6, s * 0.42, s * 0.08); ctx.fill();
    ctx.strokeStyle = p.ink; ctx.lineWidth = s * 0.06; ctx.beginPath(); ctx.arc(cx + s * 0.31, cy + s * 0.05, s * 0.12, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.fillStyle = p.accent; roundRect(ctx, cx - s * 0.36, cy + s * 0.3, s * 0.72, s * 0.05, s * 0.025); ctx.fill();
  },
  dental(ctx, cx, cy, s, p) {
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = p.accent; ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.28, cy - s * 0.18);
    ctx.bezierCurveTo(cx - s * 0.28, cy - s * 0.42, cx - s * 0.02, cy - s * 0.38, cx, cy - s * 0.3);
    ctx.bezierCurveTo(cx + s * 0.02, cy - s * 0.38, cx + s * 0.28, cy - s * 0.42, cx + s * 0.28, cy - s * 0.18);
    ctx.bezierCurveTo(cx + s * 0.28, cy + s * 0.02, cx + s * 0.16, cy + s * 0.1, cx + s * 0.14, cy + s * 0.3);
    ctx.bezierCurveTo(cx + s * 0.13, cy + s * 0.42, cx + s * 0.03, cy + s * 0.42, cx + s * 0.02, cy + s * 0.28);
    ctx.lineTo(cx - s * 0.02, cy + s * 0.28);
    ctx.bezierCurveTo(cx - s * 0.03, cy + s * 0.42, cx - s * 0.13, cy + s * 0.42, cx - s * 0.14, cy + s * 0.3);
    ctx.bezierCurveTo(cx - s * 0.16, cy + s * 0.1, cx - s * 0.28, cy + s * 0.02, cx - s * 0.28, cy - s * 0.18);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    sparkle(ctx, cx + s * 0.3, cy - s * 0.32, s * 0.09, p.accent); sparkle(ctx, cx - s * 0.34, cy + s * 0.05, s * 0.06, p.accent);
  },
  boutique(ctx, cx, cy, s, p) {
    ctx.strokeStyle = p.ink; ctx.lineWidth = s * 0.025; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.34, s * 0.04, Math.PI * 0.2, Math.PI * 1.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.25); ctx.lineTo(cx - s * 0.34, cy - s * 0.06); ctx.lineTo(cx + s * 0.34, cy - s * 0.06); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.moveTo(cx - s * 0.16, cy - s * 0.04); ctx.lineTo(cx + s * 0.16, cy - s * 0.04); ctx.lineTo(cx + s * 0.34, cy + s * 0.4); ctx.lineTo(cx - s * 0.34, cy + s * 0.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.soft; ctx.fillRect(cx - s * 0.17, cy - s * 0.02, s * 0.34, s * 0.04);
  },
  gym(ctx, cx, cy, s, p) {
    ctx.fillStyle = p.ink; roundRect(ctx, cx - s * 0.36, cy - s * 0.025, s * 0.72, s * 0.05, s * 0.02); ctx.fill();
    for (const [dx, h] of [[-0.3, 0.34], [-0.22, 0.46], [0.22, 0.46], [0.3, 0.34]]) { ctx.fillStyle = dx < 0 ? p.accent : p.accent; roundRect(ctx, cx + s * dx - s * 0.035, cy - s * h / 2, s * 0.07, s * h, s * 0.02); ctx.fill(); }
    ctx.fillStyle = p.ink; roundRect(ctx, cx - s * 0.46, cy - s * 0.09, s * 0.05, s * 0.18, s * 0.015); ctx.fill(); roundRect(ctx, cx + s * 0.41, cy - s * 0.09, s * 0.05, s * 0.18, s * 0.015); ctx.fill();
  },
  home(ctx, cx, cy, s, p) {
    ctx.fillStyle = p.ink;
    for (const [dx, w, h] of [[-0.3, 0.2, 0.5], [-0.08, 0.22, 0.72], [0.15, 0.2, 0.58], [0.34, 0.14, 0.38]]) ctx.fillRect(cx + s * dx - s * w / 2, cy + s * 0.34 - s * h, s * w, s * h);
    ctx.fillStyle = p.accent;
    for (const [dx, w, h] of [[-0.3, 0.2, 0.5], [-0.08, 0.22, 0.72], [0.15, 0.2, 0.58]]) for (let r = 0; r < Math.floor(h / 0.1); r += 1) for (let c2 = 0; c2 < 2; c2 += 1) ctx.fillRect(cx + s * dx - s * w / 2 + s * w * (0.2 + c2 * 0.4), cy + s * 0.34 - s * h + s * 0.05 + r * s * 0.095, s * w * 0.2, s * 0.045);
    ctx.fillStyle = p.accent; ctx.fillRect(cx - s * 0.46, cy + s * 0.34, s * 0.92, s * 0.025);
  },
  pantry(ctx, cx, cy, s, p) {
    ctx.fillStyle = p.soft; roundRect(ctx, cx - s * 0.22, cy - s * 0.2, s * 0.44, s * 0.56, s * 0.07); ctx.fill();
    ctx.fillStyle = p.accent; roundRect(ctx, cx - s * 0.25, cy - s * 0.3, s * 0.5, s * 0.12, s * 0.04); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; roundRect(ctx, cx - s * 0.16, cy - s * 0.04, s * 0.32, s * 0.22, s * 0.03); ctx.fill();
    ctx.fillStyle = p.ink; ctx.fillRect(cx - s * 0.1, cy + s * 0.03, s * 0.2, s * 0.025); ctx.fillRect(cx - s * 0.1, cy + s * 0.09, s * 0.14, s * 0.02);
    for (const [dx, dy, a] of [[0.34, -0.1, -0.7], [0.38, 0.1, -0.2], [-0.36, 0.0, -2.4]]) {
      ctx.save(); ctx.translate(cx + s * dx, cy + s * dy); ctx.rotate(a); ctx.fillStyle = p.accent; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.12, s * 0.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
};

function drawText(ctx, text, x, y, maxW, size, family, color, align = 'left', lineH = 1.12, maxLines = 4) {
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  fitText(ctx, text, maxW * 2.2, size, family);
  let lines = wrap(ctx, text, maxW); let s = size;
  while (lines.length > maxLines && s > 24) { s -= 4; ctx.font = `${s}px ${family}`; lines = wrap(ctx, text, maxW); }
  const fs = parseInt(ctx.font, 10) || s;
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * fs * lineH));
  return y + Math.min(lines.length, maxLines) * fs * lineH;
}

/** A post picture. `layout` 0 to 3, `w` x `h` is 1080x1350 (4:5) or 1080x1080 (1:1). */
function postJpg(client, { head, sub }, { layout = 0, w = 1080, h = 1350, seedKey = '' } = {}) {
  const p = client.palette; const { c, ctx } = canvasOf(w, h); const motif = MOTIFS[client.motif];
  const r = seeded(`${client.slug}:${seedKey}:${head}`); const pad = Math.round(w * 0.08);
  ctx.fillStyle = p.bg; ctx.fillRect(0, 0, w, h);
  if (layout === 0) {
    circle(ctx, w * 0.5, h * 0.6, w * 0.32, p.soft);
    motif(ctx, w * 0.5, h * 0.6, w * 0.46, p);
    const y = drawText(ctx, head, pad, h * 0.2, w - pad * 2, w * 0.1, DISPLAY, p.ink, 'left', 1.08, 2);
    drawText(ctx, sub, pad, y + w * 0.012, w - pad * 2, w * 0.036, SANS, p.ink, 'left', 1.3, 2);
    ctx.fillStyle = p.accent; roundRect(ctx, pad, h - pad - w * 0.1, w - pad * 2, w * 0.1, w * 0.05); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.font = `${Math.round(w * 0.036)}px ${SANS}`; ctx.fillText(client.name, w / 2, h - pad - w * 0.035);
  } else if (layout === 1) {
    ctx.fillStyle = p.accent; ctx.fillRect(0, 0, w, h * 0.56);
    circle(ctx, w * 0.5, h * 0.3, w * 0.26, p.soft); motif(ctx, w * 0.5, h * 0.3, w * 0.42, { ...p, accent: p.accent });
    ctx.fillStyle = p.ink; ctx.fillRect(0, h * 0.56, w, h * 0.44);
    const y = drawText(ctx, head, pad, h * 0.56 + w * 0.13, w - pad * 2, w * 0.095, DISPLAY, p.bg, 'left', 1.08, 2);
    drawText(ctx, sub, pad, y + w * 0.012, w - pad * 2, w * 0.036, SANS, p.soft, 'left', 1.3, 2);
    ctx.fillStyle = p.bg; ctx.font = `${Math.round(w * 0.03)}px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(client.name.toUpperCase(), pad, h - pad * 0.7);
  } else if (layout === 2) {
    ctx.fillStyle = p.ink; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = p.accent; ctx.beginPath(); ctx.moveTo(0, h * 0.62); ctx.lineTo(w, h * 0.42); ctx.lineTo(w, h * 0.62); ctx.lineTo(0, h * 0.82); ctx.closePath(); ctx.fill();
    motif(ctx, w * 0.7, h * 0.64, w * 0.5, { ...p, ink: p.bg, soft: p.soft, accent: '#FFFFFF' });
    const y = drawText(ctx, head, pad, h * 0.2, w * 0.78, w * 0.105, DISPLAY, p.bg, 'left', 1.06, 3);
    drawText(ctx, sub, pad, y + w * 0.02, w * 0.7, w * 0.04, SANS, p.soft, 'left', 1.3, 3);
    ctx.fillStyle = p.bg; ctx.font = `${Math.round(w * 0.032)}px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(client.name, pad, h - pad * 0.8);
  } else {
    ctx.strokeStyle = p.accent; ctx.lineWidth = w * 0.012; ctx.strokeRect(pad * 0.55, pad * 0.55, w - pad * 1.1, h - pad * 1.1);
    motif(ctx, w * 0.5, h * 0.27, w * 0.34, p);
    const y = drawText(ctx, head, w / 2, h * 0.54, w - pad * 2.4, w * 0.095, DISPLAY, p.ink, 'center', 1.1, 3);
    drawText(ctx, sub, w / 2, y + w * 0.015, w - pad * 2.6, w * 0.038, SANS, p.ink, 'center', 1.3, 3);
    ctx.fillStyle = p.accent; ctx.fillRect(w / 2 - w * 0.08, h - pad * 1.9, w * 0.16, w * 0.008);
    ctx.fillStyle = p.ink; ctx.textAlign = 'center'; ctx.font = `${Math.round(w * 0.03)}px ${SANS}`; ctx.fillText(client.name.toUpperCase(), w / 2, h - pad * 1.25);
  }
  return jpg(c);
}

/** The client's round logo: initials on its main colour. */
function logoPng(client, size = 512) {
  const p = client.palette; const { c, ctx } = canvasOf(size, size);
  circle(ctx, size / 2, size / 2, size * 0.48, p.ink === '#F5F5F0' ? p.accent : p.ink);
  ctx.fillStyle = p.ink === '#F5F5F0' ? '#FFFFFF' : p.bg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(size * 0.34)}px ${DISPLAY}`; ctx.fillText(client.monogram, size / 2, size * 0.5);
  return png(c);
}

module.exports = { postJpg, logoPng, MOTIFS };
