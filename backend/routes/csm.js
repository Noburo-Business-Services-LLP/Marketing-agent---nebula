const express = require('express');
const router = express.Router();
const User = require('../models/User');
const CsmSession = require('../models/CsmSession');
const { protect } = require('../middleware/auth');
const { canActFor, issueActingToken, ACTING_TOKEN_HOURS } = require('../services/csmAccess');

router.use(protect);
// The CSM's own login only; a token that is already acting for a client never reaches here
// (protect blocks /api/csm while acting).
router.use((req, res, next) => {
  if (!req.user?.isCsm) return res.status(403).json({ success: false, message: 'This area is for customer success managers.' });
  next();
});

// GET /api/csm/clients: the clients assigned to this CSM, with what needs attention.
router.get('/clients', async (req, res) => {
  try {
    const clients = await User.find({ assignedCsm: req.user._id }, {
      email: 1, firstName: 1, lastName: 1, companyName: 1, isActive: 1, lastLoginAt: 1,
      'credits.balance': 1, connectedSocials: 1, onboardingCompleted: 1, 'businessProfile.name': 1, 'businessProfile.industry': 1
    }).sort({ companyName: 1 }).lean();

    let draftCounts = {};
    try {
      const Draft = require('../models/Draft');
      const rows = await Draft.aggregate([
        { $match: { userId: { $in: clients.map((c) => c._id) }, status: { $in: ['draft', 'pending', 'pending_approval'] } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } }
      ]);
      draftCounts = Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
    } catch (_) { draftCounts = {}; }

    res.json({
      success: true,
      clients: clients.map((c) => ({
        id: String(c._id),
        name: c.businessProfile?.name || c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
        email: c.email,
        industry: c.businessProfile?.industry || '',
        quarks: c.credits?.balance ?? 0,
        connectedAccounts: Array.isArray(c.connectedSocials) ? c.connectedSocials.length : 0,
        onboardingCompleted: Boolean(c.onboardingCompleted),
        draftsWaiting: draftCounts[String(c._id)] || 0,
        lastLoginAt: c.lastLoginAt || null,
        isActive: c.isActive !== false
      }))
    });
  } catch (error) {
    console.error('[csm] list clients failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not load your clients. Please try again.' });
  }
});

// POST /api/csm/clients/:id/open: a short-lived pass into one assigned client's account.
router.post('/clients/:id/open', async (req, res) => {
  try {
    const client = await User.findById(req.params.id).select('assignedCsm isActive email companyName businessProfile.name');
    if (!client || !canActFor(req.user, client)) {
      return res.status(404).json({ success: false, message: 'This client is not assigned to you.' });
    }
    await CsmSession.create({ csm: req.user._id, client: client._id, ip: req.ip || '', userAgent: String(req.headers['user-agent'] || '').slice(0, 300) });
    res.json({
      success: true,
      token: issueActingToken({ clientId: client._id, csmId: req.user._id }),
      expiresInHours: ACTING_TOKEN_HOURS,
      client: { id: String(client._id), name: client.businessProfile?.name || client.companyName || client.email }
    });
  } catch (error) {
    console.error('[csm] open client failed:', error.message);
    res.status(500).json({ success: false, message: 'We could not open this client. Please try again.' });
  }
});

module.exports = router;
