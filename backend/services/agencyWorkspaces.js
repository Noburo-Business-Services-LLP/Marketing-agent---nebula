// backend/services/agencyWorkspaces.js
'use strict';
/** Client workspaces for the agency plan: make, list, rename, keep in step with the agency's plan, and stay within the limit. */
const crypto = require('crypto');
const { AGENCY } = require('../config/apiCosts');
const ag = require('./agency');

const MAX_NAME = 80;
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** One atomic step: take a slot only while the agency is below its limit. Returns the updated agency or null. */
function claimSlot(User, ownerId) {
  return User.findOneAndUpdate(
    {
      _id: ownerId,
      'plan.tier': 'agency',
      $expr: { $lt: [{ $ifNull: ['$agency.clientCount', 0] }, { $min: [AGENCY.maxClients, { $add: [AGENCY.includedClients, { $ifNull: ['$agency.extraSlots', 0] }] }] }] }
    },
    { $inc: { 'agency.clientCount': 1 } },
    { new: true }
  );
}
const releaseSlot = (User, ownerId) => User.updateOne({ _id: ownerId }, { $inc: { 'agency.clientCount': -1 } });

async function createWorkspace({ owner, name, industry = '', website = '', models, randomId = () => crypto.randomBytes(8).toString('hex') }) {
  const { User } = models;
  const clean = cleanName(name);
  if (!ag.isAgency(owner)) return { ok: false, message: 'Client brands are part of the Agency plan.' };
  if (clean.length < 2) return { ok: false, message: 'Please enter the client\'s business name.' };
  const claimed = await claimSlot(User, owner._id);
  if (!claimed) {
    const limit = ag.clientLimitOf(owner);
    return { ok: false, message: `Your plan includes ${limit} clients and all of them are in use. Add a client slot to add more.` };
  }
  try {
    const id = randomId();
    const planFields = ag.workspacePlanFields(owner);
    const workspace = await User.create({
      email: ag.placeholderEmail(id),
      password: crypto.randomBytes(32).toString('hex'),
      firstName: clean, lastName: '', companyName: clean,
      isVerified: true, onboardingCompleted: true,
      businessProfile: { name: clean, industry: String(industry || '').slice(0, 80), website: String(website || '').slice(0, 200) },
      agency: { ownerId: owner._id, workspaceName: clean },
      plan: { tier: planFields['plan.tier'], addons: planFields['plan.addons'] }
    });
    return { ok: true, workspace };
  } catch (e) {
    await releaseSlot(User, owner._id); // never leave a slot used by a client that was not made
    throw e;
  }
}

async function listWorkspaces({ owner, models }) {
  const rows = await models.User.find({ 'agency.ownerId': owner._id }).sort({ createdAt: 1 }).lean();
  return rows.map((r) => ({ id: String(r._id), name: (r.agency && r.agency.workspaceName) || r.companyName || '', createdAt: r.createdAt, frozen: !!(r.agency && r.agency.frozen) }));
}

async function renameWorkspace({ owner, workspaceId, name, models }) {
  const clean = cleanName(name);
  if (clean.length < 2) return { ok: false, message: 'Please enter the client\'s business name.' };
  const own = (await listWorkspaces({ owner, models })).find((w) => w.id === String(workspaceId));
  if (!own) return { ok: false, message: 'That client was not found.' };
  await models.User.updateOne({ _id: workspaceId }, { $set: { 'agency.workspaceName': clean, companyName: clean, firstName: clean, 'businessProfile.name': clean } });
  return { ok: true };
}

/** Copy the agency's plan to every client, and freeze (never delete) clients above the limit, oldest kept first. */
async function syncWorkspacePlans({ owner, models }) {
  const { User } = models;
  const rows = await User.find({ 'agency.ownerId': owner._id }).sort({ createdAt: 1 }).lean();
  await User.updateMany({ 'agency.ownerId': owner._id }, { $set: ag.workspacePlanFields(owner) });
  const limit = ag.clientLimitOf(owner);
  let n = 0;
  for (const [i, r] of rows.entries()) {
    const frozen = i >= limit;
    if (frozen !== !!(r.agency && r.agency.frozen)) await User.updateOne({ _id: r._id }, { $set: { 'agency.frozen': frozen } });
    n += 1;
  }
  return n;
}

module.exports = { claimSlot, releaseSlot, createWorkspace, listWorkspaces, renameWorkspace, syncWorkspacePlans, cleanName };
