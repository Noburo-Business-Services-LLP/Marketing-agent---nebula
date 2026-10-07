/**
 * The Team page numbers: who is on the team, their role and status, and how much each CSM carries.
 * `buildTeam` is pure; `loadTeamData` reads the database (models injected for tests).
 */
const { roleOf } = require('./permissions');
const { classifyClient } = require('./clientStatus');

const SENIORITY = { owner: 0, admin: 1, csm: 2 };

function idOf(v) {
  if (!v) return '';
  return String(v._id || v.id || v);
}

function nameOf(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';
}

/** The roles this person may give to others: only the Owner grants Admin or Owner; Admins grant CSM. */
function grantableRoles(actor) {
  const role = roleOf(actor);
  if (role === 'owner') return ['owner', 'admin', 'csm'];
  if (role === 'admin') return ['csm'];
  return [];
}

/**
 * staff: team accounts; users: clients that have a CSM; extras: { [clientId]: { draftCount, oldestDraftAt, ... } }.
 */
function buildTeam({ staff, users = [], extras = {}, now = Date.now() }) {
  const load = {};
  for (const u of users) {
    const csm = idOf(u.assignedCsm);
    if (!csm) continue;
    const extra = extras[idOf(u)] || {};
    const c = classifyClient(u, now, extra);
    const slot = load[csm] || (load[csm] = { clients: 0, draftsWaiting: 0, needAttention: 0 });
    slot.clients += 1;
    slot.draftsWaiting += Number(extra.draftCount) || 0;
    if (c.attention.length > 0) slot.needAttention += 1;
  }
  const rows = staff
    .filter((s) => roleOf(s))
    .map((s) => {
      const role = roleOf(s);
      const w = role === 'csm' ? (load[idOf(s)] || { clients: 0, draftsWaiting: 0, needAttention: 0 }) : null;
      return {
        id: idOf(s),
        name: nameOf(s),
        email: s.email || '',
        role,
        status: s.isActive === false ? 'switched_off' : 'active',
        lastActiveAt: s.lastLoginAt ? new Date(s.lastLoginAt).toISOString() : null,
        clients: w ? w.clients : null,
        draftsWaiting: w ? w.draftsWaiting : null,
        needAttention: w ? w.needAttention : null
      };
    })
    .sort((a, b) => (SENIORITY[a.role] - SENIORITY[b.role]) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return {
    rows,
    maxClients: rows.reduce((m, r) => Math.max(m, r.clients || 0), 0),
    owners: rows.filter((r) => r.role === 'owner').length
  };
}

/** Reads the team and the clients that have a CSM. */
async function loadTeamData({ models, now = Date.now() }) {
  const { User } = models;
  const { loadClientData } = require('./clientList');
  const staff = await User.find({ $or: [{ staffRole: { $in: ['owner', 'admin', 'csm'] } }, { isCsm: true }] }, { firstName: 1, lastName: 1, email: 1, staffRole: 1, isCsm: 1, isActive: 1, lastLoginAt: 1 }).lean();
  const { users, extras } = await loadClientData({ viewer: { _id: 'team', staffRole: 'owner' }, models, now, assignedOnly: true });
  return { staff, users, extras };
}

module.exports = { grantableRoles, buildTeam, loadTeamData, nameOf };
