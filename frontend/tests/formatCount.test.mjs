import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, formatShort, changeText, formatPercent } from '../utils/formatCount.ts';

test('formatCount groups digits the Indian way', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(7), '7');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1000), '1,000');
  assert.equal(formatCount(12345), '12,345');
  assert.equal(formatCount(100000), '1,00,000');
  assert.equal(formatCount(1250000), '12,50,000');
  assert.equal(formatCount(123456789), '12,34,56,789');
  assert.equal(formatCount(10000000), '1,00,00,000');
});
test('formatCount keeps the sign and rounds to a whole number', () => {
  assert.equal(formatCount(-1234), '-1,234');
  assert.equal(formatCount(-100000), '-1,00,000');
  assert.equal(formatCount(12.6), '13');
  assert.equal(formatCount(-0), '0');
  assert.equal(formatCount(0.4), '0');
  assert.equal(formatCount(-0.4), '0');
});
test('formatCount gives an empty string for anything that is not a number', () => {
  for (const v of [NaN, Infinity, -Infinity, null, undefined, '', 'abc', {}, []]) assert.equal(formatCount(v), '', String(v));
  assert.equal(formatCount('1200'), '1,200'); // a number sent as text still works
});
test('formatCount copes with very large numbers', () => {
  assert.equal(formatCount(1e12), '10,00,00,00,00,000');
  assert.equal(formatCount(Number.MAX_SAFE_INTEGER), new Intl.NumberFormat('en-IN').format(Number.MAX_SAFE_INTEGER));
  assert.equal(formatCount(1e21).replace(/,/g, '').length > 0, true);
});

test('formatShort uses K, L and Cr', () => {
  assert.equal(formatShort(0), '0');
  assert.equal(formatShort(999), '999');
  assert.equal(formatShort(1000), '1K');
  assert.equal(formatShort(1250), '1.3K');
  assert.equal(formatShort(12345), '12.3K');
  assert.equal(formatShort(99000), '99K');
  assert.equal(formatShort(100000), '1L');
  assert.equal(formatShort(125000), '1.3L');
  assert.equal(formatShort(1250000), '12.5L');
  assert.equal(formatShort(9900000), '99L');
  assert.equal(formatShort(10000000), '1Cr');
  assert.equal(formatShort(12500000), '1.3Cr');
  assert.equal(formatShort(250000000), '25Cr');
});
test('formatShort moves up a unit instead of showing 100K or 100L', () => {
  assert.equal(formatShort(99950), '1L');
  assert.equal(formatShort(99999), '1L');
  assert.equal(formatShort(9995000), '1Cr');
  assert.equal(formatShort(9999999), '1Cr');
});
test('formatShort handles negatives, huge values and rubbish', () => {
  assert.equal(formatShort(-1500), '-1.5K');
  assert.equal(formatShort(-250000), '-2.5L');
  assert.equal(formatShort(1e11), '10,000Cr');
  assert.equal(formatShort(1e12), '1,00,000Cr');
  assert.equal(formatShort(NaN), '');
  assert.equal(formatShort(null), '');
  assert.equal(formatShort(undefined), '');
  assert.equal(formatShort(Infinity), '');
});

test('changeText says the direction in words, not colour', () => {
  assert.equal(changeText(12.5), 'Up 12.5%');
  assert.equal(changeText(-3), 'Down 3%');
  assert.equal(changeText(0), 'No change');
  assert.equal(changeText(0.04), 'No change');
  assert.equal(changeText(1000), 'Up 1,000%');
  assert.equal(changeText(-100), 'Down 100%');
  for (const v of [null, undefined, NaN, Infinity]) assert.equal(changeText(v), '', String(v));
});
test('formatPercent shows one decimal at most', () => {
  assert.equal(formatPercent(4), '4%');
  assert.equal(formatPercent(4.25), '4.3%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(NaN), '');
});
