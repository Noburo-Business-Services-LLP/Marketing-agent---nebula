const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const {
  determineBrandColors, deriveSecondaryColor, ensureDistinctSecondary
} = require('../services/brandIntelligenceService');
const { extractLogoColors, colorsFromLogoUrl } = require('../services/logoColorService');

const NONE = { primary_color: '', secondary_color: '', source: 'none', confidence: 0, reason: 'No brand colours could be detected.' };
const dist = (a, b) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const png = (w, h, bg, shapes = []) => sharp({ create: { width: w, height: h, channels: 4, background: bg } })
  .composite(shapes.map((s) => ({ input: { create: { width: s.w, height: s.h, channels: 4, background: s.c } }, left: s.x, top: s.y })))
  .png().toBuffer();
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

test('nothing known: colours stay empty (no black or Nebulaa yellow invented)', async () => {
  assert.deepStrictEqual(await determineBrandColors({}), NONE);
  assert.deepStrictEqual(await determineBrandColors({ websiteUrl: 'not a url !!' }), NONE);
  assert.deepStrictEqual(await determineBrandColors({ websiteUrl: 'example.com' }), NONE);
  assert.deepStrictEqual(
    await determineBrandColors({ websiteUrl: 'example.com', scrapeWebsite: async () => ({ success: false }) }), NONE);
  assert.deepStrictEqual(
    await determineBrandColors({ websiteUrl: 'example.com', scrapeWebsite: async () => { throw new Error('x'); } }), NONE);
});

test('manual colours are honoured; a missing secondary is derived only from a real primary', async () => {
  const both = await determineBrandColors({ primaryColor: '#336699', secondaryColor: '#ff0000' });
  assert.strictEqual(both.primary_color, '#336699');
  assert.strictEqual(both.secondary_color, '#FF0000');
  assert.strictEqual(both.source, 'manual');
  const one = await determineBrandColors({ primaryColor: '#336699' });
  assert.strictEqual(one.primary_color, '#336699');
  assert.match(one.secondary_color, /^#[0-9A-F]{6}$/);
  const onlySecondary = await determineBrandColors({ secondaryColor: '#ff0000' });
  assert.strictEqual(onlySecondary.primary_color, '');
  assert.strictEqual(onlySecondary.secondary_color, '#FF0000');
});

test('derive helpers never invent a colour from nothing', () => {
  assert.strictEqual(deriveSecondaryColor(''), '');
  assert.strictEqual(deriveSecondaryColor('zzz'), '');
  assert.strictEqual(ensureDistinctSecondary('', ''), '');
  assert.strictEqual(ensureDistinctSecondary('', '#ABCDEF'), '#ABCDEF');
  assert.match(ensureDistinctSecondary('#336699', ''), /^#[0-9A-F]{6}$/);
});

test('website colours are still used', async () => {
  const html = '<meta name="theme-color" content="#d62828"><style>.btn{background:#d62828}</style>';
  const r = await determineBrandColors({ websiteUrl: 'example.com', scrapeWebsite: async () => ({ success: true, data: html }) });
  assert.strictEqual(r.source, 'website');
  assert.strictEqual(r.primary_color, '#D62828');
});

test('order is manual, website, logo, none; logo gives its own colours and a plain reason', async () => {
  const logoBuffer = await png(40, 40, '#ffffff', [{ x: 0, y: 0, w: 20, h: 40, c: '#ff0000' }, { x: 20, y: 0, w: 20, h: 40, c: '#0000ff' }]);
  const r = await determineBrandColors({ logoBuffer });
  assert.strictEqual(r.source, 'logo');
  assert.strictEqual(r.reason, 'Colours were taken from your logo.');
  assert.ok(dist(r.primary_color, '#FF0000') < 40 || dist(r.primary_color, '#0000FF') < 40);
  assert.ok(r.secondary_color);
  const manual = await determineBrandColors({ logoBuffer, primaryColor: '#336699' });
  assert.strictEqual(manual.source, 'manual');
  const html = '<meta name="theme-color" content="#d62828">';
  const web = await determineBrandColors({ logoBuffer, websiteUrl: 'example.com', scrapeWebsite: async () => ({ success: true, data: html }) });
  assert.strictEqual(web.source, 'website');
  const blank = await png(10, 10, CLEAR);
  assert.deepStrictEqual(await determineBrandColors({ logoBuffer: blank }), NONE);
});

test('extractLogoColors: red and blue logo gives both colours', async () => {
  const buf = await png(60, 60, CLEAR, [{ x: 0, y: 0, w: 40, h: 60, c: '#e01010' }, { x: 40, y: 0, w: 20, h: 60, c: '#1010e0' }]);
  const r = await extractLogoColors(buf);
  assert.ok(dist(r.primary, '#E01010') < 30, r.primary);
  assert.ok(dist(r.secondary, '#1010E0') < 30, r.secondary);
});

test('extractLogoColors: black on transparent gives black and no second colour', async () => {
  const buf = await png(60, 60, CLEAR, [{ x: 10, y: 10, w: 40, h: 40, c: '#000000' }]);
  assert.deepStrictEqual(await extractLogoColors(buf), { primary: '#000000', secondary: '' });
});

test('extractLogoColors: one colour gives one colour, white background is ignored', async () => {
  const buf = await png(60, 60, '#ffffff', [{ x: 10, y: 10, w: 40, h: 40, c: '#228833' }]);
  const r = await extractLogoColors(buf);
  assert.ok(dist(r.primary, '#228833') < 20, r.primary);
  assert.strictEqual(r.secondary, '');
});

test('extractLogoColors: white only, transparent, corrupt, empty give nothing and never throw', async () => {
  const empty = { primary: '', secondary: '' };
  assert.deepStrictEqual(await extractLogoColors(await png(20, 20, '#ffffff')), empty);
  assert.deepStrictEqual(await extractLogoColors(await png(20, 20, CLEAR)), empty);
  assert.deepStrictEqual(await extractLogoColors(Buffer.from('not an image')), empty);
  assert.deepStrictEqual(await extractLogoColors(Buffer.alloc(0)), empty);
  assert.deepStrictEqual(await extractLogoColors(null), empty);
});

test('extractLogoColors: large images are downscaled and still work', async () => {
  const buf = await png(400, 300, '#ffffff', [{ x: 0, y: 0, w: 400, h: 150, c: '#cc2200' }]);
  const r = await extractLogoColors(buf);
  assert.ok(dist(r.primary, '#CC2200') < 25, r.primary);
});

test('colorsFromLogoUrl uses the injected fetcher; a null fetch gives empty colours', async () => {
  const buf = await png(30, 30, CLEAR, [{ x: 0, y: 0, w: 30, h: 30, c: '#ff8800' }]);
  let seen = '';
  const r = await colorsFromLogoUrl('https://cdn.example.com/l.png', { fetchLogoBuffer: async (u) => { seen = u; return buf; } });
  assert.strictEqual(seen, 'https://cdn.example.com/l.png');
  assert.ok(dist(r.primary, '#FF8800') < 20);
  assert.deepStrictEqual(await colorsFromLogoUrl('https://x/l.png', { fetchLogoBuffer: async () => null }), { primary: '', secondary: '' });
  assert.deepStrictEqual(await colorsFromLogoUrl('https://x/l.png', { fetchLogoBuffer: async () => { throw new Error('x'); } }), { primary: '', secondary: '' });
});
