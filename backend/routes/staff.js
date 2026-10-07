const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const requireStaff = require('../middleware/requireStaff');
const { ACTIONS, can, roleOf } = require('../services/staff/permissions');
const { planRoleChange } = require('../services/staff/roles');
const { recordStaffAction } = require('../services/staff/activityLog');

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

// POST /api/staff/team/:id/role { role }: make someone Owner, Admin or CSM, or remove their role.
router.post('/team/:id/role', requireStaff('add_csm'), async (req, res) => {
  try {
    const newRole = req.body?.role === undefined ? undefined : (req.body.role || null);
    if (newRole === undefined) return res.status(400).json({ success: false, message: 'Choose a role.' });
    const target = await User.findById(req.params.id).select('email staffRole isCsm').lean();
    if (!target) return res.status(404).json({ success: false, message: 'That person was not found.' });
    const ownerCount = await User.countDocuments({ staffRole: 'owner' });
    const plan = planRoleChange({ actor: req.staff, target, newRole, ownerCount });
    if (!plan.ok) return res.status(403).json({ success: false, message: plan.message });
    await User.updateOne({ _id: target._id }, { $set: plan.update });
    if (newRole !== 'csm' && roleOf(target) === 'csm') {
      await User.updateMany({ assignedCsm: target._id }, { $set: { assignedCsm: null } });
    }
    await recordStaffAction({ actor: req.staff, action: 'role_change', client: target._id, details: { from: roleOf(target), to: newRole } });
    res.json({ success: true, data: { id: String(target._id), role: newRole } });
  } catch (error) {
    console.error('[staff] role change failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not change the role.' });
  }
});

module.exports = router;
