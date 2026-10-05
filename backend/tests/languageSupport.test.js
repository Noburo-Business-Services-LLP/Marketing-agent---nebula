const test = require('node:test');
const assert = require('node:assert');
const {
  BASE_LANGUAGES, MAX_ADDITIONAL_LANGUAGES, baseOf, sanitizeAdditionalLanguages, languageLabel,
} = require('../services/languageSupport');

test('there are 12 base languages and the cap is 3', () => {
  assert.deepStrictEqual(BASE_LANGUAGES, [
    'english', 'tamil', 'telugu', 'hindi', 'kannada', 'malayalam',
    'marathi', 'bengali', 'gujarati', 'punjabi', 'odia', 'urdu',
  ]);
  assert.strictEqual(MAX_ADDITIONAL_LANGUAGES, 3);
});

test('baseOf strips the English mix suffix', () => {
  assert.strictEqual(baseOf('tamil_english_mix'), 'tamil');
  assert.strictEqual(baseOf('hindi'), 'hindi');
  assert.strictEqual(baseOf(''), '');
  assert.strictEqual(baseOf(undefined), '');
});

test('sanitize keeps only base codes, removes duplicates and the primary base, caps at 3', () => {
  assert.deepStrictEqual(sanitizeAdditionalLanguages(['kannada', 'kannada', 'tamil'], 'tamil_english_mix'), ['kannada']);
  assert.deepStrictEqual(sanitizeAdditionalLanguages(['telugu_english_mix', 'klingon', 5, null, 'Telugu'], 'english'), ['telugu']);
  assert.deepStrictEqual(sanitizeAdditionalLanguages(['hindi', 'telugu', 'kannada', 'urdu'], 'tamil'), ['hindi', 'telugu', 'kannada']);
});

test('sanitize copes with missing or wrong input', () => {
  assert.deepStrictEqual(sanitizeAdditionalLanguages(undefined, 'tamil'), []);
  assert.deepStrictEqual(sanitizeAdditionalLanguages('kannada', 'tamil'), []);
  assert.deepStrictEqual(sanitizeAdditionalLanguages(['kannada'], undefined), ['kannada']);
});

test('languageLabel gives English display names', () => {
  assert.strictEqual(languageLabel('kannada'), 'Kannada');
  assert.strictEqual(languageLabel('odia'), 'Odia');
  assert.strictEqual(languageLabel('tamil_english_mix'), 'Tamil');
  assert.strictEqual(languageLabel('zzz'), '');
});
