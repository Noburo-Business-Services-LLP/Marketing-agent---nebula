import test from 'node:test';
import assert from 'node:assert/strict';
import { etaState, formatElapsed } from '../utils/eta.ts';

test('formats elapsed time as m:ss', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(372), '6:12');
});

test('the bar rises, never reaches 100 and flags overrun', () => {
  const a = etaState(30, 300, 600);
  const b = etaState(600, 300, 600);
  const c = etaState(100000, 300, 600);
  assert.ok(a.percent < b.percent && c.percent <= 95);
  assert.equal(a.over, false);
  assert.equal(c.over, true);
  assert.equal(a.range, '5 to 10 minutes');
  assert.equal(etaState(5, 20, 60).range, '20 to 60 seconds');
});
