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
  const unsettled = (r, older, now) => ['done', 'partial', 'failed'].includes(r.status) && r.refundedQuarks > 0 && !r.refundSettledAt && r.refundFailed !== true && r.refundGaveUp !== true
    && r.finishedAt && new Date(r.finishedAt) < older && (!r.refundSettlingAt || new Date(r.refundSettlingAt) < now);
  const waiting = (r) => r.status === 'queued' && r.via === 'consumer' && r.chargedAt != null;
  // Equality on every key of a claim condition (a Date by its time; null also matches a missing field).
  const holds = (r, cond) => Object.entries(cond || {}).every(([k, c]) => {
    const v = r[k];
    if (c === null || c === undefined) return v === null || v === undefined;
    if (c instanceof Date) return v != null && new Date(v).getTime() === c.getTime();
    return v != null && String(v) === String(c);
  });
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
    closeRefused: async (id, outcome, now) => { const r = find(id); if (r && r.status === 'queued' && r.chargedAt == null) { Object.assign(r, { status: 'refused', outcome, finishedAt: now }); delete r.inFlight; } },
    closeLedger: async (id, { refundedQuarks = 0, payerId, now }) => {
      if (fail.closeLedger) throw new Error('db down');
      const r = find(id); if (!r || r.status !== 'queued' || r.chargedAt != null || r.refunded) return null;
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
    markRefundSettled: async (id, now) => { const r = find(id); if (r && !r.refundSettledAt) { r.refundSettledAt = now; delete r.refundSettlingAt; } },
    unsettledRefunds: async (older, now, limit = 10) => rows.filter((r) => unsettled(r, older, now)).slice(0, limit).map((r) => ({ _id: r._id })),
    claimSettle: async (id, older, now, holdUntil) => { const r = find(id); if (!r || !unsettled(r, older, now)) return null; r.refundSettlingAt = holdUntil; return clone(r); },
    setRefundFailed: async (id) => { const r = find(id); if (r) r.refundFailed = true; },
    refundsDue: async (now, limit = 10) => rows.filter((r) => due(r, now)).slice(0, limit).map((r) => ({ _id: r._id })),
    claimRefundRetry: async (id, now, holdUntil) => {
      const r = find(id); if (!r || !due(r, now)) return null;
      r.refundRetryAt = holdUntil; r.refundAttempts = (r.refundAttempts || 0) + 1; return clone(r);
    },
    refundRetried: async (id) => { const r = find(id); if (r && r.refundFailed) { delete r.refundFailed; delete r.refundRetryAt; } },
    refundRetryLater: async (id, at) => { const r = find(id); if (r && r.refundFailed) r.refundRetryAt = at; },
    refundGaveUp: async (id) => { const r = find(id); if (r && r.refundFailed) { r.refundGaveUp = true; delete r.refundRetryAt; } },
    refundNeedsPerson: async (id) => { const r = find(id); if (r) { r.refundFailed = true; r.refundGaveUp = true; delete r.refundRetryAt; delete r.refundSettlingAt; } },
    staleQueued: async (before, limit = 10) => rows.filter((r) => r.status === 'queued' && r.chargedAt == null && new Date(r.createdAt) < before).slice(0, limit).map((r) => ({ _id: r._id, user: r.user })),
    closeStale: async (id, { refundedQuarks = 0, payerId, outcome = 'stale_queued', now }) => {
      const r = find(id); if (!r || r.status !== 'queued' || r.chargedAt != null || r.refunded) return null;
      const before = clone(r);
      Object.assign(r, { status: 'failed', outcome, refunded: true, refundedQuarks, ...(payerId ? { payerId } : {}), finishedAt: now }); delete r.inFlight;
      return before;
    },
    lostJobs: async (now, limit = 10) => rows.filter((r) => r.status === 'running' && r.via !== 'consumer' && (!r.leaseUntil || new Date(r.leaseUntil) < now)).slice(0, limit).map((r) => ({ _id: r._id, user: r.user })),
    listOwn: async (user, limit = 20) => clone(rows.filter((r) => S(r.user) === S(user) && r.kind === 'pack' && r.status !== 'refused').sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)),
    childrenOf: async (user, parents) => clone(rows.filter((r) => S(r.user) === S(user) && r.parent && parents.map(S).includes(S(r.parent)))),
    libraryOwn: async (user, limit = 200) => clone(rows.filter((r) => S(r.user) === S(user) && ['done', 'partial'].includes(r.status) && r.photos.some((p) => p.status === 'done' && p.inLibrary)).slice(0, limit)),
    setInLibrary: async (user, id, index, on) => {
      const r = rows.find((x) => S(x._id) === S(id) && S(x.user) === S(user)); if (!r) return false;
      const p = r.photos.find((x) => x.index === index && x.status === 'done' && x.deleted !== true); if (!p) return false;
      p.inLibrary = !!on; return true;
    },
    deletePhoto: async (user, id, index) => {
      const r = rows.find((x) => S(x._id) === S(id) && S(x.user) === S(user));
      if (!r || !['done', 'partial', 'failed'].includes(r.status)) return null;
      const p = r.photos.find((x) => x.index === index && x.status === 'done' && x.deleted !== true); if (!p) return null;
      const before = clone(r);
      p.deleted = true; p.inLibrary = false; delete p.url;
      return before;
    },
    countsByOutcome: async (day) => {
      const m = new Map();
      for (const r of rows.filter((x) => x.day === day)) { const k = `${r.kind}|${r.outcome || ''}`; const e = m.get(k) || { _id: { kind: r.kind, outcome: r.outcome }, n: 0, photos: 0 }; e.n += 1; e.photos += r.photoCount || 0; m.set(k, e); }
      return [...m.values()];
    },

    // ---- consumer path (E9 B2): the same conditional rules as services/photoshoot/repo.js ----
    queueCharged: async (id, { quarks, payerId, now, quarkCharge }) => {
      if (fail.queueCharged === 'before') throw new Error('db down');
      const r = find(id); if (!r || r.status !== 'queued' || r.via !== 'consumer' || r.chargedAt != null) return null;
      Object.assign(r, { quarks, payerId, chargedAt: now, queuedAt: now, quarkCharge: clone(quarkCharge) });
      if (fail.queueCharged === 'after') throw new Error('reply lost');
      return clone(r);
    },
    waitingAll: async () => rows.filter((r) => waiting(r)).length,
    consumerCandidates: async ({ excludeUsers = [], limit = 50 } = {}) => rows.filter((r) => waiting(r) && !excludeUsers.map(S).includes(S(r.user)))
      .sort((a, b) => new Date(a.queuedAt) - new Date(b.queuedAt)).slice(0, limit).map((r) => ({ _id: r._id, user: r.user, queuedAt: r.queuedAt })),
    runningByUser: async () => { const m = new Map(); for (const r of rows.filter((x) => x.status === 'running')) m.set(S(r.user), (m.get(S(r.user)) || 0) + 1); return [...m].map(([k, n]) => ({ _id: k, n })); },
    countRunning: async (user) => rows.filter((r) => r.status === 'running' && S(r.user) === S(user)).length,
    countRunningAll: async () => rows.filter((r) => r.status === 'running').length,
    claimConsumer: async (id, owner, now, until) => {
      if (fail.claim) throw new Error('db down');
      const r = find(id); if (!r || !waiting(r)) return null;
      Object.assign(r, { status: 'running', leaseOwner: owner, leaseUntil: until, startedAt: now, runs: (r.runs || 0) + 1 });
      return clone(r);
    },
    handBack: async (id, cond, { release = false, now }) => {
      const r = find(id); if (!r || !holds(r, { ...cond, status: 'running' })) return null;
      Object.assign(r, { status: 'queued', leaseOwner: null, leaseUntil: null, queuedAt: now, runs: (r.runs || 0) - 1 });
      if (release) r.releases = (r.releases || 0) + 1;
      return clone(r);
    },
    requeueLost: async (id, cond, now) => {
      const r = find(id); if (!r || r.via !== 'consumer' || !holds(r, { ...cond, status: 'running' })) return null;
      Object.assign(r, { status: 'queued', leaseOwner: null, leaseUntil: null, queuedAt: now, leaseRequeues: (r.leaseRequeues || 0) + 1 });
      return clone(r);
    },
    heartbeat: async (id, cond, until) => { const r = find(id); if (!r || !holds(r, { ...cond, status: 'running' })) return false; r.leaseUntil = until; return true; },
    releaseCallingOwned: async (id, cond, maxCalls, now) => {
      const r = find(id); if (!r || !holds(r, { ...cond, status: 'running' })) return;
      for (const p of r.photos) if (p.status === 'calling') { if ((p.attempts || 0) < maxCalls) p.status = 'pending'; else { p.status = 'failed'; p.reason = 'lost'; p.finishedAt = now; } }
    },
    startPhotoOwned: async (id, cond, index, now) => {
      const r = find(id); if (!r || !holds(r, { ...cond, status: 'running' })) return false;
      const p = r.photos.find((x) => x.index === index && x.status === 'pending'); if (!p) return false;
      p.status = 'calling'; p.startedAt = now; p.attempts = (p.attempts || 0) + 1; return true;
    },
    finishPhotoOwned: async (id, cond, index, { status, url, reason, now }) => {
      if (fail.finishPhoto) throw new Error('db down');
      const r = find(id); if (!r || !holds(r, { status: 'running', ...cond })) return false;
      const p = r.photos.find((x) => x.index === index && x.status === 'calling'); if (!p) return false;
      p.status = status; p.finishedAt = now; if (url) p.url = url; if (reason) p.reason = reason; return true;
    },
    failOpenWhere: async (id, cond, reason, now) => {
      const r = find(id); if (!r || !holds(r, cond)) return { matchedCount: 0 };
      for (const p of r.photos) if (!TERMINAL.includes(p.status)) { p.status = 'failed'; p.reason = reason; p.finishedAt = now; }
      return { matchedCount: 1 };
    },
    closeWhere: async (id, cond, set) => {
      if (fail.closeWhere) throw new Error('db down');
      const r = find(id);
      if (!r || !holds(r, cond) || r.refunded || r.photos.some((p) => !TERMINAL.includes(p.status))) return null;
      Object.assign(r, clone(set), { refunded: true });
      delete r.inFlight; delete r.leaseOwner; delete r.leaseUntil;
      return clone(r);
    },
    expiredConsumerLeases: async (before, limit = 25) => clone(rows.filter((r) => r.status === 'running' && r.via === 'consumer' && r.leaseOwner != null && r.leaseUntil && new Date(r.leaseUntil) < before).slice(0, limit)),
    stuckConsumerRuns: async (chargedBefore, limit = 10) => clone(rows.filter((r) => r.status === 'running' && r.via === 'consumer' && r.chargedAt && new Date(r.chargedAt) < chargedBefore).slice(0, limit)),
    waitingTooLong: async (before, limit = 25) => clone(rows.filter((r) => waiting(r) && r.queuedAt && new Date(r.queuedAt) < before).slice(0, limit)),
    consumerStatusCounts: async () => {
      const m = new Map();
      for (const r of rows.filter((x) => x.via === 'consumer' && x.chargedAt != null && ['queued', 'running'].includes(x.status))) {
        const e = m.get(r.status) || { _id: r.status, n: 0, oldest: null };
        e.n += 1; if (r.queuedAt && (!e.oldest || new Date(r.queuedAt) < e.oldest)) e.oldest = new Date(r.queuedAt);
        m.set(r.status, e);
      }
      return [...m.values()];
    },
    runningByWorker: async () => { const m = new Map(); for (const r of rows.filter((x) => x.status === 'running')) { const k = r.leaseOwner == null ? null : r.leaseOwner; const e = m.get(String(k)) || { _id: k, via: r.via, n: 0 }; e.n += 1; m.set(String(k), e); } return [...m.values()]; }
  };
  return repo;
}

module.exports = { createFakePhotoshootRepo };
