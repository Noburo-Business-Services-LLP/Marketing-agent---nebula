'use strict';
/**
 * The one way the API reads a session token from a request (B6). `Authorization: Bearer <token>`: the word Bearer in
 * any case, at least one space, then exactly one token with no spaces. Anything else (`Bearerx <token>`, `Bearer`,
 * `Bearer a b`, `Basic ...`) is no token at all. Used by protect, protectCached, optionalAuth, the admin bootstrap
 * check, the per-user limiter key, the live inbox stream and the socket hub handshake.
 */
const BEARER = /^Bearer\s+(\S+)$/i;
const SINGLE_TOKEN = /^\S+$/;

/** The token from an Authorization header value, or '' when the value is not exactly "Bearer <token>". */
function bearerFromHeader(value) {
  if (typeof value !== 'string') return '';
  const m = BEARER.exec(value);
  return m ? m[1] : '';
}

/** The bearer token of a request (Express or a socket.io handshake: anything with `headers`), or ''. */
function extractBearer(req) {
  return bearerFromHeader(req && req.headers ? req.headers.authorization : undefined);
}

/** A token passed on its own (a query or handshake field): one string with no spaces, else ''. */
function plainToken(value) {
  return typeof value === 'string' && SINGLE_TOKEN.test(value) ? value : '';
}

module.exports = { extractBearer, bearerFromHeader, plainToken, BEARER };
