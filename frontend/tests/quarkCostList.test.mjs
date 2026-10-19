import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { COST_GROUPS, HIDDEN_COST_KEYS, mappedCostKeys, buildCostList, FREE_LINES } from '../constants/quarks.ts';

const require = createRequire(import.meta.url);
const { QUARK_COSTS, STUDIO_CLIP_SECONDS } = require('../../backend/config/apiCosts.js');
const { pricingExtras } = require('../../backend/services/costList.js');

test('every cost key the server prices is on the list or deliberately hidden, never both', () => {
  const mapped = new Set(mappedCostKeys());
  for (const key of Object.keys(QUARK_COSTS)) {
    assert.ok(mapped.has(key) || key in HIDDEN_COST_KEYS, `${key} needs a row in COST_GROUPS or a reason in HIDDEN_COST_KEYS`);
    assert.ok(!(mapped.has(key) && key in HIDDEN_COST_KEYS), `${key} is both shown and hidden`);
  }
  for (const key of [...mapped, ...Object.keys(HIDDEN_COST_KEYS)]) assert.ok(key in QUARK_COSTS, `${key} is not a server cost key`);
});

test('the list prices every row from the server map, with videos by length and the Photoshoot packs', () => {
  const groups = buildCostList(QUARK_COSTS, pricingExtras({ ENABLE_PHOTOSHOOT: 'on' }));
  const by = Object.fromEntries(groups.map((g) => [g.id, g]));
  assert.deepEqual(groups.map((g) => g.id), ['posts', 'carousels', 'campaigns', 'videos', 'photoshoot', 'competitors', 'blueprint', 'edits']);
  const row = (g, label) => by[g].rows.find((r) => r.label === label);
  assert.equal(row('posts', 'Image post').quarks, QUARK_COSTS.image_generated);
  assert.equal(row('carousels', '5-slide carousel').quarks, 5 * QUARK_COSTS.carousel_generated);
  for (const s of [10, 20, 30]) assert.equal(row('videos', `${s} second video`).quarks, (s / STUDIO_CLIP_SECONDS) * QUARK_COSTS.studio_video);
  assert.equal(row('photoshoot', 'One photo').quarks, QUARK_COSTS.photoshoot_image);
  for (const pk of pricingExtras({ ENABLE_PHOTOSHOOT: 'on' }).photoshootPacks) assert.equal(row('photoshoot', pk.title).quarks, pk.photos * QUARK_COSTS.photoshoot_image);
  assert.equal(row('competitors', 'Post in response').quarks, QUARK_COSTS.home_response_post);
  assert.equal(row('competitors', 'Witty comment').quarks, QUARK_COSTS.home_witty_comment);
  assert.equal(row('blueprint', 'Growth Blueprint').quarks, QUARK_COSTS.blueprint);
  assert.equal(row('blueprint', 'Designed Blueprint PDF').quarks, QUARK_COSTS.blueprint_pdf);
  assert.equal(row('edits', 'Change a picture').quarks, QUARK_COSTS.image_edit);
  assert.match(by.videos.note, /up to 60 seconds/);
});

test('a key the server did not send is left out, never shown with a made-up number', () => {
  const groups = buildCostList({ image_generated: 11 }, {});
  assert.deepEqual(groups.map((g) => g.id), ['posts']);
  assert.deepEqual(groups[0].rows.map((r) => r.label), ['Image post', 'Post from your plan']);
  assert.deepEqual(buildCostList(null, null), []);
  // Without the part length the video rows are not guessed.
  assert.equal(buildCostList({ studio_video: 161 }, {}).length, 0);
});

test('plain names, no emoji, no internal names, no forbidden words', () => {
  const groups = buildCostList(QUARK_COSTS, pricingExtras());
  const text = [...groups.flatMap((g) => [g.title, g.blurb, g.note, ...g.rows.flatMap((r) => [r.label, r.detail])]), ...FREE_LINES].join('\n');
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), 'no emoji');
  assert.ok(!/_/.test(text), 'no snake_case keys');
  assert.ok(!/Image Generation|Rival Post|Video Scene|Competitor Intel/.test(text), 'no old internal names');
  assert.ok(!/\bcredits?\b|\btrials?\b|7 days|!|—/i.test(text), 'wording rules');
  for (const g of COST_GROUPS) assert.match(g.accent, /^#[0-9A-F]{6}$/);
});

test('Settings draws the list from the mapping, without emoji icons', () => {
  const src = fs.readFileSync(new URL('../pages/Settings.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('QuarkCostList'));
  assert.ok(!src.includes('ACTION_LABELS'));
});

test('Photoshoot rows are on the list only while the server sends them (ENABLE_PHOTOSHOOT)', () => {
  const { visibleCosts } = require('../../backend/services/costList.js');
  const off = buildCostList(visibleCosts(QUARK_COSTS, {}), pricingExtras({}));
  assert.ok(!off.some((g) => g.id === 'photoshoot'));
  const on = buildCostList(visibleCosts(QUARK_COSTS, { ENABLE_PHOTOSHOOT: 'on' }), pricingExtras({ ENABLE_PHOTOSHOOT: 'on' }));
  assert.ok(on.some((g) => g.id === 'photoshoot'));
  // Every other group is the same either way.
  assert.deepEqual(off.map((g) => g.id), on.map((g) => g.id).filter((id) => id !== 'photoshoot'));
});
