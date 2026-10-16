import test from 'node:test';
import assert from 'node:assert/strict';
import { canConfirmDeletion, daysUntil, needsTermsPrompt } from '../utils/accountDeletion.ts';

test('delete stays off until the password is in and DELETE is typed exactly', () => {
  assert.equal(canConfirmDeletion('', 'DELETE'), false);
  assert.equal(canConfirmDeletion('pw', 'delete'), false);
  assert.equal(canConfirmDeletion('pw', 'DELETE '), true);
});

test('days left counts up to the next whole day and never goes negative', () => {
  const now = Date.parse('2026-10-16T06:00:00Z');
  assert.equal(daysUntil('2026-10-30T06:00:00Z', now), 14);
  assert.equal(daysUntil('2026-10-16T07:00:00Z', now), 1);
  assert.equal(daysUntil('2026-10-01T00:00:00Z', now), 0);
  assert.equal(daysUntil(undefined, now), 0);
});

test('the terms prompt is for finished, non-staff accounts that have not agreed yet', () => {
  const base = { onboardingCompleted: true, staffRole: null, consent: null };
  assert.equal(needsTermsPrompt(base), true);
  assert.equal(needsTermsPrompt({ ...base, consent: { acceptedAt: '2026-10-16' } }), false);
  assert.equal(needsTermsPrompt({ ...base, onboardingCompleted: false }), false);
  assert.equal(needsTermsPrompt({ ...base, staffRole: 'csm' }), false);
  assert.equal(needsTermsPrompt({ ...base, deletion: { status: 'pending' } }), false);
  assert.equal(needsTermsPrompt(null), false);
});
