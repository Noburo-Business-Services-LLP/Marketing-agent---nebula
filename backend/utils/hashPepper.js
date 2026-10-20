'use strict';
/**
 * The key for one-way hashes the app keeps (G7): deletion records and tombstones (services/accountDeletion.js), the
 * visitor-address hash of free Blueprints (services/blueprint/service.js) and the sign-in lockout keys
 * (services/loginGuard.js). No literal fallback any more.
 *
 *  - HASH_PEPPER when set (required in production: the start-up check refuses to start without it).
 *  - Development without it: derived from JWT_SECRET (logged once), so local runs keep working.
 *  - Neither (only in tests or scripts that set nothing): a random key for this process, logged once.
 *
 * Earlier records were keyed with JWT_SECRET itself, so `verificationKeys()` also returns JWT_SECRET (the "legacy"
 * key) for LOOKUPS: a person deleted before this change is still recognised. New records use the primary key only.
 */
const crypto = require('crypto');

const filled = (v) => typeof v === 'string' && v.trim() !== '';
let told = false;
let randomKey = null;
const tell = (msg) => { if (!told) { told = true; console.warn(`[hash pepper] ${msg}`); } };

function primaryKey(env = process.env) {
  if (filled(env.HASH_PEPPER)) return env.HASH_PEPPER;
  if (env.NODE_ENV === 'production') throw new Error('HASH_PEPPER is required in production');
  if (filled(env.JWT_SECRET)) {
    tell('HASH_PEPPER is not set: using a key derived from JWT_SECRET (development only).');
    return crypto.createHmac('sha256', env.JWT_SECRET).update('nebulaa-hash-pepper-v1').digest('hex');
  }
  tell('neither HASH_PEPPER nor JWT_SECRET is set: using a random key for this process (hashes will not match after a restart).');
  randomKey = randomKey || crypto.randomBytes(32).toString('hex');
  return randomKey;
}

/** Every key a stored hash may have been made with: the primary first, then JWT_SECRET (records made before G7). */
function verificationKeys(env = process.env) {
  const keys = [primaryKey(env)];
  if (filled(env.JWT_SECRET) && !keys.includes(env.JWT_SECRET)) keys.push(env.JWT_SECRET);
  return keys;
}

const hmacWith = (key, value) => crypto.createHmac('sha256', key).update(String(value)).digest('hex');

module.exports = { primaryKey, verificationKeys, hmacWith };
