// backend/services/agencyWorkspaces.js
'use strict';
/** Client workspaces for the agency plan: make, list, rename, keep in step with the agency's plan, and stay within the limit. */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
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
      isVerified: true, onboardingCompleted: true, initialCampaignsGenerated: true, isHidden: true, // no free first batch: the agency's pool pays
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

const WORKSPACE_BUSY = 'Wait until this client\'s videos and jobs finish, then try again.';
const MAX_PUBLISH_ATTEMPTS = () => Number(process.env.CAMPAIGN_MAX_PUBLISH_ATTEMPTS || 3);
const RUNNING = ['queued', 'processing'];

/**
 * Work for this client that is still running, as plain names ([] when idle). A client is not removed while any of this runs:
 * the Quarks for a job that fails are refunded to the agency, and that refund has nowhere to go once the client is gone.
 * Every collection that holds a charged job is read here (video jobs in the queue, Hero videos, Blueprints and their designed
 * decks, studio videos, pictures and carousels being made, posts being published). `now` is in ms.
 */
async function runningWork(workspaceId, models, now = Date.now()) {
  const id = String(workspaceId);
  const checks = [
    ['AI video jobs', 'VideoJob', { userId: id, status: { $in: RUNNING } }],
    ['Hero videos', 'HeroVideoJob', { userId: id, status: { $in: RUNNING } }],
    ['Blueprints', 'Blueprint', { userId: id, $or: [{ status: { $in: RUNNING } }, { 'designed.status': { $in: RUNNING } }] }],
    ['studio videos', 'StudioVideo', { user: id, status: 'processing' }],
    ['pictures and carousels', 'Draft', { userId: id, status: 'processing' }],
    // The scheduler has no "publishing" state of its own: a scheduled post that is due now, or within two minutes, is being published.
    ['posts going out', 'Campaign', {
      userId: id, status: 'scheduled', 'scheduling.startDate': { $lte: new Date(now + 2 * 60 * 1000) }, publishAutoCancelled: { $ne: true },
      $or: [{ publishFailureCount: { $lt: MAX_PUBLISH_ATTEMPTS() } }, { publishFailureCount: { $exists: false } }]
    }],
    ['posts being sent', 'SocialPostAttempt', { userId: id, status: 'queued', createdAt: { $gte: new Date(now - 30 * 60 * 1000) } }]
  ];
  const busy = [];
  for (const [label, model, filter] of checks) {
    const Model = models[model];
    if (!Model) throw new Error(`Cannot check running work: model ${model} is missing`);
    if (await Model.exists(filter)) busy.push(label);
  }
  return busy;
}

/**
 * Erase a client and everything it holds, at once, after the agency has confirmed. `purge(workspaceId)` runs the standard
 * erase steps. Refused while the client has running work. The client is paused first and checked second, so a job cannot
 * start in between; if the check fails the client is put back as it was. A client that could not be fully erased stays in
 * place (still paused) so removing it can be tried again.
 */
async function removeWorkspace({ owner, workspaceId, models, purge, isBusy }) {
  const mine = (await listWorkspaces({ owner, models })).find((c) => c.id === String(workspaceId));
  if (!mine) return { ok: false, message: 'That client was not found.' };
  const pause = (frozen) => models.User.updateOne({ _id: mine.id, 'agency.ownerId': owner._id }, { $set: { 'agency.frozen': frozen } });
  await pause(true);
  let busy;
  try { busy = await (isBusy ? isBusy(mine.id) : runningWork(mine.id, models)); }
  catch (e) { await pause(mine.frozen); throw e; }
  if (busy && busy.length) { await pause(mine.frozen); return { ok: false, busy: true, running: busy, message: WORKSPACE_BUSY }; }
  const out = await purge(mine.id);
  if (!out || out.ok === false) return { ok: false, message: 'We could not finish removing this client. Nothing else was changed. Please try again.' };
  await releaseSlot(models.User, owner._id);
  return { ok: true };
}

const PASS_HOURS = 8;
/** The short-lived pass an agency uses to work inside one client. Names the client and the agency. */
function issueAgencyPass({ workspaceId, ownerId, secret = process.env.JWT_SECRET }) {
  return jwt.sign({ id: ag.idOf(workspaceId), actingAgency: ag.idOf(ownerId) }, secret, { expiresIn: `${PASS_HOURS}h` });
}

// Money, plan and identity changes, and client management, stay with the agency account itself.
const BLOCKED_INSIDE_CLIENT = [
  /^\/api\/payment(\/|$)/,
  /^\/api\/auth\/change-password/,
  /^\/api\/auth\/(delete|deactivate)/,
  /^\/api\/users?\/(me\/)?delete/,
  /^\/api\/account\/(deletion|export)/
];
function isBlockedInsideClient(url, method = 'GET') {
  let path = String(url || '').split('?')[0].split('#')[0];
  try { path = decodeURIComponent(path); } catch (_) { return true; } // an undecodable path is never allowed through
  path = path.toLowerCase(); // the router ignores case, so this check must too
  if (BLOCKED_INSIDE_CLIENT.some((re) => re.test(path))) return true;
  // The client list may be read, and another client opened, from inside a client; nothing else under /api/agency.
  if (/^\/api\/agency(\/|$)/.test(path)) return !(String(method).toUpperCase() === 'GET' && path === '/api/agency/clients') && !/^\/api\/agency\/clients\/[^/]+\/open$/.test(path);
  return false;
}

module.exports = { WORKSPACE_BUSY, runningWork, removeWorkspace, issueAgencyPass, BLOCKED_INSIDE_CLIENT, isBlockedInsideClient, PASS_HOURS, claimSlot, releaseSlot, createWorkspace, listWorkspaces, renameWorkspace, syncWorkspacePlans, cleanName };
