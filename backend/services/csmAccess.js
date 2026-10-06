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

function canActFor(csm, client) {
  if (!csm || !client) return false;
  if (!csm.isCsm || csm.isActive === false) return false;
  return idOf(client.assignedCsm) !== '' && idOf(client.assignedCsm) === idOf(csm);
}

function isBlockedWhileActing(url) {
  const path = String(url || '').split('?')[0];
  return BLOCKED_WHILE_ACTING.some((re) => re.test(path));
}

function issueActingToken({ clientId, csmId, secret = process.env.JWT_SECRET }) {
  return jwt.sign({ id: idOf(clientId), actingCsm: idOf(csmId) }, secret, { expiresIn: `${ACTING_TOKEN_HOURS}h` });
}

module.exports = { canActFor, isBlockedWhileActing, issueActingToken, ACTING_TOKEN_HOURS, idOf };
