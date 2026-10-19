'use strict';
/**
 * Delete competitors together with their weekly snapshots (the snapshots have no owner once the competitor is gone) and
 * their stored profile pictures (avatar.js). A picture that cannot be deleted is logged and never blocks the removal.
 */
async function removeCompetitorsWithSnapshots(filter, { Competitor = require('../../models/Competitor'), Snapshot = null, removeAvatars = null } = {}) {
  let avatars = [];
  try {
    const found = await Competitor.find(filter).select('_id avatarUrl').lean();
    const ids = found.map((c) => c._id);
    avatars = found.map((c) => c.avatarUrl).filter(Boolean);
    if (ids.length) {
      const S = Snapshot || require('../../models/CompetitorSnapshot');
      await S.deleteMany({ competitorId: { $in: ids } });
    }
  } catch (e) {
    console.error('[competitors] could not delete the old snapshots:', e && e.message);
  }
  const out = await Competitor.deleteMany(filter);
  if (avatars.length) {
    try { await (removeAvatars || require('./avatar').removeAvatars)(avatars); }
    catch (e) { console.error('[competitors] could not delete the stored pictures:', e && e.message); }
  }
  return out;
}

module.exports = { removeCompetitorsWithSnapshots };
