// Write hooks on the User schema that keep the auth cache (services/authCache.js) honest: every save, update, replace,
// delete, bulkWrite or insertMany on a User clears that user's cached entries, both BEFORE the write (so a request
// that reads during the write cannot store the old state) and AFTER it (so nothing loaded meanwhile survives).
// A write whose filter is not a plain `_id` clears the whole cache. The audit found no write to the users collection
// that bypasses the model (docs/superpowers/ops/auth-cache-audit.md).
const { idsInFilter, sharedAuthCache } = require('./authCache');

const MARK = Symbol.for('nebulaa.authCacheHook');
const QUERY_WRITES = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'];
const DOCUMENT_WRITES = ['updateOne', 'deleteOne'];
const MODEL_WRITES = ['bulkWrite', 'insertMany'];

/** The three hook bodies, with the cache to clear passed in (tests use their own). They never throw into a write. */
function createHookFns(getCache = sharedAuthCache) {
  const safely = (fn) => { try { fn(getCache()); } catch (_) { /* a cache problem must never fail a write */ } };
  const onDocument = function onDocument() {
    const id = this && this._id;
    safely((c) => (id ? c.invalidateUser(String(id)) : c.clear()));
  };
  const onQuery = function onQuery() {
    const self = this;
    safely((c) => {
      const filter = self && typeof self.getFilter === 'function' ? self.getFilter() : null;
      const ids = idsInFilter(filter);
      if (!ids) return c.clear();
      for (const id of ids) c.invalidateUser(id);
    });
  };
  const onModel = function onModel() { safely((c) => c.clear()); };
  for (const f of [onDocument, onQuery, onModel]) f[MARK] = true;
  return { onDocument, onQuery, onModel };
}

/** Adds the hooks to a schema. Must run before `mongoose.model(...)` compiles it (models/User.js does this). */
function attachUserCacheHooks(schema, getCache = sharedAuthCache) {
  const { onDocument, onQuery, onModel } = createHookFns(getCache);
  schema.pre('save', onDocument);
  schema.post('save', onDocument);
  for (const op of DOCUMENT_WRITES) {
    schema.pre(op, { document: true, query: false }, onDocument);
    schema.post(op, { document: true, query: false }, onDocument);
  }
  for (const op of QUERY_WRITES) {
    schema.pre(op, { document: false, query: true }, onQuery);
    schema.post(op, { document: false, query: true }, onQuery);
  }
  for (const op of MODEL_WRITES) {
    schema.pre(op, onModel);
    schema.post(op, onModel);
  }
  return schema;
}

module.exports = { attachUserCacheHooks, createHookFns, MARK, QUERY_WRITES, DOCUMENT_WRITES, MODEL_WRITES };
