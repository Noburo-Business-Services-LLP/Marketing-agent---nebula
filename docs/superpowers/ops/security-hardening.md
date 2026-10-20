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
