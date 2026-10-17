'use strict';
/**
 * One guard for EVERY competitor profile read: the weekly tracker, the staff "check now" and the customer-triggered
 * scrapes in routes/competitors.js. A read is allowed only when
 *   1. ENABLE_COMPETITOR_TRACKER is exactly "on" (off by default everywhere; the owner sets it deliberately),
 *   2. this account is under its daily cap (maxReadsPerAccountPerDay),
 *   3. all accounts together are under the daily ceiling (READS_PER_DAY_MAX), counting real read attempts,
 *   4. the spend guard (staff "Competitor checks" switch, AI_KILLED, daily USD ceiling) says yes.
 * `note` records a read in the ledger and with the spend guard.
 */
const defaultCaps = require('../../config/competitors');
const ACTION = 'competitor_scrape';

const trackerEnabled = (env = process.env) => String((env && env.ENABLE_COMPETITOR_TRACKER) || '').trim() === 'on';

class ReadRefused extends Error {
  constructor(reason, message) { super(message); this.name = 'ReadRefused'; this.reason = reason; }
}

const MESSAGES = {
  switched_off: 'Competitor checks are not running right now. Please try again later.',
  account_cap: 'You have reached today\'s limit for competitor checks. Please try again tomorrow.',
  daily_cap: 'Competitor checks have reached today\'s limit. Please try again tomorrow.',
  spend: 'Competitor checks are very busy right now. Please try again in a little while.'
};

function createReadGuard({ ledger, spend, caps = defaultCaps, env = process.env } = {}) {
  const L = () => ledger || require('./readLedger').sharedLedger();
  const S = () => spend || { check: (a) => require('../spendGuard').check(a), record: (a, n) => require('../spendGuard').record(a, n) };
  return {
    enabled: () => trackerEnabled(env),
    async allow({ userId, at = new Date() } = {}) {
      if (!trackerEnabled(env)) return { ok: false, reason: 'switched_off', message: MESSAGES.switched_off };
      const perAccount = Number(caps.maxReadsPerAccountPerDay);
      if (Number.isFinite(perAccount) && userId !== undefined && userId !== null && (await L().countUserToday(userId, at)) >= perAccount) {
        return { ok: false, reason: 'account_cap', message: MESSAGES.account_cap };
      }
      if ((await L().countToday(at)) >= caps.READS_PER_DAY_MAX) return { ok: false, reason: 'daily_cap', message: MESSAGES.daily_cap };
      let verdict = { ok: true };
      try { verdict = (await S().check(ACTION)) || { ok: true }; } catch (_) { verdict = { ok: true }; }
      if (verdict.ok === false) return { ok: false, reason: 'spend', message: verdict.message || MESSAGES.spend };
      return { ok: true };
    },
    /** Record one read attempt. Never throws. */
    async note({ userId, competitorId, handle, at = new Date(), source = 'tracker' } = {}) {
      await L().record({ userId, competitorId, handle, at, source });
      try { await S().record(ACTION, 1); } catch (_) { /* the read is already counted */ }
    }
  };
}

let shared = null;
const sharedGuard = () => (shared = shared || createReadGuard());

/** Run one scraper call through the guard: refuse (throw ReadRefused) before it, count it when it goes ahead. */
async function guardedRead({ guard = sharedGuard(), userId, competitorId, handle = null, at = new Date(), source = 'customer', fn }) {
  const verdict = await guard.allow({ userId, at });
  if (!verdict.ok) throw new ReadRefused(verdict.reason, verdict.message);
  await guard.note({ userId, competitorId, handle, at, source });
  return fn();
}

module.exports = { createReadGuard, sharedGuard, guardedRead, trackerEnabled, ReadRefused, ACTION, MESSAGES };
