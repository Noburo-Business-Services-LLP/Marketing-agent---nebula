import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPlanDay, sortPlanItems, monthGrid, weekRangeLabel, groupItemsByDay } from '../utils/calendarPlan.ts';

test('formatPlanDay gives the real date with weekday', () => {
  assert.equal(formatPlanDay('2026-10', 1), 'October 1 (Thursday)');
  assert.equal(formatPlanDay('2026-10', 2), 'October 2 (Friday)');
  assert.equal(formatPlanDay('2026-12', 31), 'December 31 (Thursday)');
});

test('formatPlanDay falls back to Day N', () => {
  assert.equal(formatPlanDay('2026-02', 29), 'Day 29');
  assert.equal(formatPlanDay('2024-02', 29), 'February 29 (Thursday)');
  assert.equal(formatPlanDay('', 3), 'Day 3');
  assert.equal(formatPlanDay(undefined, 3), 'Day 3');
  assert.equal(formatPlanDay('2026-13', 3), 'Day 3');
  assert.equal(formatPlanDay('October', 3), 'Day 3');
  assert.equal(formatPlanDay('2026-10', 0), 'Day 0');
  assert.equal(formatPlanDay('2026-10', 40), 'Day 40');
});

test('sortPlanItems orders by day, posts before reels, stable, no mutation', () => {
  const input = [
    { _id: 'a', day: 4, format: 'Post' },
    { _id: 'r3', day: 3, format: 'Reel' },
    { _id: 'p3', day: 3, format: 'Carousel' },
    { _id: 'b', day: 4, format: 'Story' },
    { _id: 'r1', day: 1, format: 'Reel' },
  ];
  const copy = JSON.parse(JSON.stringify(input));
  const out = sortPlanItems(input);
  assert.deepEqual(out.map((i) => i._id), ['r1', 'p3', 'r3', 'a', 'b']);
  assert.deepEqual(input, copy);
  assert.notEqual(out, input);
});

test('monthGrid is Monday first with leading blanks', () => {
  const cells = monthGrid('2026-10');
  assert.equal(cells.length % 7, 0);
  assert.equal(cells.filter((c) => c.day !== null).length, 31);
  assert.deepEqual(cells.slice(0, 4).map((c) => c.day), [null, null, null, 1]);
  assert.equal(cells[3].day, 1);
  assert.equal(cells.length, 35);
  assert.deepEqual(monthGrid('bad'), []);
});

test('groupItemsByDay groups and orders', () => {
  const g = groupItemsByDay([
    { _id: 'a', day: 4, format: 'Post' },
    { _id: 'b', day: 3, format: 'Reel' },
    { _id: 'c', day: 4, format: 'Reel' },
  ]);
  assert.deepEqual(g.map((x) => x.day), [3, 4]);
  assert.deepEqual(g[1].items.map((i) => i._id), ['a', 'c']);
});

test('weekRangeLabel', () => {
  assert.equal(weekRangeLabel([{ day: 1 }, { day: 4 }, { day: 2 }], '2026-10'), 'October 1 to 4');
  assert.equal(weekRangeLabel([{ day: 5 }], '2026-10'), 'October 5');
  assert.equal(weekRangeLabel([], '2026-10'), '');
  assert.equal(weekRangeLabel([{ day: 5 }, { day: 9 }], ''), 'Days 5 to 9');
});

import { coverFallbackText, shouldShowCoverImage } from '../utils/calendarPlan.ts';
import { readFileSync } from 'node:fs';

test('cover fallback words: month name, year and business', () => {
  const t = coverFallbackText('2026-10', 'Audit Bakery');
  assert.equal(t.monthName, 'October'); assert.equal(t.year, '2026'); assert.equal(t.business, 'Audit Bakery');
  assert.equal(t.label, 'October, 2026, Audit Bakery');
  assert.equal(coverFallbackText('', '').monthName, 'Your plan');
  assert.equal(coverFallbackText('2026-13', null).label, 'Your plan');
  assert.equal(coverFallbackText('2026-02', 'x'.repeat(90)).business.length, 40);
});

test('the picture is used only when it is a real address that has not failed to load', () => {
  assert.equal(shouldShowCoverImage('https://res.cloudinary.com/x.jpg'), true);
  assert.equal(shouldShowCoverImage(''), false);
  assert.equal(shouldShowCoverImage(undefined), false);
  assert.equal(shouldShowCoverImage('data:image/png;base64,AAAA'), false);
  assert.equal(shouldShowCoverImage('https://a/b.jpg', 'https://a/b.jpg'), false);
  assert.equal(shouldShowCoverImage('https://a/new.jpg', 'https://a/b.jpg'), true);
});

test('both cover spots use the fallback component, which handles a broken picture', () => {
  // The month cards (ContentCalendar) and the month hero (MonthHero, list and detail views).
  const page = readFileSync(new URL('../pages/ContentCalendar.tsx', import.meta.url), 'utf8')
    + readFileSync(new URL('../components/calendar/MonthHero.tsx', import.meta.url), 'utf8');
  const cover = readFileSync(new URL('../components/calendar/CalendarCover.tsx', import.meta.url), 'utf8');
  assert.equal((page.match(/<CalendarCover /g) || []).length, 2);
  assert.match(page, /tone="light"/);
  assert.match(cover, /onError=/);
  assert.match(cover, /font-serif-display/);
});
