// The Inbox filter bar (All / Needs reply / Important): only known words reach the conversation query.
const test = require('node:test');
const assert = require('node:assert');
const { priorityFilter } = require('../services/socialInboxService');

test('Important asks for high and urgent; known priorities pass; anything else is ignored', () => {
  assert.deepStrictEqual(priorityFilter('important'), { $in: ['high', 'urgent'] });
  for (const p of ['low', 'normal', 'high', 'urgent']) assert.strictEqual(priorityFilter(p), p);
  for (const bad of ['', null, undefined, 'all', { $ne: 'x' }, 'HIGH; drop']) assert.strictEqual(priorityFilter(bad), undefined, String(bad));
});
