/**
 * Bulk actions on client accounts, and creating a managed client by hand (no payment gateway).
 * Every rule lives here and is tested with an in-memory repository; the routes only wire in the database,
 * the activity log and the mailer. Who is acting comes from the signed-in account, never from the request.
 */
const crypto = require('crypto');
const { can, isStaff, roleOf } = require('./permissions');
const { parseQuarkAmount, checkAssignment, isCustomer, MAX_QUARKS_PER_GRANT } = require('./clientActions');

const MAX_CLIENTS = 200;
const TIERS = ['managed', 'free', 'starter', 'professional'];
const ADDONS = ['publish', 'competitors', 'inbox', 'bundle'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Which permission each bulk action needs. The table in permissions.js decides who has it.
const OP_PERMISSION = {
  set_active: 'toggle_client',
  add_quarks: 'add_quarks',
  assign_csm: 'assign_csm',
  set_plan: 'set_plan',
  set_features: 'set_plan',
  set_billing: 'set_plan',
  set_hidden: 'hide_client'
};

const refuse = (status, message) => ({ status, body: { success: false, message } });
const idOf = (v) => (v ? String(v._id || v.id || v) : '');

/** Cleans the list of ids: unique, well-formed, at most 200. */
function parseIds(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const ids = Array.from(new Set(list.map((x) => String(x || '').trim()).filter((x) => OBJECT_ID.test(x))));
  if (ids.length === 0) return { ok: false, message: 'Choose at least one client.' };
  if (ids.length > MAX_CLIENTS) return { ok: false, message: `Choose at most ${MAX_CLIENTS} clients at a time.` };
  return { ok: true, ids };
}

/** Checks the action and what it needs; returns the database update for it. */
function parseOperation(input = {}) {
  const op = input.op;
  if (!Object.prototype.hasOwnProperty.call(OP_PERMISSION, op)) return { ok: false, message: 'Choose what to do with these clients.' };
  switch (op) {
    case 'set_active':
      if (typeof input.active !== 'boolean') return { ok: false, message: 'Say whether to switch the accounts on or off.' };
      return { ok: true, op, params: { active: input.active }, update: { $set: { isActive: input.active } } };
    case 'set_hidden':
      if (typeof input.hidden !== 'boolean') return { ok: false, message: 'Say whether to hide or show these clients.' };
      return { ok: true, op, params: { hidden: input.hidden }, update: { $set: { isHidden: input.hidden } } };
    case 'add_quarks': {
      const q = parseQuarkAmount(input.amount);
      if (!q.ok) return q;
      return {
        ok: true, op, params: { amount: q.amount },
        update: {
          $inc: { 'credits.balance': q.amount },
          $push: { 'credits.history': { action: 'staff_grant', amount: q.amount, description: `Nebulaa staff added ${q.amount} Quarks`, createdAt: new Date() } }
        }
      };
    }
    case 'assign_csm':
      return { ok: true, op, params: { csmId: input.csmId || null }, update: { $set: { assignedCsm: input.csmId || null } } };
    case 'set_plan':
      if (!TIERS.includes(input.tier)) return { ok: false, message: 'Choose a plan: Managed, Free, Starter or Professional.' };
      return { ok: true, op, params: { tier: input.tier }, update: { $set: { 'plan.tier': input.tier } } };
    case 'set_billing': {
      if (typeof input.paying !== 'boolean') return { ok: false, message: 'Say whether these clients are paying or not.' };
      const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
      const set = { 'plan.paidManually': input.paying };
      if (input.paying && note) set['plan.paidNote'] = note;
      const update = { $set: set };
      if (!input.paying) update.$unset = { 'plan.paidNote': '' };
      return { ok: true, op, params: { paying: input.paying, ...(note ? { note } : {}) }, update };
    }
    case 'set_features': {
      const addons = (Array.isArray(input.addons) ? input.addons : []).filter((a) => ADDONS.includes(a));
      if (addons.length === 0) return { ok: false, message: 'Choose at least one feature.' };
      if (input.mode !== 'add' && input.mode !== 'remove') return { ok: false, message: 'Say whether to add or remove the features.' };
      const update = input.mode === 'add' ? { $addToSet: { 'plan.addons': { $each: addons } } } : { $pull: { 'plan.addons': { $in: addons } } };
      return { ok: true, op, params: { mode: input.mode, addons }, update };
    }
    default:
      return { ok: false, message: 'Choose what to do with these clients.' };
  }
}

// A client with a live paid subscription is never moved back to Free by a bulk action.
const hasLivePaidSubscription = (c) => Boolean(c.subscription && c.subscription.status === 'active' && c.subscription.plan && c.subscription.plan !== 'free');

/**
 * Applies one action to many clients. Staff accounts and strangers are skipped, never changed.
 * repo: findCustomers(ids), findCsm(id), applyUpdate(ids, update). record: logs one row per client.
 */
async function bulkClients({ actor, input = {}, repo, record }) {
  if (!isStaff(actor)) return refuse(403, 'This area is for Nebulaa staff.');
  const parsed = parseOperation(input);
  if (!parsed.ok) return refuse(400, parsed.message);
  if (!can(actor, OP_PERMISSION[parsed.op])) return refuse(403, 'Your role cannot do this.');
  const idCheck = parseIds(input.ids);
  if (!idCheck.ok) return refuse(400, idCheck.message);

  if (parsed.op === 'assign_csm' && parsed.params.csmId) {
    const csm = (await repo.findCsm(parsed.params.csmId)) || undefined; // an unknown id is "not a CSM", never "clear it"
    const check = checkAssignment({ csm, client: { _id: 'x' } });
    if (!check.ok) return refuse(400, check.message);
  }

  const found = await repo.findCustomers(idCheck.ids);
  const byId = new Map(found.map((c) => [idOf(c), c]));
  const eligible = [];
  const skipped = [];
  for (const id of idCheck.ids) {
    const c = byId.get(id);
    if (!c || !isCustomer(c)) { skipped.push({ id, reason: 'Not a client account.' }); continue; }
    if (parsed.op === 'set_plan' && parsed.params.tier === 'free' && hasLivePaidSubscription(c)) { skipped.push({ id, reason: 'Has an active paid subscription.' }); continue; }
    eligible.push(id);
  }

  if (eligible.length > 0) {
    await repo.applyUpdate(eligible, parsed.update);
    const label = { set_active: parsed.params.active ? 'enable_client' : 'disable_client', set_hidden: parsed.params.hidden ? 'hide_client' : 'show_client', set_billing: parsed.params.paying ? 'mark_paying' : 'mark_not_paying' }[parsed.op] || `bulk_${parsed.op}`;
    for (const id of eligible) {
      try { await record({ actor, action: label, client: id, details: { bulk: true, op: parsed.op, ...parsed.params } }); } catch (_) { /* logging never undoes the change */ }
    }
  }
  return { status: 200, body: { success: true, updated: eligible.length, skipped } };
}

/** A password nobody knows: the client sets their own with "Forgot password". Meets the sign-up rules (a letter and a number). */
function unknownPassword() {
  return `${crypto.randomBytes(18).toString('base64url')}aZ9`;
}

/**
 * Creates a client account by hand, on the Managed plan by default, so no payment is needed. A client
 * that already exists is never overwritten: the answer says so and carries its id, to activate it from the list.
 * repo: findByEmail, findByEmailKey, findCsm, createUser. invite: sends the welcome email.
 */
async function createClient({ actor, input = {}, repo, record, invite, canonicalEmail }) {
  if (!isStaff(actor) || !can(actor, 'create_client')) return refuse(403, 'Your role cannot do this.');
  const email = String(input.email || '').trim().toLowerCase();
  const firstName = String(input.firstName || '').trim().slice(0, 50);
  const lastName = String(input.lastName || '').trim().slice(0, 50);
  const companyName = String(input.companyName || '').trim().slice(0, 100);
  const tier = input.tier === undefined || input.tier === '' ? 'managed' : input.tier;
  if (!EMAIL.test(email)) return refuse(400, 'Enter a valid email address.');
  if (!firstName) return refuse(400, 'Enter their first name.');
  if (!TIERS.includes(tier)) return refuse(400, 'Choose a plan: Managed, Free, Starter or Professional.');

  let quarks = null;
  if (input.quarks !== undefined && input.quarks !== null && input.quarks !== '') {
    if (roleOf(actor) !== 'owner') return refuse(403, 'Only the Owner can set the starting Quarks.');
    const n = Number(input.quarks);
    if (!Number.isInteger(n) || n < 0 || n > MAX_QUARKS_PER_GRANT) return refuse(400, `Starting Quarks must be a whole number from 0 to ${MAX_QUARKS_PER_GRANT.toLocaleString('en-IN')}.`);
    quarks = n;
  }

  let csmId = null;
  if (input.csmId) {
    const csm = (await repo.findCsm(input.csmId)) || undefined;
    const check = checkAssignment({ csm, client: { _id: 'x' } });
    if (!check.ok) return refuse(400, check.message);
    csmId = idOf(csm);
  }

  const existing = await repo.findByEmail(email);
  const alias = existing ? null : await repo.findByEmailKey(canonicalEmail ? canonicalEmail(email) : email);
  const clash = existing || alias;
  if (clash) {
    return { status: 409, body: { success: false, message: 'An account with this email already exists. Find it in the client list and use "Set plan" to activate it as Managed.', existingId: isCustomer(clash) ? idOf(clash) : null } };
  }

  const doc = {
    email, emailKey: canonicalEmail ? canonicalEmail(email) : email, password: unknownPassword(),
    firstName, lastName, companyName, isVerified: true, isActive: true, onboardingCompleted: false,
    plan: { tier, ...(input.paying === true ? { paidManually: true } : {}) }, assignedCsm: csmId
  };
  if (quarks !== null) doc.credits = { balance: quarks, totalUsed: 0 };
  const user = await repo.createUser(doc);
  let emailed = false;
  try { emailed = Boolean(await invite({ email, firstName })); } catch (_) { emailed = false; }
  await record({ actor, action: 'create_client', client: idOf(user), details: { tier, csm: csmId, startingQuarks: quarks, emailed } });
  return { status: 201, body: { success: true, client: { id: idOf(user), email, name: [firstName, lastName].filter(Boolean).join(' '), tier }, emailed } };
}

module.exports = { bulkClients, createClient, parseOperation, parseIds, OP_PERMISSION, TIERS, ADDONS, MAX_CLIENTS };
