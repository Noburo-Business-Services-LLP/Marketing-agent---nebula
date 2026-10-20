'use strict';
/**
 * One place that turns an error into a safe HTTP answer.
 *  - Mongoose CastError / ValidationError -> 400 (field names only for validation)
 *  - duplicate key (MongoServerError 11000) -> 409
 *  - body too large -> 413, broken JSON -> 400
 *  - everything else -> 500 with plain words
 * The real error goes to the server log only. The response never carries err.message, err.stack or file paths,
 * in any environment. `errorCode` is a fixed short code that is safe to show to a developer.
 */
const VALIDATION_MESSAGE = 'Some of the details are not valid. Please check them and try again.';
const INVALID_MESSAGE = 'That request is not valid.';
const DUPLICATE_MESSAGE = 'That already exists.';
const TOO_LARGE_MESSAGE = 'That file or request is too large.';
const SERVER_MESSAGE = 'Something went wrong. Please try again.';

const isValidation = (err) => !!err && err.name === 'ValidationError' && !!err.errors && typeof err.errors === 'object';
const isDuplicate = (err) => !!err && Number(err.code) === 11000 && (err.name === 'MongoServerError' || err.name === 'MongoError' || err.name === 'BulkWriteError' || !!err.keyPattern || !!err.keyValue);
const isBadJson = (err) => !!err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err));
const isTooLarge = (err) => !!err && (err.type === 'entity.too.large' || err.name === 'PayloadTooLargeError' || Number(err.status || err.statusCode) === 413);

function statusFor(err) {
  if (!err) return 500;
  if (err.name === 'CastError') return 400;
  if (isValidation(err)) return 400;
  if (isBadJson(err)) return 400;
  if (isDuplicate(err)) return 409;
  if (isTooLarge(err)) return 413;
  const n = Number(err.statusCode || err.status || 500);
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : 500;
}

function messageFor(err, status) {
  if (status === 413) return TOO_LARGE_MESSAGE;
  // A 503 we raised on purpose (password hashing saturated) keeps its plain words; any other 5xx stays generic.
  if (status === 503 && err && err.code === 'PASSWORD_HASH_BUSY') return String(err.message);
  if (status >= 500) return SERVER_MESSAGE;
  if (isValidation(err)) return VALIDATION_MESSAGE;
  if (isDuplicate(err)) return DUPLICATE_MESSAGE;
  if (err && (err.name === 'CastError' || isBadJson(err) || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported')) {
    return isBadJson(err) ? 'Invalid JSON' : INVALID_MESSAGE;
  }
  return String((err && err.message) || 'Request could not be completed.');
}

function errorCodeFor(err, status) {
  if (err && err.name === 'CastError') return 'INVALID_ID';
  if (isValidation(err)) return 'VALIDATION_ERROR';
  if (isDuplicate(err)) return 'DUPLICATE_KEY';
  if (isBadJson(err)) return 'INVALID_JSON';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status >= 500) return 'SERVER_ERROR';
  // An error we raised ourselves may carry a short string code (never a number or the exception's own name).
  return err && typeof err.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(err.code) ? err.code : 'REQUEST_ERROR';
}

function logError(err, context) {
  const status = context && context.status;
  console.error('Server Error:', {
    status,
    method: context && context.method,
    path: context && context.path,
    name: err && err.name,
    message: String((err && err.message) || err),
    stack: status >= 500 && err ? err.stack : undefined
  });
}

/** The JSON body for an error: no err.message, err.stack or paths. */
function describe(err, publicMessage) {
  const status = statusFor(err);
  let message = messageFor(err, status);
  // Our own handlers pass the plain words of their screen for a plain 500 ("Failed to load campaigns").
  if (status === 500 && publicMessage) message = publicMessage;
  const body = { success: false, message, errorCode: errorCodeFor(err, status) };
  if (isValidation(err)) body.fields = Object.keys(err.errors);
  return { status, body };
}

/** `catch (err) { return fail(res, err, 'Failed to load campaigns'); }` */
function fail(res, err, publicMessage) {
  const { status, body } = describe(err, publicMessage);
  const req = res && res.req;
  logError(err, { status, method: req && req.method, path: req && String(req.originalUrl || req.path || '').split('?')[0] });
  if (res.headersSent) return res;
  return res.status(status).json(body);
}

module.exports = { fail, describe, logError, statusFor, messageFor, errorCodeFor, VALIDATION_MESSAGE, INVALID_MESSAGE, DUPLICATE_MESSAGE, TOO_LARGE_MESSAGE, SERVER_MESSAGE };
