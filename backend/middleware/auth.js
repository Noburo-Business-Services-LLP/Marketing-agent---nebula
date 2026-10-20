const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Demo mode when MONGODB_URI is missing or clearly a placeholder
// Read at call time so the live inbox stream and socket hub use the exact same rule (never true in production).
function demoModeActive() {
  return process.env.NODE_ENV !== 'production' && (
    !process.env.MONGODB_URI ||
    process.env.MONGODB_URI.includes('your_mongodb_connection_string_here'));
}
const isDemoMode = demoModeActive();

// Generate JWT Token
// `tokenVersion` is the account's current version (User.tokenVersion): a password change raises it and ends older sessions.
const generateToken = (userId, tokenVersion = 0) => {
  return jwt.sign(
    { id: userId, tv: Number(tokenVersion) || 0 },
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
  if (owner.subscription && owner.subscription.status === 'halted') return 'The agency plan is not active, so this client is paused. Ask the agency to renew.'; // the same test as canPayForClients
  if (workspace.agency.frozen) return 'This client is over the agency\'s client limit and is paused. Add a client slot to open it.';
  return '';
}

/**
 * The checks every way in must make for a token that names a pass: an account waiting to be deleted, a CSM whose
 * assignment ended, an agency pass whose plan, ownership or client state no longer holds. Returns the message to show,
 * or '' when the token is still good. Used by `protect` for the normal API, and by the live inbox stream and socket hub,
 * which would otherwise keep a revoked pass working for hours.
 */
const SESSION_ENDED = 'Your password was changed, so this session has ended. Please sign in again.';
/** A session token (not an agency or CSM pass) older than the account's token version: a password change since. */
function _sessionEnded(decoded, user) {
  if (!decoded || decoded.actingCsm || decoded.actingAgency) return false;
  return (Number(decoded.tv) || 0) < (Number(user && user.tokenVersion) || 0);
}

async function _tokenProblem(decoded, user, { UserModel = User } = {}) {
  if (_sessionEnded(decoded, user)) return SESSION_ENDED;
  if (user.deletion && user.deletion.status === 'pending') return 'This account is set to be deleted.';
  if (decoded && decoded.actingCsm) {
    const { canActFor } = require('../services/csmAccess');
    const csm = await UserModel.findById(decoded.actingCsm).select('isCsm staffRole isActive firstName lastName email').lean();
    if (!canActFor(csm, user)) return 'Your access to this client has ended. Please open it again from your client list.';
  }
  if (decoded && decoded.actingAgency) {
    const owner = await UserModel.findById(decoded.actingAgency).select('isActive plan subscription.status agency.ownerId deletion.status firstName lastName email').lean();
    return _agencyPassProblem(owner, user);
  }
  return '';
}

// Protect routes - verify token. Loads the FULL, fresh user document on every request and never reads the auth cache:
// every money, plan, entitlement and write route uses this. (`createProtect` only lets tests pass a fake model.)
const createProtect = ({ UserModel = User, demoMode = isDemoMode } = {}) => async function protect(req, res, next) {
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
    if (demoMode) {
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
    const user = await UserModel.findById(decoded.id);
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

    // The password was changed after this token was issued: this session has ended.
    if (_sessionEnded(decoded, user)) return res.status(401).json({ success: false, sessionEnded: true, message: SESSION_ENDED });

    // An account waiting to be deleted can only see its own status, undo the deletion, or sign out.
    if (user.deletion && user.deletion.status === 'pending' && !_allowedWhileDeleting(req.originalUrl)) {
      return res.status(423).json({ success: false, code: 'deletion_pending', purgeAfter: user.deletion.purgeAfter, message: 'This account is set to be deleted. Sign in and choose Restore if you want to keep it.' });
    }

    // A CSM working inside a client's account: re-check the assignment on every request.
    if (decoded.actingCsm) {
      const { canActFor, isBlockedWhileActing } = require('../services/csmAccess');
      const csm = await UserModel.findById(decoded.actingCsm).select('isCsm staffRole isActive firstName lastName email').lean();
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
      const owner = await UserModel.findById(decoded.actingAgency).select('isActive plan subscription.status agency.ownerId deletion.status firstName lastName email').lean();
      const problem = _agencyPassProblem(owner, user);
      if (problem) return res.status(401).json({ success: false, message: problem });
      if (ws.isBlockedInsideClient(req.originalUrl, req.method)) {
        return res.status(403).json({ success: false, message: 'Payments, plans and passwords are managed in your agency account. Go back to the agency to change them.' });
      }
      req.actingAgency = owner;
    }

    // Grant access to protected route
    req.user = user;
    req.loadFullUser = async () => user; // already the full, fresh document
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
const protect = createProtect();

// ---------------------------------------------------------------------------------------------------------------------
// protectCached: the same checks and the same answers as `protect`, for HOT READ routes only (session check, credits
// read, notifications, Home summary). The user is read lean with only the fields the checks need, kept for at most
// AUTH_CACHE_TTL_MS (15 s) per token context, and every write to a User clears it (services/authCacheHooks.js).
// `req.user` is a frozen plain object with `_id` (ObjectId) and `id` (string): never a document, never money or plan
// state. A handler that needs the real document calls `await req.loadFullUser()` (always a fresh database read).
// AUTH_CACHE=off makes this exactly `protect`. Design and staleness bound: docs/superpowers/ops/auth-cache.md.
const authCache = require('../services/authCache');

/** What the checks in `protect` read from the account itself (plus the names /me shows for a pass). */
const AUTH_FIELDS = 'email firstName lastName isActive isVerified deletion.status deletion.purgeAfter agency.ownerId agency.frozen staffRole isCsm assignedCsm tokenVersion';
const CSM_FIELDS = 'isCsm staffRole isActive firstName lastName email';
const OWNER_FIELDS = 'isActive plan subscription.status agency.ownerId deletion.status firstName lastName email';

/** A lean read has no schema defaults; fill the ones a full document would have (isActive: true, isCsm: false...). */
function _withDefaults(raw, schema, fields) {
  if (!raw || !schema || typeof schema.path !== 'function') return raw;
  for (const p of fields.split(/\s+/).filter(Boolean)) {
    const type = schema.path(p);
    if (!type || type.defaultValue === undefined || typeof type.defaultValue === 'function') continue;
    const parts = p.split('.');
    let at = raw;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (at[parts[i]] === undefined || at[parts[i]] === null) at[parts[i]] = {};
      at = at[parts[i]];
    }
    const last = parts[parts.length - 1];
    if (at[last] === undefined) at[last] = type.defaultValue;
  }
  return raw;
}

const createProtectCached = ({ UserModel = User, cache = authCache.sharedAuthCache(), demoMode = isDemoMode, settings = () => authCache.settings() } = {}) => {
  const full = createProtect({ UserModel, demoMode });
  return async function protectCached(req, res, next) {
    if (demoMode || !settings().enabled) return full(req, res, next);
    try {
      let token;
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      }
      if (!token) {
        return res.status(401).json({ success: false, message: 'Not authorized. Please log in to access this resource.' });
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const key = authCache.keyFor(decoded);
      let state = cache.get(key);
      const hit = Boolean(state);
      if (!state) {
        const ids = [decoded.id, decoded.actingCsm, decoded.actingAgency].filter(Boolean).map(String);
        const since = cache.ticket();
        const raw = await UserModel.findById(decoded.id).select(AUTH_FIELDS).lean();
        if (!raw) return res.status(401).json({ success: false, message: 'The user belonging to this token no longer exists.' });
        const user = _withDefaults(raw, UserModel.schema, AUTH_FIELDS);
        user.id = String(user._id);
        if (!user.isActive) return res.status(401).json({ success: false, message: 'Your account has been deactivated. Please contact support.' });
        const csm = decoded.actingCsm ? await UserModel.findById(decoded.actingCsm).select(CSM_FIELDS).lean() : null;
        const owner = decoded.actingAgency ? await UserModel.findById(decoded.actingAgency).select(OWNER_FIELDS).lean() : null;
        state = authCache.deepFreeze({ user, csm, owner });
        // Only a state that passes every check that does not depend on the URL is kept; a failure is never cached.
        const { canActFor } = require('../services/csmAccess');
        const good = (!decoded.actingCsm || canActFor(csm, user)) && (!decoded.actingAgency || !_agencyPassProblem(owner, user));
        if (good) cache.set(key, state, ids, since);
      }
      const { user, csm, owner } = state;

      // From here on: the same checks, in the same order, with the same answers as `protect`. The version is checked
      // against the cached account on every request (the cache key is the same for an old and a new token), and a
      // password change is a write to the user, which clears its cached state at once (services/authCacheHooks.js).
      if (_sessionEnded(decoded, user)) return res.status(401).json({ success: false, sessionEnded: true, message: SESSION_ENDED });
      if (user.deletion && user.deletion.status === 'pending' && !_allowedWhileDeleting(req.originalUrl)) {
        return res.status(423).json({ success: false, code: 'deletion_pending', purgeAfter: user.deletion.purgeAfter, message: 'This account is set to be deleted. Sign in and choose Restore if you want to keep it.' });
      }
      if (decoded.actingCsm) {
        const { canActFor, isBlockedWhileActing } = require('../services/csmAccess');
        if (!canActFor(csm, user)) {
          return res.status(401).json({ success: false, message: 'Your access to this client has ended. Please open it again from your client list.' });
        }
        if (isBlockedWhileActing(req.originalUrl, req.method)) {
          return res.status(403).json({ success: false, message: 'Payments, plans and passwords can only be changed by the client.' });
        }
        req.actingCsm = csm;
      }
      if (decoded.actingAgency) {
        const ws = require('../services/agencyWorkspaces');
        const problem = _agencyPassProblem(owner, user);
        if (problem) return res.status(401).json({ success: false, message: problem });
        if (ws.isBlockedInsideClient(req.originalUrl, req.method)) {
          return res.status(403).json({ success: false, message: 'Payments, plans and passwords are managed in your agency account. Go back to the agency to change them.' });
        }
        req.actingAgency = owner;
      }

      req.user = user;
      req.authCached = hit;
      let fullUser = null;
      req.loadFullUser = () => (fullUser = fullUser || Promise.resolve(UserModel.findById(decoded.id))); // fresh, once per request
      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Invalid token. Please log in again.' });
      if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Your session has expired. Please log in again.' });
      return res.status(500).json({ success: false, message: 'Authentication error' });
    }
  };
};
const protectCached = createProtectCached();

/** Use after protectCached on a route that needs the real, fresh Mongoose document (writes, money, plan). */
async function requireFullUser(req, res, next) {
  try {
    const user = req.loadFullUser ? await req.loadFullUser() : null;
    if (!user) return res.status(401).json({ success: false, message: 'The user belonging to this token no longer exists.' });
    req.user = user;
    return next();
  } catch (_) {
    return res.status(500).json({ success: false, message: 'Authentication error' });
  }
}

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
    if (user && user.isActive && !_sessionEnded(decoded, user)) {
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

module.exports = { demoModeActive, generateToken, protect, createProtect, protectCached, createProtectCached, requireFullUser, AUTH_FIELDS, optionalAuth, _agencyPassProblem, _tokenProblem, _allowedWhileDeleting };
