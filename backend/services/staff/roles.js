const { ROLES, roleOf } = require('./permissions');

function canBootstrapOwner(ownerCount) {
  return Number(ownerCount) === 0;
}

/**
 * Works out the change to a person's staff role, or why it is not allowed. Pure.
 * newRole: 'owner' | 'admin' | 'csm' | null (null removes the role).
 */
function planRoleChange({ actor, target, newRole, ownerCount }) {
  const actorRole = roleOf(actor);
  const currentRole = roleOf(target);
  if (newRole !== null && !ROLES.includes(newRole)) return { ok: false, message: 'That role does not exist.' };
  if (actorRole !== 'owner' && actorRole !== 'admin') return { ok: false, message: 'Your role cannot change roles.' };

  const touchesSenior = ['owner', 'admin'].includes(newRole) || ['owner', 'admin'].includes(currentRole);
  if (touchesSenior && actorRole !== 'owner') return { ok: false, message: 'Only the Owner can add or remove Admins and Owners.' };

  if (currentRole === 'owner' && newRole !== 'owner' && Number(ownerCount) <= 1) {
    return { ok: false, message: 'The last Owner cannot be removed or changed. Add another Owner first.' };
  }

  if (newRole === null) return { ok: true, update: { staffRole: null, isCsm: false } };
  return { ok: true, update: { staffRole: newRole, isCsm: newRole === 'csm', isHidden: true, onboardingCompleted: true } };
}

module.exports = { planRoleChange, canBootstrapOwner };
