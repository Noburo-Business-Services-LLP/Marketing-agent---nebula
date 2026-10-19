'use strict';
// A small in-memory cache for the Home summary: one answer per account (and per kind of look: the owner's own, or a staff
// or agency pass), kept for 60 seconds, at most MAX_ENTRIES accounts. Nothing is stored on disk and nothing survives a restart.
// The route only stores answers that loaded completely, so an error is never cached. A write that changes the numbers calls
// invalidate(accountId) (see routes/home.js), so Home does not show a stale count right after the customer acts.
const TTL_MS = 60 * 1000;
const MAX_ENTRIES = 1000;

function createSummaryCache({ ttlMs = TTL_MS, max = MAX_ENTRIES, now = () => Date.now() } = {}) {
  const map = new Map(); // insertion order = least recently used first

  const get = (key) => {
    const hit = map.get(key);
    if (!hit) return undefined;
    if (now() - hit.at > ttlMs) { map.delete(key); return undefined; }
    map.delete(key); map.set(key, hit); // now the most recently used
    return hit.value;
  };
  const set = (key, value) => {
    map.delete(key);
    map.set(key, { at: now(), value });
    while (map.size > max) map.delete(map.keys().next().value);
  };
  // Removes every entry for one account: the key is "<accountId>:<look>".
  const invalidate = (accountId) => {
    const prefix = `${accountId}:`;
    for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k);
  };
  const clear = () => map.clear();
  const size = () => map.size;
  return { get, set, invalidate, clear, size };
}

module.exports = { createSummaryCache, TTL_MS, MAX_ENTRIES };
