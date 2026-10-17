'use strict';
/** Delete competitors together with their weekly snapshots (the snapshots have no owner once the competitor is gone). */
async function removeCompetitorsWithSnapshots(filter, { Competitor = require('../../models/Competitor'), Snapshot = null } = {}) {
  try {
    const ids = (await Competitor.find(filter).select('_id').lean()).map((c) => c._id);
    if (ids.length) {
      const S = Snapshot || require('../../models/CompetitorSnapshot');
      await S.deleteMany({ competitorId: { $in: ids } });
    }
  } catch (e) {
    console.error('[competitors] could not delete the old snapshots:', e && e.message);
  }
  return Competitor.deleteMany(filter);
}

module.exports = { removeCompetitorsWithSnapshots };
