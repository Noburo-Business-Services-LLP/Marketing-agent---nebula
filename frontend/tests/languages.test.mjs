import test from 'node:test';
import assert from 'node:assert/strict';
import { availableOptions, baseOf, cleanSelection, toggleLanguage, isAtCap } from '../utils/languages.ts';
import { CONTENT_LANGUAGE_BASES } from '../components/onboarding/onboardingStrings.ts';

test('baseOf removes the English mix suffix', () => {
  assert.equal(baseOf('tamil_english_mix'), 'tamil');
  assert.equal(baseOf('urdu'), 'urdu');
  assert.equal(baseOf(undefined), '');
});

test('available options are the 12 base languages without the primary base', () => {
  assert.deepEqual([...CONTENT_LANGUAGE_BASES], [...availableOptions('')]);
  const opts = availableOptions('tamil_english_mix');
  assert.equal(opts.length, 11);
  assert.ok(!opts.includes('tamil'));
  assert.ok(opts.every((o) => !o.endsWith('_english_mix')));
});

test('toggle adds, removes, and stops at three', () => {
  let s = [];
  s = toggleLanguage(s, 'kannada', 'tamil');
  s = toggleLanguage(s, 'telugu', 'tamil');
  s = toggleLanguage(s, 'hindi', 'tamil');
  assert.deepEqual(s, ['kannada', 'telugu', 'hindi']);
  assert.ok(isAtCap(s));
  assert.deepEqual(toggleLanguage(s, 'urdu', 'tamil'), s);
  assert.deepEqual(toggleLanguage(s, 'telugu', 'tamil'), ['kannada', 'hindi']);
});

test('the primary language and unknown codes cannot be added', () => {
  assert.deepEqual(toggleLanguage([], 'tamil', 'tamil_english_mix'), []);
  assert.deepEqual(toggleLanguage([], 'klingon', 'tamil'), []);
});

test('cleanSelection drops a language that became the primary', () => {
  assert.deepEqual(cleanSelection(['kannada', 'tamil', 'kannada'], 'tamil'), ['kannada']);
  assert.deepEqual(cleanSelection(undefined, 'tamil'), []);
});
