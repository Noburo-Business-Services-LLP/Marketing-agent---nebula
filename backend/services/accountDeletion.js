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

const GRACE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const secret = () => process.env.JWT_SECRET || 'nebulaa-account-hash';
const hmac = (v) => crypto.createHmac('sha256', secret()).update(String(v)).digest('hex');
const accountHash = (userId) => hmac(`account:${userId}`);
const emailHash = (email) => hmac(`email:${String(email || '').trim().toLowerCase()}`);

/** Who may ask to be deleted from the app. Staff and managed clients go through support. */
function eligibility(user, { isStaff = () => false, resolveTier = () => 'free' } = {}) {
  if (!user) return { ok: false, message: 'Account not found.' };
  if (isStaff(user)) return { ok: false, message: 'Staff accounts cannot be deleted from the app. Please ask the account owner.' };
  if (resolveTier(user) === 'managed') return { ok: false, message: 'Your account is looked after by our team, so please write to support@nebulaa.ai and we will delete it for you.' };
  if (user.deletion && user.deletion.status === 'pending') return { ok: false, already: true, message: 'Your account is already set to be deleted.' };
  return { ok: true };
}

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
  if (mail && user.email) await mail.sendDeletionRequested(user, purgeAfter).catch((e) => console.error('[account delete] email failed:', e && e.message));
  return { ok: true, purgeAfter };
}

async function restoreDeletion({ user, models, now = new Date() }) {
  const { User, Campaign, AccountDeletion } = models;
  if (!user.deletion || user.deletion.status !== 'pending') return { ok: false, message: 'There is no deletion to undo.' };
  await AccountDeletion.updateMany({ user: user._id, status: 'pending' }, { $set: { status: 'restored', completedAt: now } });
  await User.updateOne({ _id: user._id }, { $set: { 'deletion.status': '' }, $unset: { 'deletion.requestedAt': '', 'deletion.purgeAfter': '' } });
  await Campaign.updateMany({ userId: user._id, pausedForDeletion: true }, { $set: { status: 'scheduled' }, $unset: { pausedForDeletion: '' } });
  return { ok: true, note: 'Your account is back. Your plan was cancelled, so choose a plan again if you want to carry on creating.' };
}

/** The ordered erase steps for one account. Each returns { detail } or throws. */
function stepsFor({ user, models, deps, now }) {
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
      run: async () => { await models.DeletedAccount.updateOne({ emailHash: emailHash(user.email) }, { $setOnInsert: { emailHash: emailHash(user.email), deletedAt: now } }, { upsert: true }); return { detail: 'one-way hash kept so a free Blueprint cannot be repeated' }; }
    },
    {
      name: 'account',
      run: async () => {
        if (deps.mail && user.email) await deps.mail.sendDeleted(user).catch(() => undefined);
        await models.User.deleteOne({ _id: user._id });
        return { detail: 'account erased' };
      }
    }
  ];
}

/** Runs the erase for one pending request that is due. Safe to run again after a failure: finished steps are not repeated. */
async function purgeOne(request, { models, deps, now = new Date() }) {
  const user = await models.User.findById(request.user).select('+emailKey').lean();
  await models.AccountDeletion.updateOne({ _id: request._id }, { $set: { status: 'running' }, $inc: { attempts: 1 } });
  const done = new Set((request.steps || []).filter((s) => s.status === 'done' || s.status === 'skipped').map((s) => s.name));
  if (!user) {
    await models.AccountDeletion.updateOne({ _id: request._id }, { $set: { status: 'completed', completedAt: now } });
    return { status: 'completed', note: 'the account was already gone' };
  }
  for (const step of stepsFor({ user, models, deps, now })) {
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

async function runPurgeOnce({ models, deps, now = new Date(), alert = () => {} } = {}) {
  const due = await models.AccountDeletion.find({ status: { $in: ['pending', 'failed'] }, purgeAfter: { $lte: now }, attempts: { $lt: MAX_ATTEMPTS } }).limit(10).lean();
  const out = { completed: 0, failed: 0 };
  for (const req of due) {
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

function startAccountPurge({ intervalMs = 6 * 60 * 60 * 1000, logger = console } = {}) {
  if (String(process.env.ENABLE_ACCOUNT_PURGE || 'true').toLowerCase() === 'false') { logger.log('[account delete] purge disabled via ENABLE_ACCOUNT_PURGE=false'); return () => {}; }
  logger.log(`[account delete] purge job started (every ${intervalMs}ms)`);
  const run = () => runPurgeOnce({ models: defaultModels(), deps: defaultDeps(), alert: (m) => { try { require('./opsAlerts').recordFailure('billing', m); } catch (_) { /* alerting never stops the run */ } } })
    .then((r) => { if (r.completed || r.failed) logger.log(`[account delete] completed ${r.completed}, failed ${r.failed}`); })
    .catch((e) => logger.error('[account delete] run failed:', e.message));
  const timer = setInterval(run, intervalMs);
  setTimeout(run, 3 * 60 * 1000);
  return () => clearInterval(timer);
}

module.exports = { GRACE_DAYS, MAX_ATTEMPTS, accountHash, emailHash, eligibility, cancelBilling, requestDeletion, restoreDeletion, purgeOne, runPurgeOnce, stepsFor, defaultModels, defaultDeps, startAccountPurge };
