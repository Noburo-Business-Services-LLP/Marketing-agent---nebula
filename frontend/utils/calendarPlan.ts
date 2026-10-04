// Pure helpers for the Plan view of the content calendar. No React, no browser APIs, no
// locale or timezone use: Node runs this file directly in tests.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type PlanLike = { day: number; format?: string };

const parseMonth = (month?: string | null): { y: number; m: number } | null => {
  const hit = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim());
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  return m >= 1 && m <= 12 ? { y, m } : null;
};

export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const formatPlanDay = (month: string | null | undefined, day: number): string => {
  const fallback = `Day ${day}`;
  const parsed = parseMonth(month);
  const d = Number(day);
  if (!parsed || !Number.isInteger(d) || d < 1 || d > daysInMonth(parsed.y, parsed.m)) return fallback;
  const weekday = new Date(Date.UTC(parsed.y, parsed.m - 1, d)).getUTCDay();
  return `${MONTHS[parsed.m - 1]} ${d} (${WEEKDAYS[weekday]})`;
};

export const isReelFormat = (format?: string | null): boolean => /reel|video/i.test(String(format || ''));

export const sortPlanItems = <T extends PlanLike>(items: T[]): T[] =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      (Number(a.item.day) - Number(b.item.day))
      || (Number(isReelFormat(a.item.format)) - Number(isReelFormat(b.item.format)))
      || (a.index - b.index))
    .map((x) => x.item);

/** Flat 7-column cells, Monday first (the backend's weeks run Monday to Sunday). */
export const monthGrid = (month: string | null | undefined): Array<{ day: number | null }> => {
  const parsed = parseMonth(month);
  if (!parsed) return [];
  const lead = (new Date(Date.UTC(parsed.y, parsed.m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: Array<{ day: number | null }> = [];
  for (let i = 0; i < lead; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth(parsed.y, parsed.m); d++) cells.push({ day: d });
  while (cells.length % 7 !== 0) cells.push({ day: null });
  return cells;
};

export const groupItemsByDay = <T extends PlanLike>(items: T[]): Array<{ day: number; items: T[] }> => {
  const groups: Array<{ day: number; items: T[] }> = [];
  for (const item of sortPlanItems(items)) {
    const last = groups[groups.length - 1];
    if (last && last.day === item.day) last.items.push(item);
    else groups.push({ day: item.day, items: [item] });
  }
  return groups;
};

export const weekRangeLabel = (items: Array<{ day: number }>, month: string | null | undefined): string => {
  if (!items.length) return '';
  const days = items.map((i) => Number(i.day));
  const first = Math.min(...days);
  const last = Math.max(...days);
  const parsed = parseMonth(month);
  if (!parsed) return first === last ? `Day ${first}` : `Days ${first} to ${last}`;
  const name = MONTHS[parsed.m - 1];
  return first === last ? `${name} ${first}` : `${name} ${first} to ${last}`;
};
