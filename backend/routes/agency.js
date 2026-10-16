// Client brands for an agency account (/api/agency): list, add, rename and open.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');
const { AGENCY } = require('../config/apiCosts');
const ag = require('../services/agency');
const ws = require('../services/agencyWorkspaces');
const del = require('../services/accountDeletion');

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

router.post('/clients/:id/open', protect, limiter, async (req, res) => {
  try {
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

module.exports = router;
