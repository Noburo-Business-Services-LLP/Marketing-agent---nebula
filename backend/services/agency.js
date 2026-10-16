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

const placeholderEmail = (id) => `ws-${id}@workspace.invalid`;

/** Resolve who to charge for `userId`: { payerId, workspaceId|null }. Reads the user once. */
async function resolvePayer(userId, { User = require('../models/User') } = {}) {
  const q = User.findById(userId).select('agency.ownerId');
  const me = await (q && typeof q.lean === 'function' ? q.lean() : q);
  if (!me) return { payerId: null, workspaceId: null };
  return isWorkspace(me)
    ? { payerId: idOf(me.agency.ownerId), workspaceId: idOf(userId) }
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
  const me = await User.findById(userId).select('credits.balance agency.ownerId').lean();
  if (!me) return 0;
  if (!isWorkspace(me)) return Math.max(0, num(me.credits && me.credits.balance));
  const payer = await User.findById(idOf(me.agency.ownerId)).select('credits.balance plan agency.ownerId isActive deletion.status subscription.status').lean();
  return payer && canPayForClients(payer) ? Math.max(0, num(payer.credits && payer.credits.balance)) : 0;
}

module.exports = { isAgency, isWorkspace, clientLimitOf, payerIdOf, workspacePlanFields, placeholderEmail, walletBalance, resolvePayer, canPayForClients, CLIENT_PAYER_FILTER, idOf };
