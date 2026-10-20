'use strict';
// safeFetch (hardening C4, SSRF). Everything runs against a local server on 127.0.0.1 and a random port; the
// local server is reachable ONLY with the explicit allowPrivateForTests argument. No real outbound network:
// public-looking host names get their DNS answer from the `lookup` test seam.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const sf = require('../services/safeFetch');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let server; let base; let port; const hits = {};

test.before(async () => {
  server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    hits[p] = (hits[p] || 0) + 1;
    if (p === '/img') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
    if (p === '/host') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ host: req.headers.host, auth: req.headers.authorization || null })); return; }
    if (p === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>hi</h1>'); return; }
    if (p === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return; }
    if (p === '/hop1') { res.writeHead(302, { location: '/hop2' }); res.end(); return; }
    if (p === '/hop2') { res.writeHead(301, { location: `${base}/img` }); res.end(); return; }
    if (p === '/to-private') { res.writeHead(302, { location: 'http://10.0.0.1/secret' }); res.end(); return; }
    if (p === '/to-metadata') { res.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
    if (p === '/to-ecs') { res.writeHead(302, { location: 'http://169.254.170.2/v2/credentials' }); res.end(); return; }
    if (p === '/to-name') { res.writeHead(302, { location: `http://internal.example.com:${port}/img` }); res.end(); return; }
    if (p === '/to-other-origin') { res.writeHead(302, { location: `http://localhost:${port}/host` }); res.end(); return; }
    if (p === '/big') {
      res.writeHead(200, { 'content-type': 'image/png' });
      let n = 0;
      const push = () => { if (n++ > 400 || res.destroyed) { res.end(); return; } res.write(Buffer.alloc(64 * 1024)); setImmediate(push); };
      push();
      return;
    }
    if (p === '/declared-big') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(50 * 1024 * 1024) }); res.end(); return; }
    if (p === '/slow') { res.writeHead(200, { 'content-type': 'image/png' }); res.write(PNG.subarray(0, 4)); setTimeout(() => { try { res.end(PNG.subarray(4)); } catch (_) { /* gone */ } }, 3000); return; }
    if (p === '/slow-head') { setTimeout(() => { try { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); } catch (_) { /* gone */ } }, 3000); return; }
    if (p === '/404') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('nope'); return; }
    res.writeHead(500); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
test.after(() => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }));

const T = { allowPrivateForTests: true, allowHttp: true };
const code = (c) => (e) => { assert.strictEqual(e.code, c, `${e.code}: ${e.message}`); return true; };

test('a normal image downloads (local server reachable only with the explicit test argument)', async () => {
  const r = await sf.safeFetchBuffer(`${base}/img`, { ...T, types: sf.IMAGE_TYPES });
  assert.deepStrictEqual(r.buffer, PNG);
  assert.strictEqual(r.contentType, 'image/png');
  assert.strictEqual(r.status, 200);
  const res = await sf.safeFetchResponse(`${base}/img`, { ...T, types: ['image/'] });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), PNG);
  assert.match(await sf.safeFetchDataUrl(`${base}/img`, T), /^data:image\/png;base64,/);
});

test('loopback is refused without the test argument, and the server is never asked', async () => {
  const before = hits['/img'] || 0;
  await assert.rejects(sf.safeFetchBuffer(`${base}/img`, { allowHttp: true, ports: [port] }), code('private_address'));
  await assert.rejects(sf.safeFetchBuffer(`http://localhost:${port}/img`, { allowHttp: true, ports: [port] }), code('private_address'));
  await assert.rejects(sf.safeFetchBuffer('http://127.1.2.3/img', { allowHttp: true }), code('private_address'));
  assert.strictEqual(hits['/img'] || 0, before);
  assert.strictEqual(await sf.safeFetchDataUrl(`${base}/img`, { allowHttp: true, ports: [port] }), '');
});

test('the test argument cannot be turned on by the environment and is ignored in production', async () => {
  process.env.ALLOW_PRIVATE_FOR_TESTS = '1'; process.env.SAFE_FETCH_ALLOW_PRIVATE = '1';
  try {
    await assert.rejects(sf.safeFetchBuffer(`${base}/img`, { allowHttp: true, ports: [port] }), code('private_address'));
  } finally { delete process.env.ALLOW_PRIVATE_FOR_TESTS; delete process.env.SAFE_FETCH_ALLOW_PRIVATE; }
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(sf.safeFetchBuffer(`${base}/img`, { ...T, ports: [port] }), code('private_address'));
  } finally { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; }
});

test('cloud metadata, ECS task metadata, RFC 1918, CGNAT and IPv6 loopback literals are refused even in test mode', async () => {
  for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://169.254.170.2/v2/credentials', 'http://10.0.0.1/', 'http://192.168.1.1/',
    'http://172.16.5.4/', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/',
    'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[64:ff9b::a00:1]/', 'https://[::ffff:10.0.0.1]/']) {
    await assert.rejects(sf.safeFetchBuffer(u, { allowHttp: true }), code('private_address'), u);
  }
  // test mode opens loopback only, never other private ranges
  await assert.rejects(sf.safeFetchBuffer('http://169.254.169.254/', T), code('private_address'));
  await assert.rejects(sf.safeFetchBuffer('http://10.0.0.1/', T), code('private_address'));
});

test('a public-looking name that resolves to a private address (10.0.0.1, metadata, mixed answer, IPv6) is refused before connecting', async () => {
  const ask = (addrs) => async () => addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  for (const addrs of [['10.0.0.1'], ['169.254.169.254'], ['93.184.216.34', '10.0.0.5'], ['::1'], ['::ffff:192.168.0.1'], ['fc00::5']]) {
    await assert.rejects(sf.safeFetchBuffer('https://cdn.example.com/a.png', { lookup: ask(addrs) }), code('private_address'), addrs.join(','));
  }
  await assert.rejects(sf.safeFetchBuffer('https://nohost.example.com/a.png', { lookup: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } }), code('dns'));
  await assert.rejects(sf.safeFetchBuffer('https://empty.example.com/a.png', { lookup: async () => [] }), code('dns'));
});

test('the connection goes to the CHECKED address (DNS pinned) while the Host header keeps the real name', async () => {
  let asked = 0;
  const lookup = async () => { asked += 1; return [{ address: '127.0.0.1', family: 4 }]; };
  const j = await sf.safeFetchJson(`http://pinned.example.com:${port}/host`, { ...T, lookup });
  assert.strictEqual(j.host, `pinned.example.com:${port}`);
  assert.strictEqual(asked, 1, 'resolved once; the request did not ask DNS again');
});

test('redirects: followed by hand up to 3, a redirect to a private address or metadata is refused', async () => {
  const r = await sf.safeFetchBuffer(`${base}/hop1`, { ...T, types: ['image/'] });
  assert.deepStrictEqual(r.buffer, PNG);
  assert.strictEqual(r.finalUrl, `${base}/img`);
  for (const p of ['/to-private', '/to-metadata', '/to-ecs']) {
    await assert.rejects(sf.safeFetchBuffer(`${base}${p}`, T), code('private_address'), p);
  }
  const lookup = async (h) => (h === 'internal.example.com' ? [{ address: '10.1.1.1', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(sf.safeFetchBuffer(`${base}/to-name`, { ...T, lookup }), code('private_address'));
  await assert.rejects(sf.safeFetchBuffer(`${base}/hop1`, { ...T, maxRedirects: 1 }), code('too_many_redirects'));
});

test('a redirect loop stops after 3 hops', async () => {
  hits['/loop'] = 0;
  await assert.rejects(sf.safeFetchBuffer(`${base}/loop`, T), code('too_many_redirects'));
  assert.strictEqual(hits['/loop'], 4, 'the first request and 3 redirects');
});

test('authorization is dropped when a redirect leaves the origin', async () => {
  const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  const j = await sf.safeFetchJson(`${base}/to-other-origin`, { ...T, lookup, headers: { Authorization: 'Bearer x' } });
  assert.strictEqual(j.auth, null);
  const same = await sf.safeFetchJson(`${base}/host`, { ...T, headers: { Authorization: 'Bearer x' } });
  assert.strictEqual(same.auth, 'Bearer x');
});

test('an oversize body is cut off while streaming; a declared size over the cap is refused before reading', async () => {
  await assert.rejects(sf.safeFetchBuffer(`${base}/big`, { ...T, maxBytes: 1024 * 1024 }), code('too_big'));
  await assert.rejects(sf.safeFetchBuffer(`${base}/declared-big`, T), code('too_big'));
  const res = await sf.safeFetchResponse(`${base}/big`, { ...T, maxBytes: 512 * 1024 });
  await assert.rejects(res.arrayBuffer());
  const s = await sf.safeFetchStream(`${base}/big`, { ...T, maxBytes: 256 * 1024 });
  await assert.rejects((async () => { for await (const _ of s.stream) { /* drain */ } })(), code('too_big'));
});

test('a slow body or slow headers hit the time limit', async () => {
  const t0 = Date.now();
  await assert.rejects(sf.safeFetchBuffer(`${base}/slow`, { ...T, timeoutMs: 300 }), code('timeout'));
  await assert.rejects(sf.safeFetchBuffer(`${base}/slow-head`, { ...T, timeoutMs: 300 }), code('timeout'));
  assert.ok(Date.now() - t0 < 2500, 'both stopped near the limit');
});

test('content type allowlist per call site', async () => {
  await assert.rejects(sf.safeFetchBuffer(`${base}/html`, { ...T, types: sf.IMAGE_TYPES }), code('bad_type'));
  await assert.rejects(sf.safeFetchBuffer(`${base}/img`, { ...T, types: ['video/'] }), code('bad_type'));
  assert.ok((await sf.safeFetchBuffer(`${base}/html`, { ...T, types: ['text/'] })).buffer.length);
  assert.strictEqual(await sf.safeFetchDataUrl(`${base}/html`, T), '', 'data URLs are images only');
});

test('non-2xx: the buffer helper throws bad_status, the Response helper returns it', async () => {
  await assert.rejects(sf.safeFetchBuffer(`${base}/404`, T), (e) => e.code === 'bad_status' && e.status === 404);
  const res = await sf.safeFetchResponse(`${base}/404`, T);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 404);
});

test('link rules: https only (http by option or ALLOW_HTTP_FETCH=1), no credentials, ports 80/443 unless listed, valid links only', async () => {
  await assert.rejects(sf.safeFetchBuffer('http://cdn.example.com/a.png', { lookup: async () => [{ address: '93.184.216.34' }] }), code('protocol'));
  for (const u of ['file:///etc/passwd', 'ftp://cdn.example.com/a', 'gopher://x.example.com/', 'data:text/plain,hi', 'javascript:alert(1)']) {
    await assert.rejects(sf.safeFetchBuffer(u, { allowHttp: true }), code('protocol'), u);
  }
  await assert.rejects(sf.safeFetchBuffer('https://user:pw@cdn.example.com/a.png'), code('credentials'));
  await assert.rejects(sf.safeFetchBuffer('https://cdn.example.com:8443/a.png'), code('port'));
  await assert.rejects(sf.safeFetchBuffer('https://cdn.example.com:22/a.png'), code('port'));
  for (const u of ['', 'not a url', `https://x.example.com/${'a'.repeat(5000)}`, null, 42]) {
    await assert.rejects(sf.safeFetchBuffer(u), code('bad_url'), String(u).slice(0, 20));
  }
  process.env.ALLOW_HTTP_FETCH = '1';
  try {
    assert.strictEqual(sf.checkUrl('http://cdn.example.com/a.png').port, 80);
  } finally { delete process.env.ALLOW_HTTP_FETCH; }
  assert.strictEqual(sf.checkUrl('https://cdn.example.com:8443/a', { ports: [8443] }).port, 8443);
  await assert.rejects(sf.safeFetchBuffer('https://cdn.example.com/a', { method: 'POST' }), code('bad_url'));
});

test('address classification', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.170.2', '100.64.0.1', '100.127.255.255',
    '0.0.0.0', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '192.0.0.8',
    '::', '::1', '::127.0.0.1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    '::ffff:a9fe:a9fe', '64:ff9b::10.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b:1::1', '2002:0a00:0001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '2001:db8::1', '100::1', 'nonsense', '', null, undefined, '1.2.3', '256.1.1.1']) {
    assert.ok(sf.isBlockedAddress(ip), String(ip));
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '157.240.1.1', '172.32.0.1', '100.128.0.1', '2a03:2880:f12f:83:face:b00c:0:25de', '2606:4700::6810:84e5',
    '64:ff9b::808:808', '::ffff:8.8.8.8', '2002:0808:0808::1']) {
    assert.ok(!sf.isBlockedAddress(ip), ip);
  }
});

test('the connect-time lookup refuses private answers and passes public ones through', async () => {
  const dns = require('dns');
  const real = dns.lookup;
  try {
    dns.lookup = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
    const err = await new Promise((r) => sf.safeLookup('rebind.example.com', {}, (e) => r(e)));
    assert.strictEqual(err.code, 'private_address');
    dns.lookup = (h, o, cb) => cb(null, [{ address: '157.240.1.1', family: 4 }]);
    assert.deepStrictEqual(await new Promise((r) => sf.safeLookup('x.example.com', {}, (e, a, f) => r([e, a, f]))), [null, '157.240.1.1', 4]);
    assert.deepStrictEqual(await new Promise((r) => sf.safeLookup('x.example.com', { all: true }, (e, l) => r(l))), [{ address: '157.240.1.1', family: 4 }]);
  } finally { dns.lookup = real; }
});

test('data: pictures only with allowDataUrl, under the same type list and cap, with no network', async () => {
  const d = `data:image/png;base64,${PNG.toString('base64')}`;
  await assert.rejects(sf.safeFetchBuffer(d), code('protocol'));
  assert.deepStrictEqual((await sf.safeFetchBuffer(d, { allowDataUrl: true, types: ['image/'] })).buffer, PNG);
  const res = await sf.safeFetchResponse(d, { allowDataUrl: true });
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  await assert.rejects(sf.safeFetchBuffer('data:text/html;base64,PGgxPg==', { allowDataUrl: true, types: ['image/'] }), code('bad_type'));
  await assert.rejects(sf.safeFetchBuffer(d, { allowDataUrl: true, maxBytes: 4 }), code('too_big'));
  await assert.rejects(sf.safeFetchBuffer('data:image/png,notbase64', { allowDataUrl: true }), code('bad_url'));
});
