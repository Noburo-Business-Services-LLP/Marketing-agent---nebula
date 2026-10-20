'use strict';
/**
 * Per-campaign publish claim (double-post safety, D107). Every path that sends a campaign to the social service
 * (campaign scheduler, "Post now", the status sync's Instagram video rebuild) takes ONE atomic claim first:
 *
 *   findOneAndUpdate({ _id, status in <expected>, no live claim }, { publishClaim: { by, at, until } })
 *
 * Only the winner posts. The claim is a separate field, not a status, so the user-visible status model
 * (draftStatus.js / draftStatus.ts) is untouched. The winner's final write is conditional on still holding the
 * claim (`publishClaim.by` equals its token), so a holder whose claim was taken over after `until` cannot record
 * or overwrite anything. A crash between the provider call and the final write leaves the claim to expire and the
 * status unchanged. `until` defaults to 10 minutes (PUBLISH_CLAIM_MS).
 */
const crypto = require('crypto');

const DEFAULT_MS = 10 * 60 * 1000;

function claimMs(env = process.env) {
  const n = Number.parseInt(String(env.PUBLISH_CLAIM_MS || ''), 10);
  return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_MS;
}

const noLiveClaim = (now) => ({
  $or: [
    { 'publishClaim.until': { $exists: false } },
    { 'publishClaim.until': null },
    { 'publishClaim.until': { $lte: now } }
  ]
});

/** One conditional update. Resolves { claimed, token, tookOver }. A store error counts as "not claimed". */
async function claim(Campaign, id, { statuses, extraFilter = {}, now = new Date(), ms = claimMs(), by = 'publisher' } = {}) {
  const token = `${by}-${crypto.randomBytes(8).toString('hex')}`;
  try {
    const before = await Campaign.findOneAndUpdate(
      { _id: id, status: { $in: statuses }, ...extraFilter, ...noLiveClaim(now) },
      { $set: { publishClaim: { by: token, at: now, until: new Date(now.getTime() + ms) } } },
      { new: false, projection: { publishClaim: 1 } }
    );
    if (!before) return { claimed: false, token: null, tookOver: false };
    return { claimed: true, token, tookOver: !!(before.publishClaim && before.publishClaim.by) };
  } catch (e) {
    return { claimed: false, token: null, tookOver: false, error: e && e.message };
  }
}

const changed = (r) => Number(r && (r.modifiedCount !== undefined ? r.modifiedCount : r.nModified)) > 0;

/** The holder's final write. Applies `set` and clears the claim only while the holder still holds it. */
async function finish(Campaign, id, token, set, extraFilter = {}) {
  if (!token) return false;
  const r = await Campaign.updateOne(
    { _id: id, 'publishClaim.by': token, ...extraFilter },
    { $set: set, $unset: { publishClaim: '' } }
  );
  return changed(r);
}

/** Same rule for a failed send: the failure fields are written and the claim cleared, so a retry can claim. */
const fail = finish;

/** Give the claim back without other writes (nothing was sent). */
async function release(Campaign, id, token) {
  if (!token) return false;
  const r = await Campaign.updateOne({ _id: id, 'publishClaim.by': token }, { $unset: { publishClaim: '' } });
  return changed(r);
}

/** True while someone holds an unexpired claim. */
async function hasLiveClaim(Campaign, id, now = new Date()) {
  const row = await Campaign.findOne({ _id: id, 'publishClaim.until': { $gt: now } });
  return !!row;
}

module.exports = { claim, finish, fail, release, hasLiveClaim, claimMs, DEFAULT_MS };
