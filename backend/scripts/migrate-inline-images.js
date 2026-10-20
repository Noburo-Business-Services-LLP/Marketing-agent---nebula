/**
 * Move base64 pictures out of existing documents and compact stored provider answers (impact map inline-images.md
 * section 5, decisions D105 and D106; owner steps in docs/superpowers/ops/inline-images.md).
 *
 * DRY RUN BY DEFAULT: counts the documents and bytes that WOULD be saved; nothing is uploaded or written.
 *   node scripts/migrate-inline-images.js                      dry run on nebulaa_dev
 *   CONFIRM_MIGRATE=yes node scripts/migrate-inline-images.js  act on nebulaa_dev
 * Any other database is refused, except: ALLOW_PROD_MIGRATION=yes alone allows a DRY RUN there (reads only), and
 * acting there needs ALLOW_PROD_MIGRATION=yes AND CONFIRM_MIGRATE=yes. The owner decides production; the assistant
 * never sets these.
 *
 * Options (environment):
 *   MIGRATE_COLLECTIONS=drafts,campaigns   which collections (default: drafts, campaigns, ai_content_performance, ai_campaign_history)
 *   MIGRATE_MAX_BATCHES=5                  stop after this many batches per collection (default: no limit)
 *   MIGRATE_SLEEP_MS=1500                  pause between batches (default 1500)
 *   MIGRATE_BACKUP_CAP_BYTES=262144        keep the old value in legacyInline.* only while the document stays under this
 *                                          (default 256 KB; above it only the sha256 and size are kept: the HEAD-checked
 *                                          link is the picture, and a bigger backup would keep the document heavy)
 *   MIGRATE_RESTART=yes                    ignore the saved cursor (retry everything; idempotent)
 *   node scripts/migrate-inline-images.js drop-backups   (after checking) remove legacyInline.*; dry run unless CONFIRM_MIGRATE=yes
 * Batches of 20 by _id ascending, maxTimeMS on every read, cursor saved after every batch in
 * backend/temp/migrate-inline-images.state.json (acting only), every uploaded link checked with HEAD (2xx, image/*)
 * before it replaces anything, every update conditional on the document not having changed (updatedAt).
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { compactAnswer, capMessage, isCompact, MAX_MESSAGE } = require('../services/providerAnswer');

const DEV_DB = 'nebulaa_dev';
const BATCH = 20;
const MAX_TIME_MS = 60000;
const STATE_FILE = path.join(__dirname, '..', 'temp', 'migrate-inline-images.state.json');
const ANSWER_THRESHOLD = 2048; // bytes: a stored answer above this is fetched and checked with isCompact

// What each collection holds. pictures: uploaded and replaced by the link. linksOnly: copies of a picture another
// document holds: data URIs are dropped. answers: compacted. messages: data URIs removed, cut to 500.
const SPECS = {
  drafts: { pictures: ['imageUrl', 'imageUrlNoLogo', 'creative.imageUrls'], slides: 'carouselSlides', messages: ['errorMessage'] },
  campaigns: { pictures: ['creative.imageUrls'], answers: ['publishResult'], messages: ['lastPublishError'] },
  ai_content_performance: { linksOnly: ['assets.images', 'assets.thumbnails', 'assets.videos'] },
  ai_campaign_history: { linksOnly: ['generatedImages'], answers: ['sourceResponse'] }
};

const isDataUri = (v) => typeof v === 'string' && /^\s*data:/i.test(v);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const bytesOf = (v) => (v == null ? 0 : Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v)));
const safeKey = (p) => p.replace(/\./g, '_');

/** Database rule. Returns { ok, act, reason }. Exported for tests. */
function databaseRule(dbName, env = process.env) {
  const confirm = env.CONFIRM_MIGRATE === 'yes';
  const allowProd = env.ALLOW_PROD_MIGRATION === 'yes';
  if (dbName === DEV_DB) return { ok: true, act: confirm };
  if (!allowProd) return { ok: false, reason: `Refusing: database is ${dbName}, not ${DEV_DB} (set ALLOW_PROD_MIGRATION=yes for a dry run there; the owner decides)` };
  return { ok: true, act: confirm };
}

/** Server-side expression: does this document need work? (only small booleans travel back) */
function needsExpression(spec) {
  const str = (e) => ({ $and: [{ $eq: [{ $type: e }, 'string'] }, { $eq: [{ $substrCP: [e, 0, 5] }, 'data:'] }] });
  const anyIn = (e, inner) => ({ $cond: [{ $isArray: e }, { $anyElementTrue: [{ $map: { input: e, as: 'x', in: inner } }] }, false] });
  const pic = (p) => ({ $or: [str(`$${p}`), anyIn(`$${p}`, str('$$x'))] });
  const ors = [];
  for (const p of [...(spec.pictures || []), ...(spec.linksOnly || [])]) ors.push(pic(p));
  if (spec.slides) ors.push(anyIn(`$${spec.slides}`, str('$$x.imageUrl')));
  for (const p of spec.answers || []) ors.push({ $gt: [{ $bsonSize: { x: { $ifNull: [`$${p}`, null] } } }, ANSWER_THRESHOLD] });
  for (const p of spec.messages || []) ors.push({ $and: [{ $eq: [{ $type: `$${p}` }, 'string'] }, { $gt: [{ $strLenCP: `$${p}` }, MAX_MESSAGE] }] });
  return { $or: ors };
}

/**
 * Work out the change for one document (pure apart from `store`/`head`, which are only called when acting).
 * Returns { set, unset, savedBytes, pictures: { stored, failed, refused }, touched }.
 */
async function planDocument(doc, spec, { act, store, head, backupCap, logger = console }) {
  const set = {};
  const out = { set, savedBytes: 0, pictures: { found: 0, stored: 0, failed: 0, refused: 0 }, touched: [] };
  const cache = new Map();
  const backups = {};

  const storeOne = async (uri) => {
    const key = sha256(uri);
    if (cache.has(key)) return cache.get(key);
    let url = null;
    if (!act) url = 'https://dry-run.invalid/x'.padEnd(90, 'x');
    else {
      try {
        const r = await store.storeImage(uri, { folder: 'nebula-migrated' });
        if (r && r.stored && /^https:\/\//i.test(r.url)) {
          if (await head(r.url)) { url = r.url; out.pictures.stored += 1; } else { out.pictures.failed += 1; logger.warn(`[migrate] HEAD failed for ${r.url}`); }
        } else out.pictures.failed += 1;
      } catch (e) {
        if (e && e.code === 'type') out.pictures.refused += 1; else out.pictures.failed += 1;
        logger.warn(`[migrate] ${doc._id}: picture not stored (${(e && e.code) || 'error'})`);
      }
    }
    cache.set(key, url);
    return url;
  };
  const note = (p, oldValue, newValue) => {
    set[p] = newValue;
    out.touched.push(p);
    out.savedBytes += Math.max(0, bytesOf(oldValue) - bytesOf(newValue));
    backups[p] = oldValue;
  };

  for (const p of spec.pictures || []) {
    const v = get(doc, p);
    if (isDataUri(v)) {
      out.pictures.found += 1;
      const url = await storeOne(v);
      if (url) note(p, v, url);
    } else if (Array.isArray(v) && v.some(isDataUri)) {
      const next = [];
      let changed = false;
      for (const x of v) {
        if (!isDataUri(x)) { next.push(x); continue; }
        out.pictures.found += 1;
        const url = await storeOne(x);
        if (url) { next.push(url); changed = true; } else next.push(x);
      }
      if (changed) note(p, v, next);
    }
  }
  if (spec.slides && Array.isArray(doc[spec.slides])) {
    for (let i = 0; i < doc[spec.slides].length; i++) {
      const v = doc[spec.slides][i] && doc[spec.slides][i].imageUrl;
      if (!isDataUri(v)) continue;
      out.pictures.found += 1;
      const url = await storeOne(v);
      if (url) note(`${spec.slides}.${i}.imageUrl`, v, url);
    }
  }
  for (const p of spec.linksOnly || []) {
    const v = get(doc, p);
    if (Array.isArray(v) && v.some(isDataUri)) note(p, v, v.filter((x) => typeof x === 'string' && /^https?:\/\//i.test(x)));
  }
  for (const p of spec.answers || []) {
    const v = get(doc, p);
    if (v != null && !isCompact(v)) note(p, v, compactAnswer(v));
  }
  for (const p of spec.messages || []) {
    const v = get(doc, p);
    if (typeof v === 'string' && (v.length > MAX_MESSAGE || /data:[^,]*;base64,/i.test(v))) note(p, v, capMessage(v));
  }

  // Backups: the old value when the document stays under the cap, else its hash and size.
  const newSize = Math.max(0, bytesOf(doc) - out.savedBytes);
  let budget = backupCap - newSize;
  for (const [p, old] of Object.entries(backups)) {
    const b = bytesOf(old);
    if (b <= budget) { set[`legacyInline.${safeKey(p)}`] = old; budget -= b; } else {
      set[`legacyInline.${safeKey(p)}Sha256`] = sha256(typeof old === 'string' ? old : JSON.stringify(old));
      set[`legacyInline.${safeKey(p)}Bytes`] = b;
    }
  }
  if (out.touched.length) set['legacyInline.migratedAt'] = new Date();
  return out;
}

function readState(file = STATE_FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; } }
function writeState(state, file = STATE_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

/**
 * Run over one collection. deps: { db, ObjectId, store, head, sleep, logger, filter, stateFile, env }.
 * Returns the totals.
 */
async function migrateCollection(name, { db, ObjectId, act, store, head, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), logger = console, filter = {}, stateFile = STATE_FILE, env = process.env }) {
  const spec = SPECS[name];
  if (!spec) throw new Error(`Unknown collection ${name}`);
  const coll = db.collection(name);
  const maxBatches = Number(env.MIGRATE_MAX_BATCHES) > 0 ? Number(env.MIGRATE_MAX_BATCHES) : Infinity;
  const pause = Number(env.MIGRATE_SLEEP_MS) >= 0 && env.MIGRATE_SLEEP_MS !== undefined ? Number(env.MIGRATE_SLEEP_MS) : 1500;
  const backupCap = Number(env.MIGRATE_BACKUP_CAP_BYTES) > 0 ? Number(env.MIGRATE_BACKUP_CAP_BYTES) : 256 * 1024;
  const state = act && env.MIGRATE_RESTART !== 'yes' ? readState(stateFile) : {};
  let last = state[name] ? new ObjectId(state[name]) : null;
  const totals = { collection: name, scanned: 0, needing: 0, changed: 0, skippedChanged: 0, savedBytes: 0, pictures: { found: 0, stored: 0, failed: 0, refused: 0 }, fields: {}, batches: 0 };
  const needs = needsExpression(spec);

  for (let b = 0; b < maxBatches; b++) {
    const match = { ...filter, ...(last ? { _id: { $gt: last } } : {}) };
    const page = await coll.aggregate([{ $match: match }, { $sort: { _id: 1 } }, { $limit: BATCH }, { $project: { _id: 1, needs } }], { maxTimeMS: MAX_TIME_MS }).toArray();
    if (!page.length) break;
    totals.batches += 1;
    totals.scanned += page.length;
    const ids = page.filter((r) => r.needs).map((r) => r._id);
    totals.needing += ids.length;
    if (ids.length) {
      const docs = await coll.find({ _id: { $in: ids } }, { maxTimeMS: MAX_TIME_MS }).toArray();
      for (const doc of docs) {
        const plan = await planDocument(doc, spec, { act, store, head, backupCap, logger });
        for (const k of Object.keys(plan.pictures)) totals.pictures[k] += plan.pictures[k];
        if (!plan.touched.length) continue;
        for (const p of plan.touched) totals.fields[p.replace(/\.\d+\./, '.N.')] = (totals.fields[p.replace(/\.\d+\./, '.N.')] || 0) + 1;
        totals.savedBytes += plan.savedBytes;
        if (!act) { totals.changed += 1; continue; }
        const guard = { _id: doc._id, ...(doc.updatedAt ? { updatedAt: doc.updatedAt } : {}) };
        const r = await coll.updateOne(guard, { $set: plan.set });
        if (r && r.modifiedCount) totals.changed += 1; else totals.skippedChanged += 1;
      }
    }
    last = page[page.length - 1]._id;
    if (act) { const s = readState(stateFile); s[name] = String(last); writeState(s, stateFile); }
    if (page.length < BATCH) break;
    if (pause > 0) await sleep(pause);
  }
  return totals;
}

/** After the owner has checked the moved pictures: remove the legacyInline backups, in the same bounded batches. */
async function dropBackups(name, { db, act, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), filter = {}, env = process.env }) {
  const coll = db.collection(name);
  const maxBatches = Number(env.MIGRATE_MAX_BATCHES) > 0 ? Number(env.MIGRATE_MAX_BATCHES) : Infinity;
  const pause = env.MIGRATE_SLEEP_MS !== undefined && Number(env.MIGRATE_SLEEP_MS) >= 0 ? Number(env.MIGRATE_SLEEP_MS) : 1500;
  let last = null;
  const totals = { collection: name, scanned: 0, withBackup: 0, dropped: 0, bytes: 0 };
  for (let b = 0; b < maxBatches; b++) {
    const match = { ...filter, ...(last ? { _id: { $gt: last } } : {}) };
    const page = await coll.aggregate([{ $match: match }, { $sort: { _id: 1 } }, { $limit: BATCH },
      { $project: { _id: 1, backup: { $cond: [{ $eq: [{ $type: '$legacyInline' }, 'object'] }, { $bsonSize: '$legacyInline' }, 0] } } }], { maxTimeMS: MAX_TIME_MS }).toArray();
    if (!page.length) break;
    totals.scanned += page.length;
    const ids = page.filter((r) => r.backup > 0).map((r) => r._id);
    totals.withBackup += ids.length;
    totals.bytes += page.reduce((n, r) => n + (r.backup || 0), 0);
    if (act && ids.length) totals.dropped += (await coll.updateMany({ _id: { $in: ids } }, { $unset: { legacyInline: '' } })).modifiedCount || 0;
    last = page[page.length - 1]._id;
    if (page.length < BATCH) break;
    if (pause > 0) await sleep(pause);
  }
  return totals;
}

/** HEAD check of a stored link: https, 2xx, an image type. */
async function headOk(url, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!/^https:\/\//i.test(String(url))) return false;
  try {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return res.status >= 200 && res.status < 300 && /^image\//i.test(String(res.headers.get('content-type') || ''));
  } catch (_) { return false; }
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

async function main() {
  require('dotenv').config();
  const mongoose = require('mongoose');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  const rule = databaseRule(mongoose.connection.name);
  if (!rule.ok) { await mongoose.disconnect(); throw new Error(rule.reason); }
  const imageStore = require('../services/imageStore');
  if (rule.act && !imageStore.isConfigured()) { await mongoose.disconnect(); throw new Error('Refusing to act: picture storage (Cloudinary) is not configured, nothing could be moved.'); }
  const names = (process.env.MIGRATE_COLLECTIONS || Object.keys(SPECS).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  if (process.argv[2] === 'drop-backups') {
    console.log(`${rule.act ? 'DROPPING BACKUPS' : 'DRY RUN of drop-backups'} on ${mongoose.connection.name}: ${names.join(', ')}\n`);
    for (const name of names) {
      const t = await dropBackups(name, { db: mongoose.connection.db, ObjectId: mongoose.Types.ObjectId, act: rule.act });
      console.log(`## ${name}: scanned ${t.scanned}; ${t.withBackup} with a backup (${mb(t.bytes)}); ${rule.act ? `dropped ${t.dropped}` : 'nothing dropped (dry run)'}`);
    }
    await mongoose.disconnect();
    return;
  }
  console.log(`${rule.act ? 'MIGRATING' : 'DRY RUN (nothing uploaded or written)'} on ${mongoose.connection.name}: ${names.join(', ')}\n`);
  for (const name of names) {
    const t = await migrateCollection(name, { db: mongoose.connection.db, ObjectId: mongoose.Types.ObjectId, act: rule.act, store: imageStore, head: (u) => headOk(u) });
    console.log(`## ${name}: scanned ${t.scanned} in ${t.batches} batches; ${t.needing} need work; ${rule.act ? 'changed' : 'would change'} ${t.changed}${t.skippedChanged ? ` (${t.skippedChanged} changed meanwhile, retried next run)` : ''}; ${rule.act ? 'saved' : 'would save'} ${mb(t.savedBytes)}`);
    console.log(`   pictures: ${t.pictures.found} found${rule.act ? `, ${t.pictures.stored} stored, ${t.pictures.failed} failed, ${t.pictures.refused} refused` : ''}; fields: ${JSON.stringify(t.fields)}`);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (e) => { console.error(e.message); process.exit(1); });
}

module.exports = { SPECS, databaseRule, needsExpression, planDocument, migrateCollection, dropBackups, headOk, readState, writeState, DEV_DB };
