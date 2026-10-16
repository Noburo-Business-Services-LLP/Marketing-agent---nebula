// Client brands for an agency account (/api/agency): list, add, rename and open.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { AGENCY } = require('../config/apiCosts');
const ag = require('../services/agency');
const ws = require('../services/agencyWorkspaces');
const del = require('../services/accountDeletion');
const usage = require('../services/agencyUsage');

const router = express.Router();
const idOf = (req) => String(req.user?._id || req.user?.id || '');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' },
  keyGenerator: (req) => `${idOf(req)}|${ipKeyGenerator(req.ip)}`
});
const models = () => del.defaultModels();

/** The agency account for this request: the agency itself, or the agency behind the pass when working inside a client. Always read fresh. */
async function agencyOwner(req) {
  const id = req.actingAgency ? req.actingAgency._id : req.user._id;
  return models().User.findById(id);
}

router.get('/clients', protect, limiter, async (req, res) => {
  try {
    const owner = await agencyOwner(req);
    const clients = owner ? await ws.listWorkspaces({ owner, models: models() }) : [];
    res.json({ success: true, clients, limit: owner ? ag.clientLimitOf(owner) : 0, used: clients.length, slotInr: AGENCY.slot.inr, slotQuarks: AGENCY.slot.quarks });
  } catch (e) {
    console.error('[agency] list failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not load your clients. Please try again.' });
  }
});

router.post('/clients', protect, limiter, async (req, res) => {
  try {
    if (req.actingAgency || ag.isWorkspace(req.user)) return res.status(403).json({ success: false, message: 'Clients are added from your agency account.' });
    const body = req.body || {};
    const r = await ws.createWorkspace({
      owner: req.user, name: typeof body.name === 'string' ? body.name : '',
      industry: typeof body.industry === 'string' ? body.industry : '', models: models()
    });
    if (!r.ok) return res.status(ag.isAgency(req.user) ? 400 : 403).json({ success: false, message: r.message });
    const w = r.workspace;
    res.status(201).json({ success: true, client: { id: String(w._id), name: w.agency.workspaceName, createdAt: w.createdAt, frozen: false } });
  } catch (e) {
    console.error('[agency] create failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not add this client. Please try again.' });
  }
});

router.patch('/clients/:id', protect, limiter, async (req, res) => {
  try {
    if (req.actingAgency || ag.isWorkspace(req.user)) return res.status(403).json({ success: false, message: 'Clients are renamed from your agency account.' });
    const body = req.body || {};
    const r = await ws.renameWorkspace({ owner: req.user, workspaceId: String(req.params.id), name: typeof body.name === 'string' ? body.name : '', models: models() });
    if (!r.ok) return res.status(/not found/.test(r.message) ? 404 : 400).json({ success: false, message: r.message });
    res.json({ success: true });
  } catch (e) {
    console.error('[agency] rename failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not rename this client. Please try again.' });
  }
});

/**
 * Remove a client and everything it holds, at once. Needs the agency's password and the word REMOVE. Refused while the
 * client has running work. The agency's usage history for this client is kept.
 */
router.delete('/clients/:id', protect, limiter, async (req, res) => {
  try {
    if (req.actingAgency || ag.isWorkspace(req.user)) return res.status(403).json({ success: false, message: 'Clients are removed from your agency account.' });
    const body = req.body || {};
    if (String(body.confirm).trim() !== 'REMOVE') return res.status(400).json({ success: false, message: 'Type REMOVE to confirm.' });
    if (!(await del.passwordOk(idOf(req), body.password, { User: models().User }))) return res.status(403).json({ success: false, message: 'That password is not right.' });
    const m = models();
    const owner = await m.User.findById(req.user._id);
    if (!owner) return res.status(404).json({ success: false, message: 'That client was not found.' });
    const deps = del.defaultDeps();
    const r = await ws.removeWorkspace({ owner, workspaceId: String(req.params.id), models: m, purge: (id) => del.purgeWorkspace(id, { models: m, deps }) });
    if (!r.ok) return res.status(r.busy ? 409 : /not found/.test(r.message) ? 404 : 502).json({ success: false, message: r.message });
    res.json({ success: true });
  } catch (e) {
    console.error('[agency] remove failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not remove this client. Please check your client list and try again.' });
  }
});

router.post('/clients/:id/open', protect, limiter, async (req, res) => {
  try {
    // Staff working inside an agency account cannot hand themselves a pass into its clients (the pass would outlive their assignment).
    if (req.actingCsm) return res.status(403).json({ success: false, message: 'Clients can only be opened by the agency itself.' });
    const owner = await agencyOwner(req);
    if (!owner || !ag.isAgency(owner)) return res.status(403).json({ success: false, message: 'Client brands are part of the Agency plan.' });
    const mine = (await ws.listWorkspaces({ owner, models: models() })).find((c) => c.id === String(req.params.id));
    if (!mine) return res.status(404).json({ success: false, message: 'That client was not found.' });
    if (mine.frozen) return res.status(403).json({ success: false, message: 'This client is over your client limit and is paused. Add a client slot to open it.' });
    await ws.syncWorkspacePlans({ owner, models: models() }); // heals any lag between the agency plan and its clients
    res.json({ success: true, token: ws.issueAgencyPass({ workspaceId: mine.id, ownerId: owner._id }), expiresInHours: ws.PASS_HOURS, client: { id: mine.id, name: mine.name } });
  } catch (e) {
    console.error('[agency] open failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not open this client. Please try again.' });
  }
});

/**
 * The usage report. Always for the signed-in agency account (the owner is read from the session, never from the
 * request), never from inside a client. `month` is YYYY-MM; `page` and `limit` page the client list.
 */
async function usageFor(req, res) {
  if (req.actingAgency || ag.isWorkspace(req.user)) { res.status(403).json({ success: false, message: 'The usage report is part of your agency account.' }); return null; }
  const owner = await models().User.findById(req.user._id);
  if (!owner || !ag.isAgency(owner)) { res.status(403).json({ success: false, message: 'The usage report is part of the Agency plan.' }); return null; }
  const q = req.query || {};
  return usage.usageForMonth({ owner, month: typeof q.month === 'string' ? q.month : '', page: typeof q.page === 'string' ? q.page : '', limit: typeof q.limit === 'string' ? q.limit : '', models: models() });
}

router.get('/usage', protect, limiter, async (req, res) => {
  try {
    const r = await usageFor(req, res);
    if (r) res.json({ success: true, ...r });
  } catch (e) {
    console.error('[agency] usage failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not load your usage report. Please try again.' });
  }
});

router.get('/usage.csv', protect, limiter, async (req, res) => {
  try {
    // The whole client list in one file: at most 25 clients, so no paging.
    req.query = { ...(req.query || {}), page: '1', limit: String(usage.MAX_PAGE) };
    const r = await usageFor(req, res);
    if (!r) return;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="client-usage-${r.month}.csv"`);
    res.set('Cache-Control', 'no-store');
    res.send(usage.toCsv(r.clients, r.monthLabel));
  } catch (e) {
    console.error('[agency] usage csv failed:', e.message);
    res.status(500).json({ success: false, message: 'We could not prepare your usage file. Please try again.' });
  }
});

module.exports = router;
