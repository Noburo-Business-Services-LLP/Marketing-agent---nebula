import test from 'node:test';
import assert from 'node:assert/strict';
import { fileProblem, speechLanguage, appendText, mergeDetails, MAX_FILES, isNoTextResult, referenceAssetFromFile, referenceOfferFor } from '../utils/ideaFiles.ts';

test('accepts pictures and PDFs, refuses others and big files', () => {
  assert.equal(fileProblem({ type: 'image/png', size: 100, name: 'a.png' }), '');
  assert.equal(fileProblem({ type: 'application/pdf', size: 100, name: 'a.pdf' }), '');
  assert.match(fileProblem({ type: 'video/mp4', size: 100, name: 'a.mp4' }), /not a picture or a PDF/);
  assert.match(fileProblem({ type: 'image/png', size: 9 * 1024 * 1024, name: 'big.png' }), /8 MB/);
  assert.match(fileProblem({ type: 'image/png', size: 1, name: 'a.png' }, MAX_FILES), /up to 4/);
});
test('speech language is Tamil only for Tamil choices', () => {
  assert.equal(speechLanguage('Tamil'), 'ta');
  assert.equal(speechLanguage('Tamil + English mix'), 'ta');
  assert.equal(speechLanguage('English'), 'en');
});
test('appendText does not glue or repeat', () => {
  assert.equal(appendText('', ' hello '), 'hello');
  assert.equal(appendText('a', 'b'), 'a\nb');
  assert.equal(appendText('a b', 'b'), 'a b');
  assert.equal(appendText('x', ''), 'x');
});
test('mergeDetails fills only empty boxes', () => {
  const out = mergeDetails({ headline: 'Mine', offer: '', phone: ' ' }, { headline: 'Theirs', offer: '20% off', phone: '99' });
  assert.deepEqual(out, { headline: 'Mine', offer: '20% off', phone: '99' });
});

const NEW_MSG = 'No printed text was found in this file. If it is a photo, use it as a person, place or product reference instead.';
test('isNoTextResult matches the new and the old wording only', () => {
  assert.equal(isNoTextResult(NEW_MSG), true);
  assert.equal(isNoTextResult('Nothing readable was found in this file. Try a clearer photo or a different file.'), true);
  assert.equal(isNoTextResult('This looks like a sensitive document.'), false);
  assert.equal(isNoTextResult('Could not read the files.'), false);
  assert.equal(isNoTextResult(undefined), false);
});
test('referenceAssetFromFile builds the picked-asset shape', () => {
  assert.deepEqual(referenceAssetFromFile({ name: 'girl.png', dataUrl: 'data:image/png;base64,AA==' }),
    { id: '', name: 'girl.png', imageUrl: 'data:image/png;base64,AA==', dataUrl: 'data:image/png;base64,AA==' });
});
test('an image with no text gets the offer, a PDF or other failure does not', () => {
  const img = { name: 'girl.png', type: 'image/png' };
  assert.equal(referenceOfferFor({ file: img, message: NEW_MSG, hasChoices: true }), true);
  assert.equal(referenceOfferFor({ file: img, message: NEW_MSG, hasChoices: false }), false);
  assert.equal(referenceOfferFor({ file: { name: 'a.pdf', type: 'application/pdf' }, message: NEW_MSG, hasChoices: true }), false);
  assert.equal(referenceOfferFor({ file: img, message: 'This looks like a sensitive document.', hasChoices: true }), false);
});
test('wording guard: no money or trial words in the offer text', async () => {
  const { referenceOfferText, referenceAddedText } = await import('../utils/ideaFiles.ts');
  const all = [referenceOfferText('x.png'), referenceAddedText('A person'), NEW_MSG].join(' ');
  assert.doesNotMatch(all, /quark|credit|trial|7 days/i);
});
