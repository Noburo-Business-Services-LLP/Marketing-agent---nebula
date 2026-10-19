import test from 'node:test';
import assert from 'node:assert/strict';
import { brandTiles, brandProgress, tileSpans, blueprintFormTiles, blueprintPartTiles } from '../utils/brandTiles.ts';
import { rowsOf } from '../utils/rowSpans.ts';

const full = {
  logos: [{ url: 'https://cdn.example/logo.png', isPrimary: true }, { url: 'https://cdn.example/logo2.png' }],
  profile: { assets: { primaryColor: '#f5a623', secondaryColor: '#14203A', fontType: 'Playfair Display' } },
  assets: [{ type: 'logo', url: 'https://x/l.png' }, { type: 'character', url: 'https://x/p1.jpg' }, { type: 'character', url: 'data:image/png;base64,x' }, { type: 'environment', url: 'https://x/shop.jpg' }],
  products: [{ name: 'A', imageUrl: 'https://x/a.jpg' }, { name: 'B', images: ['https://x/b.jpg'] }, { name: 'C' }],
  memory: { notes: 5, tracked: 12 },
};

test('every brand tile gets its status from stored rows', () => {
  const t = Object.fromEntries(brandTiles(full).map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(t), ['logo', 'colours', 'fonts', 'people', 'places', 'products', 'memory']);
  assert.equal(t.logo.status, '2 added');
  assert.deepEqual(t.logo.thumbs, ['https://cdn.example/logo.png']);
  assert.equal(t.colours.status, '2 added');
  assert.deepEqual(t.colours.swatches, ['#F5A623', '#14203A']);
  assert.equal(t.fonts.status, 'Added');
  assert.equal(t.fonts.font, 'Playfair Display');
  assert.equal(t.people.status, '2 added');
  assert.deepEqual(t.people.thumbs, ['https://x/p1.jpg'], 'only web pictures are shown');
  assert.equal(t.people.to, '/reels');
  assert.equal(t.places.status, '1 added');
  assert.equal(t.places.tab, 'environment');
  assert.equal(t.products.status, '3 added');
  assert.equal(t.products.state, 'partly');
  assert.equal(t.products.line, '1 without a photo');
  assert.equal(t.memory.status, '5 learned');
  assert.equal(t.memory.to, '/analytics?tab=learned');
  assert.deepEqual(brandProgress(brandTiles(full)), { done: 6, total: 6, unknown: 0, text: '6 of 6 set up. Open a tile to add or change it.' });
});

test('a new account sees Missing everywhere; placeholder colours do not count', () => {
  const t = brandTiles({ logos: [], profile: { assets: { primaryColor: '#111111', secondaryColor: '#ffcc29' } }, assets: [], products: [], memory: { notes: 0, tracked: 0 } });
  const placeholder = brandTiles({ logos: [], profile: { assets: {} }, assets: [], products: [], memory: { notes: 0, tracked: 2 } });
  assert.deepEqual(placeholder.map((x) => x.status), ['Missing', 'Missing', 'Missing', 'Missing', 'Missing', 'Missing', 'Learning']);
  assert.equal(t[1].status, 'Missing', 'the default pair a new account starts with is not the customer\'s colours');
  assert.equal(t[6].status, 'Not started');
});

test('a failed source says Could not check, never Missing', () => {
  const t = brandTiles({ logos: null, profile: null, profileFailed: true, assets: null, products: null, memory: null });
  for (const x of t) { assert.equal(x.status, 'Could not check'); assert.equal(x.state, 'unknown'); }
  assert.match(brandProgress(t).text, /could not check your brand/);
  assert.equal(brandProgress(brandTiles({ ...full, products: null })).text, '5 of 6 set up. 1 could not be checked just now.');
});

test('spans fill every row for seven tiles on four and two columns', () => {
  for (const cols of [4, 2, 3]) {
    const spans = tileSpans(7, cols);
    for (const row of rowsOf(spans, cols)) assert.equal(row.reduce((n, i) => n + spans[i], 0), cols);
  }
  assert.deepEqual(tileSpans(7, 4), [1, 1, 1, 1, 1, 1, 2]);
});

test('Blueprint form tiles follow what has been typed', () => {
  const empty = blueprintFormTiles({});
  assert.deepEqual(empty.map((t) => t.status), ['Missing', 'Missing', 'Missing', 'Optional']);
  assert.equal(empty[0].field, 'bp-name');
  const some = blueprintFormTiles({ businessName: 'Sunrise Bakery', whatYouSell: 'Fresh bread every morning', instagram: '@sunrise', goal: 'sales', colours: ['#F5A623'], competitors: [{ name: '', url: '' }] });
  assert.equal(some[0].status, '2 of 3 added');
  assert.equal(some[0].field, 'bp-for');
  assert.equal(some[1].status, 'Added');
  assert.equal(some[1].line, 'Instagram');
  assert.equal(some[2].line, 'More sales');
  assert.equal(some[3].status, '1 of 4 added');
  assert.equal(some[3].field, 'bp-competitors');
});

test('finished Blueprint tiles come from the stored pages', () => {
  const tiles = blueprintPartTiles({ pages: [
    { n: 1, id: 'where-today', title: 'Where you are today', purpose: 'What can be confirmed.', sections: [{ items: [1, 2, 3] }, { items: [1] }] },
    { n: 4, id: 'content-pillars', title: 'Content pillars', sections: [{ items: [1] }] },
    { n: 6, id: 'offers-hooks', title: 'Offers and hooks', sections: [{ items: [] }] },
    { n: 2, id: 'audience-positioning', title: 'Audience', sections: [{ items: [1] }] },
    null,
  ] });
  assert.deepEqual(tiles.map((t) => t.status), ['3 facts confirmed', '1 pillar', 'Nothing listed', 'Ready']);
  assert.equal(tiles[0].line, 'What can be confirmed.');
  assert.deepEqual(blueprintPartTiles(null), []);
});
