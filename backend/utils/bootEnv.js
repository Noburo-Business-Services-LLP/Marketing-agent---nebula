'use strict';
/**
 * Start-up check (B7, docs/superpowers/ops/security-hardening.md section 9). A pure function of the environment, so it
 * is tested without starting the server; server-main.js prints the result and exits non-zero on any error.
 *
 *  - JWT_SECRET missing (any environment): error. Every session would be signed with nothing.
 *  - production: JWT_SECRET shorter than 32 characters, MONGODB_URI missing (or the .env.example placeholder),
 *    HASH_PEPPER missing: error.
 *  - development: the same gaps only warn, so local work keeps going (HASH_PEPPER is then derived from JWT_SECRET).
 */
const MIN_SECRET = 32;
const PLACEHOLDER_URI = 'your_mongodb_connection_string_here';

const filled = (v) => typeof v === 'string' && v.trim() !== '';

function validateBootEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const production = env.NODE_ENV === 'production';
  const secret = filled(env.JWT_SECRET) ? env.JWT_SECRET : '';

  if (!secret) errors.push('JWT_SECRET is not set. Set a random value of at least 32 characters (openssl rand -hex 32).');
  else if (secret.length < MIN_SECRET) {
    (production ? errors : warnings).push(`JWT_SECRET is shorter than ${MIN_SECRET} characters${production ? '' : ' (allowed outside production)'}.`);
  }

  const uri = filled(env.MONGODB_URI) && !env.MONGODB_URI.includes(PLACEHOLDER_URI) ? env.MONGODB_URI : '';
  if (!uri) (production ? errors : warnings).push(production ? 'MONGODB_URI is not set: the database is required in production.' : 'MONGODB_URI is not set: nothing will be saved.');

  if (!filled(env.HASH_PEPPER)) {
    if (production) errors.push('HASH_PEPPER is not set: it keys the one-way hashes kept after an account is deleted and the visitor-address hashes. Set a random value of at least 32 characters.');
    else warnings.push('HASH_PEPPER is not set: derived from JWT_SECRET for development.');
  } else if (env.HASH_PEPPER.length < MIN_SECRET) warnings.push(`HASH_PEPPER is shorter than ${MIN_SECRET} characters.`);

  if (production && filled(env.ALLOW_DEMO_AUTH)) warnings.push('ALLOW_DEMO_AUTH is ignored in production.');

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateBootEnv, MIN_SECRET };
