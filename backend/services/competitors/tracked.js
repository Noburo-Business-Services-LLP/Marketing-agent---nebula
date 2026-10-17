'use strict';
/**
 * Which competitors an account tracks and which of them may be read. ONE list is used by the weekly tracker and by the
 * insights route, so the competitors that are read are always the ones that are shown (same order, same cap of five).
 */
const defaultCaps = require('../../config/competitors');

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
const time = (v) => (v ? new Date(v).getTime() || 0 : 0);

const handleOf = (c) => String((c && c.socialHandles && c.socialHandles.instagram) || '').trim().replace(/^@/, '');
const isValidHandle = (h) => HANDLE_RE.test(String(h || ''));

/**
 * suggested = found by us (a search or a guess), never read until the customer confirms it
 * verified  = our own profile check matched the competitor, read
 * confirmed = the customer confirmed or typed it, read
 * Older records have no status: a manually added competitor keeps working, an auto-discovered one waits.
 */
function handleStatusOf(c) {
  const s = c && c.handleStatus;
  if (s === 'suggested' || s === 'verified' || s === 'confirmed') return s;
  return c && c.isAutoDiscovered ? 'suggested' : 'confirmed';
}

/** Active, not ignored, newest first (id as tie-break), at most MAX_TRACKED. */
function trackedCompetitors(list, max = defaultCaps.MAX_TRACKED) {
  const idOf = (c) => String(c._id);
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && c.isActive !== false && !c.isIgnored)
    .sort((a, b) => time(b.createdAt) - time(a.createdAt) || (idOf(b) < idOf(a) ? -1 : idOf(b) > idOf(a) ? 1 : 0))
    .slice(0, max);
}

/** May the tracker spend a read on this competitor? */
function isReadable(c) {
  const h = handleOf(c);
  if (!h || !isValidHandle(h)) return false;
  if (handleStatusOf(c) === 'suggested') return false;
  if (c.tracking && c.tracking.pausedAt) return false;
  return true;
}

/** The one query both the tracker and the insights route use. */
function competitorsQuery(Competitor, userId) {
  return Competitor.find({ userId, isActive: { $ne: false }, isIgnored: { $ne: true } }).sort({ createdAt: -1, _id: -1 }).lean();
}

module.exports = { handleOf, isValidHandle, handleStatusOf, trackedCompetitors, isReadable, competitorsQuery, HANDLE_RE };
