'use strict';
// A small in-memory stand-in for the Campaign model with the filter and update operators the publish claim uses
// (equality, $in, $nin, $ne, $lt, $lte, $gt, $exists, $or, dotted paths; $set and $unset). One call is atomic here
// because it has no await inside, like one MongoDB findOneAndUpdate on one document.
const get = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => {
  const ks = String(p).split('.'); let c = o;
  ks.slice(0, -1).forEach((k) => { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k]; });
  c[ks[ks.length - 1]] = v;
};
const unsetPath = (o, p) => {
  const ks = String(p).split('.'); let c = o;
  for (const k of ks.slice(0, -1)) { if (c == null) return; c = c[k]; }
  if (c != null) delete c[ks[ks.length - 1]];
};
const cmp = (a, b) => (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b);
function condOk(val, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$in') return arg.some((x) => x === val);
      if (op === '$nin') return !arg.some((x) => x === val);
      if (op === '$ne') return val !== arg;
      if (op === '$exists') return (val !== undefined) === !!arg;
      if (val === undefined || val === null) return false;
      if (op === '$lt') return cmp(val, arg) < 0;
      if (op === '$lte') return cmp(val, arg) <= 0;
      if (op === '$gt') return cmp(val, arg) > 0;
      if (op === '$gte') return cmp(val, arg) >= 0;
      throw new Error(`fake: operator ${op} not supported`);
    });
  }
  if (cond instanceof Date) return val instanceof Date && val.getTime() === cond.getTime();
  return val === cond || (val == null && cond === null);
}
function matches(row, f) {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => matches(row, sub));
    if (k === '$and') return v.every((sub) => matches(row, sub));
    return condOk(get(row, k), v);
  });
}
function apply(row, upd) {
  Object.entries(upd.$set || {}).forEach(([k, v]) => setPath(row, k, v));
  Object.keys(upd.$unset || {}).forEach((k) => unsetPath(row, k));
}

function fakeClaimCampaigns(rows = []) {
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const find = (f) => [...byId.values()].find((r) => matches(r, f));
  return {
    rows: byId,
    async findOne(f) { const r = find(f); return r ? { ...r } : null; },
    async findOneAndUpdate(f, upd, opts = {}) {
      const r = find(f);
      if (!r) return null;
      const before = JSON.parse(JSON.stringify(r), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));
      apply(r, upd);
      return opts.new ? { ...r } : before;
    },
    async updateOne(f, upd) {
      const r = find(f);
      if (!r) return { modifiedCount: 0 };
      apply(r, upd);
      return { modifiedCount: 1 };
    },
    async findByIdAndUpdate(id, upd) { const r = byId.get(String(id)); if (r) apply(r, upd); return r ? { ...r } : null; }
  };
}
module.exports = { fakeClaimCampaigns, matches };
