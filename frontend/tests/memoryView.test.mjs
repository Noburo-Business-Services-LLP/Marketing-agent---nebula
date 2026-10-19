import test from 'node:test';
import assert from 'node:assert/strict';
import { groupNotes, confidencePct, strengthOf, waitingHint, trackedLabel, CATEGORY_ORDER, CATEGORY_INFO } from '../utils/memoryView.ts';

const note = (id, category, confidence, text = `Note ${id}`) => ({ _id: id, text, category, confidence });

test('notes are grouped by their stored category, in reading order, strongest first', () => {
  const groups = groupNotes([note('a', 'copy', 0.4), note('b', 'timing', 0.9), note('c', 'copy', 0.8), note('d', 'hashtags', 0.6)]);
  assert.deepEqual(groups.map((g) => g.category), ['timing', 'copy', 'hashtags']);
  assert.deepEqual(groups[1].notes.map((n) => n._id), ['c', 'a']);
  assert.equal(groups[0].title, 'Best days and times');
});

test('nothing is invented: no notes, broken notes and empty text give no group', () => {
  assert.deepEqual(groupNotes(undefined), []);
  assert.deepEqual(groupNotes([null, {}, { text: '  ', category: 'copy' }, 7]), []);
});

test('an unknown category is shown under words and tone, as the server stores it', () => {
  assert.deepEqual(groupNotes([note('x', 'mystery', 0.5)]).map((g) => g.category), ['copy']);
});

test('confidence becomes a percent and a strength word; a missing value counts as one half', () => {
  assert.equal(confidencePct(0.834), 83);
  assert.equal(confidencePct(4), 100);
  assert.equal(confidencePct(-1), 0);
  assert.equal(confidencePct(undefined), 50);
  assert.equal(strengthOf(0.75), 'strong');
  assert.equal(strengthOf(0.5), 'good');
  assert.equal(strengthOf(0.2), 'early');
});

test('the waiting hint follows the real tracked count and keeps the house wording', () => {
  assert.match(waitingHint(0).text, /few days/);
  assert.match(waitingHint(1).text, /^1 post is being tracked/);
  assert.match(waitingHint(5).text, /^5 posts are being tracked/);
  assert.equal(trackedLabel(1), '1 tracked post');
  assert.equal(trackedLabel('x'), '0 tracked posts');
  const all = [waitingHint(0), waitingHint(3)].flatMap((h) => [h.title, h.text]).concat(CATEGORY_ORDER.flatMap((c) => [CATEGORY_INFO[c].title, CATEGORY_INFO[c].line]));
  for (const s of all) assert.doesNotMatch(s, /!|—|credit|trial|7 days/i, s);
});
