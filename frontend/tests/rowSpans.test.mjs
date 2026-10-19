import test from 'node:test';
import assert from 'node:assert/strict';
import { fillRows, rowsOf } from '../utils/rowSpans.ts';

const full = (spans, cols) => rowsOf(spans, cols).every((r) => r.reduce((n, i) => n + spans[i], 0) === cols);

test('the nine My plan tiles fill every row on three columns', () => {
  const spans = fillRows([1, 1, 1, 2, 1, 2, 1, 3, 3], 3);
  assert.deepEqual(spans, [1, 1, 1, 2, 1, 2, 1, 3, 3]);
  assert.ok(full(spans, 3));
});

test('a level that is not decided yet (one column) does not leave a hole: its neighbour widens', () => {
  const spans = fillRows([1, 1, 1, 1, 1, 2, 1, 3, 3], 3);
  assert.deepEqual(spans, [1, 1, 1, 1, 2, 2, 1, 3, 3]);
  assert.ok(full(spans, 3));
});

test('two columns: the odd tile before a full-width one becomes full width', () => {
  const spans = fillRows([1, 1, 1, 1, 1, 1, 1, 2, 2], 2);
  assert.deepEqual(spans, [1, 1, 1, 1, 1, 1, 2, 2, 2]);
  assert.ok(full(spans, 2));
});

test('the last row is closed, wants larger than the grid are cut, bad values count as one', () => {
  assert.deepEqual(fillRows([1, 1, 1, 1], 3), [1, 1, 1, 3]);
  assert.deepEqual(fillRows([5, 0, 'x'], 3), [3, 1, 2]);
  assert.deepEqual(fillRows([], 3), []);
  assert.deepEqual(fillRows([1, 1], 1), [1, 1]);
});

test('any mix of wants on 1 to 4 columns gives only full rows', () => {
  for (let seed = 1; seed < 300; seed++) {
    const wants = Array.from({ length: (seed % 11) + 1 }, (_, i) => ((seed * 7 + i * 13) % 4) + 1);
    for (const cols of [1, 2, 3, 4]) assert.ok(full(fillRows(wants, cols), cols), `${wants} on ${cols}`);
  }
});
