function safeDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isDateOnlyString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function parseDateOnlyString(value) {
  if (!isDateOnlyString(value)) return null;
  const [yearStr, monthStr, dayStr] = value.trim().split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);

  if (!Number.isFinite(year) || year < 1970 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  // Basic validity check (e.g., reject 2026-02-31).
  const test = new Date(Date.UTC(year, month - 1, day));
  if (test.getUTCFullYear() !== year || test.getUTCMonth() !== month - 1 || test.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Accepts:
 * - "HH:mm" / "H:mm" (24h)
 * - "h:mm AM" / "h:mm PM" (12h)
 * - "h AM" / "h PM"
 * Returns { hour, minute, normalized } where normalized is "HH:mm".
 */
function parseTimeString(input) {
  if (input === undefined || input === null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  const ampmMatch = upper.match(/\b(AM|PM)\b/);
  const hasAmPm = Boolean(ampmMatch);
  const ampm = ampmMatch ? ampmMatch[1] : null;

  const timePart = hasAmPm ? upper.replace(/\b(AM|PM)\b/, '').trim() : upper.trim();
  if (!timePart) return null;

  const parts = timePart.split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return null;

  const hourRaw = Number.parseInt(parts[0], 10);
  if (!Number.isFinite(hourRaw)) return null;

  const minuteRaw = parts.length >= 2 ? Number.parseInt(parts[1], 10) : 0;
  if (!Number.isFinite(minuteRaw)) return null;

  if (minuteRaw < 0 || minuteRaw > 59) return null;

  let hour24 = hourRaw;
  if (hasAmPm) {
    if (hourRaw < 1 || hourRaw > 12) return null;
    if (ampm === 'AM') {
      hour24 = hourRaw === 12 ? 0 : hourRaw;
    } else {
      hour24 = hourRaw === 12 ? 12 : hourRaw + 12;
    }
  } else {
    if (hourRaw < 0 || hourRaw > 23) return null;
  }

  return {
    hour: hour24,
    minute: minuteRaw,
    normalized: `${pad2(hour24)}:${pad2(minuteRaw)}`,
  };
}

function normalizeTimezoneOffsetMinutes(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  // Real-world offsets are within [-14:00, +14:00]
  if (n < -14 * 60 || n > 14 * 60) return null;
  return Math.trunc(n);
}

/**
 * Build a UTC Date for a local (date + time-of-day) using the provided timezoneOffsetMinutes.
 *
 * timezoneOffsetMinutes should match `Date#getTimezoneOffset()` for the user's selected local date/time.
 * It is defined as UTC - Local (e.g., New York winter = 300).
 */
function buildUtcDateFromLocalDateTime({ date, time, timezoneOffsetMinutes }) {
  const dateParts = parseDateOnlyString(date);
  const timeParts = parseTimeString(time);
  if (!dateParts || !timeParts) return null;

  const offset = normalizeTimezoneOffsetMinutes(timezoneOffsetMinutes) ?? 0;
  const utcMs =
    Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hour, timeParts.minute, 0, 0) +
    offset * 60 * 1000;
  return safeDate(utcMs);
}

/**
 * Normalize/validate a Campaign scheduling payload.
 * - If `startDate` is "YYYY-MM-DD", combines with `postTime` (+ optional timezoneOffsetMinutes) into a UTC Date.
 * - If `startDate` is already a datetime, validates it.
 * - Normalizes `postTime` to "HH:mm" when provided.
 */
function normalizeCampaignScheduling(scheduling = {}) {
  const next = { ...(scheduling || {}) };

  let normalizedPostTime = null;
  if (next.postTime !== undefined) {
    const parsedTime = parseTimeString(next.postTime);
    if (!parsedTime) {
      const err = new Error('postTime must be a valid time (HH:mm or h:mm AM/PM)');
      err.code = 'INVALID_POST_TIME';
      throw err;
    }
    normalizedPostTime = parsedTime.normalized;
    next.postTime = normalizedPostTime;
  }

  if (next.startDate !== undefined) {
    if (isDateOnlyString(next.startDate)) {
      const timeToUse = normalizedPostTime || next.postTime;
      if (!timeToUse) {
        const err = new Error('postTime is required when startDate is a date-only value (YYYY-MM-DD)');
        err.code = 'MISSING_POST_TIME';
        throw err;
      }

      const scheduled = buildUtcDateFromLocalDateTime({
        date: next.startDate,
        time: timeToUse,
        timezoneOffsetMinutes: next.timezoneOffsetMinutes,
      });

      if (!scheduled) {
        const err = new Error('startDate and postTime must form a valid datetime');
        err.code = 'INVALID_SCHEDULE_DATETIME';
        throw err;
      }

      next.startDate = scheduled;
    } else {
      const d = safeDate(next.startDate);
      if (!d) {
        const err = new Error('startDate must be a valid date or ISO datetime');
        err.code = 'INVALID_START_DATE';
        throw err;
      }
      next.startDate = d;
    }
  }

  if (next.timezoneOffsetMinutes !== undefined) {
    const normalizedOffset = normalizeTimezoneOffsetMinutes(next.timezoneOffsetMinutes);
    if (normalizedOffset === null) {
      const err = new Error('timezoneOffsetMinutes must be a valid number of minutes (UTC - local)');
      err.code = 'INVALID_TIMEZONE_OFFSET';
      throw err;
    }
    next.timezoneOffsetMinutes = normalizedOffset;
  }

  return next;
}

/**
 * Returns the campaign's scheduled datetime as a Date (UTC).
 * Prefers `campaign.scheduling.startDate` when it contains a time-of-day.
 * Falls back to combining date-only `startDate` + `postTime` in UTC.
 */
function getCampaignScheduledFor(campaign) {
  const start = safeDate(campaign?.scheduling?.startDate);
  if (!start) return null;

  const hasTime =
    start.getUTCHours() !== 0 ||
    start.getUTCMinutes() !== 0 ||
    start.getUTCSeconds() !== 0 ||
    start.getUTCMilliseconds() !== 0;

  if (hasTime) return start;

  const postTime = campaign?.scheduling?.postTime;
  const parsedTime = parseTimeString(postTime || '');
  if (!parsedTime) return start;

  const scheduled = new Date(start);
  scheduled.setUTCHours(parsedTime.hour, parsedTime.minute, 0, 0);
  return scheduled;
}

module.exports = {
  safeDate,
  isDateOnlyString,
  parseDateOnlyString,
  parseTimeString,
  normalizeTimezoneOffsetMinutes,
  buildUtcDateFromLocalDateTime,
  normalizeCampaignScheduling,
  getCampaignScheduledFor,
};

