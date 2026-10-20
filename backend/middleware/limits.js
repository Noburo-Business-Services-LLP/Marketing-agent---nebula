'use strict';
/**
 * Shared request limits for the routes that call paid AI, scrapers, storage or ad spend
 * (docs/superpowers/ops/security-hardening.md, decision D39).
 *
 * Counted per SIGNED-IN USER (the id in the Bearer token, signature checked, no database read), so a whole office
 * behind one address is not throttled together; a request without a valid token is counted per address. The webhook
 * limiter is per address on purpose (the providers call without a user token).
 *
 *   limiter   default                 env (max / window in ms)
 *   heavyAi   30 per 15 minutes       LIMIT_HEAVY_AI_MAX / LIMIT_HEAVY_AI_WINDOW_MS   image, video, post and campaign generation
 *   lightAi   100 per 15 minutes      LIMIT_LIGHT_AI_MAX / LIMIT_LIGHT_AI_WINDOW_MS   suggestions, summaries, reading files
 *   upload    20 per 15 minutes       LIMIT_UPLOAD_MAX / LIMIT_UPLOAD_WINDOW_MS       file and picture uploads
 *   spend     10 per 15 minutes       LIMIT_SPEND_MAX / LIMIT_SPEND_WINDOW_MS         actions that spend real ad money (Meta)
 *   scrape    20 per hour             LIMIT_SCRAPE_MAX / LIMIT_SCRAPE_WINDOW_MS       paid scraping (competitor discovery and scans)
 *   webhook   300 per minute per IP   LIMIT_WEBHOOK_MAX / LIMIT_WEBHOOK_WINDOW_MS     provider webhooks
 *
 * Every limiter is made through services/rateLimitStore.js (RATE_LIMIT_STORE: memory, mongo or redis), with a stable
 * name, so with the shared store every task counts in the same bucket. The module-level limiters are single instances:
 * a route file and server-main.js that both require this file use the same counters.
 */
const rateLimit = require('../services/rateLimitStore').rateLimit;
const { tokenUserId } = require('./rateLimits');

const { ipKeyGenerator } = rateLimit;
const MIN = 60 * 1000;

const DEFAULTS = Object.freeze({
  heavyAi: { max: 30, windowMs: 15 * MIN, env: 'HEAVY_AI', message: 'Too many generation requests. Please wait a few minutes and try again.' },
  lightAi: { max: 100, windowMs: 15 * MIN, env: 'LIGHT_AI', message: 'Too many requests. Please wait a few minutes and try again.' },
  upload: { max: 20, windowMs: 15 * MIN, env: 'UPLOAD', message: 'Too many uploads. Please wait a few minutes and try again.' },
  spend: { max: 10, windowMs: 15 * MIN, env: 'SPEND', message: 'Too many ad actions. Please wait a few minutes and try again.' },
  scrape: { max: 20, windowMs: 60 * MIN, env: 'SCRAPE', message: 'Too many scans. Please try again later.' },
  webhook: { max: 300, windowMs: MIN, env: 'WEBHOOK', message: 'Too many requests.' }
});

const positiveInt = (v) => {
  const n = Number.parseInt(String(v == null ? '' : v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The effective numbers for each limiter: env values when they are positive whole numbers, else the defaults. */
function limitSettings(env = process.env) {
  const out = {};
  for (const [name, d] of Object.entries(DEFAULTS)) {
    out[name] = {
      max: positiveInt(env[`LIMIT_${d.env}_MAX`]) || d.max,
      windowMs: positiveInt(env[`LIMIT_${d.env}_WINDOW_MS`]) || d.windowMs,
      message: d.message
    };
  }
  return out;
}

const addressKey = (req) => `ip:${ipKeyGenerator(String(req.ip || ''))}`;
/** "u:<user id>" from a valid Bearer token, else "ip:<address>". */
function userKey(req) {
  const id = tokenUserId(req);
  return id ? `u:${id}` : addressKey(req);
}

function createLimits({ env = process.env, prefix = 'limits' } = {}) {
  const s = limitSettings(env);
  const make = (name, keyGenerator) => rateLimit({
    name: `${prefix}-${name}`,
    windowMs: s[name].windowMs,
    max: s[name].max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    message: { success: false, message: s[name].message, error: s[name].message }
  });
  const L = {
    heavyAi: make('heavyAi', userKey),
    lightAi: make('lightAi', userKey),
    upload: make('upload', userKey),
    spend: make('spend', userKey),
    scrape: make('scrape', userKey),
    webhook: make('webhook', addressKey)
  };
  /** For a mount where reads are free and every write may spend money (ad campaigns). */
  L.spendWrites = (req, res, next) => (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? next() : L.spend(req, res, next));
  /** Count only the requests `test(req)` picks (for example an idea saved with a picture is an upload). */
  L.when = (test, limiter) => (req, res, next) => (test(req) ? limiter(req, res, next) : next());
  L.settings = s;
  return L;
}

/** The provider webhooks of the inbox (not /webhooks/register, which a signed-in user calls). Path relative to the mount. */
const isInboxWebhook = (req) => /^\/webhooks\/(?!register\/?$)/.test(String(req.path || ''));
/** For the /api/social/inbox mount: the social limiter for user calls; webhooks have their own per-address limiter. */
const exceptInboxWebhooks = (limiter) => (req, res, next) => (isInboxWebhook(req) ? next() : limiter(req, res, next));

const shared = createLimits();

module.exports = { ...shared, createLimits, limitSettings, userKey, isInboxWebhook, exceptInboxWebhooks, DEFAULTS };
