/**
 * CSM access: a customer success manager (a normal user marked isCsm) can open the accounts of
 * clients assigned to them without the client's password. Opening issues a short-lived token
 * for the client that also names the CSM ("acting"). Every request with such a token re-checks
 * that the CSM still exists, is still a CSM and is still assigned to that client.
 */
const jwt = require('jsonwebtoken');
const { normalisePath } = require('./requestPath');

const ACTING_TOKEN_HOURS = 8;

// Money, plan and identity changes stay with the client themselves.
const BLOCKED_WHILE_ACTING = [
  /^\/api\/payment(\/|$)/,
  /^\/api\/auth\/change-password/,
  /^\/api\/auth\/(delete|deactivate)/,
  /^\/api\/users?\/(me\/)?delete/,
  /^\/api\/csm(\/|$)/,
  // The customer's own privacy choices (undo a deletion, accept the Terms, export) are never made by staff for them.
  /^\/api\/account(\/|$)/
];
// The one thing staff may still read under /api/account: whether the account is set to be deleted.
const ALLOWED_WHILE_ACTING = (path, method) => String(method || 'GET').toUpperCase() === 'GET' && path === '/api/account/status';

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

function isBlockedWhileActing(url, method = 'GET') {
  const path = normalisePath(url);
  if (path === null) return true; // an unreadable path is never allowed through
  if (ALLOWED_WHILE_ACTING(path, method)) return false;
  return BLOCKED_WHILE_ACTING.some((re) => re.test(path));
}

function issueActingToken({ clientId, csmId, secret = process.env.JWT_SECRET }) {
  return jwt.sign({ id: idOf(clientId), actingCsm: idOf(csmId) }, secret, { expiresIn: `${ACTING_TOKEN_HOURS}h` });
}

module.exports = { canActFor, isBlockedWhileActing, issueActingToken, ACTING_TOKEN_HOURS, idOf };
