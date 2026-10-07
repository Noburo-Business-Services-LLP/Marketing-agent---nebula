/**
 * Add, re-role and remove team members. Every rule lives here and is tested with an in-memory
 * repository; the routes only wire in the database and the mailer. Nothing from the request is
 * trusted for who is acting: `actor` is the signed-in account loaded by the server.
 */
const { ROLES, roleOf, isStaff, can } = require('./permissions');
const { planRoleChange } = require('./roles');
const { isPaying } = require('./clientStatus');
const { grantableRoles, nameOf } = require('./team');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const refuse = (status, message) => ({ status, body: { success: false, message } });
const idOf = (v) => (v ? String(v._id || v.id || v) : '');

function member(u) {
  return { id: idOf(u), name: nameOf(u), email: u.email || '', role: roleOf(u) };
}

/** Everything here is for Owners and Admins; the table says who (add_csm). */
function mayManage(actor) {
  return isStaff(actor) && can(actor, 'add_csm');
}

/**
 * Adds a person to the team with a role. A new email gets a new staff account; an existing plain
 * account is converted (its sign-in is kept). Paying customers and switched-off accounts are refused.
 */
async function addMember({ actor, input = {}, repo, record, invite }) {
  if (!mayManage(actor)) return refuse(403, 'Your role cannot add team members.');
  const email = String(input.email || '').trim().toLowerCase();
  const firstName = String(input.firstName || '').trim();
  const lastName = String(input.lastName || '').trim();
  const role = input.role;
  if (!EMAIL.test(email)) return refuse(400, 'Enter a valid email address.');
  if (!firstName) return refuse(400, 'Enter their first name.');
  if (!ROLES.includes(role)) return refuse(400, 'Choose a role: Owner, Admin or CSM.');
  if (!grantableRoles(actor).includes(role)) return refuse(403, 'Only the Owner can add Admins and Owners.');

  const existing = await repo.findByEmail(email);
  if (existing && isStaff(existing)) return refuse(409, 'That person is already on the team. Change their role from the list.');
  if (existing && isPaying(existing)) return refuse(400, 'That email belongs to a paying client, so it cannot become a team account. Use a different email.');
  if (existing && existing.isActive === false) return refuse(400, 'That account is switched off. Switch it on first, or use a different email.');

  const plan = planRoleChange({ actor, target: existing || {}, newRole: role, ownerCount: await repo.countOwners() });
  if (!plan.ok) return refuse(403, plan.message);

  let user;
  if (existing) {
    const set = { ...plan.update, assignedCsm: null, isVerified: true };
    await repo.updateUser(existing._id, set);
    user = { ...existing, ...set };
  } else {
    user = await repo.createUser({ email, firstName, lastName, isVerified: true, companyName: 'Nebulaa', ...plan.update });
  }

  let emailed = false;
  try { emailed = Boolean(await invite({ email, firstName: existing && existing.firstName ? existing.firstName : firstName, role })); } catch (_) { emailed = false; }
  await record({ actor, action: 'team_add', client: user._id, details: { role, converted: Boolean(existing), emailed } });
  return { status: 200, body: { success: true, member: member(user), converted: Boolean(existing), emailed } };
}

/** Loads a team member for a change; customers and strangers are "not found". */
async function loadTeamTarget(actor, targetId, repo) {
  if (!mayManage(actor)) return { out: refuse(403, 'Your role cannot manage the team.') };
  const target = await repo.findById(targetId);
  if (!target || !isStaff(target)) return { out: refuse(404, 'That person is not on the team.') };
  if (idOf(target) === idOf(actor)) return { out: refuse(403, 'You cannot change your own role. Ask another Owner.') };
  return { target };
}

/** Changes a team member's role. Removing is a separate action (removeMember). */
async function changeRole({ actor, targetId, role, repo, record }) {
  const { out, target } = await loadTeamTarget(actor, targetId, repo);
  if (out) return out;
  if (typeof role !== 'string' || !ROLES.includes(role)) return refuse(400, 'Choose a role: Owner, Admin or CSM.');
  const from = roleOf(target);
  if (from === role) return refuse(400, 'That person already has this role.');
  const plan = planRoleChange({ actor, target, newRole: role, ownerCount: await repo.countOwners() });
  if (!plan.ok) return refuse(403, plan.message);
  await repo.updateUser(target._id, plan.update);
  const unassigned = from === 'csm' ? await repo.unassignClients(idOf(target)) : { count: 0, clients: [] };
  await record({ actor, action: 'role_change', client: target._id, details: { from, to: role, unassigned: unassigned.count } });
  return { status: 200, body: { success: true, member: member({ ...target, ...plan.update }), unassigned } };
}

/** Takes staff access away. The account stays (hidden from client numbers); a CSM's clients are unassigned and listed. */
async function removeMember({ actor, targetId, repo, record }) {
  const { out, target } = await loadTeamTarget(actor, targetId, repo);
  if (out) return out;
  const from = roleOf(target);
  const plan = planRoleChange({ actor, target, newRole: null, ownerCount: await repo.countOwners() });
  if (!plan.ok) return refuse(403, plan.message);
  await repo.updateUser(target._id, plan.update);
  const unassigned = from === 'csm' ? await repo.unassignClients(idOf(target)) : { count: 0, clients: [] };
  await record({ actor, action: 'team_remove', client: target._id, details: { from, unassigned: unassigned.count } });
  return { status: 200, body: { success: true, removed: true, unassigned } };
}

module.exports = { addMember, changeRole, removeMember };
