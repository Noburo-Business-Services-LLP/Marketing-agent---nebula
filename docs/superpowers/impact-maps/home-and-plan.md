# Impact map and build plan outline: HOME / DASHBOARD + MY PLAN (top-down strategy view) + Competitor and rival-post cards on Home

Written 2026-10-18 on branch `nebulaa-redesign`. Document work only: nothing in the code was changed, no server was started, no service was called, no secret was read, no test suite was run. Every claim below was checked by reading the code; file:line points to the current worktree. Where something could not be confirmed it says UNKNOWN.

Inputs read: `docs/superpowers/OWNER-REQUESTS-LEDGER.md` (areas HOME, MY PLAN, COMPETITORS, CREATE, plus the rules at the top), `specs/2026-10-18-visual-refresh-and-photoshoot-design.md` (all sections incl. 2b, 7, 7b), `specs/2026-10-17-plan-led-home-design.md`, handovers 8 to 14.

Rules this map obeys (ledger rules 2 to 4): the area is built complete, with this map as the checklist; every screen touched gets the tile look inside the speed budget; customer words follow the wording rule (no vendor names, no "credit/trial/7 days", no "Gravity/Pulsar/Orbit", no agent names).

---

## 0. The short version

1. Home today is the old Gravity home plus two cards (Setup, This week). It shows no numbers (reach, engagement, followers), no "Do this next" list, no packs, no trends or competitor posts, no ideas, no "describe what you want" box. It fetches ALL drafts and up to 50 campaigns on every visit and caches nothing.
2. My plan today is six text sections (plus the competitor and comment cards). It has no funnel, no products level, no offline channels, no marketing-mix view, no metrics level and no PDF button. The planner already produces most of the data for the funnel (ICP, positioning, channels with organic/paid split and who-does-what, pillars, 30-day calendar, 30/60/90 roadmap). It does NOT produce offline channels, a structured metrics list, or products (plan runs always send an empty offers list, `backend/services/plan/profileInput.js:59`).
3. The rival-post feature already exists in an unsafe form: `POST /api/dashboard/generate-rival-post` (`backend/routes/dashboard.js:1234`) and a "Create Rival Post" button on the Competitors page (`frontend/pages/Competitors.tsx:723-729`). Its prompt tells the model to make a "SAVAGE" post that "DESTROYS the competition" and "mocks" them, with emojis (`backend/services/geminiAI.js:2120,2174`). It must be replaced, not extended.
4. The preview mock hides real shapes: `GET /plan` returns `result: {}` (`frontend/scripts/visual-audit/mock-session.js:593`) and `/week` and `/setup` are not mocked at all (they fall to a generic answer), so the preview has never shown a populated My plan, This week card or Setup card. Handover 8 already recorded that a mock hid a real shape bug once.

---

## 1. CURRENT STATE

### 1.1 Home (`/dashboard`, `frontend/pages/GravityHome.tsx`, 378 lines)

Route: `frontend/App.tsx:277` (`/dashboard` renders `GravityHome user={user}`). `/` redirects a signed-in user via `landingPath()` (`App.tsx:226-229`). The old 5,728-line `Dashboard.tsx` is only reachable at `/dashboard-classic` (`App.tsx:281`); the Home does not use it.

Blocks, top to bottom:

| # | Block | Source / data | Lines |
|---|---|---|---|
| 1 | Agency usage block (agency owners only) | `AgencyUsage` component (own fetch) | 205 |
| 2 | Setup card | `SetupCard` -> `GET /api/setup`; shows only until all steps done | 207, `components/SetupCard.tsx` |
| 3 | This week card | `ThisWeekCard` -> `GET /api/week` | 208, `components/ThisWeekCard.tsx` |
| 4 | Hero: "N posts are waiting for your review", two buttons (Review queue, Create content) and a rotated stack of four artwork cards | counts from `GET /api/drafts`; artwork from drafts then campaigns; when nothing exists, four Unsplash stock photos marked EXAMPLE | 211-281, stock at 127-132 and 173-175 |
| 5 | Today's plan | campaigns whose date is today (from `GET /api/campaigns`), max 6 | 286-323 |
| 6 | "This week" panel: only "Published this week" and "of N planned", plus the first campaign | campaigns, client-side maths | 326-372 |

API calls on mount: `GET /api/drafts` and `GET /api/campaigns` in `Promise.all` (`:54-57`), plus the two cards' own calls (`/api/setup`, `/api/week`). Layout adds `GET /api/credits` on mount and every 60 s (`components/Layout.tsx:137-160`). No client cache: every visit refetches.

Facts about those calls:
- `GET /api/drafts` returns EVERY draft for the user, populated, newest first, no limit (`backend/routes/drafts.js:48-70`). Cost grows with the account.
- `GET /api/campaigns` has a default `limit=50` (`backend/routes/campaigns.js:902,924`), so "published this week / planned" is counted only among the newest 50.

Defects found while reading (they belong to this area under rule 2, "build everything"):
- Week maths: `isThisWeek` starts the week on Sunday in the browser's own timezone (`GravityHome.tsx:21-27`); the rest of the app uses Monday to Sunday in India time (`backend/services/week/weekMath.js:12-19`). The Home number can disagree with the This week card.
- "Today's plan" sorts by the text "9:00 AM" with `localeCompare` (`:92`), so "10:00 AM" sorts before "9:00 AM".
- The right panel label says "Compared with the last 7 days" (`:329`) but nothing is compared; it shows a single count.
- The "waiting for review" count includes status `failed` (`:113`); the same set is in `GravityApprove.tsx:164-167`, so they agree, but the set is copied in two places and not shared.
- `pendingDrafts` is computed and never used (`:69-72`).
- The stock-photo fallback (`:127-132`) loads from an outside site on every empty account. It is labelled EXAMPLE; it is also a speed and privacy cost, and the design draft prefers our own art.
- No reach, engagement or follower numbers anywhere on Home (the code comment at `:335-337` says they were removed because they were invented; the real data now exists, see 3.2).
- All Home text is hard-coded English. The app outside onboarding has no translation layer (the only translated strings are `frontend/components/onboarding/onboardingStrings.ts`).

States that exist today: setup card shown/hidden; week card states (see 1.3); hero count 0, 1, many; no campaigns today; the sample-art stack. Account variants (`GravityHome.tsx:197-201`): a CSM pass (`localStorage csmReturnToken`) sees This week but not Setup; staff themselves see neither; inside an agency client (`user.actingAgency`) This week shows, Setup does not; agency owners get the usage block.

### 1.2 My plan (`/plan`, `frontend/pages/MyPlan.tsx`, 310 lines, helpers `frontend/utils/plan.ts`, 113 lines)

Data: `GET /api/plan` (`backend/routes/plan.js:104`) returns `{ plan: { id, completedAt, stale, result }, running, failed, stopped, nextRefreshAt, eligible, reason, missing, freeBlueprint }` (`plan.js:29-57`). `result` is the WHOLE stored Blueprint run (`result.plan` is the planner output the page reads, `MyPlan.tsx:65`; the nine-page document is also inside `result.pages` and is sent too: payload size UNKNOWN, measure). The first successful open stamps `user.setup.planOpenedAt` (`plan.js:104-111`) so the Setup step "Read your plan" ticks; a CSM, agency pass or staff look never stamps it.

Sections (`utils/plan.ts:16-32`, a section only appears when it has content): "Your business today" (promise, positioning line, territory, audience, where you are today, competitors read), "Your customer" (icp: who, pains, where, triggers), "Where to show up" (channels with role, organic/paid bar, "Nebulaa does", "You do"), "The next 90 days" (three phases: focus, actions, "How you will know"), "This month's content mix" (counts by format from the 30-day calendar, pillars with why), "What to do first" (firstSteps). After the roadmap: `CompetitorInsights` and `ListeningCard` (only for state `ready`, `MyPlan.tsx:141-142,305`). Every claim line carries a tag chip in words: Confirmed / Our reading / Suggested / Not confirmed (`plan.ts:34-39`).

Page states (`plan.ts:76-87`, `MyPlan.tsx:242-303`): building (poll every 5 s), failed (Try again), stopped (message from the run), can_build ("Build my plan", free), stale (45 days, `planRules.js:9`), ready, profile_incomplete (lists what is missing), free (explains, links to the free Blueprint and plans), none. Refresh button label shows the next date once used (7-day limit, `planRules.js:7,22-30`).

What the planner produces (`backend/services/blueprint/planner.js:169-190`, stored in `result.plan`, scanned again for the extras at `pipeline.js:9-21`): `promise`, `positioning {audience[], territory{name,rationale,risk}, line}`, `whereToday[]`, `competitors[]`, `pillars[3-5]`, `calendar[~30]` (day, pillar, format, hook), `offers[]` (only typed offers, always empty for plan runs), `channels[<=5]` (from the fixed list Instagram, Facebook, LinkedIn, WhatsApp, YouTube, Google Business Profile, Website: `config/blueprint.js:7`), `icp`, `effort[]` (organicPct + paidPct summing to 100, `nebulaaDoes` from the fixed list `PLAN_NEBULAA_CAN` at `config/blueprint.js:57`, `youDo` claims), `roadmap[3]` (focus, actions, measure), `firstSteps[<=5]`.

Not in My plan today: a funnel/tile view, a products-and-services level, offline channels (the fixed channel list is online-only; offline appears only as free text inside `youDo`, prompt rule 10 at `promptRegistry.blueprint.js:62`), a marketing-mix view, a structured "numbers to watch" level, the "Download as PDF" button the spec promised (not present in `MyPlan.tsx`; handover 8 says "No plan PDF"), offers.

### 1.3 The cards that live on Home or hang off My plan

| Card | File | API | States it shows |
|---|---|---|---|
| Setup | `components/SetupCard.tsx`, `utils/setup.ts` | `GET /api/setup` (`backend/routes/week.js` setup router, steps from `services/week/setupSteps.js`) | hidden when allDone or load fails; next step with minutes and button; "plan is being built" waiting line; folds on phones. Routes: profile, socials, plan, week (`'/'`), choose (`setup.ts:4-10`). Anchor `data-tour="setup"`. |
| This week | `components/ThisWeekCard.tsx`, `utils/week.ts` | `GET /api/week` (created on first read, `weekService.js:215-246`), `POST /api/week/approve`, `/items/:id`, `/skip` | ready, partly, approved, done, skipped, top_up, no_plan, not_eligible (null), empty. Polls while posts are being made; "taking longer" after 3 min. Anchor `data-tour="this-week"`. |
| What your competitors did | `components/CompetitorInsights.tsx`, `utils/competitorInsights.ts` | `GET /api/competitors/insights` (add-on gated) | locked (renders nothing), none, started, ready, error; per competitor status no_handle / unconfirmed / failed / paused / waiting / tracking; handle editor. Only on My plan (ready state) and the Competitors page. NOT on Home. |
| What people say about you | `components/ListeningCard.tsx`, `utils/listening.ts` | `GET /api/listening` (Inbox entitlement; scoring switched off in production) | nothing when off; "locked note" on My plan for accounts without the Inbox add-on. |

What the competitor data holds (`backend/models/CompetitorSnapshot.js`): per competitor per week: followers, postsInWindow, posts30, avgLikes, avgComments, formats, topPost {url, likes, comments, type, caption <=160 chars (`snapshot.js:107`)}, hashtags. The insights API returns only sentences and a posts-per-week trend (`routes/competitorInsights.js:75`), never followers or the top post. The older `Competitor.posts[]` (up to 5 posts with image, likes, comments, link) is filled only by the old manual refresh route `POST /api/dashboard/refresh-competitor-posts` (`dashboard.js:1112`), which scrapes outside the cost guard (known open item, handover 11) and is read by `GET /api/competitors/posts` (`routes/competitors.js:790`, not gated by the add-on, only by login). The tracker itself is OFF unless `ENABLE_COMPETITOR_TRACKER=on` (`services/competitors/tracker.js:266`), so in production today there may be no snapshots at all.

### 1.4 Tour and Layout

`frontend/utils/tour.ts:12-19`: six steps; step "welcome" targets `[data-tour="this-week"]`, then `nav-create`, `nav-review`, `nav-calendar`, `nav-plan`, `help`. `shouldAutoStart` runs on `/dashboard` or `/` (`tour.ts:60-66`), never for staff, CSM pass, agency client workspace. A missing target skips the step (`visibleSteps`, `tour.ts:21`). `tests/tourWording.test.mjs` fails if a step's `data-tour` name is not found in Layout, ThisWeekCard, SetupCard or HelpMenu sources. Nav: My plan is shown to customers and agency owners and to a CSM inside a client (`Layout.tsx:188`); Competitors entry by `showsCompetitorsEntry` (`utils/navMenu.ts:13-19`). The "Review and approve" menu badge is declared but never shows a count (`Layout.tsx:197,292-294`).

### 1.5 Gap table against every ledger item for these areas

| Ledger item | Status today | What is needed |
|---|---|---|
| HOME: dashboard "very boring", colourful, appealing (Scalio, Higgsfield, Pollo; light with gold glow, a few dark accent panels) | NOT STARTED. Home is plain list and the card stack. | Control-room layout (section 3), tile system and glow tokens (design draft section 3), one dark accent panel + one gold gradient band per page. |
| HOME: tiles with small SVG art instead of plain buttons (Review queue as a tile with picture), must not slow the app | NOT STARTED. Buttons only (`GravityHome.tsx:228-243`). | `Tile`/`TileGrid` + inline SVG art set under the size budget (section 6). Review queue becomes a tile with count and art. |
| HOME: important numbers, "Do this next", photoshoot packs and templates, trends and competitor posts, ideas for you, big "describe what you want" box | NOT STARTED (none exists). Real numbers exist in the database but not on screen. | Numbers strip (3.2), Do-this-next (3.4), packs rail (3.5), trends and competitors block (3.6), Ideas (3.8), describe box (3.3). New `GET /api/home/summary`. |
| HOME: competitor rival posts: pick a post, ask for a rival post or witty comment; decent only; customer posts the comment themselves | PARTLY EXISTS in an unsafe form (old rival-post flow, 29 Quarks, "SAVAGE/DESTROYS/mocks" prompt, section 3.7). Not on Home. | Replace with the decency pipeline (3.7); retire the old route and button; add the Home surface. |
| HOME: Setup, This week and Ideas cards restyled as tiles | NOT STARTED (cards exist, plain style). Ideas card does not exist. | Restyle both cards as tiles keeping `data-tour` anchors; build Ideas (3.8). |
| MY PLAN: visual top-down/funnel view (company, products and services, customers and ICP, positioning and message, marketing mix, channels online/offline organic/paid and who does what, content, 30/60/90, numbers to watch) | NOT STARTED, owner angry it is missing. Text sections only. | Section 2: levels helper, funnel component, small planner additions (offline, metrics, products input). |
| MY PLAN: sections as tiles with art and a status line | NOT STARTED | Same funnel tiles carry art and a status chip; existing detail sections stay below as the "open" view. |
| MY PLAN: DECISION NEEDED: offline channels (hoardings, local events, WhatsApp, referrals) in the plan model and prompts | DECISION NEEDED. WhatsApp and Google Business Profile are already online channels; the rest are absent. | Recommended default in section 2.2 and decision 1 in section 8. |
| COMPETITORS: more than names: handle, followers, posts this week, recent posts, what worked | NOT STARTED. Data for followers/posts/top post exists in snapshots but no API returns it. | New read-only endpoint returning latest snapshot fields (3.6); tile per competitor. |
| COMPETITORS: Competitors in the sidebar for paid plans | DONE, NOT RELEASED (`navMenu.ts:13`). | Nothing here; keep `navMenu.test.mjs` green. |
| COMPETITORS: "What's working for your competitors" and "Trending for your business" from honest sources only; "Make a post like this" | NOT STARTED | 3.6 and 3.7. Sources: competitor top posts (snapshots), the customer's own best posts (`AIContentPerformance`), plan pillars and festivals. No scraping of platforms. |
| COMPETITORS: use competitor insight to improve the plan day by day | NOT STARTED. The plan prompt receives competitor PAGE facts only, never snapshots. | Out of scope for this area's first pass; record as a later task: feed the latest snapshot highlights into the monthly plan refresh as extra facts (planner `competitor_page` facts path). Stated reason per rule 2: needs its own QA design, not a Home/plan-view item. |
| CREATE: tiles with a picture for Single post, Campaign, Carousel, LinkedIn | NOT STARTED (belongs to the Create page). | On Home only the four "What will you create today?" tiles (Posts, Videos, Photoshoot, Growth tools); Create page tiles are the Create area's map. |
| CREATE: Photoshoot option on Home with ready-made packs (counts, styles, time, cost) | NOT STARTED; studio does not exist. | Packs rail with data contract now, placeholder until the studio exists (3.5). |
| CREATE: templates and ready-made packs from the dashboard | NOT STARTED | Template tiles that open Create with a prefill (existing `utils/prefill.ts`); packs per 3.5. |
| PERFORMANCE (related): reach, engagement, new followers as KPI tiles with sparklines | NOT STARTED | Home numbers strip uses the same data and the same helper so Performance reuses it. |
| CROSS: tile system and illustration set with a size budget | NOT STARTED | Task 1. |
| CROSS: customer wording rule | RULE | Wording guard stays green (section 4). |
| CROSS: no paid generation or provider call without the owner's OK per run | RULE | Real runs only on `nebulaa_dev` (section 7). |
| SPEC (plan-led home): "Download as PDF" on My plan | NOT BUILT | Optional; reuses the designed Blueprint PDF. Park unless owner wants it (decision 12). |

---

## 2. TOP-DOWN STRATEGY VIEW (the owner's missing feature)

### 2.1 Level by level: what the planner gives, what is missing

| # | Level (owner's order) | What the plan already holds (field in `result.plan`) | Missing | Smallest change |
|---|---|---|---|---|
| 1 | Company / business today | `promise` (cover sentence), `whereToday[]` (inference claims), business profile (not in the plan) | nothing essential | Show `promise` as the key line; `Edit` goes to Business profile (`/settings?tab=business`). |
| 2 | Products and services | `offers[]` exists in the schema but is always empty for plan runs (`profileInput.js:59` sends `offers: []`; `planner.js:117` keeps only typed offers). The customer's catalogue exists: `backend/models/Product.js` (name, type product/service, price, priceNote, keyFeatures), `GET /api/products` | the plan does not know the products | Display level 2 from the customer's own catalogue (names and count, no model call), with `Edit` to Brand assets > Products. Separately, let the planner see up to 3 products as typed offers (section 2.2 A) so pillars and hooks use them. |
| 3 | Customers and ideal customer | `icp {who, pains, where, triggers}` (4 claims each, tagged), `positioning.audience[]` | nothing | Key line = first `icp.who` claim. |
| 4 | Positioning and message | `positioning.line`, `positioning.territory {name, rationale, risk}` | nothing | Key line = `positioning.line`; chip from its tag. |
| 5 | Marketing mix | per channel `effort[].organicPct/paidPct` (a recommendation, tagged proposed in words on the page); format counts from `calendar[]` | an overall online/offline split; any paid-ads detail (out of scope: Nebulaa does not run ads, spec "Out of scope") | Define "mix" as three read-only readings computed in code (no new model output): organic vs paid per channel (exists), online vs offline (from the new `offline` block), content format mix (counts of `calendar[].format`). No invented totals. |
| 6 | Channels: online / offline, organic / paid, who does what | online: `channels[]` (role, priority) + `effort[]` (`nebulaaDoes` from the fixed list, `youDo` claims). Sample `youDo` text can mention local events or referrals but is unstructured. | offline channels as structured rows | New optional `offline[]` block (section 2.2 B). |
| 7 | Content pillars | `pillars[3-5]` (name, why, example) | nothing | Key line = pillar names. |
| 8 | Calendar | `calendar[~30]` (day, pillar, format, hook); the real monthly calendar lives in `ContentCalendar` | nothing | Tile shows counts by format and links to `/content-calendar`. |
| 9 | 30/60/90 roadmap | `roadmap[3] {phase, focus, actions[<=4], measure[<=3]}`; current phase computed from the plan date in `services/week/planContext.js:7-12` (days 1 to 30, 31 to 60, rest) | none | Highlight the phase the account is in today. |
| 10 | Numbers to watch (metrics) | only `roadmap[].measure[]` sentences; the QA scanner forbids ROI/ROAS/CTR/CPM/CPC words and digits (`qa.js:11`) | a structured metrics list tied to real numbers | New optional `metrics[]` block that picks ids from a fixed list (section 2.2 B) so the tile can show the live number where one exists. |

### 2.2 Smallest planner / prompt / QA changes

All changes are additive and optional. The nine-page Blueprint document and the paid Blueprint flow are untouched (new blocks live only in `result.plan`, like `icp` and `effort` do; `pipeline.js:26-29`).

A. Inputs (so the plan can see products, place and kind of business):
- `backend/services/plan/profileInput.js` `inputFromProfile`: send up to 3 catalogue products as `offers` (`LIMITS.MAX_OFFERS = 3`, `config/blueprint.js:31`) with name and the price text exactly as stored; send `city` from `businessProfile.businessLocation` (the field exists in `normaliseInput`, `input.js:128`, and is never passed today).
- `backend/services/blueprint/input.js` (`normaliseInput`, whitelist at `:124-129`) and `services/blueprint/discovery.js` `typedFacts` (`:30-39`): add optional typed fields `businessType` (B2B/B2C/Both), `reachAreas`, `pricePositioning`, `keyDifferentiator` so they appear as typed facts with ids the model can cite. These exist on the profile (`models/User.js:67,85,93,94`). The QA "supported by facts" rule (`planner.js:17-21`) then accepts claims built from them.
- Cost: about 200 more prompt tokens. Free Blueprint form: unaffected (fields optional).

B. Outputs (planner JSON + `normalisePlan`, `planner.js:75-191`, prompt rules in `promptRegistry.blueprint.js`):
- `offline[]`: each row `{ channel (id from a new fixed list OFFLINE_CHANNELS in config/blueprint.js), role (claim, forced proposed), youDo[] (claims, forced proposed) }`, at most 3 rows, no `nebulaaDoes` (Nebulaa does nothing offline, so the page can say so honestly). Suggested list (owner decision 1): Word of mouth and referrals; Local events and stalls; Hoardings, posters and print; Shop or counter display; Partnerships with nearby businesses; Phone and WhatsApp follow-up.
- `metrics[]`: one row per roadmap phase `{ phase, ids[] from a fixed METRIC_IDS list, why (claim, proposed) }`. Suggested ids: reach, engagement, followers, posts_published, enquiries, reviews, website_visits. The tile shows a live number only for ids Nebulaa can read (reach, engagement, followers, posts_published, from `SocialSnapshot` and `Campaign`) and says "You track this yourself" for the rest.
- No numbers in any sentence (prompt rule 2, `QA`), so every figure comes from code, never from the model.
- Claim tags: new claims are `proposed` (or `inference` with fact ids); the model can never mint `verified` (`planner.js:23-35`). The funnel's chips reuse `tagLabel()` (`plan.ts:36`).
- Prompt: add a rule 11 (offline) and 12 (metrics) next to rule 10 and extend the JSON shape; list OFFLINE_CHANNELS and METRIC_IDS as template variables like `nebulaaCan` (`planner.js:69`, variables declared in the registry entry). Keep the prompt locked (`locked: true`).
- QA: `normalisePlan` validates ids against the fixed lists and drops rows with unknown ids; `scanPlanExtras` (`pipeline.js:9-21`) scans the new claims with the same `scanClaimText`; drops are counted apart (`droppedExtra`) so they can never push a paid Blueprint over `MAX_DROPPED`. A response that lacks the new blocks degrades to today's plan without failing the run (same rule as spec "Testing").
- Token budget: `callLLM(... maxTokens: 6500)` (`planner.js:215`). Adding two blocks risks truncation (a truncated JSON makes `normalisePlan` return null -> a retry, then a failed run, `planner.js:228-236`). Raise to about 8000 and prove with one real run. Per-run model cost today is USD 0.16 (`ACTION_USD.blueprint` in `config/apiCosts.js`, read from config); expect about USD 0.18 after.
- `PLAN_NEBULAA_CAN` (`config/blueprint.js:57`) includes "inbox replies" and "competitor tracking". The plan can therefore tell a Starter customer "Nebulaa does inbox replies" although the Inbox is an add-on and has never been live-tested (ledger INBOX). Keep the list (the plan is a recommendation) but have the funnel show an "Add-on" chip beside those two words when `canUse` is false (frontend only), and keep the Inbox honesty rule.

C. Backward compatibility: stored runs are never edited. A new pure helper `levelsOf(planView, extras)` (in `frontend/utils/plan.ts`) reads every block defensively (the same style as `planOf`, `plan.ts:13`) and returns each level as `ready`, `partial` or `not_in_plan_yet`. A level that the old plan cannot supply shows "Added when your plan is next refreshed" with the Refresh button if allowed. Levels 2 and 5 (partly) are filled from the catalogue and code, so they work on every existing plan.

D. Regeneration policy and cost cap:
- No bulk regeneration. Existing plans pick up the new blocks at the monthly pass (`planRules.js:8,32-35`, scheduler `planScheduler.js`) or on the customer's own weekly refresh (`PLAN_REFRESH_DAYS = 7`).
- Optional owner-run throttled backfill only for plans lacking the new blocks, using the same pattern and dry-run default as `backend/services/plan/backfill.js` and `scripts`; recommended for managed clients only (the team uses their plan). Cost per plan about USD 0.18 (about Rs 16 at 88 per USD, `config/apiCosts.js` INR_PER_USD); the global caps still apply: `PLAN_RUNS_PER_DAY_MAX = 100` (`config/blueprint.js:58`, so at most about USD 18 a day), the daily AI spend ceiling `AI_DAILY_SPEND_CAP_USD` default 150 (`services/spendGuard.js`), provider switch.
- Never charged to the customer (plan runs are system-started, `service.js:245-271`).
- Real runs only on `nebulaa_dev` with the owner's OK per run.

E. "Edit" and "Refresh" per tile: the plan itself is not editable (AI output, immutable run). "Edit" on a tile opens the SOURCE of that level (Business profile, Products, Competitors, Connected accounts). "Refresh" exists once, for the whole plan (weekly limit), in the page header. Per-level partial regeneration is deliberately NOT proposed (cost and QA complexity).

### 2.3 The visual

A vertical stack of ten tiles joined by a thin vertical spine with small connector dots (a funnel read top to bottom, tiles very slightly narrower toward the bottom on desktop; full width on phones). Order is the owner's:

```
 [1 Your business ]  art: shop front        key line: promise            chip  [Edit]
        |
 [2 Products and services]  art: boxes       "3 items: A, B, C"           [Edit]
        |
 [3 Your customer ]  art: person+heart       first ICP "who" line          chip
        |
 [4 Your message ]   art: speech bubble      positioning line              chip
        |
 [5 Marketing mix ]  art: split circle       "Instagram 80% organic ..."   chip
        |
 [6 Where you show up] online | offline      who does what (Nebulaa / You) chip
        |
 [7 What you post ]  art: pillars            pillar names
        |
 [8 This month ]     art: calendar           counts by format -> Calendar
        |
 [9 Next 90 days ]   art: road, 3 stops      current phase highlighted
        |
 [10 Numbers to watch] art: gauge            live numbers where available
        v
 [This week]  counts + Approve   ->  [Make something now] -> Create
```

Tile anatomy: 48 px art (inline SVG, under 2 KB), level name, one key line clamped to two lines, a status chip in words (Confirmed / Our reading / Suggested, or Ready / Needs your input / Added at next refresh / Building), a chevron. Opening a tile expands the existing detail `Section` (all current content stays; section ids become anchors). Only one `Edit` link per tile, only for levels backed by the customer's own data. Header holds the single Refresh button, plan date, and a one-line state banner (existing `planBanner`). Mobile (375 px): single column, art left, text right, connector line at the left edge, chevron 44 px tap target, details open inline; desktop (1280): max width about 960 px, art larger, level 6 shows two panes (online | offline). Links down: the last two tiles are the real `ThisWeekCard` summary (counts and the Approve button, keeping `data-tour="this-week"`) and a "Make something now" tile that opens Create with the current phase focus as the prefill (`utils/prefill.ts`). A "Download as PDF" button stays optional (decision 12).

Where it lives: `MyPlan.tsx` renders `<StrategyFunnel>` above the existing sections; Home shows a one-tile "Your plan in one line" (current phase + focus + link to `/plan`) in the Do-this-next area (3.4).

Free accounts see the funnel built from the free Blueprint? UNKNOWN: the free Blueprint result is a different run (`kind blueprint`) and this page only shows the explanation for free accounts (`MyPlan.tsx:283-295`). Default: leave the free state as it is.

---

## 3. HOME LAYOUT (control room)

Order (from design draft 7b, adapted): greeting and best next step; numbers; Do this next; create tiles + describe box; packs and templates; trends and competitors; ideas. Setup and This week stay near the top because the tour and the money path depend on them.

### 3.1 Block table

| # | Block | Data source | API (existing / new) | Loading | Empty | Error | Who sees it |
|---|---|---|---|---|---|---|---|
| 1 | Greeting + one best step (hero) | business name (`user.businessProfile.name`, `Layout.tsx:264`), result of the Do-this-next rules (3.4) | none extra | skeleton line | "Welcome, <name>" + first rule | falls back to Review queue / Create | all except staff themselves |
| 2 | Numbers strip (6 tiles) | see 3.2 | NEW `GET /api/home/summary` | six grey tiles | per tile "No data yet" with the reason | whole strip shows "We could not load your numbers. Try again." other blocks unaffected | customers with the data; see variants |
| 3 | Do this next (up to 4 rows, each one button) | pure helper `nextActions(inputs)` over summary, setup, week, plan state | summary + existing `/api/setup`, `/api/week` | skeleton rows | "You are up to date." | rows from loaded sources only | all customers |
| 4 | Create tiles (Posts, Videos, Photoshoot, Growth tools) + "Describe what you want" box (tabs Post / Video / Photoshoot) | static + routes | none; box sends a prefill to `/campaigns` or `/reels` (no model call on Home) | none | n/a | n/a | all; Photoshoot tile marked "Coming soon" until the studio exists |
| 5 | Setup card / This week card as tiles | existing | `/api/setup`, `/api/week` | existing | existing | existing | rules at `GravityHome.tsx:197-201` kept |
| 6 | Packs and templates rail | static pack definitions + (later) photoshoot studio config | none now | none | whole rail hidden until packs exist (decision 9) | n/a | all |
| 7 | Trends and competitors | competitor top posts, own best posts, plan pillars/festival | NEW `GET /api/competitors/best-posts`; own best from summary | skeleton cards | honest per-card "Not enough data yet" | card-level retry | competitor part only with the add-on |
| 8 | Ideas for you (3 to 6 cards) | weekly proposal topics + plan calendar hooks (no model call) | existing `/api/week` + plan calendar via summary | skeleton | hidden when no plan | hidden | paid with a plan |
| 9 | Today's plan list | campaigns today | summary (server-side, replaces client maths) | skeleton | existing sentence | existing | all |

Loading rule: every block renders its own skeleton at fixed height (no layout shift) and fails alone; one failed call never blanks Home. The hero count and the Review tile come from the summary, not from downloading all drafts.

### 3.2 Numbers: what exists today and where from

| Number | Exists today? | Source (verified) | Note |
|---|---|---|---|
| Reach | Yes, if the account has an Ayrshare profile key and connected platforms | `SocialSnapshot.totals.reach` per day (`models/SocialSnapshot.js:29-34`), written every 12 hours (`services/snapshotScheduler.js:35`) from provider analytics; read by `GET /api/analytics/history` (`routes/analytics.js:542-565`) | Needs the snapshot job to be on (kill switch `AYRSHARE_SNAPSHOT_ENABLED`, `snapshotScheduler.js:24-26`) and a connected account. Show "as of <date>". Paused/frozen accounts are skipped (`backgroundGate`). |
| Engagement | Yes, as a rate per platform, not a total | `platforms.<name>.engagementRate` (`SocialSnapshot.js:11-17`); Instagram's is computed from likes/followers (`snapshotScheduler.js:150-152`) | Home shows the average rate across connected platforms with the platform list; there is no stored "total engagement". |
| New followers | Derivable | difference of `totals.followers` between latest snapshot and the one about 7 days earlier | Needs two snapshots; otherwise "No data yet". Negative values shown as down chips, never hidden. |
| Followers | Yes | `totals.followers` | |
| Posts this week | Yes, but wrong on Home today | `Campaign` (`publishedAt`, status) for the Monday to Sunday IST week; today's Home counts client-side on 50 campaigns (see 1.1) | Server count: published vs planned (`scheduledFor`). Which Campaign date field marks "planned for this week" for a draft-origin post: UNKNOWN, verify (`Campaign.js:73,152,156`). |
| Drafts waiting | Yes | `Draft` count with status set pending/draft/ready/processing/failed/completed, excluding reels/videos (`GravityHome.tsx:113-119`) via index `{userId,status}` (`Draft.js:181`) | One shared set of statuses in a backend helper, used by Home summary and checked against `GravityApprove.tsx:164-167`. |
| Unreplied messages | Yes, only with the Inbox add-on and a connected platform | `getSummary().unreadMessageCount` (`services/socialInboxService.js:900-904`) | The Inbox has never been live-tested (ledger): tile copy must say "unread" and not promise automatic replies. For accounts without the add-on the tile is replaced by an "Add-on" tile (not a number). |

Formatting: Indian grouping with `Intl.NumberFormat('en-IN')` up to 99,999; above that use "1.2 lakh" and "1.2 crore" words (tested helper `formatCount`); percentages one decimal; the up/down chip says the direction in words (not colour only); never show a number we cannot source (the code comment at `GravityHome.tsx:335-337` records that invented reach was removed).

`GET /api/home/summary` (new, one call, no model call, no outside call): per-user indexed counts and two snapshot reads. Returns `{ asOf, draftsWaiting, posts { publishedThisWeek, plannedThisWeek, weekStart }, inbox { entitled, unread } | null, numbers { reach, engagement, followers, newFollowers, asOf, platforms } | null, connected { count }, plan { state }, competitors { tracked, needHandle }, products { count, withPhotos } }`. Route pattern, rate limiter and `protect` as in `routes/plan.js:15-18,104`; inside an agency client or CSM pass the user is already the client (`middleware/auth.js:127-137`). Reads only (so it is allowed inside client workspaces: the blocked list is for payments, plans, passwords). Response target under 3 KB.

### 3.3 "Describe what you want" box

Tabs Post / Video / Photoshoot. Pressing the button navigates to `/campaigns` or `/reels` with the text prefilled through `utils/prefill.ts` (the same one-shot used by This week). It makes NO model call and charges nothing on Home; costs arise on the Create/Videos screens as today. The Photoshoot tab shows a calm "coming soon" until the studio exists.

### 3.4 "Do this next" rules (ordered; show the first four that apply; each one button)

1. Not onboarded / profile incomplete (`profileComplete`, `services/plan/profileInput.js:65`) -> "Add your business details" (`/settings?tab=business`).
2. Plan failed or stopped -> "Try building your plan again" (`/plan`); plan building -> informational row, no button.
3. Paid account, plan ready, never opened (`setup.planOpenedAt` empty) -> "Read your plan" (`/plan`).
4. This week proposal `ready` (not approved) -> "Approve this week" (anchors to the This week card; no duplicate approve logic).
5. Pool cannot pay (week `topUp`) -> "Top up to make this week's posts" (`/trial-expired`).
6. Drafts waiting > 0 -> "Review N posts" (`/drafts`).
7. Inbox entitled and unread > 0 -> "Reply to N messages" (`/inbox`).
8. No connected social account (`connected.count === 0`) -> "Connect your accounts" (`/connect-socials`), note "posts can still be made".
9. Competitor add-on held and any competitor has `no_handle` / `unconfirmed` / `failed` / `paused` -> "Confirm a competitor's handle" (`/competitors`; uses `linkLabel`, `competitorInsights.ts:154`).
10. Products without a photo (`withPhotos < count`) -> "Add a photo to your products" (`/brand-assets?tab=products`).
11. Free tier: replace 3 to 5 by "Choose a plan" (`/trial-expired`).
12. Nothing applies -> "You are up to date."

Rules are one pure function `nextActions({summary, setup, week, planView, user})` with a table-driven test; it returns ids so tests and analytics do not depend on wording. The first rule also feeds the hero button.

### 3.5 Ready-made packs rail

Data it needs per pack: `id`, `title`, `art` (inline SVG id), `photoCount`, `styles[]`, `minutes`, `costLabel` (derived only from `config/apiCosts.js`; shown as "about N posts' worth" with the Quark figure beside it, per commit `65d337a`), `needs` (products with photos? environment photos?), `state` (`available` | `comingSoon`). Examples from the design draft: Product photoshoot, Marketplace pack, Festival pack, Model photoshoot. Until the Photoshoot studio exists the rail is hidden (recommended, decision 9) so nothing promises a feature that is not there; the data contract and the placeholder tile component are built now so the studio plugs in. Template tiles (post templates) open Create with a prefill and are not blocked by the studio.

### 3.6 Trends and competitors block

- "What's working for your competitors": three strongest recent competitor posts across tracked accounts. NEW read endpoint `GET /api/competitors/best-posts` (competitors add-on gate as `routes/competitorInsights.js:113`): from the latest good snapshot per tracked competitor returns `{ competitorId, name, handle, followers, postsThisWeek, topPost { url, likes, comments, type, caption (<=160) }, weekOf, isCurrentWeek }`. It reuses `trackedCompetitors`/`competitorsQuery` (`services/competitors/tracked.js`) and the same ownership checks as `viewFor` (`competitorInsights.js:49-90`). It never returns another account's data and never calls Instagram (the tracker does, weekly, behind the read guard).
- "Trending for your business": three honest sources only, each card says what it is based on: (a) competitor best posts, (b) the customer's own best posts (`AIContentPerformance` metrics likes/reach/engagement, `models/AIContentPerformance.js:32-43`, filled by `performanceTracker`), (c) plan pillars and festivals. There is NO festival dataset in the code (festivals appear only inside the calendar prompt, `services/contentCalendarService.js:16,85,109`); a small owner-approved India festival table is needed for (c) (decision 10). No scraped third-party "trending" feed.
- Per-competitor tile (on Home as a short list and on the Competitors page): initial/avatar, name and @handle link, followers, posts this week with up/down chip, best post snippet with likes and comments and "Open the post", status chip from `statusText`. Honest empty text "Not enough data yet" (matches `competitorInsights.ts` wording style).
- All tracker facts hold: the tracker is OFF by default (`tracker.js:266`), the add-on is required, handles must be confirmed (`handleStatus`), paused after 3 failed weeks (`config/competitors.js` `FAIL_PAUSE_AFTER`), max 5 tracked (`MAX_TRACKED`).

### 3.7 Rival post and witty comment draft flow (with the decency pipeline)

What exists now (to be retired): `POST /api/dashboard/generate-rival-post` (`dashboard.js:1234-1280`):
- The competitor's text comes from the request body (`competitorContent`), so any text can be injected and the server does not check it belongs to this account's competitors.
- Prompt: "SAVAGE yet professional counter-post that DESTROYS the competition", "Competitor Claims to Mock", "Include emojis" (`geminiAI.js:2120,2174`).
- Money: it checks the balance against 7 (`dashboard.js:1243`) but the action costs `QUARK_COSTS.rival_post = 29` (read from `config/apiCosts.js`; `deductCredits` uses `QUARK_COSTS`, `middleware/trialGuard.js:14,68`); the result of `deductCredits` is not checked before generating (`dashboard.js:1257-1262`), and the catch does not refund. So an account holding 7 to 28 Quarks can appear to generate for free, and a failure keeps the charge. Verify with a test before the fix (this is read from the code, not run).
- No `requireFeature('competitors')` on the route (login only). The screen text says "7" (`Competitors.tsx:216`).
- It produces an image post at USD 0.23.

New flow ("Make a post in response" and "Draft a witty comment"), on Home cards and on the Competitors page:

1. Endpoint: `POST /api/competitors/posts/draft` body `{ competitorId, kind: 'response_post' | 'comment', tone: 'friendly' | 'witty', instruction? (<=200 chars) }`. The server looks the post up itself from the latest snapshot's `topPost` (never from client text), checks ownership and `requireFeature('competitors')`, refuses staff and paused/frozen/pending-deletion accounts (`backgroundGate`), and works inside an agency client (pool shared, `payerId` as in `trialGuard.js:95-100`).
2. Local input filter on the instruction: reuse the comment-scoring safety filter and abuse list (`services/listening/helpers.js` `abuseUnsafe`/`safeQuoteText`, list at `config/listening.js:40`). The helper is not exported today (`helpers.js:391` exports `safeQuoteText` only) and `safeQuoteText` also enforces quote length and rejects numbers, so add a small exported `isDecentText(text)` that applies only the abuse and contact rules. Extend the list for banter requests (make fun of, mock, roast, expose, shame, destroy, troll) and for words about caste, religion, gender, nationality, disability, appearance, accent. The existing list is declared a minimum and cannot cover Tamil or Hindi transliteration (comment at `config/listening.js:34-38`), so the model check below carries those languages.
3. Cost guard before any model call: `spendGuard.check` for the new actions; new actions `competitor_inspired_post`, `competitor_comment_draft`, `decency_check` added to `ACTION_USD`/`QUARK_COSTS` (derived, never typed prices), to `PROVIDER_OF` as `openai_text` and given staff labels (`services/spendGuard.js:12-24`). Caps per account per day (suggest 10 drafts, 5 blocked attempts, 3 per minute) and a global daily cap, kept in `config/competitors.js` style so a number can be changed without code. The "ledger before the call" rule from comment scoring applies (`services/listening/ledger.js`): record the attempt first, so a crash can never allow a repeat call.
4. Charge once up front for an allowed request, refund on any failure or block (pattern: `weekService.refundOwned`, `services/week/weekService.js:253-262`). Comment drafts are cheap (about a caption: `campaign_text` is 4 Quarks); a response post is text only in v1 (no image), then hands off to Create with a prefill if the customer wants a picture (decision 5).
5. Generation: strict system prompt (friendly or witty banter only; own verified facts only, drawn from `businessProfile` and the plan's tagged claims; never names or insults a competitor; no claims about them; no numbers, awards, customers; no profanity; no politics; no sensitive events; length limits; customer's language and brand voice). The competitor caption goes in as quoted DATA, never as instructions (prompt-injection guard); at most 160 characters come from the snapshot anyway.
6. Output checks, all must pass: local filter on the output (`isDecentText`), no @mentions, links, phone numbers, emoji limit, length limit, no competitor name or handle inside the text, `scanClaimText` for invented numbers (`services/blueprint/qa.js:56`), then the second model check: a separate cheap call returning `{ safe: true|false, reason }` (same pinned-model, `noFallback: true` approach as `callTextLLM`, `services/openAI.js:141-150`). The check fails closed: an error or an unparseable reply counts as blocked. Blocked: plain message "That is not something we can write. Try a friendlier angle." and a refund.
7. Result shown with Copy and "Open the post" (link from the snapshot) and the line "Check this before you post it. You are responsible for what you publish." The comment is NEVER posted by Nebulaa: no code path may call a comment-posting endpoint of Ayrshare or Meta on a third-party post (a test greps the new route files for it). A response post enters the normal flow on the customer's own accounts: `POST /api/drafts/save` -> Review and approve.
8. Logging: counts only, no text. A small collection of daily counters per account and outcome (`allowed`, `blocked_local`, `blocked_model`, `error`, with a rule code), registered in `services/dataRegistry.js` (a test enforces registry coverage, `dataRegistry.js:72` is the pattern) and shown on the staff Usage view.
9. Retire the old route and button: respond 410 with a plain message, remove the button at `Competitors.tsx:723-729` and the modal chain, keep stored `rival_post` ledger rows readable. Until Task 7 ships, no new surface may link to the old flow.

### 3.8 Ideas for you

Source (no new model call; the design draft says the same): the current week's proposal items (`WeeklyProposal.items`: kind, topic, channel, status) and the plan's 30-day `calendar[]` hooks for the days ahead (`hook.text`, `format`, `pillar`). Each card: tag (pillar), title (hook or topic), format, cost label from `apiCosts` ("about 1 post"), one button "Make this" that prefills Create (existing `buildPrefill`, `utils/week.ts`) or, for a post already in the week, scrolls to the This week card so a topic is never made twice. Respect the proposal limits and the pool; hide when there is no plan. Festival ideas need the festival table (decision 10); until then the card source is pillars and hooks only.

### 3.9 Entitlement and plan variants

| Account | Home shows | My plan | Notes |
|---|---|---|---|
| Free | greeting, Create tiles, Review tile, numbers only if connected (rare), Do-this-next = Choose a plan / profile / Blueprint, no This week | explanation + free Blueprint (`MyPlan.tsx:283-295`) | No competitors, no Inbox tile. Free can still use create (`entitlements.js`: create and blueprint always allowed). |
| Starter / Growth (`professional`) | everything; competitor block shows an "Add-on" tile unless the competitors add-on is held; Inbox tile "Add-on" unless Inbox add-on and publish add-on held (`entitlements.js:50-70`) | funnel; competitor and comment cards per add-on | Growth is tier `professional`. |
| Agency owner | everything plus `AgencyUsage` (`GravityHome.tsx:205`); posts-and-videos wording, no Quarks (`showsPostsNotQuarks`, `utils/agency.ts`) | own plan like any account | Packs/numbers are the owner's own account. |
| Agency client workspace (`user.actingAgency`) | no Setup card, This week yes, no tour (`tour.ts:62`); numbers for that client's own snapshots; pool shared with the agency | funnel for the client | Payments, plans, passwords blocked server-side (`middleware/auth.js:127-137`); new draft endpoints charge the agency pool (`payerId`). Frozen or ended-agency clients are paused (`backgroundGate.js`). |
| Managed (no tier) | everything, "never blocked" (`entitlements.js:9-12,52`) | funnel | Managed clients got plans by backfill; the team sees the same page through the CSM pass. |
| Staff themselves | neither Setup nor This week; no plan menu entry | no plan | Staff pages use their own summaries. |
| CSM inside a client | This week yes, Setup no, no tour | funnel | `csmReturnToken` (`GravityHome.tsx:198`). Summary must never stamp setup flags (same rule as `plan.js:107`). |

---

## 4. DEPENDENCIES AND SIDE EFFECTS

What reads or changes because of this work:

1. Tour: steps and anchors in `frontend/utils/tour.ts:12-19`. Keep `data-tour="this-week"`, `"setup"`, `"help"`, nav anchors exactly. If the new Home moves This week lower the tour spotlight still finds it (scrolls?) UNKNOWN: check `GuidedTour.tsx` scrolls the target into view on a phone. If a Home tile for the plan is added consider a new tour step; the tour start rule is untouched. `tests/tourWording.test.mjs` fails if an anchor is removed; extend its source list if the anchors move into new component files (it reads only Layout, ThisWeekCard, SetupCard, HelpMenu).
2. Tests that pin text or structure: `tests/plan.test.mjs`, `setup.test.mjs`, `week.test.mjs`, `competitorInsights.test.mjs`, `listening.test.mjs` (reads `ListeningCard.tsx` and `utils/listening.ts` sources, `:133,147,197`), `tour*.test.mjs`, `navMenu.test.mjs`, `quarks-wording.test.mjs`, `brand-names.test.mjs`, `planArt.test.mjs` (reads `PlanArt.tsx` shape), `landing.test.mjs` (unrelated). Backend: `planRoutes`, `planNormalise`, `blueprintPlanner*`, `planFinal*`, `weekRoutes`, `competitorInsightsRoutes`, `setupSteps`. Any new field in `normalisePlan` output must keep these green.
3. Wording guard and audits: `tests/quarks-wording.test.mjs` scans all frontend text for credit/trial/7 days; `scripts/brand-audit.mjs` (Gravity/Pulsar/Orbit); `scripts/voice-audit.mjs` over the explicit list `tests/voice-scope.json` (no exclamation marks, emoji, banned slang, em dashes). New files must be ADDED to `voice-scope.json` (Tile, art, StrategyFunnel, Home blocks, utils); `GravityHome.tsx`, `MyPlan.tsx`, `utils/plan.ts`, `ThisWeekCard`, `SetupCard`, `CompetitorInsights`, `ListeningCard` are already in scope (`voice-scope.json:51-58`). `Competitors.tsx` is not in scope and contains an emoji heading and `alert(` text; touching it means adding it or cleaning it.
4. Layer lists: new Tailwind arbitrary colours and gradient fills change the generated LIGHT SEMANTICS block in `frontend/index.html` (`:100-114,206`): after UI work run `node scripts/visual-audit/gen-layer-lists.mjs`; `tests/layer-lists.test.mjs` fails while it is stale. Gradient/dark accent panels may need `data-nb-surface="dark"` (`index.html:103-104`); fills that fail contrast both ways are listed in `layer-needs-fix.json`.
5. Preview mock (`frontend/scripts/visual-audit/mock-session.js`): needs (a) a real-shaped `GET /plan` fixture with icp, effort, roadmap, calendar, pillars, plus old-plan and new-plan variants; (b) `/week` and `/setup` mocks with the card states (`ready`, `partly`, `top_up`, `no_plan`, `done`, `skipped`); (c) `/home/summary` variants (full, no data, no socials, no inbox, error, slow); (d) `/competitors/best-posts` variants (follow the existing `?compstate=`, `COMP_ROWS` at `:256-271`); (e) a draft-endpoint stub with blocked and error answers. Update `routes.json` with the new states. The audit-gate tests (`audit-gate.test.mjs`) read the route list.
6. Caches: none on the client today. Adding stale-while-revalidate for summary (sessionStorage, 60 s, wrapped in try/catch because storage can throw in private windows). Server: do not add to `DashboardCache` (type enum is only dashboard/strategic, `models/DashboardCache.js`; no expiry). `Layout` credits poll every 60 s is untouched.
7. Staff pages that mirror the plan: `routes/staff.js:359-386` (client plan view and refresh) and `frontend/pages/staff/StaffClientPage.tsx:143` (Refresh plan). They return the same `result`, so new optional blocks flow through unchanged; the staff card only shows status, so nothing breaks. If the funnel is added to the staff view later it must use the same pure `levelsOf`. Staff Usage/Home use `check_competitors`-style labels; new spend actions need labels (`spendGuard.js:24`) and the staff AI switches card lists providers from `LABELS`.
8. Agency client workspaces: see 3.9. The summary route and best-posts route must not leak across clients (always `req.user._id`); the draft route charges the pool and uses `payerId` for refunds.
9. Translations (English, Tamil, Hindi): the app outside onboarding has no translation layer, so new Home and funnel copy is English only, like everything on Home and My plan today. The plan text itself is generated in English (the planner prompt has no language variable). Customer-language handling that DOES exist: `contentLanguage` is passed to This week prefills (`GravityHome.tsx:208`) and the draft text model is chosen by language (`textModelFor`, `services/openAI.js:145`). For the witty comment/response draft the output language must follow `contentLanguage` (Tamil/Hindi supported through `textModelFor`), and the decency checks must be proven in Tamil and Hindi (decision 13). Proposal: write all new copy as constants in one `frontend/constants/homeCopy.ts` (like `constants/blueprintCopy.ts`) so a later translation is a single file; do not start a translation framework in this area.
10. Analytics/events: there is a `FeatureEvent` model (`backend/models/FeatureEvent.js`). Use it (or the existing pattern) for: home_viewed, next_action_clicked (rule id), tile_opened (level id), draft_requested/blocked (counts only). Names to be agreed; no personal text in events. UNKNOWN: how `FeatureEvent` is written and read today; check before adding.
11. Cost guard and spend ceiling: new actions inherit the daily ceiling (`AI_DAILY_SPEND_CAP_USD`, default 150), the provider switch and `AI_KILLED`; `PROVIDER_OF` must list them or the guard cannot see them (`spendGuard.js:12-23`). The plan run keeps its own caps (100/day).
12. Entitlements and locked states: `canUse(user,'competitors')` for competitor blocks; `inbox` needs Inbox + publish add-ons (`entitlements.js:67`); the Competitors page already shows the calm locked note (`competitorInsights.ts:LOCKED_NOTE`). Every locked tile must say what it is and where to get it, never block Home.
13. Release/deploy order: backend first (new routes, new optional planner blocks are harmless to the old frontend), then frontend. Switches stay as they are: `ENABLE_COMPETITOR_TRACKER` (OFF), `ENABLE_LISTENING` + `LISTENING_MODEL` (OFF), `ENABLE_WEEKLY_PROPOSAL` (unset = on). The whole branch is unreleased since `bc514a9` (handover 13); the owner types the release himself. Add a new switch `ENABLE_COMPETITOR_DRAFTS` (default off) so the draft flow can be turned off without a release.
14. Data registry and export/erasure: any new collection (daily draft counters) must be listed in `services/dataRegistry.js` with an erase action; the registry coverage test fails otherwise. Account export (`services/accountExport.js`) should include or explicitly exclude it.
15. Other readers of `GET /api/plan`: `SetupCard` indirectly (setup route calls `currentPlan`), `weekService` (`planCalendarForWeek`), `planContext.js` for calendar prompts. They read `result.plan.pillars/channels/effort/roadmap/calendar`; additive blocks do not affect them.
16. Old surfaces: `Dashboard.tsx` (classic) still contains rival post and competitor code; it is unreachable from the menu but routed. Decide whether to remove its rival-post path with the 410 (the 410 will make any remaining caller show its error).

---

## 5. EDGE CASES (checklist; each needs a visual or test state)

Account and data:
- [ ] Brand-new account, nothing yet: Home shows greeting, Create tiles, Do-this-next "Add your business details"; numbers tiles say "No data yet" with the reason, not zeros.
- [ ] Incomplete profile: plan state `profile_incomplete` lists what is missing; funnel hidden or levels 1 to 4 show "Needs your input" with Edit.
- [ ] Plan still building: skeleton funnel + banner, polling (5 s), Do-this-next shows the info row; This week shows `no_plan` text.
- [ ] Plan failed (first run) and failed refresh with an older plan: failed banner vs "last plan still here" (spec "Error handling").
- [ ] Stale plan (45 days): funnel shows with a gentle note (`planBanner` stale).
- [ ] Old stored plan without the new blocks: levels 6 (offline) and 10 (metrics) show "Added when your plan is next refreshed"; level 2 from catalogue still works.
- [ ] Stopped run (unreadable business): stopped message, no retry loop.
- [ ] No socials connected: no reach/engagement/followers; Connect tile; posts still can be made.
- [ ] Connected but no snapshot yet (job runs every 12 h): "First numbers arrive within a day".
- [ ] Only one snapshot: no "new followers" (needs two).
- [ ] Snapshot job switched off: numbers stale; show "as of" date; never present stale as today.
- [ ] No competitors / add-on missing / competitor handle `no_handle`, `unconfirmed` (never read until confirmed), `failed`, `paused` (3 failed weeks); tracker OFF in production: block explains "We look at their public posts each week" without promising a date.
- [ ] Competitor top post missing or caption empty or video without caption; link to a deleted post.
- [ ] Inbox: no add-on, add-on but nothing connected, never live-tested: no promise of automatic replies.
- [ ] No products / products without photos: level 2 and the photo rule.
- [ ] Free account: no plan funnel; Do-this-next is Choose a plan.
- [ ] Managed account (no tier) without a plan tier shown: treat as never blocked (`resolveTier` managed); no upgrade prompts.
- [ ] Agency client workspace; frozen client; agency plan ended; account pending deletion (`DeletionPending`): paused states, no draft endpoint use.
- [ ] Staff self, CSM pass: no stamps, no tour, no charges.

Numbers and text:
- [ ] Huge numbers: Indian grouping, "lakh/crore" words, no overflow in a tile at 375 px.
- [ ] Zero versus unknown: show "0" only when the source says 0; otherwise "No data yet".
- [ ] Negative change, `NaN`, `Infinity`, missing previous value.
- [ ] Very long business, product, competitor and handle names: clamp two lines, `break-words`, tooltips/title.
- [ ] Tamil and Hindi text (longer, taller line height, different fonts: see `components/onboarding/indicFonts.ts`): key lines in the funnel come from claims that are English today; competitor captions and user instructions may be Tamil/Hindi; tiles must not clip; test with long Indic strings.
- [ ] Small phone widths (320 and 375): single column, 44 px targets, no horizontal scroll (the setup card already folds below 640 px, `SetupCard.tsx:19`).

Performance and platform:
- [ ] Slow network and large art: skeletons at fixed height, art inline (no request), raster tiles `loading="lazy"` with width and height; summary failing alone.
- [ ] Reduced motion: no transform animation on the card stack or tiles; spine animation off.
- [ ] Dark mode: not supported (design draft section 9; light only): confirm nothing flips with the OS setting.
- [ ] Accessibility: every art `aria-hidden` (decorative, as `PlanArt.tsx`), status chips spell out words (colour never the only signal, as `MyPlan.tsx:21-27`), funnel is an ordered list with headings, expand buttons have `aria-expanded`, focus order top to bottom, contrast AA via the audit, text alternatives for the sparkline tiles (text summary + table fallback per dataviz rules in the design draft).
- [ ] Concurrent edits: two tabs approving the same week (idempotent: second approve changes nothing); refresh pressed in two tabs (server claim `claimStart`, `planService.js:33-36`); a plan completing while the page is open (polling swaps state); a tracker pass finishing between two loads.
- [ ] Errors from model calls: draft endpoint timeout, second check unparseable, provider switch off (`BUSY` message from `spendGuard.js`): always "Nothing was charged." and a refund.
- [ ] Blocked-by-decency drafts: friendly message, no echo of the offending text, counter incremented, repeat blocked attempts hit the daily limit; no logging of the text.
- [ ] Prompt-injection in a competitor caption ("ignore previous instructions"): treated as data; output still passes all checks.
- [ ] A competitor's page that is a person (private individual) rather than a business: v1 only drafts about topics, never uses the person's name.

---

## 6. PERFORMANCE BUDGET

Starting point, verified: Tailwind runs from the Play CDN at runtime (`frontend/index.html:8`, "esm.sh" import map noted in the audit README), so every new class is compiled in the browser; Home loads every draft and up to 50 campaigns (1.1); no caching; the first paint also waits for four+ requests.

Budget for Home and My plan (to be enforced by a script and a test, as the design draft section 3 says):
- Art: all new illustration SVG together under 40 KB gzip; each SVG component under 2 KB; no new raster above the fold except at most 6 photo tiles of at most 40 KB each (`loading="lazy"`, `decoding="async"`, explicit width/height); no blocking request for art; the unsplash fallback (`GravityHome.tsx:127-132`) is removed.
- Requests on first paint: at most 3 in parallel (summary, setup, week) plus the plan view only on My plan; every response under 30 KB; summary under 3 KB; no call may download the whole draft or campaign list.
- Timing: first contentful paint no more than 100 ms worse than the current build on the sample-data preview (design draft); layout shift zero from async blocks (fixed-height skeletons).
- Enforcement: (1) `frontend/scripts/art-budget.mjs` (new): reads `components/art/*.tsx`, extracts SVG markup, gzips it, fails over the per-file and total limits; checks `public/assets/tiles/*` file sizes; fails if a Home component contains a `src="http` external image. (2) `frontend/tests/artBudget.test.mjs` runs the script like `layer-lists.test.mjs` runs its generator (`node --test` picks it up). (3) A small test that `GravityHome.tsx` no longer calls `getDrafts`/`getCampaigns`. (4) Manual: `vite build` size before and after, recorded in the task report (not run in this document).
- Caching of home numbers: server numbers are daily snapshots (12-hourly job) so they cannot be fresher than that; the summary is cheap and uncached on the server; the client keeps the last summary for 60 s (stale-while-revalidate, `sessionStorage`, try/catch). The week and plan calls stay as they are (the week call may create the proposal row on first read, so it is called once per visit, not polled except while making posts). `GET /api/plan` payload includes `result.pages` that MyPlan does not read; measure its size and, if large, trim `pages` from the customer route ONLY after checking no other reader needs it (UNKNOWN, check `grep result.pages`).
- Server cost: summary = about 6 indexed reads (`Draft {userId,status}`, `Campaign {userId,status}`, `SocialSnapshot {userId,date}`, inbox `{userId,status}`, `Competitor {userId,isActive}`, `Product {user}`), no model call, no outside call.

---

## 7. TESTS NEEDED

Pure helpers (frontend, `node --test tests/*.test.mjs`):
- `utils/plan.ts` `levelsOf`: every level with full plan, old plan (no icp/effort/offline/metrics), empty `{}`, malformed; key-line selection; chip choice; "not_in_plan_yet" status; current-phase highlight.
- `utils/home.ts`: `formatCount` (Indian grouping, lakh/crore, 0, null, NaN, negative), `nextActions` table (each of the 12 rules, order, max four, free vs paid vs agency client vs CSM), `weekLabel` Monday-IST maths against `weekMath.js` cases, the draft status set shared with Approve (a test that fails if `GravityApprove.tsx` and the helper disagree).
- Source-reading tests in the repo's style: `homeCopy` has no banned words (credit, trial, 7 days, Gravity/Pulsar/Orbit, vendor names, emoji, exclamation); `GravityHome.tsx` keeps `data-tour` anchors; no external image URLs; tiles have `aria-hidden` art.
- Wording guard (`quarks-wording.test.mjs`) and the brand/voice audits must stay at 0; new files added to `voice-scope.json`.
- Art budget: `scripts/art-budget.mjs` + `tests/artBudget.test.mjs` (limits above).

Backend (`cd backend && node --test tests/*.test.js`):
- `homeSummary` route: counts for each variant, week boundary at Monday IST midnight, inbox null without entitlement, numbers null without snapshots, never another user's rows, agency client and CSM pass do not stamp anything, rate limit, response size.
- Planner: `normalisePlan` accepts/drops `offline` and `metrics` (unknown ids dropped, tags forced to proposed, digits and forbidden words dropped by `scanClaimText`, max rows, a response lacking the new blocks still returns the old plan, `droppedExtra` separate); `profileInput` passes products/city/typed fields and still returns `profileComplete` the same; prompt test that the locked prompt contains the new rules and variables; token cap raised and truncation case.
- Competitor best-posts route: add-on gate (403 shape as `competitorInsights.js:113`), only own competitors, unconfirmed/paused excluded, `isCurrentWeek` honoured, caption clipped, no snapshot -> empty list.
- Draft pipeline: instruction filter, injection text, each check failing (local input, local output, model says unsafe, model errors, model returns junk), refund on every failure branch, charge exactly once, caps (per minute, per day, blocked-attempt cap), spend guard busy, provider switch off, agency client pays from the pool, staff refused, `ENABLE_COMPETITOR_DRAFTS` off, language Tamil/Hindi output passes the same checks, a test that no file in the new route calls a comment-posting API, old route returns 410.
- Cost config: `apiCosts` tests (the repo derives prices from config; add the three actions; no typed prices), `PROVIDER_OF` includes them.
- Data registry coverage for the new counters collection; account export test.
- Real-database checks (script modelled on `backend/scripts/competitors-realdb-check.js`, refuses any DB except `nebulaa_dev`): summary queries on a realistic dataset (counts, week boundary, indexes used); draft counters and charge/refund atomicity; one real planner run with the new blocks (owner OK, about USD 0.18) and a look at `GET /api/plan`.

Visual states for screenshots at 375 and 1280 (preview with the mock states above; Browser pane; contrast audit AA):
Home: new account; profile incomplete; plan building; full paid account (numbers up, down, no data); no socials; Inbox add-on missing; Inbox with unread; competitors none, all handle states, best posts; packs hidden; ideas; free account; agency owner; agency client; managed; CSM pass; slow/error summary; long Tamil names; very large numbers.
My plan: funnel with full plan; old plan (missing levels); building; failed; stale; stopped; free; profile incomplete; each tile expanded; phone and desktop; reduced motion.
Competitor/rival: draft modal states: idle, working, allowed result, blocked message, error, limit reached.

---

## 8. RECOMMENDED BUILD ORDER (8 independently shippable tasks)

Each task ships alone and leaves the app working. Review levels follow the repo's practice (sonnet implementer, controller verifies, one strongest-model review for money and model-call paths, real-database check where Mongo behaviour matters).

| # | Task | Files to touch | What it proves | Needs |
|---|---|---|---|---|
| 1 | Tile foundation: `Tile`, `TileGrid`, art set (ten plan levels + home blocks), glow/glass tokens, art-budget script + test, voice-scope entries, layer-list regeneration. No page changes except one proof tile on Home. | `frontend/components/Tile.tsx`, `frontend/components/art/*`, `frontend/scripts/art-budget.mjs`, `frontend/tests/artBudget.test.mjs`, `frontend/tests/voice-scope.json`, `frontend/index.html` (generated block), `frontend/constants/homeCopy.ts` | budgets are enforced before any page uses the art; contrast AA | none special |
| 2 | Home data layer and fixes: `GET /api/home/summary`, shared draft-status helper, Monday-IST week, `utils/home.ts` (`formatCount`, `nextActions`), stale-while-revalidate, remove unbounded drafts/campaigns calls and the Unsplash fallback, fix the time sort, preview mocks for `/home/summary`, `/week`, `/setup`, real-shaped `/plan`. | `backend/routes/home.js` (new), `backend/server-main.js` (mount near `:482`), `frontend/utils/home.ts`, `frontend/pages/GravityHome.tsx`, `frontend/scripts/visual-audit/mock-session.js`, `routes.json`, tests | real numbers are right and Home is faster; the preview finally shows populated cards | real-database check of the queries (indexes, week boundary) |
| 3 | Home control-room layout: greeting + best step, numbers strip, Do-this-next, Create tiles + describe box, Setup/This week restyled as tiles (anchors kept), packs rail contract (hidden), tour check. | `frontend/pages/GravityHome.tsx` (split into `components/home/*`), `components/SetupCard.tsx`, `components/ThisWeekCard.tsx`, `frontend/utils/tour.ts` if needed, `tests/tourWording.test.mjs` source list | the screen the owner called boring is finished, all variants and edge cases render at 375 and 1280, tour still works | visual states pass; no money path |
| 4 | Planner additions: products/city/typed facts as input, `offline` and `metrics` blocks, fixed lists, prompt rules, QA scan, token cap, tests, backfill dry-run script option. | `backend/services/plan/profileInput.js`, `services/blueprint/input.js`, `discovery.js`, `planner.js`, `pipeline.js`, `config/blueprint.js`, `services/promptRegistry.blueprint.js`, `backend/tests/plan*`, `blueprintPlanner*` | the model can supply the missing levels without breaking QA; old output still valid; one real run reads well | model-call path: strongest-model review + ONE real run on `nebulaa_dev` with the owner's OK (about USD 0.18) |
| 5 | Strategy funnel on My plan: `levelsOf`, `StrategyFunnel`, mobile/desktop, states, products from catalogue, links to This week and Create, real-shaped fixtures (full, old, empty), optional tour step. | `frontend/utils/plan.ts`, `frontend/components/StrategyFunnel.tsx`, `frontend/pages/MyPlan.tsx`, mocks, `tests/plan.test.mjs` | the owner's missing top-down view exists and works on every existing stored plan | look at it with a REAL plan (handover 8 lesson); may ship before or after Task 4 (blocks marked "added at next refresh") |
| 6 | Competitor and trending read model: `GET /api/competitors/best-posts`, per-competitor tiles, "What's working", "Trending for your business" (honest sources), festival table (if approved), Home block + Competitors page tiles, locked/empty states. | `backend/routes/competitorInsights.js` (or new route), `services/competitors/*` read helper, `frontend/components/CompetitorTiles.tsx`, `pages/Competitors.tsx`, `utils/competitorInsights.ts`, mocks | data the tracker already stores becomes visible; no model call, no scraping | real-database read check; tracker stays OFF until the owner switches it on |
| 7 | Decency pipeline and the draft endpoints ("Make a post in response", "Draft a witty comment"), new cost actions, caps and ledger, counters + registry, retire the old rival route and button, switch `ENABLE_COMPETITOR_DRAFTS`. | `backend/config/apiCosts.js`, `services/spendGuard.js`, `services/listening/helpers.js` (export `isDecentText`), `config/listening.js` or new `config/decency.js`, `backend/routes/competitorDrafts.js` (new), `models/*Counter`, `services/dataRegistry.js`, `routes/dashboard.js` (410), `frontend/pages/Competitors.tsx`, `components/RivalDraft.tsx` | nothing indecent is produced or charged wrongly, nothing is ever posted on other pages, old money leak closed | money + model path: strongest-model review, real-database check of charge/refund and caps, owner OK for any real model call, Tamil/Hindi decency proof |
| 8 | Home wiring and polish: Trends/competitors block, Ideas for you, packs/templates rail (placeholder behaviour), analytics events, final visual pass at 375 and 1280 for every variant, audits (brand, voice, wording, layer lists), release notes and owner checklist. | `frontend/components/home/*`, `frontend/utils/home.ts`, `docs/superpowers/ops/` checklist, ledger status update | the whole area is complete per rule 2; ledger items marked done or parked with a reason | final review pass; ledger update |

Dependencies: 1 -> 3, 5; 2 -> 3, 8; 4 independent of 3 and 5 (5 can ship first); 6 -> 8; 7 -> 8 (the Home block calls it); 8 last.

### Open owner decisions (recommended default for each)

1. Offline channels in the plan: add a fixed list of six (word of mouth and referrals, local events and stalls, hoardings and print, shop or counter display, nearby partnerships, phone and WhatsApp follow-up), tagged Suggested, no "Nebulaa does" actions. Default: yes.
2. Existing plans: no bulk regeneration; they update at the monthly pass or the customer's refresh; a throttled owner-run backfill only for managed clients. Default: as stated.
3. "Marketing mix" meaning: organic vs paid per channel + online vs offline + format mix, all derived in code, no new percentages from the model. Default: yes.
4. Metrics list: reach, engagement, followers, posts published, enquiries, reviews, website visits; live numbers only for the first four. Default: yes.
5. Response post: text only in v1 with a hand-off to Create for a picture (the old image flow cost 29 Quarks). Default: text only.
6. Charging for drafts: priced from `apiCosts` (derived), refunded when blocked or failed, with daily caps; or free within a cap. Default: derived and refunded.
7. Retire the old "Create Rival Post" button and route now. Default: yes (it contradicts the decency rules and has the money defects in 3.7).
8. Rivalry tone: allowed as a light, nameless style (recommended by the design draft). Default: yes; comments never name the competitor.
9. Packs rail before the Photoshoot studio: hide until it exists (templates still shown). Default: hide.
10. A small owner-approved India festival table for Ideas/Trending (names, dates). Default: needed before festival cards; until then pillars and hooks only.
11. Home numbers when the snapshot job is off or no socials: show a Connect tile instead of zeros. Default: yes.
12. "Download my plan as PDF" on My plan: park (not requested in the ledger). Default: park.
13. Plan and Home copy language: English only now, copy kept in one constants file for later Tamil/Hindi; drafts follow the customer's content language. Default: yes.
14. "inbox replies" in the plan for accounts without the Inbox add-on: keep the sentence, show an "Add-on" chip. Default: yes.
15. Whether Home keeps the rotated artwork stack as a decorative hero (own posts only, no stock photos) or drops it for tiles. Default: keep with own posts when they exist, art tile otherwise.

---

## 9. What was NOT verified (UNKNOWN, check in Task 2 or 5)

- Size of `GET /api/plan` (includes `result.pages`) and whether anything besides MyPlan reads `result.pages`.
- Which Campaign date field counts as "planned for this week" for a post that came from a draft.
- Whether `GuidedTour.tsx` scrolls a target into view on a phone when This week moves lower on Home.
- How `FeatureEvent` is written and read today.
- Whether the free Blueprint result should feed a funnel for free accounts.
- Real behaviour of the Inbox (never live-tested) and of the competitor tracker in production (OFF).
- Whether the money defect in the old rival-post route behaves as read (to be proven by a test at the start of Task 7).
