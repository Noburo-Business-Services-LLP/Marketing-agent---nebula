'use strict';
/**
 * A small load generator with no dependencies: node:http with keep-alive, an OPEN loop (requests start on a fixed
 * schedule whether or not the last one answered, which is how real traffic behaves and avoids hiding a slow server),
 * latency percentiles and an error count. Used by load.js and mixed.js.
 */
const http = require('http');

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function summarise(times, statuses, errors, seconds) {
  const sorted = [...times].sort((a, b) => a - b);
  const r1 = (n) => Math.round(n * 10) / 10;
  const total = sorted.length;
  return {
    requests: total,
    rps: r1(total / Math.max(seconds, 0.001)),
    p50: r1(percentile(sorted, 50)), p90: r1(percentile(sorted, 90)), p99: r1(percentile(sorted, 99)),
    max: r1(sorted[sorted.length - 1] || 0),
    mean: r1(total ? sorted.reduce((a, b) => a + b, 0) / total : 0),
    errors, // network failures plus any status outside expectStatus (default: 4xx and 5xx)
    statuses
  };
}

/**
 * Sends `rate` requests per second for `duration` seconds to one target.
 * spec: { host, port, method, path | (() => path), headers | (() => headers), body | (() => body), expectStatus }
 * expectStatus: status codes counted as success (default: any below 400).
 * samples: an array that also receives every latency in ms (to combine several runs into one percentile).
 */
async function runLoad(spec, { rate = 10, duration = 10, agent = null, timeoutMs = 30000, samples = null, now = () => process.hrtime.bigint() } = {}) {
  if (!LOOPBACK.test(spec.host || '127.0.0.1') && !spec.allowRemote) throw new Error(`refusing to load ${spec.host}: only this machine by default (pass allowRemote for a staging server you own)`);
  const own = agent || new http.Agent({ keepAlive: true, maxSockets: 512 });
  const times = [];
  const statuses = {};
  let errors = 0;
  const pending = new Set();
  const expect = spec.expectStatus ? new Set(spec.expectStatus) : null;
  const fn = (v) => (typeof v === 'function' ? v() : v);

  const fire = () => {
    const path = fn(spec.path);
    const bodyRaw = fn(spec.body);
    const payload = bodyRaw === undefined || bodyRaw === null ? null : Buffer.from(typeof bodyRaw === 'string' ? bodyRaw : JSON.stringify(bodyRaw));
    const started = now();
    const p = new Promise((resolve) => {
      const req = http.request({
        host: spec.host || '127.0.0.1', port: spec.port, method: spec.method || 'GET', path, agent: own, timeout: timeoutMs,
        headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...(fn(spec.headers) || {}) }
      }, (res) => {
        res.resume();
        res.on('end', () => finish(res.statusCode, false));
      });
      let done = false;
      const finish = (status, networkError) => {
        if (done) return;
        done = true;
        const elapsed = Number(now() - started) / 1e6;
        times.push(elapsed);
        if (samples) samples.push(elapsed);
        statuses[status] = (statuses[status] || 0) + 1;
        if (networkError || (expect ? !expect.has(status) : status >= 400)) errors += 1;
        resolve();
      };
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => finish(0, true));
      if (payload) req.write(payload);
      req.end();
    });
    pending.add(p);
    p.finally(() => pending.delete(p));
  };

  const t0 = Date.now();
  const total = Math.max(1, Math.round(rate * duration));
  for (let i = 0; i < total; i += 1) {
    const due = t0 + (i * 1000) / rate;
    const wait = due - Date.now();
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    fire();
  }
  await Promise.all([...pending]);
  const seconds = (Date.now() - t0) / 1000;
  if (!agent) own.destroy();
  return summarise(times, statuses, errors, seconds);
}

module.exports = { runLoad, percentile, summarise, LOOPBACK };
