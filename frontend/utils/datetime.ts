export function formatLocalDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getLocalTodayYYYYMMDD(): string {
  return formatLocalDateYYYYMMDD(new Date());
}

function parseDateOnly(dateStr: string): { year: number; month: number; day: number } | null {
  const s = String(dateStr || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (!Number.isFinite(year) || year < 1970 || year > 2100) return null;
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  const test = new Date(Date.UTC(year, month - 1, day));
  if (test.getUTCFullYear() !== year || test.getUTCMonth() !== month - 1 || test.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
}

/**
 * Accepts:
 * - "HH:mm" / "H:mm" (24h)
 * - "h:mm AM" / "h:mm PM" (12h)
 * - "h AM" / "h PM"
 * Returns normalized "HH:mm", or null if invalid.
 */
export function parseTimeToHHMM(input: string): string | null {
  const raw = String(input || '').trim();
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
  const minuteRaw = parts.length >= 2 ? Number.parseInt(parts[1], 10) : 0;

  if (!Number.isFinite(hourRaw) || !Number.isFinite(minuteRaw)) return null;
  if (minuteRaw < 0 || minuteRaw > 59) return null;

  let hour24 = hourRaw;
  if (hasAmPm) {
    if (hourRaw < 1 || hourRaw > 12) return null;
    if (ampm === 'AM') hour24 = hourRaw === 12 ? 0 : hourRaw;
    else hour24 = hourRaw === 12 ? 12 : hourRaw + 12;
  } else {
    if (hourRaw < 0 || hourRaw > 23) return null;
  }

  return `${String(hour24).padStart(2, '0')}:${String(minuteRaw).padStart(2, '0')}`;
}

export function buildLocalDateTime(dateStr: string, timeStr: string): Date | null {
  const date = parseDateOnly(dateStr);
  const time = parseTimeToHHMM(timeStr);
  if (!date || !time) return null;

  const [hourStr, minuteStr] = time.split(':');
  const hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minuteStr, 10);

  const d = new Date(date.year, date.month - 1, date.day, hour, minute, 0, 0);
  if (Number.isNaN(d.getTime())) return null;

  // Ensure the date didn't roll over due to invalid inputs.
  if (d.getFullYear() !== date.year || d.getMonth() !== date.month - 1 || d.getDate() !== date.day) return null;
  // Guard against DST-skipped local times (e.g., 02:30 during spring forward).
  if (d.getHours() !== hour || d.getMinutes() !== minute) return null;

  return d;
}

export function getTimezoneOffsetMinutesForLocalDateTime(dateStr: string, timeStr: string): number | null {
  const d = buildLocalDateTime(dateStr, timeStr);
  if (!d) return null;
  return d.getTimezoneOffset();
}

export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
