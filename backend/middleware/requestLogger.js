'use strict';
/**
 * One compact line per request (hardening A7): replaces the old console.log of every request.
 *
 *   {"level":30,"time":"...","req":{"id":7,"method":"GET","url":"/api/social/inbox/stream?token=[redacted]"},"res":{"statusCode":200},"responseTime":12,"msg":"GET /api/... 200"}
 *
 * - Headers are not logged at all; the pino redact list (authorization, cookie, query.token, set-cookie) is still set as a
 *   second guard, and the logged URL has any token= value removed (the inbox stream takes its token in the query).
 * - Level by outcome: 5xx and thrown errors "error", 4xx "warn", the rest "info"; the health and ready probes of the load
 *   balancer are "debug" so they stay out of the stream at the default level.
 */
const pinoHttp = require('pino-http');
const logger = require('../utils/logger');

const PROBE = /^\/api\/(health|ready)(\/|\?|$)/;

function createRequestLogger({ log = logger } = {}) {
  return pinoHttp({
    logger: log.raw,
    redact: { paths: logger.REDACT_PATHS, censor: '[redacted]' },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      if (PROBE.test(req.originalUrl || req.url || '')) return 'debug';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${logger.redactUrl((req.originalUrl || req.url || '').split('?')[0])} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${logger.redactUrl((req.originalUrl || req.url || '').split('?')[0])} ${res.statusCode} failed`,
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: logger.redactUrl(req.url || '') }),
      res: (res) => ({ statusCode: res.statusCode }),
      // pino-http invents an Error (with a useless stack) for a plain 5xx answer; only a real error keeps its stack.
      err: (err) => ({ type: err && err.name, message: logger.scrub((err && err.message) || ''), stack: err && !/^failed with status code/.test(err.message || '') ? err.stack : undefined })
    },
    customProps: undefined
  });
}

module.exports = { createRequestLogger };
