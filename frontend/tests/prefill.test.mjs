import test from 'node:test';
import assert from 'node:assert/strict';
import { setPrefill, takePrefill, nearestLanguage } from '../utils/prefill.ts';
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

test('a prefill is handed over once and then gone', () => {
  const s = mem();
  setPrefill('video', { idea: 'Behind the oven', language: 'english' }, s, 1000);
  assert.deepEqual(takePrefill('video', s, 2000), { idea: 'Behind the oven', language: 'english' });
  assert.equal(takePrefill('video', s, 2000), null);
});
test('a prefill for one screen is not given to the other', () => {
  const s = mem();
  setPrefill('carousel', { topic: 'Five cakes' }, s, 1000);
  assert.equal(takePrefill('video', s, 1500), null);
  assert.deepEqual(takePrefill('carousel', s, 1500), { topic: 'Five cakes' });
});
test('an old prefill is dropped', () => {
  const s = mem();
  setPrefill('video', { idea: 'x' }, s, 1000);
  assert.equal(takePrefill('video', s, 1000 + 16 * 60 * 1000), null);
});
test('broken storage never throws', () => {
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.doesNotThrow(() => setPrefill('video', { idea: 'x' }, bad, 1));
  assert.equal(takePrefill('video', bad, 2), null);
});
test('a plan language maps to the nearest available id', () => {
  const ids = ['english', 'tamil', 'tamil_english_mix'];
  assert.equal(nearestLanguage('Tamil', ids, 'english'), 'tamil');
  assert.equal(nearestLanguage('english', ids, 'tamil'), 'english');
  assert.equal(nearestLanguage('Tamil + English mix', ids, 'english'), 'tamil_english_mix');
  assert.equal(nearestLanguage('Hindi', ids, 'english'), 'english');
  assert.equal(nearestLanguage(undefined, ids, 'english'), 'english');
});
test('the week item ids survive the hand-over', () => {
  const s = mem();
  setPrefill('video', { idea: 'x', weekItemId: 'i1', weekId: '2026-10-12' }, s, 1000);
  assert.deepEqual(takePrefill('video', s, 1500), { idea: 'x', weekItemId: 'i1', weekId: '2026-10-12' });
});
