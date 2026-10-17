'use strict';
/** Storage for weekly competitor snapshots. Pass a model to test against an in-memory fake. */
const DAY = 864e5;

function snapshotStore(Model = require('../../models/CompetitorSnapshot')) {
  return {
    /** Upsert by competitor + week. A failed check never overwrites a good snapshot. */
    async save(snapshot) {
      const key = { competitorId: snapshot.competitorId, weekStart: snapshot.weekStart };
      const { competitorId, weekStart, ...fields } = snapshot;
      if (snapshot.ok === false) {
        const existing = await Model.findOne({ ...key, ok: true });
        if (existing) return existing;
        try {
          return await Model.findOneAndUpdate({ ...key, ok: { $ne: true } }, { $set: fields }, { upsert: true, new: true });
        } catch (e) {
          if (e && e.code === 11000) return Model.findOne(key); // a good one landed meanwhile: keep it
          throw e;
        }
      }
      return Model.findOneAndUpdate(key, { $set: { ...fields, ok: true } }, { upsert: true, new: true });
    },
    /** Newest first, good snapshots only. */
    latest(competitorId, n = 4) {
      return Model.find({ competitorId, ok: true }).sort({ weekStart: -1 }).limit(n).lean();
    },
    /** Newest attempt of any status, or null. */
    async lastAttempt(competitorId) {
      const rows = await Model.find({ competitorId }).sort({ takenAt: -1 }).limit(1).lean();
      return rows[0] || null;
    },
    /** Keep the `keep` newest weeks for a competitor. */
    async prune(competitorId, keep) {
      const rows = await Model.find({ competitorId }).sort({ weekStart: -1 }).limit(keep).lean();
      const weeks = rows.map((r) => r.weekStart);
      if (rows.length < keep) return;
      await Model.deleteMany({ competitorId, weekStart: { $nin: weeks } });
    },
    /** Attempts in the 24 hours before `now`, across all accounts (feeds the daily cap). */
    readsToday(now = new Date()) {
      return Model.countDocuments({ takenAt: { $gte: new Date(now.getTime() - DAY) } });
    }
  };
}

module.exports = { snapshotStore };
