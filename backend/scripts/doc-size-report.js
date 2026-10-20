/**
 * Read-only document size report (inline images impact map). Which fields make documents big, per collection.
 *
 * DEVELOPMENT DATABASE ONLY: refuses any database whose name is not exactly nebulaa_dev. The dev cluster is shared
 * with production, so this script is gentle on purpose:
 *   - collection totals come from `$collStats` (metadata, no scan);
 *   - field sizes come from a BOUNDED sample: the newest N documents by `_id` (index walk, `$limit` right after the
 *     `$sort`) plus the newest N older than OLDER_DAYS (also an `_id` index range), N <= 50, every aggregate with
 *     `maxTimeMS`; the sizes are computed in the database with `$bsonSize`, so only small numbers travel back;
 *   - NEVER a full collection scan, never a write.
 *
 *   node scripts/doc-size-report.js                 default collections, N = 20
 *   SAMPLE_N=30 node scripts/doc-size-report.js     larger sample (capped at 50)
 *   node scripts/doc-size-report.js drafts campaigns  only these collections
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DEV_DB = 'nebulaa_dev';
const MAX_TIME_MS = 15000;
const N = Math.min(50, Math.max(1, Number(process.env.SAMPLE_N) || 20));
const OLDER_DAYS = 90;
// Sub-documents broken down one level further (field -> its own keys).
const NESTED = ['creative', 'publishResult', 'generationProgress', 'socialPostIds', 'rawAnalytics', 'metrics', 'carouselSlides', 'posts', 'days', 'items', 'weeks', 'rawProfile', 'assets'];
const DEFAULT_COLLECTIONS = ['drafts', 'campaigns', 'contentcalendars', 'ai_content_performance', 'home_drafts', 'video_drafts', 'contentdrafts',
  'cachedcampaigns', 'products', 'brandprofiles', 'brandassets', 'weekly_proposals', 'photoshoot_jobs', 'image_jobs', 'studio_videos', 'users'];

/** Pure: turn per-document field size rows into a ranked table. Exported for the unit test. */
function summarise(rows) {
  const fields = new Map();
  let total = 0;
  for (const r of rows) {
    total += r.total || 0;
    for (const f of r.fields || []) {
      const cur = fields.get(f.k) || { field: f.k, bytes: 0, docs: 0, max: 0, dataUris: 0 };
      cur.bytes += f.v || 0; cur.docs += 1; cur.max = Math.max(cur.max, f.v || 0); cur.dataUris += f.d ? 1 : 0;
      fields.set(f.k, cur);
    }
  }
  const list = [...fields.values()].sort((a, b) => b.bytes - a.bytes);
  return { docs: rows.length, avg: rows.length ? Math.round(total / rows.length) : 0, total, fields: list.map((f) => ({ ...f, share: total ? f.bytes / total : 0, avg: rows.length ? Math.round(f.bytes / rows.length) : 0 })) };
}

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

/** Pipeline stages that compute, per document, the BSON size of every top-level field and of the NESTED sub-fields. */
function sizeStages() {
  const strUri = (expr) => ({ $and: [{ $eq: [{ $type: expr }, 'string'] }, { $eq: [{ $substrCP: [expr, 0, 5] }, 'data:'] }] });
  // A data URI as the value itself, or as any element of an array value (creative.imageUrls).
  const isDataUri = (expr) => ({ $or: [strUri(expr), { $and: [{ $eq: [{ $type: expr }, 'array'] }, { $anyElementTrue: [{ $map: { input: expr, as: 'u', in: strUri('$$u') } }] }] }] });
  const nestedFields = NESTED.map((n) => ({
    $cond: [{ $eq: [{ $type: `$${n}` }, 'object'] },
      { $map: { input: { $objectToArray: `$${n}` }, as: 's', in: { k: { $concat: [n, '.', '$$s.k'] }, v: { $bsonSize: { $arrayToObject: [[{ k: 'x', v: '$$s.v' }]] } }, d: isDataUri('$$s.v') } } },
      { $cond: [{ $eq: [{ $type: `$${n}` }, 'array'] },
        [{ k: `${n}[]`, v: { $bsonSize: { x: `$${n}` } }, d: { $anyElementTrue: [{ $map: { input: `$${n}`, as: 'e', in: { $or: [strUri('$$e'), strUri('$$e.imageUrl')] } } }] } }],
        []] }]
  }));
  return [
    { $project: {
      total: { $bsonSize: '$$ROOT' },
      top: { $map: { input: { $objectToArray: '$$ROOT' }, as: 'f', in: { k: '$$f.k', v: { $bsonSize: { $arrayToObject: [[{ k: 'x', v: '$$f.v' }]] } }, d: isDataUri('$$f.v') } } },
      nested: { $concatArrays: nestedFields }
    } },
    { $project: { total: 1, fields: { $concatArrays: ['$top', '$nested'] } } }
  ];
}

async function sampleCollection(db, name, n = N, maxTimeMS = MAX_TIME_MS) {
  const coll = db.collection(name);
  let stats = null;
  try {
    const [s] = await coll.aggregate([{ $collStats: { storageStats: {} } }], { maxTimeMS: MAX_TIME_MS }).toArray();
    stats = s && s.storageStats ? { count: s.storageStats.count, avgObjSize: s.storageStats.avgObjSize || 0, size: s.storageStats.size } : null;
  } catch (e) { stats = { error: e.message }; }
  if (!stats || !stats.count) return { name, stats, sample: summarise([]) };
  const older = mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - OLDER_DAYS * 864e5) / 1000));
  const newest = await coll.aggregate([{ $sort: { _id: -1 } }, { $limit: n }, ...sizeStages()], { maxTimeMS }).toArray();
  const old = await coll.aggregate([{ $match: { _id: { $lt: older } } }, { $sort: { _id: -1 } }, { $limit: n }, ...sizeStages()], { maxTimeMS }).toArray();
  return { name, stats, sample: summarise([...newest, ...old]), newest: newest.length, older: old.length };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder so .env is found).');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  if (mongoose.connection.name !== DEV_DB) throw new Error(`Refusing: database is ${mongoose.connection.name}, not ${DEV_DB}`);
  const db = mongoose.connection.db;
  const wanted = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_COLLECTIONS;
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  console.log(`Document size report on ${DEV_DB}: newest ${N} by _id plus newest ${N} older than ${OLDER_DAYS} days, per collection (maxTimeMS ${MAX_TIME_MS}).\n`);
  for (const name of wanted) {
    if (!existing.has(name)) { console.log(`## ${name}: (no such collection)\n`); continue; }
    try {
      let r;
      try { r = await sampleCollection(db, name); } catch (e) {
        // Very heavy documents (campaigns about 1.7 MB each) are slow to read cold: retry once with a smaller sample.
        if (!/time limit/i.test(e.message)) throw e;
        console.log(`  (${name}: ${N} docs timed out; retrying with 5 per slice and 45 s)`);
        r = await sampleCollection(db, name, 5, 45000);
      }
      const st = r.stats && !r.stats.error ? `${r.stats.count} docs, collection avg ${kb(r.stats.avgObjSize)}, data ${kb(r.stats.size)}` : `stats unavailable${r.stats && r.stats.error ? `: ${r.stats.error}` : ''}`;
      console.log(`## ${name}: ${st}; sample ${r.sample.docs} docs (${r.newest || 0} newest + ${r.older || 0} older), sample avg ${kb(r.sample.avg)}`);
      for (const f of r.sample.fields.filter((x) => x.bytes > 0).slice(0, 12)) {
        console.log(`  ${f.field.padEnd(38)} total ${kb(f.bytes).padStart(10)}  avg/doc ${kb(f.avg).padStart(10)}  max ${kb(f.max).padStart(10)}  ${(f.share * 100).toFixed(1).padStart(5)}%${f.dataUris ? `  data-URI in ${f.dataUris}` : ''}`);
      }
      console.log('');
    } catch (e) {
      console.log(`## ${name}: sample failed: ${e.message}\n`);
    }
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (e) => { console.error(e.message); try { await mongoose.disconnect(); } catch { /* ignore */ } process.exit(1); });
}

module.exports = { summarise, sizeStages, DEV_DB };
