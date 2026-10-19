// "From the news calendar" (config/trendingEvents.js) and the future trend source interface (services/trends/provider.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../config/trendingEvents');
const F = require('../config/festivals');
const P = require('../services/trends/provider');
const { trendItems, isPlainText, MAX_TRENDING } = require('../services/competitors/bestPosts');

const KINDS = new Set(['sports', 'film', 'festival', 'national_day', 'public_event', 'shopping']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const real = (s) => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

test('every entry is well formed, dated for certain and worded plainly', () => {
  const ids = new Set();
  for (const e of E.EVENTS) {
    assert.ok(e.id && !ids.has(e.id), `unique id ${e.id}`); ids.add(e.id);
    assert.ok(KINDS.has(e.kind), `${e.id} kind`);
    const ways = [Boolean(e.every), Boolean(e.rule), Boolean(e.start || e.end)].filter(Boolean).length;
    assert.strictEqual(ways, 1, `${e.id} has exactly one way to be dated`);
    if (e.every) assert.ok(real(`2027-${String(e.every.month).padStart(2, '0')}-${String(e.every.day).padStart(2, '0')}`), `${e.id} date`);
    if (e.rule) assert.ok(E.RULES[e.rule], `${e.id} rule`);
    if (e.start) { assert.ok(real(e.start) && real(e.end) && e.start <= e.end, `${e.id} range`); }
    assert.ok(Array.isArray(e.industries) && e.industries.length && e.industries.every((t) => E.INDUSTRY_TAGS.includes(t)), `${e.id} tags`);
    for (const s of [e.name, e.idea]) { assert.ok(isPlainText(s), `${e.id}: ${s}`); assert.doesNotMatch(s, /[!—–]/); }
    assert.ok(e.idea.length <= 160 && /\.$/.test(e.idea), `${e.id} idea is one sentence`);
  }
  // No day of config/festivals.js is repeated here (those show as "Coming up").
  const festivalNames = new Set([...F.FIXED_DAYS, ...F.RULE_DAYS].map((d) => d.name));
  for (const e of E.EVENTS) assert.ok(!festivalNames.has(e.name), e.name);
  // Uncertain ones are listed out, never as entries.
  assert.ok(E.NEEDS_A_DATE.length >= 3);
  for (const n of E.NEEDS_A_DATE) assert.ok(!E.EVENTS.some((e) => e.name === n.name));
  assert.match(E.VERSION, DATE);
});

test('computed shopping days: Black Friday is the day after the fourth Thursday of November, Cyber Monday the Monday after', () => {
  assert.deepStrictEqual(E.RULES.black_friday(2026), { month: 11, day: 27 });
  assert.deepStrictEqual(E.RULES.cyber_monday(2026), { month: 11, day: 30 });
  assert.deepStrictEqual(E.RULES.black_friday(2027), { month: 11, day: 26 });
  assert.deepStrictEqual(E.RULES.cyber_monday(2027), { month: 11, day: 29 });
  assert.deepStrictEqual(E.RULES.black_friday(2025), { month: 11, day: 28 });
});

test('industry tags: choices and free text map onto tags; an unknown industry only sees entries for everyone', () => {
  assert.ok(E.industryTags('Restaurants / Cafes / Bars').has('food'));
  assert.ok(E.industryTags('Salon & Spa').has('beauty'));
  assert.ok(E.industryTags('Jewellery').has('jewellery'));
  assert.ok(E.industryTags('Home bakery').has('food'));
  assert.deepStrictEqual([...E.industryTags('')], ['all']);
  assert.deepStrictEqual([...E.industryTags('Something unusual')], ['all']);
});

test('window and industry filter, India dates, running events', () => {
  const now = new Date('2026-10-19T06:00:00Z');
  const food = E.upcomingEvents({ now, withinDays: 30, industry: 'Food & Beverage' });
  const ids = food.map((e) => e.id);
  assert.ok(ids.includes('halloween') && ids.includes('national_unity_day') && ids.includes('world_diabetes_day'));
  assert.ok(!ids.includes('gandhi_jayanti'), 'past days are not shown');
  assert.ok(!ids.includes('black_friday'), 'retail only, and beyond 30 days');
  const h = food.find((e) => e.id === 'halloween');
  assert.deepStrictEqual([h.start, h.daysAway, h.running], ['2026-10-31', 12, false]);
  for (let i = 1; i < food.length; i++) assert.ok(food[i - 1].daysAway <= food[i].daysAway, 'soonest first');
  // Late on 30 October UTC is already 31 October in India.
  const eve = E.upcomingEvents({ now: new Date('2026-10-30T20:00:00Z'), withinDays: 0, industry: 'Food & Beverage' });
  assert.ok(eve.some((e) => e.id === 'halloween' && e.daysAway === 0));
  // A one-time event while it runs.
  const olympics = E.upcomingEvents({ now: new Date('2028-07-20T06:00:00Z'), withinDays: 5, industry: '' }).find((e) => e.id === 'la_olympics_2028');
  assert.deepStrictEqual([olympics.daysAway, olympics.running, olympics.end], [0, true, '2028-07-30']);
  assert.ok(!E.upcomingEvents({ now: new Date('2028-08-05T06:00:00Z'), withinDays: 5 }).some((e) => e.id === 'la_olympics_2028'));
});

test('Trending for you: "From the news calendar" items, at most two, with a plain reason and a brief that names no competitor', () => {
  const now = new Date('2026-10-19T06:00:00Z');
  const news = E.upcomingEvents({ now, withinDays: 30, industry: 'Food & Beverage' });
  const items = trendItems({ news, pillars: ['Fresh bakes'], cards: [{ name: 'Sweet Co', handle: 'sweetco' }], now });
  const n = items.filter((i) => i.source === 'news');
  assert.strictEqual(n.length, 2);
  for (const i of n) {
    assert.strictEqual(i.label, 'From the news calendar');
    assert.match(i.reason, /^(\w+day \d{1,2} \w+, (today|tomorrow|in \d+ days)\.|On now, until .+\.|From .+ to .+\.)$/);
    assert.ok(i.idea && isPlainText(i.idea));
    assert.ok(i.action.brief.length <= 200 && /Fresh bakes/.test(i.action.brief) && !/Sweet Co|sweetco/i.test(i.action.brief));
  }
  assert.strictEqual(n[0].title, 'Halloween');
  assert.ok(items.length <= MAX_TRENDING);
  // Order: festival day before the news items, the plan last.
  const fest = trendItems({ news, festivals: [{ id: 'childrens_day', name: "Children's Day", date: '2026-11-14', daysAway: 26 }], pillars: ['Fresh bakes'], now });
  assert.deepStrictEqual(fest.map((i) => i.source), ['festival', 'news', 'news', 'plan']);
});

test('the trend source interface: none is chosen, it makes no call, and anything a future source returns is checked', async () => {
  const p = P.trendProvider(process.env);
  assert.strictEqual(p.id, 'none');
  assert.strictEqual(p.enabled(), false);
  assert.deepStrictEqual(await p.list({}), []);
  const src = fs.readFileSync(path.join(__dirname, '../services/trends/provider.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /require\(['"](https?|axios|node-fetch|puppeteer|cheerio)['"]\)|\bfetch\(|process\.env\.[A-Z_]*KEY/);
  const out = P.normaliseItems([
    { id: 'A', title: 'Monsoon recipes', reason: 'Searches are rising this week.', sourceUrl: 'https://example.org/a' },
    { title: 'Flood in the city', reason: 'Many people affected.' },
    { title: 'Our rivals are failing', reason: 'x' },
    { title: 'Ok', reason: 'Wow!' },
    { title: 'Tea time', reason: 'Popular.', sourceUrl: 'javascript:alert(1)' }
  ], { label: 'Trending now' });
  assert.deepStrictEqual(out.map((o) => o.title), ['Monsoon recipes', 'Tea time']);
  assert.strictEqual(out[1].sourceUrl, null);
  assert.strictEqual(out[0].id, 'live:a');
});
