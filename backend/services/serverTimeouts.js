'use strict';
/**
 * Connection and request timeouts (docs/superpowers/ops/security-hardening.md, decision D42).
 *
 * Server level (applyServerTimeouts, after listen):
 *   keepAliveTimeout 65 s  above the AWS load balancer's 60 s idle timeout, so the balancer never reuses a closed socket
 *   headersTimeout   66 s  a client must send its headers within this (slow-header attacks)
 *   requestTimeout   SERVER_REQUEST_TIMEOUT_MS, default 300 s: the whole request (headers and body) must arrive within
 *                    this; long because generation uploads are big. Never below headersTimeout.
 *
 * Route level (routeTimeout middleware, on /api): an ordinary route that has not answered within ROUTE_TIMEOUT_MS
 * (default 30 s; 0 switches it off) answers 503 "This is taking longer than expected" and whatever the handler sends
 * later is dropped. Routes that legitimately take long are excluded by prefix: LONG_ROUTE_PREFIXES below
 * (generation, model calls, scraping, uploads, live streams, exports).
 */

const intOr = (v, d, min = 0) => {
  const n = Number.parseInt(String(v == null ? '' : v), 10);
  return Number.isFinite(n) && n >= min ? n : d;
};

function serverTimeoutSettings(env = process.env) {
  const keepAliveTimeout = 65000;
  const headersTimeout = 66000;
  const requestTimeout = Math.max(headersTimeout, intOr(env.SERVER_REQUEST_TIMEOUT_MS, 300000, 1));
  return { keepAliveTimeout, headersTimeout, requestTimeout };
}

function applyServerTimeouts(server, env = process.env) {
  const s = serverTimeoutSettings(env);
  server.keepAliveTimeout = s.keepAliveTimeout;
  server.headersTimeout = s.headersTimeout;
  server.requestTimeout = s.requestTimeout;
  return s;
}

// Excluded from the short route timeout (prefix of the full path). Everything that generates, calls a model or a
// scraper, takes an upload, streams (SSE) or exports. Reviewed 2026-10-20 against server-main.js.
const LONG_ROUTE_PREFIXES = Object.freeze([
  '/api/campaigns', '/api/chat', '/api/seo', '/api/content', '/api/content-calendar', '/api/carousels',
  '/api/create-assist', '/api/video-generation', '/api/hero-video', '/api/videos', '/api/photoshoot', '/api/blueprint',
  '/api/plan', '/api/week', '/api/setup', '/api/drafts', '/api/dashboard', '/api/competitors', '/api/listening',
  '/api/brand-assets', '/api/brand', '/api/products', '/api/ads', '/api/ad-campaigns', '/api/social', '/api/analytics',
  '/api/ai-memory', '/api/home', '/api/google-calendar', '/api/payment', '/api/ideas', '/api/staff', '/api/csm',
  '/api/admin', '/api/generateVideoStylePrompts', '/api/generateSceneDescriptions', '/api/account/export',
  '/api/agency/usage.csv', '/api/auth/complete-onboarding', '/api/auth/update-profile', '/api/auth/signup-brand-colors',
  '/api/influencers', '/api/collaborations', '/api/submissions', '/api/accounts', '/api/support', '/api/auth/verify-gst'
]);

function isLongRoute(p) {
  const s = String(p || '');
  return LONG_ROUTE_PREFIXES.some((x) => s === x || s.startsWith(`${x}/`) || s.startsWith(`${x}?`));
}

const MESSAGE = 'This is taking longer than expected. Please try again in a moment.';
const DROP = ['json', 'send', 'end', 'write', 'status', 'set', 'header', 'setHeader', 'type', 'sendFile', 'redirect', 'writeHead', 'sendStatus'];

function routeTimeout({ env = process.env, ms } = {}) {
  const limit = ms != null ? ms : intOr(env.ROUTE_TIMEOUT_MS, 30000, 0);
  return (req, res, next) => {
    if (!limit || isLongRoute(req.originalUrl || req.path)) return next();
    const timer = setTimeout(() => {
      if (res.headersSent || res.writableEnded) return;
      console.warn(`[timeout] ${req.method} ${req.path} took over ${limit} ms: answered 503`);
      res.status(503).json({ success: false, message: MESSAGE });
      // The handler is still running: whatever it sends later is dropped instead of throwing "headers already sent".
      for (const m of DROP) if (typeof res[m] === 'function') res[m] = function dropped() { return res; };
    }, limit);
    if (typeof timer.unref === 'function') timer.unref();
    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}

module.exports = { applyServerTimeouts, serverTimeoutSettings, routeTimeout, isLongRoute, LONG_ROUTE_PREFIXES, MESSAGE };
