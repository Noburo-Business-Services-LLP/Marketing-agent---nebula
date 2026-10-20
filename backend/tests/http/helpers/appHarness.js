'use strict';
// The WHOLE app (server-main.js, every real middleware in its real order) in this process on a random 127.0.0.1 port,
// for the regression probes (docs/superpowers/ops/regression-probes.md). Nothing leaves the machine and nothing needs a
// database: the User model is the in-memory stand-in from tests/helpers/authHttp.js, the few other models a probe touches
// are swapped by the probe itself, and any outgoing request to a non-local host is refused (and counted).
//
// Order matters: `prepareEnv()` sets the environment BEFORE the app is first required (some modules read it at import),
// so a probe file calls `boot()` once at the top and reuses the result.
const http = require('http');
const https = require('https');
const { createAuthHarness } = require('../../helpers/authHttp');

const BASE_ENV = {
  NEBULAA_SERVER_NO_START: '1',
  NODE_ENV: 'test',
  JWT_SECRET: 'probe-only-secret-probe-only-secret-123456',
  HASH_PEPPER: 'probe-only-pepper',
  AUTH_CACHE: 'off', // a stand-in User has no save hooks to clear the cache; the cache has its own tests (authCache.test.js)
  LOG_LEVEL: 'silent',
  LIMIT_GENERAL_MAX: '100000', // overridden per probe where the limit itself is the thing under test
  RATE_LIMIT_STORE: 'memory'
};

const outgoing = [];
const isLocal = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ''));
function guardOutgoing() {
  for (const mod of [http, https]) {
    for (const fn of ['request', 'get']) {
      const orig = mod[fn];
      if (orig.__probeGuard) continue;
      const guarded = function guardedRequest(a, ...rest) {
        const host = typeof a === 'string' || a instanceof URL ? new URL(String(a)).hostname : (a && (a.hostname || a.host));
        if (host && !isLocal(host)) { outgoing.push(String(host)); throw new Error(`probe harness: outgoing request to ${host} refused`); }
        return orig.call(this, a, ...rest);
      };
      guarded.__probeGuard = true;
      mod[fn] = guarded;
    }
  }
  const realFetch = global.fetch;
  if (realFetch && !realFetch.__probeGuard) {
    global.fetch = Object.assign((input, init) => {
      const host = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).hostname;
      if (!isLocal(host)) { outgoing.push(host); return Promise.reject(new Error(`probe harness: outgoing fetch to ${host} refused`)); }
      return realFetch(input, init);
    }, { __probeGuard: true });
  }
}

function prepareEnv(extra = {}) {
  delete process.env.MONGODB_URI;
  delete process.env.ALLOW_DEMO_AUTH;
  delete process.env.TRUST_PROXY_HOPS;
  Object.assign(process.env, BASE_ENV, extra);
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete process.env[k];
}

/** Boots the app. `env` overrides BASE_ENV (a value of undefined removes the variable). Returns the harness plus `base`. */
async function boot({ env = {} } = {}) {
  prepareEnv(env);
  guardOutgoing();
  const harness = createAuthHarness();
  const { app } = require('../../../server-main');
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { generateToken } = require('../../../middleware/auth');
  async function close() {
    await new Promise((r) => server.close(r));
    await harness.restore();
  }
  return { ...harness, app, base, outgoing, generateToken, close };
}

module.exports = { boot, outgoing };
