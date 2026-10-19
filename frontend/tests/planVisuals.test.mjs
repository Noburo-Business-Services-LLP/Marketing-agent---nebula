import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mixSegments, donutArcs, platformOf, channelCards, pillarChips, shapeCounts, shapeOf, planDay, timelinePct, titleCard, initialsOf, heroStats } from '../utils/planVisuals.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, '../scripts/visual-audit/plan-fixture.json'), 'utf8'));
const stored = (inner) => ({ id: 'p1', completedAt: '2026-10-10T05:00:00Z', result: { plan: inner } });
const FULL = stored(fixture.plan);
const BROKEN = [null, undefined, {}, { result: null }, { result: { plan: 'oops' } }, { result: { plan: { effort: 'y', channels: [{}], pillars: [null, 3], calendar: {}, offline: [{}] } } }];

test('the donut segments are computed from the stored effort split and channel lists', () => {
  const m = mixSegments(FULL);
  // Instagram 80, WhatsApp 100, Google Business Profile 100: average 93 organic.
  assert.deepEqual(m, { organic: 93, paid: 7, splitChannels: 3, online: 3, offline: 0 });
  const withOffline = mixSegments(stored({ ...fixture.plan, offline: [{ channel: 'Referrals' }, { channel: 'Posters' }, { channel: '' }] }));
  assert.equal(withOffline.offline, 2);
  assert.equal(withOffline.online, 3);
  // The page view works as well as the stored run.
  assert.deepEqual(mixSegments({ plan: FULL }), m);
});

test('a plan without a split has no organic or paid segment, never a made-up one', () => {
  const m = mixSegments(stored({ ...fixture.plan, effort: [] }));
  assert.equal(m.organic, null);
  assert.equal(m.paid, null);
  assert.equal(m.splitChannels, 0);
  assert.equal(m.online, 3);
  // Out-of-range splits are ignored, not clamped into a value.
  assert.equal(mixSegments(stored({ effort: [{ channel: 'A', organicPct: 140 }, { channel: 'B', organicPct: 'x' }] })).organic, null);
  for (const b of BROKEN) {
    const e = mixSegments(b);
    assert.equal(e.organic, null);
    assert.equal(e.online + e.offline, 0);
  }
});

test('donut arcs close the ring exactly and skip empty parts', () => {
  const C = 2 * Math.PI * 30;
  const arcs = donutArcs([{ key: 'organic', value: 93 }, { key: 'paid', value: 7 }], C);
  assert.equal(arcs.length, 2);
  assert.ok(Math.abs(arcs.reduce((a, x) => a + x.length, 0) - C) < 0.11);
  assert.equal(arcs[0].offset, 0);
  assert.equal(arcs[1].offset, -arcs[0].length);
  const one = donutArcs([{ key: 'organic', value: 100 }, { key: 'paid', value: 0 }], 100);
  assert.deepEqual(one, [{ key: 'organic', value: 100, length: 100, offset: 0 }]);
  assert.deepEqual(donutArcs([{ key: 'a', value: 0 }], 100), []);
  assert.deepEqual(donutArcs([{ key: 'a', value: NaN }, { key: 'b', value: -3 }], 100), []);
  assert.deepEqual(donutArcs([{ key: 'a', value: 1 }], 0), []);
  const thirds = donutArcs([{ key: 'a', value: 1 }, { key: 'b', value: 1 }, { key: 'c', value: 1 }], 100);
  assert.equal(Math.round(thirds.reduce((a, x) => a + x.length, 0) * 10) / 10, 100);
});

test('channels get a mark from their name, offline rows always the shop', () => {
  assert.equal(platformOf('Instagram'), 'instagram');
  assert.equal(platformOf('WhatsApp'), 'whatsapp');
  assert.equal(platformOf('Google Business Profile'), 'google');
  assert.equal(platformOf('YouTube Shorts'), 'youtube');
  assert.equal(platformOf('LinkedIn'), 'linkedin');
  assert.equal(platformOf('Facebook'), 'facebook');
  assert.equal(platformOf('Email newsletter'), 'email');
  assert.equal(platformOf('Your website'), 'website');
  assert.equal(platformOf('Instagram', true), 'offline');
  assert.equal(platformOf('வாட்ஸ்அப் குழுக்கள்'), 'other');
  assert.equal(platformOf(null), 'other');
});

test('channel cards carry the stored split and who does what, nothing more', () => {
  const cards = channelCards(stored({ ...fixture.plan, offline: [{ channel: 'Word of mouth', youDo: [{ text: 'Hand out a card.' }, { text: '' }] }] }));
  assert.deepEqual(cards.map((c) => c.name), ['Instagram', 'WhatsApp', 'Google Business Profile', 'Word of mouth']);
  assert.equal(cards[0].organic, 80);
  assert.deepEqual(cards[0].makes, ['posts', 'carousels', 'videos', 'captions and hashtags']);
  assert.equal(cards[0].youDo, 2);
  assert.equal(cards[3].offline, true);
  assert.equal(cards[3].platform, 'offline');
  assert.equal(cards[3].organic, null);
  assert.equal(cards[3].youDo, 1);
  // An older plan has channels but no effort: no split and nothing made is claimed.
  const old = channelCards(stored({ ...fixture.plan, effort: undefined }));
  assert.ok(old.every((c) => c.organic === null && c.makes.length === 0 && c.youDo === 0));
  for (const b of BROKEN) assert.deepEqual(channelCards(b), []);
});

test('pillar chips count this month\'s posts under each pillar and their shapes', () => {
  const chips = pillarChips(FULL);
  assert.deepEqual(chips.map((c) => c.name), fixture.plan.pillars.map((p) => p.name));
  const total = chips.reduce((a, c) => a + c.posts, 0);
  const inPillars = fixture.plan.calendar.filter((c) => fixture.plan.pillars.some((p) => p.name === c.pillar)).length;
  assert.equal(total, inPillars);
  assert.ok(chips.every((c) => c.shapes.length <= 3 && c.tone >= 0 && c.tone < 5));
  assert.deepEqual(chips.map((c) => c.tone), [0, 1, 2, 3]);
  // Pillars with no calendar (an older plan) still show, with no posts claimed.
  const old = pillarChips(stored({ pillars: [{ name: 'Daily bakes' }, { name: 'daily bakes' }, { name: '' }] }));
  assert.deepEqual(old, [{ name: 'Daily bakes', tone: 0, posts: 0, shapes: [] }]);
  for (const b of BROKEN) assert.deepEqual(pillarChips(b), []);
});

test('post shapes and their counts come from the calendar formats', () => {
  assert.equal(shapeOf('reel'), 'reel');
  assert.equal(shapeOf('Image post'), 'image');
  assert.equal(shapeOf('Post'), 'image');
  assert.equal(shapeOf('carousel'), 'carousel');
  assert.equal(shapeOf('story'), 'story');
  assert.equal(shapeOf('podcast'), 'other');
  assert.equal(shapeOf(undefined), 'other');
  const counts = shapeCounts(FULL);
  const known = fixture.plan.calendar.filter((c) => shapeOf(c.format) !== 'other').length;
  assert.equal(counts.reduce((a, x) => a + x.count, 0), known);
  for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i - 1].count >= counts[i].count);
  for (const b of BROKEN) assert.deepEqual(shapeCounts(b), []);
});

test('the timeline marker is placed on the real plan day, capped at 90', () => {
  const now = new Date('2026-10-19T06:00:00Z');
  assert.equal(planDay('2026-10-10T05:00:00Z', now), 9);
  assert.equal(planDay('2026-10-19T05:00:00Z', now), 1);
  assert.equal(planDay(null, now), null);
  assert.equal(planDay('nonsense', now), null);
  assert.equal(timelinePct(9), 10);
  assert.equal(timelinePct(45), 50);
  assert.equal(timelinePct(400), 100);
  assert.equal(timelinePct(null), 0);
});

test('the title card prefers the message, then the territory, then the aim, and is null when none is stored', () => {
  assert.deepEqual(titleCard(FULL), { text: 'Baked this morning, a short walk from your home.', tag: 'proposed', kind: 'line' });
  const noLine = stored({ ...fixture.plan, positioning: { territory: { name: 'Your neighbourhood bakery' } } });
  assert.deepEqual(titleCard(noLine), { text: 'Your neighbourhood bakery', kind: 'territory' });
  assert.equal(titleCard(stored({ promise: { text: 'More walk-in customers.', tag: 'proposed' } })).kind, 'promise');
  for (const b of BROKEN) assert.equal(titleCard(b), null);
});

test('the hero counts come from the plan and leave out what it does not have', () => {
  const now = new Date('2026-10-19T06:00:00Z');
  assert.deepEqual(heroStats(FULL, now), [
    { value: '3', label: 'channels' },
    { value: '4', label: 'content themes' },
    { value: String(fixture.plan.calendar.length), label: 'posts planned this month' },
    { value: '9', label: 'of 90 days' },
  ]);
  assert.deepEqual(heroStats({ plan: FULL }, now), heroStats(FULL, now));
  // An older plan without roadmap or calendar shows only what it has.
  const { roadmap, calendar, ...old } = fixture.plan;
  assert.deepEqual(heroStats(stored(old), now).map((s) => s.label), ['channels', 'content themes']);
  assert.equal(heroStats(stored({ ...fixture.plan }), new Date('2027-03-01T00:00:00Z')).at(-1).value, '90+');
  assert.deepEqual(heroStats(stored({ channels: [{ channel: 'Instagram' }] }), now), [{ value: '1', label: 'channel' }]);
  for (const b of BROKEN) assert.deepEqual(heroStats(b, now), []);
});

test('initials work for any script and empty names', () => {
  assert.equal(initialsOf('Rival Cakes'), 'RC');
  assert.equal(initialsOf('corner'), 'C');
  assert.equal(initialsOf(''), '');
  assert.equal(initialsOf(null), '');
  assert.equal(initialsOf('ராஜா பேக்கரி').length, 2);
});
