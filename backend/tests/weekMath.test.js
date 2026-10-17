const test = require('node:test');
const assert = require('node:assert');
const { weekStartOf, weekDays, dayOfMonth } = require('../services/week/weekMath');

test('the week starts on Monday in India time', () => {
  assert.strictEqual(weekStartOf(new Date('2026-10-17T06:00:00Z')), '2026-10-12'); // Saturday
  assert.strictEqual(weekStartOf(new Date('2026-10-12T00:30:00+05:30')), '2026-10-12'); // Monday just after midnight IST
  assert.strictEqual(weekStartOf(new Date('2026-10-11T20:00:00Z')), '2026-10-12'); // Sunday 20:00 UTC is already Monday 01:30 IST
  assert.strictEqual(weekStartOf(new Date('2026-10-18T17:00:00Z')), '2026-10-12'); // Sunday 22:30 IST
});
test('week days and month ends', () => {
  assert.deepStrictEqual(weekDays('2026-10-26'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.strictEqual(dayOfMonth('2026-11-01'), 1);
});
