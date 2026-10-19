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
    closeRefused: (id, outcome, now) => J().updateOne({ _id: id, status: 'queued' }, { $set: { status: 'refused', outcome, finishedAt: now }, $unset: { inFlight: 1 } }),
    closeLedger: (id, now) => J().updateOne({ _id: id }, { $set: { status: 'failed', outcome: 'ledger', refunded: true, finishedAt: now }, $unset: { inFlight: 1 } }),
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
    setRefundFailed: (id) => J().updateOne({ _id: id }, { $set: { refundFailed: true } }),
    lostJobs: (now, limit = 10) => lean(J().find({ status: 'running', $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] }).select('_id user').limit(limit)),
    listOwn: (user, limit = 20) => lean(J().find({ user, kind: 'pack', status: { $ne: 'refused' } }).sort({ createdAt: -1 }).limit(limit)),
    childrenOf: (user, parentIds) => lean(J().find({ user, parent: { $in: parentIds } }).sort({ createdAt: 1 })),
    libraryOwn: (user, limit = 200) => lean(J().find({ user, status: { $in: ['done', 'partial'] }, photos: { $elemMatch: { status: 'done', inLibrary: true } } }).sort({ createdAt: -1 }).limit(limit)),
    setInLibrary: async (user, id, index, on) => (await J().updateOne({ _id: id, user, photos: { $elemMatch: { index, status: 'done' } } }, { $set: { 'photos.$.inLibrary': !!on } })).matchedCount === 1,
    countsByOutcome: (day) => J().aggregate([{ $match: { day } }, { $group: { _id: { kind: '$kind', outcome: '$outcome' }, n: { $sum: 1 }, photos: { $sum: '$photoCount' } } }])
  };
}

function toId(v) {
  const mongoose = require('mongoose');
  try { return new mongoose.Types.ObjectId(String(v)); } catch (_) { return v; }
}

module.exports = { createPhotoshootRepo };
