'use strict';
/**
 * Pure and injectable parts of scripts/razorpay-test-check.js: the safety guards, the ONE Razorpay client wrapper, the
 * amounts (from config only), signing helpers, polling, the results table, the cleanup and the cleanup-file helpers.
 * Nothing in here prints a key or a secret. The Razorpay SDK is loaded in exactly one place, `loadSdk` below.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REQUIRED_DB = 'nebulaa_dev';
const APPROVAL_VAR = 'I_APPROVED_RAZORPAY_TEST';
const PREFIX = 'rzpcheck-';
const CLEANUP_FILE = path.join(os.tmpdir(), 'nebulaa-razorpay-test-check.json');

// ---------------------------------------------------------------------------------------------------------------------
// Guards. Messages name the variable, never its value.
// ---------------------------------------------------------------------------------------------------------------------
/** A Razorpay key id carries its mode: rzp_test_... or rzp_live_... */
const isTestKeyId = (v) => typeof v === 'string' && /^rzp_test_[A-Za-z0-9]{6,}$/.test(v);
/**
 * Razorpay secrets carry no documented mode prefix, so a secret cannot be proven to be a test one by looking at it.
 * What can be refused: a missing one, one that looks like a live key id pasted into the wrong box, one with spaces or
 * quotes in it, or one that is too short to be real. The key id check above and Razorpay itself (a live secret does not
 * authenticate a test key id) are the real protection.
 */
function secretProblem(v) {
  if (typeof v !== 'string' || !v) return 'RAZORPAY_KEY_SECRET is not set';
  if (/^rzp_live_/i.test(v) || /^rzp_test_/i.test(v)) return 'RAZORPAY_KEY_SECRET looks like a key id, not a key secret (a key id starts with rzp_)';
  if (/\s|["']/.test(v)) return 'RAZORPAY_KEY_SECRET has spaces or quote marks in it: paste only the secret';
  if (v.length < 12) return 'RAZORPAY_KEY_SECRET is too short to be a Razorpay secret';
  return null;
}

/**
 * All the guards that need no database. Returns { ok, problems[] }.
 * `env` is read ONLY for the four variables named here; values are never copied into a message.
 */
function evaluateGuards({ env, dbName, requireMongo = true }) {
  const problems = [];
  if (env[APPROVAL_VAR] !== 'yes') problems.push(`${APPROVAL_VAR}=yes is not set. This check talks to Razorpay TEST mode and writes to the development database, so it needs your explicit approval.`);
  const id = env.RAZORPAY_KEY_ID;
  if (!id) problems.push('RAZORPAY_KEY_ID is not set.');
  else if (/^rzp_live_/i.test(id)) problems.push('RAZORPAY_KEY_ID is a LIVE key (rzp_live_...). Refusing: this check only runs with a TEST key (rzp_test_...).');
  else if (!isTestKeyId(id)) problems.push('RAZORPAY_KEY_ID does not start with rzp_test_. Refusing: only a Razorpay TEST key id is accepted.');
  const sp = secretProblem(env.RAZORPAY_KEY_SECRET);
  if (sp) problems.push(sp + '.');
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') problems.push('NODE_ENV is production. Refusing.');
  if (requireMongo && !env.MONGODB_URI) problems.push('MONGODB_URI is not set (it should point at the development database, nebulaa_dev).');
  if (dbName !== undefined && dbName !== REQUIRED_DB) problems.push(`The database is "${dbName}", not "${REQUIRED_DB}". Refusing: this check only touches the development database.`);
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------------------------------------------------
// The ONE Razorpay client wrapper. Every Razorpay call in the check (ours and the real payment route's) goes through it.
// ---------------------------------------------------------------------------------------------------------------------
/** The only place the Razorpay SDK is loaded. Called after every guard has passed. */
function loadSdk(keyId, keySecret) {
  const Razorpay = require('razorpay');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

const errInfo = (e) => ({
  statusCode: e && e.statusCode, code: e && e.error && e.error.code,
  description: String((e && ((e.error && e.error.description) || e.message)) || e || '').slice(0, 300)
});

/**
 * Wraps an SDK (or a fake with the same shape). Only the calls the check needs exist; anything else is simply not there.
 * Tracks every subscription created (so cleanup can cancel them), keeps a log of calls and the last error.
 */
function createRazorpayClient(sdk, { onSubscriptionCreated } = {}) {
  const created = [];
  const log = [];
  let lastError = null;
  const run = async (name, args, fn) => {
    log.push({ name, args });
    try { return await fn(); } catch (e) { lastError = { call: name, ...errInfo(e) }; throw e; }
  };
  return {
    plans: { create: (body) => run('plans.create', [], () => sdk.plans.create(body)) },
    subscriptions: {
      create: async (body) => {
        const s = await run('subscriptions.create', [], () => sdk.subscriptions.create(body));
        if (s && s.id) { created.push(s.id); if (onSubscriptionCreated) onSubscriptionCreated(s.id); }
        return s;
      },
      fetch: (id) => run('subscriptions.fetch', [id], () => sdk.subscriptions.fetch(id)),
      cancel: (id, atCycleEnd) => run('subscriptions.cancel', [id, atCycleEnd], () => sdk.subscriptions.cancel(id, atCycleEnd))
    },
    payments: { fetch: (id) => run('payments.fetch', [id], () => sdk.payments.fetch(id)) },
    invoices: {
      all: (query) => run('invoices.all', [], () => sdk.invoices.all(query)),
      fetch: (id) => run('invoices.fetch', [id], () => sdk.invoices.fetch(id))
    },
    createdSubscriptionIds: () => [...created],
    calls: () => log.map((c) => ({ name: c.name, args: [...c.args] })),
    lastError: () => lastError
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Amounts: from config only. Nothing here is a typed-in price.
// ---------------------------------------------------------------------------------------------------------------------
function expectedAmounts() {
  const { PLANS, AGENCY, chargePaise, gstPaise } = require('../../config/apiCosts');
  return {
    agency: { inr: PLANS.agency.inr, quarks: PLANS.agency.quarks, gstPaise: gstPaise(PLANS.agency.inr), chargePaise: chargePaise(PLANS.agency.inr) },
    slot: { inr: AGENCY.slot.inr, quarks: AGENCY.slot.quarks, gstPaise: gstPaise(AGENCY.slot.inr), chargePaise: chargePaise(AGENCY.slot.inr) },
    includedClients: AGENCY.includedClients,
    maxClients: AGENCY.maxClients,
    maxExtraSlots: AGENCY.maxClients - AGENCY.includedClients
  };
}

/** 825882 -> "Rs 8,258.82" */
const rupees = (paise) => `Rs ${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------------------------------------------------
// Signing (the same formulas the server checks).
// ---------------------------------------------------------------------------------------------------------------------
const webhookSignature = (secret, rawBody) => crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
/** Razorpay's documented checkout signature for a subscription payment: HMAC-SHA256 of "payment_id|subscription_id" with the key secret. */
const checkoutSignature = (keySecret, paymentId, subscriptionId) => crypto.createHmac('sha256', keySecret).update(`${paymentId}|${subscriptionId}`).digest('hex');
const newWebhookSecret = () => crypto.randomBytes(32).toString('hex');

/** The body Razorpay posts for a subscription event, built from real entities. */
function buildEvent(eventName, subscriptionEntity, paymentEntity) {
  return { entity: 'event', event: eventName, contains: paymentEntity ? ['subscription', 'payment'] : ['subscription'],
    payload: { subscription: { entity: subscriptionEntity }, ...(paymentEntity ? { payment: { entity: paymentEntity } } : {}) } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------------------------------------------------
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** fn() returns { done, value }. Resolves { ok:true, value } as soon as done, or { ok:false, value: lastValue } at the timeout. */
async function waitFor(fn, { intervalMs = 5000, timeoutMs = 600000, sleep = defaultSleep, now = Date.now, onTick } = {}) {
  const start = now();
  for (;;) {
    const r = await fn();
    if (r && r.done) return { ok: true, value: r.value };
    if (now() - start >= timeoutMs) return { ok: false, value: r && r.value };
    if (onTick) onTick(r && r.value);
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------------------------------
function createResults() {
  const rows = [];
  return {
    rows,
    add: (name, status, detail = '') => { rows.push({ name, status, detail }); },
    count: (s) => rows.filter((r) => r.status === s).length
  };
}
function renderTable(rows) {
  return rows.map((r) => `${r.status.padEnd(5)} ${r.name}${r.detail && r.status !== 'PASS' ? `\n      -> ${r.detail}` : ''}`).join('\n');
}
/** 0 only when nothing failed, nothing is left behind and every Razorpay subscription was cancelled. */
function exitCodeFor({ results, cleanup }) {
  const fails = results.rows.filter((r) => r.status === 'FAIL').length;
  const left = cleanup ? Object.values(cleanup.left).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) : 1;
  const rz = cleanup ? cleanup.razorpay.failed.length : 0;
  return fails || left || rz ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cleanup file (so an interrupted run can be cleaned later)
// ---------------------------------------------------------------------------------------------------------------------
const cleanupFileApi = (file = CLEANUP_FILE, fsApi = fs) => ({
  file,
  read() { try { return JSON.parse(fsApi.readFileSync(file, 'utf8')); } catch (_) { return null; } },
  write(data) { fsApi.writeFileSync(file, JSON.stringify(data), { mode: 0o600 }); },
  remove() { try { fsApi.unlinkSync(file); return true; } catch (_) { return false; } },
  exists() { return fsApi.existsSync(file); }
});

/** Runs `fn` at most once, however many times it is asked (a normal finish, a failure and Ctrl+C can all ask). */
function once(fn) { let p = null; return () => { if (!p) p = Promise.resolve().then(fn); return p; }; }

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Cancel every Razorpay TEST subscription the check made, then delete every throwaway row. Always safe to run twice.
 *   client  the wrapper (or null when there are no keys: then the subscription ids are listed for you to cancel by hand)
 *   models  { User, QuarkLedger, OpsState }
 *   db      mongoose db (for the read-only scan of other collections), or null
 */
async function cleanupAll({ client, models, db = null, file, out = () => {}, settleMs = 400, extraSubscriptionIds = [], extraUserIds = [], sleep = defaultSleep }) {
  const { User, QuarkLedger, OpsState } = models;
  const saved = file ? file.read() : null;
  const userIds = new Set([...(saved && saved.userIds) || [], ...extraUserIds].map(String));
  const subIds = new Set([...(saved && saved.subscriptionIds) || [], ...(client ? client.createdSubscriptionIds() : []), ...extraSubscriptionIds]);

  // Throwaway accounts: by name, by the cleanup file, and the client workspaces they own.
  const byName = await User.find({ email: { $regex: `^${escapeRe(PREFIX)}` } }).select('_id plan.subscriptions').lean();
  const named = [...byName];
  if (userIds.size) named.push(...await User.find({ _id: { $in: [...userIds] } }).select('_id plan.subscriptions').lean());
  for (const u of named) {
    userIds.add(String(u._id));
    for (const s of (u.plan && u.plan.subscriptions) || []) if (s && s.subscriptionId) subIds.add(s.subscriptionId);
  }
  const owners = [...userIds];
  const workspaces = owners.length ? await User.find({ 'agency.ownerId': { $in: owners } }).select('_id').lean() : [];
  const allIds = [...new Set([...owners, ...workspaces.map((w) => String(w._id))])];

  // 1. Razorpay first, while we still know the ids.
  const razorpay = { cancelled: [], alreadyDone: [], failed: [] };
  for (const id of subIds) {
    if (!client) { razorpay.failed.push(id); continue; }
    try {
      const s = await client.subscriptions.fetch(id);
      if (s && ['cancelled', 'completed', 'expired'].includes(s.status)) { razorpay.alreadyDone.push(id); continue; }
      await client.subscriptions.cancel(id, 0);
      razorpay.cancelled.push(id);
    } catch (e) {
      const d = errInfo(e).description;
      if (/already|cancelled|canceled|completed|not cancel/i.test(d)) razorpay.alreadyDone.push(id);
      else razorpay.failed.push(id);
    }
  }

  // 2. Rows. A short wait first: ledger rows are written without being waited for.
  if (settleMs) await sleep(settleMs);
  const removed = {};
  if (allIds.length) {
    removed.ledger = (await QuarkLedger.deleteMany({ $or: [{ user: { $in: allIds } }, { workspace: { $in: allIds } }] })).deletedCount || 0;
  }
  const opsFilter = { key: { $regex: [escapeRe(PREFIX), ...allIds.map(escapeRe)].join('|') } };
  removed.opsState = (await OpsState.deleteMany(opsFilter)).deletedCount || 0;
  removed.users = allIds.length || byName.length
    ? (await User.deleteMany({ $or: [{ _id: { $in: allIds } }, { email: { $regex: `^${escapeRe(PREFIX)}` } }, { 'agency.ownerId': { $in: allIds } }] })).deletedCount || 0
    : 0;

  // 3. Count what is left. A read-only scan of other collections looks for rows that point at these accounts.
  const left = {
    users: await User.countDocuments({ $or: [{ _id: { $in: allIds } }, { email: { $regex: `^${escapeRe(PREFIX)}` } }, { 'agency.ownerId': { $in: allIds } }] }),
    ledger: allIds.length ? await QuarkLedger.countDocuments({ $or: [{ user: { $in: allIds } }, { workspace: { $in: allIds } }] }) : 0,
    opsState: await OpsState.countDocuments(opsFilter),
    otherCollections: 0
  };
  const stray = {}; let unchecked = 0;
  if (db && allIds.length) {
    const skip = new Set(['users', 'quarkledgers', 'ops_state']);
    for (const { name } of await db.listCollections().toArray()) {
      if (skip.has(name) || name.startsWith('system.')) continue;
      for (const f of ['userId', 'user', 'client', 'actor', 'owner', 'agency.ownerId']) {
        try {
          const c = await db.collection(name).countDocuments({ [f]: { $in: allIds } }, { maxTimeMS: 8000 });
          if (c) stray[`${name}.${f}`] = c;
        } catch (_) { unchecked += 1; }
      }
    }
    left.otherCollections = Object.values(stray).reduce((a, b) => a + b, 0);
  }

  const clean = Object.values(left).every((v) => v === 0) && razorpay.failed.length === 0;
  if (file && clean) file.remove();
  else if (file && razorpay.failed.length) {
    // Keep what a later `cleanup` needs.
    file.write({ ...(saved || {}), tag: saved && saved.tag, subscriptionIds: [...subIds], userIds: [], note: 'cancel these Razorpay TEST subscriptions' });
  }
  out(`cleanup: Razorpay TEST subscriptions cancelled ${razorpay.cancelled.length}, already ended ${razorpay.alreadyDone.length}, NOT cancelled ${razorpay.failed.length}`);
  if (razorpay.failed.length) out(`  cancel these by hand in the Razorpay dashboard (Test mode > Subscriptions): ${razorpay.failed.join(', ')}`);
  out(`cleanup: deleted ${removed.users || 0} accounts (including client workspaces), ${removed.ledger || 0} Quark ledger rows, ${removed.opsState || 0} OpsState rows`);
  out(`cleanup: left over: accounts ${left.users}, ledger rows ${left.ledger}, OpsState rows ${left.opsState}, rows in other collections ${left.otherCollections}${unchecked ? ` (${unchecked} scans timed out and were not checked)` : ''}`);
  return { removed, left, stray, razorpay, unchecked };
}

module.exports = {
  REQUIRED_DB, APPROVAL_VAR, PREFIX, CLEANUP_FILE,
  isTestKeyId, secretProblem, evaluateGuards,
  loadSdk, createRazorpayClient, errInfo,
  expectedAmounts, rupees,
  webhookSignature, checkoutSignature, newWebhookSecret, buildEvent,
  waitFor, defaultSleep,
  createResults, renderTable, exitCodeFor,
  cleanupFileApi, once, cleanupAll, escapeRe
};
