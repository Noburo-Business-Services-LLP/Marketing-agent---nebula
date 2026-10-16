/**
 * How Quarks are held and how they expire.
 *
 * `credits.balance` is the one number the whole app reads: everything the person can spend right now. It is split
 * into buckets, tracked next to it:
 *   planBalance   the monthly allowance. Replaced on every renewal, and gone when the paid month ends.
 *   topupBalance  bought packs. Valid TOPUP_VALID_DAYS from the latest purchase, and usable only while a plan is
 *                 active (they are held, not lost, if the plan lapses inside that time).
 *   (the rest)    kept: Quarks granted before buckets existed, staff grants and bonuses. They never expire.
 * Spending takes the plan bucket first, then top-ups, then kept Quarks, so the Quarks that expire soonest go first.
 *
 * Everything here that changes money is one conditional MongoDB update, so concurrent jobs cannot overspend.
 */
const User = require('../models/User');
const QuarkLedger = require('../models/QuarkLedger');

const DAY = 24 * 60 * 60 * 1000;
const TOPUP_VALID_DAYS = 60;
// A renewal can land a little late (a retry after a failed charge), so the plan bucket outlives the paid month by this much.
const PLAN_GRACE_DAYS = 3;
const PAID_TIERS = ['starter', 'professional', 'agency'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function hasActivePlan(user) {
  const tier = user && user.plan && user.plan.tier;
  return PAID_TIERS.includes(tier) && (!user.subscription || user.subscription.status !== 'halted');
}

/** What the person can spend right now, and when each part ends. Pure: used by the API and the screens. */
function summarise(user, now = new Date()) {
  const c = (user && user.credits) || {};
  const balance = Math.max(0, num(c.balance));
  const planExpiresAt = c.planExpiresAt ? new Date(c.planExpiresAt) : null;
  const topupExpiresAt = c.topupExpiresAt ? new Date(c.topupExpiresAt) : null;
  const planLive = !planExpiresAt || planExpiresAt > now;
  const topupLive = !topupExpiresAt || topupExpiresAt > now;
  const plan = planLive ? Math.min(Math.max(0, num(c.planBalance)), balance) : 0;
  const topup = topupLive ? Math.min(Math.max(0, num(c.topupBalance)), Math.max(0, balance - plan)) : 0;
  return {
    balance,
    plan,
    topup,
    kept: Math.max(0, balance - plan - topup),
    held: Math.max(0, num(c.topupHeld)),
    planExpiresAt,
    topupExpiresAt
  };
}

function record(row) {
  // The trail must never break a payment or a job, so a failed write is logged and dropped.
  return QuarkLedger.create({ createdAt: new Date(), ...row }).catch((e) => console.warn('[quark-ledger] could not record:', e.message));
}

/**
 * One atomic spend that also moves the buckets. Pipeline update: the balance is checked and everything is
 * subtracted in a single step. Returns the updated user, or null when the balance is too low.
 */
function spendPipeline(cost, entry) {
  const b = { $max: [0, { $ifNull: ['$credits.balance', 0] }] };
  const planRaw = { $max: [0, { $ifNull: ['$credits.planBalance', 0] }] };
  const topRaw = { $max: [0, { $ifNull: ['$credits.topupBalance', 0] }] };
  const plan = { $min: [planRaw, b] };
  const topup = { $min: [topRaw, { $subtract: [b, plan] }] };
  const planUse = { $min: [plan, cost] };
  const topUse = { $min: [topup, { $subtract: [cost, planUse] }] };
  return [{
    $set: {
      'credits.balance': { $subtract: ['$credits.balance', cost] },
      'credits.totalUsed': { $add: [{ $ifNull: ['$credits.totalUsed', 0] }, cost] },
      'credits.planBalance': { $subtract: [plan, planUse] },
      'credits.topupBalance': { $subtract: [topup, topUse] },
      'credits.history': { $slice: [{ $concatArrays: [{ $ifNull: ['$credits.history', []] }, [{ $literal: entry }]] }, -100] }
    }
  }];
}

/**
 * Spend from the wallet that pays for `userId`: the user's own, or the agency's shared pool when the user is a
 * client workspace. The agency must be able to pay (see CLIENT_PAYER_FILTER), checked in the same atomic update.
 * The ledger row sits on the payer and names the client in `workspace`. Nothing is ever charged to the client record.
 * The result also names who paid (`payerId`, `workspaceId`) so a later refund can go to the same wallet.
 */
async function spend(userId, cost, { action = 'spend', description = '', ref = '', units = 1 } = {}) {
  const amount = num(cost);
  if (amount <= 0) return { success: true, balance: null, spent: 0 };
  const agencyRules = require('./agency');
  const { payerId, workspaceId } = await agencyRules.resolvePayer(userId);
  if (!payerId) return { success: false, balance: null, spent: 0 }; // never charge a record we cannot place
  const entry = { action, amount: -amount, description: description || action, createdAt: new Date() };
  const filter = { _id: workspaceId ? payerId : userId, 'credits.balance': { $gte: amount } };
  if (workspaceId) Object.assign(filter, agencyRules.CLIENT_PAYER_FILTER);
  const doc = await User.findOneAndUpdate(filter, spendPipeline(amount, entry), { new: true });
  if (!doc) return { success: false, balance: null, spent: 0 };
  record({ user: workspaceId ? payerId : userId, workspace: workspaceId || undefined, type: 'spend', quarks: -amount, balanceAfter: doc.credits.balance, action, ref });
  // What this cost us, for the daily ceiling and the staff screen. Never blocks the spend.
  try { require('./spendGuard').record(action, units); } catch (_) { /* cost tracking is best effort */ }
  return { success: true, balance: doc.credits.balance, spent: amount, user: doc, payerId: workspaceId ? payerId : String(userId), workspaceId };
}

/**
 * Give Quarks back to the wallet that was charged: `payerId` when the charge recorded one (so a refund still lands
 * even if the client was removed or the plan changed since), otherwise whoever pays for `userId` now. Returns
 * { ok, payerId } and never touches a client record. A client refund also leaves a ledger row naming the client.
 */
async function refundTo(userId, quarks, { action = 'refund', ref = '', payerId = '' } = {}) {
  const amount = num(quarks);
  if (amount <= 0) return { ok: false, payerId: null };
  let target = userId;
  let workspaceId = null;
  if (payerId && String(payerId) !== String(userId)) { target = payerId; workspaceId = String(userId); }
  else if (!payerId) {
    const r = await require('./agency').resolvePayer(userId);
    if (!r.payerId) return { ok: false, payerId: null };
    if (r.workspaceId) { target = r.payerId; workspaceId = r.workspaceId; }
  }
  const out = await User.updateOne({ _id: target }, { $inc: { 'credits.balance': amount, 'credits.totalUsed': -amount } });
  if (out && out.modifiedCount === 0) return { ok: false, payerId: null };
  record({ user: target, workspace: workspaceId || undefined, type: 'refund', quarks: amount, action, ref: ref || undefined });
  return { ok: true, payerId: String(target) };
}

/** `settle` for whoever pays for `userId`: a client's activity expires the agency's Quarks, not its own empty record. */
async function settleWallet(userId, ...rest) {
  const { payerId, workspaceId } = await require('./agency').resolvePayer(userId);
  return settle(workspaceId && payerId ? payerId : userId, ...rest);
}

/** Expire what is due, and hold top-ups while no plan is active. Safe to call often. */
async function settle(userId, now = new Date(), { forcePlan = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const user = await User.findById(userId).select('credits plan subscription').lean();
    if (!user || !user.credits) return { changed: false };
    const c = user.credits;
    const balance = Math.max(0, num(c.balance));
    const planBalance = Math.min(Math.max(0, num(c.planBalance)), balance);
    const topupBalance = Math.min(Math.max(0, num(c.topupBalance)), Math.max(0, balance - planBalance));

    const planDue = forcePlan || (c.planExpiresAt && new Date(c.planExpiresAt) <= now);
    const expirePlan = planDue ? planBalance : 0;
    const topupDue = c.topupExpiresAt && new Date(c.topupExpiresAt) <= now;
    const expireTopup = topupDue ? topupBalance : 0;
    // The plan month is over and no plan is active: the paid-for top-ups wait, they are not lost.
    const lapsed = !forcePlan && planDue && c.planExpiresAt && !hasActivePlan(user);
    const hold = !expireTopup && lapsed ? topupBalance : 0;
    const planFlag = planDue && (planBalance > 0 || num(c.planBalance) !== 0);
    if (!expirePlan && !expireTopup && !hold && !planFlag) return { changed: false };

    const removed = expirePlan + expireTopup + hold;
    const filter = { _id: userId, 'credits.balance': c.balance, 'credits.planBalance': c.planBalance ?? null };
    if (c.planBalance === undefined) delete filter['credits.planBalance'];
    const set = {};
    const inc = { 'credits.balance': -removed };
    if (planDue) { set['credits.planBalance'] = 0; }
    if (expireTopup) { set['credits.topupBalance'] = 0; set['credits.topupExpiresAt'] = null; }
    if (hold) { set['credits.topupBalance'] = 0; inc['credits.topupHeld'] = hold; }
    const entries = [];
    const stamp = new Date();
    if (expirePlan) entries.push({ action: 'plan_quarks_expired', amount: -expirePlan, description: 'Monthly Quarks ended with the paid month', createdAt: stamp });
    if (expireTopup) entries.push({ action: 'topup_quarks_expired', amount: -expireTopup, description: 'Top-up Quarks passed their 60 days', createdAt: stamp });
    if (hold) entries.push({ action: 'topup_quarks_held', amount: -hold, description: 'Top-up Quarks are held until a plan is active', createdAt: stamp });
    const update = { $set: set, $inc: inc };
    if (entries.length) update.$push = { 'credits.history': { $each: entries, $slice: -100 } };
    const doc = await User.findOneAndUpdate(filter, update, { new: true });
    if (!doc) continue; // the balance moved while we looked: read again
    if (expirePlan) record({ user: userId, type: 'expiry', bucket: 'plan', quarks: -expirePlan, balanceAfter: doc.credits.balance, action: 'plan_expired' });
    if (expireTopup) record({ user: userId, type: 'expiry', bucket: 'topup', quarks: -expireTopup, balanceAfter: doc.credits.balance, action: 'topup_expired' });
    if (hold) record({ user: userId, type: 'hold', bucket: 'topup', quarks: -hold, balanceAfter: doc.credits.balance, action: 'topup_held' });
    return { changed: true, expiredPlan: expirePlan, expiredTopup: expireTopup, held: hold, balance: doc.credits.balance };
  }
  return { changed: false };
}

/** Update parts for a monthly plan charge: a new allowance replaces whatever is left of the last one. */
function planGrantUpdate(quarks, { periodEnd, now = new Date(), heldToRelease = 0 } = {}) {
  const end = periodEnd instanceof Date && !Number.isNaN(periodEnd.getTime()) ? periodEnd : new Date(now.getTime() + 30 * DAY);
  const set = { 'credits.planBalance': quarks, 'credits.planExpiresAt': new Date(end.getTime() + PLAN_GRACE_DAYS * DAY) };
  const inc = { 'credits.balance': quarks + heldToRelease };
  if (heldToRelease > 0) { inc['credits.topupBalance'] = heldToRelease; inc['credits.topupHeld'] = -heldToRelease; }
  return { set, inc };
}

/** Update parts for a top-up: more Quarks, and 60 days counted from this purchase. */
function topupGrantUpdate(quarks, { now = new Date() } = {}) {
  return {
    set: { 'credits.topupExpiresAt': new Date(now.getTime() + TOPUP_VALID_DAYS * DAY) },
    inc: { 'credits.balance': quarks, 'credits.topupBalance': quarks }
  };
}

module.exports = {
  DAY, TOPUP_VALID_DAYS, PLAN_GRACE_DAYS, hasActivePlan, summarise, spend, spendPipeline, refundTo, settle, settleWallet,
  planGrantUpdate, topupGrantUpdate, record
};
