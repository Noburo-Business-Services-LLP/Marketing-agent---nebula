const test = require('node:test');
const assert = require('node:assert');

// Stub the generator module so no model or network is touched.
const qpath = require.resolve('../services/backgroundQueue');
let behaviour = null;
require.cache[qpath] = { id: qpath, filename: qpath, loaded: true, exports: { generateSingleCalendarItem: async (...a) => behaviour(...a) } };
const Draft = require('../models/Draft');
const Campaign = require('../models/Campaign');
const { defaultDeps } = require('../services/week/weekService');

test('a post with no picture: its draft and campaign are deleted and the calendar row is not saved', async () => {
  const gone = [];
  Draft.deleteOne = async (q) => { gone.push(['draft', q._id]); };
  Campaign.deleteOne = async (q) => { gone.push(['campaign', q._id]); };
  let saved = 0;
  behaviour = async () => ({ draft: { _id: 'd1', imageUrl: '' }, campaign: { _id: 'c1' } });
  const out = await defaultDeps().generate({ save: async () => { saved += 1; } }, {}, 1);
  assert.deepStrictEqual(gone, [['draft', 'd1'], ['campaign', 'c1']]);
  assert.strictEqual(saved, 0);
  assert.strictEqual(out.draft.imageUrl, '');
});

test('a post with a picture is kept and the calendar row is saved; a failed save does not fail the post', async () => {
  let saved = 0;
  behaviour = async () => ({ draft: { _id: 'd2', imageUrl: 'u' } });
  const out = await defaultDeps().generate({ save: async () => { saved += 1; throw new Error('db'); } }, {}, 1);
  assert.strictEqual(saved, 1);
  assert.strictEqual(out.draft._id, 'd2');
});
