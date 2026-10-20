'use strict';
// An in-memory VideoJob collection for the queue tests (E9): the calls services/videoGenerationQueue.js makes, each one
// atomic (it runs to the end before any other call), so races between several in-process workers behave like MongoDB's
// single-document atomic updates. Supports find().sort().limit().select().lean(), $set/$inc/$push($each,$slice),
// $in (null matches a missing field), $lt, $lte, $ne, Date equality, and the two aggregate shapes the queue uses.
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { if (c[k] == null || typeof c[k] !== 'object') c[k] = {}; c = c[k]; }); c[ks[ks.length - 1]] = v; };
const isPlain = (v) => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
const norm = (v) => (v === undefined ? null : v instanceof Date ? v.getTime() : v);
const time = (v) => new Date(v).getTime();

function matches(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    const v = getPath(doc, k);
    if (isPlain(cond) && Object.keys(cond).some((o) => o.startsWith('$'))) {
      return Object.entries(cond).every(([op, a]) => {
        if (op === '$in') return a.map(norm).includes(norm(v));
        if (op === '$nin') return !a.map(norm).includes(norm(v));
        if (op === '$ne') return norm(v) !== norm(a);
        if (op === '$lt') return v != null && time(v) < time(a);
        if (op === '$lte') return v != null && time(v) <= time(a);
        throw new Error(`unsupported ${op}`);
      });
    }
    return norm(v) === norm(cond);
  });
}
const clone = (d) => (d == null ? d : JSON.parse(JSON.stringify(d), (k, x) => (typeof x === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(x) ? new Date(x) : x)));
function apply(d, u) {
  Object.entries(u.$set || {}).forEach(([k, v]) => setPath(d, k, clone(v)));
  Object.entries(u.$inc || {}).forEach(([k, v]) => setPath(d, k, (Number(getPath(d, k)) || 0) + v));
  Object.entries(u.$push || {}).forEach(([k, v]) => { const arr = getPath(d, k) || []; arr.push(...(v.$each || [v])); setPath(d, k, v.$slice ? arr.slice(v.$slice) : arr); });
}
function query(fn) {
  let sortSpec = null; let lim = Infinity;
  const run = () => { let rows = fn(); if (Array.isArray(rows)) { if (sortSpec) { const [[key, dir]] = Object.entries(sortSpec); rows = rows.slice().sort((a, b) => (time(getPath(a, key)) - time(getPath(b, key))) * dir); } rows = rows.slice(0, lim); } return rows; };
  const q = {
    sort: (s) => { sortSpec = s; return q; }, limit: (n) => { lim = n; return q; }, select: () => q, lean: () => q,
    then: (ok, bad) => Promise.resolve().then(run).then(ok, bad), catch: (bad) => Promise.resolve().then(run).catch(bad)
  };
  return q;
}
const evalExpr = (doc, e) => (typeof e === 'string' && e.startsWith('$') ? getPath(doc, e.slice(1)) : isPlain(e) ? Object.fromEntries(Object.entries(e).map(([k, x]) => [k, evalExpr(doc, x)])) : e);

function makeVideoJobModel() {
  const docs = [];
  const counts = { claims: 0 };
  return {
    docs,
    counts,
    create: async (doc) => { const d = clone({ createdAt: new Date(), updatedAt: new Date(), attempts: 0, logs: [], ...doc }); docs.push(d); return { toObject: () => clone(d) }; },
    findOne: (f) => query(() => clone(docs.find((d) => matches(d, f)) || null)),
    find: (f) => query(() => docs.filter((d) => matches(d, f)).map(clone)),
    findOneAndUpdate: (f, u, o = {}) => query(() => { const d = docs.find((x) => matches(x, f)); if (!d) return null; const before = clone(d); apply(d, u); return o.new ? clone(d) : before; }),
    updateOne: async (f, u) => { const d = docs.find((x) => matches(x, f)); if (d) apply(d, u); return { matchedCount: d ? 1 : 0, modifiedCount: d ? 1 : 0 }; },
    updateMany: async (f, u) => { const ds = docs.filter((x) => matches(x, f)); ds.forEach((d) => apply(d, u)); return { matchedCount: ds.length }; },
    countDocuments: async (f) => docs.filter((x) => matches(x, f)).length,
    deleteMany: async () => ({ deletedCount: 0 }),
    aggregate: async (pipeline) => {
      let rows = docs.map(clone);
      for (const stage of pipeline) {
        if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match));
        if (stage.$group) {
          const groups = new Map();
          for (const d of rows) {
            const id = evalExpr(d, stage.$group._id);
            const key = JSON.stringify(id === undefined ? null : id);
            if (!groups.has(key)) groups.set(key, { _id: id === undefined ? null : id });
            const g = groups.get(key);
            for (const [name, acc] of Object.entries(stage.$group)) {
              if (name === '_id') continue;
              if (acc.$sum !== undefined) g[name] = (g[name] || 0) + (typeof acc.$sum === 'number' ? acc.$sum : Number(evalExpr(d, acc.$sum)) || 0);
              if (acc.$min !== undefined) { const v = evalExpr(d, acc.$min); if (v != null && (g[name] == null || time(v) < time(g[name]))) g[name] = v; }
            }
          }
          rows = [...groups.values()];
        }
      }
      return rows;
    }
  };
}

module.exports = { makeVideoJobModel };
