import test from 'node:test';
import assert from 'node:assert/strict';
import { gstinProblem, checkChar, normaliseGstin } from '../utils/gstin.ts';

test('a published sample GSTIN is accepted, with spaces and lower case', () => {
  assert.equal(gstinProblem('27AAPFU0939F1ZV'), '');
  assert.equal(gstinProblem(' 27aapfu0939f1zv '), '');
  assert.equal(normaliseGstin(' 27aa pfu '), '27AAPFU');
});

test('empty is fine because a GSTIN is optional, and early typing is not nagged', () => {
  assert.equal(gstinProblem(''), '');
  assert.equal(gstinProblem('27A'), '');
  assert.match(gstinProblem('27AAPFU0939F'), /Keep typing/);
});

test('a slip in the last character, a bad shape and an unknown state are each caught', () => {
  assert.match(gstinProblem('27AAPFU0939F1Z0'), /last character does not match/);
  assert.match(gstinProblem('27AAPFU0939F1X0'), /15 letters and numbers/);
  const first14 = '99ABCDE1234F1Z';
  assert.match(gstinProblem(first14 + checkChar(first14)), /state code/);
});

import { stateFromGstin } from '../utils/gstin.ts';
test('the state comes from the first two digits of the GSTIN', () => {
  assert.equal(stateFromGstin('33ABCDE1234F1Z7'), 'TN');
  assert.equal(stateFromGstin('27AAPFU0939F1ZV'), 'MH');
  assert.equal(stateFromGstin('99ABC'), '');
  assert.equal(stateFromGstin(''), '');
});
