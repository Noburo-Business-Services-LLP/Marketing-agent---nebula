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

function isCustomer(u) {
  return Boolean(u) && !u.staffRole && !u.isCsm;
}

/** Who may be set as a client's CSM, and on whom. `csm` null clears the assignment. */
function checkAssignment({ csm, client }) {
  if (!isCustomer(client)) return { ok: false, message: 'Only client accounts can be assigned to a CSM.' };
  if (csm === null) return { ok: true };
  if (!csm || roleOf(csm) !== 'csm') return { ok: false, message: 'That person is not a CSM.' };
  if (csm.isActive === false) return { ok: false, message: 'That CSM account is switched off.' };
  return { ok: true };
}

module.exports = { parseQuarkAmount, checkAssignment, isCustomer, MAX_QUARKS_PER_GRANT };
