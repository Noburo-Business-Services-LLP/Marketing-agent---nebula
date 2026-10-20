'use strict';
/**
 * The one place passwords and OTP codes are hashed and checked (decision D25, docs/superpowers/ops/performance-week1.md).
 *
 *  - Native `bcrypt`: the work runs on the libuv thread pool, so a sign-in no longer freezes every other request the
 *    way the pure-JavaScript bcryptjs did (it hashed on the main thread).
 *  - At most 3 hashes or checks at once (the pool has 4 threads by default; one stays free for files and DNS). The
 *    rest wait in a bounded queue; when the queue is full the caller gets a plain 503 "Please try again in a moment."
 *  - Cost from BCRYPT_ROUNDS (default 11, kept between 10 and 15). Hashes made earlier by bcryptjs ($2a$, cost 12 or 10)
 *    still verify; `rehashIfNeeded` quietly re-stores a password at the configured cost after a successful sign-in.
 */
const bcrypt = require('bcrypt');

const DEFAULT_ROUNDS = 11;
const MIN_ROUNDS = 10;
const MAX_ROUNDS = 15;
const BUSY_MESSAGE = 'Please try again in a moment.';
const BCRYPT_HASH = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/;

class PasswordHashBusyError extends Error {
  constructor() {
    super(BUSY_MESSAGE);
    this.name = 'PasswordHashBusyError';
    this.statusCode = 503;
    this.code = 'PASSWORD_HASH_BUSY';
  }
}

const isBusyError = (e) => !!e && (e instanceof PasswordHashBusyError || e.code === 'PASSWORD_HASH_BUSY');

function configuredRounds(env = process.env) {
  const n = Number.parseInt(String(env.BCRYPT_ROUNDS || ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_ROUNDS;
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, n));
}

const intFromEnv = (name, fallback) => {
  const n = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function createPasswordHasher({
  impl = bcrypt,
  maxConcurrent = intFromEnv('BCRYPT_MAX_CONCURRENT', 3) || 3,
  maxQueue = intFromEnv('BCRYPT_MAX_QUEUE', 100),
  rounds: fixedRounds = null
} = {}) {
  let running = 0;
  const waiting = [];

  const next = () => {
    if (running >= maxConcurrent || !waiting.length) return;
    running += 1;
    const { work, resolve, reject } = waiting.shift();
    Promise.resolve().then(work).then(resolve, reject).finally(() => { running -= 1; next(); });
  };

  const schedule = (work) => new Promise((resolve, reject) => {
    if (running >= maxConcurrent && waiting.length >= maxQueue) {
      reject(new PasswordHashBusyError());
      return;
    }
    waiting.push({ work, resolve, reject });
    next();
  });

  const roundsFor = (opts) => (opts && Number.isFinite(opts.rounds) ? opts.rounds : (fixedRounds || configuredRounds()));

  return {
    /** Hash a password or code. `rounds` overrides the configured cost (OTP codes use 10). */
    hash(plain, opts = {}) {
      return schedule(() => impl.hash(String(plain), roundsFor(opts)));
    },
    /** true only when `plain` matches `hashed`. A missing or malformed hash is false, never an error. */
    async compare(plain, hashed) {
      if (typeof plain !== 'string' || typeof hashed !== 'string' || !BCRYPT_HASH.test(hashed)) return false;
      return schedule(() => impl.compare(plain, hashed));
    },
    /** true when the stored hash was made at a different cost than the configured one. */
    needsRehash(hashed, opts = {}) {
      if (typeof hashed !== 'string' || !BCRYPT_HASH.test(hashed)) return false;
      try { return impl.getRounds(hashed) !== roundsFor(opts); } catch (_) { return false; }
    },
    stats() { return { running, queued: waiting.length }; }
  };
}

const shared = createPasswordHasher();

/**
 * After a successful sign-in: store the password again at the configured cost when the stored cost differs.
 * Conditional on the old hash, so a password changed in between is never overwritten. Returns true when it re-stored.
 */
async function rehashIfNeeded(user, plain, { User = require('../models/User'), rounds } = {}) {
  const opts = Number.isFinite(rounds) ? { rounds } : {};
  if (!user || !user._id || !shared.needsRehash(user.password, opts)) return false;
  const fresh = await shared.hash(plain, opts);
  await User.updateOne({ _id: user._id, password: user.password }, { $set: { password: fresh } });
  return true;
}

module.exports = {
  hash: shared.hash,
  compare: shared.compare,
  needsRehash: shared.needsRehash,
  stats: shared.stats,
  rehashIfNeeded,
  createPasswordHasher,
  configuredRounds,
  isBusyError,
  PasswordHashBusyError,
  BUSY_MESSAGE,
  DEFAULT_ROUNDS
};
