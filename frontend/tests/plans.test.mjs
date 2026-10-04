import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPaise, formatInr, upgradeMessage, upgradeInfoOf, tierLabel, apiErrorFrom } from '../utils/plans.ts';

test('paise are shown as exact rupees and paise', () => {
  assert.equal(formatPaise(117882), '₹1,178.82');
  assert.equal(formatPaise(235882), '₹2,358.82');
  assert.equal(formatPaise(589882), '₹5,898.82');
  assert.equal(formatPaise(100005), '₹1,000.05');
  assert.equal(formatInr(999), '₹999');
  assert.equal(formatInr(4999), '₹4,999');
});

test('each reason gives a plain message that ends with the next step', () => {
  for (const r of ['upgrade', 'addon', 'quarks']) {
    assert.match(upgradeMessage(r), /Please upgrade your plan, or buy an add-on pack or Quarks\.$/);
  }
  assert.match(upgradeMessage('quarks'), /enough Quarks/);
  assert.match(upgradeMessage('addon', 'competitors'), /^Competitor insights is available as an add-on/);
  assert.match(upgradeMessage('upgrade', 'publish'), /^Publishing is not included in your current plan/);
});

test('messages never say credits or trial', () => {
  for (const r of ['upgrade', 'addon', 'quarks']) assert.doesNotMatch(upgradeMessage(r, 'inbox'), /credit|trial/i);
});

test('upgradeInfoOf reads the server answer and ignores other errors', () => {
  const info = upgradeInfoOf({ data: { upgradeRequired: true, reason: 'addon', feature: 'inbox' } });
  assert.equal(info.reason, 'addon');
  assert.equal(info.feature, 'inbox');
  assert.equal(upgradeInfoOf({ data: { creditsExhausted: true } }).reason, 'quarks');
  assert.equal(upgradeInfoOf({ data: { upgradeRequired: true } }).reason, 'upgrade');
  assert.equal(upgradeInfoOf({ data: { upgradeRequired: true, reason: 'nonsense' } }).reason, 'upgrade');
  assert.equal(upgradeInfoOf(new Error('boom')), null);
  assert.equal(upgradeInfoOf({ data: { message: 'x' } }), null);
  assert.equal(upgradeInfoOf(null), null);
});

test('tier names', () => {
  assert.equal(tierLabel('starter'), 'Starter');
  assert.equal(tierLabel('professional'), 'Professional');
  assert.equal(tierLabel(undefined), 'Free');
});

test('apiErrorFrom keeps the server answer so the inbox pages can show the upgrade prompt', () => {
  const err = apiErrorFrom({ success: false, upgradeRequired: true, reason: 'addon', feature: 'inbox', message: 'This needs an add-on.' }, 403, 'Inbox request failed');
  assert.equal(err.message, 'This needs an add-on.');
  assert.equal(err.status, 403);
  const info = upgradeInfoOf(err);
  assert.equal(info.reason, 'addon');
  assert.equal(info.feature, 'inbox');
  assert.equal(apiErrorFrom(null, 500, 'Inbox request failed').message, 'Inbox request failed');
  assert.equal(upgradeInfoOf(apiErrorFrom({ message: 'x' }, 500, 'f')), null);
});
