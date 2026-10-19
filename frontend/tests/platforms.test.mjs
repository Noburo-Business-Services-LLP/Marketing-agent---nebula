import test from 'node:test';
import assert from 'node:assert/strict';
import { platformHint, choicesFor, PLATFORM_CHOICES } from '../utils/platforms.ts';

test('an icon says what it will do', () => {
  assert.equal(platformHint({ key: 'instagram', label: 'Instagram' }, 'image'), 'Post to Instagram');
  assert.equal(platformHint({ key: 'gmb', label: 'Google Business' }, 'image'), 'Post to Google Business');
});

test('a blocked platform says why it cannot be chosen', () => {
  assert.equal(platformHint({ key: 'gmb', label: 'Google Business', blocked: true }, 'video'), 'Videos cannot be sent to Google Business yet');
});

test('a platform marked as not available yet is left out of every picker', () => {
  const soon = PLATFORM_CHOICES.filter((p) => p.soon);
  for (const kind of ['image', 'video']) assert.ok(!choicesFor(kind).some((p) => p.soon) && soon.every((p) => !choicesFor(kind).includes(p)));
});

test('every picker draws from one list that includes X and Google Business', () => {
  const keys = PLATFORM_CHOICES.map((p) => p.key);
  assert.ok(keys.includes('twitter') && keys.includes('gmb'));
  assert.ok(choicesFor('video').some((p) => p.key === 'gmb' && p.video === false));
  assert.ok(!choicesFor('image').some((p) => p.key === 'youtube'));
});
