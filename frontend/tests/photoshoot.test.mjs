// The Photoshoot page helpers, the Home tile, tab and packs rail, the Library source and the hand-over to Create.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACK_PALETTE, createState, isFinished, lockedNote, minutesFor, minutesText, newKey, packTileLines, photoAlt, photoTotal,
  photosLine, priceLine, progressText, resultNotice, selectionFor, toggleProduct, uploadProblem, versionOf, UPLOAD_MAX_BYTES,
} from '../utils/photoshoot.ts';
import { HOME_CREATE_TILES, HOME_DESCRIBE_TABS, createTileHandoff, packRailItems } from '../utils/homeLayout.ts';
import { fromPhotoshootPhoto, applyFilters, DEFAULT_FILTERS } from '../utils/library.ts';
import { setPrefill, takePrefill } from '../utils/prefill.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const COSTS = { photoshoot_image: 10, image_generated: 11, studio_video: 161 };
const PACK = {
  key: 'product', title: 'Product photoshoot', subtitle: 'Styled studio and setting shots', counts: [4, 6], defaultCount: 6,
  aspectRatios: [{ key: '1:1', label: 'Square' }, { key: '4:5', label: 'Portrait' }], backgrounds: [{ key: 'cream', label: 'Warm cream' }],
  place: true, scenes: [{ key: 'studio', label: 'Studio light' }], quarks: 60, price: "60 Quarks (about 5 posts' worth)", worth: "about 5 posts' worth", minutes: 3,
};
const OPTS = { perPhoto: { quarks: 10, price: '', worth: '' }, packs: [PACK], maxProducts: 3, maxPhotos: 24, costs: COSTS, enabled: true, entitled: true, left: 60, perDay: 60 };
const job = (extra = {}) => ({
  id: 'j1', kind: 'pack', pack: 'product', packTitle: 'Product photoshoot', parent: null, parentIndex: null, status: 'running', aspectRatio: '1:1', background: '',
  products: [{ id: 'p', name: 'Brownie box' }], place: null, photoCount: 6, done: 2, failed: 0, quarks: 60, refundedQuarks: 0, minutes: 3, notice: '',
  photos: [{ index: 0, scene: 'studio', sceneLabel: 'Studio light', product: 'Brownie box', status: 'done', url: 'https://x/a.png', inLibrary: true }],
  versions: [], createdAt: '2026-10-19T06:00:00Z', finishedAt: null, ...extra,
});

test('prices are Quarks only on the Photoshoot page (owner 2026-10-19), posts\' worth only for agency accounts', () => {
  assert.equal(priceLine(60, COSTS), '60 Quarks');
  assert.equal(priceLine(1, COSTS), '1 Quark');
  assert.equal(priceLine(60, COSTS, true), '60 Quarks');
  assert.equal(priceLine(240, COSTS), '240 Quarks');
  assert.equal(priceLine(1000, COSTS), '1,000 Quarks');
  assert.equal(priceLine(0, COSTS), '');
  assert.deepEqual(packTileLines(PACK, COSTS), { price: 'Up to 60 Quarks', subtitle: 'Up to 6 photos, about 3 minutes' });
});

test('photos, minutes and the selection rules', () => {
  assert.equal(photosLine(4), '4 photos'); assert.equal(photosLine(1), '1 photo'); assert.equal(photosLine(6, 2), '12 photos (6 for each product)');
  assert.equal(minutesText(1), 'About 1 minute'); assert.equal(minutesText(4), 'About 4 minutes');
  assert.equal(minutesFor(6), 3); assert.equal(minutesFor(1), 1); assert.equal(minutesFor(24), 12);
  const s = selectionFor(PACK, { productIds: ['a'] });
  assert.deepEqual(s, { pack: PACK, productIds: ['a'], count: 6, aspectRatio: '1:1', background: 'cream', placeId: '' });
  assert.equal(photoTotal({ ...s, productIds: ['a', 'b'] }), 12);
  assert.deepEqual(toggleProduct(['a'], 'b', 3), ['a', 'b']); assert.deepEqual(toggleProduct(['a', 'b'], 'a', 3), ['b']);
  assert.deepEqual(toggleProduct(['a', 'b', 'c'], 'd', 3), ['a', 'b', 'c'], 'never more than the maximum');
});

test('Create is allowed only when everything is in place, and says why otherwise', () => {
  const s = selectionFor(PACK, { productIds: ['a'] });
  assert.deepEqual(createState(OPTS, s), { ok: true, reason: '' });
  assert.equal(createState(null, s).ok, false);
  assert.match(createState({ ...OPTS, entitled: false }, s).reason, /paid plans/);
  assert.equal(createState({ ...OPTS, entitled: false, pass: true }, s).reason, 'Photoshoots are not available for this account.', 'no upsell inside a client');
  assert.equal(createState({ ...OPTS, enabled: false }, s).reason, 'Photoshoots open soon.');
  assert.match(createState({ ...OPTS, staff: true }, s).reason, /Staff accounts/);
  assert.equal(createState({ ...OPTS, staff: true, pass: true }, s).ok, true);
  assert.match(createState(OPTS, s, true).reason, /being made/);
  assert.equal(createState(OPTS, { ...s, pack: null }).reason, 'Choose a pack to start.');
  assert.match(createState(OPTS, { ...s, productIds: [] }).reason, /at least one product/);
  assert.match(createState({ ...OPTS, maxPhotos: 10 }, { ...s, productIds: ['a', 'b'] }).reason, /at most 10 photos/);
  assert.equal(createState({ ...OPTS, left: 4 }, s).reason, 'You can make 4 more photos today.');
  assert.match(createState({ ...OPTS, left: 0 }, s).reason, /made all of today/);
});

test('progress, notices and versions of a photo', () => {
  assert.equal(progressText(job()), '2 of 6 photos ready');
  assert.equal(progressText(job({ status: 'done', done: 6 })), '6 photos ready');
  assert.equal(progressText(job({ status: 'failed', done: 0 })), 'No photos could be made');
  assert.equal(isFinished(job()), false); assert.equal(isFinished(job({ status: 'partial' })), true);
  assert.equal(resultNotice(job({ notice: 'x' })), '', 'no notice while running');
  assert.equal(resultNotice(job({ status: 'partial', notice: '1 of 6 photos could not be made. You were not charged for it.' })), '1 of 6 photos could not be made. You were not charged for it.');
  const j = job({ status: 'partial', versions: [{ id: 'v1', index: 0, status: 'done', url: 'https://x/v1.png', inLibrary: true }, { id: 'v2', index: 0, status: 'running', url: '', inLibrary: false }] });
  const v = versionOf(j, 0);
  assert.equal(v.running, true); assert.equal(v.latest.id, 'v1'); assert.equal(versionOf(j, 3).latest, null);
  assert.equal(photoAlt(j.photos[0], 6), 'Photo 1 of 6, Studio light, Brownie box');
});

test('one key per press, safe for the server pattern', () => {
  const k = newKey(() => 0.5, () => 1760000000000);
  assert.match(k, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(newKey(), newKey());
});

test('uploads: PNG, JPEG or WEBP up to 6 MB', () => {
  assert.equal(uploadProblem({ type: 'image/png', size: 1000 }), '');
  assert.equal(uploadProblem({ type: 'image/webp', size: UPLOAD_MAX_BYTES }), '');
  assert.match(uploadProblem({ type: 'image/gif', size: 10 }), /PNG, JPEG or WEBP/);
  assert.match(uploadProblem({ type: 'image/svg+xml', size: 10 }), /PNG, JPEG or WEBP/);
  assert.match(uploadProblem({ type: 'image/jpeg', size: UPLOAD_MAX_BYTES + 1 }), /6 MB/);
  assert.match(uploadProblem(null), /Choose a photo/);
});

test('the locked note never sells inside a client', () => {
  assert.equal(lockedNote({ ...OPTS, entitled: true }), null);
  assert.deepEqual(lockedNote({ ...OPTS, entitled: false }), { text: 'Photoshoots are part of the paid plans. You can look at the packs and prices here.', to: '/trial-expired', action: 'See plans' });
  assert.deepEqual(lockedNote({ ...OPTS, entitled: false, pass: true }), { text: 'Photoshoots are not available for this account.', to: '', action: '' });
});

test('every pack has a cover palette', () => {
  assert.deepEqual(Object.keys(PACK_PALETTE).sort(), ['festival', 'flatlay', 'lifestyle', 'marketplace', 'product', 'white']);
  const css = read('components/CoverTile.css');
  for (const p of new Set(Object.values(PACK_PALETTE))) assert.ok(css.includes(`.nb-cover[data-palette="${p}"]`), p);
});

test('Home: a Photoshoot tile, a Photoshoot tab and the packs rail from the server catalogue', () => {
  assert.deepEqual(HOME_CREATE_TILES.map((t) => t.key), ['single', 'carousel', 'campaign', 'video', 'photoshoot']);
  assert.deepEqual(createTileHandoff('photoshoot'), { target: null, route: '/photoshoot', data: null });
  assert.deepEqual(HOME_DESCRIBE_TABS.map((t) => t.label), ['Post', 'Video', 'Photoshoot']);
  assert.deepEqual(packRailItems({ ...OPTS }), [{ key: 'product', title: 'Product photoshoot', line: 'Up to 6 photos, about 3 minutes', price: 'Up to 60 Quarks', to: '/photoshoot?pack=product' }]);
  assert.equal(packRailItems({ ...OPTS }, true)[0].price, 'Up to 60 Quarks');
  assert.deepEqual(packRailItems(null), []);
  const blocks = read('components/home/HomeBlocks.tsx');
  assert.ok(blocks.includes('photoshootAPI.packs()'), 'the rail reads the catalogue');
  assert.ok(blocks.includes("Photoshoots use ready-made packs of your product photos, so there is nothing to type."), 'the tab is honest: nothing typed becomes a prompt');
  assert.ok(read('pages/GravityHome.tsx').includes('showPacks={!isStaffSelf}'));
});

test('Library: photoshoot photos are their own source, tagged and filterable', () => {
  const item = fromPhotoshootPhoto({ jobId: 'j1', index: 2, url: 'https://res.cloudinary.com/x/a.png', pack: 'festival', packTitle: 'Festival pack', scene: 'Gift ready', product: 'Sweets box', createdAt: '2026-10-19' });
  assert.equal(item.source, 'photoshoot'); assert.equal(item.kind, 'image'); assert.equal(item.status, 'ready');
  assert.equal(item.id, 'j1-2'); assert.equal(item.title, 'Sweets box, Gift ready'); assert.equal(item.caption, 'Photoshoot: Festival pack');
  assert.equal(fromPhotoshootPhoto({ jobId: 'j', index: 0, url: 'javascript:alert(1)' }), null);
  assert.equal(fromPhotoshootPhoto({ jobId: 'j', index: 0, url: 'http://example.com/a.png' }), null);
  assert.equal(fromPhotoshootPhoto(null), null);
  assert.equal(applyFilters([item], { ...DEFAULT_FILTERS, source: 'photoshoot' }).length, 1);
  const page = read('pages/Library.tsx');
  // Photos load into the Library and carry the "Photoshoot" source chip (the source dropdown was removed on 2026-10-19).
  assert.ok(page.includes('photoshootAPI.library()') && page.includes('SOURCE_WORD[i.source]'));
});

test("Use in Create hands the photo over as the post's product picture, once", () => {
  const store = new Map();
  const s = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  setPrefill('carousel', { mode: 'single', topic: 'A post about Brownie box', source: 'home', photo: { name: 'Brownie box', imageUrl: 'https://x/a.png' } }, s, 1000);
  assert.deepEqual(takePrefill('carousel', s, 2000).photo, { name: 'Brownie box', imageUrl: 'https://x/a.png' });
  assert.equal(takePrefill('carousel', s, 2000), null);
  const create = read('pages/GravityCreate.tsx');
  assert.ok(/p\.photo && \/\^https:/.test(create) && create.includes('setPickedProducts([{'), 'Create picks it as the product picture, only a stored https link');
});

test('the page: route, menu entry, compact cover tiles, accessible choices, no dark panel', () => {
  assert.ok(read('App.tsx').includes('<Route path="/photoshoot"'));
  assert.ok(read('utils/navMenu.ts').includes("{ key: 'photoshoot', label: 'Photoshoot', to: '/photoshoot' }"));
  const page = read('pages/Photoshoot.tsx');
  assert.ok(page.includes('<CoverTile') && page.includes('aria-pressed'), 'cover tiles for the packs, pressed state on choices');
  assert.ok(page.includes('role="status" aria-live="polite"'), 'progress is announced');
  assert.ok(!/DarkPanel/.test(page), 'no dark panel on a light page');
  assert.ok(!page.includes('\u2014') && !page.includes(String.fromCharCode(0x2014)), 'no em dash');
  for (const w of ['credit', 'trial', '7 days']) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(page.replace(/trial-expired/g, '')), w);
  const scope = JSON.parse(read('tests/voice-scope.json'));
  assert.ok(scope.includes('pages/Photoshoot.tsx') && scope.includes('utils/photoshoot.ts'));
});
