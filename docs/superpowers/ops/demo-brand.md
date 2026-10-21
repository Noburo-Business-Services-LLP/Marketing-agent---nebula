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
