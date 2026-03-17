const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Demo mode when MONGODB_URI is missing or clearly a placeholder
const isDemoMode =
  !process.env.MONGODB_URI ||
  process.env.MONGODB_URI.includes('your_mongodb_connection_string_here');

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

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

module.exports = { generateToken, protect, optionalAuth };
