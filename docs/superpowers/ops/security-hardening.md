# Security hardening, backend part (2026-10-20)

Scope: ledger item SECURITY HARDENING (queued 2026-10-20), from the tester's notes (`Downloads/1.txt`: rate limiting,
denial of service, XSS). The frontend part (safeHref, DOMPurify, escape-on-output tests) is in
`security-hardening-frontend.md`. Decisions D39 to D46 in `DECISIONS-LOG-2026-10-20.md`. Real-database check:
`backend/scripts/security-check.js` (nebulaa_dev only, 7 PASS).

Nothing here is released yet. Every number below is a default that an environment variable can change without a
code change.

## 1. Shared per-user limiters (`backend/middleware/limits.js`)

Counted per SIGNED-IN USER (the id in the Bearer token, signature checked, no database read); a request without a
valid token is counted per address. Made through `services/rateLimitStore.js`, so with `RATE_LIMIT_STORE=mongo` every
task counts in the same bucket. One instance of each: a route file and `server-main.js` share the counters.

| Limiter | Default | Env (max / window in ms) | Used for |
|---|---|---|---|
| heavyAi | 30 per 15 min | `LIMIT_HEAVY_AI_MAX` / `LIMIT_HEAVY_AI_WINDOW_MS` | image, video, post, carousel and calendar generation |
| lightAi | 100 per 15 min | `LIMIT_LIGHT_AI_MAX` / `LIMIT_LIGHT_AI_WINDOW_MS` | suggestions, summaries, checks, apply logo, CSV/manual analytics |
| upload | 20 per 15 min | `LIMIT_UPLOAD_MAX` / `LIMIT_UPLOAD_WINDOW_MS` | file and picture uploads |
| spend | 10 per 15 min | `LIMIT_SPEND_MAX` / `LIMIT_SPEND_WINDOW_MS` | actions that spend Meta ad money |
| scrape | 20 per hour | `LIMIT_SCRAPE_MAX` / `LIMIT_SCRAPE_WINDOW_MS` | paid scraping and handle lookups |
| webhook | 300 per minute per address | `LIMIT_WEBHOOK_MAX` / `LIMIT_WEBHOOK_WINDOW_MS` | provider webhooks (no user token) |
| cspReport | 60 per minute per address | `LIMIT_CSP_REPORT_MAX` / `LIMIT_CSP_REPORT_WINDOW_MS` | browser CSP reports |

Routes covered (route-local, in the route file, after `protect`; mount paths checked in `server-main.js`):
59 limiter placements in 15 route files: heavyAi 23, lightAi 15, upload 8, spend 4, scrape 6, webhook 3.

- dashboard (`/api/dashboard`): GET campaign-suggestions, campaign-suggestions-stream, strategic-advisor, content-strategy (lightAi); POST synopsis (lightAi); refresh-competitor-posts (scrape); generate-rival-post, strategic-advisor/generate-post, strategic-advisor/refine-image, generate-event-post (heavyAi).
- drafts (`/api/drafts`): :id/regenerate, generate-linkedin-post, generate-image-bg, :id/retry-image, :id/edit-image (heavyAi); :id/apply-logo (lightAi); upload-media (upload).
- content (`/api/content`): regenerate-image, generate, modify, localize-campaign, image-audio-to-video (heavyAi); download-video POST and GET, :draftId/compliance-check (lightAi).
- contentCalendar (`/api/content-calendar`): prepare, generate-next, regenerate, cover, items/:itemId/auto-generate, :id/auto-generate-week (heavyAi).
- createAssist (`/api/create-assist`): suggest-details (lightAi). read-files and transcribe keep their own per-account limits (20 and 40 an hour, per task); not double-limited.
- carousels (`/api/carousels`): generate-stream (heavyAi).
- competitors (`/api/competitors`): auto-discover, add-manual (a paid handle lookup), scrape-by-type (scrape).
- products (`/api/products`): upload-image, bulk-import (upload); :id/generate-ad-image (heavyAi).
- brandAssets (`/api/brand-assets`): upload, intelligence-profile/past-posts, frames (upload); intelligence-profile/analyze (heavyAi); intelligence-profile/colors, colors-from-logo (lightAi); refresh (scrape).
- ads (`/api/ads`): boost, PUT :adId (spend). adCampaigns (`/api/ad-campaigns`): POST /, :id/retry (spend); PUT :id/status (lightAi, so pausing is never blocked by the spend bucket). DELETE stays on the general limiter.
- analytics (`/api/analytics`): import/csv (upload), import/manual, :id/regenerate-insights (lightAi). brand (`/api/brand`): quick-analyze (scrape). ideas (`/api/ideas`): POST / with a picture (upload, only when a picture is sent).
- socialInboxRoutes (`/api/social/inbox`): GET and POST webhooks/:platform, POST webhooks/comments/:platform (webhook).

Not double-limited (they already had a specific limiter): Videos (`/api/videos`, studioVideos: own per-account limits
plus 2 videos at once), video-generation, hero-video, photoshoot, week, blueprint, plan, home, listening, competitor
insights/handle/best-posts, account, agency, payment, support, draft localize, chat/campaigns/seo (AI limiter at the
mount). Note: the studioVideos and createAssist limits are per task (in memory); with several web tasks they multiply
by the number of tasks. Moving them onto `limits.js` is a small follow-up if wanted (numbers would change).

Guard: `tests/paidRouteLimits.test.js` scans every route file (`tests/helpers/routeLimitScan.js`) for write handlers
that call a paid service (credits, model calls, generation, scrapers, publishing, ad spend, storage uploads) and
fails when neither a route-local, router-level nor mount limiter covers them; 5 reviewed exceptions (studioVideos,
with the reason). Today: 75 paid write handlers found, 70 covered by a limiter, 5 by the reviewed exception.

## 2. Mount order, staff-only triggers, developer routes

- `/api/social/inbox` is mounted before `/api/social`, so it escaped the social limiter. It now gets the social
  limiter at its own mount (`L.exceptInboxWebhooks(limits.social)`); the provider webhooks are excepted (their own
  per-address limiter). 19 inbox user routes covered.
- `POST /api/notifications/process`, `/check-now` and both `/test` handlers: staff only (new staff action `run_jobs`,
  owner and admin). Customers keep their campaign reminders from the scheduler (every minute); the list, unread count
  and mark-as-read routes are unchanged. FRONTEND FOLLOW-UP: the bell (`components/NotificationBell.tsx`, two "Check"
  buttons) calls `/check-now`; a customer now gets "This area is for Nebulaa staff." Remove those buttons (the
  scheduler already does the check).
- `/api/social/inbox/dev/*` answers 404 in production (already; regression test `tests/inboxHonesty.test.js`).

## 3. Job caps (`backend/services/userJobCap.js`)

Per account and flow: at most `JOB_CAP_ACTIVE` running (2) plus `JOB_CAP_QUEUED` waiting (5); one more is a plain 429
before anything is charged. Counted with one indexed count on the user field of the flow's own collection (no new
collection), only rows created in the last `JOB_CAP_STALE_HOURS` (6) so a job a crash left "processing" never blocks
an account for good. A database error lets the request through (like the limiters).

| Flow | Start routes | Collection |
|---|---|---|
| video | `/api/video-generation` createVideo, generateClips, mergeVideo, renderMissing | video_jobs |
| hero | `/api/hero-video/generate` | hero_video_jobs |
| blueprint | `POST /api/blueprint` | blueprints (not the plan runs) |
| carousel | `/api/carousels/generate-stream` (no queue: 2 at once) | drafts (processing carousels) |

Kept as they were: Videos (Omni, StudioVideo: 2 processing per account), Photoshoot (one shoot in flight per
account, unique index), campaign image jobs (2 running, 5 waiting, `image_jobs`).

## 4. Denial of service

- `TRUST_PROXY_HOPS` (default 1, already there).
- Server timeouts (`services/serverTimeouts.js`): keep-alive 65 s (above the load balancer's 60 s idle timeout),
  headers 66 s, whole request `SERVER_REQUEST_TIMEOUT_MS` (300 s; never below 66 s).
- Short answer time for ordinary routes: `ROUTE_TIMEOUT_MS` (30 s; 0 switches it off): 503 "This is taking longer than
  expected" and the late answer is dropped. EXCLUDED (generation, model, scrape, upload, stream, export):
  campaigns, chat, seo, content, content-calendar, carousels, create-assist, video-generation, hero-video, videos,
  photoshoot, blueprint, plan, week, setup, drafts, dashboard, competitors, listening, brand-assets, brand, products,
  ads, ad-campaigns, social (and the inbox), analytics, ai-memory, home, google-calendar, payment, ideas, staff, csm,
  admin, the prompt builder, account/export, agency/usage.csv, auth complete-onboarding, update-profile,
  signup-brand-colors and verify-gst, influencers, collaborations, submissions, accounts (Instagram health report),
  support (sends an email). The 30 s applies to the rest (auth sign-in and session, notifications, credits, reminders,
  tour, agency clients, account, prompts).
- Body limits: 1 MB by default. 10 MB (one picture as text): content, blueprint, auth/update-profile,
  auth/complete-onboarding. 40 MB (several pictures or files as text): campaigns, carousels, create-assist, drafts,
  brand-assets, video-generation, hero-video, products, ideas, social, photoshoot/upload. LOWERED from 40 MB: ads,
  ad-campaigns, chat, brand (to 1 MB); content, blueprint, update-profile, complete-onboarding (to 10 MB).
- The 120 MB media upload (`POST /api/drafts/upload-media`) streams to a temporary file instead of a 120 MB buffer in
  memory; pictures are refused over 20 MB; a refused type is 400, an oversized file 413 (was 500).
- `maxTimeMS` (`LIST_QUERY_MAX_TIME_MS`, 5 s) on the list reads: drafts, campaigns (list and counts), notifications,
  videos, inbox conversations and waiting replies (`utils/listQueryTimeout.js`). The prompt builder clamps were
  verified (`routes/api-video-style-prompts.js`, 20 scenes, 300 s, login and the AI limiter).

### NEXT JOB (not built): signed S3 uploads for big files
Today big pictures arrive as base64 text inside JSON (40 MB limit) and videos through the API task. The change:
1. `POST /api/uploads/sign` (protect, upload limiter): body `{ kind: 'image'|'video', contentType, bytes }`; checks the
   type against the allow list and the size against the cap (images 20 MB, videos 120 MB); answers a presigned S3
   POST (`@aws-sdk/s3-presigned-post`, conditions `content-length-range` and exact `Content-Type`, key
   `uploads/<userId>/<uuid>`, expires 5 minutes).
2. The browser uploads straight to S3, then calls the existing route with `{ s3Key }` instead of the file.
3. The route checks the key belongs to the user, reads the first bytes from S3 (`Range: bytes=0-2047`) with
   `services/uploadSafety.checkUpload`, and moves on (Cloudinary fetch by URL, or keep in S3).
4. Bucket: private, CORS for the app origins only, lifecycle rule deleting `uploads/` after 1 day.
5. Then lower the 40 MB JSON group to 10 MB (or 1 MB) route by route as each moves over.
Owner: create the bucket and an IAM permission `s3:PutObject` on `uploads/*` for the task role.

## 5. Headers and uploads

- Content-Security-Policy in REPORT-ONLY mode: one list in `backend/config/csp.js`, sent by helmet on the API and the
  same header in `nginx.conf` on the app page (index.html and the SPA fallback; a test keeps them equal). Allowed:
  self; scripts from cdn.tailwindcss.com, esm.sh, checkout.razorpay.com, challenges.cloudflare.com (Turnstile) and
  inline; styles self, inline, fonts.googleapis.com; fonts fonts.gstatic.com and data; pictures self, data, blob,
  res.cloudinary.com, *.amazonaws.com, images.unsplash.com, *.cdninstagram.com, *.fbcdn.net, ui-avatars.com; media
  self, data, blob, Cloudinary, S3, soundhelix (sample tracks); connections self, Razorpay (api, lumberjack,
  checkout), esm.sh, Cloudinary, S3, Turnstile; frames Razorpay and Turnstile; object none; base and form self;
  frame-ancestors self. Reports: `POST /api/csp-report` logs the directive and the blocked origin only (each new pair
  once, a summary every 10 minutes); no page address, sample or file name is kept.
- WHAT BLOCKS ENFORCING IT: the Tailwind Play CDN (`cdn.tailwindcss.com`) builds the CSS in the browser from an inline
  config script and injects inline styles, so scripts need `'unsafe-inline'` (it does not need eval as far as we
  know: the report-only run will show it); `index.html` has other inline scripts; the esm.sh import map loads code
  from a third party. Build Tailwind at build time and drop the import map (frontend job), then replace
  `'unsafe-inline'` for scripts with hashes or nonces and switch helmet `reportOnly` to false and nginx to
  `Content-Security-Policy`. Read a week of `[csp]` log lines first and add any real host they show.
- `/generated-media` and `/audio`: `Content-Security-Policy: sandbox`, `X-Content-Type-Options: nosniff`,
  `Content-Disposition` (inline for pictures, video and audio; attachment for anything else).
- SVG and HTML refused at every upload by claimed type, name AND first bytes (`services/uploadSafety.js`): brand
  asset upload, past posts, frames, product picture, idea picture, drafts upload-media (pictures and MP4/WebM),
  create-assist read-files (PNG, JPG, WebP, PDF), and the shared Cloudinary uploader (`uploadBase64Image`,
  `uploadLogo`) as a safety net for every other caller. Photoshoot uploads already read the type from the bytes.
  products/bulk-import takes a spreadsheet, not a picture (not served back): unchanged.

## 6. Addresses and emails

`services/safeUrl.js`: http or https only, at most 2048 characters, no user name or password, no spaces or control
characters; a website may be typed without https:// where people type websites; a picture may be a base64 PNG, JPG,
WebP or GIF data URL where pictures are stored. Applied as model setters (a refused address is stored as empty):
Competitor website, logo, avatarUrl, post postUrl and imageUrl; BrandProfile websiteUrl (required, so a refused one is
never saved), competitors url, scrapedPages url; User businessProfile.website; Product imageUrl;
BrandIntelligenceProfile past-post imageUrl and assets.primaryLogoUrl; Influencer profileUrl; inbox message and
conversation permalink. The profile and onboarding routes answer 400 for a script or data link, markup or a password
in the address. NOT COVERED: post links inside stored provider answers (Campaign fields of type Mixed, written from
Ayrshare replies) and other system-written picture fields (generated images): the screens guard those with safeHref.

Emails: every HTML email uses `utils/escapeHtml.js` (sign-in code, welcome, renewal, account deletion, campaign
reminder and live, and the plain-text fallback of `services/emailService.js`, which did not escape before).

## 7. Docker and AWS (OWNER STEPS)

`docker-compose.yml` is the single-machine run (production runs the images on ECS). The ngrok service was removed from
it (it published the API around the load balancer and its limits) and the API port binds to 127.0.0.1 only. An
opt-in local tunnel is in `docker-compose.tunnel.yml` (development only).

Owner, in the AWS console (ap-south-1):
1. WAF: create a Web ACL (Regional) and associate it with the load balancer `stratschool-prod-alb`. Rules, in order:
   - Rate-based rule: 2,000 requests per 5 minutes per IP address, action Block (start with Count for one day, check
     the sampled requests, then Block).
   - AWS Managed Rules: Core rule set (AWSManagedRulesCommonRuleSet) and Known bad inputs
     (AWSManagedRulesKnownBadInputsRuleSet). In the Core set, set `SizeRestrictions_BODY` to Count (our uploads are
     larger than 8 KB) or scope it down to exclude `/api/` upload paths.
   - Default action Allow. Turn on CloudWatch metrics and sampled requests.
2. Security groups: the backend tasks' security group allows port 5000 ONLY from the load balancer's security group
   (remove any 0.0.0.0/0 rule on 5000); the frontend tasks' group allows port 80 only from the load balancer's group;
   the load balancer's group allows 80/443 from the internet. Port 5000 must not be public.
3. After the release: set `RATE_LIMIT_STORE=mongo` once two or more web tasks run (shared counts), and keep
   `TRUST_PROXY_HOPS=1` (load balancer only) unless the frontend nginx forwards API calls to the backend tasks, then 2.
   Check `/api/health/details` shows your own address.

## 8. Follow-ups (NOT in this job)

### Login token in an HttpOnly cookie, with CSRF protection (own plan needed)
Today the token sits in `localStorage` and every API call sends `Authorization: Bearer`. Any injected script can read
it. Options:
- A. HttpOnly, Secure, SameSite=Lax session cookie set by sign-in, plus a CSRF token (double-submit: a readable cookie
  `csrf` and an `X-CSRF-Token` header on every write, checked by a middleware). Server: sign-in, sign-up, OTP, change
  password and agency/CSM passes set the cookie; `protect`/`protectCached`/stream/socket read the cookie when there is
  no header; sign-out clears it. Frontend: `apiCall` sends `credentials: 'include'` and the header; nothing stores the
  token. Breaks: the SSE stream URL with `?token=` (switch to the cookie), downloads opened by URL, the agency/CSM
  "open client" flow (it swaps tokens in localStorage), any tool that calls the API with a Bearer token (keep Bearer as
  a fallback for those). CORS stays `credentials: true` with the exact origin list.
- B. Short access tokens (15 to 30 minutes) in memory plus a refresh token in an HttpOnly cookie (`/api/auth/refresh`,
  rotating, stored hashed with a family id so a reused refresh token ends the family). Less change to every call (the
  Bearer header stays), more moving parts.
Recommendation: B first (smaller change, works with the stream and the passes), A later if needed.

### Token version (DONE in this job, D46)
Session tokens carry `tv` = `User.tokenVersion`; a password change or reset raises it (User pre-save), and `protect`,
`protectCached`, the inbox stream and the socket hub refuse older tokens; change-password returns a new token (the app
stores it). Old tokens without `tv` count as 0, so nobody is signed out by the release. Not covered: agency and CSM
passes (short-lived, re-checked on every request) do not end when the agency owner or the CSM changes their own
password; a "sign out everywhere" button would be the same one-line raise.

### Others
- Build Tailwind at build time and remove the esm.sh import map (frontend job): needed before the CSP is enforced.
- Signed S3 uploads (section 4).
- `npm audit` in CI and pinned dependencies (ledger).

## 9. Error answers, id parameters, CORS, duplicate index (hardening items A3, A4, D5; D47 to D49)

**No internal text to clients.** `backend/utils/httpError.js` maps errors in one place (`fail(res, err, publicMessage)` for
handlers, the same mapping in the global handler `middleware/errorHandler.js`): bad id or failed validation 400 (field
names only), duplicate key 409, too large 413, broken JSON 400 `Invalid JSON`, anything else a plain 500. The answer
carries `success:false`, `message` and a fixed `errorCode`; never `err.message`, a stack or a path, in any environment
(the development stack is removed; the log has the real error). 101 response sites in routes and controllers were
rewritten by `backend/scripts/codemod-error-leaks.js` (re-runnable; it lists what it will not touch), about 20 more by
hand (SSE streams, `.stack`, provider texts, the internal "CRITICAL" strings in the Instagram video path, the controllers
that returned a Mongoose message as a 400 now use `fail()`). `tests/noErrorLeaks.test.js` fails on any new
`error.message`/`err.message`/`e.message`/`.stack` inside `res.json`/`res.send`/`res.write`/an SSE send. Reviewed
exceptions (each states why): the `NO_PROFILE_KEY` sentence from `ayrshareGuard` (ads, analytics), the eligibility result
in `account.js` (a result object, not an exception), the bad-cursor sentence of `listPage` (campaigns, drafts), the one
sentence we throw ourselves in the campaign stream, and the `httpError()` sentences of the social inbox service.
Left alone on purpose: values stored in the database (`lastPublishError`, `publishResult.error` in campaigns: not sent
as such, but a screen may show them; worth a look), provider answers passed on as `details` on ad boost failures.

**Id parameters.** `middleware/validateObjectId.js` `applyObjectIdParams(router, names)` (strict 24 hex, otherwise 400
`Invalid id`, before any query): 23 routers, each with only the names that are ObjectIds there. Not applied (reason in
`tests/objectIdParams.test.js`): ads (`:adId`), aiMemoryLearned, blueprint (`blueprintId`), competitorHandle,
createAssist, draftLocalize (they already answer 404/400 themselves), heroVideo and videoGeneration (`:jobId` strings),
prompts, week (item ids). **Query strings:** `middleware/queryGuard.js` (before `express-mongo-sanitize`) answers 400
`Invalid query` when a query value holds a `$` key (`?status[$ne]=x`); harmless nested values pass.

**CORS.** `middleware/corsPolicy.js`: no Origin header is allowed; an allowed origin gets its headers; any other origin
gets `403 { success:false, message:'Origin not allowed' }` on `/api` (preflight too) and no CORS headers elsewhere, never
a 500. `CORS_ALLOWED_ORIGINS` still adds origins. The plain-HTTP load-balancer origin stays in the baseline list (see
D49 for why). Local ports are allowed outside production only, as before.

**Duplicate index.** `BrandIntelligenceProfile.userId` was indexed by `unique: true` on the field and by `schema.index()`;
the second declaration is removed (same index in the database, no index added or dropped). `tests/schemaIndexes.test.js`
loads every model and fails on a duplicate index or Mongoose's duplicate-index warning.

**For later (not done here, `routes/auth.js` is edited by another change):** run
`node scripts/codemod-error-leaks.js --write routes/auth.js` after removing its entry from `SKIP` in the script; the
file has `message` built from `Object.values(error.errors).map(e => e.message)` (sign-up validation, around line 742:
use `fail()` or the generic validation sentence), a helper returning `error: error.message` (about line 150), and it
needs `applyObjectIdParams` only if it gains `:id` routes. Then take `routes/auth.js` out of `SKIPPED` in
`tests/noErrorLeaks.test.js` and `tests/objectIdParams.test.js`.

**Screens that may now show a different message** (the API client reads `data.error || data.message`): wherever a 500 used
to show the exception text it now shows the route's own words or "Something went wrong. Please try again." (analytics,
reminders, campaigns, drafts, products, content, dashboard, ads, competitors). Places that read `result.error` after
the client caught the error (poster generate and edit, refine image, upload audio, boost post) fall back to their own
default text. No screen depended on the exception text to decide what to do.

## 10. Sign-in and session hardening (hardening items B3, B4, B6, B7, B10, G7, A6; D50 to D55)

Real-database check: `backend/scripts/auth-hardening-check.js` (nebulaa_dev only, whole app in process, throwaway
`zz.auth-hardening-check` users, code mailer and owner alert stubbed): 10 PASS, cleanup complete. Token version (B5)
was already built (D46); the check confirms the token from before a password change is 401.

### Account enumeration (B3, D50)
- `POST /api/auth/send-otp` and `/forgot-password`: always 200 `If an account exists, we have sent a code.` A code is
  hashed in every case (a throwaway one when there is no account); it is stored and mailed after the answer, only to
  a real account (send-otp: unverified accounts only), at most one a minute (a second ask inside the minute gets the
  same 200 and sends nothing; the 429 with `retryAfter` is gone). A mail failure is logged, never shown.
- `/verify-otp`, `/verify-reset-otp`, `/reset-password`: one 400 `That code did not work. Check it, or request a new
  code.` for no account, already verified (verify-otp), no code, expired, five wrong tries or a wrong code; the same
  bcrypt compare runs in every case (a dummy hash). `attemptsRemaining`, `expired` and `maxAttempts` are gone.
- `/login`: unknown email compares against a dummy hash (same time), same 401 `Invalid email or password. Please try
  again.` (no attempts count); "deactivated" is said only after the right password; never 423.
- KEPT ON PURPOSE: sign-up answers `An account with this email already exists. Please sign in.` (and the alias
  message). A person signing up again needs to be told to sign in; hiding it would leave them waiting for a code.
  Residual risk: someone can learn that an email has an account by trying to sign up with it. Bounded by the sign-up
  limiter (5 a day per address), the bot check (when `TURNSTILE_SECRET_KEY` is set) and the credential limiter.

### Strict bearer (B6, D53)
`backend/utils/bearer.js` `extractBearer(req)` = `/^Bearer\s+(\S+)$/i`, used by `protect`, `protectCached`,
`optionalAuth`, the admin bootstrap check, the per-user limiter key, the live inbox stream and the socket hub (which
now also reads a strict `Authorization` header). `Bearerx <token>`, `Bearer<token>`, two tokens or another scheme are
no token (401). A `?token=` or handshake token must be one string with no spaces. A guard test fails if any other file
parses the header by hand.

### Demo sign-in and start-up check (B7, D53)
- Demo tokens (`demo:<email>`, no password) only when `ALLOW_DEMO_AUTH=1` AND `NODE_ENV` is not production. A missing
  or placeholder `MONGODB_URI` no longer turns it on. Local development without a database: set `ALLOW_DEMO_AUTH=1`.
- `backend/utils/bootEnv.js` `validateBootEnv(env)` runs first in `server-main.js`: exit 1 with a clear message when
  `JWT_SECRET` is missing (any environment), or in production when `JWT_SECRET` is under 32 characters, `MONGODB_URI`
  is missing (or the example placeholder) or `HASH_PEPPER` is missing. In development these only warn. Loading the app
  without starting it (`NEBULAA_SERVER_NO_START=1`, scripts and tests) only prints.

### Sign-in lockout (B4, D51)
`backend/services/loginGuard.js`, replacing "5 wrong passwords lock the account for 30 minutes from anywhere" (which
let anyone lock a named person out). Keyed by the TYPED email, whether or not it has an account (same answers).

| Rule | Default | Env |
|---|---|---|
| Wait after the k-th wrong password in a row from one address | 1, 2, 4, 8 s (cap 30 s) | `LOGIN_DELAY_BASE_MS` (1000; 0 = off) |
| Lock of that address for that email | after 5, for 15 minutes | `LOGIN_IP_LOCK_AFTER`, `LOGIN_IP_LOCK_MINUTES` |
| Per-email ceiling (all addresses) | 30 wrong passwords an hour | `LOGIN_ACCOUNT_CEILING` |
| Addresses remembered after a good sign-in | 90 days | `LOGIN_SEEN_DAYS` |
| Bot check hook | off | `LOGIN_CHALLENGE=on` + `TURNSTILE_SECRET_KEY`, after `LOGIN_CHALLENGE_AFTER` (3) |

- A try inside the wait or the lock is 429 with `Retry-After` and `retryAfter`, and the password is NOT checked (no free
  guesses). Another address is not affected, so the owner signs in from home while an attacker is locked out.
- At the ceiling the account owner gets one email that hour ("Unsuccessful sign-in attempts on your Nebulaa account",
  via Resend), and until the hour ends only addresses that signed in to that account before may try; the owner is
  never locked out from a place they used before. An email with no account counts the same way and gets no email.
- "Seen" means the same address (IP). There is no device id in the app; an owner on a new network during an attack
  waits for the hour or resets the password (reset is not blocked by the lockout).
- Counters: MongoDB collection `login_attempts` (TTL index on `expireAt`, shared by every task), in memory when no
  database is connected. Keys and the `eh` field are HMAC hashes (HASH_PEPPER): no email or address in clear. A store
  error lets the sign-in through (logged), like the request limiters; the credential limiter still applies.
- The old fields `failedLoginAttempts` / `lockUntil` are no longer read or written; a good sign-in clears leftovers.
- LOGIN_CHALLENGE has no screen yet: the API answers 429 `challengeRequired: true`; the sign-in page would need a
  Turnstile box that sends `challengeToken`. Leave it off until that exists.

### Password policy and admin bootstrap (B10, D54)
- New passwords (sign-up, change-password, reset-password): at least 10 characters, a letter and a number, not in
  `backend/data/common-passwords.txt` (268 very common passwords written from published lists, compared without
  case, read once into a Set: a curated short list, NOT an exhaustive 10k list), not the email's name. Friendly
  messages (`backend/utils/passwordPolicy.js`). Existing accounts keep signing in with their current password.
- `/api/admin/login` and `/make-owner` (the one-time first-Owner door with `ADMIN_EMAIL` / `ADMIN_PASSWORD`): 404 unless
  `ALLOW_ADMIN_BOOTSTRAP=1`; the shared login is refused (409) once an Owner exists, so the door closes after use.
- Staff MFA: not built (P2). Staff sign in like everyone else, with the new lockout and policy.

### Secret fallbacks (G7, D52)
- `HASH_PEPPER` (`backend/utils/hashPepper.js`) keys the deletion records and tombstones, the free Blueprint
  visitor-address hash and the lockout keys. Required in production; derived from `JWT_SECRET` in development (logged
  once); a random per-process key when nothing is set (tests). The literal fallbacks `'nebulaa-account-hash'` and
  `'blueprint'` are gone; a guard test refuses any new `SECRET|PEPPER|SALT ... || '<literal>'`.
- Compatibility: tombstones written before were HMAC(JWT_SECRET). New ones use the pepper only; LOOKUPS
  (`emailLookupHashes`, the free Blueprint "deleted before" check) try both keys, so a person deleted before the change
  is still recognised. The literal was only used when JWT_SECRET was missing, which never happened where sign-in works,
  so it is not kept. The Blueprint address count is compared within one day only, so no earlier key is kept (for one
  day after the release, earlier Blueprints from an address are not counted against it).

### Crash policy (A6, D55)
`backend/utils/crashPolicy.js`, installed at the top of `server-main.js`:
- `unhandledRejection`: one structured JSON log line. Known-safe (ECONNRESET, EPIPE, aborted, premature close, a busy
  password hasher, a cancelled request): keep running. Anything else: exit code 1, then after `CRASH_GRACE_MS` (5 s)
  the same stop as below. `UNHANDLED_REJECTION_POLICY=log` is the kill switch back to "log only".
- `uncaughtException`: log, health and ready 503, stop taking connections, close idle keep-alive connections, open
  requests get up to `CRASH_DRAIN_MS` (10 s), exit 1. ECS starts a fresh task. One shutdown even if more errors follow.
- SIGTERM keeps its drain (`SHUTDOWN_DRAIN_MS`, 20 s) and exits 0.
- Watch after release: any `"type":"unhandledRejection","action":"exiting"` line is a bug that now restarts the task
  (a long generation request on that task is cut). If they are frequent, set `UNHANDLED_REJECTION_POLICY=log` and fix.

### Frontend text that no longer matches (owner or frontend job; not edited here)
- `frontend/pages/Auth.tsx`: password checklist "At least 8 characters" (lines 572 and 892) and the checks
  `password.length >= 8` (line 103) and `fpNewPassword.length >= 8` (line 403): change to 10. The checklist also asks
  for a special character, which the server does not require (fine: stricter on the screen).
- `frontend/pages/Settings.tsx`: "Password must be at least 8 characters" and `newPassword.length < 8` (lines 239 to 240)
  and the hint "Must be at least 8 characters" (line 578): change to 10.
- No screen reads "No account found", `attemptsRemaining`, `expired`, `maxAttempts` or a 423: the flows keep working.
  The resend button already sets its own 60 s cooldown on success. The sign-in page shows the server's 429 message
  (`Please wait N seconds ...`) as it shows any error.

## 11. Background leases, logging, compression, auth error text (hardening items E2, A7, A8, A4 remainder; D56 to D58)

### Leases around scheduler ticks (E2, D56)
- `backend/services/leaseLock.js` (`withLease(name, ttlMs, fn, {cooldownMs})`, `leased(...)` for a timer's tick) on the `job_leases` collection (`models/JobLease.js`). An accidental second worker, or a web task started without `RUN_BACKGROUND=0`, now skips a tick the other server holds instead of sending, publishing or charging twice. The campaign publish tick is the highest risk (it had no per-campaign claim): its lease is `scheduler:campaign-publish` (10 minutes, renewed every 3 minutes while it runs), and ticks of one process can no longer overlap either.
- Lease names are unique and start with `scheduler:`. Look at them with `db.job_leases.find()`; a stuck name clears itself when `expiresAt` passes (a crashed server's lease lasts at most its ttl). Rows are deleted a day after expiry.
- Guard tests: `tests/leaseLock.test.js` (two holders, expiry takeover, renewal, failing tick releases, cooldown, store failure means skipped), `tests/schedulerLeases.test.js` (every starter in `startBackgroundJobs()` is leased, holds an OpsState lease, or is on the allowlist with a reason; names unique).
- Not a replacement for `RUN_BACKGROUND=0` on the web service: that stays the way to run background work in one place.

### Logging (A7, D57)
- Format: one JSON object per line, for example `{"level":30,"time":"2026-10-20T10:50:18.620Z","req":{"id":2,"method":"GET","url":"/api/social/inbox/stream?token=[redacted]"},"res":{"statusCode":200},"responseTime":5,"msg":"GET /api/social/inbox/stream 200"}`. Levels are numbers (30 info, 40 warn, 50 error). `LOG_LEVEL` = fatal, error, warn, info (default), debug, trace or silent.
- No headers are logged; a `token=` value, a Bearer token and a cookie never appear (unit test `tests/loggingAndCompression.test.js`). Use `require('./utils/logger')` (`logger.info/warn/error`, printf arguments, an Error as the last argument is logged as `err`); new code should not add `console.*`.
- Search in CloudWatch Logs Insights: `fields @timestamp, req.method, req.url, res.statusCode, responseTime | filter res.statusCode >= 500`.

### Compression and cache headers (A8, D57)
- gzip/deflate for responses over 1 KB when the client sends `Accept-Encoding`; `text/event-stream` (the Inbox live stream) is never compressed. If the load balancer or CloudFront already compresses, nothing breaks (a compressed answer is passed through).
- `backend/public/assets/<name>-<hash>.<ext>` is `public, max-age=31536000, immutable`; `index.html` is `no-cache`; `X-Content-Type-Options: nosniff` stays (helmet).

### Error text in `routes/auth.js` (A4 remainder, D58)
- Fixed: the LinkedIn scrape helper's `error` field, the sign-up validation message (was joined from Mongoose messages; now one plain sentence per field from our own list), and the 429 sign-in sentence (chosen by reason from `services/loginGuard.js` MSG; same words). `routes/auth.js` is no longer in `SKIP` (codemod) or `SKIPPED` (`noErrorLeaks.test.js`); the `objectIdParams` test no longer skips it either (it has no `:id` routes).

