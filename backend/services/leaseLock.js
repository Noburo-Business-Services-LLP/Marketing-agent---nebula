'use strict';
/**
 * Lease lock for background jobs (hardening E2, docs/superpowers/ops/ecs-web-worker.md).
 *
 * Every scheduler TICK that sends, publishes, charges or refunds runs through `leased(name, ttlMs, fn)`, so two
 * servers that run background jobs by mistake (a second worker, a web task started without RUN_BACKGROUND=0, a rolling
 * deploy) cannot both run the same tick: one wins the lease, the other skips that tick.
 *
 *   - One MongoDB row per name (JobLease: name unique, holder, expiresAt). Claiming is ONE atomic findOneAndUpdate with
 *     upsert that matches only an expired row; if the row exists and is still live, the upsert tries to insert a
 *     second row, the unique index refuses it (E11000) and the claim returns "not claimed".
 *   - The holder renews every ttl/3 while the tick runs, so a long tick keeps its lease and a crashed server's lease
 *     runs out by itself after ttl.
 *   - The lease is released when the tick ends, also when it throws. `cooldownMs` keeps the lease after a SUCCESSFUL
 *     tick until startedAt + cooldownMs, so a second server whose timer fires a few seconds later does not repeat an
 *     hourly or weekly job. A failed tick releases at once so the next timer retries.
 *   - A store that fails counts as "not claimed": a tick never runs without the lease (the next timer tries again).
 *   - Same process, overlapping ticks: the second one also fails to claim (a lease is free only when expired), so a
 *     slow tick is never run twice at once. A single process still gets its lease immediately.
 *   - Outside production (NODE_ENV not "production"), with no database connection (unit tests, a dev machine without MongoDB),
 *     the tick runs directly: there is nothing to lease against and nothing else to collide with. In production, no
 *     connection means the tick is skipped.
 */
const os = require('os');
const crypto = require('crypto');

const newHolder = () => `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

function mongoStore() {
  const model = () => require('../models/JobLease');
  const connected = () => require('mongoose').connection.readyState === 1;
  return {
    available: connected,
    async claim(name, holder, now, expiresAt) {
      try {
        const doc = await model().findOneAndUpdate(
          { name, expiresAt: { $lte: now } },
          { $set: { holder, expiresAt } },
          { upsert: true, new: true }
        );
        return !!doc;
      } catch (e) {
        if (e && e.code === 11000) return false; // a live lease already holds this name
        throw e;
      }
    },
    /** Push the end out, only while we still hold it. */
    async renew(name, holder, expiresAt) {
      const r = await model().updateOne({ name, holder }, { $set: { expiresAt } });
      return Number(r && (r.modifiedCount !== undefined ? r.modifiedCount : r.nModified)) > 0;
    },
    async release(name, holder, expiresAt) {
      await model().updateOne({ name, holder }, { $set: { expiresAt } });
    }
  };
}

function createLeaseLock({ store = mongoStore(), clock = Date.now, holder = newHolder(), log = console, timers = { setInterval, clearInterval } } = {}) {
  const warn = (...a) => { try { (log.warn || log.log).call(log, ...a); } catch (_) { /* logging never stops a job */ } };

  async function acquire(name, ttlMs) {
    try {
      const now = clock();
      const ok = await store.claim(name, holder, new Date(now), new Date(now + ttlMs));
      return ok ? { name, holder, ttlMs, startedAt: now } : null;
    } catch (e) {
      warn(`[lease] could not claim "${name}":`, e && e.message);
      return null;
    }
  }

  async function renew(lease) {
    try { return await store.renew(lease.name, lease.holder, new Date(clock() + lease.ttlMs)); } catch (_) { return true; /* unknown: keep going, it runs out by itself */ }
  }

  async function release(lease, keepUntilMs) {
    try {
      const at = Math.max(clock() - 1, keepUntilMs || 0); // free now, or kept (cooldown) until a later time
      await store.release(lease.name, lease.holder, new Date(at));
    } catch (_) { /* it runs out by itself */ }
  }

  /** Run fn if (and only if) the lease for `name` is ours. Resolves { ran:false } when another holder has it. Rethrows fn's error after releasing. */
  async function withLease(name, ttlMs, fn, { cooldownMs = 0 } = {}) {
    if (store.available && !store.available()) {
      if (process.env.NODE_ENV !== 'production') return { ran: true, result: await fn({ isLost: () => false }) };
      warn(`[lease] database not connected, tick "${name}" skipped`);
      return { ran: false, reason: 'unavailable' };
    }
    const lease = await acquire(name, ttlMs);
    if (!lease) return { ran: false, reason: 'held' };
    let lost = false;
    const every = Math.max(1, Math.floor(ttlMs / 3));
    const timer = timers.setInterval(() => { renew(lease).then((ok) => { if (!ok) lost = true; }); }, every);
    if (timer && timer.unref) timer.unref();
    let ok = false;
    try {
      const result = await fn({ isLost: () => lost });
      ok = true;
      return { ran: true, result };
    } finally {
      timers.clearInterval(timer);
      await release(lease, ok && cooldownMs > 0 ? lease.startedAt + cooldownMs : 0);
    }
  }

  /** A function that runs `fn` through the lease each time it is called (the tick of a timer). Resolves to fn's result, or undefined when skipped. */
  function leased(name, ttlMs, fn, opts) {
    return async (...args) => {
      const r = await withLease(name, ttlMs, (ctx) => fn(...args, ctx), opts);
      return r.ran ? r.result : undefined;
    };
  }

  return { holder, acquire, renew, release, withLease, leased };
}

let shared = null;
const lock = () => (shared || (shared = createLeaseLock()));

module.exports = {
  createLeaseLock,
  mongoStore,
  /** The process-wide lock (MongoDB). */
  withLease: (...a) => lock().withLease(...a),
  leased: (...a) => lock().leased(...a)
};
