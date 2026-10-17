// Week boundaries. Weeks start on Monday in the calendar's own timezone (India).
const DAY_MS = 86400000;

function localDate(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
const parseUtc = (iso) => new Date(`${iso}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);

function weekStartOf(date, tz = 'Asia/Kolkata') {
  const day = parseUtc(localDate(date, tz));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return fmt(new Date(day.getTime() - sinceMonday * DAY_MS));
}

function weekDays(weekStart) {
  const start = parseUtc(weekStart).getTime();
  return Array.from({ length: 7 }, (_, i) => fmt(new Date(start + i * DAY_MS)));
}

const dayOfMonth = (isoDate) => parseInt(String(isoDate).slice(-2), 10);

module.exports = { weekStartOf, weekDays, dayOfMonth };
