# Performance work, week 1 (and the first week 2 to 3 items)

Why: the owner said the app "feels super sluggish", and his tester's load test (`/Users/dineshkannaa/Downloads/Generation flow.txt`, target 10 to 15 requests a second per flow, p90 under 300 ms) found the causes. This file lists everything done on `nebulaa-redesign` for it, the numbers measured, the switches, and what the owner (or AWS) still has to do. Frontend first-load work is in `frontend-performance.md`; the auth cache is in `auth-cache.md`.

Nothing here is released yet unless the release notes say so. All of it is behind the normal release (`docs/superpowers/ops/release-prod.sh`).

## What changed

| # | Area | What changed | Commit(s) |
|---|------|--------------|-----------|
| 1 | Sign-in, sign-up, codes | Native `bcrypt` 6.0.0 through one helper `backend/services/passwordHash.js`: hashing runs on the thread pool, at most 3 at once, a queue of 100, a plain 503 "Please try again in a moment." when full. Cost `BCRYPT_ROUNDS`, default 11 (was 12 with bcryptjs; codes stay 10). Old hashes still verify; a password stored at another cost is stored again at the setting after its next good sign-in. Decision D25. | `02dcf4f` |
| 2 | Writes | The global sanitize-html pass is gone (it turned `&` into `&amp;`, scanned every body before validation and stalled on big ones). Errors go through `middleware/errorHandler.js`: validation 400 with field names, broken JSON 400, too large 413, others a plain 500. Emails that put stored text in HTML escape it. | `696b65a` |
| 3 | Rate limits | The 20-per-15-minutes sign-in bucket only applies to the credential routes (login, signup, codes, password reset and change), keyed by address plus account, with a 100-per-address cap; `/auth/me` and sign-out are never counted. Social: 300 per user plus 1000 per address (was 30 per address). `trust proxy` from `TRUST_PROXY_HOPS`. | `da7ab96` |
| 4 | Health | `/api/health` (the load balancer path) is 200 only when MongoDB answers a ping (1.5 s timeout, kept 5 s), else 503; 503 while shutting down. `/api/ready` added. SIGTERM stops accepting and exits when open requests finish (20 s at most). | `3b2dbf0` |
| 5 | Content calendar | `GET /api/content-calendar` only reads (ready, or `not_prepared` / `preparing` / `failed` at once); it never makes a month (7 to 8 s of AI) or retries covers. `POST /prepare` makes the month in the background (free, one at a time per account). Covers are retried by the calendar scheduler. | `927bb7a` |
| 6 | Video prompt builder | `POST /api/generateVideoStylePrompts` and `/generateSceneDescriptions` need a login, at most 20 scenes, 1 to 300 s, bounded text, the AI limiter in front. | `2e0410b` |
| 7 | Auth cache | `protectCached` (15 s, 5,000 entries) on six hot read routes only; `protect` unchanged elsewhere. Decision D26, details `auth-cache.md`. | `eb084ec` to `4149e6e` |
| 8 | Campaigns list and Ayrshare | `GET /api/campaigns` makes no Ayrshare call (it used to ask Ayrshare, one after another and with writes, about every past-due scheduled post each time the list opened). The background job `backend/services/campaignStatusSync.js` does it. Details below. | `fbff733`, `c93dcfa`, `26b8593` |
| 9 | Lists | Drafts and Campaigns lists in cursor pages with list fields only; notifications and videos lists lean and bounded. Details below. | `a70a08a`, `b943d9a` |
| 10 | Calendar screen | The Calendar tab shows "Prepare this month" (POST `/prepare`) and a being-prepared state with polling. Details below. | `ad4122e` |
| 11 | Classic dashboard | The overview reads its independent parts at once and only small campaign fields for totals. Details below. | `783de35` |

## Is the release image able to load native `bcrypt`? Yes, nothing to change

Read from the files, not guessed:

- The release script builds `Dockerfile.backend` (not the root `Dockerfile`) with `docker buildx build --platform linux/amd64` (`docs/superpowers/ops/release-prod.sh`, line 54).
- `Dockerfile.backend` installs packages in a `deps` stage on `node:20-bookworm-slim` with `npm ci --omit=dev`, and copies that `node_modules` into a `runtime` stage on the same `node:20-bookworm-slim` image. Same Node 20, same Debian bookworm glibc, same CPU type, so a native module built or picked in `deps` loads in `runtime`.
- `bcrypt` 6.0.0 ships ready-made binaries (`prebuilds/linux-x64/bcrypt.glibc.node`, also `linux-arm64`, `darwin-*`, `win32-*`) and loads them with `node-gyp-build`, so nothing is compiled on linux x64. If a binary were missing, the `deps` stage already has `build-essential` and `python3` to compile it.
- `.dockerignore` excludes `backend/node_modules`, so the Mac's own modules never enter the image.
- The release script's smoke test (line 59 onward) runs inside the built image with no network and does `require('bcrypt')` plus a hash and compare, before anything is pushed. If the module did not load, the release stops there.

So: no Dockerfile change is needed. If the base image is ever changed to Alpine (musl), bcrypt still has `bcrypt.musl.node`; if it is changed to a different CPU (arm64 Graviton), the `linux-arm64` binary is there too, and the smoke test must then run with that `--platform`.

## Campaigns list and the status sync (item 8)

- `GET /api/campaigns` only reads (guard test `tests/campaignStatusSync.test.js` checks the handler has no Ayrshare call and no write).
- `services/campaignStatusSync.js`: every 5 minutes (first run 2 minutes after start), one server at a time (OpsState lease `campaign_status_sync_lease`, 10 minutes), a batch of 25 (`CAMPAIGN_STATUS_SYNC_BATCH`, at most 200), least recently checked first (`ayrshareCheckedAt`), paused accounts skipped. Rows: status `scheduled`, `scheduledFor` in the past and an Ayrshare post id.
- Same rules as the list used to apply (moved, not rewritten): posted on Ayrshare -> `posted` and its Draft `published` (the scheduler's rule, handover 20); error -> one bounded Instagram retry, else back to `draft` with the reason (or kept `scheduled` for a passing Instagram error); pending -> nothing; a failed check -> nothing.
- Guard: the same `requireOwnProfileKey` as the route. An account without its own social profile is skipped and never checked against the master profile; a managed account keeps its old behaviour. The guard test now checks the service.
- No overlap with `campaignScheduler.js`: every write of the sync is conditional on the row still being `scheduled` with the same Ayrshare post id, so if the scheduler (or the person) changed it meanwhile, their change wins and the sync does nothing.
- Off with `ENABLE_CAMPAIGN_STATUS_SYNC=off` (then past-due posts simply keep "Scheduled" until switched back on).
- Real-database check `backend/scripts/campaign-sync-check.js` (nebulaa_dev only, fake provider, any outgoing request refused): 5 of 5 PASS. GET lists the past-due posts unchanged with 0 provider calls (323 to 504 ms on the dev database from this Mac); the lease stops a second runner; a batch of 3 looks at 3 rows; the job (not the GET) moves them to posted / draft / pending; cleanup removed 2 users, 6 campaigns and the lease row.

## Lists (item 9)

- `GET /api/drafts`: 30 a page by default, `GET /api/campaigns`: 20, `?limit=` up to 50, `?cursor=` for the next page. Newest first by `createdAt`. The cursor is the last `createdAt` plus how many rows at that exact time were already sent, so posts made at the same moment (a plan makes several at once) are never repeated or lost (`services/listPage.js`, tests `tests/listPage.test.js`). The answers keep `drafts` / `campaigns` / `counts` and add `nextCursor` and `hasMore` (decision D27: no second copy of the list under `items`).
- List fields: drafts drop `imageUrlNoLogo` and a `creative.imageUrls` that only repeats `imageUrl`; campaigns drop `publishResult` (raw provider answers) and cut `lastPublishError` to 500 characters. Captions stay: every card and editor reads them and they are about 1 KB; the weight was images and provider answers. Measured on the dev database: a draft averaged 740 KB and a campaign 1.7 MB, nearly all of it base64 images (`imageUrl`, `creative.imageUrls`) and provider answers (`publishResult`, `lastPublishError` up to 2.3 MB). Open one post (`GET /drafts/:id`, `/campaigns/:id`) for the full document.
- Index: `explain()` on the dev database shows both pages use `userId_1_createdAt_-1` with no in-memory sort (drafts: 35 documents examined for 31 returned; campaigns: 21 for 21).
- Notifications: `.lean()`, `?limit=` capped at 50, unread count read at the same time as the list. Video drafts list: the 50 most recently changed, only the fields it shows. (Studio videos and Hero jobs lists were already bounded, 30 and 20, and lean.)
- Frontend: screens that need everything (calendar grid, classic pages, the Bin) read page after page (`frontend/utils/pages.ts`, safety stop at 40 pages); the Library reads the newest 30 posts, refreshes as many as it shows and offers "Load more posts" (counts still come from `/drafts/counts`).
- Measured: in-process server on a random 127.0.0.1 port, dev database (Atlas, from this Mac, so every number includes about 80 ms of network per database round trip), a throwaway user with 300 drafts, 200 campaigns, 60 notifications and 60 video drafts; 5 warm-up calls, then 30 calls one after another (`backend/scripts/lists-check.js measure` on the old code, then the new code):

| List | Before p50 / p90 | After p50 / p90 | Answer size before -> after |
|------|------------------|-----------------|-----------------------------|
| Drafts | 270 / 324 ms (266 items) | 161 / 318 ms (30 items) | 1,488 KB -> 150 KB |
| Campaigns | 166 / 216 ms (50 items) | 160 / 244 ms (20 items) | 745 KB -> 51 KB |
| Notifications | 160 / 166 ms | 80 / 85 ms | 7.9 KB -> 6.7 KB |
| Videos | 242 / 284 ms (60 items) | 160 / 166 ms (50 items) | 23.7 KB -> 19.8 KB |

  The seeded rows used normal image links. Real dev rows with base64 images are 10 to 100 times heavier, so on those the saving is much larger; the times above are mostly the network to Atlas, and the tester's local numbers (Drafts 42.8 to 3.1 ms, Campaigns 23.5 to 1.65 ms) are the same change without that network. The p90 values carry noise from single slow round trips.
- Real-database check `backend/scripts/lists-check.js`: 8 of 8 PASS (first pages, every draft exactly once across pages including equal times, limit cap and filters, trims, campaign pages and counts, notifications and videos bounded, explain, no outgoing request); cleanup removed 1 user, 300 drafts, 200 campaigns, 60 notifications, 60 video drafts.
- New script-only partial indexes (decision D28) for the jobs that look across all accounts: `perf_scheduled_scheduledFor` (status sync) and `perf_scheduled_startDate` (campaign scheduler), both only for `status: 'scheduled'` rows (`config/perfIndexes.js`, `scripts/create-perf-indexes.js`, dry run by default). Without them each run reads the whole campaigns collection; on the dev database one such scan took over two minutes. Dry run on dev: 2 missing, about 0.0 MB. NOT built anywhere yet: owner step below.

## Calendar screen (item 10)

- Plan > Calendar > Month plan reads `/content-calendar/history` (it never relied on the GET). Before, opening some Create screens called `GET /content-calendar`, which made the month as a side effect; now nothing does. So when this month has no plan, the hero says "No plan for October yet", shows "Free: preparing the plan and its cover picture takes no Quarks." and one button, "Prepare this month", which calls `POST /prepare` with the optional language and focus from the box below (decision D29). While it is made the hero shows "Planning October ... about a minute", the button is busy, and the page asks `GET /content-calendar` every 5 seconds; when the month is there it opens it. A failure shows a plain message; after 5 minutes it says it is taking longer than usual. The idea picker in Create says "Your calendar for this month is being prepared." when that is the case.
- Quarks, entitlements and the spend guard are unchanged (the month and its cover are free, as they were).
- Mock session: `?calstate=none` (not prepared; Prepare works and the month appears after about 8 s) and `?calstate=preparing` (already being made); `?draftpage=many` shows the Library's "Load more posts". Looked at in the preview at 1280 and 375.
- Known limit: the "being prepared" mark lives in the server process that started it. With two or more web servers another server answers "not prepared" until the month is saved; the page keeps asking for 2 minutes before it calls it a failure, so this only shows when the work really stopped.

## Home and classic dashboard (item 11)

- Home summary (`services/homeSummary.js`) already reads its 13 parts in one `Promise.all` and is cached 60 s per account; the one remaining wait (the snapshot before the latest date) depends on the first answer. Unchanged.
- Classic dashboard `GET /api/dashboard/overview` (on a cache miss): the influencer count, the AI insights and the Ayrshare connected-accounts read now run at the same time instead of one after another; the totals read 6 small fields of every campaign instead of whole documents, and the newest 10 cards are read with their card fields. Test `tests/dashboardOverviewParallel.test.js` (fakes: three 40 ms parts finish in about 40 ms instead of 120 ms). Not load-tested: a cache miss calls Gemini and Ayrshare, which this work never calls for real.

## Switches and settings (all optional; defaults shown)

| Setting | Default | What it does |
|---------|---------|--------------|
| `BCRYPT_ROUNDS` | 11 (10 to 15) | bcrypt cost for new passwords; raise to 12 for slower but stronger hashing |
| `BCRYPT_MAX_CONCURRENT` | 3 | hashes at once per server |
| `BCRYPT_MAX_QUEUE` | 100 | waiting hashes before a 503 |
| `TRUST_PROXY_HOPS` | 1 | proxies in front of the app (the load balancer) |
| `AUTH_CACHE` | on | `off` makes the six hot reads use `protect` again |
| `AUTH_CACHE_TTL_MS` | 15000 | auth cache lifetime |
| `ENABLE_CAMPAIGN_STATUS_SYNC` | on | `off` stops the background Ayrshare status checks |
| `CAMPAIGN_STATUS_SYNC_BATCH` | 25 (1 to 200) | posts checked per 5-minute run |
| `INSTAGRAM_SCHEDULED_RETRY_MAX` | 3 | unchanged, now used by the status sync |

## What the owner (or AWS) must do

1. Release as usual; the smoke test already checks native bcrypt. No Dockerfile change.
2. After the release, build the two small partial indexes (dry run first, then build; they are tiny):

```
cd backend && node scripts/create-perf-indexes.js
```

```
cd backend && CONFIRM_CREATE_INDEXES=yes node scripts/create-perf-indexes.js
```

   (With the production database address in `MONGODB_URI`, the way the staff and Home index scripts are run.)
3. Optional: set `BCRYPT_ROUNDS=12` if you prefer the old strength over sign-in speed (D25).
4. Infra items from the tester's list: the web/worker split, shared limits, OAuth state, persisted image jobs, pool settings and the exact AWS steps are in `ecs-web-worker.md` (Phase 1 code done, Phase 2 owner steps, Phase 3 checks). Still open there: CDN for static files, moving the in-process generation flows (Videos, Photoshoot, Hero, Blueprint) to the worker.

## Still open (not done here)

- Structured async logging (pino) instead of console calls; `explain()` review of the other top queries; images stored as base64 inside drafts and campaigns (the real weight; they should go to storage with a link: a separate, careful job); the in-process "being prepared" mark for the calendar (still in-process after the scaling work, see `ecs-web-worker.md`).
