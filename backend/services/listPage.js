'use strict';
/**
 * Cursor pages for the long lists (Drafts, Campaigns), load-test weeks 2 to 3.
 *
 * Order: newest first by `createdAt`, served by the existing { userId: 1, createdAt: -1 } index (no in-memory sort; see
 * scripts/lists-check.js, which runs explain()). The cursor is an opaque text: the createdAt of the last row returned and
 * how many rows with exactly that createdAt were already returned (`k`). The next page asks for createdAt <= that time
 * and skips those k rows. Rows with the same createdAt (a plan makes several posts at once) come back in the index's
 * own stable order, so no row is repeated or lost between pages. Known limit, accepted: a row with that exact createdAt
 * deleted between two page loads can make the next page skip one row.
 *
 * `?limit=` is capped at 50; a missing or bad limit uses the list's default (Drafts 30, Campaigns 20).
 */
const MAX_LIMIT = 50;

function parseLimit(raw, fallback) {
  const n = Number.parseInt(String(raw === undefined || raw === null ? '' : raw), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(MAX_LIMIT, n);
}

function encodeCursor(t, k) {
  return Buffer.from(JSON.stringify({ t, k })).toString('base64url');
}

/** null for "first page"; throws a 400-shaped error for a cursor we did not make. */
function decodeCursor(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const v = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (v && Number.isFinite(v.t) && Number.isInteger(v.k) && v.k >= 0 && v.k <= 10000) return { t: v.t, k: v.k };
  } catch (_) { /* below */ }
  const err = new Error('That page link is not valid. Please reload the list.');
  err.status = 400;
  throw err;
}

/** The query parts for one page: filter, sort, skip, limit (limit + 1 rows are read to know whether there is more). */
function pageQuery(filter, { cursor, limit }) {
  const c = decodeCursor(cursor);
  const where = c ? { $and: [filter, { createdAt: { $lte: new Date(c.t) } }] } : filter;
  return { filter: where, sort: { createdAt: -1 }, skip: c ? c.k : 0, limit: limit + 1, cursor: c };
}

/** Cut the extra row and make the next cursor. */
function finishPage(rows, { limit, cursor }) {
  const list = Array.isArray(rows) ? rows : [];
  const hasMore = list.length > limit;
  const items = hasMore ? list.slice(0, limit) : list;
  if (!hasMore || !items.length) return { items, nextCursor: null, hasMore: false };
  const last = items[items.length - 1];
  const t = new Date(last.createdAt).getTime();
  let k = 0;
  for (let i = items.length - 1; i >= 0 && new Date(items[i].createdAt).getTime() === t; i--) k += 1;
  // The whole page sat on the same time as the previous cursor: the rows skipped before count too.
  if (cursor && cursor.t === t && k === items.length) k += cursor.k;
  return { items, nextCursor: encodeCursor(t, k), hasMore: true };
}

/** A list read as an aggregation: the page first (index), then the trimming stages on those rows only. */
function pagePipeline(q, trim = []) {
  const stages = [{ $match: q.filter }, { $sort: q.sort }];
  if (q.skip) stages.push({ $skip: q.skip });
  stages.push({ $limit: q.limit }, ...trim);
  return stages;
}

// Drafts list: everything the cards and editors read, minus the copies of the image. `imageUrlNoLogo` is not read by
// any list screen, and `creative.imageUrls` is dropped only when it is just the same picture as `imageUrl` (every
// screen reads `imageUrl || creative.imageUrls[0]`, and the editor rebuilds `creative.imageUrls` from `imageUrl` when
// it saves). These copies were most of the weight: in the dev database a draft averaged 740 KB, nearly all images.
const DRAFT_TRIM = Object.freeze([
  { $unset: ['imageUrlNoLogo'] },
  {
    $set: {
      creative: {
        $cond: [
          {
            $and: [
              { $eq: [{ $type: '$creative.imageUrls' }, 'array'] },
              { $lte: [{ $size: '$creative.imageUrls' }, 1] },
              { $gt: [{ $strLenBytes: { $ifNull: ['$imageUrl', ''] } }, 0] },
              { $eq: [{ $arrayElemAt: ['$creative.imageUrls', 0] }, '$imageUrl'] }
            ]
          },
          { $arrayToObject: { $filter: { input: { $objectToArray: '$creative' }, cond: { $ne: ['$$this.k', 'imageUrls'] } } } },
          '$creative'
        ]
      }
    }
  }
]);

// Campaigns list: no `publishResult` (the provider's raw answers, which can hold whole images; no screen reads it from
// the list) and the last error cut to 500 characters (some held a 2 MB provider answer). Open one campaign for all.
const CAMPAIGN_TRIM = Object.freeze([
  { $unset: ['publishResult'] },
  {
    $set: {
      lastPublishError: {
        $cond: [{ $eq: [{ $type: '$lastPublishError' }, 'string'] }, { $substrCP: ['$lastPublishError', 0, 500] }, '$lastPublishError']
      }
    }
  }
]);

/** The page shapes the real-database check explains (same filter, sort and limit as the routes). */
function explainShapes(userId) {
  return {
    draftListQuery: pageQuery({ userId, status: { $ne: 'binned' } }, { limit: 30 }),
    campaignListQuery: pageQuery({ userId }, { limit: 20 })
  };
}

module.exports = { MAX_LIMIT, parseLimit, encodeCursor, decodeCursor, pageQuery, finishPage, pagePipeline, DRAFT_TRIM, CAMPAIGN_TRIM, explainShapes };
