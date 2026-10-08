'use strict';
// Finishing a designed page in code: crop to A4, put the real logo and the page marker on, make a plain page from
// the planned text when the image model could not do it, and merge the pages into one PDF.
const sharp = require('sharp');

const PAGE_W = 1240; // A4 at 150 dpi
const PAGE_H = 1754;
const FOOTER_H = 62;

const hex = (h, dflt) => (/^#[0-9a-f]{6}$/i.test(String(h || '')) ? h : dflt);

function canvasLib() {
  const { createCanvas, loadImage } = require('canvas');
  const { endCardFamily } = require('../heroVideoFinish');
  return { createCanvas, loadImage, family: endCardFamily('friendly') };
}

function wrap(ctx, text, maxW) {
  const out = [];
  let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/** The finished page: A4 crop, real logo at the top left, footer with "Prepared by Nebulaa" and the page marker. Returns JPEG. */
async function composePage({ image, logo, n, total, illustrative = false }) {
  const { createCanvas, loadImage, family } = canvasLib();
  const base = await sharp(image).resize(PAGE_W, PAGE_H, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const layers = [];

  const footer = createCanvas(PAGE_W, FOOTER_H);
  const f = footer.getContext('2d');
  f.fillStyle = 'rgba(255,255,255,0.9)';
  f.fillRect(0, 0, PAGE_W, FOOTER_H);
  f.fillStyle = '#1a1a1a';
  f.textBaseline = 'middle';
  f.font = `bold 24px ${family}`;
  f.textAlign = 'left';
  f.fillText('Prepared by Nebulaa', 40, FOOTER_H / 2);
  f.textAlign = 'right';
  f.fillText(`${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, PAGE_W - 40, FOOTER_H / 2);
  if (illustrative) {
    f.textAlign = 'center';
    f.font = `20px ${family}`;
    f.fillStyle = '#555';
    f.fillText('Illustrative imagery', PAGE_W / 2, FOOTER_H / 2);
  }
  layers.push({ input: footer.toBuffer('image/png'), left: 0, top: PAGE_H - FOOTER_H });

  if (logo) {
    const img = await loadImage(logo).catch(() => null);
    if (img) {
      const k = Math.min((PAGE_W * 0.18) / img.width, (PAGE_H * 0.075) / img.height);
      const w = Math.max(2, Math.round(img.width * k));
      const h = Math.max(2, Math.round(img.height * k));
      const c = createCanvas(w + 24, h + 24);
      const x = c.getContext('2d');
      x.fillStyle = 'rgba(255,255,255,0.92)';
      x.fillRect(0, 0, w + 24, h + 24);
      x.drawImage(img, 12, 12, w, h);
      layers.push({ input: c.toBuffer('image/png'), left: 36, top: 36 });
    }
  }
  return sharp(base).composite(layers).jpeg({ quality: 88 }).toBuffer();
}

/** A plain page made from the planned text: used when the image model could not print the page correctly. */
async function fallbackBase({ page, colours }) {
  const { createCanvas, family } = canvasLib();
  const c = createCanvas(PAGE_W, PAGE_H);
  const ctx = c.getContext('2d');
  const main = hex(colours && colours[0], '#16243d');
  const g = ctx.createLinearGradient(0, 0, PAGE_W, PAGE_H);
  g.addColorStop(0, main);
  g.addColorStop(1, '#0b1220');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  let y = 230;
  ctx.fillStyle = '#F5A623';
  ctx.font = `bold 30px ${family}`;
  ctx.fillText(String(page.kicker || '').toUpperCase().slice(0, 60), 80, y);
  y += 56;
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 84px ${family}`;
  wrap(ctx, page.title || '', PAGE_W - 160).slice(0, 3).forEach((line) => { ctx.fillText(line, 80, y); y += 100; });
  y += 50;
  ctx.font = `38px ${family}`;
  for (const line of (page.lines || []).slice(0, 8)) {
    const rows = wrap(ctx, line, PAGE_W - 240).slice(0, 3);
    const h = rows.length * 52 + 40;
    if (y + h > PAGE_H - FOOTER_H - 60) break;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(80, y, PAGE_W - 160, h);
    ctx.fillStyle = '#F5A623';
    ctx.fillRect(80, y, 10, h);
    ctx.fillStyle = '#ffffff';
    rows.forEach((r, i) => ctx.fillText(r, 120, y + 20 + i * 52));
    y += h + 22;
  }
  return c.toBuffer('image/png');
}

async function fallbackPage({ page, colours, logo, n, total }) {
  return composePage({ image: await fallbackBase({ page, colours }), logo, n, total });
}

/** Merge page images (JPEG buffers) into one A4 PDF. */
async function buildPdf(pages, { title = 'Brand Growth Blueprint' } = {}) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('Nebulaa');
  doc.setCreator('Nebulaa');
  for (const buf of pages) {
    const img = await doc.embedJpg(buf);
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await doc.save());
}

module.exports = { composePage, fallbackPage, buildPdf, PAGE_W, PAGE_H };
