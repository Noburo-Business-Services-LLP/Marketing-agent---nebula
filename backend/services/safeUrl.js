'use strict';
/**
 * One check for every address the server stores from a user or a scraper (docs/superpowers/ops/security-hardening.md,
 * decision D45): http or https only, at most 2048 characters, no user name or password, no spaces or control
 * characters. `javascript:`, `data:` (except a picture where allowed), `vbscript:`, `file:` and every other scheme are
 * refused, so a stored link can never run script when a screen or an email puts it in a link.
 *
 *   safeUrl(v, opts)        the trimmed address when safe, '' when empty, null when refused
 *   safeUrlOrEmpty(v, opts) the same, '' when refused (for scraped data: a bad link is dropped, not stored)
 *   urlSetter(opts)         a mongoose `set` that stores '' instead of a refused address
 *   options: allowBareDomain (a website typed as "example.com"), allowDataImage (a picture stored as a data URL)
 */

const MAX_LENGTH = 2048;
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;
const BARE_DOMAIN = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d{1,5})?([/?#]|$)/i;

function safeUrl(value, { maxLength = MAX_LENGTH, allowBareDomain = false, allowDataImage = false } = {}) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return '';
  if (allowDataImage && /^data:/i.test(v)) return DATA_IMAGE.test(v) ? v : null;
  if (v.length > maxLength) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F]/.test(v)) return null;
  let candidate = v;
  if (!/^https?:\/\//i.test(v)) {
    if (!allowBareDomain || !BARE_DOMAIN.test(v)) return null;
    candidate = `https://${v}`;
  }
  let u;
  try { u = new URL(candidate); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname || !/[a-z0-9]/i.test(u.hostname)) return null;
  return v;
}

/**
 * A value that is not just a badly typed address but a dangerous one: a script or data scheme, markup or quotes, or a
 * user name and password. Routes where a person types a website answer 400 for these; other junk is stored as ''.
 */
function isDangerousUrl(value) {
  if (typeof value !== 'string') return value != null;
  const v = value.trim();
  if (!v) return false;
  // Browsers ignore tabs, new lines and control characters inside a scheme ("java\tscript:"), so drop them first.
  // eslint-disable-next-line no-control-regex
  if (/^(javascript|data|vbscript|file|blob|filesystem|about|jar):/i.test(v.replace(/[\s\u0000-\u001F\u007F]/g, ''))) return true;
  if (/[<>"'`]/.test(v)) return true;
  if (/^https?:\/\/[^/?#]*@/i.test(v)) return true;
  return false;
}

const isSafeUrl = (value, opts) => typeof safeUrl(value, opts) === 'string';
const safeUrlOrEmpty = (value, opts) => safeUrl(value, opts) || '';
const urlSetter = (opts) => function setSafeUrl(v) { return v == null ? v : safeUrlOrEmpty(v, opts); };

const WEBSITE_MESSAGE = 'Please enter a website address such as example.com or https://example.com.';

module.exports = { safeUrl, isSafeUrl, isDangerousUrl, safeUrlOrEmpty, urlSetter, MAX_LENGTH, WEBSITE_MESSAGE };
