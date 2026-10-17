'use strict';
// One call per key per window, kept in this process's memory (a restart or a second server starts a fresh window).
function makeCooldown(ms, now = () => Date.now()) {
  const last = new Map();
  return {
    hit(key) {
      const k = String(key);
      const t = now();
      const prev = last.get(k);
      if (prev !== undefined && t - prev < ms) return { ok: false, retryAfterMs: ms - (t - prev) };
      last.set(k, t);
      if (last.size > 5000) for (const [kk, v] of last) if (t - v >= ms) last.delete(kk);
      return { ok: true };
    }
  };
}
module.exports = { makeCooldown };
