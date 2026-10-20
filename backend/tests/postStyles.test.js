const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { POST_STYLES, isPostStyle, normalisePostDetails, buildStyleDirective, hasDetails } = require('../config/postStyles');
const { compositeFrames, cropToFrame, frameShare, FRAME_SPECS } = require('../services/postFrames');

test('styles: plain has no directive, others spell the exact text and forbid invention', () => {
  assert.ok(POST_STYLES.length >= 6);
  assert.equal(buildStyleDirective('plain', {}), '');
  assert.equal(buildStyleDirective('nope', {}), '');
  assert.equal(isPostStyle('offer'), true);
  assert.equal(isPostStyle('__proto__'), false);
  const d = buildStyleDirective('offer', { headline: 'Diwali Sale', offer: 'Up to 30% off', items: 'Sofa set Rs 24,999\nWashing machine Rs 18,500', phone: '93442 83333', address: 'Neyveli Main Road, Vadalur' }, { language: 'Tamil' });
  for (const s of ['"Diwali Sale"', '"Up to 30% off"', '"Sofa set Rs 24,999"', '"93442 83333"', 'Neyveli Main Road', 'Tamil', 'Do not invent']) assert.ok(d.includes(s), s);
});

test('with no details, no prices or contact details may appear', () => {
  const d = buildStyleDirective('celebration', {});
  assert.match(d, /do not show any prices, phone numbers or addresses/);
  assert.equal(hasDetails(normalisePostDetails({})), false);
});

test('details are cleaned and capped', () => {
  const n = normalisePostDetails({ headline: 'x'.repeat(500), items: Array.from({ length: 30 }, (_, i) => `item ${i}`).join('\n'), phone: 5, junk: 'y' });
  assert.equal(n.headline.length, 90);
  assert.equal(n.items.length, 12);
  assert.equal(n.phone, '5');
  assert.equal(n.junk, undefined);
  assert.deepEqual(normalisePostDetails('bad'), normalisePostDetails({}));
});

const solid = (w, h, rgba) => sharp({ create: { width: w, height: h, channels: 4, background: rgba } }).png().toBuffer();

test('header goes on top and footer at the bottom, scaled to the post width', async () => {
  const post = await solid(540, 675, { r: 255, g: 255, b: 255, alpha: 1 });
  const header = await solid(1080, 140, { r: 255, g: 0, b: 0, alpha: 1 });
  const footer = await solid(1080, 200, { r: 0, g: 0, b: 255, alpha: 1 });
  const out = await compositeFrames(post, { header, footer });
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [data[(y * info.width + x) * info.channels], data[(y * info.width + x) * info.channels + 1], data[(y * info.width + x) * info.channels + 2]];
  assert.deepEqual([info.width, info.height], [540, 675]);
  assert.deepEqual(px(10, 10), [255, 0, 0]);
  assert.deepEqual(px(10, 674), [0, 0, 255]);
  assert.deepEqual(px(270, 337), [255, 255, 255]);
  assert.ok(frameShare('footer', 540, 675) > 0 && frameShare('footer', 540, 675) <= 0.3);
});

test('a transparent frame leaves the picture showing through, and no frames returns the post', async () => {
  const post = await solid(100, 100, { r: 10, g: 200, b: 10, alpha: 1 });
  const clear = await solid(1080, 140, { r: 0, g: 0, b: 0, alpha: 0 });
  const out = await compositeFrames(post, { header: clear });
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([data[0], data[1], data[2]], [10, 200, 10]);
  assert.equal((await sharp(await compositeFrames(post, {})).metadata()).width, 100);
});

test('crop to frame gives the exact header and footer size', async () => {
  const big = await solid(2000, 900, { r: 1, g: 2, b: 3, alpha: 1 });
  for (const k of ['header', 'footer']) {
    const m = await sharp(await cropToFrame(big, k)).metadata();
    assert.deepEqual([m.width, m.height], [FRAME_SPECS[k].width, FRAME_SPECS[k].height]);
  }
  await assert.rejects(() => cropToFrame(big, 'side'));
});

test('addFramesToImage lays the frames over and never throws', async () => {
  const { addFramesToImage } = require('../services/postFrames');
  const post = await solid(200, 250, { r: 255, g: 255, b: 255, alpha: 1 });
  const footer = await solid(1080, 200, { r: 0, g: 0, b: 255, alpha: 1 });
  const io = { fetchBuffer: async (s) => (s === 'post' ? post : s === 'footer' ? footer : null), upload: async () => ({ success: true, url: 'https://saved/x.png' }) };
  const ok = await addFramesToImage('post', { footerUrl: 'footer' }, io);
  assert.equal(ok.applied, true); assert.equal(ok.imageUrl, 'https://saved/x.png'); assert.equal(ok.preFrameImageUrl, 'post');
  assert.equal((await addFramesToImage('post', {}, io)).applied, false);
  const broken = await addFramesToImage('post', { footerUrl: 'footer' }, { fetchBuffer: async () => { throw new Error('x'); } });
  assert.equal(broken.applied, false); assert.equal(broken.imageUrl, 'post');
});

test('frames: a failed store keeps the unframed picture, never a framed base64 copy (D101)', async () => {
  const { addFramesToImage } = require('../services/postFrames');
  const post = await solid(1080, 1080, { r: 255, g: 0, b: 0, alpha: 1 });
  const footer = await solid(1080, 200, { r: 0, g: 0, b: 255, alpha: 1 });
  const io = { fetchBuffer: async (s) => (s === 'post' ? post : s === 'footer' ? footer : null), upload: async () => ({ success: false, error: 'down' }) };
  const out = await addFramesToImage('post', { footerUrl: 'footer' }, io);
  assert.equal(out.applied, false);
  assert.equal(out.imageUrl, 'post');
});
