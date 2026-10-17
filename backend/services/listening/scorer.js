'use strict';
/**
 * Weekly comment scorer (social listening). For each entitled account it sends that account's own unscored inbox
 * comments and messages to a small model in batches of BATCH_SIZE, and stores only a label and a reason code per item.
 * Money rules, all checked on every batch (mirrors services/competitors/tracker.js):
 *   - OFF unless ENABLE_LISTENING is exactly "on"; refuses to run when LISTENING_MODEL is unset (plain log, no throw),
 *   - the batch is written to the ledger (database row + process memory) BEFORE the model call, and a batch whose items
 *     the ledger says were already sent in the last 7 days is never sent again, so a failed save never repeats a paid call,
 *   - caps count ledger ATTEMPTS, never saved scores: items per run, items per account per day, batches per day (all accounts),
 *   - spendGuard.check('listening_score') before every batch and spendGuard.record after it (staff switch, AI_KILLED, daily ceiling),
 *   - one pass at a time across all server instances (OpsState lease, key listening_scorer_lease), released in `finally`,
 *   - fair rotation: every entitled account is paged in, never-scored first, then oldest listeningRunAt,
 *   - before an account is scored, scores whose inbox item no longer exists are erased (erase.sweepOrphans, bounded, never throws),
 *   - 3 failed runs in a row pause the account until a newer item arrives on a later day, with one ops alert a day.
 * Nothing here logs comment text or the model's reply: only counts, ids and error names.
 * Every external call goes through `deps` so tests use fakes; defaults are required lazily so tests exit cleanly.
 */
const defaultCaps = require('../../config/listening');
const { eligibleItem, kindOf, makeBatches, buildPrompt, parseReply } = require('./helpers');
const { eligibleAccount } = require('./entitlement');

const DAY = 864e5;
const PAUSE_MS = 1000;
const PAGE = 500;
const TYPES = ['comment', 'mention', 'dm', 'message'];
const STOP_PASS = new Set(['batch_cap', 'spend', 'no_model']);
const SOURCE_LEASE_KEY = 'listening_scorer_lease';

let running = false;
const sharedMemory = new Map(); // userId -> { failures, at }: the failure count survives a failed database write
const alerted = new Set();      // userId|day: one alert per account per day

const asDate = (v) => (v ? new Date(v) : new Date());
const dayOf = (at) => asDate(at).toISOString().slice(0, 10);
const errTag = (e) => `${(e && (e.name || 'Error')) || 'Error'}${e && e.code ? ` ${e.code}` : ''}`; // never e.message: it can echo model text

function defaultDeps({ User: UserModel } = {}) {
  const User = () => UserModel || require('../../models/User');
  return {
    caps: defaultCaps,
    env: process.env,
    memory: sharedMemory,
    ledger: require('./ledger').sharedBatchLedger(),
    store: new Proxy({}, { get: (_, k) => (...a) => { const s = require('./store').listeningStore(); return s[k](...a); } }),
    lease: require('../competitors/lease').createLease({ key: SOURCE_LEASE_KEY, ttlMs: defaultCaps.LEASE_MINUTES * 60 * 1000 }),
    callText: (...a) => require('../openAI').callTextLLM(...a),
    spend: { check: (a) => require('../spendGuard').check(a), record: (a, n) => require('../spendGuard').record(a, n) },
    // The strict gate: if it cannot be read the pass is skipped, never run without it.
    gate: () => require('../backgroundGate').blockedAccountIds(),
    erase: { sweepOrphans: (...a) => require('./erase').sweepOrphans(...a) },
    alert: ({ key, subject, text }) => require('../opsAlerts').notify({ key, subject, text, cooldownMs: DAY }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    // Every non-free account, read in pages by _id so none is cut off; entitlement is applied later by eligibleAccount.
    accounts: async ({ ids = null, pageSize } = {}) => {
      const size = Number(pageSize) > 0 ? Number(pageSize) : PAGE;
      const out = [];
      let last = null;
      for (;;) {
        const idFilter = { ...(ids ? { $in: ids } : {}), ...(last ? { $gt: last } : {}) };
        const page = await User().find({
          isActive: { $ne: false }, onboardingCompleted: true, staffRole: null, isCsm: { $ne: true }, 'plan.tier': { $ne: 'free' },
          ...(Object.keys(idFilter).length ? { _id: idFilter } : {})
        }).select('_id isActive onboardingCompleted staffRole isCsm plan listeningRunAt listeningFailures payments').sort({ _id: 1 }).limit(size).lean();
        out.push(...page);
        if (page.length < size) break;
        last = page[page.length - 1]._id;
      }
      return out;
    },
    // Newest first. Reads only the fields the scorer needs, only this account's inbound items.
    items: ({ userId, since, types, limit }) => require('../../models/SocialInboxMessage')
      .find({ userId, direction: 'inbound', createdAt: { $gte: since }, messageType: { $in: types } })
      .select('_id userId platform messageType direction senderType spamScore body createdAt')
      .sort({ createdAt: -1 }).limit(limit).lean(),
    markRun: (user, { at, failures }) => User().updateOne({ _id: user._id }, { $set: { listeningRunAt: at, listeningFailures: failures } }, { timestamps: false })
  };
}
const withDefaults = (deps) => ({ ...defaultDeps(), ...(deps || {}) });
const modelOf = (env) => String((env && env.LISTENING_MODEL) || '').trim();

/**
 * Score one account's unscored items. Never throws. Returns { scored, attempted, batches, skipped?, stopped? }:
 * `skipped` is why nothing was sent, `stopped` is why it ended early after some batches (batch_cap, spend).
 * `force` (staff) skips only the weekly cadence; the caps, spend guard, entitlement and pause still apply.
 */
async function scoreAccount({ user, now, deps, force = false } = {}) {
  const out = { scored: 0, attempted: 0, batches: 0 };
  try {
    const d = withDefaults(deps);
    const caps = d.caps || defaultCaps;
    const at = asDate(now);
    const userId = user._id;
    const model = modelOf(d.env);
    if (!model) { console.warn('[listening] LISTENING_MODEL is not set: scoring is off'); return { ...out, skipped: 'no_model' }; }

    const memory = d.memory || sharedMemory;
    const mem = memory.get(String(userId)) || { failures: 0, at: null };
    const lastKnown = [user.listeningRunAt, mem.at].filter(Boolean).map((x) => new Date(x)).sort((a, b) => b - a)[0] || null;

    if (!force) {
      const ledgerLast = await d.ledger.lastRunAt(userId).catch(() => null);
      const last = [ledgerLast, lastKnown].filter(Boolean).sort((a, b) => b - a)[0];
      if (last && at - last < caps.RUN_EVERY_DAYS * DAY) return { ...out, skipped: 'not_due' };
    }

    // Scores whose inbox item is gone are erased first, so the counts below never include a deleted comment.
    try { await d.erase.sweepOrphans({ userId, now: at }); } catch (e) { console.error('[listening] orphan sweep failed:', errTag(e)); }

    const since = new Date(at.getTime() - caps.ITEM_WINDOW_DAYS * DAY);
    const raw = (await d.items({ userId, since, types: TYPES, limit: caps.MAX_ITEMS_PER_RUN * 2 })) || [];
    const eligible = raw.filter((it) => eligibleItem(it, at, { userId }));

    const failures = Math.max(Number(user.listeningFailures) || 0, mem.failures || 0);
    if (failures >= caps.FAIL_PAUSE_AFTER) {
      const newest = eligible[0] && new Date(eligible[0].createdAt);
      const newer = !!newest && (!lastKnown || newest > lastKnown);
      if (!newer || (lastKnown && dayOf(at) <= dayOf(lastKnown))) return { ...out, skipped: 'paused' };
    }

    const ids = eligible.map((it) => String(it._id));
    const [scoredSet, triedSet] = await Promise.all([d.store.scoredIds(userId, ids), d.ledger.attempted(userId, ids, at)]);
    const fresh = eligible.filter((it) => !scoredSet.has(String(it._id)) && !triedSet.has(String(it._id)));

    const periodStart = at.getTime() - caps.PERIOD_DAYS * DAY;
    const already = ((await d.store.scoresSince(userId, new Date(periodStart))) || []).length;
    const newInPeriod = fresh.filter((it) => new Date(it.createdAt).getTime() >= periodStart).length;
    if (already + newInPeriod < caps.MIN_ITEMS) return { ...out, skipped: 'too_few' };

    const usedToday = await d.ledger.countItemsUserToday(userId, at);
    const room = caps.MAX_ITEMS_PER_ACCOUNT_PER_DAY - usedToday;
    if (room <= 0) return { ...out, skipped: 'account_cap' };
    const take = fresh.slice(0, Math.min(caps.MAX_ITEMS_PER_RUN, room));
    if (!take.length) return { ...out, skipped: 'too_few' };

    let failed = 0;
    let stopped = null;
    for (const batch of makeBatches(take, caps.BATCH_SIZE)) {
      if ((await d.ledger.countBatchesToday(at)) >= caps.MAX_BATCHES_PER_DAY) { stopped = 'batch_cap'; break; }
      let verdict;
      try { verdict = await d.spend.check('listening_score'); } catch (_) { verdict = { ok: false }; }
      if (!verdict || verdict.ok === false) { stopped = 'spend'; break; }

      // The attempt is written BEFORE the call, so a failed save, a restart or a full database cannot cause a repeat.
      try { await d.ledger.record({ userId, itemIds: batch.map((it) => String(it._id)), at, source: force ? 'staff' : 'scorer' }); }
      catch (e) { console.error('[listening] could not record a batch, stopping:', errTag(e)); stopped = 'ledger'; break; }
      out.batches++;
      out.attempted += batch.length;

      let reply;
      try {
        reply = await d.callText(buildPrompt(batch), { jsonMode: true, maxTokens: 1500, temperature: 0, model, timeout: 60000, noFallback: true });
      } catch (e) {
        console.warn(`[listening] a batch of ${batch.length} failed (${errTag(e)}); it is not retried`);
        failed++;
        continue;
      }
      try { await d.spend.record('listening_score', 1); } catch (e) { console.error('[listening] could not record spend:', errTag(e)); }

      const parsed = parseReply(reply, batch.length);
      if (!parsed.size) { console.warn(`[listening] a batch of ${batch.length} came back unusable; its items stay unscored`); failed++; continue; }
      const rows = [];
      for (const [idx, v] of parsed) {
        const it = batch[idx];
        if (!it) continue;
        rows.push({ inboxItemId: it._id, platform: it.platform, kind: kindOf(it), label: v.label, reason: v.reason, itemAt: it.createdAt, scoredAt: at, modelVersion: caps.MODEL_VERSION });
      }
      try { await d.store.saveScores(userId, rows); out.scored += rows.length; }
      catch (e) { console.error(`[listening] could not save ${rows.length} scores (${errTag(e)}); the batch is not repeated`); failed++; }
    }

    if (out.batches > 0) {
      try { await d.store.rebuildWeeks(userId, at); } catch (e) { console.error('[listening] could not rebuild the weekly totals:', errTag(e)); }
      const runFailed = failed === out.batches;
      const next = runFailed ? failures + 1 : 0;
      memory.set(String(userId), { failures: next, at });
      user.listeningFailures = next;
      user.listeningRunAt = at;
      try { await d.markRun(user, { at, failures: next }); } catch (e) { console.error('[listening] could not stamp the run:', errTag(e)); }
      if (runFailed && next >= caps.FAIL_PAUSE_AFTER) await alertOnce(d, userId, next, at);
    }
    if (stopped) { if (out.batches === 0) return { ...out, skipped: stopped }; return { ...out, stopped }; }
    return out;
  } catch (e) {
    console.error('[listening] scoring an account failed:', errTag(e));
    return { ...out, skipped: 'error' };
  }
}

async function alertOnce(d, userId, failures, at) {
  const k = `${String(userId)}|${dayOf(at)}`;
  if (alerted.has(k)) return;
  alerted.add(k);
  if (alerted.size > 5000) alerted.clear();
  try {
    await d.alert({
      key: 'listening_pause', subject: 'Nebulaa alert: comment scoring paused for an account',
      text: `Comment scoring failed ${failures} runs in a row for account ${String(userId)} and is paused for it until a new comment arrives on a later day. Check the model name in LISTENING_MODEL and the AI provider status.`
    });
  } catch (_) { /* alerting never stops the run */ }
}

/**
 * One pass over all entitled accounts, oldest scored first. `limit` is the most accounts that get scored in one pass
 * (accounts with nothing to send do not count). Returns { accounts, scored } plus `busy` or `disabled`.
 */
async function runScorerOnce({ deps, now, accountIds = null, force = false, limit } = {}) {
  if (running) return { accounts: 0, scored: 0, busy: true };
  running = true;
  const out = { accounts: 0, scored: 0 };
  let token = null;
  let d = null;
  try {
    d = withDefaults(deps);
    const caps = d.caps || defaultCaps;
    const at = asDate(now);
    if (String((d.env && d.env.ENABLE_LISTENING) || '').trim() !== 'on') return { ...out, disabled: true };
    token = await d.lease.claim(at);
    if (!token) return { ...out, busy: true };

    let blocked;
    try { blocked = new Set(((await d.gate()) || []).map(String)); }
    catch (e) { console.warn('[listening] could not read the paused accounts, skipping this pass:', errTag(e)); return out; }

    const only = Array.isArray(accountIds) ? new Set(accountIds.map(String)) : null;
    let users = (await d.accounts({ ids: only ? [...only] : null })) || [];
    if (only) users = users.filter((u) => u && only.has(String(u._id)));
    const ranAt = (u) => (u && u.listeningRunAt ? new Date(u.listeningRunAt).getTime() : 0);
    users = [...users].sort((a, b) => ranAt(a) - ranAt(b) || (String(a && a._id) < String(b && b._id) ? -1 : 1));

    const maxAccounts = limit || caps.ACCOUNTS_PER_PASS || 60;
    for (const user of users) {
      if (out.accounts >= maxAccounts) break;
      if (!user || !eligibleAccount(user, { blocked })) continue;
      if (!force && user.listeningRunAt && at - new Date(user.listeningRunAt) < caps.RUN_EVERY_DAYS * DAY) continue;
      token = (await d.lease.renew(token, at)) || token;
      const r = await scoreAccount({ user, now: at, deps: d, force });
      if (r.batches > 0) {
        out.accounts++;
        out.scored += r.scored;
        await d.sleep(PAUSE_MS);
      }
      if (STOP_PASS.has(r.skipped) || STOP_PASS.has(r.stopped)) break;
    }
    return out;
  } catch (e) {
    console.error('[listening] scoring pass failed:', errTag(e));
    return out;
  } finally {
    if (token && d) { try { await d.lease.release(token); } catch (_) { /* it expires by itself */ } }
    running = false;
  }
}

const EVERY_MS = 6 * 3600000;       // a tick every 6 hours; accounts are only scored when their weekly run is due
const FIRST_MS = 25 * 60 * 1000;    // first tick 25 minutes after startup, after the competitor tracker's

/**
 * Starts the weekly scorer's timers. Returns null (starts nothing, logs nothing) unless ENABLE_LISTENING is exactly "on",
 * and always null under NODE_ENV=test. Timers are unref'd; a tick never throws and never overlaps a tick still running in
 * this process (the lease covers other servers). Failures log only the error name, never a message that could echo text.
 */
function startListeningScorer({ env = process.env, intervalMs = EVERY_MS, firstDelayMs = FIRST_MS, logger = console, deps, run, timers } = {}) {
  if (String((env && env.ENABLE_LISTENING) || '') !== 'on' || (env && env.NODE_ENV) === 'test') return null;
  const t = timers || { setTimeout, setInterval, clearTimeout, clearInterval };
  const pass = run || (() => runScorerOnce({ deps }));
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await pass(); } catch (e) { try { logger.error('[listening] scorer tick failed:', errTag(e)); } catch (_) { /* logging never throws out */ } }
    finally { busy = false; }
  };
  const first = t.setTimeout(tick, firstDelayMs);
  const timer = t.setInterval(tick, intervalMs);
  if (first && first.unref) first.unref();
  if (timer && timer.unref) timer.unref();
  logger.log(`[listening] comment scoring on: a check every ${Math.round(intervalMs / 3600000)} h, first check in ${Math.round(firstDelayMs / 60000)} min`);
  return { stop: () => { t.clearTimeout(first); t.clearInterval(timer); } };
}

module.exports = { scoreAccount, runScorerOnce, startListeningScorer, defaultDeps };
