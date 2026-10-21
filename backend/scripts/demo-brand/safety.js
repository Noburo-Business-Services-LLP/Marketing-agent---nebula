'use strict';
/**
 * The guard rails of the demo brand seed. Pure: no database, no network, no environment reads.
 *  - Only the development database `nebulaa_dev`, checked from the address BEFORE connecting and again after.
 *  - Only the fake address demo-zaya@example.test.
 *  - The password file must sit outside the repository.
 *  - Picture links only on this computer (http://localhost:<port>).
 *  - Every row the seed makes carries a marker, so `remove` deletes exactly those rows.
 */
const crypto = require('crypto');
const path = require('path');
const { isDemoProfileKey } = require('../../services/demoProfile');

const DEV_DB = 'nebulaa_dev';
const DEMO_EMAIL = 'demo-zaya@example.test';
const DEMO_TAG = 'demo-zaya';
// The fake social profile key: starts with `demo-`, so the app never calls the provider for it (D112).
const PROFILE_KEY = 'demo-zaya-naturals';
const DEFAULT_ASSET_BASE = 'http://localhost:5000';
// Where the pictures are served: <asset base>/demo-assets/<brand slug>/...
const ASSET_PATH = '/demo-assets/zaya';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const fail = (msg) => { throw new Error(msg); };

/** The database named in a MongoDB address (mongodb:// or mongodb+srv://), or '' when none is named. */
function dbNameFromUri(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(String(uri || '').trim());
  return m ? decodeURIComponent(m[1]) : '';
}

/** Before connecting: an address must be set and must name nebulaa_dev exactly. Never echoes the address. */
function assertDevUri(uri) {
  if (!uri || typeof uri !== 'string' || !uri.trim()) fail('MONGODB_URI is not set, so nothing was done.');
  if (dbNameFromUri(uri) !== DEV_DB) fail(`Refusing: this script only runs on the database named ${DEV_DB}. Nothing was changed.`);
}

/** After connecting: the connection itself must be on nebulaa_dev. */
function assertDevTarget(dbName) {
  if (dbName !== DEV_DB) fail(`Refusing: this script only runs on the database named ${DEV_DB}. Nothing was changed.`);
}

const emailOk = (email) => email === DEMO_EMAIL;

/** The password file must be given as an absolute path outside this repository (so it can never be committed). */
function passwordFileOk(file, repoRoot = REPO_ROOT) {
  if (!file || typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const rel = path.relative(path.resolve(repoRoot), path.resolve(file));
  return rel.startsWith('..') || path.isAbsolute(rel);
}

/** Picture links may only point at this computer. */
const assetBaseOk = (base) => /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(String(base || ''));

/** A readable random password: no look-alike characters (O 0 I l 1), grouped with dashes. */
function makePassword(bytes = crypto.randomBytes(15)) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const alphabet = letters + digits;
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  // The app's password rule needs a letter and a number (utils/passwordPolicy.js): make sure of both.
  if (!chars.some((c) => digits.includes(c))) chars[1] = digits[bytes[1] % digits.length];
  if (!chars.some((c) => letters.includes(c))) chars[0] = letters[bytes[0] % letters.length];
  const s = chars.join('');
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}`;
}

/** `create|remove|status` plus `--password-file <path>` (or `=path`) and `--asset-base <url>`. */
function parseArgs(argv = []) {
  const mode = argv[0];
  const flag = (name) => {
    const i = argv.findIndex((x) => x === `--${name}` || x.startsWith(`--${name}=`));
    if (i < 0) return '';
    const a = argv[i];
    return a.includes('=') ? a.slice(a.indexOf('=') + 1) : (argv[i + 1] || '');
  };
  return { mode, passwordFile: flag('password-file'), assetBase: flag('asset-base') || DEFAULT_ASSET_BASE };
}

// ---- markers: how each collection's demo rows are recognised (all of them also belong to the demo user)
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ASSET_RE = new RegExp(`${escape(ASSET_PATH)}/`);
const MARKERS = Object.freeze({
  BrandAsset: { field: 'user', tag: { cloudinaryPublicId: new RegExp(`^${DEMO_TAG}/`) } },
  Product: { field: 'user', tag: { imageUrl: ASSET_RE } },
  QuarkLedger: { field: 'user', tag: { ref: new RegExp(`^${DEMO_TAG}:`) } },
  // One per account, made by the seed with the brand's colours and fonts (it has no free field for a tag).
  BrandIntelligenceProfile: { field: 'userId', tag: {} },
  // Stage 2 (content). Posts carry a link to a demo picture; Campaigns and measured rows a fake provider post id.
  Draft: { field: 'userId', tag: { imageUrl: ASSET_RE } },
  Campaign: { field: 'userId', tag: { socialPostId: new RegExp(`^${DEMO_TAG}-post-`) } },
  ContentCalendar: { field: 'userId', tag: { coverImageUrl: ASSET_RE } },
  Blueprint: { field: 'userId', tag: { blueprintId: new RegExp(`^${DEMO_TAG}-`) } },
  AIContentPerformance: { field: 'userId', tag: { postId: new RegExp(`^${DEMO_TAG}-post-`) } },
  // The demo account is skipped by every background job, so these two hold only what the seed (and the app's own
  // brand memory run) wrote for it.
  SocialSnapshot: { field: 'userId', tag: {} },
  AIBrandMemory: { field: 'userId', tag: {} },
});

/** The query for the demo rows of one collection. */
function markerFilter(model, userId) {
  const m = MARKERS[model];
  if (!m) fail(`No demo marker for ${model}.`);
  return { [m.field]: userId, ...m.tag };
}

/** True when a plain row (as the seed builds it) carries the marker of its collection. Used by the tests. */
function hasMarker(model, row) {
  const m = MARKERS[model];
  if (!m || !row) return false;
  return Object.entries(m.tag).every(([k, re]) => re.test(String(row[k] || '')));
}

/** The demo account: only the fake address with the fake profile key. */
const isDemoUser = (user) => Boolean(user && user.email === DEMO_EMAIL && isDemoProfileKey(user.ayrshare && user.ayrshare.profileKey));

const tagRef = (ref) => `${DEMO_TAG}:${ref}`;
const assetUrl = (base, rel) => `${base}${ASSET_PATH}/${rel}`;

module.exports = {
  DEV_DB, DEMO_EMAIL, DEMO_TAG, PROFILE_KEY, DEFAULT_ASSET_BASE, ASSET_PATH, REPO_ROOT, MARKERS,
  dbNameFromUri, assertDevUri, assertDevTarget, emailOk, passwordFileOk, assetBaseOk, makePassword, parseArgs,
  markerFilter, hasMarker, isDemoUser, tagRef, assetUrl
};
