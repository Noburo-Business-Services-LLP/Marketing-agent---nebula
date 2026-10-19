const test = require('node:test');
const assert = require('node:assert');
const { FIXED_DAYS, RULE_DAYS, LUNAR_DAYS, daysInYear, upcoming } = require('../config/festivals');

test('the table holds only the approved fixed-date and rule-based days; no lunar-calendar day is listed', () => {
  assert.deepStrictEqual(FIXED_DAYS.map((d) => d.id).sort(), ['childrens_day', 'christmas', 'independence_day', 'new_year', 'republic_day', 'teachers_day', 'valentines_day'].sort());
  assert.deepStrictEqual(RULE_DAYS.map((d) => d.id).sort(), ['fathers_day', 'mothers_day']);
  assert.deepStrictEqual(LUNAR_DAYS, [], 'Diwali, Holi, Eid, Ganesh Chaturthi and the like move every year: add them only with owner-approved dates');
  const names = [...FIXED_DAYS, ...RULE_DAYS].map((d) => d.name).join(' ');
  for (const lunar of ['Diwali', 'Holi', 'Eid', 'Ganesh', 'Pongal', 'Onam', 'Navratri', 'Raksha']) assert.ok(!names.includes(lunar), lunar);
});

test('the fixed days fall on their own dates, and the Sunday rules are computed (second Sunday of May, third Sunday of June)', () => {
  const y26 = Object.fromEntries(daysInYear(2026).map((d) => [d.id, d.date]));
  assert.strictEqual(y26.republic_day, '2026-01-26');
  assert.strictEqual(y26.independence_day, '2026-08-15');
  assert.strictEqual(y26.teachers_day, '2026-09-05');
  assert.strictEqual(y26.childrens_day, '2026-11-14');
  assert.strictEqual(y26.christmas, '2026-12-25');
  assert.strictEqual(y26.mothers_day, '2026-05-10');
  assert.strictEqual(y26.fathers_day, '2026-06-21');
  const y27 = Object.fromEntries(daysInYear(2027).map((d) => [d.id, d.date]));
  assert.strictEqual(y27.mothers_day, '2027-05-09');
  assert.strictEqual(y27.fathers_day, '2027-06-20');
  const y28 = Object.fromEntries(daysInYear(2028).map((d) => [d.id, d.date]));
  assert.strictEqual(y28.mothers_day, '2028-05-14', 'May 2028 starts on a Monday');
  assert.strictEqual(y28.fathers_day, '2028-06-18');
});

test('upcoming days are counted in India time and cover the next 12 months, soonest first', () => {
  // 19 October 2026, 23:00 IST = 17:30 UTC. Children's Day is 26 days away.
  const now = new Date('2026-10-19T17:30:00Z');
  const list = upcoming(now, 365);
  assert.strictEqual(list[0].id, 'childrens_day');
  assert.strictEqual(list[0].date, '2026-11-14');
  assert.strictEqual(list[0].daysAway, 26);
  assert.deepStrictEqual(list.map((d) => d.id), ['childrens_day', 'christmas', 'new_year', 'republic_day', 'valentines_day', 'mothers_day', 'fathers_day', 'independence_day', 'teachers_day']);
  assert.ok(list.every((d, i) => i === 0 || d.daysAway >= list[i - 1].daysAway));
  // Just after midnight IST on Christmas Day (still 24 December in UTC) Christmas is today.
  const xmas = upcoming(new Date('2026-12-24T18:40:00Z'), 30);
  assert.strictEqual(xmas[0].id, 'christmas');
  assert.strictEqual(xmas[0].daysAway, 0);
  assert.strictEqual(upcoming(new Date('2026-10-19T06:00:00Z'), 10).length, 0, 'nothing within 10 days of 19 October');
});
