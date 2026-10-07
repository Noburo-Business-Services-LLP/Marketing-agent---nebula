import test from 'node:test';
import assert from 'node:assert/strict';
import { platformHint, choicesFor, PLATFORM_CHOICES } from '../utils/platforms.ts';

test('an icon says what it will do', () => {
  assert.equal(platformHint({ key: 'instagram', label: 'Instagram' }, 'image'), 'Post to Instagram');
  assert.equal(platformHint({ key: 'gmb', label: 'Google Business' }, 'image'), 'Post to Google Business');
});

test('a blocked or upcoming platform says why it cannot be chosen', () => {
  assert.equal(platformHint({ key: 'gmb', label: 'Google Business', blocked: true }, 'video'), 'Videos cannot be sent to Google Business yet');
  assert.equal(platformHint({ key: 'x', label: 'X', soon: true }, 'image'), 'X: coming soon');
});

test('every picker draws from one list that includes X and Google Business', () => {
  const keys = PLATFORM_CHOICES.map((p) => p.key);
  assert.ok(keys.includes('twitter') && keys.includes('gmb'));
  assert.ok(choicesFor('video').some((p) => p.key === 'gmb' && p.video === false));
  assert.ok(!choicesFor('image').some((p) => p.key === 'youtube'));
});
