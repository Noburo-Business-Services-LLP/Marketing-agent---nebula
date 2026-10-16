const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Demo mode when MONGODB_URI is missing or clearly a placeholder
const isDemoMode = process.env.NODE_ENV !== 'production' && (
  !process.env.MONGODB_URI ||
  process.env.MONGODB_URI.includes('your_mongodb_connection_string_here'));

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

/** What an account waiting to be deleted may still call: its own account routes, who it is, and sign out. */
function _allowedWhileDeleting(url) {
  const path = require('../services/requestPath').normalisePath(url);
  return path !== null && /^\/api\/(account(\/|$)|auth\/(me|logout)$)/.test(path);
}

/** Empty when an agency client pass is still good, otherwise the message to show. */
function _agencyPassProblem(owner, workspace) {
  const ended = 'Your access to this client has ended. Please open it again from your clients list.';
  if (!owner || owner.isActive === false) return ended;
  if (owner.agency && owner.agency.ownerId) return ended; // a client can never be the agency
  if (owner.deletion && owner.deletion.status === 'pending') return ended;
  if (!workspace || !workspace.agency || !workspace.agency.ownerId || String(workspace.agency.ownerId) !== String(owner._id)) return ended;
  if (!owner.plan || owner.plan.tier !== 'agency') return 'The agency plan is not active, so this client is paused. Ask the agency to renew.';
  if (workspace.agency.frozen) return 'This client is over the agency\'s client limit and is paused. Add a client slot to open it.';
  return '';
}

// Protect routes - verify token
const protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized. Please log in to access this resource.'
      });
    }

    // Demo mode: accept simple "demo:<email>" token without JWT/Mongo
    if (isDemoMode) {
      if (!token.startsWith('demo:')) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Please log in again.'
        });
      }
      const email = token.slice(5);
      req.demoEmail = email;
      req.user = { email, isActive: true };
      return next();
    }

    // Normal mode: verify JWT and load user from DB
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user still exists
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'The user belonging to this token no longer exists.'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // An account waiting to be deleted can only see its own status, undo the deletion, or sign out.
    if (user.deletion && user.deletion.status === 'pending' && !_allowedWhileDeleting(req.originalUrl)) {
      return res.status(423).json({ success: false, code: 'deletion_pending', purgeAfter: user.deletion.purgeAfter, message: 'This account is set to be deleted. Sign in and choose Restore if you want to keep it.' });
    }

    // A CSM working inside a client's account: re-check the assignment on every request.
    if (decoded.actingCsm) {
      const { canActFor, isBlockedWhileActing } = require('../services/csmAccess');
      const csm = await User.findById(decoded.actingCsm).select('isCsm staffRole isActive firstName lastName email').lean();
      if (!canActFor(csm, user)) {
        return res.status(401).json({ success: false, message: 'Your access to this client has ended. Please open it again from your client list.' });
      }
      if (isBlockedWhileActing(req.originalUrl, req.method)) {
        return res.status(403).json({ success: false, message: 'Payments, plans and passwords can only be changed by the client.' });
      }
      req.actingCsm = csm;
    }

    // An agency working inside one of its clients: re-check ownership and plan on every request.
    if (decoded.actingAgency) {
      const ws = require('../services/agencyWorkspaces');
      const owner = await User.findById(decoded.actingAgency).select('isActive plan agency.ownerId deletion.status firstName lastName email').lean();
      const problem = _agencyPassProblem(owner, user);
      if (problem) return res.status(401).json({ success: false, message: problem });
      if (ws.isBlockedInsideClient(req.originalUrl, req.method)) {
        return res.status(403).json({ success: false, message: 'Payments, plans and passwords are managed in your agency account. Go back to the agency to change them.' });
      }
      req.actingAgency = owner;
    }

    // Grant access to protected route
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. Please log in again.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Your session has expired. Please log in again.'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Optional auth - doesn't require token but will use it if present
const optionalAuth = async (req, res, next) => {
  try {
    let token;

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      // No token, continue without user
      req.user = null;
      return next();
    }

    // Demo mode: accept simple "demo:<email>" token without JWT/Mongo
    if (isDemoMode) {
      if (token.startsWith('demo:')) {
        const email = token.slice(5);
        req.demoEmail = email;
        req.user = { email, isActive: true };
      } else {
        req.user = null;
      }
      return next();
    }

    // Normal mode: verify token via JWT and DB
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user still exists
    const user = await User.findById(decoded.id);
    if (user && user.isActive) {
      req.user = user;
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    // Token invalid or expired, continue without user
    req.user = null;
    next();
  }
};

module.exports = { generateToken, protect, optionalAuth, _agencyPassProblem, _allowedWhileDeleting };
