const test = require('node:test');
const assert = require('node:assert');
const { createAlerter } = require('../services/opsAlerts');

function setup(env = {}) {
  let t = 0; const sent = [];
  const a = createAlerter({ env: { ALERT_EMAILS: 'a@x.com, b@x.com', ...env }, now: () => t, send: async (m) => { sent.push(m); } });
  return { a, sent, advance: (ms) => { t += ms; } };
}

test('alerts once the threshold is reached inside the window', async () => {
  const { a, sent } = setup();
  assert.strictEqual(await a.recordFailure('image', 'quota'), false);
  assert.strictEqual(await a.recordFailure('image', 'quota'), false);
  assert.strictEqual(await a.recordFailure('image', 'quota'), true);
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(sent[0].to, ['a@x.com', 'b@x.com']);
  assert.match(sent[0].subject, /Image generation is failing/);
});

test('old failures outside the window do not count', async () => {
  const { a, sent, advance } = setup();
  await a.recordFailure('publish'); await a.recordFailure('publish');
  advance(11 * 60000);
  assert.strictEqual(await a.recordFailure('publish'), false);
  assert.strictEqual(sent.length, 0);
});

test('cooldown stops repeat emails, then allows one again', async () => {
  const { a, sent, advance } = setup();
  for (let i = 0; i < 6; i++) await a.recordFailure('payment');
  assert.strictEqual(sent.length, 1);
  advance(61 * 60000);
  for (let i = 0; i < 3; i++) await a.recordFailure('payment');
  assert.strictEqual(sent.length, 2);
});

test('no recipients means no email, and a send error never throws', async () => {
  const quiet = createAlerter({ env: {}, now: () => 0, send: async () => { throw new Error('x'); } });
  for (let i = 0; i < 3; i++) assert.strictEqual(await quiet.recordFailure('image'), false);
  const broken = createAlerter({ env: { ALERT_EMAILS: 'a@x.com' }, now: () => 0, send: async () => { throw new Error('down'); } });
  for (let i = 0; i < 3; i++) await broken.recordFailure('image');
});
