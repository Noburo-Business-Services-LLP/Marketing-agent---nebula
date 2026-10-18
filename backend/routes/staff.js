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
const { buildRecurring } = require('../services/staff/recurring');
const { buildUsage, loadUsageData, parseWindow } = require('../services/staff/usage');
const { parseQuarkAmount, checkAssignment, isCustomer, openProblem } = require('../services/staff/clientActions');
const { canActFor, issueActingToken, ACTING_TOKEN_HOURS } = require('../services/csmAccess');
const tools = require('../services/staff/tools');
const billing = require('../services/staff/billingLedger');
const billingZoho = require('../services/staff/billingZoho');
const { bulkClients, createClient } = require('../services/staff/clientBulk');
const { canonicalEmail } = require('../services/signupGuard');
const { keyFor, defaultCache } = require('../services/staff/cache');

// The four heavy pages (Home, Clients, Team, Usage) keep their last result for 5 minutes (see services/staff/cache.js).
// Off under `node --test` unless a test injects one with router._setCache(cache).
let staffCache = defaultCache();
router._setCache = (cache) => { staffCache = cache; };

/**
 * Runs `compute` through the cache. The key always carries the caller's permission level (and, for a CSM, their own id),
 * so one level never gets another level's data. Returns { value, freshness }: freshness is null when the cache is off.
 * `?refresh=1` skips the stored result and reads everything again.
 */
async function cachedRead(req, { endpoint, window = '' }, compute) {
  if (!staffCache) return { value: await compute(), freshness: null };
  const role = roleOf(req.staff);
  const key = keyFor({ endpoint, window, role, csmId: role === 'csm' ? String(req.staff._id) : '' });
  const hit = await staffCache.get(key, compute, { refresh: String((req.query || {}).refresh) === '1' });
  return { value: hit.value, freshness: { updatedAt: new Date(hit.updatedAt).toISOString(), fromCache: hit.fromCache, stale: hit.stale } };
}
const withFreshness = (body, freshness) => (freshness ? { ...body, freshness } : body);

router.use(protect);
// A staff change (assign a CSM, switch a client off, add Quarks, hide, add a team member ...) makes what was stored out of date: forget it all.
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') res.on('finish', () => { if (staffCache && res.statusCode < 400) staffCache.clear(); });
  next();
});

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
    const { value: team, freshness } = await cachedRead(req, { endpoint: 'team' }, async () => buildTeam(await loadTeamData({ models })));
    res.json(withFreshness({ success: true, me: String(req.staff._id), grantable: grantableRoles(req.staff), can: { reset_accounts: can(req.staff, 'reset_accounts'), add_quarks: can(req.staff, 'add_quarks') }, ...team }, freshness));
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

// The database wiring for the Owner tools (the rules are in services/staff/tools.js).
function toolsRepo() {
  const mongoose = require('mongoose');
  const valid = (v) => mongoose.Types.ObjectId.isValid(v);
  const Coupon = () => require('../models/Coupon');
  return {
    findById: (id) => (valid(id) ? User.findById(id).select('email staffRole isCsm').lean() : null),
    resetAyrshareProfileKeys: async () => (await User.updateMany(tools.AYRSHARE_RESET.filter, tools.AYRSHARE_RESET.update)).modifiedCount || 0,
    clearTestProfile: async (id) => {
      await User.updateOne({ _id: id }, { $unset: { businessProfile: '' }, $set: { connectedSocials: [], onboardingCompleted: true } });
      const result = await require('../models/Draft').updateMany({ userId: id, status: { $ne: 'archived' } }, { $set: { status: 'archived' } });
      return result.modifiedCount || 0;
    },
    setHidden: (id, hidden) => User.updateOne({ _id: id }, { $set: { isHidden: hidden } }),
    grantQuarks: async (id, amount) => {
      const updated = await User.findByIdAndUpdate(id, {
        $inc: { 'credits.balance': amount },
        $push: { 'credits.history': { action: 'staff_grant', amount, description: `Nebulaa staff added ${amount} Quarks`, createdAt: new Date() } }
      }, { new: true }).select('credits.balance').lean();
      return updated.credits.balance;
    },
    exists: async (code) => Boolean(await Coupon().findOne({ code }).lean()),
    create: async (doc) => { const row = await Coupon().create(doc); return couponRow(row.toObject ? row.toObject() : row); },
    deactivate: async (code) => { const row = await Coupon().findOneAndUpdate({ code }, { isActive: false }, { new: true }).lean(); return row ? couponRow(row) : null; },
    remove: async (code) => Boolean(await Coupon().findOneAndDelete({ code }))
  };
}
const couponRow = (c) => ({ code: c.code, discountedAmount: c.discountedAmount, maxUses: c.maxUses, usedCount: c.usedCount || 0, isActive: c.isActive !== false, note: c.note || '', createdAt: c.createdAt });
const toolDeps = () => ({ repo: toolsRepo(), record: recordStaffAction });

// POST /api/staff/ayrshare/reset-ids { confirm: true }: forget every customer's stored social profile id after
// switching to a different Ayrshare account (Owner only). Nothing is sent to Ayrshare.
router.post('/ayrshare/reset-ids', requireStaff('reset_accounts'), (req, res) =>
  runTeam(res, 'ayrshare reset', () => tools.resetAyrshareIds({ actor: req.staff, confirm: req.body && req.body.confirm, ...toolDeps() })));

// POST /api/staff/team/:id/reset-account { confirm: true }: clean a staff member's old test business profile (Owner only).
router.post('/team/:id/reset-account', requireStaff('reset_accounts'), (req, res) =>
  runTeam(res, 'staff account reset', () => tools.resetStaffAccount({ actor: req.staff, targetId: req.params.id, confirm: req.body && req.body.confirm, ...toolDeps() })));

// POST /api/staff/team/:id/quarks { amount }: add Quarks to a team member's own account (Owner only).
router.post('/team/:id/quarks', requireStaff('add_quarks'), (req, res) =>
  runTeam(res, 'staff quarks', () => tools.grantStaffQuarks({ actor: req.staff, targetId: req.params.id, amount: req.body && req.body.amount, ...toolDeps() })));

// POST /api/staff/clients/:id/hidden { hidden }: leave a client out of (or back in) the staff numbers (Owner, Admin).
router.post('/clients/:id/hidden', requireStaff('hide_client'), (req, res) =>
  runTeam(res, 'hide client', () => tools.setHidden({ actor: req.staff, targetId: req.params.id, hidden: req.body && req.body.hidden, ...toolDeps() })));

// Coupons (Owner only). Customers still redeem them through /api/payment.
router.get('/coupons', requireStaff('manage_coupons'), async (req, res) => {
  try {
    const rows = await require('../models/Coupon').find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, coupons: rows.map(couponRow) });
  } catch (error) {
    console.error('[staff] coupons failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the coupons. Please try again.' });
  }
});
router.post('/coupons', requireStaff('manage_coupons'), (req, res) =>
  runTeam(res, 'coupon create', () => tools.createCoupon({ actor: req.staff, input: req.body || {}, ...toolDeps() })));
router.post('/coupons/:code/deactivate', requireStaff('manage_coupons'), (req, res) =>
  runTeam(res, 'coupon deactivate', () => tools.deactivateCoupon({ actor: req.staff, code: req.params.code, ...toolDeps() })));
router.delete('/coupons/:code', requireStaff('manage_coupons'), (req, res) =>
  runTeam(res, 'coupon delete', () => tools.deleteCoupon({ actor: req.staff, code: req.params.code, ...toolDeps() })));

// GET /api/staff/ai-spend: what the AI providers have cost today (estimated), the daily ceiling, and each provider switch.
router.get('/ai-spend', requireStaff('manage_ai_switches'), async (req, res) => {
  try { res.json({ success: true, ...(await require('../services/spendGuard').status()) }); }
  catch (error) { console.error('[staff] ai spend failed:', error.message); res.status(500).json({ success: false, message: 'We could not load this right now.' }); }
});

// GET /api/staff/ayrshare-profiles: social profiles in use against the flat-fee limit, counted from our own accounts.
router.get('/ayrshare-profiles', requireStaff('manage_ai_switches'), async (req, res) => {
  try {
    const watch = require('../services/ayrshareProfileWatch');
    res.json({ success: true, ...watch.status(await watch.countProfiles({ User })) });
  } catch (error) { console.error('[staff] profile count failed:', error.message); res.status(500).json({ success: false, message: 'We could not load this right now.' }); }
});

// POST /api/staff/ai-switches { provider, disabled, note }: stop or resume one AI provider (Owner only).
router.post('/ai-switches', requireStaff('manage_ai_switches'), async (req, res) => {
  try {
    const b = req.body || {};
    const out = await require('../services/spendGuard').setSwitch(String(b.provider || ''), b.disabled === true, { note: b.note, by: req.staff && req.staff.email });
    if (!out.ok) return res.status(400).json({ success: false, message: out.message });
    res.json({ success: true, ...(await require('../services/spendGuard').status()) });
  } catch (error) { console.error('[staff] ai switch failed:', error.message); res.status(500).json({ success: false, message: 'We could not change this right now.' }); }
});

// GET /api/staff/home: health, clients that need attention, growth. A CSM sees only their own clients;
// error details are shown to Owners and Admins only.
router.get('/home', requireStaff('view_home'), async (req, res) => {
  try {
    const FeatureEvent = require('../models/FeatureEvent');
    const models = { User, FeatureEvent, Draft: require('../models/Draft') };
    const { value: home, freshness } = await cachedRead(req, { endpoint: 'home' }, async () => {
      const data = await loadClientData({ viewer: req.staff, models });
      let dailyActive = [];
      try { dailyActive = await loadDailyActive({ FeatureEvent, ids: activityIds(data.users) }); } catch (error) { console.error('[staff] daily activity failed:', error.message); }
      return buildHome({ viewer: req.staff, ...data, dailyActive });
    });

    const snapshot = require('../services/opsAlerts').snapshot();
    let breaker = { tripped: false };
    try { breaker = require('../services/socialMediaAPI').getAyrshareCircuitBreakerState(); } catch (_) { /* leave as not tripped */ }
    const seeErrors = roleOf(req.staff) !== 'csm';
    const cards = buildHealth({ snapshot, breaker }).map((c) => (seeErrors ? c : { ...c, latest: [] }));
    res.json(withFreshness({ success: true, health: { since: snapshot.since, cards }, attention: home.attention, growth: home.growth }, freshness));
  } catch (error) {
    console.error('[staff] home failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the Home numbers. Please try again.' });
  }
});

// GET /api/staff/money: revenue, plan mix, payments, renewals, failures, Quarks, Ayrshare profiles (Owner only).
router.get('/money', requireStaff('view_money'), async (req, res) => {
  try {
    const data = await loadMoneyData({ models: { User, ClientInvoice: require('../models/ClientInvoice') } });
    const q = req.query || {};
    res.json({ success: true, ...buildMoney({ ...data, page: q.page, pageSize: q.pageSize }), recurring: buildRecurring({ users: data.users, records: data.invoices }) });
  } catch (error) {
    console.error('[staff] money failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the Money numbers. Please try again.' });
  }
});

// GET /api/staff/money/payments?page=&pageSize=: one page of the payments table (Owner only).
router.get('/money/payments', requireStaff('view_money'), async (req, res) => {
  try {
    const { users } = await loadMoneyData({ models: { User, ClientInvoice: require('../models/ClientInvoice') } });
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
    const level = can(req.staff, 'view_usage_full') ? 'full' : 'summary';
    const { value, freshness } = await cachedRead(req, { endpoint: 'usage', window: String(w.days) }, async () => {
      const data = await loadUsageData({ models, window: w.days, level });
      return buildUsage({ ...data, window: w.days, level });
    });
    res.json(withFreshness({ success: true, ...value }, freshness));
  } catch (error) {
    console.error('[staff] usage failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load the Usage numbers. Please try again.' });
  }
});

// GET /api/staff/csms: active CSMs, for the "assign a CSM" menus (Owner, Admin).
router.get('/csms', requireStaff('assign_csm'), async (req, res) => {
  try {
    const rows = await User.find({ $or: [{ staffRole: 'csm' }, { isCsm: true }], isActive: { $ne: false } }, { firstName: 1, lastName: 1, email: 1 }).sort({ firstName: 1 }).lean();
    res.json({ success: true, csms: rows.map((r) => ({ id: String(r._id), name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email })) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Could not load the CSM list.' });
  }
});

// GET /api/staff/clients: the client list (filters with counts, search, sort, paging). CSMs see only their own clients.
router.get('/clients', requireStaff('view_clients'), async (req, res) => {
  try {
    const models = { User, FeatureEvent: require('../models/FeatureEvent'), Draft: require('../models/Draft') };
    // What is stored is the data read from the database; the filter, search, sort and page are applied fresh on every request.
    const { value: data, freshness } = await cachedRead(req, { endpoint: 'clients' }, () => loadClientData({ viewer: req.staff, models }));
    const q = req.query || {};
    res.json(withFreshness({ success: true, ...buildList({ viewer: req.staff, ...data, filter: q.filter, q: q.q, sort: q.sort, dir: q.dir, page: q.page, pageSize: q.pageSize }) }, freshness));
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
        hidden: Boolean(client.isHidden), signedUpAt: client.createdAt, lastActiveAt: status.lastActiveAt, onboardingCompleted: Boolean(client.onboardingCompleted),
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
      can: Object.fromEntries(['open_client', 'add_quarks', 'toggle_client', 'assign_csm', 'hide_client', 'view_money', 'manage_billing', 'set_plan'].map((a) => [a, can(req.staff, a, client)]))
    });
  } catch (error) {
    console.error('[staff] client page failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load this client. Please try again.' });
  }
});

// GET /api/staff/clients/:id/plan: the client's plan as they see it, plus when it last ran and how it ended.
router.get('/clients/:id/plan', requireStaff('view_clients'), async (req, res) => {
  try {
    const client = await clientFor(req, res);
    if (!client) return;
    const planRoutes = require('./plan');
    const lastRun = (id) => require('../models/Blueprint').findOne({ userId: id, kind: 'plan' }).sort({ createdAt: -1 }).select('status completedAt createdAt').lean();
    const body = await planRoutes.staffView({ client, service: require('../services/plan/planService').createPlanService(), lastRun });
    res.json(body);
  } catch (error) {
    console.error('[staff] client plan failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load this plan. Please try again.' });
  }
});

// POST /api/staff/clients/:id/plan/refresh: start a new plan for a client. The weekly limit does not apply; it is logged.
router.post('/clients/:id/plan/refresh', requireStaff('open_client'), async (req, res) => {
  try {
    const client = await clientFor(req, res, 'open_client');
    if (!client) return;
    const out = await require('./plan').staffRefresh({ client, staff: req.staff, service: require('../services/plan/planService').createPlanService(), record: recordStaffAction });
    res.status(out.status).json(out.json);
  } catch (error) {
    console.error('[staff] client plan refresh failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not refresh this plan. Please try again.' });
  }
});

// GET /api/staff/clients/:id/competitors: the competitor insights as the client sees them (same body).
router.get('/clients/:id/competitors', requireStaff('view_clients'), async (req, res) => {
  try {
    const client = await clientFor(req, res);
    if (!client) return;
    res.json(await require('./competitorInsights').viewFor(client));
  } catch (error) {
    console.error('[staff] client competitors failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load these competitors. Please try again.' });
  }
});

// POST /api/staff/clients/:id/competitors/check: read this client's competitors now. Skips the 12 hour cooldown only;
// the daily cap and the spend guard still apply. Logged.
router.post('/clients/:id/competitors/check', requireStaff('open_client'), require('./competitorInsights').checkLimiter, async (req, res) => {
  try {
    const client = await clientFor(req, res, 'open_client');
    if (!client) return;
    res.json(await require('./competitorInsights').staffCheck({ client, staff: req.staff, record: recordStaffAction }));
  } catch (error) {
    console.error('[staff] client competitors check failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not check these competitors. Please try again.' });
  }
});

// GET /api/staff/clients/:id/listening: the comment score card as the client sees it, plus the ledger counts.
router.get('/clients/:id/listening', requireStaff('view_clients'), async (req, res) => {
  try {
    const client = await clientFor(req, res);
    if (!client) return;
    res.json(await require('./listening').staffViewFor(client));
  } catch (error) {
    console.error('[staff] client listening failed:', error.name);
    res.status(500).json({ success: false, message: 'We could not load this comment score. Please try again.' });
  }
});

// POST /api/staff/clients/:id/listening/score: score this client's comments now. Skips the weekly wait only; the daily
// caps, the spend guard, the switch and the lease still apply. Logged.
router.post('/clients/:id/listening/score', requireStaff('open_client'), require('./listening').checkLimiter, async (req, res) => {
  try {
    const client = await clientFor(req, res, 'open_client');
    if (!client) return;
    res.json(await require('./listening').staffScore({ client, staff: req.staff, record: recordStaffAction }));
  } catch (error) {
    console.error('[staff] client listening score failed:', error.name);
    res.status(500).json({ success: false, message: 'We could not score these comments. Please try again.' });
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

// POST /api/staff/clients/:id/name { name }: correct the business name shown everywhere for this client (Owner, Admin).
router.post('/clients/:id/name', requireStaff('set_plan'), async (req, res) => {
  try {
    const client = await clientFor(req, res, 'set_plan');
    if (!client) return;
    const name = String((req.body && req.body.name) || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 100) return res.status(400).json({ success: false, message: 'Type a name between 2 and 100 characters.' });
    await User.updateOne({ _id: client._id }, { $set: { 'businessProfile.name': name, companyName: name } });
    await recordStaffAction({ actor: req.staff, action: 'rename_client', client: client._id, details: { from: (client.businessProfile && client.businessProfile.name) || client.companyName || '', to: name } });
    res.json({ success: true, name });
  } catch (error) {
    console.error('[staff] rename failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not change the name.' });
  }
});

// ---- Managed client billing: the month-by-month ledger (Owner, Admin) ----
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const billingRepo = () => {
  const ClientInvoice = require('../models/ClientInvoice');
  return {
    getClient: (id) => (OBJECT_ID.test(String(id)) ? User.findById(id).select('staffRole isCsm email firstName lastName companyName businessProfile.name managedBilling plan').lean() : null),
    listRecords: (id) => ClientInvoice.find({ client: id }).lean(),
    getRecord: (id, period) => ClientInvoice.findOne({ client: id, period }).lean(),
    upsertRecord: (id, period, set) => ClientInvoice.updateOne({ client: id, period }, { $set: set, $setOnInsert: { client: id, period } }, { upsert: true }),
    deleteRecord: (id, period) => ClientInvoice.deleteOne({ client: id, period }),
    setSettings: (id, settings) => User.updateOne({ _id: id }, { $set: { managedBilling: settings } }),
    setEnded: (id, endedMonth, reason) => User.updateOne({ _id: id }, endedMonth ? { $set: { 'managedBilling.endedMonth': endedMonth, 'managedBilling.endReason': reason } } : { $unset: { 'managedBilling.endedMonth': '', 'managedBilling.endReason': '' } }),
    markClientPaying: (id) => User.updateOne({ _id: id }, { $set: { 'plan.paidManually': true } })
  };
};
const billingRoute = (handler) => async (req, res) => {
  try {
    const out = await handler({ actor: req.staff, clientId: req.params.id, period: req.params.period, input: req.body || {}, repo: billingRepo(), zoho: require('../services/zohoBooks'), record: (row) => recordStaffAction(row) });
    if (out.body && out.body.success && out.body.rows) out.body.zohoOrgId = process.env.ZOHO_BOOKS_ORG_ID || '';
    res.status(out.status).json(out.body);
  } catch (error) {
    console.error('[staff] billing failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not complete that billing action. Please try again.' });
  }
};
router.get('/clients/:id/billing', requireStaff('manage_billing'), billingRoute((a) => billing.viewBilling(a)));
router.put('/clients/:id/billing/settings', requireStaff('manage_billing'), billingRoute((a) => billing.saveSettings(a)));
router.post('/clients/:id/billing/end', requireStaff('manage_billing'), billingRoute((a) => billing.endBilling(a)));
router.post('/clients/:id/billing/:period/invoice', requireStaff('manage_billing'), billingRoute((a) => billing.linkInvoice(a)));
router.post('/clients/:id/billing/sync', requireStaff('manage_billing'), billingRoute((a) => billingZoho.syncFromZoho({ ...a, apply: a.input.apply === true, invoiceNumbers: a.input.invoiceNumbers })));
router.post('/clients/:id/billing/:period/zoho-invoice', requireStaff('manage_billing'), billingRoute((a) => billingZoho.createZohoInvoice(a)));
router.post('/clients/:id/billing/:period/paid', requireStaff('manage_billing'), billingRoute((a) => billingZoho.markPaidWithZoho(a)));
router.get('/zoho/items', requireStaff('manage_billing'), async (req, res) => {
  try {
    const out = await billingZoho.listZohoItems({ actor: req.staff, zoho: require('../services/zohoBooks') });
    res.status(out.status).json(out.body);
  } catch (error) {
    res.status(200).json({ success: true, items: [] });
  }
});
router.get('/zoho/invoices', requireStaff('manage_billing'), async (req, res) => {
  try {
    const out = await billingZoho.searchZohoInvoices({ actor: req.staff, q: req.query.q, zoho: require('../services/zohoBooks') });
    res.status(out.status).json(out.body);
  } catch (error) {
    console.error('[staff] zoho search failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not search Zoho Books. Please try again.' });
  }
});
router.post('/clients/:id/billing/:period/dates', requireStaff('manage_billing'), billingRoute((a) => billing.editDates(a)));
router.post('/clients/:id/billing/:period/unpay', requireStaff('manage_billing'), billingRoute((a) => billing.undoPaid(a)));
router.post('/clients/:id/billing/:period/void', requireStaff('manage_billing'), billingRoute((a) => billing.setVoid({ ...a, voided: a.input.void !== false })));

// POST /api/staff/clients { email, firstName, lastName?, companyName?, csmId?, tier?, quarks? }: add a client by hand, on the
// Managed plan unless another is chosen. No payment gateway is involved. Owner, Admin.
router.post('/clients', requireStaff('create_client'), async (req, res) => {
  try {
    const repo = {
      findByEmail: (email) => User.findOne({ email }).select('staffRole isCsm').lean(),
      findByEmailKey: (key) => User.findOne({ emailKey: key }).select('staffRole isCsm').lean(),
      findCsm: (id) => (/^[a-f0-9]{24}$/i.test(String(id)) ? User.findById(id).select('staffRole isCsm isActive').lean() : null),
      createUser: (doc) => User.create(doc)
    };
    const out = await createClient({
      actor: req.staff, input: req.body || {}, repo, canonicalEmail,
      record: (row) => recordStaffAction(row),
      invite: (who) => require('../services/staff/invite').sendClientInvite(who)
    });
    res.status(out.status).json(out.body);
  } catch (error) {
    console.error('[staff] create client failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not add the client. Please try again.' });
  }
});

// POST /api/staff/clients/bulk { ids, op, ... }: one action on up to 200 clients (switch on or off, Quarks, CSM, plan, features, hide).
// Each action needs its own permission; staff accounts are skipped, never changed.
router.post('/clients/bulk', requireStaff('view_clients'), async (req, res) => {
  try {
    const repo = {
      findCustomers: (ids) => User.find({ _id: { $in: ids } }).select('staffRole isCsm subscription').lean(),
      findCsm: (id) => (/^[a-f0-9]{24}$/i.test(String(id)) ? User.findById(id).select('staffRole isCsm isActive').lean() : null),
      applyUpdate: (ids, update) => User.updateMany({ _id: { $in: ids }, staffRole: null, isCsm: { $ne: true }, 'agency.ownerId': null }, update)
    };
    const out = await bulkClients({ actor: req.staff, input: req.body || {}, repo, record: (row) => recordStaffAction(row) });
    res.status(out.status).json(out.body);
  } catch (error) {
    console.error('[staff] bulk action failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not apply that to the clients. Please try again.' });
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
    const result = await User.updateMany({ _id: { $in: ids }, staffRole: null, isCsm: { $ne: true }, 'agency.ownerId': null }, { $set: { assignedCsm: csmId } });
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
    const problem = openProblem(client);
    if (problem) return res.status(400).json({ success: false, message: problem });
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
