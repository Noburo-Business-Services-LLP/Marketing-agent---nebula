const SECRET_KEY = /pass|secret|token|key|otp|card|cvv/i;

function cleanDetails(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 20)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 300) : v;
  }
  return out;
}

async function recordStaffAction({ actor, action, client = null, details = {} }) {
  try {
    const StaffAction = require('../../models/StaffAction');
    const { roleOf } = require('./permissions');
    await StaffAction.create({ actor: actor._id, actorRole: roleOf(actor) || '', action, client: client ? (client._id || client) : null, details: cleanDetails(details) });
  } catch (error) {
    console.error('[staff] could not record action:', error.message);
  }
}

module.exports = { cleanDetails, recordStaffAction };
