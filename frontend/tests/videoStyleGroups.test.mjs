import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { STYLE_GROUPS, GROUPED_KEYS, groupOf, groupLabel, filterStyles, styleChips, safeFilter } from '../utils/videoStyleGroups.ts';

const require = createRequire(import.meta.url);
const { STYLES } = require('../../backend/services/studioVideo.js');
const serverKeys = Object.keys(STYLES);
const styles = serverKeys.map((key) => ({ key, label: STYLES[key].label }));

test('every server style is in exactly one group, and no group lists a style the server does not have', () => {
  assert.equal(serverKeys.length, 22);
  assert.equal(new Set(GROUPED_KEYS).size, GROUPED_KEYS.length, 'a key is listed twice');
  assert.deepEqual(GROUPED_KEYS.slice().sort(), serverKeys.slice().sort());
  serverKeys.forEach((k) => assert.ok(groupOf(k), `${k} has no group`));
});

test('the four chips are Ads, Stories, Social and Explainers', () => {
  assert.deepEqual(STYLE_GROUPS.map((g) => g.label), ['Ads', 'Stories', 'Social', 'Explainers']);
  assert.equal(groupOf('product-advertisement'), 'ads');
  assert.equal(groupOf('founder-story'), 'stories');
  assert.equal(groupOf('daily-life-vlog'), 'social');
  assert.equal(groupOf('myth-busting'), 'explainers');
  assert.equal(groupLabel('unboxing'), 'Social');
  assert.equal(groupOf(' Testimonial '), 'stories');
});

test('chips count the styles and the counts add up', () => {
  const chips = styleChips(styles);
  assert.deepEqual(chips.map((c) => c.key), ['all', 'ads', 'stories', 'social', 'explainers']);
  assert.equal(chips[0].count, 22);
  assert.equal(chips.slice(1).reduce((n, c) => n + c.count, 0), 22);
  chips.slice(1).forEach((c) => assert.equal(filterStyles(styles, c.key).length, c.count));
});

test('filter keeps the order and All returns a copy', () => {
  const ads = filterStyles(styles, 'ads').map((s) => s.key);
  assert.deepEqual(ads, serverKeys.filter((k) => groupOf(k) === 'ads'));
  const all = filterStyles(styles, 'all');
  assert.deepEqual(all, styles);
  assert.notEqual(all, styles);
});

test('an unknown style shows under All only; groups without styles get no chip', () => {
  const few = [{ key: 'daily-life-vlog' }, { key: 'cinematic-commercial' }, { key: 'brand-new-style' }];
  assert.equal(groupOf('brand-new-style'), null);
  assert.deepEqual(styleChips(few).map((c) => [c.key, c.count]), [['all', 3], ['ads', 1], ['social', 1]]);
  assert.equal(safeFilter(few, 'stories'), 'all');
  assert.equal(safeFilter(few, 'ads'), 'ads');
  assert.equal(safeFilter(few, 'nonsense'), 'all');
});
