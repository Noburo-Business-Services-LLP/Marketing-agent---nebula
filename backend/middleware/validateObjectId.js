'use strict';
/**
 * Route parameters that name a MongoDB document must be 24 hex characters. Anything else is a plain 400 before any
 * query runs, so a bad id never reaches Mongoose (no "Cast to ObjectId failed" text, no 500) and an operator object
 * can never be passed as an id.
 *
 *   applyObjectIdParams(router)                          // the default names
 *   applyObjectIdParams(router, ['id', 'noteId'])        // only the names that are ObjectIds in THIS router
 *
 * A router whose `:id` is a slug, a uuid or a provider id must not use it for that name (see the per-router lists).
 */
const DEFAULT_NAMES = ['id', 'campaignId', 'draftId', 'itemId', 'postId', 'jobId', 'userId'];
const HEX24 = /^[a-f0-9]{24}$/i;

const isObjectIdString = (v) => typeof v === 'string' && HEX24.test(v);

function applyObjectIdParams(router, names = DEFAULT_NAMES) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => {
      if (isObjectIdString(value)) return next();
      return res.status(400).json({ success: false, message: 'Invalid id', errorCode: 'INVALID_ID' });
    });
  }
  return router;
}

module.exports = { applyObjectIdParams, isObjectIdString, DEFAULT_NAMES };
