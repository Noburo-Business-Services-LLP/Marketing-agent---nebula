// Shared in-memory fakes for hero video tests (not a test file itself: no `.test.js`).
// The fake JobModel mimics the subset of Mongoose used by heroVideoFlow / routes:
// create / find().sort().limit().lean() / findOne / findOneAndUpdate / updateOne,
// with filters supporting equality, $ne, $in, $gte, $lt, $exists (dotted paths) and
// a top-level $or; updates support $set and $unset. findOneAndUpdate and updateOne are
// synchronous inside the async function, so they are atomic like a single Mongo op.

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
function unsetPath(obj, path) {
  const keys = path.split('.');
  const parent = getPath(obj, keys.slice(0, -1).join('.')) ?? (keys.length === 1 ? obj : undefined);
  if (parent && typeof parent === 'object') delete parent[keys[keys.length - 1]];
}
const time = (v) => new Date(v).getTime();

function matchCond(v, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case '$ne': return String(v) !== String(arg) && v !== arg;
        case '$in': return arg.includes(v);
        case '$gte': return v != null && time(v) >= time(arg);
        case '$lt': return v != null && (v instanceof Date || typeof v === 'string' || typeof v === 'number') && time(v) < time(arg);
        case '$exists': return (v !== undefined) === Boolean(arg);
        default: throw new Error('fake: unsupported operator ' + op);
      }
    });
  }
  return String(v) === String(cond);
}
function matches(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return cond.some((f) => matches(doc, f));
    return matchCond(getPath(doc, k), cond);
  });
}
function applyUpdate(d, update) {
  for (const [k, v] of Object.entries(update.$set || {})) setPath(d, k, v);
  for (const k of Object.keys(update.$unset || {})) unsetPath(d, k);
}
const clone = (d) => JSON.parse(JSON.stringify(d));

function makeJobModel() {
  const docs = [];
  return {
    docs,
    async create(data) { const d = clone(data); docs.push(d); return d; },
    find(filter) {
      let res = docs.filter((d) => matches(d, filter));
      const q = {
        sort(spec) {
          const keys = Object.entries(spec);
          res = [...res].sort((a, b) => {
            for (const [k, dir] of keys) {
              const av = k === 'createdAt' ? time(a[k]) : a[k];
              const bv = k === 'createdAt' ? time(b[k]) : b[k];
              if (av < bv) return -dir;
              if (av > bv) return dir;
            }
            return 0;
          });
          return q;
        },
        limit(n) { res = res.slice(0, n); return q; },
        lean() { return q; },
        then(ok, bad) { return Promise.resolve(res.map(clone)).then(ok, bad); }
      };
      return q;
    },
    async findOne(filter) { const d = docs.find((x) => matches(x, filter)); return d ? clone(d) : null; },
    // returns the pre-update doc (Mongoose default)
    async findOneAndUpdate(filter, update) {
      const d = docs.find((x) => matches(x, filter));
      if (!d) return null;
      const before = clone(d);
      applyUpdate(d, update);
      return before;
    },
    async updateOne(filter, update) {
      const d = docs.find((x) => matches(x, filter));
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(d, update);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

function makeDeps(over = {}) {
  const JobModel = makeJobModel();
  const calls = { deduct: [], refund: [], submit: [], getStatus: [], copy: [], quota: 0 };
  return {
    JobModel,
    calls,
    hasFalKey: () => true,
    quotaFn: async () => { calls.quota++; return { used: 0, limit: 2, resetsOn: 'x' }; },
    deduct: async (...a) => { calls.deduct.push(a); return { success: true }; },
    refund: async (...a) => { calls.refund.push(a); return { success: true }; },
    submit: async (...a) => { calls.submit.push(a); return 'req-1'; },
    getStatus: async (...a) => { calls.getStatus.push(a); return { state: 'processing' }; },
    copyToStorage: async (u) => { calls.copy.push(u); return 'https://cdn.example/' + 'stored.mp4'; },
    now: () => new Date('2026-10-03T00:00:00Z'),
    ...over
  };
}

module.exports = { makeJobModel, makeDeps, matches };
