// Tiny in-memory stand-ins for the inbox models, so inbox tests never touch a database.
const mongoose = require('mongoose');

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[keys[keys.length - 1]] = value;
}
const same = (a, b) => String(a) === String(b);

function matchValue(actual, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId)) {
    return Object.entries(cond).every(([op, v]) => {
      if (op === '$in') return v.some((x) => same(x, actual));
      if (op === '$gte') return actual >= v;
      if (op === '$lt') return actual < v;
      if (op === '$ne') return !same(actual, v);
      if (op === '$exists') return (actual !== undefined) === v;
      if (op === '$not') return !matchValue(actual, v);
      return false;
    });
  }
  return same(actual, cond);
}
function matches(doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return cond.some((q) => matches(doc, q));
    return matchValue(getPath(doc, key), cond);
  });
}

class Query {
  constructor(run) { this.run = run; this.sortSpec = null; this.max = null; }
  sort(spec) { this.sortSpec = spec; return this; }
  limit(n) { this.max = n; return this; }
  select() { return this; }
  lean() { return this; }
  exec() { return this.then((v) => v); }
  then(res, rej) {
    let rows = this.run();
    if (this.sortSpec) {
      const [[k, dir]] = Object.entries(this.sortSpec);
      rows = [...rows].sort((a, b) => (new Date(a[k]) - new Date(b[k])) * dir);
    }
    if (this.max) rows = rows.slice(0, this.max);
    return Promise.resolve(this.single ? (rows[0] || null) : rows).then(res, rej);
  }
}

function makeModel(defaults = () => ({})) {
  const rows = [];
  class Model {
    constructor(data) { Object.assign(this, defaults(), data); if (!this._id) this._id = new mongoose.Types.ObjectId(); }
    async save() { if (!rows.includes(this)) rows.push(this); return this; }
    static async create(data) { const doc = new Model(data); rows.push(doc); return doc; }
    static find(q = {}) { return new Query(() => rows.filter((r) => matches(r, q))); }
    static findOne(q = {}) { const query = new Query(() => rows.filter((r) => matches(r, q))); query.single = true; return query; }
    static findById(id) { return Model.findOne({ _id: id }); }
    static async countDocuments(q = {}) { return rows.filter((r) => matches(r, q)).length; }
    static async findOneAndUpdate(q, update) {
      const doc = rows.find((r) => matches(r, q));
      if (!doc) return null;
      Object.entries(update.$set || {}).forEach(([k, v]) => setPath(doc, k, v));
      Object.entries(update.$inc || {}).forEach(([k, v]) => setPath(doc, k, (getPath(doc, k) || 0) + v));
      return doc;
    }
    static async updateOne(q, update) {
      const doc = rows.find((r) => matches(r, q));
      if (!doc) return { matchedCount: 0 };
      Object.entries(update.$set || {}).forEach(([k, v]) => setPath(doc, k, v));
      return { matchedCount: 1 };
    }
    static async updateMany() { return { matchedCount: 0 }; }
    static aggregate() { return Promise.resolve([]); }
  }
  Model.rows = rows;
  Model.reset = () => { rows.length = 0; };
  return Model;
}

module.exports = { makeModel };
