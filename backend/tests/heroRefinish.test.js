const test = require('node:test');
const assert = require('node:assert');
const { refinishClip } = require('../services/heroVideoFlow');
const { normalizeFinishOptions } = require('../services/heroVideoFinish');
const { normaliseCaption } = require('../services/heroVideoShare');

test('end card options: new choices are kept when valid and fall back when not', () => {
  const o = normalizeFinishOptions({ endCard: { enabled: true, ctaText: 'Hi', font: 'classic', size: 'large', theme: 'light', showLogo: false, details: ' Call us ' } }).endCard;
  assert.equal(o.font, 'classic'); assert.equal(o.size, 'large'); assert.equal(o.theme, 'light'); assert.equal(o.showLogo, false); assert.equal(o.details, 'Call us');
  const d = normalizeFinishOptions({ endCard: { font: 'comic', size: 'huge', theme: 'neon' } }).endCard;
  assert.deepEqual([d.font, d.size, d.theme, d.showLogo], ['modern', 'medium', 'brand', true]);
});

test('refinish re-runs only the finish on the saved original and merges the changes', async () => {
  const seen = {};
  const io = {
    mkdtemp: async () => require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'rf-')),
    download: async (url) => { seen.downloaded = url; return { filePath: '/tmp/x.mp4' }; },
    loadBrand: async () => ({ name: 'Nebulaa', logoUrl: 'https://l/x.png', website: 'https://nebulaa.ai', colors: ['#1e3a5f'] }),
    finish: async (a) => { seen.options = a.options; seen.brand = a.brand; },
    upload: async () => ({ url: 'https://res.cloudinary.com/demo/video/upload/new.mp4' })
  };
  const job = { userId: 'u1', result: { rawVideoUrl: 'https://raw/orig.mp4', videoUrl: 'https://old.mp4' }, payload: { finish: { captions: false, endCard: { enabled: true, ctaText: 'Old CTA', website: 'nebulaa.ai' } } } };
  const out = await refinishClip({ job, finishOverride: { captions: true, endCard: { ctaText: 'New CTA', font: 'friendly' } } }, io);
  assert.equal(seen.downloaded, 'https://raw/orig.mp4');
  assert.equal(seen.options.captions, true);
  assert.equal(seen.options.endCard.ctaText, 'New CTA');
  assert.equal(seen.options.endCard.website, 'nebulaa.ai');
  assert.equal(seen.options.endCard.font, 'friendly');
  assert.equal(seen.brand.color, '#1e3a5f');
  assert.equal(out.videoUrl, 'https://res.cloudinary.com/demo/video/upload/new.mp4');
});

test('refinish refuses a video with no saved original', async () => {
  await assert.rejects(() => refinishClip({ job: { result: { videoUrl: 'x' } }, finishOverride: {} }, {}), /no saved original/);
});

test('caption: cut to safe length, hashtags cleaned, nothing usable gives null', () => {
  const c = normaliseCaption({ caption: 'x'.repeat(900), hashtags: ['#Sale!', 'good morning', '', 'ok', 'ok', '1', '2', '3', '4', '5', '6'] });
  assert.equal(c.caption.length, 600);
  assert.ok(c.hashtags.length <= 8);
  assert.ok(c.hashtags.every((t) => /^#[\p{L}\p{N}_]+$/u.test(t)));
  assert.equal(new Set(c.hashtags).size, c.hashtags.length);
  assert.equal(normaliseCaption({ caption: '  ' }), null);
  assert.equal(normaliseCaption(null), null);
});
