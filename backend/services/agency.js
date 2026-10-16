'use strict';
/**
 * Agency rules with no database of their own: who is an agency, who is a client workspace, how many clients are
 * allowed, and who pays. A client workspace is a hidden User record owned by the agency.
 */
const { AGENCY } = require('../config/apiCosts');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const idOf = (v) => (v ? String(v._id || v.id || v) : '');

const isWorkspace = (u) => !!(u && u.agency && u.agency.ownerId);
// A client workspace mirrors tier 'agency' from its owner, but it is not itself an agency and cannot own clients.
const isAgency = (u) => !!(u && u.plan && u.plan.tier === 'agency') && !isWorkspace(u);

/** Paid extra client slots: a whole number >= 0; negative, fractional-below-1, non-finite and non-numeric values give 0. */
const slotsOf = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function clientLimitOf(owner) {
  if (!isAgency(owner)) return 0;
  return Math.min(AGENCY.maxClients, AGENCY.includedClients + slotsOf(owner.agency && owner.agency.extraSlots));
}

/** The account whose Quarks are spent: the agency for a client workspace, the user themselves otherwise. */
const payerIdOf = (u) => (isWorkspace(u) ? idOf(u.agency.ownerId) : idOf(u));

/** What a workspace mirrors from its agency so plan and add-on checks need no special case. */
function workspacePlanFields(owner) {
  return { 'plan.tier': isAgency(owner) ? 'agency' : 'free', 'plan.addons': [] };
}

/** Added to any query over customers so a hidden client workspace is never counted or treated as an independent customer. */
const NOT_A_WORKSPACE = Object.freeze({ 'agency.ownerId': null });

const placeholderEmail = (id) => `ws-${id}@workspace.invalid`;

/** Resolve who to charge for `userId`: { payerId, workspaceId|null }. Reads the user once. */
async function resolvePayer(userId, { User = require('../models/User') } = {}) {
  const q = User.findById(userId).select('agency.ownerId agency.frozen');
  const me = await (q && typeof q.lean === 'function' ? q.lean() : q);
  if (!me) return { payerId: null, workspaceId: null };
  // `frozen` is present (true) only for a client over the limit; the shape is otherwise unchanged.
  return isWorkspace(me)
    ? { payerId: idOf(me.agency.ownerId), workspaceId: idOf(userId), ...(me.agency.frozen ? { frozen: true } : {}) }
    : { payerId: idOf(userId), workspaceId: null };
}

/**
 * An agency that may pay for its clients: on the agency plan (not itself a client), an active account, not being
 * deleted and not halted. The same test as the pass check in middleware/auth.js, so a client cannot spend while its pass would be refused.
 */
const canPayForClients = (owner) =>
  !!owner && isAgency(owner) && owner.isActive !== false &&
  !(owner.deletion && owner.deletion.status === 'pending') &&
  !(owner.subscription && owner.subscription.status === 'halted');

/** The same test as a MongoDB filter, so a spend checks it in the one atomic update. */
const CLIENT_PAYER_FILTER = Object.freeze({
  'plan.tier': 'agency',
  'agency.ownerId': null,
  isActive: { $ne: false },
  'deletion.status': { $ne: 'pending' },
  'subscription.status': { $ne: 'halted' }
});

/** Quarks available to this user: the payer's balance. 0 if the payer cannot be found or a client's agency cannot pay. */
async function walletBalance(userId, { User = require('../models/User') } = {}) {
  const me = await User.findById(userId).select('credits.balance agency.ownerId agency.frozen').lean();
  if (!me) return 0;
  if (!isWorkspace(me)) return Math.max(0, num(me.credits && me.credits.balance));
  if (me.agency.frozen) return 0; // a frozen client (over the limit) has no Quarks to use until the agency has a place for it
  const payer = await User.findById(idOf(me.agency.ownerId)).select('credits.balance plan agency.ownerId isActive deletion.status subscription.status').lean();
  return payer && canPayForClients(payer) ? Math.max(0, num(payer.credits && payer.credits.balance)) : 0;
}

/**
 * What a client workspace's own `credits` field shows on a profile response: the agency pool's balance and total used
 * (0 when the agency cannot pay), and nothing else, so the agency's history is never exposed. null for any other account.
 */
async function publicCredits(user, { User = require('../models/User') } = {}) {
  if (!isWorkspace(user)) return null;
  if (user.agency.frozen) return { balance: 0, totalUsed: 0 };
  const payer = await User.findById(idOf(user.agency.ownerId)).select('credits.balance credits.totalUsed plan agency.ownerId isActive deletion.status subscription.status').lean();
  if (!payer || !canPayForClients(payer)) return { balance: 0, totalUsed: 0 };
  return { balance: Math.max(0, num(payer.credits && payer.credits.balance)), totalUsed: Math.max(0, num(payer.credits && payer.credits.totalUsed)) };
}

/** The free first campaign batch is for a person's own first run. A client's work is paid from the agency's shared pool. */
const freeFirstBatch = (u) => !isWorkspace(u) && !(u && u.initialCampaignsGenerated);

module.exports = { NOT_A_WORKSPACE, publicCredits, freeFirstBatch, isAgency, isWorkspace, clientLimitOf, payerIdOf, workspacePlanFields, placeholderEmail, walletBalance, resolvePayer, canPayForClients, CLIENT_PAYER_FILTER, idOf };
