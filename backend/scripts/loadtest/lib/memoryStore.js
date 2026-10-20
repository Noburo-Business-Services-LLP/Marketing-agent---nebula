'use strict';
/**
 * In-memory stand-ins for the data layer, so the real app can be loaded without any database. Every model except User
 * answers reads with empty results (or the rows a flow supplies) and swallows writes; User is the in-memory store of
 * tests/helpers/authHttp.js. What this measures is the app layer: middleware, auth, validation, serialisation,
 * JSON and password hashing. It does NOT measure MongoDB; for that run the same flows against a local server on the
 * development database with scripts/bench-local.js.
 */
const mongoose = require('mongoose');

const READ_ONE = ['findOne', 'findById'];
const READ_MANY = ['find', 'distinct'];
const COUNT = ['countDocuments', 'estimatedDocumentCount'];
const WRITE_ONE = ['findOneAndUpdate', 'findByIdAndUpdate', 'findOneAndDelete', 'findByIdAndDelete', 'findOneAndReplace'];
const WRITE_RESULT = ['updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne', 'bulkWrite', 'insertMany'];

/** A chainable, awaitable query that resolves to `value()`. */
function fakeQuery(value) {
  const q = {};
  for (const m of ['select', 'sort', 'limit', 'skip', 'lean', 'populate', 'hint', 'maxTimeMS', 'allowDiskUse', 'session', 'read', 'collation', 'comment', 'batchSize', 'where', 'projection']) q[m] = () => q;
  q.exec = () => Promise.resolve(value());
  q.then = (ok, ko) => Promise.resolve().then(() => value()).then(ok, ko);
  q.catch = (ko) => q.then(undefined, ko);
  q.finally = (f) => q.then((v) => { f(); return v; }, (e) => { f(); throw e; });
  q.cursor = () => ({ async *[Symbol.asyncIterator]() { for (const r of value() || []) yield r; }, close: async () => {} });
  return q;
}

/**
 * @param {object} rows   { ModelName: { methodName: () => value } } overrides, for example { Draft: { aggregate: () => [...] } }
 * @returns {() => void}  restore function
 */
function installEmptyModels(rows = {}, { exclude = ['User'] } = {}) {
  const saved = [];
  const swap = (obj, name, fn) => { saved.push([obj, name, obj[name]]); obj[name] = fn; };
  for (const name of mongoose.modelNames()) {
    if (exclude.includes(name)) continue;
    const M = mongoose.model(name);
    const own = rows[name] || {};
    const val = (method, dflt) => (own[method] ? own[method] : () => dflt());
    for (const m of READ_ONE) swap(M, m, (...a) => fakeQuery(() => val(m, () => null)(...a)));
    for (const m of READ_MANY) swap(M, m, (...a) => fakeQuery(() => val(m, () => [])(...a)));
    for (const m of COUNT) swap(M, m, (...a) => fakeQuery(() => val(m, () => 0)(...a)));
    for (const m of WRITE_ONE) swap(M, m, (...a) => fakeQuery(() => val(m, () => null)(...a)));
    for (const m of WRITE_RESULT) swap(M, m, () => fakeQuery(() => ({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, deletedCount: 0 })));
    swap(M, 'aggregate', (...a) => fakeQuery(() => val('aggregate', () => [])(...a)));
    swap(M, 'populate', async (docs) => docs);
    swap(M, 'exists', (...a) => fakeQuery(() => val('exists', () => null)(...a)));
    swap(M, 'create', async (d) => d);
    swap(M.prototype, 'save', async function save() { return this; });
  }
  return () => { for (const [obj, name, fn] of saved.reverse()) obj[name] = fn; };
}

module.exports = { installEmptyModels, fakeQuery };
