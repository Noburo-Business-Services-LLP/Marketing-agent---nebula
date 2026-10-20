'use strict';
/**
 * The API's request limits (docs/superpowers/ops/performance-week1.md).
 *
 *  - general: every /api request, per address (unchanged: 2000 per 15 minutes, cheap polling GETs skipped).
 *  - credential: ONLY the routes that take a password or a code (sign-in, sign-up, sending and checking codes,
 *    password reset and change). Two buckets: per address AND account (20 per 15 minutes; an office behind one
 *    address no longer shares one bucket) and a per-address safety cap across accounts (100). Session checks such as
 *    /auth/me and sign-out are never counted. The account lock after 5 wrong passwords still applies on top.
 *  - social: per signed-in user (300 per 15 minutes) plus a per-address safety cap (1000), instead of 30 per address.
 *  - ai: unchanged, per address.
 * Counters: RATE_LIMIT_STORE (memory by default; `mongo` shares them across every task, `redis` when REDIS_URL is set).
 * Every limiter of the app, these and the route-local ones, is made through services/rateLimitStore.js.
 *
 * The client address comes from `trust proxy` = TRUST_PROXY_HOPS (default 1: the AWS load balancer appends the real
 * address as the last X-Forwarded-For entry). If requests reach this server through a second proxy (the frontend
 * nginx), set TRUST_PROXY_HOPS=2. /api/health/details shows the address the server sees.
 */
const rateLimit = require('../services/rateLimitStore').rateLimit;
const jwt = require('jsonwebtoken');

const { ipKeyGenerator } = rateLimit;
const WINDOW_MS = 15 * 60 * 1000;
const CREDENTIAL_PATHS = new Set(['/login', '/signup', '/send-otp', '/verify-otp', '/forgot-password', '/verify-reset-otp', '/reset-password', '/change-password']);
const CREDENTIAL_MESSAGE = 'Too many sign-in attempts. Please wait a few minutes and try again.';
const SOCIAL_MESSAGE = 'Too many social media requests, please try again later.';

function trustProxySetting(env = process.env) {
  const n = Number.parseInt(String(env.TRUST_PROXY_HOPS == null ? '' : env.TRUST_PROXY_HOPS), 10);
  if (!Number.isFinite(n)) return 1;
  if (n <= 0) return false;
  return Math.min(n, 5);
}

/** A POST to one of the credential routes of /api/auth (req.path is relative to the mount). */
function isCredentialRequest(req) {
  return req.method === 'POST' && CREDENTIAL_PATHS.has(String(req.path || '').replace(/\/+$/, ''));
}

const addressKey = (req) => ipKeyGenerator(String(req.ip || ''));

/** The signed-in user's id from the bearer token (signature checked, no database read), or ''. */
function tokenUserId(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  if (!h.startsWith('Bearer ') || !process.env.JWT_SECRET) return '';
  try {
    const decoded = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    return String((decoded && (decoded.id || decoded.userId)) || '');
  } catch (_) { return ''; }
}

/** Which account an attempt is for: the email in the body (normalised), else the signed-in user. */
function accountKey(req) {
  const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
  return email ? `e:${email}` : (tokenUserId(req) ? `u:${tokenUserId(req)}` : 'none');
}

const answer = (message) => ({ success: false, message, error: message });

function createRateLimits({
  windowMs = WINDOW_MS,
  generalMax = 2000,
  aiMax = 100,
  credentialMax = 20,
  credentialIpMax = 100,
  socialUserMax = 300,
  socialIpMax = 1000
} = {}) {
  const base = { windowMs, standardHeaders: true, legacyHeaders: false };

  const general = rateLimit({
    ...base,
    name: 'general',
    max: generalMax,
    message: { error: 'Too many requests, please try again later.' },
    keyGenerator: addressKey,
    skip: (req) => {
      const url = String(req.originalUrl || '');
      if (req.method !== 'GET') return false;
      return url.startsWith('/api/notifications') || url.startsWith('/api/credits') || url.startsWith('/api/video-generation/jobs/');
    }
  });

  const ai = rateLimit({ ...base, name: 'ai', max: aiMax, message: { error: 'Too many AI generation requests, please try again later.' }, keyGenerator: addressKey });

  const credentialIp = rateLimit({ ...base, name: 'credential-ip', max: credentialIpMax, message: answer(CREDENTIAL_MESSAGE), keyGenerator: addressKey });
  const credentialAccount = rateLimit({ ...base, name: 'credential-account', max: credentialMax, message: answer(CREDENTIAL_MESSAGE), keyGenerator: (req) => `${addressKey(req)}|${accountKey(req)}` });
  const runCredential = (req, res, next) => credentialIp(req, res, (err) => (err ? next(err) : credentialAccount(req, res, next)));

  const socialIp = rateLimit({ ...base, name: 'social-ip', max: socialIpMax, message: answer(SOCIAL_MESSAGE), keyGenerator: addressKey });
  const socialUser = rateLimit({ ...base, name: 'social-user', max: socialUserMax, message: answer(SOCIAL_MESSAGE), keyGenerator: (req) => { const id = tokenUserId(req); return id ? `u:${id}` : `a:${addressKey(req)}`; } });

  return {
    general,
    ai,
    /** For /api/auth: limits only the credential routes. */
    credential: (req, res, next) => (isCredentialRequest(req) ? runCredential(req, res, next) : next()),
    /** For a router whose every route is a credential route (/api/admin: the bootstrap sign-in). */
    credentialAll: runCredential,
    social: (req, res, next) => socialIp(req, res, (err) => (err ? next(err) : socialUser(req, res, next)))
  };
}

module.exports = { createRateLimits, trustProxySetting, isCredentialRequest, accountKey, tokenUserId, CREDENTIAL_PATHS };
