'use strict';
/**
 * Deleting an account, with a waiting period. The customer asks (we cancel their plan at once, stop their posts and tell them),
 * they have 14 days to change their mind, and after that a background job erases everything on the data list, step by step,
 * keeping only what the law requires. Every step is recorded and can be retried, so a failure in one outside system never
 * leaves a half erased account that nobody knows about.
 */
const crypto = require('crypto');
const { erasable, filterFor, RETENTION_YEARS } = require('./dataRegistry');
const { extractAssets, deleteAssets } = require('./cloudinaryCleanup');
const ag = require('./agency');

const GRACE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// Keyed with HASH_PEPPER (utils/hashPepper.js, G7; no literal fallback). Records made before were keyed with
// JWT_SECRET, so lookups try that key too (decision D52).
const pepper = require('../utils/hashPepper');
const hmac = (v, key = pepper.primaryKey()) => crypto.createHmac('sha256', key).update(String(v)).digest('hex');
const accountHash = (userId) => hmac(`account:${userId}`);
const emailText = (email) => `email:${String(email || '').trim().toLowerCase()}`;
const emailHash = (email) => hmac(emailText(email));
const emailForms = (email) => [...new Set([String(email || '').trim().toLowerCase(), require('./signupGuard').canonicalEmail(email)])];
/**
 * Every hash an address is KEPT by: the plain lower-case address (what earlier tombstones used) and its canonical form
 * (no +tag, no dots for Gmail), so a deleted person cannot come back under j.ohn+2@gmail.com.
 */
const emailHashes = (email) => [...new Set(emailForms(email).map((e) => emailHash(e)))];
/** Every hash an address may have been kept by, for LOOKUPS: both forms under the current and the earlier key. */
const emailLookupHashes = (email) => [...new Set(pepper.verificationKeys().flatMap((key) => emailForms(email).map((e) => hmac(emailText(e), key))))];

/** Who may ask to be deleted from the app. Staff and managed clients go through support. */
function eligibility(user, { isStaff = () => false, resolveTier = () => 'free' } = {}) {
  if (!user) return { ok: false, message: 'Account not found.' };
  // A client brand is looked after by the agency that owns it; it has no login and is never deleted on its own.
  if (ag.isWorkspace(user)) return { ok: false, message: 'Remove this client from your agency account.' };
  if (isStaff(user)) return { ok: false, message: 'Staff accounts cannot be deleted from the app. Please ask the account owner.' };
  if (resolveTier(user) === 'managed') return { ok: false, message: 'Your account is looked after by our team, so please write to support@nebulaa.ai and we will delete it for you.' };
  if (user.deletion && user.deletion.status === 'pending') return { ok: false, already: true, message: 'Your account is already set to be deleted.' };
  return ownsClients(user) ? { ok: true, clients: Number(user.agency && user.agency.clientCount) || 0 } : { ok: true };
}

/**
 * An agency, or any account that still has client brands, even if its plan has since ended. Pass `realCount` (the
 * number of workspaces that name this account as their owner) wherever you can: the stored `clientCount` is only a
 * counter and can drift, and a drifted zero must never leave client brands behind when their agency is erased.
 */
const ownsClients = (user, realCount) => {
  if (ag.isAgency(user)) return true;
  if (!user || ag.isWorkspace(user)) return false;
  if (Number.isFinite(realCount)) return realCount > 0;
  return !!(user.agency && Number(user.agency.clientCount) > 0);
};
/** How many workspaces this account really owns, counted from the workspaces themselves. undefined if it cannot be counted. */
async function realClientCount(user, User) {
  if (!User || typeof User.find !== 'function') return undefined;
  return (await clientIds(user, User)).length;
}

/** The password is asked again for anything that downloads or erases an account. */
async function passwordOk(userId, password, { User } = {}) {
  const Model = User || defaultModels().User;
  const u = await Model.findById(userId).select('+password');
  if (!u || !password || typeof password !== 'string') return false;
  try { return await u.comparePassword(password); } catch (_) { return false; }
}

/** Ids of the client workspaces an account owns. */
async function clientIds(user, User) {
  const rows = await User.find({ 'agency.ownerId': user._id }).select('_id').lean();
  return rows.map((r) => r._id);
}

const clientIdsOf = async (user, User) => (User && typeof User.find === 'function' ? clientIds(user, User) : []);

/** Stops billing now: the plan and any add-ons are cancelled immediately. "Already cancelled" counts as done. */
async function cancelBilling(user, razorpay) {
  const recs = ((user.plan && user.plan.subscriptions) || []).filter((s) => s && s.active).map((s) => s.subscriptionId);
  const legacy = user.subscription && user.subscription.razorpaySubscriptionId;
  if (legacy && !recs.includes(legacy) && user.subscription.status === 'active') recs.push(legacy);
  const failed = [];
  for (const id of recs) {
    try { await razorpay.subscriptions.cancel(id, 0); }
    catch (e) { if (!/already|cancelled|canceled|completed|not cancel/i.test(String((e && (e.error && e.error.description || e.message)) || ''))) failed.push(id); }
  }
  return { cancelled: recs.length - failed.length, failed };
}

async function requestDeletion({ user, via = 'self', models, razorpay, now = new Date(), mail }) {
  const { User, Campaign, AccountDeletion } = models;
  const billing = await cancelBilling(user, razorpay);
  if (billing.failed.length) return { ok: false, message: 'We could not stop your plan’s billing just now, so nothing was changed. Please try again in a few minutes, or write to support@nebulaa.ai.' };
  const purgeAfter = new Date(now.getTime() + GRACE_DAYS * DAY);
  await AccountDeletion.create({ user: user._id, accountHash: accountHash(user._id), via, status: 'pending', requestedAt: now, purgeAfter });
  await User.updateOne({ _id: user._id }, { $set: { 'deletion.status': 'pending', 'deletion.requestedAt': now, 'deletion.purgeAfter': purgeAfter, 'subscription.cancelAtPeriodEnd': true } });
  // Scheduled posts stop going out. They are put back if the account is restored.
  await Campaign.updateMany({ userId: user._id, status: 'scheduled' }, { $set: { status: 'paused', pausedForDeletion: true } });
  // An agency's clients go with it, so their scheduled posts stop too. Counted from the workspaces, never from the stored counter.
  const ids = await clientIdsOf(user, User);
  if (ids.length) await Campaign.updateMany({ userId: { $in: ids }, status: 'scheduled' }, { $set: { status: 'paused', pausedForDeletion: true } });
  if (mail && user.email) await mail.sendDeletionRequested(user, purgeAfter).catch((e) => console.error('[account delete] email failed:', e && e.message));
  return { ok: true, purgeAfter };
}

async function restoreDeletion({ user, models, now = new Date() }) {
  const { User, Campaign, AccountDeletion } = models;
  if (!user.deletion || user.deletion.status !== 'pending') return { ok: false, message: 'There is no deletion to undo.' };
  await AccountDeletion.updateMany({ user: user._id, status: 'pending' }, { $set: { status: 'restored', completedAt: now } });
  await User.updateOne({ _id: user._id }, { $set: { 'deletion.status': '' }, $unset: { 'deletion.requestedAt': '', 'deletion.purgeAfter': '' } });
  await Campaign.updateMany({ userId: user._id, pausedForDeletion: true }, { $set: { status: 'scheduled' }, $unset: { pausedForDeletion: '' } });
  const ids = await clientIdsOf(user, User);
  if (ids.length) await Campaign.updateMany({ userId: { $in: ids }, pausedForDeletion: true }, { $set: { status: 'scheduled' }, $unset: { pausedForDeletion: '' } });
  return { ok: true, note: 'Your account is back. Your plan was cancelled, so choose a plan again if you want to carry on creating.' };
}

/** The ordered erase steps for one account. Each returns { detail } or throws. */
function stepsFor({ user, models, deps, now, clientCount }) {
  const ownerFilters = erasable().map((rule) => ({ rule, Model: models[rule.model], filter: (id) => filterFor(rule, id) })).filter((x) => x.Model);
  return [
    {
      name: 'keep_payment_records',
      run: async () => {
        const until = new Date(now.getTime() + RETENTION_YEARS * 365 * DAY);
        const b = user.billingDetails || {};
        let kept = 0;
        for (const p of (user.payments || [])) {
          const doc = { razorpayPaymentId: p.razorpayPaymentId, razorpayOrderId: p.razorpayOrderId, item: p.item, amount: p.amount, currency: p.currency, exGstAmount: p.exGstAmount, status: p.status, paidAt: p.paidAt, invoiceUrl: p.invoiceUrl || '', invoicedTo: { name: [user.firstName, user.lastName].filter(Boolean).join(' '), legalName: b.legalName || user.companyName || '', gstin: b.gstin || '', stateCode: b.stateCode || '' }, retainUntil: until };
          await models.RetainedPayment.updateOne({ razorpayPaymentId: p.razorpayPaymentId || `none:${kept}:${user._id}` }, { $setOnInsert: doc }, { upsert: true });
          kept += 1;
        }
        return { detail: `${kept} payment records kept for tax` };
      }
    },
    ...(ownsClients(user, clientCount) ? [{
      name: 'clients',
      run: async () => {
        // Every client is erased the same way a single removal erases it (files, connected accounts, data, then the record).
        const list = await require('./agencyWorkspaces').listWorkspaces({ owner: user, models });
        for (const c of list) {
          const out = await purgeWorkspace(c.id, { models, deps, now });
          if (!out.ok) throw new Error(`client "${c.name}" could not be erased${out.error ? `: ${out.error}` : ''}`);
        }
        return { detail: `${list.length} clients erased`, skipped: list.length === 0 };
      }
    }] : []),
    {
      name: 'files',
      run: async () => {
        const found = new Map();
        const add = (text) => extractAssets(text).forEach((a) => found.set(`${a.resourceType}:${a.publicId}`, a));
        add(JSON.stringify(user));
        for (const { Model, filter } of ownerFilters) {
          const cursor = Model.find(filter(user._id)).lean().cursor();
          for await (const doc of cursor) add(JSON.stringify(doc));
        }
        const out = await deps.deleteAssets([...found.values()]);
        if (out.failedBatches) throw new Error(`${out.failedBatches} file batches could not be deleted`);
        return { detail: `${out.requested} files deleted` };
      }
    },
    {
      name: 'social_profile',
      run: async () => {
        const key = user.ayrshare && user.ayrshare.profileKey;
        if (!key) return { detail: 'no connected accounts', skipped: true };
        const r = await deps.deleteSocialProfile(key);
        if (r && r.success === false && !/not found|does not exist/i.test(String(r.error || r.message || ''))) throw new Error(`social profile: ${r.error || r.message || 'not deleted'}`);
        return { detail: 'connected accounts profile deleted' };
      }
    },
    {
      name: 'data',
      run: async () => {
        let total = 0;
        for (const { rule, Model, filter } of ownerFilters) { const r = await Model.deleteMany(filter(user._id)); total += (r && r.deletedCount) || 0; }
        return { detail: `${total} records deleted across ${ownerFilters.length} collections` };
      }
    },
    {
      name: 'staff_log',
      run: async () => { await models.StaffAction.updateMany({ client: user._id }, { $set: { client: null } }); return { detail: 'staff log made anonymous' }; }
    },
    {
      name: 'tombstone',
      run: async () => { for (const h of emailHashes(user.email)) await models.DeletedAccount.updateOne({ emailHash: h }, { $setOnInsert: { emailHash: h, deletedAt: now } }, { upsert: true }); return { detail: 'one-way hash kept so a free Blueprint cannot be repeated' }; }
    },
    {
      name: 'account',
      run: async () => {
        if (deps.mail && user.email && !ag.isWorkspace(user)) await deps.mail.sendDeleted(user).catch(() => undefined);
        await models.User.deleteOne({ _id: user._id });
        return { detail: 'account erased' };
      }
    }
  ];
}

// A client workspace has no payments, no email and no staff history, and nothing is sent to it.
const WORKSPACE_STEPS = ['files', 'social_profile', 'data', 'account'];

/**
 * Erases one client workspace now, with no waiting period and no email. Never runs on an ordinary account or an agency.
 * A step that fails leaves the workspace in place, so it can be tried again; finished steps are safe to repeat.
 * The agency's own ledger rows for this client are kept: the data list finds ledger rows by their account, which is the agency.
 */
async function purgeWorkspace(workspaceId, { models, deps, now = new Date() }) {
  const user = await models.User.findById(workspaceId).select('+emailKey').lean();
  if (!user) return { ok: true, note: 'the client was already gone' };
  if (!ag.isWorkspace(user)) return { ok: false, error: 'not a client account' };
  for (const step of stepsFor({ user, models, deps, now }).filter((s) => WORKSPACE_STEPS.includes(s.name))) {
    try { await step.run(); }
    catch (e) { console.error(`[client removal] step "${step.name}" failed:`, e && e.message); return { ok: false, step: step.name, error: e && e.message }; }
  }
  return { ok: true };
}

/** Runs the erase for one pending request that is due. Safe to run again after a failure: finished steps are not repeated. */
async function purgeOne(request, { models, deps, now = new Date() }) {
  const user = await models.User.findById(request.user).select('+emailKey').lean();
  await models.AccountDeletion.updateOne({ _id: request._id }, { $set: { status: 'running', runningSince: now }, $inc: { attempts: 1 } });
  const done = new Set((request.steps || []).filter((s) => s.status === 'done' || s.status === 'skipped').map((s) => s.name));
  if (!user) {
    await models.AccountDeletion.updateOne({ _id: request._id }, { $set: { status: 'completed', completedAt: now } });
    return { status: 'completed', note: 'the account was already gone' };
  }
  const clientCount = await realClientCount(user, models.User);
  for (const step of stepsFor({ user, models, deps, now, clientCount })) {
    if (done.has(step.name)) continue;
    try {
      const out = await step.run();
      await models.AccountDeletion.updateOne({ _id: request._id }, { $push: { steps: { name: step.name, status: out && out.skipped ? 'skipped' : 'done', detail: (out && out.detail) || '', at: new Date() } } });
    } catch (e) {
      await models.AccountDeletion.updateOne({ _id: request._id }, { $set: { status: 'failed' }, $push: { steps: { name: step.name, status: 'failed', detail: String(e && e.message).slice(0, 200), at: new Date() } } });
      return { status: 'failed', step: step.name, error: e && e.message };
    }
  }
  await models.AccountDeletion.updateOne({ _id: request._id }, { $set: { status: 'completed', completedAt: now } });
  return { status: 'completed' };
}

// A purge that has been "running" this long was interrupted (a deploy, a crash) and is picked up again.
const RUNNING_STALE_MS = 30 * 60 * 1000;

/**
 * Finds the requests that are due and runs each one. A request is claimed with one conditional update (pending or
 * failed, or running for too long, to running), so two instances or two overlapping runs can never both erase the same
 * account or send its "deleted" email twice.
 */
async function runPurgeOnce({ models, deps, now = new Date(), alert = () => {} } = {}) {
  const cutoff = new Date(now.getTime() - RUNNING_STALE_MS);
  const due = await models.AccountDeletion.find({
    purgeAfter: { $lte: now }, attempts: { $lt: MAX_ATTEMPTS },
    $or: [
      { status: { $in: ['pending', 'failed'] } },
      { status: 'running', $or: [{ runningSince: { $lt: cutoff } }, { runningSince: null, updatedAt: { $lt: cutoff } }] }
    ]
  }).limit(10).lean();
  const out = { completed: 0, failed: 0 };
  for (const req of due) {
    const claimFilter = req.status === 'running'
      ? { _id: req._id, status: 'running', runningSince: req.runningSince === undefined ? null : req.runningSince }
      : { _id: req._id, status: { $in: ['pending', 'failed'] } };
    const claimed = await models.AccountDeletion.findOneAndUpdate(claimFilter, { $set: { status: 'running', runningSince: now } }, { new: true });
    if (!claimed) continue; // another run took it
    const r = await purgeOne(req, { models, deps, now });
    if (r.status === 'completed') out.completed += 1; else { out.failed += 1; alert(`Deleting an account stopped at "${r.step}": ${r.error}`); }
  }
  return out;
}

function defaultModels() {
  // Some files define more than one model, so load them all and take the models from mongoose by name.
  const mongoose = require('mongoose');
  const fs = require('fs'); const path = require('path');
  const dir = path.join(__dirname, '../models');
  for (const f of fs.readdirSync(dir)) { if (f.endsWith('.js')) { try { require(path.join(dir, f)); } catch (e) { console.error(`[account delete] could not load model ${f}:`, e.message); } } }
  const out = {};
  for (const name of ['User', 'Campaign', 'AccountDeletion', 'RetainedPayment', 'DeletedAccount', 'StaffAction', ...erasable().map((r) => r.model)]) out[name] = mongoose.models[name];
  const missing = Object.entries(out).filter(([, m]) => !m).map(([n]) => n);
  if (missing.length) throw new Error(`Models missing for account deletion: ${missing.join(', ')}`);
  return out;
}
const defaultDeps = () => ({
  deleteAssets: (assets) => deleteAssets(assets),
  deleteSocialProfile: (key) => require('./socialMediaAPI').deleteAyrshareProfile(key),
  mail: require('./accountMail')
});

function startAccountPurge({ intervalMs = 6 * 60 * 60 * 1000, logger = require('../utils/logger') } = {}) {
  if (String(process.env.ENABLE_ACCOUNT_PURGE || 'true').toLowerCase() === 'false') { logger.log('[account delete] purge disabled via ENABLE_ACCOUNT_PURGE=false'); return () => {}; }
  logger.log(`[account delete] purge job started (every ${intervalMs}ms)`);
  // Through a lease (services/leaseLock.js; a long purge keeps it by renewal), kept for half the interval after a good run.
  const leasedPurge = require('./leaseLock').leased('scheduler:account-purge', 30 * 60 * 1000, () => runPurgeOnce({ models: defaultModels(), deps: defaultDeps(), alert: (m) => { try { require('./opsAlerts').recordFailure('billing', m); } catch (_) { /* alerting never stops the run */ } } })
    .then((r) => { if (r.completed || r.failed) logger.log(`[account delete] completed ${r.completed}, failed ${r.failed}`); }), { cooldownMs: intervalMs / 2 });
  const run = () => leasedPurge().catch((e) => logger.error('[account delete] run failed:', e.message));
  const timer = setInterval(run, intervalMs);
  const first = setTimeout(run, 3 * 60 * 1000);
  return () => { clearInterval(timer); clearTimeout(first); };
}

module.exports = { RUNNING_STALE_MS, passwordOk, ownsClients, realClientCount, purgeWorkspace, GRACE_DAYS, MAX_ATTEMPTS, accountHash, emailHash, emailHashes, emailLookupHashes, eligibility, cancelBilling, requestDeletion, restoreDeletion, purgeOne, runPurgeOnce, stepsFor, defaultModels, defaultDeps, startAccountPurge };
