'use strict';
/**
 * The scoring batch ledger: every model batch ATTEMPT is recorded here BEFORE the call, so a failed save, a full
 * database or a restart can never send the same items to the paid model twice, and the daily caps count real calls.
 * Entries go to the database AND stay in this process; every read takes the larger of the two. A day is a UTC day.
 * Pass `Model: null` for memory only (tests). Mirrors services/competitors/readLedger.js.
 */
const DAY = 864e5;
const ATTEMPT_DAYS = 7;
const dayOf = (at) => (at instanceof Date ? at : new Date(at || Date.now())).toISOString().slice(0, 10);

function createBatchLedger({ Model = undefined } = {}) {
  let model = Model;
  const lazy = () => { if (model === undefined) model = require('../../models/ListeningBatchLog'); return model; };
  const perDay = new Map();   // day -> batches
  const perUser = new Map();  // day|user -> items
  const tried = new Map();    // user|itemId -> Date of the newest attempt
  const lastBy = new Map();   // user -> Date

  const forget = (today, now) => {
    for (const k of perDay.keys()) if (k < today) perDay.delete(k);
    for (const k of perUser.keys()) if (k.slice(0, 10) < today) perUser.delete(k);
    for (const [k, at] of tried) if (now - at > ATTEMPT_DAYS * DAY) tried.delete(k);
  };

  return {
    /** Never throws. Memory first, then the database. Returns true when the database row was stored (or when this ledger is
     *  memory only, as in tests), false when the database write failed: the caller must then NOT make the paid call. */
    async record({ userId, itemIds = [], at = new Date(), source = 'scorer' } = {}) {
      const date = at instanceof Date ? at : new Date(at);
      const day = dayOf(date);
      forget(day, date);
      perDay.set(day, (perDay.get(day) || 0) + 1);
      const uk = `${day}|${String(userId)}`;
      perUser.set(uk, (perUser.get(uk) || 0) + itemIds.length);
      for (const id of itemIds) {
        const k = `${String(userId)}|${String(id)}`;
        const prev = tried.get(k);
        if (!prev || prev < date) tried.set(k, date);
      }
      const prevRun = lastBy.get(String(userId));
      if (!prevRun || prevRun < date) lastBy.set(String(userId), date);
      try {
        const M = lazy();
        if (M) await M.create({ userId, day, at: date, itemIds, source });
        return true;
      } catch (_) {
        return false; // the caller logs once; no error text is kept here
      }
    },
    async countBatchesToday(at = new Date()) {
      const day = dayOf(at);
      let stored = 0;
      try { const M = lazy(); if (M) stored = Number(await M.countDocuments({ day })) || 0; } catch (_) { stored = 0; }
      return Math.max(stored, perDay.get(day) || 0);
    },
    async countItemsUserToday(userId, at = new Date()) {
      const day = dayOf(at);
      let stored = 0;
      try {
        const M = lazy();
        if (M) {
          const rows = await M.find({ day, userId }).select('itemIds').lean();
          stored = rows.reduce((n, r) => n + ((r.itemIds && r.itemIds.length) || 0), 0);
        }
      } catch (_) { stored = 0; }
      return Math.max(stored, perUser.get(`${day}|${String(userId)}`) || 0);
    },
    /** Ids among `itemIds` that were sent in the last 7 days, whether or not anything was saved. */
    async attempted(userId, itemIds = [], at = new Date()) {
      const now = at instanceof Date ? at : new Date(at);
      const since = new Date(now.getTime() - ATTEMPT_DAYS * DAY);
      const wanted = new Set(itemIds.map(String));
      const out = new Set();
      for (const id of wanted) {
        const when = tried.get(`${String(userId)}|${id}`);
        if (when && when >= since && when <= now) out.add(id);
      }
      try {
        const M = lazy();
        if (M) {
          const rows = await M.find({ userId, at: { $gte: since, $lte: now }, itemIds: { $in: itemIds } }).select('itemIds').lean();
          for (const r of rows) for (const id of r.itemIds || []) if (wanted.has(String(id))) out.add(String(id));
        }
      } catch (_) { /* memory already counted */ }
      return out;
    },
    /** The newest batch attempt for this account, or null. */
    async lastRunAt(userId) {
      const mem = lastBy.get(String(userId)) || null;
      let stored = null;
      try {
        const M = lazy();
        if (M) { const row = await M.findOne({ userId }).sort({ at: -1 }).lean(); stored = row ? new Date(row.at) : null; }
      } catch (_) { stored = null; }
      if (stored && (!mem || stored >= mem)) return stored;
      return mem;
    }
  };
}

let shared = null;
/** One ledger for the whole process, so the scheduler and the staff route count the same batches. */
const sharedBatchLedger = () => (shared = shared || createBatchLedger());

module.exports = { createBatchLedger, sharedBatchLedger, dayOf };
