'use strict';
/**
 * The last error handler of the API. The caller's mistakes are 4xx with plain words; server faults are a plain 500
 * (the real message goes to the log only, customers never see raw system errors).
 *  - Mongoose validation errors (a value the model refuses) are 400 with the field names, not 500.
 *  - Broken JSON is 400, a body over its size limit is 413, a malformed id is 400.
 */
const VALIDATION_MESSAGE = 'Some of the details are not valid. Please check them and try again.';
const INVALID_MESSAGE = 'That request is not valid.';
const TOO_LARGE_MESSAGE = 'That file or request is too large.';
const SERVER_MESSAGE = 'Something went wrong. Please try again.';

const isValidation = (err) => !!err && err.name === 'ValidationError' && !!err.errors && typeof err.errors === 'object';

function statusFor(err) {
  if (!err) return 500;
  if (err.name === 'CastError') return 400;
  if (isValidation(err)) return 400;
  if (err.type === 'entity.parse.failed') return 400;
  const n = Number(err.statusCode || err.status || 500);
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : 500;
}

function messageFor(err, status) {
  if (status === 413) return TOO_LARGE_MESSAGE;
  // A 503 we raised on purpose (password hashing saturated) keeps its plain words; any other 5xx stays generic.
  if (status === 503 && err && err.code === 'PASSWORD_HASH_BUSY') return String(err.message);
  if (status >= 500) return SERVER_MESSAGE;
  if (isValidation(err)) return VALIDATION_MESSAGE;
  if (err && (err.name === 'CastError' || err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported')) return INVALID_MESSAGE;
  return String((err && err.message) || 'Request could not be completed.');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = statusFor(err);
  const message = messageFor(err, status);

  console.error('Server Error:', {
    status,
    method: req.method,
    path: req.path,
    message: String((err && err.message) || message),
    stack: status >= 500 ? err && err.stack : undefined
  });

  const isApiRequest = String(req.path || '').startsWith('/api');
  if (!isApiRequest) return res.status(status).json({ success: false, message });

  return res.status(status).json({
    success: false,
    message,
    fields: isValidation(err) ? Object.keys(err.errors) : undefined,
    errorCode: status >= 500 ? undefined : (err && (err.code || err.name)) || undefined,
    error: process.env.NODE_ENV === 'development' ? ((err && err.stack) || String(err)) : undefined
  });
}

module.exports = { errorHandler, statusFor, messageFor, VALIDATION_MESSAGE, SERVER_MESSAGE };
