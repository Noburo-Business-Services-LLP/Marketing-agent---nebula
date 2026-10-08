const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { composePage, fallbackPage, buildPdf, PAGE_W, PAGE_H } = require('../services/blueprint/designedCompose');

const solid = (w, h, c) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

test('a page is cropped to A4, with the footer and the real logo drawn on', async () => {
  const img = await solid(1024, 1536, { r: 20, g: 120, b: 120 });
  const logo = await solid(300, 100, { r: 255, g: 0, b: 0 });
  const out = await composePage({ image: img, logo, n: 3, total: 11 });
  const m = await sharp(out).metadata();
  assert.deepEqual([m.width, m.height, m.format], [PAGE_W, PAGE_H, 'jpeg']);
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 1], data[(y * info.width + x) * info.channels + 2]];
  const logoPx = px(80, 80);
  assert.ok(logoPx[0] > 180 && logoPx[1] < 90, 'the logo is red at the top left');
  const mid = px(PAGE_W / 2, PAGE_H / 2);
  assert.ok(mid[1] > 90 && mid[0] < 60, 'the picture shows through in the middle');
  const foot = px(PAGE_W / 2, PAGE_H - 5);
  assert.ok(foot[0] > 200 && foot[1] > 200, 'a pale footer band is at the bottom');
});

test('a page without a logo still works', async () => {
  const out = await composePage({ image: await solid(800, 1200, { r: 5, g: 5, b: 5 }), n: 1, total: 11, illustrative: true });
  assert.equal((await sharp(out).metadata()).width, PAGE_W);
});

test('the fallback page is made from the planned text at A4 size', async () => {
  const out = await fallbackPage({ page: { title: 'Content pillars', kicker: 'The themes your content returns to.', lines: ['Origin stories', 'Behind the roast'] }, colours: ['#1f7a7a'], n: 4, total: 11 });
  const m = await sharp(out).metadata();
  assert.deepEqual([m.width, m.height], [PAGE_W, PAGE_H]);
  const stats = await sharp(out).stats();
  assert.ok(stats.channels[0].stdev > 5, 'the page has content, it is not one flat colour');
});

test('the PDF has one A4 page for each image', async () => {
  const jpg = await sharp(await solid(300, 424, { r: 9, g: 9, b: 9 })).jpeg().toBuffer();
  const pdf = await buildPdf([jpg, jpg, jpg]);
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 3);
  assert.deepEqual([Math.round(doc.getPage(0).getWidth()), Math.round(doc.getPage(0).getHeight())], [595, 842]);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
