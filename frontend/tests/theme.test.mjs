import test from 'node:test';
import assert from 'node:assert/strict';
import { forceLightTheme } from '../utils/theme.ts';

function fakeDoc(initial = ['dark', 'x']) {
  const classes = new Set(initial);
  return {
    classes,
    documentElement: { classList: { remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } },
  };
}

test('removes the dark class and the stored dark preference', () => {
  const doc = fakeDoc();
  const removed = [];
  forceLightTheme(doc, { removeItem: (k) => removed.push(k) });
  assert.equal(doc.classes.has('dark'), false);
  assert.equal(doc.classes.has('x'), true);
  assert.deepEqual(removed, ['nebulaa-theme']);
});

test('works without storage and survives a throwing storage', () => {
  const doc = fakeDoc();
  forceLightTheme(doc, null);
  forceLightTheme(doc, { removeItem: () => { throw new Error('blocked'); } });
  assert.equal(doc.classes.has('dark'), false);
});
