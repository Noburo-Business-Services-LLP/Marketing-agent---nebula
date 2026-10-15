const test = require('node:test');
const assert = require('node:assert');
const { proofreadImage, fixInstructions, buildProofreadPrompt } = require('../services/proofread');

test('the proofreader is told the language, the exact lines and the numbers allowed', () => {
  const p = buildProofreadPrompt({ languageName: 'Tamil (Tamil script)', expected: [{ label: 'headline', text: 'தீபாவளி சலுகை' }], allowedNumbers: ['299'] });
  assert.match(p, /Tamil \(Tamil script\)/);
  assert.match(p, /headline: "தீபாவளி சலுகை"/);
  assert.match(p, /Numbers that are allowed to appear: 299/);
});

test('issues come back cleaned, and a model that rejects reasoning_effort is asked again without it', async () => {
  const bodies = [];
  const io = {
    apiKey: 'k',
    fetch: async (url, opts) => {
      const b = JSON.parse(opts.body); bodies.push(b);
      if (b.reasoning_effort) { const t = JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } }); return { ok: false, status: 400, text: async () => t }; }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":false,"issues":[{"kind":"headline","text":"Sael","should_be":"Sale"},{"kind":"bogus","text":"x"}]}' } }] }) };
    },
  };
  const out = await proofreadImage({ imageUrl: 'https://img/1.jpg', languageName: 'English', expected: [{ label: 'headline', text: 'Sale' }] }, io);
  assert.strictEqual(out.checked, true);
  assert.strictEqual(out.ok, false);
  assert.deepStrictEqual(out.issues, [{ kind: 'headline', text: 'Sael', should_be: 'Sale' }]);
  assert.strictEqual(bodies.length, 2);
});

test('with no key, no image or a failed call, it reports "not checked" and never throws', async () => {
  assert.deepStrictEqual((await proofreadImage({ imageUrl: '' }, { apiKey: 'k' })).checked, false);
  const failed = await proofreadImage({ imageUrl: 'https://img/1.jpg' }, { apiKey: 'k', fetch: async () => { throw new Error('network'); } });
  assert.strictEqual(failed.checked, false);
  assert.strictEqual(failed.ok, true);
});

test('fix instructions name what to correct', () => {
  const f = fixInstructions([{ kind: 'headline', text: 'Sael', should_be: 'Sale' }, { kind: 'cut_off', text: 'that want to', should_be: '' }, { kind: 'invented', text: '18+ years', should_be: '' }]);
  assert.deepStrictEqual(f, ['the headline must read exactly "Sale"', 'finish or remove the sentence "that want to"', 'remove "18+ years", it was not given']);
});
