'use strict';
/**
 * Which browser origins may call the API, and what a refused origin gets.
 *  - No Origin header (server to server, curl, same-origin GET, mobile): allowed.
 *  - Allowed origin: CORS headers are sent. Local development: any port on localhost / 127.0.0.1, never in production.
 *  - Any other origin: the cors package is told "not allowed" (it adds no CORS headers, never throws a 500), and
 *    rejectDisallowedOrigin answers /api calls with 403 { success:false, message:'Origin not allowed' }, preflight too.
 */
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;

function isOriginAllowed(origin, allowedOrigins, env = process.env) {
  if (!origin) return true;
  if (env.NODE_ENV !== 'production' && LOCAL_DEV_ORIGIN.test(origin)) return true;
  return allowedOrigins.includes(origin);
}

function corsOptions(allowedOrigins, env = process.env) {
  return {
    origin(origin, callback) {
      // A refused origin is a normal answer (no CORS headers), not an Error, so it can never become a 500.
      callback(null, isOriginAllowed(origin, allowedOrigins, env));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  };
}

/** Mount BEFORE cors(): the cors package would otherwise answer a refused preflight with a bare 204. */
function rejectDisallowedOrigin(allowedOrigins, env = process.env) {
  return function corsGate(req, res, next) {
    const origin = req.headers.origin;
    if (!origin || isOriginAllowed(origin, allowedOrigins, env)) return next();
    if (String(req.path || req.url || '').startsWith('/api')) {
      console.warn(`CORS refused origin: ${String(origin).slice(0, 200)}`);
      return res.status(403).json({ success: false, message: 'Origin not allowed' });
    }
    return next();
  };
}

module.exports = { isOriginAllowed, corsOptions, rejectDisallowedOrigin };
