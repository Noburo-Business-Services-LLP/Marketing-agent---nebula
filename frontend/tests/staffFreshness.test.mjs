import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOW_AFTER_MS, SLOW_NOTICE, isSlow, lastUpdatedText } from '../utils/staffFreshness.ts';

test('the slow notice appears after 8 seconds and says what is happening in plain words', () => {
  assert.equal(SLOW_AFTER_MS, 8000);
  assert.equal(SLOW_NOTICE, 'Still loading. This page reads a lot of data and can take a minute.');
  assert.equal(isSlow(1000, 8999), false);
  assert.equal(isSlow(1000, 9000), true);
  assert.equal(isSlow(null, 99999), false);
});

test('last updated shows only when the numbers came from the stored copy', () => {
  const now = new Date('2026-10-18T10:00:00');
  assert.equal(lastUpdatedText(null, now), '');
  assert.equal(lastUpdatedText(undefined, now), '');
  assert.equal(lastUpdatedText({ updatedAt: new Date('2026-10-18T09:50:00').toISOString(), fromCache: false }, now), '');
  assert.equal(lastUpdatedText({ updatedAt: 'not a date', fromCache: true }, now), '');
});

test('last updated names the time today and the day for an older copy', () => {
  const now = new Date('2026-10-18T10:00:00');
  const today = lastUpdatedText({ updatedAt: new Date('2026-10-18T09:50:00').toISOString(), fromCache: true }, now);
  assert.match(today, /^Last updated 9:50 am$/);
  const older = lastUpdatedText({ updatedAt: new Date('2026-10-17T21:05:00').toISOString(), fromCache: true }, now);
  assert.match(older, /^Last updated 17 Oct, 9:05 pm$/);
});

test('a copy that is being refreshed says so', () => {
  const now = new Date('2026-10-18T10:00:00');
  const text = lastUpdatedText({ updatedAt: new Date('2026-10-18T09:40:00').toISOString(), fromCache: true, stale: true }, now);
  assert.equal(text, 'Last updated 9:40 am. Updating in the background.');
});
