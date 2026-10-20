# Frontend performance (2026-10-20)

Why: the owner said the app feels sluggish, and the load test found a ~3 MB script on first load. All figures below are from `cd frontend && npx vite build` (sizes in KB, raw / gzip). Nothing was released.

## Before and after

| First load (what every visitor downloads) | Before | After |
|---|---|---|
| Main script | 3,240.2 / 864.3 | 314.5 / 88.7 |
| React (own file, cached across releases) | inside main | 195.9 / 61.4 |
| Router (own file) | inside main | 39.7 / 14.4 |
| **Scripts total** | **3,240 / 864** | **550 / 164** |
| Style sheet (build output) | 204.1 / 34.9 | 47.3 / 9.5 (each page's own styles load with the page) |
| Other first-load files | none | none (Home is in the main script on purpose, see below) |

About 17 percent of the old first-load script size (19 percent of the old gzip size) is still downloaded on the first screen.

Loaded only when needed (gzip): PDF libraries 241.5 (only on a PDF download), Excel 271.3 (only on a spreadsheet export), Photoshoot 6.2, Campaigns (old page) 73.6, Dashboard (old page) 32, Staff area 38.4, Reel studio 34.8, Onboarding 18.9, Create 19.8, Plan 19.3, Insights 18.8, Library 12.7, guided tour 3.2. About 160 page and shared files in total; each page costs 1 to 35 KB gzip.

What dominated the old script: `services/api.ts` (190 KB of source, the biggest single file), then the PDF libraries (jspdf, html2canvas, dompurify: 242 KB gzip, pulled in through two static imports), ExcelJS (271 KB gzip, already on demand), then every page. `recharts` and `socket.io-client` are imported but unused (tree-shaken, no cost).

Home stays in the main script: it is the page every signed-in visitor lands on, so loading it as a separate file would add one more round trip before the first screen. Measured: the Home page is small beside the shell; keeping it eager costs nothing extra.

## Tailwind at build time (2026-10-20, D67)

The Tailwind Play CDN script is gone. Tailwind now runs inside `vite build` (and the dev server) through PostCSS, with the same version the CDN served (3.4.17, pinned exactly) and the same config `index.html` used to set in the browser.

| First load, sizes in KB raw / gzip (`vite build`; the CDN script measured from `cdn.tailwindcss.com/3.4.17`) | Before | After |
|---|---|---|
| Tailwind Play CDN script (third party, ran before the first paint, then built the styles in the browser and watched the page for changes) | 407.3 / 123.1 | gone |
| Main style sheet `index-*.css` (now holds all Tailwind rules the source uses) | 47.3 / 9.5 | 199.0 / 32.1 |
| `index.html` (the page `<style>` with tokens and the override layer stays inline) | 111.5 / 18.4 | 110.4 / 17.8 (the inline config script and import map are gone; autoprefixer adds a few prefixes to the inline style) |
| Scripts of the app (unchanged) | 551 / 165 | 551 / 165 |
| **Total first load** | **1,117 / 316** | **861 / 215** |

So every first visit downloads about 100 KB gzip less, makes one fewer third-party connection, and no longer runs a 407 KB compiler before anything is drawn. Local measurement in headless Chrome on the production build with sample data (cache off, 7 loads, median): first contentful paint 164 ms -> 128 ms, DOMContentLoaded 150 ms -> 48 ms. On a phone and a slow network the gain is larger (the CDN script was a third-party round trip plus parse and compile on the main thread). The style sheet is 22.6 KB gzip bigger because it now holds every class in the source rather than the ones on the current page; it is cached as `immutable` with the other assets.

What changed:
- `frontend/tailwind.config.js` (the inline config: `darkMode: 'class'`, the `nebula` and `gravity` colours, the `serif` and `sans` font families, no plugins; the CDN loaded none). `content`: `index.html`, the root `*.{ts,tsx}` and `components`, `pages`, `context`, `hooks`, `utils`, `services`, `constants` (not `tests`, `scripts`, `node_modules`). `safelist`: six hover classes the source builds from pieces (`hover:${isDarkMode ? 'bg-[#161b22]' : 'bg-[#f5f5f5]'}` in `pages/Dashboard.tsx` and the like in `components/NotificationBell.tsx`); the Play CDN saw them in the live page, a build cannot. `tests/tailwindBuild.test.mjs` fails when a new `variant:${...}` appears.
- `frontend/postcss.config.js` (tailwindcss, autoprefixer), `frontend/index.css` (`@tailwind base; components; utilities`), imported FIRST in `index.tsx`.
- `index.html`: removed the CDN script and its preconnect, the inline config script and the esm.sh import map (nothing imported from esm.sh: the build bundles React, Router and icons). The Google Fonts stylesheet stays non-blocking (`media=print`, preconnect, `noscript` copy); its inline `onload` handler moved into the bundle (`utils/fontStyles.ts`), so the page has no inline script left.
- Cascade order is the one the CDN produced, measured in the browser: the page `<style>` in `index.html` (tokens, override layer, LIGHT SEMANTICS) first, then the Tailwind rules, then each component's own `.css`. The CDN appended its `<style>` after the page `<style>`; Vite puts the built `<link>` after it too. The override layer wins by specificity (`body.gravity-shell ...`), never by order, so it did not move. One difference: in the old production build the entry chunk's own CSS (`index-*.css`, then component styles only) came BEFORE the CDN sheet; now the Tailwind rules are at the top of that same file, so those component styles come after the utilities, which is the order the dev server and the audit preview always had. No screen changed (below).
- `scripts/visual-audit/gen-layer-lists.mjs` skips tool config files (`*.config.js`): the theme hex colours in `tailwind.config.js` would otherwise read as inline backgrounds. The generated block is byte-identical.
- `scripts/visual-audit/vite.audit.config.mjs`: runs Tailwind with the fixture pages added to `content` (so the production build carries no audit-only classes), and `/__layer-fixtures` links `/index.css` and switches the font sheet on itself (it has no app script).
- CSP (report-only): `cdn.tailwindcss.com` and `esm.sh` removed from `script-src` and `connect-src` in `backend/config/csp.js` and `nginx.conf` (D67, security-hardening.md section 5).

Proof that nothing changed on screen:
- Pixel diff, headless Chrome, sample-data preview, before from the committed code (a second worktree) and after: 21 screens at 1280 and 375 (Home, My plan, Create, Videos, Photoshoot, Library needs approval and all, Inbox, Insights performance, Competitors, What Nebulaa learned, Settings billing and profile, Help, Plan calendar, Brand assets, Connect socials, Blueprint, landing, both layer-fixture pages), up to 4 viewport-high segments of each page's scroller (121 images per set), animations off. Every screen 0.000 percent at a tolerance of 16 per channel; at tolerance 0 the largest is 0.032 percent (Library all at 375: text anti-aliasing). The same 19 app screens on the production builds (before with the CDN, after with the built CSS, served with the mock session): 0.000 percent everywhere.
- Contrast audit (all modes, 1280 and 375, 182 result files): failures 147 (1280) and 70 (375) before and after, every one of the 182 results identical (elements checked, failures, ratios). The gate was already FAIL before for the known items (`layer-needs-fix.json`, unsigned unknowns); unchanged.
- Purge: every class in the DOM of every audit route (1,868 tokens, both widths, all modes) was compiled with Tailwind and looked up in the build output. Missing: none of the app's classes (the six composed hover classes were found this way and safelisted); the 15 still missing exist only in the audit fixture pages, which the audit server adds for itself.
- Dark theme: not applicable. The app is light only (`utils/theme.ts` removes `dark`), so `dark:` variants never apply, before or after.
- Docker: `docker build -f Dockerfile.frontend` (Node 20.20.2; `npm ci` installs the dev dependencies in the build stage, and Tailwind runs inside `npm run build`) produced the same CSS file (same hash) as the local build; the nginx container served it as `text/css`, gzip, `public, immutable`, with the new report-only CSP header.

## What changed

- `App.tsx`: every page except Layout and Home is `lazyWithRetry` (list of loaders in `utils/routeChunks.ts`). HashRouter, every route and every redirect are unchanged (guarded by `tests/lazyPages.test.mjs` and the older route tests).
- `utils/lazyWithRetry.ts`: a failed page download is retried once after 400 ms; after a second failure the error screen asks for a reload.
- `components/RouteErrorBoundary.tsx`: covers both route tables. A page file that is gone after a release shows "Nebulaa has been updated" with a Reload button; any other page crash shows a plain message and a Reload button; the menu keeps working (the boundary clears when the address changes).
- `components/RouteFallback.tsx`: a calm placeholder that draws nothing for the first 150 ms, so a fast load never flashes.
- Prefetch (small): after the browser is idle it fetches Library, Create and Plan; hovering or focusing a menu link fetches that page (`PagePrefetcher` in `App.tsx`). A page is requested once.
- `vite.config.ts`: library groups `vendor-react`, `vendor-router`, `vendor-pdf`, `vendor-socket` (the last is empty today). Vite's own preload helper is pinned into `vendor-react`; without that line it landed in the PDF group and dragged 242 KB gzip into the first load.
- The PDF libraries load when someone presses Download (`StrategyDocumentView`, `generateAnalyticsPDF`). The guided tour loads when it opens (`Layout.tsx`). Three small pop-ups (plan prompt, terms prompt, deletion screen) load when shown.
- Razorpay: `checkout.js` is no longer in `index.html`. `utils/loadRazorpay.ts` adds it the first time a payment starts (the plans page and the extra-slot purchase). It is a third-party script; saving it from every page load also removes one request and one connection.
- `index.html`: early connections (preconnect) to the style and font hosts; the Google Fonts stylesheet no longer blocks the first paint (`media=print` swap with a `noscript` fallback; `display=swap` was already set).

## Render-blocking items in `index.html`

| Item | Cost | Done / advice |
|---|---|---|
| Tailwind Play CDN script (`cdn.tailwindcss.com`) | Was the largest remaining cost: 407 KB (123 KB gzip) of script that ran before the first paint, then built the styles in the browser and re-scanned the page on every change. | Removed (D67): Tailwind is built at build time. See "Tailwind at build time". |
| Google Fonts stylesheet (9 families) | Blocked the first paint on a third-party round trip, then font files for any family used. | Made non-blocking, preconnect added. Advice: the 9 families (Montserrat, Poppins, Lora, Roboto, Tamil, Devanagari are picks for posts or languages) could load only when chosen; or self-host the two used by the app shell (Plus Jakarta Sans, Playfair Display) as woff2 with a `preload`. Not done, it needs a design check. |
| esm.sh import map | Zero. The build bundles React, Router and icons, so nothing read the map. | Removed (D67). |
| Razorpay `checkout.js` | One blocking third-party request on every page. | Now loaded on first payment. |

## Tailwind: the risk of moving to a build step (resolved by D67, kept for the record)

This was written before the move; "Tailwind at build time" above says how each point was handled (the layer did not move: it wins by specificity and stays before the utilities, as with the CDN). The styles were produced in the browser. A build-time Tailwind (PostCSS plugin plus a `tailwind.config` with the same colours and font families that `index.html` sets in `tailwind.config = {...}`) would remove the biggest remaining cost and also remove the flash of unstyled content. It is not a small change here, so it was not done:

1. The light-theme layer (`gen-layer-lists.mjs` writes the class lists into `index.html`) overrides Tailwind classes such as `bg-white/5` and `text-white` and relies on that rule order: the CDN adds its generated sheet at a known place. With a build, the generated sheet comes from a `<link>` in a different order, so the overrides could lose to the utilities (specificity ties are decided by order). The layer would have to move into the build as a real `@layer` or be loaded after Tailwind.
2. The generator and `tests/layer-lists.test.mjs` scan class names in the source. Arbitrary values (`bg-[var(--gv-bg)]`) and class names assembled in strings must still be found by the Tailwind `content` globs, or they silently lose their styles.
3. The visual and contrast audit (`scripts/visual-audit`) was measured against the CDN output; it must be run again in full.

Proposed order: (a) add Tailwind as a build dependency with the config copied from `index.html`; (b) move the layer into `index.css` after the utilities; (c) regenerate the lists; (d) run the contrast audit at 1280 and 375; (e) delete the CDN script. Expect a further saving of about 300 KB script and the removal of the in-browser build.

## Requests made when pages open

Read from the code and measured in the sample-data preview (Home mounted from Library: 7 calls: week, photoshoot packs, home summary, draft counts, best competitor posts, draft options, tour).

| Duplicate or waste | Fix |
|---|---|
| Notification bell fetched the full list twice on every load for any account with unread notifications, and again each time the count changed: its timer effect depended on the count, so each answer restarted it. | The effect runs once; the latest count is kept in a ref. The browser notification still reads the latest list. |
| Bell (limit 10) and the reminder pop-up (limit 20) fetched the same list. | The bell now asks for 20 and shows the newest 10; the two share one request. |
| Any two identical reads started together (credit balance, draft counts on Library: the menu badge and the page, user info) made two requests. | `apiCall` shares one running read between callers (`utils/inflight.ts`): GET only, no caching after the request ends, so nothing shown can be stale. |
| Background tabs polled every 30 and 60 seconds (credits, draft counts, unread count, reminders). | They skip the call while the tab is hidden. |

Typical Home first load for a signed-in account, requests to the API: before about 12 (user, credits, draft counts, notifications x2 to x3, summary, week, packs, best posts, draft options, setup card), after about 10 (notifications once, and no duplicate when two parts ask the same thing at once). Waterfalls: the only one on Home is the Setup card, which waits for the summary on purpose so finished accounts skip the call.

Intervals shorter than 15 seconds, all reported and left alone because each one runs only while something is actually being made: Library 8 s (only while a post is being created), Videos history 8 s and its status poll 5 s (only while a video is processing), Create 6 s (only while a draft is processing), Calendar covers 6 s, Review 6 s, background reel indicator 8 s (only while a reel is rendering). Idle pages poll only at 30 and 60 seconds.

## What still needs infrastructure

The web app is served by nginx (`nginx.conf`, built into `Dockerfile.frontend`), behind a load balancer.

- Compression: gzip was already on; this change sets level 5 and `gzip_proxied any` (the load balancer adds a header that otherwise switches compression off) and adds font and manifest types. Brotli is about 15 to 20 percent smaller than gzip but is not in the stock `nginx:alpine` image: either add the brotli module to the image or turn on compression at the CDN (CloudFront: enable "Compress objects automatically", which serves brotli and gzip).
- Cache headers: already correct. `/assets/` is `public, immutable` for one year (file names carry a hash), `index.html` is `no-cache`. A missing old file under `/assets/` returns 404 (not the home page), which is what lets the reload prompt appear after a release.
- A CDN in front of the static files (CloudFront) so scripts come from a nearby edge instead of the ALB in ap-south-1: the biggest remaining network gain after the Tailwind change.
- HTTP/2 or HTTP/3 on the load balancer or CDN (the container listens on plain HTTP; the ALB terminates TLS and supports HTTP/2): confirm the listener has it on. With about 160 small files, HTTP/1.1 would be slow.
- Optionally keep the previous release's `/assets/` files for a few days after a deploy so open tabs of the old release do not get 404s; the retry and reload prompt cover the rest.

## Checks run

Tailwind at build time (D67): `npx vite build` (also on Node 20.20.2, same output), `node --test tests/*.test.mjs` (875 pass), `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors), `node scripts/visual-audit/gen-layer-lists.mjs --check`, brand, voice and art-budget audits, the pixel diff and contrast audit above, `docker build -f Dockerfile.frontend` and the container serving the CSS, the backend suite (CSP test).

Earlier (code splitting):

`npx vite build`, `node --test tests/*.test.mjs` (843 pass, includes the brand, voice and art-budget audits and the layer-list test), `npx tsc --noEmit` (the one old error in `pages/Influencers.tsx`), and the sample-data preview on port 3170: eleven routes opened in a row (Library, Create, Plan, Insights, Videos, Photoshoot, Settings, Help, Brand assets, the Upload redirect, Home), each loaded on demand with no console error and no error screen.
