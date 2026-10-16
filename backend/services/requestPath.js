'use strict';
/**
 * One way to read "which route is this request for", shared by every check that decides on the path
 * (the CSM block list, the agency client block list, the deletion allow-list). Express routes on the pathname only,
 * ignoring case and a trailing slash, so the checks must read the same thing:
 *   - an absolute-form request line (`http://host/api/x`) is reduced to its path,
 *   - the query and the fragment are dropped,
 *   - percent-encoding is decoded once,
 *   - the result is lower case, with repeated slashes collapsed and no trailing slash.
 * Returns null when the path cannot be read (for example a broken percent sequence); callers must then fail closed.
 */
function normalisePath(url) {
  let s = String(url == null ? '' : url);
  s = s.split('#')[0].split('?')[0];
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  try { s = decodeURIComponent(s); } catch (_) { return null; }
  s = s.toLowerCase().replace(/\/{2,}/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1) s = s.replace(/\/+$/, '') || '/';
  return s;
}

module.exports = { normalisePath };
