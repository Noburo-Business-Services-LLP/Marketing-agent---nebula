import test from 'node:test';
import assert from 'node:assert/strict';
import { shareInflight, isShareableRead } from '../utils/inflight.ts';

test('two identical reads started together make one request and share the answer', async () => {
  let calls = 0;
  const start = () => new Promise((r) => { calls++; setTimeout(() => r({ n: calls }), 5); });
  const [a, b] = await Promise.all([shareInflight('k', start), shareInflight('k', start)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
});

test('a read after the first one has finished asks again (nothing is cached)', async () => {
  let calls = 0;
  const start = async () => ++calls;
  assert.equal(await shareInflight('k2', start), 1);
  assert.equal(await shareInflight('k2', start), 2);
});

test('a failed read is not kept: the next call tries again, and both waiting callers see the failure', async () => {
  let calls = 0;
  const bad = () => new Promise((_, rej) => { calls++; setTimeout(() => rej(new Error('no')), 2); });
  const results = await Promise.allSettled([shareInflight('k3', bad), shareInflight('k3', bad)]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
  assert.equal(calls, 1);
  assert.equal(await shareInflight('k3', async () => 'fine'), 'fine');
});

test('different keys never share', async () => {
  let calls = 0;
  const start = async () => ++calls;
  await Promise.all([shareInflight('a', start), shareInflight('b', start)]);
  assert.equal(calls, 2);
});

test('only plain reads may share', () => {
  assert.equal(isShareableRead({}), true);
  assert.equal(isShareableRead({ method: 'GET' }), true);
  assert.equal(isShareableRead({ method: 'POST' }), false);
  assert.equal(isShareableRead({ method: 'GET', body: '{}' }), false);
  assert.equal(isShareableRead({ method: 'GET', signal: {} }), false);
  assert.equal(isShareableRead({ method: 'GET', headers: { 'X-A': '1' } }), false);
});
