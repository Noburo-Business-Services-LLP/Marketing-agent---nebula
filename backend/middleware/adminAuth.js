const jwt = require('jsonwebtoken');

const adminAuth = (req, res, next) => {
  const token = require('../utils/bearer').extractBearer(req); // strict "Bearer <token>" (B6)
  if (!token) return res.status(401).json({ error: 'Admin access required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
};

module.exports = adminAuth;
