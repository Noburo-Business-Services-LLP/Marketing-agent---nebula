'use strict';
// Monday-start weeks and days in India time (IST, UTC+5:30, no daylight saving). The one definition the Home summary uses;
// frontend/utils/week.ts mirrors it so the page and the server never disagree about "this week".
// Pure: no database, no clock of its own (pass `now` in).
const IST_OFFSET_MINUTES = 330;
const MINUTE_MS = 60000;
const DAY_MS = 86400000;
const OFFSET_MS = IST_OFFSET_MINUTES * MINUTE_MS;

const asDate = (value) => {
  const d = value instanceof Date ? value : new Date(value === undefined || value === null ? Date.now() : value);
  return Number.isFinite(d.getTime()) ? d : new Date();
};
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Midnight IST of the calendar day containing `d`, as a UTC millisecond value.
const istMidnight = (d) => {
  const shifted = d.getTime() + OFFSET_MS; // the clock time on an Indian wall
  return Math.floor(shifted / DAY_MS) * DAY_MS - OFFSET_MS;
};

/** The IST calendar day holding `now`: { date: 'YYYY-MM-DD', startsAt, endsAt (exclusive) }. */
function istDay(now) {
  const start = istMidnight(asDate(now));
  return { date: iso(start + OFFSET_MS), startsAt: new Date(start), endsAt: new Date(start + DAY_MS) };
}

/**
 * The Monday-to-Sunday IST week holding `now`.
 * { start, end (the next Monday, exclusive), startsAt, endsAt, previousStart, previousStartsAt, days[7] }
 */
function istWeek(now) {
  const dayStart = istMidnight(asDate(now));
  const weekday = new Date(dayStart + OFFSET_MS).getUTCDay(); // 0 Sunday .. 6 Saturday
  const sinceMonday = (weekday + 6) % 7;
  const startMs = dayStart - sinceMonday * DAY_MS;
  const endMs = startMs + 7 * DAY_MS;
  const prevMs = startMs - 7 * DAY_MS;
  return {
    start: iso(startMs + OFFSET_MS),
    end: iso(endMs + OFFSET_MS),
    startsAt: new Date(startMs),
    endsAt: new Date(endMs),
    previousStart: iso(prevMs + OFFSET_MS),
    previousStartsAt: new Date(prevMs),
    days: Array.from({ length: 7 }, (_, i) => iso(startMs + i * DAY_MS + OFFSET_MS))
  };
}

/** "9:00 AM", "12:30 pm" or "18:45" as minutes after midnight. null when it is not a time. */
function parseTimeOfDay(text) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/.exec(String(text === undefined || text === null ? '' : text));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3].toLowerCase() === 'pm';
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** Sort comparator for times of day. Anything that is not a time goes last. */
function compareTimeOfDay(a, b) {
  const x = parseTimeOfDay(a);
  const y = parseTimeOfDay(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

module.exports = { IST_OFFSET_MINUTES, istWeek, istDay, parseTimeOfDay, compareTimeOfDay };
