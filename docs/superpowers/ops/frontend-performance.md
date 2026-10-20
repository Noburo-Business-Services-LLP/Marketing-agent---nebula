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

Only about 19 percent of the old first-load script size (and 19 percent of the old gzip size) is still downloaded on the first screen.

Loaded only when needed (gzip): PDF libraries 241.5 (only on a PDF download), Excel 271.3 (only on a spreadsheet export), Photoshoot 6.2, Campaigns (old page) 73.6, Dashboard (old page) 32, Staff area 38.4, Reel studio 34.8, Onboarding 18.9, Create 19.8, Plan 19.3, Insights 18.8, Library 12.7, guided tour 3.2. About 160 page and shared files in total; each page costs 1 to 35 KB gzip.

What dominated the old script: `services/api.ts` (190 KB of source, the biggest single file), then the PDF libraries (jspdf, html2canvas, dompurify: 242 KB gzip, pulled in through two static imports), ExcelJS (271 KB gzip, already on demand), then every page. `recharts` and `socket.io-client` are imported but unused (tree-shaken, no cost).

Home stays in the main script: it is the page every signed-in visitor lands on, so loading it as a separate file would add one more round trip before the first screen. Measured: the Home page is small beside the shell; keeping it eager costs nothing extra.

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
| Tailwind Play CDN script (`cdn.tailwindcss.com`) | Largest remaining cost. About 300+ KB of script that must run before the first paint, then builds the styles in the browser and re-scans the page on every change. Production use is discouraged by Tailwind itself. | Not removed: the whole app depends on it at run time. Preconnect added. See "Tailwind" below. |
| Google Fonts stylesheet (9 families) | Blocked the first paint on a third-party round trip, then font files for any family used. | Made non-blocking, preconnect added. Advice: the 9 families (Montserrat, Poppins, Lora, Roboto, Tamil, Devanagari are picks for posts or languages) could load only when chosen; or self-host the two used by the app shell (Plus Jakarta Sans, Playfair Display) as woff2 with a `preload`. Not done, it needs a design check. |
| esm.sh import map | Zero. The build bundles React, Router and icons, so nothing reads the map. It only matters if someone opens the source without a build. | Left alone; safe to delete later. |
| Razorpay `checkout.js` | One blocking third-party request on every page. | Now loaded on first payment. |

## Tailwind: the risk of moving to a build step

The styles are produced in the browser. A build-time Tailwind (PostCSS plugin plus a `tailwind.config` with the same colours and font families that `index.html` sets in `tailwind.config = {...}`) would remove the biggest remaining cost and also remove the flash of unstyled content. It is not a small change here, so it was not done:

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

`npx vite build`, `node --test tests/*.test.mjs` (843 pass, includes the brand, voice and art-budget audits and the layer-list test), `npx tsc --noEmit` (the one old error in `pages/Influencers.tsx`), and the sample-data preview on port 3170: eleven routes opened in a row (Library, Create, Plan, Insights, Videos, Photoshoot, Settings, Help, Brand assets, the Upload redirect, Home), each loaded on demand with no console error and no error screen.
