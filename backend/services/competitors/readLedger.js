'use strict';
/**
 * The read ledger: every profile read ATTEMPT is recorded here, before the result is stored. The daily ceiling, the
 * per-account cap and the per-competitor cooldown all read from it, so they count real reads and keep working when a
 * snapshot or tracking save fails. Each entry is written to the database (a separate small row) AND kept in this
 * process, and every count takes the larger of the two. If the database is down or full, this process still refuses to
 * read the same competitor again inside its cooldown, and still stops at the daily ceiling.
 * A day is a UTC day. Pass `Model: null` for memory only (tests).
 */
const dayOf = (at) => (at instanceof Date ? at : new Date(at || Date.now())).toISOString().slice(0, 10);

function createReadLedger({ Model = undefined } = {}) {
  let model = Model;
  const lazy = () => { if (model === undefined) model = require('../../models/CompetitorReadLog'); return model; };
  const perDay = new Map();   // day -> reads
  const perUser = new Map();  // day|user -> reads
  const lastBy = new Map();   // competitorId -> { at, handle }

  const forget = (today) => {
    for (const k of perDay.keys()) if (k < today) perDay.delete(k);
    for (const k of perUser.keys()) if (k.slice(0, 10) < today) perUser.delete(k);
  };

  return {
    /** Never throws. Memory first, then the database. */
    async record({ userId, competitorId, handle = null, at = new Date(), source = 'tracker' } = {}) {
      const date = at instanceof Date ? at : new Date(at);
      const day = dayOf(date);
      forget(day);
      perDay.set(day, (perDay.get(day) || 0) + 1);
      const uk = `${day}|${String(userId)}`;
      perUser.set(uk, (perUser.get(uk) || 0) + 1);
      if (competitorId !== undefined && competitorId !== null) {
        const prev = lastBy.get(String(competitorId));
        if (!prev || prev.at <= date) lastBy.set(String(competitorId), { at: date, handle });
      }
      try {
        const M = lazy();
        if (M) await M.create({ userId, competitorId, day, at: date, handle, source });
      } catch (e) {
        console.error('[competitors] could not store a read record (counting in memory):', e && e.message);
      }
    },
    async countToday(at = new Date()) {
      const day = dayOf(at);
      let stored = 0;
      try { const M = lazy(); if (M) stored = Number(await M.countDocuments({ day })) || 0; } catch (_) { stored = 0; }
      return Math.max(stored, perDay.get(day) || 0);
    },
    async countUserToday(userId, at = new Date()) {
      const day = dayOf(at);
      let stored = 0;
      try { const M = lazy(); if (M) stored = Number(await M.countDocuments({ day, userId })) || 0; } catch (_) { stored = 0; }
      return Math.max(stored, perUser.get(`${day}|${String(userId)}`) || 0);
    },
    /** The newest read of this competitor: { at, handle } or null. */
    async lastRead(competitorId) {
      const mem = lastBy.get(String(competitorId)) || null;
      let stored = null;
      try { const M = lazy(); if (M) stored = await M.findOne({ competitorId }).sort({ at: -1 }).lean(); } catch (_) { stored = null; }
      if (stored && (!mem || new Date(stored.at) >= mem.at)) return { at: new Date(stored.at), handle: stored.handle || null };
      return mem;
    }
  };
}

let shared = null;
/** One ledger for the whole process, so the tracker and the customer routes count the same reads. */
const sharedLedger = () => (shared = shared || createReadLedger());

module.exports = { createReadLedger, sharedLedger, dayOf };
