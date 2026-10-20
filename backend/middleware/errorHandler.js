'use strict';
/**
 * The last error handler of the API. The caller's mistakes are 4xx with plain words; server faults are a plain 500
 * (the real message goes to the log only, customers never see raw system errors, stacks or paths in ANY environment).
 * The mapping lives in utils/httpError.js (shared with the route handlers):
 *  - Mongoose validation errors are 400 with the field names, a malformed id is 400, a duplicate key is 409,
 *    broken JSON is 400, a body over its size limit is 413.
 */
const { describe, logError, statusFor, messageFor, VALIDATION_MESSAGE, SERVER_MESSAGE } = require('../utils/httpError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const { status, body } = describe(err);
  logError(err, { status, method: req.method, path: req.path });

  const isApiRequest = String(req.path || '').startsWith('/api');
  if (!isApiRequest) return res.status(status).json({ success: false, message: body.message });
  return res.status(status).json(body);
}

module.exports = { errorHandler, statusFor, messageFor, VALIDATION_MESSAGE, SERVER_MESSAGE };
