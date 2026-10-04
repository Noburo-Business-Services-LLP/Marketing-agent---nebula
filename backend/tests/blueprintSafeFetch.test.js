'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchPublicPage, robotsAllows, parseRobots } = require('../services/blueprint/safeFetch');

const PUBLIC = async () => [{ address: '93.184.216.34' }];
const html = (body = '<html><title>Hi</title></html>', headers = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
function counter(impl) {
  const f = async (url, init) => { f.calls.push({ url, init }); return impl(url, init, f.calls.length); };
  f.calls = [];
  return f;
}

test('refuses non-public targets without fetching', async () => {
  for (const url of ['http://example.com/', 'https://localhost/', 'https://10.0.0.5/', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://user:pw@example.com/', 'https://example.com:8443/']) {
    const f = counter(() => html());
    const r = await fetchPublicPage(url, { fetchImpl: f, lookup: PUBLIC });
    assert.equal(r.ok, false, url);
    assert.equal(r.reason, 'blocked', url);
    assert.equal(f.calls.length, 0, url);
  }
});

test('a host resolving to a private address, or a mixed answer, is refused', async () => {
  for (const addrs of [[{ address: '10.1.2.3' }], [{ address: '93.184.216.34' }, { address: '192.168.0.1' }], [{ address: '127.0.0.1' }], [{ address: '169.254.169.254' }], [{ address: 'fd00::1' }], []]) {
    const f = counter(() => html());
    const r = await fetchPublicPage('https://example.com/', { fetchImpl: f, lookup: async () => addrs });
    assert.deepEqual([r.ok, r.reason], [false, 'blocked']);
    assert.equal(f.calls.length, 0);
  }
  const f = counter(() => html());
  const r = await fetchPublicPage('https://example.com/', { fetchImpl: f, lookup: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(r.ok, false);
  assert.equal(f.calls.length, 0);
});

test('a redirect into a private host is refused and never fetched', async () => {
  const f = counter((url) => (url === 'https://example.com/'
    ? new Response(null, { status: 302, headers: { location: 'https://internal.example.net/x' } })
    : html()));
  const lookup = async (h) => (h === 'internal.example.net' ? [{ address: '10.0.0.9' }] : [{ address: '93.184.216.34' }]);
  const r = await fetchPublicPage('https://example.com/', { fetchImpl: f, lookup });
  assert.deepEqual([r.ok, r.reason], [false, 'blocked']);
  assert.equal(f.calls.length, 1);
  // redirect to http and to a literal private address
  for (const loc of ['http://example.com/x', 'https://10.0.0.1/', 'https://169.254.169.254/']) {
    const g = counter(() => new Response(null, { status: 301, headers: { location: loc } }));
    const rr = await fetchPublicPage('https://example.com/', { fetchImpl: g, lookup: PUBLIC });
    assert.equal(rr.reason, 'blocked', loc);
    assert.equal(g.calls.length, 1);
  }
});

test('same-site rule on redirects', async () => {
  const mk = () => counter((url) => (url === 'https://example.com/'
    ? new Response(null, { status: 302, headers: { location: 'https://other.com/' } })
    : html()));
  const r = await fetchPublicPage('https://example.com/', { fetchImpl: mk(), lookup: PUBLIC, sameSiteOf: 'example.com' });
  assert.deepEqual([r.ok, r.reason], [false, 'other_site']);
  const f2 = counter((url) => (url === 'https://example.com/'
    ? new Response(null, { status: 302, headers: { location: 'https://www.example.com/home' } })
    : html()));
  const ok = await fetchPublicPage('https://example.com/', { fetchImpl: f2, lookup: PUBLIC, sameSiteOf: 'www.example.com' });
  assert.equal(ok.ok, true);
  assert.equal(ok.finalUrl, 'https://www.example.com/home');
});

test('redirect limit, type, size and status', async () => {
  const loop = counter(() => new Response(null, { status: 302, headers: { location: 'https://example.com/again' } }));
  assert.equal((await fetchPublicPage('https://example.com/', { fetchImpl: loop, lookup: PUBLIC })).reason, 'redirects');
  assert.equal(loop.calls.length, 4);
  const png = counter(() => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } }));
  assert.equal((await fetchPublicPage('https://example.com/', { fetchImpl: png, lookup: PUBLIC })).reason, 'type');
  const big = counter(() => html('x', { 'content-length': '999999' }));
  assert.equal((await fetchPublicPage('https://example.com/', { fetchImpl: big, lookup: PUBLIC })).reason, 'size');
  const streamed = counter(() => html('a'.repeat(500)));
  assert.equal((await fetchPublicPage('https://example.com/', { fetchImpl: streamed, lookup: PUBLIC, maxBytes: 100 })).reason, 'size');
  const nf = counter(() => new Response('no', { status: 404, headers: { 'content-type': 'text/html' } }));
  const r = await fetchPublicPage('https://example.com/', { fetchImpl: nf, lookup: PUBLIC });
  assert.deepEqual([r.ok, r.reason, r.status], [false, 'status', 404]);
  const thrower = counter(() => { throw new Error('boom'); });
  assert.equal((await fetchPublicPage('https://example.com/', { fetchImpl: thrower, lookup: PUBLIC })).reason, 'error');
});

test('timeout gives timeout and the process can exit', async () => {
  const hang = counter(() => new Promise(() => {}));
  const r = await fetchPublicPage('https://example.com/', { fetchImpl: hang, lookup: PUBLIC, timeoutMs: 20 });
  assert.deepEqual([r.ok, r.reason], [false, 'timeout']);
});

test('a good page is returned, redirects handled by hand', async () => {
  const f = counter(() => html('<html><title>Sweet</title></html>'));
  const r = await fetchPublicPage('https://example.com/', { fetchImpl: f, lookup: PUBLIC });
  assert.equal(r.ok, true);
  assert.match(r.text, /Sweet/);
  assert.equal(r.finalUrl, 'https://example.com/');
  assert.equal(f.calls[0].init.redirect, 'manual');
  assert.match(f.calls[0].init.headers['user-agent'], /NebulaaBlueprint/);
});

test('without a test seam the request is DNS-pinned to the checked address', async () => {
  const heroFinish = require('../services/heroVideoFinish');
  const orig = heroFinish._pinnedFetch;
  const seen = [];
  heroFinish._pinnedFetch = async (url, init, address) => { seen.push({ url, address }); return html(); };
  try {
    const r = await fetchPublicPage('https://example.com/', { lookup: PUBLIC });
    assert.equal(r.ok, true);
    assert.deepEqual(seen, [{ url: 'https://example.com/', address: '93.184.216.34' }]);
  } finally { heroFinish._pinnedFetch = orig; }
});

test('parseRobots and robotsAllows', async () => {
  const txt = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nDisallow:\n';
  assert.deepEqual(parseRobots(txt), ['/private']);
  assert.deepEqual(parseRobots('User-agent: *\nDisallow:\n'), []);
  const robots = (body, status = 200) => counter(() => new Response(body, { status, headers: { 'content-type': 'text/plain' } }));
  const opts = (f) => ({ fetchImpl: f, lookup: PUBLIC });
  assert.equal(await robotsAllows('https://example.com/private/x', opts(robots('User-agent: *\nDisallow: /private'))), false);
  assert.equal(await robotsAllows('https://example.com/shop', opts(robots('User-agent: *\nDisallow: /private'))), true);
  assert.equal(await robotsAllows('https://example.com/shop', opts(robots('User-agent: bot\nDisallow: /'))), true);
  assert.equal(await robotsAllows('https://example.com/shop', opts(robots('User-agent: *\nDisallow:'))), true);
  assert.equal(await robotsAllows('https://example.com/shop', opts(robots('nope', 404))), true);
  const f = robots('');
  await robotsAllows('https://example.com/shop', opts(f));
  assert.equal(f.calls[0].url, 'https://example.com/robots.txt');
});

test('mapped, metadata and link-local answers are refused', async () => {
  for (const address of ['::ffff:10.0.0.1', '::ffff:169.254.169.254', 'fe80::1', '100.64.0.1', '0.0.0.0', '192.0.0.1']) {
    const f = counter(() => html());
    const r = await fetchPublicPage('https://example.com/', { fetchImpl: f, lookup: async () => [{ address }] });
    assert.equal(r.reason, 'blocked', address);
    assert.equal(f.calls.length, 0);
  }
});
