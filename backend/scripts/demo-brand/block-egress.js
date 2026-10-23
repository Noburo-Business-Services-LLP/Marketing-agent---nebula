// Recording safety: any outbound HTTP(S)/HTTP2 request to a host other than this computer is refused. Database sockets are untouched.
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
const hostOf = (x) => { try { return typeof x === 'string' ? new URL(x).hostname : (x && (x.hostname || x.host)) ? String(x.hostname || x.host).split(':')[0] : (x && x.href ? new URL(x.href).hostname : ''); } catch (_) { return ''; } };
const deny = (h) => { const e = new Error(`[recording-guard] blocked outbound request to ${h}`); e.code = 'ECONNREFUSED'; return e; };
const f = globalThis.fetch;
globalThis.fetch = (u, ...r) => { const h = hostOf(u instanceof Request ? u.url : u); if (!LOCAL.has(h)) return Promise.reject(deny(h)); return f(u, ...r); };
for (const m of ['http', 'https']) {
  const mod = require(m);
  for (const fn of ['request', 'get']) {
    const o = mod[fn];
    mod[fn] = function (a, b, c) { const h = typeof a === 'string' || a instanceof URL ? hostOf(a) : hostOf(a); if (h && !LOCAL.has(h)) throw deny(h); if (!h) throw deny('(unknown)'); return o.call(this, a, b, c); };
  }
}
const h2 = require('http2'); const oc = h2.connect;
h2.connect = function (a, ...r) { const h = hostOf(a); if (!LOCAL.has(h)) throw deny(h); return oc.call(this, a, ...r); };
console.log('[recording-guard] outbound web requests to anything but this computer are blocked');
