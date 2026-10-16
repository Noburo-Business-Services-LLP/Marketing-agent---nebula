import test from 'node:test';
import assert from 'node:assert/strict';
import { spendPercent, spendTone, money, spendSummary } from '../utils/aiSpend.ts';

test('the bar reads a whole percent and never passes 100', () => {
  assert.equal(spendPercent(0, 150), 0);
  assert.equal(spendPercent(75, 150), 50);
  assert.equal(spendPercent(300, 150), 100);
  assert.equal(spendPercent(10, 0), 0);
  assert.equal(spendPercent(NaN, 150), 0);
});

test('the colour turns amber at 70 percent and red at the ceiling, like the emails', () => {
  assert.equal(spendTone(104, 150), 'ok');
  assert.equal(spendTone(105, 150), 'warn');
  assert.equal(spendTone(150, 150), 'over');
  assert.equal(spendTone(500, 0), 'ok');
});

test('money shows dollars and rupees', () => {
  assert.equal(money(12.4), '$12.40 (about ₹1,091)');
  assert.equal(money(NaN), '$0.00 (about ₹0)');
});

test('the summary says what matters first: anything switched off, then the ceiling', () => {
  assert.match(spendSummary(10, 150, 1), /1 kind of work switched off/);
  assert.match(spendSummary(10, 150, 2), /2 kinds of work switched off/);
  assert.match(spendSummary(200, 150, 0), /ceiling is reached/);
  assert.match(spendSummary(110, 150, 0), /above 70%/);
  assert.match(spendSummary(10, 150, 0), /Everything is on/);
  assert.match(spendSummary(10, 0, 0), /No daily ceiling/);
});
