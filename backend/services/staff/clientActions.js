/** Checks for the actions staff can take on a client. Pure, so the rules are tested without a database. */
const { roleOf } = require('./permissions');

const MAX_QUARKS_PER_GRANT = 100000;

/** A whole number of Quarks between 1 and 100,000; anything else is refused with a plain message. */
function parseQuarkAmount(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return { ok: false, message: 'Enter a whole number of Quarks, 1 or more.' };
  if (n > MAX_QUARKS_PER_GRANT) return { ok: false, message: `One grant can be at most ${MAX_QUARKS_PER_GRANT.toLocaleString('en-IN')} Quarks.` };
  return { ok: true, amount: n };
}

// A customer is a real account. A hidden client workspace of an agency is not one: staff cannot add Quarks to it,
// assign a CSM to it or open it (its Quarks live on the agency account).
function isCustomer(u) {
  return Boolean(u) && !u.staffRole && !u.isCsm && !(u.agency && u.agency.ownerId);
}

/** Why staff cannot open this account right now, in plain words, or null when they can. */
function openProblem(client) {
  if (!client) return 'That client was not found.';
  if (client.isActive === false) return 'This account is switched off. Switch it on first.';
  if (client.deletion && client.deletion.status === 'pending') return 'This account has a deletion request waiting. It cannot be opened while the customer is deciding.';
  return null;
}

/** Who may be set as a client's CSM, and on whom. `csm` null clears the assignment. */
function checkAssignment({ csm, client }) {
  if (!isCustomer(client)) return { ok: false, message: 'Only client accounts can be assigned to a CSM.' };
  if (csm === null) return { ok: true };
  if (!csm || roleOf(csm) !== 'csm') return { ok: false, message: 'That person is not a CSM.' };
  if (csm.isActive === false) return { ok: false, message: 'That CSM account is switched off.' };
  return { ok: true };
}

module.exports = { parseQuarkAmount, checkAssignment, isCustomer, openProblem, MAX_QUARKS_PER_GRANT };
