# Impact map: PERFORMANCE and BRAND (assets, Brand Growth Blueprint)

Written 2026-10-19 on branch `nebulaa-redesign`, before building. Brand memory (`/ai-memory`) was already redone and is only linked from here. Ledger items covered:

- PERFORMANCE: "Make reach, engagement and new followers beautiful: KPI tiles with sparklines and up/down chips, best post of the month."
- BRAND: "Brand assets, Brand Growth Blueprint and Memory as tiles with art and status."

Left out on purpose (stated reason, ledger rule 2): the business-profile questionnaire redo (BRAND, NOT STARTED) is a Settings and onboarding form change with data effects of its own (new fields for reach, B2B, gender); it is not part of the tile work and needs its own map.

## 1. Current state (read from the code)

### Performance (`/analytics`, `frontend/pages/GravityInsights.tsx`)
- One call: `GET /api/campaigns` (newest 50, `backend/routes/campaigns.js:902-924`). Everything is worked out in the browser from `campaign.metrics.reach` and `campaign.analytics.reach`.
- Those fields do not exist. The Campaign model keeps `performance.{impressions, clicks, engagement, reach, likes, comments, shares}` (`backend/models/Campaign.js:107-118`) and nothing in the backend writes them (searched `services`, `routes`, `jobs`, `workers`, `controllers`). So today the page always says "No reach has been recorded yet", even for an account with years of data.
- The real stored series is `SocialSnapshot` (`backend/models/SocialSnapshot.js`): one row per account per day, written every 12 hours by `services/snapshotScheduler.js` while an account is connected; per platform `followers, posts, reach, impressions, engagementRate, likes`, plus `totals`. It is read by `GET /api/analytics/history?days=N` (`backend/routes/analytics.js:542`), already used by the classic page (`apiService.getAnalyticsHistory`).
- Home already turns the newest snapshot into honest numbers with reasons (`GET /api/home/summary`, `numbers.reach | engagement | followers | postsPublishedThisWeek`, `docs/superpowers/ops/home-summary.md`).
- Two buttons (Filter, Export) do nothing (no handler).

### Brand assets (`/brand-assets`, `frontend/pages/BrandAssets.tsx`)
- Tabs: Brand (logos, colours, font, enforcement), Products and services (`Inventory.tsx` embedded), Environment (places, `EnvironmentAssets.tsx`), Headers and footers, Voice.
- Calls on open: `brand-assets/logos`, `brand-assets/intelligence-profile`, `brand-assets` (all types, used for the colour palette).
- People ("characters") are `BrandAsset` rows of type `character`, added from the Videos page (`CreateVideo.tsx:237-251`); Brand assets has no tab for them.
- No overview: a customer cannot see at a glance what is set up and what is missing.

### Blueprint (`/blueprint/new`, `/blueprint/:id`)
- Start: one long form (`BlueprintStart.tsx`), extras in a `<details>`. Prefilled from the business profile and the brand profile.
- Result: stepper while running, checkpoints, then `DesignedEdition` and the nine-page `BlueprintDocument` (pages `where-today`, `audience-positioning`, `competitor-read`, `content-pillars`, `calendar-preview`, `offers-hooks`, `channel-plan`, `roadmap-90`, `first-steps`).

## 2. What changes

| Screen | Change | New calls |
|---|---|---|
| Performance | Hero, four KPI tiles (reach, engagement, new followers, posts published) with sparklines and change chips in words, best post of the month (with its picture), reach over 30 days chart, honest empty states with art | `GET /api/home/summary` (cached 60 s, read-only) and `GET /api/analytics/history?days=35` beside the existing `GET /api/campaigns` |
| Brand assets | "Your brand at a glance": seven tiles (Logo, Colours, Fonts, People, Places, Products, Brand memory) with art, a status word and thumbnails; a tile opens its tab or page | `GET /api/products` and `GET /api/ai-memory/summary` (both read paths the Products tab and the Brand memory page already use); the existing `brand-assets` call now also gives the people and place counts |
| Blueprint start | Four compact tiles above the form (Your business, Where you are online, Your goal, Extras) with art and a status from the live form; a tile moves to the first missing field | none |
| Blueprint result | When ready: a tile per page of the document with art and a status (from the stored result); a tile scrolls to its page | none |

Nothing is removed from behaviour except the two dead Filter and Export buttons and the "Approval rate" figure (it counted every non-draft campaign as approved, which is not what approval means).

## 3. Dependencies and side effects
- `GET /api/home/summary` is shared with Home; it is read-only and cached per account for 60 seconds, so Performance adds no write and at most one database pass a minute. A failure of the summary does not blank the page: the tiles say "We could not load this just now".
- `GET /api/campaigns` keeps its existing side effect (overdue scheduled posts are checked with the publishing service); the page made this call before too. No new provider call is added anywhere.
- `GET /api/ai-memory/summary` runs `syncBrandMemoryFromProfile` (a database write of the brand memory from the profile), exactly as opening Brand memory does. No model call.
- Styles are new plain CSS files imported by the pages (`components/performance/performance.css`, `components/brand/brandTiles.css`); nothing goes into `index.html` (the controller regenerates it).
- New art lives in `components/art/brand/` (imported from the piece files, not the barrel); the art budget covers it.

## 4. Money and entitlement effects
- No charge, no Quark movement, no entitlement check changes. Blueprint pages keep their Quark and price wording as is.
- Free accounts: summary reasons say "Connecting accounts comes with a paid plan." with a See plans link (not inside a client workspace).
- Managed accounts: same numbers as their own account.
- Agency client workspace: the signed-in account is the client (summary and history read the client). Plan or add-on links are hidden there, as on Home.
- Staff on their own page: the summary returns an empty picture; tiles show reasons.

## 5. Data effects
- None. No model change, no migration, no index. Everything is read from stored rows: `SocialSnapshot`, `Campaign`, `BrandAsset`, `BrandIntelligenceProfile`, `Product`, `AIBrandMemory`, `Blueprint`.

## 6. Honesty rules (owner)
- A number shows only when stored. Not available shows the reason in words, never 0 or a dash pretending to be a value.
- Sparklines are drawn only from real stored points: daily snapshots for reach, engagement and followers; weekly counts of published posts for posts. Fewer than two points: no line, a sentence says when it will appear.
- Snapshot days with reach 0 are skipped in the reach line (a platform that returns nothing is stored as 0, as Home treats it).
- Change chips say "Up 12 percent on last week" only when both weeks exist; a previous week of 0 posts says "None last week".
- New followers is the stored difference between the newest snapshot and the one at least 7 days older (Home's `followers.change`); without an older snapshot the tile shows the follower count and says new followers show after a week of numbers.
- Best post of the month: the published post of this month (India time) with the most stored engagement (likes + comments + shares, else `performance.engagement`), then reach. Per-post numbers are not written by the backend today, so normally no post has any: then the tile shows the latest published post of the month, titled "Latest post this month", and says why the best one cannot be picked. Nothing published this month: an illustrated empty state.
- Campaign list limit: the campaigns call returns the newest 50. When it returns 50, weeks older than the oldest returned campaign are not drawn (they could be undercounted).
- Brand statuses come from stored rows only: "Added", "Missing", "N added". Colours count only when they are not the placeholder pair (`isPlaceholderColorPair`).

## 7. Edge cases
| Case | Performance | Brand |
|---|---|---|
| No connected accounts | Reach, engagement, followers: "Connect an account to see this." with a link; old snapshots of a disconnected account are hidden. Posts tile still counts posts. | Unaffected |
| New account | "Your first numbers arrive within a day of connecting."; best post empty state | All "Missing", each tile says what to add |
| Free plan | Paid plan reason with See plans | Same tiles |
| Agency client / staff | Client's own data; no plan links in a client workspace | Client's own assets |
| Partial data | Each tile on its own: one source failing leaves the others | A failed call shows "Could not check" on its tiles, never "Missing" |
| Only one snapshot | Value shown, no line, no chip, sentence about the line | n/a |
| Long names, Tamil or Hindi titles | Titles wrap, clamp at two lines | Same |
| Phone 375 | KPI tiles two by two, best post and chart full width | Tiles two columns, last odd tile full width |
| Reduced motion | No rise, no line draw | No rise |

## 8. Tests
- `frontend/tests/performanceView.test.mjs`: KPI building from the summary and history (available, reasons, chips in words only with both periods, new followers, engagement mean), sparkline points (skip reach 0, need two points), sparkline path, weekly post counts with the 50-limit cut, best post ranking and the "latest" fallback, India month boundaries.
- `frontend/tests/brandTiles.test.mjs`: statuses for each brand tile from real rows (placeholder colours count as missing, failed source gives "Could not check"), Blueprint start tiles from the form, Blueprint result tiles from the stored pages, row filling.
- Existing suites stay green (`node --test tests/*.test.mjs`), `tsc` (only the old Influencers error), brand audit, voice audit, art budget.
- Look: audit preview on port 3102, `?perfstate=` and `?brandstate=` mock states, rows measured with `getBoundingClientRect` at 1280 and 375.

## Addendum (2026-10-19): per-platform Performance view

- New read `GET /api/analytics/performance` replaces the page's three calls (Home summary, history, campaigns); Home is untouched. Reads `SocialSnapshot`, `AIContentPerformance`, `Campaign` only, bounded and cached 60 s per account, range and platform; the snapshot and post measuring jobs clear the cache. No money, Quark or entitlement change; free accounts see the paid plan reason, client workspaces see the client's own data and no plan links.
- Edge cases covered by `backend/tests/performanceView.test.js` and `backend/scripts/performance-view-check.js`: nothing connected (free and paid), connected without numbers, old numbers of a disconnected platform hidden, X without account reach, Google without followers, posts published but not measured, too few posts for findings, a failed source, another account never visible, agency pass.
- Look: `?perfstate=full|oneplatform|empty|notconnected|error` at 1280 and 375. Details in `docs/superpowers/ops/performance-view.md`.
- The old `utils/performanceView.ts` KPI builders (`buildKpis`, `bestPostOfMonth`, `reachDays`, `chartPaths`, `heroLine`) are no longer used by the page; kept with their tests for now (only `sparkPath`, `reasonLink` and the KPI types are still imported).
