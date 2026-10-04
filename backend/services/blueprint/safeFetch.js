'use strict';
// Fetches one public https page for Blueprint discovery. SSRF safe: only public https, no credentials or ports,
// every hop (first URL and each redirect, followed by hand) is re-validated, resolved, refused unless EVERY
// address is public, and connected to at the checked address (DNS pinned). Size, time and redirect limits.
// Never throws. Built on the primitives Hero already uses; no range tables are copied here.
const dns = require('dns');
const { isPublicHttpsUrl, isPublicIp } = require('../heroVideoService');
const { LIMITS } = require('../../config/blueprint');

const MAX_REDIRECTS = 3;
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)/i;
const USER_AGENT = 'NebulaaBlueprint/1.0 (+https://nebulaa.ai)';
const defaultLookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true });
const noWww = (h) => String(h || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

async function cancelBody(res) {
  try { if (res && res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch (_) { /* ignore */ }
}

// Reads at most `cap` bytes; resolves null when the body is larger.
async function readCapped(res, cap) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > cap) { try { await reader.cancel(); } catch (_) { /* ignore */ } return null; }
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts);
  }
  const ab = await res.arrayBuffer();
  return ab.byteLength > cap ? null : Buffer.from(ab);
}

// ONE address to connect to, or null when unresolvable or ANY address is not public (a mixed answer is refused).
async function resolvePublicAddress(host, lookup) {
  const list = await lookup(host);
  if (!Array.isArray(list) || !list.length) return null;
  const addrs = list.map((x) => (x && typeof x === 'object' ? x.address : x));
  return addrs.every((a) => isPublicIp(a)) ? addrs[0] : null;
}

function hopAllowed(url) {
  if (!isPublicHttpsUrl(url)) return false;
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  return !u.username && !u.password && !u.port;
}

async function fetchPublicPage(url, opts = {}) {
  const f = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : null;
  const lookup = typeof opts.lookup === 'function' ? opts.lookup : defaultLookup;
  const ms = Math.min(LIMITS.FETCH_TIMEOUT_MS, opts.timeoutMs > 0 ? opts.timeoutMs : LIMITS.FETCH_TIMEOUT_MS);
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : LIMITS.PAGE_BYTES;
  const okTypes = opts.okTypes instanceof RegExp ? opts.okTypes : HTML_TYPES;
  const site = opts.sameSiteOf ? noWww(opts.sameSiteOf) : '';
  const ctrl = new AbortController();
  const aborted = new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  aborted.catch(() => {});
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    if (typeof url !== 'string') return { ok: false, reason: 'blocked' };
    let current = url.trim();
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!hopAllowed(current)) return { ok: false, reason: 'blocked' };
      const host = new URL(current).hostname.toLowerCase().replace(/\.$/, '');
      if (site && noWww(host) !== site) return { ok: false, reason: 'other_site' };
      let address;
      try { address = await Promise.race([resolvePublicAddress(host, lookup), aborted]); } catch (e) { if (ctrl.signal.aborted) throw e; return { ok: false, reason: 'blocked' }; }
      if (!address) return { ok: false, reason: 'blocked' };
      const init = { redirect: 'manual', signal: ctrl.signal, headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT } };
      const res = await Promise.race([f ? f(current, init) : require('../heroVideoFinish')._pinnedFetch(current, init, address), aborted]);
      if (!res || !res.headers || typeof res.headers.get !== 'function') return { ok: false, reason: 'error' };
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        await cancelBody(res);
        if (!loc) return { ok: false, reason: 'status', status: res.status };
        if (hop === MAX_REDIRECTS) return { ok: false, reason: 'redirects' };
        try { current = new URL(loc, current).toString(); } catch (_) { return { ok: false, reason: 'blocked' }; }
        continue;
      }
      if (!res.ok) { await cancelBody(res); return { ok: false, reason: 'status', status: res.status }; }
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (!okTypes.test(type)) { await cancelBody(res); return { ok: false, reason: 'type', status: res.status }; }
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > maxBytes) { await cancelBody(res); return { ok: false, reason: 'size', status: res.status }; }
      const buf = await Promise.race([readCapped(res, maxBytes), aborted]);
      if (!buf) return { ok: false, reason: 'size', status: res.status };
      return { ok: true, status: res.status, finalUrl: current, text: new TextDecoder('utf-8').decode(buf) };
    }
    return { ok: false, reason: 'redirects' };
  } catch (_) {
    return { ok: false, reason: ctrl.signal.aborted ? 'timeout' : 'error' };
  } finally {
    clearTimeout(timer);
  }
}

// Disallow prefixes of the "User-agent: *" group. An empty Disallow allows everything.
function parseRobots(text) {
  const out = [];
  let agents = [];
  let inAgents = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!inAgents) agents = [];
      agents.push(val.toLowerCase());
      inAgents = true;
    } else {
      inAgents = false;
      if (key === 'disallow' && val && agents.includes('*')) out.push(val);
    }
  }
  return out;
}

async function robotsAllows(pageUrl, opts = {}) {
  try {
    const u = new URL(pageUrl);
    const r = await fetchPublicPage(`https://${u.host}/robots.txt`, { ...opts, okTypes: /^text\/plain/i, sameSiteOf: u.hostname });
    if (!r.ok) return true;
    return !parseRobots(r.text).some((p) => (u.pathname + u.search).startsWith(p));
  } catch (_) {
    return true;
  }
}

module.exports = { fetchPublicPage, robotsAllows, parseRobots };
