'use strict';
/** Storage for listening scores and weekly totals. Pass models to test against in-memory fakes. */
const cfg = require('../../config/listening');
const { weekStartOf } = require('../week/weekMath');

const DAY = 864e5;
const BUCKET = { pos: 'positive', neu: 'neutral', neg: 'negative' };

function listeningStore({ Score, Weekly } = {}) {
  const S = () => Score || require('../../models/ListeningScore');
  const W = () => Weekly || require('../../models/ListeningWeekly');
  return {
    /** Bulk upsert by { userId, inboxItemId }. An existing label is never overwritten ($setOnInsert only). */
    async saveScores(userId, rows = []) {
      if (!rows.length) return;
      const ops = rows.map((r) => ({
        updateOne: {
          filter: { userId, inboxItemId: r.inboxItemId },
          update: {
            $setOnInsert: {
              userId, inboxItemId: r.inboxItemId, platform: r.platform, kind: r.kind, label: r.label, reason: r.reason,
              itemAt: r.itemAt, scoredAt: r.scoredAt || new Date(), modelVersion: r.modelVersion || cfg.MODEL_VERSION
            }
          },
          upsert: true
        }
      }));
      try {
        await S().bulkWrite(ops, { ordered: false });
      } catch (e) {
        if (!(e && (e.code === 11000 || (e.writeErrors || []).every((w) => w && w.code === 11000)))) throw e;
      }
    },
    /** The ids among `ids` that already have a score. */
    async scoredIds(userId, ids = []) {
      if (!ids.length) return new Set();
      const rows = await S().find({ userId, inboxItemId: { $in: ids } }).select('inboxItemId').lean();
      return new Set(rows.map((r) => String(r.inboxItemId)));
    },
    scoresSince(userId, since) {
      return S().find({ userId, itemAt: { $gte: since } }).lean();
    },
    /** Recompute the last KEEP_WEEKS weeks from the scores and delete older weeks. */
    async rebuildWeeks(userId, now = new Date()) {
      const current = weekStartOf(now);
      const oldest = weekStartOf(new Date(new Date(`${current}T00:00:00Z`).getTime() - (cfg.KEEP_WEEKS - 1) * 7 * DAY));
      const since = new Date(`${oldest}T00:00:00Z`);
      const rows = await S().find({ userId, itemAt: { $gte: new Date(since.getTime() - DAY) } }).lean();
      const byWeek = new Map();
      for (const r of rows) {
        if (!r.itemAt) continue;
        const ws = weekStartOf(new Date(r.itemAt));
        if (ws < oldest || ws > current) continue;
        const w = byWeek.get(ws) || { counts: { positive: 0, neutral: 0, negative: 0 }, total: 0, reasons: {} };
        const bucket = BUCKET[r.label];
        if (!bucket) continue;
        w.counts[bucket] += 1; w.total += 1;
        if (r.label === 'neg') { const k = r.reason || 'other'; w.reasons[k] = (w.reasons[k] || 0) + 1; }
        byWeek.set(ws, w);
      }
      const computedAt = new Date();
      for (const [weekStart, w] of byWeek) {
        await W().updateOne({ userId, weekStart }, { $set: { counts: w.counts, total: w.total, reasons: w.reasons, computedAt } }, { upsert: true });
      }
      // A week that no longer has any score (an item was deleted) is removed; weeks older than the window go too.
      await W().deleteMany({ userId, weekStart: { $nin: [...byWeek.keys()] } });
    },
    /** Newest first. */
    weeks(userId, n = cfg.KEEP_WEEKS) {
      return W().find({ userId }).sort({ weekStart: -1 }).limit(n).lean();
    }
  };
}

module.exports = { listeningStore };
