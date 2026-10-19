# Home summary (`GET /api/home/summary`)

Built 2026-10-19 as Task 2 of the Home build (impact map: `docs/superpowers/impact-maps/home-and-plan.md`). It is the data layer only. The page layout is Task 3.

## What it is

One small, read-only answer for the Home page. The signed-in account is the only one ever read (inside an agency or CSM pass the signed-in account already is the client; an id in the request is ignored). It makes no model call and no outside call, creates nothing (it never creates the weekly proposal and never stamps a setup step), and costs nothing. Staff on their own page get an empty picture flagged `staff`.

Code: `backend/routes/home.js` (route, cache, write watcher), `backend/services/homeSummary.js` (assembly), `homeActions.js` (Do this next), `draftStatus.js` (draft states), `weekIst.js` (India weeks), `homeSummaryCache.js`. Frontend: `frontend/utils/home.ts`, `week.ts`, `draftStatus.ts`, `formatCount.ts`, `GravityHome.tsx`, `api.getHomeSummary()`.

## What it returns

| Field | Meaning |
|---|---|
| `numbers.reach`, `engagement`, `followers` | From the newest daily snapshot (`SocialSnapshot`, written every 12 hours). `previous` and `changePct` come from the newest snapshot that is at least 7 days older (and within 14). `asOf` is the snapshot date in India time; `stale` is true when it is older than 3 days. Engagement is the mean of the platforms that report a rate above 0, `unit: "percent"`. Followers also has `change` (the plain difference). |
| `numbers.postsPublishedThisWeek` | Count of campaigns with status `posted` and `publishedAt` inside this India week; `previous` is last week's count. A real 0 is a real answer. |
| `numbers.draftsWaiting` | Count of posts in the Approve queue (see "Draft states"). Point in time: no comparison. |
| `numbers.unrepliedMessages` | Inbox conversations with status `unread`. Only for an account that holds the Inbox add-on and has something connected. |
| `nextActions` | Up to 5 rows `{ id, kind, title, detail, to, count?, info? }` from `homeActions.js`. |
| `week` | `start` (Monday) and `end` (next Monday, exclusive) in India time; `proposal` state (`none`, `proposed`, `approved`, `skipped`, `expired`); `topUp`; `posts { planned, made, published, scheduled }`; `counts { posts, carousels, videos }`. `planned` and `made` come from the weekly proposal and are `null` until the proposal exists (the This week card creates it on its first read, Home never does). |
| `plan` | `state` is `none`, `building`, `ready`, `failed` or `stale`; `opened` (the customer has opened My plan); `eligible`; `stopped`; `completedAt`. |
| `setup` | `{ next, allDone, done, total }` from the same rules as the Setup card. |
| `balance` | `posts` and `videos` the balance buys (from `config/apiCosts.js`), `text`, and the Quark figure beside it when the account sees Quarks. Agency owners and client workspaces see posts and videos only (`showQuarks: false`, `quarks: null`); a client workspace shows the agency's shared pool. |
| `account` | Flags: `tier`, `free`, `paidTier`, `agencyOwner`, `clientWorkspace`, `managed`, `staff`, `pass` (CSM or agency pass), `frozen`, `showsPostsNotQuarks`. |
| `features` | `inbox`, `competitors`, `publish`: what the account holds. |
| `connected` | `{ count, platforms[] }`. |
| `competitors` | `{ held, tracked, needHandle }`. `needHandle` counts tracked competitors (at most 5) with no valid handle, a suggested (unconfirmed) handle, or a paused one. Zero without the add-on. |
| `products` | `{ count, withPhotos }`. |
| `today` | Up to 6 posts for today (India time) sorted by real time: `{ id, at, title, subtitle, image, status, platform }`. |
| `recent` | Up to 4 recent pictures from the customer's own drafts and campaigns (https links only). Nothing when they have none: Home shows no stock photo. |
| `degraded` | Names of sources that failed this time. Empty when everything loaded. |
| `cached` | Added by the route: whether this answer came from the cache. |

Each number is `{ value, previous, changePct, available, reason, unit?, asOf?, stale?, change? }`. When `available` is false, `value` is null and `reason` is a plain sentence. A figure is never invented and never replaced by a zero it cannot source.

## Reasons a number is not available

| Reason shown | When |
|---|---|
| Connect an account to see this. | Nothing is connected (also hides an old snapshot of an account that was disconnected). |
| Connecting accounts comes with a paid plan. | Nothing connected and the account is on the free plan. |
| Your first numbers arrive within a day of connecting. | Connected, but the snapshot job has not written one yet. |
| Your connected accounts have not reported this yet. | A snapshot exists but reach is 0, or no platform reports an engagement rate. (Followers of 0 is shown as 0.) |
| Messages are part of the Inbox add-on. | The account does not hold the Inbox add-on (the unread count is not even queried). |
| We could not load this just now. Please try again in a moment. | That source failed. The rest of Home still loads and the answer is not cached. |

## Do this next (order, conditions)

First five that apply, in this fixed order (`homeActions.js`, tested rule by rule):

1. `finish_profile`: business profile incomplete.
2. `choose_plan`: free account.
3. `fix_plan`: the plan could not be built.
4. `plan_building`: information only, no button (`to: null`).
5. `read_plan`: plan ready or stale and never opened (not for a staff, CSM or agency pass, nor inside a client workspace).
6. `approve_week`: this week's proposal is waiting and has posts.
7. `top_up`: the week cannot be paid for (a failed post with `no_pool`, or no proposal yet while the balance cannot pay for one post). Not inside a client workspace.
8. `review_drafts`: drafts waiting, with the count.
9. `reply_messages`: unread messages (Inbox add-on and a connection only).
10. `connect_account`: nothing connected.
11. `confirm_competitor`: a competitor needs a handle confirmed (competitors add-on only).
12. `add_product_photo`: products without a photo.

Free accounts only ever see `finish_profile`, `choose_plan` and `connect_account` (setup and plan actions). Agency client workspaces never see billing or plan-choice rows. A settled account gets an empty list and the page says "You are up to date".

## Draft states (one definition)

`backend/services/draftStatus.js` and `frontend/utils/draftStatus.ts` (a test compares them):
waiting = pending, draft, ready, processing, completed; approved = approved, scheduled; published = published, posted; failed = failed; closed = rejected, archived. The Approve page lists waiting and failed posts (never reels or videos), and "drafts waiting" counts exactly that set. The Approve page now uses the shared helper instead of its own copy.

## Weeks

Monday to Sunday in India time (UTC+5:30): `backend/services/weekIst.js`, mirrored in `frontend/utils/week.ts`, compared hour by hour in tests and with the weekly proposal's own week. Home used to start the week on Sunday in the browser's timezone, which could disagree with the This week card. The boundaries are inclusive at Monday 00:00:00 IST and exclusive at the next Monday 00:00:00.

## Cache

`services/homeSummaryCache.js`: in memory, per account (and per kind of look: the owner's own versus a CSM or agency pass), 60 seconds, at most 1000 entries (least recently used goes first). Only an answer that loaded completely is stored, so an error or a failed block is never cached. `?refresh=1` skips the cache and stores the fresh answer. Any successful write (`POST`, `PUT`, `PATCH`, `DELETE`) on `/api` clears the signed-in account's entry (`app.use('/api', homeCacheWatch)` in `server-main.js`), so Home does not show an old count right after the customer acts. Nothing survives a restart. The response carries `Cache-Control: private, no-store`. The page also keeps the last answer for 60 seconds in `sessionStorage` (per account, wrapped in try/catch) so Home opens at once and refreshes quietly.

## Queries and indexes

Every query is a count or a small projection with a limit and `maxTimeMS` of 20 seconds. The real-database check ran `explain` on all of them: none is a collection scan; each reads only the account's own rows.

| Source | Query | Index used today |
|---|---|---|
| Drafts waiting | `Draft` `{ userId, status in [...], not reel/video }` count | `{ userId, status }` |
| Published and scheduled this week | `Campaign` count by `status` and a date range | `{ userId, status }` (then filters the date) |
| Today's posts | `Campaign` `$or` of `scheduledFor` or `publishedAt` today, sorted, limit 6 | `{ userId, ... }` prefix |
| Recent pictures | `Draft` and `Campaign` newest 6 each | `{ userId, createdAt }` |
| Snapshots | `SocialSnapshot` newest one, then up to 15 in the comparison window | `{ userId, date }` |
| Unread messages | `SocialInboxConversation` count | `{ userId, status, ... }` |
| Weekly proposal | `WeeklyProposal` `{ userId, weekStart }` | unique index |
| Plan | `Blueprint` newest 5 plan runs (no result body) | `{ userId, createdAt }` |
| Competitors | `Competitor` up to 25 active ones | `{ userId, isActive }` |
| Products | two counts on `{ user }` | `user` |

Without new indexes the two campaign date queries look at every campaign the account owns (the check measured 150 and 165 documents for an account with 165 campaigns). Two optional indexes make them direct range reads: `home_userId_publishedAt` and `home_userId_scheduledFor` on `campaigns` (`backend/config/homeIndexes.js`). They are declared on the model with `_autoIndex: false`, so the app never builds them by itself (the cluster is close to its disk limit). To build them on purpose, with the same safety rules as the staff indexes (dry run by default, `CONFIRM_CREATE_INDEXES=yes` to build, safe to repeat):

```
INDEX_SCRIPT=create-home-indexes.js bash docs/superpowers/ops/create-staff-indexes.sh
CONFIRM_CREATE_INDEXES=yes INDEX_SCRIPT=create-home-indexes.js bash docs/superpowers/ops/create-staff-indexes.sh
```

This is optional and can wait until after the staff indexes; Home works without them.

## Real-database check

`backend/scripts/home-summary-check.js` (refuses any database except `nebulaa_dev`; throwaway `zz.homechk-` users; runs the real route in this process on a random 127.0.0.1 port with real tokens; computes every expected number independently from the raw collections; deletes everything it made):

```
cd backend
node scripts/home-summary-check.js            # run, then clean up
node scripts/home-summary-check.js cleanup    # remove leftovers of an interrupted run
```

The 2026-10-19 run: 42 PASS, 0 FAIL, 359 rows removed, 0 left.

## Known limits

- The answer is about 3.7 KB (the target in the impact map was 3 KB); it holds the today list and the recent pictures so Home needs no second call.
- Reach of 0 is treated as "not reported" (a provider that returns nothing is stored as 0), so a real 0 reach shows the not-reported sentence.
- Today's list sorts at the database by `scheduledFor`; a post that was published today with no `scheduledFor` sorts first, which only matters when more than 6 posts fall on one day.
- Inbox: the unread count is shown as unread, never as a promise of automatic replies (the Inbox has not been tested live).
- `plan.state` treats a plan run that stopped (not enough to go on) as `failed`; My plan shows the plain message.

## The page that reads it (Task 3, 2026-10-19)

`frontend/pages/GravityHome.tsx` lays out the control room from this answer: header (greeting, the headline sentence, balance in posts and videos with the Quark figure beside it when the account sees Quarks), plan banner (building, failed, stale), numbers strip (six compact tiles; a number that is not available shows its reason and a link, never a zero; one quiet line when nothing can be shown yet), the deep-ink "Do this next" panel (up to five rows, the first emphasised; "Approve this week" scrolls to the This week card), Setup and This week cards, "What will you create today?" (four small tiles and a describe box that hands the idea to Create or Videos through `utils/prefill.ts` with `source: 'home'`), Today's plan and a competitors line. Rules live in `frontend/utils/homeLayout.ts` (tested in `tests/homeLayout.test.mjs`), blocks in `components/home/HomeBlocks.tsx`, styles in `components/home/home.css`. Each block fails alone: a name in `degraded` shows a small note in that block. The Setup card and its call are left out when the summary says setup is finished. Preview: `?homestate=degraded` shows failed blocks.
