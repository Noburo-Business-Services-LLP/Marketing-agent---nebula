const test = require('node:test');
const assert = require('node:assert/strict');
const hero = require('../services/heroVideoService');

const TEXT = 'bytedance/seedance-2.0/text-to-video';
const REF = 'bytedance/seedance-2.0/reference-to-video';

test.beforeEach(() => {
  delete process.env.FAL_HERO_TEXT_MODEL;
  delete process.env.FAL_HERO_REF_MODEL;
  delete process.env.HERO_VIDEO_MONTHLY_LIMIT;
});

test('no refs -> text model, 720p, 15s, audio, 9:16', () => {
  const { model, input } = hero.buildHeroInput({ prompt: 'a cat' });
  assert.equal(model, TEXT);
  assert.equal(input.resolution, '720p');
  assert.equal(String(input.duration), '15');
  assert.equal(input.generate_audio, true);
  assert.equal(input.aspect_ratio, '9:16');
  assert.equal(input.prompt, 'a cat');
  assert.equal(input.image_urls, undefined);
});

test('2 refs -> reference model with image_urls', () => {
  const urls = ['https://a.com/1.png', 'https://b.com/2.jpg'];
  const { model, input } = hero.buildHeroInput({ prompt: 'p', refImageUrls: urls });
  assert.equal(model, REF);
  assert.deepEqual(input.image_urls, urls);
});

test('env model overrides read at call time', () => {
  process.env.FAL_HERO_TEXT_MODEL = 'x/t';
  process.env.FAL_HERO_REF_MODEL = 'x/r';
  assert.equal(hero.buildHeroInput({ prompt: 'p' }).model, 'x/t');
  assert.equal(hero.buildHeroInput({ prompt: 'p', refImageUrls: ['https://a.com/1.png'] }).model, 'x/r');
});

test('duration clamps', () => {
  assert.equal(String(hero.buildHeroInput({ prompt: 'p', duration: 99 }).input.duration), '15');
  assert.equal(String(hero.buildHeroInput({ prompt: 'p', duration: 2 }).input.duration), '4');
});

test('aspect ratio validated', () => {
  assert.equal(hero.buildHeroInput({ prompt: 'p', aspectRatio: '16:9' }).input.aspect_ratio, '16:9');
  assert.equal(hero.buildHeroInput({ prompt: 'p', aspectRatio: '7:3' }).input.aspect_ratio, '9:16');
});

test('invalid prompt throws', () => {
  assert.throws(() => hero.buildHeroInput({ prompt: '' }));
  assert.throws(() => hero.buildHeroInput({ prompt: '   ' }));
  assert.throws(() => hero.buildHeroInput({}));
});

test('invalid refs throw', () => {
  const ok = 'https://a.com/1.png';
  assert.throws(() => hero.buildHeroInput({ prompt: 'p', refImageUrls: Array(5).fill(ok) }));
  for (const bad of ['http://x', 'javascript:alert(1)', '', 5, null, {}]) {
    assert.throws(() => hero.validateRefUrls([bad]), String(bad));
  }
  assert.throws(() => hero.validateRefUrls('https://a.com/1.png'));
  assert.deepEqual(hero.validateRefUrls(undefined), []);
  assert.deepEqual(hero.validateRefUrls([ok]), [ok]);
});

test('month boundaries', () => {
  const now = new Date('2026-10-31T23:30:00Z');
  assert.equal(hero.monthStartUTC(now).toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(hero.nextMonthStartUTC(now).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(hero.nextMonthStartUTC(new Date('2026-12-15T00:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
});

test('monthly limit', () => {
  assert.equal(hero.heroMonthlyLimit(), 2);
  process.env.HERO_VIDEO_MONTHLY_LIMIT = '5';
  assert.equal(hero.heroMonthlyLimit(), 5);
  process.env.HERO_VIDEO_MONTHLY_LIMIT = 'abc';
  assert.equal(hero.heroMonthlyLimit(), 2);
  process.env.HERO_VIDEO_MONTHLY_LIMIT = '0';
  assert.equal(hero.heroMonthlyLimit(), 2);
});

test('getHeroQuota filter and result', async () => {
  const now = new Date('2026-10-10T10:00:00Z');
  let seen;
  const fake = { countDocuments: async (f) => { seen = f; return 1; } };
  const q = await hero.getHeroQuota('u1', now, fake);
  assert.deepEqual(seen, {
    userId: 'u1',
    'metadata.kind': 'hero',
    status: { $in: ['queued', 'processing', 'completed'] },
    createdAt: { $gte: hero.monthStartUTC(now) }
  });
  assert.deepEqual(q, { used: 1, limit: 2, resetsOn: '2026-11-01T00:00:00.000Z' });
});
