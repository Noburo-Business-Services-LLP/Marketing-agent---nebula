/**
 * Leftovers after a rollback of the Photoshoot consumer (E9 stage B2, docs/superpowers/ops/ecs-web-worker.md "Photoshoot on
 * the worker"): lists the consumer photoshoots that are still waiting for a worker (charged, never claimed) and still
 * running on a worker, and, when asked to, closes every WAITING one and returns its Quarks through the same proof-first
 * close as the 30-minute safety close (services/photoshoot/service.js closeWaiting: proof first, the refund claimed in the
 * closing write, only while the row is still waiting).
 *
 * Normally NOT needed: the rollback steps wait until photoshoot.queueDepth and photoshoot.running are 0 first. Running rows
 * are only counted (their worker, or the lease sweep of a current image, finishes or closes them).
 *
 *   MONGODB_URI=<uri that names its database> node scripts/photoshoot-drain-queued.js                  dry run: counts only
 *   MONGODB_URI=<uri that names its database> CONFIRM_DRAIN=yes node scripts/photoshoot-drain-queued.js act
 *
 * Refuses unless the database name is written in MONGODB_URI. Prints counts only (never the URI, ids, users or secrets).
 */
const { explicitDbName } = require('./studio-video-drain-queued');

const BATCH = 50;
const WAITING = { status: 'queued', via: 'consumer', chargedAt: { $ne: null } };
const RUNNING = { status: 'running', via: 'consumer' };

/**
 * Pure part. `model` has countDocuments(q) and find(q).limit(n).lean(); `close(row)` is the proof-first close (returns the
 * closed row, or null when it was not closed). dryRun counts only. Returns { waiting, running, closed, notClosed, dryRun }.
 */
async function drainWaiting({ model, close, dryRun = true, batch = BATCH }) {
  const waiting = await model.countDocuments(WAITING);
  const running = await model.countDocuments(RUNNING);
  if (dryRun) return { waiting, running, closed: 0, notClosed: 0, dryRun: true };
  let closed = 0;
  const skipped = new Set(); // rows that were not closed (proof unreadable, or claimed meanwhile): not retried in this run
  for (;;) {
    const rows = ((await model.find({ ...WAITING, ...(skipped.size ? { _id: { $nin: [...skipped] } } : {}) }).limit(batch).lean())) || [];
    if (!rows.length) break;
    for (const row of rows) {
      let out = null;
      try { out = await close(row); } catch (_) { out = null; }
      if (out) closed += 1; else skipped.add(row._id);
    }
  }
  return { waiting, running, closed, notClosed: skipped.size, dryRun: false };
}

async function main(env = process.env) {
  const uri = env.MONGODB_URI;
  if (!explicitDbName(uri)) { console.error('Refusing: MONGODB_URI must name its database explicitly (mongodb://host/<database>).'); return 2; }
  const act = String(env.CONFIRM_DRAIN || '').toLowerCase() === 'yes';
  const mongoose = require('mongoose');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000, maxPoolSize: 5 });
  try {
    if (mongoose.connection.name !== explicitDbName(uri)) { console.error('Refusing: the connected database is not the one named in MONGODB_URI.'); return 2; }
    const svc = require('../services/photoshoot/service').createPhotoshoot();
    const out = await drainWaiting({ model: require('../models/PhotoshootJob'), close: (row) => svc.closeWaiting(row), dryRun: !act });
    console.log(act
      ? `Closed and refunded ${out.closed} of ${out.waiting} waiting photoshoots (${out.notClosed} left for the 30 minute safety close). Still running on a worker: ${out.running}.`
      : `Dry run: ${out.waiting} waiting photoshoots would be closed and refunded; ${out.running} are running on a worker (not touched). Run again with CONFIRM_DRAIN=yes to do it.`);
    return 0;
  } finally { await mongoose.disconnect().catch(() => null); }
}

module.exports = { drainWaiting, WAITING, RUNNING };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => { console.error('Drain failed:', e && e.message); process.exit(1); });
}
