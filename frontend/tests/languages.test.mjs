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

import { languageName, languageChoices, versionsOf, variantLabel } from '../utils/languages.ts';

test('languageName gives English display names, also for mix codes', () => {
  assert.equal(languageName('kannada'), 'Kannada');
  assert.equal(languageName('tamil_english_mix'), 'Tamil');
  assert.equal(languageName('English'), 'English');
  assert.equal(languageName(''), '');
});

test('choices list the client\'s languages first and mark created ones', () => {
  const c = languageChoices({ additional: ['kannada', 'telugu'], draftLanguage: 'English', created: ['telugu'] });
  assert.deepEqual(c.mine.map((x) => [x.code, x.created]), [['kannada', false], ['telugu', true]]);
  assert.equal(c.other.length, 9);
  assert.ok(!c.other.some((x) => x.code === 'english' || x.code === 'kannada' || x.code === 'telugu'));
  assert.ok(c.other.every((x) => x.created === false));
});

test('choices never offer the draft\'s own language', () => {
  const c = languageChoices({ additional: ['tamil', 'kannada'], draftLanguage: 'tamil', created: [] });
  assert.deepEqual(c.mine.map((x) => x.code), ['kannada']);
  assert.ok(!c.other.some((x) => x.code === 'tamil'));
});

test('a created language outside the client\'s list shows as created under other', () => {
  const c = languageChoices({ additional: [], draftLanguage: 'English', created: ['urdu'] });
  assert.equal(c.mine.length, 0);
  assert.equal(c.other.find((x) => x.code === 'urdu').created, true);
});

test('versionsOf finds the versions of one draft and variantLabel names them', () => {
  const rows = [
    { _id: 'a' }, { _id: 'b', languageVariantOf: 'a', language: 'kannada' },
    { _id: 'c', languageVariantOf: 'x', language: 'hindi' }, { _id: 'd', languageVariantOf: 'a', language: 'telugu' },
  ];
  assert.deepEqual(versionsOf(rows, 'a').map((r) => r._id), ['b', 'd']);
  assert.equal(variantLabel({ languageVariantOf: 'a', language: 'kannada' }), 'Kannada version');
  assert.equal(variantLabel({ _id: 'a' }), '');
});
