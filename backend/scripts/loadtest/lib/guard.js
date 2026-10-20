'use strict';
/**
 * The load tools never touch a real database except the development one. `assertSafeDatabase(uri)` is called before
 * anything starts: no URI means the in-memory stand-ins (allowed); a URI is allowed only when its database name is
 * exactly nebulaa_dev; anything else (production, a shared name, no name) throws. The development database shares a
 * cluster with production, so even then the tools in this folder do not write to it: they strip the URI and run in memory.
 * For real-database numbers use scripts/bench-local.js, which has the same refusal plus its own cleanup.
 */
const DEV_DB = 'nebulaa_dev';

function databaseName(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(String(uri || '').trim());
  return m ? decodeURIComponent(m[1]) : '';
}

function assertSafeDatabase(uri) {
  if (!uri || !String(uri).trim()) return { store: 'memory' };
  const name = databaseName(uri);
  if (name !== DEV_DB) throw new Error(`Refusing: MONGODB_URI points at database "${name || '(none)'}", not ${DEV_DB}. The load tools run on in-memory stores; unset MONGODB_URI or point it at ${DEV_DB}.`);
  return { store: 'dev-uri-ignored', database: name };
}

/** Local ports the tools must never use. */
const RESERVED_PORTS = new Set([3000, 3200, 5000]);

module.exports = { assertSafeDatabase, databaseName, DEV_DB, RESERVED_PORTS };
