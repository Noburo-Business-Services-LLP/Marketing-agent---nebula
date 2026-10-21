'use strict';
/**
 * Which accounts background jobs (the content calendar, analytics snapshots, scheduled publishing) must leave alone:
 *   - any account that is waiting to be deleted,
 *   - a client workspace that is frozen (over the agency's limit),
 *   - a client workspace whose agency plan has ended, or whose agency is switched off or waiting to be deleted,
 *   - a demo account made by a seed script (social profile key starting `demo-`, decision D112): its data is fixed.
 * An ordinary account that is not waiting to be deleted is never in this list, so nothing changes for them.
 * The jobs add `$nin: ids` to their query, so a long list of skipped accounts can never starve the others of a turn.
 */
const { DEMO_PROFILE_QUERY } = require('./demoProfile');

const idsOf = (rows) => (rows || []).map((r) => r._id);

async function blockedAccountIds({ User = require('../models/User') } = {}) {
  const [frozen, pending, ownerIds, demo] = await Promise.all([
    User.find({ 'agency.frozen': true }).select('_id').lean(),
    User.find({ 'deletion.status': 'pending' }).select('_id').lean(),
    User.distinct('agency.ownerId', { 'agency.ownerId': { $exists: true, $ne: null } }),
    User.find(DEMO_PROFILE_QUERY).select('_id').lean()
  ]);
  const ended = ownerIds.length
    ? await User.find({ _id: { $in: ownerIds }, $or: [{ 'plan.tier': { $ne: 'agency' } }, { isActive: false }] }).select('_id').lean()
    : [];
  // Clients of an agency that is waiting to be deleted stop with it, and so do clients of an agency whose plan ended.
  const stoppedOwners = [...idsOf(ended), ...idsOf(pending)];
  const orphans = stoppedOwners.length ? await User.find({ 'agency.ownerId': { $in: stoppedOwners } }).select('_id').lean() : [];
  const seen = new Map();
  for (const id of [...idsOf(frozen), ...idsOf(pending), ...idsOf(orphans), ...idsOf(demo)]) seen.set(String(id), id);
  return [...seen.values()];
}

/** Same list, but a read failure never stops the job: it is logged and the job runs as it did before. */
async function blockedAccountIdsSafe(opts) {
  try { return await blockedAccountIds(opts); }
  catch (e) { console.warn('[background gate] could not read the paused accounts, running without it:', e && e.message); return []; }
}

module.exports = { blockedAccountIds, blockedAccountIdsSafe };
