const test = require('node:test');
const assert = require('node:assert');
const { generateDirectPost } = require('../services/directImage');

function run(language, issuesFirst) {
  const calls = [];
  let n = 0;
  const io = {
    generate: async (prompt, opts) => { calls.push(opts.quality); return { success: true, imageUrl: `https://x/${++n}.jpg`, model: 'm' }; },
    readText: async () => 'Sale 10% off',
    proofread: async () => ({ checked: true, issues: issuesFirst && n === 1 ? [{ kind: 'headline', text: 'x' }] : [] }),
    fetchReference: async () => null,
  };
  return generateDirectPost({ brief: 'Sale 10% off', imageText: 'Sale', language, aspectRatio: '4:5', details: {}, noLogo: true }, io).then((r) => ({ r, calls }));
}

test('plain English starts at low', async () => {
  const { calls, r } = await run('english', false);
  assert.deepStrictEqual(calls, ['low']);
  assert.strictEqual(r.quality, 'low');
});

test('English is remade at medium when the proofreader finds a problem', async () => {
  const { calls, r } = await run('english', true);
  assert.deepStrictEqual(calls, ['low', 'medium']);
  assert.strictEqual(r.quality, 'medium');
});

test('Tamil starts straight at medium', async () => {
  const { calls } = await run('tamil', false);
  assert.deepStrictEqual(calls, ['medium']);
});

test('a medium start that fails the check is remade at high', async () => {
  const { calls } = await run('tamil', true);
  assert.deepStrictEqual(calls, ['medium', 'high']);
});
