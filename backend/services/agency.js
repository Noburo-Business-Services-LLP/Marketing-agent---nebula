'use strict';
/**
 * Agency rules with no database of their own: who is an agency, who is a client workspace, how many clients are
 * allowed, and who pays. A client workspace is a hidden User record owned by the agency.
 */
const { AGENCY } = require('../config/apiCosts');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const idOf = (v) => (v ? String(v._id || v.id || v) : '');

const isAgency = (u) => !!(u && u.plan && u.plan.tier === 'agency');
const isWorkspace = (u) => !!(u && u.agency && u.agency.ownerId);

function clientLimitOf(owner) {
  if (!isAgency(owner)) return 0;
  return Math.min(AGENCY.maxClients, AGENCY.includedClients + Math.max(0, num(owner.agency && owner.agency.extraSlots)));
}

/** The account whose Quarks are spent: the agency for a client workspace, the user themselves otherwise. */
const payerIdOf = (u) => (isWorkspace(u) ? idOf(u.agency.ownerId) : idOf(u));

/** What a workspace mirrors from its agency so plan and add-on checks need no special case. */
function workspacePlanFields(owner) {
  return { 'plan.tier': isAgency(owner) ? 'agency' : 'free', 'plan.addons': [] };
}

const placeholderEmail = (id) => `ws-${id}@workspace.invalid`;

/** Quarks available to this user: the payer's balance. 0 if the payer cannot be found. */
async function walletBalance(userId, { User = require('../models/User') } = {}) {
  const me = await User.findById(userId).select('credits.balance agency.ownerId').lean();
  if (!me) return 0;
  if (!isWorkspace(me)) return Math.max(0, num(me.credits && me.credits.balance));
  const payer = await User.findById(idOf(me.agency.ownerId)).select('credits.balance').lean();
  return payer ? Math.max(0, num(payer.credits && payer.credits.balance)) : 0;
}

module.exports = { isAgency, isWorkspace, clientLimitOf, payerIdOf, workspacePlanFields, placeholderEmail, walletBalance, idOf };
