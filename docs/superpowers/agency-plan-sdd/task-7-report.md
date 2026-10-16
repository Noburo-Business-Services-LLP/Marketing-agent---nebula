# Task 7 report: usage per client

Status: done. Backend 1150/1150 (was 1135, +15). Frontend untouched. Real run on `nebulaa_dev` passed and left nothing behind.

## What was built
- `backend/services/agencyUsage.js`: `POST_ACTIONS`, `VIDEO_ACTIONS`, `monthRange`, `summarise` (pure), `toCsv` (pure), `usageForMonth`.
- `backend/routes/agency.js`: `GET /api/agency/usage` and `GET /api/agency/usage.csv`.
- `backend/tests/agencyUsage.test.js` (15 tests), `backend/scripts/agency-usage-check.js` (dev-database only; refuses any other database).
- `backend/tests/creditAccessGuard.test.js`: `services/agencyUsage.js` added to REVIEWED (it reads the signed-in agency's own pool balance).

## How it works
- Ledger rows for client spend sit on the agency (`user`) and name the client in `workspace`. Two aggregate queries (this month, all time) grouped by client, kind and action, both matched on `user = <session agency>` and `type in [spend, refund]`. Cost does not grow with the number of rows read by Node, and the existing index `{user, workspace, createdAt}` serves them.
- Quarks: spend adds, refund takes off (exact, integers, may be negative only if a refund lands in a later month than its spend).
- Posts and videos are derived: Quarks on the line divided by the price of one (`QUARK_COSTS`). Needed because one `deductCredits` row can cover several units (for example 4 posts). A `_refund` suffix on the action (`studio_video_refund`) is stripped so the refund nets the video. Counts never go below 0.
  - Posts: image_generated, campaign_text, campaign_full, rival_post, strategic_post, event_post.
  - Videos: studio_video, hero_video_clip, video_base (one per video; video_generated is per scene so it is not counted).
  - Carousel slides, scenes, edits, chat are not counted (their Quarks are in `quarksSpent`).
- Last active: latest spend row (all time) per client; `null` if none.
- Removed clients: the ledger rows stay on the agency with the old client id. Any id not in the current client list is merged into ONE line `{ id: 'removed', name: 'Removed client', removed: true }`, with no ids exposed. Totals therefore still reconcile after a removal.
- Ownership: owner comes from the session (`req.user`, re-read fresh), never from query, params or body. A client login, a pass into a client (`req.actingAgency`) and a non-agency get 403. `isBlockedInsideClient` already blocks both paths for a pass.
- Not exposed: other agencies, top-ups, grants, purchases, balances of others, staff data.

## Shapes for Tasks 10 and 11
`GET /api/agency/usage?month=YYYY-MM&page=1&limit=25` (auth: agency login token only; page and limit optional; limit max 50; bad month falls back to the current month, UTC)

```json
{
  "success": true,
  "month": "2026-10",
  "monthLabel": "October 2026",
  "poolLeft": 4200,
  "poolPosts": 381,
  "poolVideos": 26,
  "page": 1, "limit": 25, "total": 4, "hasMore": false,
  "clients": [
    {
      "id": "<client id>", "name": "Sweet Co", "frozen": false,
      "posts": 1, "videos": 1, "quarksSpent": 172,
      "total": { "posts": 2, "videos": 1, "quarksSpent": 183 },
      "lastActive": "2026-10-05T10:00:00.000Z"
    },
    { "id": "removed", "name": "Removed client", "removed": true, "frozen": false, "posts": 1, "videos": 0, "quarksSpent": 11, "total": { ... }, "lastActive": "..." }
  ]
}
```
`posts`, `videos`, `quarksSpent` are for the month; `total` is all time. Order: clients oldest first, "Removed client" last. Errors: `{ success:false, message }` with 403 (not an agency, client, or pass), 401 (no login), 500, 429 (rate limit, 60 per 15 minutes shared with the other agency routes).

`GET /api/agency/usage.csv?month=YYYY-MM`: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="client-usage-2026-10.csv"`, `Cache-Control: no-store`. Header `Client,Posts,Videos`, one line per client (all of them, no paging), names quoted when they hold commas or quotes, and a leading `'` when a name starts with `= + - @` so a spreadsheet does not run it. No Quarks in the file. Month figures only. Fetch it with the auth header and save the blob (a plain link will not carry the token).

UI rule for Tasks 10 and 11: show posts, videos, last active and pool as `poolPosts` / `poolVideos`. Do not show `quarksSpent`, `total.quarksSpent` or `poolLeft` to customers; they are in the response for the numbers that must add up.

## Verification
- Unit: 15 tests. RED first (module missing), then GREEN. Includes the sum test: per-client all-time usage plus the agency's own untagged use equals the pool's total net spend from the same ledger rows, and isolation from a second agency's rows, paging, two queries only, route access with a request-supplied id ignored.
- Real run `node scripts/agency-usage-check.js` (nebulaa_dev only, random 127.0.0.1 port, throwaway users deleted, 0 left over): report matches real spends and a refund, clients 216 + own use 11 = pool drop 227, removed client kept under "Removed client" with unchanged totals, CSV and paging fine, client pass 403, client login 403, no login 401, rival agency sees only its own client.
- Full backend suite 1150 pass, 0 fail, every file exits on its own.

## Deviations
1. Brief's `month` in the response was a label; `month` is now `YYYY-MM` (what a month input needs) and the label is `monthLabel`.
2. Brief counted posts per row; the ledger has no unit count, so counts come from Quarks divided by unit price. This is exact unless prices changed between the charge and today (then rounded to the nearest whole unit).
3. Action lists differ from the brief's example (`carousel_slide`, `video_generated` do not fit): lists above are pinned to real `QUARK_COSTS` keys by a test.
4. `summarise` does not clamp `quarksSpent` at 0 (clamping would break the reconciliation); only counts are clamped.
5. Added: all-time totals, last active, frozen flag, removed-client line, paging, pool as posts and videos. `toCsv` ignores its second argument (kept for the brief's signature).

## Concerns
- Task 9 (remove a client) must not delete ledger rows owned by the agency (`user` = agency, `workspace` = client). The registry deletes by `user` only, so rows on the workspace's own id are removed but the agency's tagged rows stay, which is what this report relies on.
- If an agency's plan ends (tier no longer `agency`) the report returns 403, as the other agency routes do. If the spec wants export access until the plan ends, relax the check in `usageFor`.
- The all-time query reads every tagged row of the agency (indexed). Fine at 25 clients; if rows grow into the millions, add a monthly roll-up.
