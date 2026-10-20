'use strict';
/**
 * Every database step of the Photoshoot studio, each one a single conditional MongoDB update so two server processes
 * (or a runner and the resume loop) can never both start the same call, finish the same photo or refund the same job.
 * The unit tests use an in-memory copy with the same rules (tests/helpers/fakePhotoshootRepo.js); the real-database
 * check (scripts/photoshoot-check.js) runs this file against nebulaa_dev.
 */
function createPhotoshootRepo({ Job = () => require('../../models/PhotoshootJob') } = {}) {
  const J = () => Job();
  const lean = (q) => (q && typeof q.lean === 'function' ? q.lean() : q);
  const TERMINAL_PHOTO = ['done', 'failed'];

  return {
    findByKey: (user, key) => lean(J().findOne({ user, key })),
    findOwn: (user, id) => lean(J().findOne({ _id: id, user })),
    findById: (id) => lean(J().findById(id)),
    insert: async (doc) => (await J().create(doc)).toObject(),
    anyInFlight: (user) => lean(J().findOne({ user, inFlight: true }).select('_id')),
    countStartsSince: (user, since) => J().countDocuments({ user, createdAt: { $gte: since } }),
    photosToday: async (user, day) => {
      const rows = await J().aggregate([{ $match: { user: toId(user), day, quarks: { $gt: 0 } } }, { $group: { _id: null, n: { $sum: '$photoCount' } } }]);
      return rows.length ? rows[0].n : 0;
    },
    runningAll: () => J().countDocuments({ inFlight: true, status: 'running' }),
    markCharged: async (id, { quarks, payerId, now }) => {
      const r = await J().updateOne({ _id: id, status: 'queued' }, { $set: { status: 'running', quarks, payerId, chargedAt: now } });
      return r.modifiedCount === 1;
    },
    // `chargedAt: null` on every "written, not yet charged" path: an in-process queued row never has a recorded charge (it
    // gets one in the same write that makes it running); a consumer row that waits for a worker does (E9 B2), and only the
    // consumer closes or claims it.
    closeRefused: (id, outcome, now) => J().updateOne({ _id: id, status: 'queued', chargedAt: null }, { $set: { status: 'refused', outcome, finishedAt: now }, $unset: { inFlight: 1 } }),
    /**
     * The charge landed but could not be marked on the job: closes it and claims its refund in one step. Returns the row
     * before the change, or null when it was no longer queued or its refund was already claimed (the stale sweep got
     * there first), in which case the caller must not refund.
     */
    closeLedger: (id, { refundedQuarks = 0, payerId, now }) => lean(J().findOneAndUpdate(
      { _id: id, status: 'queued', chargedAt: null, refunded: { $ne: true } },
      { $set: { status: 'failed', outcome: 'ledger', refunded: true, refundedQuarks, ...(payerId ? { payerId } : {}), finishedAt: now }, $unset: { inFlight: 1 } },
      { new: false })),
    /**
     * A charge landed AFTER the stale sweep closed its row with a 0 refund (the charge was slower than the stale window).
     * Records the refund on that closed row in one conditional update (only a row closed 'stale_queued' with refund 0 and no
     * recorded charge, so it can happen once); refundSettledAt stays unset, so the settle sweep pays it once, with proof.
     * The row after, or null.
     */
    claimLateRefund: (id, { refundedQuarks, payerId, now }) => lean(J().findOneAndUpdate(
      { _id: id, status: 'failed', outcome: 'stale_queued', refunded: true, refundedQuarks: 0, chargedAt: null, refundSettledAt: null },
      { $set: { refundedQuarks, ...(payerId ? { payerId } : {}), finishedAt: now } }, { new: true })),
    claimLease: (id, owner, now, until) => lean(J().findOneAndUpdate(
      { _id: id, status: 'running', $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }, { leaseOwner: owner }] },
      { $set: { leaseOwner: owner, leaseUntil: until } }, { new: true })),
    renewLease: async (id, owner, until) => (await J().updateOne({ _id: id, status: 'running', leaseOwner: owner }, { $set: { leaseUntil: until } })).modifiedCount === 1,
    /** pending -> calling, attempts + 1, only for the lease holder. True when this caller may now make the call. */
    startPhoto: async (id, owner, index, now) => (await J().updateOne(
      { _id: id, status: 'running', leaseOwner: owner, photos: { $elemMatch: { index, status: 'pending' } } },
      { $set: { 'photos.$.status': 'calling', 'photos.$.startedAt': now }, $inc: { 'photos.$.attempts': 1 } })).modifiedCount === 1,
    /** calling -> done | pending | failed. False when the photo was closed meanwhile (the result is then dropped). */
    finishPhoto: async (id, index, { status, url, reason, now }) => {
      const set = { 'photos.$.status': status, 'photos.$.finishedAt': now };
      if (url) set['photos.$.url'] = url;
      if (reason) set['photos.$.reason'] = reason;
      const r = await J().updateOne({ _id: id, status: 'running', photos: { $elemMatch: { index, status: 'calling' } } }, { $set: set });
      return r.modifiedCount === 1;
    },
    /** After taking over a lost runner: a photo left calling goes back to pending if it has a call left, else fails. */
    releaseCalling: async (id, maxCalls, now) => {
      await J().updateOne({ _id: id, status: 'running' }, { $set: { 'photos.$[p].status': 'pending' } }, { arrayFilters: [{ 'p.status': 'calling', 'p.attempts': { $lt: maxCalls } }] });
      await J().updateOne({ _id: id, status: 'running' }, { $set: { 'photos.$[p].status': 'failed', 'photos.$[p].reason': 'lost', 'photos.$[p].finishedAt': now } }, { arrayFilters: [{ 'p.status': 'calling', 'p.attempts': { $gte: maxCalls } }] });
    },
    /** Every unfinished photo fails with this reason (switch off, too old). */
    failOpen: (id, reason, now) => J().updateOne({ _id: id, status: 'running' }, { $set: { 'photos.$[p].status': 'failed', 'photos.$[p].reason': reason, 'photos.$[p].finishedAt': now } }, { arrayFilters: [{ 'p.status': { $nin: TERMINAL_PHOTO } }] }),
    /** Finishes the job and claims its refund in one step. Returns the job before the change, or null if already done. */
    finalize: (id, { status, outcome, refundedQuarks, now }) => lean(J().findOneAndUpdate(
      { _id: id, status: 'running', refunded: false, photos: { $not: { $elemMatch: { status: { $nin: TERMINAL_PHOTO } } } } },
      { $set: { status, outcome, refunded: true, refundedQuarks, finishedAt: now }, $unset: { inFlight: 1, leaseOwner: 1, leaseUntil: 1 } },
      { new: false })),
    /** The refund is paid (or was found paid): the job needs no settle sweep. Once only. */
    markRefundSettled: (id, now) => J().updateOne({ _id: id, refundSettledAt: null }, { $set: { refundSettledAt: now }, $unset: { refundSettlingAt: 1 } }),
    /** Closed jobs with a recorded refund not yet settled, finished before `older`, not held by a sweep (see service.sweepUnsettled). */
    unsettledRefunds: (older, now, limit = 10) => lean(J().find(unsettledQuery(older, now)).select('_id').limit(limit)),
    /** Claims one: holds it until `holdUntil`, only if still unsettled and not held. The row after, or null. */
    claimSettle: (id, older, now, holdUntil) => lean(J().findOneAndUpdate({ _id: id, ...unsettledQuery(older, now) }, { $set: { refundSettlingAt: holdUntil } }, { new: true })),
    setRefundFailed: (id) => J().updateOne({ _id: id }, { $set: { refundFailed: true } }),
    /** Refunds that did not land and are due for another try (see service.retryRefunds). */
    refundsDue: (now, limit = 10) => lean(J().find(retryDue(now)).select('_id').limit(limit)),
    /** Claims one retry: moves its time forward (the hold) and counts it, only if still due. The row after, or null. */
    claimRefundRetry: (id, now, holdUntil) => lean(J().findOneAndUpdate({ _id: id, ...retryDue(now) }, { $set: { refundRetryAt: holdUntil }, $inc: { refundAttempts: 1 } }, { new: true })),
    refundRetried: (id) => J().updateOne({ _id: id, refundFailed: true }, { $unset: { refundFailed: 1, refundRetryAt: 1 } }),
    refundRetryLater: (id, at) => J().updateOne({ _id: id, refundFailed: true }, { $set: { refundRetryAt: at } }),
    refundGaveUp: (id) => J().updateOne({ _id: id, refundFailed: true }, { $set: { refundGaveUp: true }, $unset: { refundRetryAt: 1 } }),
    /** A recorded refund the proof does not support (no charge found, or above it): no sweep pays it; a person checks. */
    refundNeedsPerson: (id) => J().updateOne({ _id: id }, { $set: { refundFailed: true, refundGaveUp: true }, $unset: { refundRetryAt: 1, refundSettlingAt: 1 } }),
    /** Rows still queued after `before`: the process died, or a close failed, between the insert and the charge being marked. */
    staleQueued: (before, limit = 10) => lean(J().find({ status: 'queued', chargedAt: null, createdAt: { $lt: before } }).select('_id user').limit(limit)),
    /**
     * Closes a stale queued row and claims its refund in one step (so a second sweep, or another process, finds nothing to
     * do). Returns the row before the change, or null when it was no longer queued or its refund was already claimed.
     */
    closeStale: (id, { refundedQuarks = 0, payerId, outcome = 'stale_queued', now }) => lean(J().findOneAndUpdate(
      { _id: id, status: 'queued', chargedAt: null, refunded: { $ne: true } },
      { $set: { status: 'failed', outcome, refunded: true, refundedQuarks, ...(payerId ? { payerId } : {}), finishedAt: now }, $unset: { inFlight: 1 } },
      { new: false })),
    // The in-process resume loop never takes a consumer row (E9 B2: the consumer and its lease sweep own those).
    lostJobs: (now, limit = 10) => lean(J().find({ status: 'running', via: { $ne: 'consumer' }, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] }).select('_id user').limit(limit)),
    listOwn: (user, limit = 20) => lean(J().find({ user, kind: 'pack', status: { $ne: 'refused' } }).sort({ createdAt: -1 }).limit(limit)),
    childrenOf: (user, parentIds) => lean(J().find({ user, parent: { $in: parentIds } }).sort({ createdAt: 1 })),
    libraryOwn: (user, limit = 200) => lean(J().find({ user, status: { $in: ['done', 'partial'] }, photos: { $elemMatch: { status: 'done', inLibrary: true } } }).sort({ createdAt: -1 }).limit(limit)),
    setInLibrary: async (user, id, index, on) => (await J().updateOne({ _id: id, user, photos: { $elemMatch: { index, status: 'done', deleted: { $ne: true } } } }, { $set: { 'photos.$.inLibrary': !!on } })).matchedCount === 1,
    /**
     * Deletes ONE finished photo of a finished job: marks it deleted, takes it out of the Library and removes its link,
     * in one conditional step (a running job never matches). Returns the job as it was before (so the caller can clean up
     * the stored image), or null. Never touches the refund, the charge or the counts on the job.
     */
    deletePhoto: (user, id, index) => lean(J().findOneAndUpdate(
      { _id: id, user, status: { $in: ['done', 'partial', 'failed'] }, photos: { $elemMatch: { index, status: 'done', deleted: { $ne: true } } } },
      { $set: { 'photos.$.deleted': true, 'photos.$.inLibrary': false }, $unset: { 'photos.$.url': 1 } },
      { new: false })),
    countsByOutcome: (day) => J().aggregate([{ $match: { day } }, { $group: { _id: { kind: '$kind', outcome: '$outcome' }, n: { $sum: 1 }, photos: { $sum: '$photoCount' } } }]),

    // ---- consumer path (E9 stage B2, services/photoshootConsumer.js; impact map "Stage B step 2") ----------------------
    // `cond` is the claim a caller read: { status, leaseOwner, runs } for a run (plus leaseUntil for a lease sweep), or
    // { status: 'queued', queuedAt } for a waiting row. Every write below is conditional on it.

    /** The charge landed: the SAME row becomes claimable (still 'queued', now with its charge recorded). The row after, or null. */
    queueCharged: (id, { quarks, payerId, now, quarkCharge }) => lean(J().findOneAndUpdate(
      { _id: id, status: 'queued', via: 'consumer', chargedAt: null },
      { $set: { quarks, payerId, chargedAt: now, queuedAt: now, quarkCharge } }, { new: true })),
    /** Charged consumer rows waiting for a worker (for the all-accounts cap). */
    waitingAll: () => J().countDocuments(WAITING),
    consumerCandidates: ({ excludeUsers = [], limit = 50 } = {}) => lean(J().find({ ...WAITING, ...(excludeUsers.length ? { user: { $nin: excludeUsers } } : {}) })
      .sort({ queuedAt: 1 }).limit(limit).select('_id user queuedAt')),
    /** Running photoshoots per account, all workers and the in-process path together. [{ _id: user, n }] */
    runningByUser: () => J().aggregate([{ $match: { status: 'running' } }, { $group: { _id: '$user', n: { $sum: 1 } } }]),
    countRunning: (user) => J().countDocuments({ status: 'running', user }),
    countRunningAll: () => J().countDocuments({ status: 'running' }),
    /** waiting -> running for THIS worker: one atomic update. The row after, or null when another worker took it. */
    claimConsumer: (id, owner, now, until) => lean(J().findOneAndUpdate(
      { _id: id, ...WAITING },
      { $set: { status: 'running', leaseOwner: owner, leaseUntil: until, startedAt: now }, $inc: { runs: 1 } }, { new: true })),
    /** Back to waiting with the run not counted (per-account cap, a claim after SIGTERM; `release` counts a SIGTERM hand-back). */
    handBack: (id, cond, { release = false, now }) => lean(J().findOneAndUpdate(
      { _id: id, ...cond, status: 'running' },
      { $set: { status: 'queued', leaseOwner: null, leaseUntil: null, queuedAt: now }, $inc: { runs: -1, ...(release ? { releases: 1 } : {}) } }, { new: true })),
    /** A lost lease under the run cap: back to waiting (the next run resumes). The row after, or null. */
    requeueLost: (id, cond, now) => lean(J().findOneAndUpdate(
      { _id: id, ...cond, status: 'running', via: 'consumer' },
      { $set: { status: 'queued', leaseOwner: null, leaseUntil: null, queuedAt: now }, $inc: { leaseRequeues: 1 } }, { new: true })),
    heartbeat: async (id, cond, until) => matched(await J().updateOne({ _id: id, ...cond, status: 'running' }, { $set: { leaseUntil: until } })),
    /** After a claim: a photo a dead run left calling goes back to pending if it has a call left, else fails 'lost'. */
    releaseCallingOwned: async (id, cond, maxCalls, now) => {
      const f = { _id: id, ...cond, status: 'running' };
      await J().updateOne(f, { $set: { 'photos.$[p].status': 'pending' } }, { arrayFilters: [{ 'p.status': 'calling', 'p.attempts': { $lt: maxCalls } }] });
      await J().updateOne(f, { $set: { 'photos.$[p].status': 'failed', 'photos.$[p].reason': 'lost', 'photos.$[p].finishedAt': now } }, { arrayFilters: [{ 'p.status': 'calling', 'p.attempts': { $gte: maxCalls } }] });
    },
    startPhotoOwned: async (id, cond, index, now) => (await J().updateOne(
      { _id: id, ...cond, status: 'running', photos: { $elemMatch: { index, status: 'pending' } } },
      { $set: { 'photos.$.status': 'calling', 'photos.$.startedAt': now }, $inc: { 'photos.$.attempts': 1 } })).modifiedCount === 1,
    finishPhotoOwned: async (id, cond, index, { status, url, reason, now }) => {
      const set = { 'photos.$.status': status, 'photos.$.finishedAt': now };
      if (url) set['photos.$.url'] = url;
      if (reason) set['photos.$.reason'] = reason;
      return (await J().updateOne({ _id: id, ...cond, status: cond.status || 'running', photos: { $elemMatch: { index, status: 'calling' } } }, { $set: set })).modifiedCount === 1;
    },
    /** Every unfinished photo of the claim that was read fails with this reason. */
    failOpenWhere: (id, cond, reason, now) => J().updateOne({ _id: id, ...cond }, { $set: { 'photos.$[p].status': 'failed', 'photos.$[p].reason': reason, 'photos.$[p].finishedAt': now } }, { arrayFilters: [{ 'p.status': { $nin: TERMINAL_PHOTO } }] }),
    /** Closes the job AND claims its refund in ONE write, only while it is still the claim that was read. The row after, or null. */
    closeWhere: (id, cond, set) => lean(J().findOneAndUpdate(
      { _id: id, ...cond, refunded: false, photos: { $not: { $elemMatch: { status: { $nin: TERMINAL_PHOTO } } } } },
      { $set: { ...set, refunded: true }, $unset: { inFlight: 1, leaseOwner: 1, leaseUntil: 1 } }, { new: true })),
    expiredConsumerLeases: (before, limit = 25) => lean(J().find({ status: 'running', via: 'consumer', leaseOwner: { $ne: null }, leaseUntil: { $lt: before } }).limit(limit)),
    /** Consumer runs still open long after their charge (a worker alive but stuck: its heartbeat keeps the lease fresh). */
    stuckConsumerRuns: (chargedBefore, limit = 10) => lean(J().find({ status: 'running', via: 'consumer', chargedAt: { $lt: chargedBefore } }).limit(limit)),
    waitingTooLong: (before, limit = 25) => lean(J().find({ ...WAITING, queuedAt: { $lt: before } }).sort({ queuedAt: 1 }).limit(limit)),
    /** Staff numbers: waiting and running consumer rows with the oldest wait. [{ _id: status, n, oldest }] */
    consumerStatusCounts: () => J().aggregate([{ $match: { via: 'consumer', chargedAt: { $ne: null }, status: { $in: ['queued', 'running'] } } }, { $group: { _id: '$status', n: { $sum: 1 }, oldest: { $min: '$queuedAt' } } }]),
    runningByWorker: () => J().aggregate([{ $match: { status: 'running' } }, { $group: { _id: { $ifNull: ['$leaseOwner', null] }, via: { $first: '$via' }, n: { $sum: 1 } } }])
  };
}

// A consumer row whose charge landed and that waits for a worker.
const WAITING = Object.freeze({ status: 'queued', via: 'consumer', chargedAt: { $ne: null } });
const matched = (r) => Number(r && (r.matchedCount !== undefined ? r.matchedCount : r.modifiedCount)) > 0;

function unsettledQuery(older, now) {
  return {
    status: { $in: ['done', 'partial', 'failed'] }, refundedQuarks: { $gt: 0 }, refundSettledAt: null,
    refundFailed: { $ne: true }, refundGaveUp: { $ne: true }, finishedAt: { $lt: older },
    $or: [{ refundSettlingAt: null }, { refundSettlingAt: { $lt: now } }]
  };
}

function retryDue(now) {
  return { refundFailed: true, refundGaveUp: { $ne: true }, $or: [{ refundRetryAt: { $exists: false } }, { refundRetryAt: null }, { refundRetryAt: { $lte: now } }] };
}

function toId(v) {
  const mongoose = require('mongoose');
  try { return new mongoose.Types.ObjectId(String(v)); } catch (_) { return v; }
}

module.exports = { createPhotoshootRepo };
