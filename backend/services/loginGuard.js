'use strict';
/**
 * Sign-in lockout that cannot be used to lock a named person out (B4, docs/superpowers/ops/security-hardening.md
 * section 10). Replaces "5 wrong passwords lock the account for 30 minutes from anywhere".
 *
 *  - Per EMAIL + SOURCE ADDRESS: after the k-th wrong password in a row from one address, the next try from that
 *    address waits min(30 s, base x 2^(k-1)) (1, 2, 4, 8 s); at LOGIN_IP_LOCK_AFTER (5) that address is locked out of
 *    that email for LOGIN_IP_LOCK_MINUTES (15). Another address is not affected, so the owner can still sign in. A
 *    try that arrives too early is answered 429 and the password is NOT checked (no free guesses).
 *  - Per EMAIL across all addresses: LOGIN_ACCOUNT_CEILING (30) wrong passwords within an hour emails the account
 *    owner once that hour, and from then until the hour ends only addresses that signed in to this account before
 *    (kept LOGIN_SEEN_DAYS, 90) may try. The owner is never locked out from a place they used before.
 *  - Keyed by the typed email, whether or not an account has it, so the answers are the same for both (B3).
 *  - LOGIN_CHALLENGE=off (default). `on` (with TURNSTILE_SECRET_KEY set) asks for a bot check (`challengeToken`)
 *    after LOGIN_CHALLENGE_AFTER (3) wrong passwords from one address. The app has no screen for it yet.
 *  - Counters in MongoDB (`login_attempts`, TTL), shared by every task; in memory when no database is connected.
 *    A store error lets the sign-in through (logged), like the request limiters.
 */
const crypto = require('crypto');

const COLLECTION = 'login_attempts';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const int = (v, fallback, min = 0) => {
  const n = Number.parseInt(String(v == null ? '' : v), 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

function settings(env = process.env) {
  return {
    ipLockAfter: int(env.LOGIN_IP_LOCK_AFTER, 5, 1),
    ipLockMs: int(env.LOGIN_IP_LOCK_MINUTES, 15, 1) * 60000,
    ipWindowMs: DAY,
    delayBaseMs: int(env.LOGIN_DELAY_BASE_MS, 1000, 0),
    delayMaxMs: 30000,
    accountCeiling: int(env.LOGIN_ACCOUNT_CEILING, 30, 1),
    accountWindowMs: HOUR,
    seenMs: int(env.LOGIN_SEEN_DAYS, 90, 1) * DAY,
    challenge: String(env.LOGIN_CHALLENGE || 'off').trim().toLowerCase() === 'on' && Boolean(env.TURNSTILE_SECRET_KEY),
    challengeAfter: int(env.LOGIN_CHALLENGE_AFTER, 3, 1)
  };
}

/** The wait after k wrong passwords in a row: base, 2 x base, 4 x base ..., at most 30 s. */
function delayFor(fails, s) {
  if (!(fails > 0) || !(s.delayBaseMs > 0)) return 0;
  return Math.min(s.delayMaxMs, s.delayBaseMs * 2 ** Math.min(fails - 1, 20));
}

/** Keys hold no email or address in clear (HMAC with the hash pepper when available, else SHA-256). */
function digest(text) {
  let key = '';
  try { key = require('../utils/hashPepper').primaryKey(); } catch (_) { key = ''; }
  return key ? crypto.createHmac('sha256', key).update(text).digest('hex') : crypto.createHash('sha256').update(text).digest('hex');
}
const norm = (email) => String(email || '').trim().toLowerCase();
const keys = (email, ip) => {
  const e = norm(email);
  return { eh: digest(`email:${e}`), ip: `ip:${digest(`${e}|${ip}`)}`, acct: `acct:${digest(e)}`, seen: `seen:${digest(`${e}|${ip}`)}` };
};

/** In-memory store with the same meaning as the Mongo one (tests, and a process with no database). */
function createMemoryStore() {
  const docs = new Map();
  const live = (k, now) => { const d = docs.get(k); if (d && d.expireAt && d.expireAt.getTime() <= now) { docs.delete(k); return null; } return d || null; };
  return {
    async get(k, now = Date.now()) { const d = live(k, now); return d ? { ...d } : null; },
    async addFailure(k, { now, windowMs, expireAt, eh }) {
      const d = live(k, now) || { _id: k, eh, fails: 0 };
      const fresh = !d.windowStart || d.windowStart.getTime() < now - windowMs;
      d.fails = fresh ? 1 : d.fails + 1;
      if (fresh) d.windowStart = new Date(now);
      d.lastFailAt = new Date(now); d.expireAt = expireAt; d.eh = eh;
      docs.set(k, d);
      return { ...d };
    },
    async set(k, fields) { const d = docs.get(k); if (d) Object.assign(d, fields); },
    async claimAlert(k, { now, windowStart }) {
      const d = docs.get(k);
      if (!d || (d.alertedAt && d.alertedAt.getTime() >= windowStart)) return false;
      d.alertedAt = new Date(now); return true;
    },
    async remove(k) { docs.delete(k); },
    async markSeen(k, { expireAt, eh }) { docs.set(k, { _id: k, eh, seenAt: new Date(), expireAt }); },
    _docs: docs
  };
}

let indexReady = null;
function createMongoStore({ collection } = {}) {
  const coll = () => {
    if (collection) return collection;
    const conn = require('mongoose').connection;
    if (!conn || conn.readyState !== 1 || !conn.db) return null;
    const c = conn.db.collection(COLLECTION);
    if (!indexReady) indexReady = c.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expireAt' }).catch((e) => { indexReady = null; console.warn('[login guard] TTL index:', e && e.message); });
    return c;
  };
  const need = () => { const c = coll(); if (!c) throw new Error('no database'); return c; };
  return {
    async get(k) { return need().findOne({ _id: k }); },
    async addFailure(k, { now, windowMs, expireAt, eh }) {
      const at = new Date(now);
      const floor = new Date(now - windowMs);
      const res = await need().findOneAndUpdate({ _id: k }, [
        { $set: { _fresh: { $or: [{ $eq: [{ $type: '$windowStart' }, 'missing'] }, { $lt: ['$windowStart', floor] }] } } },
        { $set: { fails: { $cond: ['$_fresh', 1, { $add: [{ $ifNull: ['$fails', 0] }, 1] }] }, windowStart: { $cond: ['$_fresh', at, '$windowStart'] }, lastFailAt: at, expireAt, eh } },
        { $unset: '_fresh' }
      ], { upsert: true, returnDocument: 'after' });
      return res && res.ok !== undefined && 'value' in res ? res.value : res; // driver 6+ returns the document itself
    },
    async set(k, fields) { await need().updateOne({ _id: k }, { $set: fields }); },
    async claimAlert(k, { now, windowStart }) {
      const r = await need().updateOne({ _id: k, $or: [{ alertedAt: { $exists: false } }, { alertedAt: { $lt: new Date(windowStart) } }] }, { $set: { alertedAt: new Date(now) } });
      return r.modifiedCount === 1;
    },
    async remove(k) { await need().deleteOne({ _id: k }); },
    async markSeen(k, { expireAt, eh }) { await need().updateOne({ _id: k }, { $set: { eh, seenAt: new Date(), expireAt } }, { upsert: true }); }
  };
}

/** Mongo when connected, else memory (one process). */
function createDefaultStore() {
  const mongo = createMongoStore();
  const memory = createMemoryStore();
  const connected = () => { const c = require('mongoose').connection; return Boolean(c && c.readyState === 1 && c.db); };
  const pick = () => (connected() ? mongo : memory);
  const out = {};
  for (const name of Object.keys(memory)) if (typeof memory[name] === 'function') out[name] = (...a) => pick()[name](...a);
  return out;
}

const MSG = {
  wait: (s) => `Too many sign-in attempts. Please wait ${s} second${s === 1 ? '' : 's'} and try again.`,
  locked: (m) => `Too many sign-in attempts from this connection. Please try again in ${m} minute${m === 1 ? '' : 's'}, or reset your password.`,
  ceiling: 'Too many sign-in attempts on this email. Please try again later from a device you have used before, or reset your password.',
  challenge: 'Please complete the check to show that you are a person, then sign in again.'
};

function alertMail(user, fails) {
  const { escapeHtml } = require('../utils/escapeHtml');
  const name = String((user && user.firstName) || '').trim();
  const paras = [
    name ? `Hello ${name},` : 'Hello,',
    `In the last hour there were ${fails} unsuccessful attempts to sign in to your Nebulaa account.`,
    'If this was you, there is nothing to do. You can still sign in from the devices and places you have used before.',
    'If it was not you, your password has kept your account safe. To be sure, choose "Forgot password" on the sign-in page and set a new one.',
    'Nebulaa'
  ];
  return { subject: 'Unsuccessful sign-in attempts on your Nebulaa account', text: paras.join('\n\n'), html: paras.map((p) => `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(p)}</p>`).join('') };
}

async function sendAlertEmail(user, fails, env = process.env) {
  if (!user || !user.email || !env.RESEND_API_KEY) return { skipped: true };
  const mail = alertMail(user, fails);
  const { Resend } = require('resend');
  const { error } = await new Resend(env.RESEND_API_KEY).emails.send({ from: `Nebulaa <${env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai'}>`, to: [user.email], subject: mail.subject, html: mail.html, text: mail.text });
  if (error) throw new Error(error.message || 'Email provider error');
  return { sent: true };
}

function createLoginGuard({ store = createDefaultStore(), now = Date.now, config = () => settings(), sendAlert = (user, fails) => module.exports.sendAlertEmail(user, fails) /* looked up at call time: scripts stub it */, verifyChallenge = null, log = console } = {}) {
  const challengeCheck = verifyChallenge || ((token, ip) => require('./signupGuard').verifyBotCheck(token, ip, process.env.TURNSTILE_SECRET_KEY));

  /** May this email be tried from this address now? { allowed } or { allowed: false, status, retryAfter, message }. */
  async function check({ email, ip, challengeToken }) {
    try {
      const s = config();
      const t = now();
      const k = keys(email, ip);
      const rec = await store.get(k.ip, t);
      if (rec && rec.lockedUntil && new Date(rec.lockedUntil).getTime() > t) {
        const secs = Math.ceil((new Date(rec.lockedUntil).getTime() - t) / 1000);
        return { allowed: false, reason: 'locked', retryAfter: secs, message: MSG.locked(Math.ceil(secs / 60)) };
      }
      const fails = rec && rec.windowStart && new Date(rec.windowStart).getTime() >= t - s.ipWindowMs ? Number(rec.fails) || 0 : 0;
      const waitUntil = fails && rec.lastFailAt ? new Date(rec.lastFailAt).getTime() + delayFor(fails, s) : 0;
      if (waitUntil > t) {
        const secs = Math.max(1, Math.ceil((waitUntil - t) / 1000));
        return { allowed: false, reason: 'delay', retryAfter: secs, message: MSG.wait(secs) };
      }
      const acct = await store.get(k.acct, t);
      const acctFails = acct && acct.windowStart && new Date(acct.windowStart).getTime() >= t - s.accountWindowMs ? Number(acct.fails) || 0 : 0;
      if (acctFails >= s.accountCeiling && !(await store.get(k.seen, t))) {
        const secs = Math.max(1, Math.ceil((new Date(acct.windowStart).getTime() + s.accountWindowMs - t) / 1000));
        return { allowed: false, reason: 'ceiling', retryAfter: secs, message: MSG.ceiling };
      }
      if (s.challenge && fails >= s.challengeAfter) {
        const ok = challengeToken ? await challengeCheck(String(challengeToken), ip) : false;
        if (!ok) return { allowed: false, reason: 'challenge', retryAfter: 0, challengeRequired: true, message: MSG.challenge };
      }
      return { allowed: true };
    } catch (e) {
      log.warn('[login guard] check skipped:', e && e.message);
      return { allowed: true };
    }
  }

  /** A wrong password (or an email with no account) from this address. `user` is the account when there is one. */
  async function fail({ email, ip, user }) {
    try {
      const s = config();
      const t = now();
      const k = keys(email, ip);
      const rec = await store.addFailure(k.ip, { now: t, windowMs: s.ipWindowMs, expireAt: new Date(t + s.ipWindowMs + s.ipLockMs), eh: k.eh });
      if (rec && rec.fails >= s.ipLockAfter) await store.set(k.ip, { lockedUntil: new Date(t + s.ipLockMs) });
      const acct = await store.addFailure(k.acct, { now: t, windowMs: s.accountWindowMs, expireAt: new Date(t + 2 * s.accountWindowMs), eh: k.eh });
      if (user && acct && acct.fails >= s.accountCeiling && (await store.claimAlert(k.acct, { now: t, windowStart: new Date(acct.windowStart).getTime() }))) {
        Promise.resolve().then(() => sendAlert(user, acct.fails)).catch((e) => log.error('[login guard] owner alert email failed:', e && e.message));
      }
    } catch (e) {
      log.warn('[login guard] failure not counted:', e && e.message);
    }
  }

  /** The right password: this address starts fresh for this email and counts as seen. */
  async function success({ email, ip }) {
    try {
      const s = config();
      const k = keys(email, ip);
      await store.remove(k.ip);
      await store.markSeen(k.seen, { expireAt: new Date(now() + s.seenMs), eh: k.eh });
    } catch (e) {
      log.warn('[login guard] success not recorded:', e && e.message);
    }
  }

  return { check, fail, success };
}

let shared = null;
const sharedLoginGuard = () => (shared = shared || createLoginGuard());

module.exports = { createLoginGuard, sharedLoginGuard, createMemoryStore, createMongoStore, settings, delayFor, keys, alertMail, sendAlertEmail, COLLECTION, MSG };
