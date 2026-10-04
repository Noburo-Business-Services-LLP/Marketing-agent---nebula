import test from 'node:test';
import assert from 'node:assert/strict';
import { NEBULAA_AREAS, CURRENT_AREA_ID, areaTarget, nextEnabledIndex } from '../utils/appSwitcher.ts';

test('areas are Content (available) then Outreach and Lead generation (not available)', () => {
  assert.deepEqual(NEBULAA_AREAS.map((a) => [a.id, a.label, a.available]), [
    ['content', 'Content', true],
    ['outreach', 'Outreach', false],
    ['leads', 'Lead generation', false],
  ]);
  assert.equal(CURRENT_AREA_ID, 'content');
});

test('unavailable areas never produce a navigation target', () => {
  const [content, outreach, leads] = NEBULAA_AREAS;
  assert.equal(areaTarget(content), '/dashboard');
  assert.equal(areaTarget(outreach), null);
  assert.equal(areaTarget(leads), null);
  assert.equal(areaTarget({ ...content, path: null }), null);
});

test('no agent names appear in labels', () => {
  const text = JSON.stringify(NEBULAA_AREAS).toLowerCase();
  for (const word of ['gravity', 'pulsar', 'orbit']) assert.equal(text.includes(word), false);
});

test('nextEnabledIndex skips unavailable items and wraps', () => {
  const a = (id, available) => ({ id, label: id, path: available ? '/' + id : null, available });
  const areas = [a('one', true), a('two', false), a('three', true)];
  assert.equal(nextEnabledIndex(areas, 0, 1), 2);
  assert.equal(nextEnabledIndex(areas, 2, 1), 0);
  assert.equal(nextEnabledIndex(areas, 0, -1), 2);
  assert.equal(nextEnabledIndex([a('only', true), a('x', false)], 0, 1), 0);
});
