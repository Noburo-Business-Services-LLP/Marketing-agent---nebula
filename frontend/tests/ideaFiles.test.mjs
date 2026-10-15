import test from 'node:test';
import assert from 'node:assert/strict';
import { fileProblem, speechLanguage, appendText, mergeDetails, MAX_FILES } from '../utils/ideaFiles.ts';

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
