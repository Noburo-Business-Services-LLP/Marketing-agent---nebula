import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_ORDER, SOURCE_INFO, sourcesInOrder, heroCounts, chipStatus, sourceLine, itemFoot, shownItems, whenWords, cooldownWords,
  confidenceOf, CONFIDENCE_LABEL, MAX_SHOWN,
} from '../utils/memorySources.ts';

const NOW = new Date('2026-10-20T06:00:00Z');
const block = (key, over = {}) => ({ key, label: key, title: key, state: 'none', reason: 'Why', evidenceCount: 0, evidenceUnit: '', checkedAt: null, items: [], ...over });
const item = (id, confidence, over = {}) => ({ id, type: 'item', text: `Item ${id}`, confidence, ...over });

test('the six sources always show in page order, a missing one as not looked at yet', () => {
  assert.deepEqual(SOURCE_ORDER, ['plan', 'blueprint', 'customers', 'products', 'results', 'competitors']);
  const s = sourcesInOrder({ sources: [block('results', { items: [item('a', 'good')] }), block('plan')] });
  assert.deepEqual(s.map((b) => b.key), SOURCE_ORDER);
  assert.equal(s[1].reason, 'Nebulaa has not looked at this yet.');
  assert.equal(sourcesInOrder(null).length, 6);
  for (const k of SOURCE_ORDER) assert.ok(SOURCE_INFO[k].title.startsWith('Learned'), k);
  assert.ok(new Set(SOURCE_ORDER.map((k) => SOURCE_INFO[k].tone)).size === 6, 'each source its own colour');
});

test('hero counts: items learned and the sources that gave something', () => {
  const v = { sources: [block('plan', { items: [item('a', 'strong'), item('b', 'good')] }), block('results', { items: [item('c', 'early')] })] };
  assert.deepEqual(heroCounts(v), { items: 3, sources: 2, total: 6 });
  assert.deepEqual(heroCounts(null), { items: 0, sources: 0, total: 6 });
});

test('chip words per state, in plain words', () => {
  assert.equal(chipStatus(block('plan', { items: [item('a', 'strong')] })), '1 learned');
  assert.equal(chipStatus(block('results', { state: 'not_enough' })), 'Not enough yet');
  assert.equal(chipStatus(block('competitors', { state: 'not_on_plan' })), 'Not on your plan');
  assert.equal(chipStatus(block('products', { state: 'error' })), 'Could not check');
  assert.equal(chipStatus(block('blueprint')), 'Not yet');
});

test('evidence and time lines', () => {
  assert.equal(sourceLine(block('results', { evidenceCount: 14, evidenceUnit: 'posts', checkedAt: '2026-10-20T01:00:00Z' }), NOW), 'From 14 posts, checked today');
  assert.equal(sourceLine(block('products', { evidenceCount: 1, evidenceUnit: 'items', checkedAt: '2026-10-19T05:00:00Z' }), NOW), 'From 1 item, checked yesterday');
  assert.equal(sourceLine(block('plan', { checkedAt: '2026-10-20T01:00:00Z' }), NOW), 'Checked today');
  assert.equal(sourceLine(block('plan'), NOW), '');
  assert.equal(whenWords('2026-10-17T06:00:00Z', NOW), '3 days ago');
  assert.equal(whenWords('2026-10-02T06:00:00Z', NOW), '2 October');
  assert.equal(whenWords('nonsense', NOW), '');
  assert.equal(itemFoot(item('a', 'good', { evidenceText: 'from 14 posts', learnedAt: '2026-10-17T06:00:00Z' }), NOW), 'from 14 posts, learned 3 days ago');
  assert.equal(itemFoot(item('a', 'good', { evidenceText: 'from your plan', userEdited: true }), NOW), 'from your plan, your words');
});

test('cooldown words and confidence words', () => {
  assert.equal(cooldownWords(600), 'Refresh again in 10 minutes');
  assert.equal(cooldownWords(30), 'Refresh again in 1 minute');
  assert.equal(cooldownWords(0), '');
  assert.equal(cooldownWords(undefined), '');
  assert.equal(confidenceOf('strong'), 'strong');
  assert.equal(confidenceOf(0.9), 'early', 'never turns a number into a word on its own');
  assert.deepEqual(CONFIDENCE_LABEL, { strong: 'Strong', good: 'Good', early: 'Early' });
});

test('a tile shows the strongest few first, and all of them when opened', () => {
  const items = [item('a', 'early'), item('b', 'strong'), item('c', 'good'), item('d', 'strong'), item('e', 'good')];
  const shut = shownItems(items, false);
  assert.equal(shut.list.length, MAX_SHOWN);
  assert.deepEqual(shut.list.map((i) => i.id), ['b', 'd']);
  assert.equal(shut.hidden, 3);
  assert.equal(shownItems(items, true).list.length, 5);
  assert.equal(shownItems(items.slice(0, 2), false).hidden, 0);
});
