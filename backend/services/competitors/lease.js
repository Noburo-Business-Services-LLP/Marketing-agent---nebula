'use strict';
/**
 * A single-runner lease so two server instances never run the competitor tracker at the same time.
 * The lease is one OpsState row: `value` is `<expiry ISO>|<holder>`, or '' when released. An ISO timestamp sorts as text,
 * so "expired" is simply `value < now`. Claiming is one atomic findOneAndUpdate with upsert: if the row exists and is not
 * expired the upsert tries to insert a second row and the unique key refuses it (E11000), which means "not claimed".
 * A store that fails is treated as "not claimed": the tracker never runs without the lease.
 */
const KEY = 'competitor_tracker_lease';

function opsStateStore(Model, keyOrOptions = KEY) {
  const key = (keyOrOptions && typeof keyOrOptions === 'object' ? keyOrOptions.key : keyOrOptions) || KEY;
  const M = () => (Model || require('../../models/OpsState'));
  return {
    async claim(value, nowIso) {
      try {
        const doc = await M().findOneAndUpdate({ key, value: { $lt: nowIso } }, { $set: { value } }, { upsert: true, new: true });
        return !!doc;
      } catch (e) {
        if (e && e.code === 11000) return false;
        throw e;
      }
    },
    /** Change the value only if it is still `from`. */
    async swap(from, to) {
      const r = await M().updateOne({ key, value: from }, { $set: { value: to } });
      return Number(r && (r.modifiedCount !== undefined ? r.modifiedCount : r.nModified)) > 0;
    }
  };
}

function createLease({ key = KEY, store = opsStateStore(undefined, key), ttlMs = 45 * 60 * 1000, holder = `${process.pid}-${Math.random().toString(36).slice(2, 8)}` } = {}) {
  const valueAt = (at) => `${new Date(at.getTime() + ttlMs).toISOString()}|${holder}`;
  return {
    /** Returns a token (the stored value) or null. Never throws. */
    async claim(at = new Date()) {
      try {
        const value = valueAt(at);
        return (await store.claim(value, at.toISOString())) ? { value } : null;
      } catch (e) {
        console.warn('[lease] could not claim a background-job lease:', e && e.message);
        return null;
      }
    },
    /** Push the expiry out. Returns the new token, or the old one if it was lost. */
    async renew(token, at = new Date()) {
      try {
        const value = valueAt(at);
        return (await store.swap(token.value, value)) ? { value } : token;
      } catch (_) { return token; }
    },
    async release(token) {
      try { if (token) await store.swap(token.value, ''); } catch (_) { /* it expires by itself */ }
    }
  };
}

module.exports = { createLease, opsStateStore, KEY };
