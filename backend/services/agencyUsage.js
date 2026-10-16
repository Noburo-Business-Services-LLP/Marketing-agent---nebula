'use strict';
/**
 * What each client of an agency used, from the Quark ledger. The ledger rows for a client sit on the agency account
 * (the one that pays) and name the client in `workspace`, so this reads only rows owned by the agency asking.
 * Customers see posts and videos; the Quark figures are for the server and the numbers that must add up.
 */
const { QUARK_COSTS, outputsFor } = require('../config/apiCosts');

// Actions whose ledger rows are posts and videos (a subset of the keys of QUARK_COSTS; one test pins them).
// A carousel slide or a video scene is part of a post or video, not one itself, so those are left out of the counts.
const POST_ACTIONS = ['image_generated', 'campaign_text', 'campaign_full', 'rival_post', 'strategic_post', 'event_post'];
const VIDEO_ACTIONS = ['studio_video', 'hero_video_clip', 'video_base'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const REMOVED = Object.freeze({ id: 'removed', name: 'Removed client' });
const DEFAULT_PAGE = 25;
const MAX_PAGE = 50;

function monthRange(input, now = new Date()) {
  const m = typeof input === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(input) : null;
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)), label: `${MONTHS[mo]} ${y}`, key: `${y}-${String(mo + 1).padStart(2, '0')}` };
}

const int = (n) => (Number.isFinite(n) ? Math.round(n) : 0);
/** How many posts or videos a ledger line stands for: the Quarks charged over the price of one. */
function unitsOf(row, list) {
  const action = String(row.action || '').replace(/_refund$/, '');
  if (!list.includes(action)) return 0;
  const cost = QUARK_COSTS[action];
  return cost > 0 ? Math.round(Math.abs(Number(row.quarks) || 0) / cost) : 0;
}

/**
 * Rows are ledger lines (or per-client totals of them: same fields, summed `quarks`). Spends add, refunds take off.
 * Rows with no client are the agency's own use and are ignored. Rows for a client not in `workspaces` (removed since)
 * are kept together on one "Removed client" line, with no ids.
 */
function summarise(rows, workspaces) {
  const out = new Map(workspaces.map((w) => [String(w.id), { id: String(w.id), name: w.name, posts: 0, videos: 0, quarksSpent: 0 }]));
  let removed = null;
  for (const r of rows) {
    if (!r.workspace || (r.type !== 'spend' && r.type !== 'refund')) continue;
    let c = out.get(String(r.workspace));
    if (!c) { removed = removed || { ...REMOVED, removed: true, posts: 0, videos: 0, quarksSpent: 0 }; c = removed; }
    const sign = r.type === 'spend' ? 1 : -1;
    c.quarksSpent += sign * int(Math.abs(Number(r.quarks) || 0));
    c.posts += sign * unitsOf(r, POST_ACTIONS);
    c.videos += sign * unitsOf(r, VIDEO_ACTIONS);
  }
  const list = [...out.values()];
  if (removed) list.push(removed);
  // Counts never go below nothing (a refund in a later month than its spend). Quarks stay exact so the sums add up.
  return list.map((c) => ({ ...c, posts: Math.max(0, c.posts), videos: Math.max(0, c.videos) }));
}

const cell = (s) => {
  let t = String(s == null ? '' : s);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // a spreadsheet must not read a name as a formula
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
/** Posts and videos per client, for the agency to keep or send on. No Quarks. */
function toCsv(summary) {
  return ['Client,Posts,Videos', ...summary.map((c) => `${cell(c.name)},${int(c.posts)},${int(c.videos)}`)].join('\n') + '\n';
}

function pageOf(v, fallback, max) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

/** Totals per (client, kind, action) for this agency only, optionally within a month. One query; the result is small. */
function totalsQuery(models, ownerId, range) {
  const $match = { user: ownerId, workspace: { $ne: null }, type: { $in: ['spend', 'refund'] } };
  if (range) $match.createdAt = { $gte: range.from, $lt: range.to };
  return models.QuarkLedger.aggregate([
    { $match },
    { $group: { _id: { workspace: '$workspace', type: '$type', action: '$action' }, quarks: { $sum: '$quarks' }, last: { $max: '$createdAt' } } }
  ]);
}
const flat = (g) => g.map((x) => ({ workspace: x._id.workspace, type: x._id.type, action: x._id.action, quarks: x.quarks, last: x.last }));

async function usageForMonth({ owner, month, models, now = new Date(), page, limit }) {
  const range = monthRange(month, now);
  const { listWorkspaces } = require('./agencyWorkspaces');
  const workspaces = await listWorkspaces({ owner, models });
  const [monthRows, allRows] = await Promise.all([totalsQuery(models, owner._id, range), totalsQuery(models, owner._id, null)]);
  const thisMonth = new Map(summarise(flat(monthRows), workspaces).map((c) => [c.id, c]));
  const allTime = summarise(flat(allRows), workspaces);
  const lastSpend = new Map();
  const known = new Set(workspaces.map((w) => String(w.id)));
  for (const r of flat(allRows)) {
    if (r.type !== 'spend' || !r.last) continue;
    const k = known.has(String(r.workspace)) ? String(r.workspace) : REMOVED.id;
    const at = new Date(r.last);
    if (!lastSpend.has(k) || at > lastSpend.get(k)) lastSpend.set(k, at);
  }
  const frozen = new Map(workspaces.map((w) => [w.id, !!w.frozen]));
  const all = allTime.map((t) => {
    const m = thisMonth.get(t.id) || { posts: 0, videos: 0, quarksSpent: 0 };
    const at = lastSpend.get(t.id);
    return {
      id: t.id, name: t.name, ...(t.removed ? { removed: true } : {}), frozen: !!frozen.get(t.id),
      posts: m.posts, videos: m.videos, quarksSpent: m.quarksSpent,
      total: { posts: t.posts, videos: t.videos, quarksSpent: t.quarksSpent },
      lastActive: at ? at.toISOString() : null
    };
  });
  const size = pageOf(limit, DEFAULT_PAGE, MAX_PAGE);
  const p = pageOf(page, 1, 1e6);
  const poolLeft = Math.max(0, int(Number(owner.credits && owner.credits.balance) || 0));
  const out = outputsFor(poolLeft);
  return {
    month: range.key, monthLabel: range.label,
    poolLeft, poolPosts: out.posts, poolVideos: out.videos,
    page: p, limit: size, total: all.length, hasMore: p * size < all.length,
    clients: all.slice((p - 1) * size, p * size)
  };
}

module.exports = { POST_ACTIONS, VIDEO_ACTIONS, DEFAULT_PAGE, MAX_PAGE, monthRange, summarise, toCsv, usageForMonth };
