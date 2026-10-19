# Owner requests ledger (the single list of everything the owner has asked for)

Created 2026-10-18 after the owner said: "You are forgetting so many things. Please keep a note of things I say, and do them as and when we get the chance." Every request goes here the moment it is made. Older requests are summarised from the handovers (5 to 14), the specs and the conversation; where a detail was lost it points to the document that holds it.

## How this ledger is used (rules, agreed with the owner)
1. **Add first, build later.** Anything the owner says is written here the same turn, in his words where possible, under its area, with a date and a status (NOT STARTED, PARTLY, DONE, DECISION NEEDED, PARKED BY OWNER).
2. **Area-complete rule.** When we start work in an area (Home, Videos, Competitors, Inbox, Calendar, Plan, Create, Performance, Brand, Billing, Landing, Staff, Ops), we first read that area's section here and BUILD EVERYTHING listed for it that can be built now, together, not just the item that triggered the work. Leaving a known item out needs a stated reason in the ledger.
3. **Impact map before building an area.** For each area write down (in `docs/superpowers/impact-maps/<area>.md`): what depends on it, what it changes elsewhere (side effects), money and entitlement effects, data and migration effects, edge cases (empty, new, free, managed, agency client, staff, phone, other languages, failures), tests needed. The build plan for the area is checked against that map.
4. **Visual standard.** Every screen touched is made visually appealing (tiles, small art, colour) following the design draft `docs/superpowers/specs/2026-10-18-visual-refresh-and-photoshoot-design.md`, within the speed budget.
5. **Read this file at the start of every session** (handovers point here) and update the status at the end.

## Area: HOME / DASHBOARD
- [PARTLY: control-room layout DONE, NOT RELEASED (2026-10-19, Home build Task 3): compact cream page with the gold glow, colour-coded number tiles, one deep-ink "Do this next" panel, compact create tiles; trends, packs and ideas follow in Tasks 6 to 8] Dashboard is "very boring": make it colourful and appealing (references: Scalio home, Higgsfield, Pollo; light theme with gold glow, a few dark accent panels). (2026-10-18)
- [PARTLY: Home create tiles use the small art tiles, numbers have small icon marks (2026-10-19); a Review queue picture tile is not on Home, the drafts number and Do this next row link there] Show tiles with small SVG art or tiny photos instead of plain buttons (for example "Review queue" as a tile with a picture). Must not slow the app. (2026-10-18)
- [PARTLY: data layer and layout DONE, NOT RELEASED (2026-10-19): numbers strip, Do this next, create tiles and the describe box (Post and Video; it hands the idea to Create or Videos), Today's plan, competitors line, balance, plan banner; trends and competitor posts DONE, NOT RELEASED (2026-10-19, Task 6: "Your competitors" tiles, What's working, Trending for you); packs (hidden until Photoshoot exists) and ideas (Task 8) still to do] Home shows: important numbers, "Do this next" actionables, ready-made photoshoot packs and templates, trends and competitor posts, ideas for you, a big "describe what you want" box. (2026-10-18)
- [DONE, NOT RELEASED] Home data layer (2026-10-19, Home build Task 2): `GET /api/home/summary` (reach, engagement, followers, posts published this week, drafts waiting, unread messages, each with a reason instead of an invented number; "Do this next" rows; this week; plan status; balance; account kind; 60 s cache), Monday-start India week helper on server and page, one shared draft-status rule (Home and Approve), Indian number formatting (`formatCount`), real-time sort of Today's plan, the unbounded drafts and campaigns downloads and the stock-photo fallback removed from Home, real-shaped preview mocks (`?homestate=`, `?weekstate=`, `?setupstate=`, `?planstate=`). Checked against `nebulaa_dev` (42 of 42). How it works: `docs/superpowers/ops/home-summary.md`. Still to do for Home: the control-room layout (numbers strip, Do this next, create tiles and describe box, Setup and This week as tiles), which reads this endpoint. Optional: two campaign indexes for large accounts (`create-home-indexes.js`).
- [PARTLY] Competitor rival posts on the home (old unsafe flow removed 2026-10-18; the new safe, gated one is not built yet, it is Home build Task 7): pick a competitor post and tell the AI to write a rival post or a witty comment draft; decent only (no offence, no derogatory, racist or obscene content); the customer posts the comment themselves, Nebulaa never posts on other people's pages. (2026-10-18)
- [PARTLY: Setup and This week restyled as compact cards with tour anchors kept (2026-10-19); Ideas card not built yet, Task 8] Setup, This week and Ideas cards restyled as tiles. (2026-10-18)

## Area: MY PLAN / STRATEGY (top-down view)
- [NOT STARTED, owner angry it is missing] A visual TOP-DOWN / funnel view of the strategy: company, products and services, customers and the ideal customer (ICP), positioning and message, marketing mix, channels (online and offline, organic and paid, who does what), then content, then the 30/60/90-day plan and the numbers to watch. Today My plan exists (released) but only as text sections ("Your business today", "Your customer", "Where to show up", roadmap, "This month's mix", "What to do first"); it has no visual funnel, no offline channels and no marketing-mix view. (originally in handover 8, restated 2026-10-18)
- [NOT STARTED] My plan sections as tiles with art and a status line. (2026-10-18)
- [DECISION NEEDED] Whether to add offline channels (hoardings, local events, WhatsApp, referrals) to the plan model and prompts (a planner change).

## Area: CREATE CONTENT
- [DONE, NOT RELEASED] Tiles with a picture for Single post, Campaign, Carousel and LinkedIn so people understand at a glance (one-line description and the price under each; rows on a phone). (2026-10-18) Also fixed: the LinkedIn price now reads the action the server really charges for a LinkedIn post.
- [DONE, NOT RELEASED] "Video" entry tile on Create content: opens the Videos page and shows its price (the Photoshoot tile waits for its page). (2026-10-18)
- [IN PROGRESS, 2026-10-19] Owner: the new Create content screen is "so ugly", too big and blocky (big picture tiles, big blocks of text); the older one looked better. Redo: small quiet tiles in one even row (single post, campaign, carousel, LinkedIn, video) with a small price line, form back above the fold, less blocky everywhere on the screen. Also REMOVE the "Theme or festival (optional)" field for now.
- [DONE IN CODE, NOT RELEASED, 2026-10-19] Owner on the redone Create tiles: fill each tile (Single post, Campaign, Carousel, LinkedIn, Video) with a FULL image and put the title and text over it with a nice effect, like YouTube thumbnails, movie posters and title cards; make it appealing, not boring ("it's a marketing tool"). Keep the wide, short card shape (not vertical; vertical cards take too much space, they suit the plan page only). The picture should still explain at a glance what the option is. Built as cover tiles (`components/CoverTile.tsx`): the existing art filling each card on its own colour grade, white poster title over a dark scrim, price chip, gold selected ring; contrast computed in `tests/coverTile.test.mjs`. Guidance in `docs/superpowers/ops/tile-system.md`.
- [NOT STARTED, Photoshoot page does not exist yet, so no Create content tile yet] Photoshoot option in Images and on Home: ready-made packs (product photoshoot, model photoshoot, marketplace pack, festival pack): states how many photos, which styles, how long and what it costs. Uses the products and environment photos already uploaded. (2026-10-18)
- [NOT STARTED] Templates and ready-made packs available from the dashboard (remaining for Create content together with Photoshoot). (2026-10-18)

## Area: VIDEOS
- [DONE, NOT RELEASED] 22-style photo grid on the new Videos screen (the owner saw only 4 old styles because production is on the old build). Release fixes it. (diagnosis 2026-10-18)
- [DECISION NEEDED] Bring Hero Studio's richer style rules (4 group rule sets) into the new Videos styles, one style at a time, and add Hero Studio to the menu. (2026-10-18)
- [DONE, NOT PROVEN WITH REAL AUDIO] Subtitles timed from the real audio (Whisper); needs ONE real proof (about one cent) then a real 30 s Tamil test (about USD 3) with the owner's OK. (handover 14)
- [NOT STARTED] Telugu, Kannada, Malayalam speech and captions never seen; a real 3-clip fade join never seen. (handover 14)
- [NOT STARTED] Video styles shown as visual tiles everywhere videos are chosen. (2026-10-18)

## Area: CALENDAR
- [BUG, FIXED IN CODE, NOT RELEASED] Month cover image not loading (prompt `calendar.cover` was missing; restored). Failed months need a retry. (diagnosis 2026-10-18)
- [DECISION NEEDED] Retry old failed covers automatically (one per day) and treat a stuck "pending" as retryable; add an image error fallback on the banner; stay free to the customer? (2026-10-18)
- [NOT STARTED] Calendar month hero and "plan inputs" card like Scalio's ("<Business>'s October posts, in one tap"). (2026-10-18)

## Area: COMPETITORS / TRENDS
- [DONE, NOT RELEASED (2026-10-19, Home build Task 6)] Competitors page shows more than names: handle, followers, posts this week, their recent posts, what worked well. (2026-10-18) A compact tile per tracked competitor: @handle, followers with the week-on-week change, posts this week ("at least N" when the read is cut short), best post of the week or month with a link to it, a "what worked" line computed in code (for example "Reels got 3 times the likes of photos on average this month", only with at least 6 posts), a status chip in words (Tracking, Last checked, Confirm handle, Needs a handle, First check pending, Could not read, Private account, Paused), Confirm or Edit handle on the tile. Stored snapshots only (the snapshot now keeps the 12 compact posts the weekly read already returns; older snapshots show their stored best post). Shows real data only once the owner switches the weekly tracker on (`ENABLE_COMPETITOR_TRACKER`). How it works: `docs/superpowers/ops/competitors-home.md`.
- [DONE, NOT RELEASED] Competitors in the sidebar menu for paid plans. (2026-10-18)
- [DONE, NOT RELEASED] Old unsafe Create Rival Post retired (route returns a plain message, button removed); safe replacement is Home build Task 7. (2026-10-18)
- [DONE, NOT RELEASED (2026-10-19, Home build Task 6)] "What's working for your competitors" and "Trending for your business" (honest sources only: competitor best posts, your own best posts, your plan and festivals; no scraping of social platforms). "Make a post like this". (2026-10-18) On Home and the Competitors page; each Trending idea says its source (From a competitor, From your own posts, Coming up, From your plan) and its reason; "Make a post like this" opens Create or Videos with a short brief written by code that never contains a competitor's name, handle or caption. Festivals: only fixed-date days (New Year, Republic Day, Valentine's Day, Independence Day, Teachers' Day, Children's Day, Christmas) and Mother's and Father's Day; DECISION NEEDED: owner-approved dates for Diwali, Holi, Eid, Ganesh Chaturthi and other lunar-calendar festivals before they can appear.
- [NOT STARTED] Use the competitor insight to improve the plan day by day. (2026-10-18)

## Area: INBOX / REVIEWS / AUTOMATIC REPLIES
- [NOT STARTED] Inbox has NEVER been tested live: does it receive Instagram/Facebook comments and messages, does it reply automatically; test sheet `docs/superpowers/ops/inbox-live-test.md`; Ayrshare Messaging add-on was inactive. (2026-10-18)
- [NOT STARTED] Tiles with art for Messages and comments, Google reviews, Automatic replies; a sales-style explainer for automatic replies; status chips (Connected, Needs setup, Add-on). (2026-10-18)

## Area: PERFORMANCE
- [NOT STARTED] Make reach, engagement and new followers beautiful: KPI tiles with sparklines and up/down chips, best post of the month. (2026-10-18)

## Area: BRAND (assets, Growth Blueprint, Memory)
- [NOT STARTED] Brand assets, Brand Growth Blueprint and Memory as tiles with art and status. (2026-10-18)
- [DONE, NOT RELEASED] Brand colours read from the logo automatically with a palette picker. (2026-10-07)
- [NOT STARTED] Redo the business-profile questionnaire: geographic reach only has hyperlocal, local city, regional (add State, All India, International, several allowed); target gender is a poor fit (optional, hidden for B2B); no B2B branch; content-language type out of date; brand voice and goals differ between onboarding and Settings; industry list retail-heavy. (audit 2026-10-07)

## Area: PLANS, BILLING, QUARKS
- [DONE, NOT RELEASED] Plans page reworked (light theme, order Starter, Growth, Agency, no banner above plans). (2026-10-18)
- [NOT STARTED] Quarks still show on the header chip, in the shared upgrade prompt and in some backend messages; owner's rule: customers see posts and videos (the recent commit shows Quarks with the posts-and-videos equivalent beside them): reconcile the rule and sweep. (2026-10-18)
- [DECISION NEEDED] Agency: upgrade path from Starter/Growth, single-slot cancel, move new Agency sign-ups to Rs 9,999 near 30 Ayrshare profiles. (handover 6 to 10)
- [PARKED BY OWNER] Razorpay live webhook, live purchase test, lawyer and accountant reviews.

## Area: LANDING PAGE AND WEBSITE
- [DONE, PARTLY] Landing page workflow rework exists (handover 13); hold the inbox step and FAQ until the Inbox live test passes. (2026-10-18)
- [NOT STARTED] Make landing page and website "sexy" like Higgsfield and Pollo: proof-first galleries of real results, "What you can make", "Built for" cards, glow bands, FAQ, wordmark footer, phone mock. Same copy for the separate website (`docs/superpowers/ops/website-copy-workflow.md`). (2026-10-18)

## Area: SIGN-UP, ACCOUNTS
- [DONE, NOT RELEASED] Sign-up question "one business or several brands?" and the demo agency. (2026-10-18)
- [NOT BUILT, DECISION] Team seats (several people on one business) do not exist; owner asked how "individual / agency / team" works. (2026-10-18)

## Area: STAFF AREA, OPS, RELEASE
- [DONE, NOT RELEASED] Staff pages speed fix; the owner must run the index script after the next release. (2026-10-18)
- [OWNER STEPS] Release (everything since `bc514a9` is unreleased); staff indexes; Inbox live test; Razorpay live webhook; switches (`ENABLE_COMPETITOR_TRACKER`, `LISTENING_MODEL`, `ENABLE_LISTENING`); close terminals holding keys; AWS root keys to a limited user; ECR lifecycle policy.

## Cross-cutting
- [PARTLY] Tile system and illustration set with a size budget (design draft). Foundation DONE, NOT RELEASED (2026-10-18): Tile, TileGrid and DarkPanel, signature glow tokens, 22 inline SVG illustrations, art budget script and test, developer showcase page; how to use it: `docs/superpowers/ops/tile-system.md`. Remaining: roll the tiles out to the other areas (each area's own item), photo tiles, templates.
- [RULE] Customer wording: no vendor names, raw errors, "Gravity/Pulsar/Orbit", no "credit"/"trial"/"7 days"; plain professional sentences.
- [RULE] No paid generation or provider call without the owner's OK for that run; real runs only on dev databases.
