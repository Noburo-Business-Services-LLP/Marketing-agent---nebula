const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

// Loading every model must not make Mongoose warn about a duplicate index ("index: true" or "unique: true" on a field
// plus schema.index() for the same key), and no schema may list the same key with the same options twice.
test('no model declares the same index twice', () => {
  const dir = path.join(__dirname, '..', 'models');
  const warnings = [];
  const onWarning = (w) => { if (/Duplicate schema index/i.test(String(w && w.message))) warnings.push(String(w.message)); };
  process.on('warning', onWarning);
  const duplicates = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) require(path.join(dir, f));
  for (const name of mongoose.modelNames()) {
    const seen = new Set();
    for (const [keys, opts] of mongoose.model(name).schema.indexes()) {
      const sig = JSON.stringify([keys, { u: !!opts.unique, s: !!opts.sparse, p: opts.partialFilterExpression || null, t: opts.expireAfterSeconds === undefined ? null : opts.expireAfterSeconds }]);
      if (seen.has(sig)) duplicates.push(`${name} ${sig}`);
      seen.add(sig);
    }
  }
  return new Promise((resolve) => setImmediate(() => {
    process.removeListener('warning', onWarning);
    assert.deepStrictEqual(duplicates, []);
    assert.deepStrictEqual(warnings, []);
    resolve();
  }));
});
