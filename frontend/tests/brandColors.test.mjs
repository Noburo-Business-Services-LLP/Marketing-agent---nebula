import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderColorPair } from '../utils/brandColors.ts';

test('the exact old placeholder pair is recognised in either letter case', () => {
  assert.equal(isPlaceholderColorPair('#111111', '#FFCC29'), true);
  assert.equal(isPlaceholderColorPair('#111111', '#ffcc29'), true);
  assert.equal(isPlaceholderColorPair(' #111111 ', '#FfCc29'), true);
});

test('one different colour is not a placeholder pair', () => {
  assert.equal(isPlaceholderColorPair('#111111', '#FFCC2A'), false);
  assert.equal(isPlaceholderColorPair('#222222', '#FFCC29'), false);
  assert.equal(isPlaceholderColorPair('#FFCC29', '#111111'), false);
});

test('empty or missing colours are not a placeholder pair', () => {
  assert.equal(isPlaceholderColorPair('', ''), false);
  assert.equal(isPlaceholderColorPair('#111111', ''), false);
  assert.equal(isPlaceholderColorPair(undefined, null), false);
});
