# Demo brand "Zaya Naturals" (development only)

A fictional direct-to-consumer ayurveda-inspired skincare brand with a complete account, made for the demo video. Plan and full data inventory: `demo-brand-plan.md`. This page is about what Stage 1 built and how to use it.

## What exists after `create` (Stage 1)
- The account `demo-zaya@example.test`: verified, onboarding and tour done, current Terms and Privacy consent, Growth plan with the Publish, Competitors and Inbox bundle, Quark wallet (healthy, not full) with a ledger that adds up, and a payment history of 6 plan payments, 5 bundle payments and 1 top-up (Settings > Billing).
- Business profile in the new questionnaire shape (sells to consumers, reach State and All India, beauty and wellness, English with Tamil mix, one business).
- Brand assets: logo, colours (plum #3B1F3A, rose gold #C98B7B, cream #FBF3EA, sage #8AA17D), fonts, a founder and two models, two places. Eight products with two or three pictures each.
- Connected accounts (fake): Instagram @zaya.naturals (about 34k), a Facebook page, a YouTube channel, a LinkedIn page. The profile key starts with `demo-`, so the app never calls the social provider for this account (see D112).
- Every picture is drawn on this computer (node-canvas and sharp) into `backend/demo-assets/zaya/` (git-ignored, in `.dockerignore`, nothing under `frontend/public`). The dev backend serves them at `/demo-assets/...` only when `NODE_ENV` is not production.
- Not yet (later stages): plan, Blueprint, brand memory, calendar, posts, performance, competitors, inbox, photoshoot, videos, reviews. Those screens are empty for now.

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

