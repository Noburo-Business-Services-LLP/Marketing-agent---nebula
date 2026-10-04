const test = require('node:test');
const assert = require('node:assert/strict');

// geminiAI starts a never-ending interval on load, which would keep this test process alive.
// Stub it in the module cache so the pure function under test can be loaded and the file exits.
const geminiPath = require.resolve('../services/geminiAI');
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: {} };
const { groupIntoRealWeeks } = require('../services/contentCalendarService');


test('groupIntoRealWeeks orders items by day inside each week, posts before reels', () => {
  const items = [
    { _id: 'p1', day: 1, format: 'Post' },
    { _id: 'p4', day: 4, format: 'Post' },
    { _id: 'p5', day: 5, format: 'Post' },
    { _id: 'r3', day: 3, format: 'Reel' },
    { _id: 'p3', day: 3, format: 'Carousel' },
    { _id: 'r9', day: 9, format: 'Reel' },
    { _id: 'p8', day: 8, format: 'Post' },
  ];
  const weeks = groupIntoRealWeeks(items, '2026-10');
  assert.equal(weeks[0].items.map((i) => i._id).join(','), 'p1,p3,r3,p4');
  assert.equal(weeks[1].items.map((i) => i._id).join(','), 'p5,p8,r9');
  for (const w of weeks) {
    const days = w.items.map((i) => i.day);
    assert.deepEqual(days, [...days].sort((a, b) => a - b));
  }
});
