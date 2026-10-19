// An in-memory stand-in for the HomeDraft model with the two unique indexes ({userId, key} and one inFlight row per
// account) and the operators the Home drafts service uses. Only for tests.
let seq = 0;
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Date ? { $date: x.toISOString() } : x)), (k, x) => (x && typeof x === 'object' && x.$date ? new Date(x.$date) : x)));
const same = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b));
const cmp = (a, b) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() - new Date(b).getTime() : Number(a) - Number(b));

function matches(doc, filter) {
  for (const [k, cond] of Object.entries(filter || {})) {
    if (k === '$or') { if (!cond.some((f) => matches(doc, f))) return false; continue; }
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, arg] of Object.entries(cond)) {
        if (op === '$gt' && !(v !== undefined && v !== null && cmp(v, arg) > 0)) return false;
        if (op === '$gte' && !(v !== undefined && v !== null && cmp(v, arg) >= 0)) return false;
        if (op === '$lt' && !(v !== undefined && v !== null && cmp(v, arg) < 0)) return false;
        if (op === '$lte' && !(v !== undefined && v !== null && cmp(v, arg) <= 0)) return false;
        if (op === '$in' && !arg.some((a) => same(a, v))) return false;
        if (op === '$exists' && (v !== undefined) !== Boolean(arg)) return false;
        if (op === '$ne' && same(v, arg)) return false;
      }
    } else if (cond === true || cond === false) {
      if (v !== cond) return false;
    } else if (!same(v, cond)) return false;
  }
  return true;
}

function applyUpdate(doc, update) {
  for (const [k, v] of Object.entries(update.$set || {})) doc[k] = clone(v);
  for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (Number(doc[k]) || 0) + v;
  for (const k of Object.keys(update.$unset || {})) delete doc[k];
}

class Query {
  constructor(run) { this.run = run; }
  select() { return this; }
  sort() { return this; }
  limit() { return this; }
  maxTimeMS() { return this; }
  lean() { return Promise.resolve().then(() => clone(this.run())); }
  then(a, b) { return this.lean().then(a, b); }
}

function createFakeDraftModel({ failCreate = false, failInc = false, failCharge = false } = {}) {
  const rows = [];
  const flags = { failCreate, failInc, failCharge };
  const wrap = (d) => ({ ...clone(d), toObject() { return clone(d); } });
  const M = {
    rows, flags,
    async create(doc) {
      if (flags.failCreate) throw new Error('database is full');
      const d = { _id: `d${String(++seq).padStart(23, '0')}`, attempts: 0, checks: 0, quarks: 0, refunded: false, ...clone(doc) };
      if (rows.some((r) => same(r.userId, d.userId) && r.key === d.key)) throw Object.assign(new Error('dup key'), { code: 11000 });
      if (d.inFlight === true && rows.some((r) => same(r.userId, d.userId) && r.inFlight === true)) throw Object.assign(new Error('dup in flight'), { code: 11000 });
      rows.push(d);
      return wrap(d);
    },
    findOne(filter) { return new Query(() => rows.find((r) => matches(r, filter)) || null); },
    find(filter) { return new Query(() => rows.filter((r) => matches(r, filter))); },
    async countDocuments(filter) { return rows.filter((r) => matches(r, filter)).length; },
    async updateOne(filter, update) {
      if (flags.failInc && update.$inc) throw new Error('write failed');
      const d = rows.find((r) => matches(r, filter));
      if (!d) return { modifiedCount: 0, matchedCount: 0 };
      applyUpdate(d, update);
      return { modifiedCount: 1, matchedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      if (flags.failCharge && update.$set && update.$set.status === 'charged') throw new Error('write failed');
      const d = rows.find((r) => matches(r, filter));
      if (!d) return null;
      applyUpdate(d, update);
      return wrap(d);
    },
    async aggregate() {
      const groups = new Map();
      for (const r of rows) { const k = `${r.kind}|${r.outcome || ''}`; groups.set(k, (groups.get(k) || 0) + 1); }
      return [...groups].map(([k, n]) => ({ _id: { kind: k.split('|')[0], outcome: k.split('|')[1] || undefined }, n }));
    }
  };
  return M;
}

module.exports = { createFakeDraftModel, matches };
