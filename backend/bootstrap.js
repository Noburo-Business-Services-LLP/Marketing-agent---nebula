// bootstrap.js
// Loads secrets from AWS Secrets Manager at container startup and injects them
// into process.env, so the rest of the app just reads process.env.<KEY> as usual.
//
// USAGE (put at the very top of server.js, BEFORE requiring routes / express / etc.):
//
//   require('dotenv').config(); // still keeps local dev working
//   (async () => {
//     await require('./bootstrap').loadSecrets();
//     require('./server-main'); // or inline the rest of server.js here
//   })();
//
// Or, if you want to keep server.js mostly untouched, wrap the whole file:
//
//   (async () => {
//     await require('./bootstrap').loadSecrets();
//     // ... paste existing server.js body here ...
//   })();
//
// Fargate task role must have `secretsmanager:GetSecretValue` for each ARN below.

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const REGION = process.env.AWS_REGION || 'ap-south-1';

// Comma-separated list of secret names/ARNs to load, in order.
// The last one loaded wins for any key collisions (rarely happens).
// Example: AWS_SECRET_IDS=nebulaa/prod/backend-core,nebulaa/prod/backend-integrations
const SECRET_IDS = String(process.env.AWS_SECRET_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// If nothing is configured, we run in "local" mode — .env is enough.
const isLocalMode = SECRET_IDS.length === 0;

// Never overwrite an env var that's already been set explicitly (via task-def
// env, docker-compose env_file, or dotenv). Secrets fill only the gaps.
const OVERWRITE_EXISTING_ENV = String(process.env.SECRETS_OVERWRITE_ENV || 'false').toLowerCase() === 'true';

// Redact secret-shaped values in log output.
function preview(value) {
  const str = String(value || '');
  if (str.length <= 4) return '***';
  return str.slice(0, 3) + '***' + str.slice(-2);
}

async function fetchSecret(client, secretId) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
      // Two shapes: SecretString (JSON or raw) or binary (rare).
      if (res.SecretString) return res.SecretString;
      if (res.SecretBinary) return Buffer.from(res.SecretBinary, 'base64').toString('utf8');
      throw new Error(`Secret ${secretId} has no SecretString/SecretBinary`);
    } catch (err) {
      lastErr = err;
      const retryable = ['ThrottlingException', 'InternalServiceError', 'ServiceUnavailableException']
        .includes(err?.name);
      if (!retryable || attempt === maxAttempts) throw err;
      const wait = 300 * Math.pow(2, attempt - 1);
      console.warn(`[bootstrap] retry ${attempt}/${maxAttempts} for ${secretId} in ${wait}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function parseSecretPayload(raw, secretId) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return {};
  // Prefer JSON — that's the standard Secrets Manager format when you store
  // multiple KV pairs under one secret.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (err) {
      console.warn(`[bootstrap] ${secretId} looked like JSON but failed to parse — treating as raw string`);
    }
  }
  // Fall back: treat the whole secret value as a single env var whose name
  // is the last path segment of the secret ID (kebab → SCREAMING_SNAKE).
  const tail = String(secretId).split('/').pop() || 'SECRET_VALUE';
  const key = tail.replace(/[^a-zA-Z0-9_]+/g, '_').toUpperCase();
  return { [key]: trimmed };
}

async function loadSecrets() {
  if (isLocalMode) {
    console.log('[bootstrap] AWS_SECRET_IDS not set — using local process.env only (dev mode).');
    return { loaded: 0, keys: [] };
  }

  const client = new SecretsManagerClient({ region: REGION });
  const loadedKeys = [];
  const perSecretCounts = {};

  for (const secretId of SECRET_IDS) {
    let payload;
    try {
      const raw = await fetchSecret(client, secretId);
      payload = parseSecretPayload(raw, secretId);
    } catch (err) {
      // Fail fast — a container that half-starts without its secrets is worse
      // than a container that refuses to start. Fargate will restart it.
      console.error(`[bootstrap] FATAL: could not load secret ${secretId}: ${err.message}`);
      throw err;
    }

    let addedFromThisSecret = 0;
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        // Skip nested objects — Secrets Manager JSON should be flat.
        console.warn(`[bootstrap] Skipping non-scalar key "${key}" from ${secretId}`);
        continue;
      }
      const strValue = String(value);
      if (process.env[key] !== undefined && !OVERWRITE_EXISTING_ENV) {
        // Existing env wins (e.g. docker-compose env_file, task-def env).
        continue;
      }
      process.env[key] = strValue;
      loadedKeys.push(key);
      addedFromThisSecret += 1;
    }
    perSecretCounts[secretId] = addedFromThisSecret;
  }

  console.log(`[bootstrap] Loaded ${loadedKeys.length} env var(s) from AWS Secrets Manager (region=${REGION}):`);
  for (const [sid, count] of Object.entries(perSecretCounts)) {
    console.log(`  ${sid}: ${count} key(s)`);
  }
  // One-line audit trail with redacted values — safe for CloudWatch.
  console.log(
    '[bootstrap] injected keys:',
    loadedKeys.map((k) => `${k}=${preview(process.env[k])}`).join(', ')
  );

  return { loaded: loadedKeys.length, keys: loadedKeys };
}

module.exports = { loadSecrets };
