import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indiaMonthKey, addMonth, nextPlanMonth, pickHeroCalendar, heroTitle, monthCounts, weekOfMonth, heroAction,
  topValues, formatMix, planInputs, NOT_SET, monthName,
} from '../utils/calendarHero.ts';

test('India month key turns over at India midnight, not UTC midnight', () => {
  assert.equal(indiaMonthKey(Date.UTC(2026, 9, 31, 18, 29)), '2026-10');
  assert.equal(indiaMonthKey(Date.UTC(2026, 9, 31, 18, 31)), '2026-11');
});

test('addMonth and nextPlanMonth follow the server rule', () => {
  assert.equal(addMonth('2026-12'), '2027-01');
  assert.equal(addMonth('2026-01', -1), '2025-12');
  assert.equal(nextPlanMonth([], '2026-10'), '2026-10');
  assert.equal(nextPlanMonth([{ month: '2026-09' }, { month: '2026-11' }, { month: 'junk' }], '2026-10'), '2026-12');
});

test('hero month: this month, else the nearest coming, else the newest past', () => {
  const h = [{ month: '2026-08' }, { month: '2026-12' }, { month: '2026-11' }];
  assert.equal(pickHeroCalendar(h, '2026-11').month, '2026-11');
  assert.equal(pickHeroCalendar(h, '2026-10').month, '2026-11');
  assert.equal(pickHeroCalendar(h, '2027-03').month, '2026-12');
  assert.equal(pickHeroCalendar([], '2026-10'), null);
});

test('hero title', () => {
  assert.equal(heroTitle('Audit Bakery', '2026-10'), "Audit Bakery's October posts");
  assert.equal(heroTitle('Sweets', '2026-10'), "Sweets' October posts");
  assert.equal(heroTitle('  ', '2026-03'), 'Your March posts');
  assert.equal(heroTitle('', 'bad'), 'Your monthly posts');
  assert.equal(monthName('2026-13'), '');
});

test('counts: rejected days are not planned; approved includes everything further along', () => {
  const items = ['draft', 'approved', 'rejected', 'generated', 'scheduled', 'published', 'generating', undefined].map((status) => ({ status }));
  assert.deepEqual(monthCounts(items), { planned: 7, approved: 5, published: 1 });
  assert.deepEqual(monthCounts([]), { planned: 0, approved: 0, published: 0 });
});

test('week of month matches the old week button', () => {
  assert.deepEqual([1, 7, 8, 14, 15, 21, 22, 31].map(weekOfMonth), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('hero action follows the stored state', () => {
  assert.deepEqual(heroAction(null, { inList: true, week: 1, nextMonth: '2026-11' }), { kind: 'plan', label: 'Plan November' });
  assert.deepEqual(heroAction({ month: '2026-10' }, { inList: true, week: 2 }), { kind: 'open', label: 'Open October' });
  assert.deepEqual(heroAction({ month: '2026-10', approved: false }, { inList: false, week: 2 }), { kind: 'approve', label: 'Approve this month' });
  assert.deepEqual(heroAction({ month: '2026-10', approved: true }, { inList: false, week: 3 }), { kind: 'make-week', label: 'Make week 3 posts' });
});

test('topValues and formatMix', () => {
  assert.deepEqual(topValues(['A', 'b', 'a', '', null, 'B', 'B', 'c'], 2), [{ value: 'b', count: 3 }, { value: 'A', count: 2 }]);
  assert.equal(formatMix([{ format: 'Post' }, { format: 'post' }, { format: 'Reel' }, {}]), '3 posts, 1 reel');
});

test('plan inputs come only from stored fields and say when something is not set', () => {
  const cal = {
    language: 'tamil', businessVertical: 'Bakery', niche: 'bakery',
    weeks: [{ items: [
      { objective: 'Awareness', contentPillar: 'Behind the scenes', productNeeded: 'Sourdough loaf', format: 'Post' },
      { objective: 'engagement', contentPillar: 'Product', productNeeded: 'Sourdough loaf', format: 'Reel' },
      { objective: 'awareness', contentPillar: 'Behind the scenes', productNeeded: '', format: 'Carousel' },
    ] }],
  };
  const inputs = planInputs(cal);
  assert.deepEqual(inputs.map((i) => i.key), ['language', 'business', 'goals', 'pillars', 'products', 'formats']);
  const by = Object.fromEntries(inputs.map((i) => [i.key, i]));
  assert.deepEqual(by.language.values, ['Tamil']);
  assert.deepEqual(by.business.values, ['Bakery']);
  assert.deepEqual(by.goals.values, ['Awareness', 'Engagement']);
  assert.deepEqual(by.pillars.values, ['Behind the scenes', 'Product']);
  assert.deepEqual(by.products.values, ['Sourdough loaf']);
  assert.deepEqual(by.formats.values, ['1 post, 1 reel, 1 carousel']);
  const bare = Object.fromEntries(planInputs({ language: '', weeks: [] }).map((i) => [i.key, i]));
  assert.equal(bare.products.empty, true);
  assert.deepEqual(bare.products.values, [NOT_SET]);
  assert.deepEqual(planInputs(null), []);
});

// Load-test week 1: GET /content-calendar only reads; a month that is not prepared shows "Prepare this month" (POST /prepare).
test('a month that is not prepared offers "Prepare this month"; otherwise the actions are unchanged', async () => {
  const { heroAction: act, thisMonthMissing } = await import('../utils/calendarHero.ts');
  assert.equal(thisMonthMissing([], '2026-10'), true);
  assert.equal(thisMonthMissing([{ month: '2026-11' }], '2026-10'), true);
  assert.equal(thisMonthMissing([{ month: '2026-10' }], '2026-10'), false);
  assert.deepEqual(act(null, { inList: true, week: 1, nextMonth: '2026-10', todayMonth: '2026-10' }), { kind: 'prepare', label: 'Prepare this month' });
  assert.equal(act(null, { inList: true, week: 1, nextMonth: '2026-12', todayMonth: '2026-10' }).kind, 'plan');
  assert.equal(act(null, { inList: true, week: 1, nextMonth: '2026-12' }).kind, 'plan');
});

test('the Calendar tab prepares through POST /prepare and polls; no screen relies on GET to make a month', async () => {
  const fs = await import('node:fs');
  const api = fs.readFileSync(new URL('../services/api.ts', import.meta.url), 'utf8');
  assert.match(api, /prepare: async[\s\S]{0,200}'\/content-calendar\/prepare', \{ method: 'POST'/);
  const page = fs.readFileSync(new URL('../pages/ContentCalendar.tsx', import.meta.url), 'utf8');
  assert.match(page, /contentCalendarAPI\.prepare\(/);
  assert.match(page, /if \(prep !== 'preparing'\) return;[\s\S]{0,400}contentCalendarAPI\.get\(\)/);
  assert.match(page, /onClick: handlePrepare, busy: preparing/);
  assert.match(page, /Free: preparing the plan and its cover picture takes no Quarks\./);
  const picker = fs.readFileSync(new URL('../components/CalendarIdeaPicker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /status === 'preparing'/);
});
