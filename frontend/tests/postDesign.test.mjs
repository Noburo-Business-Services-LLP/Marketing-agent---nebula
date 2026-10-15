import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POST_STYLE_OPTIONS, DEFAULT_DESIGN, designRequestFields, referenceFileProblem } from '../utils/postDesign.ts';

test('the style list matches the server list and every style has a sample picture', () => {
  const server = fs.readFileSync(new URL('../../backend/config/postStyles.js', import.meta.url), 'utf8');
  const ids = [...server.matchAll(/\{ id: '([a-z]+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(POST_STYLE_OPTIONS.map((s) => s.id), ids);
  for (const s of POST_STYLE_OPTIONS) assert.ok(fs.existsSync(new URL(`../public${s.sample}`, import.meta.url)), s.id);
});

test('plain style sends nothing about design; other styles send the style and only filled details', () => {
  assert.deepEqual(designRequestFields(DEFAULT_DESIGN), {});
  const d = { ...DEFAULT_DESIGN, style: 'offer', details: { ...DEFAULT_DESIGN.details, phone: '123' }, headerUrl: 'https://h', footerUrl: 'https://f', referenceImage: 'data:image/png;base64,AA' };
  const f = designRequestFields(d);
  assert.equal(f.postStyle, 'offer'); assert.equal(f.postDetails.phone, '123'); assert.equal(f.headerUrl, 'https://h'); assert.equal(f.referenceImage, 'data:image/png;base64,AA');
  assert.equal(designRequestFields({ ...d, details: DEFAULT_DESIGN.details }).postDetails, undefined);
  assert.equal(designRequestFields(d, { reference: false }).referenceImage, undefined);
});

test('reference picture checks', () => {
  assert.equal(referenceFileProblem({ type: 'image/png', size: 100 }), '');
  assert.match(referenceFileProblem({ type: 'application/pdf', size: 100 }), /PNG, JPG or WebP/);
  assert.match(referenceFileProblem({ type: 'image/jpeg', size: 6 * 1024 * 1024 }), /5 MB/);
  assert.match(referenceFileProblem(null), /Choose/);
});

test('frame share of a post follows the shape, capped at 30 percent', async () => {
  const { frameSharePercent } = await import('../utils/postDesign.ts');
  assert.equal(frameSharePercent('footer', '4:5'), 14.8);
  assert.equal(frameSharePercent('header', '1:1'), 13);
  assert.ok(frameSharePercent('footer', '16:9') <= 30);
  assert.equal(frameSharePercent('footer', 'weird'), 18.5);
});

test('typed details travel with the request even though no style is chosen any more', () => {
  const d = { ...DEFAULT_DESIGN, details: { ...DEFAULT_DESIGN.details, headline: 'Diwali sale', phone: '98765 43210' } };
  const f = designRequestFields(d);
  assert.equal(f.postStyle, undefined);
  assert.equal(f.postDetails.headline, 'Diwali sale');
  assert.equal(f.postDetails.phone, '98765 43210');
  assert.deepEqual(designRequestFields(DEFAULT_DESIGN), {});
});
