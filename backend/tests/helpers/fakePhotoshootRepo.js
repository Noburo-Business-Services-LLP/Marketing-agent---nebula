'use strict';
// An in-memory copy of services/photoshoot/repo.js with the same conditional rules (unique key per user, one job in
// flight per user, lease-holder-only calls, refund claimed once). The real file is checked against MongoDB by
// scripts/photoshoot-check.js.
const TERMINAL = ['done', 'failed'];
let seq = 0;
const newId = () => `6c${String(++seq).padStart(22, '0')}`;
const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x), (k, v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v)));
const dup = () => Object.assign(new Error('duplicate key'), { code: 11000 });

function createFakePhotoshootRepo({ fail = {} } = {}) {
  const rows = [];
  const S = (v) => String(v);
  const find = (id) => rows.find((r) => S(r._id) === S(id));
  const due = (r, now) => r.refundFailed === true && r.refundGaveUp !== true && (!r.refundRetryAt || new Date(r.refundRetryAt) <= now);
  const leaseFree = (r, owner, now) => !r.leaseUntil || new Date(r.leaseUntil) < now || r.leaseOwner === owner;
  const repo = {
    rows, fail,
    findByKey: async (user, key) => clone(rows.find((r) => S(r.user) === S(user) && r.key === key) || null),
    findOwn: async (user, id) => clone(rows.find((r) => S(r._id) === S(id) && S(r.user) === S(user)) || null),
    findById: async (id) => clone(find(id) || null),
    insert: async (doc) => {
      if (fail.insert) throw new Error('db down');
      if (rows.some((r) => S(r.user) === S(doc.user) && r.key === doc.key)) throw dup();
      if (doc.inFlight && rows.some((r) => S(r.user) === S(doc.user) && r.inFlight)) throw dup();
      const row = { _id: newId(), refunded: false, refundedQuarks: 0, createdAt: new Date(), ...clone(doc) };
      rows.push(row);
      return clone(row);
    },
    anyInFlight: async (user) => (rows.find((r) => S(r.user) === S(user) && r.inFlight) ? { _id: 'x' } : null),
    countStartsSince: async (user, since) => rows.filter((r) => S(r.user) === S(user) && new Date(r.createdAt) >= since).length,
    photosToday: async (user, day) => rows.filter((r) => S(r.user) === S(user) && r.day === day && r.quarks > 0).reduce((a, r) => a + (r.photoCount || 0), 0),
    runningAll: async () => rows.filter((r) => r.inFlight && r.status === 'running').length,
    markCharged: async (id, { quarks, payerId, now }) => {
      if (fail.markCharged) return false;
      const r = find(id); if (!r || r.status !== 'queued') return false;
      Object.assign(r, { status: 'running', quarks, payerId, chargedAt: now }); return true;
    },
    closeRefused: async (id, outcome, now) => { const r = find(id); if (r && r.status === 'queued') { Object.assign(r, { status: 'refused', outcome, finishedAt: now }); delete r.inFlight; } },
    closeLedger: async (id, { refundedQuarks = 0, payerId, now }) => {
      const r = find(id); if (!r || r.status !== 'queued' || r.refunded) return null;
      const before = clone(r);
      Object.assign(r, { status: 'failed', outcome: 'ledger', refunded: true, refundedQuarks, ...(payerId ? { payerId } : {}), finishedAt: now }); delete r.inFlight;
      return before;
    },
    claimLease: async (id, owner, now, until) => {
      const r = find(id); if (!r || r.status !== 'running' || !leaseFree(r, owner, now)) return null;
      Object.assign(r, { leaseOwner: owner, leaseUntil: until }); return clone(r);
    },
    renewLease: async (id, owner, until) => { const r = find(id); if (!r || r.status !== 'running' || r.leaseOwner !== owner) return false; r.leaseUntil = until; return true; },
    startPhoto: async (id, owner, index, now) => {
      const r = find(id); if (!r || r.status !== 'running' || r.leaseOwner !== owner) return false;
      const p = r.photos.find((x) => x.index === index && x.status === 'pending'); if (!p) return false;
      p.status = 'calling'; p.startedAt = now; p.attempts = (p.attempts || 0) + 1; return true;
    },
    finishPhoto: async (id, index, { status, url, reason, now }) => {
      const r = find(id); if (!r || r.status !== 'running') return false;
      const p = r.photos.find((x) => x.index === index && x.status === 'calling'); if (!p) return false;
      p.status = status; p.finishedAt = now; if (url) p.url = url; if (reason) p.reason = reason; return true;
    },
    releaseCalling: async (id, maxCalls, now) => {
      const r = find(id); if (!r || r.status !== 'running') return;
      for (const p of r.photos) if (p.status === 'calling') { if ((p.attempts || 0) < maxCalls) p.status = 'pending'; else { p.status = 'failed'; p.reason = 'lost'; p.finishedAt = now; } }
    },
    failOpen: async (id, reason, now) => {
      const r = find(id); if (!r || r.status !== 'running') return;
      for (const p of r.photos) if (!TERMINAL.includes(p.status)) { p.status = 'failed'; p.reason = reason; p.finishedAt = now; }
    },
    finalize: async (id, { status, outcome, refundedQuarks, now }) => {
      const r = find(id);
      if (!r || r.status !== 'running' || r.refunded || r.photos.some((p) => !TERMINAL.includes(p.status))) return null;
      const before = clone(r);
      Object.assign(r, { status, outcome, refunded: true, refundedQuarks, finishedAt: now });
      delete r.inFlight; delete r.leaseOwner; delete r.leaseUntil;
      return before;
    },
    setRefundFailed: async (id) => { const r = find(id); if (r) r.refundFailed = true; },
    refundsDue: async (now, limit = 10) => rows.filter((r) => due(r, now)).slice(0, limit).map((r) => ({ _id: r._id })),
    claimRefundRetry: async (id, now, holdUntil) => {
      const r = find(id); if (!r || !due(r, now)) return null;
      r.refundRetryAt = holdUntil; r.refundAttempts = (r.refundAttempts || 0) + 1; return clone(r);
    },
    refundRetried: async (id) => { const r = find(id); if (r && r.refundFailed) { delete r.refundFailed; delete r.refundRetryAt; } },
    refundRetryLater: async (id, at) => { const r = find(id); if (r && r.refundFailed) r.refundRetryAt = at; },
    refundGaveUp: async (id) => { const r = find(id); if (r && r.refundFailed) { r.refundGaveUp = true; delete r.refundRetryAt; } },
    staleQueued: async (before, limit = 10) => rows.filter((r) => r.status === 'queued' && new Date(r.createdAt) < before).slice(0, limit).map((r) => ({ _id: r._id, user: r.user })),
    closeStale: async (id, { refundedQuarks = 0, payerId, outcome = 'stale_queued', now }) => {
      const r = find(id); if (!r || r.status !== 'queued' || r.refunded) return null;
      const before = clone(r);
      Object.assign(r, { status: 'failed', outcome, refunded: true, refundedQuarks, ...(payerId ? { payerId } : {}), finishedAt: now }); delete r.inFlight;
      return before;
    },
    lostJobs: async (now, limit = 10) => rows.filter((r) => r.status === 'running' && (!r.leaseUntil || new Date(r.leaseUntil) < now)).slice(0, limit).map((r) => ({ _id: r._id, user: r.user })),
    listOwn: async (user, limit = 20) => clone(rows.filter((r) => S(r.user) === S(user) && r.kind === 'pack' && r.status !== 'refused').sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)),
    childrenOf: async (user, parents) => clone(rows.filter((r) => S(r.user) === S(user) && r.parent && parents.map(S).includes(S(r.parent)))),
    libraryOwn: async (user, limit = 200) => clone(rows.filter((r) => S(r.user) === S(user) && ['done', 'partial'].includes(r.status) && r.photos.some((p) => p.status === 'done' && p.inLibrary)).slice(0, limit)),
    setInLibrary: async (user, id, index, on) => {
      const r = rows.find((x) => S(x._id) === S(id) && S(x.user) === S(user)); if (!r) return false;
      const p = r.photos.find((x) => x.index === index && x.status === 'done'); if (!p) return false;
      p.inLibrary = !!on; return true;
    },
    countsByOutcome: async (day) => {
      const m = new Map();
      for (const r of rows.filter((x) => x.day === day)) { const k = `${r.kind}|${r.outcome || ''}`; const e = m.get(k) || { _id: { kind: r.kind, outcome: r.outcome }, n: 0, photos: 0 }; e.n += 1; e.photos += r.photoCount || 0; m.set(k, e); }
      return [...m.values()];
    }
  };
  return repo;
}

module.exports = { createFakePhotoshootRepo };
