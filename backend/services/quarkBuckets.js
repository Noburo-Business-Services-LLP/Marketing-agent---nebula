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
 * client workspace. The agency must be able to pay (see CLIENT_PAYER_FILTER), checked in the same atomic update, and the client must not be frozen.
 * The ledger row sits on the payer and names the client in `workspace`. Nothing is ever charged to the client record.
 * The result also names who paid (`payerId`, `workspaceId`) so a later refund can go to the same wallet.
 */
async function spend(userId, cost, { action = 'spend', description = '', ref = '', units = 1 } = {}) {
  const amount = num(cost);
  if (amount <= 0) return { success: true, balance: null, spent: 0 };
  const agencyRules = require('./agency');
  const { payerId, workspaceId, frozen } = await agencyRules.resolvePayer(userId);
  if (!payerId) return { success: false, balance: null, spent: 0 }; // never charge a record we cannot place
  // A frozen client (over the agency's limit) cannot spend or reserve the shared pool by any path, pass or no pass:
  // scheduled jobs, automatic replies and queued work are refused like a balance that is too low. Refunds are not blocked.
  if (workspaceId && frozen) return { success: false, balance: null, spent: 0, frozen: true };
  // `ref` is written in the same atomic update as the debit: the proof of the charge that crash recovery reads when the
  // ledger row (written after, and allowed to fail) is missing. See chargeProof.
  const entry = { action, amount: -amount, description: description || action, createdAt: new Date(), ...(ref ? { ref: String(ref) } : {}) };
  const filter = { _id: workspaceId ? payerId : userId, 'credits.balance': { $gte: amount } };
  if (workspaceId) Object.assign(filter, agencyRules.CLIENT_PAYER_FILTER);
  const doc = await User.findOneAndUpdate(filter, spendPipeline(amount, entry), { new: true });
  if (!doc) return { success: false, balance: null, spent: 0 };
  await record({ user: workspaceId ? payerId : userId, workspace: workspaceId || undefined, type: 'spend', quarks: -amount, balanceAfter: doc.credits.balance, action, ref });
  forgetSummary(workspaceId ? payerId : userId, workspaceId);
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
  // The history entry (with `ref`) lands in the same update as the credit: the proof that this refund happened even when
  // the ledger row below cannot be written, so a retry never pays twice (see chargeProof).
  const entry = { action, amount, description: action, createdAt: new Date(), ...(ref ? { ref: String(ref) } : {}) };
  const out = await User.updateOne({ _id: target }, { $inc: { 'credits.balance': amount, 'credits.totalUsed': -amount }, $push: { 'credits.history': { $each: [entry], $slice: -100 } } });
  if (out && out.modifiedCount === 0) return { ok: false, payerId: null };
  await record({ user: target, workspace: workspaceId || undefined, type: 'refund', quarks: amount, action, ref: ref || undefined });
  forgetSummary(target, workspaceId);
  return { ok: true, payerId: String(target) };
}

/** The Home summary shows the balance: forget the cached answer of the wallet (and the client) whose balance moved. */
function forgetSummary(...ids) {
  try {
    const cache = require('./homeSummaryCache').sharedCache();
    for (const id of ids) if (id) cache.invalidate(String(id));
  } catch (_) { /* the cache never breaks a payment */ }
}

/**
 * Did the charge with this `ref` land, and was it refunded? The Quark ledger row is read first; when it is missing (it
 * is written after the debit and a failed write is only logged), the credits.history entry written in the same atomic
 * update as the debit decides. History is searched on the account itself, the recorded payer and its current payer
 * (the agency pool for a client). Returns { spend: { payer, workspace, quarks, source } | null, refunded }.
 * Throws when the lookup itself fails, so a caller can leave the money question open instead of guessing.
 */
async function chargeProof(ref, { userId = '', payerId = '' } = {}) {
  const r = String(ref || '');
  if (!r) return { spend: null, refunded: false };
  const pick = (q) => (q && typeof q.lean === 'function' ? q.lean() : q);
  const sel = (q) => (q && typeof q.select === 'function' ? q.select('user workspace quarks') : q);
  const [spentRow, refundRow] = await Promise.all([pick(sel(QuarkLedger.findOne({ type: 'spend', ref: r }))), pick(sel(QuarkLedger.findOne({ type: 'refund', ref: r })))]);
  let spend = spentRow ? { payer: String(spentRow.user), workspace: spentRow.workspace ? String(spentRow.workspace) : '', quarks: Math.abs(num(spentRow.quarks)), source: 'ledger' } : null;
  let refunded = Boolean(refundRow);
  if (spend && refunded) return { spend, refunded };
  const ids = new Set([userId, payerId].filter(Boolean).map(String));
  if (userId) {
    const p = await require('./agency').resolvePayer(userId);
    if (p && p.payerId) ids.add(String(p.payerId));
  }
  if (!ids.size) return { spend, refunded };
  const q = User.find({ _id: { $in: [...ids] }, 'credits.history.ref': r });
  const docs = (await pick(q && typeof q.select === 'function' ? q.select('_id credits.history') : q)) || [];
  for (const d of docs) {
    for (const h of (d.credits && d.credits.history) || []) {
      if (!h || h.ref !== r) continue;
      if (num(h.amount) < 0 && !spend) {
        const payer = String(d._id);
        spend = { payer, workspace: userId && payer !== String(userId) ? String(userId) : '', quarks: -num(h.amount), source: 'history' };
      }
      if (num(h.amount) > 0) refunded = true;
    }
  }
  return { spend, refunded };
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
function topupGrantUpdate(quarks, { now = new Date(), keepExpiry = false } = {}) {
  return {
    // keepExpiry: the Quarks join a bucket that is already counting down, so its end date is left alone.
    set: keepExpiry ? {} : { 'credits.topupExpiresAt': new Date(now.getTime() + TOPUP_VALID_DAYS * DAY) },
    inc: { 'credits.balance': quarks, 'credits.topupBalance': quarks }
  };
}

/** True when the top-up bucket holds Quarks that are still valid (so its end date should not move). */
function topupIsLive(topup, now = new Date()) {
  if (!topup || !(num(topup.balance) > 0) || !topup.expiresAt) return false;
  return new Date(topup.expiresAt) > now;
}

module.exports = {
  DAY, TOPUP_VALID_DAYS, PLAN_GRACE_DAYS, hasActivePlan, summarise, spend, spendPipeline, refundTo, settle, settleWallet,
  planGrantUpdate, topupGrantUpdate, topupIsLive, record, chargeProof, forgetSummary
};
