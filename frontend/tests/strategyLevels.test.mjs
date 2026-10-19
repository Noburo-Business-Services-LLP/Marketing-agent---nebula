import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levelsOf, clampText, currentPhase, STATUS_TEXT, LEVEL_COPY } from '../utils/strategyLevels.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../scripts/visual-audit/plan-fixture.json'), 'utf8'));
const stored = (inner, extra = {}) => ({ id: 'p1', completedAt: '2026-10-10T05:00:00Z', result: { plan: inner }, ...extra });
const FULL = stored(fixture.plan);
const PRODUCTS = [
  { _id: 'a', name: 'Butter croissant', type: 'product', price: 90, currency: 'INR' },
  { _id: 'b', name: 'Custom birthday cake', type: 'service', priceNote: 'From Rs 1,200' },
  { _id: 'c', name: 'Country sourdough', price: 220, currency: 'INR' },
];
const NOW = new Date('2026-10-19T06:00:00Z');
const byId = (levels) => Object.fromEntries(levels.map((l) => [l.id, l]));

test('a full plan gives nine levels in the owner\'s order, numbered 1 to 9', () => {
  const levels = levelsOf(FULL, { products: PRODUCTS, now: NOW });
  assert.deepEqual(levels.map((l) => l.id), ['business', 'products', 'customers', 'positioning', 'mix', 'channels', 'content', 'roadmap', 'numbers']);
  assert.deepEqual(levels.map((l) => l.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const l of levels) {
    assert.ok(l.title && l.summary, `${l.id} has a title and a summary`);
    assert.ok(['ready', 'thin', 'missing'].includes(l.status), `${l.id} status`);
  }
  const L = byId(levels);
  for (const id of ['business', 'products', 'customers', 'positioning', 'mix', 'channels', 'content', 'roadmap', 'numbers']) assert.equal(L[id].status, 'ready', id);
});

test('each level reads the right part of the stored plan', () => {
  const L = byId(levelsOf(FULL, { products: PRODUCTS, now: NOW }));
  assert.match(L.business.summary, /More enquiries for custom cakes/);
  assert.equal(L.products.summary, '3 items: Butter croissant, Custom birthday cake and Country sourdough');
  assert.ok(L.products.items.some((i) => i.text.includes('From Rs 1,200')));
  assert.match(L.customers.summary, /^Parents in Anna Nagar/);
  assert.ok(L.customers.items.some((i) => i.label === 'What makes them buy'));
  assert.equal(L.positioning.summary, 'Baked this morning, a short walk from your home.');
  assert.match(L.channels.summary, /Instagram, WhatsApp and Google Business Profile/);
  const ig = L.channels.items.find((i) => i.label === 'Instagram');
  assert.ok(ig.sub.some((s) => s.label === 'Nebulaa does' && s.text === 'Makes your posts, carousels, videos and captions and hashtags.'));
  assert.ok(ig.sub.some((s) => s.label === 'You do' && /Reply to comments/.test(s.text)));
  assert.match(L.content.summary, /Fresh from the oven, Cakes made to order, Celebrations at home and Behind the counter/);
  assert.equal(L.roadmap.items.length, 3);
  assert.ok(L.numbers.items.length >= 3);
});

test('the marketing mix is computed from the stored channels and formats, never invented', () => {
  const L = byId(levelsOf(FULL, { now: NOW }));
  const mix = L.mix;
  const ig = mix.items.find((i) => i.label === 'Instagram');
  assert.deepEqual(ig.split, { organic: 80, paid: 20 });
  assert.equal(ig.text, '80% organic, 20% paid');
  // Average of 80, 100, 100 organic, rounded.
  assert.match(mix.summary, /93% organic on average/);
  const online = mix.items.find((i) => i.label === 'Online and offline');
  assert.match(online.text, /All 3 channels in this plan are online/);
  assert.match(online.text, /does not include offline activity yet/);
  const formats = mix.items.find((i) => i.label === 'Formats this month');
  const total = fixture.plan.calendar.length;
  const nums = formats.text.match(/\d+/g).map(Number);
  assert.equal(nums.reduce((a, b) => a + b, 0), total);
  assert.match(formats.text, /image posts/);
});

test('mix says plainly when the plan has no paid or organic split', () => {
  const inner = { ...fixture.plan, effort: [] };
  const mix = byId(levelsOf(stored(inner), { now: NOW })).mix;
  assert.equal(mix.status, 'thin');
  assert.ok(mix.items.some((i) => /does not split organic and paid effort yet/.test(i.text)));
  assert.ok(!mix.items.some((i) => i.split));
});

test('a plan with no paid effort says no paid promotion is suggested', () => {
  const inner = { ...fixture.plan, effort: fixture.plan.effort.map((e) => ({ ...e, organicPct: 100, paidPct: 0 })) };
  const mix = byId(levelsOf(stored(inner), { now: NOW })).mix;
  assert.match(mix.summary, /All organic/);
  assert.ok(mix.items.some((i) => /No paid promotion is suggested/.test(i.text)));
});

test('offline rows and metrics are used when a newer plan has them', () => {
  const inner = {
    ...fixture.plan,
    offline: [{ channel: 'Word of mouth and referrals', role: { text: 'Ask regulars to tell a friend.', tag: 'proposed' }, youDo: [{ text: 'Give a small card with each cake.', tag: 'proposed' }] }],
    metrics: [{ phase: 'foundation', ids: ['reach', 'enquiries'], why: { text: 'Shows if people see and ask.', tag: 'proposed' } }],
  };
  const L = byId(levelsOf(stored(inner), { now: NOW }));
  const online = L.mix.items.find((i) => i.label === 'Online and offline');
  assert.match(online.text, /3 online channels and 1 offline/);
  const wom = L.channels.items.find((i) => i.label === 'Word of mouth and referrals');
  assert.ok(wom.sub.some((s) => s.label === 'Nebulaa does' && /Nothing offline/.test(s.text)));
  assert.equal(wom.offline, true);
  assert.ok(L.numbers.items.some((i) => i.label === 'Reach'));
  assert.ok(L.numbers.items.some((i) => i.label === 'Enquiries' && /You track this yourself/.test(i.text)));
});

test('the roadmap marks the phase the account is in today', () => {
  assert.equal(currentPhase('2026-10-10T05:00:00Z', NOW), 'foundation');
  assert.equal(currentPhase('2026-09-01T05:00:00Z', NOW), 'storytelling');
  assert.equal(currentPhase('2026-06-01T05:00:00Z', NOW), 'growth');
  assert.equal(currentPhase(null, NOW), null);
  assert.equal(currentPhase('nonsense', NOW), null);
  const road = byId(levelsOf(FULL, { now: NOW })).roadmap;
  assert.deepEqual(road.items.map((i) => !!i.current), [true, false, false]);
  assert.match(road.summary, /^Now: days 1 to 30, Foundation/);
});

test('a thin plan: some levels have something, others say what is missing', () => {
  const inner = { promise: { text: 'More walk-in customers.', tag: 'proposed' }, pillars: [{ name: 'Daily bakes' }], calendar: [{ day: 1, format: 'reel', pillar: 'Daily bakes' }], channels: [{ channel: 'Instagram', role: { text: 'Show the bakes.' } }] };
  const L = byId(levelsOf(stored(inner), { now: NOW }));
  assert.equal(L.business.status, 'thin');
  assert.equal(L.customers.status, 'missing');
  assert.equal(L.positioning.status, 'missing');
  assert.equal(L.channels.status, 'thin');
  assert.equal(L.content.status, 'thin');
  assert.equal(L.products.status, 'missing');
  // Channels alone still say something true about the mix.
  assert.equal(byId(levelsOf(stored({ channels: [{ channel: 'Instagram' }] }))).mix.status, 'thin');
  assert.equal(L.customers.summary, LEVEL_COPY.customers.missing);
  assert.equal(L.customers.note, STATUS_TEXT.refresh);
});

test('an empty or broken plan never crashes and says "not decided yet" everywhere', () => {
  for (const input of [null, undefined, {}, { result: null }, { result: { plan: null } }, { result: { plan: 'oops' } }, { result: { plan: { icp: 'x', effort: 'y', roadmap: {}, calendar: null, pillars: [null, 3], channels: [{}] } } }]) {
    const levels = levelsOf(input);
    assert.equal(levels.length, 9);
    for (const l of levels) {
      assert.equal(l.status, 'missing', `${l.id} for ${JSON.stringify(input)}`);
      assert.equal(l.summary, LEVEL_COPY[l.id].missing);
      assert.ok(Array.isArray(l.items));
    }
  }
});

test('an old stored plan (before the customer and effort blocks) still works', () => {
  const { icp, effort, ...old } = fixture.plan;
  const L = byId(levelsOf(stored(old), { now: NOW }));
  // Without the customer block, the audience line stands in, marked thin.
  assert.equal(L.customers.status, 'thin');
  assert.match(L.customers.summary, /Families in Anna Nagar/);
  // Channels without effort: roles only, nothing invented about who does what.
  assert.equal(L.channels.status, 'thin');
  assert.ok(L.channels.items.every((i) => !i.sub || !i.sub.some((s) => s.label === 'Nebulaa does' && /Makes/.test(s.text))));
  assert.equal(L.mix.status, 'thin');
  assert.equal(L.business.status, 'ready');
});

test('the page view itself can be passed in, as well as the stored plan', () => {
  const view = { plan: FULL, running: false };
  assert.equal(levelsOf(view, { now: NOW })[0].status, 'ready');
});

test('very long text is clamped on a whole character and marked with an ellipsis', () => {
  const long = 'Cakes '.repeat(200);
  const inner = { ...fixture.plan, promise: { text: long, tag: 'proposed' } };
  const L = byId(levelsOf(stored(inner), { now: NOW }));
  assert.ok(L.business.summary.length <= 141);
  assert.ok(L.business.summary.endsWith('…'));
  assert.ok(L.business.items[0].text.length <= 401);
  assert.equal(clampText('short', 10), 'short');
  assert.equal(clampText('  spaced   out  ', 40), 'spaced out');
  assert.equal(clampText(null, 10), '');
  // A Tamil syllable is never cut in half.
  const ta = 'கேக்'.repeat(50);
  const cut = clampText(ta, 21);
  assert.ok(cut.endsWith('…'));
  const body = cut.slice(0, -1);
  const graphemes = (s) => [...new Intl.Segmenter('ta', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
  assert.equal(body, graphemes(ta).slice(0, graphemes(body).length).join(''));
  assert.ok(graphemes(body).length <= 20);
});

test('plans written in other languages pass through unchanged', () => {
  const inner = {
    ...fixture.plan,
    promise: { text: 'அண்ணா நகரில் உள்ள குடும்பங்களிடமிருந்து அதிக கேக் ஆர்டர்கள்.', tag: 'proposed' },
    positioning: { ...fixture.plan.positioning, line: { text: 'आज सुबह बना, आपके घर के पास।', tag: 'proposed' } },
    pillars: [{ name: 'புதிய ரொட்டி', why: { text: 'தினமும்', tag: 'proposed' } }, { name: 'பிறந்தநாள் கேக்' }, { name: 'பண்டிகை' }],
  };
  const L = byId(levelsOf(stored(inner), { now: NOW }));
  assert.equal(L.business.summary, 'அண்ணா நகரில் உள்ள குடும்பங்களிடமிருந்து அதிக கேக் ஆர்டர்கள்.');
  assert.equal(L.positioning.summary, 'आज सुबह बना, आपके घर के पास।');
  assert.match(L.content.summary, /புதிய ரொட்டி, பிறந்தநாள் கேக் and பண்டிகை/);
});

test('links point to the right place', () => {
  const L = byId(levelsOf(FULL, { products: PRODUCTS, now: NOW }));
  assert.equal(L.business.link.to, '/settings?tab=business');
  assert.equal(L.products.link.to, '/brand-assets?tab=products');
  assert.equal(L.positioning.link.to, '/brand-assets');
  assert.equal(L.channels.link.to, '/dashboard');
  assert.equal(L.content.link.to, '/campaigns');
  assert.equal(L.roadmap.link.to, '/dashboard');
  assert.equal(L.numbers.link.to, '/analytics');
  assert.equal(L.mix.link, undefined);
  const E = byId(levelsOf({}));
  assert.equal(E.business.link.to, '/settings?tab=business');
  assert.equal(E.roadmap.link, undefined);
  assert.equal(E.content.link, undefined);
});

test('products come from the catalogue; with none, the level points to Brand assets', () => {
  const none = byId(levelsOf(FULL, { now: NOW })).products;
  assert.equal(none.status, 'missing');
  assert.match(none.summary, /Add what you sell/);
  assert.equal(none.note, undefined);
  assert.equal(none.link.to, '/brand-assets?tab=products');
  const one = byId(levelsOf(FULL, { products: [{ name: 'Plum cake' }], now: NOW })).products;
  assert.equal(one.status, 'ready');
  assert.equal(one.summary, '1 item: Plum cake');
  const many = byId(levelsOf(FULL, { products: Array.from({ length: 9 }, (_, i) => ({ name: `Cake ${i + 1}` })), now: NOW })).products;
  assert.equal(many.summary, '9 items: Cake 1, Cake 2, Cake 3 and 6 more');
  assert.equal(many.items.length, 9);
  // A list that could not be loaded is not the same as an empty one.
  const failed = byId(levelsOf(FULL, { products: null, now: NOW })).products;
  assert.equal(failed.status, 'missing');
  assert.match(failed.note, /could not load your products/);
  // Junk rows in the catalogue are skipped.
  const junk = byId(levelsOf(FULL, { products: [null, {}, { name: '  ' }, 'x'], now: NOW })).products;
  assert.equal(junk.status, 'missing');
});

// Wording guard: every customer-facing string the helper can produce and the funnel's own copy.
const sources = () => ['../utils/strategyLevels.ts', '../components/StrategyFunnel.tsx'].map((p) => readFileSync(resolve(here, p), 'utf8'));
const BANNED = [/\bcredits?\b/i, /\btrials?\b/i, /\b7[- ]days?\b/i, /—/, /!(?!=)/, /\b(Gravity|Pulsar|Orbit|Ayrshare|OpenAI|Gemini|GPT|Seedance|Meta API)\b/];

test('wording guard: produced text has no vendor names, no credit or trial words, no exclamation marks or em dashes', () => {
  const variants = [
    levelsOf(FULL, { products: PRODUCTS, now: NOW }),
    levelsOf({}),
    levelsOf(stored({ ...fixture.plan, effort: [] }), { now: NOW }),
  ];
  const texts = [];
  for (const levels of variants) for (const l of levels) {
    texts.push(l.title, l.summary, l.note || '', l.link ? l.link.label : '');
    for (const i of l.items) { texts.push(i.label || '', i.text, ...(i.bullets || [])); for (const s of i.sub || []) texts.push(s.label, s.text); }
  }
  texts.push(...Object.values(STATUS_TEXT), ...Object.values(LEVEL_COPY).flatMap((c) => [c.title, c.missing]));
  for (const t of texts) for (const re of BANNED) assert.ok(!re.test(t), `"${t}" matches ${re}`);
});

test('wording guard: the funnel component source has no banned words in its strings', () => {
  for (const src of sources()) {
    const strings = (src.match(/'[^'\n]*'|"[^"\n]*"|>[^<>{}\n]+</g) || []).join('\n');
    for (const re of [BANNED[0], BANNED[1], BANNED[2], BANNED[3], BANNED[5]]) assert.ok(!re.test(strings), `source matches ${re}`);
  }
});
