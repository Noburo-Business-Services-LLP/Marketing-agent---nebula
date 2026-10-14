import test from 'node:test';
import assert from 'node:assert/strict';
import { orderForViewing } from '../utils/postOrder.ts';

const camp = (id, n, total, at, name = 'Diwali feast') => ({ _id: id, title: `${name} - Post ${n}`, sourceType: 'campaign', contentType: 'campaign', createdAt: at, generationProgress: { index: n - 1, total } });

test('a campaign is shown together and in its planned order, newest campaign first, other posts keep their place', () => {
  const drafts = [
    { _id: 's1', title: 'Single', contentType: 'post', createdAt: '2026-10-14T12:00:00Z' },
    camp('c3', 3, 3, '2026-10-14T10:00:20Z'), camp('c1', 1, 3, '2026-10-14T10:00:00Z'), camp('c2', 2, 3, '2026-10-14T10:00:10Z'),
    camp('o2', 2, 2, '2026-10-13T09:00:10Z', 'Weekend offer'), camp('o1', 1, 2, '2026-10-13T09:00:00Z', 'Weekend offer'),
    { _id: 's0', title: 'Older single', contentType: 'post', createdAt: '2026-10-12T08:00:00Z' },
  ];
  const out = orderForViewing(drafts);
  assert.deepEqual(out.map((o) => o.draft._id), ['s1', 'c1', 'c2', 'c3', 'o1', 'o2', 's0']);
  assert.deepEqual(out[1].group, { name: 'Diwali feast', size: 3, position: 1, kind: 'campaign' });
  assert.equal(out[0].group, undefined);
});

test('two runs of the same campaign name hours apart are kept apart', () => {
  const out = orderForViewing([camp('a1', 1, 2, '2026-10-14T10:00:00Z'), camp('a2', 2, 2, '2026-10-14T10:00:05Z'), camp('b1', 1, 2, '2026-10-14T16:00:00Z'), camp('b2', 2, 2, '2026-10-14T16:00:05Z')]);
  assert.deepEqual(out.map((o) => o.draft._id), ['b1', 'b2', 'a1', 'a2']);
});

test('posts that share a theme are listed together, oldest first, wherever they are in time; the label is case-blind', () => {
  const out = orderForViewing([
    { _id: 'a', title: 'A', theme: 'Diwali', createdAt: '2026-10-14T12:00:00Z' },
    { _id: 'x', title: 'X', createdAt: '2026-10-13T12:00:00Z' },
    { _id: 'b', title: 'B', theme: 'diwali', createdAt: '2026-10-10T12:00:00Z' },
    { _id: 'c', title: 'C', theme: ' Diwali ', createdAt: '2026-10-12T12:00:00Z' },
  ]);
  assert.deepEqual(out.map((o) => o.draft._id), ['b', 'c', 'a', 'x']);
  assert.deepEqual(out[0].group, { name: 'Diwali', size: 3, position: 1, kind: 'theme' });
  assert.equal(out[3].group, undefined);
});
