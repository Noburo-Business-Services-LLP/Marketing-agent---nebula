# Demo brand "Zaya Naturals" (development only)

A fictional direct-to-consumer ayurveda-inspired skincare brand with a complete account, made for the demo video. Plan and full data inventory: `demo-brand-plan.md`. This page is about what Stage 1 built and how to use it.

## What exists after `create` (Stage 1)
- The account `demo-zaya@example.test`: verified, onboarding and tour done, current Terms and Privacy consent, Growth plan with the Publish, Competitors and Inbox bundle, Quark wallet (healthy, not full) with a ledger that adds up, and a payment history of 6 plan payments, 5 bundle payments and 1 top-up (Settings > Billing).
- Business profile in the new questionnaire shape (sells to consumers, reach State and All India, beauty and wellness, English with Tamil mix, one business).
- Brand assets: logo, colours (plum #3B1F3A, rose gold #C98B7B, cream #FBF3EA, sage #8AA17D), fonts, a founder and two models, two places. Eight products with two or three pictures each.
- Connected accounts (fake): Instagram @zaya.naturals (about 34k), a Facebook page, a YouTube channel, a LinkedIn page. The profile key starts with `demo-`, so the app never calls the social provider for this account (see D112).
- Every picture is drawn on this computer (node-canvas and sharp) into `backend/demo-assets/zaya/` (git-ignored, in `.dockerignore`, nothing under `frontend/public`). The dev backend serves them at `/demo-assets/...` only when `NODE_ENV` is not production.
- Stages 2 and 3 (below) add the plan, posts, results, memory, competitors, Inbox, Photoshoot and Videos.

## Commands (from the `backend` folder, `nvm use 20`)

    node scripts/seed-demo-brand.js create --password-file /absolute/path/outside/the/repo/demo-zaya-login.txt
    node scripts/seed-demo-brand.js status
    node scripts/seed-demo-brand.js remove
    node scripts/demo-brand-login-check.js --password-file /absolute/path/outside/the/repo/demo-zaya-login.txt

- `create` is idempotent (a second run adds only what is missing). The password is generated (at least 12 characters, letters and digits), written ONLY to the `--password-file` (mode 0600, outside the repo) BEFORE the account is made, and never printed or logged. An existing account keeps its password.
- `remove` deletes exactly what `create` made (every row carries a marker: the Quark ledger `ref`, the BrandAsset `cloudinaryPublicId`, the picture links of products), anything the app made for the account while the demo was used, the account and the picture folder, then checks that nothing is left.
- `status` prints counts per collection and the number of picture files.
- Every mode refuses any database except `nebulaa_dev` (checked from the address before connecting, and again after). No payment, email, AI, image-service or social call is made.
- `demo-brand-login-check.js` signs in through the real login route with an in-process server on a random 127.0.0.1 port and reads `/api/auth/me`, `/api/credits`, `/api/home/summary`, `/api/social/status`.

## Sign in on the dev app
1. Start the backend on port 5000 (dev database) and the dev frontend on port 3200 (`cd frontend && npx vite --port 3200 --strictPort`). The app on port 3000 is an OLD build; do not use it.
2. Open http://localhost:3200, sign in with `demo-zaya@example.test` and the password in your password file.
3. A backend that was already running before the first `create` needs one restart to serve `/demo-assets` (the route is mounted at start).

## Rename the brand
Change `BRAND` in `backend/scripts/demo-brand/constants.js` (and the email and key in `safety.js`), then `remove` and `create`.

## Stage 2 (content): plan, Blueprint, memory, calendar, posts, results (2026-10-21)
`create` now also builds, in this order (modules in `backend/scripts/demo-brand/`):
1. `plan.js`: My plan (a completed Blueprint of kind plan, 5 pillars, 30-day calendar, 3 customer segments, 4 online channels with who does what, 3 offline rows (pop-ups, salon partnerships, referrals), 5 numbers to watch, 3 roadmap phases, mix) and a finished free Blueprint with its designed edition (11 page pictures drawn locally, no PDF). Built through the app's own `assembleBlueprint`.
2. `content.js` and `contentBank.js`: 5 monthly calendars (last four months done, current month in progress, each with a local cover), 90 posts and 65 campaigns (scheduled and posted). Library counts: needs approval 8, drafts 4, approved 4, scheduled 10, posted 55, archived 6, bin 3. A poster per post (product, headline, brand colours, 4:5) under `/demo-assets/zaya/posts/`. Captions in English with Tamil touches, hashtags, platforms, `campaignId` links, fake provider ids `demo-zaya-post-<n>`.
3. `performance.js`: 97 measured post rows (`ai_content_performance`, figures in the publishing service's shape, `metrics` computed by `metricsFromRaw`) and 181 daily snapshots for Instagram (34,280 followers), Facebook, YouTube and LinkedIn, ending on the stored numbers. Story: followers about +7 percent a month, reels about 2.5 times image posts, Fridays, Sundays and evenings best.
4. `memory.js`: runs the app's own brand memory runner (no model call). Six sources: plan, Blueprint, customers, products and results learn; competitors honestly says "not enough yet" until Stage 3 seeds competitors.

Every run of `create` deletes and rebuilds these Stage 2 rows (D115) so dates are counted back from today; the account, password, payments, products and pictures are kept. `status` prints a count for each collection; `remove` deletes all of it plus the picture folder. Check the screens' data with `node scripts/demo-brand-login-check.js --password-file <file>` (Library counts and every view, Performance for week, month and 90 days, My plan, Blueprint, calendar, What Nebulaa learned, Home).

## Stage 3 (conversations and media): competitors, Inbox, Photoshoot, Videos (2026-10-21)
`create` now also builds (modules in `backend/scripts/demo-brand/`, pictures in `images3.js`):
1. `competitors.js`: five fictional brands (Kaya Veda, Pure Petal Co, Ritu Organics, Glow Ghar, Amla and Ash), each with 12 weekly readings (60 `CompetitorSnapshot` rows) whose newest one is this India week, a locally drawn profile picture and six post pictures. The readings are the app's own `summarise()` of invented scraper-shaped posts. Story: reels get about 2.2 times the likes of other posts (what the "What worked" line says), Glow Ghar is big and slow, Amla and Ash small and fast. Home's competitor tiles, the Competitors page and "What Nebulaa learned" (competitors source, 3 items) read them.
2. `inbox.js`: 25 conversations (17 Instagram, 6 Facebook, 2 YouTube; WhatsApp is not in the Inbox model and Google reviews are read live, so that panel says "not connected" for a demo account): 7 unread (Home: "Reply to 7 messages"), 5 read, 11 replied, 2 closed; 3 drafts waiting for approval (a shade question, a complaint, a Hinglish bulk-pricing query), 4 sent after approval, Tamil and Hindi mixes; settings are "approval before sending" with comments suggest-only.
3. `photoshoot.js`: 3 finished photoshoots (product shoot in the studio, flat lay, festival pack) with 14 drawn photos in the Photoshoot page and the Library.
4. `videos.js`: 5 finished videos (four 9:16, one 16:9, 11 s each) made with `ffmpeg-static`, each with a poster, listed on the Videos page and in the Library; the reels of those products in the Library play them. Needs `node_modules/ffmpeg-static` (without it the posters are made and the videos are skipped with a message).

Like Stage 2 these rows are rebuilt on every `create` (the demo user's own rows of those collections), so dates are counted back from today. The check script (`node scripts/demo-brand-login-check.js --password-file <file>`) now also reads `/api/competitors/best-posts` and `/insights`, the Inbox summary, conversations (each status), pending drafts, a thread, settings and reviews, `/api/photoshoot/jobs` and `/library`, `/api/videos`, and fetches a video (200 and a 206 range answer, as a player sends), its poster and two competitor pictures.

Notes for the recording
- The competitor picture exception (D120) is on in every non-production run; the post pictures need no `ENABLE_COMPETITOR_THUMBS` for the demo's local files.
- "posted N times this week, down from M" on the competitor highlights is the app's own wording for a part-finished week; it reads best late in the week.
- The Quark ledger (Stage 1) shows more past photoshoot and video spending than the 3 photoshoots and 5 videos that are listed.
- Verified through the real routes and files; not looked at in a browser by the seed's author (see the final report).


## Stage 4 (walkthrough fixes and the demo script) (2026-10-21)
Every screen was walked in the browser; the data fixes are in `demo-brand/extras.js` (saved ideas, bell notifications, business context) and small changes to `content.js`, `performance.js`, `competitors.js`, `videos.js`, `images*.js`, `inbox.js`, `constants.js`. Findings per screen and the UI issues for the ledger: `demo-walkthrough-findings.md`. The recording script and the reset recipe: `demo-script.md`.
- Four reel-only tall clips (`videos/reel-<product>.mp4`) are made next to the five studio videos so every reel in the Library plays and no reel uses the wide video. They are not rows on the Videos page.
- Notifications are only listed by the app for 24 hours, so run `create` on the recording day. `create` on an existing account rebuilds all dated rows and refreshes the social counts; the browser may keep old pictures, so hard refresh.
- The video and poster files are kept between runs; delete `backend/demo-assets/zaya/videos` (or run `remove`) to redraw them.

## Real pictures (optional, USD 1.10 once)
`docs/superpowers/ops/demo-photos.md`: 24 real photos made with your own OpenAI key replace the drawn ones (same file names). `create` keeps them and `status` shows how many slots are real.
