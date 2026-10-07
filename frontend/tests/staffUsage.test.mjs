import test from 'node:test';
import assert from 'node:assert/strict';
import { percentText, funnelSummary, featureSummary, shapeFeatures, quarksSummary, barPercent, WINDOWS } from '../utils/staffUsage.ts';

const steps = [
  { key: 'signedUp', label: 'Signed up', available: true, count: 10, reached: 10, fromPrevious: null, fromStart: 100 },
  { key: 'onboarded', label: 'Finished onboarding', available: true, count: 6, reached: 6, fromPrevious: 60, fromStart: 60 },
  { key: 'firstContent', label: 'Created first content', available: true, count: 3, reached: 4, fromPrevious: 50, fromStart: 30 }
];

test('percent text is whole percent, with a dash when there is nothing to divide by', () => {
  assert.equal(percentText(60), '60%');
  assert.equal(percentText(0), '0%');
  assert.equal(percentText(null), '—');
  assert.equal(percentText(undefined), '—');
  assert.equal(percentText(Number.NaN), '—');
});

test('windows offered are 30 and 90 days', () => {
  assert.deepEqual(WINDOWS.map((w) => w.days), [30, 90]);
});

test('bar width is a share of the largest value, never zero for a real value, never over 100', () => {
  assert.equal(barPercent(5, 10), 50);
  assert.equal(barPercent(1, 1000), 1);
  assert.equal(barPercent(0, 10), 0);
  assert.equal(barPercent(5, 0), 0);
  assert.equal(barPercent(20, 10), 100);
});

test('the funnel summary names the first and last step and the biggest drop', () => {
  const s = funnelSummary(steps, 30);
  assert.match(s, /^Of 10 clients who signed up in the last 30 days/);
  assert.match(s, /6 finished onboarding/);
  assert.match(s, /3 created first content/);
  assert.match(s, /Biggest drop: from Signed up to Finished onboarding/);
});

test('the funnel summary copes with no sign-ups and with steps that could not be counted', () => {
  assert.equal(funnelSummary([{ ...steps[0], count: 0, fromStart: null }], 90), 'No clients signed up in the last 90 days.');
  const s = funnelSummary([steps[0], { key: 'x', label: 'Published first post', available: false, reason: 'no' }], 30);
  assert.match(s, /Published first post could not be counted/);
});

test('feature summary reads the biggest and says which could not be counted', () => {
  const items = [
    { key: 'images', label: 'Images generated', available: true, count: 40, clients: 5 },
    { key: 'videos', label: 'Videos', available: true, count: 2, clients: 1 },
    { key: 'heroVideos', label: 'Hero videos', available: false, reason: 'x' }
  ];
  const s = featureSummary(items);
  assert.match(s, /Images generated: 40 by 5 clients/);
  assert.match(s, /Videos: 2 by 1 client\./);
  assert.match(s, /Hero videos could not be counted/);
  assert.equal(featureSummary([{ key: 'a', label: 'A', available: true, count: 0, clients: 0 }]), 'Nothing was made in the last 30 days.');
});

test('shapeFeatures keeps order, finds the largest and flags empty', () => {
  const out = shapeFeatures([
    { key: 'a', label: 'A', available: true, count: 3, clients: 2 },
    { key: 'b', label: 'B', available: false, reason: 'r' },
    { key: 'c', label: 'C', available: true, count: 9, clients: 4 }
  ]);
  assert.equal(out.max, 9);
  assert.equal(out.hasData, true);
  assert.deepEqual(out.rows.map((r) => r.key), ['a', 'b', 'c']);
  assert.equal(shapeFeatures(undefined).hasData, false);
  assert.equal(shapeFeatures([{ key: 'a', label: 'A', available: true, count: 0, clients: 0 }]).hasData, false);
});

test('quark summary names the largest group and total', () => {
  const s = quarksSummary({ available: true, total: 100, categories: [{ key: 'images', label: 'Images and posts', quarks: 70, percent: 70 }, { key: 'video', label: 'Video', quarks: 30, percent: 30 }] });
  assert.match(s, /100 Quarks/);
  assert.match(s, /Images and posts 70%/);
  assert.equal(quarksSummary({ available: true, total: 0, categories: [] }), 'No Quarks spent this month.');
});
