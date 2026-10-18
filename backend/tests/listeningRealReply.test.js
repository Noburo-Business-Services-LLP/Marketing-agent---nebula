const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseReply } = require('../services/listening/helpers');

// A REAL reply from gpt-4o-mini captured on 2026-10-18 for 24 MADE-UP comments (no customer data). The model returned
// bare JSON in the strict shape, 23 of 24 items (the empty-looking comment number 22 was left out).
const RAW = fs.readFileSync(path.join(__dirname, 'fixtures', 'listening-real-reply-gpt-4o-mini.json'), 'utf8');

test('the real gpt-4o-mini reply parses: 23 of 24 items, the missing one is simply left unscored', () => {
  const m = parseReply(RAW, 24);
  assert.strictEqual(m.size, 23);
  assert.ok(!m.has(21), 'comment 22 (index 21) was not returned and stays unscored');
  for (const [, v] of m) assert.ok(['pos', 'neu', 'neg'].includes(v.label), `unexpected label ${v.label}`);
});

test('the real reply labels match what a person expects for the clear cases', () => {
  const m = parseReply(RAW, 24);
  assert.strictEqual(m.get(0).label, 'pos');   // 1 loved the saree
  assert.strictEqual(m.get(4).label, 'neu');    // 5 shop timings question
  assert.strictEqual(m.get(7).label, 'neg');   // 8 order two weeks late
  assert.strictEqual(m.get(19).label, 'neg');  // 20 injection attempt kept its negative label
});
