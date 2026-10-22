/**
 * X (Twitter) "bring your own keys" for the social service (required since 31 March 2026).
 * The keys come only from env AYRSHARE_X_API_KEY and AYRSHARE_X_API_SECRET and are never logged,
 * returned or put in error text. When either is missing nothing here changes any request.
 */

const CUSTOMER_TEXT = 'Connecting X is not available right now. Our team has been notified.';

function xKeys(env = process.env) {
  const key = String(env.AYRSHARE_X_API_KEY || '').trim();
  const secret = String(env.AYRSHARE_X_API_SECRET || '').trim();
  return key && secret ? { key, secret } : null;
}

function hasXKeys(env = process.env) { return xKeys(env) !== null; }

/** Both headers or none, never one. */
function xHeaders(env = process.env) {
  const k = xKeys(env);
  return k ? { 'X-Twitter-OAuth1-Api-Key': k.key, 'X-Twitter-OAuth1-Api-Secret': k.secret } : {};
}

const isX = (p) => ['twitter', 'x'].includes(String(p || '').toLowerCase());

function parseBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') { try { return JSON.parse(body); } catch (_) { return null; } }
  return null;
}

/** Does this link (allowedSocial) list involve X, or have no restriction? */
function linkIncludesX(allowedSocial) {
  if (!Array.isArray(allowedSocial) || allowedSocial.length === 0) return true;
  return allowedSocial.some(isX);
}

/** Fields for the linking body: only with both keys and when X can be linked. */
function xLinkFields(allowedSocial, env = process.env) {
  const k = xKeys(env);
  if (!k || !linkIncludesX(allowedSocial)) return {};
  return { twitterApiKey: k.key, twitterApiSecret: k.secret };
}

/** Does a request to the social service target X, or can we not tell (then true)? */
function requestTargetsX(url, options = {}) {
  let u;
  try { u = new URL(url); } catch (_) { return false; }
  if (u.hostname !== 'api.ayrshare.com') return false;
  const path = u.pathname;
  if (/\/profiles(\/|$)/.test(path) || /\/ads\//.test(path)) return false;
  const msg = path.match(/\/messages\/([^/]+)/);
  if (msg) return isX(decodeURIComponent(msg[1]));
  const body = parseBody(options.body);
  let list = null;
  const qp = u.searchParams.get('platforms');
  if (qp) list = qp.split(',');
  else if (body && Array.isArray(body.platforms)) list = body.platforms;
  else if (body && typeof body.platform === 'string') list = [body.platform];
  if (list) return list.some(isX);
  return true;
}

/** Headers to add for a request: only both keys, only when it targets X. */
function xHeadersFor(url, options = {}, env = process.env) {
  return hasXKeys(env) && requestTargetsX(url, options) ? xHeaders(env) : {};
}

/**
 * Reads a failed response. Returns { code, staff, internal, customer } or null when it is not an X key problem.
 * Never includes provider text or secrets.
 */
function mapXError(status, data) {
  const s = Number(status);
  const text = String((data && (data.message || data.error)) || (typeof data === 'string' ? data : '') || '');
  const code = data && data.code;
  let hit = null;
  if (s === 402 || /creditsdepleted|credits depleted/i.test(text)) {
    hit = ['credits', 'X credits are used up', 'X credits depleted (402)'];
  } else if (s === 403 && /callback url/i.test(text)) {
    hit = ['callback', 'X app callback address is not approved', 'X callback URL not approved (403)'];
  } else if (s === 403 && /oauth1|app permissions/i.test(text)) {
    hit = ['permissions', 'X app needs Read and write and Direct message permissions', 'X app OAuth1 permissions missing (403)'];
  } else if ((s === 419 || s === 400) && /twitter|x-twitter|oauth1|api (key|secret)|consumer/i.test(text)) {
    hit = ['keys', 'X is not set up on our social service yet', `X key error (${s})`];
  } else if (code === 402) {
    hit = ['credits', 'X credits are used up', 'X credits depleted (code 402)'];
  }
  if (!hit) return null;
  return { code: hit[0], staff: hit[1] + '.', internal: hit[2], customer: CUSTOMER_TEXT };
}

/** Server log line for an X failure: the reason only. */
function logXFailure(where, mapped) {
  if (mapped) console.error(`[X keys] ${where}: ${mapped.internal}`);
}

module.exports = { xKeys, xHeaders, hasXKeys, xLinkFields, requestTargetsX, xHeadersFor, mapXError, logXFailure, CUSTOMER_TEXT };
