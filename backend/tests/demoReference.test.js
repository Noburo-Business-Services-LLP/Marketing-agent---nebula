const test = require('node:test');
const assert = require('node:assert');
const { readDemoReference } = require('../services/demoProfile');

const fakeFs = (files) => ({
  statSync: (f) => { const b = files[f]; if (!b) throw new Error('nope'); return { isFile: () => true, size: b.length }; },
  readFileSync: (f) => files[f]
});
const dir = '/d';
const URL_OK = 'http://localhost:5000/demo-assets/zaya/products/kumkumadi-glow-serum-1.jpg';

test('a demo product photo is read from the demo folder outside production', () => {
  const r = readDemoReference(URL_OK, { env: {}, dir, fsm: fakeFs({ '/d/products/kumkumadi-glow-serum-1.jpg': Buffer.from('abc') }) });
  assert.deepStrictEqual(r, { mimeType: 'image/jpeg', data: Buffer.from('abc').toString('base64') });
});

test('never in production, never another path, host or type, never over 6 MB', () => {
  const f = fakeFs({ '/d/products/kumkumadi-glow-serum-1.jpg': Buffer.from('abc'), '/d/products/big.jpg': Buffer.alloc(6 * 1024 * 1024 + 1) });
  assert.strictEqual(readDemoReference(URL_OK, { env: { NODE_ENV: 'production' }, dir, fsm: f }), null);
  assert.strictEqual(readDemoReference('https://example.com/demo-assets/zaya/products/kumkumadi-glow-serum-1.jpg', { env: {}, dir, fsm: f }), null);
  assert.strictEqual(readDemoReference('http://localhost:5000/demo-assets/zaya/products/../../.env', { env: {}, dir, fsm: f }), null);
  assert.strictEqual(readDemoReference('http://localhost:5000/demo-assets/zaya/posts/x.jpg', { env: {}, dir, fsm: f }), null);
  assert.strictEqual(readDemoReference('http://localhost:5000/demo-assets/zaya/products/big.jpg', { env: {}, dir, fsm: f }), null);
  assert.strictEqual(readDemoReference('http://localhost:5000/demo-assets/zaya/products/missing.jpg', { env: {}, dir, fsm: f }), null);
  assert.strictEqual(readDemoReference(null), null);
});
