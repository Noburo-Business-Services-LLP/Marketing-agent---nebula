const { can, isStaff } = require('../services/staff/permissions');

function defaultLoadUser(id) {
  return require('../models/User').findById(id).select('email firstName lastName staffRole isCsm isActive').lean();
}

/** Use after `protect`. Refuses anyone whose staff role does not allow `action`. */
function requireStaff(action, { loadUser = defaultLoadUser } = {}) {
  return async (req, res, next) => {
    const id = req.user?._id || req.user?.id;
    if (!id) return res.status(401).json({ success: false, message: 'Please sign in.' });
    let staff;
    try {
      staff = await loadUser(id);
    } catch (error) {
      return res.status(500).json({ success: false, message: 'We could not check your access right now. Please try again.' });
    }
    if (!staff || staff.isActive === false || !isStaff(staff)) {
      return res.status(403).json({ success: false, message: 'This area is for Nebulaa staff.' });
    }
    if (!can(staff, action)) {
      return res.status(403).json({ success: false, message: 'Your role cannot do this.' });
    }
    req.staff = staff;
    next();
  };
}

module.exports = requireStaff;
