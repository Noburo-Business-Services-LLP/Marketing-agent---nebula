import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInr, formatInrShort, formatUsd, shapeRevenueSeries, revenueSummary, gaugeShape, pageLabel, whenIst } from '../utils/staffMoney.ts';

test('rupees use Indian grouping and never go through a float', () => {
  assert.equal(formatInr(117882), '₹1,178.82');
  assert.equal(formatInr(11788200), '₹1,17,882');
  assert.equal(formatInr(471646), '₹4,716.46');
  assert.equal(formatInr(0), '₹0');
  assert.equal(formatInr(5), '₹0.05');
  assert.equal(formatInr(10000000000), '₹10,00,00,000');
  assert.equal(formatInr(99900, { alwaysPaise: true }), '₹999.00');
  assert.equal(formatInr(-50000), '-₹500');
  assert.equal(formatInr(undefined), '—');
  assert.equal(formatInr(Number.NaN), '—');
});

test('short axis labels use K, L and Cr', () => {
  assert.deepEqual([50000, 250000, 12000000, 350000000, 1500000000].map(formatInrShort), ['₹500', '₹2.5K', '₹1.2L', '₹35L', '₹1.5Cr']);
});

test('dollars from integer cents', () => {
  assert.equal(formatUsd(4495), '$44.95');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(120005), '$1,200.05');
  assert.equal(formatUsd(null), '—');
});

test('the revenue series is sorted, cleaned and totalled', () => {
  const s = shapeRevenueSeries([
    { day: '2026-10-03', exGstPaise: 99900, gstPaise: 17982, unsplitPaise: 0 },
    { day: '2026-10-01', exGstPaise: 'x' },
    { day: '2026-10-02', unsplitPaise: 500 }
  ]);
  assert.deepEqual(s.days.map((d) => d.day), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(s.days.map((d) => d.total), [0, 500, 117882]);
  assert.equal(s.total, 118382);
  assert.equal(s.max, 117882);
  assert.equal(s.hasUnsplit, true);
  assert.equal(s.hasData, true);
  assert.equal(shapeRevenueSeries(null).hasData, false);
});

test('the chart summary is one plain sentence with the best day', () => {
  const s = shapeRevenueSeries([{ day: '2026-10-02', exGstPaise: 100000, gstPaise: 18000 }, { day: '2026-10-03', exGstPaise: 200000, gstPaise: 36000 }]);
  assert.match(revenueSummary(s), /₹3,540 collected over 2 days, from 2 Oct to 3 Oct\. Payments on 2 days\. Best day: 3 Oct, ₹2,360\./);
  assert.equal(revenueSummary(shapeRevenueSeries([])), 'No payments in the last 30 days.');
});

test('the profile gauge scales to the limit and flags going over', () => {
  assert.deepEqual(gaugeShape(12, 30, 100), { used: 12, included: 30, over: false, top: 100 });
  assert.equal(gaugeShape(34, 30, 100).over, true);
  assert.equal(gaugeShape(0, 30, 0).used, 0);
});

test('paging and date wording', () => {
  assert.equal(pageLabel(2, 5, 41), 'Page 2 of 5, 41 payments');
  assert.equal(pageLabel(1, 1, 0), 'No payments yet');
  assert.equal(whenIst(null), 'Date not stored');
  assert.equal(whenIst('2026-09-30T20:00:00Z'), '1 Oct 2026'); // already 1 October in India
});
