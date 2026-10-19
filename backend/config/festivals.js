'use strict';
/**
 * The approved India days for "Trending for you" (the "Coming up" cards). Only days whose date is certain are listed:
 *   - FIXED_DAYS fall on the same date every year,
 *   - RULE_DAYS are computed (Mother's Day = second Sunday of May, Father's Day = third Sunday of June).
 * Lunar-calendar festivals (Diwali, Holi, Eid, Ganesh Chaturthi, Pongal, Onam, Navratri, Raksha Bandhan and the like)
 * move every year and are deliberately NOT here. To add one, put its owner-approved date per year in LUNAR_DAYS as
 * { id, name, dates: { 2026: 'YYYY-MM-DD', ... } } and extend the test; never guess a date.
 * All dates are India calendar dates; "days away" is counted from today's India date.
 */

const FIXED_DAYS = Object.freeze([
  { id: 'new_year', name: "New Year's Day", month: 1, day: 1 },
  { id: 'republic_day', name: 'Republic Day', month: 1, day: 26 },
  { id: 'valentines_day', name: "Valentine's Day", month: 2, day: 14 },
  { id: 'independence_day', name: 'Independence Day', month: 8, day: 15 },
  { id: 'teachers_day', name: "Teachers' Day", month: 9, day: 5 },
  { id: 'childrens_day', name: "Children's Day", month: 11, day: 14 },
  { id: 'christmas', name: 'Christmas', month: 12, day: 25 }
]);

// nth Sunday of a month (weekday 0 = Sunday).
const RULE_DAYS = Object.freeze([
  { id: 'mothers_day', name: "Mother's Day", month: 5, weekday: 0, nth: 2 },
  { id: 'fathers_day', name: "Father's Day", month: 6, weekday: 0, nth: 3 }
]);

const LUNAR_DAYS = Object.freeze([]);

const DAY = 864e5;
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function nthWeekday(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}

/** Every listed day of one calendar year as { id, name, date: 'YYYY-MM-DD' }. */
function daysInYear(year) {
  const out = FIXED_DAYS.map((d) => ({ id: d.id, name: d.name, date: iso(year, d.month, d.day) }));
  for (const r of RULE_DAYS) out.push({ id: r.id, name: r.name, date: iso(year, r.month, nthWeekday(year, r.month, r.weekday, r.nth)) });
  for (const l of LUNAR_DAYS) if (l.dates && l.dates[year]) out.push({ id: l.id, name: l.name, date: l.dates[year] });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Today's India date as 'YYYY-MM-DD'. */
const istToday = (now) => new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);

/** Days from today (India date) up to `withinDays` ahead, soonest first: { id, name, date, daysAway }. */
function upcoming(now = new Date(), withinDays = 365) {
  const today = istToday(now);
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const year = Number(today.slice(0, 4));
  const out = [];
  for (const y of [year, year + 1]) {
    for (const d of daysInYear(y)) {
      const away = Math.round((Date.parse(`${d.date}T00:00:00Z`) - t0) / DAY);
      if (away >= 0 && away <= withinDays) out.push({ ...d, daysAway: away });
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}

module.exports = { FIXED_DAYS, RULE_DAYS, LUNAR_DAYS, daysInYear, upcoming };
