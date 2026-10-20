'use strict';
/**
 * safeFetch: the ONE way the server downloads a link that a person, a stored record or another service gave us
 * (hardening item C4, SSRF). Fixed provider endpoints (api.openai.com, Gemini, Ayrshare, ...) keep their own fetch.
 *
 * Rules, checked for the first link and again for EVERY redirect hop:
 *  - `https:` only; `http:` only when the call site passes `allowHttp: true` or `ALLOW_HTTP_FETCH=1` is set.
 *  - no user name or password in the link; port 80 or 443 unless the call site lists more in `ports`.
 *  - the host is resolved with dns.lookup({ all: true }) and refused when ANY address is not public: loopback,
 *    RFC 1918, link-local 169.254.0.0/16 (cloud metadata 169.254.169.254, ECS task metadata 169.254.170.2),
 *    CGNAT 100.64.0.0/10, multicast, reserved, unspecified, documentation, and the IPv6 equivalents (::1, ::,
 *    fc00::/7, fe80::/10, fec0::/10, ff00::/8, IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible, NAT64 64:ff9b::/96
 *    judged by the IPv4 address inside, 6to4 judged likewise, Teredo refused).
 *  - the connection is made to the address that was checked (the request's `lookup` is pinned), so a second DNS
 *    answer (rebinding) cannot change the target; TLS still checks the certificate for the real host name.
 *  - redirects are followed by hand (at most 3 by default); authorization and cookie headers are dropped when a
 *    redirect leaves the origin.
 *  - one overall time limit (15 s default) covering every hop and the body; the body is counted while it streams
 *    and cut off past the size cap (25 MB default); a declared Content-Length over the cap is refused before reading.
 *  - an optional content-type allowlist per call site (`types: ['image/', 'video/mp4']`, entries ending in '/' are
 *    prefixes).
 *
 * `allowPrivateForTests: true` lets a test reach a local server on 127.0.0.0/8 or ::1 (any port). It is a function
 * argument only (no environment variable can turn it on) and it is ignored when NODE_ENV is 'production'.
 * `lookup` (async host -> [{ address, family }]) is a test seam for the DNS answer.
 *
 * Errors are SafeFetchError with a `code`: protocol, credentials, port, bad_url, private_address, dns,
 * too_many_redirects, bad_redirect, timeout, too_big, bad_type, bad_status (with `status`), network.
 */
const net = require('net');
const http = require('http');
const https = require('https');
const { Transform, Readable } = require('stream');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 4096;
const USER_AGENT = 'NebulaaFetch/1.0 (+https://nebulaa.ai)';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/', 'application/octet-stream'];

class SafeFetchError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'SafeFetchError';
    this.code = code;
    Object.assign(this, extra);
  }
}
const fail = (code, message, extra) => { throw new SafeFetchError(code, message, extra); };

// ---------------------------------------------------------------------------
// Address rules
// ---------------------------------------------------------------------------

function v4Parts(s) {
  const p = String(s).split('.');
  if (p.length !== 4) return null;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return n.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? n : null;
}

function blockedV4([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || a >= 224 // this network, private, loopback, multicast, reserved, broadcast
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local, cloud and ECS metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) // IETF protocol assignments, documentation
    || (a === 192 && b === 88 && c === 99) // 6to4 relay
    || (a === 198 && (b === 18 || b === 19)) // benchmarking
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113); // documentation
}

// Eight 16-bit groups, or null. Accepts '::' shortening, an IPv4 tail and a zone id.
function v6Groups(input) {
  let s = String(input).toLowerCase().split('%')[0];
  if (net.isIP(s) !== 6) return null;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const p = v4Parts(tail[1]);
    if (!p) return null;
    s = s.slice(0, -tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const all = [...left, ...Array(Math.max(0, fill)).fill('0'), ...right].map((h) => parseInt(h, 16));
  return all.length === 8 && all.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? all : null;
}

const v4FromGroups = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/** True for every address the server must never connect to on a person's behalf (and for anything not an IP). */
function isBlockedAddress(ip) {
  const s = String(ip == null ? '' : ip).trim().replace(/^\[|\]$/g, '');
  const kind = net.isIP(s.split('%')[0]);
  if (kind === 4) { const p = v4Parts(s); return !p || blockedV4(p); }
  if (kind !== 6) return true;
  const g = v6Groups(s);
  if (!g) return true;
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return blockedV4(v4FromGroups(g[6], g[7])); // IPv4-mapped
  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedV4(v4FromGroups(g[6], g[7])); // NAT64
  if (g[0] === 0x0064 && g[1] === 0xff9b) return true; // NAT64 local-use 64:ff9b:1::/48
  if (g[0] === 0x2002) return blockedV4(v4FromGroups(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if ((g[0] & 0xe000) !== 0x2000) return true; // only 2000::/3 is global unicast (drops fc00::/7, fe80::/10, ff00::/8, 100::/64)
  return false;
}

// The local test server exception: 127.0.0.0/8 and ::1 only, never other private ranges.
function isLoopback(ip) {
  const s = String(ip || '').replace(/^\[|\]$/g, '');
  if (net.isIP(s) === 4) return s.startsWith('127.');
  const g = net.isIP(s) === 6 ? v6Groups(s) : null;
  return !!g && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
}

function testMode(opts) {
  return !!(opts && opts.allowPrivateForTests === true) && process.env.NODE_ENV !== 'production';
}

function addressAllowed(address, opts) {
  if (!isBlockedAddress(address)) return true;
  return testMode(opts) && isLoopback(address);
}

// ---------------------------------------------------------------------------
// Link rules
// ---------------------------------------------------------------------------

function httpAllowed(opts) {
  return (opts && opts.allowHttp === true) || process.env.ALLOW_HTTP_FETCH === '1';
}

/** Parses and checks one link (no DNS). Returns { url, host, port, ipLiteral }. Throws SafeFetchError. */
function checkUrl(raw, opts = {}) {
  const s = typeof raw === 'string' ? raw.trim() : (raw instanceof URL ? raw.href : '');
  if (!s || s.length > MAX_URL_LENGTH) fail('bad_url', 'The link is empty or too long');
  let u;
  try { u = new URL(s); } catch (_) { fail('bad_url', 'The link is not valid'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && httpAllowed(opts))) fail('protocol', `Links must use https (got ${u.protocol})`);
  if (u.username || u.password) fail('credentials', 'Links with a user name or password are refused');
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  const ports = [80, 443, ...((opts && Array.isArray(opts.ports)) ? opts.ports.map(Number) : [])];
  if (!ports.includes(port) && !testMode(opts)) fail('port', `Port ${port} is not allowed`);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) fail('bad_url', 'The link has no host');
  const ipLiteral = net.isIP(host) ? host : '';
  if (ipLiteral) {
    if (!addressAllowed(ipLiteral, opts)) fail('private_address', 'The link points at a private address');
  } else if ((host === 'localhost' || host.endsWith('.localhost')) && !testMode(opts)) {
    fail('private_address', 'The link points at this machine');
  }
  return { url: u, host, port, ipLiteral };
}

const defaultLookupAll = (host) => require('dns').promises.lookup(host, { all: true, verbatim: true });

/** Resolves a host and returns ONE checked address, refusing the whole answer when any address is not public. */
async function resolveChecked(host, opts = {}) {
  let list;
  try {
    list = await (typeof opts.lookup === 'function' ? opts.lookup : defaultLookupAll)(host);
  } catch (_) {
    fail('dns', 'The host could not be found');
  }
  const addrs = (Array.isArray(list) ? list : [list])
    .map((a) => (a && typeof a === 'object' ? { address: a.address, family: a.family || net.isIP(a.address) } : { address: a, family: net.isIP(a) }))
    .filter((a) => a.address);
  if (!addrs.length) fail('dns', 'The host could not be found');
  if (addrs.some((a) => !addressAllowed(a.address, opts))) fail('private_address', 'The host resolves to a private address');
  return { address: addrs[0].address, family: addrs[0].family === 6 ? 6 : 4 };
}

/**
 * A dns.lookup stand-in for http(s).request that refuses private answers at connect time. For code that keeps its
 * own request but must check the address actually connected to (competitor pictures). Reads dns.lookup at call time.
 */
function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const o = typeof options === 'object' && options ? options : {};
  require('dns').lookup(hostname, { ...o, all: true }, (err, list) => {
    if (err) return cb(err);
    const addrs = Array.isArray(list) ? list : [];
    if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) return cb(new SafeFetchError('private_address', 'The host resolves to a private address'));
    if (o.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function typeAllowed(contentType, types) {
  if (!Array.isArray(types) || !types.length) return true;
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!t) return false;
  return types.some((x) => { const v = String(x).toLowerCase(); return v.endsWith('/') ? t.startsWith(v) : t === v; });
}

// One request to the checked address. Resolves the Node response (body unread).
function requestOnce(target, address, init, signal) {
  return new Promise((resolve, reject) => {
    const { url, host } = target;
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      protocol: url.protocol,
      hostname: host,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method,
      headers: init.headers,
      servername: net.isIP(host) ? undefined : host,
      lookup: (h, o, cb) => (o && o.all ? cb(null, [address]) : cb(null, address.address, address.family)),
      agent: false,
      signal
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

function cleanHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) if (v !== undefined && v !== null) out[String(k).toLowerCase()] = String(v);
  return out;
}

/**
 * Opens a link under every rule above and follows redirects. Resolves
 * { status, headers (lower-case object), finalUrl, contentType, stream (a capped Readable, or null for HEAD and
 * bodyless answers), done() } once the final answer's headers arrive. The time limit keeps running until the body
 * ends, errors or done() is called. Throws SafeFetchError.
 */
async function openSafe(rawUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const maxRedirects = Number.isInteger(opts.maxRedirects) && opts.maxRedirects >= 0 ? opts.maxRedirects : DEFAULT_MAX_REDIRECTS;
  const method = String(opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') fail('bad_url', 'Only GET and HEAD are supported');

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  const done = () => clearTimeout(timer);
  const aborted = new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new SafeFetchError('timeout', 'The download took too long')), { once: true }));
  aborted.catch(() => {});
  const race = (p) => Promise.race([p, aborted]);

  let headers = { 'user-agent': USER_AGENT, accept: '*/*', ...cleanHeaders(opts.headers), 'accept-encoding': 'identity' };
  let current = rawUrl;
  try {
    for (let hop = 0; ; hop += 1) {
      const target = checkUrl(current, opts);
      const address = target.ipLiteral
        ? { address: target.ipLiteral, family: net.isIP(target.ipLiteral) }
        : await race(resolveChecked(target.host, opts));
      let res;
      try {
        res = await race(requestOnce(target, address, { method, headers: { ...headers, host: target.url.host } }, ctrl.signal));
      } catch (e) {
        if (e instanceof SafeFetchError) throw e;
        if (ctrl.signal.aborted) fail('timeout', 'The download took too long');
        fail('network', `The download failed (${(e && e.code) || 'network error'})`);
      }
      const status = Number(res.statusCode);
      if (REDIRECTS.has(status)) {
        res.resume();
        const loc = res.headers.location;
        if (!loc) fail('bad_redirect', 'A redirect without a location');
        if (hop >= maxRedirects) fail('too_many_redirects', 'Too many redirects');
        let next;
        try { next = new URL(String(loc), target.url); } catch (_) { fail('bad_redirect', 'A redirect to a link that is not valid'); }
        if (next.origin !== target.url.origin) { const { authorization, cookie, ...rest } = headers; headers = rest; }
        current = next.href;
        continue;
      }
      const contentType = String(res.headers['content-type'] || '');
      const ok = status >= 200 && status < 300;
      if (ok && method === 'GET' && !typeAllowed(contentType, opts.types)) { res.resume(); fail('bad_type', `This kind of file is not accepted (${contentType.split(';')[0] || 'none'})`, { status }); }
      const declared = Number(res.headers['content-length']);
      if (method === 'GET' && Number.isFinite(declared) && declared > maxBytes) { res.resume(); fail('too_big', 'The file is too large', { status }); }
      const bodyless = method === 'HEAD' || status === 204 || status === 304 || status < 200;
      let stream = null;
      if (bodyless) { res.resume(); done(); } else {
        let seen = 0;
        let ended = false; // the first reason wins; later errors from tearing the socket down are ignored
        const stop = (err) => { if (ended) return; ended = true; capped.destroy(err); res.destroy(); };
        const capped = new Transform({
          transform(chunk, _enc, cb) {
            seen += chunk.length;
            if (seen > maxBytes) { cb(); stop(new SafeFetchError('too_big', 'The file is too large', { status })); return; }
            cb(null, chunk);
          },
          flush(cb) { ended = true; cb(); }
        });
        const cut = () => stop(timedOut ? new SafeFetchError('timeout', 'The download took too long') : new SafeFetchError('network', 'The download was cut off'));
        res.on('error', cut);
        res.on('aborted', cut);
        ctrl.signal.addEventListener('abort', () => stop(new SafeFetchError('timeout', 'The download took too long')), { once: true });
        capped.on('close', done);
        res.pipe(capped);
        stream = capped;
      }
      return { status, ok, headers: cleanHeaders(res.headers), contentType, finalUrl: target.url.href, stream, done };
    }
  } catch (e) {
    done();
    ctrl.abort();
    if (e instanceof SafeFetchError) throw e;
    throw new SafeFetchError(timedOut ? 'timeout' : 'network', timedOut ? 'The download took too long' : 'The download failed');
  }
}

async function readAll(stream) {
  if (!stream) return Buffer.alloc(0);
  const parts = [];
  for await (const c of stream) parts.push(c);
  return Buffer.concat(parts);
}

const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?(?:;[a-z0-9=.+-]+)*;base64,([a-z0-9+/=\s]*)$/i;

// `allowDataUrl: true` (call sites that always accepted a stored data: picture): decoded locally, no network,
// under the same type allowlist and size cap.
function decodeDataUrl(raw, opts) {
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const s = String(raw);
  if (s.length > Math.ceil(maxBytes * 1.37) + 200) fail('too_big', 'The file is too large');
  const m = DATA_URL.exec(s);
  if (!m) fail('bad_url', 'The data link is not valid');
  const contentType = String(m[1] || 'application/octet-stream').toLowerCase();
  if (!typeAllowed(contentType, opts.types)) fail('bad_type', `This kind of file is not accepted (${contentType})`);
  const buffer = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length > maxBytes) fail('too_big', 'The file is too large');
  return { buffer, contentType, status: 200, headers: { 'content-type': contentType }, finalUrl: '' };
}
const isDataUrl = (url, opts) => opts && opts.allowDataUrl === true && typeof url === 'string' && /^data:/i.test(url.trim());

/** Downloads into a Buffer. Non-2xx answers throw SafeFetchError('bad_status') with `status`. */
async function safeFetchBuffer(url, opts = {}) {
  if (isDataUrl(url, opts)) return decodeDataUrl(url.trim(), opts);
  const r = await openSafe(url, opts);
  if (!r.ok) { if (r.stream) r.stream.destroy(); r.done(); fail('bad_status', `The download answered ${r.status}`, { status: r.status }); }
  const buffer = await readAll(r.stream);
  return { buffer, contentType: r.contentType.split(';')[0].trim().toLowerCase(), status: r.status, headers: r.headers, finalUrl: r.finalUrl };
}

/** Downloads and parses JSON (default type allowlist application/json and +json; 2 MB default cap). */
async function safeFetchJson(url, opts = {}) {
  const { buffer } = await safeFetchBuffer(url, { maxBytes: 2 * 1024 * 1024, types: ['application/json', 'application/ld+json', 'text/json'], ...opts });
  try { return JSON.parse(buffer.toString('utf8')); } catch (_) { return fail('bad_type', 'The answer was not JSON'); }
}

/** A streamed download: { stream, status, ok, headers, contentType, finalUrl }. The caller pipes or destroys it. */
async function safeFetchStream(url, opts = {}) {
  return openSafe(url, opts);
}

/**
 * A standard Response (status, ok, headers.get, arrayBuffer, json, text, body) for code written against fetch().
 * The body keeps the size cap and the time limit; `finalUrl` is added. Rules errors throw SafeFetchError.
 */
async function safeFetchResponse(url, opts = {}) {
  if (isDataUrl(url, opts)) {
    const d = decodeDataUrl(url.trim(), opts);
    const res = new Response(d.buffer, { status: 200, headers: { 'content-type': d.contentType } });
    Object.defineProperty(res, 'finalUrl', { value: '', enumerable: true });
    return res;
  }
  const r = await openSafe(url, opts);
  const headers = new Headers();
  for (const [k, v] of Object.entries(r.headers)) headers.set(k, v);
  const nullBody = !r.stream || [101, 204, 205, 304].includes(r.status);
  if (nullBody && r.stream) r.stream.destroy();
  const res = new Response(nullBody ? null : Readable.toWeb(r.stream), { status: r.status, headers });
  Object.defineProperty(res, 'finalUrl', { value: r.finalUrl, enumerable: true });
  return res;
}

/** A data: URL for an image link, or '' on any refusal or failure (never throws). */
async function safeFetchDataUrl(url, opts = {}) {
  try {
    const { buffer, contentType } = await safeFetchBuffer(url, { types: IMAGE_TYPES, ...opts });
    return buffer.length ? `data:${contentType || 'image/png'};base64,${buffer.toString('base64')}` : '';
  } catch (_) { return ''; }
}

module.exports = {
  safeFetchBuffer, safeFetchJson, safeFetchResponse, safeFetchStream, safeFetchDataUrl,
  checkUrl, resolveChecked, isBlockedAddress, safeLookup, typeAllowed, SafeFetchError,
  IMAGE_TYPES, VIDEO_TYPES, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES, DEFAULT_MAX_REDIRECTS
};
