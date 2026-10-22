'use strict';
/**
 * The one logger (hardening A7). JSON lines through pino, level from LOG_LEVEL (default "info"; "silent" under
 * NODE_ENV=test unless LOG_LEVEL is set).
 *
 * `log` has console-shaped methods (log.info / warn / error / debug take printf-style arguments), so replacing a
 * console call is a rename. Every message goes through scrub(): a "token=<value>" in a URL and a "Bearer <token>"
 * never reach the output. An Error as the first argument is logged as `err` (name, message, stack).
 *
 * `raw` is the pino instance (pino-http needs it). Redaction of structured fields is set here and in
 * middleware/requestLogger.js.
 */
const util = require('util');
const pino = require('pino');

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.query.token',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'query.token',
  'headers["X-Twitter-OAuth1-Api-Key"]',
  'headers["X-Twitter-OAuth1-Api-Secret"]',
  'headers["x-twitter-oauth1-api-key"]',
  'headers["x-twitter-oauth1-api-secret"]',
  'AYRSHARE_X_API_KEY',
  'AYRSHARE_X_API_SECRET',
  'twitterApiKey',
  'twitterApiSecret'
];

/** Remove secrets from a text: ?token=... / &token=... / "token": "..." values and Bearer tokens. */
function scrub(text) {
  return String(text)
    .replace(/([?&;]|\b)(token|access_token|refresh_token|id_token|api_key|apikey|password|secret)=([^&\s"'#]+)/gi, (m, pre, name) => `${pre}${name}=[redacted]`)
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]');
}

/** Remove the query string's token from a URL (other parameters stay). */
function redactUrl(url) {
  return scrub(url);
}

function levelFromEnv(env = process.env) {
  const v = String(env.LOG_LEVEL || '').trim().toLowerCase();
  if (['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(v)) return v;
  return env.NODE_ENV === 'test' ? 'silent' : 'info';
}

function createLogger({ level = levelFromEnv(), destination } = {}) {
  const raw = pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: undefined, // no pid/hostname on every line: the platform adds the task to each stream
    timestamp: pino.stdTimeFunctions.isoTime
  }, destination);

  const emit = (lvl) => (...args) => {
    if (!raw.isLevelEnabled(lvl)) return;
    if (args.length === 1 && String(args[0]).trim() === '') return; // a blank spacer line has no place in a JSON stream
    if (args[0] instanceof Error) {
      const err = args.shift();
      raw[lvl]({ err }, scrub(args.length ? util.format(...args) : err.message));
      return;
    }
    // A trailing Error (console.error('text', err)) is logged as err too.
    const last = args[args.length - 1];
    if (args.length > 1 && last instanceof Error) {
      args.pop();
      raw[lvl]({ err: last }, scrub(util.format(...args)));
      return;
    }
    raw[lvl](scrub(util.format(...args)));
  };

  const log = {
    raw,
    level: () => raw.level,
    fatal: emit('fatal'),
    error: emit('error'),
    warn: emit('warn'),
    info: emit('info'),
    debug: emit('debug'),
    trace: emit('trace'),
    // console-shaped alias so a logger can be handed to code that expects `logger.log(...)`
    log: emit('info')
  };
  return log;
}

const log = createLogger();

module.exports = log;
module.exports.log = log;
module.exports.createLogger = createLogger;
module.exports.scrub = scrub;
module.exports.redactUrl = redactUrl;
module.exports.levelFromEnv = levelFromEnv;
module.exports.REDACT_PATHS = REDACT_PATHS;
