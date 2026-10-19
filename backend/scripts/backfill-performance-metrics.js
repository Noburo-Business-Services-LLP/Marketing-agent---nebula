/**
 * Recompute `metrics` (and the learning score and tier) of existing `ai_content_performance` rows from their stored
 * `rawAnalytics`. Older rows hold zeros because the tracker's normaliser read a flat answer; the real figures are in the
 * per-platform answer. Safe by default:
 *   node scripts/backfill-performance-metrics.js                         DRY RUN: counts and a few examples, writes nothing
 *   CONFIRM_BACKFILL=yes node scripts/backfill-performance-metrics.js    writes, in batches of 200
 * Only the development database nebulaa_dev is accepted. Only `metrics.*` fields the answer really gives are changed
 * (never lowered, never fields it cannot give such as spend), plus `learning.score` and `learning.tier`; rawAnalytics and
 * everything else stay as they are. Re-running changes nothing more. No outside call, no model call.
 * Optional: LIMIT=n (rows to look at, default no limit), ONLY_USER=<user id>.
 */
const DEV_DB = 'nebulaa_dev';
const BATCH = 200;
const FIELDS = ['likes', 'views', 'comments', 'shares', 'saves', 'clicks', 'impressions', 'reach', 'ctr', 'engagement', 'engagementRate'];

function assertDevDatabase(name) {
  if (name !== DEV_DB) throw new Error(`Refusing: database is ${name || '(none)'}, not ${DEV_DB}`);
}

/** What one row would become: { change, metrics, score, tier }. Pure. */
function planRow(row) {
  const { metricsFromRaw } = require('../services/performance/metrics');
  const { scorePerformance } = require('../services/aiMemoryService');
  const stored = (row && row.metrics) || {};
  const read = metricsFromRaw((row && row.rawAnalytics) || {}, row && row.platform);
  if (!read) return { change: false };
  const metrics = { ...stored };
  let changed = false;
  for (const k of FIELDS) {
    const next = read[k];
    const prev = Number.isFinite(stored[k]) ? stored[k] : 0;
    // The answer wins only where it gives a figure above what is stored (a stored figure is never lowered to 0).
    if (Number.isFinite(next) && next > prev) { metrics[k] = next; changed = true; }
  }
  if (!changed) return { change: false };
  const score = scorePerformance(metrics);
  const tier = score >= 70 ? 'winner' : score >= 45 ? 'high' : score >= 20 ? 'average' : 'low';
  return { change: true, metrics, score, tier };
}

async function main() {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const confirm = process.env.CONFIRM_BACKFILL === 'yes';
  const limit = Number(process.env.LIMIT) > 0 ? Number(process.env.LIMIT) : Infinity;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (run from the backend folder).');
  // Refuse before connecting when the address names another database.
  const named = (process.env.MONGODB_URI.match(/^mongodb(?:\+srv)?:\/\/[^/]*\/([^?]*)/) || [])[1] || '';
  assertDevDatabase(named);
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  assertDevDatabase(mongoose.connection.name);
  const coll = mongoose.connection.db.collection('ai_content_performance');
  const filter = { rawAnalytics: { $type: 'object' } };
  if (process.env.ONLY_USER && /^[0-9a-f]{24}$/i.test(process.env.ONLY_USER)) filter.userId = new mongoose.Types.ObjectId(process.env.ONLY_USER);
  console.log(`Database: ${DEV_DB}. Mode: ${confirm ? 'WRITE' : 'DRY RUN (set CONFIRM_BACKFILL=yes to write)'}`);
  let seen = 0; let changes = 0; let written = 0; let ops = [];
  const examples = [];
  const flush = async () => {
    if (!ops.length) return;
    const r = await coll.bulkWrite(ops, { ordered: false });
    written += r.modifiedCount;
    ops = [];
  };
  const cursor = coll.find(filter, { projection: { platform: 1, metrics: 1, rawAnalytics: 1 } }).batchSize(BATCH);
  for await (const row of cursor) {
    if (seen >= limit) break;
    seen += 1;
    const p = planRow(row);
    if (!p.change) continue;
    changes += 1;
    if (examples.length < 3) examples.push({ id: String(row._id), platform: row.platform, likes: `${(row.metrics || {}).likes || 0} -> ${p.metrics.likes}`, reach: `${(row.metrics || {}).reach || 0} -> ${p.metrics.reach}` });
    if (confirm) {
      ops.push({ updateOne: { filter: { _id: row._id }, update: { $set: { metrics: p.metrics, 'learning.score': p.score, 'learning.tier': p.tier } } } });
      if (ops.length >= BATCH) await flush();
    }
  }
  if (confirm) await flush();
  console.log(`Looked at ${seen} rows; ${changes} ${confirm ? 'recomputed' : 'would change'}${confirm ? `, ${written} written` : ''}.`);
  if (examples.length) console.log('Examples:', JSON.stringify(examples));
  await mongoose.disconnect();
}

module.exports = { assertDevDatabase, planRow, FIELDS };

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('FAILED', e.message); process.exit(1); });
}
