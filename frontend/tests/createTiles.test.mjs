import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREATE_TILES, VIDEO_ENTRY, PHOTOSHOOT_ENTRY, actionCostKey, createTileCost, videoEntryCost, photoshootEntryCost } from '../utils/createTiles.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const COSTS = { image_generated: 11, campaign_full: 12, carousel_generated: 4, campaign_text: 3, studio_video: 161 };

test('the four modes, in order, with the agreed one-line descriptions', () => {
  assert.deepEqual(CREATE_TILES.map((t) => t.key), ['single', 'campaign', 'carousel', 'linkedin']);
  assert.deepEqual(CREATE_TILES.map((t) => t.title), ['Single post', 'Campaign', 'Carousel', 'LinkedIn post']);
  assert.deepEqual(CREATE_TILES.map((t) => t.subtitle), [
    'One image post with a caption',
    'A series of posts for a goal',
    'Swipeable slides',
    'A professional post for LinkedIn',
  ]);
  for (const t of CREATE_TILES) assert.equal(t.accent, 'create');
});

test('each mode is charged under the same action the server charges', () => {
  assert.equal(actionCostKey('single'), 'image_generated');
  assert.equal(actionCostKey('campaign'), 'campaign_full');
  assert.equal(actionCostKey('carousel'), 'carousel_generated');
  assert.equal(actionCostKey('linkedin'), 'campaign_text');
});

test('the cost line uses the existing Quark wording with the posts equivalent beside it', () => {
  assert.equal(createTileCost('single', COSTS), '11 Quarks');
  assert.equal(createTileCost('linkedin', COSTS), '3 Quarks');
  assert.equal(createTileCost('campaign', COSTS), '12 Quarks for each post');
  assert.equal(createTileCost('carousel', COSTS), '4 Quarks for each slide');
});

test('no cost line when the price is not known yet', () => {
  assert.equal(createTileCost('single', {}), '');
  assert.equal(createTileCost('campaign', undefined), '');
  assert.equal(createTileCost('carousel', { carousel_generated: 0 }), '');
  assert.equal(createTileCost('single', { image_generated: 1 }), '1 Quark');
});

test('the copy follows the voice rules', () => {
  const text = [read('utils/createTiles.ts'), read('components/Tile.tsx'), read('components/DarkPanel.tsx')].join('\n');
  assert.ok(!/!\s*['"`<]|—/.test(CREATE_TILES.map((t) => t.title + t.subtitle).join(' ')), 'no exclamation or em dash in the tile copy');
  for (const t of CREATE_TILES) {
    assert.ok(!/[!—]/.test(t.title + t.subtitle));
    assert.ok(!/\b(credit|trial|7 days)\b/i.test(t.title + t.subtitle));
  }
  assert.ok(text.length > 0);
});

test('Create content shows the mode tiles and keeps the modes and their behaviour', () => {
  const page = read('pages/GravityCreate.tsx');
  assert.ok(page.includes("import CoverTile, { type CoverPalette } from '../components/CoverTile'") && page.includes("import TileGrid from '../components/TileGrid'"));
  assert.ok(page.includes('CREATE_TILES.map'), 'tiles are built from the list');
  assert.ok(page.includes('onClick={() => setMode(t.key)}'), 'a tile sets the mode like the old tabs did');
  assert.ok(page.includes('selected={mode === t.key}'), 'the current mode is marked');
  assert.ok(page.includes('<ModeExplainer mode={mode} />'), 'the explainer stays');
  for (const label of ['Create campaign', 'Create carousel', 'Create post', 'Building your campaign', 'Building your carousel']) {
    assert.ok(page.includes(label), label + ' unchanged');
  }
  assert.ok(page.includes('actionCostKey(mode)'), 'the button uses the shared cost key');
  assert.ok(!page.includes("onClick={() => setMode('single')}"), 'the old pill buttons are gone');
});

test('the Create tile copy file is in the voice scope', () => {
  const scope = JSON.parse(read('tests/voice-scope.json'));
  assert.ok(scope.includes('utils/createTiles.ts'));
  assert.ok(scope.includes('components/Tile.tsx'));
});

test('Video is offered as an entry that opens the existing Videos page, with its price', () => {
  assert.deepEqual({ ...VIDEO_ENTRY }, { title: 'Video', subtitle: 'A short video for your business', accent: 'video', to: '/reels' });
  assert.equal(videoEntryCost(COSTS), '161 Quarks');
  assert.equal(videoEntryCost({}), '');
  const page = read('pages/GravityCreate.tsx');
  assert.ok(page.includes('VIDEO_ENTRY.to') && page.includes('<VideoArt'), 'the page shows it');
  assert.ok(read('App.tsx').includes('path="/reels"'), 'the destination route exists');
});

test('the six choices are cover tiles of one structure in one row, and the theme field is gone', () => {
  const page = read('pages/GravityCreate.tsx');
  // Photoshoot joined on 2026-10-19 (its page exists now), second after Video.
  assert.ok(page.includes('<TileGrid columns={6} size="small"'), 'one even row of six');
  assert.equal((page.match(/<CoverTile\b/g) || []).length, 3, 'the mode tiles, the Video tile and the Photoshoot tile use the same cover tile');
  assert.ok(!/<Tile\b/.test(page), 'no compact tile left on the chooser');
  assert.ok(page.includes("palette=\"ink\"") && /single: 'gold', campaign: 'coral', carousel: 'teal', linkedin: 'blue'/.test(page), 'each type has its own colour grade');
  assert.ok(!/Theme or festival|create-theme|setTheme/.test(page), 'no theme or festival field');
  assert.ok(!/theme: theme/.test(page), 'no theme value is sent');
});

test('Photoshoot is the second tile, after Video and before the four modes, and opens its page with its price', () => {
  assert.deepEqual({ ...PHOTOSHOOT_ENTRY }, { title: 'Photoshoot', subtitle: 'Product photos in ready-made packs', accent: 'photoshoot', to: '/photoshoot' });
  assert.equal(photoshootEntryCost({ photoshoot_image: 10 }), '10 Quarks for each photo');
  assert.equal(photoshootEntryCost({}), '');
  const page = read('pages/GravityCreate.tsx');
  const v = page.indexOf('to={VIDEO_ENTRY.to}'); const p = page.indexOf('to={PHOTOSHOOT_ENTRY.to}'); const m = page.indexOf('CREATE_TILES.map((t) => (');
  assert.ok(v > 0 && v < p && p < m, 'order: Video, Photoshoot, then Single post, Campaign, Carousel, LinkedIn');
  assert.ok(read('App.tsx').includes('path="/photoshoot"'), 'the destination route exists');
  assert.ok(!/[!\u2014]/.test(PHOTOSHOOT_ENTRY.title + PHOTOSHOOT_ENTRY.subtitle));
});
