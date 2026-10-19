const test = require('node:test');
const assert = require('node:assert');
const { istWeek, istDay, parseTimeOfDay, compareTimeOfDay, IST_OFFSET_MINUTES } = require('../services/weekIst');

test('IST is five and a half hours ahead of UTC', () => {
  assert.strictEqual(IST_OFFSET_MINUTES, 330);
});

test('a Monday morning IST belongs to the week that starts that day', () => {
  const w = istWeek(new Date('2026-10-12T00:30:00+05:30'));
  assert.strictEqual(w.start, '2026-10-12');
  assert.strictEqual(w.end, '2026-10-19');
  assert.strictEqual(w.startsAt.toISOString(), '2026-10-11T18:30:00.000Z');
  assert.strictEqual(w.endsAt.toISOString(), '2026-10-18T18:30:00.000Z');
  assert.strictEqual(w.previousStart, '2026-10-05');
  assert.strictEqual(w.previousStartsAt.toISOString(), '2026-10-04T18:30:00.000Z');
});

test('Sunday 23:59 IST is still the old week, one minute later is the next', () => {
  assert.strictEqual(istWeek(new Date('2026-10-18T23:59:00+05:30')).start, '2026-10-12');
  assert.strictEqual(istWeek(new Date('2026-10-19T00:00:00+05:30')).start, '2026-10-19');
  assert.strictEqual(istWeek(new Date('2026-10-18T18:29:59.999Z')).start, '2026-10-12');
  assert.strictEqual(istWeek(new Date('2026-10-18T18:30:00.000Z')).start, '2026-10-19');
});

test('Sunday 20:00 UTC is already Monday in India', () => {
  assert.strictEqual(istWeek(new Date('2026-10-11T20:00:00Z')).start, '2026-10-12');
});

test('the seven days are listed, Monday first', () => {
  const w = istWeek(new Date('2026-10-14T10:00:00Z'));
  assert.deepStrictEqual(w.days, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
});

test('month and year ends', () => {
  const w = istWeek(new Date('2026-12-31T12:00:00Z'));
  assert.strictEqual(w.start, '2026-12-28');
  assert.strictEqual(w.end, '2027-01-04');
});

test('an invalid or missing date falls back to now and never throws', () => {
  assert.match(istWeek('nonsense').start, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(istWeek(undefined).start, /^\d{4}-\d{2}-\d{2}$/);
});

test('the day range is midnight to midnight in India', () => {
  const d = istDay(new Date('2026-10-18T19:00:00Z')); // Monday 00:30 IST on the 19th
  assert.strictEqual(d.date, '2026-10-19');
  assert.strictEqual(d.startsAt.toISOString(), '2026-10-18T18:30:00.000Z');
  assert.strictEqual(d.endsAt.toISOString(), '2026-10-19T18:30:00.000Z');
});

test('times of day are compared as real times, not as text', () => {
  assert.strictEqual(parseTimeOfDay('9:00 AM'), 9 * 60);
  assert.strictEqual(parseTimeOfDay('10:00 AM'), 10 * 60);
  assert.strictEqual(parseTimeOfDay('12:00 AM'), 0);
  assert.strictEqual(parseTimeOfDay('12:30 PM'), 12 * 60 + 30);
  assert.strictEqual(parseTimeOfDay('11:59 pm'), 23 * 60 + 59);
  assert.strictEqual(parseTimeOfDay('18:45'), 18 * 60 + 45);
  assert.strictEqual(parseTimeOfDay(''), null);
  assert.strictEqual(parseTimeOfDay('soon'), null);
  assert.strictEqual(parseTimeOfDay('13:00 PM'), null);
  const sorted = ['10:00 AM', '9:00 AM', '1:15 PM', '12:05 AM'].sort(compareTimeOfDay);
  assert.deepStrictEqual(sorted, ['12:05 AM', '9:00 AM', '10:00 AM', '1:15 PM']);
  assert.deepStrictEqual(['x', '9:00 AM'].sort(compareTimeOfDay), ['9:00 AM', 'x']);
});

test('agrees with the weekly proposal week for every hour of three weeks', () => {
  const { weekStartOf } = require('../services/week/weekMath');
  const from = Date.parse('2026-10-01T00:00:00Z');
  for (let h = 0; h < 24 * 21; h++) {
    const at = new Date(from + h * 3600000);
    assert.strictEqual(istWeek(at).start, weekStartOf(at), at.toISOString());
  }
});
