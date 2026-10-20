'use strict';
/**
 * Cache headers for the files Express itself serves from backend/public (hardening A8). In production nginx serves the
 * web app; this is for a build left in `public`.
 *   - public/assets/<name>-<hash>.<ext> : fingerprinted by the build, so it can never change under its name:
 *     "public, max-age=31536000, immutable".
 *   - index.html : "no-cache" (always revalidated, so a new build is picked up).
 *   - everything else: the default (short revalidation).
 * X-Content-Type-Options: nosniff comes from helmet for every response.
 */

const IMMUTABLE = 'public, max-age=31536000, immutable';
const HASHED = /[.-][A-Za-z0-9_-]{8,}\.(js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|map)$/i;

function cacheControlFor(filePath) {
  const p = String(filePath || '').replace(/\\/g, '/');
  if (/(^|\/)index\.html$/i.test(p)) return 'no-cache';
  if (/(^|\/)assets\//.test(p) && HASHED.test(p)) return IMMUTABLE;
  return null;
}

/** express.static `setHeaders` callback. */
function setStaticHeaders(res, filePath) {
  const value = cacheControlFor(filePath);
  if (value) res.setHeader('Cache-Control', value);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = { setStaticHeaders, cacheControlFor, IMMUTABLE };
