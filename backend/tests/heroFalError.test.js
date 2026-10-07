const test = require('node:test');
const assert = require('node:assert');
const { describeFalError, getHeroClipStatus } = require('../services/heroVideoService');

test('the provider detail is kept next to the generic message', () => {
  const err = Object.assign(new Error('Unprocessable Entity'), { status: 422, body: { detail: [{ loc: ['body', 'image_urls', 0], msg: 'image could not be downloaded' }, { msg: 'prompt too long' }] } });
  assert.strictEqual(describeFalError(err), 'Unprocessable Entity: body.image_urls.0: image could not be downloaded; prompt too long');
});

test('string and message bodies are handled, and a plain error is unchanged', () => {
  assert.strictEqual(describeFalError(Object.assign(new Error('Bad'), { body: { detail: 'content policy' } })), 'Bad: content policy');
  assert.strictEqual(describeFalError(Object.assign(new Error('Bad'), { body: { message: 'nope' } })), 'Bad: nope');
  assert.strictEqual(describeFalError(new Error('plain')), 'plain');
  assert.strictEqual(describeFalError(null), 'fal request failed');
});

test('a finished clip whose result is refused with a client error fails with the provider reason', async () => {
  const err = Object.assign(new Error('Unprocessable Entity'), { status: 422, body: { detail: [{ msg: 'reference image rejected' }] } });
  const fal = { queue: { status: async () => ({ status: 'COMPLETED' }), result: async () => { throw err; } } };
  const out = await getHeroClipStatus('m', 'r', fal);
  assert.strictEqual(out.state, 'failed');
  assert.match(out.error, /reference image rejected/);
});

test('a server error or a dropped connection is still retried, never failed', async () => {
  for (const status of [500, 503, 429, undefined]) {
    const err = Object.assign(new Error('x'), { status });
    const fal = { queue: { status: async () => ({ status: 'COMPLETED' }), result: async () => { throw err; } } };
    await assert.rejects(() => getHeroClipStatus('m', 'r', fal));
  }
});

test('an entry with only a type, or a body in another shape, is still shown (the log said only "Unprocessable Entity")', () => {
  const typed = Object.assign(new Error('Unprocessable Entity'), { body: { detail: [{ loc: ['body'], type: 'content_policy_violation' }] } });
  assert.match(describeFalError(typed), /content_policy_violation/);
  const other = Object.assign(new Error('Unprocessable Entity'), { body: { error: 'face detected', code: 'partner_validation' } });
  assert.match(describeFalError(other), /face detected/);
  assert.ok(describeFalError(other).length <= 500);
  const empty = Object.assign(new Error('Unprocessable Entity'), { body: {} });
  assert.strictEqual(describeFalError(empty), 'Unprocessable Entity');
});
