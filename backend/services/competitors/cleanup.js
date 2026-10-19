'use strict';
/**
 * Delete competitors together with their weekly snapshots (the snapshots have no owner once the competitor is gone) and
 * their stored profile pictures (avatar.js) and post pictures (postThumbs.js). A picture that cannot be deleted is logged and never blocks the removal.
 */
async function removeCompetitorsWithSnapshots(filter, { Competitor = require('../../models/Competitor'), Snapshot = null, removeAvatars = null, removeThumbs = null } = {}) {
  let avatars = [];
  let thumbs = [];
  try {
    const found = await Competitor.find(filter).select('_id avatarUrl postThumbs').lean();
    const ids = found.map((c) => c._id);
    avatars = found.map((c) => c.avatarUrl).filter(Boolean);
    thumbs = found.flatMap((c) => (Array.isArray(c.postThumbs) ? c.postThumbs : []).map((t) => t && t.thumbUrl)).filter(Boolean);
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
  if (thumbs.length) {
    try { await (removeThumbs || require('./postThumbs').removeThumbs)(thumbs); }
    catch (e) { console.error('[competitors] could not delete the stored post pictures:', e && e.message); }
  }
  return out;
}

module.exports = { removeCompetitorsWithSnapshots };
