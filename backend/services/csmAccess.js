/**
 * CSM access: a customer success manager (a normal user marked isCsm) can open the accounts of
 * clients assigned to them without the client's password. Opening issues a short-lived token
 * for the client that also names the CSM ("acting"). Every request with such a token re-checks
 * that the CSM still exists, is still a CSM and is still assigned to that client.
 */
const jwt = require('jsonwebtoken');

const ACTING_TOKEN_HOURS = 8;

// Money, plan and identity changes stay with the client themselves.
const BLOCKED_WHILE_ACTING = [
  /^\/api\/payment(\/|$)/,
  /^\/api\/auth\/change-password/,
  /^\/api\/auth\/(delete|deactivate)/,
  /^\/api\/users?\/(me\/)?delete/,
  /^\/api\/csm(\/|$)/
];

function idOf(value) {
  if (!value) return '';
  return String(value._id || value.id || value);
}

function canActFor(staff, client) {
  if (!staff || !client || staff.isActive === false) return false;
  if (client.staffRole || client.isCsm) return false; // staff accounts are never opened this way
  // The permission table decides: Owners and Admins may open any client, a CSM only their own.
  return require('./staff/permissions').can(staff, 'open_client', client);
}

function isBlockedWhileActing(url) {
  const path = String(url || '').split('?')[0];
  return BLOCKED_WHILE_ACTING.some((re) => re.test(path));
}

function issueActingToken({ clientId, csmId, secret = process.env.JWT_SECRET }) {
  return jwt.sign({ id: idOf(clientId), actingCsm: idOf(csmId) }, secret, { expiresIn: `${ACTING_TOKEN_HOURS}h` });
}

module.exports = { canActFor, isBlockedWhileActing, issueActingToken, ACTING_TOKEN_HOURS, idOf };

// Resetting wipes a person's business profile, so it is only allowed for staff accounts and only
// when the admin typed the account's own email to confirm.
function canResetStaffAccount(user, confirmEmail) {
  if (!user || !user.isCsm) return { ok: false, message: 'Only CSM accounts can be reset. Mark the account as a CSM first.' };
  if (String(confirmEmail || '').trim().toLowerCase() !== String(user.email || '').trim().toLowerCase()) {
    return { ok: false, message: 'Type the account email exactly to confirm.' };
  }
  return { ok: true };
}

module.exports.canResetStaffAccount = canResetStaffAccount;

// After switching to a different Ayrshare account, stored profile ids belong to the old one and
// would be refused. Clearing them makes the app create a fresh profile on the new account the
// next time each customer connects. Only the Ayrshare fields are touched.
const AYRSHARE_RESET = {
  filter: { 'ayrshare.profileKey': { $exists: true, $nin: ['', null] } },
  update: { $set: { 'ayrshare.profileKey': '', 'ayrshare.refId': '', 'ayrshare.title': '', 'ayrshare.activeSocialAccounts': [], 'ayrshare.displayNames': [], 'ayrshare.lastCheckedAt': null } }
};

module.exports.AYRSHARE_RESET = AYRSHARE_RESET;
module.exports.confirmsAyrshareReset = (text) => String(text || '').trim() === 'RESET';
