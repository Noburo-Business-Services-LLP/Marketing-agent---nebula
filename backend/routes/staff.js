const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const requireStaff = require('../middleware/requireStaff');
const { ACTIONS, can, roleOf } = require('../services/staff/permissions');
const { grantableRoles, buildTeam, loadTeamData } = require('../services/staff/team');
const { addMember, changeRole, removeMember } = require('../services/staff/teamActions');
const { recordStaffAction } = require('../services/staff/activityLog');
const { buildList, loadClientData, displayName, platformsOf } = require('../services/staff/clientList');
const { classifyClient } = require('../services/staff/clientStatus');
const { buildHome, loadDailyActive, activityIds } = require('../services/staff/home');
const { buildHealth } = require('../services/staff/health');
const { buildMoney, buildPayments, loadMoneyData } = require('../services/staff/money');
const { buildUsage, loadUsageData, parseWindow } = require('../services/staff/usage');
const { parseQuarkAmount, checkAssignment, isCustomer } = require('../services/staff/clientActions');
const { canActFor, issueActingToken, ACTING_TOKEN_HOURS } = require('../services/csmAccess');

router.use(protect);

// GET /api/staff/me: who I am and what my role may do (the screens use this to show or hide things).
router.get('/me', requireStaff('view_home'), (req, res) => {
  const s = req.staff;
  res.json({
    success: true,
    staff: { id: String(s._id), name: [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email, email: s.email, role: roleOf(s) },
    can: Object.fromEntries(ACTIONS.map((a) => [a, can(s, a)]))
  });
});

// The database and mail wiring for the Team actions (the rules are in services/staff/teamActions.js).
function teamRepo() {
  const mongoose = require('mongoose');
  const ids = (v) => (mongoose.Types.ObjectId.isValid(v) ? v : null);
  return {
    findByEmail: (email) => User.findOne({ email }).select('email firstName lastName staffRole isCsm isActive payments.status plan.subscriptions').lean(),
    findById: (id) => (ids(id) ? User.findById(id).select('email firstName lastName staffRole isCsm isActive').lean() : null),
    countOwners: () => User.countDocuments({ staffRole: 'owner' }),
    createUser: async (doc) => {
      const user = await User.create({ ...doc, password: require('crypto').randomBytes(24).toString('hex') });
      return user.toObject();
    },
    updateUser: (id, set) => User.updateOne({ _id: id }, { $set: set }),
    unassignClients: async (csmId) => {
      const mine = await User.find({ assignedCsm: csmId }).select('firstName lastName email companyName businessProfile.name').lean();
      if (mine.length) await User.updateMany({ assignedCsm: csmId }, { $set: { assignedCsm: null } });
      return { count: mine.length, clients: mine.slice(0, 50).map((c) => ({ id: String(c._id), name: displayName(c) })) };
    }
  };
}
const teamDeps = () => ({ repo: teamRepo(), record: recordStaffAction, invite: (args) => require('../services/staff/invite').sendInvite(args) });

async function runTeam(res, label, work) {
  try {
    const out = await work();
    res.status(out.status).json(out.body);
  } catch (error) {
    console.error(`[staff] ${label} failed:`, error.message);
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

// GET /api/staff/team: the team with role, status, last active and CSM workload (Owner, Admin).
router.get('/team', requireStaff('add_csm'), async (req, res) => {
  try {
    const models = { User, FeatureEvent: require('../models/FeatureEvent'), Draft: require('../models/Draft') };
    const data = await loadTeamData({ models });
    const team = buildTeam(data);
    res.json({ success: true, me: String(req.staff._id), grantable: grantableRoles(req.staff), ...team });
  } catch (error) {
    console.error('[staff] team list failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the team. Please try again.' });
  }
});

// POST /api/staff/team { email, firstName, lastName, role }: add a team member and email the invite.
router.post('/team', requireStaff('add_csm'), (req, res) =>
  runTeam(res, 'add team member', () => addMember({ actor: req.staff, input: req.body || {}, ...teamDeps() })));

// PATCH /api/staff/team/:id { role }: change a team member's role.
router.patch('/team/:id', requireStaff('add_csm'), (req, res) =>
  runTeam(res, 'role change', () => changeRole({ actor: req.staff, targetId: req.params.id, role: req.body && req.body.role, ...teamDeps() })));

// POST /api/staff/team/:id/role { role }: same as PATCH (kept for the old admin page).
router.post('/team/:id/role', requireStaff('add_csm'), (req, res) =>
  runTeam(res, 'role change', () => changeRole({ actor: req.staff, targetId: req.params.id, role: req.body && req.body.role, ...teamDeps() })));

// DELETE /api/staff/team/:id: take staff access away; a CSM's clients are unassigned and listed.
router.delete('/team/:id', requireStaff('add_csm'), (req, res) =>
  runTeam(res, 'remove team member', () => removeMember({ actor: req.staff, targetId: req.params.id, ...teamDeps() })));

// GET /api/staff/home: health, clients that need attention, growth. A CSM sees only their own clients;
// error details are shown to Owners and Admins only.
router.get('/home', requireStaff('view_home'), async (req, res) => {
  try {
    const FeatureEvent = require('../models/FeatureEvent');
    const models = { User, FeatureEvent, Draft: require('../models/Draft') };
    const data = await loadClientData({ viewer: req.staff, models });
    let dailyActive = [];
    try { dailyActive = await loadDailyActive({ FeatureEvent, ids: activityIds(data.users) }); } catch (error) { console.error('[staff] daily activity failed:', error.message); }
    const home = buildHome({ viewer: req.staff, ...data, dailyActive });

    const snapshot = require('../services/opsAlerts').snapshot();
    let breaker = { tripped: false };
    try { breaker = require('../services/socialMediaAPI').getAyrshareCircuitBreakerState(); } catch (_) { /* leave as not tripped */ }
    const seeErrors = roleOf(req.staff) !== 'csm';
    const cards = buildHealth({ snapshot, breaker }).map((c) => (seeErrors ? c : { ...c, latest: [] }));
    res.json({ success: true, health: { since: snapshot.since, cards }, attention: home.attention, growth: home.growth });
  } catch (error) {
    console.error('[staff] home failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the Home numbers. Please try again.' });
  }
});

// GET /api/staff/money: revenue, plan mix, payments, renewals, failures, Quarks, Ayrshare profiles (Owner only).
router.get('/money', requireStaff('view_money'), async (req, res) => {
  try {
    const data = await loadMoneyData({ models: { User } });
    const q = req.query || {};
    res.json({ success: true, ...buildMoney({ ...data, page: q.page, pageSize: q.pageSize }) });
  } catch (error) {
    console.error('[staff] money failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the Money numbers. Please try again.' });
  }
});

// GET /api/staff/money/payments?page=&pageSize=: one page of the payments table (Owner only).
router.get('/money/payments', requireStaff('view_money'), async (req, res) => {
  try {
    const { users } = await loadMoneyData({ models: { User } });
    const q = req.query || {};
    res.json({ success: true, ...buildPayments({ users: users.filter((u) => !u.staffRole && !u.isCsm && !u.isHidden), page: q.page, pageSize: q.pageSize }) });
  } catch (error) {
    console.error('[staff] payments page failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the payments. Please try again.' });
  }
});

// GET /api/staff/usage?window=30|90: feature use, sign-up funnel, Quark spending by group, top feature per plan.
// Owner sees everything; an Admin gets the summary (no Quark spending); a CSM is refused. The level comes from the
// signed-in person's stored role, never from anything the caller sends.
router.get('/usage', requireStaff('view_usage_summary'), async (req, res) => {
  const w = parseWindow((req.query || {}).window);
  if (!w.ok) return res.status(400).json({ success: false, message: w.message });
  try {
    const models = {
      User, Draft: require('../models/Draft'), Campaign: require('../models/Campaign'), VideoJob: require('../models/VideoJob'),
      HeroVideoJob: require('../models/HeroVideoJob'), Blueprint: require('../models/Blueprint'), SocialInboxMessage: require('../models/SocialInboxMessage')
    };
    const data = await loadUsageData({ models, window: w.days });
    const level = can(req.staff, 'view_usage_full') ? 'full' : 'summary';
    res.json({ success: true, ...buildUsage({ ...data, window: w.days, level }) });
  } catch (error) {
    console.error('[staff] usage failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the Usage numbers. Please try again.' });
  }
});

// GET /api/staff/csms: active CSMs, for the "assign a CSM" menus (Owner, Admin).
router.get('/csms', requireStaff('assign_csm'), async (req, res) => {
  try {
    const rows = await User.find({ staffRole: 'csm', isActive: { $ne: false } }, { firstName: 1, lastName: 1, email: 1 }).sort({ firstName: 1 }).lean();
    res.json({ success: true, csms: rows.map((r) => ({ id: String(r._id), name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email })) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not load the CSM list.' });
  }
});

// GET /api/staff/clients: the client list (filters with counts, search, sort, paging). CSMs see only their own clients.
router.get('/clients', requireStaff('view_clients'), async (req, res) => {
  try {
    const models = { User, FeatureEvent: require('../models/FeatureEvent'), Draft: require('../models/Draft') };
    const data = await loadClientData({ viewer: req.staff, models });
    const q = req.query || {};
    res.json({ success: true, ...buildList({ viewer: req.staff, ...data, filter: q.filter, q: q.q, sort: q.sort, dir: q.dir, page: q.page, pageSize: q.pageSize }) });
  } catch (error) {
    console.error('[staff] client list failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the clients. Please try again.' });
  }
});

// Loads one client for a staff member and checks that this person may see them.
async function clientFor(req, res, action = 'view_clients') {
  const client = await User.findById(req.params.id).select('-password').lean();
  if (!client || !isCustomer(client) || !can(req.staff, action, client)) {
    res.status(404).json({ success: false, message: 'That client was not found, or is not yours to manage.' });
    return null;
  }
  return client;
}

// GET /api/staff/clients/:id: everything about one client on one page.
router.get('/clients/:id', requireStaff('view_clients'), async (req, res) => {
  try {
    const client = await clientFor(req, res);
    if (!client) return;
    const FeatureEvent = require('../models/FeatureEvent');
    const Draft = require('../models/Draft');
    const StaffAction = require('../models/StaffAction');
    const since30 = new Date(Date.now() - 30 * 86400000);
    const [events, lastEvent, drafts, oldestDraft, history] = await Promise.all([
      FeatureEvent.aggregate([{ $match: { userId: client._id, timestamp: { $gte: since30 } } }, { $group: { _id: '$feature', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }]),
      FeatureEvent.findOne({ userId: client._id }).sort({ timestamp: -1 }).select('timestamp').lean(),
      Draft.aggregate([{ $match: { userId: client._id, createdAt: { $gte: since30 } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Draft.findOne({ userId: client._id, status: 'draft' }).sort({ createdAt: 1 }).select('createdAt').lean(),
      StaffAction.find({ client: client._id }).sort({ at: -1 }).limit(20).populate('actor', 'firstName lastName email').lean()
    ]);
    const status = classifyClient(client, Date.now(), { lastEventAt: lastEvent && lastEvent.timestamp, oldestDraftAt: oldestDraft && oldestDraft.createdAt });
    const owner = roleOf(req.staff) === 'owner';
    const csm = client.assignedCsm ? await User.findById(client.assignedCsm).select('firstName lastName email').lean() : null;
    res.json({
      success: true,
      client: {
        id: String(client._id), name: displayName(client), email: client.email, mobile: client.mobileNumber || '',
        business: { name: client.businessProfile && client.businessProfile.name, industry: client.businessProfile && client.businessProfile.industry, website: client.businessProfile && client.businessProfile.website, location: client.businessProfile && client.businessProfile.businessLocation, languages: client.businessProfile && client.businessProfile.additionalLanguages },
        signedUpAt: client.createdAt, lastActiveAt: status.lastActiveAt, onboardingCompleted: Boolean(client.onboardingCompleted),
        csm: csm ? { id: String(csm._id), name: [csm.firstName, csm.lastName].filter(Boolean).join(' ') || csm.email } : null,
        status: status.status, tier: status.tier, addons: status.addons, paying: status.paying, trial: status.trial,
        access: status.access, attention: status.attention, quarks: status.quarks,
        connections: platformsOf(client),
        recentQuarks: (client.credits && client.credits.history ? client.credits.history.slice(-10).reverse() : []).map((h) => ({ action: h.action, amount: h.amount, description: h.description, at: h.createdAt || h.timestamp })),
        featureUse30d: events.map((e) => ({ feature: e._id, count: e.n })),
        drafts30d: Object.fromEntries(drafts.map((d) => [d._id || 'unknown', d.n])),
        money: owner ? { payments: (client.payments || []).slice(-20).reverse().map((p) => ({ item: p.item, amount: p.amount, currency: p.currency, status: p.status, at: p.paidAt })), subscriptions: (client.plan && client.plan.subscriptions || []).map((x) => ({ kind: x.kind, key: x.key, active: x.active, since: x.createdAt })) } : null,
        history: (can(req.staff, 'view_activity_all') ? history : history.filter((h) => String(h.actor && h.actor._id) === String(req.staff._id))).map((h) => ({ action: h.action, by: h.actor ? ([h.actor.firstName, h.actor.lastName].filter(Boolean).join(' ') || h.actor.email) : '', at: h.at, details: h.details }))
      },
      can: Object.fromEntries(['open_client', 'add_quarks', 'toggle_client', 'assign_csm', 'view_money'].map((a) => [a, can(req.staff, a, client)]))
    });
  } catch (error) {
    console.error('[staff] client page failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load this client. Please try again.' });
  }
});

// POST /api/staff/clients/:id/quarks { amount }: Owner only.
router.post('/clients/:id/quarks', requireStaff('add_quarks'), async (req, res) => {
  try {
    const client = await clientFor(req, res, 'add_quarks');
    if (!client) return;
    const parsed = parseQuarkAmount(req.body && req.body.amount);
    if (!parsed.ok) return res.status(400).json({ success: false, message: parsed.message });
    const updated = await User.findByIdAndUpdate(client._id, {
      $inc: { 'credits.balance': parsed.amount },
      $push: { 'credits.history': { action: 'staff_grant', amount: parsed.amount, description: `Nebulaa staff added ${parsed.amount} Quarks`, createdAt: new Date() } }
    }, { new: true }).select('credits.balance').lean();
    await recordStaffAction({ actor: req.staff, action: 'add_quarks', client: client._id, details: { amount: parsed.amount, balanceAfter: updated.credits.balance } });
    res.json({ success: true, balance: updated.credits.balance });
  } catch (error) {
    console.error('[staff] add quarks failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not add the Quarks.' });
  }
});

// POST /api/staff/clients/:id/toggle { active }: switch an account off or on (Owner, Admin).
router.post('/clients/:id/toggle', requireStaff('toggle_client'), async (req, res) => {
  try {
    const client = await clientFor(req, res, 'toggle_client');
    if (!client) return;
    const active = Boolean(req.body && req.body.active);
    await User.updateOne({ _id: client._id }, { $set: { isActive: active } });
    await recordStaffAction({ actor: req.staff, action: active ? 'enable_client' : 'disable_client', client: client._id });
    res.json({ success: true, active });
  } catch (error) {
    console.error('[staff] toggle failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not change the account.' });
  }
});

// POST /api/staff/clients/:id/assign-csm { csmId | null } (Owner, Admin)
router.post('/clients/:id/assign-csm', requireStaff('assign_csm'), async (req, res) => {
  try {
    const client = await clientFor(req, res, 'assign_csm');
    if (!client) return;
    const csmId = req.body && req.body.csmId ? req.body.csmId : null;
    const csm = csmId ? await User.findById(csmId).select('staffRole isCsm isActive').lean() : null;
    const check = checkAssignment({ csm: csmId ? csm : null, client });
    if (!check.ok) return res.status(400).json({ success: false, message: check.message });
    await User.updateOne({ _id: client._id }, { $set: { assignedCsm: csmId } });
    await recordStaffAction({ actor: req.staff, action: 'assign_csm', client: client._id, details: { csm: csmId ? String(csmId) : null } });
    res.json({ success: true });
  } catch (error) {
    console.error('[staff] assign failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not assign the CSM.' });
  }
});

// POST /api/staff/clients/bulk-assign { ids, csmId }: up to 200 clients at once (Owner, Admin).
router.post('/clients/bulk-assign', requireStaff('assign_csm'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.slice(0, 200) : [];
    if (ids.length === 0) return res.status(400).json({ success: false, message: 'Choose at least one client.' });
    const csmId = req.body.csmId || null;
    const csm = csmId ? await User.findById(csmId).select('staffRole isCsm isActive').lean() : null;
    const check = checkAssignment({ csm: csmId ? csm : null, client: { _id: 'x' } });
    if (!check.ok) return res.status(400).json({ success: false, message: check.message });
    const result = await User.updateMany({ _id: { $in: ids }, staffRole: null, isCsm: { $ne: true } }, { $set: { assignedCsm: csmId } });
    await recordStaffAction({ actor: req.staff, action: 'bulk_assign_csm', details: { clients: ids.length, csm: csmId ? String(csmId) : null } });
    res.json({ success: true, updated: result.modifiedCount || 0 });
  } catch (error) {
    console.error('[staff] bulk assign failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not assign the CSM.' });
  }
});

// POST /api/staff/clients/:id/open: a short-lived pass into the client's account (Owner, Admin; a CSM only for their own clients).
router.post('/clients/:id/open', requireStaff('open_client'), async (req, res) => {
  try {
    const client = await clientFor(req, res, 'open_client');
    if (!client) return;
    if (client.isActive === false) return res.status(400).json({ success: false, message: 'This account is switched off. Switch it on first.' });
    if (!canActFor(req.staff, client)) return res.status(403).json({ success: false, message: 'Your role cannot open this account.' });
    const CsmSession = require('../models/CsmSession');
    await CsmSession.create({ csm: req.staff._id, client: client._id, ip: req.ip || '', userAgent: String(req.headers['user-agent'] || '').slice(0, 300) });
    await recordStaffAction({ actor: req.staff, action: 'open_client', client: client._id });
    res.json({ success: true, token: issueActingToken({ clientId: client._id, csmId: req.staff._id }), expiresInHours: ACTING_TOKEN_HOURS, client: { id: String(client._id), name: displayName(client) } });
  } catch (error) {
    console.error('[staff] open client failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not open this client. Please try again.' });
  }
});

module.exports = router;
