'use strict';
// Test helpers for the Blueprint service: an in-memory model and fake dependencies. Not a test file.
const sheetFixture = require('./fixtures/blueprintSheet.json');

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v), (k, x) => (typeof x === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(x) ? new Date(x) : x)));
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, p, val) {
  const keys = p.split('.');
  let cur = o;
  keys.slice(0, -1).forEach((k) => { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; });
  cur[keys[keys.length - 1]] = val;
}
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([path, cond]) => {
    const v = getPath(doc, path);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, x]) => {
        if (op === '$in') return (Array.isArray(v) ? v : [v]).some((e) => x.includes(e));
        if (op === '$ne') return Array.isArray(v) ? !v.includes(x) : v !== x;
        if (op === '$gte') return v != null && new Date(v).valueOf() >= new Date(x).valueOf();
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return Array.isArray(v) ? v.includes(cond) : v === cond;
  });
}
function applyUpdate(doc, update) {
  Object.entries(update.$set || {}).forEach(([p, val]) => setPath(doc, p, clone(val)));
}

function makeBlueprintModel() {
  const docs = [];
  return {
    docs,
    async create(d) {
      const c = clone(d);
      if (c.freeSlot === true) {
        const clash = docs.some((o) => o.freeSlot === true && (o.emailKey === c.emailKey || (o.businessKeys || []).some((k) => (c.businessKeys || []).includes(k))));
        if (clash) throw Object.assign(new Error('E11000'), { code: 11000 });
      }
      docs.push(c);
      return clone(c);
    },
    async findOne(filter) { const d = docs.find((x) => matches(x, filter)); return d ? clone(d) : null; },
    find(filter) {
      let rows = docs.filter((x) => matches(x, filter));
      const q = {
        sort() { rows = rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); return q; },
        limit(n) { rows = rows.slice(0, n); return q; },
        async lean() { return rows.map(clone); }
      };
      return q;
    },
    async findOneAndUpdate(filter, update) {
      const d = docs.find((x) => matches(x, filter));
      if (!d) return null;
      const before = clone(d);
      applyUpdate(d, update);
      return before;
    },
    async updateOne(filter, update) {
      const d = docs.find((x) => matches(x, filter));
      if (d) applyUpdate(d, update);
      return { matchedCount: d ? 1 : 0 };
    },
    async countDocuments(filter) { return docs.filter((x) => matches(x, filter)).length; }
  };
}

const goodResult = () => ({ cover: { businessName: 'Sweet Co' }, pages: [], closing: {} });

// over: any dep to replace; `clock.t` is the fake time in ms.
function makeDeps(over = {}) {
  const Blueprint = over.Blueprint || makeBlueprintModel();
  const calls = { deduct: [], refund: [], upload: [], discover: 0, directions: 0, build: 0, buildArgs: [], discoverArgs: [] };
  const queued = [];
  const clock = { t: Date.parse('2026-10-04T10:00:00Z') };
  let n = 0;
  const deps = {
    Blueprint, calls, queued, clock,
    deduct: async (...a) => { calls.deduct.push(a); return { success: true, creditsDeducted: 7 }; },
    refund: async (...a) => { calls.refund.push(a); return { success: true, creditsRefunded: 7 }; },
    uploadLogo: async (d) => { calls.upload.push(d); return 'https://res.cloudinary.com/demo/image/upload/logo.png'; },
    discover: async (a) => { calls.discover += 1; calls.discoverArgs.push(a); return { sheet: clone(sheetFixture), sources: [{ id: 'S1', url: 'https://sweetco.in/', kind: 'website', ok: true }] }; },
    plan: {
      build: async (a) => { calls.build += 1; calls.buildArgs.push(a); return { result: goodResult(), qa: { passed: true, flags: [] } }; },
      directions: async () => { calls.directions += 1; return [0, 1, 2].map((i) => ({ name: `Direction ${i}`, rationale: { text: `Why ${i}`, tag: 'proposed' }, risk: { text: `Risk ${i}`, tag: 'proposed' } })); }
    },
    enqueue: (t) => { queued.push(t); },
    now: () => clock.t,
    uuid: () => { n += 1; return `bp-${n}`; },
    hashIp: (ip) => `h:${ip}`,
    ...over
  };
  deps.drain = async () => { while (queued.length) await queued.shift()(); };
  return deps;
}

module.exports = { makeBlueprintModel, makeDeps, clone, goodResult };
