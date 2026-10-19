// Reference photos come from customer-controlled links: private addresses, odd ports, redirects into the network and
// endless bodies are all refused. No real network: DNS, the request and node's https are fakes.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const dns = require('dns');
const https = require('https');
const { loadRef, safeUrl } = require('../services/photoshoot/refs');
const avatar = require('../services/competitors/avatar');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20, 3)]);
const okRes = { status: 200, headers: { 'content-type': 'image/png' }, body: png };
const addrs = (...a) => async () => a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const PUBLIC = addrs('93.184.216.34');

test('a host that resolves to a private, loopback or link-local address is refused before any request', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.9', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    let calls = 0;
    const r = await loadRef('https://10.0.0.5.nip.io/a.png', { request: async () => { calls += 1; return okRes; }, resolve: addrs(ip) });
    assert.strictEqual(r, null, ip);
    assert.strictEqual(calls, 0, `${ip}: no request is made`);
  }
  // one private address among public ones is enough to refuse
  assert.strictEqual(await loadRef('https://shop.example.com/a.png', { request: async () => okRes, resolve: addrs('93.184.216.34', '127.0.0.1') }), null);
  assert.strictEqual(await loadRef('https://nohost.example.com/a.png', { request: async () => okRes, resolve: async () => { throw new Error('ENOTFOUND'); } }), null);
});

test('only port 443 is allowed', async () => {
  assert.ok(safeUrl('https://shop.example.com:443/a.png'));
  assert.ok(!safeUrl('https://shop.example.com:8080/a.png'));
  let calls = 0;
  assert.strictEqual(await loadRef('https://shop.example.com:8080/a.png', { request: async () => { calls += 1; return okRes; }, resolve: PUBLIC }), null);
  assert.strictEqual(calls, 0);
});

test('redirects are followed at most twice and every hop is checked again', async () => {
  const seen = [];
  const hops = { 'https://a.example.com/x': 'https://b.example.com/y', 'https://b.example.com/y': 'https://c.example.com/z' };
  const request = async (url) => { seen.push(url); return hops[url] ? { status: 302, headers: { location: hops[url] }, body: Buffer.alloc(0) } : okRes; };
  assert.ok(await loadRef('https://a.example.com/x', { request, resolve: PUBLIC }), 'two redirects are fine');
  assert.deepStrictEqual(seen, ['https://a.example.com/x', 'https://b.example.com/y', 'https://c.example.com/z']);
  // a third redirect is refused
  const loop = async (url) => ({ status: 301, headers: { location: `${url}x` }, body: Buffer.alloc(0) });
  assert.strictEqual(await loadRef('https://a.example.com/', { request: loop, resolve: PUBLIC }), null);
  // redirect to a host that resolves privately
  const resolve = async (host) => [{ address: host === 'evil.example.com' ? '169.254.169.254' : '93.184.216.34', family: 4 }];
  let reached = 0;
  const toPrivate = async (url) => { reached += 1; return url.includes('evil') ? okRes : { status: 302, headers: { location: 'https://evil.example.com/m' }, body: Buffer.alloc(0) }; };
  assert.strictEqual(await loadRef('https://a.example.com/x', { request: toPrivate, resolve }), null);
  assert.strictEqual(reached, 1, 'the private hop is never requested');
  // redirect to a literal IP, a plain http link, or another port
  for (const loc of ['https://127.0.0.1/a.png', 'http://b.example.com/a.png', 'https://b.example.com:8443/a.png']) {
    const r = await loadRef('https://a.example.com/x', { request: async () => ({ status: 302, headers: { location: loc }, body: Buffer.alloc(0) }), resolve: PUBLIC });
    assert.strictEqual(r, null, loc);
  }
});

test('only image content types are accepted', async () => {
  for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', '']) {
    assert.strictEqual(await loadRef('https://a.example.com/x', { request: async () => ({ status: 200, headers: { 'content-type': type }, body: png }), resolve: PUBLIC }), null, type);
  }
  assert.ok(await loadRef('https://a.example.com/x', { request: async () => ({ status: 200, headers: { 'content-type': 'image/png; charset=binary' }, body: png }), resolve: PUBLIC }));
});

test('the real request is made with the checked lookup and an oversize stream is aborted early', async () => {
  const original = https.get;
  const sent = []; let destroyed = false; let opts = null;
  https.get = (url, o, cb) => {
    opts = o;
    const req = new EventEmitter(); req.destroy = () => { destroyed = true; };
    const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': 'image/png' };
    setImmediate(() => {
      cb(res);
      for (let i = 0; i < 1000 && !destroyed; i += 1) { sent.push(i); res.emit('data', Buffer.alloc(1024 * 1024)); }
    });
    return req;
  };
  try {
    const r = await loadRef('https://a.example.com/x', { resolve: PUBLIC, maxBytes: 3 * 1024 * 1024 });
    assert.strictEqual(r, null);
    assert.strictEqual(opts.lookup, avatar.safeLookup, 'the address is checked again when the connection is made');
    assert.ok(destroyed, 'the connection is dropped');
    assert.ok(sent.length <= 4, `stopped after ${sent.length} MB, not the whole stream`);
  } finally { https.get = original; }
});

test('happy path through the real request code with a fake https', async () => {
  const original = https.get;
  https.get = (url, o, cb) => {
    const req = new EventEmitter(); req.destroy = () => {};
    const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': 'image/png' };
    setImmediate(() => { cb(res); res.emit('data', png); res.emit('end'); });
    return req;
  };
  try {
    assert.deepStrictEqual(await loadRef('https://res.cloudinary.com/x/image/upload/a.png', { resolve: PUBLIC }), { mimeType: 'image/png', data: png.toString('base64') });
  } finally { https.get = original; }
});

test('the connect-time lookup refuses a private answer (rebinding)', async () => {
  const original = dns.lookup;
  dns.lookup = (host, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
  try {
    const err = await new Promise((res) => avatar.safeLookup('rebind.example.com', {}, (e) => res(e)));
    assert.strictEqual(err && err.code, 'private_address');
  } finally { dns.lookup = original; }
});
