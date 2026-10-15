import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlan, waitMessage, videosLeft, CHANGE_IDEAS } from '../utils/studioVideo.ts';

test('an idea needs a few words before planning', () => {
  assert.equal(canPlan(''), false);
  assert.equal(canPlan('  hi  '), false);
  assert.equal(canPlan('Diwali offer at our sweet shop'), true);
});

test('the wait message moves on with time and never claims it is done', () => {
  assert.match(waitMessage(5), /Planning/);
  assert.match(waitMessage(40), /Filming/);
  assert.match(waitMessage(90), /voice and music/);
  assert.match(waitMessage(400), /little longer/);
});

test('videos left is a whole number, never negative', () => {
  assert.equal(videosLeft(500, 161), 3);
  assert.equal(videosLeft(100, 161), 0);
  assert.equal(videosLeft(-5, 161), 0);
  assert.equal(videosLeft(500, 0), 0);
  assert.equal(videosLeft(NaN, 161), 0);
});

test('change ideas are short and plain', () => {
  assert.ok(CHANGE_IDEAS.length >= 3);
  for (const c of CHANGE_IDEAS) assert.ok(c.length < 40);
});
