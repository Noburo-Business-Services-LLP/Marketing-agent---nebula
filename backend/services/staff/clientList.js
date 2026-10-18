/**
 * The client list for the staff area: who is visible, filters with counts, search, sorting, paging.
 * `buildList` is pure; `loadClientData` reads the database. Staff accounts are never clients.
 */
const { classifyClient, matchesFilter, FILTERS } = require('./clientStatus');
const { roleOf } = require('./permissions');
const { NOT_A_WORKSPACE } = require('../agency');
const { READ_OPTIONS } = require('./readErrors');

const SORTS = ['name', 'quarks', 'lastActive', 'status', 'plan'];

function idOf(v) {
  if (!v) return '';
  return String(v._id || v.id || v);
}

function displayName(u) {
  const bp = u.businessProfile || {};
  return bp.name || u.companyName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';
}

function isCustomer(u) {
  return !u.staffRole && !u.isCsm;
}

/** CSMs see only their own clients; Owners and Admins see every client. */
function visibleTo(viewer, u) {
  if (!isCustomer(u)) return false;
  if (roleOf(viewer) === 'csm') return idOf(u.assignedCsm) === idOf(viewer);
  return true;
}

function platformsOf(u) {
  const names = new Set();
  (Array.isArray(u.connectedSocials) ? u.connectedSocials : []).forEach((s) => s && s.platform && names.add(String(s.platform).toLowerCase() === 'twitter' ? 'x' : String(s.platform).toLowerCase()));
  (Array.isArray(u.ayrshare && u.ayrshare.activeSocialAccounts) ? u.ayrshare.activeSocialAccounts : []).forEach((p) => names.add(String(p).toLowerCase() === 'twitter' ? 'x' : String(p).toLowerCase()));
  return [...names];
}

function toRow(u, c, csmNames) {
  return {
    id: idOf(u),
    name: displayName(u),
    email: u.email || '',
    company: u.companyName || '',
    mobile: u.mobileNumber || '',
    tier: c.tier,
    addons: c.addons,
    paying: c.paying,
    trial: c.trial,
    status: c.status,
    quarks: c.quarks,
    platforms: platformsOf(u),
    access: c.access,
    csm: u.assignedCsm ? { id: idOf(u.assignedCsm), name: csmNames[idOf(u.assignedCsm)] || '' } : null,
    lastActiveAt: c.lastActiveAt ? c.lastActiveAt.toISOString() : null,
    attention: c.attention,
    hidden: Boolean(u.isHidden)
  };
}

function sorter(sort, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  const key = {
    name: (r) => r.name.toLowerCase(),
    quarks: (r) => r.quarks,
    lastActive: (r) => (r.lastActiveAt ? new Date(r.lastActiveAt).getTime() : 0),
    status: (r) => ({ active: 0, inactive: 1, disabled: 2 }[r.status]),
    plan: (r) => `${r.paying ? 0 : 1}${r.tier}`
  }[SORTS.includes(sort) ? sort : 'lastActive'];
  return (a, b) => {
    const x = key(a), y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  };
}

/**
 * users: lean customer-or-staff documents; extras: { [userId]: { lastEventAt, oldestDraftAt, failedPosts7d } };
 * csmNames: { [staffId]: name }
 */
function buildList({ viewer, users, extras = {}, csmNames = {}, now = Date.now(), filter = 'all', q = '', sort = 'lastActive', dir = 'desc', page = 1, pageSize = 25 }) {
  const { counts, rows } = buildRows({ viewer, users, extras, csmNames, now, filter, q, sort, dir });
  const size = Math.max(1, Math.min(100, Number(pageSize) || 25));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.max(1, Math.min(pages, Number(page) || 1));
  return { counts, total: rows.length, page: current, pages, rows: rows.slice((current - 1) * size, current * size) };
}

/** Every visible client classified once. Home needs several views of the same list, so it does this once and asks `rowsOf` for each. */
function classifyAll({ viewer, users, extras = {}, now = Date.now() }) {
  const scoped = users.filter((u) => visibleTo(viewer, u));
  return scoped.map((u) => ({ u, c: classifyClient(u, now, extras[idOf(u)] || {}) }));
}

/** The filter counts and all matching rows (not yet cut into pages), sorted. */
function rowsOf(classified, { csmNames = {}, filter = 'all', q = '', sort = 'lastActive', dir = 'desc' }) {
  const f = FILTERS.includes(filter) ? filter : 'all';

  // Hidden accounts (test accounts the owner hid) stay out of everything except their own filter.
  const shown = classified.filter(({ u }) => !u.isHidden);
  const counts = {};
  FILTERS.forEach((name) => {
    counts[name] = name === 'hidden'
      ? classified.filter(({ u }) => u.isHidden).length
      : shown.filter(({ u, c }) => matchesFilter(name, u, c)).length;
  });

  const pool = f === 'hidden' ? classified.filter(({ u }) => u.isHidden) : shown.filter(({ u, c }) => matchesFilter(f, u, c));
  const needle = String(q || '').trim().toLowerCase();
  const searched = needle
    ? pool.filter(({ u }) => [displayName(u), u.email, u.companyName, u.mobileNumber, u.firstName, u.lastName].some((v) => String(v || '').toLowerCase().includes(needle)))
    : pool;

  const rows = searched.map(({ u, c }) => toRow(u, c, csmNames)).sort(sorter(sort, dir));
  return { counts, rows };
}

function buildRows({ viewer, users, extras = {}, csmNames = {}, now = Date.now(), filter = 'all', q = '', sort = 'lastActive', dir = 'desc' }) {
  return rowsOf(classifyAll({ viewer, users, extras, now }), { csmNames, filter, q, sort, dir });
}

/**
 * The only user fields the client list, Home and Team read. Social accounts are read as a list of platforms (the list
 * shows the platform names and the status rules count them), the plan as tier, add-ons and the paid flags.
 */
const CLIENT_USER_PROJECTION = Object.freeze({
  email: 1, firstName: 1, lastName: 1, companyName: 1, mobileNumber: 1, createdAt: 1, isActive: 1, isHidden: 1, lastLoginAt: 1,
  onboardingCompleted: 1, 'credits.balance': 1, 'connectedSocials.platform': 1, 'ayrshare.activeSocialAccounts': 1,
  'plan.tier': 1, 'plan.addons': 1, 'plan.paidManually': 1, 'plan.subscriptions.active': 1, 'trial.isExpired': 1, 'payments.status': 1,
  assignedCsm: 1, staffRole: 1, isCsm: 1, 'businessProfile.name': 1
});

/** Reads what the list needs. `models` is injected for tests. Each activity read stands alone: one that fails is logged and the others still load. */
async function loadClientData({ viewer, models, now = Date.now(), assignedOnly = false }) {
  const { User, FeatureEvent, Draft } = models;
  const scope = { staffRole: null, isCsm: { $ne: true }, ...NOT_A_WORKSPACE }; // null also matches accounts that never had a role; a client workspace is never a customer here
  if (roleOf(viewer) === 'csm') scope.assignedCsm = viewer._id;
  else if (assignedOnly) scope.assignedCsm = { $ne: null }; // the Team page only needs clients that have a CSM
  const users = await User.find(scope, CLIENT_USER_PROJECTION, { maxTimeMS: READ_OPTIONS.maxTimeMS }).lean();
  const ids = users.map((u) => u._id);
  const extras = {};
  const put = (id, patch) => { extras[String(id)] = { ...(extras[String(id)] || {}), ...patch }; };

  const reads = [
    ['activity', async () => (await FeatureEvent.aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: '$userId', last: { $max: '$timestamp' } } }], READ_OPTIONS))
      .forEach((e) => put(e._id, { lastEventAt: e.last }))],
    ['waiting drafts', async () => (await Draft.aggregate([
      { $match: { userId: { $in: ids }, status: 'draft' } },
      { $group: { _id: '$userId', oldest: { $min: '$createdAt' }, n: { $sum: 1 } } }
    ], READ_OPTIONS)).forEach((d) => put(d._id, { oldestDraftAt: d.oldest, draftCount: d.n }))],
    ['failed posts', async () => (await Draft.aggregate([
      { $match: { userId: { $in: ids }, status: 'failed', updatedAt: { $gte: new Date(now - 7 * 86400000) } } },
      { $group: { _id: '$userId', n: { $sum: 1 } } }
    ], READ_OPTIONS)).forEach((d) => put(d._id, { failedPosts7d: d.n }))]
  ];
  const results = await Promise.allSettled(reads.map(([, run]) => run()));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[staff] could not read ${reads[i][0]} for the client list:`, r.reason.message);
  });

  const staff = await User.find({ $or: [{ staffRole: { $ne: null } }, { isCsm: true }] }, { firstName: 1, lastName: 1, email: 1 }).lean();
  const csmNames = Object.fromEntries(staff.map((s) => [String(s._id), [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email]));
  return { users, extras, csmNames };
}

module.exports = { buildList, buildRows, classifyAll, rowsOf, loadClientData, displayName, platformsOf, SORTS, CLIENT_USER_PROJECTION };
