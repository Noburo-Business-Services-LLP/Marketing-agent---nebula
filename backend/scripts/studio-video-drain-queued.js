/**
 * Leftovers after a rollback of the Videos consumer (E9 stage B1, docs/superpowers/ops/ecs-web-worker.md "Videos on the
 * worker"): closes every StudioVideo that is still `queued` (charged, never claimed) and returns its Quarks, through the
 * same close-with-refund path as the studio sweep (proof first, one refund, conditional on the row still being queued).
 *
 * Normally NOT needed: rollback step 2 waits until studioVideos.queueDepth and running are 0 first. Use this only for rows
 * left behind (an older image does not claim `queued` rows; they would otherwise wait for the 30 minute safety close).
 *
 *   MONGODB_URI=<uri that names its database> node scripts/studio-video-drain-queued.js                  dry run: counts only
 *   MONGODB_URI=<uri that names its database> CONFIRM_DRAIN=yes node scripts/studio-video-drain-queued.js act
 *
 * Refuses unless the database name is written in MONGODB_URI. Prints counts only (never the URI, ids, users or secrets).
 */
const REASON = 'The video could not be made because the service was changed back. Your Quarks were returned. Please try again.';
const BATCH = 50;

/** The database name written in a connection string, or '' when there is none. Never throws, never returns the URI. */
function explicitDbName(uri) {
  try {
    const u = new URL(String(uri || ''));
    return decodeURIComponent(u.pathname.replace(/^\//, '').split('/')[0] || '');
  } catch (_) { return ''; }
}

/**
 * Pure part. `model` has find(q).limit(n).lean() and countDocuments(q); `fail(row, message, filter)` is the close-with-refund
 * path (returns the closed row, or null when it was not closed); `dropClips(urls)` deletes stored clip files.
 * dryRun counts only. Returns counts: { queued, closed, notClosed }.
 */
async function drainQueued({ model, fail, dropClips = async () => {}, dryRun = true, reason = REASON, batch = BATCH }) {
  const queued = await model.countDocuments({ status: 'queued' });
  if (dryRun) return { queued, closed: 0, notClosed: 0, dryRun: true };
  let closed = 0;
  const skipped = new Set(); // rows that were not closed (proof unreadable, or taken meanwhile): not retried in this run
  for (;;) {
    const rows = ((await model.find({ status: 'queued', ...(skipped.size ? { _id: { $nin: [...skipped] } } : {}) }).limit(batch).lean())) || [];
    if (!rows.length) break;
    for (const row of rows) {
      let out = null;
      try { out = await fail(row, reason, { status: 'queued' }); } catch (_) { out = null; }
      if (out) {
        closed += 1;
        try { if (Array.isArray(out.clipUrls) && out.clipUrls.length) await dropClips(out.clipUrls); } catch (_) { /* best effort */ }
      } else skipped.add(row._id);
    }
  }
  return { queued, closed, notClosed: skipped.size, dryRun: false };
}

async function main(env = process.env) {
  const uri = env.MONGODB_URI;
  if (!explicitDbName(uri)) { console.error('Refusing: MONGODB_URI must name its database explicitly (mongodb://host/<database>).'); return 2; }
  const act = String(env.CONFIRM_DRAIN || '').toLowerCase() === 'yes';
  const mongoose = require('mongoose');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000, maxPoolSize: 5 });
  try {
    if (mongoose.connection.name !== explicitDbName(uri)) { console.error('Refusing: the connected database is not the one named in MONGODB_URI.'); return 2; }
    const route = require('../routes/studioVideos');
    const out = await drainQueued({ model: require('../models/StudioVideo'), fail: route._money.fail, dropClips: route.dropClips, dryRun: !act });
    console.log(act
      ? `Closed and refunded ${out.closed} of ${out.queued} queued Videos (${out.notClosed} left for the 30 minute safety close).`
      : `Dry run: ${out.queued} queued Videos would be closed and refunded. Run again with CONFIRM_DRAIN=yes to do it.`);
    return 0;
  } finally { await mongoose.disconnect().catch(() => null); }
}

module.exports = { drainQueued, explicitDbName, REASON };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => { console.error('Drain failed:', e && e.message); process.exit(1); });
}
